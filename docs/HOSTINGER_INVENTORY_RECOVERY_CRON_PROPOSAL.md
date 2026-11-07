# Hostinger Cron — Abandoned Checkout Recovery (PROPOSAL ONLY)

**Status:** Recommendation only. Do **not** configure a Hostinger cron job yet.

## Hostinger runtime finding (read-only)

- `staging.orva-store.com` and `orva-store.com` are Hostinger websites with `website_type: other` (not Node.js app hosting).
- Staging PHP is **8.3.36**.
- Extension **`pdo_pgsql` is currently disabled** on Staging (must be enabled before PG inventory / PHP recovery).
- Prefer **PHP CLI** recovery on shared hosting; do not depend on Node CLI.

## Primary command (PHP — Hostinger shared)

```bash
/usr/bin/php /home/u520776094/domains/orva-store.com/public_html/staging/scripts/recover-abandoned-reservations.php --apply --threshold-ms=900000
```

Adjust the path if the Staging docroot differs. Do **not** pass any assume-no-order flag.

## Fallback (only if a Node.js runtime is later provisioned)

```bash
/usr/bin/node /home/u520776094/domains/orva-store.com/public_html/staging/scripts/recover-abandoned-reservations.js --apply --threshold-ms 900000
```

## Schedule

- Every 15 minutes (cron expression: minute step 15).
- Matches default recovery threshold so in-flight checkouts are not reaped early.

## Safety requirements

| Rule | How |
|------|-----|
| Only approved recovery process | PHP `scripts/recover-abandoned-reservations.php` (or Node twin) |
| Reconcile order existence/status | REST order lookup; fail closed if unavailable |
| Never release historical rows | Requires `lifecycle=CHECKOUT_PENDING`; NULL/ORDER_BOUND skipped |
| Preserve 51 historical RESERVED | Those rows lack `CHECKOUT_PENDING` |
| Prevent concurrent recovery | `flock` + `data/locks/inventory-recovery.lock` |
| Sanitized logs | Counts + order-id prefixes only |
| Idempotent | Second run releases 0 for already RELEASED / non-pending rows |

## Suggested flock wrapper

```bash
flock -n $HOME/tmp/orva-inventory-recovery.lock \
  /usr/bin/php /home/u520776094/domains/orva-store.com/public_html/staging/scripts/recover-abandoned-reservations.php --apply --threshold-ms=900000 \
  >> $HOME/logs/orva-inventory-recovery.log 2>&1
```

## Not included yet

- No Hostinger cron entry created
- No Production schedule enabled
- `pdo_pgsql` not enabled yet on Staging (blocker for PG-backed recovery)
