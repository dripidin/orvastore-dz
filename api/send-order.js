'use strict';
// =============================================================================
// Order Submission API — /api/send-order (ORVA Store)
// Phase 8C.1: Dynamic Catalog, Key-Based Idempotency, Atomic Inventory Reservation
// =============================================================================

const https = require('https');
const { saveOrderToDb, checkAndRecordRateLimit, findOrCreateCustomer, updateCustomerStats } = require('../lib/db');
const { evaluateRequest, recordRiskEvent, hashIp } = require('../lib/riskEngine');
const { sendMetaPurchaseEvent } = require('../lib/metaCAPI');
const { getEffectiveSettings } = require('../lib/admin-settings-store');
const { dispatchTelegramNotification } = require('../lib/telegram-notifier');
const {
    verifyAndCalculateOrder,
    reserveStock,
    releaseStock,
    extractIdempotencyKey,
    withIdempotencyLock
} = require('../lib/order-validator');
// bindReservationToOrder lives in inventory-manager (dispatches to PG or JSON), not order-validator.
const { bindReservationToOrder } = require('../lib/inventory-manager');

function getCookieValue(cookieHeader, name) {
    if (!cookieHeader) return null;
    const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name.replace(/([.*+?^=!:${}()|[\]/\\])/g, '\\$1') + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Idempotency-Key, X-Idempotency-Key');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED', message: 'Please send a POST request.' });
    }

    try {
        const clientIp = (
            req.headers['x-forwarded-for'] ||
            req.headers['x-real-ip'] ||
            (req.socket && req.socket.remoteAddress) ||
            '127.0.0.1'
        ).split(',')[0].trim();

        const body = req.body || {};
        const {
            fullName, phone, wilaya, wilayaId, commune,
            deliveryType,
            quantity,
            orderId, deviceId,
            honeypot, formDurationMs,
            fbp, fbc,
            packId, productId, sku, productName,
            eventId, event_id,
            testEventCode, test_event_code
        } = body;

        // ── 1. Authoritative Server-Side Validation ───────────────────────────
        const validation = verifyAndCalculateOrder({
            packId, productId, sku, productName,
            quantity,
            wilaya, wilayaId, commune,
            deliveryType,
            fullName, phone
        });

        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                error: validation.code,
                message: validation.message
            });
        }

        const {
            product, wilaya: wilayaObj, commune: cleanCommune,
            quantity: validQty, unitPrice, shippingFee: validShipping,
            productTotal: validProductTotal, grandTotal: validGrandTotal,
            deliveryType: actualDeliveryType, deliveryTime: actualDeliveryTime
        } = validation;

        // ── 2. Unique Idempotency Key Resolution ─────────────────────────────
        const explicitKey = extractIdempotencyKey(req);
        const idempotencyKey = explicitKey || `dedup_${phone.replace(/\D/g, '')}_${product.sku}_${wilayaObj.id}_${Math.floor(Date.now() / 300000)}`;
        const crypto = require('crypto');
        let cleanOrderId = orderId && /^[A-Za-z0-9._:-]{6,64}$/.test(String(orderId))
            ? String(orderId).trim()
            : ('ORVA-' + crypto.randomBytes(6).toString('hex').toUpperCase());
        if (!orderId) {
            cleanOrderId = 'ORVA-' + crypto.randomBytes(6).toString('hex').toUpperCase();
        }
        const finalEventId = eventId || event_id || `order_${cleanOrderId}_${Date.now()}`;
        const activeTestCode = testEventCode || test_event_code || process.env.META_TEST_EVENT_CODE || null;
        const cleanLocation = `${wilayaObj.canonicalName} — ${cleanCommune}`;

        // ── 3. Anti-Spam & Honeypot / Risk Evaluation ─────────────────────────
        const clientIpHash = hashIp(clientIp);
        const riskCtx = {
            storeId:        'orvastore',
            orderId:        cleanOrderId,
            requestType:    'order',
            actorPhone:     phone,
            actorIpHash:    clientIpHash,
            deviceId:       deviceId || null,
            honeypotValue:  honeypot || '',
            formDurationMs: formDurationMs ? Number(formDurationMs) : null
        };

        const riskResult = await evaluateRequest(riskCtx);

        if (riskResult.decision === 'BLOCK') {
            console.warn('[send-order] BLOCKED by Risk Engine:', cleanOrderId, riskResult.reasons);
            await recordRiskEvent(riskCtx, riskResult);
            return res.status(429).json({
                success: false,
                error: 'REQUEST_BLOCKED',
                message: 'عذراً، لا يمكن معالجة طلبك في الوقت الحالي. يرجى التحقق من معلوماتك والمحاولة مرة أخرى.'
            });
        }

        // ── 4. Rate Limit Check ───────────────────────────────────────────────
        try {
            const rl = await checkAndRecordRateLimit(clientIp, deviceId, phone);
            if (!rl.allowed) {
                console.warn('[send-order] RATE_LIMIT_HIT:', cleanOrderId, phone);
                return res.status(429).json({
                    success: false,
                    error: 'RATE_LIMIT_EXCEEDED',
                    message: rl.message || 'عذراً، لقد تم تسجيل طلبك مسبقاً (الحد الأقصى محاولتين). سيتصل بك فريقنا لتأكيد طلبك.'
                });
            }
        } catch (e) {
            if (e && (e.code === 'RATE_LIMIT_STORAGE_UNAVAILABLE' || e.statusCode === 503)) {
                return res.status(503).json({
                    success: false,
                    error: 'RATE_LIMIT_STORAGE_UNAVAILABLE',
                    message: 'تعذر التحقق من حد الطلبات. يرجى المحاولة لاحقاً.'
                });
            }
            console.warn('[send-order] Rate limit check error:', e.message);
            return res.status(503).json({
                success: false,
                error: 'RATE_LIMIT_STORAGE_UNAVAILABLE',
                message: 'تعذر التحقق من حد الطلبات. يرجى المحاولة لاحقاً.'
            });
        }

        // ── 5. Concurrent-Safe Idempotency Wrapper & Inventory Execution ───────
        const executionResult = await withIdempotencyLock(idempotencyKey, async () => {
            // A. Atomic Inventory Reservation
            let reservedState;
            let createdReservation = false;
            try {
                reservedState = await reserveStock(product.sku, validQty, cleanOrderId);
                if (reservedState && reservedState.alreadyReserved) {
                    const err = new Error('DUPLICATE_ORDER_ID');
                    err.statusCode = 409;
                    err.code = 'DUPLICATE_ORDER_ID';
                    err.message = 'معرف الطلب مستخدم مسبقاً. يرجى إعادة المحاولة.';
                    throw err;
                }
                createdReservation = !!(reservedState && reservedState.created);
            } catch (invErr) {
                console.warn('[send-order] Stock reservation failed:', invErr.message);
                if (invErr.message === 'INSUFFICIENT_STOCK' || invErr.code === 'INSUFFICIENT_STOCK') {
                    const err = new Error('INSUFFICIENT_STOCK');
                    err.statusCode = 400;
                    err.code = 'INSUFFICIENT_STOCK';
                    err.message = 'عذراً، الكمية المطلوبة غير متوفرة حالياً في المخزون.';
                    throw err;
                }
                if (invErr.message === 'INVENTORY_SKU_MISSING' || invErr.code === 'INVENTORY_SKU_MISSING') {
                    const err = new Error('INVENTORY_SKU_MISSING');
                    err.statusCode = 409;
                    err.code = 'INVENTORY_SKU_MISSING';
                    err.message = 'المخزون غير مهيأ لهذا المنتج. يرجى المحاولة لاحقاً.';
                    throw err;
                }
                throw invErr;
            }

            // B. Database Persistence
            try {
                if (process.env.MOCK_DB_FAIL === 'true') {
                    throw new Error('STORAGE_UNAVAILABLE');
                }

                await saveOrderToDb({
                    orderId:             cleanOrderId,
                    storeId:             'orvastore',
                    fullName,
                    phone,
                    wilaya:              cleanLocation,
                    commune:             cleanCommune,
                    deliveryType:        actualDeliveryType,
                    deliveryTime:        actualDeliveryTime,
                    quantity:            validQty,
                    productName:         product.name,
                    productTotal:        `${validProductTotal} د.ج`,
                    shippingFee:         `${validShipping} د.ج`,
                    priceNum:            validGrandTotal,
                    grandTotal:          `${validGrandTotal} د.ج`,
                    status:              riskResult.decision === 'REVIEW' ? 'review' : 'pending',
                    in_redex:            false,
                    redex_tracking_code: null,
                    clientIpHash,
                    deviceId
                }, {
                    riskScore:    riskResult.score,
                    riskLevel:    riskResult.level,
                    riskDecision: riskResult.decision,
                    riskReasons:  riskResult.reasons
                });
                // Bind reservation so abandoned-checkout recovery will not release a real order.
                try {
                    const { shouldUsePgInventory, bindReservationToOrderPg } = require('../lib/inventory-pg');
                    if (shouldUsePgInventory()) {
                        await bindReservationToOrderPg(cleanOrderId);
                    } else {
                        await bindReservationToOrder(cleanOrderId);
                    }
                } catch (bindErr) {
                    console.warn('[send-order] reservation bind warning:', bindErr.message);
                }
            } catch (dbErr) {
                console.error('[send-order] DB Persistence Failed:', dbErr.message);
                // Roll back ONLY a reservation created by this request
                if (createdReservation) {
                    await releaseStock(product.sku, validQty, cleanOrderId, 'DB_PERSISTENCE_FAILED');
                }
                const err = new Error('STORAGE_UNAVAILABLE');
                err.statusCode = 503;
                err.code = 'STORAGE_UNAVAILABLE';
                err.message = 'تعذر حفظ الطلب في قاعدة البيانات. يرجى المحاولة مرة أخرى لاحقاً.';
                throw err;
            }

            // Customer stats background update
            try {
                await recordRiskEvent({ ...riskCtx, orderId: cleanOrderId }, riskResult);
                await findOrCreateCustomer(phone, fullName);
                await updateCustomerStats(phone, 'ordered');
            } catch (custErr) {
                console.warn('[send-order] Customer stats update warning:', custErr.message);
            }

            // C. Decoupled Meta Conversions API (CAPI)
            const cookieHeader = req.headers['cookie'] || '';
            const userFbp = fbp || getCookieValue(cookieHeader, '_fbp') || undefined;
            const userFbc = fbc || getCookieValue(cookieHeader, '_fbc') || undefined;

            try {
                let metaCfg = null;
                try {
                    metaCfg = getEffectiveSettings().metaPixel;
                } catch (_) {}
                if (metaCfg && metaCfg.capiEnabled === false) {
                    // Admin deactivated server CAPI code source
                } else {
                let effectivePixelId = (metaCfg && metaCfg.pixelId) || process.env.META_PIXEL_ID;

                sendMetaPurchaseEvent({
                    pixelId:        effectivePixelId || undefined,
                    eventId:        finalEventId,
                    value:          validGrandTotal,
                    currency:       'DZD',
                    orderId:        cleanOrderId,
                    fullName:       fullName,
                    phone:          phone,
                    wilaya:         cleanLocation,
                    commune:        cleanCommune,
                    clientIp:       clientIp,
                    userAgent:      req.headers['user-agent'],
                    eventSourceUrl: req.headers['referer'] || req.headers['origin'] || 'https://orva-store.com',
                    fbp:            userFbp,
                    fbc:            userFbc,
                    quantity:       validQty,
                    productName:    product.name,
                    contentName:    product.sku,
                    testEventCode:  activeTestCode
                }).catch(capiErr => {
                    console.warn('[Meta CAPI Async Warning]:', capiErr ? capiErr.message : capiErr);
                });
                }
            } catch (capiDispatchErr) {
                console.warn('[Meta CAPI Dispatch Warning]:', capiDispatchErr.message);
            }

            // D. Decoupled Telegram Alert with Ledger Deduplication (Phase 8D)
            try {
                dispatchTelegramNotification({
                    event: 'ORDER_CREATED',
                    orderId: cleanOrderId,
                    data: {
                        productTitle: product.shortTitle,
                        productName: product.name,
                        grandTotal: validGrandTotal,
                        fullName: fullName,
                        phone: phone,
                        location: cleanLocation,
                        deliveryType: actualDeliveryType,
                        quantity: validQty,
                        riskScore: riskResult.score,
                        riskDecision: riskResult.decision
                    }
                }).catch(tgErr => {
                    console.warn('[Telegram Dispatch Warning]:', tgErr ? tgErr.message : tgErr);
                });
            } catch (tgSyncErr) {
                console.warn('[Telegram Exception]:', tgSyncErr.message);
            }

            return {
                success: true,
                orderId: cleanOrderId,
                eventId: finalEventId,
                sku: product.sku,
                productName: product.name,
                quantity: validQty,
                productTotal: `${validProductTotal} د.ج`,
                shippingFee: `${validShipping} د.ج`,
                grandTotal: `${validGrandTotal} د.ج`,
                deliveryType: actualDeliveryType,
                deliveryTime: actualDeliveryTime,
                message: riskResult.decision === 'REVIEW' ? 'تم استلام طلبك وسيتم مراجعته قريباً.' : 'تم استلام طلبك بنجاح!'
            };
        });

        return res.status(200).json(executionResult);

    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({
                success: false,
                error: error.code || 'VALIDATION_FAILED',
                message: error.message
            });
        }
        console.error('[send-order] Unhandled error:', error);
        return res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Internal server error processing order.' });
    }
};
