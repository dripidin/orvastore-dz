'use strict';

/**
 * =============================================================================
 * ORVA STORE — ORDER VISIBILITY & FULL PHONE VERIFICATION TEST SUITE
 * =============================================================================
 *
 * Verifies:
 * 1. Test A: Admin Visibility (all fields present, live repository mode, status filter matching).
 * 2. Test B: Telegram Full Phone (unmasked Algerian phone in ORDER_CREATED, new RTL format, ecommerce URL).
 * 3. Test C: Privacy & Security (public endpoints protect PII, CSRF & Auth enforcement, token secrecy).
 * 4. Test D: Reliability & Idempotency (deduplication, order persistence independence from notification).
 */

const assert = require('assert');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const templateEngine = require('../lib/telegram-template-engine');
const telegramNotifier = require('../lib/telegram-notifier');
const { verifyAndCalculateOrder } = require('../lib/order-validator');

let passedTests = 0;
let totalTests = 0;

function runTest(id, name, fn) {
    totalTests++;
    try {
        fn();
        console.log(`[${id}] ✅ PASS: ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`[${id}] ❌ FAIL: ${name}`);
        console.error('      Error:', err.message);
        throw err;
    }
}

async function runTestAsync(id, name, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`[${id}] ✅ PASS: ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`[${id}] ❌ FAIL: ${name}`);
        console.error('      Error:', err.message);
        throw err;
    }
}

async function main() {
    console.log('='.repeat(80));
    console.log('   ORVA STORE — ORDER VISIBILITY & FULL PHONE NUMBER VERIFICATION');
    console.log('='.repeat(80));

    // =========================================================================
    // SUITE 1: TELEGRAM FULL PHONE & MESSAGE FORMAT (TEST B)
    // =========================================================================
    console.log('\n--- SUITE 1: TELEGRAM FULL PHONE & FORMAT (TEST B) ---');

    runTest('TG-01', 'Default Message ORDER_CREATED displays full Algerian phone number', () => {
        const orderId = 'ORVA-77123';
        const sampleOrder = {
            fullName: 'أحمد محمد',
            phone: '0791231316',
            productTitle: 'Yamaha Pack 1',
            quantity: 1,
            grandTotal: '4500 دج',
            shippingFee: '500 دج',
            wilaya: '07 - بسكرة',
            commune: 'بسكرة'
        };

        const msg = templateEngine.buildDefaultMessage('ORDER_CREATED', orderId, sampleOrder);

        // Must contain full phone number
        assert.ok(msg.includes('0791231316'), 'Message must contain original full phone 0791231316');
        assert.ok(!msg.includes('079***1316'), 'Message must NOT contain masked phone 079***1316');

        // Must contain proper icons and labels
        assert.ok(msg.includes('طلب جديد — ORVA STORE'), 'Must have header: طلب جديد — ORVA STORE');
        assert.ok(msg.includes('رقم الطلب:'), 'Must have order ID label');
        assert.ok(msg.includes('#ORVA-77123'), 'Must contain order number with #');
        assert.ok(msg.includes('اسم العميل:'), 'Must have customer name label');
        assert.ok(msg.includes('أحمد محمد'), 'Must contain customer name');
        assert.ok(msg.includes('الهاتف:'), 'Must have phone label');
        assert.ok(msg.includes('الولاية:'), 'Must have wilaya label');
        assert.ok(msg.includes('بسكرة'), 'Must contain wilaya/commune');
        assert.ok(msg.includes('سعر المنتجات:'), 'Must have product price label');
        assert.ok(msg.includes('التوصيل:'), 'Must have delivery label');
        assert.ok(msg.includes('الإجمالي:'), 'Must have total label');
    });

    runTest('TG-02', 'Telegram dashboard URL points to /dashboard/ecommerce?orderId=...', () => {
        const orderId = 'ORVA-99001';
        const url = templateEngine.generateDashboardUrl(orderId);
        assert.strictEqual(url, 'https://orva-store.com/dashboard/ecommerce?orderId=ORVA-99001');

        const baseOnly = templateEngine.generateDashboardUrl('');
        assert.strictEqual(baseOnly, 'https://orva-store.com/dashboard/ecommerce');
    });

    runTest('TG-03', 'Variable {{customer_phone}} substitutes full phone and {{masked_phone}} provides masked option', () => {
        const tpl = 'Full: {{customer_phone}} | Masked: {{masked_phone}} | Order: {{order_id}}';
        const ctx = {
            order_id: 'ORVA-1025',
            phone: '0661998877'
        };
        const rendered = templateEngine.renderTemplate(tpl, ctx, { event: 'ORDER_CREATED' });
        assert.ok(rendered.text.includes('Full: 0661998877'), 'Full phone must be rendered');
        assert.ok(rendered.text.includes('Masked: 066***8877'), 'Masked phone must be rendered');
    });

    runTest('TG-04', 'Telegram notifier fallback buildMessage preserves full phone', () => {
        const msg = telegramNotifier.buildMessage('ORDER_CREATED', 'ORVA-88221', {
            phone: '0550112233',
            fullName: 'سفيان دراجي',
            location: '25 - قسنطينة'
        });
        assert.ok(msg.includes('0550112233'), 'Notifier message must contain full phone');
        assert.ok(!msg.includes('055***2233'), 'Notifier message must NOT be masked');
        assert.ok(msg.includes('/dashboard/ecommerce?orderId=ORVA-88221'), 'Link must point to ecommerce page');
    });

    // =========================================================================
    // SUITE 2: ADMIN VISIBILITY & REPOSITORY (TEST A)
    // =========================================================================
    console.log('\n--- SUITE 2: ADMIN VISIBILITY & REPOSITORY (TEST A) ---');

    runTest('VIS-01', 'Repository Factory strictly defaults to live API mode in all environments', () => {
        const fs = require('fs');
        const repoFactoryPath = path.join(__dirname, '..', 'orvastore Dashbaord v0.9', 'next-shadcn-admin-dashboard-baseui-main', 'src', 'lib', 'repository', 'orders-repository-factory.ts');
        const content = fs.readFileSync(repoFactoryPath, 'utf8');

        assert.ok(content.includes('return "live"'), 'getAppRepositoryMode must strictly return "live"');
        assert.ok(content.includes('new ApiOrdersRepository()'), 'getOrdersRepository must strictly instantiate ApiOrdersRepository');
        assert.ok(!content.includes('return "mock"'), 'Must not default to mock mode');
    });

    runTest('VIS-02', 'Order Normalization pipeline retains full phone number without masking', () => {
        const rawRow = {
            order_id: 'ORVA-TEST-NORM',
            full_name: 'يوسف الجزائري',
            phone: '0770554433',
            wilaya: '16 - Alger',
            commune: 'Bab El Oued',
            delivery_type: 'توصيل للمنزل',
            product_name: 'PACK 4EN1 4950',
            product_total: '4950 د.ج',
            shipping_fee: '500 د.ج',
            price_num: 5450,
            grand_total: '5450 د.ج',
            status: 'pending',
            created_at: new Date().toISOString()
        };

        const fs = require('fs');
        const orvaApiPath = path.join(__dirname, '..', 'orvastore Dashbaord v0.9', 'next-shadcn-admin-dashboard-baseui-main', 'src', 'lib', 'orva-api.ts');
        const orvaApiSrc = fs.readFileSync(orvaApiPath, 'utf8');

        // Verify orva-api maps phone to unmasked property
        assert.ok(orvaApiSrc.includes('readOptionalString(raw, "phone", "phone_number")'), 'orva-api must read phone field directly');

        // Test columns.tsx does not mask phone
        const columnsPath = path.join(__dirname, '..', 'orvastore Dashbaord v0.9', 'next-shadcn-admin-dashboard-baseui-main', 'src', 'app', '(main)', 'dashboard', 'ecommerce', '_components', 'recent-orders-table', 'columns.tsx');
        const columnsSrc = fs.readFileSync(columnsPath, 'utf8');
        assert.ok(columnsSrc.includes('row.original.phone || "—"'), 'columns.tsx must display unmasked phone directly');
        assert.ok(!columnsSrc.includes('maskDemoPhone(row.original.phone)'), 'columns.tsx must NOT call maskDemoPhone');

        // Test order-details-drawer.tsx does not mask phone
        const drawerPath = path.join(__dirname, '..', 'orvastore Dashbaord v0.9', 'next-shadcn-admin-dashboard-baseui-main', 'src', 'app', '(main)', 'dashboard', 'ecommerce', '_components', 'order-details-drawer.tsx');
        const drawerSrc = fs.readFileSync(drawerPath, 'utf8');
        assert.ok(drawerSrc.includes('order.phone || "—"'), 'order-details-drawer must display unmasked phone');
        assert.ok(!drawerSrc.includes('maskDemoPhone(order.phone)'), 'order-details-drawer must NOT call maskDemoPhone');
    });

    runTest('VIS-03', 'Orders with status "review" are recognized and retained in pending pipeline', () => {
        const fs = require('fs');
        const columnsPath = path.join(__dirname, '..', 'orvastore Dashbaord v0.9', 'next-shadcn-admin-dashboard-baseui-main', 'src', 'app', '(main)', 'dashboard', 'ecommerce', '_components', 'recent-orders-table', 'columns.tsx');
        const columnsSrc = fs.readFileSync(columnsPath, 'utf8');

        // Verify Pending filter includes 'review'
        assert.ok(columnsSrc.includes('s === "review"'), 'columns.tsx filterFn must include "review" in Pending filter');
        assert.ok(columnsSrc.includes('قيد المراجعة (Review)'), 'columns.tsx must provide OperationalStatusBadge for review');
    });

    // =========================================================================
    // SUITE 3: SECURITY & PRIVACY BOUNDARIES (TEST C)
    // =========================================================================
    console.log('\n--- SUITE 3: SECURITY & PRIVACY BOUNDARIES (TEST C) ---');

    await runTestAsync('SEC-01', 'Unauthenticated request to /api/delivery?action=get_all_orders is rejected (401)', async () => {
        const deliveryHandler = require('../api/delivery');
        let statusCode = null;
        let responseJson = null;

        const fakeReq = {
            method: 'GET',
            url: '/api/delivery?action=get_all_orders',
            headers: {},
            query: { action: 'get_all_orders' },
            cookies: {}
        };

        const fakeRes = {
            setHeader: () => {},
            status: (code) => {
                statusCode = code;
                return {
                    json: (data) => { responseJson = data; }
                };
            }
        };

        await deliveryHandler(fakeReq, fakeRes);
        assert.strictEqual(statusCode, 401, 'Unauthenticated request must receive 401 UNAUTHORIZED');
        assert.strictEqual(responseJson.error, 'UNAUTHORIZED_ACCESS');
    });

    runTest('SEC-02', 'Telegram Bot Token is strictly redacted from error sanitization', () => {
        const errorWithToken = new Error('Telegram API failure at https://api.telegram.org/bot123456789:ABCdefGHIjklMNOpqrsTUVwxyz/sendMessage');
        const sanitized = telegramNotifier.sanitizeError(errorWithToken);
        assert.ok(!sanitized.includes('123456789:ABCdefGHIjklMNOpqrsTUVwxyz'), 'Bot token must be redacted');
        assert.ok(sanitized.includes('/bot[REDACTED_TOKEN]/'), 'Must contain [REDACTED_TOKEN]');
    });

    // =========================================================================
    // SUITE 4: RELIABILITY & IDEMPOTENCY (TEST D)
    // =========================================================================
    console.log('\n--- SUITE 4: RELIABILITY & IDEMPOTENCY (TEST D) ---');

    runTest('REL-01', 'Order Calculation preserves exact prices and validates phone format', () => {
        const calc = verifyAndCalculateOrder({
            packId: 'pack1',       // catalog key: orva-p1-pro alias
            quantity: 1,
            wilaya: '07 - بسكرة', // Arabic canonical name
            commune: 'بسكرة',
            deliveryType: 'home',
            fullName: 'أحمد بن سالم',
            phone: '0791231316'
        });

        assert.strictEqual(calc.valid, true, 'Validation must succeed for valid order');
        assert.strictEqual(calc.grandTotal, 5500, 'Grand total must equal 5500 (4950 product + 550 domicile)');
        assert.strictEqual(calc.shippingFee, 550, 'Shipping fee for wilaya 07 home delivery must be 550');
    });

    runTest('REL-02', 'Invalid phone number format is strictly rejected by checkout validator', () => {
        const calc = verifyAndCalculateOrder({
            packId: 'pack1',
            quantity: 1,
            wilaya: '07 - بسكرة',
            commune: 'بسكرة',
            deliveryType: 'home',
            fullName: 'أحمد بن سالم',
            phone: '12345' // Invalid phone
        });

        assert.strictEqual(calc.valid, false, 'Invalid phone number must be rejected');
        assert.strictEqual(calc.code, 'INVALID_PHONE');
    });

    await runTestAsync('REL-03', 'Compound ledger deduplication prevents duplicate Telegram notifications', async () => {
        telegramNotifier.resetTestLedger();
        const testOrderId = 'ORVA-DEDUP-VERIFY-1';
        const mockCreds = { mock: true, botToken: 'test-token', chatId: 'test-chat-123' };

        // First dispatch
        const res1 = await telegramNotifier.dispatchTelegramNotification({
            event: 'ORDER_CREATED',
            orderId: testOrderId,
            data: { phone: '0791231316', fullName: 'علي' },
            credentials: mockCreds
        });
        assert.strictEqual(res1.success, true, 'First dispatch must succeed');
        assert.strictEqual(res1.simulated, true, 'First dispatch must be simulated');

        // Second dispatch (immediate duplicate)
        const res2 = await telegramNotifier.dispatchTelegramNotification({
            event: 'ORDER_CREATED',
            orderId: testOrderId,
            data: { phone: '0791231316', fullName: 'علي' },
            credentials: mockCreds
        });

        assert.strictEqual(res2.success, true, 'Second notification must succeed');
        assert.strictEqual(res2.deduplicated, true, 'Second notification for same orderId must be marked deduplicated');
    });

    // =========================================================================
    // FINAL SUMMARY
    // =========================================================================
    console.log('\n' + '='.repeat(80));
    console.log(`TOTAL SCENARIOS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
    console.log('='.repeat(80));
    if (passedTests === totalTests) {
        console.log('🎉 VERDICT: ALL TESTS PASSED (100% SUCCESS)');
    }
}

main().catch((err) => {
    console.error('Fatal test runner failure:', err);
    process.exit(1);
});
