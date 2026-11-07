'use strict';
/**
 * Shared admin session checks for Vercel/Node APIs.
 * Accepts: Bearer ADMIN_API_TOKEN, HMAC signed cookie (orva1.*), legacy cookie=token, local session file.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SESSIONS_FILE = path.join(__dirname, '..', 'data', 'private', 'admin-sessions.json');

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

function adminToken() {
    return String(process.env.ADMIN_API_TOKEN || '').trim();
}

function readSessionCookie(req) {
    const cookieHeader = String(req.headers?.cookie || '');
    const raw = cookieHeader
        .split(';')
        .map((p) => p.trim())
        .find((p) => p.startsWith('orva_admin_session='))
        ?.slice('orva_admin_session='.length);
    if (!raw) return '';
    try {
        return decodeURIComponent(raw);
    } catch (_) {
        return '';
    }
}

function signedSessionValid(sessionId, secret) {
    if (!sessionId || !secret) return false;
    const parts = String(sessionId).split('.');
    if (parts.length !== 4 || parts[0] !== 'orva1') return false;
    const payload = parts.slice(0, 3).join('.');
    const sig = parts[3];
    const expect = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (!safeEqual(sig, expect)) return false;
    return Number(parts[1]) > Math.floor(Date.now() / 1000);
}

function fileSessionValid(sessionId) {
    if (!sessionId || process.env.VERCEL) return false;
    try {
        if (!fs.existsSync(SESSIONS_FILE)) return false;
        const sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8') || '{}');
        const row = sessions[sessionId];
        return Boolean(row && Number(row.expiresAt || 0) > Math.floor(Date.now() / 1000));
    } catch (_) {
        return false;
    }
}

function createSignedSession(ttlSeconds, secret) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const nonce = crypto.randomBytes(16).toString('hex');
    const payload = `orva1.${exp}.${nonce}`;
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return `${payload}.${sig}`;
}

/**
 * @returns {{ ok: boolean, type: ''|'bearer'|'cookie_signed'|'cookie_legacy'|'cookie_file', token: string }}
 */
function authorizeAdmin(req) {
    const token = adminToken();
    if (!token) return { ok: false, type: '', token: '' };

    const auth = String(req.headers?.authorization || req.headers?.Authorization || '');
    const bearer = auth.replace(/^bearer\s+/i, '').trim();
    if (bearer && safeEqual(bearer, token)) {
        return { ok: true, type: 'bearer', token };
    }

    const session = readSessionCookie(req);
    if (!session) return { ok: false, type: '', token };

    if (signedSessionValid(session, token)) {
        return { ok: true, type: 'cookie_signed', token };
    }
    if (safeEqual(session, token)) {
        return { ok: true, type: 'cookie_legacy', token };
    }
    if (fileSessionValid(session)) {
        return { ok: true, type: 'cookie_file', token };
    }
    return { ok: false, type: '', token };
}

function isTrustedAdminOrigin(origin) {
    if (!origin) return false;
    const exact = [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:8080',
        'http://127.0.0.1:3000',
        'https://orva-store.com',
        'https://www.orva-store.com',
        'https://staging.orva-store.com',
        'https://orvastore.vercel.app',
        'https://orvastore-dripalpha.vercel.app',
    ];
    if (exact.includes(origin)) return true;
    try {
        const host = new URL(origin).hostname;
        if (host === 'orvastore.vercel.app') return true;
        if (host.endsWith('.vercel.app') && host.includes('orvastore')) return true;
    } catch (_) {
        /* ignore */
    }
    return false;
}

module.exports = {
    safeEqual,
    adminToken,
    readSessionCookie,
    signedSessionValid,
    createSignedSession,
    authorizeAdmin,
    isTrustedAdminOrigin,
};
