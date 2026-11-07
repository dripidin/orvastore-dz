# ORVA STORE — STAGING DATABASE CONNECTIVITY

**Date:** 2026-11-06  
**Project:** `olmsjkhdfghyydogcvvy` (OrvaStore Eccommerce)  
**Site:** `https://staging.orva-store.com`  
**Config path (intended):** `/home/u520776094/domains/orva-store.com/staging-secure-config.php`

## Verdict

| Area | Status |
|------|--------|
| External configuration | **PARTIAL** — loaded with `SUPABASE_SCHEMA=staging`; **`SUPABASE_STAGING_TOKEN` missing** |
| Hosted schema / role | **PASS** |
| JWT compatibility (algorithm / claims model) | **PASS** (HS256 legacy JWT path active) |
| JWT mint / install | **BLOCKED** — project JWT signing secret not available offline |
| Migration (create schema/role) | **NOT REQUIRED** (already present) |
| Optional RLS hardening (drop leftover anon policies) | **AWAITING APPROVAL** |
| Connectivity / synthetic order | **BLOCKED** |
| Production isolation | **PASS** so far (`staging.orders=0`, `public.orders=259`) |

**Completion criteria:** **NOT MET** — PHP cannot authenticate as `staging_user` until a valid `SUPABASE_STAGING_TOKEN` is installed.

---

## 1. External configuration status

| Check | Result | Evidence |
|-------|--------|----------|
| Hostinger MCP can read `staging-secure-config.php` | **NO** | File is outside website document root (`root_directory` = `.../public_html/staging`). MCP file APIs are document-root scoped and refuse secret files. |
| PHP loads external Staging config | **YES** | Live checkout returns `STAGING_TOKEN_REQUIRED` — thrown only when `supabase.schema === 'staging'`. Default without external config is `public`. |
| `SUPABASE_SCHEMA` | **staging** | Same error path |
| `SUPABASE_STAGING_TOKEN` | **MISSING / empty** | `HTTP 503 STAGING_TOKEN_REQUIRED` |
| `SUPABASE_SERVICE_ROLE_KEY` fallback on Staging | **NOT USED** | Staging schema path refuses service_role substitution; failure is token-required, not a public write |
| `APP_ENV` | **LIKELY staging** (not byte-inspected) | External config is loaded; template sets `APP_ENV=staging`. Exact value not readable without outside-webroot access or a deployed probe |
| Permissions of outside config | **NOT INSPECTED** | Requires File Manager / SSH outside `public_html` |

No secrets were printed. Configuration was **not** overwritten. Production was **not** modified.

Prepared (not deployed) helpers for the next step:
- `api/staging-config-status.php` — boolean-only probe (requires probe token)
- `scripts/mint-staging-user-jwt.js` — offline HS256 mint (writes `data/private/staging-user.jwt`, never prints JWT)
- `scripts/install-staging-token-remote.js` — one-shot patcher that updates **only** `SUPABASE_STAGING_TOKEN` and removes any service_role key if present

---

## 2. Hosted schema and role status

Verified with Supabase MCP `execute_sql` on project `olmsjkhdfghyydogcvvy`:

| Object | Status |
|--------|--------|
| Schema `staging` | **EXISTS** |
| Role `staging_user` | **EXISTS** — `NOLOGIN`, `NOBYPASSRLS`, not superuser |
| `authenticator` → `staging_user` | **YES** (`pg_has_role(... MEMBER) = true`) |
| `search_path` for `staging_user` | `staging, pg_temp` |
| Staging tables (12) | `orders`, `order_items`, `customers`, `rate_limits`, `watchlist`, `risk_events`, `audit_logs`, `inventory_items`, `inventory_audit`, `idempotency_records`, `shipments`, `telegram_dispatch_ledger` |
| RLS enabled + `staging_user` policy | **YES** on all 12 |
| Staging functions | `execute_order_switch`, `update_updated_at_column` |
| Table privileges for `staging_user` | Match intended matrix (orders SELECT/INSERT; inventory SELECT/UPDATE; etc.) |
| Staging sequences | None present (empty) |
| Order counts | `staging.orders = 0`, `public.orders = 259` |

### PostgREST / Exposed Schemas

| Check | Result |
|-------|--------|
| `Accept-Profile: staging` with anon/publishable key | **HTTP 200** `[]` — schema **is exposed** to PostgREST |
| Default profile (public) | **HTTP 200** — returns public order rows |

### Residual policy debt (does not block `staging_user`)

Still present on hosted DB:
- `anon staging order insertion` / `anon staging order read` on `staging.orders`
- `anon staging rate limits` on `staging.rate_limits`
- `anon` / `authenticated` still have `USAGE` on schema `staging`

Prepared fix (not executed):  
`supabase/proposals/2026-11-06-staging-rls-hardening.sql`  
SHA-256: `4C3AF068AFE0A31B8F5AFD55658BCA1932807273D0BA9534807B263AE4998E52`  

Impact if approved: Staging-only policy drops; **no `public` schema changes**; Production order table policies untouched.

---

## 3. JWT compatibility status

| Check | Result |
|-------|--------|
| Legacy anon API key type | Present (`type: legacy`) — HS256 JWT with `iss=supabase`, `role=anon`, **no `kid`** |
| Accepted algorithm for custom role tokens | **HS256** (matches Phase 8E offline architecture) |
| Required `kid` | **None** for legacy HS256 path |
| Required claims for Staging | `role=staging_user`, `iss=supabase`, `iat`, `exp` |
| PostgREST can SET ROLE `staging_user` | **YES** (authenticator membership verified) |
| Local `SUPABASE_JWT_SECRET` / `JWT_SECRET` | **ABSENT** from `.env.local` and process env |
| Service role key locally | **ABSENT** (good) |

**No token was generated** (per rule: do not invent a replacement without the real signing secret).  
**No private signing key was placed on Hostinger.**

---

## 4. Migration status

| Item | Status |
|------|--------|
| Create schema `staging` / role `staging_user` | **NOT REQUIRED** — already hosted |
| DDL executed this session | **NONE** |
| Optional anon-policy hardening | **STOPPED for explicit approval** |

---

## 5. Connectivity / synthetic tests

| Test | Result |
|------|--------|
| Authenticated Staging read as `staging_user` | **BLOCKED** (no token) |
| Synthetic Staging checkout | **BLOCKED** — `STAGING_TOKEN_REQUIRED` |
| Persist in `staging.orders` | **NOT TESTED** |
| Absent from `public.orders` | **N/A** (no write attempted); baseline public count unchanged at inspection time |
| Inventory reservation | Pre-token path reserves then rolls back on storage exception (**PASS** for rollback) |
| Dashboard visibility | **NOT TESTED** |
| Cancellation / reservation release | **NOT TESTED** |
| Telegram delivery | **NOT TESTED** |

---

## 6. Production isolation

| Check | Result |
|-------|--------|
| Production site deploy | **NOT TOUCHED** |
| Public schema DDL | **NOT TOUCHED** |
| Hostinger MySQL | **UNUSED** (by design) |
| 49 Pack1 reservations | **NOT MODIFIED** |

---

## 7. Remaining blockers

1. **Provide the project JWT Secret offline** (Supabase Dashboard → Project Settings → API → JWT Secret) by setting local-only `SUPABASE_JWT_SECRET` in `.env.local` (gitignored). Do **not** put it on Hostinger.
2. Then run:
   - `node scripts/mint-staging-user-jwt.js` → writes `data/private/staging-user.jwt` (default TTL 7 days, cap 90 days)
   - `node scripts/install-staging-token-remote.js` → prepares one-shot `api/patch-staging-token.php`
   - Deploy that single endpoint to Staging (or approve a Staging-only redeploy)
   - `node scripts/install-staging-token-remote.js --send` → patches outside config only; endpoint self-deletes
3. Re-run focused Staging order tests.
4. **Optional approval:** execute `2026-11-06-staging-rls-hardening.sql` to remove leftover anon Staging policies.

---

## Exact manual queries (if MCP unavailable later)

```sql
SELECT rolname, rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname IN ('staging_user','authenticator');
SELECT pg_has_role('authenticator','staging_user','MEMBER');
SELECT relname, relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='staging' AND relkind='r';
SELECT polname, tablename FROM pg_policies WHERE schemaname='staging' ORDER BY 2,1;
SELECT (SELECT count(*) FROM staging.orders) AS staging_orders, (SELECT count(*) FROM public.orders) AS public_orders;
```

---

*End of report — Staging DB connectivity incomplete pending JWT secret + token install.*
