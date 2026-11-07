-- ==============================================================================
-- ORVA STORE — STAGING-ONLY RLS HARDENING (REQUIRES EXPLICIT APPROVAL)
-- Date: 2026-11-06
-- DO NOT EXECUTE until approved.
-- DO NOT run the public-schema proposal against Production as a "Staging test".
-- ==============================================================================
-- Architecture:
--   Production orders live in schema public.
--   Staging orders live in schema staging (same Supabase project).
--   Staging PHP must authenticate as staging_user via SUPABASE_STAGING_TOKEN
--   and send Accept-Profile / Content-Profile: staging.
-- Goal:
--   Confirm anon/authenticated have zero direct access to staging.orders and
--   related staging tables. Keep staging_user policies intact.
-- Non-goals:
--   No changes to public.* policies.
--   No GRANT/REVOKE on public.
--   No service_role substitution for staging_user.
-- ==============================================================================

BEGIN;

-- Defensive: drop any anon/authenticated policies if they were reintroduced
DROP POLICY IF EXISTS "anon staging order insertion" ON staging.orders;
DROP POLICY IF EXISTS "anon staging order read" ON staging.orders;
DROP POLICY IF EXISTS "anon staging rate limits" ON staging.rate_limits;
DROP POLICY IF EXISTS "authenticated staging full management" ON staging.orders;
DROP POLICY IF EXISTS "authenticated staging order_items" ON staging.order_items;
DROP POLICY IF EXISTS "authenticated staging customers" ON staging.customers;
DROP POLICY IF EXISTS "authenticated staging shipments" ON staging.shipments;
DROP POLICY IF EXISTS "authenticated staging inventory" ON staging.inventory_items;
DROP POLICY IF EXISTS "authenticated staging audit_logs" ON staging.audit_logs;

-- Ensure staging_user policies remain (recreate if missing)
DROP POLICY IF EXISTS "staging_user full access orders" ON staging.orders;
CREATE POLICY "staging_user full access orders"
  ON staging.orders FOR ALL TO staging_user
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "staging_user full access rate_limits" ON staging.rate_limits;
CREATE POLICY "staging_user full access rate_limits"
  ON staging.rate_limits FOR ALL TO staging_user
  USING (true) WITH CHECK (true);

-- Optional defense in depth (uncomment only after verifying staging_user JWT works):
-- REVOKE ALL ON ALL TABLES IN SCHEMA staging FROM anon, authenticated;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA staging TO staging_user;
-- GRANT USAGE ON SCHEMA staging TO staging_user;

COMMIT;

-- Read-only verification (safe to run separately without this migration):
-- SELECT n.nspname, c.relname, pol.polname, pol.polcmd
-- FROM pg_policy pol
-- JOIN pg_class c ON c.oid = pol.polrelid
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'staging'
-- ORDER BY c.relname, pol.polname;
