'use strict';
// =============================================================================
// ORVA STORE — Authoritative Order Validation & Dynamic Tariff Engine (Phase 8C.1)
// Server-Side Financial Verification, Dynamic Catalog, Inventory & Idempotency Binding
// =============================================================================

const algeriaCommunes = require('../algeria-communes');
const {
    loadCatalog,
    resolveProduct,
    loadTariffs,
    resolveWilaya,
    registerOrUpdateProduct,
    setProductStatus
} = require('./catalog-manager');

const {
    getInventory,
    reserveStock,
    releaseStock,
    settleStock,
    setStockExplicit,
    reconcileStaleReservations,
    withCrossProcessInventoryLock
} = require('./inventory-manager');

const {
    extractIdempotencyKey,
    getStoredIdempotency,
    recordIdempotency,
    withIdempotencyLock
} = require('./idempotency-manager');

function validateCommune(wilayaId, communeName) {
    if (!wilayaId || !communeName) return false;
    const list = algeriaCommunes[String(wilayaId)];
    if (!list || !Array.isArray(list)) return false;

    const target = String(communeName).trim().toLowerCase();
    return list.some(c => c.toLowerCase() === target);
}

function validatePhone(phone) {
    if (!phone) return false;
    const cleaned = String(phone).replace(/[\s\-\.]/g, '');
    return /^(?:0|\+?213)(5|6|7)[0-9]{8}$/.test(cleaned);
}

// ── Master Authoritative Calculation & Verification ──────────────────────────
function verifyAndCalculateOrder(payload) {
    const {
        packId, productId, sku, productName,
        quantity: rawQty,
        wilaya: rawWilaya,
        wilayaId: rawWilayaId,
        commune: rawCommune,
        deliveryType: rawDeliveryType,
        fullName, phone
    } = payload || {};

    // 1. Validate required contact fields
    if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 3) {
        return { valid: false, code: 'INVALID_FULL_NAME', message: 'يرجى إدخال اسم كامل صحيح (3 أحرف على الأقل).' };
    }
    if (!validatePhone(phone)) {
        return { valid: false, code: 'INVALID_PHONE', message: 'رقم الهاتف غير صالح. يرجى إدخال رقم هاتف جزائري (05/06/07).' };
    }

    // 2. Authoritative Dynamic Product Resolution
    const prod = resolveProduct(sku || productId || packId || productName);
    if (!prod) {
        return { valid: false, code: 'PRODUCT_UNAVAILABLE', message: 'المنتج المطلوب غير متوفر أو تم حذفه من الكتالوج.' };
    }
    if (prod.status === 'archived' || prod.status === 'draft' || !prod.allowOrders) {
        return { valid: false, code: 'PRODUCT_INACTIVE', message: 'هذا المنتج متوقف حالياً عن البيع.' };
    }

    // 3. Quantity boundary validation (1 to 10 integer)
    const qty = Number(rawQty !== undefined ? rawQty : 1);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
        return { valid: false, code: 'INVALID_QUANTITY', message: 'كمية الطلب يجب أن تكون رقماً صحيحاً بين 1 و 10 قطع.' };
    }

    // 4. Wilaya Resolution — prefer wilayaId; never trust free-text location alone
    const wilayaObj = resolveWilaya(
        rawWilayaId !== undefined && rawWilayaId !== null && rawWilayaId !== ''
            ? rawWilayaId
            : rawWilaya
    );
    if (!wilayaObj) {
        return { valid: false, code: 'INVALID_WILAYA', message: 'يرجى اختيار ولاية صحيحة من قائمة الـ 58 ولاية.' };
    }

    // 5. Commune Validation
    const cleanCommune = String(rawCommune || '').trim();
    if (!cleanCommune || !validateCommune(wilayaObj.id, cleanCommune)) {
        return {
            valid: false,
            code: 'INVALID_COMMUNE_FOR_WILAYA',
            message: `البلدية "${cleanCommune}" غير مطابقة للولاية المختارة (${wilayaObj.canonicalName}).`
        };
    }

    // 6. Delivery Tariff Calculation
    const isStopdesk = typeof rawDeliveryType === 'string' && (
        rawDeliveryType.toLowerCase().includes('desk') ||
        rawDeliveryType.toLowerCase().includes('stop') ||
        rawDeliveryType.includes('مكتب')
    );

    let authoritativeShipping = 500;
    let actualDeliveryType = 'توصيل للمنزل';

    if (isStopdesk) {
        if (wilayaObj.stopdesk !== null) {
            authoritativeShipping = wilayaObj.stopdesk;
            actualDeliveryType = 'توصيل للمكتب (Stop Desk)';
        } else {
            // Stopdesk unavailable in southern wilayas, fallback to domicile
            authoritativeShipping = wilayaObj.domicile;
            actualDeliveryType = 'توصيل للمنزل (Stop Desk غير متوفر)';
        }
    } else {
        authoritativeShipping = wilayaObj.domicile;
        actualDeliveryType = 'توصيل للمنزل';
    }

    // 7. Authoritative Financial Computation (Zero Client Trust)
    const unitPrice = prod.sellingPrice;
    const calculatedProductTotal = unitPrice * qty;
    const calculatedGrandTotal = calculatedProductTotal + authoritativeShipping;

    return {
        valid: true,
        product: prod,
        wilaya: wilayaObj,
        commune: cleanCommune,
        quantity: qty,
        unitPrice,
        shippingFee: authoritativeShipping,
        productTotal: calculatedProductTotal,
        grandTotal: calculatedGrandTotal,
        deliveryType: actualDeliveryType,
        deliveryTime: wilayaObj.time
    };
}

function generateOrderDeduplicationKey(data) {
    const phone = String(data.phone || '').replace(/\D/g, '');
    const sku = String(data.sku || data.packId || '');
    const wilayaId = String(data.wilayaId || '');
    const timeBucket = Math.floor(Date.now() / 300000);
    return `dedup_${phone}_${sku}_${wilayaId}_${timeBucket}`;
}

module.exports = {
    loadCatalog,
    loadTariffs,
    resolveProduct,
    resolveWilaya,
    validateCommune,
    validatePhone,
    verifyAndCalculateOrder,
    registerOrUpdateProduct,
    setProductStatus,
    getInventory,
    getInventoryState: getInventory,
    reserveStock,
    releaseStock,
    settleStock,
    setStockExplicit,
    reconcileStaleReservations,
    withCrossProcessInventoryLock,
    extractIdempotencyKey,
    getStoredIdempotency,
    checkIdempotency: getStoredIdempotency,
    recordIdempotency,
    generateOrderDeduplicationKey,
    withIdempotencyLock
};
