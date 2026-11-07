# ORVA Store — Next.js Control Panel Production Readiness

**Date:** 2026-11-07  
**Scope:** Classic admin (`admin.html` / `admin.js`) → Next.js admin (`orvastore Dashbaord v0.9/...` → static `admin/`)  
**Verdict:** **Not ready to fully decommission the classic panel yet.** Next.js is the primary ops surface for orders/products/logistics; classic remains the fallback for a short parity window.

---

## 1. Classic control panel tools (inventory)

Distinct administrator tools in the classic panel:

1. **Password auth gate** — session login via `/api/auth` (fallback `/api/delivery?login`).
2. **Dashboard KPIs** — totals, pending, shipped, revenue, returned.
3. **Orders table** — search, status filters, wilaya filter, mobile cards.
4. **Order status change** — pending → confirmed → shipped → delivered / returned / cancelled.
5. **Create shipment / colis** — autofill from order + wilaya tariff preview → courier create.
6. **Ship to carrier (Redex/Ecotrack)** — push with token/base URL settings.
7. **Track parcel** — tracking modal / courier status.
8. **Print official label (PDF)** — `/api/delivery?action=label_pdf`.
9. **Delete order/colis** — soft/hard delete via delivery API.
10. **58-wilaya tariffs modal** — domicile / stopdesk / delivery time table.
11. **Carrier settings** — select courier, API token, base URL, connection test.
12. **Risk & fraud shield** — risk filter, score modal, trust/block overrides (`/api/risk`).
13. **Analytics tab** — website analytics fetch.
14. **Excel / Sheets export pill** — local export helper.
15. **FR / AR language switch**.
16. **Auto-refresh orders** (~20s polling).
17. **Storefront deep links** — home, pack1, pack2.
18. **Jump to Next.js panel** — A/B pill to `/admin`.

---

## 2. What was done in this pass

| Action | Result |
|--------|--------|
| Remove invoice creation page | Deleted Next source `dashboard/invoice` + static `admin/dashboard/invoice`; removed from sidebar & overview nav |
| Remove unused template/demo routes | Removed academy, calendar, chat, CRM demo tab, finance, kanban, mail, patient-monitoring, productivity, roles, tasks, users, profile, legacy v1 dashboards (source + most static mirrors) |
| Port classic tools into Next nav | Sidebar now maps Overview, Orders, **Risk**, Delivery/Tariffs, Customers & Couriers, Analytics, Traffic, Settings, Products |
| Risk sync (backend ↔ admin UI) | `delivery.php` already exposed risk fields; Next `orva-api` + orders table now map/show risk badges; `#risk` filter + 30s visibility-aware poll |
| Product admin ← pack layout | Live storefront-style preview (notice bar → hero → price → COD form) on Products page |
| Dual verification script | `scripts/verify-admin-frontend-backend-sync.js` |
| Latency | Optimistic status UI retained; soft poll 30s when tab visible (less chatty than classic 20s always-on) |

---

## 3. Dual verification (backend ↔ frontends)

**Visitor / customer path:** pack pages → honeypot + form → `send-order` (Node or PHP) → risk evaluate → inventory → DB → Telegram.  
**Admin path:** session cookie → `delivery?action=get_all_orders` → Next `normalizeOrvaOrder` / classic `admin.js` → status/ship/risk actions → same delivery/risk APIs.

Run:

```bash
node scripts/verify-admin-frontend-backend-sync.js
```

Checks contracts for risk fields, send-order risk wiring, classic tool presence, invoice removal, and product storefront preview.

---

## 4. Remaining gaps before classic decommission

Must close before turning off `admin.html`:

1. **Rebuild & redeploy Next static export** into `admin/` after these source edits (sidebar/risk/products changes are in source; live `admin/_next` chunks may still be stale until `next build` + copy `out` → `admin`).
2. **Risk override UI in Next** — badges/filter exist; trust/block modal + `/api/risk` call still thinner than classic `viewRisk` / `overrideRisk`.
3. **Carrier settings UX** — Settings integrations registry exists; classic one-click token/baseUrl + `test_courier` is clearer for ops.
4. **Create-colis modal** — Next uses push/switch dialogs; confirm ops SOP matches classic create flow.
5. **FR/AR i18n** — classic bilingual; Next is mostly AR/EN mixed.
6. **Products repository** — still uses mock/local repo in places; confirm production catalog write path matches `data/products-catalog.json` / live packs.
7. **Auth gate** — ensure Next `/admin` always requires the same session as classic (no public demo routes left).

---

## 5. Production readiness checklist

| Gate | Status |
|------|--------|
| Invoice page removed | Done (source + static) |
| Demo/template routes purged from nav & most trees | Done |
| Classic tools listed & mapped into Next IA | Done |
| Risk fields synchronized admin ↔ API | Done (display/filter); override UX partial |
| Product UI follows pack page structure | Done (preview) |
| Dual-verification script | Done |
| Response-time soft poll | Done |
| Full classic decommission | **Blocked** — rebuild + gaps §4 |

**Recommendation:** Keep classic at `/admin.html` as fallback for 1–2 ops cycles after Next rebuild. Decommission only when §4 items are green and the verification script passes on the deployed host.

---

## 6. Skills applied

- **ponytail:** delete demo/invoice rather than wrap; smallest parity for risk + product preview; honest decommission block.
- **Explore / inventory:** classic vs Next route map before edits.
- **Dual verification:** contract script instead of manual-only checklist.
