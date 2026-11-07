'use strict';
// =============================================================================
// ORVA STORE — Atomic Inventory Reservation Manager (Phase 8C.2)
// Cross-Process Concurrency Safety, Invariant: TotalPhysical = Available + Reserved
// Idempotent Operations by orderId, Crash Recovery Reconciler, Audit Ledger
//
// Hostinger Production first launch: ORVA_INVENTORY_BACKEND=json (default).
// Postgres is opt-in (ORVA_INVENTORY_BACKEND=postgres). No silent fallback.
// Vercel must not mutate Hostinger JSON inventory (refuse JSON writes on VERCEL).
// =============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');

function resolveInventoryBackend() {
    let raw = String(process.env.ORVA_INVENTORY_BACKEND || '').trim().toLowerCase();
    if (!raw) {
        const requirePg = String(process.env.ORVA_INVENTORY_REQUIRE_PG || '').trim().toLowerCase();
        raw = (requirePg === 'true' || requirePg === '1') ? 'postgres' : 'json';
    }
    if (raw === 'postgres' || raw === 'postgresql' || raw === 'pg') return 'postgres';
    if (raw === 'json' || raw === 'file') return 'json';
    return 'invalid';
}

function getInventoryPaths() {
    const file = String(process.env.ORVA_INVENTORY_STATE_PATH || '').trim()
        || path.join(ROOT_DIR, 'data', 'inventory-state.json');
    const locksDir = String(process.env.ORVA_INVENTORY_LOCKS_DIR || '').trim()
        || path.join(path.dirname(file), 'locks');
    const audit = String(process.env.ORVA_INVENTORY_AUDIT_PATH || '').trim()
        || path.join(path.dirname(file), 'inventory-audit.json');
    return {
        file,
        locksDir,
        lockDir: path.join(locksDir, 'inventory_active.lock'),
        audit,
        backend: resolveInventoryBackend(),
    };
}

function assertJsonBackendWritable() {
    const backend = resolveInventoryBackend();
    if (backend !== 'json') {
        const err = new Error('INVENTORY_BACKEND_MISMATCH');
        err.code = 'INVENTORY_BACKEND_MISMATCH';
        throw err;
    }
    // Prevent split-brain: Vercel must not write Hostinger's JSON inventory file.
    if (process.env.VERCEL && String(process.env.ORVA_INVENTORY_ALLOW_VERCEL_JSON || '').toLowerCase() !== 'true') {
        const err = new Error('INVENTORY_JSON_DISABLED_ON_VERCEL');
        err.code = 'INVENTORY_JSON_DISABLED_ON_VERCEL';
        throw err;
    }
}

function loadInventoryStateForMutation() {
    assertJsonBackendWritable();
    const { file } = getInventoryPaths();
    if (!fs.existsSync(file)) {
        const err = new Error('INVENTORY_UNAVAILABLE');
        err.code = 'INVENTORY_UNAVAILABLE';
        throw err;
    }
    try {
        const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') {
            const err = new Error('INVENTORY_UNAVAILABLE');
            err.code = 'INVENTORY_UNAVAILABLE';
            throw err;
        }
        if (!data.reservations) data.reservations = {};
        if (!data.inventory) data.inventory = {};
        return data;
    } catch (err) {
        if (err.code === 'INVENTORY_UNAVAILABLE') throw err;
        const e = new Error('INVENTORY_UNAVAILABLE');
        e.code = 'INVENTORY_UNAVAILABLE';
        throw e;
    }
}

// In-process per-SKU promise queue for intra-process concurrency
const skuMutexQueues = new Map();

function withSkuLock(sku, fn) {
    const cleanSku = String(sku).toUpperCase().trim();
    let currentQueue = skuMutexQueues.get(cleanSku) || Promise.resolve();

    const nextQueue = currentQueue.then(async () => {
        try {
            return await fn();
        } catch (err) {
            throw err;
        }
    }).catch(err => {
        throw err;
    });

    skuMutexQueues.set(cleanSku, nextQueue.catch(() => {}));
    return nextQueue;
}

/**
 * Cross-Process Lock for Inventory File
 * Uses atomic directory creation supported natively across all operating systems.
 * Includes auto-reclamation for stale locks (> 10s).
 */
async function withCrossProcessInventoryLock(fn) {
    const { locksDir, lockDir } = getInventoryPaths();
    if (!fs.existsSync(locksDir)) {
        fs.mkdirSync(locksDir, { recursive: true });
    }

    const timeout = 10000;
    const startTime = Date.now();
    let acquired = false;

    while (!acquired) {
        try {
            fs.mkdirSync(lockDir);
            acquired = true;
        } catch (err) {
            if (err.code === 'EEXIST') {
                try {
                    const stat = fs.statSync(lockDir);
                    if (Date.now() - stat.mtimeMs > 10000) {
                        try {
                            fs.rmdirSync(lockDir);
                        } catch (_) {}
                    }
                } catch (_) {}

                if (Date.now() - startTime > timeout) {
                    throw new Error('INVENTORY_LOCK_TIMEOUT');
                }
                await new Promise(r => setTimeout(r, 20));
            } else {
                throw err;
            }
        }
    }

    try {
        return await fn();
    } finally {
        try {
            fs.rmdirSync(lockDir);
        } catch (_) {}
    }
}

function loadInventoryState() {
    try {
        const { file } = getInventoryPaths();
        if (fs.existsSync(file)) {
            const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
            const data = JSON.parse(raw);
            if (!data.reservations) data.reservations = {};
            if (!data.inventory) data.inventory = {};
            return data;
        }
    } catch (err) {
        console.warn('[InventoryManager] Error loading inventory file:', err.message);
    }
    return { version: 2, lastUpdated: new Date().toISOString(), inventory: {}, reservations: {} };
}

function saveInventoryState(state) {
    assertJsonBackendWritable();
    const { file } = getInventoryPaths();
    state.lastUpdated = new Date().toISOString();
    const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tempFile, file);
}

function recordAuditLog(entry) {
    try {
        if (resolveInventoryBackend() !== 'json') return;
        const { audit } = getInventoryPaths();
        let auditLog = [];
        if (fs.existsSync(audit)) {
            const raw = fs.readFileSync(audit, 'utf8');
            auditLog = JSON.parse(raw);
            if (!Array.isArray(auditLog)) auditLog = [];
        }
        auditLog.push({
            id: `adj_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            timestamp: new Date().toISOString(),
            ...entry
        });
        const tempFile = `${audit}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tempFile, JSON.stringify(auditLog, null, 2), 'utf8');
        fs.renameSync(tempFile, audit);
    } catch (err) {
        console.warn('[InventoryManager] Audit log write warning:', err.message);
    }
}

function getInventory(sku) {
    const cleanSku = String(sku).toUpperCase().trim();
    const state = loadInventoryState();
    return state.inventory[cleanSku] || null;
}

function ensureSkuInitialized(cleanSku) {
    const state = loadInventoryStateForMutation();
    // Fail closed: never invent stock for unknown SKUs
    if (!state.inventory[cleanSku]) {
        return null;
    }
    return state;
}

/**
 * Atomically reserve stock for an order
 * Idempotent by orderId: Repeated reservation calls for the same orderId return existing state
 */
async function reserveStock(sku, quantity, orderId = null) {
    const cleanSku = String(sku).toUpperCase().trim();
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
        throw new Error('INVALID_RESERVATION_QUANTITY');
    }

    const { shouldUsePgInventory, reserveStockPg } = require('./inventory-pg');
    if (shouldUsePgInventory()) {
        return reserveStockPg(cleanSku, qty, orderId);
    }
    if (resolveInventoryBackend() !== 'json') {
        const err = new Error('INVENTORY_UNAVAILABLE');
        err.code = 'INVENTORY_UNAVAILABLE';
        throw err;
    }

    return withCrossProcessInventoryLock(async () => {
        return withSkuLock(cleanSku, async () => {
            const state = ensureSkuInitialized(cleanSku);
            if (!state) {
                const err = new Error('INVENTORY_SKU_MISSING');
                err.code = 'INVENTORY_SKU_MISSING';
                throw err;
            }
            const item = state.inventory[cleanSku];
            if (!state.reservations) state.reservations = {};

            // 1. Idempotency Check by orderId
            if (orderId && state.reservations[orderId]) {
                const existing = state.reservations[orderId];
                if (existing.status === 'RESERVED' || existing.status === 'SETTLED') {
                    return { ...item, duplicateReservation: true, alreadyReserved: true, created: false };
                }
            }

            // 2. Available stock check
            if (item.available < qty) {
                const err = new Error('INSUFFICIENT_STOCK');
                err.code = 'INSUFFICIENT_STOCK';
                err.available = item.available;
                err.requested = qty;
                throw err;
            }

            const availableBefore = item.available;
            const reservedBefore = item.reserved;

            // 3. Atomic state transition
            item.available -= qty;
            item.reserved += qty;

            // 4. Invariant checks
            if (item.available < 0) {
                item.available += qty;
                item.reserved -= qty;
                throw new Error('NEGATIVE_STOCK_PREVENTED');
            }

            if (item.totalPhysical !== item.available + item.reserved) {
                throw new Error('INVENTORY_INVARIANT_VIOLATION');
            }

            // Record reservation state for idempotency tracking.
            // CHECKOUT_PENDING marks the REST gap until order persist binds the row.
            if (orderId) {
                state.reservations[orderId] = {
                    sku: cleanSku,
                    quantity: qty,
                    status: 'RESERVED',
                    lifecycle: 'CHECKOUT_PENDING',
                    timestamp: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
            }

            saveInventoryState(state);

            recordAuditLog({
                sku: cleanSku,
                orderId: orderId || 'UNASSIGNED',
                action: 'RESERVE',
                quantity: qty,
                availableBefore,
                availableAfter: item.available,
                reservedBefore,
                reservedAfter: item.reserved,
                totalPhysical: item.totalPhysical
            });

            return { ...item, created: true, alreadyReserved: false };
        });
    });
}

/**
 * Release reserved stock upon order cancellation or rejection
 * Idempotent by orderId: Repeated release calls return existing state without duplicate release
 */
async function releaseStock(sku, quantity, orderId = null, reason = 'ORDER_CANCELLED') {
    const cleanSku = String(sku).toUpperCase().trim();
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) return null;

    const { shouldUsePgInventory, releaseStockPg } = require('./inventory-pg');
    if (shouldUsePgInventory()) {
        return releaseStockPg(cleanSku, qty, orderId, reason);
    }
    if (resolveInventoryBackend() !== 'json') {
        const err = new Error('INVENTORY_UNAVAILABLE');
        err.code = 'INVENTORY_UNAVAILABLE';
        throw err;
    }

    return withCrossProcessInventoryLock(async () => {
        return withSkuLock(cleanSku, async () => {
            const state = loadInventoryStateForMutation();
            const item = state.inventory[cleanSku];
            if (!item) return null;
            if (!state.reservations) state.reservations = {};

            // Idempotency check: if already released or settled for this orderId, return early
            if (orderId && state.reservations[orderId]) {
                const existing = state.reservations[orderId];
                if (existing.status === 'RELEASED') {
                    return { ...item, alreadyReleased: true };
                }
                if (existing.status === 'SETTLED') {
                    return { ...item, alreadySettled: true };
                }
                existing.status = 'RELEASED';
                existing.releasedAt = new Date().toISOString();
                existing.releaseReason = reason;
            }

            const availableBefore = item.available;
            const reservedBefore = item.reserved;

            const actualRelease = Math.min(item.reserved, qty);
            item.reserved -= actualRelease;
            item.available = Math.min(item.totalPhysical, item.available + actualRelease);

            // Assert invariant
            if (item.totalPhysical !== item.available + item.reserved) {
                throw new Error('INVENTORY_INVARIANT_VIOLATION');
            }

            saveInventoryState(state);

            recordAuditLog({
                sku: cleanSku,
                orderId: orderId || 'UNASSIGNED',
                action: 'RELEASE',
                reason,
                quantity: actualRelease,
                availableBefore,
                availableAfter: item.available,
                reservedBefore,
                reservedAfter: item.reserved,
                totalPhysical: item.totalPhysical
            });

            return { ...item };
        });
    });
}

/**
 * Settle stock upon order delivery / fulfillment
 * Idempotent by orderId: Repeated settlement calls return early without duplicate physical decrement
 */
async function settleStock(sku, quantity, orderId = null) {
    const cleanSku = String(sku).toUpperCase().trim();
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) return null;

    const { shouldUsePgInventory, settleStockPg } = require('./inventory-pg');
    if (shouldUsePgInventory()) {
        return settleStockPg(cleanSku, qty, orderId);
    }
    if (resolveInventoryBackend() !== 'json') {
        const err = new Error('INVENTORY_UNAVAILABLE');
        err.code = 'INVENTORY_UNAVAILABLE';
        throw err;
    }

    return withCrossProcessInventoryLock(async () => {
        return withSkuLock(cleanSku, async () => {
            const state = loadInventoryStateForMutation();
            const item = state.inventory[cleanSku];
            if (!item) return null;
            if (!state.reservations) state.reservations = {};

            if (orderId && state.reservations[orderId]) {
                const existing = state.reservations[orderId];
                if (existing.status === 'SETTLED') {
                    return { ...item, alreadySettled: true };
                }
                existing.status = 'SETTLED';
                existing.settledAt = new Date().toISOString();
            }

            const availableBefore = item.available;
            const reservedBefore = item.reserved;

            const actualSettle = Math.min(item.reserved, qty);
            item.reserved -= actualSettle;
            item.totalPhysical = Math.max(0, item.totalPhysical - actualSettle);

            // Assert invariant
            if (item.totalPhysical !== item.available + item.reserved) {
                throw new Error('INVENTORY_INVARIANT_VIOLATION');
            }

            saveInventoryState(state);

            recordAuditLog({
                sku: cleanSku,
                orderId: orderId || 'UNASSIGNED',
                action: 'SETTLE',
                quantity: actualSettle,
                availableBefore,
                availableAfter: item.available,
                reservedBefore,
                reservedAfter: item.reserved,
                totalPhysical: item.totalPhysical
            });

            return { ...item };
        });
    });
}

/**
 * Crash Recovery Reconciler (safe).
 * Only CHECKOUT_PENDING rows older than maxAgeMs with no matching order are released.
 * Historical RESERVED rows without lifecycle are preserved.
 *
 * @param {number} maxAgeMs
 * @param {Set<string>|null} validOrderIds — if provided, used as order existence set
 * @param {(orderId: string) => Promise<{exists:boolean,processing?:boolean}>|null} [reconcileOrderFn]
 */
async function reconcileStaleReservations(maxAgeMs = 15 * 60 * 1000, validOrderIds = null, reconcileOrderFn = null) {
    const { recoverAbandonedCheckoutReservations } = require('./inventory-recovery');
    return withCrossProcessInventoryLock(async () => {
        const reconcileOrder = async (orderId) => {
            if (typeof reconcileOrderFn === 'function') {
                return reconcileOrderFn(orderId);
            }
            if (validOrderIds instanceof Set) {
                return { exists: validOrderIds.has(orderId) };
            }
            // Without reconciliation data, refuse to release (fail closed for recovery).
            return { exists: true, processing: true };
        };

        const summary = await recoverAbandonedCheckoutReservations({
            thresholdMs: maxAgeMs,
            reconcileOrder,
            loadState: async () => loadInventoryState(),
            saveState: (state) => saveInventoryState(state),
            appendAudit: (entry) => recordAuditLog(entry),
            dryRun: false,
        });
        return { recoveredCount: summary.released, ...summary };
    });
}

async function bindReservationToOrder(orderId) {
    const clean = String(orderId || '').trim();
    if (!clean) return { ok: false, code: 'MISSING_ORDER_ID' };
    if (resolveInventoryBackend() === 'postgres') {
        const { bindReservationToOrderPg } = require('./inventory-pg');
        return bindReservationToOrderPg(clean);
    }
    if (resolveInventoryBackend() !== 'json') {
        return { ok: false, code: 'INVENTORY_UNAVAILABLE' };
    }
    return withCrossProcessInventoryLock(async () => {
        const state = loadInventoryStateForMutation();
        if (!state.reservations || !state.reservations[clean]) {
            return { ok: true, code: 'NO_RESERVATION' };
        }
        const res = state.reservations[clean];
        if (String(res.status || '').toUpperCase() !== 'RESERVED') {
            return { ok: true, code: 'NOT_RESERVED', status: res.status };
        }
        res.lifecycle = 'ORDER_BOUND';
        res.boundAt = new Date().toISOString();
        res.updatedAt = res.boundAt;
        saveInventoryState(state);
        recordAuditLog({
            sku: res.sku,
            orderId: clean,
            action: 'BIND_ORDER',
            quantity: res.quantity,
            lifecycle: 'ORDER_BOUND',
        });
        return { ok: true, bound: true };
    });
}

/**
 * Reset stock to explicit baseline (useful for test setup)
 */
async function setStockExplicit(sku, available, reserved) {
    const cleanSku = String(sku).toUpperCase().trim();
    return withCrossProcessInventoryLock(async () => {
        return withSkuLock(cleanSku, async () => {
            const state = loadInventoryState();
            if (!state.reservations) state.reservations = {};
            state.inventory[cleanSku] = {
                sku: cleanSku,
                available: available,
                reserved: reserved,
                totalPhysical: available + reserved,
                lowStockThreshold: 5
            };
            // Clean out old reservations for this SKU to provide a pure baseline
            for (const [oid, r] of Object.entries(state.reservations)) {
                if (r.sku === cleanSku) {
                    delete state.reservations[oid];
                }
            }
            saveInventoryState(state);
            return { ...state.inventory[cleanSku] };
        });
    });
}

module.exports = {
    loadInventoryState,
    getInventory,
    reserveStock,
    releaseStock,
    settleStock,
    reconcileStaleReservations,
    bindReservationToOrder,
    setStockExplicit,
    withSkuLock,
    withCrossProcessInventoryLock,
    resolveInventoryBackend,
    getInventoryPaths,
};
