'use strict';
/**
 * Products Catalog Admin API (Node local / Vercel-compatible)
 * Source of truth: data/products-catalog.json
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SESSIONS_FILE = path.join(ROOT, 'data', 'private', 'admin-sessions.json');

function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
    const max = Math.max(Buffer.byteLength(a), Buffer.byteLength(b), 1);
    const ba = Buffer.alloc(max);
    const bb = Buffer.alloc(max);
    ba.write(a);
    bb.write(b);
    return crypto.timingSafeEqual(ba, bb) && Buffer.byteLength(a) === Buffer.byteLength(b);
}

function authorize(req) {
    const expected = String(process.env.ADMIN_API_TOKEN || '').trim();
    const auth = String(req.headers.authorization || '');
    const bearer = auth.replace(/^bearer\s+/i, '').trim();
    if (expected && bearer && safeEqual(bearer, expected)) return { ok: true, type: 'bearer' };

    const cookie = String(req.headers.cookie || '');
    const match = cookie.split(';').map((p) => p.trim()).find((p) => p.startsWith('orva_admin_session='));
    let session = '';
    try {
        session = decodeURIComponent((match || '').slice('orva_admin_session='.length));
    } catch (_) {
        session = '';
    }
    if (!session) return { ok: false };
    if (expected && safeEqual(session, expected)) return { ok: true, type: 'cookie_legacy' };
    try {
        if (!fs.existsSync(SESSIONS_FILE)) return { ok: false };
        const sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8') || '{}');
        const row = sessions[session];
        if (row && Number(row.expiresAt || 0) > Math.floor(Date.now() / 1000)) {
            return { ok: true, type: 'cookie' };
        }
    } catch (_) {
        /* ignore */
    }
    return { ok: false };
}

function catalogPath(useTest, host) {
    if (useTest) {
        const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(String(host || ''));
        if (!local) {
            const err = new Error('TEST_FIXTURE_LOCAL_ONLY');
            err.status = 403;
            throw err;
        }
        const file = path.join(ROOT, 'data', 'local-fixtures', 'products-catalog.test.json');
        if (!fs.existsSync(file)) {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            const seed = path.join(ROOT, 'data', 'products-catalog.json');
            if (fs.existsSync(seed)) fs.copyFileSync(seed, file);
            else fs.writeFileSync(file, JSON.stringify({ version: 1, products: {} }, null, 2));
        }
        return file;
    }
    return path.join(ROOT, 'data', 'products-catalog.json');
}

function readCatalog(file) {
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!data.products || typeof data.products !== 'object') data.products = {};
        return data;
    } catch (_) {
        return { version: 1, products: {} };
    }
}

function writeCatalog(file, data) {
    data.lastUpdated = new Date().toISOString();
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
}

function toAdmin(key, p) {
    const status = String(p.status || 'active').toLowerCase();
    return {
        id: String(p.id || key),
        catalogKey: key,
        sku: String(p.sku || ''),
        title: String(p.title || p.name || key),
        subtitle: String(p.shortTitle || p.name || ''),
        description: String(p.desc || p.description || ''),
        images: Array.isArray(p.images) ? p.images : [],
        sellingPrice: Number(p.sellingPrice) || 0,
        purchaseCost: Number(p.purchaseCost) || 0,
        marketingCostPerOrder: Number(p.marketingCostPerOrder) || 0,
        stockQuantity: Number(p.stockQuantity) || 0,
        lowStockThreshold: Number(p.lowStockThreshold) || 5,
        status: ['active', 'draft', 'archived'].includes(status) ? status : 'active',
        allowOrders: p.allowOrders !== undefined ? Boolean(p.allowOrders) : status === 'active',
        slug: String(p.slug || ''),
        createdAt: String(p.createdAt || ''),
        updatedAt: String(p.updatedAt || ''),
    };
}

function send(res, status, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
}

module.exports = async (req, res) => {
    const origin = req.headers.origin || '';
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || /orva-store\.com$/.test(origin.replace(/^https?:\/\//, ''))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Sec-Fetch-Site');

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        return res.end();
    }

    const auth = authorize(req);
    if (!auth.ok) return send(res, 401, { success: false, error: 'UNAUTHORIZED' });

    const u = new URL(req.url || '/', 'http://localhost');
    let action = u.searchParams.get('action') || '';
    const useTest = u.searchParams.get('fixture') === 'test';
    let body = {};
    if (req.method === 'POST' || req.method === 'PUT') {
        body = typeof req.body === 'object' && req.body ? req.body : {};
        if (!action && body.action) action = String(body.action);
    }
    if (!action) action = req.method === 'GET' ? 'list' : '';

    let file;
    try {
        file = catalogPath(useTest, req.headers.host);
    } catch (e) {
        return send(res, e.status || 500, { success: false, error: e.message });
    }

    if (action === 'list' || action === 'get') {
        const catalog = readCatalog(file);
        const list = Object.entries(catalog.products).map(([k, p]) => toAdmin(k, p || {}));
        return send(res, 200, { success: true, fixture: useTest ? 'test' : 'live', count: list.length, data: list });
    }

    if (action === 'upsert' || action === 'update') {
        const product = body.product || body;
        const sku = String(product.sku || '').trim().toUpperCase();
        if (!sku) return send(res, 400, { success: false, error: 'MISSING_SKU' });
        let catalogKey = String(product.catalogKey || body.catalogKey || '').trim();
        if (!catalogKey) catalogKey = sku.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const price = Number(product.sellingPrice);
        if (!Number.isFinite(price) || price < 0) return send(res, 400, { success: false, error: 'INVALID_PRICE' });
        let status = String(product.status || 'active').toLowerCase();
        if (!['active', 'draft', 'archived'].includes(status)) status = 'active';

        const catalog = readCatalog(file);
        const existing = catalog.products[catalogKey] || {};
        const now = new Date().toISOString();
        const merged = {
            ...existing,
            id: String(product.id || existing.id || `prod_${catalogKey}`),
            sku,
            slug: String(product.slug || existing.slug || ''),
            title: String(product.title || existing.title || sku).trim(),
            name: String(product.name || product.subtitle || existing.name || sku).trim(),
            shortTitle: String(product.subtitle || product.shortTitle || existing.shortTitle || '').trim(),
            desc: String(product.description || product.desc || existing.desc || '').trim(),
            sellingPrice: price,
            purchaseCost: Number(product.purchaseCost ?? existing.purchaseCost ?? 0) || 0,
            marketingCostPerOrder: Number(product.marketingCostPerOrder ?? existing.marketingCostPerOrder ?? 0) || 0,
            stockQuantity: Number(product.stockQuantity ?? existing.stockQuantity ?? 0) || 0,
            lowStockThreshold: Number(product.lowStockThreshold ?? existing.lowStockThreshold ?? 5) || 5,
            status,
            allowOrders: product.allowOrders !== undefined ? Boolean(product.allowOrders) : status === 'active',
            images: Array.isArray(product.images) ? product.images : (existing.images || []),
            updatedAt: now,
            createdAt: String(existing.createdAt || now),
        };
        catalog.products[catalogKey] = merged;
        writeCatalog(file, catalog);
        return send(res, 200, { success: true, data: toAdmin(catalogKey, merged) });
    }

    if (action === 'adjust_stock') {
        let catalogKey = String(body.catalogKey || body.id || '').trim();
        const change = Number(body.change || 0);
        if (!catalogKey || !change) return send(res, 400, { success: false, error: 'INVALID_STOCK_ADJUSTMENT' });
        const catalog = readCatalog(file);
        if (!catalog.products[catalogKey]) {
            for (const [k, row] of Object.entries(catalog.products)) {
                if (row && (row.id === catalogKey || row.sku === catalogKey)) {
                    catalogKey = k;
                    break;
                }
            }
        }
        if (!catalog.products[catalogKey]) return send(res, 404, { success: false, error: 'NOT_FOUND' });
        const row = catalog.products[catalogKey];
        row.stockQuantity = Math.max(0, Number(row.stockQuantity || 0) + change);
        row.updatedAt = new Date().toISOString();
        catalog.products[catalogKey] = row;
        writeCatalog(file, catalog);
        return send(res, 200, {
            success: true,
            data: toAdmin(catalogKey, row),
            inventory: {
                productId: row.id || catalogKey,
                availableQuantity: row.stockQuantity,
                reservedQuantity: 0,
                totalPhysicalQuantity: row.stockQuantity,
            },
        });
    }

    return send(res, 400, { success: false, error: 'UNKNOWN_ACTION' });
};
