# E2E Test Infra: Telegram Message Customization & Template Manager

## Test Philosophy
- Opaque-box, requirement-driven. Derived strictly from `ORIGINAL_REQUEST.md` and user-facing specifications, completely independent of implementation internals.
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial Testing + Real-World Workload Scenarios.

## Feature Inventory
| # | Feature | Source (Requirement) | Tier 1 (Coverage) | Tier 2 (Boundaries) | Tier 3 (Pairwise) |
|---|---------|----------------------|:-----------------:|:-------------------:|:-----------------:|
| F1 | Architecture & Event Mapping (5 events) | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| F2 | Centralized Variable Registry | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| F3 | Telegram HTML Template Renderer & Escaping | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| F4 | Transparent Fallback Mechanism | ORIGINAL_REQUEST §R6 | 5 | 5 | ✓ |
| F5 | Notification Isolation & Order Decoupling | ORIGINAL_REQUEST §R6 | 5 | 5 | ✓ |
| F6 | Encrypted Template Persistence | ORIGINAL_REQUEST §R6 | 5 | 5 | ✓ |
| F7 | Two-Way Runtime Parity (Node & PHP) | ORIGINAL_REQUEST §R6 | 5 | 5 | ✓ |
| F8 | Authenticated Admin Mutation Endpoints | ORIGINAL_REQUEST §R6 | 5 | 5 | ✓ |
| F9 | Credential Secrecy & Redaction | ORIGINAL_REQUEST §R2, §R6 | 5 | 5 | ✓ |
| F10 | Rate Limiting on Test Dispatches | ORIGINAL_REQUEST §R6 | 5 | 5 | ✓ |
| F11 | Admin Customization UI & RTL | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| F12 | Visual Editor & Variable Insertion Menu | ORIGINAL_REQUEST §R2, §R3 | 5 | 5 | ✓ |
| F13 | Live Interactive Preview | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| F14 | Draft, Activate & Restore Controls | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| F15 | Custom Admin Message Composer | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ |
| F16 | Send Test Message Action | ORIGINAL_REQUEST §R5 | 5 | 5 | ✓ |

## Test Architecture
- Test runner: `node scripts/test-phase8f-telegram-customization.js`
- Test framework: Native Node.js `node:assert`, `node:crypto`, `node:http`, `node:https`.
- Pass/Fail Semantics: Process exits with code 0 on 100% pass, non-zero code on any failure.
- Directory layout:
  - `scripts/test-phase8f-telegram-customization.js`: Master E2E runner.
  - `tests/test-telegram-template-engine.js`: Engine & registry tests.
  - `tests/test-telegram-settings-api.js`: Settings persistence, API mutation & security tests.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Admin customizes `ORDER_CREATED` template with custom Arabic greeting and `{{dashboard_url}}`, previews with synthetic Algerian customer, saves draft, activates template, and verifies live checkout renders custom notification. | F1, F2, F3, F6, F8, F12, F13, F14 | High |
| 2 | Courier creates waybill (`SHIPMENT_CREATED`), delivery tracking updates to `DELIVERED_TO_CUSTOMER` (`STATUS_UPDATED`), custom active template dispatches without blocking courier API or webhook handler. | F1, F2, F3, F5, F6 | High |
| 3 | Admin composes urgent custom broadcast announcement in Composer, previews with live character count, confirms dispatch modal, and message arrives strictly in authorized Telegram admin chat. | F8, F9, F15 | Medium |
| 4 | Admin sends test message for `ORDER_CANCELLED`, receives synthetic test notification with `[TEST]` prefix, while store database records, inventory counts, and customer phone numbers remain completely untouched. | F5, F8, F9, F10, F16 | High |
| 5 | Custom template contains malformed HTML or invalid tags; system safely sanitizes markup, logs warning, and dispatches without throwing or crashing checkout. Disabling custom template immediately reverts to default built-in message. | F3, F4, F5, F8, F14 | High |

## Coverage Thresholds
- Tier 1: ≥5 per feature (80 test cases across 16 features)
- Tier 2: ≥5 per feature (boundary and error-handling tests)
- Tier 3: Pairwise coverage across major feature interactions
- Tier 4: ≥5 realistic application scenarios

