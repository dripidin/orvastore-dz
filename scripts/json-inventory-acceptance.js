'use strict';
/**
 * Local JSON inventory acceptance — synthetic fixtures only.
 * Does NOT touch data/inventory-state.json (operational / historical ledger).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orva-json-inv-'));
const stateFile = path.join(tmpDir, 'inventory-state.json');
const locksDir = path.join(tmpDir, 'locks');
const auditFile = path.join(tmpDir, 'inventory-audit.json');

process.env.APP_ENV = 'local';
process.env.ORVA_INVENTORY_BACKEND = 'json';
delete process.env.ORVA_INVENTORY_REQUIRE_PG;
delete process.env.DATABASE_URL;
delete process.env.VERCEL;
process.env.ORVA_INVENTORY_STATE_PATH = stateFile;
process.env.ORVA_INVENTORY_LOCKS_DIR = locksDir;
process.env.ORVA_INVENTORY_AUDIT_PATH = auditFile;

const {
    reserveStock,
    releaseStock,
    settleStock,
    bindReservationToOrder,
    resolveInventoryBackend,
    loadInventoryState,
} = require('../lib/inventory-manager');
const { recoverAbandonedCheckoutReservations, LIFECYCLE } = require('../lib/inventory-recovery');
const { shouldUsePgInventory } = require('../lib/inventory-pg');

const results = [];
async function check(name, fn) {
    try {
        await fn();
        results.push({ name, status: 'PASS' });
        console.log('PASS', name);
    } catch (e) {
        results.push({ name, status: 'FAIL', error: e.message });
        console.log('FAIL', name, e.message);
    }
}

function writeState(state) {
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function readState() {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
}

function baseState(overrides = {}) {
    return {
        version: 2,
        lastUpdated: new Date().toISOString(),
        inventory: {
            'ORVA-JSON-TEST': { sku: 'ORVA-JSON-TEST', available: 5, reserved: 0, totalPhysical: 5 },
            'ORVA-LAST-UNIT': { sku: 'ORVA-LAST-UNIT', available: 1, reserved: 0, totalPhysical: 1 },
            'ORVA-P1-PRO': { sku: 'ORVA-P1-PRO', available: 0, reserved: 50, totalPhysical: 50 },
            'ORVA-P2-ELITE': { sku: 'ORVA-P2-ELITE', available: 0, reserved: 1, totalPhysical: 1 },
            'ORVA-DRILL-PRO': { sku: 'ORVA-DRILL-PRO', available: 17, reserved: 3, totalPhysical: 20 },
        },
        reservations: {},
        ...overrides,
    };
}

function seedHistorical51() {
    const reservations = {};
    for (let i = 1; i <= 50; i++) {
        reservations[`HIST-P1-${String(i).padStart(3, '0')}`] = {
            sku: 'ORVA-P1-PRO',
            quantity: 1,
            status: 'RESERVED',
            timestamp: '2025-01-01T00:00:00.000Z',
        };
    }
    reservations['HIST-P2-001'] = {
        sku: 'ORVA-P2-ELITE',
        quantity: 1,
        status: 'RESERVED',
        timestamp: '2025-01-01T00:00:00.000Z',
    };
    return reservations;
}

(async () => {
    await check('backend defaults to json and PG selector is false', async () => {
        assert.strictEqual(resolveInventoryBackend(), 'json');
        assert.strictEqual(shouldUsePgInventory(), false);
    });

    await check('JSON inventory initialization / readable fixture', async () => {
        writeState(baseState());
        const s = loadInventoryState();
        assert.ok(s.inventory['ORVA-JSON-TEST']);
        assert.strictEqual(s.inventory['ORVA-JSON-TEST'].available, 5);
    });

    await check('missing SKU never invents stock', async () => {
        writeState(baseState());
        await assert.rejects(() => reserveStock('ORVA-DOES-NOT-EXIST', 1, 'OID-MISS-001'), (e) => e.code === 'INVENTORY_SKU_MISSING');
        const s = readState();
        assert.strictEqual(s.inventory['ORVA-DOES-NOT-EXIST'], undefined);
    });

    await check('missing inventory file fails closed', async () => {
        const missing = path.join(tmpDir, 'missing-state.json');
        process.env.ORVA_INVENTORY_STATE_PATH = missing;
        try {
            await assert.rejects(() => reserveStock('ORVA-JSON-TEST', 1, 'OID-NOFILE-001'), (e) => e.code === 'INVENTORY_UNAVAILABLE');
        } finally {
            process.env.ORVA_INVENTORY_STATE_PATH = stateFile;
        }
    });

    await check('reserve then duplicate order id is idempotent', async () => {
        writeState(baseState());
        const a = await reserveStock('ORVA-JSON-TEST', 1, 'OID-DUP-001');
        assert.strictEqual(a.created, true);
        const b = await reserveStock('ORVA-JSON-TEST', 1, 'OID-DUP-001');
        assert.strictEqual(b.alreadyReserved, true);
        const s = readState();
        assert.strictEqual(s.inventory['ORVA-JSON-TEST'].available, 4);
        assert.strictEqual(s.inventory['ORVA-JSON-TEST'].reserved, 1);
    });

    await check('concurrent last-unit: only one reserve wins', async () => {
        writeState(baseState());
        const outcomes = await Promise.allSettled([
            reserveStock('ORVA-LAST-UNIT', 1, 'OID-RACE-A'),
            reserveStock('ORVA-LAST-UNIT', 1, 'OID-RACE-B'),
        ]);
        const ok = outcomes.filter((o) => o.status === 'fulfilled');
        const fail = outcomes.filter((o) => o.status === 'rejected');
        assert.strictEqual(ok.length, 1, 'exactly one winner');
        assert.strictEqual(fail.length, 1, 'exactly one loser');
        assert.ok(
            fail[0].reason && (fail[0].reason.code === 'INSUFFICIENT_STOCK' || fail[0].reason.message === 'INSUFFICIENT_STOCK')
        );
        const s = readState();
        assert.strictEqual(s.inventory['ORVA-LAST-UNIT'].available, 0);
        assert.strictEqual(s.inventory['ORVA-LAST-UNIT'].reserved, 1);
    });

    await check('bind after persist; release on simulated storage failure', async () => {
        writeState(baseState());
        const oid = 'OID-FAILSAVE-001';
        await reserveStock('ORVA-JSON-TEST', 1, oid);
        // Simulate crash before bind: recovery would see CHECKOUT_PENDING
        const mid = readState();
        assert.strictEqual(mid.reservations[oid].lifecycle, 'CHECKOUT_PENDING');
        // Compensating release (send-order rollback path)
        await releaseStock('ORVA-JSON-TEST', 1, oid, 'STORAGE_FAILURE_ROLLBACK');
        const after = readState();
        assert.strictEqual(after.reservations[oid].status, 'RELEASED');
        assert.strictEqual(after.inventory['ORVA-JSON-TEST'].available, 5);
        assert.strictEqual(after.inventory['ORVA-JSON-TEST'].reserved, 0);
    });

    await check('cancel release once; duplicate release noop', async () => {
        writeState(baseState());
        const oid = 'OID-CANCEL-001';
        await reserveStock('ORVA-JSON-TEST', 2, oid);
        await bindReservationToOrder(oid);
        const r1 = await releaseStock('ORVA-JSON-TEST', 2, oid, 'ORDER_CANCELLED');
        assert.ok(!r1.alreadyReleased);
        const r2 = await releaseStock('ORVA-JSON-TEST', 2, oid, 'ORDER_CANCELLED');
        assert.strictEqual(r2.alreadyReleased, true);
        const s = readState();
        assert.strictEqual(s.inventory['ORVA-JSON-TEST'].available, 5);
        assert.strictEqual(s.inventory['ORVA-JSON-TEST'].reserved, 0);
    });

    await check('settle once on ship; duplicate settle noop', async () => {
        writeState(baseState());
        const oid = 'OID-SHIP-001';
        await reserveStock('ORVA-JSON-TEST', 1, oid);
        await bindReservationToOrder(oid);
        const s1 = await settleStock('ORVA-JSON-TEST', 1, oid);
        assert.ok(!s1.alreadySettled);
        const s2 = await settleStock('ORVA-JSON-TEST', 1, oid);
        assert.strictEqual(s2.alreadySettled, true);
        const s = readState();
        assert.strictEqual(s.inventory['ORVA-JSON-TEST'].available, 4);
        assert.strictEqual(s.inventory['ORVA-JSON-TEST'].reserved, 0);
        assert.strictEqual(s.inventory['ORVA-JSON-TEST'].totalPhysical, 4);
    });

    await check('checkout pending recovery releases only eligible pending', async () => {
        const oldIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const hist = seedHistorical51();
        hist['PEND-OLD-001'] = {
            sku: 'ORVA-JSON-TEST',
            quantity: 1,
            status: 'RESERVED',
            lifecycle: LIFECYCLE.CHECKOUT_PENDING,
            timestamp: oldIso,
            updatedAt: oldIso,
        };
        writeState(baseState({
            inventory: {
                ...baseState().inventory,
                'ORVA-JSON-TEST': { sku: 'ORVA-JSON-TEST', available: 4, reserved: 1, totalPhysical: 5 },
                'ORVA-P1-PRO': { sku: 'ORVA-P1-PRO', available: 0, reserved: 50, totalPhysical: 50 },
                'ORVA-P2-ELITE': { sku: 'ORVA-P2-ELITE', available: 0, reserved: 1, totalPhysical: 1 },
                'ORVA-DRILL-PRO': { sku: 'ORVA-DRILL-PRO', available: 17, reserved: 3, totalPhysical: 20 },
            },
            reservations: hist,
        }));
        const before = readState();
        const histCountBefore = Object.values(before.reservations).filter((r) => r.status === 'RESERVED' && !r.lifecycle).length;
        assert.strictEqual(histCountBefore, 51);
        const drillBefore = { ...before.inventory['ORVA-DRILL-PRO'] };

        const summary = await recoverAbandonedCheckoutReservations({
            thresholdMs: 15 * 60 * 1000,
            dryRun: false,
            reconcileOrder: async () => ({ exists: false }),
            loadState: async () => readState(),
            saveState: (st) => writeState(st),
            appendAudit: () => {},
        });
        assert.strictEqual(summary.released, 1);
        const after = readState();
        const histCountAfter = Object.values(after.reservations).filter((r) => r.status === 'RESERVED' && !r.lifecycle).length;
        assert.strictEqual(histCountAfter, 51);
        assert.strictEqual(after.reservations['PEND-OLD-001'].status, 'RELEASED');
        assert.deepStrictEqual(after.inventory['ORVA-DRILL-PRO'], drillBefore);
        assert.strictEqual(after.inventory['ORVA-P1-PRO'].reserved, 50);
        assert.strictEqual(after.inventory['ORVA-P2-ELITE'].reserved, 1);
    });

    await check('lifecycle=NULL historical never released by recovery', async () => {
        const oldIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        writeState(baseState({
            inventory: {
                'ORVA-JSON-TEST': { sku: 'ORVA-JSON-TEST', available: 4, reserved: 1, totalPhysical: 5 },
            },
            reservations: {
                'HIST-NULL-001': {
                    sku: 'ORVA-JSON-TEST',
                    quantity: 1,
                    status: 'RESERVED',
                    timestamp: oldIso,
                },
            },
        }));
        const summary = await recoverAbandonedCheckoutReservations({
            thresholdMs: 1000,
            dryRun: false,
            reconcileOrder: async () => ({ exists: false }),
            loadState: async () => readState(),
            saveState: (st) => writeState(st),
            appendAudit: () => {},
        });
        assert.strictEqual(summary.released, 0);
        assert.strictEqual(readState().reservations['HIST-NULL-001'].status, 'RESERVED');
    });

    await check('PHP JSON acceptance on temp fixture', async () => {
        writeState(baseState());
        const php = spawnSync('php', [path.join(__dirname, 'php-json-inventory-acceptance.php'), stateFile, locksDir], {
            encoding: 'utf8',
            env: {
                ...process.env,
                APP_ENV: 'local',
                ORVA_INVENTORY_BACKEND: 'json',
                ORVA_INVENTORY_STATE_PATH: stateFile,
                ORVA_INVENTORY_LOCKS_DIR: locksDir,
            },
        });
        if (php.status !== 0) {
            throw new Error(`php acceptance failed: ${php.stderr || php.stdout}`);
        }
        assert.ok(String(php.stdout).includes('PHP_JSON_INVENTORY_ACCEPTANCE_OK'));
    });

    await check('no split-brain: postgres backend refuses JSON write path', async () => {
        writeState(baseState());
        process.env.ORVA_INVENTORY_BACKEND = 'postgres';
        try {
            // Re-require not needed — resolveInventoryBackend reads env each call
            assert.strictEqual(resolveInventoryBackend(), 'postgres');
            await assert.rejects(
                () => reserveStock('ORVA-JSON-TEST', 1, 'OID-SPLIT-001'),
                (e) => e.code === 'STORAGE_UNAVAILABLE' || e.code === 'INVENTORY_UNAVAILABLE' || e.message.includes('STORAGE')
            );
            // Fixture untouched by JSON writer
            assert.strictEqual(readState().inventory['ORVA-JSON-TEST'].available, 5);
        } finally {
            process.env.ORVA_INVENTORY_BACKEND = 'json';
        }
    });

    await check('Vercel refuses JSON inventory mutations', async () => {
        writeState(baseState());
        process.env.VERCEL = '1';
        delete process.env.ORVA_INVENTORY_ALLOW_VERCEL_JSON;
        try {
            await assert.rejects(
                () => reserveStock('ORVA-JSON-TEST', 1, 'OID-VERCEL-001'),
                (e) => e.code === 'INVENTORY_JSON_DISABLED_ON_VERCEL'
            );
        } finally {
            delete process.env.VERCEL;
        }
    });

    // Read-only counters against real operational file (no writes)
    await check('local operational ledger snapshot counters (read-only)', async () => {
        const realPath = path.join(__dirname, '..', 'data', 'inventory-state.json');
        if (!fs.existsSync(realPath)) {
            throw new Error('operational inventory-state.json missing locally');
        }
        const raw = fs.readFileSync(realPath, 'utf8').replace(/^\uFEFF/, '');
        const real = JSON.parse(raw);
        let reserved = 0;
        let pending = 0;
        for (const r of Object.values(real.reservations || {})) {
            if (String(r.status || '').toUpperCase() === 'RESERVED') {
                reserved += 1;
                if (String(r.lifecycle || '').toUpperCase() === 'CHECKOUT_PENDING') pending += 1;
            }
        }
        const drill = real.inventory['ORVA-DRILL-PRO'] || {};
        const report = {
            reservedLedgerRows: reserved,
            checkoutPending: pending,
            drillPro: {
                available: drill.available,
                reserved: drill.reserved,
                totalPhysical: drill.totalPhysical,
            },
            note: 'READ_ONLY — no mutations performed',
        };
        const out = path.join(__dirname, '..', 'data', 'local-fixtures', 'json-inventory-reconciliation-local.json');
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, JSON.stringify(report, null, 2));
        assert.strictEqual(reserved, 51);
        assert.strictEqual(pending, 0);
        assert.strictEqual(Number(drill.reserved), 3);
    });

    const failed = results.filter((r) => r.status === 'FAIL');
    console.log(JSON.stringify({ tmpDir, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
    process.exit(failed.length ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
