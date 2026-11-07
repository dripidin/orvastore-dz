# Ponytail audit — ORVA STORE

Date: 7 November 2026. One-shot review. No application code was changed for this audit.

**What this repo does:** ORVA STORE is a cash-on-delivery shop for Algeria. Customers order from pack pages; Node (Vercel) and PHP (Hostinger) both expose `/api/send-order` and admin APIs. Orders live in Supabase Postgres. Staff use a Next.js static export under `/admin/` (classic `admin.html` kept as fallback). Stock, idempotency, and some settings still use JSON files on disk.

**Load assumed:** one shop, ad traffic, tens to a few hundred orders per day, a handful of staff in the dashboard. Not multi-tenant, not thousands of concurrent checkouts. Scale notes below are for growth past that, or for Vercel’s multi-instance serverless shape.

---

## Must fix

1. **Server talks to Supabase with the public (anon) key, not a server secret** (`lib/supabaseServer.js:L9-L33`)
   - **What this is:** `getSupabase()` builds the client from `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_ANON_KEY`. There is no use of `SUPABASE_SERVICE_ROLE_KEY`.
   - **Problem:** Admin list/update/delete and checkout insert all act as `anon`. If RLS still allows broad anon `SELECT`/`INSERT` (see `supabase/proposals/2026-11-06-production-anon-order-read-containment.sql`), anyone with the publishable key can read phones and addresses. If RLS is tightened without switching the server to the service role, checkout and the dashboard silently return empty or fail.
   - **Fix:** Create the server client with `SUPABASE_SERVICE_ROLE_KEY` only (never `NEXT_PUBLIC_*`). Keep anon out of server paths. Apply the containment SQL after that switch.
   - **If we skip it:** Customer PII stays one HTTP call away, or the shop breaks the day RLS is hardened.

2. **Idempotency and stock live in local JSON files that Vercel cannot share** (`lib/idempotency-manager.js:L12-L56`, `lib/inventory-manager.js:L13-L105`)
   - **What this is:** Duplicate-order locks and stock reservations write `data/idempotency-records.json` and `data/inventory-state.json` on the local disk.
   - **Problem:** On Vercel each function instance has its own ephemeral disk. Locks do not see each other. Writes do not stick across deploys. Two parallel checkouts of the same SKU can both pass “in stock”. Hostinger PHP may use a different copy of the same files.
   - **Fix:** Move reservations and idempotency to Postgres (unique order id + stock row with `UPDATE … WHERE available >= qty`). One source of truth for Node and PHP.
   - **If we skip it:** Over-sell under parallel ads traffic; “out of stock” that resets after every deploy.

3. **Rate limit fails open and scans every order in memory** (`lib/db.js:L388-L412`)
   - **What this is:** Before accepting a checkout, the code loads all non-deleted orders, then counts matches by phone/device/IP.
   - **Problem:** On any DB error it returns `{ allowed: true }`. A crafted flood still places orders. As order count grows, every checkout pays for a full table read.
   - **Fix:** Store rate limits in a small table keyed by phone hash; on DB error return 503, not allow. Do not load the whole orders list.
   - **If we skip it:** Abuse passes; checkout latency grows with history size.

4. **Order id is spliced into the Supabase filter string** (`lib/db.js:L228`, `L291`)
   - **What this is:** `findOrderById` / updates build `.or(\`order_id.eq.${cleanId},…\`)`.
   - **Problem:** An id containing `,` or filter syntax changes the PostgREST query. PG path uses `$1` (safe). REST path does not.
   - **Fix:** Use `.eq('order_id', cleanId)` (and a second query for tracking), or encode with the PostgREST filter helper. Reject ids outside `[A-Za-z0-9._:-]`.
   - **If we skip it:** Wrong row returned or updated when a tracking code or forged id has special characters.

5. **Production Supabase URL is hardcoded as a fallback** (`lib/supabaseServer.js:L9`)
   - **What this is:** If env vars are missing, the client still points at `https://olmsjkhdfghyydogcvvy.supabase.co`.
   - **Problem:** A misconfigured preview or local run hits the real project. The project ref is also visible in the repo forever.
   - **Fix:** Require `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) and throw if empty. No default host.
   - **If we skip it:** Staging mistakes write or read production.

6. **Postgres failover always writes `public.orders` even when schema is staging** (`lib/db.js:L136-L206`)
   - **What this is:** REST uses `SUPABASE_SCHEMA`. The `pg` fallback SQL hardcodes `public.orders`.
   - **Problem:** A staging app with `DATABASE_URL` set can insert into production `public` when REST fails.
   - **Fix:** Parameterize the schema (quoted identifier from an allowlist: `public` | `staging`) in every SQL string.
   - **If we skip it:** Staging bleed into live orders on the next REST outage.

---

## Should fix

7. **Admin product/catalog saves on Vercel look successful but do not persist** (`api/products-catalog.js` write path, `data/products-catalog.json`)
   - **What this is:** Upsert writes the JSON catalog file on disk after auth.
   - **Problem:** Serverless disk is ephemeral. The UI can show success; the next cold start reloads the old file from the deployment bundle.
   - **Fix:** Persist catalog in Postgres or object storage, or only allow catalog writes on Hostinger. Surface “read-only on this host” in the API.
   - **If we skip it:** Staff think prices changed; customers still see the old price.

8. **Checkout CORS is `*` with credentials enabled** (`api/send-order.js:L28-L29`)
   - **What this is:** Every origin is allowed, and `Access-Control-Allow-Credentials` is true.
   - **Problem:** Browsers may ignore the combination, or other clients treat it as open. It fights the tighter origin lists on admin APIs.
   - **Fix:** Mirror `isTrustedAdminOrigin` / storefront allowlist. Drop `*` .
   - **If we skip it:** Confusing browser errors and a wider attack surface for cookie-bearing tools.

9. **SSL verification is disabled for the Postgres pool** (`lib/supabaseServer.js:L44`)
   - **What this is:** `ssl: { rejectUnauthorized: false }`.
   - **Problem:** A MITM on the DB connection can see order rows and credentials.
   - **Fix:** Use the platform CA (or Supabase’s) and leave verification on.
   - **If we skip it:** Network attackers can read the database connection.

10. **Signed admin sessions are HMAC’d with `ADMIN_API_TOKEN`** (`lib/admin-session-auth.js:L49-L70`)
    - **What this is:** Login cookies are `orva1.exp.nonce.sig` with the API token as the HMAC key.
    - **Problem:** The same secret that opens every Bearer admin call also forges cookies. Token rotation logs everyone out and invalidates automation at once.
    - **Fix:** Separate `ADMIN_SESSION_SECRET`. Keep `ADMIN_API_TOKEN` for machine Bearer only.
    - **If we skip it:** One leaked token forges staff sessions until rotated.

11. **`getAllOrdersFromDb` has no pagination** (`lib/db.js:L182-L216`)
    - **What this is:** Admin “list orders” and analytics pull every non-deleted row.
    - **Problem:** Fine at ~261 orders. At thousands, dashboard and analytics timeouts and memory spikes on serverless.
    - **Fix:** `.range()` / keyset by `created_at`, and aggregate analytics in SQL.
    - **If we skip it:** The panel slows then fails as the shop grows.

12. **Dual Node and PHP APIs for the same jobs** (`api/delivery.js` ~81KB vs `api/delivery.php` ~37KB; same for auth, send-order, settings)
    - **What this is:** Vercel runs `.js`; Hostinger runs `.php`. Rules diverge (wilaya checks, stock, auth).
    - **Problem:** A fix on one host does not land on the other. Past audits already saw PHP wilaya matching weaker than Node.
    - **Fix:** Pick one runtime per environment and delete or generate the other. Until then, one shared contract test that hits both.
    - **If we skip it:** “Works on Vercel, broken on Hostinger” keeps returning.

13. **Almost all phase test scripts are gitignored** (`.gitignore:L27` `scripts/test-*`)
    - **What this is:** `package.json` lists many `test:phase8*` scripts; gitignore hides `scripts/test-*`.
    - **Problem:** CI and new clones cannot run the suite that was meant to protect money and auth paths.
    - **Fix:** Track the tests, or move them under `tests/` and stop ignoring them.
    - **If we skip it:** Regressions ship without a red bar.

14. **Classic admin is duplicated** (`admin.html` and `classic-admin.html`, same size)
    - **What this is:** Two full copies of the classic panel after the Next routing fix.
    - **Problem:** Edits must be done twice or drift.
    - **Fix:** Keep one file; redirect `/classic-admin` to it.
    - **If we skip it:** Drift between “classic” entry points.

---

## Nice to have

15. **Login lockout is per Vercel instance** (`api/auth.js` + `/tmp` shortcut)
    - **What this is:** Failed logins write under `/tmp` (or skip on error). Marked `shortcut:`.
    - **Problem:** Attackers rotate instances and bypass the 5-try lock.
    - **Fix:** Store lockouts in Redis/KV or Postgres when load or abuse appears.
    - **If we skip it:** Brute force is only slowed, not stopped, on serverless.

16. **Large unused trees sit next to the shop** (`antigravity-skills-main/`, `codflow-main/`, `CourierDZ-main/`, etc.)
    - **What this is:** Cloned skill and courier repos in the workspace (many gitignored).
    - **Problem:** Slows search, confuses agents, risks accidental deploys if ignore slips.
    - **Fix:** Keep them outside the shop repo or in a sibling folder.
    - **If we skip it:** Noise only, until one gets committed.

17. **Default product price 4950 is baked into the DB mapper** (`lib/db.js:L24-L25`, `L68`)
    - **What this is:** Missing price fields fall back to Pack defaults.
    - **Problem:** A partial update can rewrite totals to 4950.
    - **Fix:** Refuse save when price is missing; never invent money.
    - **If we skip it:** Rare bad rows with wrong totals.

---

**Verdict:** Ship is alive on Vercel, but the money path still trusts anon Supabase keys and disk JSON for stock/idempotency — fix 1–3 before ads scale.

**Lean:** ~-59KB duplicate classic HTML; large delivery.js/php overlap; possible removal of unused clone trees from the workspace (not all tracked).

**Not checked:** Live Supabase RLS policies (proposals only); Hostinger runtime; full PHP send-order stock rollback path line-by-line vs current Node; Next dashboard source under `orvastore Dashbaord v0.9/` (gitignored); Meta/Telegram live sends; courier live APIs; contents of any password files on disk.
