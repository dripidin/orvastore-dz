# ORVA STORE — Vercel Preview Fix (Local Only)

**Date:** 2026-11-07  
**Commit that failed preview:** `9c5ea2f`  
**Deployed remotely:** No (local prep only)

## Root cause

Vercel treats `/api/admin-settings` as one route. The repo has both:

- `api/admin-settings.js` (Vercel / Node)
- `api/admin-settings.php` (Hostinger)

Same basename pairs also exist for `auth`, `delivery`, `publish-page`, `send-order`.

Error: *Two or more files have conflicting paths… `api/admin-settings.js` conflicts with `api/admin-settings.php`.*

## Fix applied (local)

| Change | Purpose |
|--------|---------|
| `.vercelignore` | Exclude `**/*.php` (and Hostinger-only bulk) so Vercel only sees Node APIs |
| `vercel.json` | Add `/pack3` rewrite + API `no-store` headers |
| `scripts/vercel-path-conflicts.js` + `npm run check:vercel-paths` | Guard against shipping without PHP ignore |
| `admin.js` login error copy | Mentions Vercel **or** server config (not Vercel-only) |
| `.env.example` | Note that Vercel Preview needs `ADMIN_PASSWORD` / `ADMIN_API_TOKEN` |

## ADMIN_PASSWORD note

Preview login message (*Mot de passe incorrect… ADMIN_PASSWORD sur Vercel*) means the **Node** `/api/auth` rejected the password. After the path conflict is fixed, set matching `ADMIN_PASSWORD` and `ADMIN_API_TOKEN` in the Vercel project env (Preview + Production). Local `.env.local` already has both keys present (values not logged).

## A/B local verification

| Lane | Base | Storefront Pack 3 name | pack3.html | Pixel ID | Admin login |
|------|------|------------------------|------------|----------|-------------|
| **A — Node (Vercel-like)** | http://localhost:3000 | Pass | 200 | Pass | Pass with `.env.local` `ADMIN_PASSWORD` (wrong → 401, right → 200) |
| **B — PHP (Hostinger-like)** | http://127.0.0.1:8000 | Pass | 200 | Pass | Pass with `data/private/local-secure-config.php` password; `.env.local` password rejected (PHP loads local secure override) |

Browser (lane A): home shows three renamed packs; Pack 3 CTA present.

`npm run check:vercel-paths` → OK (5 pairs; PHP ignored for Vercel).

## Next (manual — not done here)

1. Commit/push `.vercelignore` + `vercel.json` (+ related) so Preview rebuilds.
2. In Vercel project **orvastore** → Environment Variables: set Preview `ADMIN_PASSWORD` + `ADMIN_API_TOKEN` to the intended values.
3. Do **not** delete PHP APIs from the repo (Hostinger still needs them).

## Not done

- No `git push`
- No Vercel / Hostinger deploy
- Vercel dashboard env vars not changed from this machine
