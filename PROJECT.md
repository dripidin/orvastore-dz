# Project: Telegram Message Customization & Template Manager (ORVA STORE)

## Architecture
- **Overview**: An administrative template customization and message composition system embedded inside the ORVA STORE Admin Settings Center (`/dashboard/settings` -> Integrations -> Telegram). It enables non-technical store managers to customize automated event notifications, preview live messages with context data, dispatch test alerts, and compose broadcast administrative messages to the authorized store channel without touching source code.
- **Data Flow**:
  1. Admin UI (`settings-integrations.tsx` in Next.js 16 RTL) interacts via `POST /api/admin-settings` using authenticated sessions (`orva_admin_session` cookie or `Authorization: Bearer`).
  2. `api/admin-settings.js` (and PHP parity `api/admin-settings.php`) validates CSRF origin, session credentials, and payload schema, then reads/writes encrypted configuration via `lib/admin-settings-store.js`.
  3. Settings are encrypted at rest with `AES-256-GCM` in `data/private/admin-settings.enc` under cross-process directory mutex `data/locks/admin-settings.lock`.
  4. Template Engine (`lib/telegram-template-engine.js`) maintains the safe Centralized Variable Registry, parses dynamic variables, escapes HTML entities, strips disallowed tags, and enforces the 4,096-character limit.
  5. Operational dispatchers (`lib/telegram-notifier.js` and `api/send-order.php`) evaluate custom active templates for events (`ORDER_CREATED`, `SHIPMENT_CREATED`, `SHIPMENT_FAILED`, `STATUS_UPDATED`, `ORDER_CANCELLED`); if disabled or missing, they fall back transparently to existing default templates.
  6. Dispatches are deduplicated via `data/telegram-dispatch-ledger.json` and executed asynchronously without blocking database order transactions.
  7. Test messages and administrative announcements are dispatched strictly to the configured `telegram.chatId` with rate limiting and explicit `[TEST]` prefixing.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Architecture & Event Mapping | Map all 5 operational events (`ORDER_CREATED`, `SHIPMENT_CREATED`, `SHIPMENT_FAILED`, `STATUS_UPDATED`, `ORDER_CANCELLED`) and admin alerts to existing triggers and payload schemas. | M1 | ORIGINAL_REQUEST §R1 |
| F2 | Centralized Variable Registry | Safe variable dictionary per event with description, validation, and auto-fallback for missing values (no "undefined"/"null"). | M1 | ORIGINAL_REQUEST §R3 |
| F3 | Telegram HTML Template Renderer | Safe renderer with HTML parse mode escaping (`&`, `<`, `>`), tag whitelisting (`<b>`, `<i>`, `<code>`, `<pre>`, `<a>`), length capping (4,096 chars), and `{{dashboard_url}}` generation. | M1 | ORIGINAL_REQUEST §R3 |
| F4 | Transparent Fallback Mechanism | If custom template is disabled, empty, or absent, system automatically falls back to default hardcoded message without disruption. | M1 | ORIGINAL_REQUEST §R6 |
| F5 | Notification Isolation & Resilience | Telegram dispatch errors or template rendering issues never fail orders, alter inventory, or block courier actions. | M1 | ORIGINAL_REQUEST §R6 |
| F6 | Encrypted Template Persistence | Persist template drafts, active templates, and toggles in `data/private/admin-settings.enc` using existing AES-256-GCM architecture without database migrations. | M2 | ORIGINAL_REQUEST §R6 |
| F7 | Two-Way Runtime Parity (Node & PHP) | Both Node.js (`lib/admin-settings-store.js`) and Hostinger PHP 8.3 (`api/admin-settings.php`) support identical template schema, encryption, and locking. | M2 | ORIGINAL_REQUEST §R6 |
| F8 | Authenticated Mutation Endpoints | Extend `/api/admin-settings` with actions: `save_template`, `activate_template`, `restore_template`, `toggle_template`, `send_test_message`, `send_custom_message` with CSRF & auth validation. | M2 | ORIGINAL_REQUEST §R6 |
| F9 | Credential Secrecy & Sanitization | Bot tokens are never exposed in API responses or frontend payloads; tokens redacted in logs; customer phones masked. | M2 | ORIGINAL_REQUEST §R2, §R6 |
| F10 | Rate Limiting on Test Dispatches | Enforce rate limiting on test message sends to prevent Telegram API flood limits. | M2 | ORIGINAL_REQUEST §R6 |
| F11 | Admin Message Customization UI | Dedicated section under Settings → Integrations → Telegram → Message Customization with Arabic RTL layout, Tajawal typography, and event list selector. | M3 | ORIGINAL_REQUEST §R2 |
| F12 | Visual Editor & Variable Insertion | Visual message editor with context-aware dropdown inserting only valid variables for selected event, format helpers, and character counter. | M3 | ORIGINAL_REQUEST §R2, §R3 |
| F13 | Live Interactive Preview | Real-time preview card rendering synthetic sample data inside a simulated Telegram chat bubble. | M3 | ORIGINAL_REQUEST §R2 |
| F14 | Draft, Activate & Restore Controls | Dedicated controls to Save Draft, Activate Template, and Restore Default Template with immediate toast feedback. | M3 | ORIGINAL_REQUEST §R2 |
| F15 | Custom Admin Message Composer | Free-form administrative announcement composer with title/body editing, live preview, authorized destination lock, and explicit confirmation dialog. | M3 | ORIGINAL_REQUEST §R4 |
| F16 | Send Test Message Action | Test trigger dispatching synthetic data prefixed with `[TEST]` to authorized admin chat without modifying database or alerting customers. | M3 | ORIGINAL_REQUEST §R5 |
| F17 | Static Dashboard Build & Sync | Compile Next.js dashboard (`npm run build`) to `out/` and synchronize to root `admin/` and `dist-hostinger/admin/`. | M3 | ORIGINAL_REQUEST §R2 |
| F18 | Automated E2E Test Suite (Tiers 1-4) | Comprehensive test suite covering template CRUD, variables, escaping, RTL/Arabic, length, test routing, CSRF, credential secrecy, deduplication, and fallback. | M4 | ORIGINAL_REQUEST §R7 |
| F19 | Adversarial Coverage Hardening (Tier 5) | White-box stress-testing and boundary verification with adversarial edge cases. | M4 | ORIGINAL_REQUEST §R7 |
| F20 | Staging Validation & Completion Report | Verification on live Hostinger Staging environment (`https://staging.orva-store.com`) and final completion documentation. | M4 | ORIGINAL_REQUEST §R7 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Core Template Engine & Variable Registry | `lib/telegram-template-engine.js`, integration in `lib/telegram-notifier.js`, variable registry, HTML escaping, missing value handling, fallback | none | **DONE** |
| M2 | Settings Persistence, Admin APIs & Security | `lib/admin-settings-store.js`, `api/admin-settings.js`, PHP parity in `api/admin-settings.php`, template CRUD actions, test dispatch, rate limiting, CSRF | M1 | **DONE** |
| M3 | Admin Settings Center UI & Static Build | `settings-integrations.tsx`, Arabic RTL message customization, variable dropdown, live preview, composer, confirmation modal, Next.js build & sync | M1, M2 | **DONE** |
| M4 | Final Milestone: 100% E2E Pass, Hardening & Staging Validation | Execute E2E suite (Tiers 1-4), adversarial hardening (Tier 5), Staging validation on `https://staging.orva-store.com`, final report | M1, M2, M3 | PLANNED |

## Interface Contracts

### 1. Template Engine API (`lib/telegram-template-engine.js`)
```javascript
// Registry
getEventRegistry(): Record<string, { labelAr: string, description: string, allowedVariables: string[], defaultTemplate: string }>
isValidVariable(event: string, variableName: string): boolean
getEventVariables(event: string): Array<{ key: string, labelAr: string, sampleValue: string }>

// Rendering & Sanitization
renderTemplate(templateText: string, context: Record<string, any>, options?: { isTest?: boolean }): { text: string, charCount: number, warnings: string[], truncated: boolean }
escapeTelegramHtml(rawText: string): string
validateTemplate(event: string, templateText: string): { valid: boolean, errors: string[], warnings: string[] }
getSampleData(event: string): Record<string, any>
buildDefaultMessage(event: string, orderId: string, data?: Record<string, any>): string
generateDashboardUrl(orderId?: string, baseUrl?: string): string
```

### 2. Settings Persistence Schema (`data/private/admin-settings.enc`)
```json
{
  "telegram": {
    "enabled": true,
    "botToken": "...",
    "chatId": "-1003965560132",
    "updatedAt": "2026-11-04T02:40:00.000Z",
    "templates": {
      "<EVENT_NAME>": {
        "enabled": true,
        "draftTemplate": "...",
        "activeTemplate": "...",
        "updatedAt": "2026-11-04T02:40:00.000Z"
      }
    }
  }
}
```

### 3. Admin API Endpoints (`/api/admin-settings`)
- `GET /api/admin-settings`:
  Returns public projection: `templates: Record<string, { enabled: boolean, activeTemplate: string, draftTemplate: string, isCustomActive: boolean }>` (zero bot tokens).
- `POST /api/admin-settings`:
  - `action: "save_template"`: `{ event: string, draftTemplate: string, enabled?: boolean }`
  - `action: "activate_template"`: `{ event: string }`
  - `action: "restore_template"`: `{ event: string }`
  - `action: "toggle_template"`: `{ event: string, enabled: boolean }`
  - `action: "send_test_message"`: `{ event: string, templateText?: string }` (rate limited: 1 per 3s, max 10/min)
  - `action: "send_custom_message"`: `{ title: string, body: string }` (strictly to authorized `telegram.chatId`)

## Code Layout
- Frontend UI:
  `orvastore Dashbaord v0.9/next-shadcn-admin-dashboard-baseui-main/src/app/(main)/dashboard/settings/`
  - `settings-integrations.tsx`: Integration settings tabs and template customization UI.
  - Subcomponents in `components/settings/` (if modularized): `telegram-template-editor.tsx`, `telegram-live-preview.tsx`, `telegram-composer-dialog.tsx`.
- Compiled Static Assets:
  `admin/` and `dist-hostinger/admin/`
- Backend Modules:
  - `lib/telegram-template-engine.js`: Centralized variable registry, template parsing, HTML escaping, and validation.
  - `lib/telegram-notifier.js`: Dispatches notifications using custom active templates with transparent fallback.
  - `lib/admin-settings-store.js`: Encrypted settings storage and template CRUD.
- API Handlers:
  - `api/admin-settings.js`: Node.js serverless route for settings management and test message dispatch.
  - `api/admin-settings.php`: PHP 8.3 parity route for Hostinger LiteSpeed runtime.
  - `api/send-order.php`: PHP checkout notification sender.
- Storage & Data:
  - `data/private/admin-settings.enc`: Encrypted settings store.
  - `data/locks/admin-settings.lock/`: Cross-process directory mutex lock.
  - `data/telegram-dispatch-ledger.json`: Notification deduplication ledger.
- Testing Suite:
  - `tests/test-telegram-template-engine.js`: Engine and registry unit tests.
  - `tests/test-telegram-settings-api.js`: Settings persistence, API actions, and security tests.
  - `scripts/test-phase8f-telegram-customization.js`: Comprehensive E2E test runner (Tiers 1-4).

