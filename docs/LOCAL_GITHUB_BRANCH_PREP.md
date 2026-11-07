# Local GitHub branch preparation (no remote actions)

## Intended mapping (not wired yet)

| Branch | Target document root | Site |
|--------|----------------------|------|
| `main` | `public_html` | Production `orva-store.com` |
| `staging` | `public_html/staging` | Staging `staging.orva-store.com` |

## Local status (2026-11-07)

- Current working branch: `release/v1.0` (many uncommitted local changes preserved).
- Remote branches today: `main`, `release/v1.0`.
- Local `staging` branch: **not created** while the tree is dirty (avoids mixing unfinished work).
- No Hostinger Git attach, no push, no commit performed by this prep.

## When ready to create the local staging branch (manual)

1. Finish or stash unrelated work.
2. `git switch -c staging` from the commit that should become Staging baseline (or from `main` after merging storefront + admin export).
3. Ensure `admin/` static export (including nested dashboard routes) is present on that branch.
4. Do **not** push until explicitly approved.

## Admin dashboard packaging

Source build (when dashboard source tree is available):

```bat
npm run build:dashboard
```

This runs the Next build under `orvastore Dashbaord v0.9/...` then `node scripts/sync-admin.js`.

Verify export routes locally:

```bat
php scripts/verify-admin-export-routes.php
```

## Mutable vs source-controlled data

| Path | Recommendation |
|------|----------------|
| `data/inventory-state.json` | Runtime mutable — keep backups; prefer gitignore + seed example before future commits |
| `data/products-catalog.json` | Catalog may stay tracked; treat inventory separately |
| `data/idempotency-records.json` | Already gitignored |
| `data/private/*` | Secrets — gitignored |
| `data/local-fixtures/orders-store.json` | Local mock DB — gitignored |
| `data/local-fixtures/*.example.json` | Tracked seeds |

Existing inventory/catalog files were **not** deleted. Backup copies live under `backups/local-impl-2026-11-07/`.
