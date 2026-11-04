-- ==============================================================================
-- ORVA STORE — Phase 8E.3.5: Supabase Staging Schema Rollback
-- FILE: supabase/migrations/20261103_staging_schema_rollback.sql
-- STATUS: UNEXECUTED SPECIFICATION — SAFE ROLLBACK SCRIPT
-- ENGINE: PostgreSQL 15+ / Supabase
-- ==============================================================================
--
-- ROLLBACK SPECIFICATIONS:
-- 1. Strictly Scoped: Drops ONLY objects in schema 'staging' and role 'staging_user'.
-- 2. Zero Public Alteration: CANNOT drop or alter any public table, function, or role.
-- 3. Atomic Transaction: Wrapped in BEGIN; ... COMMIT;.
-- ==============================================================================

BEGIN;

-- ── 1. Drop Staging Triggers ──────────────────────────────────────────────────
DROP TRIGGER IF EXISTS tr_staging_orders_updated_at ON staging.orders;
DROP TRIGGER IF EXISTS tr_staging_customers_updated_at ON staging.customers;

-- ── 2. Drop Staging Functions ─────────────────────────────────────────────────
DROP FUNCTION IF EXISTS staging.execute_order_switch(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS staging.update_updated_at_column();

-- ── 3. Drop Staging Tables (Order respects dependencies) ──────────────────────
DROP TABLE IF EXISTS staging.order_items CASCADE;
DROP TABLE IF EXISTS staging.shipments CASCADE;
DROP TABLE IF EXISTS staging.telegram_dispatch_ledger CASCADE;
DROP TABLE IF EXISTS staging.idempotency_records CASCADE;
DROP TABLE IF EXISTS staging.inventory_audit CASCADE;
DROP TABLE IF EXISTS staging.inventory_items CASCADE;
DROP TABLE IF EXISTS staging.audit_logs CASCADE;
DROP TABLE IF EXISTS staging.risk_events CASCADE;
DROP TABLE IF EXISTS staging.watchlist CASCADE;
DROP TABLE IF EXISTS staging.customers CASCADE;
DROP TABLE IF EXISTS staging.rate_limits CASCADE;
DROP TABLE IF EXISTS staging.orders CASCADE;

-- ── 4. Drop Dedicated Staging Role & Revoke Authenticator Membership ─────────
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') AND EXISTS (SELECT FROM pg_roles WHERE rolname = 'staging_user') THEN
        REVOKE staging_user FROM authenticator;
    END IF;
END
$$;
DROP ROLE IF EXISTS staging_user;

-- ── 5. Drop Schema staging ───────────────────────────────────────────────────
DROP SCHEMA IF EXISTS staging CASCADE;

COMMIT;

