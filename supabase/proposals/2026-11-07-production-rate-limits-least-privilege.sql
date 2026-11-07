-- ==============================================================================
-- ORVA STORE — Production rate_limits least privilege (PROPOSAL ONLY)
-- Date: 2026-11-07 (amended after local effective-privileges validation)
-- DO NOT EXECUTE without explicit SEPARATE approval.
-- ==============================================================================
-- Purpose:
--   Strip unused mutation / DDL-adjacent privileges from anon/authenticated/PUBLIC
--   on public.rate_limits while keeping INSERT for writers that still use anon.
--
-- Preconditions:
--   1. Backup of grants for public.rate_limits.
--   2. rate_limits SELECT containment already applied (recommended).
--   3. Confirm no production path needs anon UPDATE/DELETE on rate_limits.
--
-- Does NOT:
--   - Revoke INSERT / Drop INSERT policies
--   - Touch public.orders or staging.*
--   - Change service_role
-- ==============================================================================

BEGIN;

REVOKE UPDATE ON TABLE public.rate_limits FROM anon;
REVOKE UPDATE ON TABLE public.rate_limits FROM authenticated;
REVOKE UPDATE ON TABLE public.rate_limits FROM PUBLIC;
REVOKE DELETE ON TABLE public.rate_limits FROM anon;
REVOKE DELETE ON TABLE public.rate_limits FROM authenticated;
REVOKE DELETE ON TABLE public.rate_limits FROM PUBLIC;
REVOKE TRUNCATE ON TABLE public.rate_limits FROM anon;
REVOKE TRUNCATE ON TABLE public.rate_limits FROM authenticated;
REVOKE TRUNCATE ON TABLE public.rate_limits FROM PUBLIC;
REVOKE REFERENCES ON TABLE public.rate_limits FROM anon;
REVOKE REFERENCES ON TABLE public.rate_limits FROM authenticated;
REVOKE REFERENCES ON TABLE public.rate_limits FROM PUBLIC;
REVOKE TRIGGER ON TABLE public.rate_limits FROM anon;
REVOKE TRIGGER ON TABLE public.rate_limits FROM authenticated;
REVOKE TRIGGER ON TABLE public.rate_limits FROM PUBLIC;

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
        AND table_name = 'rate_limits'
        AND grantee = role_name
        AND privilege_type IN ('UPDATE', 'REFERENCES')
    LOOP
      IF role_name = 'PUBLIC' THEN
        EXECUTE format('REVOKE %s (%I) ON TABLE public.rate_limits FROM PUBLIC', priv, col);
      ELSE
        EXECUTE format('REVOKE %s (%I) ON TABLE public.rate_limits FROM %I', priv, col, role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;

COMMIT;

-- ==============================================================================
-- Post-apply verification (catalog only):
--
-- No UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER for anon/authenticated/PUBLIC.
-- INSERT for anon remains until Checkout/rate-limit fully server-side.
--
-- Rollback: restore grants from backup only.
-- ==============================================================================
