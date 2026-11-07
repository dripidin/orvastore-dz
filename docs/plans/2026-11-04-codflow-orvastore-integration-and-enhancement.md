# CodFlow -> OrvaStore Integration & Project Enhancement Master Plan

**Date:** 2026-11-04
**Status:** Proposed (no implementation yet)
**Scope owner:** OrvaStore dashboard (`orvastore Dashbaord v0.9/next-shadcn-admin-dashboard-baseui-main`)
**Source system:** CodFlow (`codflow-main`)
**Goal:** Reuse CodFlow's backend features/services inside the OrvaStore dashboard without corrupting either codebase, then improve the dashboard's source, functions, and optional features through coordinated multi-agent execution.

---

## 0. How to read this document

- **Part I (§1-§10)** is the CodFlow -> OrvaStore integration plan.
- **Part II (§11-§12)** is the multi-agent enhancement plan for the project source, functions, and optional features.
- **§13-§15** hold the risk register, open decisions, and the first three PRs.
- Every phase is additive, flag-gated, and reversible. No phase requires a CodFlow database migration.

**Hard rule:** Do not start Phase 1 until Phase 0 is deployed and verified on the target host.

---

# Part I - CodFlow -> OrvaStore Integration

## 1. Verified baseline

### 1.1 OrvaStore dashboard reality (important)

| Fact | Evidence |
|---|---|
| The dashboard is a **static Next.js export**, not a server app. | `next.config.mjs` -> `output: "export"`, `distDir: "out"` |
| It is synced into `admin/` and `dist-hostinger/admin/`. | `scripts/sync-admin.js` |
| It is served by Hostinger/LiteSpeed with `.htaccess` rewrites. | root `.htaccess` maps `/dashboard/*` to `admin/dashboard/*/index.html` |
| There is no Next.js server, middleware, or API route at runtime. | static export; `src/server/server-actions.ts` only touches `document`/cookies |
| Login is a password gate against `/api/auth` (PHP). | `src/app/(main)/dashboard/_components/admin-session-gate.tsx` |
| Orders already flow through one repository seam. | `src/lib/repository/orders-repository-factory.ts` -> `ApiOrdersRepository` -> `/api/delivery` |
| Products, store pages, layout, and traffic analytics use mock/local repositories. | `src/lib/repository/mock-*.ts`, `src/lib/analytics/mock-*.ts` |
| The "classic admin" (`admin.html` / `admin.js`) still uses the legacy PHP API. | root `admin.*`, `api/delivery.php`, `api/auth.php` |
| Types are duplicated between `src/lib/orva-api.ts` and `src/lib/repository/types.ts`. | both declare `OrvaOrder` |

Consequence: **there is no place in the dashboard to safely hold a CodFlow API key or a server-side session.** Any direct browser-to-CodFlow call must use a short-lived JWT and CORS; any API-key call must go through a server-side bridge.

### 1.2 CodFlow reality

| Fact | Evidence |
|---|---|
| Cloudflare Worker API built with Hono. | `codflow-main/cod-server/src/index.ts` |
| Merchant API is mounted at `/api/*` behind `authMiddleware`. | `app.use("/api/*", authMiddleware)` |
| `authMiddleware` accepts `Authorization: Bearer <JWT>` **or** `X-API-Key: <key>`. | `cod-server/src/middleware/auth.ts` |
| JWTs are Better Auth 1.7 Ed25519 tokens verified against JWKS. | `cod-server/src/lib/session-auth.ts` |
| API keys map to a `users.apiKey` row; scopes come from `user_scopes` or `*` for admins. | `auth.ts`, `cod-shared/rbac/scopes.ts` |
| The merchant API is effectively **single-store** (orders have no `store_id`; reviews/store pages do). | `cod-shared/db/schema.ts` |
| Public storefront API is `/store/*` with `X-Store-API-Key`. | `cod-server/src/middleware/storeAuth.ts` |
| CORS is origin-whitelisted in production via `ALLOWED_ORIGINS`. | `cod-server/src/middleware/cors.ts` |
| Responses are `{ success, data, ... }`, with `{ error, code, category }` on failure. | handlers, e.g. `orders/handlers.ts` |
| Order statuses are a fixed 11-state machine. | `orders/validation.ts`, `status-transitions.ts` |
| `DELETE /api/orders/{id}` is a **hard delete** (no soft-delete). | `orders/handlers.ts` |
| Product images live in R2; upload via `/api/images/upload` or presign. | `images/routes.ts`, `product_images` |
| **Not deployed yet** (as of 2026-11-06); Phase 0 targets local `wrangler dev`, production via env only. | User decision recorded in §16.1 |
| PHP consumes `multipart/form-data`, so the bridge cannot transparently proxy `/api/images/upload`. Use `/api/images/presign` + direct R2 `PUT`. | `api/codflow.php` |
| Activity logs support an `entityType=order` filter (no `entityId` filter; order-scoped filtering is client-side). | `activity-logs/routes.ts` |

### 1.3 Capability gaps that must stay OrvaStore-owned (for now)

| OrvaStore capability | CodFlow today | Decision |
|---|---|---|
| First-party visitor/traffic analytics | No visitor-session model | Keep OrvaStore local analytics; do not fake it |
| Invoice layout/printing | No invoice endpoint | Derive invoice from `GET /api/orders/{id}` |
| Product-page HTML generator | Landing pages exist, generator does not | Keep generator local; persist assets/metadata in CodFlow |
| "Switch order" workflow | No first-class concept | Compose `PATCH /orders/{id}` + `POST /orders/{id}/add-remark` |
| Soft-deleted orders | Hard delete only | Disable delete; use `status=cancelled` |
| Per-product/per-wilaya demand analytics | Only `/api/analytics/dashboard-stats` | Compute from orders in Phase 1; add additive endpoint only if needed |
| Multi-store merchant isolation | Orders are not store-scoped | Assume one brand per CodFlow deployment |

---

## 2. The "no corruption" contract

Every phase must satisfy all of these:

1. **CodFlow source is untouched.** `git status --porcelain codflow-main` must be empty after each phase. Any CodFlow change is a separate, explicitly approved, additive PR.
2. **No CodFlow schema change.** No new columns, no enum changes, no migrations.
3. **Legacy OrvaStore endpoints stay live.** `/api/auth.php` and `/api/delivery.php` continue to serve `admin.html`/`admin.js` and any unflagged page.
4. **One writer per domain.** No dual writes. A domain is either legacy-owned or CodFlow-owned, never both.
5. **All new code is namespaced.** Dashboard: `src/lib/codflow/**`. Server: `api/codflow.php`. No edits scattered through legacy files.
6. **No secret ever reaches the browser.** The static bundle must not contain `CODFLOW_API_KEY`; the bridge holds it server-side.
7. **Every phase is reversible without data recovery.** Rollback is a flag or a rewrite removal, because no data is migrated.
8. **Contracts are pinned by fixtures.** Mappers are tested against captured, sanitized CodFlow responses before UI wiring.
9. **Diff scope is reviewable.** Each PR lists its exact files; unrelated dirty files in the repo are not staged or reformatted.
10. **The static build stays green.** `npm run build` and `node scripts/sync-admin.js` must pass before deployment.

---

## 3. Target architecture

```text
+---------------------------------------------------------------+
| Browser: admin.orva-store.com (or /dashboard on Hostinger)    |
|                                                               |
|  React screens                                                |
|      |                                                        |
|      v                                                        |
|  src/lib/codflow/repositories/*   (domain adapters)           |
|      |                                                        |
|      v                                                        |
|  src/lib/codflow/client.ts        (single fetch seam)          |
|      |  same-origin fetch /api/codflow?path=/api/...          |
+------|--------------------------------------------------------+
       |
       v
+---------------------------------------------------------------+
| Hostinger LiteSpeed + PHP 8.3                                 |
|                                                               |
|  /api/auth.php       (unchanged, legacy session)              |
|  /api/delivery.php   (unchanged, legacy fallback)             |
|  /api/codflow.php    (NEW: authenticated reverse proxy)       |
|      |                                                        |
|      |  HTTPS + X-API-Key (server-side only, never exposed)   |
+------|--------------------------------------------------------+
       |
       v
+---------------------------------------------------------------+
| Cloudflare cod-server (/api/*)                                |
|                                                               |
|  Hono routes -> D1 (source of truth)                          |
|              -> R2 (product/landing images)                    |
|              -> KV (platform state)                            |
|                                                               |
|  Better Auth JWKS is only needed for the optional JWT cutover |
+---------------------------------------------------------------+
```

**Key property:** the browser only ever talks to its own origin. CORS, cookie domains, and JWT audience issues disappear in the default path.

---

## 4. Auth and security decision

### 4.1 Options

| Option | How it works | CodFlow changes | Dashboard changes | Main risk | Verdict |
|---|---|---|---|---|---|
| **A. Direct JWT** | Dashboard logs into Better Auth, caches `set-auth-jwt`, sends `Authorization: Bearer` to CodFlow | `ALLOWED_ORIGINS`, `trustedOrigins` | Real login UI, token refresh, CORS | Third-party cookies, audience/issuer mismatch, token in memory/XSS | Strategic, later |
| **B. PHP bridge + API key** | Browser calls `/api/codflow`; PHP verifies the existing admin session, then calls CodFlow with `X-API-Key` | None | Only a new client adapter | Bridge becomes a privileged proxy; must be tightly scoped | **Recommended now** |
| **C. Cookie passthrough** | Browser sends CodFlow cookies cross-origin | Cookie domain + SameSite changes | CORS + credentials | Browser third-party cookie blocking | Reject |
| **D. Embed CodFlow dashboard** | iframe or copy Astro UI | None | Large rewrite | Two design systems, auth duplication | Reject |

### 4.2 Recommended: Option B (bridge)

- Create a **dedicated CodFlow user** named `orvastore-dashboard` with role `staff`.
- Grant only the scopes each phase needs (least privilege).
- Rotate its API key once, capture the raw key, store it only in Hostinger environment variables.
- The bridge accepts the existing `orva_admin_session` cookie **or** a `Bearer` `ADMIN_API_TOKEN` header, using `hash_equals` (same model as `api/delivery.php`).
- The bridge never forwards cookies or the browser's `Authorization` header.
- The bridge sets `X-API-Key` server-side and strips it from any response.
- Rotate the key every 90 days; the bridge reads the new value from env without a dashboard rebuild.

### 4.3 Scope grant by phase

| Phase | Scopes |
|---|---|
| 0 (health only) | `dashboard:view` (probed via `GET /api/analytics/dashboard-stats`) |
| 1 (orders read) | `orders:read`, `delivery:read`, `customers:read` |
| 2 (orders write) | `orders:update`, `orders:assign`, `delivery:assign`, `delivery:dispatch` |
| 3 (products) | `products:read`, `products:manage`, `stock:read`, `stock:manage`, `product_groups:read`, `product_groups:manage` |
| 4 (customers/delivery) | `customers:create`, `customers:update`, `customer_groups:*`, `customer_tags:*`, `delivery:create`, `delivery:update`, `delivery:manage` |
| 5 (store content) | `settings:view`, `settings:integrations`, `store_pages:*`, `landing_pages:*`, `reviews:*`, `offers:*`, `abandoned_orders:*`, `checkout_form:*`, `whatsapp_widget:*` |
| 6 (analytics/optional) | `dashboard:view`, `reports` not available; reuse read scopes |

### 4.4 Bridge security requirements (`api/codflow.php`)

1. `define('ORVA_API', true); require config.php;` like the other endpoints.
2. Enforce `orva_admin_session` with `hash_equals` against `ADMIN_API_TOKEN` (same model as `api/delivery.php`).
3. Accept only `path` values matching an allowlist regex:
   `^/api/(orders|products|product-groups|customers|customer-groups|customer-tags|drivers|wilayas|delivery-companies|shipping-profiles|driver-payments|stores|reviews|offers|stock|analytics|activity-logs|abandoned-orders|store-pages|landing-pages|checkout-form|whatsapp-widget|images|users)(/|$)`
4. Reject `..`, absolute URLs, encoded slashes, and non-`/api/` paths.
5. Forward only `GET`, `POST`, `PATCH`, `PUT`, `DELETE`.
6. Do **not** forward `multipart/form-data`. PHP consumes multipart into `$_POST`/`$_FILES`, so `php://input` is empty and a transparent proxy would silently corrupt uploads. Return `501 MULTIPART_NOT_SUPPORTED` and direct clients to `POST /api/images/presign` + a direct browser `PUT` to R2. Only JSON and form-urlencoded bodies are proxied.
7. Timeout: 5s connect, 20s total (clamped 1-60s); `CURLOPT_FOLLOWLOCATION = false`; TLS verification on.
8. Return upstream status and `Content-Type: application/json`; never leak upstream headers.
9. **Redact** known secret fields before returning settings payloads:
   `apiToken`, `apiUserGuid`, `webhookSecret`, `keyHash`, `secret`, `password`, `smtpPassword`, `otpApiKey`, `turnstileSecret`, `emailApiKey`.
   Prefer blocking write endpoints that return secrets at all.
10. Add `X-Orva-Request-Id` (UUID) to logs and responses; log method, path, status, latency, and upstream `Cf-Ray`. Never log request bodies containing phone/address.
11. Per-session rate limit (e.g. 120 requests/minute) using APCu with a locked file fallback.
12. `/__health` and `/__flags` are handled locally and never forwarded. The optional upstream probe uses `GET /api/analytics/dashboard-stats` (`dashboard:view`) — **not** `GET /api/stores/me`, which requires `auth: "admin"` and would 403 a least-privilege `staff` key.

### 4.5 Runtime feature flags (critical for a static build)

`NEXT_PUBLIC_*` values are baked at build time. To allow **rollback without rebuilding**, the bridge exposes server-controlled flags:

```text
GET /api/codflow?path=/__flags
-> { "success": true, "data": { "orders": "read", "products": "off", "customers": "off", "delivery": "off", "store": "off", "auth": "bridge" } }
```

Server env:

```text
CODFLOW_FLAGS=orders:read,products:off,customers:off,delivery:off,store:off,auth:bridge
```

The client caches flags for 60 seconds. Default when unavailable is `off` (legacy path). This is the primary rollback lever.

---

## 5. Domain ownership matrix

| Domain | Current owner | Target owner | Flag key | Phase | Rollback |
|---|---|---|---|---|---|
| Orders | Legacy `/api/delivery` | CodFlow | `orders` | 1-2 | `orders:off` |
| Products/inventory | Mock/localStorage | CodFlow | `products` | 3 | `products:off` |
| Product images | IndexedDB | CodFlow R2 | `products` | 3 | `products:off` |
| Customers/CRM | Derived from orders | CodFlow | `customers` | 4 | `customers:off` |
| Delivery config (companies, drivers, profiles) | Mock/legacy | CodFlow | `delivery` | 4 | `delivery:off` |
| Store pages/legal | Mock/localStorage | CodFlow | `store` | 5 | `store:off` |
| Landing pages/offers/reviews | Local/mock | CodFlow | `store` | 5 | `store:off` |
| Store settings/config | PHP settings | CodFlow | `store` | 5 | `store:off` |
| Traffic analytics | OrvaStore local | OrvaStore local | n/a | 6 | n/a |
| Invoices | OrvaStore derived | OrvaStore derived | n/a | 6 | n/a |
| Product page HTML | OrvaStore generator | Hybrid (generator + CodFlow assets) | `store` | 5 | `store:off` |
| Classic admin | Legacy PHP | Legacy PHP | n/a | never | n/a |

---

## 6. Contract mapping

### 6.1 Orders

| OrvaStore field | CodFlow source | Rule |
|---|---|---|
| `id` | `order.id` | direct |
| `number` (new) | `order.orderNumber` | display only |
| `createdAt` | `order.createdAt` | ISO-8601 |
| `customer` | `order.customerName` | direct |
| `phone` | `order.phone` | direct |
| `wilaya` | `order.wilayaName` or resolve `wilayaId` via `/api/wilayas` | cache lookup |
| `commune` | `order.communeName` or resolve `communeId` | cache lookup |
| `deliveryType` | `order.deliveryType` (`home` / `stop_desk`) | translate to Arabic labels only in UI |
| `priceDzd` | `order.price` | product subtotal, excludes delivery |
| `shippingDzd` | `order.deliveryFee` | direct |
| `grandTotalDzd` | `order.codAmount` | **authoritative**; fallback `price + deliveryFee` only if null |
| `quantity` | sum of `order.orderProducts[].quantity` | detail payload |
| `productName` | first line's `productName` + `" +N"` | detail payload |
| `inRedex` | company code `redex` or `trackingNumber` present | never inferred from status |
| `redexTrackingCode` | `order.trackingNumber` | direct |
| `remarks` | `/api/orders/{id}/remarks` | detail only; list uses `notes` |
| `conversions` | remarks with `event: "ORDER_CONVERSION"` | preserved convention |
| `raw` | original CodFlow object | debug only, never rendered |

**Money invariants**

- All DZD amounts are integers.
- Never parse `grandTotal` from a formatted string; that legacy behavior stays inside the legacy adapter.
- `codAmount` is the only cash-on-delivery authority.
- Never recompute totals with floating-point addition after mapping.

### 6.2 Status vocabulary

Canonical internal vocabulary becomes CodFlow's 11 states. The legacy adapter maps old values into it.

| CodFlow | Arabic label | Legacy alias |
|---|---|---|
| `new` | جديد | `pending` |
| `confirmed` | مؤكد | `confirmed` |
| `unreachable` | غير متوفر | `pending` (no exact legacy equivalent) |
| `preparing` | قيد التحضير | `confirmed` |
| `ready` | جاهز | `confirmed` |
| `assigned` | موزّع | `shipped` |
| `dispatched` | تم الإرسال | `shipped` |
| `out_for_delivery` | قيد التوصيل | `shipped` |
| `delivered` | تم التسليم | `delivered` |
| `returned` | مرتجع | `returned` |
| `cancelled` | ملغي | `cancelled` |
| — | — | `deleted` (legacy only; CodFlow hard-deletes) |

Rules:

- `src/lib/repository/types.ts` `OrderStatus` is widened to the 11 CodFlow states + `deleted`.
- A `legacyStatus` derived field keeps old KPI math and old saved filters working.
- Status chips, filters, and KPI calculators are updated once in Phase 1; they then work for both adapters.
- The UI never invents a status. Unknown values fall back to `new` with a visible warning.

### 6.3 Products

| OrvaStore | CodFlow | Rule |
|---|---|---|
| `title` | `name` | direct |
| `subtitle` | — | local overlay; CodFlow has no subtitle |
| `description` | `description` + `descriptionFormat` | render HTML only when format is `html` |
| `images` | `/api/products/{id}/images` or `product.images` | R2 URLs |
| `sellingPrice` | `price` | integer DZD |
| `purchaseCost` | `costPrice` | admin-only; never send to public storefront |
| `marketingCostPerOrder` | — | local overlay, default 0 |
| `stockQuantity` | `inventory` (simple) or sum of variant `inventory` | variant-aware |
| `lowStockThreshold` | `lowStockThreshold` | variant-aware |
| `status` | `DRAFT` / `ACTIVE` / `ARCHIVED` | map to `draft` / `active` / `archived` |
| `sku` | `sku` (simple) or variant `sku` | first/representative |
| `createdAt` / `updatedAt` | same | ISO |

Variants: `product_variants.variations` is JSON (`{"Color":"Red","Size":"M"}`); render `variantLabel` by joining values in key order.

### 6.4 Customers

| OrvaStore | CodFlow |
|---|---|
| name | `name` |
| phone | `phone` |
| wilaya | `wilaya` / `wilayaId` |
| commune | `commune` / `communeId` |
| total orders | `totalOrders` |
| total spent | `totalSpent` |
| last order | `lastOrderAt` |

Dedupe rule: search `GET /api/customers?search=<phone>` before create. CodFlow does not enforce a unique phone, so the adapter must prevent duplicates at the seam.

### 6.5 Delivery

| OrvaStore | CodFlow |
|---|---|
| courier catalog | `GET /api/delivery-companies` (`code`, `name`, capabilities) |
| driver list | `GET /api/drivers` |
| tracking timeline | `GET /api/orders/{id}/tracking-events` |
| dispatch | `POST /api/orders/{id}/dispatch` |
| shipping fees | `GET /api/shipping-profiles` + rules |
| driver payments | `GET /api/driver-payments/{driverId}/pending`, `POST /api/driver-payments` |

`src/lib/couriers/courier-catalog.ts` stays the UI catalog, but IDs must resolve to CodFlow company IDs by `code` (`redex`, `ecotrack`, `yalidine`, `zr_express`, ...). Do not hardcode UUIDs.

### 6.6 Store content and settings

| OrvaStore screen | CodFlow endpoints |
|---|---|
| Store identity/branding | `GET/PATCH /api/stores/me` |
| Pixel config | `GET/POST /api/stores/pixel-config` |
| OTP config | `GET/POST /api/stores/otp-config`, `POST /test` |
| Turnstile config | `GET/POST /api/stores/turnstile-config` |
| Email config | `GET/POST /api/stores/email-config`, `POST /test` |
| Checkout form | `GET/PUT /api/checkout-form` |
| WhatsApp widget | `GET/PUT /api/whatsapp-widget` |
| Store pages/legal | `GET/POST/PATCH/DELETE /api/store-pages`, `PUT /legal-profile`, `POST /seed-defaults`, translations |
| Landing pages | `/api/landing-pages` CRUD, publish/unpublish/archive, images, tracking |
| Reviews | `GET /api/reviews`, `PATCH /{id}`, `DELETE /{id}` |
| Offers | `/api/offers` CRUD |

**Secret rule:** settings responses may contain provider tokens. The bridge must redact or block them; the UI shows only "configured / not configured" and a masked last-4 where CodFlow already supports it.

### 6.7 Analytics

- KPI cards: `GET /api/analytics/dashboard-stats`.
- Revenue/AOV/return rate: computed from order pages in Phase 1.
- Wilaya demand: reuse `src/lib/analytics/wilaya-demand-calculator.ts` against CodFlow orders.
- Traffic/session analytics: remains OrvaStore first-party local data. Do not present it as CodFlow data.
- If order volume makes client-side aggregation too slow, add **one additive** CodFlow endpoint in Phase 6 (`GET /api/analytics/wilaya-demand`) behind a separate PR.

---

## 7. Phase 0 - Bridge and guardrails

**Goal:** a safe, authenticated, observable pipe to CodFlow. No UI changes.

### New files

| File | Purpose |
|---|---|
| `api/codflow.php` | Authenticated reverse proxy, allowlist, redaction, health/flags |
| `src/lib/codflow/config.ts` | Endpoint constants, timeouts, flag keys |
| `src/lib/codflow/flags.ts` | Runtime flag cache + safe defaults |
| `src/lib/codflow/errors.ts` | `CodflowApiError`, status/code mapping |
| `src/lib/codflow/client.ts` | Single fetch seam, envelope parsing, timeout, request id |
| `src/lib/codflow/types.ts` | DTOs for orders/products/customers/delivery/store |
| `scripts/audit-codflow-bridge.js` | Node 18+ audit script (no new deps) |

### Modified files

| File | Change |
|---|---|
| `.htaccess` | Add `RewriteRule ^api/codflow/?$ api/codflow.php [L,QSA]` before generic rules |
| `.env.example` | Add `CODFLOW_API_URL`, `CODFLOW_API_KEY`, `CODFLOW_TIMEOUT_MS`, `CODFLOW_FLAGS`, `CODFLOW_ALLOW_INSECURE_LOCAL`, `NEXT_PUBLIC_CODFLOW_BRIDGE_PATH` |
| `api/config.php` | Read CodFlow env values (no hardcoded secrets) |

### Tasks

1. Create the CodFlow service user and grant `dashboard:view` + `orders:read` only.
2. Implement the bridge with the §4.4 controls.
3. Implement `/__health` (checks env presence and returns latency of an optional `GET /api/analytics/dashboard-stats` probe) and `/__flags`.
4. Implement the client wrapper and error taxonomy.
5. Add the audit script:
   - no session -> 401
   - bad path -> 400/403
   - unsupported method -> 405
   - valid path -> 200 (or the documented 503/502 while CodFlow is undeployed)
   - secret fields absent from settings responses
   - no `CODFLOW_API_KEY` in `out/`
6. Document the bridge env in `docs/`.

### Implementation status (2026-11-06)

PR 1 is implemented and audit-green:

- `node scripts/audit-codflow-bridge.js` -> 25 static checks pass.
- `node scripts/audit-codflow-bridge.js --url=http://127.0.0.1:8099 --token=test-token --bridge-path=/api/codflow.php` -> **34 passed, 0 skipped, 0 failed**.
- `php -l api/codflow.php` and `php -l api/config.php` pass.
- Scoped `tsc --noEmit --strict` and `biome check src/lib/codflow` pass.
- CodFlow is **not deployed yet**; Phase 0 is validated against `php -S` with `CODFLOW_NOT_CONFIGURED` (503), which is the documented state. Production config is env-only.

### Acceptance

- `curl` with a valid `orva_admin_session` (or Bearer token) returns CodFlow data through `/api/codflow`.
- `codflow-main` `git status --porcelain` shows only `?? codflow-main/` (vendored copy, untouched by this PR).
- `npm run build` succeeds.
- No secret string appears in the exported bundle.
- Classic `admin.html` still works unchanged.
- Rollback works without rebuilding the static dashboard: set the domain flag to `off` and purge LiteSpeed cache.

### Rollback

Remove the `.htaccess` line and `api/codflow.php`. Nothing else references it yet.

---

## 8. Phase 1 - Orders read-only

**Goal:** the dashboard reads real CodFlow orders without changing any write behavior.

### New files

| File | Purpose |
|---|---|
| `src/lib/codflow/mappers/status.ts` | Canonical status map + legacy aliases |
| `src/lib/codflow/mappers/money.ts` | Integer DZD invariants |
| `src/lib/codflow/mappers/orders.ts` | CodFlow order -> `OrvaOrder` |
| `src/lib/codflow/repositories/codflow-orders-repository.ts` | Read methods; writes throw `COD_FLOW_READ_ONLY` |
| `src/lib/codflow/repositories/routing-orders-repository.ts` | Delegates per call to legacy or CodFlow based on flags |
| `src/lib/codflow/__fixtures__/orders-*.json` | Sanitized contract fixtures |
| `scripts/audit-codflow-orders.js` | Mapper + routing audit |

### Modified files

| File | Change |
|---|---|
| `src/lib/repository/orders-repository-factory.ts` | Return `RoutingOrdersRepository` |
| `src/lib/repository/types.ts` | Widen `OrderStatus`; add `number`, `legacyStatus`, `sourceStatus` |
| `src/lib/delivery/delivery-metrics-calculator.ts` | Canonical status buckets |
| `src/lib/delivery/courier-status-mapper.ts` | Add CodFlow tracking-event mapping |
| `src/lib/delivery/use-delivery-tracking.ts` | Use CodFlow adapter when `delivery:read` |
| `src/lib/repository/api-orders-repository.ts` | Map legacy status -> canonical at the boundary |
| `src/app/(main)/dashboard/ecommerce/_components/recent-orders-table/columns.tsx` | Status labels/colors |
| `src/app/(main)/dashboard/ecommerce/_components/recent-orders-table/schema.ts` | New fields |
| `src/app/(main)/dashboard/ecommerce/_components/*` | Consume canonical status; no direct API |
| `src/app/(main)/dashboard/customers-delivery/_components/delivery-filters.tsx` | Canonical status filter |

### Adapter behavior

- `getOrders()`: paginate `GET /api/orders?limit=100&offset=...` until fewer than 100 rows, hard cap 50 pages (5,000 orders). Log a warning when the cap is hit.
- `getOrderById()`: `GET /api/orders/{id}` for line items/remarks; fall back to the list cache.
- `getAuditLogs()`: `GET /api/activity-logs?entityType=order&limit=100`, then filter the returned entries by order ID client-side (no `entityId` query exists).
- Write methods throw a typed `CodflowReadOnlyError` until Phase 2.

### Acceptance

- With `orders:read`, the ecommerce and customers-delivery screens render CodFlow orders.
- With `orders:off`, behavior is byte-for-byte the legacy experience.
- Order count/status distribution matches CodFlow for the same query.
- No write request is issued (network audit).
- 401/403 from CodFlow produce a clear Arabic message and do not blank the page.
- Mapper tests pass on fixtures incl. nulls, 101+ orders, Arabic names, and missing product lines.

### Rollback

`CODFLOW_FLAGS=orders:off` + purge LiteSpeed cache. No rebuild.

---

## 9. Phase 2 - Orders write operations

**Goal:** status changes, bulk updates, dispatch, and the OrvaStore "switch order" flow.

### Files

| File | Change |
|---|---|
| `src/lib/codflow/repositories/codflow-orders-repository.ts` | Implement writes |
| `src/lib/codflow/mappers/orders.ts` | Add request builders |
| `src/lib/codflow/idempotency.ts` | Client-side operation guard |
| `src/app/(main)/dashboard/ecommerce/_components/order-push-dialog.tsx` | Map courier -> company ID |
| `src/app/(main)/dashboard/ecommerce/_components/order-switch-dialog.tsx` | Compose PATCH + remark |
| `src/app/(main)/dashboard/ecommerce/_components/order-details-drawer.tsx` | Cancel instead of delete |
| `scripts/audit-codflow-orders-write.js` | Transition/idempotency audit |

### Operation mapping

| OrvaStore operation | CodFlow call | Notes |
|---|---|---|
| `updateOrderStatus` | `PATCH /api/orders/{id}/status` | Show CodFlow's `INVALID_STATUS_TRANSITION` verbatim |
| `bulkUpdateStatus` | Sequential `PATCH` per order | Preserve partial success; never hide failures |
| `switchOrder` | `PATCH /api/orders/{id}` then `POST /api/orders/{id}/add-remark` | Remark body carries `event: "ORDER_CONVERSION"` |
| `pushOrder` | `POST /api/orders/{id}/dispatch` with resolved `companyId` | Refuse if `trackingNumber` or `externalOrderId` already present |
| `deleteOrder` | `PATCH status=cancelled` | Hard delete is disabled in the UI |

### Safeguards

- Before dispatch: reload the order; if tracking exists, show "already dispatched".
- All mutating buttons disable while in flight; a second click must not send a second request.
- A local `pendingOps` map (memory + `sessionStorage`) prevents duplicate operations across tabs for 60 seconds.
- Every write refreshes the affected order, not the whole list.
- Errors are surfaced with CodFlow's `code` and `category`; no generic "failed".

### Acceptance

- Invalid transitions are rejected with CodFlow's message; no local status is invented.
- Dispatch twice returns a clear duplicate guard, not a second shipment.
- Switch preserves the conversion record and remains visible in the timeline.
- Activity log shows the CodFlow user.

### Rollback

`orders:read` (keeps reads, disables writes) or `orders:off`.

---

## 10. Phases 3-7

### Phase 3 - Products and inventory

**New:** `codflow-products-repository.ts`, `mappers/products.ts`, `repositories/codflow-stock-repository.ts`, `scripts/audit-codflow-products.js`.

**Modified:** `src/app/(main)/dashboard/products/page.tsx`, `products/demand/page.tsx`, `products/designer/page.tsx`, `src/lib/product-image-db.ts` (draft cache only), `src/lib/repository/product-types.ts` (add `codflowId`, `variantCount`), `src/lib/settings/integrations-registry.ts`.

**Work:**

- CRUD via `/api/products`, variants via `/api/products/{id}/variants`.
- Images via `/api/products/{id}/images` + `/api/images/upload`; IndexedDB only for unsaved drafts.
- The bridge must stream multipart uploads (no JSON re-encode) and the host must allow `upload_max_filesize` / `post_max_size` large enough for product photos.
- Stock via `/api/stock/overview`, `/alerts`, `/products/{id}/stock/adjust`, `/history`.
- Categories/product groups via `/api/product-groups`.
- Keep `purchaseCost`/`marketingCostPerOrder` admin-only; never send to the storefront.

**Acceptance:** create/edit/archive round-trip; stock adjustments produce history; images survive a different browser; no cost field leaves the admin surface.

**Rollback:** `products:off`.

### Phase 4 - Customers, CRM, delivery configuration

**New:** `codflow-customers-repository.ts`, `codflow-delivery-repository.ts`, `mappers/customers.ts`, `mappers/delivery.ts`, `scripts/audit-codflow-customers.js`.

**Modified:** `customers-delivery/page.tsx` and its `_components/*`, `logistics/page.tsx` and its `_components/*`, `src/lib/delivery/mock-courier-adapter.ts` (keep for demo only).

**Work:**

- Customers CRUD + groups/tags + order history.
- Delivery companies, drivers, shipping profiles, stop desks, driver payments.
- Phone validation `^0[5-7]\d{8}$` at the adapter boundary.
- Tracking timeline from CodFlow; never mutate internal status on sync.

**Acceptance:** no duplicate customer for the same phone; driver payments reconcile; shipping fee rules resolve by wilaya/commune.

**Rollback:** `customers:off` / `delivery:off`.

### Phase 5 - Store content and settings

**New:** `codflow-store-repository.ts`, `codflow-content-repository.ts`, `mappers/store.ts`, `scripts/audit-codflow-store.js`.

**Modified:** `settings/page.tsx`, `settings/settings-integrations.tsx`, `products/pages/page.tsx`, `products/designer/page.tsx`, `src/lib/settings/integrations-registry.ts`.

**Work:**

- Store identity/branding, pixel/OTP/Turnstile/email config, checkout form, WhatsApp widget.
- Store pages + legal profile + translations; landing pages + offers + reviews + abandoned orders.
- Replace hardcoded integration statuses with real probes where safe; mark CodFlow-managed items explicitly.
- Redact secrets in the bridge; UI only shows configured/not configured.

**Acceptance:** settings round-trip; no secret appears in the DOM or bundle; publishing a store page is reflected in CodFlow.

**Rollback:** `store:off`.

### Phase 6 - Analytics, invoices, optional features

**New:** `src/lib/codflow/analytics/` calculators, `src/lib/invoice/codflow-invoice.ts`, `scripts/audit-codflow-analytics.js`.

**Work:**

- KPI from `dashboard-stats` + order pages.
- Invoice derived from order detail; print CSS only, no server.
- Traffic analytics stays local; label it "First-party OrvaStore data".
- Optional: reviews moderation, offers, abandoned orders, bulk dispatch, label printing.
- Only if needed: one additive CodFlow endpoint for wilaya/product demand, separate PR.

**Acceptance:** KPI totals match a scripted reconciliation; invoice totals equal `codAmount`; traffic page never claims CodFlow attribution.

**Rollback:** flags per domain, or revert the new screens.

### Phase 7 - Optional auth cutover (strategic)

**Preconditions:** dashboard and CodFlow API on the same site (e.g. `admin.example.com` + `api.example.com`), or a deliberate cross-site cookie policy.

**Work:**

- Add `trustedOrigins` and `ALLOWED_ORIGINS`.
- Replace the bridge with direct JWT (`set-auth-jwt` -> `Authorization: Bearer`).
- Add token refresh once on 401.
- Map CodFlow scopes to UI visibility.
- Keep the bridge as a fallback flag (`auth:bridge|jwt`).

**Acceptance:** login/logout/session refresh; no token in `localStorage`; 401 refresh works once; RBAC hides forbidden actions.

**Rollback:** `auth:bridge`.

---

## 11. Testing and verification

### 11.1 Test layers

| Layer | Tool | What it proves |
|---|---|---|
| Bridge contract | `scripts/audit-codflow-bridge.js` (Node 24, `fetch`) | auth, allowlist, redaction, timeout, error passthrough |
| Mappers | `scripts/audit-codflow-mappers.js` (`ts-node`) | field/status/money correctness on fixtures |
| Repository routing | `scripts/audit-codflow-routing.js` | flag on/off selects the right adapter |
| Build/export | `npm run build` + `node scripts/sync-admin.js` | static export still works |
| Legacy regression | `scripts/audit-legacy-delivery.js` | `/api/delivery` actions still behave |
| No-corruption | `scripts/audit-no-corruption.js` | `codflow-main` diff empty; no secrets in `out/` |
| Manual E2E | checklist | RTL screens, dialogs, duplicate guards |

No new test framework is required for Phase 0-2. Use the repo's existing Node-script + `ts-node` convention. Add Playwright only with explicit approval.

### 11.2 Golden fixtures

Capture sanitized responses from a local CodFlow (`wrangler dev` + seeded D1) for:

- orders list (0, 1, 101 rows; Arabic names; null commune)
- order detail with variants and remarks
- dashboard stats
- product list/detail with and without variants
- customers list/detail
- delivery companies/drivers
- error envelopes: 401, 403, 404, 409, 422, 500
- invalid status transition

Store under `src/lib/codflow/__fixtures__/`. Never include real phone numbers or addresses.

### 11.3 Performance budgets

| Metric | Target |
|---|---|
| Orders screen p95 (500 orders) | < 1.5 s |
| Orders screen p95 (5,000 orders) | < 4 s, with pagination warning |
| Bridge overhead | < 150 ms p95 |
| CodFlow API p95 | < 500 ms |
| Bundle increase from `src/lib/codflow` | < 5% (tree-shaken) |
| Error rate | < 1% of requests |

### 11.4 Negative-path checklist

- Expired/invalid API key -> 401, user sees "session expired", not a blank page.
- Missing scope -> 403 with the missing scope logged.
- CodFlow down -> bridge returns 502 with `COD_FLOW_UNAVAILABLE`; legacy fallback remains available.
- Malformed JSON -> typed error, no unhandled rejection.
- Duplicate dispatch -> guarded before request.
- Invalid status transition -> CodFlow message shown.
- Empty list -> empty state, not a spinner forever.
- 101+ orders -> pagination loop terminates and logs the cap.

---

## 12. Deployment and rollback runbook

### 12.1 Deploy order

1. Deploy `api/codflow.php` + env + `.htaccess` rewrite to Hostinger.
2. Verify `GET /api/codflow?path=/__health` (authenticated); expect `configured=true` once env is set.
3. Verify `GET /api/codflow?path=/api/analytics/dashboard-stats` returns 200 (`dashboard:view`).
4. Build the dashboard with flags off; run `node scripts/sync-admin.js`.
5. Deploy `admin/` + `dist-hostinger/admin/`.
6. Enable `orders:read` via `CODFLOW_FLAGS`; purge LiteSpeed cache.
7. Verify counts, then enable `orders:write`.
8. Repeat per domain.

### 12.2 Rollback

| Symptom | Action |
|---|---|
| Wrong data / mapping bug | Set the domain flag to `off`; purge cache |
| Bridge compromised | Rotate the CodFlow API key; set `CODFLOW_FLAGS=off`; remove rewrite |
| CodFlow outage | Bridge returns 502; dashboard falls back to legacy only if the flag is off |
| Build regression | Re-deploy the previous `admin/` export; bridge stays |
| Legacy admin broken | Restore the previous `.htaccess`; the bridge rewrite is the only addition |

### 12.3 Hosting decision (resolved)

- **Hostinger/LiteSpeed — chosen (2026-11-06).** The PHP bridge (`api/codflow.php`) is the production transport. It matches the existing root `.htaccess`, `admin/` sync, `dist-hostinger/admin/`, and PHP 8.3 endpoints.
- **Vercel — not used.** PHP does not run there; do not add a parallel Vercel Function. If hosting ever changes, port the same allowlist/redaction logic rather than mixing both.

---

# Part II - Multi-Agent Enhancement Plan

## 13. Enhancement backlog (source, functions, optional features)

Prioritized by risk reduction and user value. "Effort" is relative, not calendar time.

### P0 - Correctness and safety (do first)

| # | Item | Why | Files | Effort | Risk |
|---|---|---|---|---|---|
| P0-1 | Replace duplicated `OrvaOrder` types with one contract | Prevents mapper drift | `src/lib/orva-api.ts`, `src/lib/repository/types.ts` | S | Low |
| P0-2 | Scoped typecheck for new code (`ignoreBuildErrors` stays for legacy) | Catches real type bugs without a big-bang cleanup | new `tsconfig.codflow.json`, `package.json` script | S | Low |
| P0-3 | Unify API errors (`OrvaApiError` everywhere) | Consistent UX and retry logic | `api-orders-repository.ts`, `orva-api.ts`, new `errors.ts` | S | Low |
| P0-4 | Harden demo mode | Ensure `NEXT_PUBLIC_ALLOW_DEMO_MODE` cannot bypass production auth | `src/lib/demo-environment.ts`, `admin-session-gate.tsx` | S | Medium |
| P0-5 | Add a build/version indicator + cache-bust check | Prevents stale `_next` chunks after sync | `src/config/app-config.ts`, dashboard header | S | Low |
| P0-6 | Add request IDs and structured client logs | Makes bridge/API failures debuggable | `src/lib/codflow/client.ts`, bridge | S | Low |
| P0-7 | Delete/disable hard-delete UI | CodFlow hard-deletes; prevent data loss | order dialogs | S | High if ignored |

### P1 - Integration and reliability

| # | Item | Why | Phase |
|---|---|---|---|
| P1-1 | CodFlow bridge + runtime flags | Safe transport and rollback | 0 |
| P1-2 | Orders read adapter + status normalization | First real value | 1 |
| P1-3 | Orders write + idempotency guards | Daily operations | 2 |
| P1-4 | Products/inventory real data | Removes localStorage fragility | 3 |
| P1-5 | Customers/delivery real data | Removes duplicate customers | 4 |
| P1-6 | Server-side pagination/filtering for orders | 5,000-order cap | 1/6 |
| P1-7 | Optimistic UI + targeted refetch | Perceived speed | 2 |
| P1-8 | Error boundaries per dashboard section | One failure does not blank the app | 1 |
| P1-9 | Cache invalidation after writes | Avoid stale counts | 2 |

### P2 - UX, performance, optional features

| # | Item | Why | Phase |
|---|---|---|---|
| P2-1 | Virtualized order/customer tables | Large datasets | 6 |
| P2-2 | Dynamic import for map/designer/charts | Initial bundle | 6 |
| P2-3 | WCAG 2.2 audit + RTL focus management | Accessibility | 6 |
| P2-4 | Invoice print/PDF layout | Merchant workflow | 6 |
| P2-5 | Reviews moderation, offers, abandoned orders | CodFlow features already exist | 6 |
| P2-6 | Driver payments + reconciliation screen | CodFlow feature already exists | 6 |
| P2-7 | Landing page A/B compare + tracking config | CodFlow feature already exists | 5/6 |
| P2-8 | WhatsApp widget / OTP / Turnstile config | CodFlow feature already exists | 5 |
| P2-9 | Persist traffic analytics | Cross-device reporting | 6+ |
| P2-10 | RBAC-driven UI | Multi-user safety | 7 |
| P2-11 | Multi-store support | Only if the business needs it | future |

### Metrics baseline to capture before Phase 1

- `npm run build` time and output size.
- Number of TypeScript errors currently hidden by `ignoreBuildErrors`.
- `biome check` error count.
- Orders screen load time with the current dataset.
- Lighthouse performance/accessibility on ecommerce, products, customers-delivery.
- Legacy `/api/delivery` p95 and error rate.
- Browser console error count on a full dashboard walkthrough.

Targets: zero new type errors in scoped files, zero new lint errors, < 10% build-time increase, p95 budgets from §11.3, no new console errors.

---

## 14. Multi-agent orchestration plan

Use the `agent-orchestration-multi-agent-optimize` skill's operating model: baseline -> profile -> change -> validate -> roll back. The unit of work is a **domain slice**, not a file.

### 14.1 Roles

| Role | Responsibility | Model tier |
|---|---|---|
| Orchestrator | Owns the contract, task graph, merge gate, shared-file edits | Strong |
| Codebase explorer x3 | CodFlow API/contracts, OrvaStore screens, legacy PHP | Fast/medium |
| Foundation agent | Bridge, client, flags, types, errors | Strong |
| Domain adapter agents x4 | Orders, products, customers/delivery, store | Medium |
| UI wiring agents x4 | Disjoint page directories | Fast/medium |
| Verification agents x4 | Contract tests, security, performance, accessibility | Medium/strong |
| Release agent | Build, sync, deploy checklist, rollback verification | Medium |

### 14.2 Wave plan

| Wave | Parallelism | Work | Gate |
|---|---|---|---|
| 0 | 3 explorers + orchestrator | Capture contracts, screen dependencies, legacy behavior | Contract notes + fixtures approved |
| 1 | 1 foundation agent | Bridge, client, flags, types, errors | Bridge audit passes |
| 2 | 4 domain agents | Orders, products, customers/delivery, store adapters | Mapper audits pass |
| 3 | 4 UI agents | Wire disjoint page directories | Build + manual smoke |
| 4 | 4 verifiers | Security, performance, a11y, regression | All gates green |
| 5 | 1 release agent | Deploy, flag rollout, rollback drill | Production verified |

### 14.3 File ownership rules

- **One writer per file.** No two agents edit the same file in the same wave.
- **Orchestrator owns shared files:** `orders-repository-factory.ts`, `sidebar-items.ts`, `integrations-registry.ts`, `types.ts`, `app-config.ts`.
- **Domain agents own only** `src/lib/codflow/**`.
- **UI agents own only** their page directory (`dashboard/ecommerce/**`, `dashboard/products/**`, etc.).
- **No agent touches `codflow-main`** except a dedicated, approved additive-endpoint agent in a separate PR.
- **No agent reformats unrelated files.** Biome runs only on touched paths.

### 14.4 Worktree and dirty-tree policy

The repository has many unrelated uncommitted changes. Do **not** create worktrees until a clean baseline is agreed, because a worktree would miss untracked/modified files.

Recommended:

1. Work in the same tree with disjoint paths.
2. Stage only owned files: `git add <explicit paths>`.
3. Before merge: `git diff --stat -- <owned paths>` and `git status --porcelain` review.
4. Never run `git add -A`, `git stash`, or `git reset` on the shared tree.

If worktrees are later approved, first create a scoped checkpoint commit containing only the plan and foundation files.

### 14.5 Handoff format (every agent)

```text
Task:
Files changed:
Contract assumptions:
Tests run:
Result: pass/fail
Open issues:
Diff stat:
```

### 14.6 Cost and context controls

- Each agent reads only its domain files + `docs/plans/2026-11-04-codflow-orvastore-integration-and-enhancement.md` + the contract fixtures.
- No agent performs a full-repo scan; use targeted `grep`/`glob`.
- Cap retries at 2 per task; escalate to the orchestrator on the third failure.
- Reuse fixtures instead of re-capturing API responses.
- Run build/tests locally, not through an agent, when the command is deterministic.
- Strong model only for architecture, security review, and ambiguous mapping; mechanical wiring uses the faster tier.

### 14.7 Merge gate

A wave is mergeable only when:

1. Scoped typecheck passes.
2. `biome check` passes on touched files.
3. Domain audit scripts pass.
4. `npm run build` succeeds.
5. `codflow-main` diff is empty.
6. No secret in `out/`.
7. The previous phase's flag-off behavior still works.

---

## 15. Risk register

| Risk | Likelihood | Impact | Mitigation | Trigger |
|---|---|---|---|---|
| Static export cannot hold secrets | Certain | High | PHP bridge; server env only | Any direct key in client code |
| CORS/cookie failure in direct JWT mode | High | Medium | Default to bridge; same-site subdomains for Phase 7 | 401/CORS errors in console |
| Status vocabulary mismatch | High | High | Canonical CodFlow statuses + legacy alias map | KPI counts diverge |
| Money/COD mismatch | Medium | High | `codAmount` authoritative; integer DZD; reconciliation script | Invoice != CodFlow total |
| Hard delete data loss | Medium | Critical | Disable delete; cancel instead | Delete button present |
| Duplicate dispatch | Medium | High | Reload-before-dispatch + tracking guard + pendingOps | Two shipments for one order |
| Duplicate customers | High | Medium | Phone search before create; adapter-level guard | Same phone twice |
| Bridge becomes an open proxy | Medium | Critical | Path allowlist, auth, rate limit, no redirects | Non-`/api/` path accepted |
| Secret leakage via settings endpoints | Medium | Critical | Redaction list + block secret-returning writes | Token visible in DOM/network |
| Pagination cap hides orders | Medium | Medium | Warn at cap; add server-side filters in Phase 6 | Count mismatch above 5,000 |
| Stale static build after flag change | High | Medium | Runtime `/__flags`; no rebuild needed | UI ignores flag change |
| Legacy admin breaks | Low | High | Never edit legacy endpoints; smoke test each release | `admin.html` API errors |
| CodFlow schema drift | Low | High | No schema changes; contract fixtures; version pin | Unexpected field shape |
| Concurrent agents overwrite files | Medium | High | One writer per file; orchestrator-owned shared files | Conflicting diffs |
| Unrelated dirty tree gets staged | High | Medium | Explicit `git add` paths; diff review | `git status` shows unexpected files |
| Performance regression from full order loads | High | Medium | Pagination loop + cap + virtualized tables | p95 > budget |
| Multi-store assumption wrong | Medium | High | Confirm before Phase 1; if needed, scope by `storeId` in a separate design | Orders from wrong brand |

---

## 16. Decisions

### 16.1 Resolved (2026-11-06)

| # | Decision | Answer | Consequence |
|---|---|---|---|
| 1 | Hosting target | **Hostinger/LiteSpeed** | PHP bridge is the production transport; no Vercel Function (see §12.3) |
| 2 | CodFlow URL | **Not deployed yet** | Phase 0 runs against local `php -S` + `wrangler dev`; production origin/key live only in env; no host hardcoded |
| 3 | Single store | **Assumed yes, unverified** | Pre-Phase-1 gate below; if false, stop and design store scoping before orders |
| 4 | First domain | **Orders first** | PR 2 read-only, then PR 3 writes; other domains stay legacy |
| 5 | Invoices / traffic analytics | **Stay OrvaStore-owned** | Not migrated to CodFlow |
| 6 | CodFlow schema changes | **None** | Integration uses existing routes only; no migrations, no dual writes |
| 7 | Auth cutover (Phase 7) | **Deferred** | Bridge stays permanent until explicitly revisited |
| 8 | Test framework | **Node audit scripts for now** | No new test dependency in PR 1-3; revisit Playwright/Vitest later |
| 9 | Demo mode in production | **Never** | `NEXT_PUBLIC_ALLOW_DEMO_MODE` must not bypass auth in production |

### 16.2 Pre-Phase-1 verification gate (single-store)

Before wiring any order screen, confirm against the real CodFlow deployment/data:

1. `stores` has exactly one row (or all rows represent the same brand).
2. Orders/customers/products contain no second-brand data.
3. No current or planned requirement to filter orders by `store_id`.
4. If any check fails: **stop**. Orders need additive store scoping (new column/migration or separate deployments) before Phase 1.

### 16.3 Still open before Phase 2 (writes)

1. **Order creation:** dashboard-only management, or also create orders? Creation needs idempotency and duplicate protection.
2. **Write roles:** which OrvaStore admins may mutate orders, and does that map to the single `staff` CodFlow user or multiple service users?
3. **Phase 7 auth cutover:** permanently out of scope, or revisit after writes stabilize?
4. **Test framework:** when to add Playwright/Vitest and which flows get E2E coverage.

---

## 17. First three PRs

> **Repository tracking constraint (2026-11-06).** Root `.gitignore` ignores the whole `orvastore Dashbaord v0.9/` clone and `scripts/audit-*`. As a result, the five `src/lib/codflow/*.ts` files and `scripts/audit-codflow-bridge.js` are **not committable by default**; only `admin/` and `dist-hostinger/` artifacts are tracked. Decide before PR 2: keep the dashboard source external and version the library separately, force-add just the integration files with `git add -f`, or relocate the library to a tracked path. Do **not** unignore the entire dashboard folder. PR 1 leaves all ignored files uncommitted and untouched by git.

### PR 1 - Foundation only (no UI change)

**Files:** `api/codflow.php`, `.htaccess`, `.env.example`, `api/config.php`, `src/lib/codflow/{config,flags,errors,client,types}.ts`, `scripts/audit-codflow-bridge.js`, this plan.

**Status (2026-11-06): implemented, uncommitted, audit-green (34/34 live checks).** Do not enable `orders:read` until PR 2's legacy regression audit exists.

**Done when:** bridge health/flags work, audit passes, no secret in bundle, classic admin untouched, `codflow-main` diff empty.

### PR 2 - Orders read-only

**Files:** `src/lib/codflow/mappers/{status,money,orders}.ts`, `repositories/{codflow-orders-repository,routing-orders-repository}.ts`, `__fixtures__/orders-*.json`, `scripts/audit-codflow-orders.js`, `orders-repository-factory.ts`, `repository/types.ts`, status consumers.

**Done when:** `orders:read` shows CodFlow orders; `orders:off` is unchanged; mapper/routing audits pass.

### PR 3 - Orders write

**Files:** `codflow-orders-repository.ts` writes, `idempotency.ts`, order dialogs, `scripts/audit-codflow-orders-write.js`.

**Done when:** status/bulk/switch/dispatch work with guards; delete is disabled; invalid transitions surface CodFlow errors.

---

## 18. Definition of done (whole program)

- All enabled domains read/write through CodFlow; disabled domains behave exactly as before.
- No CodFlow schema change, no CodFlow route removal, no secret in the browser.
- Legacy `admin.html`/`admin.js` and `/api/delivery` still work.
- Every phase has a passing audit script and a documented rollback.
- Build + sync + deploy are reproducible.
- The dashboard has one contract per domain, one error taxonomy, and no mock data on enabled screens.
- The enhancement backlog is either shipped or explicitly deferred with an owner.

---

## 19. Immediate next action

1. Review PR 1 (foundation only) and commit it with explicit paths — never `git add -A`.
2. Run the §16.2 single-store verification gate against the real CodFlow deployment.
3. Start PR 2: orders read-only mapper/repository/routing + legacy regression audit.
4. Keep `orders:off` in production until the PR 2 audit and a manual rollback drill pass.
4. Do not enable `orders:read` until the bridge audit and the legacy regression audit both pass.
