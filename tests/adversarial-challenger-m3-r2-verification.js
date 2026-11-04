/**
 * INDEPENDENT ADVERSARIAL VERIFICATION HARNESS - MILESTONE 3 ITERATION 2
 * Agent: teamwork_challenger_tg_m3_r2_1
 *
 * This test directly extracts and evaluates buildLivePreviewHtml and validateTemplateSyntax
 * directly from the production source file:
 * orvastore Dashbaord v0.9/next-shadcn-admin-dashboard-baseui-main/src/app/(main)/dashboard/settings/settings-integrations.tsx
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const UI_PATH = path.join(
    __dirname,
    '..',
    'orvastore Dashbaord v0.9',
    'next-shadcn-admin-dashboard-baseui-main',
    'src',
    'app',
    '(main)',
    'dashboard',
    'settings',
    'settings-integrations.tsx'
);

const uiSource = fs.readFileSync(UI_PATH, 'utf8');

// 1. Extract EVENT_VARIABLES_MAP from source
const varsMapMatch = uiSource.match(/export const EVENT_VARIABLES_MAP:\s*Record<SupportedEvent,\s*[^>]+>\s*=\s*(\{[\s\S]*?\n\};)/);
if (!varsMapMatch) throw new Error('Failed to extract EVENT_VARIABLES_MAP from UI source');
const cleanedVarsCode = varsMapMatch[1].replace(/:\s*Record<[^>]+>/g, '').trim().replace(/;\s*$/, '');
const EVENT_VARIABLES_MAP = eval(`(${cleanedVarsCode})`);

// 2. Extract buildLivePreviewHtml from source
const buildLivePreviewMatch = uiSource.match(/function buildLivePreviewHtml\([\s\S]*?\n\}/);
if (!buildLivePreviewMatch) throw new Error('Failed to extract buildLivePreviewHtml from UI source');
// Strip TypeScript annotations
const cleanedBuildLivePreview = buildLivePreviewMatch[0]
    .replace(/templateText:\s*string/g, 'templateText')
    .replace(/event:\s*SupportedEvent/g, 'event')
    .replace(/:\s*string\s*\{/g, ' {')
    .replace(/:\s*Record<string,\s*string>/g, '')
    .replace(/:\s*string\b/g, '');
const buildLivePreviewHtml = new Function('EVENT_VARIABLES_MAP', `return (${cleanedBuildLivePreview});`)(EVENT_VARIABLES_MAP);

// 3. Extract validateTemplateSyntax from source
const validateSyntaxMatch = uiSource.match(/function validateTemplateSyntax\([\s\S]*?\n\}/);
if (!validateSyntaxMatch) throw new Error('Failed to extract validateTemplateSyntax from UI source');
const cleanedValidateSyntax = validateSyntaxMatch[0]
    .replace(/text:\s*string/g, 'text')
    .replace(/:\s*\{[^}]+\}\s*\{/g, ' {');
const validateTemplateSyntax = new Function(`return (${cleanedValidateSyntax});`)();

console.log('================================================================================');
console.log('   ORVA STORE — INDEPENDENT CHALLENGER M3_R2 EMPIRICAL HARNESS');
console.log('   Extracted directly from settings-integrations.tsx');
console.log('================================================================================\n');

let total = 0;
let passed = 0;
let failed = 0;
const failures = [];

function test(id, title, fn) {
    total++;
    try {
        fn();
        passed++;
        console.log(`  [PASS] [${id}] ${title}`);
    } catch (err) {
        failed++;
        failures.push({ id, title, error: err.message });
        console.error(`  ❌ [FAIL] [${id}] ${title}: ${err.message}`);
    }
}

// -----------------------------------------------------------------------------
// SECTION 1: VULN-M3-01 Remediation - Live Preview Sanitization
// -----------------------------------------------------------------------------
console.log('--- SECTION 1: VULN-M3-01 Remediation (DOM XSS in Live Preview) ---');

test('XSS-01', '<img src=x onerror=alert(1)> is completely stripped in buildLivePreviewHtml', () => {
    const out = buildLivePreviewHtml('<img src=x onerror=alert(1)>', 'ORDER_CREATED');
    assert.strictEqual(out.includes('<img'), false, 'Should not contain <img');
    assert.strictEqual(out.includes('onerror'), false, 'Should not contain onerror');
    assert.strictEqual(out.includes('alert(1)'), false, 'Should not contain alert(1)');
});

test('XSS-02', '<svg onload=alert(1)> is completely stripped in buildLivePreviewHtml', () => {
    const out = buildLivePreviewHtml('<svg onload=alert(1)>', 'ORDER_CREATED');
    assert.strictEqual(out.includes('<svg'), false, 'Should not contain <svg');
    assert.strictEqual(out.includes('onload'), false, 'Should not contain onload');
    assert.strictEqual(out.includes('alert(1)'), false, 'Should not contain alert(1)');
});

test('XSS-03', '<a href="javascript:alert(1)"> is neutralized to href="#"', () => {
    const out = buildLivePreviewHtml('<a href="javascript:alert(1)">انقر هنا</a>', 'ORDER_CREATED');
    assert.strictEqual(out.includes('javascript:'), false, 'Should not contain javascript:');
    assert.ok(out.includes('href="#"'), 'Should have neutralized href="#"');
});

test('XSS-04', '<a href="  javascript:alert(1)"> with spaces is neutralized to href="#"', () => {
    const out = buildLivePreviewHtml('<a href="  javascript:alert(1)">انقر هنا</a>', 'ORDER_CREATED');
    assert.strictEqual(out.includes('javascript:'), false, 'Should not contain javascript:');
    assert.ok(out.includes('href="#"'), 'Should have neutralized href="#"');
});

test('XSS-05', '<a href="data:text/html,<script>alert(1)</script>"> is neutralized to href="#"', () => {
    const out = buildLivePreviewHtml('<a href="data:text/html,<script>alert(1)</script>">click</a>', 'ORDER_CREATED');
    assert.strictEqual(out.includes('data:'), false, 'Should not contain data:');
    assert.ok(out.includes('href="#"'), 'Should have neutralized href="#"');
});

test('XSS-06', '<a href="vbscript:msgbox(1)"> is neutralized to href="#"', () => {
    const out = buildLivePreviewHtml('<a href="vbscript:msgbox(1)">click</a>', 'ORDER_CREATED');
    assert.strictEqual(out.includes('vbscript:'), false, 'Should not contain vbscript:');
    assert.ok(out.includes('href="#"'), 'Should have neutralized href="#"');
});

test('XSS-07', '<b onmouseover="alert(1)">bold</b> strips inline event handler on allowed tag', () => {
    const out = buildLivePreviewHtml('<b onmouseover="alert(1)">نص عريض</b>', 'ORDER_CREATED');
    assert.strictEqual(out.includes('onmouseover'), false, 'Should strip onmouseover attribute');
    assert.ok(out.includes('<b>نص عريض</b>') || out.includes('<b >نص عريض</b>'), 'Should preserve <b>');
});

test('XSS-08', '<tg-spoiler onclick="alert(1)">spoiler</tg-spoiler> strips inline event handler', () => {
    const out = buildLivePreviewHtml('<tg-spoiler onclick="alert(1)">نص مخفي</tg-spoiler>', 'ORDER_CREATED');
    assert.strictEqual(out.includes('onclick'), false, 'Should strip onclick');
    assert.ok(out.includes('tg-spoiler'), 'Should preserve tg-spoiler tag');
});

test('XSS-09', '<IMG/SRC=X/ONERROR=alert(1)> (uppercase & slashed) is completely stripped', () => {
    const out = buildLivePreviewHtml('<IMG/SRC=X/ONERROR=alert(1)>', 'ORDER_CREATED');
    assert.strictEqual(out.toLowerCase().includes('<img'), false, 'Should strip uppercase/slashed img');
    assert.strictEqual(out.includes('alert(1)'), false, 'Should strip onerror payload');
});

test('XSS-10', '<script>alert(1)</script> executable content completely removed', () => {
    const out = buildLivePreviewHtml('قبل <script>alert(1)</script> بعد', 'ORDER_CREATED');
    assert.strictEqual(out.includes('alert(1)'), false, 'Script body must be removed');
    assert.ok(out.includes('قبل') && out.includes('بعد'), 'Normal content preserved');
});

test('XSS-11', 'Unclosed <script src="evil.js" during active typing is stripped', () => {
    const out = buildLivePreviewHtml('بداية <script src="evil.js" نهاية', 'ORDER_CREATED');
    assert.strictEqual(out.includes('<script'), false, 'Unclosed script tag must be stripped');
});

test('XSS-12', '<iframe src="evil.html"></iframe> is completely stripped', () => {
    const out = buildLivePreviewHtml('<iframe src="evil.html"></iframe>', 'ORDER_CREATED');
    assert.strictEqual(out.includes('<iframe'), false, 'iframe must be stripped');
});

test('XSS-13', '<style>body{display:none;}</style> is completely stripped', () => {
    const out = buildLivePreviewHtml('<style>body{display:none;}</style>', 'ORDER_CREATED');
    assert.strictEqual(out.includes('<style'), false, 'style tag must be stripped');
    assert.strictEqual(out.includes('display:none'), false, 'style body must be stripped');
});

test('XSS-14', '<form action="https://evil.com"><input name="pwd"/><button>Send</button></form> stripped', () => {
    const out = buildLivePreviewHtml('<form action="https://evil.com"><input name="pwd"/><button>Send</button></form>', 'ORDER_CREATED');
    assert.strictEqual(out.includes('<form'), false, 'form must be stripped');
    assert.strictEqual(out.includes('<input'), false, 'input must be stripped');
    assert.strictEqual(out.includes('<button'), false, 'button must be stripped');
});

test('XSS-15', 'Safe links (<a href="https://orva-store.com"> and <a href="tg://resolve">) are preserved', () => {
    const out = buildLivePreviewHtml('<a href="https://orva-store.com">المتجر</a> و <a href="tg://resolve?domain=orva">تيليجرام</a>', 'ORDER_CREATED');
    assert.ok(out.includes('href="https://orva-store.com"'), 'https link preserved');
    assert.ok(out.includes('href="tg://resolve?domain=orva"'), 'tg:// link preserved');
});

// -----------------------------------------------------------------------------
// SECTION 2: VULN-M3-02 Remediation - Syntax Validator Coverage
// -----------------------------------------------------------------------------
console.log('\n--- SECTION 2: VULN-M3-02 Remediation (Syntax Validator Disallowed Tags) ---');

test('SYN-01', 'validateTemplateSyntax("<script>alert(1)</script>") returns valid: false with warning', () => {
    const res = validateTemplateSyntax('<script>alert(1)</script>');
    assert.strictEqual(res.valid, false, 'Should be invalid');
    assert.ok(res.warning.includes('script'), 'Warning should mention script');
});

test('SYN-02', 'validateTemplateSyntax("<div>test</div>") returns valid: false with warning', () => {
    const res = validateTemplateSyntax('<div>test</div>');
    assert.strictEqual(res.valid, false, 'Should be invalid');
    assert.ok(res.warning.includes('div'), 'Warning should mention div');
});

test('SYN-03', 'validateTemplateSyntax("<form action=\\"evil\\"></form>") returns valid: false with warning', () => {
    const res = validateTemplateSyntax('<form action="evil"></form>');
    assert.strictEqual(res.valid, false, 'Should be invalid');
    assert.ok(res.warning.includes('form'), 'Warning should mention form');
});

test('SYN-04', 'validateTemplateSyntax("<img src=x onerror=alert(1)>") returns valid: false with warning', () => {
    const res = validateTemplateSyntax('<img src=x onerror=alert(1)>');
    assert.strictEqual(res.valid, false, 'Should be invalid');
    assert.ok(res.warning.includes('img'), 'Warning should mention img');
});

test('SYN-05', 'validateTemplateSyntax("<svg onload=alert(1)>") returns valid: false with warning', () => {
    const res = validateTemplateSyntax('<svg onload=alert(1)>');
    assert.strictEqual(res.valid, false, 'Should be invalid');
    assert.ok(res.warning.includes('svg'), 'Warning should mention svg');
});

test('SYN-06', 'validateTemplateSyntax("<iframe></iframe>") returns valid: false with warning', () => {
    const res = validateTemplateSyntax('<iframe></iframe>');
    assert.strictEqual(res.valid, false, 'Should be invalid');
    assert.ok(res.warning.includes('iframe'), 'Warning should mention iframe');
});

test('SYN-07', 'validateTemplateSyntax("<style></style>") returns valid: false with warning', () => {
    const res = validateTemplateSyntax('<style></style>');
    assert.strictEqual(res.valid, false, 'Should be invalid');
    assert.ok(res.warning.includes('style'), 'Warning should mention style');
});

test('SYN-08', 'validateTemplateSyntax("<a href=\\"javascript:alert(1)\\">click</a>") returns valid: false with warning', () => {
    const res = validateTemplateSyntax('<a href="javascript:alert(1)">click</a>');
    assert.strictEqual(res.valid, false, 'Should be invalid');
    assert.ok(res.warning.includes('javascript:'), 'Warning should mention javascript:');
});

test('SYN-09', 'validateTemplateSyntax with valid allowed tags (b, i, code, pre, a, tg-spoiler, strong, em, u, s, blockquote) returns valid: true', () => {
    const text = '<b>عريض</b> <i>مائل</i> <code>رمز</code> <pre>بلوك</pre> <a href="https://orva.com">رابط</a> <tg-spoiler>مخفي</tg-spoiler> <strong>قوي</strong> <em>تأكيد</em> <u>تسطير</u> <s>شطب</s> <blockquote>اقتباس</blockquote>';
    const res = validateTemplateSyntax(text);
    assert.strictEqual(res.valid, true, 'Valid telegram tags should pass');
});

test('SYN-10', 'validateTemplateSyntax detects unclosed <b> tag', () => {
    const res = validateTemplateSyntax('<b>نص بدون إغلاق');
    assert.strictEqual(res.valid, false, 'Should be invalid');
    assert.ok(res.warning.includes('<b>'), 'Warning should mention unclosed <b>');
});

test('SYN-11', 'validateTemplateSyntax detects unclosed <code> tag', () => {
    const res = validateTemplateSyntax('<code>كود غير مغلق');
    assert.strictEqual(res.valid, false, 'Should be invalid');
    assert.ok(res.warning.includes('<code>'), 'Warning should mention unclosed <code>');
});

test('SYN-12', 'validateTemplateSyntax detects unclosed <blockquote> tag', () => {
    const res = validateTemplateSyntax('<blockquote>اقتباس غير مغلق');
    assert.strictEqual(res.valid, false, 'Should be invalid');
    assert.ok(res.warning.includes('<blockquote>'), 'Warning should mention unclosed <blockquote>');
});

// -----------------------------------------------------------------------------
// SECTION 3: Boundary & Multi-Byte UTF-8 & Emoji Surrogates
// -----------------------------------------------------------------------------
console.log('\n--- SECTION 3: Boundary & Multi-Byte UTF-8 & Emoji Surrogates ---');

test('BND-01', 'Length 4,095 ASCII characters returns valid: true', () => {
    const text = 'A'.repeat(4095);
    const res = validateTemplateSyntax(text);
    assert.strictEqual(res.valid, true);
});

test('BND-02', 'Length 4,096 ASCII characters returns valid: true', () => {
    const text = 'A'.repeat(4096);
    const res = validateTemplateSyntax(text);
    assert.strictEqual(res.valid, true);
});

test('BND-03', 'Length 4,097 ASCII characters returns valid: false with length warning', () => {
    const text = 'A'.repeat(4097);
    const res = validateTemplateSyntax(text);
    assert.strictEqual(res.valid, false);
    assert.ok(res.warning.includes('4097 / 4096'), 'Warning should state exact overflow');
});

test('BND-04', 'Length 4,096 Arabic characters (8,192 UTF-8 bytes) returns valid: true', () => {
    const arabicChar = 'ت'; // U+062A (2 bytes UTF-8, 1 UTF-16 code unit)
    const text = arabicChar.repeat(4096);
    assert.strictEqual(text.length, 4096, 'JS length should be 4096');
    assert.strictEqual(Buffer.byteLength(text, 'utf8'), 8192, 'UTF-8 byte length should be 8192');
    const res = validateTemplateSyntax(text);
    assert.strictEqual(res.valid, true, 'Should pass validation');
});

test('BND-05', 'Length 4,097 Arabic characters returns valid: false', () => {
    const text = 'ت'.repeat(4097);
    const res = validateTemplateSyntax(text);
    assert.strictEqual(res.valid, false);
    assert.ok(res.warning.includes('4097 / 4096'));
});

test('BND-06', '2,048 crown emojis (4,096 UTF-16 code units) returns valid: true', () => {
    const crown = '👑'; // Surrogate pair (2 UTF-16 code units)
    const text = crown.repeat(2048);
    assert.strictEqual(text.length, 4096, 'Length should be 4096');
    const res = validateTemplateSyntax(text);
    assert.strictEqual(res.valid, true);
});

test('BND-07', '4,095 ASCII + 1 crown emoji (4,097 code units) returns valid: false', () => {
    const text = 'A'.repeat(4095) + '👑';
    assert.strictEqual(text.length, 4097);
    const res = validateTemplateSyntax(text);
    assert.strictEqual(res.valid, false);
    assert.ok(res.warning.includes('4097 / 4096'));
});

// -----------------------------------------------------------------------------
// SECTION 4: Live Preview Null & Undefined Safety Across All Events
// -----------------------------------------------------------------------------
console.log('\n--- SECTION 4: Live Preview Safety & Variable Expansion ---');

const supportedEvents = [
    'ORDER_CREATED',
    'SHIPMENT_CREATED',
    'SHIPMENT_FAILED',
    'STATUS_UPDATED',
    'ORDER_CANCELLED',
    'ADMIN_ALERT'
];

for (const ev of supportedEvents) {
    test(`PREV-NULL-${ev}`, `Event ${ev} renders with zero "undefined" and zero "null"`, () => {
        const vars = EVENT_VARIABLES_MAP[ev] || [];
        const template = vars.map(v => `<b>${v.labelAr}:</b> {{${v.key}}}`).join('\n');
        const preview = buildLivePreviewHtml(template, ev);
        assert.strictEqual(preview.includes('undefined'), false, `Preview for ${ev} contains "undefined"`);
        assert.strictEqual(preview.includes('null'), false, `Preview for ${ev} contains "null"`);
    });
}

test('PREV-MISSING-VAR', 'Missing unknown variable {{non_existent_token}} renders safely as empty string', () => {
    const preview = buildLivePreviewHtml('طلب: {{non_existent_token}} شكرا', 'ORDER_CREATED');
    assert.strictEqual(preview.includes('undefined'), false);
    assert.strictEqual(preview.includes('null'), false);
    assert.ok(preview.includes('طلب:  شكرا') || preview.includes('طلب: شكرا'));
});

test('PREV-CAMELCASE', 'CamelCase variable {{orderId}} correctly expands sample value', () => {
    const preview = buildLivePreviewHtml('رقم: {{orderId}}', 'ORDER_CREATED');
    assert.ok(preview.includes('ORVA-94821'), 'Should expand orderId correctly');
});

test('PREV-CASE-INSENSITIVE', 'Uppercase variable {{ORDER_ID}} correctly expands sample value', () => {
    const preview = buildLivePreviewHtml('رقم: {{ORDER_ID}}', 'ORDER_CREATED');
    assert.ok(preview.includes('ORVA-94821'), 'Should expand ORDER_ID correctly');
});

// -----------------------------------------------------------------------------
// SUMMARY
// -----------------------------------------------------------------------------
console.log('\n================================================================================');
console.log('   INDEPENDENT HARNESS SUMMARY');
console.log('================================================================================');
console.log(`TOTAL EXECUTED: ${total}`);
console.log(`PASSED:         ${passed} (${Math.round((passed / total) * 100)}%)`);
console.log(`FAILED:         ${failed}`);
console.log('================================================================================');

if (failed > 0) {
    console.error('\nFAILURES:');
    for (const f of failures) {
        console.error(`- [${f.id}] ${f.title}: ${f.error}`);
    }
    process.exit(1);
} else {
    console.log('\n🎉 ALL INDEPENDENT EMPIRICAL TESTS PASSED WITHOUT EXCEPTION.');
    process.exit(0);
}
