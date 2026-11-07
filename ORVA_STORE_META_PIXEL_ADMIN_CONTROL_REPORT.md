# Meta Pixel / CAPI — Admin control (local)

**Date:** 2026-11-07  
**Deploy:** not pushed / not deployed

## What admins can do

In **Dashboard → Settings → Analytics & Meta Pixel**:

- Enable / disable browser Pixel  
- Add or change **Pixel ID**  
- Add or clear **CAPI token** (server-only; never sent to browser)  
- Scope: **all storefront pages** or **selected pages** (home, pack1, pack2, pack3, yamaha-archive)  
- Remove Pixel ID entirely  

## How storefront applies it

- Pages load `meta-pixel-loader.js`, which calls `GET /api/admin-settings?action=public`.  
- Pixel injects only if enabled + ID present + (scope=all **or** page selected).  
- Hardcoded Pixel IDs removed from `index.html` / `pack1–3.html`.

## Backend

- Node store already supported scope/pages; allowlist now includes `/pack3.html`.  
- PHP save now persists `scope` + `pages`; public route fails soft without encryption key.  

## Local check

| Check | Result |
|-------|--------|
| PHP `?action=public` | OK; pages include pack3 |
| `meta-pixel-loader.js` on pack3 | Present |
| Admin settings UI rebuilt + synced to `admin/` | Done |

## Ops note

Saving settings needs `ADMIN_SETTINGS_ENCRYPTION_KEY` on the server (Hostinger secure-config / Vercel env). Without it, public config falls back to env `META_PIXEL_ID` only.
