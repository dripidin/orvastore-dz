# ORVA STORE — Staging Deployment Recovery Report

**Date:** 2026-11-06  
**Target:** `https://staging.orva-store.com`  
**Document root:** `/home/u520776094/domains/orva-store.com/public_html/staging`  
**Scope:** Staging only. No Production deploy. No Supabase DDL. No 49-reservation auto-reconcile.

---

## Verdict

| Area | Result |
|------|--------|
| Hostinger MCP | **PASS** |
| TLS diagnostics | **PASS** (local TLS 1.2); TLS 1.3 **BLOCKED** on this Windows 10 agent |
| ZIP validation | **PASS** |
| Staging backup | **PASS** (pre-state captured; Staging was empty aside from Hostinger default) |
| File deployment | **PASS** |
| Staging config (APP_ENV / schema / token) | **BLOCKED** — schema is `staging`, but `SUPABASE_STAGING_TOKEN` is missing |
| HTTP surface checks | **PASS** |
| Focused DB write tests | **BLOCKED** (prerequisite: Staging token) |
| Production untouched | **PASS** |

---

## 1. Hostinger MCP connection

**PASS** — Namespace `plugin-hostinger-cursor-plugin-hostinger-hosting` was connected and authenticated. Used verified operations only: `hosting_websites_*`, `hosting_deploy`, `hosting_files_list-website-and-directories`, `hosting_files_website-content`.

---

## 2. TLS diagnostic results

| Check | Result |
|-------|--------|
| DNS `staging.orva-store.com` | **PASS** — A `62.72.37.8`, AAAA present |
| TCP 443 connect | **PASS** |
| TLS 1.2 handshake | **PASS** — Schannel, ALPN http/1.1, HTTP/1.1 200 |
| TLS 1.3 handshake | **BLOCKED** — agent OS: Windows 10; curl reports `TLS 1.3 not supported on Windows prior to 11` |
| Certificate | **PASS** — CN=`staging.orva-store.com`, Issuer=Let's Encrypt YE1, valid 2026-11-03 → 2027-02-01, hostname match |
| Chain / verify | **PASS** — no insecure flags used (`-k` / `rejectUnauthorized:false` not used) |
| Prior curl exit 35 / Node EPROTO | **Environment-specific** — earlier failures were Schannel/`--tls-max 1.3` on Win10; not a server cert fault |

Production `orva-store.com` also answers TLS 1.2 (**PASS**, HTTP 200). Staging and Production resolve to different IPs (expected for this Hostinger layout).

---

## 3. ZIP validation

### Prepared stabilization package (manifest)

| Field | Value |
|-------|-------|
| File | `orva-store-staging-stabilization.zip` |
| SHA-256 | `56798B10A1845EA8BE4D6D79F4B548E45F983D7BE62CFFFC32EC776D4D89B040` |
| Structure | Flat paths matching Staging docroot (`api/`, `lib/`, `data/`, root JS) — **no extra nested folder** |
| Secrets | **PASS** — no `.env`, `secure-config`, private keys, or credentials |
| Production-only config | **PASS** — excluded |
| Manifest match | **PASS** vs `STAGING_DEPLOYMENT_MANIFEST.md` (15 content files) |

### Deploy vehicle actually used

`hosting_deploy` **fully replaces** the website document root. Deploying only the 15-file stabilization ZIP would have wiped Staging to those files alone. Staging had been recreated empty (`default.php` only), so a **full site archive** was required:

| File | SHA-256 | Notes |
|------|---------|-------|
| `orva-store-staging-full_20261106_231847.zip` | `C72A4449C7C6EB496953B5D45879B6F2936B8C2450944FAACB73FA1A4720B337` | Initial Staging populate |
| `orva-store-staging-full_20261106_bomfix.zip` | `4AFB2CC7BD06FE453A8B77C13D994BFEF7B9896C5307698847C050DC882642FB` | Hotfix: BOM-free inventory + inventory BOM strip + Supabase exception rollback (~693 entries) |

---

## 4. Backup

| Item | Result |
|------|--------|
| Pre-deploy Staging state | **PASS** — local note `backups/staging-predeploy-20261106/` (Staging contained only Hostinger `default.php` after subdomain recreate) |
| Prefer outside `public_html` | **N/A / limited** — Hostinger MCP file API is scoped to website document roots; no remote outside-webroot backup API available in-session |
| Credentials / encryption key | **PASS** — not copied into archives; not overwritten by deploy (external `staging-secure-config.php` path is outside the ZIP) |
| Production | **PASS** — not backed up or modified |

---

## 5. Deployment result

| Item | Result |
|------|--------|
| Target domain | `staging.orva-store.com` only |
| `hosting_deploy` status | **PASS** (`status: deployed`) |
| Files on Staging (listed) | **284+** application/media files under `staging/` (full site; admin static tree included) |
| Stabilization files present | **PASS** — `api/send-order.php`, `api/auth.php`, `lib/inventory-store.php`, `lib/admin-session.php`, `packs-client.js` (27762), `script.js` (34484) |
| Production `public_html` | **PASS** — untouched (`script.js` still **33950** bytes) |
| Nested path mistake | **PASS** — files at `staging/api/...`, not `staging/staging/...` |

Hotfix redeploy also cleared three synthetic test reservations left by the earlier empty-500 failure window.

---

## 6. Staging configuration verification

| Check | Result | Evidence |
|-------|--------|----------|
| Document root is `.../public_html/staging` | **PASS** | Hostinger listing under `staging/` |
| `SUPABASE_SCHEMA = staging` | **PASS** | Checkout returns `STAGING_TOKEN_REQUIRED` (thrown only when schema === `staging`) |
| `SUPABASE_STAGING_TOKEN` present | **FAIL / BLOCKED** | Same error — token empty |
| No `SUPABASE_SERVICE_ROLE_KEY` fallback on Staging schema | **PASS** | Code path refuses silent service_role for `staging` schema; failure is token-required, not a prod write |
| `APP_ENV = staging` | **NOT DIRECTLY READABLE** | External config file is outside web root / treated as sensitive. Schema staging implies Staging secure-config is loaded; exact `APP_ENV` value not HTTP-visible |
| Private config not HTTP-exposed | **PASS** | `/api/config.php` → 403; `/data/*` → 403; `/data/private/*` → 403; `staging-secure-config.php` via web → 404 |
| Existing Staging auth still works | **NOT TESTED** (correct password not used). Wrong password → `INVALID_PASSWORD`; lockout → `LOGIN_LOCKED` **PASS** |

**Prerequisite for DB writes:** place/restore `SUPABASE_STAGING_TOKEN` (staging_user JWT) in `/home/u520776094/domains/orva-store.com/staging-secure-config.php` (outside web root). Do not set service_role on Staging.

---

## 7. HTTP status checks

| Path | Status | Result |
|------|-------:|--------|
| `/` | 200 | **PASS** |
| `/pack1.html`, `/pack2.html` | 200 | **PASS** |
| `/script.js`, `/packs-client.js` | 200 | **PASS** |
| `GET /api/send-order.php` | 405 | **PASS** |
| `POST /api/auth.php` (empty) | 400 `MISSING_PASSWORD` | **PASS** |
| `GET /api/delivery.php` | 200 gateway banner | **PASS** |
| `/api/config.php` | 403 | **PASS** |
| `/data/products-catalog.json` | 403 | **PASS** |
| `/data/inventory-state.json` | 403 | **PASS** |
| `/data/private/analytics-ledger.json` | 403 | **PASS** |

---

## 8. Focused test results

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1 | Successful checkout | **BLOCKED** | `STAGING_TOKEN_REQUIRED` (HTTP 503). Inventory reserves then rolls back. |
| 2 | Duplicate order attempt | **PASS** (pre-DB) | Earlier window: `DUPLICATE_ORDER_ID` after reserve. After hotfix, second attempt also fails closed on token (no leaked reserve). |
| 3 | Cancellation | **NOT TESTED** | Requires persisted order + admin session |
| 4 | Courier handoff simulation | **NOT TESTED** | Requires persisted order + admin session; no real dispatch attempted |
| 5 | Invalid wilaya/commune | **PASS** | `INVALID_WILAYA`; `INVALID_COMMUNE_FOR_WILAYA` |
| 6 | Archived product rejection | **PASS** | `PRODUCT_INACTIVE` for `ORVA-INACTIVE-TEST` and `ORVA-SAC-YAM` |
| 7 | Admin login / lockout | **PASS** (lockout) | 5 wrong passwords → `LOGIN_LOCKED` / HTTP 429. Successful login **NOT TESTED** |
| 8 | Telegram HTML escaping | **NOT TESTED** (runtime) | Code present on Staging (`orva_tg_escape` / `htmlspecialchars`). Runtime path not reached without successful order |

**49-reservation reconciliation:** **NOT RUN** (per instructions).

---

## 9. Issues found during recovery (Staging-only fixes applied)

1. **UTF-8 BOM on `data/inventory-state.json`** — PHP `json_decode` failed → false `INVENTORY_SKU_MISSING`. Fixed by redeploying BOM-free JSON and stripping BOM in `lib/inventory-store.php`.
2. **Uncaught Supabase exceptions** — empty HTTP 500 and leaked reservations. Fixed by try/catch + inventory rollback in `api/send-order.php`; now returns JSON `STAGING_TOKEN_REQUIRED`.

---

## 10. Remaining blockers

1. **BLOCKED:** Set `SUPABASE_STAGING_TOKEN` in external Staging secure-config (and confirm `APP_ENV=staging`, `SUPABASE_SCHEMA=staging`, no service_role). Then re-run focused tests 1–4 and 8.
2. **NOT TESTED:** Successful admin login (needs Staging admin password from secure-config).
3. **INVESTIGATE only:** Historical 49 Pack1 reservations (local ledger concern) — do not auto-release.
4. **Yamaha** merchant price decision still pending (product remains archived on Staging).

---

## 11. Manual follow-up (if MCP unavailable later)

SFTP / File Manager target: `public_html/staging` only.  
Do **not** upload into Production `public_html`.  
Restore/edit secrets only at:  
`/home/u520776094/domains/orva-store.com/staging-secure-config.php` (outside web root).

---

*End of recovery report.*
