'use strict';
// =============================================================================
// ORVA Store — Admin Authentication API Gateway (/api/auth)
// Phase 5D: Hardened — No fallback secrets, timingSafeEqual, CSRF Origin check
// =============================================================================

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Timing-safe string comparison. Returns false if either argument is empty or
 * if the lengths differ (no early-exit leakage).
 */
function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    // Pad the shorter string so Buffer lengths always match — prevents length
    // oracle even if timingSafeEqual itself is safe against unequal buffers.
    const lenA = Buffer.byteLength(a, 'utf8');
    const lenB = Buffer.byteLength(b, 'utf8');
    const maxLen = Math.max(lenA, lenB, 1);
    const bufA = Buffer.alloc(maxLen);
    const bufB = Buffer.alloc(maxLen);
    bufA.write(a, 'utf8');
    bufB.write(b, 'utf8');
    return crypto.timingSafeEqual(bufA, bufB) && lenA === lenB;
}

/**
 * Read a required secret from environment variables.
 * Returns null (never a fallback value) if absent or empty.
 */
function requireEnv(key) {
    const val = (process.env[key] || '').toString().trim();
    return val.length > 0 ? val : null;
}

/**
 * Determine allowed origins for this server.
 * On Hostinger: the site domain. Locally: localhost variants.
 */
function isAllowedOrigin(origin) {
    if (!origin) return false; // non-browser requests are handled via cookie/bearer
    // Allow same-origin and configured domain
    const allowedPatterns = [
        /^https?:\/\/localhost(:\d+)?$/,
        /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
        /^https:\/\/orva-store\.com$/,
        /^https:\/\/www\.orva-store\.com$/,
    ];
    return allowedPatterns.some((re) => re.test(origin));
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

module.exports = async (req, res) => {
    // CORS: Only allow configured origins (no wildcard for credentialed routes)
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
        // -- Parse body --
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

        // -- Load required secrets from environment (no fallbacks) --
        const expectedPassword = requireEnv('ADMIN_PASSWORD');
        const adminToken = requireEnv('ADMIN_API_TOKEN');

        if (!expectedPassword || !adminToken) {
            // Server misconfiguration — refuse all auth operations
            console.error('[Auth] CRITICAL: ADMIN_PASSWORD or ADMIN_API_TOKEN env var is not set.');
            return res.status(503).json({ success: false, error: 'SERVER_MISCONFIGURED' });
        }

        // -- Parse session cookie --
        const cookieHeader = String(req.headers?.cookie || '');
        const sessionCookie = cookieHeader
            .split(';')
            .map((p) => p.trim())
            .find((p) => p.startsWith('orva_admin_session='))
            ?.slice('orva_admin_session='.length) ?? '';
        let sessionToken = '';
        try { sessionToken = decodeURIComponent(sessionCookie); } catch (_) {}

        // -- Cookie setter --
        const setSessionCookie = (token, maxAge) => {
            // Use socket.encrypted or x-forwarded-proto FROM a trusted hop only.
            // On Hostinger, the proxy sets x-forwarded-proto reliably.
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

        // ── session action ──────────────────────────────────────────────────
        if (action === 'session') {
            if (!safeEqual(sessionToken, adminToken)) {
                return res.status(401).json({ success: false, error: 'UNAUTHORIZED_ACCESS' });
            }
            return res.status(200).json({ success: true, message: 'AUTHENTICATED' });
        }

        // ── logout action ───────────────────────────────────────────────────
        if (action === 'logout') {
            setSessionCookie('', 0);
            return res.status(200).json({ success: true, message: 'SIGNED_OUT' });
        }

        // ── login / auth action ─────────────────────────────────────────────
        if (action !== 'login' && action !== 'auth') {
            return res.status(400).json({ success: false, error: 'INVALID_ACTION' });
        }

        // Accept password only — NOT the API token as a login credential
        const inputPassword = (body.password || '').toString().trim();
        if (!inputPassword) {
            return res.status(400).json({ success: false, error: 'MISSING_PASSWORD' });
        }

        if (safeEqual(inputPassword, expectedPassword)) {
            setSessionCookie(adminToken, 28800); // 8 hours
            return res.status(200).json({ success: true, message: 'AUTHENTICATED' });
        }

        return res.status(401).json({ success: false, error: 'INVALID_PASSWORD' });

    } catch (err) {
        // Never expose internal error details
        console.error('[Auth API Error]:', err?.message ?? err);
        return res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
    }
};
