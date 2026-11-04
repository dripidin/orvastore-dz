'use strict';
// =============================================================================
// ORVA STORE — Dynamic Integration Settings API (/api/admin-settings) (Phase 8D.1)
// Admin Session Gated, CSRF Protected, Zero Secrets Returned over HTTP
// =============================================================================

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const {
    DEFAULT_REDEX_URL,
    DEFAULT_ECOTRACK_URL,
    LEGACY_PIXEL_ID,
    STOREFRONT_PAGES,
    AUDIT_FILE,
    getEffectiveSettings,
    getPublicSettings,
    getPublicStorefrontConfig,
    updateSettings,
    saveTemplateDraft,
    activateTemplate,
    restoreTemplateDefault,
    toggleTemplate
} = require('../lib/admin-settings-store');

const { testConnection, validateCourierUrl } = require('../lib/courier-client');

const ALLOWED_ORIGINS = new Set([
    'https://orva-store.com',
    'https://www.orva-store.com',
    'https://staging.orva-store.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:8080'
]);

function safeEqual(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
    const lenA = Buffer.byteLength(left, 'utf8');
    const lenB = Buffer.byteLength(right, 'utf8');
    const maxLen = Math.max(lenA, lenB, 1);
    const bufA = Buffer.alloc(maxLen);
    const bufB = Buffer.alloc(maxLen);
    bufA.write(left, 'utf8');
    bufB.write(right, 'utf8');
    return crypto.timingSafeEqual(bufA, bufB) && lenA === lenB;
}

function getSessionToken(cookieHeader) {
    const entry = String(cookieHeader || '').split(';').map((part) => part.trim())
        .find((part) => part.startsWith('orva_admin_session='));
    if (!entry) return '';
    try { return decodeURIComponent(entry.slice('orva_admin_session='.length)); } catch (_) { return ''; }
}

function isAuthorized(req) {
    const adminToken = process.env.ADMIN_API_TOKEN || '';
    const adminPassword = process.env.ADMIN_PASSWORD || '';

    // 1. Authorization header (Bearer token)
    const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
    if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim();
        if (adminToken && safeEqual(token, adminToken)) return true;
        if (adminPassword && safeEqual(token, adminPassword)) return true;
    }

    // 2. HttpOnly Cookie session
    const cookieToken = getSessionToken(req.headers?.cookie);
    if (cookieToken) {
        if (adminToken && safeEqual(cookieToken, adminToken)) return true;
        if (adminPassword && safeEqual(cookieToken, adminPassword)) return true;
    }

    return false;
}

function isTrustedOrigin(req) {
    const secFetchSite = req.headers?.['sec-fetch-site'];
    if (secFetchSite === 'cross-site') {
        return false;
    }

    const origin = req.headers?.origin;
    const referer = req.headers?.referer;
    const host = req.headers?.host;

    if (origin) {
        if (ALLOWED_ORIGINS.has(origin)) return true;
        try {
            const parsed = new URL(origin);
            if (host && parsed.host.toLowerCase() === host.toLowerCase()) return true;
        } catch (_) {}
        return false;
    }

    if (referer) {
        try {
            const parsed = new URL(referer);
            const originStr = `${parsed.protocol}//${parsed.host}`;
            if (ALLOWED_ORIGINS.has(originStr)) return true;
            if (host && parsed.host.toLowerCase() === host.toLowerCase()) return true;
        } catch (_) {}
    }

    // If neither origin nor referer present on local test, permit if host matches localhost
    if (host && (host.startsWith('localhost') || host.startsWith('127.0.0.1'))) {
        return true;
    }

    return false;
}

// ── Validation Helpers ────────────────────────────────────────────────────────

function validateCourierSettings(input, defaultBaseUrl) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_SETTINGS');
    const output = {};

    if (input.enabled !== undefined) {
        if (typeof input.enabled !== 'boolean') throw new Error('INVALID_SETTINGS');
        output.enabled = input.enabled;
    }

    if (input.baseUrl !== undefined) {
        if (typeof input.baseUrl !== 'string' || input.baseUrl.length > 256) throw new Error('INVALID_SETTINGS');
        const rawUrl = input.baseUrl.trim() || defaultBaseUrl;
        let validated;
        try {
            validated = validateCourierUrl(rawUrl);
        } catch (_) {
            throw new Error('INVALID_SETTINGS');
        }
        output.baseUrl = validated;
    }

    if (input.apiToken !== undefined) {
        if (typeof input.apiToken !== 'string' || input.apiToken.length > 4096) throw new Error('INVALID_SETTINGS');
        if (input.apiToken.trim()) output.apiToken = input.apiToken.trim();
    }

    if (input.clearApiToken !== undefined) {
        if (typeof input.clearApiToken !== 'boolean') throw new Error('INVALID_SETTINGS');
        output.clearApiToken = input.clearApiToken;
    }

    return output;
}

function validateTelegram(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_SETTINGS');
    const output = {};

    if (input.enabled !== undefined) {
        if (typeof input.enabled !== 'boolean') throw new Error('INVALID_SETTINGS');
        output.enabled = input.enabled;
    }

    if (input.botToken !== undefined) {
        if (typeof input.botToken !== 'string' || input.botToken.length > 4096) throw new Error('INVALID_SETTINGS');
        if (input.botToken.trim()) output.botToken = input.botToken.trim();
    }

    if (input.chatId !== undefined) {
        if (typeof input.chatId !== 'string' || input.chatId.length > 128) throw new Error('INVALID_SETTINGS');
        const chatId = input.chatId.trim();
        if (chatId && !/^(?:-?\d{1,24}|@[A-Za-z0-9_]{5,})$/.test(chatId)) throw new Error('INVALID_SETTINGS');
        output.chatId = chatId;
    }

    for (const field of ['clearBotToken', 'clearChatId']) {
        if (input[field] !== undefined) {
            if (typeof input[field] !== 'boolean') throw new Error('INVALID_SETTINGS');
            output[field] = input[field];
        }
    }

    return output;
}

function validateMetaPixel(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_SETTINGS');
    const output = {};

    if (input.enabled !== undefined) {
        if (typeof input.enabled !== 'boolean') throw new Error('INVALID_SETTINGS');
        output.enabled = input.enabled;
    }

    if (input.pixelId !== undefined) {
        if (typeof input.pixelId !== 'string' || input.pixelId.length > 64) throw new Error('INVALID_SETTINGS');
        const pid = input.pixelId.trim();
        if (pid === LEGACY_PIXEL_ID) throw new Error('LEGACY_PIXEL_DECOMMISSIONED');
        if (pid && !/^\d{5,24}$/.test(pid)) throw new Error('INVALID_SETTINGS');
        output.pixelId = pid;
    }

    if (input.clearPixelId !== undefined) {
        if (typeof input.clearPixelId !== 'boolean') throw new Error('INVALID_SETTINGS');
        output.clearPixelId = input.clearPixelId;
    }

    if (input.capiEnabled !== undefined) {
        if (typeof input.capiEnabled !== 'boolean') throw new Error('INVALID_SETTINGS');
        output.capiEnabled = input.capiEnabled;
    }

    if (input.capiToken !== undefined) {
        if (typeof input.capiToken !== 'string' || input.capiToken.length > 4096) throw new Error('INVALID_SETTINGS');
        if (input.capiToken.trim()) output.capiToken = input.capiToken.trim();
    }

    if (input.clearCapiToken !== undefined) {
        if (typeof input.clearCapiToken !== 'boolean') throw new Error('INVALID_SETTINGS');
        output.clearCapiToken = input.clearCapiToken;
    }

    if (input.scope !== undefined) {
        if (input.scope !== 'all' && input.scope !== 'selected') throw new Error('INVALID_SETTINGS');
        output.scope = input.scope;
    }

    if (input.pages !== undefined) {
        if (!Array.isArray(input.pages) || input.pages.some((page) => !STOREFRONT_PAGES.includes(page))) {
            throw new Error('INVALID_SETTINGS');
        }
        output.pages = [...new Set(input.pages)];
    }

    return output;
}

// ── Connection Testing Logic ──────────────────────────────────────────────────

function deriveConnectionStatus(res) {
    if (!res.configured) return 'not_configured';
    if (res.operational || (res.reachable && res.authenticated)) return 'operational';
    if (res.authenticated) return 'authenticated';
    if (res.reachable) return 'reachable';
    return 'error';
}

async function runConnectionTest(integration, credentials = {}) {
    const effective = getEffectiveSettings();

    switch (integration) {
        case 'redex': {
            const rawToken = credentials.apiToken || credentials.token || effective.redex.apiToken;
            const baseUrl = credentials.baseUrl || effective.redex.baseUrl || DEFAULT_REDEX_URL;

            if (!rawToken) {
                const res = {
                    provider: 'redex',
                    safeCheck: 'wilayas_ping',
                    status: 'not_configured',
                    success: false,
                    configured: false,
                    reachable: false,
                    authenticated: false,
                    operational: false,
                    message: 'RedEx API token is not configured.'
                };
                return res;
            }

            const rawResult = await testConnection({
                provider: 'redex',
                baseUrl,
                token: rawToken,
                mockResponse: credentials.mockResponse
            });

            return {
                provider: 'redex',
                safeCheck: 'wilayas_ping',
                status: deriveConnectionStatus(rawResult),
                ...rawResult
            };
        }

        case 'ecotrack': {
            const rawToken = credentials.apiToken || credentials.token || effective.ecotrack.apiToken;
            const baseUrl = credentials.baseUrl || effective.ecotrack.baseUrl || DEFAULT_ECOTRACK_URL;

            if (!rawToken) {
                const res = {
                    provider: 'ecotrack',
                    safeCheck: 'wilayas_ping',
                    status: 'not_configured',
                    success: false,
                    configured: false,
                    reachable: false,
                    authenticated: false,
                    operational: false,
                    message: 'Ecotrack API token is not configured.'
                };
                return res;
            }

            const rawResult = await testConnection({
                provider: 'ecotrack',
                baseUrl,
                token: rawToken,
                mockResponse: credentials.mockResponse
            });

            return {
                provider: 'ecotrack',
                safeCheck: 'wilayas_ping',
                status: deriveConnectionStatus(rawResult),
                ...rawResult
            };
        }

        case 'telegram': {
            const botToken = credentials.botToken || effective.telegram.botToken;
            const chatId = credentials.chatId || effective.telegram.chatId;

            if (!botToken || !chatId) {
                return {
                    provider: 'telegram',
                    safeCheck: 'getMe',
                    status: 'not_configured',
                    success: false,
                    configured: false,
                    reachable: false,
                    authenticated: false,
                    operational: false,
                    message: 'Telegram Bot Token and Chat ID are both required.'
                };
            }

            if (credentials.mockResponse) {
                return {
                    provider: 'telegram',
                    safeCheck: 'getMe',
                    status: deriveConnectionStatus(credentials.mockResponse),
                    ...credentials.mockResponse
                };
            }

            // Safe official verification via getMe (never sends a message)
            const tgResult = await new Promise((resolve) => {
                const req = https.get(`https://api.telegram.org/bot${botToken}/getMe`, { timeout: 8000 }, (res) => {
                    let data = '';
                    res.on('data', chunk => { data += chunk; });
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            if (res.statusCode === 200 && parsed.ok) {
                                resolve({
                                    success: true,
                                    configured: true,
                                    reachable: true,
                                    authenticated: true,
                                    operational: true,
                                    botUsername: parsed.result?.username,
                                    botName: parsed.result?.first_name,
                                    chatId,
                                    message: `Telegram Bot @${parsed.result?.username || 'bot'} verified successfully.`
                                });
                            } else {
                                resolve({
                                    success: false,
                                    configured: true,
                                    reachable: true,
                                    authenticated: false,
                                    operational: false,
                                    message: parsed.description || 'Invalid Telegram bot token.'
                                });
                            }
                        } catch (e) {
                            resolve({
                                success: false,
                                configured: true,
                                reachable: true,
                                authenticated: false,
                                operational: false,
                                message: 'Failed to parse response from Telegram.'
                            });
                        }
                    });
                });

                req.on('timeout', () => {
                    req.destroy();
                    resolve({
                        success: false,
                        configured: true,
                        reachable: false,
                        authenticated: false,
                        operational: false,
                        message: 'Connection to Telegram timed out.'
                    });
                });

                req.on('error', (err) => {
                    resolve({
                        success: false,
                        configured: true,
                        reachable: false,
                        authenticated: false,
                        operational: false,
                        message: `Failed to connect to Telegram: ${err.message}`
                    });
                });
            });

            return {
                provider: 'telegram',
                safeCheck: 'getMe',
                status: deriveConnectionStatus(tgResult),
                ...tgResult
            };
        }

        case 'metaPixel': {
            const pixelId = credentials.pixelId !== undefined ? credentials.pixelId : effective.metaPixel.pixelId;
            const capiToken = credentials.capiToken !== undefined ? credentials.capiToken : effective.metaPixel.capiToken;

            if (!pixelId) {
                return {
                    provider: 'metaPixel',
                    safeCheck: 'format_and_token_validation',
                    status: 'not_configured',
                    success: false,
                    configured: false,
                    reachable: true,
                    authenticated: false,
                    operational: false,
                    message: 'Meta Pixel ID is not configured.'
                };
            }

            if (pixelId === LEGACY_PIXEL_ID) {
                return {
                    provider: 'metaPixel',
                    safeCheck: 'format_and_token_validation',
                    status: 'error',
                    success: false,
                    configured: false,
                    reachable: true,
                    authenticated: false,
                    operational: false,
                    error: 'LEGACY_PIXEL_DECOMMISSIONED',
                    message: 'Legacy Pixel ID 2340414976777036 is decommissioned. Enter new Pixel ID.'
                };
            }

            if (!/^\d{5,24}$/.test(pixelId)) {
                return {
                    provider: 'metaPixel',
                    safeCheck: 'format_and_token_validation',
                    status: 'error',
                    success: false,
                    configured: false,
                    reachable: true,
                    authenticated: false,
                    operational: false,
                    message: 'Invalid Meta Pixel ID format. Expected 5-24 numeric digits.'
                };
            }

            if (capiToken && capiToken.length < 20) {
                return {
                    provider: 'metaPixel',
                    safeCheck: 'format_and_token_validation',
                    status: 'reachable',
                    success: false,
                    configured: true,
                    reachable: true,
                    authenticated: false,
                    operational: false,
                    message: 'Meta CAPI token appears invalid (too short).'
                };
            }

            return {
                provider: 'metaPixel',
                safeCheck: 'format_and_token_validation',
                status: 'operational',
                success: true,
                configured: true,
                reachable: true,
                authenticated: true,
                operational: true,
                pixelId,
                capiConfigured: Boolean(capiToken),
                message: 'Meta Pixel configuration verified successfully (Valid numeric format and CAPI setup).'
            };
        }

        default:
            return {
                provider: integration,
                status: 'error',
                success: false,
                configured: false,
                reachable: false,
                authenticated: false,
                operational: false,
                message: `Unknown integration '${integration}'.`
            };
    }
}

const SUPPORTED_TELEGRAM_EVENTS = new Set([
    'ORDER_CREATED',
    'SHIPMENT_CREATED',
    'SHIPMENT_FAILED',
    'STATUS_UPDATED',
    'ORDER_CANCELLED',
    'ADMIN_ALERT'
]);

const adminTestRateLimits = new Map();

function resetAdminTestRateLimits() {
    adminTestRateLimits.clear();
}

function checkAdminTestRateLimit(req, now = Date.now()) {
    const ip = req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
    const auth = req.headers?.authorization || req.headers?.cookie || 'admin';
    const key = `${ip}:${auth}`;
    let entry = adminTestRateLimits.get(key);
    if (!entry) {
        entry = { lastDispatched: 0, timestamps: [] };
    }
    // Clean timestamps older than 60s
    entry.timestamps = entry.timestamps.filter(ts => now - ts < 60000);

    // Rule 1: 3-second cooldown
    const elapsed = now - entry.lastDispatched;
    if (elapsed < 3000) {
        const retryAfter = Math.max(1, Math.ceil((3000 - elapsed) / 1000));
        return {
            allowed: false,
            retryAfter,
            message: `يرجى الانتظار ${retryAfter} ثوانٍ قبل إرسال رسالة تجريبية أخرى لتجنب حظر تيليجرام.`
        };
    }

    // Rule 2: Max 10 per minute
    if (entry.timestamps.length >= 10) {
        const oldest = entry.timestamps[0];
        const retryAfter = Math.max(1, Math.ceil((60000 - (now - oldest)) / 1000));
        return {
            allowed: false,
            retryAfter,
            message: `تم تجاوز الحد الأقصى لإرسال الرسائل (10 رسائل في الدقيقة). يرجى الانتظار ${retryAfter} ثانية.`
        };
    }

    entry.lastDispatched = now;
    entry.timestamps.push(now);
    adminTestRateLimits.set(key, entry);

    if (adminTestRateLimits.size > 200) {
        for (const [k, v] of adminTestRateLimits.entries()) {
            if (now - v.lastDispatched > 300000) adminTestRateLimits.delete(k);
        }
    }

    return { allowed: true };
}

function sendTelegramHttpRequest(botToken, chatId, text) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });

        const req = https.request({
            hostname: 'api.telegram.org',
            port: 443,
            path: `/bot${botToken}/sendMessage`,
            method: 'POST',
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                let parsed = null;
                try { parsed = JSON.parse(body); } catch (_) {}
                if (res.statusCode >= 200 && res.statusCode < 300 && parsed && parsed.ok) {
                    resolve({ ok: true, result: parsed.result });
                } else {
                    const errMsg = (parsed && parsed.description) ? parsed.description : `HTTP_${res.statusCode}`;
                    reject(new Error(`TELEGRAM_API_ERROR: ${errMsg}`));
                }
            });
        });

        req.on('timeout', () => {
            req.destroy(new Error('TELEGRAM_TIMEOUT'));
        });

        req.on('error', (err) => {
            const msg = (err && err.message) || String(err);
            reject(new Error(msg.replace(/\/bot[a-zA-Z0-9_:-]+/g, '/bot[REDACTED_TOKEN]')));
        });

        req.write(payload);
        req.end();
    });
}

// ── Main Request Handler ─────────────────────────────────────────────────────

const adminSettingsHandler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const origin = req.headers?.origin || '';
    if (ALLOWED_ORIGINS.has(origin)) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-CSRF-Token');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    let query = req.query;
    if (!query && req.url) {
        try {
            const parsed = new URL(req.url, 'http://localhost');
            query = Object.fromEntries(parsed.searchParams.entries());
        } catch (_) {
            query = {};
        }
    }
    query = query || {};

    // ── 1. Anonymous Public Storefront Route (/api/admin-settings?action=public) ─
    if (req.method === 'GET' && query.action === 'public') {
        try {
            return res.status(200).json({
                success: true,
                config: getPublicStorefrontConfig()
            });
        } catch (_) {
            return res.status(503).json({ success: false, error: 'SETTINGS_UNAVAILABLE' });
        }
    }

    // ── 2. Admin Authentication Gate ──────────────────────────────────────────
    if (!isAuthorized(req)) {
        return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Admin session required.' });
    }

    // ── 3. Read All Public Settings (GET) ─────────────────────────────────────
    if (req.method === 'GET') {
        try {
            return res.status(200).json({
                success: true,
                settings: getPublicSettings()
            });
        } catch (_) {
            return res.status(503).json({ success: false, error: 'SETTINGS_UNAVAILABLE' });
        }
    }

    // ── 4. CSRF / Trusted Origin Guard on State-Changing Methods ──────────────
    if (!isTrustedOrigin(req)) {
        return res.status(403).json({ success: false, error: 'CSRF_REJECTED', message: 'Untrusted origin.' });
    }

    const contentLength = parseInt(req.headers?.['content-length'] || '0', 10);
    if (contentLength > 65536) {
        return res.status(400).json({ success: false, error: 'PAYLOAD_TOO_LARGE', message: 'Request payload exceeds 64KB limit.' });
    }

    let body = req.body || {};
    if (typeof body === 'string') {
        if (Buffer.byteLength(body) > 65536) {
            return res.status(400).json({ success: false, error: 'PAYLOAD_TOO_LARGE', message: 'Request payload exceeds 64KB limit.' });
        }
        try { body = JSON.parse(body); } catch (_) {}
    }

    const action = String(body.action || query.action || 'save').toLowerCase();

    // ── Telegram Template & Custom Message Actions (Phase 8F Milestone 2) ─────
    if (action === 'save_template') {
        const event = String(body.event || '').trim();
        if (!SUPPORTED_TELEGRAM_EVENTS.has(event)) {
            return res.status(400).json({ success: false, error: 'INVALID_EVENT', message: `Event '${event}' is unsupported.` });
        }
        const draftTemplate = typeof body.draftTemplate === 'string' ? body.draftTemplate : '';
        if (draftTemplate.length > 8192) {
            return res.status(400).json({ success: false, error: 'PAYLOAD_TOO_LARGE', message: 'Template text exceeds maximum allowed size.' });
        }
        try {
            const updated = saveTemplateDraft(event, draftTemplate, body.enabled, 'admin');
            return res.status(200).json({ success: true, settings: updated, event });
        } catch (_) {
            return res.status(503).json({ success: false, error: 'SETTINGS_UNAVAILABLE' });
        }
    }

    if (action === 'activate_template') {
        const event = String(body.event || '').trim();
        if (!SUPPORTED_TELEGRAM_EVENTS.has(event)) {
            return res.status(400).json({ success: false, error: 'INVALID_EVENT', message: `Event '${event}' is unsupported.` });
        }
        try {
            const updated = activateTemplate(event, 'admin');
            return res.status(200).json({ success: true, settings: updated, event });
        } catch (_) {
            return res.status(503).json({ success: false, error: 'SETTINGS_UNAVAILABLE' });
        }
    }

    if (action === 'restore_template') {
        const event = String(body.event || '').trim();
        if (!SUPPORTED_TELEGRAM_EVENTS.has(event)) {
            return res.status(400).json({ success: false, error: 'INVALID_EVENT', message: `Event '${event}' is unsupported.` });
        }
        try {
            const updated = restoreTemplateDefault(event, 'admin');
            return res.status(200).json({ success: true, settings: updated, event });
        } catch (_) {
            return res.status(503).json({ success: false, error: 'SETTINGS_UNAVAILABLE' });
        }
    }

    if (action === 'toggle_template') {
        const event = String(body.event || '').trim();
        if (!SUPPORTED_TELEGRAM_EVENTS.has(event)) {
            return res.status(400).json({ success: false, error: 'INVALID_EVENT', message: `Event '${event}' is unsupported.` });
        }
        if (typeof body.enabled !== 'boolean') {
            return res.status(400).json({ success: false, error: 'INVALID_SETTINGS', message: 'Field enabled must be a boolean.' });
        }
        try {
            const updated = toggleTemplate(event, body.enabled, 'admin');
            return res.status(200).json({ success: true, settings: updated, event });
        } catch (_) {
            return res.status(503).json({ success: false, error: 'SETTINGS_UNAVAILABLE' });
        }
    }

    if (action === 'send_test_message') {
        const event = String(body.event || '').trim();
        if (!SUPPORTED_TELEGRAM_EVENTS.has(event)) {
            return res.status(400).json({ success: false, error: 'INVALID_EVENT', message: `Event '${event}' is unsupported.` });
        }

        const rateCheck = checkAdminTestRateLimit(req);
        if (!rateCheck.allowed) {
            res.setHeader('Retry-After', String(rateCheck.retryAfter));
            return res.status(429).json({
                success: false,
                error: 'RATE_LIMITED',
                message: rateCheck.message,
                retryAfter: rateCheck.retryAfter
            });
        }

        const effective = getEffectiveSettings().telegram;
        if (!effective.botToken || !effective.chatId) {
            return res.status(400).json({
                success: false,
                error: 'TELEGRAM_NOT_CONFIGURED',
                message: 'Telegram bot token and chat ID must be configured in settings.'
            });
        }

        let engine = null;
        try { engine = require('../lib/telegram-template-engine'); } catch (_) {}
        if (!engine) {
            return res.status(500).json({ success: false, error: 'ENGINE_UNAVAILABLE' });
        }

        let templateText = typeof body.templateText === 'string' && body.templateText.trim() ? body.templateText.trim() : null;
        if (templateText && templateText.length > 8192) {
            return res.status(400).json({ success: false, error: 'PAYLOAD_TOO_LARGE' });
        }

        if (!templateText) {
            const tpls = effective.templates || {};
            const stored = tpls[event];
            templateText = (stored && (stored.draftTemplate || stored.activeTemplate)) || (engine.getEventRegistry()[event]?.defaultTemplate) || '';
        }

        const sampleData = engine.getSampleData(event);
        const rendered = engine.renderTemplate(templateText, sampleData, { isTest: true, event });

        try {
            const dispatchRes = await sendTelegramHttpRequest(effective.botToken, effective.chatId, rendered.text);
            return res.status(200).json({
                success: true,
                message: 'Test message dispatched successfully.',
                event,
                chatId: effective.chatId,
                messageId: dispatchRes?.result?.message_id,
                test: true,
                charCount: rendered.charCount
            });
        } catch (err) {
            const sanitized = String(err.message || err).replace(/\/bot[a-zA-Z0-9_:-]+/g, '/bot[REDACTED_TOKEN]');
            return res.status(500).json({
                success: false,
                error: 'TELEGRAM_DISPATCH_FAILED',
                message: sanitized
            });
        }
    }

    if (action === 'send_custom_message') {
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const bodyText = typeof body.body === 'string' ? body.body.trim() : '';
        if (!title || !bodyText) {
            return res.status(400).json({ success: false, error: 'INVALID_PAYLOAD', message: 'Both title and body are required.' });
        }
        if (title.length > 256 || bodyText.length > 4096) {
            return res.status(400).json({ success: false, error: 'PAYLOAD_TOO_LARGE', message: 'Title or body exceeds length limits.' });
        }

        const effective = getEffectiveSettings().telegram;
        if (!effective.botToken || !effective.chatId) {
            return res.status(400).json({ success: false, error: 'TELEGRAM_NOT_CONFIGURED', message: 'Telegram bot token and chat ID must be configured.' });
        }

        let engine = null;
        try { engine = require('../lib/telegram-template-engine'); } catch (_) {}
        const messageText = engine && typeof engine.buildDefaultMessage === 'function'
            ? engine.buildDefaultMessage('ADMIN_ALERT', 'ADMIN-BROADCAST', { title, body: bodyText, admin_name: 'مدير المتجر' })
            : `📢 <b>${title}</b>\n━━━━━━━━━━━━━━━━━━\n${bodyText}\n━━━━━━━━━━━━━━━━━━\n<b>👤 المرسل:</b> مدير المتجر\n<b>📅 التاريخ:</b> ${new Date().toLocaleString('ar-DZ', { timeZone: 'Africa/Algiers' })}`;

        try {
            const dispatchRes = await sendTelegramHttpRequest(effective.botToken, effective.chatId, messageText);
            try {
                let audit = [];
                if (fs.existsSync(AUDIT_FILE)) {
                    try { audit = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8')); } catch (_) { audit = []; }
                }
                audit.push({
                    timestamp: new Date().toISOString(),
                    action: 'SETTINGS_UPDATE',
                    integration: 'telegram',
                    subAction: 'CUSTOM_MESSAGE',
                    admin: 'admin'
                });
                if (audit.length > 1000) audit = audit.slice(-1000);
                const tmp = `${AUDIT_FILE}.${process.pid}.tmp`;
                fs.writeFileSync(tmp, JSON.stringify(audit, null, 2), 'utf8');
                fs.renameSync(tmp, AUDIT_FILE);
            } catch (_) {}

            return res.status(200).json({
                success: true,
                message: 'Custom administrative message dispatched successfully.',
                chatId: effective.chatId,
                messageId: dispatchRes?.result?.message_id
            });
        } catch (err) {
            const sanitized = String(err.message || err).replace(/\/bot[a-zA-Z0-9_:-]+/g, '/bot[REDACTED_TOKEN]');
            return res.status(500).json({
                success: false,
                error: 'TELEGRAM_DISPATCH_FAILED',
                message: sanitized
            });
        }
    }

    // ── 5. Action: Connection Test ────────────────────────────────────────────
    if (action === 'test') {
        const integration = String(body.integration || '').trim();
        if (!integration) {
            return res.status(400).json({ success: false, error: 'MISSING_INTEGRATION' });
        }
        try {
            const testResult = await runConnectionTest(integration, body.credentials || {});
            return res.status(200).json({
                success: true,
                testResult
            });
        } catch (err) {
            return res.status(500).json({
                success: false,
                testResult: {
                    success: false,
                    configured: true,
                    reachable: false,
                    authenticated: false,
                    operational: false,
                    message: err.message
                }
            });
        }
    }

    // ── 6. Action: Delete / Clear Credential ───────────────────────────────────
    if (action === 'delete' || action === 'clear') {
        const integration = String(body.integration || '').trim();
        const field = String(body.field || 'token').trim();

        const patch = {};
        if (integration === 'redex') patch.redex = { clearApiToken: true };
        else if (integration === 'ecotrack') patch.ecotrack = { clearApiToken: true };
        else if (integration === 'telegram') patch.telegram = field === 'chatId' ? { clearChatId: true } : { clearBotToken: true };
        else if (integration === 'metaPixel') patch.metaPixel = field === 'capi' ? { clearCapiToken: true } : { clearPixelId: true };
        else {
            return res.status(400).json({ success: false, error: 'INVALID_INTEGRATION' });
        }

        try {
            const updated = updateSettings(patch, 'admin');
            return res.status(200).json({ success: true, settings: updated });
        } catch (err) {
            return res.status(503).json({ success: false, error: 'SETTINGS_UNAVAILABLE' });
        }
    }

    // ── 7. Action: Save / Update ──────────────────────────────────────────────
    if (req.method === 'POST' || req.method === 'PUT') {
        try {
            const patch = {};
            if (body.redex !== undefined) patch.redex = validateCourierSettings(body.redex, DEFAULT_REDEX_URL);
            if (body.ecotrack !== undefined) patch.ecotrack = validateCourierSettings(body.ecotrack, DEFAULT_ECOTRACK_URL);
            if (body.telegram !== undefined) patch.telegram = validateTelegram(body.telegram);
            if (body.metaPixel !== undefined) patch.metaPixel = validateMetaPixel(body.metaPixel);

            if (!Object.keys(patch).length) {
                return res.status(400).json({ success: false, error: 'INVALID_SETTINGS', message: 'No valid integration settings provided.' });
            }

            const updated = updateSettings(patch, 'admin');
            return res.status(200).json({ success: true, settings: updated });
        } catch (error) {
            if (error?.message === 'LEGACY_PIXEL_DECOMMISSIONED') {
                return res.status(400).json({
                    success: false,
                    error: 'LEGACY_PIXEL_DECOMMISSIONED',
                    message: 'Legacy Pixel ID 2340414976777036 is decommissioned. Enter a new Pixel ID.'
                });
            }
            if (error?.message === 'INVALID_SETTINGS') {
                return res.status(400).json({ success: false, error: 'INVALID_SETTINGS', message: 'Settings validation failed.' });
            }
            return res.status(503).json({ success: false, error: 'SETTINGS_UNAVAILABLE' });
        }
    }

    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
};

adminSettingsHandler.resetAdminTestRateLimits = resetAdminTestRateLimits;

module.exports = adminSettingsHandler;
