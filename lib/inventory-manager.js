'use strict';
// =============================================================================
// ORVA STORE — Atomic Inventory Reservation Manager (Phase 8C.2)
// Cross-Process Concurrency Safety, Invariant: TotalPhysical = Available + Reserved
// Idempotent Operations by orderId, Crash Recovery Reconciler, Audit Ledger
// =============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const INVENTORY_FILE = path.join(ROOT_DIR, 'data', 'inventory-state.json');
const AUDIT_FILE = path.join(ROOT_DIR, 'data', 'inventory-audit.json');
const LOCKS_DIR = path.join(ROOT_DIR, 'data', 'locks');
const INVENTORY_LOCK_DIR = path.join(LOCKS_DIR, 'inventory_active.lock');

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
    if (!fs.existsSync(LOCKS_DIR)) {
        fs.mkdirSync(LOCKS_DIR, { recursive: true });
    }

    const timeout = 10000;
    const startTime = Date.now();
    let acquired = false;

    while (!acquired) {
        try {
            fs.mkdirSync(INVENTORY_LOCK_DIR);
            acquired = true;
        } catch (err) {
            if (err.code === 'EEXIST') {
                try {
                    const stat = fs.statSync(INVENTORY_LOCK_DIR);
                    if (Date.now() - stat.mtimeMs > 10000) {
                        try {
                            fs.rmdirSync(INVENTORY_LOCK_DIR);
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
            fs.rmdirSync(INVENTORY_LOCK_DIR);
        } catch (_) {}
    }
}

function loadInventoryState() {
    try {
        if (fs.existsSync(INVENTORY_FILE)) {
            const raw = fs.readFileSync(INVENTORY_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (!data.reservations) data.reservations = {};
            return data;
        }
    } catch (err) {
        console.warn('[InventoryManager] Error loading inventory file:', err.message);
    }
    return { version: 2, lastUpdated: new Date().toISOString(), inventory: {}, reservations: {} };
}

function saveInventoryState(state) {
    state.lastUpdated = new Date().toISOString();
    const tempFile = `${INVENTORY_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.mkdirSync(path.dirname(INVENTORY_FILE), { recursive: true });
    fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tempFile, INVENTORY_FILE);
}

function recordAuditLog(entry) {
    try {
        let audit = [];
        if (fs.existsSync(AUDIT_FILE)) {
            const raw = fs.readFileSync(AUDIT_FILE, 'utf8');
            audit = JSON.parse(raw);
            if (!Array.isArray(audit)) audit = [];
        }
        audit.push({
            id: `adj_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            timestamp: new Date().toISOString(),
            ...entry
        });
        const tempFile = `${AUDIT_FILE}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tempFile, JSON.stringify(audit, null, 2), 'utf8');
        fs.renameSync(tempFile, AUDIT_FILE);
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
    const state = loadInventoryState();
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

            // Record reservation state for idempotency tracking
            if (orderId) {
                state.reservations[orderId] = {
                    sku: cleanSku,
                    quantity: qty,
                    status: 'RESERVED',
                    timestamp: new Date().toISOString()
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

    return withCrossProcessInventoryLock(async () => {
        return withSkuLock(cleanSku, async () => {
            const state = loadInventoryState();
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

    return withCrossProcessInventoryLock(async () => {
        return withSkuLock(cleanSku, async () => {
            const state = loadInventoryState();
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
 * Crash Recovery Reconciler
 * Automatically scans active reservations and recovers orphaned reservations older than maxAgeMs
 */
async function reconcileStaleReservations(maxAgeMs = 15 * 60 * 1000, validOrderIds = null) {
    return withCrossProcessInventoryLock(async () => {
        const state = loadInventoryState();
        if (!state.reservations) return { recoveredCount: 0 };
        const now = Date.now();
        let recoveredCount = 0;

        for (const [orderId, res] of Object.entries(state.reservations)) {
            if (res.status === 'RESERVED') {
                const resAge = now - new Date(res.timestamp).getTime();
                const isOrphan = validOrderIds ? !validOrderIds.has(orderId) : (resAge > maxAgeMs);
                if (isOrphan && resAge > maxAgeMs) {
                    const item = state.inventory[res.sku];
                    if (item) {
                        const actualRelease = Math.min(item.reserved, res.quantity);
                        item.reserved -= actualRelease;
                        item.available = Math.min(item.totalPhysical, item.available + actualRelease);
                        res.status = 'RELEASED';
                        res.releasedAt = new Date().toISOString();
                        res.releaseReason = 'STALE_CRASH_RECOVERY';
                        recoveredCount++;

                        recordAuditLog({
                            sku: res.sku,
                            orderId,
                            action: 'RECOVER_STALE_RESERVATION',
                            quantity: actualRelease,
                            availableAfter: item.available,
                            reservedAfter: item.reserved,
                            totalPhysical: item.totalPhysical
                        });
                    }
                }
            }
        }

        if (recoveredCount > 0) {
            saveInventoryState(state);
        }
        return { recoveredCount };
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
    setStockExplicit,
    withSkuLock,
    withCrossProcessInventoryLock
};
