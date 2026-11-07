'use strict';
/**
 * CLI: recover abandoned CHECKOUT_PENDING reservations (local / ops).
 *
 * Usage:
 *   node scripts/recover-abandoned-reservations.js --dry-run
 *   node scripts/recover-abandoned-reservations.js --apply
 *
 * Requires an order reconciler. In local isolation without DB, pass --assume-no-order
 * only for synthetic CHECKOUT_PENDING fixtures (never for historical seed rows).
 *
 * Does NOT connect to hosted Supabase unless DATABASE_URL is a local disposable DB
 * and APP_ENV is not blocking it.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || !args.includes('--apply');
const assumeNoOrder = args.includes('--assume-no-order');
const thresholdMs = (() => {
    const i = args.indexOf('--threshold-ms');
    if (i >= 0 && args[i + 1]) return Number(args[i + 1]);
    return 15 * 60 * 1000;
})();

async function main() {
    const { isLocalUnconfigured } = require('../lib/db-authority');
    const { shouldUsePgInventory, recoverAbandonedCheckoutReservationsPg } = require('../lib/inventory-pg');
    const { reconcileStaleReservations, loadInventoryState } = require('../lib/inventory-manager');

    const reconcileOrder = async (orderId) => {
        if (assumeNoOrder) {
            return { exists: false };
        }
        try {
            const { findOrderById } = require('../lib/db');
            const row = await findOrderById(orderId);
            return { exists: Boolean(row), status: row ? row.status : null };
        } catch (e) {
            // Fail closed: treat as processing so we do not release without proof.
            console.warn('[recover] order reconcile unavailable:', e.message);
            return { exists: true, processing: true };
        }
    };

    let summary;
    if (shouldUsePgInventory()) {
        summary = await recoverAbandonedCheckoutReservationsPg({ thresholdMs, reconcileOrder, dryRun });
    } else if (isLocalUnconfigured()) {
        if (dryRun) {
            const { recoverAbandonedCheckoutReservations } = require('../lib/inventory-recovery');
            summary = await recoverAbandonedCheckoutReservations({
                thresholdMs,
                reconcileOrder,
                dryRun: true,
                loadState: async () => loadInventoryState(),
                saveState: () => {},
            });
        } else {
            summary = await reconcileStaleReservations(thresholdMs, null, reconcileOrder);
        }
    } else {
        console.error('Neither PG inventory nor local-unconfigured JSON path is available.');
        process.exit(2);
    }

    console.log(JSON.stringify({ dryRun, thresholdMs, assumeNoOrder, summary }, null, 2));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
