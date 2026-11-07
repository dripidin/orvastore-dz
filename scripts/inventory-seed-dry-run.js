'use strict';
/**
 * Dry-run reconciliation of data/inventory-state.json → proposed inventory_items seed.
 * Does NOT write to any database. Does NOT release historical reservations.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'inventory-state.json');
const OUT = path.join(ROOT, 'data', 'local-fixtures', 'inventory-seed-dry-run.json');

function main() {
    const raw = fs.readFileSync(SRC, 'utf8');
    const checksum = crypto.createHash('sha256').update(raw).digest('hex');
    const state = JSON.parse(raw);
    const inventory = state.inventory || {};
    const reservations = state.reservations || {};

    const reservedBySku = {};
    let historicalReservedOrders = 0;
    for (const [orderId, res] of Object.entries(reservations)) {
        if ((res.status || '') !== 'RESERVED') continue;
        historicalReservedOrders += 1;
        const sku = String(res.sku || '').toUpperCase();
        reservedBySku[sku] = (reservedBySku[sku] || 0) + Number(res.quantity || 0);
    }

    const rows = [];
    const warnings = [];
    for (const [sku, item] of Object.entries(inventory)) {
        const available = Number(item.available || 0);
        const reserved = Number(item.reserved || 0);
        const totalPhysical = Number(item.totalPhysical || available + reserved);
        const ledgerReserved = reservedBySku[sku] || 0;
        if (available + reserved !== totalPhysical) {
            warnings.push({ sku, issue: 'INVARIANT_MISMATCH', available, reserved, totalPhysical });
        }
        if (ledgerReserved !== reserved) {
            warnings.push({
                sku,
                issue: 'LEDGER_VS_ITEM_RESERVED',
                itemReserved: reserved,
                ledgerReserved,
                note: 'Seed will preserve item.reserved totals; will NOT auto-release Pack1 historical holds.',
            });
        }
        rows.push({
            sku,
            available,
            reserved,
            total_physical: totalPhysical,
            preserve_historical_reservations: true,
        });
    }

    const report = {
        generatedAt: new Date().toISOString(),
        sourceFile: 'data/inventory-state.json',
        sourceSha256: checksum,
        historicalReservedOrders,
        pack1Note: 'ORVA-P1-PRO reserved quantity preserved; no automatic release.',
        warnings,
        proposedRows: rows,
        applied: false,
        message: 'DRY RUN ONLY — no database writes.',
    };

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({
        ok: true,
        out: OUT,
        checksum,
        skus: rows.length,
        warnings: warnings.length,
        historicalReservedOrders,
    }, null, 2));
}

main();
