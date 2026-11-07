# ORVA STORE — Critical Stabilization Report

Date: 6 November 2026  
Scope: Ponytail audit findings (checkout, inventory, Supabase security, admin auth, Telegram)  
Mode: Local source fixes + local tests. No Production DDL, no Production inventory mutation, no bulk orders.

---

## Confirmed findings

| # | Finding | Confirmed locally? |
|---|---------|--------------------|
| 1 | Duplicate order id can release another order's stock | Yes (`api/send-order.php` rolled back any RESERVED id on DB failure) |
| 2 | Reserved stock never released/settled on cancel/ship | Yes (`api/delivery.php` had no inventory calls; 49 Pack1 RESERVED rows remain) |
| 3 | Anon RLS can read/insert orders | Confirmed in repo schema (`supabase/schema.sql`). **Hosted DB not queried** (no server credentials in this environment) |
| 4 | Yamaha checkout missing product id / price mismatch | Yes (`script.js` sent no sku; page 4200 vs catalog 4400 archived / 4900 active) |
| 5 | Wilaya text search + no commune check | Yes |
| 6 | Admin password accepted as Bearer/cookie | Yes |
| 7 | Test SKUs sellable | Yes |
| 8 | PHP/Node checkout drift | Yes |
| 9 | Substring product alias match | Yes |
| 10 | Missing inventory invents 20 units; missing catalog fallback | Yes |
| 11 | No login lockout | Yes |
| 12 | Analytics sessions unbounded + client purchase counting | Already partially addressed in tree; session cap verified present |
| 13 | Default Telegram HTML unescaped | Yes |
| 14 | JSON growth / stale idempotency | Partially addressed (24h idempotency prune on write); live Pack1 ledger preserved |
| 15 | Codflow rate-limit fail-open | Yes |
| 16 | Unused `resend` dependency | Yes |

---

## Fixed findings (local source)

### Priority 1 — Order id + inventory

**Finding 1 — Fixed in code**
- Root cause: on Supabase insert failure, PHP released reservation for the order id even when this request did not create it.
- Fix: `lib/inventory-store.php` + `api/send-order.php` track `createdReservation`; rollback only if this request created it; explicit duplicate order id returns 409 before reserve; server generates collision-resistant ids when client omits id; Node path mirrors the created-flag rule.

**Finding 2 — Fixed in code (transitions); historical 49 rows NOT auto-released**
- Root cause: delivery status/courier/delete never called inventory.
- Fix: cancel/delete → `orva_inventory_release`; courier handoff / shipped → `orva_inventory_settle` (reserved↓ and totalPhysical↓ once, idempotent).
- Backup created: `backups/inventory-state.20261106-225108.json` and catalog twin.
- Read-only reconciliation: `data/reservation-reconciliation-report.json` shows **49 RESERVED** rows, all `ORVA-P1-PRO`, oldest from 2026-11-04. Supabase order matching was **not** executed (no local `SUPABASE_*` credentials). **No reservation was released.**

### Priority 2 — Supabase security

**Finding 3 — Prepared, not executed**
- Repo schema grants anon SELECT + INSERT on `public.orders` and rate_limits.
- Proposed SQL (approval required): `supabase/proposals/2026-11-06-revoke-anon-orders-access.sql`
- PHP prepared to use `SUPABASE_SERVICE_ROLE_KEY` from env/secure config when present (`api/config.php`). Empty by default. Never hardcoded.
- **Do not run the SQL until Staging/Production approval.** After SQL, Hostinger must have service role configured or checkout inserts will fail closed.

### Priority 3 — Checkout validation

**Finding 4 — Partially fixed; commercial decision required**
- Client now sends `packId`/`sku` = `yamaha` and `wilayaId`.
- Catalog still has `ORVA-SAC-YAM` archived at 4400; page shows 4200; bundle is 4900 active.
- Server correctly rejects Yamaha as `PRODUCT_INACTIVE`.
- **Decision needed (do not guess):**
  1. Activate/update `ORVA-SAC-YAM` to the approved selling price and update the page, or
  2. Point the page at `ORVA-SAC-BUNDLE` and align page price to 4900, or
  3. Add a new approved catalog SKU at 4200.

**Finding 5 — Fixed**
- Wilaya resolved by id only; commune exact match against `data/algeria-communes.json`; server tariffs only.
- Clients (`packs-client.js`, `script.js`) send `wilayaId`.

**Finding 7 — Fixed**
- `ORVA-LAST-ITEM-TEST`, `ORVA-RACE-TEST-SKU`, `ORVA-DRILL-DYNAMO` set to `archived` + `allowOrders: false`. Rows kept for history.

### Priority 4 — Admin auth

**Findings 6 + 11 — Fixed**
- Random session ids in `data/private/admin-sessions.json`.
- Password accepted only on login action.
- Bearer accepts `ADMIN_API_TOKEN` only (never password).
- Cookie accepts random session (legacy cookie=API token still accepted for rollout compatibility).
- 5 failures → 15 minute lockout (`lib/admin-session.php`, `api/auth.php`, Node `api/auth.js` / `api/admin-settings.js`).

### Priority 5 — Telegram

**Finding 13 — Fixed**
- Default Telegram builder escapes order id, name, phone, commune, location, product, totals via `orva_tg_escape`.
- Custom template path unchanged (already escaped). Telegram failure cannot invalidate a persisted order.

### Priority 6 — Consistency / stability

**Finding 8 — Improved**
- Shared validation contract: exact product resolve, wilayaId, exact commune, fail-closed inventory, created-reservation rollback in PHP and Node.

**Finding 9 — Fixed**
- Substring alias matching removed in PHP and `lib/catalog-manager.js`.

**Finding 10 — Fixed**
- Missing inventory SKU → error (no invented 20).
- Missing catalog → HTTP 503.
- Hardcoded PHP catalog fallback removed.

**Finding 12 — Verified present**
- Public analytics ignores client purchase conversions; sessions pruned to 24h / capped.

**Finding 14 — Partial**
- Idempotency records pruned to 24h on write.
- Live Pack1 reserved ledger preserved pending order-by-order reconcile with Supabase.
- Test SKU cleanup of historical race rows deferred until Supabase match is available.

### Priority 7 — Optional

**Finding 15 — Fixed**
- Codflow rate limiter fails closed when storage cannot initialize.

**Finding 16 — Fixed**
- Unused `resend` dependency removed.

---

## Files modified

- `api/send-order.php`
- `api/send-order.js`
- `api/delivery.php`
- `api/auth.php`
- `api/auth.js`
- `api/admin-settings.php` (authorize helper)
- `api/admin-settings.js`
- `api/publish-page.php`
- `api/config.php`
- `api/codflow.php`
- `lib/inventory-store.php` **(new)**
- `lib/admin-session.php` **(new)**
- `lib/inventory-manager.js`
- `lib/catalog-manager.js`
- `lib/order-validator.js`
- `data/products-catalog.json`
- `data/algeria-communes.json` **(new, generated)**
- `packs-client.js`
- `script.js`
- `package.json` / `package-lock.json`
- `.env.example`
- `supabase/proposals/2026-11-06-revoke-anon-orders-access.sql` **(new, not executed)**
- `scripts/test-critical-stabilization.js` **(new)**
- `scripts/php-inventory-smoke.php` **(new)**
- `scripts/reconcile-reservations-report.js` **(new)**
- Backups under `backups/`

---

## Staging test results

### Executed locally (not Staging host)

Command: `node scripts/test-critical-stabilization.js`  
Result: **11 passed, 0 failed**

| Test | Result |
|------|--------|
| 1 Duplicate order id does not release foreign stock | PASS |
| 2 Cancellation releases stock exactly once | PASS |
| 3 Courier handoff deducts reserved and physical once | PASS |
| 5 Invalid wilaya/commune rejected | PASS |
| 6 Yamaha identifier present; archived until price decision | PASS |
| 7 Archived test products cannot be purchased | PASS |
| 8 Missing inventory fails closed | PASS |
| 9 Missing catalog returns 503 (source contract) | PASS |
| 11 Password cannot be Bearer | PASS |
| 12 Login lockout after 5 failures | PASS |
| 13 Telegram HTML escape | PASS |

Also executed: `php scripts/php-inventory-smoke.php` → `PHP_INVENTORY_SMOKE_OK`  
Also executed: reservation reconcile (read-only) → 49 Pack1 reserved rows documented.

### Not executed (blocked)

| Item | Reason |
|------|--------|
| Staging Hostinger deploy of PHP files | No deploy credentials/action in this session |
| Staging synthetic end-to-end HTTP orders on staging.orva-store.com | Requires Staging deploy first |
| Hosted Supabase RLS live inspection | No `SUPABASE_SERVICE_ROLE_KEY` / secure config available locally |
| Auto-release of the 49 Pack1 reservations | Explicitly forbidden until each id is matched to a real order status |

---

## Hosted inspection results

**Not executed.**  
This environment has no `.env` and no readable `secret-keys.php`.  
Therefore Production/Staging Supabase ACLs were **not** queried.

What is known from repository schema only:
- `Allow anon order insertion` and `Allow anon order read` exist in `supabase/schema.sql`.
- Until hosted verification, treat Finding 3 as **probable in Production if that schema was applied**, not as hosted-confirmed.

---

## Remaining unresolved blockers

1. **Yamaha commercial price/product decision** (Finding 4) — checkout still correctly refuses until catalog/page are aligned by merchant approval.
2. **Hosted Supabase RLS verification + SQL approval** (Finding 3) — proposed file ready; needs read-only hosted confirm, then explicit approval to execute.
3. **Configure `SUPABASE_SERVICE_ROLE_KEY` on Hostinger (server-only)** before/with RLS revoke, or order inserts break.
4. **49 Pack1 RESERVED units** — reconcile each `order_id` against Supabase status, then release/settle individually. Backup already taken. Do not mass-release.
5. **Staging deploy + focused Staging HTTP verification** still required before Production.
6. Remove hardcoded publishable key default from `api/config.php` after Hostinger env is confirmed (not done here to avoid breaking unconfigured hosts without approval).

---

## SQL changes requiring approval

File: `supabase/proposals/2026-11-06-revoke-anon-orders-access.sql`

Impact summary:
- Drops anon/authenticated SELECT + INSERT policies on `public.orders` and `public.rate_limits`.
- Keeps `service_role` full access.
- After apply: browsers cannot read phones/orders via PostgREST; checkout must insert through PHP using server credential.
- Staging schema isolation is untouched by this file.

**Awaiting explicit approval before any DDL/GRANT/REVOKE on hosted databases.**

---

## Production deployment recommendation

### NO-GO for Production release right now

Required before GO:
1. Deploy stabilized PHP/JS to **Staging** and pass the focused HTTP checklist (duplicate id, cancel release, ship settle, wilaya/commune reject, auth lockout, Telegram escape).
2. Merchant decision + catalog/page fix for Yamaha.
3. Read-only hosted RLS inspection; if unsafe policies exist, approve and apply the SQL on Staging first, with `SUPABASE_SERVICE_ROLE_KEY` configured server-side.
4. Reconcile the 49 Pack1 reservations against real orders; release/settle only confirmed orphans/cancellations/shipments.
5. Only then promote the same artifact set to Production with change approval.

Local code stabilization for findings 1,2,5,6,7,8,9,10,11,13,15,16 is complete. Findings 3 and 4 remain release blockers until the approvals above.
