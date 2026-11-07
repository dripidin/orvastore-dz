-- ==============================================================================
-- ORVA STORE — PUBLIC inventory / reservations / idempotency (PROPOSAL ONLY)
-- Date: 2026-11-07
-- DO NOT EXECUTE on hosted Supabase without explicit authorization.
--
-- Schema is aligned with lib/inventory-pg.js and lib/inventory-pg.php.
-- Rollback: DROP the four CREATE TABLE objects (and indexes) in reverse order
-- inside a transaction. Existing public.rate_limits is left intact.
-- ==============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku TEXT UNIQUE NOT NULL,
    name TEXT,
    available INTEGER NOT NULL DEFAULT 0 CHECK (available >= 0),
    reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    total_physical INTEGER NOT NULL DEFAULT 0 CHECK (total_physical >= 0),
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT inventory_items_invariant CHECK (total_physical = available + reserved)
);

-- Reservation ownership: UNIQUE (order_id, sku). operation_id is a stable
-- RSV-{orderId}-{sku} key used by Node/PHP inserts. Concurrent reserve of the
-- same final unit is serialized by UPDATE ... WHERE available >= qty RETURNING.
-- lifecycle: CHECKOUT_PENDING = reserved awaiting order persist (crash-recovery eligible).
--            ORDER_BOUND = order row exists (never auto-release).
--            NULL = historical / pre-lifecycle ledger (never auto-release; preserves seed rows).
CREATE TABLE IF NOT EXISTS public.inventory_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id TEXT UNIQUE NOT NULL,
    order_id TEXT NOT NULL,
    sku TEXT NOT NULL REFERENCES public.inventory_items(sku),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    status TEXT NOT NULL CHECK (status IN ('RESERVED', 'RELEASED', 'SETTLED')),
    lifecycle TEXT CHECK (lifecycle IS NULL OR lifecycle IN ('CHECKOUT_PENDING', 'ORDER_BOUND')),
    release_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (order_id, sku)
);

-- Idempotent additive migration for environments that already applied an earlier draft.
ALTER TABLE public.inventory_reservations
    ADD COLUMN IF NOT EXISTS lifecycle TEXT
    CHECK (lifecycle IS NULL OR lifecycle IN ('CHECKOUT_PENDING', 'ORDER_BOUND'));

CREATE TABLE IF NOT EXISTS public.inventory_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku TEXT NOT NULL,
    order_id TEXT,
    change_type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    previous_available INTEGER NOT NULL,
    new_available INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Idempotency concurrency: UNIQUE(key) + SELECT FOR UPDATE claim of in_progress.
CREATE TABLE IF NOT EXISTS public.idempotency_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    order_id TEXT,
    status TEXT NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'completed', 'failed')),
    response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- rate_limits already in schema.sql; create if a greenfield DB lacks it.
CREATE TABLE IF NOT EXISTS public.rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip TEXT,
    device_id TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_phone_created
    ON public.rate_limits (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limits_device_created
    ON public.rate_limits (device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_created
    ON public.rate_limits (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_order
    ON public.inventory_reservations (order_id);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_status
    ON public.inventory_reservations (status);
CREATE INDEX IF NOT EXISTS idx_idempotency_updated
    ON public.idempotency_records (updated_at);

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.inventory_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.inventory_reservations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.inventory_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.idempotency_records FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.rate_limits FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.inventory_items TO service_role;
GRANT ALL ON TABLE public.inventory_reservations TO service_role;
GRANT ALL ON TABLE public.inventory_audit TO service_role;
GRANT ALL ON TABLE public.idempotency_records TO service_role;
GRANT ALL ON TABLE public.rate_limits TO service_role;

COMMIT;
