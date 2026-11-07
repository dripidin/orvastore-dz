'use strict';
/**
 * Abandoned checkout reservation recovery.
 *
 * Only releases rows explicitly marked lifecycle=CHECKOUT_PENDING that are older
 * than the recovery threshold AND whose order_id does not exist (reconciled).
 * Historical RESERVED rows without CHECKOUT_PENDING are never auto-released.
 *
 * This does NOT make checkout fully atomic across REST order insert.
 */

const DEFAULT_THRESHOLD_MS = 15 * 60 * 1000;
const PROCESSING_GRACE_MS = 2 * 60 * 1000;

const LIFECYCLE = {
    CHECKOUT_PENDING: 'CHECKOUT_PENDING',
    ORDER_BOUND: 'ORDER_BOUND',
};

function parseAgeMs(iso) {
    if (!iso) return Number.POSITIVE_INFINITY;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
    return Date.now() - t;
}

/**
 * @param {object} opts
 * @param {number} [opts.thresholdMs]
 * @param {(orderId: string) => Promise<{exists:boolean,status?:string|null,processing?:boolean}|null>} opts.reconcileOrder
 * @param {() => Promise<object>} opts.loadState
 * @param {(state: object) => Promise<void>|void} opts.saveState
 * @param {(entry: object) => void} [opts.appendAudit]
 * @param {boolean} [opts.dryRun]
 */
async function recoverAbandonedCheckoutReservations(opts) {
    const thresholdMs = Number(opts.thresholdMs) > 0 ? Number(opts.thresholdMs) : DEFAULT_THRESHOLD_MS;
    const reconcileOrder = opts.reconcileOrder;
    if (typeof reconcileOrder !== 'function') {
        throw new Error('RECOVERY_REQUIRES_ORDER_RECONCILE');
    }
    const dryRun = Boolean(opts.dryRun);
    const state = await opts.loadState();
    if (!state.reservations) state.reservations = {};

    const summary = {
        scanned: 0,
        eligible: 0,
        released: 0,
        skippedBound: 0,
        skippedHistorical: 0,
        skippedYoung: 0,
        skippedOrderExists: 0,
        skippedProcessing: 0,
        skippedAlreadyTerminal: 0,
        dryRun,
        releasedOrderIds: [],
        preservedHistorical: true,
    };

    for (const [orderId, res] of Object.entries(state.reservations)) {
        summary.scanned += 1;
        const status = String(res.status || '').toUpperCase();
        if (status === 'RELEASED' || status === 'SETTLED') {
            summary.skippedAlreadyTerminal += 1;
            continue;
        }
        if (status !== 'RESERVED') continue;

        const lifecycle = String(res.lifecycle || '').toUpperCase();
        if (lifecycle === LIFECYCLE.ORDER_BOUND) {
            summary.skippedBound += 1;
            continue;
        }
        if (lifecycle !== LIFECYCLE.CHECKOUT_PENDING) {
            // Missing lifecycle = historical / pre-recovery ledger. Never auto-release.
            summary.skippedHistorical += 1;
            continue;
        }

        const ageMs = parseAgeMs(res.timestamp || res.reservedAt || res.created_at);
        if (ageMs < thresholdMs) {
            summary.skippedYoung += 1;
            continue;
        }
        // Still inside processing grace after threshold floor — treat as in-flight if very recent update
        const updateAge = parseAgeMs(res.updatedAt || res.timestamp);
        if (updateAge < PROCESSING_GRACE_MS) {
            summary.skippedProcessing += 1;
            continue;
        }

        summary.eligible += 1;
        const verdict = await reconcileOrder(orderId);
        if (verdict && verdict.processing) {
            summary.skippedProcessing += 1;
            continue;
        }
        if (verdict && verdict.exists) {
            // Bind lifecycle instead of releasing — order won the race
            res.lifecycle = LIFECYCLE.ORDER_BOUND;
            res.boundAt = new Date().toISOString();
            summary.skippedOrderExists += 1;
            continue;
        }

        if (dryRun) {
            summary.releasedOrderIds.push(orderId);
            summary.released += 1;
            continue;
        }

        const sku = String(res.sku || '').toUpperCase();
        const qty = Number(res.quantity) || 0;
        const item = state.inventory && state.inventory[sku];
        if (item && qty > 0) {
            const actual = Math.min(Number(item.reserved) || 0, qty);
            item.reserved = (Number(item.reserved) || 0) - actual;
            item.available = Math.min(
                Number(item.totalPhysical) || 0,
                (Number(item.available) || 0) + actual
            );
            if (Number(item.totalPhysical) !== Number(item.available) + Number(item.reserved)) {
                throw new Error('INVENTORY_INVARIANT_VIOLATION');
            }
            if (typeof opts.appendAudit === 'function') {
                opts.appendAudit({
                    sku,
                    orderId,
                    action: 'CHECKOUT_CRASH_RECOVERY',
                    quantity: actual,
                    availableAfter: item.available,
                    reservedAfter: item.reserved,
                    totalPhysical: item.totalPhysical,
                    reason: 'ABANDONED_CHECKOUT_PENDING',
                });
            }
        }

        res.status = 'RELEASED';
        res.releasedAt = new Date().toISOString();
        res.releaseReason = 'CHECKOUT_CRASH_RECOVERY';
        res.lifecycle = LIFECYCLE.CHECKOUT_PENDING; // retain provenance
        summary.released += 1;
        summary.releasedOrderIds.push(orderId);
    }

    if (!dryRun) {
        await opts.saveState(state);
    }
    return summary;
}

module.exports = {
    LIFECYCLE,
    DEFAULT_THRESHOLD_MS,
    PROCESSING_GRACE_MS,
    recoverAbandonedCheckoutReservations,
};
