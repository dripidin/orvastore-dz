'use strict';
/**
 * Read-only reservation reconciliation report.
 * Does NOT release or delete any reservations.
 * Optionally compares against Supabase when SUPABASE_URL + key are present.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const INV = path.join(ROOT, 'data', 'inventory-state.json');
const OUT = path.join(ROOT, 'data', 'reservation-reconciliation-report.json');

function loadInv() {
    return JSON.parse(fs.readFileSync(INV, 'utf8'));
}

function fetchOrders(url, key, schema) {
    return new Promise((resolve, reject) => {
        const u = new URL(url.replace(/\/$/, '') + '/rest/v1/orders?select=order_id,status,product_name,created_at&limit=1000');
        const headers = {
            apikey: key,
            Authorization: 'Bearer ' + key,
            Accept: 'application/json',
        };
        if (schema && schema !== 'public') {
            headers['Accept-Profile'] = schema;
        }
        const req = https.request(u, { method: 'GET', headers }, (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        reject(e);
                    }
                } else {
                    reject(new Error('HTTP ' + res.statusCode + ' (body redacted)'));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function main() {
    const inv = loadInv();
    const reservations = inv.reservations || {};
    const reserved = Object.entries(reservations)
        .filter(([, r]) => String(r.status || '').toUpperCase() === 'RESERVED')
        .map(([orderId, r]) => ({
            orderId,
            sku: r.sku,
            quantity: r.quantity,
            timestamp: r.timestamp,
        }));

    const bySku = {};
    for (const row of reserved) {
        bySku[row.sku] = bySku[row.sku] || { count: 0, quantity: 0, orderIds: [] };
        bySku[row.sku].count += 1;
        bySku[row.sku].quantity += Number(row.quantity || 0);
        bySku[row.sku].orderIds.push(row.orderId);
    }

    const report = {
        generatedAt: new Date().toISOString(),
        mode: 'READ_ONLY',
        note: 'No reservations were released or deleted by this script.',
        reservedCount: reserved.length,
        bySku,
        sampleOldest: reserved
            .slice()
            .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
            .slice(0, 20),
        supabase: { inspected: false },
    };

    const url = process.env.SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
    const schema = process.env.SUPABASE_SCHEMA || 'public';

    if (url && key) {
        try {
            const orders = await fetchOrders(url, key, schema);
            const byId = new Map(orders.map((o) => [o.order_id, o]));
            const matched = [];
            const missingInDb = [];
            for (const row of reserved) {
                const o = byId.get(row.orderId);
                if (!o) missingInDb.push({ orderId: row.orderId, sku: row.sku, quantity: row.quantity });
                else matched.push({ orderId: row.orderId, status: o.status, sku: row.sku });
            }
            report.supabase = {
                inspected: true,
                schema,
                ordersFetched: orders.length,
                matchedReservations: matched.length,
                missingInDbCount: missingInDb.length,
                // Do not dump customer PII
                missingOrderIdsOnly: missingInDb.map((m) => m.orderId),
                matchedStatusBreakdown: matched.reduce((acc, m) => {
                    const s = String(m.status || 'unknown').toLowerCase();
                    acc[s] = (acc[s] || 0) + 1;
                    return acc;
                }, {}),
            };
        } catch (e) {
            report.supabase = {
                inspected: false,
                error: 'lookup_failed',
                message: String(e.message || e),
            };
        }
    } else {
        report.supabase = {
            inspected: false,
            reason: 'SUPABASE_URL / server key not configured in this environment',
        };
    }

    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log('Wrote', OUT);
    console.log('Reserved rows:', report.reservedCount);
    console.log('By SKU counts:', Object.fromEntries(Object.entries(bySku).map(([k, v]) => [k, v.count])));
    if (report.supabase.inspected) {
        console.log('Matched:', report.supabase.matchedReservations, 'Missing in DB:', report.supabase.missingInDbCount);
    } else {
        console.log('Supabase inspection skipped:', report.supabase.reason || report.supabase.error);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
