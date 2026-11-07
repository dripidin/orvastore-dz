# ORVA STORE — Local Implementation Report

**Date:** 2026-11-07  
**Scope:** Local Windows machine only. No Git push/commit, no Hostinger, no hosted Supabase SQL/roles.

---

## Part 1 — Project protection

| Check | Result |
|-------|--------|
| Branch | `release/v1.0` (unchanged) |
| Uncommitted work | Preserved (large dirty tree left intact) |
| Local `staging` branch | **Not created** (avoids mixing dirty work) |
| Backups | `backups/local-impl-2026-11-07/` (`config.php`, `send-order.php`, `delivery.php`, `.gitignore`, inventory, catalog) |
| PHP | 8.3.36 CLI |
| Node | v24.22.1 |
| `pdo_pgsql` | **Unavailable** locally |

---

## Part 2 — GitHub deploy prep (local only)

- Documented mapping in `docs/LOCAL_GITHUB_BRANCH_PREP.md`.
- Admin export routes verified: `/dashboard/default`, `products/designer|demand|pages`, login — **all PASS**.
- Mutable data policy: fixture runtime files gitignored; inventory/catalog **not deleted**; seeds under `data/seeds/` and `data/local-fixtures/*.example.*`.
- No remote branch, attach, or deploy.

---

## Part 3 — Staging PDO prototype

| File | Role |
|------|------|
| `lib/staging-db.php` | PDO repository + mock store + REST shim |
| `api/config.php` | `staging_pdo` config + local secure merge |
| `api/send-order.php` / `api/delivery.php` | Route via `orva_orders_storage_request` |
| `api/local-dev-status.php` | Safe diagnostics (no secrets) |
| `data/private/local-secure-config.php` | Synthetic local credentials (gitignored) |

**Security model in code:**

- Opt-in via `STAGING_USE_PDO` + `APP_ENV` in `{local,staging,development,dev}` only.
- Production PostgREST path unchanged when flag off / wrong env.
- Intended roles: `staging_login` (LOGIN) → `SET ROLE staging_user` (NOLOGIN, NOBYPASSRLS).
- Fully qualified `staging.*` SQL; hosted DSN blocked unless `STAGING_PDO_ALLOW_LIVE=true` (kept false).
- No JWT minting on this path; no service_role fallback.

---

## Part 4 — Local DB / mocks

| Item | Status |
|------|--------|
| Local PostgreSQL server | Not used / not required |
| `pdo_pgsql` | Missing |
| Mock fixture store | Implemented |
| Real PostgreSQL integration | **NOT_TESTED** |
| Hosted Supabase connection | **Blocked / not attempted** |

---

## Part 5 — Localhost preview

Servers started for review:

| Service | URL |
|---------|-----|
| Node storefront + JS APIs | http://localhost:3000 (already listening; new start hit EADDRINUSE) |
| PHP APIs + static + admin export | http://127.0.0.1:8000 (running) |
| Admin default | http://127.0.0.1:8000/admin/dashboard/default/ |
| Nested designer | http://127.0.0.1:8000/admin/dashboard/products/designer/ |
| Local diagnostics | http://127.0.0.1:8000/api/local-dev-status.php |

Verified live: storefront 200, dashboard routes 200, diagnostics show `orders_backend: mock`, synthetic `POST /api/send-order.php` succeeded, `get_all_orders` returned fixture + new order.

Synthetic admin credentials (local only): password `local-dev-admin-password`, token `local-dev-admin-token`.

Also added `lib/mbstring-polyfill.php` because local Windows PHP lacked `ext-mbstring` (Hostinger normally has it).

Restart later: `npm run preview:local` or `scripts/start-local-preview.ps1`.

Node JS order path should use `ORVA_TEST_MOCK_SUPABASE=true` when started via that script. PHP order path uses the mock PDO repository.

---

## Part 6 — Automated tests

```
php scripts/test-staging-pdo-local.php   → 20 passed, 0 failed
php scripts/verify-admin-export-routes.php → 6 passed, 0 failed
```

Covered: repository init, prepare/emulate contract, schema qualification, role names, mock CRUD, REST shim, hosted-DSN refusal, production flag isolation.

Not covered (no driver): live `SET ROLE`, SSL handshake, Session Pooler auth.

---

## Explicit non-actions

No Git commit/push; no Hostinger MCP; no hosted role/SQL/RLS changes; no Production/Staging website changes; no Production customer data used.

---

*End of report.*
