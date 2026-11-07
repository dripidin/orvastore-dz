-- ==============================================================================
-- ORVA STORE — PROPOSED RLS HARDENING (REQUIRES EXPLICIT APPROVAL)
-- Date: 2026-11-06
-- DO NOT EXECUTE on Production until separately approved.
-- ==============================================================================
-- Goal:
--   Remove public (anon/authenticated) direct read/insert on customer orders.
--   Checkout must insert only through the PHP backend using a server credential.
-- Impact:
--   - Browser JS using the publishable/anon key can no longer SELECT orders.
--   - Browser JS can no longer INSERT orders directly into PostgREST.
--   - PHP checkout must use a server-side key that is authorized to INSERT
--     (service_role or a dedicated server role with INSERT-only grants).
--   - Admin dashboard continues to read orders via /api/delivery (PHP).
-- Staging isolation (staging schema + staging_user) is unchanged by this file.
-- ==============================================================================

BEGIN;

-- 1) Drop unsafe public policies on orders
DROP POLICY IF EXISTS "Allow anon order insertion" ON public.orders;
DROP POLICY IF EXISTS "Allow anon order read" ON public.orders;

-- 2) Drop unsafe public policies on rate_limits (contains phone / device signals)
DROP POLICY IF EXISTS "Allow anon rate limit insert" ON public.rate_limits;
DROP POLICY IF EXISTS "Allow anon rate limit select" ON public.rate_limits;

-- 3) Keep service_role full access (already present in schema.sql)
-- Recreate defensively if missing:
DROP POLICY IF EXISTS "Service role full access on orders" ON public.orders;
CREATE POLICY "Service role full access on orders"
  ON public.orders
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on rate_limits" ON public.rate_limits;
CREATE POLICY "Service role full access on rate_limits"
  ON public.rate_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4) Optional defense in depth: revoke direct table privileges from anon/authenticated
-- Uncomment only after confirming PHP uses service_role (or equivalent) for writes:
-- REVOKE ALL ON TABLE public.orders FROM anon, authenticated;
-- REVOKE ALL ON TABLE public.rate_limits FROM anon, authenticated;
-- GRANT ALL ON TABLE public.orders TO service_role;
-- GRANT ALL ON TABLE public.rate_limits TO service_role;

COMMIT;

-- ==============================================================================
-- REQUIRED APPLICATION FOLLOW-UP (not SQL):
-- Update Hostinger PHP config so order INSERT uses SUPABASE_SERVICE_ROLE_KEY
-- (or a dedicated server JWT), never the browser publishable key.
-- Never place the service role key in browser JS, Git, ZIP, or public config.
-- ==============================================================================

-- Verification queries (read-only):
-- SELECT polname, polcmd, polroles::regrole[]
-- FROM pg_policy
-- JOIN pg_class c ON c.oid = polrelid
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relname IN ('orders', 'rate_limits');
