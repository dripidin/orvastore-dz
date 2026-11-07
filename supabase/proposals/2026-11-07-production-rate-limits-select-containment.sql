-- ==============================================================================
-- ORVA STORE — Production rate_limits SELECT containment (PROPOSAL ONLY)
-- Date: 2026-11-07 (amended after local effective-privileges validation)
-- DO NOT EXECUTE without explicit approval for THIS FILE alone.
-- ==============================================================================
-- Purpose:
--   Remove public SELECT on public.rate_limits for anon/authenticated/PUBLIC.
--   Clear residual column-level SELECT grants.
--   Preserve INSERT privilege + INSERT policies used by rate-limit writers.
--   Keep service_role untouched.
--
-- Preconditions:
--   1. Backup of policies + table/column grants for public.rate_limits.
--   2. Confirm Checkout path does not require PostgREST SELECT on rate_limits.
--   3. Prefer applying AFTER orders SELECT containment is verified.
--   4. Catalog check: no unexpected role membership granting SELECT to anon.
--
-- Does NOT:
--   - Drop INSERT policies / Revoke INSERT
--   - Touch UPDATE/DELETE/TRUNCATE (see least-privilege file)
--   - Touch public.orders or staging.*
-- ==============================================================================

BEGIN;

DROP POLICY IF EXISTS "Allow anon rate limit select" ON public.rate_limits;

REVOKE SELECT ON TABLE public.rate_limits FROM anon;
REVOKE SELECT ON TABLE public.rate_limits FROM authenticated;
REVOKE SELECT ON TABLE public.rate_limits FROM PUBLIC;

DO $$
DECLARE
  col text;
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'PUBLIC'] LOOP
    FOR col IN
      SELECT column_name
      FROM information_schema.column_privileges
      WHERE table_schema = 'public'
        AND table_name = 'rate_limits'
        AND grantee = role_name
        AND privilege_type = 'SELECT'
    LOOP
      IF role_name = 'PUBLIC' THEN
        EXECUTE format('REVOKE SELECT (%I) ON TABLE public.rate_limits FROM PUBLIC', col);
      ELSE
        EXECUTE format('REVOKE SELECT (%I) ON TABLE public.rate_limits FROM %I', col, role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;

COMMIT;

-- ==============================================================================
-- Post-apply verification (catalog only):
--
-- Policy "Allow anon rate limit select" absent.
-- No SELECT table/column grants to anon, authenticated, PUBLIC.
-- INSERT grants/policies remain.
--
-- Emergency: restore from backup — do not recreate USING (true) SELECT.
-- ==============================================================================
