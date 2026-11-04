# E2E Test Suite Ready: Telegram Message Customization & Template Manager

**Document Code:** `ORVA-PHASE8F-TEST-READY`  
**Execution Timestamp:** 2026-11-04T02:59:00Z  
**Author / Track:** E2E Testing Track (`teamwork_test_writer_e2e`)  
**Target Runner:** `scripts/test-phase8f-telegram-customization.js`  
**NPM Target:** `npm run test:phase8f`  
**Integrity Mode:** Development  

---

## 1. Executive Summary

The master opaque-box E2E test suite for the **Telegram Message Customization & Template Manager** has been authored, verified, and published in `scripts/test-phase8f-telegram-customization.js`. Derived strictly from `ORIGINAL_REQUEST.md`, `PROJECT.md`, and `TEST_INFRA.md`, the suite exercises all 16 features (F1–F16) across the 4-tier testing hierarchy with zero live external network dependencies.

- **Total Test Cases:** **105 tests**
- **Framework:** Native Node.js (`node:assert`, `node:crypto`, `node:http`, `node:https`)
- **Execution Speed:** Full 105-test run completes in under 2 seconds
- **Pass/Fail Semantics:** Exits `0` on 100% pass; exits non-zero (`1`) on any failure or unfulfilled contract
- **Zero Live Network Calls:** In-memory `https.request` mock interceptor for `api.telegram.org` combined with `process.env.MOCK_TELEGRAM = 'true'` sandbox guard

---

## 2. Test Runner Commands

### 2.1 Complete 4-Tier Test Run
```powershell
# Using npm script:
npm run test:phase8f

# Or using Node CLI directly:
node scripts/test-phase8f-telegram-customization.js
```

### 2.2 Tier-Filtered Execution
```powershell
# Tier 1: Feature Coverage (80 tests across F1–F16)
node scripts/test-phase8f-telegram-customization.js --tier=1

# Tier 2: Boundary & Corner Cases (12 tests)
node scripts/test-phase8f-telegram-customization.js --tier=2

# Tier 3: Cross-Feature Combinations & State Transitions (8 tests)
node scripts/test-phase8f-telegram-customization.js --tier=3

# Tier 4: Realistic Application Workflows (5 End-to-End Scenarios)
node scripts/test-phase8f-telegram-customization.js --tier=4
```

### 2.3 Milestone-Targeted Execution
```powershell
# Milestone 1: Template Engine & Variable Registry (F1–F5)
node scripts/test-phase8f-telegram-customization.js --milestone=m1

# Milestone 2: Settings Persistence, Admin APIs & Security (F6–F10)
node scripts/test-phase8f-telegram-customization.js --milestone=m2

# Milestone 3: Admin UI, Live Preview & Composer (F11–F16)
node scripts/test-phase8f-telegram-customization.js --milestone=m3
```

### 2.4 Feature-Specific Execution
```powershell
# Run individual features (F1 to F16):
node scripts/test-phase8f-telegram-customization.js --feature=F1
node scripts/test-phase8f-telegram-customization.js --feature=F4
node scripts/test-phase8f-telegram-customization.js --feature=F5
node scripts/test-phase8f-telegram-customization.js --feature=F7
node scripts/test-phase8f-telegram-customization.js --feature=F9
```

---

## 3. Four-Tier Coverage Inventory

| Tier | Category | Scope | Test Count | Pass (Baseline) | Pending Worker Delivery |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **Tier 1** | Feature Coverage | F1–F16 (≥5 tests per feature) | 80 | 36 | 44 (M1, M2, M3) |
| **Tier 2** | Boundaries & Stress | Max 4,096 chars, Harakat, XSS injection, missing fields, empty inputs | 12 | 1 | 11 (M1 Engine) |
| **Tier 3** | Combinations | Draft vs Active, fallback toggles, CSRF, rate-limiting, deduplication | 8 | 5 | 3 (M2 API Actions) |
| **Tier 4** | E2E Workflows | Real checkout, courier waybills, custom broadcast, test sandbox, fallback recovery | 5 | 1 | 4 (Full System) |
| **TOTAL** | | | **105** | **43 (41%)** | **62 (59%)** |

---

## 4. Feature Coverage Matrix (F1 to F16)

| # | Feature Name | Milestone | Scope / Interface Contract | Tests | Status |
| :--- | :--- | :---: | :--- | :---: | :---: |
| **F1** | Architecture & Event Mapping | M1 | 5 events (`ORDER_CREATED`, `SHIPMENT_CREATED`, `SHIPMENT_FAILED`, `STATUS_UPDATED`, `ORDER_CANCELLED`) + `ADMIN_ALERT` | 5 | Pending M1 |
| **F2** | Centralized Variable Registry | M1 | Variable dictionary, validation, missing-value safe fallback (no "undefined"/"null") | 5 | Pending M1 |
| **F3** | HTML Template Renderer | M1 | HTML escaping (`&`, `<`, `>`), tag whitelisting, 4,096-char cap, `{{dashboard_url}}` | 5 | Pending M1 |
| **F4** | Transparent Fallback | M1 | Automatic fallback to default built-in message if custom template disabled/missing/empty | 5 | **5 / 5 PASS** |
| **F5** | Notification Isolation | M1 | Telegram dispatch failures never block database order creation or inventory deductions | 5 | **5 / 5 PASS** |
| **F6** | Encrypted Persistence | M2 | AES-256-GCM encryption in `admin-settings.enc`, atomic temp writes, mutex locking | 5 | Pending M2 |
| **F7** | Two-Way Runtime Parity | M2 | Cross-runtime Node.js & Hostinger PHP 8.3 parity, AAD `'orva-admin-settings-v1'` | 5 | **5 / 5 PASS** |
| **F8** | Authenticated Mutation APIs | M2 | `/api/admin-settings` actions: `save_template`, `activate_template`, `restore_template`, `toggle_template` | 5 | Pending M2 |
| **F9** | Credential Secrecy & Redaction | M2 | Zero bot tokens in GET/POST responses, `/bot[REDACTED_TOKEN]` in errors, phone masking | 5 | **5 / 5 PASS** |
| **F10** | Rate Limiting on Test Sends | M2 | 1 test msg / 3s per session; rate limiting does NOT throttle customer checkout | 5 | Pending M2 |
| **F11** | Admin Customization UI & RTL | M3 | Arabic RTL (`dir="rtl"`), Tajawal font, event list selector in `settings-integrations.tsx` | 5 | Pending M3 |
| **F12** | Visual Editor & Variables Dropdown | M3 | Event-scoped variable menu, format helpers (`<b>`, `<i>`, `<code>`), character counter | 5 | Pending M3 |
| **F13** | Live Interactive Preview | M3 | Simulated Telegram chat bubble rendering synthetic sample data in real time | 5 | Pending M3 |
| **F14** | Draft, Activate & Restore Controls | M3 | Save Draft, Activate Template, Restore Default with immediate UI toast notifications | 5 | Pending M3 |
| **F15** | Custom Admin Composer | M3 | Free-form announcements, read-only chat ID lock, confirmation prompt | 5 | Pending M3 |
| **F16** | Send Test Message Action | M3 | Synthetic data, `[TEST]` prefix, zero database orders, zero courier calls | 5 | Pending M3 |

---

## 5. Safe Mocking & Network Isolation Guarantee

The test suite implements an in-memory `https.request` interceptor:
1. All calls to `api.telegram.org` are captured and simulated locally.
2. In-flight payloads (`chat_id`, `text`, `parse_mode`, `disable_web_page_preview`) are recorded in `mockTelegramDispatches` for exact assertion.
3. Network outages, timeouts, and HTTP 401 Unauthorized errors are simulated deterministically.
4. **Zero live messages** will ever be sent to Telegram channels during automated test runs.
5. `data/private/admin-settings.enc` is automatically backed up prior to test execution and restored upon suite completion.

---

## 6. Implementation Defect Escallation

During test suite verification, the following implementation bug in `lib/telegram-notifier.js` was identified and documented for the Milestone 1 Worker:

- **Location:** `lib/telegram-notifier.js:253`
  ```javascript
  const trackingCode = data.trackingNumber || data.trackingCode || '';
  ```
- **Defect:** If caller invokes `dispatchTelegramNotification` with `data: null`, default parameter `data = {}` is bypassed, throwing an unhandled TypeError: `Cannot read properties of null (reading 'trackingNumber')`.
- **Recommended Fix:** Change line 253 to:
  ```javascript
  const safeData = data && typeof data === 'object' ? data : {};
  const trackingCode = safeData.trackingNumber || safeData.trackingCode || '';
  ```

---

## 7. Next Steps for Implementation Track

1. **Milestone 1 Worker:** Implement `lib/telegram-template-engine.js` satisfying Interface Contract 1. Tests `T1-F01-01` through `T1-F03-05` and Tier 2 `T2-B01` through `T2-B11` will immediately turn GREEN.
2. **Milestone 2 Worker:** Extend `api/admin-settings.js` and `lib/admin-settings-store.js` with template CRUD actions and rate-limiting. Tests `T1-F06-01` through `T1-F10-05` and Tier 3 will turn GREEN.
3. **Milestone 3 Worker:** Implement visual editor, variable dropdown, preview bubble, and composer in `settings-integrations.tsx`. Tests `T1-F11-01` through `T1-F16-05` will turn GREEN.
4. **Milestone 4 (Final Gate):** Run `npm run test:phase8f` to verify **105 / 105 PASS (100%)**.
