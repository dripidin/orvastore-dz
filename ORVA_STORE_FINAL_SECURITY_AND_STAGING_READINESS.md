# ORVA STORE — Final Security Remediation & Staging Readiness

**Date:** 2026-11-06  
**Project:** `olmsjkhdfghyydogcvvy`  
**Scope:** Contain Production order-data exposure; harden Staging; prepare safe JWT provisioning.  
**Hard rules observed:** No Production DDL executed. No JWT minted. No secret printed. No Staging claimed operational.

---

## Executive scorecard

| Item | Status |
|------|--------|
| Production anon order-read exposure confirmed | **FAIL** (live) |
| Surgical Production containment SQL prepared | **PASS** (awaiting approval) |
| Hardcoded admin-token RLS on Production | **FAIL** (separate proposal) |
| Staging RLS hardening SQL reviewed | **PASS** (v1 checksum OK; v2 recommended) |
| Staging RLS hardening v2 executed (approval C) | **PASS** (SHA-256 verified; anon USAGE revoked; public untouched) |
| Authenticator `SET` capability | **PASS** (`can_set_staging_role = true`) |
| JWT mint/install script security review | **PASS** (hardened) |
| Staging token provisioned (approval D) | **BLOCKED** — awaiting local secret entry in open dialog |
| Synthetic Staging order persisted | **NOT TESTED** / **BLOCKED** |
| Staging operational | **BLOCKED** |
| Production release ready | **BLOCKED** |

---

## PRIORITY 1 — Production order-data exposure

### Confirmed finding — **FAIL**

Hosted policies on `public.orders` / `public.rate_limits` (read-only inspection; no customer payloads printed):

| Policy | Table | Command | Roles | Effect |
|--------|-------|---------|-------|--------|
| **Allow anon order read** | `public.orders` | **SELECT** | `anon`, `authenticated` | **`USING (true)` — full order list readable with publishable/legacy anon key** |
| Allow anon order insertion | `public.orders` | INSERT | `anon`, `authenticated` | Checkout path (keep for now) |
| Allow admin token order update | `public.orders` | UPDATE | `anon`, `authenticated` | Header `x-admin-token` equals hardcoded string |
| Allow admin token order delete | `public.orders` | DELETE | `anon`, `authenticated` | Same hardcoded header gate |
| Allow anon rate limit select | `public.rate_limits` | SELECT | `anon`, `authenticated` | Rate-limit rows readable |
| Allow anon rate limit insert / check | `public.rate_limits` | INSERT | `anon`, `authenticated` | Keep for now |
| Service role full access … | orders / rate_limits / … | ALL | `service_role` | Intended server path |

Effective privileges: `anon` has table-level SELECT/INSERT/UPDATE on `public.orders` and `public.rate_limits` (RLS still decides row visibility via policies above).

External probe (prior session): default-profile REST `GET /rest/v1/orders?select=order_id&limit=1` with anon → **HTTP 200** with order id present. Treat as confirmed customer-data exposure.

### Checkout dependency

Production `api/send-order.php` → `orva_supabase_rest_request()`:

- If `SUPABASE_SERVICE_ROLE_KEY` is set → Bearer = service_role.
- Else → Bearer = anon/publishable key.

Therefore **anonymous INSERT is still required today** until Production PHP is confirmed using a server credential. **Do not drop INSERT yet.**

Admin dashboard reads (`api/delivery.php`) also go through PHP with the same credential selection. Dropping anon SELECT **will break admin order listing** if Production Hostinger config still lacks service_role.

### Recommended apply order (approval gates)

1. Confirm / install Production server credential in **outside-webroot** `secure-config.php` (`SUPABASE_SERVICE_ROLE_KEY` or narrower server JWT). Never in Git/browser.
2. Verify PHP admin list orders still works.
3. Apply **surgical SELECT containment** (below).
4. Later: migrate INSERT off anon; then drop INSERT policies; rotate credentials; remove admin-token RLS.

### Surgical SQL requiring approval — **NOT EXECUTED**

File: `supabase/proposals/2026-11-06-production-anon-order-read-containment.sql`  
SHA-256: `588F01F485545B51C08C8ABC53EFB18D9DB38D9C5B8DD971D163966BC713BBB3`

```sql
BEGIN;
DROP POLICY IF EXISTS "Allow anon order read" ON public.orders;
DROP POLICY IF EXISTS "Allow anon rate limit select" ON public.rate_limits;
COMMIT;
```

| Impact | Detail |
|--------|--------|
| Stops | Anonymous/authenticated **SELECT** of Production orders and rate_limits |
| Preserves | Anonymous **INSERT** for checkout and rate-limit writes |
| Does not touch | `staging.*`, GRANTs, service_role policies, INSERT policies |
| Risk | Admin PHP order reads fail until server credential is active |
| Rollback | Recreate the two SELECT policies (documented in the SQL file; restores exposure) |

### Additional Production finding (separate approval)

File: `supabase/proposals/2026-11-06-production-admin-token-rls-removal.sql`

Drops:

- `Allow admin token order update`
- `Allow admin token order delete`

These allow `anon`/`authenticated` to mutate/delete Production orders via a hardcoded `x-admin-token` comparison inside RLS. **Not executed.** Apply only after confirming all admin mutations use PHP server auth.

Older broader proposal `2026-11-06-revoke-anon-orders-access.sql` (SHA-256 `0FD53429…`) also drops INSERT — **do not use for the urgent containment**; it is superseded for Priority 1 by the surgical SELECT-only file.

---

## PRIORITY 2 — Staging RLS hardening

### Original file verification

| Check | Result |
|-------|--------|
| Path | `supabase/proposals/2026-11-06-staging-rls-hardening.sql` |
| SHA-256 | `4C3AF068AFE0A31B8F5AFD55658BCA1932807273D0BA9534807B263AE4998E52` — **PASS** |
| All policy targets in `staging` | **PASS** |
| Modifies `public` | **PASS** (none) |
| Drops anon SELECT/INSERT on staging.orders | **PASS** |
| Drops anon rate_limits policy | **PASS** |
| Revokes staging USAGE from anon/authenticated | **FAIL in v1** — still commented optional block |
| Preserves staging_user policies | **PASS** (recreates orders + rate_limits) |

### Live Staging policy debt (still present)

- `anon staging order insertion` / `anon staging order read` on `staging.orders`
- `anon staging rate limits` on `staging.rate_limits`

### Execution (approval C) — **PASS**

Pre-exec SHA-256 verified: `5D1697D8637E4353B2A5531996B3225CEA208E193FC0D1F6949D0A487FD6B593`  
Public-schema references in file: **none**  
Migration name: `staging_rls_hardening_v2` via Supabase MCP `apply_migration`

Post-exec verification:

| Check | Result |
|-------|--------|
| `anon` USAGE on `staging` | **false** |
| `authenticated` USAGE on `staging` | **false** |
| `staging_user` USAGE on `staging` | **true** |
| anon policies on `staging.orders` / `rate_limits` | **removed** |
| Remaining policies on those tables | `staging_user full access …` only |
| Production / `public` policies | **untouched** (A/B not approved) |

---

## PRIORITY 3 — Authenticator SET capability

```sql
SELECT pg_has_role('authenticator', 'staging_user', 'SET') AS can_set_staging_role;
```

**Result:** `can_set_staging_role = true` — **PASS**

No membership changes made.

---

## PRIORITY 4 — JWT procedure security review — **PASS** (not executed)

### Scripts reviewed / hardened

| File | Status |
|------|--------|
| `scripts/mint-staging-user-jwt.js` | Hardened: **process.env.SUPABASE_JWT_SECRET only**; rejects `.env.local`; rejects `JWT_SECRET`; role hardcoded `staging_user`; `iss=supabase`; `iat=now`; TTL capped at **7 days**; never prints JWT/secret |
| `scripts/install-staging-token-remote.js` | Hardened: validates claims before send; Staging host only; writes only `staging-secure-config.php`; unsets service_role; self-deletes endpoint; scrubs local jwt after success; never prints JWT |
| `api/staging-config-status.php` | Boolean-only probe; probe-token gated |
| `api/patch-staging-token.php` | **Absent** until prepare step (good) |

### Approved procedure (awaiting your go) — **DO NOT RUN YET**

1. In a local shell only (never chat, never `.env.local`, never Hostinger):
   - Set `SUPABASE_JWT_SECRET` temporarily via secure prompt (`Read-Host -AsSecureString` / equivalent).
2. `node scripts/mint-staging-user-jwt.js` → writes `data/private/staging-user.jwt` only.
3. Unset `SUPABASE_JWT_SECRET` from the shell.
4. `node scripts/install-staging-token-remote.js` → creates one-shot `api/patch-staging-token.php`.
5. Deploy **that Staging file only** (explicit Staging deploy approval).
6. `node scripts/install-staging-token-remote.js --send`
7. Confirm endpoint self-deleted; local jwt scrubbed.
8. Optional: hit config status probe (booleans only).

**Status:** Provisioning **BLOCKED** pending your approval of this exact procedure (and Staging deploy of the patcher).

---

## PRIORITY 5 — Staging connectivity tests

| Test | Status |
|------|--------|
| Authenticated staging read | **BLOCKED** (no token) |
| Synthetic checkout | **BLOCKED** |
| Row in `staging.orders` | **NOT TESTED** |
| Absent from `public.orders` | **NOT TESTED** |
| Inventory reservation | **NOT TESTED** (post-token) |
| Dashboard visibility | **NOT TESTED** |
| Cancellation / stock release | **NOT TESTED** |
| Telegram admin delivery | **NOT TESTED** |
| 49 historical reservations | **NOT MODIFIED** |

Prerequisites before these tests: approve+execute Staging RLS v2 → JWT procedure → token install.

---

## PRIORITY 6 — Remaining Production release blockers

Ordered checklist (no new features):

1. **Production server credential** in outside-webroot config (service_role or narrower) for PHP admin + later INSERT.
2. **Approve & execute** `2026-11-06-production-anon-order-read-containment.sql` (SELECT containment).
3. **Approve & execute** `2026-11-06-production-admin-token-rls-removal.sql` after confirming PHP-only admin mutations.
4. Move Production INSERT off anon; then drop anon INSERT policies (`orders`, `order_items`, `rate_limits`).
5. Credential rotation (admin password/token, encryption key, Telegram, courier tokens as needed).
6. Yamaha commercial product decision (still archived on Staging).
7. Reconcile 49 historical Pack1 reservations (report-only until approved).
8. Complete Staging synthetic verification (Priority 5).
9. Production backup + Staging→Production release deploy (separate explicit approval).

---

## Approvals requested (reply with exact IDs)

Reply **yes** / **no** per item (no execution without yes):

| ID | Action |
|----|--------|
| **A** | Execute Production SELECT containment SQL (`…anon-order-read-containment.sql`) — only after server credential confirmed for admin reads |
| **B** | Execute Production admin-token RLS removal (`…admin-token-rls-removal.sql`) |
| **C** | Execute Staging RLS hardening **v2** (`…staging-rls-hardening-v2.sql`) |
| **D** | Approve JWT mint + Staging token install procedure (Priority 4 steps 1–7) |

---

*End of consolidated readiness report. Staging is not operational until a persisted synthetic order is verified.*
