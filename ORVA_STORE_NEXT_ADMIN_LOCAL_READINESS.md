# ORVA Store — Next.js Admin Local Readiness

**Date:** 2026-11-07  
**Scope:** Local implementation + verification only (no commit / push / Hostinger / Production).  
**Classic fallback:** `admin.html` + `admin.js` **preserved**.

---

## Local preview URLs

| Surface | URL |
|---------|-----|
| Next.js admin (primary) | http://localhost:3000/admin |
| Orders workspace | http://localhost:3000/dashboard/ecommerce/ |
| Risk filter deep-link | http://localhost:3000/dashboard/ecommerce/#risk |
| Products (live catalog) | http://localhost:3000/dashboard/products/ |
| Products isolated test catalog | http://localhost:3000/dashboard/products/?fixture=test |
| Logistics / tariffs | http://localhost:3000/dashboard/logistics/ |
| Settings / couriers | http://localhost:3000/dashboard/settings/ |
| Classic admin (fallback) | http://localhost:3000/admin.html or http://localhost:3000/admin?v=classic |
| PHP API peer (if needed) | http://127.0.0.1:8000 |

Node preview server is running with `MOCK_COURIER=true`, `ORVA_TEST_MOCK_SUPABASE=true`, local admin token/password (not printed here).

---

## Features completed

1. **Risk management UI** — score/reasons/decision dialog; Trust / Block / Unblock via `/api/risk` (auth required).
2. **Courier settings** — existing encrypted Settings Center kept; Redex/Ecotrack save + masked tokens + test; local `MOCK_COURIER` simulation.
3. **Create shipment workflow** — Push dialog shows customer, address, wilaya tariff fields, courier select, confirm, tracking + label URL; localhost sends `mock:true` (no real dispatch).
4. **AR / FR language** — `AdminLocaleProvider` + header switcher; RTL/LTR on `documentElement`; persisted in `localStorage`.
5. **Products → real catalog** — `/api/products-catalog` (Node + PHP) reads/writes `data/products-catalog.json`; Products page uses `CatalogProductsRepository`; `?fixture=test` uses isolated local copy.
6. **Auth gate** — no auto demo login; password login uses `/api/auth`; optional explicit Demo button on localhost only; logout clears session.
7. **Static export rebuilt** — `npm run build` → synced into `admin/`; invoice + demo routes absent; classic files untouched.
8. **Local backup** — `data/local-fixtures/admin-static-backup-20261107-023240/`.

---

## Features still blocked / limited

| Item | Status |
|------|--------|
| Full FR translation of every ecommerce string | Partial — chrome/nav covered; deep order-table copy still mixed AR/EN |
| Risk override when order missing in DB | Contract works; update may return null updated row |
| Live courier dispatch | Intentionally mocked locally — do not enable without ops approval |
| Production decommission of classic panel | **Not approved** — keep classic until ops parity sign-off |
| Designer / demand / overview still touch mock analytics helpers | Product CRUD is live catalog; visitor analytics remain stub zeros |

---

## Files modified (high level)

- Next: risk dialog, recent-orders/columns, layout + locale, products repo wiring, order-push tariff panel, auth gate, api-orders mock flag, sidebar (prior), catalog repository
- API: `api/products-catalog.php`, `api/products-catalog.js`, `api/delivery.js` mock, `api/delivery.php` mock, `api/admin-settings.php` mock courier test
- `dev-server.js` route registration
- Scripts: `scripts/smoke-next-admin-local.js`
- Static: `admin/` rebuilt from Next `out/`
- Report: this file

---

## Static export build result

- Command: `npm run build` in `orvastore Dashbaord v0.9/next-shadcn-admin-dashboard-baseui-main`
- Output: `out/` → copied to project `admin/`
- Routes present: default, ecommerce, products (+ designer/demand/pages), logistics, settings, analytics, store-traffic, customers-delivery, top-products, 404
- Invoice route: removed
- Classic: `admin.html` / `admin.js` OK

---

## Test results (executed)

### `node scripts/smoke-next-admin-local.js` (after MOCK_COURIER restart)

| Check | Result | Class |
|-------|--------|-------|
| GET `/admin` | PASS 200 | Real static |
| GET `/dashboard/ecommerce/` | PASS 200 | Real static |
| GET `/dashboard/products/` | PASS 200 | Real static |
| GET `/admin.html` | PASS 200 | Real classic |
| Catalog without auth | PASS 401 | Real auth |
| Catalog with bearer | PASS 200 (11 products) | Real catalog file |
| Catalog `fixture=test` | PASS | Isolated test catalog |
| Mock shipment create | PASS (after delivery.js mock) | **Mocked** courier |
| Risk trust | PASS 200 | Real risk API (order may be absent) |
| Invoice URL | PASS 404 | Real routing |

### `node scripts/verify-admin-frontend-backend-sync.js`

36/36 PASS (contract dual-verification).

### Not executed / not claimed

- Full browser click-through of every Settings save with encryption key present
- Real Redex/Ecotrack network call
- Real Supabase production writes
- Real Telegram notifications
- Load / bulk tests (forbidden)

---

## Mocked vs real integration

| Area | Classification |
|------|----------------|
| Static dashboard pages | Real local files |
| `/api/auth` session | Real local session store |
| `/api/products-catalog` | Real JSON catalog (or test fixture) |
| `/api/risk` overrides | Real API; DB row update depends on local/mock DB |
| `/api/delivery` list/status | Depends on local mock Supabase / staging mock PDO |
| Courier test + create on localhost | **Mocked** (`MOCK_COURIER` / `body.mock`) |
| Meta Pixel / Telegram live sends | Not exercised |

---

## Classic feature parity matrix

| Classic tool | Next.js | Notes |
|--------------|---------|-------|
| Auth gate | Yes | Session + optional localhost demo |
| KPIs / overview | Yes | `/dashboard/default` |
| Orders search/filters | Yes | ecommerce |
| Status changes | Yes | Optimistic UI |
| Create / push shipment | Yes | Mocked locally |
| Track / label PDF route | Preserved | label_pdf endpoint kept |
| Delete order | Yes (API) | Via delivery delete |
| 58 wilaya tariffs | Yes | logistics map + push shows fees |
| Carrier settings | Yes | Settings Center |
| Risk shield | Yes | Dialog + filter |
| Analytics | Yes | analytics / store-traffic |
| Excel export | Yes | ecommerce CSV export |
| FR/AR | Partial | Switcher + RTL/LTR |
| Storefront links | Yes | Classic link in header |
| Auto-refresh | Yes | 30s visibility poll |
| Invoice demo page | Removed | Backend PDF/label kept |

---

## Security verification

- Catalog + risk + settings mutations require admin session/bearer.
- Catalog test fixture blocked off localhost.
- Demo mode no longer auto-enters; must click Demo explicitly.
- Static export contains no embedded secrets/customer dumps by design.
- Courier tokens not returned to frontend (Settings continue masked pattern).
- Local preview uses mock Supabase / mock courier — not Production.

---

## Remaining limitations

1. Restart Node after API file changes (done for this session).
2. FR coverage incomplete on deep tables.
3. Mock shipment does not persist tracking onto a real order row when the order ID does not exist in DB.
4. Classic panel must stay until ops sign-off.
5. Do not deploy / commit from this task.

---

## Approval gate

**Stop here.** Preview locally, then approve before any git commit, remote branch, or Hostinger deploy.
