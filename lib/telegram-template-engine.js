'use strict';
// =============================================================================
// ORVA Store — Centralized Telegram Template Engine & Variable Registry
// Milestone 1: Core Template Engine, HTML Sanitization, Length Capping,
// Safe Variable Substitution and Fallback Management.
// =============================================================================

const MAX_TELEGRAM_MESSAGE_LENGTH = 4096;
const TRUNCATION_CEILING = 4000;
const TRUNCATION_NOTICE = '\n\n... [تم اقتطاع الرسالة لتجاوز الحد الأقصى]';
const TEST_PREFIX = '🧪 <b>[TEST] [رسالة تجريبية]</b>\n\n';

/**
 * Safe property checker preventing prototype pollution.
 */
function hasOwn(obj, key) {
    if (!obj || typeof obj !== 'object') return false;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return false;
    return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Mask customer phone number for administrative privacy.
 * E.g. '0555123456' -> '055***3456'
 */
function maskPhone(phone) {
    if (!phone || typeof phone === 'object' || typeof phone === 'symbol') return 'غير محدد';
    const clean = String(phone).replace(/\s+/g, '');
    if (clean.includes('***')) return clean;
    if (clean.length < 8) return clean;
    return clean.slice(0, 3) + '***' + clean.slice(-4);
}

/**
 * Deterministically normalize variable names.
 * Converts camelCase to snake_case and lowercases:
 * 'orderId' -> 'order_id', 'ORDER_ID' -> 'order_id'
 */
function normalizeKey(key) {
    if (!key || typeof key !== 'string') return '';
    return key
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase();
}

/**
 * Strict Telegram HTML escaping.
 * Handles & first to prevent double-escaping, then <, >, ".
 */
function escapeTelegramHtml(rawText) {
    if (rawText === undefined || rawText === null || typeof rawText === 'object' || typeof rawText === 'symbol') return '';
    const str = typeof rawText === 'string' ? rawText : String(rawText);
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Strict variable value sanitizer.
 * Ensures undefined, null, NaN, [object Object], functions NEVER render.
 */
function sanitizeVariableValue(val, fallback = '') {
    if (val === undefined || val === null) {
        return fallback;
    }
    if (typeof val === 'function' || typeof val === 'symbol') {
        return fallback;
    }
    if (typeof val === 'object' && val !== null) {
        return fallback;
    }
    if (typeof val === 'number') {
        if (isNaN(val)) return fallback;
        return String(val);
    }
    if (typeof val === 'boolean') {
        return val ? 'نعم' : 'لا';
    }
    try {
        const str = String(val).trim();
        if (
            str === '' ||
            str === 'undefined' ||
            str === 'null' ||
            str === 'NaN' ||
            str.includes('[object Object]') ||
            str.startsWith('function ') ||
            str.includes('function(')
        ) {
            return fallback;
        }
        return str;
    } catch {
        return fallback;
    }
}

/**
 * Generate Direct Admin Dashboard URL.
 */
function generateDashboardUrl(orderId, baseUrl) {
    const defaultBase = 'https://orva-store.com';
    let base = baseUrl || process.env.ADMIN_BASE_URL || process.env.APP_BASE_URL || defaultBase;
    if (typeof base !== 'string' || !base.trim()) {
        base = defaultBase;
    }
    const cleanBase = base.trim().replace(/\/+$/, '');

    if (orderId && String(orderId).trim()) {
        const cleanId = String(orderId).trim();
        return `${cleanBase}/dashboard/ecommerce?orderId=${encodeURIComponent(cleanId)}`;
    }
    return `${cleanBase}/dashboard/ecommerce`;
}

// =============================================================================
// CENTRALIZED VARIABLE REGISTRY
// =============================================================================

const EVENT_REGISTRY = {
    ORDER_CREATED: {
        labelAr: 'طلب جديد (Checkout)',
        description: 'يتم إرساله فور إتمام الزبون للطلب عبر المتجر.',
        allowedVariables: [
            'order_id',
            'customer_name',
            'customer_phone',
            'product_name',
            'quantity',
            'product_price',
            'shipping_fee',
            'grand_total',
            'wilaya',
            'commune',
            'delivery_type',
            'delivery_time',
            'risk_score',
            'risk_decision',
            'risk_badge',
            'date',
            'dashboard_url'
        ],
        defaultTemplate: `👑 <b>طلب جديد: {{product_name}} — {{grand_total}} د.ج</b>
━━━━━━━━━━━━━━━━━━
<b>🆔 رقم الطلب:</b> <code>{{order_id}}</code>
<b>👤 الاسم:</b> {{customer_name}}
<b>📱 الهاتف:</b> <code>{{customer_phone}}</code>
<b>📍 المكان:</b> {{wilaya}}
<b>🚚 التوصيل:</b> {{delivery_type}}
<b>📦 الكمية:</b> {{quantity}} قطعة
<b>💰 الإجمالي:</b> <b>{{grand_total}} د.ج</b>
<b>📅 التاريخ:</b> {{date}}{{risk_badge}}
━━━━━━━━━━━━━━━━━━
👉 <a href="{{dashboard_url}}">لوحة التحكم (Admin Dashboard)</a>`,
        variables: {
            order_id: {
                key: 'order_id',
                aliases: ['orderId', 'id'],
                labelAr: 'رقم الطلب',
                description: 'المعرف الفريد للطلب (مثال: ORVA-94821)',
                defaultValue: 'غير محدد',
                sampleValue: 'ORVA-94821'
            },
            customer_name: {
                key: 'customer_name',
                aliases: ['customerName', 'fullName', 'name'],
                labelAr: 'اسم الزبون',
                description: 'الاسم الكامل للزبون كما أدخله في نموذج الطلب',
                defaultValue: 'زبون',
                sampleValue: 'سفيان بن علي'
            },
            customer_phone: {
                key: 'customer_phone',
                aliases: ['customerPhone', 'phone', 'maskedPhone'],
                labelAr: 'هاتف الزبون (مشفر)',
                description: 'رقم هاتف الزبون مع حجب الأرقام الوسطى لحماية الخصوصية',
                defaultValue: 'غير محدد',
                sampleValue: '055***3456'
            },
            product_name: {
                key: 'product_name',
                aliases: ['productName', 'productTitle', 'product', 'shortTitle'],
                labelAr: 'اسم المنتج / العرض',
                description: 'عنوان المنتج أو الباقة المطلوبة',
                defaultValue: 'منتج ORVA',
                sampleValue: 'PACK 4EN1 4950'
            },
            quantity: {
                key: 'quantity',
                aliases: ['qty', 'count'],
                labelAr: 'الكمية المطلوبة',
                description: 'عدد القطع المطلوبة',
                defaultValue: '1',
                sampleValue: '1'
            },
            product_price: {
                key: 'product_price',
                aliases: ['productPrice', 'productTotal', 'subtotal'],
                labelAr: 'سعر المنتج (د.ج)',
                description: 'سعر المنتج الإفرادي أو مجموع سعر المنتجات دون التوصيل',
                defaultValue: '0',
                sampleValue: '4,500'
            },
            shipping_fee: {
                key: 'shipping_fee',
                aliases: ['shippingFee', 'shipping', 'deliveryFee'],
                labelAr: 'مصاريف التوصيل (د.ج)',
                description: 'تكلفة الشحن المقدرة للمنطقة',
                defaultValue: '0',
                sampleValue: '450'
            },
            grand_total: {
                key: 'grand_total',
                aliases: ['grandTotal', 'total', 'priceNum', 'amount'],
                labelAr: 'المبلغ الإجمالي الكلي',
                description: 'المبلغ الإجمالي شامل المنتجات والتوصيل بالدينار الجزائري',
                defaultValue: '0',
                sampleValue: '4,950'
            },
            wilaya: {
                key: 'wilaya',
                aliases: ['location', 'wilayaName', 'province'],
                labelAr: 'الولاية / المكان',
                description: 'ولاية التوصيل أو الموقع الجغرافي للزبون',
                defaultValue: 'الجزائر',
                sampleValue: '16 — الجزائر العاصمة'
            },
            commune: {
                key: 'commune',
                aliases: ['city', 'municipality'],
                labelAr: 'البلدية',
                description: 'بلدية التوصيل',
                defaultValue: '',
                sampleValue: 'باب الزوار'
            },
            delivery_type: {
                key: 'delivery_type',
                aliases: ['deliveryType', 'delivery_method'],
                labelAr: 'نوع التوصيل',
                description: 'طريقة التسليم (توصيل للمنزل أو استلام من المكتب)',
                defaultValue: 'توصيل للمنزل',
                sampleValue: 'توصيل للمنزل'
            },
            delivery_time: {
                key: 'delivery_time',
                aliases: ['deliveryTime', 'duration'],
                labelAr: 'مدة التوصيل المقدرة',
                description: 'الوقت المقدر لوصول الطرد',
                defaultValue: '24 إلى 48 ساعة',
                sampleValue: '24 إلى 48 ساعة'
            },
            risk_score: {
                key: 'risk_score',
                aliases: ['riskScore', 'fraudScore'],
                labelAr: 'مؤشر الخطر (0-100)',
                description: 'درجة تقييم مخاطر الاحتيال للطلب',
                defaultValue: '0',
                sampleValue: '12'
            },
            risk_decision: {
                key: 'risk_decision',
                aliases: ['riskDecision'],
                labelAr: 'قرار نظام الحماية',
                description: 'قرار فحص الاحتيال (ALLOW, REVIEW, BLOCK)',
                defaultValue: 'ALLOW',
                sampleValue: 'ACCEPT'
            },
            risk_badge: {
                key: 'risk_badge',
                aliases: ['riskBadge'],
                labelAr: 'شارة الفحص اليدوي',
                description: 'تنبيه إضافي يظهر إذا كان الطلب يتطلب مراجعة يدوية',
                defaultValue: '',
                sampleValue: '\n🟡 مؤشر خطر: 12/100'
            },
            date: {
                key: 'date',
                aliases: ['dateTime', 'timestamp', 'created_at'],
                labelAr: 'التاريخ والتوقيت',
                description: 'تاريخ وتوقيت تسجيل الطلب بتوقيت الجزائر',
                defaultValue: 'الآن',
                sampleValue: '2026/11/04 14:35'
            },
            dashboard_url: {
                key: 'dashboard_url',
                aliases: ['dashboardUrl', 'admin_url', 'adminUrl', 'adminLink'],
                labelAr: 'رابط لوحة التحكم',
                description: 'رابط مباشر لفتح وتعديل تفاصيل الطلب في لوحة الإدارة',
                defaultValue: 'https://orva-store.com/admin.html',
                sampleValue: 'https://orva-store.com/admin.html?orderId=ORVA-94821'
            }
        }
    },

    SHIPMENT_CREATED: {
        labelAr: 'إنشاء شحنة جديدة (Courier Waybill)',
        description: 'يتم إرساله عند إنشاء بوليصة شحن لدى شركة التوصيل (مثل RedEx أو Yalidine).',
        allowedVariables: [
            'order_id',
            'courier_name',
            'tracking_number',
            'reference',
            'wilaya',
            'commune',
            'date',
            'dashboard_url'
        ],
        defaultTemplate: `🚚 <b>تم إنشاء بوليصة الشحن بنجاح</b>
━━━━━━━━━━━━━━━━━━
<b>🆔 رقم الطلب:</b> <code>{{order_id}}</code>
<b>📦 شركة الشحن:</b> {{courier_name}}
<b>🏷️ رقم التتبع:</b> <code>{{tracking_number}}</code>
<b>📋 المرجع:</b> <code>{{reference}}</code>
<b>📍 الوجهة:</b> {{wilaya}} ({{commune}})
<b>📅 التاريخ:</b> {{date}}
━━━━━━━━━━━━━━━━━━
👉 <a href="{{dashboard_url}}">عرض تفاصيل الشحنة</a>`,
        variables: {
            order_id: {
                key: 'order_id',
                aliases: ['orderId', 'id'],
                labelAr: 'رقم الطلب',
                description: 'رقم الطلب الداخلي في المتجر',
                defaultValue: 'غير محدد',
                sampleValue: 'ORVA-94821'
            },
            courier_name: {
                key: 'courier_name',
                aliases: ['courierName', 'carrier', 'courier'],
                labelAr: 'شركة الشحن',
                description: 'اسم الناقل اللوجستي',
                defaultValue: 'Redex Delivery DZ',
                sampleValue: 'Redex Delivery DZ'
            },
            tracking_number: {
                key: 'tracking_number',
                aliases: ['trackingNumber', 'trackingCode', 'tracking'],
                labelAr: 'رقم التتبع / البوليصة',
                description: 'رقم التتبع الصادر من الناقل',
                defaultValue: 'غير متوفر',
                sampleValue: 'RDX-94821-DZ'
            },
            reference: {
                key: 'reference',
                aliases: ['ref', 'orderReference'],
                labelAr: 'المرجع لدى الناقل',
                description: 'المرجع المعتمد لدى شركة الشحن',
                defaultValue: 'غير محدد',
                sampleValue: 'REF-ORVA-94821'
            },
            wilaya: {
                key: 'wilaya',
                aliases: ['location', 'wilayaName'],
                labelAr: 'ولاية التسليم',
                description: 'ولاية المقصد للشحنة',
                defaultValue: '',
                sampleValue: 'الجزائر العاصمة'
            },
            commune: {
                key: 'commune',
                aliases: ['city'],
                labelAr: 'بلدية التسليم',
                description: 'بلدية المقصد للشحنة',
                defaultValue: '',
                sampleValue: 'باب الزوار'
            },
            date: {
                key: 'date',
                aliases: ['dateTime', 'timestamp'],
                labelAr: 'تاريخ الإنشاء',
                description: 'توقيت توليد البوليصة',
                defaultValue: 'الآن',
                sampleValue: '2026/11/04 15:10'
            },
            dashboard_url: {
                key: 'dashboard_url',
                aliases: ['dashboardUrl', 'admin_url', 'adminLink'],
                labelAr: 'رابط تفاصيل الشحنة',
                description: 'رابط معاينة الطلب والشحنة في لوحة الإدارة',
                defaultValue: 'https://orva-store.com/admin.html',
                sampleValue: 'https://orva-store.com/admin.html?orderId=ORVA-94821'
            }
        }
    },

    SHIPMENT_FAILED: {
        labelAr: 'فشل إنشاء الشحنة (Courier Error)',
        description: 'يتم إرساله عند رفض شركة الشحن إنشاء البوليصة أو حدوث خطأ أثناء الإرسال.',
        allowedVariables: [
            'order_id',
            'courier_name',
            'error_message',
            'date',
            'dashboard_url'
        ],
        defaultTemplate: `❌ <b>فشل إنشاء الشحنة مع شركة الشحن</b>
━━━━━━━━━━━━━━━━━━
<b>🆔 رقم الطلب:</b> <code>{{order_id}}</code>
<b>📦 شركة الشحن:</b> {{courier_name}}
<b>⚠️ سبب الخطأ:</b> {{error_message}}
<b>📅 التاريخ:</b> {{date}}
━━━━━━━━━━━━━━━━━━
⚠️ <i>لم يتم تعديل الطلب الداخلي أو المخزون. يرجى التدقيق يدوياً.</i>
👉 <a href="{{dashboard_url}}">لوحة التحكم</a>`,
        variables: {
            order_id: {
                key: 'order_id',
                aliases: ['orderId', 'id'],
                labelAr: 'رقم الطلب',
                description: 'رقم الطلب المعني بالخطأ',
                defaultValue: 'غير محدد',
                sampleValue: 'ORVA-94821'
            },
            courier_name: {
                key: 'courier_name',
                aliases: ['courierName', 'carrier'],
                labelAr: 'شركة الشحن',
                description: 'اسم شركة الشحن التي رفضت العملية',
                defaultValue: 'Redex Delivery DZ',
                sampleValue: 'Redex Delivery DZ'
            },
            error_message: {
                key: 'error_message',
                aliases: ['errorMessage', 'error', 'reason', 'failureReason'],
                labelAr: 'سبب / رسالة الخطأ',
                description: 'نص الخطأ الصادر عن خادم الناقل',
                defaultValue: 'خطأ غير محدد من خادم التوصيل',
                sampleValue: 'رمز البلدية غير متطابق مع الولاية المختارة (Commune mismatch)'
            },
            date: {
                key: 'date',
                aliases: ['dateTime', 'timestamp'],
                labelAr: 'تاريخ الفشل',
                description: 'توقيت حدوث الخطأ',
                defaultValue: 'الآن',
                sampleValue: '2026/11/04 15:12'
            },
            dashboard_url: {
                key: 'dashboard_url',
                aliases: ['dashboardUrl', 'admin_url', 'adminLink'],
                labelAr: 'رابط لوحة التحكم',
                description: 'رابط الطلب للتدخل اليدوي',
                defaultValue: 'https://orva-store.com/admin.html',
                sampleValue: 'https://orva-store.com/admin.html?orderId=ORVA-94821'
            }
        }
    },

    STATUS_UPDATED: {
        labelAr: 'تحديث حالة الشحن (Status Sync)',
        description: 'يتم إرساله عند استلام تحديث جديد لحالة الطرد من شركة الشحن.',
        allowedVariables: [
            'order_id',
            'tracking_number',
            'new_status',
            'status_label_ar',
            'status_label',
            'new_status_code',
            'old_status',
            'raw_status',
            'receipt_classification',
            'date',
            'dashboard_url'
        ],
        defaultTemplate: `🔄 <b>تحديث حالة الشحن: {{new_status}}</b>
━━━━━━━━━━━━━━━━━━
<b>🆔 رقم الطلب:</b> <code>{{order_id}}</code>
<b>🏷️ رقم التتبع:</b> <code>{{tracking_number}}</code>
<b>📊 الحالة الجديدة:</b> {{new_status}} ({{receipt_classification}})
<b>📝 الحالة الأصلية:</b> <code>{{raw_status}}</code>
<b>📅 التاريخ:</b> {{date}}
━━━━━━━━━━━━━━━━━━
👉 <a href="{{dashboard_url}}">عرض الطلب</a>`,
        variables: {
            order_id: {
                key: 'order_id',
                aliases: ['orderId', 'id'],
                labelAr: 'رقم الطلب',
                description: 'رقم الطلب المرتبط بالتحديث',
                defaultValue: 'غير محدد',
                sampleValue: 'ORVA-94821'
            },
            tracking_number: {
                key: 'tracking_number',
                aliases: ['trackingNumber', 'trackingCode'],
                labelAr: 'رقم التتبع',
                description: 'رقم بوليصة الشحنة',
                defaultValue: 'غير متوفر',
                sampleValue: 'RDX-94821-DZ'
            },
            new_status: {
                key: 'new_status',
                aliases: ['newStatus', 'statusLabelAr', 'status_label_ar', 'status_label', 'status'],
                labelAr: 'الحالة الجديدة (عربي)',
                description: 'الاسم العربي للحالة المعيارية (مثال: تم التسليم للزبون)',
                defaultValue: 'تحديث حالة',
                sampleValue: 'تم التسليم للزبون'
            },
            status_label_ar: {
                key: 'status_label_ar',
                aliases: ['statusLabelAr', 'status_label', 'statusLabel', 'new_status', 'newStatus', 'status'],
                labelAr: 'الحالة الجديدة (عربي)',
                description: 'الاسم العربي للحالة المعيارية (مثال: تم التسليم للزبون)',
                defaultValue: 'تحديث حالة',
                sampleValue: 'تم التسليم للزبون'
            },
            status_label: {
                key: 'status_label',
                aliases: ['status_label_ar', 'statusLabelAr', 'new_status', 'newStatus', 'status'],
                labelAr: 'اسم الحالة',
                description: 'اسم الحالة للتحديث اللوجستي',
                defaultValue: 'تحديث حالة',
                sampleValue: 'تم التسليم للزبون'
            },
            new_status_code: {
                key: 'new_status_code',
                aliases: ['newStatusCode', 'normalizedStatus'],
                labelAr: 'رمز الحالة المعياري',
                description: 'الرمز البرمجي للحالة (DELIVERED_TO_CUSTOMER, etc.)',
                defaultValue: 'UNKNOWN',
                sampleValue: 'DELIVERED_TO_CUSTOMER'
            },
            old_status: {
                key: 'old_status',
                aliases: ['oldStatus', 'previousStatus'],
                labelAr: 'الحالة السابقة',
                description: 'الحالة التي كان عليها الطرد قبل التحديث',
                defaultValue: '',
                sampleValue: 'خرج للتسليم'
            },
            raw_status: {
                key: 'raw_status',
                aliases: ['rawStatus', 'courierStatus'],
                labelAr: 'الحالة الأصلية من الناقل',
                description: 'النص الخام للحالة كما وردت من API شركة الشحن',
                defaultValue: '',
                sampleValue: 'LIVRE_CLIENT'
            },
            receipt_classification: {
                key: 'receipt_classification',
                aliases: ['receiptClassification', 'classification'],
                labelAr: 'تصنيف استلام الزبون',
                description: 'تصنيف الاستلام (Received, Returning, etc.)',
                defaultValue: '',
                sampleValue: 'Received'
            },
            date: {
                key: 'date',
                aliases: ['dateTime', 'timestamp'],
                labelAr: 'تاريخ التحديث',
                description: 'توقيت معالجة التحديث',
                defaultValue: 'الآن',
                sampleValue: '2026/11/04 16:45'
            },
            dashboard_url: {
                key: 'dashboard_url',
                aliases: ['dashboardUrl', 'admin_url', 'adminLink'],
                labelAr: 'رابط فحص الطلب',
                description: 'رابط فحص وتدقيق حالة الطلب',
                defaultValue: 'https://orva-store.com/admin.html',
                sampleValue: 'https://orva-store.com/admin.html?orderId=ORVA-94821'
            }
        }
    },

    ORDER_CANCELLED: {
        labelAr: 'إلغاء الطلب (Order Cancelled)',
        description: 'يتم إرساله عند إلغاء الطلب من لوحة التحكم واسترجاع المخزون.',
        allowedVariables: [
            'order_id',
            'cancellation_reason',
            'reason',
            'restocked',
            'date',
            'dashboard_url'
        ],
        defaultTemplate: `🚫 <b>تم إلغاء الطلب / الشحنة</b>
━━━━━━━━━━━━━━━━━━
<b>🆔 رقم الطلب:</b> <code>{{order_id}}</code>
<b>سبب الإلغاء:</b> {{cancellation_reason}}
<b>المخزون المسترجع:</b> {{restocked}}
<b>📅 التاريخ:</b> {{date}}
━━━━━━━━━━━━━━━━━━
👉 <a href="{{dashboard_url}}">لوحة التحكم</a>`,
        variables: {
            order_id: {
                key: 'order_id',
                aliases: ['orderId', 'id'],
                labelAr: 'رقم الطلب',
                description: 'رقم الطلب الملغى',
                defaultValue: 'غير محدد',
                sampleValue: 'ORVA-94821'
            },
            cancellation_reason: {
                key: 'cancellation_reason',
                aliases: ['cancellationReason', 'reason'],
                labelAr: 'سبب الإلغاء',
                description: 'السبب المسجل لإلغاء الطلب',
                defaultValue: 'إلغاء من لوحة التحكم أو رفض الزبون',
                sampleValue: 'طلب الزبون إلغاء الطلب بعد الاتصال الهاتفي'
            },
            reason: {
                key: 'reason',
                aliases: ['cancellation_reason', 'cancellationReason'],
                labelAr: 'سبب الإلغاء',
                description: 'السبب المسجل لإلغاء الطلب',
                defaultValue: 'إلغاء من لوحة التحكم أو رفض الزبون',
                sampleValue: 'طلب الزبون إلغاء الطلب بعد الاتصال الهاتفي'
            },
            restocked: {
                key: 'restocked',
                aliases: ['restockStatus', 'inventoryRestocked'],
                labelAr: 'حالة استرجاع المخزون',
                description: 'بيان ما إذا تم استرجاع الكمية إلى المستودع',
                defaultValue: 'لم يتغير',
                sampleValue: 'تم إرجاع الكمية للمخزون (+1)'
            },
            date: {
                key: 'date',
                aliases: ['dateTime', 'timestamp'],
                labelAr: 'تاريخ الإلغاء',
                description: 'توقيت إلغاء الطلب',
                defaultValue: 'الآن',
                sampleValue: '2026/11/04 17:00'
            },
            dashboard_url: {
                key: 'dashboard_url',
                aliases: ['dashboardUrl', 'admin_url', 'adminLink'],
                labelAr: 'رابط لوحة التحكم',
                description: 'رابط معاينة الطلب في لوحة التحكم',
                defaultValue: 'https://orva-store.com/admin.html',
                sampleValue: 'https://orva-store.com/admin.html?orderId=ORVA-94821'
            }
        }
    },

    ADMIN_ALERT: {
        labelAr: 'تنبيه إداري يدوي (Admin Broadcast)',
        description: 'رسائل وتنبيهات مخصصة يرسلها المشرف إلى قناة الإدارة المعتمدة.',
        allowedVariables: [
            'title',
            'body',
            'admin_name',
            'severity',
            'date',
            'dashboard_url'
        ],
        defaultTemplate: `📢 <b>{{title}}</b>
━━━━━━━━━━━━━━━━━━
{{body}}
━━━━━━━━━━━━━━━━━━
<b>👤 المرسل:</b> {{admin_name}}
<b>📅 التاريخ:</b> {{date}}
👉 <a href="{{dashboard_url}}">لوحة التحكم</a>`,
        variables: {
            title: {
                key: 'title',
                aliases: ['alertTitle', 'subject'],
                labelAr: 'عنوان التنبيه الإداري',
                description: 'موضوع التنبيه الرئيسي',
                defaultValue: 'تنبيه إداري من متجر ORVA',
                sampleValue: 'تنبيه إداري: تحديث أسعار التوصيل'
            },
            body: {
                key: 'body',
                aliases: ['message', 'content', 'text'],
                labelAr: 'نص الرسالة الإدارية',
                description: 'تفاصيل الإشعار أو التعميم',
                defaultValue: '',
                sampleValue: 'تم تحديث أسعار الشحن لكافة ولايات الجنوب الكبير ابتداءً من اليوم. يرجى مراجعة جدول التعريفات في لوحة التحكم.'
            },
            admin_name: {
                key: 'admin_name',
                aliases: ['adminName', 'sender', 'author'],
                labelAr: 'اسم المسؤول / المرسل',
                description: 'اسم الشخص الذي قام بإرسال التنبيه',
                defaultValue: 'مدير المتجر',
                sampleValue: 'المدير العام'
            },
            severity: {
                key: 'severity',
                aliases: ['priority', 'level'],
                labelAr: 'مستوى الأهمية',
                description: 'مستوى الأهمية (INFO, WARNING, URGENT)',
                defaultValue: 'INFO',
                sampleValue: 'INFO'
            },
            date: {
                key: 'date',
                aliases: ['dateTime', 'timestamp'],
                labelAr: 'تاريخ الإرسال',
                description: 'تاريخ وتوقيت إرسال التنبيه',
                defaultValue: 'الآن',
                sampleValue: '2026/11/04 17:30'
            },
            dashboard_url: {
                key: 'dashboard_url',
                aliases: ['dashboardUrl', 'admin_url', 'adminLink'],
                labelAr: 'رابط لوحة التحكم',
                description: 'رابط عام للوحة التحكم',
                defaultValue: 'https://orva-store.com/admin.html',
                sampleValue: 'https://orva-store.com/admin.html'
            }
        }
    }
};

/**
 * Return copy of the Centralized Event Registry.
 */
function getEventRegistry() {
    return JSON.parse(JSON.stringify(EVENT_REGISTRY));
}

/**
 * Check if a variable key/alias is valid for a given event.
 */
function isValidVariable(event, variableName) {
    if (!event || !variableName || !hasOwn(EVENT_REGISTRY, event)) return false;
    const normName = normalizeKey(variableName);
    const eventConfig = hasOwn(EVENT_REGISTRY, event) ? EVENT_REGISTRY[event] : null;
    if (!eventConfig || !eventConfig.allowedVariables) return false;

    for (const key of eventConfig.allowedVariables) {
        if (normalizeKey(key) === normName) return true;
        const varDef = eventConfig.variables[key];
        if (varDef && varDef.aliases) {
            for (const alias of varDef.aliases) {
                if (normalizeKey(alias) === normName) return true;
            }
        }
    }
    return false;
}

/**
 * Return array of variable descriptors for a given event.
 */
function getEventVariables(event) {
    if (!event || !hasOwn(EVENT_REGISTRY, event)) return [];
    const eventConfig = hasOwn(EVENT_REGISTRY, event) ? EVENT_REGISTRY[event] : null;
    if (!eventConfig || !eventConfig.allowedVariables) return [];
    return eventConfig.allowedVariables.map((k) => {
        const v = eventConfig.variables[k];
        return {
            key: v.key,
            labelAr: v.labelAr,
            description: v.description,
            defaultValue: v.defaultValue,
            sampleValue: v.sampleValue,
            aliases: v.aliases || []
        };
    });
}

/**
 * Generate authentic Algerian sample data for live preview and test sends.
 */
function getSampleData(event) {
    if (!event || !hasOwn(EVENT_REGISTRY, event)) {
        return {
            order_id: 'ORVA-94821',
            date: '2026/11/04 14:35',
            dashboard_url: 'https://orva-store.com/admin.html?orderId=ORVA-94821'
        };
    }

    const eventConfig = hasOwn(EVENT_REGISTRY, event) ? EVENT_REGISTRY[event] : null;
    if (!eventConfig || !eventConfig.allowedVariables) {
        return {
            order_id: 'ORVA-94821',
            date: '2026/11/04 14:35',
            dashboard_url: 'https://orva-store.com/admin.html?orderId=ORVA-94821'
        };
    }

    const data = {};
    for (const key of eventConfig.allowedVariables) {
        const v = eventConfig.variables[key];
        data[key] = (v && v.sampleValue !== undefined) ? v.sampleValue : '';
    }
    return data;
}

// =============================================================================
// HTML SANITIZATION & TAG WHITELISTING
// =============================================================================

const ALLOWED_TAGS = new Set([
    'b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del',
    'a', 'code', 'pre', 'blockquote', 'tg-spoiler', 'tg-emoji', 'span'
]);

/**
 * Whitelist sanitizer for Telegram HTML templates.
 * Strips disallowed tags, converts layout tags (<br> -> \n), cleans attributes,
 * replaces unsupported entities, and auto-balances tags in strict LIFO order.
 */
function sanitizeTelegramTemplate(rawTemplate) {
    if (!rawTemplate || typeof rawTemplate !== 'string') return '';

    let text = rawTemplate;

    // 1. Remove dangerous script, style, iframe tags and their inner content
    text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    text = text.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

    // 2. Normalize layout tags to plain-text equivalents
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<p\b[^>]*>/gi, '');
    text = text.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '<b>$1</b>\n');
    text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, '• $1\n');
    text = text.replace(/<\/?(?:ul|ol|div|header|footer|section|article)\b[^>]*>/gi, '');

    // 3. Replace unsupported named entities with literal characters
    const entityMap = {
        '&nbsp;': ' ',
        '&copy;': '©',
        '&reg;': '®',
        '&trade;': '™',
        '&euro;': '€',
        '&pound;': '£',
        '&yen;': '¥',
        '&cent;': '¢',
        '&mdash;': '—',
        '&ndash;': '–',
        '&hellip;': '…',
        '&apos;': '&#39;'
    };
    text = text.replace(/&(?:nbsp|copy|reg|trade|euro|pound|yen|cent|mdash|ndash|hellip|apos);/g, (match) => entityMap[match] || match);

    // 4. Tokenize tags and enforce strict tag & attribute whitelist
    const tagRegex = /<\/?([a-zA-Z0-9_-]+)([^>]*)>/g;
    const openTagStack = [];
    let sanitized = '';
    let lastIndex = 0;

    let match;
    while ((match = tagRegex.exec(text)) !== null) {
        const fullMatch = match[0];
        const isClosing = fullMatch.startsWith('</');
        const rawTagName = match[1].toLowerCase();
        const rawAttrs = match[2] || '';
        const matchStart = match.index;

        // Append text preceding this tag
        sanitized += text.slice(lastIndex, matchStart);
        lastIndex = matchStart + fullMatch.length;

        // If tag is not in whitelist, strip tag wrapper but retain inner text
        if (!ALLOWED_TAGS.has(rawTagName)) {
            continue;
        }

        if (isClosing) {
            // Find matching opening tag on stack (LIFO)
            const stackIdx = openTagStack.lastIndexOf(rawTagName);
            if (stackIdx !== -1) {
                // Close any improperly nested tags in between
                while (openTagStack.length - 1 > stackIdx) {
                    const unclosed = openTagStack.pop();
                    sanitized += `</${unclosed}>`;
                }
                openTagStack.pop();
                sanitized += `</${rawTagName}>`;
            }
            // Discard orphaned closing tag
        } else {
            // Opening tag: sanitize attributes strictly
            let cleanTag = '';
            if (rawTagName === 'a') {
                const hrefMatch = rawAttrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
                const href = hrefMatch ? (hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || '').trim() : '';
                // Validate protocol strictly: http://, https://, or tg://
                if (/^(?:https?:\/\/|tg:\/\/)/i.test(href)) {
                    // Ampersands and quotes in URL must be escaped
                    const safeHref = href.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                    cleanTag = `<a href="${safeHref}">`;
                    openTagStack.push('a');
                } else {
                    cleanTag = ''; // Insecure or invalid protocol -> strip <a> wrapper
                }
            } else if (rawTagName === 'span') {
                if (/\bclass\s*=\s*["']tg-spoiler["']/i.test(rawAttrs)) {
                    cleanTag = '<span class="tg-spoiler">';
                    openTagStack.push('span');
                } else {
                    cleanTag = ''; // Disallowed span
                }
            } else if (rawTagName === 'blockquote') {
                const isExpandable = /\bexpandable\b/i.test(rawAttrs);
                cleanTag = isExpandable ? '<blockquote expandable>' : '<blockquote>';
                openTagStack.push('blockquote');
            } else if (rawTagName === 'tg-emoji') {
                const emojiMatch = rawAttrs.match(/\bemoji-id\s*=\s*["']?(\d+)["']?/i);
                if (emojiMatch) {
                    cleanTag = `<tg-emoji emoji-id="${emojiMatch[1]}">`;
                    openTagStack.push('tg-emoji');
                } else {
                    cleanTag = '';
                }
            } else if (rawTagName === 'code') {
                const langMatch = rawAttrs.match(/\bclass\s*=\s*["'](language-[a-zA-Z0-9_-]+)["']/i);
                if (langMatch) {
                    cleanTag = `<code class="${langMatch[1]}">`;
                } else {
                    cleanTag = '<code>';
                }
                openTagStack.push('code');
            } else {
                // All other allowed tags: strictly ZERO attributes permitted
                cleanTag = `<${rawTagName}>`;
                openTagStack.push(rawTagName);
            }

            sanitized += cleanTag;
        }
    }

    // Append remaining text
    sanitized += text.slice(lastIndex);

    // Auto-close any unclosed tags remaining on the stack
    while (openTagStack.length > 0) {
        const remaining = openTagStack.pop();
        sanitized += `</${remaining}>`;
    }

    return sanitized;
}

/**
 * Truncate message safely respecting Telegram's 4,096 char limit,
 * preserving HTML tags, entities, surrogate pairs, and auto-closing tags.
 */
function enforceLengthLimit(htmlText) {
    if (!htmlText || htmlText.length <= MAX_TELEGRAM_MESSAGE_LENGTH) {
        return {
            text: htmlText || '',
            charCount: (htmlText || '').length,
            truncated: false,
            warnings: []
        };
    }

    let truncatedText = '';
    const tagStack = [];
    let i = 0;

    const calcClosingLen = () => tagStack.reduce((sum, t) => sum + t.length + 3, 0);

    while (i < htmlText.length) {
        const currentClosingLen = calcClosingLen();
        const maxBudget = Math.min(TRUNCATION_CEILING, MAX_TELEGRAM_MESSAGE_LENGTH - TRUNCATION_NOTICE.length - currentClosingLen);

        if (truncatedText.length >= maxBudget) {
            break;
        }

        const char = htmlText[i];

        if (char === '<') {
            let inTag = true;
            let currentTag = '<';
            i++;
            let tagChars = 0;

            // Bound tag scanning so an unclosed < does not scan past 250 characters
            while (i < htmlText.length && inTag && tagChars < 250) {
                currentTag += htmlText[i];
                if (htmlText[i] === '>') {
                    inTag = false;
                }
                i++;
                tagChars++;
            }

            // If tag never closed, treat as unclosed tag / syntax error and stop
            if (inTag) {
                const remainingSpace = Math.max(0, maxBudget - truncatedText.length);
                truncatedText += currentTag.slice(0, remainingSpace);
                break;
            }

            // Determine if this is an open or close tag
            const openMatch = currentTag.match(/^<([a-zA-Z0-9_-]+)/);
            const closeMatch = currentTag.match(/^<\/([a-zA-Z0-9_-]+)>/);
            const isSelfClosing = currentTag.endsWith('/>');

            let addedClosingLen = 0;
            if (openMatch && !isSelfClosing && !closeMatch) {
                addedClosingLen = openMatch[1].length + 3;
            }

            // Pre-calculate remaining budget when adding tags near the threshold
            const projectedClosingLen = currentClosingLen + addedClosingLen;
            const projectedMaxBudget = Math.min(TRUNCATION_CEILING, MAX_TELEGRAM_MESSAGE_LENGTH - TRUNCATION_NOTICE.length - projectedClosingLen);

            if (truncatedText.length + currentTag.length > projectedMaxBudget) {
                // Not enough room for this tag, stop before it
                break;
            }

            // Update tagStack
            if (openMatch && !isSelfClosing && !closeMatch) {
                tagStack.push(openMatch[1].toLowerCase());
            } else if (closeMatch) {
                const idx = tagStack.lastIndexOf(closeMatch[1].toLowerCase());
                if (idx !== -1) tagStack.splice(idx, 1);
            }

            truncatedText += currentTag;
            continue;
        }

        // Avoid splitting surrogate pairs
        const code = htmlText.charCodeAt(i);
        if (code >= 0xD800 && code <= 0xDBFF && i + 1 < htmlText.length) {
            if (truncatedText.length + 2 > maxBudget) {
                break;
            }
            truncatedText += htmlText.slice(i, i + 2);
            i += 2;
        } else {
            if (truncatedText.length + 1 > maxBudget) {
                break;
            }
            truncatedText += char;
            i++;
        }
    }

    // Ensure closing tags fit within remaining space
    while (tagStack.length > 0) {
        const closingLen = calcClosingLen();
        if (closingLen + TRUNCATION_NOTICE.length <= MAX_TELEGRAM_MESSAGE_LENGTH) {
            break;
        }
        tagStack.shift();
    }

    // Build closing tags in LIFO order
    let closingTags = '';
    for (let j = tagStack.length - 1; j >= 0; j--) {
        closingTags += `</${tagStack[j]}>`;
    }

    let finalText = truncatedText + TRUNCATION_NOTICE + closingTags;

    // Post-truncation hard clamp ensuring <= 4,096 chars under all conditions
    if (finalText.length > MAX_TELEGRAM_MESSAGE_LENGTH) {
        const budget = MAX_TELEGRAM_MESSAGE_LENGTH - TRUNCATION_NOTICE.length - closingTags.length;
        if (budget > 0) {
            truncatedText = truncatedText.slice(0, budget);
            const lastOpen = truncatedText.lastIndexOf('<');
            const lastClose = truncatedText.lastIndexOf('>');
            if (lastOpen > lastClose) {
                truncatedText = truncatedText.slice(0, lastOpen);
            }
            if (truncatedText.length > 0) {
                const lastCode = truncatedText.charCodeAt(truncatedText.length - 1);
                if (lastCode >= 0xD800 && lastCode <= 0xDBFF) {
                    truncatedText = truncatedText.slice(0, -1);
                }
            }
            finalText = truncatedText + TRUNCATION_NOTICE + closingTags;
        } else {
            finalText = finalText.slice(0, MAX_TELEGRAM_MESSAGE_LENGTH);
        }
    }

    return {
        text: finalText,
        charCount: finalText.length,
        truncated: true,
        warnings: [`MESSAGE_EXCEEDED_4096_CHARS_TRUNCATED: original length was ${htmlText.length}`]
    };
}

// =============================================================================
// TEMPLATE VALIDATION & RENDERING
// =============================================================================

/**
 * Validate a template before saving or activating.
 *
 * @param {string} event
 * @param {string} templateText
 * @returns {{ valid: boolean, errors: string[], warnings: string[], unknownVariables: string[] }}
 */
function validateTemplate(event, templateText) {
    const errors = [];
    const warnings = [];
    const unknownVariables = [];

    if (!templateText || typeof templateText !== 'string' || !templateText.trim()) {
        errors.push('نص القالب لا يمكن أن يكون فارغاً (TEMPLATE_EMPTY).');
        return { valid: false, errors, warnings, unknownVariables };
    }

    if (!event || !hasOwn(EVENT_REGISTRY, event)) {
        errors.push(`UNKNOWN_EVENT: الحدث "${event}" غير مدعوم في النظام.`);
        return { valid: false, errors, warnings, unknownVariables };
    }

    // 1. Check for unknown variables
    const varMatches = templateText.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g);
    const checked = new Set();
    for (const match of varMatches) {
        const rawVar = match[1];
        if (checked.has(rawVar)) continue;
        checked.add(rawVar);

        if (!isValidVariable(event, rawVar)) {
            unknownVariables.push(rawVar);
            errors.push(`المتغير {{${rawVar}}} غير مدعوم في حدث ${event} (UNKNOWN_VARIABLE).`);
        }
    }

    // 2. Check for disallowed tags
    const disallowedMatch = templateText.match(/<\/?(script|iframe|style|object|embed|form|input|button|applet|meta|link)\b/i);
    if (disallowedMatch) {
        errors.push(`DISALLOWED_TAG: الوسم <${disallowedMatch[1]}> غير مسموح به لأسباب أمنية.`);
    }

    // 3. Check for tag balance
    const tagRegex = /<\/?([a-zA-Z0-9_-]+)[^>]*>/g;
    const stack = [];
    let match;
    while ((match = tagRegex.exec(templateText)) !== null) {
        const full = match[0];
        const isClosing = full.startsWith('</');
        const tag = match[1].toLowerCase();

        // Skip void / layout tags that might be in raw user text
        if (tag === 'br' || tag === 'hr' || tag === 'img') continue;

        if (isClosing) {
            if (stack.length === 0 || stack[stack.length - 1] !== tag) {
                errors.push(`UNCLOSED_TAG_${tag.toUpperCase()}: تم العثور على وسم إغلاق </${tag}> دون وسم فتح متطابق.`);
                break;
            }
            stack.pop();
        } else {
            stack.push(tag);
        }
    }

    if (stack.length > 0) {
        for (const t of stack) {
            errors.push(`UNCLOSED_TAG_${t.toUpperCase()}: الوسم <${t}> لم يتم إغلاقه.`);
        }
    }

    // 4. Sample render length check
    try {
        const sampleData = getSampleData(event);
        const sampleRender = renderTemplate(templateText, sampleData, { event });
        if (sampleRender.charCount > MAX_TELEGRAM_MESSAGE_LENGTH) {
            warnings.push(`تحذير: الرسالة الناتجة مع البيانات النموذجية تتجاوز 4,096 حرفاً (${sampleRender.charCount} حرف). سيتم اقتطاعها تلقائياً.`);
        }
    } catch (_) {}

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        unknownVariables
    };
}

/**
 * Build unified template context from event, orderId, and data object.
 */
function buildTemplateContext(event, orderId, data = {}, options = {}) {
    const rawData = (data && typeof data === 'object') ? data : {};
    const context = { ...rawData };

    // Set orderId
    const resolvedOrderId = orderId || rawData.orderId || rawData.order_id || rawData.id || '';
    if (resolvedOrderId) {
        context.order_id = resolvedOrderId;
        context.orderId = resolvedOrderId;
    }

    // Date
    if (!context.date && !context.dateTime && !context.timestamp && !context.created_at) {
        context.date = new Date().toLocaleString('ar-DZ', { timeZone: 'Africa/Algiers' });
    }

    // Phone number resolution: preserve full original phone for admin notification, provide masked_phone as secondary
    const phoneVal = rawData.phone || rawData.customerPhone || rawData.customer_phone || rawData.maskedPhone;
    if (phoneVal) {
        const rawCleanPhone = String(phoneVal).trim();
        const masked = maskPhone(rawCleanPhone);
        context.customer_phone = rawCleanPhone;
        context.customerPhone = rawCleanPhone;
        context.phone = rawCleanPhone;
        context.raw_phone = rawCleanPhone;
        context.masked_phone = masked;
        context.maskedPhone = masked;
    }

    // Map common aliases
    if (rawData.fullName || rawData.customerName || rawData.name) {
        const name = rawData.fullName || rawData.customerName || rawData.name;
        context.customer_name = name;
        context.customerName = name;
        context.fullName = name;
    }

    if (rawData.productTitle || rawData.productName || rawData.shortTitle) {
        const prod = rawData.productTitle || rawData.productName || rawData.shortTitle;
        context.product_name = prod;
        context.productName = prod;
        context.productTitle = prod;
    }

    if (rawData.grandTotal !== undefined || rawData.grand_total !== undefined || rawData.total !== undefined || rawData.priceNum !== undefined) {
        const total = rawData.grandTotal !== undefined ? rawData.grandTotal : (rawData.grand_total !== undefined ? rawData.grand_total : rawData.total);
        const cleanTotal = total !== undefined ? String(total).replace('د.ج', '').trim() : '0';
        context.grand_total = cleanTotal;
        context.grandTotal = cleanTotal;
        context.total = cleanTotal;
    }

    if (rawData.location || rawData.wilaya || rawData.wilayaName) {
        const loc = rawData.location || rawData.wilaya || rawData.wilayaName;
        context.wilaya = loc;
        context.location = loc;
    }

    if (rawData.commune || rawData.city) {
        const com = rawData.commune || rawData.city;
        context.commune = com;
        context.city = com;
    }

    if (rawData.deliveryType || rawData.delivery_type) {
        const dt = rawData.deliveryType || rawData.delivery_type;
        context.delivery_type = dt;
        context.deliveryType = dt;
    }

    if (rawData.trackingNumber || rawData.tracking_number || rawData.trackingCode) {
        const trk = rawData.trackingNumber || rawData.tracking_number || rawData.trackingCode;
        context.tracking_number = trk;
        context.trackingNumber = trk;
        context.trackingCode = trk;
    }

    if (rawData.courierName || rawData.courier_name || rawData.carrier) {
        const cr = rawData.courierName || rawData.courier_name || rawData.carrier;
        context.courier_name = cr;
        context.courierName = cr;
    }

    if (rawData.errorMessage || rawData.error_message || rawData.error) {
        const err = rawData.errorMessage || rawData.error_message || rawData.error;
        context.error_message = err;
        context.errorMessage = err;
    }

    if (rawData.statusLabelAr || rawData.new_status || rawData.newStatus || rawData.normalizedStatus) {
        const st = rawData.statusLabelAr || rawData.new_status || rawData.newStatus || rawData.normalizedStatus;
        context.new_status = st;
        context.newStatus = st;
        context.statusLabelAr = st;
        context.status_label_ar = st;
        context.status_label = st;
    }

    if (rawData.receiptClassification || rawData.receipt_classification) {
        const rc = rawData.receiptClassification || rawData.receipt_classification;
        context.receipt_classification = rc;
        context.receiptClassification = rc;
    }

    if (rawData.rawStatus || rawData.raw_status) {
        const rs = rawData.rawStatus || rawData.raw_status;
        context.raw_status = rs;
        context.rawStatus = rs;
    }

    if (rawData.reason || rawData.cancellationReason || rawData.cancellation_reason) {
        const r = rawData.reason || rawData.cancellationReason || rawData.cancellation_reason;
        context.cancellation_reason = r;
        context.cancellationReason = r;
        context.reason = r;
    }

    if (rawData.restocked !== undefined) {
        context.restocked = typeof rawData.restocked === 'boolean'
            ? (rawData.restocked ? 'تم إرجاع الكمية للمخزون (+1)' : 'لم يتغير')
            : String(rawData.restocked);
    }

    // Risk badge computation for ORDER_CREATED
    if (event === 'ORDER_CREATED' && !context.risk_badge && !context.riskBadge) {
        const score = rawData.riskScore || rawData.risk_score || 0;
        const decision = rawData.riskDecision || rawData.risk_decision;
        if (decision === 'REVIEW') {
            context.risk_badge = `\n⚠️ <b>فحص يدوي (REVIEW)</b> — نقاط الخطر: ${score}/100`;
        } else if (score > 0) {
            context.risk_badge = `\n🟡 مؤشر خطر: ${score}/100`;
        } else {
            context.risk_badge = '';
        }
    }

    // Direct Dashboard URL
    if (!context.dashboard_url && !context.dashboardUrl) {
        context.dashboard_url = generateDashboardUrl(resolvedOrderId, options.baseUrl);
        context.dashboardUrl = context.dashboard_url;
    }

    return context;
}

/**
 * Render template text with provided context and options.
 *
 * @param {string} templateText
 * @param {Record<string, any>} context
 * @param {Object} [options]
 * @param {boolean} [options.isTest]
 * @param {string} [options.event]
 * @param {string} [options.baseUrl]
 * @returns {{ text: string, charCount: number, warnings: string[], truncated: boolean }}
 */
function renderTemplate(templateText, context = {}, options = {}) {
    const warnings = [];
    if (!templateText || typeof templateText !== 'string') {
        return { text: '', charCount: 0, warnings: [], truncated: false };
    }

    const event = options.event || context.event || null;
    const ctx = (context && typeof context === 'object') ? context : {};

    // 1. Resolve Dashboard URL if missing
    let dashboardUrl = hasOwn(ctx, 'dashboard_url') ? ctx.dashboard_url : (hasOwn(ctx, 'dashboardUrl') ? ctx.dashboardUrl : null);
    if (!dashboardUrl) {
        const orderId = hasOwn(ctx, 'order_id') ? ctx.order_id :
                       (hasOwn(ctx, 'orderId') ? ctx.orderId :
                       (ctx.data && typeof ctx.data === 'object' && (ctx.data.order_id || ctx.data.orderId)));
        dashboardUrl = generateDashboardUrl(orderId, options.baseUrl || ctx.dashboard_base_url);
    }

    // 2. Variable Substitution with Normalization & Escaping
    const substituted = templateText.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, rawToken) => {
        const normKey = normalizeKey(rawToken);

        // Disallow prototype / internal object keys
        if (rawToken === '__proto__' || rawToken === 'constructor' || rawToken === 'prototype' || rawToken === 'toString' || rawToken === 'valueOf') {
            return '';
        }

        // Check if event registry has definition
        let varDef = null;
        if (event && hasOwn(EVENT_REGISTRY, event)) {
            const eventConfig = hasOwn(EVENT_REGISTRY, event) ? EVENT_REGISTRY[event] : null;
            if (eventConfig && eventConfig.allowedVariables) {
                for (const key of eventConfig.allowedVariables) {
                    if (normalizeKey(key) === normKey) {
                        varDef = eventConfig.variables[key];
                        break;
                    }
                    const def = eventConfig.variables[key];
                    if (def && def.aliases) {
                        for (const alias of def.aliases) {
                            if (normalizeKey(alias) === normKey) {
                                varDef = def;
                                break;
                            }
                        }
                    }
                    if (varDef) break;
                }
            }
        }

        // Look up value in context strictly with hasOwn
        let val;
        if (normKey === 'dashboard_url' || normKey === 'dashboardurl' || normKey === 'admin_url' || normKey === 'adminlink') {
            val = dashboardUrl;
        } else if (normKey === 'customer_phone' || normKey === 'customerphone' || normKey === 'phone' || normKey === 'raw_phone' || normKey === 'rawphone') {
            let rawPhone;
            if (hasOwn(ctx, rawToken)) rawPhone = ctx[rawToken];
            else if (hasOwn(ctx, normKey)) rawPhone = ctx[normKey];
            else if (hasOwn(ctx, 'customer_phone')) rawPhone = ctx.customer_phone;
            else if (hasOwn(ctx, 'customerPhone')) rawPhone = ctx.customerPhone;
            else if (hasOwn(ctx, 'phone')) rawPhone = ctx.phone;
            else if (ctx.data && typeof ctx.data === 'object' && hasOwn(ctx.data, 'phone')) rawPhone = ctx.data.phone;

            val = rawPhone !== undefined ? String(rawPhone).trim() : undefined;
        } else if (normKey === 'masked_phone' || normKey === 'maskedphone') {
            let rawPhone;
            if (hasOwn(ctx, rawToken)) rawPhone = ctx[rawToken];
            else if (hasOwn(ctx, normKey)) rawPhone = ctx[normKey];
            else if (hasOwn(ctx, 'masked_phone')) rawPhone = ctx.masked_phone;
            else if (hasOwn(ctx, 'maskedPhone')) rawPhone = ctx.maskedPhone;
            else if (hasOwn(ctx, 'customer_phone')) rawPhone = ctx.customer_phone;
            else if (hasOwn(ctx, 'phone')) rawPhone = ctx.phone;
            else if (ctx.data && typeof ctx.data === 'object' && hasOwn(ctx.data, 'phone')) rawPhone = ctx.data.phone;

            val = rawPhone !== undefined ? maskPhone(rawPhone) : undefined;
        } else {
            // Direct context lookups
            if (hasOwn(ctx, rawToken)) {
                val = ctx[rawToken];
            } else if (hasOwn(ctx, normKey)) {
                val = ctx[normKey];
            } else if (varDef && hasOwn(ctx, varDef.key)) {
                val = ctx[varDef.key];
            } else if (ctx.data && typeof ctx.data === 'object') {
                if (hasOwn(ctx.data, rawToken)) {
                    val = ctx.data[rawToken];
                } else if (hasOwn(ctx.data, normKey)) {
                    val = ctx.data[normKey];
                } else if (varDef && hasOwn(ctx.data, varDef.key)) {
                    val = ctx.data[varDef.key];
                }
            }
        }

        // Default fallback from definition or empty string
        const fallback = varDef ? (varDef.defaultValue !== undefined ? varDef.defaultValue : '') : '';

        // If unknown variable
        if (event && hasOwn(EVENT_REGISTRY, event) && !isValidVariable(event, rawToken) && val === undefined) {
            warnings.push(`UNKNOWN_VARIABLE: ${rawToken}`);
        }

        const sanitizedVal = sanitizeVariableValue(val, fallback);
        return escapeTelegramHtml(sanitizedVal);
    });

    // 3. Whitelist sanitizer on template markup
    let sanitizedMarkup = sanitizeTelegramTemplate(substituted);

    // 4. Test Prefixing if requested
    if (options.isTest === true) {
        sanitizedMarkup = TEST_PREFIX + sanitizedMarkup;
    }

    // 5. Enforce 4,096 char limit
    const lengthResult = enforceLengthLimit(sanitizedMarkup);
    const combinedWarnings = [...warnings, ...lengthResult.warnings];

    return {
        text: lengthResult.text,
        charCount: lengthResult.charCount,
        warnings: combinedWarnings,
        truncated: lengthResult.truncated
    };
}

/**
 * Build 100% backward-compatible default messages matching Phase 8D.
 */
function buildDefaultMessage(event, orderId, data = {}) {
    const dateFormatted = new Date().toLocaleString('ar-DZ', { timeZone: 'Africa/Algiers' });
    const adminLink = generateDashboardUrl(orderId);
    const safeData = (data && typeof data === 'object') ? data : {};

    switch (event) {
        case 'ORDER_CREATED': {
            const rawPhone = String(safeData.phone || safeData.customerPhone || safeData.customer_phone || '').trim();
            const total = (safeData.grandTotal !== undefined || safeData.grand_total !== undefined)
                ? String(safeData.grandTotal !== undefined ? safeData.grandTotal : safeData.grand_total).replace('د.ج', '').trim()
                : '0';
            const shipping = (safeData.shippingFee !== undefined || safeData.shipping_fee !== undefined)
                ? String(safeData.shippingFee !== undefined ? safeData.shippingFee : safeData.shipping_fee).replace('د.ج', '').trim()
                : '500';
            const riskDecision = safeData.riskDecision || safeData.risk_decision;
            const riskScore = safeData.riskScore || safeData.risk_score || 0;
            const riskBadge = riskDecision === 'REVIEW'
                ? `\n⚠️ <b>فحص يدوي (REVIEW)</b> — نقاط الخطر: ${riskScore}/100`
                : (riskScore > 0 ? `\n🟡 مؤشر خطر: ${riskScore}/100` : '');

            return `
🔔 <b>طلب جديد — ORVA STORE</b>
━━━━━━━━━━━━━━
🆔 <b>رقم الطلب:</b> <code>#${orderId}</code>
👤 <b>اسم العميل:</b> ${safeData.fullName || safeData.customerName || safeData.customer_name || 'زبون'}
📞 <b>الهاتف:</b> <code>${rawPhone || 'غير محدد'}</code>
📍 <b>الولاية:</b> ${safeData.wilaya || safeData.location || 'الجزائر'}
🏠 <b>البلدية:</b> ${safeData.commune || safeData.city || 'الجزائر'}
━━━━━━━━━━━━━━
🛒 <b>تفاصيل المنتجات:</b>
• ${safeData.productTitle || safeData.productName || safeData.product_name || 'منتج ORVA'}
• الكمية: ${safeData.quantity || 1}
• السعر: ${total} دج
━━━━━━━━━━━━━━
💰 <b>سعر المنتجات:</b> ${total} دج
🚚 <b>التوصيل:</b> ${shipping} دج
💵 <b>الإجمالي:</b> <b>${total} دج</b>
📅 <b>تاريخ الطلب:</b> ${dateFormatted}
📌 <b>الحالة:</b> طلب جديد${riskBadge}
━━━━━━━━━━━━━━
👉 <a href="${adminLink}">لوحة التحكم (Admin Dashboard)</a>`.trim();
        }

        case 'SHIPMENT_CREATED': {
            return `
🚚 <b>تم إنشاء بوليصة الشحن بنجاح</b>
━━━━━━━━━━━━━━━━━━
<b>🆔 رقم الطلب:</b> <code>${orderId}</code>
<b>📦 شركة الشحن:</b> ${safeData.courierName || safeData.courier_name || 'Redex Delivery'}
<b>🏷️ رقم التتبع:</b> <code>${safeData.trackingNumber || safeData.tracking_number || 'غير متوفر'}</code>
<b>📋 المرجع:</b> <code>${safeData.reference || orderId}</code>
<b>📍 الوجهة:</b> ${safeData.wilaya || ''} (${safeData.commune || ''})
<b>📅 التاريخ:</b> ${dateFormatted}
━━━━━━━━━━━━━━━━━━
👉 <a href="${adminLink}">عرض تفاصيل الشحنة</a>`.trim();
        }

        case 'SHIPMENT_FAILED': {
            return `
❌ <b>فشل إنشاء الشحنة مع شركة الشحن</b>
━━━━━━━━━━━━━━━━━━
<b>🆔 رقم الطلب:</b> <code>${orderId}</code>
<b>📦 شركة الشحن:</b> ${safeData.courierName || safeData.courier_name || 'Redex Delivery'}
<b>⚠️ سبب الخطأ:</b> ${safeData.errorMessage || safeData.error_message || 'خطأ غير محدد من خادم التوصيل'}
<b>📅 التاريخ:</b> ${dateFormatted}
━━━━━━━━━━━━━━━━━━
⚠️ <i>لم يتم تعديل الطلب الداخلي أو المخزون. يرجى التدقيق يدوياً.</i>
👉 <a href="${adminLink}">لوحة التحكم</a>`.trim();
        }

        case 'STATUS_UPDATED': {
            return `
🔄 <b>تحديث حالة الشحن: ${safeData.statusLabelAr || safeData.status_label_ar || safeData.new_status || safeData.newStatus || safeData.normalizedStatus || 'تحديث'}</b>
━━━━━━━━━━━━━━━━━━
<b>🆔 رقم الطلب:</b> <code>${orderId}</code>
<b>🏷️ رقم التتبع:</b> <code>${safeData.trackingNumber || safeData.tracking_number || ''}</code>
<b>📊 الحالة الجديدة:</b> ${safeData.statusLabelAr || safeData.status_label_ar || safeData.new_status || safeData.newStatus || safeData.normalizedStatus} (${safeData.receiptClassification || safeData.receipt_classification || ''})
<b>📝 الحالة الأصلية:</b> <code>${safeData.rawStatus || safeData.raw_status || ''}</code>
<b>📅 التاريخ:</b> ${dateFormatted}
━━━━━━━━━━━━━━━━━━
👉 <a href="${adminLink}">عرض الطلب</a>`.trim();
        }

        case 'ORDER_CANCELLED': {
            return `
🚫 <b>تم إلغاء الطلب / الشحنة</b>
━━━━━━━━━━━━━━━━━━
<b>🆔 رقم الطلب:</b> <code>${orderId}</code>
<b>سبب الإلغاء:</b> ${safeData.reason || safeData.cancellationReason || safeData.cancellation_reason || 'إلغاء من لوحة التحكم أو رفض الزبون'}
<b>المخزون المسترجع:</b> ${safeData.restocked ? (typeof safeData.restocked === 'string' ? safeData.restocked : 'تم إرجاع الكمية للمخزون') : 'لم يتغير'}
<b>📅 التاريخ:</b> ${dateFormatted}
━━━━━━━━━━━━━━━━━━
👉 <a href="${adminLink}">لوحة التحكم</a>`.trim();
        }

        case 'ADMIN_ALERT': {
            return `
📢 <b>${safeData.title || 'تنبيه إداري من متجر ORVA'}</b>
━━━━━━━━━━━━━━━━━━
${safeData.body || ''}
━━━━━━━━━━━━━━━━━━
<b>👤 المرسل:</b> ${safeData.admin_name || safeData.adminName || 'مدير المتجر'}
<b>📅 التاريخ:</b> ${dateFormatted}
👉 <a href="${adminLink}">لوحة التحكم</a>`.trim();
        }

        default:
            return `
ℹ️ <b>إشعار إداري: ${event}</b>
━━━━━━━━━━━━━━━━━━
<b>🆔 رقم الطلب:</b> <code>${orderId}</code>
<b>التاريخ:</b> ${dateFormatted}
👉 <a href="${adminLink}">لوحة التحكم</a>`.trim();
    }
}

module.exports = {
    // 1. Registry & Variables
    getEventRegistry,
    isValidVariable,
    getEventVariables,

    // 2. Rendering, Substitution & Sanitization
    renderTemplate,
    escapeTelegramHtml,
    sanitizeVariableValue,
    sanitizeTelegramTemplate,
    enforceLengthLimit,
    buildTemplateContext,

    // 3. Validation
    validateTemplate,

    // 4. Sample Data, Defaults & Links
    getSampleData,
    buildDefaultMessage,
    generateDashboardUrl,
    maskPhone,

    // Constants
    MAX_TELEGRAM_MESSAGE_LENGTH,
    TRUNCATION_CEILING,
    TEST_PREFIX
};
