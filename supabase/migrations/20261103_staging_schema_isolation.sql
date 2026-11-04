-- ==============================================================================
-- ORVA STORE — Phase 8E.3.5: Supabase Staging Migration (Authorization & JWT Final)
-- FILE: supabase/migrations/20261103_staging_schema_isolation.sql
-- STATUS: UNEXECUTED SPECIFICATION — AWAITING EXPLICIT REVIEW & APPROVAL
-- ENGINE: PostgreSQL 15+ / Supabase PostgREST
-- ==============================================================================
--
-- SECURITY & ISOLATION SPECIFICATIONS:
-- 1. Dedicated 'staging' Schema: Complete logical separation from 'public'.
-- 2. Zero Cross-Schema Foreign Keys: All constraints reference staging.*.
-- 3. Zero Trigger Cross-Contamination: Triggers update only staging tables.
-- 4. Function Hardening:
--    - staging.update_updated_at_column(): SECURITY INVOKER with fixed search_path.
--    - staging.execute_order_switch(): SECURITY DEFINER, search_path = pg_catalog, pg_temp,
--      REVOKE EXECUTE FROM PUBLIC, granted exclusively to staging_user.
-- 5. Least-Privilege Role Model & Fail-Closed PostgREST Identity:
--    - Dedicated staging_user role created with explicit REVOKE on schema public.
--    - Direct CLI search_path set to 'staging, pg_temp' (PostgREST uses Profile headers).
--    - PostgREST authenticator granted staging_user role with fail-closed assertion.
--    - PostgREST anon strictly revoked from all objects in staging schema.
--    - PostgREST authenticated strictly revoked from all objects in staging schema.
--    - Zero blanket ALL privileges granted.
-- 6. Comprehensive Row Level Security (RLS):
--    - Active and enforced on all 12 staging tables.
--    - Scoped policies covering 100% of staging tables exclusively for staging_user.
-- 7. Zero Production Customer Data: Synthetic seed records only.
-- ==============================================================================

BEGIN;

-- ── 1. Create Dedicated Staging Schema ─────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS staging;

-- ── 2. Create Staging Timestamp Update Trigger Function (SECURITY INVOKER) ─────
CREATE OR REPLACE FUNCTION staging.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

-- ── 3. Staging Orders Table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staging.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id TEXT UNIQUE NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'orvastore',
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    wilaya TEXT NOT NULL,
    commune TEXT DEFAULT 'الجزائر',
    delivery_type TEXT DEFAULT 'توصيل للمنزل',
    delivery_time TEXT DEFAULT '24 - 48 H',
    quantity INTEGER DEFAULT 1,
    product_name TEXT DEFAULT 'Pack 1 Pro',
    product_total TEXT DEFAULT '4950 د.ج',
    shipping_fee TEXT DEFAULT '500 د.ج',
    price_num NUMERIC DEFAULT 4950,
    grand_total TEXT DEFAULT '5450 د.ج',
    status TEXT DEFAULT 'pending',
    in_redex BOOLEAN DEFAULT false,
    redex_tracking_code TEXT,
    notes TEXT,
    remarks JSONB DEFAULT '[]'::jsonb,
    client_ip TEXT,
    client_ip_hash TEXT,
    device_id TEXT,
    risk_score INTEGER DEFAULT 0,
    risk_level TEXT DEFAULT 'LOW',
    risk_decision TEXT DEFAULT 'ALLOW',
    risk_reasons TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

DROP TRIGGER IF EXISTS tr_staging_orders_updated_at ON staging.orders;
CREATE TRIGGER tr_staging_orders_updated_at
    BEFORE UPDATE ON staging.orders
    FOR EACH ROW
    EXECUTE FUNCTION staging.update_updated_at_column();

-- ── 4. Staging Order Items Table (Multi-item support) ─────────────────────────
CREATE TABLE IF NOT EXISTS staging.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id TEXT NOT NULL REFERENCES staging.orders(order_id) ON DELETE CASCADE,
    product_name TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    unit_price NUMERIC DEFAULT 4950,
    total_price NUMERIC DEFAULT 4950,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ── 5. Staging Anti-Spam / Rate Limits Table ───────────────────────────────────
CREATE TABLE IF NOT EXISTS staging.rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip TEXT,
    device_id TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ── 6. Staging Customers Table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staging.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id TEXT UNIQUE NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    name TEXT,
    total_orders INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0,
    cancelled INTEGER DEFAULT 0,
    rejected INTEGER DEFAULT 0,
    no_response INTEGER DEFAULT 0,
    trust_score INTEGER DEFAULT 50,
    risk_level TEXT DEFAULT 'LOW',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

DROP TRIGGER IF EXISTS tr_staging_customers_updated_at ON staging.customers;
CREATE TRIGGER tr_staging_customers_updated_at
    BEFORE UPDATE ON staging.customers
    FOR EACH ROW
    EXECUTE FUNCTION staging.update_updated_at_column();

-- ── 7. Staging Watchlist Table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staging.watchlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier TEXT NOT NULL,
    identifier_type TEXT DEFAULT 'PHONE',
    reason TEXT,
    status TEXT DEFAULT 'watchlist',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    expires_at TIMESTAMPTZ
);

-- ── 8. Staging Risk Events Table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS staging.risk_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    store_id TEXT DEFAULT 'orvastore',
    order_id TEXT,
    actor_phone TEXT,
    device_id TEXT,
    ip_hash TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ── 9. Staging Audit Logs Table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staging.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    actor TEXT,
    payload JSONB DEFAULT '{}'::jsonb,
    request_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ── 10. Staging Inventory & Reservation Tables ────────────────────────────────
CREATE TABLE IF NOT EXISTS staging.inventory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    available INTEGER NOT NULL DEFAULT 20,
    reserved INTEGER NOT NULL DEFAULT 0,
    total_physical INTEGER NOT NULL DEFAULT 20,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS staging.inventory_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku TEXT NOT NULL,
    order_id TEXT,
    change_type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    previous_available INTEGER NOT NULL,
    new_available INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ── 11. Staging Idempotency Records Table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS staging.idempotency_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    order_id TEXT,
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ── 12. Staging Courier Shipments Registry ────────────────────────────────────
CREATE TABLE IF NOT EXISTS staging.shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tracking_code TEXT UNIQUE NOT NULL,
    order_id TEXT NOT NULL REFERENCES staging.orders(order_id) ON DELETE CASCADE,
    courier TEXT NOT NULL,
    status TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ── 13. Staging Telegram Dispatch Ledger ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS staging.telegram_dispatch_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL,
    message_id TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ── 14. Performance Indexes Scoped to Staging ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_staging_orders_order_id ON staging.orders(order_id);
CREATE INDEX IF NOT EXISTS idx_staging_orders_phone ON staging.orders(phone);
CREATE INDEX IF NOT EXISTS idx_staging_orders_status ON staging.orders(status);
CREATE INDEX IF NOT EXISTS idx_staging_orders_created_at ON staging.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staging_customers_phone ON staging.customers(phone);
CREATE INDEX IF NOT EXISTS idx_staging_watchlist_identifier ON staging.watchlist(identifier);
CREATE INDEX IF NOT EXISTS idx_staging_audit_entity ON staging.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_staging_inventory_sku ON staging.inventory_items(sku);
CREATE INDEX IF NOT EXISTS idx_staging_shipments_order ON staging.shipments(order_id);

-- ── 15. Staging Atomic Order Switch RPC Function (Hardened SECURITY DEFINER) ──
CREATE OR REPLACE FUNCTION staging.execute_order_switch(
    p_order_id TEXT,
    p_new_full_name TEXT,
    p_new_phone TEXT,
    p_new_wilaya TEXT,
    p_new_commune TEXT,
    p_new_delivery_type TEXT,
    p_reason TEXT,
    p_operator TEXT,
    p_operator_override BOOLEAN,
    p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_order RECORD;
    v_audit_id UUID;
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_existing_audit RECORD;
BEGIN
    IF p_operator_override IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_OVERRIDE_FLAG',
            'message', 'The operator_override flag must be explicitly TRUE or FALSE; NULL is not permitted.'
        );
    END IF;

    -- Check existing idempotency record strictly in staging.audit_logs
    IF p_idempotency_key IS NOT NULL AND p_idempotency_key != '' THEN
        SELECT id, payload, request_hash
        INTO v_existing_audit
        FROM staging.audit_logs
        WHERE idempotency_key = p_idempotency_key
        LIMIT 1;

        IF FOUND THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'idempotent', true,
                'audit_id', v_existing_audit.id
            );
        END IF;
    END IF;

    -- Lock and retrieve staging order
    SELECT * INTO v_order
    FROM staging.orders
    WHERE order_id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'ORDER_NOT_FOUND',
            'message', 'Order not found in staging schema.'
        );
    END IF;

    -- Execute order update in staging.orders only
    UPDATE staging.orders
    SET full_name = p_new_full_name,
        phone = p_new_phone,
        wilaya = p_new_wilaya,
        commune = p_new_commune,
        delivery_type = p_new_delivery_type,
        updated_at = v_now
    WHERE order_id = p_order_id;

    -- Write audit log in staging.audit_logs only
    INSERT INTO staging.audit_logs (
        idempotency_key, action, entity_type, entity_id, actor, payload, created_at
    ) VALUES (
        p_idempotency_key,
        'ORDER_SWITCH',
        'order',
        p_order_id,
        p_operator,
        pg_catalog.jsonb_build_object(
            'reason', p_reason,
            'override', p_operator_override
        ),
        v_now
    ) RETURNING id INTO v_audit_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'order_id', p_order_id,
        'audit_id', v_audit_id
    );
END;
$$;

-- Restrict execution: Revoke from PUBLIC, grant only to trusted identities
REVOKE ALL ON FUNCTION staging.execute_order_switch(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;

-- ── 16. Least-Privilege Role Isolation & Public Denial ───────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'staging_user') THEN
        CREATE ROLE staging_user NOLOGIN;
    END IF;
END
$$;

-- Authenticator Role Membership (Enables PostgREST to switch to staging_user via custom JWT)
-- Fail-Closed Assertion: PostgREST requires 'authenticator' role to exist; abort migration if absent
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
        RAISE EXCEPTION 'MIGRATION_HALTED_FATAL: PostgREST connection role "authenticator" does not exist. Cannot grant staging_user role membership.';
    END IF;
    GRANT staging_user TO authenticator;
END
$$;

-- Defense-in-Depth Search Path Setting for Direct SQL Sessions:
-- NOTE: In PostgREST, SET LOCAL ROLE does NOT evaluate ALTER ROLE SET configurations.
-- True schema routing under PostgREST is driven by Accept-Profile and Content-Profile headers,
-- combined with explicit schema qualification on all staging objects and functions.
ALTER ROLE staging_user SET search_path = staging, pg_temp;

-- Explicit Public Schema Denial for Staging Identity
REVOKE ALL ON SCHEMA public FROM staging_user;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM staging_user;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM staging_user;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM staging_user;

-- Explicit Staging Schema Denial for Anon Role (Hard Isolation Against Anon Key Abuse)
REVOKE ALL ON SCHEMA staging FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA staging FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA staging FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA staging FROM anon;

-- Explicit Staging Schema Denial for Authenticated Role (Zero Direct Browser Auth Dependency)
REVOKE ALL ON SCHEMA staging FROM authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA staging FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA staging FROM authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA staging FROM authenticated;

-- Staging Schema Grants for staging_user (Dedicated Staging Identity)
GRANT USAGE ON SCHEMA staging TO staging_user;
GRANT SELECT, INSERT ON staging.orders TO staging_user;
GRANT SELECT, INSERT ON staging.order_items TO staging_user;
GRANT SELECT, INSERT, UPDATE ON staging.customers TO staging_user;
GRANT SELECT, INSERT ON staging.rate_limits TO staging_user;
GRANT SELECT ON staging.watchlist TO staging_user;
GRANT SELECT, INSERT ON staging.risk_events TO staging_user;
GRANT SELECT, INSERT ON staging.audit_logs TO staging_user;
GRANT SELECT, UPDATE ON staging.inventory_items TO staging_user;
GRANT SELECT, INSERT ON staging.inventory_audit TO staging_user;
GRANT SELECT, INSERT ON staging.idempotency_records TO staging_user;
GRANT SELECT, INSERT, UPDATE ON staging.shipments TO staging_user;
GRANT SELECT, INSERT ON staging.telegram_dispatch_ledger TO staging_user;
GRANT EXECUTE ON FUNCTION staging.execute_order_switch(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO staging_user;

-- ── 17. Row Level Security Configuration (All 12 Staging Tables) ─────────────
ALTER TABLE staging.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.risk_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.inventory_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.telegram_dispatch_ledger ENABLE ROW LEVEL SECURITY;

-- Drop any legacy anon / authenticated policies on staging tables
DROP POLICY IF EXISTS "anon staging order insertion" ON staging.orders;
DROP POLICY IF EXISTS "anon staging order read" ON staging.orders;
DROP POLICY IF EXISTS "anon staging rate limits" ON staging.rate_limits;
DROP POLICY IF EXISTS "authenticated staging full management" ON staging.orders;
DROP POLICY IF EXISTS "authenticated staging order_items" ON staging.order_items;
DROP POLICY IF EXISTS "authenticated staging customers" ON staging.customers;
DROP POLICY IF EXISTS "authenticated staging shipments" ON staging.shipments;
DROP POLICY IF EXISTS "authenticated staging inventory" ON staging.inventory_items;
DROP POLICY IF EXISTS "authenticated staging audit_logs" ON staging.audit_logs;

-- staging_user Scoped Access Policies across all 12 Staging Tables
DROP POLICY IF EXISTS "staging_user full access orders" ON staging.orders;
CREATE POLICY "staging_user full access orders" ON staging.orders FOR ALL TO staging_user USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "staging_user full access order_items" ON staging.order_items;
CREATE POLICY "staging_user full access order_items" ON staging.order_items FOR ALL TO staging_user USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "staging_user full access customers" ON staging.customers;
CREATE POLICY "staging_user full access customers" ON staging.customers FOR ALL TO staging_user USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "staging_user full access rate_limits" ON staging.rate_limits;
CREATE POLICY "staging_user full access rate_limits" ON staging.rate_limits FOR ALL TO staging_user USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "staging_user full access watchlist" ON staging.watchlist;
CREATE POLICY "staging_user full access watchlist" ON staging.watchlist FOR ALL TO staging_user USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "staging_user full access risk_events" ON staging.risk_events;
CREATE POLICY "staging_user full access risk_events" ON staging.risk_events FOR ALL TO staging_user USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "staging_user full access audit" ON staging.audit_logs;
CREATE POLICY "staging_user full access audit" ON staging.audit_logs FOR ALL TO staging_user USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "staging_user full access inventory" ON staging.inventory_items;
CREATE POLICY "staging_user full access inventory" ON staging.inventory_items FOR ALL TO staging_user USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "staging_user full access inventory_audit" ON staging.inventory_audit;
CREATE POLICY "staging_user full access inventory_audit" ON staging.inventory_audit FOR ALL TO staging_user USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "staging_user full access idempotency_records" ON staging.idempotency_records;
CREATE POLICY "staging_user full access idempotency_records" ON staging.idempotency_records FOR ALL TO staging_user USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "staging_user full access shipments" ON staging.shipments;
CREATE POLICY "staging_user full access shipments" ON staging.shipments FOR ALL TO staging_user USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "staging_user full access telegram_ledger" ON staging.telegram_dispatch_ledger;
CREATE POLICY "staging_user full access telegram_ledger" ON staging.telegram_dispatch_ledger FOR ALL TO staging_user USING (true) WITH CHECK (true);

-- ── 18. Synthetic Reference & Seed Test Data (Zero Production Data) ───────────
INSERT INTO staging.inventory_items (sku, name, available, reserved, total_physical)
VALUES 
    ('ORVA-P1-PRO', 'Pack 1 Pro 4-in-1 (Staging Test)', 45, 0, 45),
    ('ORVA-P2-ELITE', 'Pack 2 Elite 6-in-1 (Staging Test)', 22, 0, 22),
    ('ORVA-P3-ULTRA', 'Pack 3 Ultra Heavy Duty (Staging Test)', 15, 0, 15)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO staging.customers (customer_id, phone, name, trust_score, risk_level)
VALUES 
    ('CUST-STAGING-001', '0555000000', 'Staging Verified Test Customer', 100, 'LOW')
ON CONFLICT (phone) DO NOTHING;

COMMIT;
