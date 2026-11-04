'use strict';
// =============================================================================
// Admin Risk Override API — /api/risk
// =============================================================================
// GET  /api/risk?orderId=XYZ          → return risk evaluation for order
// GET  /api/risk?action=health        → Google Sheets connection status
// POST /api/risk { orderId, action }  → override risk decision
// Protected by ADMIN_API_TOKEN in Authorization header.
// =============================================================================

const crypto = require('crypto');
const { getRiskEvaluationByOrderId, updateRiskOverride, addToWatchlist } = require('../lib/db');
const { verifyConnection } = require('../lib/googleSheets');

const ADMIN_TOKEN = (process.env.ADMIN_API_TOKEN || '').trim();

const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'https://orva-store.com',
    'https://www.orva-store.com'
];

function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
    const lenA = Buffer.byteLength(a, 'utf8');
    const lenB = Buffer.byteLength(b, 'utf8');
    const maxLen = Math.max(lenA, lenB, 1);
    const bufA = Buffer.alloc(maxLen);
    const bufB = Buffer.alloc(maxLen);
    bufA.write(a, 'utf8');
    bufB.write(b, 'utf8');
    return crypto.timingSafeEqual(bufA, bufB) && lenA === lenB;
}

function getAuthType(req) {
    if (!ADMIN_TOKEN) return '';
    const auth = (req.headers['authorization'] || req.headers['Authorization'] || '');
    const token = auth.replace(/^bearer\s+/i, '').trim();
    if (token && safeEqual(token, ADMIN_TOKEN)) return 'bearer';

    const cookieHeader = String(req.headers.cookie || '');
    const sessionCookie = cookieHeader
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('orva_admin_session='))
        ?.slice('orva_admin_session='.length);
    let sessionToken = '';
    try {
        sessionToken = decodeURIComponent(sessionCookie || '');
    } catch (_) {
        sessionToken = '';
    }

    if (sessionToken && safeEqual(sessionToken, ADMIN_TOKEN)) return 'cookie';
    return '';
}

async function handleGet(req, res) {
    const { orderId, action } = req.query || {};

    // Public health endpoint (no auth required)
    if (action === 'health') {
        const conn = await verifyConnection();
        return res.status(200).json({
            ok:     conn.ok,
            sheets: conn.sheetNames || [],
            title:  conn.spreadsheetTitle || '',
            error:  conn.error || null
        });
    }

    if (!getAuthType(req)) return res.status(401).json({ error: 'UNAUTHORIZED' });
    if (!orderId)            return res.status(400).json({ error: 'MISSING_ORDER_ID' });

    const evalData = await getRiskEvaluationByOrderId(orderId);
    if (!evalData) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json(evalData);
}

async function handlePost(req, res) {
    const authType = getAuthType(req);
    if (!authType) return res.status(401).json({ error: 'UNAUTHORIZED' });

    // CSRF gate for Cookie auth on mutation
    if (authType === 'cookie') {
        const secFetchSite = String(req.headers?.['sec-fetch-site'] || '').toLowerCase();
        if (secFetchSite === 'cross-site') {
            return res.status(403).json({ error: 'CSRF_REJECTED' });
        }
        const origin = req.headers?.origin || '';
        if (!origin) return res.status(403).json({ error: 'CSRF_ORIGIN_REQUIRED' });
        if (!allowedOrigins.includes(origin)) return res.status(403).json({ error: 'CSRF_ORIGIN_DISALLOWED' });
    }

    const { orderId, action, identifier, identifierType, reason, expiresAt } = req.body || {};
    if (!action) return res.status(400).json({ error: 'MISSING_ACTION' });

    const VALID_ACTIONS = ['trust', 'block', 'reject', 'confirm', 'unblock', 'watchlist'];
    if (!VALID_ACTIONS.includes(action)) {
        return res.status(400).json({ error: `INVALID_ACTION. Must be one of: ${VALID_ACTIONS.join(', ')}` });
    }

    // Watchlist: add arbitrary identifier
    if (action === 'watchlist') {
        if (!identifier) return res.status(400).json({ error: 'MISSING_IDENTIFIER' });
        const entry = await addToWatchlist(identifier, identifierType || 'PHONE', reason || 'Manual watchlist', 'watchlist', expiresAt || '');
        return res.json({ success: true, action, entry });
    }

    if (!orderId) return res.status(400).json({ error: 'MISSING_ORDER_ID' });
    const result = await updateRiskOverride(orderId, action);
    return res.json({ success: true, updated: result });
}

module.exports = async (req, res) => {
    const origin = req.headers?.origin || '';
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, Sec-Fetch-Site');

    if (req.method === 'OPTIONS') {
        if (res.writeHead) res.writeHead(204);
        else if (res.status) res.status(204);
        return res.end();
    }
    if (req.method === 'GET')     return handleGet(req, res);
    if (req.method === 'POST')    return handlePost(req, res);
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
};
