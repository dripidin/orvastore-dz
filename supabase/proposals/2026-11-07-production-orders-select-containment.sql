-- ==============================================================================
-- ORVA STORE — Production orders SELECT containment (PROPOSAL ONLY)
-- Date: 2026-11-07 (amended after local effective-privileges validation)
-- DO NOT EXECUTE without explicit approval for THIS FILE alone.
-- ==============================================================================
-- Purpose:
--   Remove public SELECT on public.orders for anon/authenticated/PUBLIC.
--   Clear residual column-level SELECT grants (table REVOKE alone is not enough).
--   Keep INSERT (Checkout dependency when server credential is absent).
--   Keep service_role privileges and policies untouched.
--
-- Preconditions (must be verified BEFORE execute):
--   1. Backup of current pg_policy + role_table_grants + column_privileges for public.orders.
--   2. Hostinger Production PHP loads SUPABASE_SERVICE_ROLE_KEY (delivery.php
--      unauthenticated admin calls should reach 401 UNAUTHORIZED_ACCESS, not 503).
--   3. Admin order list works via PHP with admin session/Bearer.
--   4. Catalog check: anon/authenticated are not members of other roles that
--      still hold SELECT on public.orders (membership is outside this file).
--
-- Does NOT:
--   - Drop INSERT policies / Revoke INSERT
--   - Touch UPDATE/DELETE/TRUNCATE grants (see mutation-lockdown file)
--   - Touch staging.* or any other table
--   - Touch rate_limits (separate file)
--   - Revoke EXECUTE on arbitrary functions
-- ==============================================================================

BEGIN;

-- Remove open SELECT policy (USING true for anon/authenticated).
DROP POLICY IF EXISTS "Allow anon order read" ON public.orders;

-- Table-level SELECT (roles + PUBLIC).
REVOKE SELECT ON TABLE public.orders FROM anon;
REVOKE SELECT ON TABLE public.orders FROM authenticated;
REVOKE SELECT ON TABLE public.orders FROM PUBLIC;

-- Column-level SELECT survives table REVOKE in PostgreSQL — clear explicitly.
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
        AND table_name = 'orders'
        AND grantee = role_name
        AND privilege_type = 'SELECT'
    LOOP
      -- PUBLIC is a special grantee keyword; never quote it as %I.
      IF role_name = 'PUBLIC' THEN
        EXECUTE format('REVOKE SELECT (%I) ON TABLE public.orders FROM PUBLIC', col);
      ELSE
        EXECUTE format('REVOKE SELECT (%I) ON TABLE public.orders FROM %I', col, role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;

COMMIT;

-- ==============================================================================
-- Post-apply verification (catalog only — do NOT SELECT customer payloads):
--
-- SELECT polname FROM pg_policy p
-- JOIN pg_class c ON c.oid = p.polrelid
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relname = 'orders' AND polname = 'Allow anon order read';
-- -- expect 0 rows
--
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
-- WHERE table_schema = 'public' AND table_name = 'orders'
--   AND grantee IN ('anon','authenticated','PUBLIC') AND privilege_type = 'SELECT';
-- -- expect 0 rows
--
-- SELECT grantee, column_name FROM information_schema.column_privileges
-- WHERE table_schema = 'public' AND table_name = 'orders'
--   AND grantee IN ('anon','authenticated','PUBLIC') AND privilege_type = 'SELECT';
-- -- expect 0 rows
--
-- SELECT has_table_privilege('anon','public.orders','SELECT');
-- -- expect false (unless unexpected role membership grants SELECT)
--
-- Confirm INSERT grant/policy still present for Checkout.
--
-- Emergency notes:
--   Do NOT recreate USING (true) SELECT as a normal rollback.
--   Prefer restore from policy/grants backup taken in precondition 1.
-- ==============================================================================
