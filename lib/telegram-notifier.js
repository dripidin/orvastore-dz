'use strict';
// =============================================================================
// ORVA Store — Centralized Telegram Notification Dispatcher
// Handles server-side administrative alerts with idempotency deduplication.
// Adheres strictly to Phase 8D requirements:
// 1. 5 Key Events: ORDER_CREATED, SHIPMENT_CREATED, SHIPMENT_FAILED,
//    STATUS_UPDATED, ORDER_CANCELLED.
// 2. Non-blocking dispatch (never throws, never fails order flow).
// 3. Deduplication via data/telegram-dispatch-ledger.json (zero duplicate alerts).
// 4. Zero token in logs or client-facing errors.
// 5. PII protection (masked phone numbers).
// 6. Test sandbox guard (zero live messages during automated tests).
// =============================================================================

const https = require('https');
const fs = require('fs');
const path = require('path');
const { getEffectiveSettings } = require('./admin-settings-store');

const LEDGER_FILE = path.join(__dirname, '..', 'data', 'telegram-dispatch-ledger.json');
const LEDGER_LOCK_FILE = path.join(__dirname, '..', 'data', 'locks', 'telegram-ledger.lock');

/**
 * Mask customer phone number for administrative privacy.
 * E.g. '0555123456' -> '055***3456'
 */
function maskPhone(phone) {
    if (!phone) return 'غير محدد';
    const clean = String(phone).replace(/\s+/g, '');
    if (clean.length < 8) return clean;
    return clean.slice(0, 3) + '***' + clean.slice(-4);
}

/**
 * Sanitize error messages so Telegram bot token is NEVER printed.
 */
function sanitizeError(err) {
    if (!err) return '';
    const msg = typeof err === 'string' ? err : (err.message || String(err));
    return msg.replace(/\/bot[a-zA-Z0-9_:-]+/g, '/bot[REDACTED_TOKEN]');
}

/**
 * Load deduplication ledger safely.
 */
function readLedger() {
    try {
        if (!fs.existsSync(LEDGER_FILE)) return {};
        const content = fs.readFileSync(LEDGER_FILE, 'utf8');
        return JSON.parse(content) || {};
    } catch (_) {
        return {};
    }
}

/**
 * Write deduplication ledger atomically.
 */
function writeLedger(ledger) {
    try {
        fs.mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
        const tmp = `${LEDGER_FILE}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf8');
        fs.renameSync(tmp, LEDGER_FILE);
    } catch (e) {
        console.warn('[Telegram Ledger] Write warning:', sanitizeError(e));
    }
}

/**
 * Format notification message text according to event.
 */
function buildMessage(event, orderId, data = {}) {
    const dateFormatted = new Date().toLocaleString('ar-DZ', { timeZone: 'Africa/Algiers' });
    const adminLink = `https://orva-store.com/admin.html?orderId=${encodeURIComponent(orderId)}`;

    switch (event) {
        case 'ORDER_CREATED': {
            const masked = maskPhone(data.phone);
            const total = data.grandTotal ? String(data.grandTotal).replace('د.ج', '').trim() : '0';
            const riskBadge = data.riskDecision === 'REVIEW'
                ? `\n⚠️ <b>فحص يدوي (REVIEW)</b> — نقاط الخطر: ${data.riskScore || 0}/100`
                : (data.riskScore > 0 ? `\n🟡 مؤشر خطر: ${data.riskScore}/100` : '');

            return `
👑 <b>طلب جديد: ${data.productTitle || data.productName || 'منتج ORVA'} — ${total} د.ج</b>
━━━━━━━━━━━━━━━━━━
<b>🆔 رقم الطلب:</b> <code>${orderId}</code>
<b>👤 الاسم:</b> ${data.fullName || 'زبون'}
<b>📱 الهاتف:</b> <code>${masked}</code>
<b>📍 المكان:</b> ${data.location || data.wilaya || 'الجزائر'}
<b>🚚 التوصيل:</b> ${data.deliveryType || 'توصيل للمنزل'}
<b>📦 الكمية:</b> ${data.quantity || 1} قطعة
<b>💰 الإجمالي:</b> <b>${total} د.ج</b>
<b>📅 التاريخ:</b> ${dateFormatted}${riskBadge}
━━━━━━━━━━━━━━━━━━
👉 <a href="${adminLink}">لوحة التحكم (Admin Dashboard)</a>`.trim();
        }

        case 'SHIPMENT_CREATED': {
            return `
🚚 <b>تم إنشاء بوليصة الشحن بنجاح</b>
━━━━━━━━━━━━━━━━━━
<b>🆔 رقم الطلب:</b> <code>${orderId}</code>
<b>📦 شركة الشحن:</b> ${data.courierName || 'Redex Delivery'}
<b>🏷️ رقم التتبع:</b> <code>${data.trackingNumber || 'غير متوفر'}</code>
<b>📋 المرجع:</b> <code>${data.reference || orderId}</code>
<b>📍 الوجهة:</b> ${data.wilaya || ''} (${data.commune || ''})
<b>📅 التاريخ:</b> ${dateFormatted}
━━━━━━━━━━━━━━━━━━
👉 <a href="${adminLink}">عرض تفاصيل الشحنة</a>`.trim();
        }

        case 'SHIPMENT_FAILED': {
            return `
❌ <b>فشل إنشاء الشحنة مع شركة الشحن</b>
━━━━━━━━━━━━━━━━━━
<b>🆔 رقم الطلب:</b> <code>${orderId}</code>
<b>📦 شركة الشحن:</b> ${data.courierName || 'Redex Delivery'}
<b>⚠️ سبب الخطأ:</b> ${data.errorMessage || 'خطأ غير محدد من خادم التوصيل'}
<b>📅 التاريخ:</b> ${dateFormatted}
━━━━━━━━━━━━━━━━━━
⚠️ <i>لم يتم تعديل الطلب الداخلي أو المخزون. يرجى التدقيق يدوياً.</i>
👉 <a href="${adminLink}">لوحة التحكم</a>`.trim();
        }

        case 'STATUS_UPDATED': {
            return `
🔄 <b>تحديث حالة الشحن: ${data.statusLabelAr || data.normalizedStatus || 'تحديث'}</b>
━━━━━━━━━━━━━━━━━━
<b>🆔 رقم الطلب:</b> <code>${orderId}</code>
<b>🏷️ رقم التتبع:</b> <code>${data.trackingNumber || ''}</code>
<b>📊 الحالة الجديدة:</b> ${data.statusLabelAr || data.normalizedStatus} (${data.receiptClassification || ''})
<b>📝 الحالة الأصلية:</b> <code>${data.rawStatus || ''}</code>
<b>📅 التاريخ:</b> ${dateFormatted}
━━━━━━━━━━━━━━━━━━
👉 <a href="${adminLink}">عرض الطلب</a>`.trim();
        }

        case 'ORDER_CANCELLED': {
            return `
🚫 <b>تم إلغاء الطلب / الشحنة</b>
━━━━━━━━━━━━━━━━━━
<b>🆔 رقم الطلب:</b> <code>${orderId}</code>
<b>سبب الإلغاء:</b> ${data.reason || 'إلغاء من لوحة التحكم أو رفض الزبون'}
<b>المخزون المسترجع:</b> ${data.restocked ? 'تم إرجاع الكمية للمخزون' : 'لم يتغير'}
<b>📅 التاريخ:</b> ${dateFormatted}
━━━━━━━━━━━━━━━━━━
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

/**
 * Perform low-level HTTP dispatch to Telegram Bot API.
 */
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
            reject(new Error(sanitizeError(err)));
        });

        req.write(payload);
        req.end();
    });
}

/**
 * Main Entry Point: Dispatch Telegram Notification.
 *
 * @param {Object} params
 * @param {'ORDER_CREATED'|'SHIPMENT_CREATED'|'SHIPMENT_FAILED'|'STATUS_UPDATED'|'ORDER_CANCELLED'} params.event
 * @param {string} params.orderId
 * @param {Object} [params.data]
 * @param {Object} [params.credentials]  - Optional override for testing
 * @returns {Promise<{success: boolean, deduplicated?: boolean, skipped?: boolean, simulated?: boolean, error?: string}>}
 */
async function dispatchTelegramNotification({ event, orderId, data = {}, credentials = {} }) {
    if (!event || !orderId) {
        return { success: false, error: 'MISSING_EVENT_OR_ORDER_ID' };
    }

    // Resolve credentials (settings store -> env -> credentials arg)
    let botToken = credentials.botToken !== undefined ? credentials.botToken : null;
    let chatId = credentials.chatId !== undefined ? credentials.chatId : null;

    let tgEnabled = true;
    if (botToken === null || chatId === null) {
        try {
            const settings = getEffectiveSettings().telegram;
            tgEnabled = settings.enabled !== false;
            if (botToken === null) botToken = settings.botToken;
            if (chatId === null) chatId = settings.chatId;
        } catch (_) {
            if (botToken === null) botToken = process.env.TELEGRAM_BOT_TOKEN;
            if (chatId === null) chatId = process.env.TELEGRAM_CHAT_ID;
        }
    }

    if (!tgEnabled && !credentials.mock && !credentials.force) {
        return { success: true, skipped: true, reason: 'TELEGRAM_DISABLED' };
    }

    if (!botToken || !chatId) {
        return { success: false, skipped: true, reason: 'NO_CONFIG' };
    }

    // Deduplication check via ledger
    const trackingCode = data.trackingNumber || data.trackingCode || '';
    const ledgerKey = `${event}_${orderId}_${trackingCode || 'none'}`;
    const ledger = readLedger();

    if (ledger[ledgerKey] && (ledger[ledgerKey].status === 'DISPATCHED' || ledger[ledgerKey].status === 'SIMULATED')) {
        return {
            success: true,
            deduplicated: true,
            dispatchedAt: ledger[ledgerKey].timestamp,
            key: ledgerKey
        };
    }

    const messageText = buildMessage(event, orderId, data);

    // Sandbox / Test guard: Never send live messages during automated tests or when MOCK_TELEGRAM is set
    const isTest = process.env.NODE_ENV === 'test' ||
                   process.env.MOCK_TELEGRAM === 'true' ||
                   Boolean(credentials.mock);

    if (isTest) {
        // Record in ledger as simulated
        ledger[ledgerKey] = {
            event,
            orderId,
            trackingCode,
            status: 'SIMULATED',
            timestamp: new Date().toISOString()
        };
        writeLedger(ledger);
        return { success: true, simulated: true, event, orderId, ledgerKey };
    }

    // Live dispatch
    try {
        await sendTelegramHttpRequest(botToken, chatId, messageText);
        ledger[ledgerKey] = {
            event,
            orderId,
            trackingCode,
            status: 'DISPATCHED',
            timestamp: new Date().toISOString()
        };
        writeLedger(ledger);
        return { success: true, event, orderId, ledgerKey };
    } catch (err) {
        const sanitized = sanitizeError(err);
        console.warn(`[Telegram Notifier Warning] Event ${event} for Order ${orderId} failed: ${sanitized}`);
        return { success: false, error: sanitized };
    }
}

/**
 * Clear test ledger (used in test suite reset).
 */
function resetTestLedger() {
    try {
        if (fs.existsSync(LEDGER_FILE)) {
            fs.unlinkSync(LEDGER_FILE);
        }
    } catch (_) {}
}

module.exports = {
    dispatchTelegramNotification,
    buildMessage,
    maskPhone,
    sanitizeError,
    readLedger,
    resetTestLedger
};
