-- ==============================================================================
-- ORVA STORE — Production orders mutation lockdown (PROPOSAL ONLY)
-- Date: 2026-11-07 (amended after local effective-privileges validation)
-- DO NOT EXECUTE without explicit SEPARATE approval after SELECT containment.
-- ==============================================================================
-- Purpose:
--   Remove legacy RLS that lets anon/authenticated UPDATE/DELETE orders when
--   header x-admin-token matches a hardcoded SQL literal.
--   Revoke mutation privileges from anon/authenticated/PUBLIC, including
--   residual column-level UPDATE grants.
--
-- Preconditions (strict):
--   1. Backup of policies + grants for public.orders.
--   2. All admin UPDATE/DELETE go through PHP using service_role after admin auth.
--   3. Orders SELECT containment already applied and verified.
--   4. Admin status update / cancel / delete smoke-tested on Production.
--
-- Does NOT:
--   - Drop or revoke INSERT (Checkout)
--   - Drop SELECT policies (handled in select-containment file)
--   - Change service_role grants/policies
--   - Touch rate_limits or staging.*
-- ==============================================================================

BEGIN;

DROP POLICY IF EXISTS "Allow admin token order update" ON public.orders;
DROP POLICY IF EXISTS "Allow admin token order delete" ON public.orders;

REVOKE UPDATE ON TABLE public.orders FROM anon;
REVOKE UPDATE ON TABLE public.orders FROM authenticated;
REVOKE UPDATE ON TABLE public.orders FROM PUBLIC;
REVOKE DELETE ON TABLE public.orders FROM anon;
REVOKE DELETE ON TABLE public.orders FROM authenticated;
REVOKE DELETE ON TABLE public.orders FROM PUBLIC;
REVOKE TRUNCATE ON TABLE public.orders FROM anon;
REVOKE TRUNCATE ON TABLE public.orders FROM authenticated;
REVOKE TRUNCATE ON TABLE public.orders FROM PUBLIC;
REVOKE REFERENCES ON TABLE public.orders FROM anon;
REVOKE REFERENCES ON TABLE public.orders FROM authenticated;
REVOKE REFERENCES ON TABLE public.orders FROM PUBLIC;
REVOKE TRIGGER ON TABLE public.orders FROM anon;
REVOKE TRIGGER ON TABLE public.orders FROM authenticated;
REVOKE TRIGGER ON TABLE public.orders FROM PUBLIC;

-- Column-level UPDATE/INSERT/REFERENCES can remain after table REVOKE.
DO $$
DECLARE
  col text;
  role_name text;
  priv text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'PUBLIC'] LOOP
    FOR col, priv IN
      SELECT column_name, privilege_type
      FROM information_schema.column_privileges
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND grantee = role_name
        AND privilege_type IN ('UPDATE', 'REFERENCES')
    LOOP
      IF role_name = 'PUBLIC' THEN
        EXECUTE format('REVOKE %s (%I) ON TABLE public.orders FROM PUBLIC', priv, col);
      ELSE
        EXECUTE format('REVOKE %s (%I) ON TABLE public.orders FROM %I', priv, col, role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;

COMMIT;

-- ==============================================================================
-- Post-apply verification (catalog only):
--
-- admin-token UPDATE/DELETE policies absent.
-- No UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER table grants to anon/authenticated/PUBLIC.
-- No column UPDATE/REFERENCES for those grantees.
-- INSERT privilege for anon/authenticated should still exist until Checkout migrates.
-- service_role UPDATE/DELETE/SELECT should still exist.
--
-- Rollback: restore from backup only — do not reintroduce hardcoded token policies.
-- ==============================================================================
