# ORVA STORE — Staging Release Preparation & Deployment Safety Audit

**Date:** 2026-11-07  
**Gate:** Preparation only. **No commit, push, Hostinger deploy, hosted SQL, Production changes, historical reservation mutations, or remote Cron creation.**

**Local acceptance baseline:** PostgreSQL 18.6 · 14 PASS / 0 FAIL · PHP/Node parity PASS · crash recovery PASS · 51 historical RESERVED preserved.

---

## Verdict

The Staging release package is **ready to assemble** from `release/v1.0` plus the stabilization files, with clear exclusions for local-only PG tooling and secrets. **Do not deploy yet.** Two Hostinger blockers remain: Staging **`pdo_pgsql` is disabled**, and **`data/inventory-state.json` is Git-tracked** (must not overwrite live inventory on deploy).

---

## 1. Release artifact hygiene

### Git state

| Item | Value |
|------|-------|
| Current branch | `release/v1.0` @ `d2b991e` (tracks `origin/release/v1.0`) |
| Proposed Staging base | Same tip — create local `staging` from `release/v1.0` **after approval** |
| Remote `staging` branch | Not inspected as created in this pass |
| Dirty tree | Yes — modified API/lib + untracked stabilization modules (32 porcelain lines) |

### Already-tracked paths requiring care (`git ls-files`)

| Path | Risk | Action for Staging package |
|------|------|----------------------------|
| `data/inventory-state.json` | Live ledger; workstation copy dirty | **Exclude from Hostinger sync** / preserve server file |
| `data/reservation-reconciliation-*.json` | Ops reports | Exclude from public docroot ZIP |
| `.env.example` | OK (no secrets) | Include |
| `admin/` (426 files) | Next static export | **Include** |

### Local-only resources — exclusion status

| Resource | Excluded? |
|----------|-----------|
| `tools/pgsql-portable/` | **Yes** (`.gitignore`) |
| `tools/orva-pgdata/` | **Yes** |
| `data/private/orva-local-pg.env` | **Yes** (`/data/private/`) |
| `.env.local` / credentials | **Yes** (`.env*`) |
| PG test result JSON | **Yes** (`*results*.json`) |
| `orvastore Dashbaord v0.9/` source | Not in deploy set (export is `admin/`) |

No tracked private credentials found under `data/private/` (directory gitignored). **No `git rm` / destructive untrack performed.**

### Deployment manifest

| Field | Value |
|-------|-------|
| Generator | `node scripts/build-staging-release-manifest.js` |
| Sidecar list | `data/local-fixtures/staging-release-manifest-files.txt` |
| Sidecar meta | `data/local-fixtures/staging-release-manifest.json` |
| File count | **653** |
| Manifest list SHA-256 | `8c3d52751d64fe0d0a428c70bec3a1592ae5058a6c4abb3cccec4103173e0c78` |
| Admin export files | **426** |
| Proposed new commit files (untracked today) | `lib/db-authority.js`, `lib/*-pg.*`, `lib/inventory-recovery.js`, `lib/orva-pg.php`, `lib/rate-limit-pg.php`, recovery scripts, SQL proposal, cron proposal docs, local reports |

**ZIP/branch contents (intended):** application PHP/JS API, `admin/` Next export, storefront HTML/assets, `lib/` including PG inventory/rate-limit/recovery, `scripts/recover-abandoned-reservations.php` (+ JS twin), SQL **proposals** (not executed), `.env.example`.  

**Not in ZIP/branch runtime payload:** portable PG binaries, local PG data, private env, synthetic PG test results, dashboard **source** tree.

---

## 2. Hostinger recovery runner

### Node CLI on Hostinger

| Finding | Detail |
|---------|--------|
| Website types | `orva-store.com` and `staging.orva-store.com` → `website_type: **other**` (not `nodejs`) |
| Conclusion | **Do not rely on Node CLI cron** for shared Hostinger Staging |

### PHP CLI runner (prepared)

| Item | Detail |
|------|--------|
| Script | `scripts/recover-abandoned-reservations.php` |
| Rules | Same as Node: aged `CHECKOUT_PENDING` only; order-existence reconcile; fail closed; never NULL lifecycle; lock file; sanitized prefixes |
| Local dry-run | **PASS** — scanned 199; `skippedHistorical=51`; `released=0` |
| Node twin | `scripts/recover-abandoned-reservations.js` (fallback if Node hosting added later) |

### Cron proposal (not created)

See `docs/HOSTINGER_INVENTORY_RECOVERY_CRON_PROPOSAL.md`.

```text
Schedule: every 15 minutes
Command: flock … php …/staging/scripts/recover-abandoned-reservations.php --apply --threshold-ms=900000
```

**Remote Cron Job: NOT created.**

---

## 3. Inventory seed safety (dry-run only)

Report: `data/local-fixtures/inventory-seed-staging-dry-run-report.json`

| Metric | Value |
|--------|------:|
| Historical RESERVED ledger rows | **51** |
| Among them `CHECKOUT_PENDING` | **0** |
| ORVA-P1-PRO ledger / item reserved | 50 / 50 |
| ORVA-P2-ELITE ledger / item reserved | 1 / 1 |
| Available / reserved / totalPhysical | Preserved per SKU in source JSON |

### ORVA-DRILL-PRO mismatch

| Field | Value |
|-------|------:|
| item.available | 17 |
| item.reserved | 3 |
| item.totalPhysical | 20 |
| matching RESERVED ledger rows | **0** |
| Classification | `LEDGER_VS_ITEM_RESERVED` |

**Seed policy when later approved:** import counters as-is; **do not** invent ledger rows; **do not** auto-release. Manual ops review after Staging schema exists.

**Hosted seed: NOT executed.**

---

## 4. SQL proposal verification

| File | `supabase/proposals/2026-11-07-public-inventory-idempotency.sql` |
|------|------------------------------------------------------------------|
| SHA-256 | `4550f155a2133728695755b5132385514743567d7cae44b392163bcb54ca6720` |
| Expected match | **PASS** |

| Check | Result |
|-------|--------|
| Objects necessary | items, reservations (+ lifecycle), audit, idempotency, rate_limits + indexes |
| RLS enabled | **Yes** on inventory/idempotency/rate_limits |
| Permissions restricted | `REVOKE` from `PUBLIC`/`anon`/`authenticated`; `GRANT` to `service_role` |
| Atomic inventory ops | App transactions + `FOR UPDATE` / conditional `UPDATE` / advisory locks (code) |
| Idempotency constraint | `UNIQUE(key)` + status machine |
| Rollback | Documented in proposal header (DROP objects / leave rate_limits if pre-existing) |
| Overwrite hosted | `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS lifecycle` — **additive**, does not DROP data; still requires explicit Staging approval before execute |

**Hosted SQL: NOT executed.**

Local-only bootstrap `2026-11-07-orva-local-bootstrap.sql` must **never** run on hosted Supabase.

---

## 5. GitHub Staging branch preparation (no commit/push)

| Step | Status |
|------|--------|
| Correct source base | `release/v1.0` @ `d2b991e` |
| Next.js static dashboard | `admin/` present (**426** tracked files) |
| Mutable runtime independent of Git | Required: preserve Hostinger `data/inventory-state.json` (and locks) outside deploy overwrite |
| Exact commit contents (when approved) | Stabilization libs + recovery scripts + SQL proposal + docs/reports + modified send-order/db/inventory/vercel/gitignore/.env.example; **exclude** local PG tools/private env |
| Hostinger Git connect | **Not done** |
| Commit / push | **Not done** |

Suggested local sequence **after approval only:**

```text
git checkout -b staging release/v1.0
# stage approved files only (not tools/, not data/private/, not .env.local)
# git commit …
# git push -u origin staging   # only when explicitly requested
```

---

## 6. Final Staging deployment checklist

| Prerequisite | Classification | Evidence |
|--------------|----------------|----------|
| Existing Supabase Staging schema | **NOT TESTED** (this pass; prior docs exist; no hosted connect) | — |
| Restricted Staging login (`staging_login` / `staging_user`) | **PASS** (local mirror) / **NOT TESTED** (hosted) | Local bootstrap verified `SET ROLE` |
| Hostinger PHP 8.3 | **PASS** | Staging PHP `8.3.36` via `hosting_php_get` |
| Hostinger PHP `pdo_pgsql` | **BLOCKED** | Extension state **disabled** on `staging.orva-store.com` |
| Protected external Staging config | **NOT TESTED** | Must confirm server-side secure config / no secrets in Git |
| Correct Staging DB connection | **NOT TESTED** | Requires Staging URL + non-service_role path |
| Complete Dashboard static export | **PASS** | `admin/` 426 files in manifest |
| PHP / Node inventory parity | **PASS** | Local `orva_local` acceptance |
| Safe recovery scheduling | **PASS** (artifacts) / cron **NOT** installed | PHP runner + proposal doc |
| Node CLI cron on shared Hostinger | **BLOCKED** as primary | websites are `other`, not `nodejs` |
| Inventory seed into hosted Staging | **NOT TESTED** / **blocked until SQL + approval** | Dry-run only |
| Historical 51 preserved | **PASS** | Live JSON + PHP recovery dry-run |

---

## 7. Remaining blockers (must clear before Staging go-live)

1. **Enable `pdo_pgsql` (and preferably `pgsql` if required by tooling) on Hostinger Staging** via hPanel / `hosting_php_update` — needs explicit approval (mutates PHP config).
2. **Deploy hygiene:** never overwrite live `data/inventory-state.json` from Git; confirm rsync/Git deploy excludes or uses server-side preserve.
3. **Apply SQL proposal to Staging schema only** after checksum confirmation and backup — not done.
4. **Seed inventory dry-run → real seed** only after SQL + ops sign-off; Drill-Pro mismatch remains manual.
5. **Staging DB credentials / `staging_login` architecture on hosted Supabase** — verify before cutover.
6. **Create Cron Job** only after `pdo_pgsql` + deploy of PHP recovery script.
7. **Commit/push `staging` branch** only after explicit approval of file list.

---

## Approval gate

Stop here. Review this document, the manifest checksum `8c3d5275…`, and the SQL checksum `4550f155…`.  

Approve separately, in order: (1) enable Staging `pdo_pgsql`, (2) commit/push staging branch, (3) Hostinger deploy with inventory preserve, (4) Staging SQL, (5) inventory seed, (6) Cron Job.
