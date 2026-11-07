-- ==============================================================================
-- ORVA STORE — PRODUCTION ANON ORDER-READ CONTAINMENT (REQUIRES EXPLICIT APPROVAL)
-- Date: 2026-11-06
-- DO NOT EXECUTE without explicit authorization.
-- ==============================================================================
-- Confirmed exposure:
--   Policy "Allow anon order read" ON public.orders
--   FOR SELECT TO anon, authenticated USING (true)
--   → any holder of the publishable/legacy anon key can list Production orders.
--
-- Also confirmed (same table, separate approval recommended):
--   "Allow admin token order update/delete" TO anon,authenticated with a
--   hardcoded x-admin-token comparison. Not dropped by this surgical file.
--
-- Checkout dependency:
--   Production PHP currently inserts via orva_supabase_rest_request().
--   When SUPABASE_SERVICE_ROLE_KEY is unset, Authorization uses the anon key.
--   Therefore anonymous INSERT must remain until a server credential is live.
--
-- This file ONLY removes anonymous/authenticated SELECT on:
--   - public.orders
--   - public.rate_limits  (phone / device signals)
-- It does NOT drop INSERT policies.
-- It does NOT modify staging.* or revoke table GRANTs.
-- ==============================================================================

BEGIN;

-- 1) Stop anonymous / authenticated reading of Production orders
DROP POLICY IF EXISTS "Allow anon order read" ON public.orders;

-- 2) Stop anonymous / authenticated reading of rate-limit rows (PII-adjacent)
DROP POLICY IF EXISTS "Allow anon rate limit select" ON public.rate_limits;

-- INSERT policies intentionally retained:
--   "Allow anon order insertion" ON public.orders
--   "Allow anon rate limit insert" / "Allow anon rate limit check" ON public.rate_limits
--   "Allow anon order_items insert" ON public.order_items

COMMIT;

-- ==============================================================================
-- ROLLBACK (restore previous SELECT exposure — only if emergency):
-- CREATE POLICY "Allow anon order read"
--   ON public.orders FOR SELECT TO anon, authenticated
--   USING (true);
-- CREATE POLICY "Allow anon rate limit select"
--   ON public.rate_limits FOR SELECT TO anon, authenticated
--   USING (true);
-- ==============================================================================

-- Verification (read-only; do not SELECT customer payloads):
-- SELECT pol.polname, c.relname,
--   CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
--        WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' END AS cmd,
--   ARRAY(SELECT r.rolname FROM pg_roles r WHERE r.oid = ANY(pol.polroles)) AS roles
-- FROM pg_policy pol
-- JOIN pg_class c ON c.oid = pol.polrelid
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relname IN ('orders','rate_limits')
-- ORDER BY c.relname, pol.polname;
--
-- External check (must fail closed after apply):
--   GET /rest/v1/orders?select=order_id&limit=1
--   with anon/publishable Authorization → expect 401/empty under RLS deny
--   (do not print returned row bodies during diagnosis).
