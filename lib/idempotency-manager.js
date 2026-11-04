'use strict';
// =============================================================================
// ORVA STORE — Robust Idempotency & Deduplication Engine (Phase 8C.2)
// Key-Based Deduplication, Cross-Process Lock Mutex, Double-Checked Locking
// =============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const IDEMPOTENCY_FILE = path.join(ROOT_DIR, 'data', 'idempotency-records.json');
const LOCKS_DIR = path.join(ROOT_DIR, 'data', 'locks');

// In-flight request promises to prevent duplicate processing on simultaneous hits in same process
const inFlightRequests = new Map();
const inMemoryCache = new Map();

function extractIdempotencyKey(req) {
    const headers = req.headers || {};
    const body = req.body || {};

    const key = headers['idempotency-key'] ||
                headers['x-idempotency-key'] ||
                body.idempotencyKey ||
                body.idempotency_key ||
                body.orderId ||
                null;

    if (key && typeof key === 'string' && key.trim().length >= 4) {
        return key.trim();
    }
    return null;
}

function loadPersistedIdempotency() {
    try {
        if (fs.existsSync(IDEMPOTENCY_FILE)) {
            const raw = fs.readFileSync(IDEMPOTENCY_FILE, 'utf8');
            return JSON.parse(raw);
        }
    } catch (err) {
        console.warn('[IdempotencyManager] Error reading file:', err.message);
    }
    return {};
}

function savePersistedIdempotency(records) {
    try {
        const tempFile = `${IDEMPOTENCY_FILE}.${process.pid}.${Date.now()}.tmp`;
        fs.mkdirSync(path.dirname(IDEMPOTENCY_FILE), { recursive: true });
        fs.writeFileSync(tempFile, JSON.stringify(records, null, 2), 'utf8');
        fs.renameSync(tempFile, IDEMPOTENCY_FILE);
    } catch (err) {
        console.warn('[IdempotencyManager] Error saving file:', err.message);
    }
}

function getStoredIdempotency(key) {
    if (!key) return null;

    // 1. Fast in-memory lookup
    if (inMemoryCache.has(key)) {
        return inMemoryCache.get(key);
    }

    // 2. Persistent file lookup
    const records = loadPersistedIdempotency();
    if (records[key]) {
        inMemoryCache.set(key, records[key]);
        return records[key];
    }

    return null;
}

function recordIdempotency(key, responseData) {
    if (!key || !responseData) return;

    inMemoryCache.set(key, responseData);

    const records = loadPersistedIdempotency();
    records[key] = {
        timestamp: new Date().toISOString(),
        response: responseData
    };
    savePersistedIdempotency(records);
}

/**
 * Cross-Process Lock for a specific Idempotency Key
 * Guarantees cross-process mutex using atomic OS directory semantics.
 */
async function withCrossProcessKeyLock(key, fn) {
    if (!key) return fn();

    if (!fs.existsSync(LOCKS_DIR)) {
        fs.mkdirSync(LOCKS_DIR, { recursive: true });
    }

    const keyHash = crypto.createHash('md5').update(String(key)).digest('hex');
    const lockDir = path.join(LOCKS_DIR, `idemp_${keyHash}.lock`);
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
                        try { fs.rmdirSync(lockDir); } catch (_) {}
                    }
                } catch (_) {}

                if (Date.now() - startTime > timeout) {
                    throw new Error('IDEMPOTENCY_LOCK_TIMEOUT');
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

/**
 * Executes an operation with concurrency locking on the idempotency key.
 * Double-checked locking across processes and intra-process promise chain.
 */
async function withIdempotencyLock(key, executionFn) {
    if (!key) {
        return executionFn();
    }

    // 1. Fast check: already completed?
    const existing = getStoredIdempotency(key);
    if (existing) {
        const resp = existing.response || existing;
        return {
            ...resp,
            idempotent: true
        };
    }

    // 2. Intra-process in-flight promise check
    if (inFlightRequests.has(key)) {
        console.log(`[IdempotencyManager] Concurrent hit (in-process): awaiting in-flight execution for key ${key}`);
        const result = await inFlightRequests.get(key);
        return {
            ...result,
            idempotent: true
        };
    }

    // 3. Cross-process lock with Double-Checked Locking
    return withCrossProcessKeyLock(key, async () => {
        // Re-read after acquiring lock
        const doubleCheck = getStoredIdempotency(key);
        if (doubleCheck) {
            const resp = doubleCheck.response || doubleCheck;
            return {
                ...resp,
                idempotent: true
            };
        }

        const promise = (async () => {
            try {
                const result = await executionFn();
                recordIdempotency(key, result);
                return result;
            } finally {
                inFlightRequests.delete(key);
            }
        })();

        inFlightRequests.set(key, promise);
        return await promise;
    });
}

module.exports = {
    extractIdempotencyKey,
    getStoredIdempotency,
    recordIdempotency,
    withIdempotencyLock,
    withCrossProcessKeyLock
};
