# ORVA STORE — Backend Stabilization Local Report (Final Consistency Pass)

**Date:** 2026-11-07  
**Gate:** Local implementation + localhost verification only. **No commit, push, Hostinger deploy, or hosted Supabase SQL.**

---

## Verdict

**Local PostgreSQL acceptance completed** against disposable database `orva_local` on `127.0.0.1:5432` (PostgreSQL **18.6**). PHP `pdo_pgsql` enabled. Integration suite: **14 PASS / 0 FAIL**. PHP↔Node inventory parity: **PASS**. Historical JSON **51 RESERVED** untouched. Local preview still up. Official EDB Windows installer CDN returned **HTTP 403** from this host (no admin); portable official Postgres binaries (zonky-packaged) were used for the disposable local cluster — see §6.

---

## 1. PHP / Node inventory parity

| Concern | Node | PHP |
|---------|------|-----|
| PG reserve / release / settle | `lib/inventory-pg.js` | `lib/inventory-pg.php` via `lib/inventory-store.php` |
| Schema | `public` \| `staging` allowlist | Same (`orva_pg_schema`) |
| Proposal tables | `inventory_items`, `inventory_reservations`, `inventory_audit` | Same SQL columns (`operation_id`, `UNIQUE(order_id,sku)`, `change_type`, …) |
| Configured DB fails | No silent JSON fallback → error / 503 | Same (`INVENTORY_UNAVAILABLE` → HTTP 503) |
| JSON path | Only `isLocalUnconfigured()` | Only `orva_pg_is_local_unconfigured()` |
| Hosted `DATABASE_URL` under `APP_ENV=local` | `getPgPool()` returns null | `orva_pg_pdo()` throws `ORVA_PG_HOSTED_BLOCKED`; treated as local-isolated fixtures |

**Added / updated:** `lib/orva-pg.php`, `lib/inventory-pg.php`, `lib/inventory-store.php` (PG prefer + JSON write refuse), `lib/db-authority.js`, `lib/supabaseServer.js`.

---

## 2. PHP rate limiting (fail-closed)

`lib/rate-limit-pg.php` mirrors Node `checkAndRecordRateLimit`:

- `BEGIN` → `pg_advisory_xact_lock(hashtext(...))` → 24h count on normalized phone **OR** device_id **OR** IP hash → insert → `COMMIT`
- Max **2** attempts
- DB failure / missing pool outside local isolation → **HTTP 503** (never silent allow)
- Wired in `api/send-order.php` before inventory reserve

Local isolation (`APP_ENV=local` + hosted URL refused or no DB) returns `{ allowed: true, localBypass: true }` — intentional fixture mode, not outage fallback.

---

## 3. Checkout transaction-boundary assessment

**Proven (same connection, one SQL transaction):**

| Operation | Boundary |
|-----------|----------|
| Inventory reserve | Single `BEGIN`…`COMMIT` (item lock + ledger upsert + audit) |
| Inventory release / settle | Single txn; status machine; duplicate ops no-op |
| Rate limit check+insert | Single txn + advisory lock |

**Not one PostgreSQL transaction across the full checkout (REST design):**

| Step | Store | Same txn as reserve? |
|------|-------|----------------------|
| Idempotency claim (`in_progress`) | PG | No — claim commits before work |
| Inventory reserve | PG | Own txn |
| Order insert | Supabase REST / PHP storage | **No** — separate network call |
| Idempotency complete | PG | After work |
| Telegram / Meta CAPI | External | Independent by design |

**Compensation already in both runtimes:** if order persistence fails after a **newly created** reservation, stock is released (`DB_PERSISTENCE_FAILED` / `STORAGE_*_ROLLBACK`). Duplicate order IDs do not create a second reserve.

**Limitation (documented, not claimed as atomic):** a crash between successful reserve commit and order insert can leave a temporary RESERVED row until release compensation runs (or manual reconcile). Full atomicity would require moving order insert onto the same Postgres connection inside the reserve transaction (or a DB function / RPC). **Not implemented in this pass** — would change the REST order path.

**Telegram** remains independent of order persistence success path after storage (notification failure must not roll back a committed order).

---

## 4. Reservation count: 49 vs 51 (sanitized)

Read-only report: `data/local-fixtures/reservation-count-49-vs-51-reconciliation.json`

| Snapshot | Count | Scope |
|----------|------:|-------|
| `data/reservation-reconciliation-report.json` (2026-11-06) | **49** | Pack1 (`ORVA-P1-PRO`) only |
| Current `data/inventory-state.json` | **51** | All SKUs RESERVED |
| Dry-run `historicalReservedOrders` | **51** | Matches current ledger |

**Why the count differs (nothing deleted):**

1. All **49** prior Pack1 IDs remain `RESERVED`.
2. **+1 Pack1:** `LOCAL-PREV-5203300d` (2026-11-07T00:24:21Z) after the old report.
3. **+1 Pack2:** `PACK2-40288` / `ORVA-P2-ELITE` (2026-11-06T23:28:25Z) — outside the Pack1-only prior report.
4. Arithmetic: `49 + 1 + 1 = 51`.

**Related mismatch (preserved, not “fixed”):** `ORVA-DRILL-PRO` item `reserved=3` vs **0** RESERVED ledger rows (`LEDGER_VS_ITEM_RESERVED` in dry-run). Seed policy preserves item counters; no historical release.

**Inventory state SHA-256:** `e4c5be3d94dbe458353396a4a7517d4894675b34d0f9e5bad4bc15f6f906c1b7`

No import / release / settle / delete of historical reservations was performed.

---

## 5. SQL proposal audit

**File:** `supabase/proposals/2026-11-07-public-inventory-idempotency.sql`  
**SHA-256:** `4550f155a2133728695755b5132385514743567d7cae44b392163bcb54ca6720`

**Latest local delta:** `inventory_reservations.lifecycle` (`CHECKOUT_PENDING` \| `ORDER_BOUND` \| `NULL` historical) + `ADD COLUMN IF NOT EXISTS` for earlier drafts.

| Topic | Status |
|-------|--------|
| Objects | items, reservations (+ lifecycle), audit, idempotency, rate_limits |
| RLS | ENABLED; revoke `PUBLIC`/`anon`/`authenticated`; `service_role` GRANT ALL |
| Seed / historical | `lifecycle NULL` → never auto-released by recovery |
| Executed on hosted? | **No** |

---

## 6. Local PostgreSQL installation result

### Environment inspected

| Item | Value |
|------|-------|
| OS | Windows 10.0.19044 AMD64 |
| Admin privileges | **False** (no elevation) |
| Disk free (C:) | ~68 GB |
| PHP CLI | 8.3.36 ZTS VC2019 x64 (WinGet user install) |
| php.ini | `...\PHP.PHP.8.3_...\php.ini` (backed up to `php.ini.bak-orva-20261107-042610`) |
| Docker | Missing |
| Official EDB installer via winget | **FAIL** — download `get.enterprisedb.com` → **HTTP 403 Forbidden** |

### What was installed for acceptance

| Component | Result |
|-----------|--------|
| PostgreSQL engine | **PASS** — PostgreSQL **18.6** portable binaries under `tools/pgsql-portable/` (zonky-packaged official Windows amd64 build; EDB GUI installer unavailable due to 403) |
| Listen address | **`127.0.0.1` only** (confirmed) |
| Database | **`orva_local`** |
| Credentials | `data/private/orva-local-pg.env` (gitignored; disposable local secrets — not Production / not Supabase) |
| Control script | `scripts/orva-local-pg-ctl.ps1 start\|stop\|status` |

### PHP PDO PostgreSQL

| Check | Result |
|-------|--------|
| `php_pdo_pgsql.dll` present | Yes |
| `extension=pdo_pgsql` enabled | **PASS** (native `pgsql` left commented) |
| `php -m` shows `pdo_pgsql` | **PASS** |
| `PDO::getAvailableDrivers()` | **`pgsql`** |

Hosted Supabase SQL was **not** executed.

### Optional: official EDB install (when user can approve)

1. Run elevated PowerShell.
2. `winget install --id PostgreSQL.PostgreSQL.17 -e`
3. If CDN still 403: download installer manually in a browser from https://www.enterprisedb.com/downloads/postgres-postgresql-downloads then run it.
4. Bind to localhost; create `orva_local`; point `data/private/orva-local-pg.env` at the new instance.

---

## 7. Local database role setup

Applied on `orva_local` only:

| Role | Login | Notes |
|------|-------|-------|
| `orva_admin` | yes | Cluster bootstrap owner (superuser of **local** cluster only) |
| `orva_app_local` | yes | Production-shaped app tests: **NOSUPERUSER**, **BYPASSRLS** (like `service_role`) |
| `staging_login` | yes | Restricted staging login |
| `staging_user` | **NOLOGIN** | Assumed via `SET ROLE` from `staging_login` |
| `service_role` / `anon` / `authenticated` | NOLOGIN | Placeholders so proposal `GRANT`/`REVOKE` apply |

Schemas: `public` (proposal tables + minimal `orders`) and `staging` (mirrored tables). Bootstrap: `supabase/proposals/2026-11-07-orva-local-bootstrap.sql` via `scripts/setup-orva-local-pg.js`.

Application integration tests used **`orva_app_local`**, not superuser.

---

## 8. PostgreSQL integration tests (`orva_local`)

Runner: `node scripts/test-pg-integration-orva-local.js`  
Results artifact: `data/local-fixtures/pg-integration-orva-local-results.json`

| # | Case | Result |
|---|------|--------|
| 1 | Concurrent final-unit reservation | **PASS** |
| 2 | Duplicate reservation prevention | **PASS** |
| 3 | Duplicate order submission race | **PASS** |
| 4 | Concurrent rate-limit same phone | **PASS** |
| 5 | Concurrent rate-limit same device | **PASS** |
| 6 | Concurrent rate-limit same IP hash | **PASS** |
| 7 | Cancellation releases exactly once | **PASS** |
| 8 | Courier settlement exactly once | **PASS** |
| 9 | Duplicate idempotency stored response | **PASS** |
| 10 | Order persist failure → reservation release | **PASS** |
| 11 | Abandoned `CHECKOUT_PENDING` recovery | **PASS** |
| 12a | Node inventory fixture | **PASS** |
| — | Historical JSON 51 untouched | **PASS** |
| — | staging_login → SET ROLE staging_user; app not superuser | **PASS** |

**Summary: 14 PASS / 0 FAIL.**

Fixes proven by these tests (local only):

- Inventory reserve: `pg_advisory_xact_lock` on `order_id` (gap-lock race).
- Rate limit: per-dimension advisory locks (phone / device / IP), not one composite key.
- Local pool SSL auto-disabled for loopback hosts.

### PHP / Node parity

| Check | Result |
|-------|--------|
| `php scripts/test-php-pg-parity.php` | **PASS** — reserve 2 units → available 8 / reserved 2; bind; duplicate `alreadyReserved` |
| Artifact | `data/local-fixtures/php-pg-parity-results.json` |

---

## 9. Checkout crash recovery + Hostinger scheduling proposal

Mechanism unchanged: `CHECKOUT_PENDING` → bind `ORDER_BOUND` after persist; recovery only pending + aged + order missing.

**PG recovery test:** **PASS** (released synthetic abandoned row; historical-style `lifecycle NULL` preserved).

**JSON historical dry-run:** 51 skipped as historical; released 0.

**Hostinger cron:** **NOT CONFIGURED**. Proposal only: `docs/HOSTINGER_INVENTORY_RECOVERY_CRON_PROPOSAL.md`  
Suggested: every 15 minutes, `node scripts/recover-abandoned-reservations.js --apply`, under `flock`, with order reconcile (no `--assume-no-order`).

**Full checkout atomicity:** still **not** claimed (REST order insert remains a separate step with compensation).

---

## 10. Dashboard route verification

Canonical orders UI: **http://localhost:3000/admin/dashboard/ecommerce/#orders** (sidebar). `/admin/dashboard/orders/` → 302 to ecommerce `#orders`.

---

## 11. Localhost preview (kept running)

| Surface | Status |
|---------|--------|
| http://localhost:3000/ | 200 |
| http://localhost:3000/admin/ | 200 |
| http://localhost:3000/admin/dashboard/ecommerce/#orders | 200 |
| http://localhost:3000/classic-admin.html | 200 |
| http://127.0.0.1:8000/ | 200 |
| PG `127.0.0.1:5432` | Listening |
| Historical RESERVED count in `inventory-state.json` | **51** |

---

## Remaining blockers

1. Official EDB Windows installer still blocked by CDN **403** without manual/browser download + admin — portable PG is sufficient for local acceptance; optional for long-term service install.
2. Checkout reserve + REST order insert still **compensating**, not one DB transaction.
3. Historical 51 RESERVED + Drill item/ledger mismatch still need manual order matching before any release/settle.
4. Hostinger recovery cron **not** installed (proposal only).
5. Anon `orders` INSERT containment still a later Staging/Production pass.
6. No commit / push / Hostinger deploy / hosted SQL in this task.

---

## Approval gate

Stop here. Local PG acceptance tests passed. Inspect localhost + `orva_local` results before Staging deployment or any hosted SQL.
