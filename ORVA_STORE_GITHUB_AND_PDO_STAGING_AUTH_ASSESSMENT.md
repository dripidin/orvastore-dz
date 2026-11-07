# ORVA STORE — GitHub Deployment & Direct PostgreSQL Auth Assessment

**Date:** 2026-11-07  
**Scope:** Read-only evaluation. No deploy, commit, push, role change, or phpinfo exposure.  
**Alternative under review:** GitHub → Hostinger Git → PHP 8.3 → Supabase Session Pooler → restricted Staging LOGIN role (no legacy JWT minting).

---

## Verdict

| Area | Result |
|------|--------|
| `main` → `public_html` / `staging` → `public_html/staging` | **FEASIBLE** with Hostinger Git, not yet wired |
| Repo / static dashboard compatibility | **PARTIAL** — PHP storefront OK; Next `admin/` export **not** on GitHub `main` |
| Secrets excluded from Git | **PASS** (`.gitignore` covers secure-config / private / `.env*`) |
| Direct PG LOGIN for Staging (vs JWT) | **FEASIBLE** — prefer **new LOGIN role**, keep `staging_user` NOLOGIN |
| Hostinger PHP 8.3 Staging | **PASS** version; **pdo_pgsql / pgsql currently disabled** (can enable) |
| Session Pooler (actual host) | **PASS** — `aws-0-eu-west-1.pooler.supabase.com:5432` (IPv4) |
| Replace PostgREST with PDO for Staging | **FEASIBLE** with moderate PHP refactor; inventory stays file-based |
| Node/browser Supabase dependency | **LOW** for storefront; admin is PHP-proxied |

**Recommendation:** Proceed with this architecture for Staging **after** (1) enabling `pdo_pgsql`, (2) creating a dedicated LOGIN role (do not convert `staging_user` yet), (3) adding a Staging PDO repository behind the existing API surface, (4) creating a `staging` Git branch and wiring Hostinger Git roots carefully. Keep Production on PostgREST until server credential + anon-read containment (prior A/B) are done.

---

## 1. GitHub deployment architecture

### Repository inspected

| Item | Value |
|------|--------|
| Remote | `https://github.com/dripidin/orvastore.git` |
| Visibility | Public |
| Default branch | `main` |
| Other remote branches | `release/v1.0` |
| Local current branch | `release/v1.0` |
| `staging` branch | **Does not exist yet** |
| Last remote push (API) | 2026-11-04 |

### Hostinger document roots (verified)

| Domain | `root_directory` |
|--------|------------------|
| `orva-store.com` | `/home/u520776094/domains/orva-store.com/public_html` |
| `staging.orva-store.com` | `/home/u520776094/domains/orva-store.com/public_html/staging` |

### Current Git linkage

| Site | Linked Git repos |
|------|------------------|
| Production | **None** |
| Staging | **None** |

Hostinger supports:

- `hosting_git_deploy-website-repository` — clone/pull into document root or a **subdirectory**
- `hosting_deploy` with `git: { repository, branch, directory }` — static/PHP auto-deploy on push (GitHub/GitLab connected in hPanel)

### Proposed mapping

| Branch | Target |
|--------|--------|
| `main` | Production docroot (`orva-store.com` → `public_html`) |
| `staging` (to create) | Staging docroot (`staging.orva-store.com` → `public_html/staging`) |

**Preferred wiring:** treat Staging as its own Hostinger website (already is) and attach Git to `staging.orva-store.com` with branch `staging` into **document root** (empty/`null` directory). Attach Production Git to `orva-store.com` with branch `main`. Avoid deploying Staging as a subdirectory of the Production Git repo on the main site (reduces cross-overwrite risk).

### Overwrite / preservation behavior

From Hostinger Git deploy semantics:

- Tracked files in the branch are reset to the commit (local server edits to tracked files are discarded).
- **Untracked** files on the server **remain**.
- Paths **outside** the website document root are **not** touched by Git deploy.

Therefore:

| Asset | Risk under Git deploy |
|-------|------------------------|
| `staging-secure-config.php` / `secure-config.php` (outside `public_html`) | **Preserved** |
| `data/private/*` (gitignored) | **Preserved** if never committed |
| `data/inventory-state.json` | **At risk** if tracked on the branch — keep gitignored or deploy-exclude |
| Full Next `admin/` tree currently live on Staging only | **Will disappear** unless added to the `staging` branch |

### Secrets exclusion — **PASS**

`.gitignore` already excludes `.env*`, `staging-secure-config*.php`, `secret-keys.php`, `/data/private/`, credentials patterns. GitHub `main` tree scan found only `.env.example` as secret-like path.

### Static dashboard / repo structure compatibility — **PARTIAL**

GitHub `main` is a **flat PHP/HTML storefront** (~120 tracked paths): `api/`, `lib/`, `index.html`, `pack1.html`, packs JS/CSS, `admin.html` / `admin.js` (legacy), **not** the large Next.js `admin/` static export that was bulk-deployed to Staging earlier.

| Surface | On GitHub `main` | On live Staging today |
|---------|------------------|------------------------|
| Storefront PHP/HTML/JS | Yes | Yes |
| `api/*.php` | Yes | Yes (stabilized) |
| Next `admin/` export | **No** | Present from full zip deploy |
| External secure config | N/A (correctly out of Git) | Outside web root |

**Implication:** Hostinger Git from `main`/`staging` will **not** reproduce the current Staging Next admin UI unless you add a build/export step to the branch or keep a separate admin deploy path.

### Do not do yet

No commit, push, or Hostinger Git attach was performed in this assessment.

---

## 2. Direct PostgreSQL LOGIN evaluation

### Current hosted `staging_user` (unchanged)

| Attribute | Value |
|-----------|--------|
| `rolcanlogin` | **false** (NOLOGIN) |
| `rolbypassrls` | **false** |
| `rolsuper` / `CREATEDB` / `CREATEROLE` | **false** |
| `search_path` | `staging, pg_temp` |

This matches PostgREST `SET ROLE staging_user` via JWT — not a TCP login identity.

### Convert `staging_user` → LOGIN? vs separate role

| Option | Pros | Cons |
|--------|------|------|
| **A. ALTER `staging_user` LOGIN** | Existing RLS policies already `TO staging_user` | Changes security model that PostgREST also uses; password on a role that is also JWT-assumed; harder to revoke DB password without affecting JWT path |
| **B. New `staging_login` LOGIN** (recommended) | Keeps JWT-era `staging_user` NOLOGIN intact; password rotatable independently; clearest least-privilege story | Must grant table rights + RLS policies `TO staging_login` (or `SET ROLE staging_user` after connect) |

**Recommendation: Option B.** Do **not** convert `staging_user` until a written migration is approved. Do **not** use `postgres` project password or `service_role`.

Suggested constraints for the new role (when approved later):

- `LOGIN` + strong password  
- `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`  
- `GRANT USAGE ON SCHEMA staging` + table DML matching current `staging_user` matrix  
- `REVOKE` all on `public`  
- `ALTER ROLE … SET search_path = staging, pg_temp`  
- RLS policies explicitly `TO staging_login` (or session `SET ROLE staging_user` with membership)

### Pooler username format (Supabase)

Session pooler users are typically:

`{db_user}.{project_ref}`

Example shape from this project’s existing Session Pooler URL (password redacted):

- Host: `aws-0-eu-west-1.pooler.supabase.com`  
- Port: `5432` (session mode)  
- Current dashboard-style user in local env: `postgres.olmsjkhdfghyydogcvvy`  

A dedicated Staging login would follow the same pattern, e.g. `staging_login.olmsjkhdfghyydogcvvy` (exact name TBD when role is created). Confirm in Dashboard → Connect → Session pooler after the role exists.

**No role was modified in this assessment.**

---

## 3. Hostinger PHP 8.3 compatibility (Staging)

Source: `hosting_php_get` for `staging.orva-store.com` (not public phpinfo).

| Extension | State |
|-----------|--------|
| PHP version | **8.3.36** |
| `pdo` | **enabled** |
| `openssl` | **build-in** |
| `pdo_pgsql` | **disabled** |
| `pgsql` | **disabled** |
| `curl` | build-in (current PostgREST path) |
| `nd_pdo_mysql` | enabled (Hostinger MySQL — unused by design) |

**Enabling PostgreSQL drivers:** Hostinger supports toggling extensions via `hosting_php_update` (`extensions.enable: ["pdo_pgsql","pgsql"]`). That call is **destructive-capable** (version changes reset extensions) — do only with explicit approval, and pass the full desired extension set if changing version.

**SSL:** OpenSSL is available for `PDO::pgsql` with `sslmode=require`.

---

## 4. Supabase connection requirements

### Actual Session Pooler (from project env shape + docs + DNS)

| Item | Verified value |
|------|----------------|
| Region | `eu-west-1` |
| Session pooler host | **`aws-0-eu-west-1.pooler.supabase.com`** |
| Session mode port | **5432** |
| Transaction mode port (docs) | 6543 (not preferred for PDO prepared statements) |
| Direct DB host | `db.olmsjkhdfghyydogcvvy.supabase.co` |
| Direct DNS | **AAAA only** (IPv6) in this check |
| Pooler DNS | **A records** (IPv4) — suitable for Hostinger |

### Requirements for Staging PDO

| Requirement | Notes |
|-------------|--------|
| IPv4 | Use Session Pooler (not direct) from Hostinger |
| SSL | `sslmode=require` (or verify-full with Supabase CA) |
| Session mode | Port **5432** — supports prepared statements / session `SET` |
| Transaction mode | Avoid for PDO prepared statements unless disabled |
| Auth | Dedicated LOGIN role password in **outside-webroot** Staging config only |
| `search_path` | Force `staging, pg_temp` on role + assert in app bootstrap |
| RLS | Remains enforced (`NOBYPASSRLS`); policies must include the LOGIN role |
| Isolation | Never grant `public` DML; qualify SQL as `staging.*` |

### Isolated Staging test (not run)

A live PDO smoke test was **not** executed (would need enabled `pdo_pgsql` + approved LOGIN role + password). When ready:

1. Enable `pdo_pgsql` on Staging only.  
2. Create LOGIN role (approved SQL).  
3. Store DSN in `staging-secure-config.php` only.  
4. One-off CLI/`api` probe: `SELECT current_user, current_schema, inet_server_addr()`.  
5. Confirm `SELECT` against `staging.orders` works and `public.orders` is denied.

---

## 5. Application architecture impact

### What depends on PostgREST today

Central helper: `orva_supabase_rest_request()` in `api/config.php` (schema profiles + credential selection).

| Endpoint | Operations |
|----------|------------|
| `api/send-order.php` | `POST /rest/v1/orders` |
| `api/delivery.php` | `GET/PATCH/DELETE /rest/v1/orders`, `POST /rest/v1/audit_logs` |

Inventory reserve/release/settle remains in **`lib/inventory-store.php`** (local JSON + flock) — **not** PostgREST. That lock behavior can stay as-is under a PDO order path.

### Can PDO replace REST safely?

**Yes for Staging**, if you introduce a thin repository (e.g. `lib/staging-db.php`) that:

- Opens PDO once per request with DSN from secure config  
- Uses **only** parameterized SQL  
- Qualifies every object as `staging.<table>`  
- On connect: `SET search_path TO staging, pg_temp` (defense in depth)  
- Maps current REST shapes (insert order, list orders, patch status, audit insert) to SQL  
- Returns the same PHP array shapes the endpoints already expect  

**Preserve:** inventory file locks; Telegram after successful persist; fail-closed if DSN/role missing.

**Do not:** put DB password in Git, browser JS, or Staging zip archives.

### Schema qualification guarantee

- Role `search_path = staging, pg_temp`  
- Application always uses `staging.orders`, etc.  
- Reject any query builder that accepts raw table names from the client  

### Node / browser impact

Storefront JS (`packs-client.js`, `script.js`) talks to **PHP APIs**, not Supabase REST directly for orders. Admin dashboard also proxies through PHP.  

**Node changes required for Staging PDO:** none for storefront. Optional later: tooling scripts that currently call REST. The Next admin static export remains a **deploy packaging** issue, not a PDO issue.

### Production impact

None under this design if PDO is Staging-only behind `APP_ENV=staging`. Production can keep PostgREST until A/B credential work completes.

---

## Proposed target architecture (not implemented)

```
GitHub  staging branch ──► Hostinger Git ──► public_html/staging (PHP/HTML)
                                                      │
                                         staging-secure-config.php (outside web root)
                                                      │
                                         PDO + pdo_pgsql + SSL
                                                      │
                         aws-0-eu-west-1.pooler.supabase.com:5432
                                                      │
                                         staging_login.olmsjkhdfghyydogcvvy
                                                      │
                                              schema staging + RLS
```

Legacy JWT minting for Staging becomes **unnecessary** once PDO path is live. PostgREST can remain available for Production / transitional tools.

---

## Prerequisites before any implementation (approval gates)

1. Enable Staging PHP extensions: `pdo_pgsql` (+ `pgsql` if desired).  
2. Approve SQL to create **LOGIN** role (not converting `staging_user` yet) + grants/policies.  
3. Create Git branch `staging`; decide how Next `admin/` is published.  
4. Wire Hostinger Git: Staging site → `staging` branch; Production site → `main` (separate attach).  
5. Implement Staging PDO repository; feature-flag REST vs PDO.  
6. Isolated connectivity + synthetic order test.  

---

## Explicit non-actions this session

- No Git commit/push  
- No Hostinger deploy or Git attach  
- No role ALTER/CREATE  
- No PHP extension enable  
- No password or JWT printed  
- No Production policy/data changes  

---

*End of assessment.*
