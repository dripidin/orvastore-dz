'use strict';
// =============================================================================
// ORVA Store — Admin Authentication API Gateway (/api/auth)
// Stabilization: random session IDs, login lockout, password never as Bearer
// =============================================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Vercel serverless FS is read-only except /tmp — signed cookies don't need a session file.
const ON_VERCEL = Boolean(process.env.VERCEL);
const DATA_ROOT = ON_VERCEL ? path.join('/tmp', 'orva-auth') : path.join(__dirname, '..', 'data');
const SESSIONS_FILE = path.join(DATA_ROOT, 'private', 'admin-sessions.json');
const LOCKOUTS_FILE = path.join(DATA_ROOT, 'locks', 'auth-lockouts.json');

function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const lenA = Buffer.byteLength(a, 'utf8');
    const lenB = Buffer.byteLength(b, 'utf8');
    const maxLen = Math.max(lenA, lenB, 1);
    const bufA = Buffer.alloc(maxLen);
    const bufB = Buffer.alloc(maxLen);
    bufA.write(a, 'utf8');
    bufB.write(b, 'utf8');
    return crypto.timingSafeEqual(bufA, bufB) && lenA === lenB;
}

function requireEnv(key) {
    const val = (process.env[key] || '').toString().trim();
    return val.length > 0 ? val : null;
}

function isAllowedOrigin(origin) {
    if (!origin) return false;
    const allowedPatterns = [
        /^https?:\/\/localhost(:\d+)?$/,
        /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
        /^https:\/\/orva-store\.com$/,
        /^https:\/\/www\.orva-store\.com$/,
        /^https:\/\/staging\.orva-store\.com$/,
    ];
    return allowedPatterns.some((re) => re.test(origin));
}

function readJson(file) {
    try {
        if (!fs.existsSync(file)) return {};
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        return raw && typeof raw === 'object' ? raw : {};
    } catch (_) {
        return {};
    }
}

function writeJson(file, data) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmp, file);
    } catch (err) {
        // shortcut: lockout/session file writes may fail on read-only hosts; signed cookies still auth
        console.warn('[Auth] writeJson skipped:', err?.code || err?.message);
    }
}

function clientIp(req) {
    const raw = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '0.0.0.0')
        .split(',')[0]
        .trim();
    return raw.replace(/[^0-9a-fA-F:.]/g, '') || '0.0.0.0';
}

function lockoutKey(req) {
    return crypto.createHash('sha256').update('orva-auth|' + clientIp(req)).digest('hex');
}

function checkLockout(req) {
    const all = readJson(LOCKOUTS_FILE);
    const row = all[lockoutKey(req)];
    if (!row) return { locked: false };
    const until = Number(row.lockedUntil || 0);
    if (until > Math.floor(Date.now() / 1000)) {
        return { locked: true, retryAfter: until - Math.floor(Date.now() / 1000) };
    }
    return { locked: false };
}

function recordFailedLogin(req) {
    const all = readJson(LOCKOUTS_FILE);
    const key = lockoutKey(req);
    const row = all[key] || { failures: 0, lockedUntil: 0 };
    row.failures = Number(row.failures || 0) + 1;
    row.lastFailureAt = new Date().toISOString();
    if (row.failures >= 5) {
        row.lockedUntil = Math.floor(Date.now() / 1000) + 15 * 60;
        row.failures = 0;
    }
    all[key] = row;
    writeJson(LOCKOUTS_FILE, all);
}

function clearLockout(req) {
    const all = readJson(LOCKOUTS_FILE);
    const key = lockoutKey(req);
    if (all[key]) {
        delete all[key];
        writeJson(LOCKOUTS_FILE, all);
    }
}

function createSignedSession(ttlSeconds, secret) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const nonce = crypto.randomBytes(16).toString('hex');
    const payload = `orva1.${exp}.${nonce}`;
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return `${payload}.${sig}`;
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

function createSession(ttlSeconds = 28800, secret = '') {
    if (ON_VERCEL || secret) {
        return createSignedSession(ttlSeconds, secret || requireEnv('ADMIN_API_TOKEN') || 'local');
    }
    const all = readJson(SESSIONS_FILE);
    const now = Math.floor(Date.now() / 1000);
    for (const [sid, meta] of Object.entries(all)) {
        if (!meta || Number(meta.expiresAt || 0) <= now) delete all[sid];
    }
    const sessionId = crypto.randomBytes(32).toString('hex');
    all[sessionId] = {
        createdAt: new Date().toISOString(),
        expiresAt: now + ttlSeconds,
    };
    writeJson(SESSIONS_FILE, all);
    return sessionId;
}

function destroySession(sessionId) {
    if (!sessionId || ON_VERCEL) return;
    const all = readJson(SESSIONS_FILE);
    if (all[sessionId]) {
        delete all[sessionId];
        writeJson(SESSIONS_FILE, all);
    }
}

function sessionIsValid(sessionId, adminToken) {
    if (!sessionId) return false;
    if (signedSessionValid(sessionId, adminToken)) return true;
    if (!ON_VERCEL) {
        const all = readJson(SESSIONS_FILE);
        const meta = all[sessionId];
        if (meta && Number(meta.expiresAt || 0) > Math.floor(Date.now() / 1000)) return true;
    }
    // Legacy compatibility: cookie previously stored ADMIN_API_TOKEN
    if (adminToken && safeEqual(sessionId, adminToken)) return true;
    return false;
}

module.exports = async (req, res) => {
    const origin = req.headers?.origin || '';
    if (isAllowedOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Sec-Fetch-Site');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
    }

    try {
        let body = req.body || {};
        if (typeof body === 'string') {
            try {
                body = JSON.parse(body);
            } catch (_) {
                try {
                    body = Object.fromEntries(new URLSearchParams(body));
                } catch (__) {}
            }
        }

        const action = String(body.action || 'login').trim().toLowerCase();
        const expectedPassword = requireEnv('ADMIN_PASSWORD');
        const adminToken = requireEnv('ADMIN_API_TOKEN');

        if (!expectedPassword || !adminToken) {
            console.error('[Auth] CRITICAL: ADMIN_PASSWORD or ADMIN_API_TOKEN env var is not set.');
            return res.status(503).json({ success: false, error: 'SERVER_MISCONFIGURED' });
        }

        const cookieHeader = String(req.headers?.cookie || '');
        const sessionCookie = cookieHeader
            .split(';')
            .map((p) => p.trim())
            .find((p) => p.startsWith('orva_admin_session='))
            ?.slice('orva_admin_session='.length) ?? '';
        let sessionToken = '';
        try { sessionToken = decodeURIComponent(sessionCookie); } catch (_) {}

        const setSessionCookie = (token, maxAge) => {
            const isHttps =
                Boolean(req.socket?.encrypted) ||
                req.headers?.['x-forwarded-proto'] === 'https';
            const cookie = [
                `orva_admin_session=${encodeURIComponent(token)}`,
                'Path=/',
                'HttpOnly',
                'SameSite=Strict',
                `Max-Age=${maxAge}`,
                ...(isHttps ? ['Secure'] : []),
            ].join('; ');
            res.setHeader('Set-Cookie', cookie);
        };

        if (action === 'session') {
            if (!sessionIsValid(sessionToken, adminToken)) {
                return res.status(401).json({ success: false, error: 'UNAUTHORIZED_ACCESS' });
            }
            return res.status(200).json({ success: true, message: 'AUTHENTICATED' });
        }

        if (action === 'logout') {
            destroySession(sessionToken);
            setSessionCookie('', 0);
            return res.status(200).json({ success: true, message: 'SIGNED_OUT' });
        }

        if (action !== 'login' && action !== 'auth') {
            return res.status(400).json({ success: false, error: 'INVALID_ACTION' });
        }

        const lock = checkLockout(req);
        if (lock.locked) {
            res.setHeader('Retry-After', String(lock.retryAfter || 900));
            return res.status(429).json({
                success: false,
                error: 'LOGIN_LOCKED',
                message: 'Too many failed login attempts. Try again in 15 minutes.',
                retryAfter: lock.retryAfter || 900,
            });
        }

        const inputPassword = (body.password || '').toString().trim();
        if (!inputPassword) {
            return res.status(400).json({ success: false, error: 'MISSING_PASSWORD' });
        }

        if (safeEqual(inputPassword, expectedPassword)) {
            clearLockout(req);
            const sessionId = createSession(28800, adminToken);
            setSessionCookie(sessionId, 28800);
            return res.status(200).json({ success: true, message: 'AUTHENTICATED' });
        }

        recordFailedLogin(req);
        return res.status(401).json({ success: false, error: 'INVALID_PASSWORD' });
    } catch (err) {
        console.error('[Auth API Error]:', err?.message ?? err);
        return res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
    }
};
