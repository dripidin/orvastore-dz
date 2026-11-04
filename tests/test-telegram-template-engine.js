'use strict';
// =============================================================================
// ORVA STORE — TELEGRAM TEMPLATE ENGINE & VARIABLE REGISTRY UNIT TESTS
// Covers all 38 test scenarios across the 8 categories specified in Milestone 1.
// Execution: node tests/test-telegram-template-engine.js
// =============================================================================

const assert = require('assert');
const path = require('path');
const engine = require('../lib/telegram-template-engine');
const notifier = require('../lib/telegram-notifier');

let passedTests = 0;
let totalTests = 0;

function runTest(tcId, name, fn) {
    totalTests++;
    try {
        fn();
        passedTests++;
        console.log(`[${tcId}] ✅ PASS: ${name}`);
    } catch (err) {
        console.error(`[${tcId}] ❌ FAIL: ${name}`);
        console.error(`       Error: ${err.message}`);
        throw err;
    }
}

async function runTestAsync(tcId, name, fn) {
    totalTests++;
    try {
        await fn();
        passedTests++;
        console.log(`[${tcId}] ✅ PASS: ${name}`);
    } catch (err) {
        console.error(`[${tcId}] ❌ FAIL: ${name}`);
        console.error(`       Error: ${err.message}`);
        throw err;
    }
}

async function main() {
    console.log('================================================================================');
    console.log('   ORVA STORE — TELEGRAM TEMPLATE ENGINE & VARIABLE REGISTRY UNIT TESTS');
    console.log('================================================================================\n');

    // =============================================================================
    // SUITE 1: REGISTRY COVERAGE & METADATA (TC01 - TC05)
    // =============================================================================
    console.log('--- SUITE 1: REGISTRY COVERAGE & METADATA ---');

    runTest('TC01', 'getEventRegistry() returns all 5 operational events + ADMIN_ALERT', () => {
        const reg = engine.getEventRegistry();
        const requiredEvents = ['ORDER_CREATED', 'SHIPMENT_CREATED', 'SHIPMENT_FAILED', 'STATUS_UPDATED', 'ORDER_CANCELLED', 'ADMIN_ALERT'];
        for (const evt of requiredEvents) {
            assert.ok(reg[evt], `Missing required event in registry: ${evt}`);
        }
    });

    runTest('TC02', 'Registry Metadata: Every registered event has complete valid schema', () => {
        const reg = engine.getEventRegistry();
        for (const [evt, config] of Object.entries(reg)) {
            assert.strictEqual(typeof config.labelAr, 'string', `${evt} labelAr must be string`);
            assert.ok(config.labelAr.length > 0, `${evt} labelAr cannot be empty`);
            assert.strictEqual(typeof config.description, 'string', `${evt} description must be string`);
            assert.ok(Array.isArray(config.allowedVariables), `${evt} allowedVariables must be array`);
            assert.ok(config.allowedVariables.length > 0, `${evt} allowedVariables cannot be empty`);
            assert.strictEqual(typeof config.defaultTemplate, 'string', `${evt} defaultTemplate must be string`);
            assert.ok(config.defaultTemplate.includes('<b>'), `${evt} defaultTemplate must contain Telegram HTML formatting`);
        }
    });

    runTest('TC03', 'Variable Metadata: getEventVariables(event) returns array of variable descriptor objects', () => {
        const vars = engine.getEventVariables('ORDER_CREATED');
        assert.ok(Array.isArray(vars), 'Result must be an array');
        assert.ok(vars.length >= 10, 'ORDER_CREATED must have at least 10 variables');
        for (const v of vars) {
            assert.ok(v.key, 'Variable descriptor must have key');
            assert.ok(v.labelAr, `Variable ${v.key} must have labelAr`);
            assert.ok(v.sampleValue !== undefined, `Variable ${v.key} must have sampleValue`);
        }
    });

    runTest('TC04', 'Variable Validation: isValidVariable(event, varName) strictly validates scope', () => {
        assert.strictEqual(engine.isValidVariable('ORDER_CREATED', 'order_id'), true);
        assert.strictEqual(engine.isValidVariable('ORDER_CREATED', 'orderId'), true);
        assert.strictEqual(engine.isValidVariable('ORDER_CREATED', 'customer_name'), true);
        assert.strictEqual(engine.isValidVariable('ORDER_CREATED', 'dashboard_url'), true);
        assert.strictEqual(engine.isValidVariable('ORDER_CREATED', 'unknown_xyz'), false);
        assert.strictEqual(engine.isValidVariable('ORDER_CREATED', 'tracking_number'), false);
        assert.strictEqual(engine.isValidVariable('INVALID_EVENT', 'order_id'), false);
    });

    runTest('TC05', 'Sample Data Generator: getSampleData(event) supplies synthetic values for all event variables', () => {
        const events = ['ORDER_CREATED', 'SHIPMENT_CREATED', 'SHIPMENT_FAILED', 'STATUS_UPDATED', 'ORDER_CANCELLED', 'ADMIN_ALERT'];
        for (const evt of events) {
            const sample = engine.getSampleData(evt);
            assert.ok(sample && typeof sample === 'object', `Sample data for ${evt} must be an object`);
            const vars = engine.getEventVariables(evt);
            for (const v of vars) {
                const val = sample[v.key];
                assert.ok(val !== undefined, `Sample data missing variable ${v.key} for event ${evt}`);
                assert.ok(typeof val === 'string' || typeof val === 'number', `Sample value for ${v.key} in ${evt} must be string or number`);
                assert.ok(String(val).length > 0, `Sample value for ${v.key} in ${evt} must not be empty`);
            }
        }
    });

    // =============================================================================
    // SUITE 2: VARIABLE SYNTAX & NORMALIZATION (TC06 - TC12)
    // =============================================================================
    console.log('\n--- SUITE 2: VARIABLE SYNTAX & NORMALIZATION ---');

    runTest('TC06', 'Standard Variable Syntax: {{order_id}} replaces with exact value', () => {
        const tpl = 'Order ID: {{order_id}}';
        const rendered = engine.renderTemplate(tpl, { order_id: 'ORVA-83599' });
        assert.strictEqual(rendered.text, 'Order ID: ORVA-83599');
    });

    runTest('TC07', 'Whitespace Tolerance: {{ order_id }}, {{  order_id  }} resolve correctly', () => {
        const tpl = 'Order: {{ order_id }} | Ref: {{  order_id  }}';
        const rendered = engine.renderTemplate(tpl, { order_id: 'ORVA-100' });
        assert.strictEqual(rendered.text, 'Order: ORVA-100 | Ref: ORVA-100');
    });

    runTest('TC08', 'Case-Insensitive Matching: {{ORDER_ID}}, {{Order_Id}} resolve correctly', () => {
        const tpl = '{{ORDER_ID}} - {{Order_Id}}';
        const rendered = engine.renderTemplate(tpl, { order_id: 'ORVA-200' });
        assert.strictEqual(rendered.text, 'ORVA-200 - ORVA-200');
    });

    runTest('TC09', 'Multiple Identical Variables: repeated occurrences in template are all substituted', () => {
        const tpl = '{{order_id}} -> {{order_id}} -> {{order_id}}';
        const rendered = engine.renderTemplate(tpl, { order_id: 'ORVA-TRIO' });
        assert.strictEqual(rendered.text, 'ORVA-TRIO -> ORVA-TRIO -> ORVA-TRIO');
    });

    runTest('TC10', 'Multiple Distinct Variables: multiple distinct variables in one template are substituted', () => {
        const tpl = '{{order_id}} - {{customer_name}} - {{grand_total}} د.ج';
        const rendered = engine.renderTemplate(tpl, {
            order_id: 'ORVA-55',
            customer_name: 'أحمد',
            grand_total: '5,000'
        });
        assert.strictEqual(rendered.text, 'ORVA-55 - أحمد - 5,000 د.ج');
    });

    runTest('TC11', 'CamelCase / SnakeCase: {{customerName}} and {{customer_name}} resolve identically', () => {
        const tpl1 = '{{customerName}}';
        const tpl2 = '{{customer_name}}';
        const ctx = { customer_name: 'كريم البشير' };
        assert.strictEqual(engine.renderTemplate(tpl1, ctx).text, 'كريم البشير');
        assert.strictEqual(engine.renderTemplate(tpl2, ctx).text, 'كريم البشير');
    });

    runTest('TC12', 'Direct Dashboard URL: {{dashboard_url}} generates valid admin order link', () => {
        const tpl = 'Link: {{dashboard_url}}';
        const rendered = engine.renderTemplate(tpl, { order_id: 'ORVA-83599' });
        assert.ok(rendered.text.includes('https://orva-store.com/dashboard/ecommerce?orderId=ORVA-83599'));
    });

    // =============================================================================
    // SUITE 3: NULL / UNDEFINED SAFETY & DEFAULTS (TC13 - TC18)
    // =============================================================================
    console.log('\n--- SUITE 3: NULL / UNDEFINED SAFETY & DEFAULTS ---');

    runTest('TC13', 'Undefined Field Fallback: missing optional field in context falls back cleanly', () => {
        const tpl = 'Order: {{order_id}} | Commune: {{commune}}';
        const rendered = engine.renderTemplate(tpl, { order_id: 'ORVA-99' }, { event: 'ORDER_CREATED' });
        assert.ok(!rendered.text.includes('undefined'), 'Rendered text must not contain "undefined"');
        assert.ok(!rendered.text.includes('null'), 'Rendered text must not contain "null"');
    });

    runTest('TC14', 'Null Field Fallback: field explicitly set to null falls back cleanly', () => {
        const tpl = 'Total: {{grand_total}} | City: {{commune}}';
        const rendered = engine.renderTemplate(tpl, { grand_total: null, commune: null }, { event: 'ORDER_CREATED' });
        assert.ok(!rendered.text.includes('null'));
        assert.ok(!rendered.text.includes('undefined'));
    });

    runTest('TC15', 'Default Customer Name: missing customer name in ORDER_CREATED renders fallback', () => {
        const tpl = '👤 {{customer_name}}';
        const rendered = engine.renderTemplate(tpl, {}, { event: 'ORDER_CREATED' });
        assert.strictEqual(rendered.text, '👤 زبون');
    });

    runTest('TC16', 'Default Product Title: missing product title in ORDER_CREATED renders fallback', () => {
        const tpl = '📦 {{product_name}}';
        const rendered = engine.renderTemplate(tpl, {}, { event: 'ORDER_CREATED' });
        assert.strictEqual(rendered.text, '📦 منتج ORVA');
    });

    runTest('TC17', 'Universal Null-Safety Sweep: render every event template with completely empty context ({})', () => {
        const reg = engine.getEventRegistry();
        for (const [evt, config] of Object.entries(reg)) {
            const rendered = engine.renderTemplate(config.defaultTemplate, {}, { event: evt });
            assert.ok(!/undefined/i.test(rendered.text), `${evt} rendered with {} contains "undefined"`);
            assert.ok(!/null/i.test(rendered.text), `${evt} rendered with {} contains "null"`);
            assert.ok(!/\[object Object\]/i.test(rendered.text), `${evt} rendered with {} contains "[object Object]"`);
            assert.ok(!/NaN/i.test(rendered.text), `${evt} rendered with {} contains "NaN"`);
        }
    });

    runTest('TC18', 'Unknown Variable Warning: template containing unsupported variable emits warning without crashing', () => {
        const tpl = 'Order {{order_id}} with promo {{promo_code}}';
        const rendered = engine.renderTemplate(tpl, { order_id: 'ORVA-1' }, { event: 'ORDER_CREATED' });
        assert.ok(rendered.warnings.some(w => w.includes('UNKNOWN_VARIABLE: promo_code')));
        assert.ok(!rendered.text.includes('promo_code'));
    });

    // =============================================================================
    // SUITE 4: HTML ESCAPING, WHITELIST & XSS PROTECTION (TC19 - TC25)
    // =============================================================================
    console.log('\n--- SUITE 4: HTML ESCAPING, WHITELIST & XSS PROTECTION ---');

    runTest('TC19', 'HTML Entity Escaping: & is escaped to &amp;', () => {
        const escaped = engine.escapeTelegramHtml('Pack 2 & 1 Pro');
        assert.strictEqual(escaped, 'Pack 2 &amp; 1 Pro');
    });

    runTest('TC20', 'HTML Entity Escaping: < and > are escaped to &lt; and &gt;', () => {
        const escaped = engine.escapeTelegramHtml('<Alert> "Quotes" & More');
        assert.strictEqual(escaped, '&lt;Alert&gt; &quot;Quotes&quot; &amp; More');
    });

    runTest('TC21', 'XSS / Script Injection: malicious input is neutralized in variable substitution', () => {
        const tpl = 'Customer: {{customer_name}}';
        const rendered = engine.renderTemplate(tpl, { customer_name: 'Samir <script>alert(1)</script>' });
        assert.ok(!rendered.text.includes('<script>'));
        assert.ok(rendered.text.includes('Samir &lt;script&gt;alert(1)&lt;/script&gt;'));
    });

    runTest('TC22', 'Allowed HTML Preservation: whitelisted Telegram HTML tags in template remain intact', () => {
        const tpl = '<b>Title:</b> <code>{{order_id}}</code> — <i>{{product_name}}</i> <a href="https://example.com">Link</a>';
        const rendered = engine.renderTemplate(tpl, { order_id: 'ORVA-88', product_name: 'Pack 1' });
        assert.ok(rendered.text.includes('<b>Title:</b>'));
        assert.ok(rendered.text.includes('<code>ORVA-88</code>'));
        assert.ok(rendered.text.includes('<i>Pack 1</i>'));
        assert.ok(rendered.text.includes('<a href="https://example.com">Link</a>'));
    });

    runTest('TC23', 'Disallowed Tag Stripping: disallowed tags (<div>, <iframe>, <img>, <button>) stripped', () => {
        const tpl = '<div>Content</div><iframe>frame</iframe><button>Click</button><b>Valid</b>';
        const rendered = engine.renderTemplate(tpl, {});
        assert.ok(!rendered.text.includes('<div>'));
        assert.ok(!rendered.text.includes('</div>'));
        assert.ok(!rendered.text.includes('<iframe>'));
        assert.ok(!rendered.text.includes('<button>'));
        assert.ok(rendered.text.includes('<b>Valid</b>'));
    });

    runTest('TC24', 'Malicious Link Protocol: <a href="javascript:alert(1)"> is sanitized and stripped', () => {
        const tpl = '<a href="javascript:alert(1)">Click Me</a>';
        const rendered = engine.renderTemplate(tpl, {});
        assert.ok(!rendered.text.includes('href="javascript:'));
        assert.ok(!rendered.text.includes('javascript:'));
    });

    runTest('TC25', 'Customer Full Phone: dynamic phone variable renders unmasked original number', () => {
        const tpl = 'Phone: {{customer_phone}}';
        const rendered = engine.renderTemplate(tpl, { phone: '0555123456' });
        assert.strictEqual(rendered.text, 'Phone: 0555123456');

        const maskedTpl = 'Masked: {{masked_phone}}';
        const maskedRendered = engine.renderTemplate(maskedTpl, { phone: '0555123456' });
        assert.strictEqual(maskedRendered.text, 'Masked: 055***3456');
    });

    // =============================================================================
    // SUITE 5: ARABIC RTL, NUMERALS & EMOJIS (TC26 - TC29)
    // =============================================================================
    console.log('\n--- SUITE 5: ARABIC RTL, NUMERALS & EMOJIS ---');

    runTest('TC26', 'Arabic RTL Preservation: Arabic text renders without Unicode corruption', () => {
        const arabicText = 'طلب جديد: حقيبة يد نسائية فاخرة — التوصيل متوفر لجميع الولايات';
        const rendered = engine.renderTemplate(arabicText, {});
        assert.strictEqual(rendered.text, arabicText);
    });

    runTest('TC27', 'Bidirectional Text (Bidi): mixed Arabic, Latin IDs, and French courier names render cleanly', () => {
        const tpl = '<b>🆔 رقم الطلب:</b> <code>{{order_id}}</code> — شركة الشحن: {{courier_name}}';
        const rendered = engine.renderTemplate(tpl, { order_id: 'ORVA-94821', courier_name: 'Redex Delivery DZ' });
        assert.ok(rendered.text.includes('ORVA-94821'));
        assert.ok(rendered.text.includes('Redex Delivery DZ'));
    });

    runTest('TC28', 'Telegram Emoji & Box Glyphs: emojis and line characters preserved', () => {
        const tpl = '👑 <b>طلب جديد</b>\n━━━━━━━━━━━━━━━━━━\n📦 🚚 ❌ 🔄 🚫';
        const rendered = engine.renderTemplate(tpl, {});
        assert.ok(rendered.text.includes('👑'));
        assert.ok(rendered.text.includes('━━━━━━━━━━━━━━━━━━'));
        assert.ok(rendered.text.includes('📦 🚚 ❌ 🔄 🚫'));
    });

    runTest('TC29', 'Currency & Numbers: DZD currency symbol (د.ج) and price amounts format accurately', () => {
        const tpl = '<b>💰 الإجمالي:</b> <b>{{grand_total}} د.ج</b>';
        const rendered = engine.renderTemplate(tpl, { grand_total: '4,950' });
        assert.strictEqual(rendered.text, '<b>💰 الإجمالي:</b> <b>4,950 د.ج</b>');
    });

    // =============================================================================
    // SUITE 6: LENGTH ENFORCEMENT (4,096 CHARS) (TC30 - TC31)
    // =============================================================================
    console.log('\n--- SUITE 6: LENGTH ENFORCEMENT (4,096 CHARS) ---');

    runTest('TC30', 'Character Limit Compliance: template under 4,096 UTF-8 characters passes with exact charCount', () => {
        const text = 'A'.repeat(500);
        const rendered = engine.renderTemplate(text, {});
        assert.strictEqual(rendered.charCount, 500);
        assert.strictEqual(rendered.truncated, false);
        assert.strictEqual(rendered.warnings.length, 0);
    });

    runTest('TC31', 'Length Exceeded Truncation: template exceeding 4,096 characters is safely capped', () => {
        const text = '<b>' + 'A'.repeat(5000) + '</b>';
        const rendered = engine.renderTemplate(text, {});
        assert.ok(rendered.charCount <= 4096, `Char count ${rendered.charCount} must be <= 4096`);
        assert.strictEqual(rendered.truncated, true);
        assert.ok(rendered.text.includes('تم اقتطاع الرسالة'));
        assert.ok(rendered.text.endsWith('</b>'), 'Open <b> tag must be automatically closed at the end');
    });

    // =============================================================================
    // SUITE 7: TEMPLATE VALIDATION ENGINE (TC32 - TC34)
    // =============================================================================
    console.log('\n--- SUITE 7: TEMPLATE VALIDATION ENGINE ---');

    runTest('TC32', 'Template Validator: Valid Template returns { valid: true, errors: [] }', () => {
        const tpl = '<b>Order:</b> <code>{{order_id}}</code>\nName: {{customer_name}}';
        const res = engine.validateTemplate('ORDER_CREATED', tpl);
        assert.strictEqual(res.valid, true);
        assert.strictEqual(res.errors.length, 0);
    });

    runTest('TC33', 'Template Validator: Unclosed Tag detects unclosed HTML tag (<b>text)', () => {
        const tpl = '<b>Unclosed bold text with {{order_id}}';
        const res = engine.validateTemplate('ORDER_CREATED', tpl);
        assert.strictEqual(res.valid, false);
        assert.ok(res.errors.some(e => e.includes('UNCLOSED_TAG_B')));
    });

    runTest('TC34', 'Template Validator: Disallowed Tag detects forbidden tag (<script>)', () => {
        const tpl = 'Hello <script>alert(1)</script> {{order_id}}';
        const res = engine.validateTemplate('ORDER_CREATED', tpl);
        assert.strictEqual(res.valid, false);
        assert.ok(res.errors.some(e => e.includes('DISALLOWED_TAG')));
    });

    // =============================================================================
    // SUITE 8: NOTIFIER INTEGRATION & FALLBACK (TC35 - TC38)
    // =============================================================================
    console.log('\n--- SUITE 8: NOTIFIER INTEGRATION & FALLBACK ---');

    runTest('TC35', 'Fallback: Empty Custom Template in buildMessage falls back to default message', () => {
        const defaultMsg = notifier.buildMessage('ORDER_CREATED', 'ORVA-FALLBACK-1', { fullName: 'سفيان' });
        const emptyCustomMsg = notifier.buildMessage('ORDER_CREATED', 'ORVA-FALLBACK-1', { fullName: 'سفيان' }, '');
        assert.strictEqual(emptyCustomMsg, defaultMsg);
        assert.ok(emptyCustomMsg.includes('سفيان'));
    });

    runTest('TC36', 'Fallback: Render Exception in buildMessage catches error and falls back to default message', () => {
        const defaultMsg = notifier.buildMessage('ORDER_CREATED', 'ORVA-EXC-1', { fullName: 'سفيان' });
        const brokenCustomMsg = notifier.buildMessage('ORDER_CREATED', 'ORVA-EXC-1', { fullName: 'سفيان' }, 12345);
        assert.strictEqual(brokenCustomMsg, defaultMsg);
    });

    runTest('TC37', 'Test Mode Prefixing: renderTemplate with options.isTest === true prepends test banner', () => {
        const tpl = 'Order: {{order_id}}';
        const rendered = engine.renderTemplate(tpl, { order_id: 'ORVA-TEST-MODE' }, { isTest: true });
        assert.ok(rendered.text.startsWith(engine.TEST_PREFIX));
        assert.ok(rendered.text.startsWith('🧪 <b>[TEST] [رسالة تجريبية]</b>\n\nOrder: ORVA-TEST-MODE'));
    });

    await runTestAsync('TC38', 'Notifier Null Data Safety: dispatchTelegramNotification with data: null does not throw', async () => {
        notifier.resetTestLedger();
        const res = await notifier.dispatchTelegramNotification({
            event: 'ORDER_CREATED',
            orderId: 'ORVA-NULL-DATA-TEST',
            data: null,
            credentials: { mock: true, botToken: 'mock_token', chatId: '-100mock' }
        });
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.simulated, true);
    });

    console.log('\n================================================================================');
    console.log(`TOTAL SCENARIOS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
    console.log('🎉 VERDICT: 100% UNIT TESTS PASSED FOR MILESTONE 1');
    console.log('================================================================================\n');
}

main().catch((err) => {
    console.error('Test execution fatal error:', err);
    process.exit(1);
});
