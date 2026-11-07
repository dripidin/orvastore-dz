-- ==============================================================================
-- ORVA STORE — disposable local role/schema bootstrap for orva_local ONLY
-- DO NOT run on hosted Supabase / Production.
-- Placeholders __APP_PASSWORD__ and __STAGING_LOGIN_PASSWORD__ substituted by setup script.
-- ==============================================================================

BEGIN;

-- Minimal orders table for recovery reconcile tests (public)
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id TEXT UNIQUE NOT NULL,
    store_id TEXT,
    full_name TEXT,
    phone TEXT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.orders FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.orders TO service_role;

-- Production-shaped app role (LOGIN, NOT superuser) for Node/PHP integration tests
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orva_app_local') THEN
    CREATE ROLE orva_app_local LOGIN PASSWORD '__APP_PASSWORD__' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE orva_app_local WITH LOGIN PASSWORD '__APP_PASSWORD__' NOSUPERUSER;
  END IF;
END $$;

-- Production-shaped local role: BYPASSRLS like service_role, but NOT superuser.
ALTER ROLE orva_app_local BYPASSRLS;
GRANT USAGE ON SCHEMA public TO orva_app_local;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO orva_app_local;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO orva_app_local;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orva_app_local;

-- Staging isolation model: staging_login (LOGIN) + staging_user (NOLOGIN)
CREATE SCHEMA IF NOT EXISTS staging;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'staging_user') THEN
    CREATE ROLE staging_user NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'staging_login') THEN
    CREATE ROLE staging_login LOGIN PASSWORD '__STAGING_LOGIN_PASSWORD__' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE staging_login WITH LOGIN PASSWORD '__STAGING_LOGIN_PASSWORD__' NOSUPERUSER;
  END IF;
END $$;

GRANT staging_user TO staging_login;
GRANT USAGE ON SCHEMA staging TO staging_user, staging_login;

CREATE TABLE IF NOT EXISTS staging.inventory_items (
    LIKE public.inventory_items INCLUDING ALL
);
CREATE TABLE IF NOT EXISTS staging.inventory_reservations (
    LIKE public.inventory_reservations INCLUDING ALL
);
CREATE TABLE IF NOT EXISTS staging.inventory_audit (
    LIKE public.inventory_audit INCLUDING ALL
);
CREATE TABLE IF NOT EXISTS staging.idempotency_records (
    LIKE public.idempotency_records INCLUDING ALL
);
CREATE TABLE IF NOT EXISTS staging.rate_limits (
    LIKE public.rate_limits INCLUDING ALL
);
CREATE TABLE IF NOT EXISTS staging.orders (
    LIKE public.orders INCLUDING ALL
);

ALTER TABLE staging.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.inventory_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.orders ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA staging TO staging_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA staging TO staging_user;

-- staging_login may SET ROLE staging_user; no direct public inventory grants
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM staging_login;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM staging_user;

COMMIT;
