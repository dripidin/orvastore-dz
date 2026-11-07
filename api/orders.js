const crypto = require('crypto');
const {
    saveOrderToDb,
    getAllOrdersFromDb,
    updateOrderInDb,
    deleteOrderFromDb
} = require('../lib/db');

module.exports = async (req, res) => {
    // Restricted CORS origins
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

    const { method } = req;
    const allowedHttpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
    if (!allowedHttpMethods.includes(method)) {
        res.setHeader('Allow', 'GET, POST, PUT, PATCH, DELETE');
        return res.status(405).json({
            success: false,
            error: 'METHOD_NOT_ALLOWED',
            message: `Method ${method} is not allowed.`
        });
    }
    const { id, orderId, search, status, limit } = req.query || {};

    const { authorizeAdmin } = require('../lib/admin-session-auth');
    const authz = authorizeAdmin(req);
    const adminToken = authz.token;
    const isBearerAuth = authz.type === 'bearer';
    const isCookieAuth = authz.ok && authz.type !== 'bearer';

    // Administrative operations (GET, PUT, PATCH, DELETE) require admin token
    if (['GET', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
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
                message: 'Authorization: Bearer <ADMIN_API_TOKEN> or valid session required.'
            });
        }

        // CSRF Gate: Applied to browser Cookie authentication
        if (isCookieAuth && !isBearerAuth) {
            const secFetchSite = String(req.headers?.['sec-fetch-site'] || '').toLowerCase();
            if (secFetchSite === 'cross-site') {
                return res.status(403).json({
                    success: false,
                    error: 'CSRF_REJECTED',
                    message: 'Cross-site request blocked by Sec-Fetch-Site policy.'
                });
            }

            if (['PUT', 'PATCH', 'DELETE'].includes(method)) {
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
    }

    try {
        // ─── 1. GET Orders (List & Filter) ──────────────────────────────────
        if (method === 'GET') {
            let orders = await getAllOrdersFromDb();

            // Filter by search (orderId, phone, fullName)
            if (search) {
                const s = search.toLowerCase().trim();
                orders = orders.filter(o =>
                    (o.orderId && o.orderId.toLowerCase().includes(s)) ||
                    (o.phone && o.phone.includes(s)) ||
                    (o.fullName && o.fullName.toLowerCase().includes(s)) ||
                    (o.redex_tracking_code && o.redex_tracking_code.toLowerCase().includes(s))
                );
            }

            // Filter by status
            if (status && status !== 'all') {
                orders = orders.filter(o => o.status === status);
            }

            if (limit) {
                orders = orders.slice(0, parseInt(limit));
            }

            return res.status(200).json({
                success: true,
                count: orders.length,
                data: orders
            });
        }

        // ─── 2. POST (Create / Upsert Order) ────────────────────────────────
        if (method === 'POST') {
            const body = req.body || {};
            if (!body.fullName || !body.phone || !body.wilaya) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required order fields (fullName, phone, wilaya)'
                });
            }

            const cleanOrderId = body.orderId || ('ORVA-' + Math.floor(10000 + Math.random() * 90000));
            const saved = await saveOrderToDb({
                ...body,
                storeId: 'orvastore',
                orderId: cleanOrderId
            });

            return res.status(201).json({
                success: true,
                message: 'Order persisted successfully in Supabase PostgreSQL',
                data: saved
            });
        }

        // ─── 3. PUT / PATCH (Update Order) ──────────────────────────────────
        if (method === 'PUT' || method === 'PATCH') {
            const body = req.body || {};
            const targetId = id || orderId || body.orderId || body.id;

            if (!targetId) {
                return res.status(400).json({ success: false, error: 'Missing orderId to update' });
            }

            const updated = await updateOrderInDb(targetId, body);
            return res.status(200).json({
                success: true,
                message: 'Order updated successfully in Supabase',
                data: updated
            });
        }

        // ─── 4. DELETE (Remove Order) ───────────────────────────────────────
        if (method === 'DELETE') {
            const targetId = id || orderId || (req.body && (req.body.orderId || req.body.id));

            if (!targetId) {
                return res.status(400).json({ success: false, error: 'Missing orderId to delete' });
            }

            await deleteOrderFromDb(targetId);
            return res.status(200).json({
                success: true,
                message: `Order ${targetId} deleted successfully from Supabase and cache.`
            });
        }

        return res.status(405).json({ error: 'Method Not Allowed' });
    } catch (err) {
        console.error('API /api/orders error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
};
