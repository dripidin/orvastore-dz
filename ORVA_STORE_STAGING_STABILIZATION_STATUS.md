# ORVA STORE — STAGING STABILIZATION STATUS

Date: 6 November 2026  
Continues from: Critical Stabilization Report (same day)  
Target: `https://staging.orva-store.com` only  
Production: untouched

---

## 1. Deployment status

| Item | Status |
|------|--------|
| Hostinger MCP (`hosting_deploy` / file tools) | **BLOCKED** — not available in this Cursor session |
| Staging HTTPS reachability from this environment | **FAIL** — TLS handshake error (`curl` exit 35 / Node `EPROTO`) |
| Staging package prepared locally | **PASS** |
| Files uploaded to Staging | **NOT TESTED** (no deploy channel) |
| Production files changed | **PASS** (none) |

**Verdict: deployment did not succeed and is not claimed.**

### Package ready for manual Staging upload

- Zip: `orva-store-staging-stabilization.zip` (≈0.076 MB)
- Manifest: `STAGING_DEPLOYMENT_MANIFEST.md`
- Build script: `scripts/package-staging-stabilization.ps1`
- Staging root (from prior Hostinger audit):  
  `/home/u520776094/domains/orva-store.com/public_html/staging`

### Files in package (to deploy)

| Path | Notes |
|------|--------|
| `api/send-order.php` | Order-id + inventory + validation + Telegram escape |
| `api/delivery.php` | Cancel release / ship settle |
| `api/auth.php` | Random sessions + lockout |
| `api/admin-settings.php` | Password no longer Bearer |
| `api/config.php` | Staging token preferred; service_role not used on staging |
| `api/codflow.php` | Rate-limit fail-closed |
| `api/publish-page.php` | Session authorize helper |
| `api/analytics.php` | Session cap / no client purchase count |
| `lib/inventory-store.php` | **New** |
| `lib/admin-session.php` | **New** |
| `packs-client.js` | Sends `wilayaId` |
| `script.js` | Yamaha id present; still inactive commercially |
| `data/products-catalog.json` | Test SKUs archived |
| `data/algeria-communes.json` | **New** server commune list |
| `data/wilayas-tariffs.json` | Tariffs |

### Explicitly excluded from package

- `.env`, `secure-config.php`, `secret-keys.php`, `data/private/**`
- `data/inventory-state.json` (preserves Staging ledger; local file still has 49 Pack1 reservations)
- Idempotency / Telegram ledgers
- Full `admin/` dashboard rebuild

### Backup reference (required before upload)

Create on Staging:

`public_html/staging/_backup_stabilization_YYYYMMDD/`

Copy every file that will be replaced into that folder first. Also copy Staging `data/inventory-state.json` even though it is not replaced by this package.

Local inventory backup from earlier work (still valid, do not overwrite Staging with it):

- `backups/inventory-state.20261106-225108.json`

### Exact deployment instructions (Hostinger MCP unavailable)

1. Open Hostinger hPanel → Files → `domains/orva-store.com/public_html/staging`.
2. Create `_backup_stabilization_YYYYMMDD` and copy current versions of all packaged paths into it.
3. Upload `orva-store-staging-stabilization.zip` into `staging` and extract/merge (overwrite listed paths only).
4. Confirm `lib/inventory-store.php` and `lib/admin-session.php` exist under Staging.
5. Confirm Staging secure config **outside web root** still has:
   - `APP_ENV=staging`
   - `SUPABASE_SCHEMA=staging`
   - `SUPABASE_STAGING_TOKEN=<staging_user JWT>`
   - **Do not set** `SUPABASE_SERVICE_ROLE_KEY` on Staging
6. Re-run the focused Staging tests in §7.

---

## 2. Supabase security status

| Item | Status |
|------|--------|
| Execute public RLS SQL on Production | **NOT DONE** (forbidden without approval) |
| Execute public SQL as a “Staging test” | **BLOCKED** (wrong schema; would hit Production) |
| Staging-specific SQL prepared | **PASS** (not executed) |
| Hosted read-only policy inspection | **BLOCKED** (no authorized DB credentials in session; Staging TLS also unreachable here) |

### Proposals (approval required before any DDL)

1. Staging-only: `supabase/proposals/2026-11-06-staging-rls-hardening.sql`  
   - Touches **only** `staging.*`  
   - Re-asserts: no anon/authenticated policies; keep `staging_user` policies  
   - Does not touch `public.*`

2. Production (later, separate approval): `supabase/proposals/2026-11-06-revoke-anon-orders-access.sql`  
   - Must **not** be used as a Staging experiment

### Existing Staging architecture (from migration)

`supabase/migrations/20261103_staging_schema_isolation.sql` already:
- Enables RLS on staging tables
- Drops anon/authenticated staging policies
- Grants scoped access to `staging_user`

So Staging policy work is primarily **verification + defense-in-depth**, not a copy of the public revoke script.

---

## 3. `SUPABASE_SERVICE_ROLE_KEY` architecture assessment

| Question | Answer |
|----------|--------|
| Does service_role bypass RLS? | **Yes.** In Supabase/Postgres, `service_role` bypasses RLS. |
| Should Staging use it? | **No.** Staging must keep `staging_user` + `SUPABASE_STAGING_TOKEN` + `Content-Profile: staging`. |
| Would browser JS receive it? | **No path in code** — only `api/config.php` server load from env / outside-webroot secure config. Never in frontend bundles in this package. |
| Git / ZIP risk? | Package excludes secrets. Do not add the key to Git or the zip. |
| Can Staging accidentally write `public`? | Mitigated in `api/config.php`: when `SUPABASE_SCHEMA=staging`, code **requires** staging token and **refuses** to substitute service_role. Staging env must keep `APP_ENV=staging` fail-closed against `public`. |

### PHP endpoints that call Supabase REST

Via `orva_supabase_rest_request()` in `api/config.php`:

- `api/send-order.php` — insert order
- `api/delivery.php` — list / patch / delete / push metadata
- Any other PHP that uses the helper

### Recommendation (awaiting approval)

- **Staging:** continue with `staging_user` JWT only. Do **not** provision service_role there.
- **Production:** if anon order policies are confirmed live, revoke them only after PHP Production is configured with an approved server credential model (service_role **or** a narrower server role). Prefer least privilege; do not silently replace `staging_user` with service_role.

**Provisioning of service_role: NOT DONE / awaiting approval.**

---

## 4. Authentication status

| Check | Status |
|-------|--------|
| Password only on login | **PASS** (local code) |
| Password rejected as Bearer | **PASS** (local tests previously) |
| Random session ids | **PASS** (local code) |
| 5-failure / 15-minute lockout | **PASS** (local tests previously) |
| Staging login / logout live | **NOT TESTED** (deploy + TLS blocked) |
| Remove legacy cookie=`ADMIN_API_TOKEN` | **BLOCKED** until Staging login verified |

Legacy cookie compatibility remains intentionally for Staging rollout safety. Remove only after a successful Staging login with the new random session cookie.

---

## 5. Reservation reconciliation (49 Pack 1 units)

Source: `data/reservation-reconciliation-report.json`  
Action table: `data/reservation-reconciliation-actions.json`  
Mode: **READ ONLY** — no RELEASE / SETTLE / DELETE executed.

| Metric | Value |
|--------|-------|
| Reserved rows | 49 |
| SKU | `ORVA-P1-PRO` only |
| Supabase match | **NOT TESTED** (no hosted credentials; no Staging TLS) |

Sanitized recommendation for every listed order id:

| Order ID pattern | Qty | Supabase found | Status | Recommended action |
|------------------|----:|----------------|--------|--------------------|
| All 49 ids in report (e.g. `ORVA-21215` … `ORVA-96271`) | 1 | NOT TESTED | NOT TESTED | **INVESTIGATE** |

Next approved step (not executed):
1. Read-only query `public.orders` / `staging.orders` for those `order_id`s (no PII in exports).
2. Map:
   - found + `pending`/`confirmed` → **KEEP**
   - found + `cancelled`/`deleted` → **RELEASE** (after approval)
   - found + `shipped`/`delivered` → **SETTLE** (after approval)
   - not found → **INVESTIGATE** then likely RELEASE only with approval
3. Apply stock actions only after explicit merchant approval.
4. Keep existing backup.

---

## 6. Yamaha merchant decision

| Item | Status |
|------|--------|
| Pack 1 / Pack 2 identifiers | Intact (`pack1` / `pack2`) |
| Yamaha sends product id | Local code sends `yamaha` |
| Yamaha commercially orderable | **BLOCKED** — archived / price undecided |
| Price change / activate archived | **Not done** (requires merchant choice) |

Required merchant choice (unchanged):
1. Approve activating/updating `ORVA-SAC-YAM` to the intended price, or  
2. Point page to `ORVA-SAC-BUNDLE` at 4900, or  
3. Add a new approved 4200 SKU.

---

## 7. Focused Staging tests

| # | Test | Result |
|---|------|--------|
| 1 | One successful order | **NOT TESTED** |
| 2 | Duplicate order attempt | **NOT TESTED** |
| 3 | Cancellation + stock release | **NOT TESTED** |
| 4 | Shipping handoff settlement | **NOT TESTED** |
| 5 | Invalid wilaya/commune | **NOT TESTED** |
| 6 | Archived product rejection | **NOT TESTED** |
| 7 | Admin login / session / lockout | **NOT TESTED** |
| 8 | Telegram HTML escaping | **NOT TESTED** on Staging (local source **PASS** earlier) |

Reasons: Hostinger MCP absent; Staging TLS from this environment fails; no upload performed.

Local pre-deploy suite from the Critical Stabilization Report remains the last executed automated evidence (**11/11 PASS**).

---

## 8. Remaining blockers

1. **Deploy channel** — restore Hostinger MCP or perform manual upload per manifest.  
2. **Staging TLS / reachability** from this agent environment (exit 35).  
3. **Staging secure config confirmation** (`APP_ENV`, `SUPABASE_SCHEMA=staging`, `SUPABASE_STAGING_TOKEN`).  
4. **Hosted read-only RLS inspection** + approval before any SQL.  
5. **49-reservation INVESTIGATE** against real orders; no auto mutation.  
6. **Yamaha commercial decision**.  
7. **Legacy auth cookie removal** only after Staging login PASS.  
8. **Do not provision service_role on Staging.**

---

## Summary scorecard

| Area | Result |
|------|--------|
| Deployment | **BLOCKED** |
| Backup on Staging | **NOT TESTED** (instructions provided) |
| Package / manifest | **PASS** |
| Staging synthetic tests | **NOT TESTED** |
| Supabase security changes | **BLOCKED** / awaiting approval |
| Auth hardening code | **PASS** locally; Staging **NOT TESTED** |
| Reservation reconcile actions | **INVESTIGATE** (no DB match yet) |
| Yamaha | **BLOCKED** (merchant decision) |
| Production safety | **PASS** (no Production changes) |

**Overall: NO Staging validation complete. NO Production GO.**  
Next human action: upload `orva-store-staging-stabilization.zip` to Staging (with backups), confirm secure config, then authorize re-run of §7 tests.
