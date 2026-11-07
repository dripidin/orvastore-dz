# Staging Stabilization Deployment Manifest

Generated: 2026-11-06 23:05:35 UTC
Package: `orva-store-staging-stabilization.zip` (0.076 MB)
Target host: `https://staging.orva-store.com`
Target directory (Hostinger): `/home/u520776094/domains/orva-store.com/public_html/staging`
Production root: DO NOT TOUCH `/home/u520776094/domains/orva-store.com/public_html/`

## Files included

| Path | Bytes | SHA256 (prefix) |
|------|------:|-----------------|
| `api/send-order.php` | 28153 | `2641A8B06F1D97C0` |
| `api/delivery.php` | 35323 | `8F06D7B06CA1DF43` |
| `api/auth.php` | 5278 | `2A2B5347924E2313` |
| `api/admin-settings.php` | 55153 | `812C432EE1B3BD87` |
| `api/config.php` | 16953 | `3D7556F136A4FC4E` |
| `api/codflow.php` | 26438 | `CEA4055B919F79F5` |
| `api/publish-page.php` | 15111 | `A320AB126FBF5FE1` |
| `api/analytics.php` | 7738 | `1C2084701ADAFEE3` |
| `lib/inventory-store.php` | 14316 | `650B084092038E95` |
| `lib/admin-session.php` | 7895 | `0833DE9EEA4E1BA8` |
| `packs-client.js` | 27762 | `169B50C628F03FE8` |
| `script.js` | 34484 | `CDF48864182464F1` |
| `data/products-catalog.json` | 6488 | `ACC97C9315080468` |
| `data/algeria-communes.json` | 27292 | `1EC18F7F3025815C` |
| `data/wilayas-tariffs.json` | 7838 | `A94D23CB92A063F1` |

## Explicitly excluded

- Secrets (`.env`, `secure-config.php`, `secret-keys.php`, `data/private/**`)
- `data/inventory-state.json` (preserve Staging stock ledger; local file has 49 Pack1 reservations pending reconcile)
- Idempotency / telegram ledgers
- Full dashboard rebuild / `admin/` (not required for these PHP/checkout fixes)

## Pre-deploy backup checklist (Staging only)

Before replacing each file on Staging, copy the live file to:

`/home/u520776094/domains/orva-store.com/public_html/staging/_backup_stabilization_YYYYMMDD/`

Minimum backups:
- `api/send-order.php`
- `api/delivery.php`
- `api/auth.php`
- `api/admin-settings.php`
- `api/config.php`
- `api/codflow.php`
- `api/publish-page.php`
- `api/analytics.php`
- `lib/inventory-store.php`
- `lib/admin-session.php`
- `packs-client.js`
- `script.js`
- `data/products-catalog.json`
- `data/algeria-communes.json`
- `data/wilayas-tariffs.json`
- `data/inventory-state.json` (even though not replaced)
- `data/private/` (permissions only; do not download secrets into Git)

## Deploy steps (Hostinger MCP unavailable in this session)

1. Open Hostinger hPanel → Files → `public_html/staging`.
2. Create backup folder `_backup_stabilization_YYYYMMDD`.
3. Move/copy current versions of the listed files into the backup folder.
4. Upload and extract `orva-store-staging-stabilization.zip` into `public_html/staging` (merge/overwrite listed paths only).
5. Confirm `lib/inventory-store.php` and `lib/admin-session.php` exist.
6. Confirm Staging secure config outside web root still sets:
   - `APP_ENV=staging`
   - `SUPABASE_SCHEMA=staging`
   - `SUPABASE_STAGING_TOKEN=...` (staging_user JWT)
   - Do **not** set `SUPABASE_SERVICE_ROLE_KEY` on Staging.
7. Run focused Staging tests from the status report.

## Rollback

Restore files from `_backup_stabilization_YYYYMMDD` over the same paths.
