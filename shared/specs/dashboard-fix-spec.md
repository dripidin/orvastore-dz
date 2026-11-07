# DASHBOARD FIX SPEC — ORVA STORE
**Date:** 2026-11-04
**Author:** Orchestrator (audit synthesis)
**Status:** APPROVED FOR EXECUTION

## Context

Three parallel audit agents investigated the dashboard code, API endpoints, and project documentation. The audit found that the **static HTML/JS dashboard** (`admin.html`, `admin.js`, `admin.css`) is the real operational dashboard, and it has several critical issues: dead duplicate functions, fabricated tracking timelines, disabled fraud detection with fake reasons, missing auth on API calls, hardcoded analytics values, and more.

**Guiding principle:** Remove illusion code. Every function must either work with real data or honestly show "unavailable" — never fabricate data that looks real.

---

## TASKS

### Task 1: Remove dead duplicate functions in `admin.js` (CRITICAL)

**File:** `e:/Websites On Line/yamahasac/admin.js`

Three functions are defined twice — the first definition is dead code overridden by the second:

| Function | Dead (first) lines | Active (second) lines |
|---|---|---|
| `switchTab` | 558–573 | 1426–1435 |
| `printOfficialLabel` | 1072–1094 | 1564–1645 |
| `trackColis` | 1097–1153 | 1651–1679 |

**Action:** Delete the first (dead) definition of each pair. Keep the second (active) definition.

**Important:** The dead `switchTab` (558–573) calls `this.fetchAnalytics()` on the analytics tab — the active one (1426–1435) does NOT. After removing the dead version, ADD `this.fetchAnalytics();` to the active `switchTab` inside the analytics branch (after line ~1433) so analytics are fetched when the tab is opened.

**Verification:** Search `admin.js` for each function name — should find exactly ONE definition each. No syntax errors.

---

### Task 2: Fix `trackColis` — stop fabricating tracking timeline (CRITICAL)

**File:** `e:/Websites On Line/yamahasac/admin.js`, lines 1651–1679 (the active version)

**Problem:** The function fabricates a fake tracking timeline with hardcoded text ("Centre de tri Alger Hub - Expédition validée", "Attribué au livreur du secteur", "Aujourd'hui") without any API call.

**Action:** Replace the fabricated timeline with an honest representation based ONLY on actual order data:
1. Show "Commande confirmée" with the real `o.createdAt` or `o.date` (if available)
2. If the order has `in_redex` or a tracking code: show "Expédié via [carrier]" with the real tracking code
3. If the order status is "delivered": show "Livré" step
4. If no tracking data exists: show a single message: "Aucune donnée de suivi disponible. Le colis n'a pas encore été expédié." (No tracking data available. Parcel not yet shipped.)
5. Do NOT invent "Centre de tri", "livreur du secteur", or dates that don't exist in the data.

**Verification:** Open the tracking modal for an order without tracking — should show the honest "no data" message, not fabricated timeline steps.

---

### Task 3: Fix `viewRisk` — remove fake risk reasons and "system paused" banner (CRITICAL)

**File:** `e:/Websites On Line/yamahasac/admin.js`, lines 1687–1745

**Problem:** 
1. Hardcoded banner says risk system is "paused by administration" — this may not be true
2. When no `riskReasons` from backend, falls back to fake reasons: "Trafic organique vérifié", "Format téléphone algérien valide", "Empreinte appareil conforme"

**Action:**
1. Remove the "system paused" banner (lines 1700–1706). The risk system status should come from the backend, not be hardcoded.
2. Replace the fake fallback reasons with: show "Aucune analyse de risque disponible pour cette commande." (No risk analysis available for this order.) when `o.riskReasons` is empty.
3. Keep the score/level/decision display — those use real data from the backend.
4. Keep the trust/block action buttons.

**Verification:** Open risk modal for an order without risk data — should show "No risk analysis available", not fabricated reasons.

---

### Task 4: Fix `overrideRisk` — add authentication to API call (CRITICAL)

**File:** `e:/Websites On Line/yamahasac/admin.js`, lines 1747–1765

**Problem:** The fetch to `/api/risk` sends no auth credentials. The backend (`api/risk.js`) requires either a Bearer token or `orva_admin_session` cookie. The call will always return 401.

**Action:** Add credentials to the fetch call:
```javascript
const res = await fetch('/api/risk', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (this.getStoredCarrierToken() || '')
    },
    credentials: 'same-origin'
});
```

Check how other authenticated calls in this file work (look at `fetchOrders`, `deleteColis`, `changeOrderStatus`) and match the same auth pattern. If they use cookies, add `credentials: 'same-origin'`. If they use tokens, match the header format.

**Verification:** The function should send auth credentials. When called with a valid session, the backend should accept it.

---

### Task 5: Remove hardcoded analytics fallback values in `admin.html` (MODERATE)

**File:** `e:/Websites On Line/yamahasac/admin.html`, lines 458–519

**Problem:** Analytics KPI cards and breakdown lists are pre-filled with fake data (1,480 visitors, 4,620 page views, 3.8% conversion, specific referrer/device/city percentages). If the API fails, these remain permanently visible as if real.

**Action:**
1. Replace all hardcoded KPI values with placeholder text: `—` (em dash) or `...` 
2. Replace all breakdown list contents with a single placeholder row: `<div class="analytics-row"><span>Chargement...</span><strong>—</strong></div>` (Loading...)
3. The `fetchAnalytics()` function already updates these elements when the API returns data — that's correct. We just need honest placeholders before data arrives.

**Specific replacements:**
- Line 458: `1,480` → `—`
- Line 463: `4,620` → `—`
- Line 468: `3.8%` → `—`
- Line 473: `2m 45s` → `—`
- Lines 482–487 (referrers): Replace all 4 rows with single "Chargement..." row
- Lines 493–497 (devices): Same
- Lines 503–508 (cities): Same
- Lines 514–518 (browsers): Same

**Verification:** Before `fetchAnalytics()` runs or if it fails, dashboard should show `—` and "Chargement...", not fake numbers.

---

### Task 6: Fix `updateKPIs` — remove 4950 DZD fallback (MODERATE)

**File:** `e:/Websites On Line/yamahasac/admin.js`, line 887

**Problem:** `return sum + (parseInt(raw, 10) || 4950);` — when price can't be parsed, it silently adds 4950 DZD (Pack 1 price), inflating revenue.

**Action:** Change to `return sum + (parseInt(raw, 10) || 0);` — if price can't be parsed, add 0. Unknown prices should not contribute to revenue.

**Verification:** Revenue KPI should be 0 when no orders have parseable prices, not inflated by 4950 per order.

---

### Task 7: Fix `renderWilayaChart` — remove fake fallback data (MODERATE)

**File:** `e:/Websites On Line/yamahasac/admin.js`, lines 1031–1033

**Problem:** When no orders exist, injects fake data: `sorted.push(['16 - Alger', 1], ['07 - Biskra', 1], ['31 - Oran', 1]);`

**Action:** Replace the fake data injection with an honest empty state. If `sorted.length === 0`, draw text on the canvas: "Aucune donnée disponible" (No data available) centered on the canvas, and return early.

```javascript
if (sorted.length === 0) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px Plus Jakarta Sans, Cairo, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(currentLang === 'fr' ? 'Aucune donnée disponible' : 'لا توجد بيانات', w / 2, h / 2);
    return;
}
```

**Verification:** With 0 orders, chart shows "No data available" text, not fake bars.

---

### Task 8: Fix `fetchAnalytics` — remove hardcoded fallback values (MODERATE)

**File:** `e:/Websites On Line/yamahasac/admin.js`, lines 683–686

**Problem:** `json.overview.conversionRate || '3.8%'` and `json.overview.avgSessionDuration || '2m 45s'` — same fake values as HTML. Even if API returns empty, user sees fabricated data.

**Action:** Change to `json.overview.conversionRate || '—'` and `json.overview.avgSessionDuration || '—'`.

**Verification:** When API returns empty/missing values, dashboard shows `—`, not fabricated metrics.

---

### Task 9: Fix `lib/vercelAnalytics.js` — remove hardcoded fallback data (MODERATE)

**File:** `e:/Websites On Line/yamahasac/lib/vercelAnalytics.js`

**Problem:** Multiple hardcoded fallback values when Vercel API returns no data:
- Line 67: `|| 782` (visitors)
- Line 68: `|| 883` (pageviews)
- Lines 94–98: Hardcoded referrer breakdown
- Lines 116–119: Hardcoded device breakdown
- Line 175: `'28.4%'` bounce rate
- Line 176: `'2m 14s'` avg session
- Line 177: `Math.floor(4 + Math.random() * 6)` — random live visitors
- Lines 155–161: Hardcoded top cities

**Action:**
1. Line 67: Change `|| 782` to `|| 0`
2. Line 68: Change `|| 883` to `|| 0`
3. Lines 94–98: Change the `else` block to return an empty array `[]` instead of fabricated referrers
4. Lines 116–119: Same — return `[]`
5. Line 175: Change `'28.4%'` to `'—'`
6. Line 176: Change `'2m 14s'` to `'—'`
7. Line 177: Change `Math.floor(4 + Math.random() * 6)` to `0`
8. Lines 155–161: If cities data is empty, return `[]` not hardcoded cities

**Verification:** Without `VERCEL_TOKEN`, the function should return 0s, empty arrays, and `—` — not fabricated metrics.

---

### Task 10: Fix `exportExcel` — dynamic export instead of static file (LOW)

**File:** `e:/Websites On Line/yamahasac/admin.js`, lines 1895–1897

**Problem:** Opens a static file `/data/excel/Orders.xlsx` that may be stale, not a real-time export.

**Action:** Since this project doesn't have a dynamic Excel export endpoint and adding one is out of scope, change the function to honestly tell the user:
```javascript
exportExcel: function () {
    const msg = currentLang === 'fr'
        ? "L'export Excel dynamique n'est pas encore disponible. Les commandes affichées à l'écran sont en temps réel."
        : "تصدير إكسيل الديناميكي غير متاح حالياً. الطلبيات المعروضة على الشاشة في الوقت الفعلي.";
    alert(msg);
}
```

Alternatively, if you can implement a simple CSV export from `ordersList` in the browser, that would be even better — but the alert is the minimum acceptable fix (honesty over illusion).

**Verification:** Clicking "Export Excel" shows an honest message, not a stale file.

---

### Task 11: Fix label modal demo data in `admin.html` (LOW)

**File:** `e:/Websites On Line/yamahasac/admin.html`, lines 738–783

**Problem:** Label modal contains pre-filled demo data (Samir Deriadi, 0772552823, ORVA-59067, etc.) visible if modal opens without JS populating it.

**Action:** Replace all demo values with placeholders:
- `lblDateStamp`: `—`
- `lblBarcodeCode`: `—`
- `lblOrderRefTag`: `Réf: —`
- `lblClientNameText`: `—`
- `lblClientPhoneText`: `—`
- `lblDestinationText`: `—`
- `lblAmountText`: `— DZD`

**Verification:** If label modal opens without JS, shows `—` placeholders, not demo data.

---

## Out of Scope (Documented but NOT Fixed)

These issues exist but are intentionally out of scope for this fix cycle:
- **Next.js dashboard template shell** (`admin/dashboard/`) — it's a third-party template, removing it is a product decision
- **`/api/analytics` missing Node.js version** — requires creating a new API endpoint
- **Temp-file order storage** (`os.tmpdir()`) — architectural change
- **Staging migration unexecuted** — requires Supabase access
- **`audit_logs` table missing from schema** — requires database migration
- **`Orders.xlsx` publicly accessible on production** — requires server config
- **Credential rotation** — requires vendor console access

---

## Execution Rules

1. **One task at a time** — complete and verify each before moving to the next
2. **Read before edit** — always re-read the file region before `replace_in_file`
3. **No new files** — all fixes are edits to existing files
4. **Preserve working code** — don't refactor functions that work correctly
5. **Test after each task** — verify the change with a search or read
6. **Comment on completion** — note what was changed, how to verify, any known issues
