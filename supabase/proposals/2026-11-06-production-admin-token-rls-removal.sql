-- ==============================================================================
-- ORVA STORE — PRODUCTION ADMIN-TOKEN RLS REMOVAL (SEPARATE APPROVAL)
-- Date: 2026-11-06
-- DO NOT EXECUTE without explicit authorization.
-- ==============================================================================
-- Finding:
--   public.orders policies allow anon/authenticated UPDATE and DELETE when
--   request header x-admin-token matches a hardcoded string embedded in RLS.
--   This is independent of PHP session auth and is unsafe.
--
-- Prerequisite before execute:
--   Confirm Production admin order mutations go only through PHP
--   (/api/delivery.php) using a server credential, never browser→PostgREST
--   with x-admin-token.
--
-- This file does NOT change INSERT or SELECT policies.
-- ==============================================================================

BEGIN;

DROP POLICY IF EXISTS "Allow admin token order update" ON public.orders;
DROP POLICY IF EXISTS "Allow admin token order delete" ON public.orders;

COMMIT;

-- Rollback (unsafe — restores prior exposure):
-- Recreate only from a known backup of policy definitions; do not improvise.
