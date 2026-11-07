'use strict';
// =============================================================================
// Meta Conversions API (CAPI) Client — Server-side Purchase Event Tracking
// Adheres strictly to Phase 8D requirements:
// - Legacy Pixel ID '2340414976777036' decommissioned; dynamic configuration enforced.
// - Meta Access Token kept server-secret (never exposed to browser or logs).
// - Deduplicates with Browser Pixel via matching event_name ('Purchase'), matching event_id (orderId),
//   currency ('DZD'), and matching total value.
// =============================================================================

const crypto = require('crypto');
const https = require('https');

const GRAPH_API_VERSION = 'v19.0';
const LEGACY_PIXEL_ID   = '2340414976777036'; // Legacy Decommissioned Pixel ID
const DEFAULT_PIXEL_ID  = ''; // Dynamic: must be set via process.env.META_PIXEL_ID

/**
 * SHA-256 hash helper (hex output, trimmed, lowercase).
 */
function sha256(val) {
    if (!val) return null;
    const clean = String(val).trim().toLowerCase();
    if (!clean) return null;
    return crypto.createHash('sha256').update(clean).digest('hex');
}

/**
 * Normalize and hash Algerian phone number according to Meta guidelines.
 * Expected Meta format: Country code + Number without leading 0 or symbols (e.g. 213555123456).
 */
function hashPhone(phone) {
    if (!phone) return null;
    let digits = String(phone).replace(/\D/g, '');
    if (digits.startsWith('0') && digits.length === 10) {
        digits = '213' + digits.substring(1);
    } else if (!digits.startsWith('213') && digits.length === 9) {
        digits = '213' + digits;
    }
    return sha256(digits);
}

/**
 * Extract first and last name from full name string and hash them.
 */
function hashNames(fullName) {
    if (!fullName) return { fn: null, ln: null };
    const parts = String(fullName).trim().split(/\s+/);
    const fn = parts[0] ? sha256(parts[0]) : null;
    const ln = parts.length > 1 ? sha256(parts.slice(1).join(' ')) : null;
    return { fn, ln };
}

/**
 * Send Purchase event to Meta Conversions API.
 *
 * @param {Object} params
 * @param {string} params.eventId         - Exact matching eventID (e.g. orderId)
 * @param {number} params.value           - Final total amount (e.g. 4950)
 * @param {string} [params.currency='DZD'] - Currency code
 * @param {string} [params.orderId]       - Order identifier
 * @param {string} [params.fullName]      - Customer full name
 * @param {string} [params.phone]         - Customer phone number
 * @param {string} [params.wilaya]        - Customer wilaya/state
 * @param {string} [params.commune]       - Customer commune/city
 * @param {string} [params.clientIp]      - Client IP address
 * @param {string} [params.userAgent]     - Client User Agent
 * @param {string} [params.eventSourceUrl]- Request origin / referrer URL
 * @param {string} [params.fbp]           - _fbp cookie value
 * @param {string} [params.fbc]           - _fbc cookie value
 * @param {number} [params.quantity=1]    - Quantity purchased
 * @param {string} [params.productName]   - Product name
 * @param {Function} [params.mockTransport] - Optional mock transport for tests
 * @returns {Promise<{success: boolean, response?: any, skipped?: boolean, error?: string, reason?: string}>}
 */
async function sendMetaPurchaseEvent(params) {
    let effectiveMeta = null;
    try {
        const { getEffectiveSettings } = require('./admin-settings-store');
        effectiveMeta = getEffectiveSettings().metaPixel;
    } catch (_) {}

    // Admin code-source gate: server CAPI can be deactivated independently of browser Pixel.
    if (effectiveMeta && effectiveMeta.capiEnabled === false) {
        return { success: false, skipped: true, reason: 'CAPI_CODE_SOURCE_DISABLED' };
    }

    const rawPixelId = params.pixelId || effectiveMeta?.pixelId || process.env.META_PIXEL_ID || DEFAULT_PIXEL_ID;
    const pixelId = String(rawPixelId).trim();

    // Decommissioned legacy Pixel check
    if (!pixelId) {
        return { success: false, skipped: true, reason: 'NO_PIXEL_ID' };
    }
    if (pixelId === LEGACY_PIXEL_ID) {
        console.warn('[Meta CAPI] Legacy Pixel ID 2340414976777036 is decommissioned. Skipping server event dispatch until new ID is configured.');
        return { success: false, skipped: true, reason: 'LEGACY_PIXEL_DECOMMISSIONED' };
    }

    const accessToken = params.accessToken || effectiveMeta?.capiToken || process.env.META_ACCESS_TOKEN || '';
    if (!accessToken && !params.mockTransport) {
        console.warn('[Meta CAPI] META_ACCESS_TOKEN is not configured in environment. Skipping server-side event dispatch.');
        return { success: false, skipped: true, reason: 'NO_ACCESS_TOKEN' };
    }

    if (!params.eventId) {
        console.warn('[Meta CAPI] Missing eventId for Purchase deduplication.');
        return { success: false, error: 'MISSING_EVENT_ID' };
    }

    const { fn, ln } = hashNames(params.fullName);
    const hashedPhone = hashPhone(params.phone);
    const hashedWilaya = params.wilaya ? sha256(params.wilaya) : null;
    const hashedCommune = params.commune ? sha256(params.commune) : null;
    const hashedEmail = params.email ? sha256(params.email) : null;

    const userData = {
        client_ip_address: params.clientIp || undefined,
        client_user_agent: params.userAgent || undefined,
        country:           [sha256('dz')]
    };

    if (hashedPhone) userData.ph = [hashedPhone];
    if (fn) userData.fn = [fn];
    if (ln) userData.ln = [ln];
    if (hashedWilaya) userData.st = [hashedWilaya];
    if (hashedCommune) userData.ct = [hashedCommune];
    if (params.fbp) userData.fbp = params.fbp;
    if (params.fbc) userData.fbc = params.fbc;
    if (hashedEmail) userData.em = [hashedEmail];

    const rawValue = typeof params.value === 'number' ? params.value : (parseFloat(params.value) || 0);
    const targetCurrency = (params.currency || 'DZD').toUpperCase();
    const eventTime = Math.floor(Date.now() / 1000);

    const customData = {
        currency:     targetCurrency,
        value:        rawValue,
        content_name: params.contentName || params.productName || 'pack1',
        num_items:    Number(params.quantity) || 1
    };
    if (params.contentIds && Array.isArray(params.contentIds) && params.contentIds.length > 0) {
        customData.content_ids = params.contentIds;
        customData.content_type = 'product';
    }

    const eventPayload = {
        event_name:       'Purchase',
        event_time:       eventTime,
        event_id:         String(params.eventId),
        event_source_url: params.eventSourceUrl || 'https://orva-store.com',
        action_source:    'website',
        user_data:        userData,
        custom_data:      customData
    };

    const requestBody = {
        data: [eventPayload]
    };

    const testEventCode = params.testEventCode || process.env.META_TEST_EVENT_CODE || null;
    if (testEventCode) {
        requestBody.test_event_code = String(testEventCode).trim();
    }

    // Support mock transport for automated test suite
    if (params.mockTransport) {
        return params.mockTransport({
            pixelId,
            requestBody,
            eventPayload
        });
    }

    const payloadString = JSON.stringify(requestBody);

    return new Promise((resolve) => {
        const options = {
            hostname: 'graph.facebook.com',
            port: 443,
            path: `/${GRAPH_API_VERSION}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`,
            method: 'POST',
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payloadString)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve({ success: true, response: parsed });
                    } else {
                        resolve({ success: false, error: parsed.error ? parsed.error.message : data });
                    }
                } catch (e) {
                    resolve({ success: false, error: 'JSON_PARSE_ERROR' });
                }
            });
        });

        req.on('timeout', () => {
            req.destroy(new Error('META_CAPI_TIMEOUT'));
        });

        req.on('error', (err) => {
            resolve({ success: false, error: err.message });
        });

        req.write(payloadString);
        req.end();
    });
}

module.exports = {
    sendMetaPurchaseEvent,
    sha256,
    hashPhone,
    hashNames,
    LEGACY_PIXEL_ID,
    DEFAULT_PIXEL_ID
};
