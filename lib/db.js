'use strict';
// =============================================================================
// Database Abstraction Layer — Supabase & Google Sheets (ORVA Store)
// =============================================================================

const crypto = require('crypto');
const { getSupabase, getPgPool, SUPABASE_SCHEMA } = require('./supabaseServer');
const { assertValidOrderId, assertDbSchema, qualifyTable } = require('./db-authority');

function ordersTableSql() {
    return qualifyTable(assertDbSchema(SUPABASE_SCHEMA || process.env.SUPABASE_SCHEMA || 'public'), 'orders');
}

function rateLimitsTableSql() {
    return qualifyTable(assertDbSchema(SUPABASE_SCHEMA || process.env.SUPABASE_SCHEMA || 'public'), 'rate_limits');
}

function tryGetSupabase() {
    const { isLocalUnconfigured, getAppEnv } = require('./db-authority');
    try {
        return getSupabase();
    } catch (e) {
        if (e && (e.code === 'SERVER_MISCONFIGURED' || e.code === 'STAGING_SERVICE_ROLE_FORBIDDEN')) {
            // Local/dev/test: no service_role — fall back to the local PG pool
            // (hosted DSNs stay refused by the local isolation guard in db.js).
            const env = String(getAppEnv() || '').toLowerCase();
            if (env === 'local' || env === 'development' || env === 'test' || isLocalUnconfigured()) return null;
            throw e;
        }
        throw e;
    }
}

function hashValue(value) {
    if (!value) return null;
    return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
}
function nowISO() { return new Date().toISOString(); }
function parseIntSafe(val, def) {
    if (val === undefined || val === null || val === '') return def;
    const cleanStr = String(val).replace(/[^\d]/g, '');
    const n = parseInt(cleanStr, 10);
    return isNaN(n) ? def : n;
}
function parseBool(val) { if (typeof val === 'boolean') return val; return val === 'true' || val === '1' || val === true; }

// ── Store defaults ────────────────────────────────────────────────────────────
const STORE_ID       = 'orvastore';
// Display-only labels for legacy rows missing product_name — NEVER used as a sellable price.
const LEGACY_PRODUCT_LABEL = 'ORVA PRODUCT';

function parsePriceRequired(val, fieldName) {
    if (val === undefined || val === null || val === '') {
        const err = new Error('PRODUCT_PRICE_MISSING');
        err.code = 'PRODUCT_PRICE_MISSING';
        err.field = fieldName || 'price';
        throw err;
    }
    const cleanStr = String(val).replace(/[^\d]/g, '');
    const n = parseInt(cleanStr, 10);
    if (!Number.isFinite(n) || n < 0) {
        const err = new Error('PRODUCT_PRICE_MISSING');
        err.code = 'PRODUCT_PRICE_MISSING';
        err.field = fieldName || 'price';
        throw err;
    }
    return n;
}

function mapOrderFromRow(row) {
    if (!row) return null;
    let remarks = [];
    if (typeof row.remarks === 'string') {
        try { remarks = JSON.parse(row.remarks); } catch (e) { remarks = []; }
    } else if (Array.isArray(row.remarks)) {
        remarks = row.remarks;
    }

    const created = (row.created_at instanceof Date)
        ? row.created_at.toISOString()
        : (row.created_at ? String(row.created_at) : nowISO());
    // Read path: never invent a sellable price. Missing price_num → null (admin UI must not treat as 4950).
    let priceNum = null;
    if (row.price_num !== undefined && row.price_num !== null && row.price_num !== '') {
        const parsed = parseIntSafe(row.price_num, NaN);
        priceNum = Number.isFinite(parsed) ? parsed : null;
    }
    return {
        orderId:            row.order_id || '',
        storeId:            row.store_id || STORE_ID,
        fullName:           row.full_name || '',
        phone:              row.phone || '',
        wilaya:             row.wilaya || '',
        commune:            row.commune || 'الجزائر',
        deliveryType:       row.delivery_type || 'توصيل للمنزل',
        deliveryTime:       row.delivery_time || '24 - 48 H',
        quantity:           parseIntSafe(row.quantity, 1),
        productName:        row.product_name || LEGACY_PRODUCT_LABEL,
        productTotal:       row.product_total || '',
        shippingFee:        row.shipping_fee || '500 د.ج',
        priceNum,
        grandTotal:         row.grand_total || '',
        status:             row.status || 'pending',
        in_redex:           parseBool(row.in_redex),
        redex_tracking_code: row.redex_tracking_code || null,
        remarks:            remarks,
        riskScore:          parseIntSafe(row.risk_score, 0),
        riskLevel:          row.risk_level || 'LOW',
        riskDecision:       row.risk_decision || 'ALLOW',
        riskReasons:        row.risk_reasons ? (Array.isArray(row.risk_reasons) ? row.risk_reasons : String(row.risk_reasons).split('|')) : [],
        date:               created.includes('T') ? created.split('T')[0] : created.slice(0, 10),
        createdAt:          created
    };
}

function mapOrderToDb(order, extra) {
    // Write path: refuse silent 4950 (or any) price fallback — caller must supply an approved price.
    const numPrice = parsePriceRequired(
        order.priceNum !== undefined && order.priceNum !== null && order.priceNum !== ''
            ? order.priceNum
            : (order.price !== undefined && order.price !== null && order.price !== ''
                ? order.price
                : order.grandTotal),
        'priceNum'
    );
    if (!order.productName && !order.name) {
        const err = new Error('PRODUCT_NAME_MISSING');
        err.code = 'PRODUCT_NAME_MISSING';
        throw err;
    }
    return {
        order_id:            order.orderId || '',
        store_id:            order.storeId || STORE_ID,
        full_name:           order.fullName || order.name || '',
        phone:               order.phone || '',
        wilaya:              order.wilaya || '',
        commune:             order.commune || 'الجزائر',
        delivery_type:       order.deliveryType || 'توصيل للمنزل',
        delivery_time:       order.deliveryTime || '24 - 48 H',
        quantity:            parseIntSafe(order.quantity, 1),
        product_name:        order.productName || order.name,
        product_total:       order.productTotal || (numPrice + ' د.ج'),
        shipping_fee:        order.shippingFee || '500 د.ج',
        price_num:           numPrice,
        grand_total:         order.grandTotal || (numPrice + ' د.ج'),
        status:              order.status || 'pending',
        in_redex:            parseBool(order.in_redex),
        redex_tracking_code: order.redex_tracking_code || null,
        remarks:             order.remarks || [],
        client_ip:           order.clientIp || null,
        client_ip_hash:      order.clientIpHash || (order.clientIp ? hashValue(order.clientIp) : null),
        device_id:           order.deviceId || null,
        risk_score:          parseIntSafe(extra && extra.riskScore !== undefined ? extra.riskScore : 0, 0),
        risk_level:          (extra && extra.riskLevel) || 'LOW',
        risk_decision:       (extra && extra.riskDecision) || 'ALLOW',
        risk_reasons:        (extra && extra.riskReasons) ? (Array.isArray(extra.riskReasons) ? extra.riskReasons.join('|') : String(extra.riskReasons)) : '',
        created_at:          order.createdAt || nowISO()
    };
}

// ── Orders CRUD (100% Supabase PostgreSQL Engine) ─────────────────────────────

async function saveOrderToDb(order, riskResult) {
    const existing = await findOrderById(order.orderId);
    if (existing) {
        console.log('[DB] Order already exists:', order.orderId);
        return existing;
    }

    if (order.orderId) assertValidOrderId(order.orderId);
    const row = mapOrderToDb(order, riskResult);
    const supabase = tryGetSupabase();
    let savedSuccessfully = false;

    // 1. Primary: Supabase REST API
    if (supabase) {
        try {
            const { data, error } = await supabase.from('orders').insert([row]).select();
            if (error) {
                console.error('[DB-Supabase] REST insert error:', error.message);
                throw error;
            }
            console.log('[DB] Order saved to Supabase (REST):', order.orderId);
            savedSuccessfully = true;
            if (data && data.length > 0) {
                return mapOrderFromRow(data[0]);
            }
        } catch (sbErr) {
            if (sbErr && sbErr.code === 'SERVER_MISCONFIGURED') throw sbErr;
            console.warn('[DB] Supabase REST error, trying direct PostgreSQL pool:', sbErr.message);
        }
    }

    // 2. Resilient Failover: Direct PostgreSQL pool connection
    if (!savedSuccessfully) {
        const pool = getPgPool();
        if (pool) {
            try {
                const ot = ordersTableSql();
                const queryText = `
                    INSERT INTO ${ot} (
                        order_id, store_id, full_name, phone, wilaya, commune,
                        delivery_type, delivery_time, quantity, product_name,
                        product_total, shipping_fee, price_num, grand_total,
                        status, in_redex, redex_tracking_code, remarks,
                        client_ip, client_ip_hash, device_id, risk_score,
                        risk_level, risk_decision, risk_reasons, created_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6,
                        $7, $8, $9, $10,
                        $11, $12, $13, $14,
                        $15, $16, $17, $18,
                        $19, $20, $21, $22,
                        $23, $24, $25, $26, $27
                    )
                    ON CONFLICT (order_id) DO NOTHING
                    RETURNING *;
                `;
                const values = [
                    row.order_id, row.store_id, row.full_name, row.phone, row.wilaya, row.commune,
                    row.delivery_type, row.delivery_time, row.quantity, row.product_name,
                    row.product_total, row.shipping_fee, row.price_num, row.grand_total,
                    row.status, row.in_redex, row.redex_tracking_code, JSON.stringify(row.remarks || []),
                    row.client_ip, row.client_ip_hash, row.device_id, row.risk_score,
                    row.risk_level, row.risk_decision, row.risk_reasons, row.created_at, row.created_at
                ];
                const res = await pool.query(queryText, values);
                console.log('[DB] Order saved to Supabase (Direct PG Pool):', order.orderId);
                savedSuccessfully = true;
                if (res.rows && res.rows.length > 0) {
                    return mapOrderFromRow(res.rows[0]);
                }
            } catch (pgErr) {
                console.error('[DB] Direct PostgreSQL pool insert error:', pgErr.message);
            }
        }
    }

    if (!savedSuccessfully) {
        console.error('[DB] Could not save order to Supabase. Database persistence failed.');
        throw new Error('STORAGE_UNAVAILABLE');
    }

    return mapOrderFromRow(row);
}

async function getAllOrdersFromDb() {
    const supabase = tryGetSupabase();
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('orders')
                .select('*')
                .neq('status', 'deleted')
                .order('created_at', { ascending: false });

            if (!error && Array.isArray(data)) {
                return data.map(mapOrderFromRow).filter(Boolean);
            }
            console.warn('[DB-Supabase] getAllOrdersFromDb REST error:', error ? error.message : 'Unknown');
        } catch (e) {
            console.warn('[DB] getAllOrdersFromDb REST exception:', e.message);
        }
    }

    const pool = getPgPool();
    if (pool) {
        try {
            const ot = ordersTableSql();
            const res = await pool.query(
                `SELECT * FROM ${ot} WHERE status != 'deleted' ORDER BY created_at DESC;`
            );
            if (res.rows) {
                return res.rows.map(mapOrderFromRow).filter(Boolean);
            }
        } catch (pgErr) {
            console.error('[DB] getAllOrdersFromDb PG Pool error:', pgErr.message);
        }
    }

    return [];
}

async function findOrderById(orderId) {
    if (!orderId) return null;
    let cleanId;
    try {
        cleanId = assertValidOrderId(orderId);
    } catch (_) {
        return null;
    }
    const supabase = tryGetSupabase();
    if (supabase) {
        try {
            let { data, error } = await supabase
                .from('orders')
                .select('*')
                .eq('order_id', cleanId)
                .limit(1);
            if (!error && data && data.length > 0) {
                return mapOrderFromRow(data[0]);
            }
            ({ data, error } = await supabase
                .from('orders')
                .select('*')
                .eq('redex_tracking_code', cleanId)
                .limit(1));
            if (!error && data && data.length > 0) {
                return mapOrderFromRow(data[0]);
            }
        } catch (e) {
            console.warn('[DB] findOrderById REST exception:', e.message);
        }
    }

    const pool = getPgPool();
    if (pool) {
        try {
            const ot = ordersTableSql();
            const res = await pool.query(
                `SELECT * FROM ${ot} WHERE order_id = $1 OR redex_tracking_code = $1 LIMIT 1;`,
                [cleanId]
            );
            if (res.rows && res.rows[0]) {
                return mapOrderFromRow(res.rows[0]);
            }
        } catch (pgErr) {
            console.error('[DB] findOrderById PG Pool error:', pgErr.message);
        }
    }

    return null;
}

async function updateOrderInDb(orderId, updateFields) {
    if (!orderId) return null;
    const cleanId = assertValidOrderId(orderId);
    const dbUpdate = {};
    if (updateFields.status !== undefined)              dbUpdate.status = updateFields.status;
    if (updateFields.in_redex !== undefined)            dbUpdate.in_redex = parseBool(updateFields.in_redex);
    if (updateFields.redex_tracking_code !== undefined) dbUpdate.redex_tracking_code = updateFields.redex_tracking_code || null;
    if (updateFields.remarks !== undefined)             dbUpdate.remarks = updateFields.remarks;
    if (updateFields.productName !== undefined)         dbUpdate.product_name = updateFields.productName;
    if (updateFields.productTotal !== undefined)        dbUpdate.product_total = updateFields.productTotal;
    if (updateFields.priceNum !== undefined)            dbUpdate.price_num = parsePriceRequired(updateFields.priceNum, 'priceNum');
    if (updateFields.grandTotal !== undefined)          dbUpdate.grand_total = updateFields.grandTotal;
    if (updateFields.shippingFee !== undefined)         dbUpdate.shipping_fee = updateFields.shippingFee;
    if (updateFields.fullName !== undefined)            dbUpdate.full_name = updateFields.fullName;
    if (updateFields.phone !== undefined)               dbUpdate.phone = updateFields.phone;
    if (updateFields.wilaya !== undefined)              dbUpdate.wilaya = updateFields.wilaya;
    if (updateFields.commune !== undefined)             dbUpdate.commune = updateFields.commune;
    if (updateFields.deliveryType !== undefined)        dbUpdate.delivery_type = updateFields.deliveryType;
    if (updateFields.deliveryTime !== undefined)        dbUpdate.delivery_time = updateFields.deliveryTime;
    if (updateFields.quantity !== undefined)            dbUpdate.quantity = parseIntSafe(updateFields.quantity, 1);
    if (updateFields.riskScore !== undefined)           dbUpdate.risk_score = parseIntSafe(updateFields.riskScore, 0);
    if (updateFields.riskLevel !== undefined)           dbUpdate.risk_level = updateFields.riskLevel;
    if (updateFields.riskDecision !== undefined)        dbUpdate.risk_decision = updateFields.riskDecision;
    if (updateFields.riskReasons !== undefined)         dbUpdate.risk_reasons = Array.isArray(updateFields.riskReasons) ? updateFields.riskReasons.join('|') : String(updateFields.riskReasons);

    dbUpdate.updated_at = nowISO();

    const supabase = tryGetSupabase();
    if (supabase) {
        try {
            let { data, error } = await supabase
                .from('orders')
                .update(dbUpdate)
                .eq('order_id', cleanId)
                .select();
            if (!error && data && data.length > 0) {
                return mapOrderFromRow(data[0]);
            }
            ({ data, error } = await supabase
                .from('orders')
                .update(dbUpdate)
                .eq('redex_tracking_code', cleanId)
                .select());
            if (!error && data && data.length > 0) {
                return mapOrderFromRow(data[0]);
            }
        } catch (e) {
            console.warn('[DB] updateOrderInDb REST exception:', e.message);
        }
    }

    const pool = getPgPool();
    if (pool) {
        try {
            const setClauses = [];
            const values = [];
            let i = 1;

            for (const [key, val] of Object.entries(dbUpdate)) {
                setClauses.push(`${key} = $${i}`);
                values.push(key === 'remarks' ? JSON.stringify(val || []) : val);
                i++;
            }

            values.push(cleanId);
            const ot = ordersTableSql();
            const queryText = `
                UPDATE ${ot}
                SET ${setClauses.join(', ')}
                WHERE order_id = $${i} OR redex_tracking_code = $${i}
                RETURNING *;
            `;
            const res = await pool.query(queryText, values);
            if (res.rows && res.rows[0]) {
                return mapOrderFromRow(res.rows[0]);
            }
        } catch (pgErr) {
            console.error('[DB] updateOrderInDb PG Pool error:', pgErr.message);
        }
    }

    return findOrderById(cleanId);
}

async function deleteOrderFromDb(orderId) {
    if (!orderId) return false;
    const cleanId = String(orderId).trim();

    // 1. Try Direct PostgreSQL pool hard delete (Primary for administrative hard deletion)
    const pool = getPgPool();
    if (pool) {
        try {
            await pool.query(
                `DELETE FROM ${ordersTableSql()} WHERE order_id = $1 OR redex_tracking_code = $1;`,
                [assertValidOrderId(cleanId)]
            );
            return true;
        } catch (pgErr) {
            console.warn('[DB] deleteOrderFromDb PG Pool delete error:', pgErr.message);
        }
    }

    // 2. Try Supabase REST API hard delete
    const supabase = tryGetSupabase();
    if (supabase) {
        try {
            const { error } = await supabase.from('orders')
                .delete()
                .eq('order_id', cleanId);
            if (!error) return true;
        } catch (e) {
            console.warn('[DB] deleteOrderFromDb Supabase delete exception:', e.message);
        }

        // 3. Fallback to soft delete
        try {
            await supabase.from('orders')
                .update({ status: 'deleted', updated_at: nowISO() })
                .eq('order_id', cleanId);
            return true;
        } catch (e2) {
            console.warn('[DB] deleteOrderFromDb soft-delete exception:', e2.message);
        }
    }

    return false;
}

// ── Rate Limiting & Fraud Tracking ───────────────────────────────────────────

async function checkAndRecordRateLimit(ip, deviceId, phone) {
    const ipHash = hashValue(ip);
    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : null;
    const cleanDevice = deviceId ? String(deviceId).trim() : null;
    const DENY_MSG = 'عذراً، لقد تم تسجيل طلبك مسبقاً (الحد الأقصى محاولتين). سيتصل بك فريقنا لتأكيد طلبك.';

    const failClosed = (msg) => {
        const err = new Error(msg || 'RATE_LIMIT_STORAGE_UNAVAILABLE');
        err.code = 'RATE_LIMIT_STORAGE_UNAVAILABLE';
        err.statusCode = 503;
        throw err;
    };

    const pool = getPgPool();
    if (!pool) {
        // REST atomic path via RPC not available without pool — fail closed when DB is required
        const { isLocalUnconfigured } = require('./db-authority');
        if (isLocalUnconfigured()) {
            return { allowed: true, count: 1, localBypass: true };
        }
        failClosed('DATABASE_URL required for atomic rate limiting');
    }

    const rl = rateLimitsTableSql();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Serialize on each shared fingerprint dimension (phone OR device OR ip).
        // A single composite lock key fails when only one dimension is shared.
        if (cleanPhone) {
            await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`orva-rl:phone:${cleanPhone}`]);
        }
        if (cleanDevice) {
            await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`orva-rl:device:${cleanDevice}`]);
        }
        if (ipHash) {
            await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`orva-rl:ip:${ipHash}`]);
        }

        const countRes = await client.query(
            `SELECT COUNT(*)::int AS c FROM ${rl}
             WHERE created_at >= NOW() - INTERVAL '24 hours'
               AND (
                 ($1::text IS NOT NULL AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $1)
                 OR ($2::text IS NOT NULL AND device_id = $2)
                 OR ($3::text IS NOT NULL AND ip = $3)
               )`,
            [cleanPhone || null, cleanDevice || null, ipHash || null]
        );
        const count = Number(countRes.rows[0]?.c || 0);
        if (count >= 2) {
            await client.query('COMMIT');
            return { allowed: false, count, message: DENY_MSG };
        }
        await client.query(
            `INSERT INTO ${rl} (ip, device_id, phone, created_at) VALUES ($1, $2, $3, NOW())`,
            [ipHash || null, cleanDevice || null, cleanPhone || null]
        );
        await client.query('COMMIT');
        return { allowed: true, count: count + 1 };
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.error('[DB] checkAndRecordRateLimit error:', e.message);
        failClosed(e.message);
    } finally {
        client.release();
    }
}

async function saveRiskEvaluation({ orderId, score, level, decision, reasons }) {
    return updateOrderInDb(orderId, { riskScore: score, riskLevel: level, riskDecision: decision, riskReasons: reasons || [] });
}

async function getRiskEvaluationByOrderId(orderId) {
    const row = await findOrderById(orderId);
    if (!row) return null;
    return {
        orderId: row.orderId,
        score: parseIntSafe(row.riskScore, 0),
        level: row.riskLevel || 'LOW',
        decision: row.riskDecision || 'ALLOW',
        reasons: row.riskReasons || []
    };
}

async function updateRiskOverride(orderId, overrideAction) {
    const decisionMap = { trust: 'ALLOW', confirm: 'ALLOW', reject: 'BLOCK', block: 'BLOCK', unblock: 'ALLOW' };
    const newDecision = decisionMap[overrideAction] || 'ALLOW';
    const newStatus   = overrideAction === 'reject' ? 'rejected' : overrideAction === 'confirm' ? 'confirmed' : undefined;
    const updateData  = { riskDecision: newDecision };
    if (newStatus) updateData.status = newStatus;
    const updated = await updateOrderInDb(orderId, updateData);
    
    const eventType = overrideAction === 'block' ? 'ACTOR_BLOCKED' : overrideAction === 'reject' ? 'REQUEST_REJECTED' : overrideAction === 'trust' ? 'ACTOR_TRUSTED' : 'ADMIN_OVERRIDE';
    
    const supabase = tryGetSupabase();
    if (supabase) {
        supabase.from('risk_events').insert([{
            event_id: 'ADM-' + Date.now(),
            event_type: eventType,
            store_id: STORE_ID,
            order_id: orderId,
            actor_phone: updated ? updated.phone || '' : '',
            metadata: { action: overrideAction, by: 'admin' },
            created_at: nowISO()
        }]).then(() => {}).catch(err => console.warn('[DB] Risk event insert warning:', err.message));
    }

    if (overrideAction === 'block' && updated && updated.phone) {
        await addToWatchlist(updated.phone, 'PHONE', 'Admin block', 'blocked');
    }
    return updated;
}

// ── Customer Trust & Watchlist ───────────────────────────────────────────────

async function findOrCreateCustomer(phone, name) {
    if (!phone) return null;
    const supabase = tryGetSupabase();
    if (supabase) {
        try {
            const { data } = await supabase.from('customers').select('*').eq('phone', phone).limit(1);
            if (data && data.length > 0) return data[0];

            const newCust = {
                customer_id: 'CUST-' + hashValue(phone).slice(0, 12),
                phone,
                name: name || '',
                total_orders: 0,
                completed: 0,
                cancelled: 0,
                rejected: 0,
                no_response: 0,
                trust_score: 50,
                risk_level: 'LOW',
                created_at: nowISO(),
                updated_at: nowISO()
            };
            const { data: inserted } = await supabase.from('customers').insert([newCust]).select();
            if (inserted && inserted.length > 0) return inserted[0];
            return newCust;
        } catch (e) {
            console.warn('[DB] findOrCreateCustomer Supabase exception:', e.message);
        }
    }
    return { phone, name: name || '', trust_score: 50, risk_level: 'LOW' };
}

async function updateCustomerStats(phone, outcome) {
    if (!phone) return null;
    const supabase = tryGetSupabase();
    if (supabase) {
        try {
            const { data } = await supabase.from('customers').select('*').eq('phone', phone).limit(1);
            if (data && data.length > 0) {
                const c = data[0];
                const update = { updated_at: nowISO() };
                if (outcome === 'ordered')    update.total_orders = (c.total_orders || 0) + 1;
                if (outcome === 'completed') { update.completed = (c.completed || 0) + 1; update.trust_score = Math.min(100, (c.trust_score || 50) + 5); }
                if (outcome === 'cancelled') { update.cancelled = (c.cancelled || 0) + 1; update.trust_score = Math.max(0, (c.trust_score || 50) - 5); }
                if (outcome === 'rejected')  { update.rejected = (c.rejected || 0) + 1; update.trust_score = Math.max(0, (c.trust_score || 50) - 15); update.risk_level = 'HIGH'; }
                const { data: res } = await supabase.from('customers').update(update).eq('phone', phone).select();
                return res ? res[0] : null;
            }
        } catch (e) {
            console.warn('[DB] updateCustomerStats exception:', e.message);
        }
    }
    return null;
}

async function getWatchlistEntry(identifier) {
    if (!identifier) return null;
    const supabase = tryGetSupabase();
    if (supabase) {
        try {
            const { data } = await supabase.from('watchlist').select('*').eq('identifier', identifier).limit(1);
            if (data && data.length > 0) {
                const entry = data[0];
                if (entry.expires_at && new Date(entry.expires_at) < new Date()) return null;
                return entry;
            }
        } catch (e) {
            console.warn('[DB] getWatchlistEntry exception:', e.message);
        }
    }
    return null;
}

async function addToWatchlist(identifier, identifierType, reason, status, expiresAt) {
    const supabase = tryGetSupabase();
    const entry = {
        identifier,
        identifier_type: identifierType || 'PHONE',
        reason: reason || '',
        status: status || 'watchlist',
        created_at: nowISO(),
        expires_at: expiresAt || null
    };

    if (supabase) {
        try {
            await supabase.from('watchlist').insert([entry]);
            return entry;
        } catch (e) {
            console.warn('[DB] addToWatchlist exception:', e.message);
        }
    }
    return entry;
}

async function createAuditLog(action, entityType, entityId, actor, payload) {
    const pool = getPgPool();
    if (pool) {
        try {
            const query = `
                INSERT INTO public.audit_logs (action, entity_type, entity_id, actor, payload, created_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *;
            `;
            const res = await pool.query(query, [
                action,
                entityType,
                entityId,
                actor || 'Admin',
                JSON.stringify(payload || {}),
                nowISO()
            ]);
            return res.rows[0];
        } catch (e) {
            console.error('[DB] createAuditLog error:', e.message);
        }
    }
    return null;
}

function mapFromDbRecord(row) { return mapOrderFromRow(row); }
function mapToDbRecord(order) { return mapOrderToDb(order); }

module.exports = {
    saveOrderToDb,
    getAllOrdersFromDb,
    findOrderById,
    updateOrderInDb,
    deleteOrderFromDb,
    createAuditLog,
    checkAndRecordRateLimit,
    saveRiskEvaluation,
    getRiskEvaluationByOrderId,
    updateRiskOverride,
    findOrCreateCustomer,
    updateCustomerStats,
    getWatchlistEntry,
    addToWatchlist,
    mapFromDbRecord,
    mapToDbRecord,
    hashValue,
    STORE_ID
};
