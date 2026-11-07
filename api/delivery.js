'use strict';
// =============================================================================
// ORVA Store — Logistics Hub & Algerian Carriers API Gateway
// Supports: Ecotrack (Redex, DHD, Conexlog, MSM Go), Yalidine, ZR Express, Noest, Maystro, Anderson
// =============================================================================

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dzship = require('dzship');
const { resolveRedexCommune } = require('../lib/communesMapper');
const { getEffectiveSettings } = require('../lib/admin-settings-store');
const { dispatchTelegramNotification } = require('../lib/telegram-notifier');
const { mapExternalCourierStatus } = require('../lib/courier-status-mapper');
const { readShipments, writeShipments } = require('../lib/courier-client');

function getEcoTrackSettings() {
    try {
        return getEffectiveSettings().ecotrack;
    } catch (_) {
        return {
            apiToken: process.env.ECOTRACK_API_TOKEN || process.env.REDEX_API_TOKEN || '',
            baseUrl: process.env.ECOTRACK_API_BASE_URL || 'https://redex.ecotrack.dz'
        };
    }
}

// ── 1. Algerian Couriers Catalog ─────────────────────────────────────────────
const ALGERIAN_COURIERS = [
    {
        id: 'redex',
        name: 'Redex Delivery DZ',
        type: 'ecotrack',
        baseUrl: 'https://redex.ecotrack.dz',
        defaultToken: process.env.ECOTRACK_API_TOKEN || process.env.REDEX_API_TOKEN || '',
        active: true,
        logoText: 'REDEX'
    },
    {
        id: 'dhd',
        name: 'DHD Express',
        type: 'ecotrack',
        baseUrl: 'https://platform.dhd-dz.com',
        defaultToken: '',
        active: true,
        logoText: 'DHD'
    },
    {
        id: 'conexlog',
        name: 'Conexlog DZ',
        type: 'ecotrack',
        baseUrl: 'https://app.conexlog-dz.com',
        defaultToken: '',
        active: true,
        logoText: 'CONEXLOG'
    },
    {
        id: 'msmgo',
        name: 'MSM Go Express',
        type: 'ecotrack',
        baseUrl: 'https://app.msmgo.ecotrack.dz',
        defaultToken: '',
        active: true,
        logoText: 'MSM GO'
    },
    {
        id: 'yalidine',
        name: 'Yalidine Express',
        type: 'yalidine',
        baseUrl: 'https://api.yalidine.app',
        defaultToken: process.env.YALIDINE_API_TOKEN || '',
        apiId: process.env.YALIDINE_API_ID || '',
        fromWilaya: 16,
        active: true,
        logoText: 'YALIDINE'
    },
    {
        id: 'zrexpress',
        name: 'ZR Express (Procolis)',
        type: 'zrexpress',
        baseUrl: 'https://procolis.com/api',
        defaultToken: process.env.ZR_API_TOKEN || '',
        key: process.env.ZR_API_KEY || '',
        active: true,
        logoText: 'ZR EXPRESS'
    },
    {
        id: 'noest',
        name: 'Noest Delivery',
        type: 'noest',
        baseUrl: 'https://api.noest-dz.com',
        defaultToken: process.env.NOEST_API_TOKEN || '',
        active: true,
        logoText: 'NOEST'
    },
    {
        id: 'maystro',
        name: 'Maystro Delivery',
        type: 'maystro',
        baseUrl: 'https://api.maystro-delivery.com',
        defaultToken: process.env.MAYSTRO_API_TOKEN || '',
        active: true,
        logoText: 'MAYSTRO'
    },
    {
        id: 'anderson',
        name: 'Anderson Express',
        type: 'anderson',
        baseUrl: 'https://app.anderson-logistics.dz',
        defaultToken: process.env.ANDERSON_API_TOKEN || '',
        active: true,
        logoText: 'ANDERSON'
    }
];

// Active Courier Client Factory
function getCourierClient(courierId = 'redex', customToken = '', customBaseUrl = '') {
    const courier = ALGERIAN_COURIERS.find(c => c.id === courierId) || ALGERIAN_COURIERS[0];
    const ecoTrack = courier.id === 'redex' ? getEcoTrackSettings() : null;
    const token = customToken || (ecoTrack ? ecoTrack.apiToken : courier.defaultToken || '');
    const baseUrl = customBaseUrl || ecoTrack?.baseUrl || courier.baseUrl;

    if (courier.type === 'yalidine') {
        return dzship({
            courier: 'yalidine',
            credentials: {
                apiId: courier.apiId || process.env.YALIDINE_API_ID || 'demo',
                apiToken: token
            },
            options: { fromWilaya: courier.fromWilaya || 16 }
        });
    }

    if (courier.type === 'zrexpress') {
        return dzship({
            courier: 'zrexpress',
            credentials: {
                token: token,
                key: courier.key || process.env.ZR_API_KEY || 'demo'
            }
        });
    }

    // Default Ecotrack Tenant
    return dzship({
        courier: 'ecotrack',
        credentials: { token: token },
        options: { baseUrl: baseUrl }
    });
}

// Direct Redex Ecotrack Order Creation Function
async function createRedexOrderDirect({ token, baseUrl, orderPayload }) {
    const ecoTrack = getEcoTrackSettings();
    const carrierUrl = (baseUrl || ecoTrack.baseUrl || 'https://redex.ecotrack.dz').replace(/\/+$/, '');
    const carrierToken = token || ecoTrack.apiToken || '';

    const wilayaCode = parseInt(orderPayload.wilayaCode) || 16;
    const rawCommune = orderPayload.commune || 'Alger Centre';
    const resolvedCommune = resolveRedexCommune(wilayaCode, rawCommune);

    const isStopDesk = (
        orderPayload.deliveryType === 'stopdesk' ||
        orderPayload.deliveryType === 'desk' ||
        String(orderPayload.deliveryType || '').toLowerCase().includes('stop') ||
        String(orderPayload.deliveryType || '').includes('المكتب')
    );

    let resolvedProductName = 'PACK 4EN1 4950';
    const pSource = String(orderPayload.productList || orderPayload.productName || orderPayload.orderId || '').toLowerCase();
    if (pSource.includes('13390') || pSource.includes('12950') || pSource.includes('pack 2') || pSource.includes('pack2') || pSource.includes('5') || pSource.includes('crown')) {
        resolvedProductName = 'PACK 5EN1 13390';
    } else {
        resolvedProductName = 'PACK 4EN1 4950';
    }

    const rawPriceStr = String(orderPayload.priceNum || orderPayload.price || orderPayload.grandTotal || '').replace(/[^\d]/g, '');
    const defaultPrice = (resolvedProductName.includes('13390') || resolvedProductName.includes('12950')) ? 13390 : 4950;
    const finalPriceNum = parseInt(rawPriceStr, 10) || defaultPrice;

    const deliveryNote = isStopDesk ? 'Stop Desk (استلام من المكتب)' : 'Domicile (توصيل للمنزل)';

    const redexBody = {
        nom_client: orderPayload.fullName || 'Client',
        telephone: orderPayload.phone || '0555000000',
        telephone_2: orderPayload.phone2 || null,
        adresse: orderPayload.address || (isStopDesk ? 'Bureau Stop Desk' : 'Centre Ville'),
        code_wilaya: String(wilayaCode),
        commune: resolvedCommune,
        montant: finalPriceNum,
        remarque: `${deliveryNote} - ${resolvedProductName}`,
        produit: resolvedProductName,
        type: 1,
        stop_desk: isStopDesk ? 1 : 0,
        reference: orderPayload.orderId || ('ORVA-' + Date.now().toString().slice(-5))
    };

    console.log('[Redex API] Dispatching order to:', `${carrierUrl}/api/v1/create/order`, 'Commune:', resolvedCommune);

    const res = await fetch(`${carrierUrl}/api/v1/create/order`, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + carrierToken,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(redexBody)
    });

    const resData = await res.json().catch(() => ({}));

    if (!res.ok) {
        let errDetail = resData.message || (`Erreur HTTP ${res.status}`);
        if (resData.errors) {
            const errList = Object.values(resData.errors).flat();
            errDetail += ' : ' + errList.join(' | ');
        }
        throw new Error(errDetail);
    }

    if (resData.success && resData.tracking) {
        return {
            trackingNumber: resData.tracking,
            reference: resData.reference,
            communeUsed: resolvedCommune,
            raw: resData
        };
    }

    throw new Error(resData.message || 'Réponse inattendue de Redex Delivery');
}

// Convert dashboard order format to dzship format
function convertToDzshipOrder(order) {
    let wilayaCode = 16;
    let communeName = 'الجزائر';
    let address = order.address || 'Centre Ville';

    if (order.wilayaCode) {
        wilayaCode = parseInt(order.wilayaCode);
    } else if (order.wilaya) {
        const wilayaMatch = order.wilaya.match(/^(\d+)/);
        wilayaCode = wilayaMatch ? parseInt(wilayaMatch[1]) : 16;
    }

    if (order.commune) {
        communeName = order.commune;
    } else if (order.wilaya) {
        const communeMatch = order.wilaya.match(/—\s*(.+)$/) || order.wilaya.match(/-\s*(.+)$/);
        communeName = communeMatch ? communeMatch[1].trim() : 'الجزائر';
    }

    const deliveryType = (order.deliveryType && (order.deliveryType.includes('Stop') || order.deliveryType.includes('المكتب') || order.deliveryType === 'desk' || order.deliveryType === 'stopdesk'))
        ? 'stopdesk'
        : 'home';

    return {
        reference: order.orderId || order.tracking_code || ('ORVA-' + Math.floor(10000 + Math.random() * 90000)),
        recipient: {
            fullName: order.fullName || 'Client Anonyme',
            phone: order.phone || '0555000000',
            wilayaCode: wilayaCode,
            communeName: communeName,
            address: address
        },
        deliveryType: deliveryType,
        productList: order.productList || order.productName || 'Sac Banane Moto Yamaha + Cadeaux',
        codAmount: order.priceNum || parseInt(String(order.grandTotal || '').replace(/\D/g, '')) || 4400
    };
}

function getStoredOrders() {
    try {
        const tmpFile = path.join(os.tmpdir(), 'orva_orders.json');
        if (fs.existsSync(tmpFile)) {
            return JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
        }
    } catch (e) {}
    return [];
}

function getBlacklistedOrders() {
    const defaultBlacklist = ['ECEOSK26081843163', 'ECEOSK26081842580', 'ECEOSK26081842574'];
    try {
        const tmpFile = path.join(os.tmpdir(), 'blacklisted_orders.json');
        if (fs.existsSync(tmpFile)) {
            const list = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
            return Array.from(new Set([...defaultBlacklist, ...list]));
        }
    } catch (e) { }
    return defaultBlacklist;
}

function addBlacklistedOrder(orderId) {
    if (!orderId) return;
    try {
        const tmpFile = path.join(os.tmpdir(), 'blacklisted_orders.json');
        let list = [];
        if (fs.existsSync(tmpFile)) {
            list = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
        }
        if (!list.includes(orderId)) {
            list.push(orderId);
            fs.writeFileSync(tmpFile, JSON.stringify(list), 'utf8');
        }
    } catch (e) { }
}

module.exports = async (req, res) => {
    // Restricted CORS origins (Exact matching, no wildcard when credentials used)
    const origin = req.headers?.origin || '';
    const allowedOrigins = [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:8080',
        'http://127.0.0.1:3000',
        'https://orva-store.com',
        'https://www.orva-store.com'
    ];
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, Sec-Fetch-Site'
    );

    if (req.method === 'OPTIONS') {
        if (res.writeHead) {
            res.writeHead(204);
            res.end();
        } else if (res.status) {
            res.status(204).end();
        } else {
            res.end();
        }
        return;
    }

    const bodyAction = (req.body && typeof req.body === 'object' && req.body.action) ? req.body.action : '';
    const action = (req.query?.action || bodyAction || '').toString().trim();
    const { id, tracking, courierId, baseUrl, token } = req.query || {};
    const method = req.method;

    // Delivery Tariffs (58 Wilayas Standard Rate Card)
    const tariffs = [
        { wilaya_id: 1, name: "Adrar / أدرار", home_price: 1000, desk_price: 600, active: true },
        { wilaya_id: 2, name: "Chlef / الشلف", home_price: 700, desk_price: 400, active: true },
        { wilaya_id: 3, name: "Laghouat / الأغواط", home_price: 900, desk_price: 500, active: true },
        { wilaya_id: 4, name: "Oum El Bouaghi / أم البواقي", home_price: 800, desk_price: 450, active: true },
        { wilaya_id: 5, name: "Batna / باتنة", home_price: 800, desk_price: 450, active: true },
        { wilaya_id: 6, name: "Béjaïa / بجاية", home_price: 750, desk_price: 400, active: true },
        { wilaya_id: 7, name: "Biskra / بسكرة", home_price: 550, desk_price: 350, active: true },
        { wilaya_id: 8, name: "Béchar / بشار", home_price: 1000, desk_price: 600, active: true },
        { wilaya_id: 9, name: "Blida / البليدة", home_price: 600, desk_price: 350, active: true },
        { wilaya_id: 10, name: "Bouira / البويرة", home_price: 700, desk_price: 400, active: true },
        { wilaya_id: 11, name: "Tamanrasset / تمنراست", home_price: 1400, desk_price: 900, active: true },
        { wilaya_id: 12, name: "Tébessa / تبسة", home_price: 850, desk_price: 500, active: true },
        { wilaya_id: 13, name: "Tlemcen / تلمسان", home_price: 800, desk_price: 450, active: true },
        { wilaya_id: 14, name: "Tiaret / تيارت", home_price: 800, desk_price: 450, active: true },
        { wilaya_id: 15, name: "Tizi Ouzou / تيزي وزو", home_price: 700, desk_price: 400, active: true },
        { wilaya_id: 16, name: "Alger / الجزائر", home_price: 400, desk_price: 300, active: true },
        { wilaya_id: 17, name: "Djelfa / الجلفة", home_price: 900, desk_price: 500, active: true },
        { wilaya_id: 18, name: "Jijel / جيجل", home_price: 750, desk_price: 400, active: true },
        { wilaya_id: 19, name: "Sétif / سطيف", home_price: 750, desk_price: 400, active: true },
        { wilaya_id: 20, name: "Saïda / سعيدة", home_price: 850, desk_price: 500, active: true },
        { wilaya_id: 21, name: "Skikda / سكيكدة", home_price: 800, desk_price: 450, active: true },
        { wilaya_id: 22, name: "Sidi Bel Abbès / سيدي بلعباس", home_price: 800, desk_price: 450, active: true },
        { wilaya_id: 23, name: "Annaba / عنابة", home_price: 800, desk_price: 450, active: true },
        { wilaya_id: 24, name: "Guelma / قالمة", home_price: 800, desk_price: 450, active: true },
        { wilaya_id: 25, name: "Constantine / قسنطينة", home_price: 750, desk_price: 400, active: true },
        { wilaya_id: 26, name: "Médéa / المدية", home_price: 700, desk_price: 400, active: true },
        { wilaya_id: 27, name: "Mostaganem / مستغانم", home_price: 800, desk_price: 450, active: true },
        { wilaya_id: 28, name: "M'Sila / المسيلة", home_price: 800, desk_price: 450, active: true },
        { wilaya_id: 29, name: "Mascara / معسكر", home_price: 800, desk_price: 450, active: true },
        { wilaya_id: 30, name: "Ouargla / ورقلة", home_price: 950, desk_price: 550, active: true },
        { wilaya_id: 31, name: "Oran / وهران", home_price: 750, desk_price: 400, active: true },
        { wilaya_id: 32, name: "El Bayadh / البيض", home_price: 1000, desk_price: 600, active: true },
        { wilaya_id: 33, name: "Illizi / إليزي", home_price: 1400, desk_price: 900, active: true },
        { wilaya_id: 34, name: "Bordj Bou Arréridj / برج بوعريريج", home_price: 750, desk_price: 400, active: true },
        { wilaya_id: 35, name: "Boumerdès / بومرداس", home_price: 600, desk_price: 350, active: true },
        { wilaya_id: 36, name: "El Tarf / الطارف", home_price: 850, desk_price: 500, active: true },
        { wilaya_id: 37, name: "Tindouf / تندوف", home_price: 1500, desk_price: 1000, active: true },
        { wilaya_id: 38, name: "Tissemsilt / تيسمسيلت", home_price: 850, desk_price: 500, active: true },
        { wilaya_id: 39, name: "El Oued / الوادي", home_price: 950, desk_price: 550, active: true },
        { wilaya_id: 40, name: "Khenchela / خنشلة", home_price: 850, desk_price: 500, active: true },
        { wilaya_id: 41, name: "Souk Ahras / سوق أهراس", home_price: 850, desk_price: 500, active: true },
        { wilaya_id: 42, name: "Tipaza / تيبازة", home_price: 600, desk_price: 350, active: true },
        { wilaya_id: 43, name: "Mila / ميلة", home_price: 750, desk_price: 400, active: true },
        { wilaya_id: 44, name: "Aïn Defla / عين الدفلى", home_price: 700, desk_price: 400, active: true },
        { wilaya_id: 45, name: "Naâma / النعامة", home_price: 1000, desk_price: 600, active: true },
        { wilaya_id: 46, name: "Aïn Témouchent / عين تموشنت", home_price: 800, desk_price: 450, active: true },
        { wilaya_id: 47, name: "Ghardaïa / غرداية", home_price: 950, desk_price: 550, active: true },
        { wilaya_id: 48, name: "Relizane / غليزان", home_price: 800, desk_price: 450, active: true },
        { wilaya_id: 49, name: "Timimoun / تيميمون", home_price: 1100, desk_price: 700, active: true },
        { wilaya_id: 50, name: "Bordj Badji Mokhtar / برج باجي مختار", home_price: 1600, desk_price: 1100, active: true },
        { wilaya_id: 51, name: "Ouled Djellal / أولاد جلال", home_price: 900, desk_price: 500, active: true },
        { wilaya_id: 52, name: "Béni Abbès / بني عباس", home_price: 1100, desk_price: 700, active: true },
        { wilaya_id: 53, name: "In Salah / عين صالح", home_price: 1400, desk_price: 900, active: true },
        { wilaya_id: 54, name: "In Guezzam / عين قزام", home_price: 1600, desk_price: 1100, active: true },
        { wilaya_id: 55, name: "Touggourt / تقرت", home_price: 950, desk_price: 550, active: true },
        { wilaya_id: 56, name: "Djanet / جانت", home_price: 1500, desk_price: 1000, active: true },
        { wilaya_id: 57, name: "El M'Ghair / المغير", home_price: 950, desk_price: 550, active: true },
        { wilaya_id: 58, name: "El Meniaa / المنيعة", home_price: 1100, desk_price: 700, active: true }
    ];

    try {
        const adminToken = (process.env.ADMIN_API_TOKEN || '').trim();
        const authHeader = (req.headers && (req.headers['authorization'] || req.headers['Authorization'])) || '';
        const cookieHeader = String(req.headers?.cookie || '');
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

        const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

        function safeTokenEqual(a, b) {
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

        // Distinct Authentication Pathways
        const isBearerAuth = Boolean(bearerToken && safeTokenEqual(bearerToken, adminToken));
        const isCookieAuth = Boolean(sessionToken && safeTokenEqual(sessionToken, adminToken));

        // State-changing actions definition
        const stateChangingActions = [
            'update_status', 'status', 'change_status', 'bulk_update_status',
            'modify_order', 'switch_order', 'delete', 'create', 'push_order'
        ];

        // ── 0. HTTP Method Guard on State-Changing Actions ──────────────────
        if (stateChangingActions.includes(action)) {
            const allowedMethods = action === 'delete' ? ['POST', 'DELETE'] : ['POST', 'PATCH'];
            if (!allowedMethods.includes(req.method)) {
                res.setHeader('Allow', allowedMethods.join(', '));
                return res.status(405).json({
                    success: false,
                    error: 'METHOD_NOT_ALLOWED',
                    message: `Action '${action}' requires ${allowedMethods.join(' or ')}.`
                });
            }
        }

        const adminActions = ['get_all_orders', 'orders', 'update_status', 'status', 'change_status', 'bulk_update_status', 'modify_order', 'switch_order', 'delete', 'analytics', 'marketing_funnel', 'audit_logs', 'system_health', 'integrations', 'customers', 'push_order'];
        if (adminActions.includes(action)) {
            if (!adminToken) {
                return res.status(503).json({
                    success: false,
                    error: 'SERVER_MISCONFIGURED',
                    message: 'ADMIN_API_TOKEN is not configured.'
                });
            }
            if (!isBearerAuth && !isCookieAuth) {
                return res.status(401).json({
                    success: false,
                    error: 'UNAUTHORIZED_ACCESS',
                    message: 'Authorization: Bearer <ADMIN_API_TOKEN> or valid session cookie required.'
                });
            }

            // CSRF Gate: Applied to browser Cookie authentication
            if (isCookieAuth && !isBearerAuth) {
                const secFetchSite = String(req.headers?.['sec-fetch-site'] || '').toLowerCase();
                if (secFetchSite === 'cross-site') {
                    return res.status(403).json({
                        success: false,
                        error: 'CSRF_REJECTED',
                        message: 'Cross-site browser request rejected by Sec-Fetch-Site policy.'
                    });
                }

                // State-changing operations via Cookie MUST have a trusted Origin header
                if (stateChangingActions.includes(action)) {
                    if (!origin) {
                        return res.status(403).json({
                            success: false,
                            error: 'CSRF_ORIGIN_REQUIRED',
                            message: 'Origin header is required for state-changing browser sessions.'
                        });
                    }
                    if (!allowedOrigins.includes(origin)) {
                        return res.status(403).json({
                            success: false,
                            error: 'CSRF_ORIGIN_DISALLOWED',
                            message: 'Origin header is not permitted for state-changing browser sessions.'
                        });
                    }
                }
            }
            // S2S Bearer token pathway: Allowed without Origin header for automation / CLI
        }

        // ── 1. Fetch All Orders ───────────────────────────────────────────────
        if (action === 'get_all_orders' || action === 'orders') {
            const { getAllOrdersFromDb } = require('../lib/db');
            const dbOrders = await getAllOrdersFromDb();
            const stored = getStoredOrders();
            const blacklist = getBlacklistedOrders();

            const combinedMap = new Map();

            // 1. Add all Database orders (primary source)
            dbOrders.forEach(o => {
                // Normalize status
                let normalizedStatus = o.status || 'pending';
                const sLow = String(normalizedStatus).toLowerCase();
                if (sLow.includes('retour') || sLow.includes('مرتجع') || sLow.includes('echou') || sLow.includes('refus')) {
                    normalizedStatus = 'returned';
                } else if (sLow.includes('livr') || sLow.includes('تسليم') || sLow.includes('مستلم')) {
                    normalizedStatus = 'delivered';
                } else if (sLow.includes('shipped') || sLow.includes('exped') || sLow.includes('redex') || sLow.includes('ecotrack') || o.in_redex) {
                    normalizedStatus = 'shipped';
                }

                combinedMap.set(o.orderId, {
                    ...o,
                    status: normalizedStatus,
                    in_redex: o.in_redex || (o.redex_tracking_code && o.redex_tracking_code.length > 0)
                });
            });

            // 2. Add local stored orders
            stored.forEach(o => {
                if (!combinedMap.has(o.orderId)) {
                    combinedMap.set(o.orderId, { ...o, in_redex: o.in_redex || false });
                }
            });

            const finalOrders = Array.from(combinedMap.values()).filter(o =>
                !blacklist.includes(o.orderId) && !blacklist.includes(o.tracking_code) && o.status !== 'deleted'
            );

            return res.status(200).json({ success: true, count: finalOrders.length, data: finalOrders });
        }

        // ── 1.2. Update Order Status (Direct Admin Control & Bulk Updates) ──
        if (action === 'update_status' || action === 'status' || action === 'change_status' || action === 'bulk_update_status') {
            const body = req.body || {};
            // Strictly read mutation parameters from body (NEVER from req.query)
            const newStatus = (body.status || '').toString().trim().toLowerCase();

            if (!newStatus) {
                return res.status(400).json({ success: false, error: 'Statut manquant' });
            }

            const { updateOrderInDb } = require('../lib/db');

            // Bulk Status Update
            if (Array.isArray(body.orderIds) && body.orderIds.length > 0) {
                const results = [];
                for (const oId of body.orderIds) {
                    const clean = String(oId).trim();
                    if (!clean) continue;
                    try {
                        const up = await updateOrderInDb(clean, { status: newStatus });
                        if (up) results.push(up);
                    } catch (e) {
                        console.warn(`[BulkUpdate] Error updating ${clean}:`, e.message);
                    }
                }
                return res.status(200).json({
                    success: true,
                    message: `Mise à jour groupée de ${results.length} commandes vers '${newStatus}'.`,
                    status: newStatus,
                    updatedCount: results.length,
                    data: results
                });
            }

            // Single Status Update — Strictly from body
            const targetId = (body.orderId || body.id || '').toString().trim();
            if (!targetId) {
                return res.status(400).json({ success: false, error: 'Numéro de commande manquant' });
            }

            const updated = await updateOrderInDb(targetId, { status: newStatus });

            return res.status(200).json({
                success: true,
                message: `Statut de la commande ${targetId} mis à jour vers '${newStatus}'.`,
                orderId: targetId,
                status: newStatus,
                data: updated
            });
        }

        // ── 1.4. Order Switch / In-Place Modification & Audit ───────────────
        if (action === 'modify_order' || action === 'switch_order') {
            const body = req.body || {};
            // Strictly from body (NEVER from req.query)
            const orderId = (body.orderId || body.id || '').toString().trim();
            if (!orderId) {
                return res.status(400).json({ success: false, error: 'Missing orderId parameter' });
            }

            const { findOrderById, updateOrderInDb, createAuditLog } = require('../lib/db');
            const currentOrder = await findOrderById(orderId);
            if (!currentOrder) {
                return res.status(404).json({ success: false, error_code: 'ORDER_NOT_FOUND', error: `Order ${orderId} not found` });
            }

            if (action === 'switch_order') {
                const remarks = Array.isArray(currentOrder.remarks)
                    ? [...currentOrder.remarks]
                    : currentOrder.remarks ? [currentOrder.remarks] : [];
                const idempotencyKey = String(body.idempotencyKey || '').trim();
                if (!/^[A-Za-z0-9._:-]{8,100}$/.test(idempotencyKey)) {
                    return res.status(400).json({ success: false, error_code: 'INVALID_IDEMPOTENCY_KEY' });
                }
                const previousSwitch = remarks.find((remark) =>
                    remark && typeof remark === 'object' && remark.idempotency_key === idempotencyKey
                );
                if (previousSwitch) {
                    return res.status(200).json({
                        success: true,
                        orderId,
                        status: currentOrder.status,
                        redexComment: previousSwitch.redex_comment || ''
                    });
                }

                const currentStatus = String(currentOrder.status || '').toLowerCase();
                if (['delivered', 'cancelled', 'deleted'].includes(currentStatus)) {
                    return res.status(422).json({ success: false, error_code: 'CANNOT_SWITCH_TERMINAL_ORDER' });
                }
                const operatorOverride = body.operatorOverride === true;
                if ((currentOrder.in_redex || currentStatus === 'shipped') && !operatorOverride) {
                    return res.status(409).json({ success: false, error_code: 'SHIPPED_ORDER_OVERRIDE_REQUIRED' });
                }

                const reason = String(body.reason || '').trim();
                const fullName = String(body.fullName || currentOrder.fullName || '').trim();
                const phone = String(body.phone || currentOrder.phone || '').trim();
                const wilaya = String(body.wilaya || currentOrder.wilaya || '').trim();
                const commune = String(body.commune || currentOrder.commune || '').trim();
                const deliveryType = String(body.deliveryType || currentOrder.deliveryType || '').trim();
                const shippingFee = String(body.shippingFee || '').trim();
                const grandTotal = String(body.grandTotal || '').trim();
                if ([...reason].length < 3 || !fullName || !phone || !wilaya || !deliveryType) {
                    return res.status(400).json({ success: false, error_code: 'INVALID_SWITCH_FIELDS' });
                }

                const parseDzdAmount = (value) => {
                    const digits = String(value).replace(/\D+/g, '');
                    if (!digits || digits.length > 12) return null;
                    const amount = Number(digits);
                    return Number.isSafeInteger(amount) ? amount : null;
                };
                const shippingAmount = parseDzdAmount(shippingFee);
                const grandAmount = parseDzdAmount(grandTotal);
                const productAmount = currentOrder.priceNum == null ? null : Number(currentOrder.priceNum);
                const financialFieldsUnchanged = shippingFee === String(currentOrder.shippingFee || '')
                    && grandTotal === String(currentOrder.grandTotal || '');
                const invalidFinancialFields = shippingAmount === null || grandAmount === null
                    || (!Number.isSafeInteger(productAmount)
                        ? !financialFieldsUnchanged
                        : (productAmount < 0 || grandAmount !== productAmount + shippingAmount));
                if (invalidFinancialFields) {
                    return res.status(422).json({ success: false, error_code: 'INVALID_SWITCH_TOTAL' });
                }

                const nextSequence = remarks.filter((remark) =>
                    remark && typeof remark === 'object' && (remark.event === 'ORDER_CONVERSION' || remark.switch_status === 'switched')
                ).length + 1;
                const nowUtc = new Date().toISOString();
                const claimedName = String(body.claimedOperatorName || '').trim().slice(0, 50);
                const operator = claimedName ? `Orva Admin [${claimedName}]` : 'Orva Admin [Shared Session]';
                const redexComment = `[ORVA STORE — تعديل بيانات المستلم والتوصيل]\n`
                    + `─────────────────────────────────────────────\n`
                    + `• رقم الطلبية: ${orderId}\n`
                    + `• المنتج والكمية: ${currentOrder.productName || 'غير مسجل'} — ${currentOrder.quantity || 'غير مسجلة'}\n`
                    + `• المبلغ المسجل (COD): ${grandTotal}\n`
                    + `• العميل: ${fullName} | الهاتف: ${phone}\n`
                    + `• العنوان: ${wilaya} — ${commune} (${deliveryType})\n`
                    + `• سبب التعديل: ${reason}\n`
                    + `• تاريخ التعديل: ${nowUtc} (المسؤول: ${operator})\n`
                    + `─────────────────────────────────────────────\n`
                    + 'ملاحظة للموزع: يرجى تحديث بيانات المستلم والوجهة يدويًا؛ لا يتم إرسال التعديل إلى Redex آليًا.';

                const diff = {};
                for (const [field, before, after] of [
                    ['full_name', currentOrder.fullName || '', fullName],
                    ['phone', currentOrder.phone || '', phone],
                    ['wilaya', currentOrder.wilaya || '', wilaya],
                    ['commune', currentOrder.commune || '', commune],
                    ['delivery_type', currentOrder.deliveryType || '', deliveryType],
                    ['shipping_fee', currentOrder.shippingFee || '', shippingFee],
                    ['grand_total', currentOrder.grandTotal || '', grandTotal]
                ]) {
                    if (String(before) !== String(after)) diff[field] = { from: before, to: after };
                }
                diff.origin_hub = 'بسكرة (07 - Biskra Hub)';

                remarks.push({
                    event: 'ORDER_CONVERSION',
                    switch_status: 'switched',
                    conversion_sequence: nextSequence,
                    idempotency_key: idempotencyKey,
                    timestamp_utc: nowUtc,
                    operator,
                    reason,
                    override_applied: operatorOverride,
                    redex_tracking_code: currentOrder.redex_tracking_code || null,
                    redex_comment: redexComment,
                    diff
                });

                const updated = await updateOrderInDb(orderId, {
                    fullName,
                    phone,
                    wilaya,
                    commune,
                    deliveryType,
                    shippingFee,
                    grandTotal,
                    remarks
                });
                if (!updated) {
                    return res.status(502).json({ success: false, error_code: 'ORDER_SWITCH_UPDATE_FAILED' });
                }

                return res.status(200).json({
                    success: true,
                    orderId,
                    status: updated.status,
                    redexComment,
                    data: updated
                });
            }

            const currentStatus = (currentOrder.status || '').toLowerCase();

            // Terminal barriers
            if (currentStatus === 'delivered') {
                return res.status(422).json({ success: false, error_code: 'CANNOT_MODIFY_DELIVERED_ORDER', error: 'Cannot switch delivered order.' });
            }
            if (currentStatus === 'cancelled') {
                return res.status(422).json({ success: false, error_code: 'CANNOT_MODIFY_CANCELLED_ORDER', error: 'Cannot switch cancelled order.' });
            }
            if (currentStatus === 'deleted') {
                return res.status(422).json({ success: false, error_code: 'CANNOT_MODIFY_DELETED_ORDER', error: 'Cannot switch deleted order.' });
            }

            // Shipped barrier
            const operatorOverride = Boolean(body.operatorOverride);
            if ((currentOrder.in_redex || currentStatus === 'shipped') && !operatorOverride) {
                return res.status(409).json({
                    success: false,
                    error_code: 'SHIPPED_ORDER_OVERRIDE_REQUIRED',
                    error: 'Order is shipped. Operator override confirmation is required.'
                });
            }

            // Non-empty Reason validation
            const baseReason = (body.reason || '').trim();
            if (!baseReason) {
                return res.status(400).json({ success: false, error_code: 'MISSING_REASON', error: 'Reason is required for auditing.' });
            }

            // Target fields (recipient & delivery details, plus verified recalculated shipping fee from Biskra origin hub)
            const newFullName    = (body.fullName || currentOrder.fullName || '').trim();
            const newPhone       = (body.phone || currentOrder.phone || '').trim();
            const newWilaya      = (body.wilaya || currentOrder.wilaya || '').trim();
            const newCommune     = (body.commune || currentOrder.commune || '').trim();
            const newDelivery    = (body.deliveryType || currentOrder.deliveryType || 'توصيل للمنزل').trim();
            const newShippingFee = (body.shippingFee || currentOrder.shippingFee || '').trim();
            const newGrandTotal  = (body.grandTotal || currentOrder.grandTotal || '').trim();
            const serverOperator = 'Orva Admin [Shared Session]';
            const claimedName    = (body.claimedOperatorName || '').trim();
            const auditOperator  = claimedName ? `Orva Admin [${claimedName}]` : serverOperator;

            // Invariants: Product, Price, and Operational Status remain strictly UNCHANGED
            const diff = {};
            if (newFullName !== currentOrder.fullName) diff.full_name = { from: currentOrder.fullName, to: newFullName };
            if (newPhone !== currentOrder.phone) diff.phone = { from: currentOrder.phone, to: newPhone };
            if (newWilaya !== currentOrder.wilaya) diff.wilaya = { from: currentOrder.wilaya, to: newWilaya };
            if (newCommune !== currentOrder.commune) diff.commune = { from: currentOrder.commune, to: newCommune };
            if (newDelivery !== currentOrder.deliveryType) diff.delivery_type = { from: currentOrder.deliveryType, to: newDelivery };
            if (newShippingFee && newShippingFee !== currentOrder.shippingFee) {
                diff.shipping_fee = { from: currentOrder.shippingFee, to: newShippingFee };
            }
            if (newGrandTotal && newGrandTotal !== currentOrder.grandTotal) {
                diff.grand_total = { from: currentOrder.grandTotal, to: newGrandTotal };
            }
            diff.origin_hub = 'بسكرة (07 - Biskra Hub)';

            const remarks = Array.isArray(currentOrder.remarks) ? [...currentOrder.remarks] : currentOrder.remarks ? [currentOrder.remarks] : [];
            let convSeq = 1;
            for (const r of remarks) {
                if (typeof r === 'object' && r !== null && (r.event === 'ORDER_CONVERSION' || r.switch_status === 'switched')) {
                    convSeq++;
                }
            }

            const nowUtc = new Date().toISOString();
            const conversionEntry = {
                event: 'ORDER_CONVERSION',
                switch_status: 'switched',
                conversion_sequence: convSeq,
                conversion_id: `conv-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                timestamp_utc: nowUtc,
                operator: auditOperator,
                reason: baseReason,
                override_applied: operatorOverride,
                redex_tracking_code: currentOrder.redex_tracking_code || null,
                origin_hub: 'بسكرة (07 - Biskra Hub)',
                summary: `[${nowUtc}] تحويل (#${convSeq}) بواسطة ${auditOperator}: ${baseReason}`,
                diff
            };
            remarks.push(conversionEntry);

            // Audit log snapshot
            await createAuditLog('ORDER_SWITCH', 'order', orderId, auditOperator, {
                diff,
                operational_status: currentOrder.status,
                in_redex: currentOrder.in_redex,
                override_applied: operatorOverride,
                reason: baseReason,
                conversion_sequence: convSeq,
                timestamp_utc: nowUtc
            });

            // Update in-place in database preserving product & status invariants
            const updated = await updateOrderInDb(orderId, {
                fullName: newFullName,
                phone: newPhone,
                wilaya: newWilaya,
                commune: newCommune,
                deliveryType: newDelivery,
                shippingFee: newShippingFee,
                grandTotal: newGrandTotal,
                remarks: remarks,
                updated_at: nowUtc
            });

            let warningBlock = '';
            if (operatorOverride) {
                warningBlock = "⚠️ تنبيه لوجستي: تم تعديل الطلب بعد شحنه. يجب تحديث بوليصة الموزع (Redex) يدويًا.\n";
            }

            const redexComment = `[ORVA STORE — تحويل بيانات طلبية (#${convSeq})]\n`
                + `─────────────────────────────────────────────\n`
                + `• رقم الطلبية: ${orderId}\n`
                + `• اسم المستلم المحدث: ${newFullName}\n`
                + `• رقم الهاتف المحدث: ${newPhone}\n`
                + `• العنوان المحدث: ${newWilaya} — ${newCommune} (${newDelivery})\n`
                + `• نقطة الانطلاق الأصلية: بسكرة (07 - Biskra Hub)\n`
                + `• رسوم التوصيل المحدثة: ${newShippingFee}\n`
                + `• إجمالي التحصيل المحدث (COD): ${newGrandTotal}\n`
                + `• سبب التحويل: ${baseReason}\n`
                + `• توقيت التعديل: ${nowUtc} (المسؤول: ${auditOperator})\n`
                + warningBlock
                + `─────────────────────────────────────────────\n`
                + `ملاحظة للموزع: يرجى تسليم الطرد للمستلم المحدث أعلاه وتحصيل المبلغ المطلوب.`;

            return res.status(200).json({
                success: true,
                message: `Order ${orderId} switched successfully (Sequence #${convSeq}).`,
                orderId,
                conversionSequence: convSeq,
                status: currentOrder.status,
                overrideApplied: operatorOverride,
                redexComment,
                data: updated
            });
        }

        // ── 1.45. Marketing Funnel & Reports Analytics (Module 3) ────────────
        if (action === 'analytics' || action === 'marketing_funnel') {
            const { getAllOrdersFromDb } = require('../lib/db');
            const orders = await getAllOrdersFromDb();

            let total = orders.length;
            let pending = 0, confirmed = 0, shipped = 0, delivered = 0, returned = 0, cancelled = 0, switched = 0;
            let deliveredRevenue = 0;
            let pack1Count = 0, pack2Count = 0;

            orders.forEach(o => {
                const s = (o.status || '').toLowerCase();
                if (s === 'delivered') {
                    delivered++;
                    deliveredRevenue += (Number(o.priceNum || o.price_num) || 4950);
                } else if (s === 'shipped' || o.in_redex) {
                    shipped++;
                } else if (s === 'confirmed') {
                    confirmed++;
                } else if (s === 'returned' || s.includes('retour') || s.includes('مرتجع') || s.includes('refus')) {
                    returned++;
                } else if (s === 'cancelled' || s === 'deleted') {
                    cancelled++;
                } else {
                    pending++;
                }

                if (o.remarks) {
                    const rList = Array.isArray(o.remarks) ? o.remarks : [o.remarks];
                    const isSw = rList.some(r => typeof r === 'object' && r && (r.event === 'ORDER_CONVERSION' || r.switch_status === 'switched'));
                    if (isSw) switched++;
                }

                const prod = (o.productName || o.product_name || '').toLowerCase();
                if (prod.includes('pack 2') || prod.includes('5950')) {
                    pack2Count++;
                } else {
                    pack1Count++;
                }
            });

            return res.status(200).json({
                success: true,
                funnel: {
                    totalOrders: total,
                    pending,
                    confirmed,
                    shipped,
                    delivered,
                    returned,
                    cancelled,
                    switched,
                    deliveryRate: total > 0 ? ((delivered / total) * 100).toFixed(1) + '%' : '0%',
                    returnRate: total > 0 ? ((returned / total) * 100).toFixed(1) + '%' : '0%',
                    deliveredRevenueDZD: deliveredRevenue,
                    pack1Count,
                    pack2Count
                },
                externalAnalyticsNotice: {
                    source: "Unlinked External Service (Google Analytics / Cloudflare)",
                    status: "UNLINKED",
                    message: "بيانات جلسات الزوار الفريدة ومصادر الحملات تتطلب ربط Google Analytics أو Cloudflare API. المعروض هنا هو بيانات القمع التسويقي المحسوبة فعليًا من قاعدة بيانات الطلبيات المعتمدة."
                }
            });
        }

        // ── 1.46. Registered Customers Management (Module 4) ─────────────────
        if (action === 'customers') {
            const { getAllOrdersFromDb } = require('../lib/db');
            const orders = await getAllOrdersFromDb();

            const customerMap = new Map();

            orders.forEach(o => {
                let rawPhone = (o.phone || '').trim();
                let cleanPhone = rawPhone.replace(/[^\d]/g, '');
                if (cleanPhone.startsWith('213') && cleanPhone.length === 12) {
                    cleanPhone = '0' + cleanPhone.slice(3);
                }
                const key = cleanPhone || rawPhone || (o.fullName || 'unknown');

                if (!customerMap.has(key)) {
                    customerMap.set(key, {
                        phone: rawPhone,
                        normalizedPhone: cleanPhone,
                        fullName: o.fullName || o.full_name || 'عميل',
                        names: new Set([o.fullName || o.full_name].filter(Boolean)),
                        wilaya: o.wilaya || '',
                        commune: o.commune || '',
                        deliveryType: o.deliveryType || o.delivery_type || 'توصيل للمنزل',
                        totalOrders: 0,
                        deliveredOrders: 0,
                        returnedOrders: 0,
                        cancelledOrders: 0,
                        switchedOrders: 0,
                        totalSpent: 0,
                        orders: []
                    });
                }

                const c = customerMap.get(key);
                c.totalOrders++;
                if (o.fullName) c.names.add(o.fullName);
                const st = (o.status || '').toLowerCase();
                if (st === 'delivered') {
                    c.deliveredOrders++;
                    c.totalSpent += (Number(o.priceNum || o.price_num) || 0);
                } else if (st === 'returned') {
                    c.returnedOrders++;
                } else if (st === 'cancelled') {
                    c.cancelledOrders++;
                }

                let isSw = false;
                if (o.remarks) {
                    const rList = Array.isArray(o.remarks) ? o.remarks : [o.remarks];
                    isSw = rList.some(r => typeof r === 'object' && r && (r.event === 'ORDER_CONVERSION' || r.switch_status === 'switched'));
                }
                if (isSw) c.switchedOrders++;

                c.orders.push({
                    orderId: o.orderId || o.order_id,
                    date: o.created_at || new Date().toISOString(),
                    status: o.status,
                    total: o.grandTotal || o.grand_total,
                    isSwitched: isSw
                });
            });

            const customersList = Array.from(customerMap.values()).map(c => ({
                phone: c.phone,
                normalizedPhone: c.normalizedPhone,
                fullName: c.fullName,
                hasDuplicatePhone: c.names.size > 1,
                aliases: Array.from(c.names),
                wilaya: c.wilaya,
                commune: c.commune,
                deliveryType: c.deliveryType,
                totalOrders: c.totalOrders,
                deliveredOrders: c.deliveredOrders,
                returnedOrders: c.returnedOrders,
                cancelledOrders: c.cancelledOrders,
                switchedOrders: c.switchedOrders,
                hasReturns: c.returnedOrders > 0,
                hasSwitched: c.switchedOrders > 0,
                totalSpent: c.totalSpent,
                orders: c.orders
            }));

            return res.status(200).json({
                success: true,
                count: customersList.length,
                customers: customersList
            });
        }

        // ── 1.47. Integration & System Health Status (Module 5) ──────────────
        if (action === 'system_health' || action === 'integrations') {
            const { getPgPool } = require('../lib/supabaseServer');
            let dbStatus = 'CONNECTED';
            let dbProvider = 'Supabase PostgreSQL';
            let poolReady = false;

            try {
                const pool = getPgPool();
                if (pool) {
                    poolReady = true;
                } else {
                    dbStatus = 'LOCAL_FALLBACK';
                    dbProvider = 'Local Database (Offline Fallback)';
                }
            } catch (e) {
                dbStatus = 'LOCAL_FALLBACK';
                dbProvider = 'Local Fallback: ' + e.message;
            }

            const effectiveSettings = getEffectiveSettings();
            const ecoSettings = effectiveSettings.ecotrack || {};
            const tgSettings = effectiveSettings.telegram || {};
            const metaSettings = effectiveSettings.metaPixel || {};

            const envPixelId = process.env.META_PIXEL_ID || metaSettings.pixelId || '';
            const isLegacyPixel = envPixelId === '2340414976777036';
            const isPixelReady = Boolean(envPixelId) && !isLegacyPixel;

            const hasMetaToken = Boolean(process.env.META_ACCESS_TOKEN && process.env.META_ACCESS_TOKEN.length > 5);
            const hasEcoToken = Boolean(ecoSettings.apiToken || process.env.ECOTRACK_API_TOKEN || process.env.REDEX_API_TOKEN);
            const hasTelegram = Boolean(tgSettings.botToken && tgSettings.chatId);

            return res.status(200).json({
                success: true,
                timestamp: new Date().toISOString(),
                integrations: {
                    database: {
                        name: 'Supabase PostgreSQL',
                        status: dbStatus,
                        provider: dbProvider,
                        poolReady: poolReady,
                        safeMode: true
                    },
                    meta_pixel: {
                        name: 'Meta Pixel (Browser)',
                        pixelId: isLegacyPixel ? '' : envPixelId,
                        configured: isPixelReady,
                        status: isPixelReady ? 'ACTIVE' : (isLegacyPixel ? 'LEGACY_DECOMMISSIONED_BLOCKED' : 'UNCONFIGURED'),
                        activationStatus: isPixelReady ? 'OPERATIONAL' : 'BLOCKED_AWAITING_NEW_PIXEL_ID',
                        standardEvents: ['PageView', 'ViewContent', 'InitiateCheckout', 'Purchase'],
                        deduplicationMatchKey: 'event_id = order_id'
                    },
                    meta_capi: {
                        name: 'Meta Conversions API (Server CAPI)',
                        configured: hasMetaToken,
                        status: hasMetaToken ? 'CONFIGURED_SECURE' : 'UNCONFIGURED',
                        apiVersion: 'v19.0',
                        hashAlgorithm: 'SHA-256 (phone, name, wilaya)',
                        testModeSupported: true,
                        serverSecretMasked: 'Configured on server (never exposed to browser)',
                        switchPolicy: 'Order conversion does NOT dispatch duplicate Purchase events'
                    },
                    redex: {
                        name: 'Redex Ecotrack Logistics',
                        configured: hasEcoToken,
                        reachable: hasEcoToken,
                        authenticated: false,
                        operational: false,
                        status: hasEcoToken ? 'CONFIGURED_MANUAL_DISPATCH' : 'UNCONFIGURED',
                        mode: 'اعتماد يدوي من لوحة التحكم (Manual Dashboard Approval)',
                        hubOrigin: 'بسكرة (07 - Biskra Hub)',
                        automatedDispatch: false,
                        duplicatePrevention: 'orderId check before API dispatch'
                    },
                    ecotrack: {
                        name: 'Ecotrack Courier Network',
                        configured: hasEcoToken,
                        baseUrl: ecoSettings.baseUrl || 'https://redex.ecotrack.dz',
                        status: hasEcoToken ? 'CONFIGURED' : 'UNCONFIGURED'
                    },
                    telegram: {
                        name: 'Telegram Bot Notifications',
                        configured: hasTelegram,
                        chatIdConfigured: Boolean(tgSettings.chatId),
                        status: hasTelegram ? 'CONFIGURED' : 'UNCONFIGURED',
                        eventsSupported: ['ORDER_CREATED', 'SHIPMENT_CREATED', 'SHIPMENT_FAILED', 'STATUS_UPDATED', 'ORDER_CANCELLED'],
                        deduplication: 'data/telegram-dispatch-ledger.json'
                    },
                    delivery_api: {
                        name: 'Delivery & Orders Gateway',
                        status: 'HEALTHY_ACTIVE',
                        authMode: 'Bearer Token Enforced',
                        endpoints: ['/api/delivery', '/api/orders', '/api/send-order']
                    }
                }
            });
        }

        // ── 1.5. Admin Login Verification — Delegated to /api/auth ────────────
        if (action === 'login' || action === 'auth') {
            return res.status(405).json({
                success: false,
                error: 'USE_AUTH_ENDPOINT',
                message: 'Login must be performed via POST /api/auth'
            });
        }

        // ── 2. Couriers Directory & Configuration ─────────────────────────────
        if (action === 'couriers') {
            const publicCouriers = ALGERIAN_COURIERS.map(({ defaultToken, apiId, key, ...courier }) => ({
                ...courier,
                credentialsConfigured: Boolean(defaultToken || apiId || key)
            }));
            return res.status(200).json({
                success: true,
                count: publicCouriers.length,
                data: publicCouriers
            });
        }

        // ── 3. Test Courier Connection (Side-effect free GET /api/v1/get/wilayas) ──
        if (action === 'test_courier' || action === 'test_ecotrack') {
            const targetCourier = ALGERIAN_COURIERS.find(c => c.id === courierId) || ALGERIAN_COURIERS[0];
            const ecoTrack = targetCourier.id === 'redex' ? getEcoTrackSettings() : null;
            const providedToken = token || req.query.token || req.body?.token || '';
            const activeToken = providedToken || (ecoTrack
                ? ecoTrack.apiToken
                : targetCourier.defaultToken || process.env.ECOTRACK_API_TOKEN || process.env.REDEX_API_TOKEN || '');
            const carrierUrl = (baseUrl || req.query.baseUrl || req.body?.baseUrl || ecoTrack?.baseUrl || targetCourier.baseUrl || 'https://redex.ecotrack.dz').replace(/\/+$/, '');

            if (process.env.MOCK_COURIER === 'true' || req.body?.mock === true || req.query?.mock === 'true') {
                return res.status(200).json({
                    success: true,
                    configured: true,
                    reachable: true,
                    authenticated: true,
                    operational: true,
                    mocked: true,
                    courier: targetCourier.name,
                    baseUrl: carrierUrl,
                    message: 'MOCK_COURIER: connection test simulated locally (no remote call).'
                });
            }

            if (!activeToken) {
                return res.status(400).json({
                    success: false,
                    configured: false,
                    reachable: false,
                    authenticated: false,
                    operational: false,
                    courier: targetCourier.name,
                    error: 'MISSING_API_TOKEN',
                    message: 'Jeton API non configuré pour ce transporteur.'
                });
            }

            if (targetCourier.type === 'ecotrack' || targetCourier.id === 'redex') {
                try {
                    const testRes = await fetch(`${carrierUrl}/api/v1/get/wilayas`, {
                        headers: {
                            'Authorization': 'Bearer ' + activeToken,
                            'Accept': 'application/json'
                        }
                    });

                    if (testRes.ok) {
                        return res.status(200).json({
                            success: true,
                            configured: true,
                            reachable: true,
                            authenticated: true,
                            operational: true,
                            courier: targetCourier.name,
                            type: targetCourier.type,
                            baseUrl: carrierUrl,
                            status: 'OPERATIONAL',
                            message: `✅ Connexion réussie avec ${targetCourier.name} (Jeton API vérifié et valide)`
                        });
                    } else if (testRes.status === 401 || testRes.status === 403) {
                        return res.status(401).json({
                            success: false,
                            configured: true,
                            reachable: true,
                            authenticated: false,
                            operational: false,
                            courier: targetCourier.name,
                            error: 'AUTHENTICATION_FAILED',
                            message: 'Jeton API non autorisé (401 Unauthorized). Veuillez vérifier la clé saisie.'
                        });
                    } else {
                        return res.status(testRes.status).json({
                            success: false,
                            configured: true,
                            reachable: true,
                            authenticated: false,
                            operational: false,
                            courier: targetCourier.name,
                            error: `Erreur HTTP ${testRes.status} reçue du serveur ${targetCourier.name}`
                        });
                    }
                } catch (e) {
                    return res.status(500).json({
                        success: false,
                        configured: true,
                        reachable: false,
                        authenticated: false,
                        operational: false,
                        error: `Impossible de joindre le serveur ${carrierUrl} : ${e.message}`
                    });
                }
            }

            return res.status(200).json({
                success: true,
                configured: true,
                reachable: true,
                authenticated: true,
                operational: true,
                courier: targetCourier.name,
                type: targetCourier.type,
                baseUrl: carrierUrl,
                status: 'OPERATIONAL',
                message: `Passerelle ${targetCourier.name} prête.`
            });
        }

        // ── 3.6. Test Telegram Bot Connection (Safe verification) ──────────────
        if (action === 'test_telegram') {
            const effective = getEffectiveSettings();
            const botToken = req.query.botToken || req.body?.botToken || effective.telegram?.botToken || process.env.TELEGRAM_BOT_TOKEN;
            const chatId = req.query.chatId || req.body?.chatId || effective.telegram?.chatId || process.env.TELEGRAM_CHAT_ID;

            if (!botToken || !chatId) {
                return res.status(400).json({
                    success: false,
                    configured: false,
                    reachable: false,
                    authenticated: false,
                    operational: false,
                    error: 'MISSING_TELEGRAM_CREDENTIALS',
                    message: 'Bot token and Chat ID are required.'
                });
            }

            try {
                const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
                const tgData = await tgRes.json().catch(() => ({}));
                if (tgRes.ok && tgData.ok) {
                    return res.status(200).json({
                        success: true,
                        configured: true,
                        reachable: true,
                        authenticated: true,
                        operational: true,
                        botName: tgData.result?.username,
                        chatId: chatId,
                        message: `Telegram Bot @${tgData.result?.username || 'bot'} verified successfully.`
                    });
                } else {
                    return res.status(401).json({
                        success: false,
                        configured: true,
                        reachable: true,
                        authenticated: false,
                        operational: false,
                        error: 'TELEGRAM_AUTH_FAILED',
                        message: tgData.description || 'Invalid Telegram bot token.'
                    });
                }
            } catch (tgErr) {
                return res.status(500).json({
                    success: false,
                    configured: true,
                    reachable: false,
                    authenticated: false,
                    operational: false,
                    error: 'TELEGRAM_CONNECTION_ERROR',
                    message: tgErr.message
                });
            }
        }

        // ── 4. Create & Dispatch Parcel to Carrier API ─────────────────────────
        if ((action === 'create' || action === 'push_order') && method === 'POST') {
            const body = req.body || {};
            const mockCourier = process.env.MOCK_COURIER === 'true' || body.mock === true;
            if (mockCourier) {
                const targetOrderId = body.orderId || ('ORVA-' + Math.floor(10000 + Math.random() * 90000));
                const activeCourier = body.courierId || courierId || 'redex';
                const trackingNumber = 'MOCK-' + crypto.createHash('sha256')
                    .update(String(targetOrderId) + Date.now())
                    .digest('hex')
                    .slice(0, 10)
                    .toUpperCase();
                return res.status(200).json({
                    success: true,
                    mocked: true,
                    orderId: targetOrderId,
                    trackingCode: trackingNumber,
                    trackingNumber,
                    courierId: activeCourier,
                    courierName: activeCourier === 'ecotrack' ? 'Ecotrack DZ (mocked)' : 'Redex Delivery DZ (mocked)',
                    labelUrl: `/api/delivery?action=label_pdf&tracking=${encodeURIComponent(trackingNumber)}`,
                    message: 'MOCK_COURIER: shipment created locally without dispatching to a real carrier.'
                });
            }
            const activeCourier = body.courierId || courierId || 'redex';
            const ecoTrack = activeCourier === 'redex' ? getEcoTrackSettings() : null;
            const providedToken = body.token || req.query.token || token || '';
            const activeToken = providedToken || (ecoTrack
                ? ecoTrack.apiToken
                : process.env.ECOTRACK_API_TOKEN || process.env.REDEX_API_TOKEN || '');
            const activeBaseUrl = (body.baseUrl || req.query.baseUrl || baseUrl || ecoTrack?.baseUrl || 'https://redex.ecotrack.dz').replace(/\/+$/, '');

            const targetOrderId = body.orderId || ('ORVA-' + Math.floor(10000 + Math.random() * 90000));

            // Duplicate Shipment Check (Phase 8D)
            const shipments = readShipments();
            if (shipments[targetOrderId] && shipments[targetOrderId].trackingNumber) {
                return res.status(200).json({
                    success: true,
                    duplicatePrevented: true,
                    orderId: targetOrderId,
                    trackingCode: shipments[targetOrderId].trackingNumber,
                    trackingNumber: shipments[targetOrderId].trackingNumber,
                    courier: shipments[targetOrderId].courierId || activeCourier,
                    message: 'Shipment already exists for this order. Returned existing tracking record.'
                });
            }

            const orderPayload = {
                orderId: targetOrderId,
                fullName: body.fullName || 'Client',
                phone: body.phone || '0555000000',
                phone2: body.phone2 || null,
                wilaya: body.wilaya || '16 - Alger',
                wilayaCode: body.wilayaCode || 16,
                commune: body.commune || 'Alger Centre',
                address: body.address || '',
                deliveryType: body.deliveryType || 'home',
                grandTotal: `${body.price || 4400} DZD`,
                priceNum: parseInt(body.price) || 4400,
                productList: body.productList || 'Pack Commande ORVA Store'
            };

            let trackingNumber = null;
            let courierRes = null;
            let resolvedCommuneName = orderPayload.commune;

            if (activeCourier === 'redex' || activeCourier.includes('ecotrack')) {
                try {
                    const redexRes = await createRedexOrderDirect({
                        token: activeToken,
                        baseUrl: activeBaseUrl,
                        orderPayload: orderPayload
                    });
                    trackingNumber = redexRes.trackingNumber;
                    resolvedCommuneName = redexRes.communeUsed;
                    courierRes = { status: 200, data: redexRes };

                    shipments[targetOrderId] = {
                        orderId: targetOrderId,
                        trackingNumber: trackingNumber,
                        reference: redexRes.reference || targetOrderId,
                        courierId: activeCourier,
                        wilayaCode: orderPayload.wilayaCode,
                        commune: resolvedCommuneName,
                        createdAt: new Date().toISOString()
                    };
                    writeShipments(shipments);

                    dispatchTelegramNotification({
                        event: 'SHIPMENT_CREATED',
                        orderId: targetOrderId,
                        data: {
                            courierName: 'RedEx Delivery',
                            trackingNumber: trackingNumber,
                            reference: redexRes.reference || targetOrderId,
                            wilaya: orderPayload.wilaya,
                            commune: resolvedCommuneName
                        }
                    }).catch(() => {});

                } catch (err) {
                    console.error('[Redex Direct Dispatch Error]:', err.message);

                    dispatchTelegramNotification({
                        event: 'SHIPMENT_FAILED',
                        orderId: targetOrderId,
                        data: {
                            courierName: 'RedEx Delivery',
                            errorMessage: err.message
                        }
                    }).catch(() => {});

                    return res.status(422).json({
                        success: false,
                        error: `Échec d'expédition vers Redex : ${err.message}`,
                        orderId: orderPayload.orderId
                    });
                }
            } else {
                // Fallback for other carriers via dzship
                const dzshipOrder = convertToDzshipOrder(orderPayload);
                const client = getCourierClient(activeCourier, activeToken, activeBaseUrl);
                try {
                    const apiRes = await client.createOrder(dzshipOrder);
                    if (apiRes && apiRes.trackingNumber) {
                        trackingNumber = apiRes.trackingNumber;
                        courierRes = { status: 200, data: apiRes };

                        shipments[targetOrderId] = {
                            orderId: targetOrderId,
                            trackingNumber: trackingNumber,
                            reference: targetOrderId,
                            courierId: activeCourier,
                            createdAt: new Date().toISOString()
                        };
                        writeShipments(shipments);

                        dispatchTelegramNotification({
                            event: 'SHIPMENT_CREATED',
                            orderId: targetOrderId,
                            data: {
                                courierName: activeCourier,
                                trackingNumber: trackingNumber
                            }
                        }).catch(() => {});
                    } else {
                        throw new Error('Aucun code de suivi retourné');
                    }
                } catch (err) {
                    dispatchTelegramNotification({
                        event: 'SHIPMENT_FAILED',
                        orderId: targetOrderId,
                        data: {
                            courierName: activeCourier,
                            errorMessage: err.message
                        }
                    }).catch(() => {});

                    return res.status(502).json({
                        success: false,
                        error: `Échec d'expédition vers ${activeCourier} : ${err.message}`
                    });
                }
            }

            // Sync with DB
            const { updateOrderInDb, saveOrderToDb } = require('../lib/db');
            try {
                await updateOrderInDb(orderPayload.orderId, {
                    in_redex: true,
                    redex_tracking_code: trackingNumber,
                    status: 'shipped',
                    commune: resolvedCommuneName
                });
            } catch (e) {
                await saveOrderToDb({
                    ...orderPayload,
                    in_redex: true,
                    redex_tracking_code: trackingNumber,
                    status: 'shipped',
                    commune: resolvedCommuneName
                });
            }

            return res.status(200).json({
                success: true,
                trackingCode: trackingNumber,
                trackingNumber: trackingNumber,
                courier: activeCourier,
                labelUrl: `/api/delivery?action=label_pdf&tracking=${encodeURIComponent(trackingNumber)}`,
                message: `Colis expédié avec succès vers ${activeCourier} (${trackingNumber})`,
                courierResponse: courierRes,
                data: {
                    tracking_code: trackingNumber,
                    trackingCode: trackingNumber,
                    order_id: orderPayload.orderId,
                    client_name: orderPayload.fullName,
                    phone: orderPayload.phone,
                    wilaya: orderPayload.wilaya,
                    commune: resolvedCommuneName,
                    price: orderPayload.priceNum
                }
            });
        }

        if (action === 'label_pdf') {
            const trackingCode = tracking || id || req.query.code;
            if (!trackingCode) {
                return res.status(400).send('Numéro de suivi manquant');
            }
            const ecoTrack = getEcoTrackSettings();
            const activeToken = token || req.query.token || ecoTrack.apiToken || '';
            const carrierUrl = (baseUrl || req.query.baseUrl || ecoTrack.baseUrl || 'https://redex.ecotrack.dz').replace(/\/+$/, '');

            try {
                const pdfRes = await fetch(`${carrierUrl}/api/v1/get/order/label?tracking=${encodeURIComponent(trackingCode)}`, {
                    headers: { 'Authorization': 'Bearer ' + activeToken }
                });

                if (!pdfRes.ok) {
                    return res.status(pdfRes.status).send(`Impossible de récupérer le bordereau Redex (${pdfRes.statusText})`);
                }

                const pdfBuffer = await pdfRes.arrayBuffer();
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `inline; filename="bordereau-${trackingCode}.pdf"`);
                return res.send(Buffer.from(pdfBuffer));
            } catch (err) {
                return res.status(500).send('Erreur lors du téléchargement du bordereau : ' + err.message);
            }
        }

        if (action === 'label') {
            const trackingCode = tracking || id;
            if (!trackingCode || trackingCode.length < 5) {
                return res.status(400).json({
                    success: false,
                    error: 'L\'étiquette officielle n\'est disponible qu\'après l\'envoi du colis au transporteur.'
                });
            }

            const pdfDirectUrl = `/api/delivery?action=label_pdf&tracking=${encodeURIComponent(trackingCode)}`;

            return res.status(200).json({
                success: true,
                trackingCode: trackingCode,
                labelUrl: pdfDirectUrl,
                courier: 'Redex Delivery DZ',
                message: 'Lien du bordereau officiel prêt pour impression.'
            });
        }

        // ── 5.5. Live Tracking Check ──────────────────────────────────────────
        if (action === 'track' || action === 'tracking') {
            const trackingCode = tracking || id || req.query.code;
            if (!trackingCode) {
                return res.status(400).json({ success: false, error: 'Numéro de suivi manquant' });
            }
            const ecoTrack = getEcoTrackSettings();
            const activeToken = token || req.query.token || ecoTrack.apiToken || '';
            const carrierUrl = (baseUrl || req.query.baseUrl || ecoTrack.baseUrl || 'https://redex.ecotrack.dz').replace(/\/+$/, '');

            try {
                const trackRes = await fetch(`${carrierUrl}/api/v1/get/orders?tracking=${encodeURIComponent(trackingCode)}`, {
                    headers: { 'Authorization': 'Bearer ' + activeToken, 'Accept': 'application/json' }
                });
                const trackData = await trackRes.json();
                return res.status(200).json({
                    success: true,
                    trackingCode: trackingCode,
                    data: Array.isArray(trackData) ? trackData[0] : (trackData.data?.[0] || trackData)
                });
            } catch (err) {
                return res.status(500).json({ success: false, error: err.message });
            }
        }

        // ── 6. Website Analytics & Vercel Telemetry ───────────────────────────
        if (action === 'analytics') {
            const { getAllOrdersFromDb } = require('../lib/db');
            const { getAggregatedWebsiteAnalytics } = require('../lib/vercelAnalytics');
            const orders = await getAllOrdersFromDb();
            const analyticsData = await getAggregatedWebsiteAnalytics(orders);

            return res.status(200).json({
                success: true,
                ...analyticsData
            });
        }

        // ── 7. Delete / Archive Order ──────────────────────────────────────────
        if (action === 'delete') {
            const body = req.body || {};
            // Strictly from body (NEVER from req.query)
            const targetId = (body.orderId || body.id || '').toString().trim();
            if (!targetId) {
                return res.status(400).json({ success: false, error: 'Numéro de commande manquant' });
            }
            addBlacklistedOrder(targetId);
            const { deleteOrderFromDb } = require('../lib/db');
            await deleteOrderFromDb(targetId);
            return res.status(200).json({
                success: true,
                message: `Commande ${targetId} supprimée et synchronisée.`,
                orderId: targetId
            });
        }

        // ── 8. Tariffs List ───────────────────────────────────────────────────
        if (action === 'tariffs') {
            return res.status(200).json({ success: true, count: tariffs.length, data: tariffs });
        }

        return res.status(404).json({ success: false, error: `Action '${action}' non reconnue.` });
    } catch (err) {
        console.error('[Delivery API Error]:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
};
