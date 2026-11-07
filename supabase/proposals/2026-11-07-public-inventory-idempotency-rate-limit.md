# Migration proposal — public inventory, reservations ledger, idempotency (NOT EXECUTED)

**Date:** 2026-11-07  
**Status:** Proposal only. Do **not** run against hosted Supabase without separate approval.

## SQL (public schema)

See companion file: `2026-11-07-public-inventory-idempotency.sql`

## Checklist before hosted apply

1. Production Node/PHP use `SUPABASE_SERVICE_ROLE_KEY` (or Hostinger secure config).
2. Staging still uses `staging_login` / `staging_user` — never service_role.
3. Dry-run seed from `data/inventory-state.json` reconciled locally.
4. Backup Production DB.
5. Apply in a maintenance window; verify RLS grants.

## Rollback

```sql
DROP TABLE IF EXISTS public.inventory_audit CASCADE;
DROP TABLE IF EXISTS public.inventory_reservations CASCADE;
DROP TABLE IF EXISTS public.idempotency_records CASCADE;
DROP TABLE IF EXISTS public.inventory_items CASCADE;
-- rate_limits already exists; keep data. Drop only new indexes if added.
```

## Anon SELECT containment

Still gated on `2026-11-06-production-anon-order-read-containment.sql` — not part of this apply.
