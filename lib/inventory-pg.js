'use strict';
/**
 * Postgres-backed inventory: reserve / release / settle with ledger + audit in one txn.
 */
const { getPgPool } = require('./supabaseServer');
const { assertDbSchema, qualifyTable, assertValidOrderId, isLocalUnconfigured, dbConfigured } = require('./db-authority');

function schema() {
    return assertDbSchema(process.env.SUPABASE_SCHEMA || 'public');
}

async function withClient(fn) {
    const pool = getPgPool();
    if (!pool) {
        const err = new Error('STORAGE_UNAVAILABLE');
        err.code = 'STORAGE_UNAVAILABLE';
        throw err;
    }
    const client = await pool.connect();
    try {
        return await fn(client);
    } finally {
        client.release();
    }
}

async function reserveStockPg(sku, quantity, orderId) {
    const cleanSku = String(sku).toUpperCase().trim();
    const qty = parseInt(quantity, 10);
    const cleanOrderId = assertValidOrderId(orderId);
    if (!Number.isFinite(qty) || qty <= 0) {
        const err = new Error('INVALID_RESERVATION_QUANTITY');
        err.code = 'INVALID_RESERVATION_QUANTITY';
        throw err;
    }

    const items = qualifyTable(schema(), 'inventory_items');
    const ledger = qualifyTable(schema(), 'inventory_reservations');
    const audit = qualifyTable(schema(), 'inventory_audit');

    return withClient(async (client) => {
        await client.query('BEGIN');
        try {
            // Serialize same order_id inserts (gap-lock safe under concurrency).
            await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`orva-inv:${cleanOrderId}`]);
            const existing = await client.query(
                `SELECT * FROM ${ledger} WHERE order_id = $1 AND sku = $2 FOR UPDATE`,
                [cleanOrderId, cleanSku]
            );
            if (existing.rows[0]) {
                const row = existing.rows[0];
                if (row.status === 'RESERVED' || row.status === 'SETTLED') {
                    const item = await client.query(`SELECT * FROM ${items} WHERE sku = $1`, [cleanSku]);
                    await client.query('COMMIT');
                    const inv = item.rows[0] || {};
                    return {
                        sku: cleanSku,
                        available: inv.available,
                        reserved: inv.reserved,
                        totalPhysical: inv.total_physical,
                        alreadyReserved: true,
                        created: false,
                    };
                }
            }

            const upd = await client.query(
                `UPDATE ${items}
                 SET available = available - $2,
                     reserved = reserved + $2,
                     updated_at = NOW()
                 WHERE sku = $1 AND available >= $2
                 RETURNING *`,
                [cleanSku, qty]
            );
            if (!upd.rows[0]) {
                const miss = await client.query(`SELECT sku FROM ${items} WHERE sku = $1`, [cleanSku]);
                await client.query('ROLLBACK');
                if (!miss.rows[0]) {
                    const err = new Error('INVENTORY_SKU_MISSING');
                    err.code = 'INVENTORY_SKU_MISSING';
                    throw err;
                }
                const err = new Error('INSUFFICIENT_STOCK');
                err.code = 'INSUFFICIENT_STOCK';
                throw err;
            }
            const inv = upd.rows[0];
            const opId = `RSV-${cleanOrderId}-${cleanSku}`;
            await client.query(
                `INSERT INTO ${ledger} (operation_id, order_id, sku, quantity, status, lifecycle, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, 'RESERVED', 'CHECKOUT_PENDING', NOW(), NOW())
                 ON CONFLICT (order_id, sku) DO UPDATE
                   SET status = 'RESERVED',
                       quantity = EXCLUDED.quantity,
                       lifecycle = 'CHECKOUT_PENDING',
                       updated_at = NOW()
                 WHERE ${ledger}.status NOT IN ('SETTLED')`,
                [opId, cleanOrderId, cleanSku, qty]
            );
            await client.query(
                `INSERT INTO ${audit} (sku, order_id, change_type, quantity, previous_available, new_available, created_at)
                 VALUES ($1, $2, 'RESERVE', $3, $4, $5, NOW())`,
                [cleanSku, cleanOrderId, qty, inv.available + qty, inv.available]
            );
            await client.query('COMMIT');
            return {
                sku: cleanSku,
                available: inv.available,
                reserved: inv.reserved,
                totalPhysical: inv.total_physical,
                created: true,
                alreadyReserved: false,
            };
        } catch (e) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            throw e;
        }
    });
}

async function releaseStockPg(sku, quantity, orderId, reason) {
    const cleanSku = String(sku).toUpperCase().trim();
    const cleanOrderId = assertValidOrderId(orderId);
    const items = qualifyTable(schema(), 'inventory_items');
    const ledger = qualifyTable(schema(), 'inventory_reservations');
    const audit = qualifyTable(schema(), 'inventory_audit');

    return withClient(async (client) => {
        await client.query('BEGIN');
        try {
            const led = await client.query(
                `SELECT * FROM ${ledger} WHERE order_id = $1 AND sku = $2 FOR UPDATE`,
                [cleanOrderId, cleanSku]
            );
            const row = led.rows[0];
            if (!row) {
                await client.query('COMMIT');
                return { alreadyReleased: true };
            }
            if (row.status === 'RELEASED') {
                await client.query('COMMIT');
                return { alreadyReleased: true };
            }
            if (row.status === 'SETTLED') {
                await client.query('COMMIT');
                return { alreadySettled: true };
            }
            const qty = Number(row.quantity) || parseInt(quantity, 10) || 0;
            const upd = await client.query(
                `UPDATE ${items}
                 SET reserved = GREATEST(0, reserved - $2),
                     available = LEAST(total_physical, available + $2),
                     updated_at = NOW()
                 WHERE sku = $1
                 RETURNING *`,
                [cleanSku, qty]
            );
            await client.query(
                `UPDATE ${ledger} SET status = 'RELEASED', release_reason = $3, updated_at = NOW()
                 WHERE order_id = $1 AND sku = $2 AND status = 'RESERVED'`,
                [cleanOrderId, cleanSku, reason || 'ORDER_CANCELLED']
            );
            const inv = upd.rows[0];
            if (inv) {
                await client.query(
                    `INSERT INTO ${audit} (sku, order_id, change_type, quantity, previous_available, new_available, created_at)
                     VALUES ($1, $2, 'RELEASE', $3, $4, $5, NOW())`,
                    [cleanSku, cleanOrderId, qty, inv.available - qty, inv.available]
                );
            }
            await client.query('COMMIT');
            return inv
                ? { sku: cleanSku, available: inv.available, reserved: inv.reserved, totalPhysical: inv.total_physical }
                : {};
        } catch (e) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            throw e;
        }
    });
}

async function settleStockPg(sku, quantity, orderId) {
    const cleanSku = String(sku).toUpperCase().trim();
    const cleanOrderId = assertValidOrderId(orderId);
    const items = qualifyTable(schema(), 'inventory_items');
    const ledger = qualifyTable(schema(), 'inventory_reservations');
    const audit = qualifyTable(schema(), 'inventory_audit');

    return withClient(async (client) => {
        await client.query('BEGIN');
        try {
            const led = await client.query(
                `SELECT * FROM ${ledger} WHERE order_id = $1 AND sku = $2 FOR UPDATE`,
                [cleanOrderId, cleanSku]
            );
            const row = led.rows[0];
            if (!row) {
                await client.query('COMMIT');
                return { alreadySettled: true };
            }
            if (row.status === 'SETTLED') {
                await client.query('COMMIT');
                return { alreadySettled: true };
            }
            if (row.status === 'RELEASED') {
                await client.query('COMMIT');
                return { alreadyReleased: true };
            }
            const qty = Number(row.quantity) || parseInt(quantity, 10) || 0;
            const upd = await client.query(
                `UPDATE ${items}
                 SET reserved = GREATEST(0, reserved - $2),
                     total_physical = GREATEST(0, total_physical - $2),
                     updated_at = NOW()
                 WHERE sku = $1
                 RETURNING *`,
                [cleanSku, qty]
            );
            await client.query(
                `UPDATE ${ledger} SET status = 'SETTLED', updated_at = NOW()
                 WHERE order_id = $1 AND sku = $2 AND status = 'RESERVED'`,
                [cleanOrderId, cleanSku]
            );
            const inv = upd.rows[0];
            if (inv) {
                await client.query(
                    `INSERT INTO ${audit} (sku, order_id, change_type, quantity, previous_available, new_available, created_at)
                     VALUES ($1, $2, 'SETTLE', $3, $4, $5, NOW())`,
                    [cleanSku, cleanOrderId, qty, inv.available, inv.available]
                );
            }
            await client.query('COMMIT');
            return inv
                ? { sku: cleanSku, available: inv.available, reserved: inv.reserved, totalPhysical: inv.total_physical }
                : {};
        } catch (e) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            throw e;
        }
    });
}

/**
 * Explicit backend only. Default is JSON for Hostinger Production first launch.
 * Postgres when ORVA_INVENTORY_BACKEND=postgres (or legacy ORVA_INVENTORY_REQUIRE_PG=true).
 * Never silent-fallback to JSON when postgres is selected, or to PG when json is selected.
 */
function shouldUsePgInventory() {
    let raw = String(process.env.ORVA_INVENTORY_BACKEND || '').trim().toLowerCase();
    if (!raw) {
        const requirePg = String(process.env.ORVA_INVENTORY_REQUIRE_PG || '').trim().toLowerCase();
        raw = (requirePg === 'true' || requirePg === '1') ? 'postgres' : 'json';
    }
    if (raw === 'json' || raw === 'file') return false;
    if (raw === 'postgres' || raw === 'postgresql' || raw === 'pg') {
        // Opt-in postgres path still refuses hosted pooler under local isolation.
        if (isLocalUnconfigured()) return false;
        return Boolean(getPgPool()) || dbConfigured();
    }
    return false;
}

async function bindReservationToOrderPg(orderId) {
    const cleanOrderId = assertValidOrderId(orderId);
    const ledger = qualifyTable(schema(), 'inventory_reservations');
    return withClient(async (client) => {
        const upd = await client.query(
            `UPDATE ${ledger}
             SET lifecycle = 'ORDER_BOUND', updated_at = NOW()
             WHERE order_id = $1 AND status = 'RESERVED'
             RETURNING order_id, lifecycle`,
            [cleanOrderId]
        );
        if (!upd.rows[0]) {
            return { ok: true, code: 'NO_RESERVATION' };
        }
        return { ok: true, bound: true };
    });
}

/**
 * PG recovery: only CHECKOUT_PENDING + age + order reconcile callback.
 */
async function recoverAbandonedCheckoutReservationsPg(opts = {}) {
    const { recoverAbandonedCheckoutReservations, DEFAULT_THRESHOLD_MS } = require('./inventory-recovery');
    const thresholdMs = opts.thresholdMs || DEFAULT_THRESHOLD_MS;
    const reconcileOrder = opts.reconcileOrder;
    if (typeof reconcileOrder !== 'function') {
        throw new Error('RECOVERY_REQUIRES_ORDER_RECONCILE');
    }
    const dryRun = Boolean(opts.dryRun);
    const items = qualifyTable(schema(), 'inventory_items');
    const ledger = qualifyTable(schema(), 'inventory_reservations');
    const audit = qualifyTable(schema(), 'inventory_audit');

    return withClient(async (client) => {
        await client.query('BEGIN');
        try {
            const rows = await client.query(
                `SELECT * FROM ${ledger}
                 WHERE status = 'RESERVED' AND lifecycle = 'CHECKOUT_PENDING'
                 FOR UPDATE`
            );
            const summary = {
                scanned: rows.rows.length,
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
            const cutoff = new Date(Date.now() - thresholdMs).toISOString();
            for (const row of rows.rows) {
                const created = row.created_at || row.updated_at;
                if (!created || new Date(created).toISOString() > cutoff) {
                    summary.skippedYoung += 1;
                    continue;
                }
                summary.eligible += 1;
                const verdict = await reconcileOrder(row.order_id);
                if (verdict && verdict.processing) {
                    summary.skippedProcessing += 1;
                    continue;
                }
                if (verdict && verdict.exists) {
                    if (!dryRun) {
                        await client.query(
                            `UPDATE ${ledger} SET lifecycle = 'ORDER_BOUND', updated_at = NOW()
                             WHERE order_id = $1 AND sku = $2 AND status = 'RESERVED'`,
                            [row.order_id, row.sku]
                        );
                    }
                    summary.skippedOrderExists += 1;
                    continue;
                }
                if (dryRun) {
                    summary.released += 1;
                    summary.releasedOrderIds.push(row.order_id);
                    continue;
                }
                const qty = Number(row.quantity) || 0;
                const upd = await client.query(
                    `UPDATE ${items}
                     SET reserved = GREATEST(0, reserved - $2),
                         available = LEAST(total_physical, available + $2),
                         updated_at = NOW()
                     WHERE sku = $1
                     RETURNING *`,
                    [row.sku, qty]
                );
                await client.query(
                    `UPDATE ${ledger}
                     SET status = 'RELEASED',
                         release_reason = 'CHECKOUT_CRASH_RECOVERY',
                         updated_at = NOW()
                     WHERE order_id = $1 AND sku = $2 AND status = 'RESERVED'
                       AND lifecycle = 'CHECKOUT_PENDING'`,
                    [row.order_id, row.sku]
                );
                const inv = upd.rows[0];
                if (inv) {
                    await client.query(
                        `INSERT INTO ${audit} (sku, order_id, change_type, quantity, previous_available, new_available, created_at)
                         VALUES ($1, $2, 'CHECKOUT_CRASH_RECOVERY', $3, $4, $5, NOW())`,
                        [row.sku, row.order_id, qty, inv.available - qty, inv.available]
                    );
                }
                summary.released += 1;
                summary.releasedOrderIds.push(row.order_id);
            }
            if (dryRun) {
                await client.query('ROLLBACK');
            } else {
                await client.query('COMMIT');
            }
            return summary;
        } catch (e) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            throw e;
        }
    });
}

module.exports = {
    reserveStockPg,
    releaseStockPg,
    settleStockPg,
    bindReservationToOrderPg,
    recoverAbandonedCheckoutReservationsPg,
    shouldUsePgInventory,
};
