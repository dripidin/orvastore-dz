-- ==============================================================================
-- ORVA STORE — STAGING-ONLY RLS HARDENING v2 (REQUIRES EXPLICIT APPROVAL)
-- Date: 2026-11-06
-- Supersedes (for execution): 2026-11-06-staging-rls-hardening.sql
-- Original file checksum (unchanged reference):
--   SHA-256 4C3AF068AFE0A31B8F5AFD55658BCA1932807273D0BA9534807B263AE4998E52
-- v2 adds: schema USAGE / table privilege revoke from anon & authenticated.
-- DO NOT EXECUTE until approved.
-- DO NOT run against public schema.
-- ==============================================================================

BEGIN;

-- Defensive: drop anon/authenticated policies on staging only
DROP POLICY IF EXISTS "anon staging order insertion" ON staging.orders;
DROP POLICY IF EXISTS "anon staging order read" ON staging.orders;
DROP POLICY IF EXISTS "anon staging rate limits" ON staging.rate_limits;
DROP POLICY IF EXISTS "authenticated staging full management" ON staging.orders;
DROP POLICY IF EXISTS "authenticated staging order_items" ON staging.order_items;
DROP POLICY IF EXISTS "authenticated staging customers" ON staging.customers;
DROP POLICY IF EXISTS "authenticated staging shipments" ON staging.shipments;
DROP POLICY IF EXISTS "authenticated staging inventory" ON staging.inventory_items;
DROP POLICY IF EXISTS "authenticated staging audit_logs" ON staging.audit_logs;

-- Ensure staging_user policies remain
DROP POLICY IF EXISTS "staging_user full access orders" ON staging.orders;
CREATE POLICY "staging_user full access orders"
  ON staging.orders FOR ALL TO staging_user
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "staging_user full access rate_limits" ON staging.rate_limits;
CREATE POLICY "staging_user full access rate_limits"
  ON staging.rate_limits FOR ALL TO staging_user
  USING (true) WITH CHECK (true);

-- Defense in depth: remove schema/table access from anon & authenticated
REVOKE ALL ON SCHEMA staging FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA staging FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA staging FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA staging FROM anon, authenticated;

-- staging_user retains intended access
GRANT USAGE ON SCHEMA staging TO staging_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA staging TO staging_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA staging TO staging_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA staging TO staging_user;

COMMIT;

-- Verification (read-only):
-- SELECT has_schema_privilege('anon','staging','USAGE') AS anon_usage,
--        has_schema_privilege('authenticated','staging','USAGE') AS auth_usage,
--        has_schema_privilege('staging_user','staging','USAGE') AS staging_user_usage;
-- SELECT polname, tablename FROM pg_policies WHERE schemaname='staging' ORDER BY 2,1;
