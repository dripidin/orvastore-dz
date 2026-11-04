'use strict';
// =============================================================================
// ORVA Store — Hardened Courier Gateway Client (RedEx & Ecotrack)
// Adheres strictly to Phase 8D requirements:
// 1. SSRF Guard: HTTPS only, restricted to verified Algerian courier domains.
// 2. Strict 8s network timeout.
// 3. Side-effect-free health check (GET /api/v1/get/wilayas).
// 4. Manual dashboard shipment creation with orderId duplicate prevention.
// 5. Real provider tracking number preservation (no fake RDX-{id}-DZ).
// 6. Non-mutating status mapping (does not alter internal order price, COD, inventory).
// 7. Zero token exposure in error logs or responses.
// =============================================================================

const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const { mapExternalCourierStatus } = require('./courier-status-mapper');
const { getEffectiveSettings } = require('./admin-settings-store');

const SHIPMENTS_FILE = path.join(__dirname, '..', 'data', 'shipments-registry.json');
const DEFAULT_TIMEOUT_MS = 8000;

// Allowed Algerian Courier Domains (SSRF Protection)
const ALLOWED_COURIER_DOMAINS = [
    'rex.ecotrack.dz',
    'redex.ecotrack.dz',
    'api.ecotrack.dz',
    'ecotrack.dz',
    'suivi.ecotrack.dz',
    'app.ecotrack.dz',
    'platform.dhd-dz.com',
    'app.conexlog-dz.com',
    'app.msmgo.ecotrack.dz',
    'api.yalidine.app',
    'procolis.com',
    'api.noest-dz.com',
    'api.maystro-delivery.com',
    'app.anderson-logistics.dz'
];

/**
 * Validate that an endpoint URL is HTTPS and belongs to an allowed courier domain.
 */
function validateCourierUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        throw new Error('INVALID_COURIER_URL: URL is required');
    }
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch (_) {
        throw new Error('INVALID_COURIER_URL: Malformed URL string');
    }

    if (parsed.protocol !== 'https:') {
        throw new Error(`INSECURE_PROTOCOL: Only HTTPS is allowed (received ${parsed.protocol})`);
    }

    const hostname = parsed.hostname.toLowerCase();
    const isAllowed = ALLOWED_COURIER_DOMAINS.some(allowed => {
        return hostname === allowed || hostname.endsWith('.' + allowed);
    });

    if (!isAllowed) {
        throw new Error(`RESTRICTED_DOMAIN: Hostname '${hostname}' is not in the approved courier whitelist`);
    }

    return parsed.origin;
}

/**
 * Read shipments registry.
 */
function readShipments() {
    try {
        if (!fs.existsSync(SHIPMENTS_FILE)) return {};
        return JSON.parse(fs.readFileSync(SHIPMENTS_FILE, 'utf8')) || {};
    } catch (_) {
        return {};
    }
}

/**
 * Write shipments registry atomically.
 */
function writeShipments(shipments) {
    try {
        fs.mkdirSync(path.dirname(SHIPMENTS_FILE), { recursive: true });
        const tmp = `${SHIPMENTS_FILE}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(shipments, null, 2), 'utf8');
        fs.renameSync(tmp, SHIPMENTS_FILE);
    } catch (e) {
        console.warn('[Shipments Registry] Write error:', e.message);
    }
}

/**
 * Low-level HTTPS request wrapper with strict timeout and sanitization.
 */
function makeHttpsRequest(urlStr, options = {}, bodyData = null) {
    return new Promise((resolve, reject) => {
        let parsed;
        try {
            parsed = new URL(urlStr);
        } catch (e) {
            return reject(new Error('INVALID_URL'));
        }

        const reqOptions = {
            hostname: parsed.hostname,
            port: parsed.port || 443,
            path: parsed.pathname + parsed.search,
            method: options.method || 'GET',
            timeout: options.timeout || DEFAULT_TIMEOUT_MS,
            headers: options.headers || {}
        };

        const req = https.request(reqOptions, (res) => {
            let resBody = '';
            res.on('data', chunk => { resBody += chunk; });
            res.on('end', () => {
                let parsedJson = null;
                try { parsedJson = JSON.parse(resBody); } catch (_) {}
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: parsedJson !== null ? parsedJson : resBody
                });
            });
        });

        req.on('timeout', () => {
            req.destroy(new Error('CONNECTION_TIMEOUT: Courier API request timed out after 8s'));
        });

        req.on('error', (err) => {
            reject(new Error(`NETWORK_ERROR: ${err.message}`));
        });

        if (bodyData) {
            req.write(typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
        }
        req.end();
    });
}

/**
 * 1. Health Check (Side-effect free)
 * Calls GET /api/v1/get/wilayas with Bearer token.
 * Validates connectivity and credentials without altering any state.
 */
async function testConnection(credentials = {}) {
    let effective = null;
    try {
        const { getEffectiveSettings } = require('./admin-settings-store');
        effective = getEffectiveSettings();
    } catch (_) {}

    const provider = String(credentials.provider || credentials.carrierId || credentials.courierId || '').toLowerCase();
    const effectiveRedex = effective?.redex || {};
    const effectiveEcotrack = effective?.ecotrack || {};

    let defaultUrl = 'https://redex.ecotrack.dz';
    let defaultToken = '';

    if (provider === 'redex') {
        defaultUrl = effectiveRedex.baseUrl || process.env.REDEX_BASE_URL || 'https://redex.ecotrack.dz';
        defaultToken = effectiveRedex.apiToken || process.env.REDEX_API_TOKEN || '';
    } else if (provider === 'ecotrack') {
        defaultUrl = effectiveEcotrack.baseUrl || process.env.ECOTRACK_API_BASE_URL || 'https://api.ecotrack.dz';
        defaultToken = effectiveEcotrack.apiToken || process.env.ECOTRACK_API_TOKEN || '';
    } else {
        defaultUrl = effectiveRedex.baseUrl || effectiveEcotrack.baseUrl || process.env.ECOTRACK_API_BASE_URL || 'https://redex.ecotrack.dz';
        defaultToken = effectiveRedex.apiToken || effectiveEcotrack.apiToken || process.env.ECOTRACK_API_TOKEN || process.env.REDEX_API_TOKEN || '';
    }

    const rawUrl = credentials.baseUrl || defaultUrl;
    const token = credentials.token !== undefined
        ? credentials.token
        : (credentials.apiToken !== undefined ? credentials.apiToken : defaultToken);

    if (!token) {
        return {
            success: false,
            configured: false,
            reachable: false,
            authenticated: false,
            error: 'MISSING_API_TOKEN',
            message: 'API token is not configured.'
        };
    }

    let baseUrl;
    try {
        baseUrl = validateCourierUrl(rawUrl);
    } catch (err) {
        return {
            success: false,
            configured: true,
            reachable: false,
            authenticated: false,
            error: err.message
        };
    }

    // Support mock for testing
    if (credentials.mockResponse) {
        return credentials.mockResponse;
    }

    try {
        const response = await makeHttpsRequest(`${baseUrl}/api/v1/get/wilayas`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        if (response.status === 200) {
            return {
                success: true,
                configured: true,
                reachable: true,
                authenticated: true,
                operational: true,
                message: 'Connection verified and authenticated successfully.'
            };
        } else if (response.status === 401 || response.status === 403) {
            return {
                success: false,
                configured: true,
                reachable: true,
                authenticated: false,
                operational: false,
                statusCode: response.status,
                error: 'AUTHENTICATION_FAILED',
                message: 'Invalid API token provided to courier provider.'
            };
        } else {
            return {
                success: false,
                configured: true,
                reachable: true,
                authenticated: false,
                operational: false,
                statusCode: response.status,
                error: 'PROVIDER_ERROR',
                message: `Courier service returned status ${response.status}.`
            };
        }
    } catch (err) {
        return {
            success: false,
            configured: true,
            reachable: false,
            authenticated: false,
            operational: false,
            error: err.message.includes('TIMEOUT') ? 'CONNECTION_TIMEOUT' : 'CONNECTION_FAILED',
            message: err.message
        };
    }
}

/**
 * 2. Create Shipment (Deliberate dashboard action with OrderId duplicate prevention)
 */
async function createShipment(orderPayload, credentials = {}) {
    if (!orderPayload || !orderPayload.orderId) {
        throw new Error('MISSING_ORDER_ID: orderId is required to create a shipment');
    }

    const orderId = orderPayload.orderId;

    // A. Check duplicate shipment prevention
    const shipments = readShipments();
    if (shipments[orderId] && shipments[orderId].trackingNumber) {
        return {
            success: true,
            duplicatePrevented: true,
            orderId: orderId,
            trackingNumber: shipments[orderId].trackingNumber,
            reference: shipments[orderId].reference || orderId,
            courierId: shipments[orderId].courierId || 'redex',
            message: 'Shipment already exists for this order; returned existing tracking record.'
        };
    }

    // B. Validate required logistics fields
    if (!orderPayload.fullName || !orderPayload.phone || !orderPayload.wilayaCode || !orderPayload.commune) {
        throw new Error('MISSING_LOGISTICS_FIELDS: fullName, phone, wilayaCode, and commune are required');
    }

    const price = parseInt(orderPayload.price || orderPayload.grandTotal || 0, 10);
    if (!price || price <= 0) {
        throw new Error('INVALID_PRICE: price must be a positive integer');
    }

    const rawUrl = credentials.baseUrl || process.env.ECOTRACK_API_BASE_URL || 'https://redex.ecotrack.dz';
    const token = credentials.token || credentials.apiToken || process.env.ECOTRACK_API_TOKEN || process.env.REDEX_API_TOKEN || '';

    if (!token && !credentials.mockTransport) {
        throw new Error('MISSING_API_TOKEN: API token is not configured for courier dispatch');
    }

    let baseUrl = 'https://redex.ecotrack.dz';
    if (!credentials.mockTransport) {
        baseUrl = validateCourierUrl(rawUrl);
    }

    const courierBody = {
        nom_client: orderPayload.fullName,
        telephone: orderPayload.phone,
        telephone_2: orderPayload.phone2 || null,
        adresse: orderPayload.address || (orderPayload.isStopDesk ? 'Bureau Stop Desk' : 'Centre Ville'),
        code_wilaya: String(orderPayload.wilayaCode),
        commune: orderPayload.commune,
        montant: price,
        remarque: orderPayload.remarks || (orderPayload.isStopDesk ? 'Stop Desk' : 'Domicile'),
        produit: orderPayload.productName || 'ORVA Store Order',
        type: 1,
        stop_desk: orderPayload.isStopDesk ? 1 : 0,
        reference: orderId
    };

    let resultData;

    // Support mock transport for test suite
    if (credentials.mockTransport) {
        resultData = await credentials.mockTransport(courierBody);
    } else {
        const response = await makeHttpsRequest(`${baseUrl}/api/v1/create/order`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        }, courierBody);

        if (response.status !== 200 && response.status !== 201) {
            const errDetail = (response.body && response.body.message) || `HTTP_${response.status}`;
            throw new Error(`COURIER_DISPATCH_FAILED: ${errDetail}`);
        }

        resultData = response.body;
    }

    if (!resultData || !resultData.tracking) {
        throw new Error('COURIER_RESPONSE_INVALID: Provider response did not contain a valid tracking number');
    }

    const realTrackingNumber = String(resultData.tracking).trim();
    const reference = resultData.reference || orderId;

    // Record shipment in registry
    shipments[orderId] = {
        orderId: orderId,
        trackingNumber: realTrackingNumber,
        reference: reference,
        courierId: credentials.courierId || 'redex',
        wilayaCode: orderPayload.wilayaCode,
        commune: orderPayload.commune,
        price: price,
        createdAt: new Date().toISOString(),
        rawResponse: resultData
    };
    writeShipments(shipments);

    return {
        success: true,
        orderId: orderId,
        trackingNumber: realTrackingNumber,
        reference: reference,
        courierId: credentials.courierId || 'redex',
        raw: resultData
    };
}

/**
 * 3. Get Tracking Status
 */
async function getTracking(trackingNumber, credentials = {}) {
    if (!trackingNumber) {
        throw new Error('MISSING_TRACKING_NUMBER: tracking number is required');
    }

    const rawUrl = credentials.baseUrl || process.env.ECOTRACK_API_BASE_URL || 'https://redex.ecotrack.dz';
    const token = credentials.token || credentials.apiToken || process.env.ECOTRACK_API_TOKEN || process.env.REDEX_API_TOKEN || '';

    // Support mock transport
    if (credentials.mockTracking) {
        const rawStatus = credentials.mockTracking.status || 'UNKNOWN';
        const mapped = mapExternalCourierStatus(rawStatus);
        return {
            success: true,
            trackingNumber: trackingNumber,
            rawStatus: rawStatus,
            normalizedStatus: mapped.normalizedStatus,
            receiptClassification: mapped.receiptClassification,
            labelAr: mapped.labelAr,
            labelEn: mapped.labelEn,
            history: credentials.mockTracking.history || []
        };
    }

    const baseUrl = validateCourierUrl(rawUrl);
    const response = await makeHttpsRequest(`${baseUrl}/api/v1/get/orders?tracking=${encodeURIComponent(trackingNumber)}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        }
    });

    if (response.status !== 200) {
        throw new Error(`TRACKING_LOOKUP_FAILED: HTTP_${response.status}`);
    }

    const data = response.body;
    const rawStatus = (data && (data.status || data.statut || (data.order && data.order.status))) || 'UNKNOWN';
    const mapped = mapExternalCourierStatus(rawStatus);

    return {
        success: true,
        trackingNumber: trackingNumber,
        rawStatus: rawStatus,
        normalizedStatus: mapped.normalizedStatus,
        receiptClassification: mapped.receiptClassification,
        labelAr: mapped.labelAr,
        labelEn: mapped.labelEn,
        history: data.history || data.events || []
    };
}

/**
 * 4. Cancel Shipment
 */
async function cancelShipment(trackingNumber, credentials = {}) {
    if (!trackingNumber) {
        throw new Error('MISSING_TRACKING_NUMBER: tracking number is required for cancellation');
    }

    if (credentials.mockCancel) {
        return credentials.mockCancel(trackingNumber);
    }

    const rawUrl = credentials.baseUrl || process.env.ECOTRACK_API_BASE_URL || 'https://redex.ecotrack.dz';
    const token = credentials.token || credentials.apiToken || process.env.ECOTRACK_API_TOKEN || process.env.REDEX_API_TOKEN || '';
    const baseUrl = validateCourierUrl(rawUrl);

    const response = await makeHttpsRequest(`${baseUrl}/api/v1/cancel/order`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    }, { tracking: trackingNumber });

    if (response.status === 200 || response.status === 204) {
        return { success: true, trackingNumber: trackingNumber, cancelled: true };
    }

    throw new Error(`CANCELLATION_FAILED: HTTP_${response.status}`);
}

/**
 * Helper to reset test shipments registry.
 */
function resetTestShipments() {
    try {
        if (fs.existsSync(SHIPMENTS_FILE)) {
            fs.unlinkSync(SHIPMENTS_FILE);
        }
    } catch (_) {}
}

module.exports = {
    validateCourierUrl,
    testConnection,
    createShipment,
    getTracking,
    cancelShipment,
    readShipments,
    resetTestShipments,
    ALLOWED_COURIER_DOMAINS
};
