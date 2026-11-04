'use strict';
// =============================================================================
// ORVA STORE — Phase 8F Milestone 2 Resilience Challenger 2
// Empirical Adversarial Stress Harness: Destination Pinning, Side-Effect Zero-State,
// Checkout Fallback Transparency, and CSRF Origin Enforcements.
//
// Target Modules:
//   - api/admin-settings.js (Node.js API handler)
//   - api/admin-settings.php (Hostinger PHP 8.3 CLI parity handler)
//   - api/send-order.js & api/send-order.php (Checkout pipelines)
//   - lib/telegram-notifier.js (Operational Telegram dispatcher)
//   - lib/admin-settings-store.js (Encrypted settings store)
// =============================================================================

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const assert = require('node:assert');
const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const adminSettingsHandler = require('../api/admin-settings');
const sendOrderHandler = require('../api/send-order');
const {
    getEffectiveSettings,
    getPublicSettings,
    updateSettings,
    saveTemplateDraft,
    activateTemplate,
    restoreTemplateDefault,
    toggleTemplate,
    SETTINGS_FILE
} = require('../lib/admin-settings-store');
const {
    dispatchTelegramNotification,
    buildMessage,
    buildDefaultMessage,
    readLedger
} = require('../lib/telegram-notifier');
const templateEngine = require('../lib/telegram-template-engine');
const dbLayer = require('../lib/db');

// Files for Backup & Restore
const INVENTORY_FILE = path.join(__dirname, '..', 'data', 'inventory-state.json');
const LEDGER_FILE = path.join(__dirname, '..', 'data', 'telegram-dispatch-ledger.json');
const AUDIT_FILE = path.join(__dirname, '..', 'data', 'admin-audit.json');

// Constant Auth Header for Admin Mutations
const AUTH_HEADER = {
    authorization: 'Bearer ' + (process.env.ADMIN_API_TOKEN || 'orva-admin-2026-secure'),
    origin: 'https://orva-store.com'
};

// PHP Binary Resolver
function resolvePhpBinary() {
    const candidatePaths = [
        'C:\\Users\\user\\AppData\\Local\\Microsoft\\WinGet\\Packages\\PHP.PHP.8.3_Microsoft.Winget.Source_8wekyb3d8bbwe\\php.exe',
        'php'
    ];
    for (const p of candidatePaths) {
        try {
            execFileSync(p, ['-v'], { stdio: 'pipe' });
            return p;
        } catch (_) {}
    }
    return null;
}
const phpBin = resolvePhpBinary();

// Helper for PHP CLI executions with Mock Stream Wrapper
function runPhpCli(phpCode, inputPayload = null, envExtra = {}) {
    if (!phpBin) return null;

    const streamBootstrap = `
class MockPhpStream {
    public $context;
    private static $data = '';
    private $pos = 0;
    public static function setContent($d) { self::$data = $d; }
    public function stream_open($path, $mode, $options, &$opened_path) { $this->pos = 0; return true; }
    public function stream_read($count) {
        $ret = substr(self::$data, $this->pos, $count);
        $this->pos += strlen($ret);
        return $ret;
    }
    public function stream_tell() { return $this->pos; }
    public function stream_eof() { return $this->pos >= strlen(self::$data); }
    public function stream_stat() { return ['size' => strlen(self::$data)]; }
}

$stdin = file_get_contents('php://stdin');
if ($stdin !== false && $stdin !== '') {
    @stream_wrapper_unregister('php');
    @stream_wrapper_register('php', 'MockPhpStream');
    MockPhpStream::setContent($stdin);
}
`;

    const fullScript = streamBootstrap + phpCode;
    return execFileSync(phpBin, ['-d', 'extension=mbstring', '-r', fullScript], {
        input: inputPayload ? JSON.stringify(inputPayload) : '',
        encoding: 'utf8',
        env: { ...process.env, ...envExtra }
    }).trim();
}

// ── Global Spies & Network Interceptor ─────────────────────────────────────────
const originalHttpsRequest = https.request;
const originalHttpRequest = http.request;

const mockTelegramDispatches = [];
const mockCourierCalls = [];
const mockSupabaseCalls = [];
let mockTelegramError = null;

function activateMocks() {
    delete process.env.MOCK_TELEGRAM; // Allow notifier to dispatch to our in-memory mock https.request
    process.env.NODE_ENV = 'production';

    mockTelegramDispatches.length = 0;
    mockCourierCalls.length = 0;
    mockSupabaseCalls.length = 0;
    mockTelegramError = null;

    https.request = function(options, cb) {
        const urlStr = typeof options === 'string'
            ? options
            : ((options.protocol || 'https:') + '//' + (options.hostname || '') + (options.path || ''));

        // 1. Telegram API Interception
        if (urlStr.includes('api.telegram.org')) {
            const reqEmitter = new (require('events').EventEmitter)();
            reqEmitter._chunks = [];
            reqEmitter.write = function(chunk) {
                if (chunk) reqEmitter._chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            };
            reqEmitter.end = function(chunk) {
                if (chunk) reqEmitter.write(chunk);
                process.nextTick(() => {
                    const raw = Buffer.concat(reqEmitter._chunks).toString('utf8');
                    let payload = {};
                    try { payload = JSON.parse(raw); } catch (_) { payload = { raw }; }

                    if (mockTelegramError === 'TIMEOUT') {
                        reqEmitter.emit('timeout');
                        reqEmitter.emit('error', new Error('TELEGRAM_TIMEOUT'));
                        return;
                    }
                    if (mockTelegramError === 'HTTP_500') {
                        const resEmitter = new (require('events').EventEmitter)();
                        resEmitter.statusCode = 500;
                        if (typeof cb === 'function') cb(resEmitter);
                        resEmitter.emit('data', JSON.stringify({ ok: false, error_code: 500, description: 'Internal Server Error' }));
                        resEmitter.emit('end');
                        return;
                    }
                    if (mockTelegramError === 'PARSE_ERROR') {
                        const resEmitter = new (require('events').EventEmitter)();
                        resEmitter.statusCode = 400;
                        if (typeof cb === 'function') cb(resEmitter);
                        resEmitter.emit('data', JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: can\'t parse entities: unclosed tag' }));
                        resEmitter.emit('end');
                        return;
                    }

                    mockTelegramDispatches.push({ url: urlStr, payload, timestamp: new Date().toISOString() });
                    const resEmitter = new (require('events').EventEmitter)();
                    resEmitter.statusCode = 200;
                    if (typeof cb === 'function') cb(resEmitter);
                    resEmitter.emit('data', JSON.stringify({
                        ok: true,
                        result: {
                            message_id: 88000 + mockTelegramDispatches.length,
                            chat: { id: payload.chat_id }
                        }
                    }));
                    resEmitter.emit('end');
                });
            };
            reqEmitter.destroy = (err) => { reqEmitter.emit('error', err || new Error('destroyed')); };
            return reqEmitter;
        }

        // 2. Courier Gateway Interception
        if (/ecotrack|redex|yalidine|procolis|maystro|conexlog/i.test(urlStr)) {
            mockCourierCalls.push({ url: urlStr, options, timestamp: new Date().toISOString() });
            const reqEmitter = new (require('events').EventEmitter)();
            reqEmitter.write = function() {};
            reqEmitter.end = function() {
                process.nextTick(() => {
                    const resEmitter = new (require('events').EventEmitter)();
                    resEmitter.statusCode = 200;
                    if (typeof cb === 'function') cb(resEmitter);
                    resEmitter.emit('data', JSON.stringify({ success: true, tracking: 'MOCK-COURIER-TRACK' }));
                    resEmitter.emit('end');
                });
            };
            return reqEmitter;
        }

        // 3. Supabase REST Interception
        if (urlStr.includes('supabase.co') || urlStr.includes('/rest/v1/orders')) {
            mockSupabaseCalls.push({ url: urlStr, timestamp: new Date().toISOString() });
            const reqEmitter = new (require('events').EventEmitter)();
            reqEmitter.write = function() {};
            reqEmitter.end = function() {
                process.nextTick(() => {
                    const resEmitter = new (require('events').EventEmitter)();
                    resEmitter.statusCode = 201;
                    if (typeof cb === 'function') cb(resEmitter);
                    resEmitter.emit('data', JSON.stringify([{ id: 'MOCK-SUPABASE-ID', order_id: 'ORVA-MOCK' }]));
                    resEmitter.emit('end');
                });
            };
            return reqEmitter;
        }

        return originalHttpsRequest.apply(https, arguments);
    };

    http.request = function(options, cb) {
        const urlStr = typeof options === 'string'
            ? options
            : ((options.protocol || 'http:') + '//' + (options.hostname || '') + (options.path || ''));

        if (/ecotrack|redex|yalidine|procolis/i.test(urlStr)) {
            mockCourierCalls.push({ url: urlStr, options, timestamp: new Date().toISOString() });
        }
        return originalHttpRequest.apply(http, arguments);
    };
}

function deactivateMocks() {
    https.request = originalHttpsRequest;
    http.request = originalHttpRequest;
}

function executeRequest(handler, req) {
    return new Promise((resolve) => {
        let statusCode = 200;
        const responseHeaders = {};
        let responseBody = null;

        const res = {
            setHeader: (k, v) => { responseHeaders[k.toLowerCase()] = v; },
            getHeader: (k) => responseHeaders[k.toLowerCase()],
            status: (code) => { statusCode = code; return res; },
            json: (data) => { responseBody = data; resolve({ statusCode, headers: responseHeaders, body: data }); },
            send: (data) => { responseBody = data; resolve({ statusCode, headers: responseHeaders, body: data }); },
            end: (data) => { resolve({ statusCode, headers: responseHeaders, body: responseBody || data }); }
        };

        try {
            Promise.resolve(handler(req, res)).catch((err) => {
                resolve({ statusCode: 500, headers: responseHeaders, body: { error: err.message } });
            });
        } catch (err) {
            resolve({ statusCode: 500, headers: responseHeaders, body: { error: err.message } });
        }
    });
}

// ── Test Runner Infrastructure ────────────────────────────────────────────────
let totalCount = 0;
let passedCount = 0;
let failedCount = 0;
const failureDetails = [];

async function challengeTest(id, category, description, fn) {
    totalCount++;
    process.stdout.write(`[${id}] [${category}] ${description} ... `);
    try {
        await fn();
        passedCount++;
        console.log('✅ PASS');
    } catch (err) {
        failedCount++;
        failureDetails.push({ id, category, description, error: err.message, stack: err.stack });
        console.log(`❌ FAIL: ${err.message}`);
    }
}

// ── Main Test Execution ───────────────────────────────────────────────────────
(async function runMasterChallenge() {
    console.log('================================================================================');
    console.log('   ORVA STORE — RESILIENCE CHALLENGER 2 EMPIRICAL TEST HARNESS');
    console.log('   Scope: Destination Pinning, Zero-Side-Effects, Fallback & CSRF Invariants');
    console.log('================================================================================\n');

    // Snapshot state
    const backupSettings = fs.existsSync(SETTINGS_FILE) ? fs.readFileSync(SETTINGS_FILE) : null;
    const backupInventory = fs.existsSync(INVENTORY_FILE) ? fs.readFileSync(INVENTORY_FILE, 'utf8') : null;
    const backupLedger = fs.existsSync(LEDGER_FILE) ? fs.readFileSync(LEDGER_FILE, 'utf8') : null;

    activateMocks();

    try {
        const configuredChatId = String(getEffectiveSettings().telegram.chatId || '-1003965560132');

        // =============================================================================
        // CATEGORY 1: STRICT ROUTING TO CONFIGURED telegram.chatId ONLY (REFUSING CLIENT HIJACK)
        // =============================================================================
        console.log('--- CATEGORY 1: STRICT ROUTING & DESTINATION PINNING ---');

        await challengeTest('CH-01-01', 'ROUTING', 'send_test_message strictly routes to configured chatId ignoring attacker-supplied chatId', async () => {
            mockTelegramDispatches.length = 0;
            const res = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: { ...AUTH_HEADER, 'x-forwarded-for': '10.0.1.1' },
                body: {
                    action: 'send_test_message',
                    event: 'ORDER_CREATED',
                    chatId: '-1009999999999', // Attacker destination attempt
                    chat_id: '-1009999999999',
                    to: '+213555999888',
                    phone: '0555999888'
                }
            });
            assert.strictEqual(res.statusCode, 200, 'Test send must succeed 200');
            assert.strictEqual(mockTelegramDispatches.length, 1, 'Exactly one dispatch must be sent');
            const dispatchedChatId = String(mockTelegramDispatches[0].payload.chat_id);
            assert.strictEqual(dispatchedChatId, configuredChatId, 'Dispatched chat_id must match configured telegram.chatId');
            assert.notStrictEqual(dispatchedChatId, '-1009999999999', 'Must NEVER target attacker-supplied chatId');
            assert.notStrictEqual(dispatchedChatId, '+213555999888', 'Must NEVER target phone number');
        });

        await challengeTest('CH-01-02', 'ROUTING', 'send_custom_message strictly routes to configured chatId refusing recipient/to fields', async () => {
            mockTelegramDispatches.length = 0;
            const res = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: AUTH_HEADER,
                body: {
                    action: 'send_custom_message',
                    title: 'Empirical Challenge Broadcast',
                    body: 'Verification message for destination lockdown',
                    chatId: '-1008888888888',
                    recipient: '@hijacked_channel',
                    to: '+213770112233',
                    phone: '0770112233'
                }
            });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(mockTelegramDispatches.length, 1);
            const dispatchedChatId = String(mockTelegramDispatches[0].payload.chat_id);
            assert.strictEqual(dispatchedChatId, configuredChatId, 'Dispatched chat_id must strictly match configured chatId');
            assert.notStrictEqual(dispatchedChatId, '-1008888888888');
            assert.notStrictEqual(dispatchedChatId, '@hijacked_channel');
        });

        await challengeTest('CH-01-03', 'ROUTING', 'Attempted SMS/phone hijacking on test send endpoint is completely rejected/ignored', async () => {
            mockTelegramDispatches.length = 0;
            const res = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: { ...AUTH_HEADER, 'x-forwarded-for': '10.0.1.2' },
                body: {
                    action: 'send_test_message',
                    event: 'ADMIN_ALERT',
                    phone: '0550123456',
                    target: '0550123456',
                    chatId: '0550123456'
                }
            });
            assert.strictEqual(res.statusCode, 200);
            const lastDispatch = mockTelegramDispatches[mockTelegramDispatches.length - 1];
            assert.strictEqual(String(lastDispatch.payload.chat_id), configuredChatId);
            assert.ok(!JSON.stringify(lastDispatch.payload).includes('0550123456'), 'Recipient phone must not be injected as destination');
        });

        if (phpBin) {
            await challengeTest('CH-01-04', 'ROUTING_PHP', 'PHP 8.3 CLI send_test_message strictly locks destination to configured chat ID', async () => {
                const phpCode = `
                    define('ORVA_API', true);
                    \$_SERVER['REQUEST_METHOD'] = 'POST';
                    \$_SERVER['HTTP_ORIGIN'] = 'https://orva-store.com';
                    \$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . (getenv('ADMIN_API_TOKEN') ?: 'orva-admin-2026-secure');
                    \$_SERVER['REMOTE_ADDR'] = '10.0.2.1';
                    \$_SERVER['CONTENT_TYPE'] = 'application/json';
                    putenv('MOCK_TELEGRAM=true');
                    require 'api/admin-settings.php';
                `;
                const out = runPhpCli(phpCode, {
                    action: 'send_test_message',
                    event: 'ORDER_CREATED',
                    chatId: '-1007777777777',
                    phone: '+213555000000',
                    to: '@attacker'
                });

                assert.ok(out, 'PHP CLI output must not be empty');
                const parsed = JSON.parse(out);
                assert.strictEqual(parsed.success, true, 'PHP test message must succeed');
                assert.strictEqual(String(parsed.destination), configuredChatId, 'PHP must dispatch to configuredChatId');
                assert.notStrictEqual(String(parsed.destination), '-1007777777777', 'PHP must not use client-supplied chatId');
            });

            await challengeTest('CH-01-05', 'ROUTING_PHP', 'PHP 8.3 CLI send_custom_message strictly locks destination to configured chat ID', async () => {
                const phpCode = `
                    define('ORVA_API', true);
                    \$_SERVER['REQUEST_METHOD'] = 'POST';
                    \$_SERVER['HTTP_ORIGIN'] = 'https://orva-store.com';
                    \$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . (getenv('ADMIN_API_TOKEN') ?: 'orva-admin-2026-secure');
                    \$_SERVER['REMOTE_ADDR'] = '10.0.2.2';
                    \$_SERVER['CONTENT_TYPE'] = 'application/json';
                    putenv('MOCK_TELEGRAM=true');
                    require 'api/admin-settings.php';
                `;
                const out = runPhpCli(phpCode, {
                    action: 'send_custom_message',
                    title: 'PHP Routing Lock',
                    body: 'Testing PHP broadcast target pinning',
                    chatId: '-1006666666666',
                    to: '+213555111222'
                });

                assert.ok(out, 'PHP CLI output must not be empty');
                const parsed = JSON.parse(out);
                assert.strictEqual(parsed.success, true);
                assert.strictEqual(String(parsed.destination), configuredChatId);
                assert.notStrictEqual(String(parsed.destination), '-1006666666666');
            });
        }

        // =============================================================================
        // CATEGORY 2: SIDE-EFFECT ZERO-STATE INVARIANTS (ZERO ORDERS, ZERO STOCK, ZERO COURIER)
        // =============================================================================
        console.log('\n--- CATEGORY 2: SIDE-EFFECT ZERO-STATE & SANDBOX INVARIANTS ---');

        await challengeTest('CH-02-01', 'SIDE_EFFECTS', 'send_test_message across all 6 events creates EXACTLY ZERO database orders', async () => {
            let saveOrderCallCount = 0;
            const originalSaveOrder = dbLayer.saveOrderToDb;
            dbLayer.saveOrderToDb = async function(...args) {
                saveOrderCallCount++;
                return originalSaveOrder.apply(this, args);
            };

            mockSupabaseCalls.length = 0;
            const events = ['ORDER_CREATED', 'SHIPMENT_CREATED', 'SHIPMENT_FAILED', 'STATUS_UPDATED', 'ORDER_CANCELLED', 'ADMIN_ALERT'];

            try {
                for (let i = 0; i < events.length; i++) {
                    const evt = events[i];
                    const res = await executeRequest(adminSettingsHandler, {
                        method: 'POST',
                        headers: { ...AUTH_HEADER, 'x-forwarded-for': `10.0.3.${i + 1}` },
                        body: { action: 'send_test_message', event: evt }
                    });
                    assert.strictEqual(res.statusCode, 200, `Event ${evt} must succeed 200`);
                }

                assert.strictEqual(saveOrderCallCount, 0, 'saveOrderToDb must be called EXACTLY 0 times');
                assert.strictEqual(mockSupabaseCalls.length, 0, 'Supabase REST order insertions must be EXACTLY 0');
            } finally {
                dbLayer.saveOrderToDb = originalSaveOrder;
            }
        });

        await challengeTest('CH-02-02', 'SIDE_EFFECTS', 'send_test_message deducts ZERO inventory in data/inventory-state.json', async () => {
            const initialInvContent = fs.readFileSync(INVENTORY_FILE, 'utf8');
            const initialHash = crypto.createHash('sha256').update(initialInvContent).digest('hex');
            const initialParsed = JSON.parse(initialInvContent);

            // Send multiple test messages with synthetic templates referencing SKU quantities
            for (let i = 0; i < 5; i++) {
                const res = await executeRequest(adminSettingsHandler, {
                    method: 'POST',
                    headers: { ...AUTH_HEADER, 'x-forwarded-for': `10.0.4.${i + 1}` },
                    body: {
                        action: 'send_test_message',
                        event: 'ORDER_CREATED',
                        templateText: 'TEST SKU DEDUCTION ATTEMPT: {{product_name}} Qty: {{quantity}}'
                    }
                });
                assert.strictEqual(res.statusCode, 200);
            }

            const finalInvContent = fs.readFileSync(INVENTORY_FILE, 'utf8');
            const finalHash = crypto.createHash('sha256').update(finalInvContent).digest('hex');
            const finalParsed = JSON.parse(finalInvContent);

            assert.strictEqual(finalHash, initialHash, 'Inventory state JSON hash must remain 100% byte-for-byte identical');
            for (const [sku, item] of Object.entries(initialParsed.inventory || {})) {
                assert.strictEqual(
                    finalParsed.inventory[sku].available,
                    item.available,
                    `SKU ${sku} available stock must be unchanged`
                );
                assert.strictEqual(
                    finalParsed.inventory[sku].reserved,
                    item.reserved,
                    `SKU ${sku} reserved stock must be unchanged`
                );
            }
        });

        await challengeTest('CH-02-03', 'SIDE_EFFECTS', 'send_test_message triggers ZERO courier API calls (RedEx, Ecotrack, Yalidine)', async () => {
            mockCourierCalls.length = 0;

            for (let i = 0; i < 4; i++) {
                const res = await executeRequest(adminSettingsHandler, {
                    method: 'POST',
                    headers: { ...AUTH_HEADER, 'x-forwarded-for': `10.0.5.${i + 1}` },
                    body: {
                        action: 'send_test_message',
                        event: 'SHIPMENT_CREATED',
                        templateText: 'Courier tracking: {{tracking_number}} Carrier: {{courier_name}}'
                    }
                });
                assert.strictEqual(res.statusCode, 200);
            }

            assert.strictEqual(mockCourierCalls.length, 0, 'Total courier gateway calls must be EXACTLY 0');
        });

        await challengeTest('CH-02-04', 'SIDE_EFFECTS', 'send_test_message payload always includes explicit [TEST] or test indicator', async () => {
            mockTelegramDispatches.length = 0;
            const res = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: { ...AUTH_HEADER, 'x-forwarded-for': '10.0.6.1' },
                body: { action: 'send_test_message', event: 'ORDER_CREATED' }
            });
            assert.strictEqual(res.statusCode, 200);
            const text = mockTelegramDispatches[mockTelegramDispatches.length - 1].payload.text;
            const hasTestIndicator = text.includes('[TEST]') || text.includes('رسالة تجريبية') || text.includes('معاينة تجريبية');
            assert.ok(hasTestIndicator, 'Test message body must feature unambiguous test indicator prefix');
        });

        // =============================================================================
        // CATEGORY 3: FALLBACK TRANSPARENCY & ORDER RESILIENCE ON DISABLED/INVALID TEMPLATES
        // =============================================================================
        console.log('\n--- CATEGORY 3: FALLBACK TRANSPARENCY & RESILIENCE DURING CHECKOUT ---');

        await challengeTest('CH-03-01', 'FALLBACK', 'Checkout succeeds with 200 OK when custom template is disabled (enabled: false)', async () => {
            // Save custom template and disable it
            updateSettings({
                telegram: {
                    templates: {
                        ORDER_CREATED: {
                            enabled: false,
                            activeTemplate: '🚨 SHOULD NEVER BE SEEN: CUSTOM DISABLED TEMPLATE',
                            updatedAt: new Date().toISOString()
                        }
                    }
                }
            }, 'admin');

            mockTelegramDispatches.length = 0;
            const checkoutRes = await executeRequest(sendOrderHandler, {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin: 'https://orva-store.com' },
                socket: { remoteAddress: '127.0.0.1' },
                body: {
                    fullName: 'Empirical Test Customer 1',
                    phone: '0551' + Math.floor(100000 + Math.random() * 900000),
                    wilaya: '16',
                    commune: 'الجزائر الوسطى',
                    packId: 'pack1',
                    quantity: 1
                }
            });

            assert.strictEqual(checkoutRes.statusCode, 200, 'Checkout must succeed with 200 OK');
            assert.strictEqual(checkoutRes.body.success, true, 'Checkout response must have success: true');
            assert.ok(checkoutRes.body.orderId, 'Checkout must issue valid orderId');

            // Wait brief tick for async decoupled notification
            await new Promise((r) => setTimeout(r, 200));
            assert.ok(mockTelegramDispatches.length > 0, 'Notification must be dispatched');
            const lastMsg = mockTelegramDispatches[mockTelegramDispatches.length - 1].payload.text;
            assert.ok(!lastMsg.includes('SHOULD NEVER BE SEEN'), 'Must NOT use disabled template');
            assert.ok(lastMsg.includes('طلب جديد'), 'Must transparently fall back to default notification');
        });

        await challengeTest('CH-03-02', 'FALLBACK', 'Checkout succeeds with 200 OK when active template is empty string', async () => {
            updateSettings({
                telegram: {
                    templates: {
                        ORDER_CREATED: {
                            enabled: true,
                            activeTemplate: '    \n\t  ',
                            updatedAt: new Date().toISOString()
                        }
                    }
                }
            }, 'admin');

            mockTelegramDispatches.length = 0;
            const checkoutRes = await executeRequest(sendOrderHandler, {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin: 'https://orva-store.com' },
                socket: { remoteAddress: '127.0.0.1' },
                body: {
                    fullName: 'Empirical Test Customer 2',
                    phone: '0552' + Math.floor(100000 + Math.random() * 900000),
                    wilaya: '16',
                    commune: 'الجزائر الوسطى',
                    packId: 'pack1',
                    quantity: 1
                }
            });

            assert.strictEqual(checkoutRes.statusCode, 200);
            assert.strictEqual(checkoutRes.body.success, true);
            await new Promise((r) => setTimeout(r, 200));
            assert.ok(mockTelegramDispatches.length > 0, 'Notification must be dispatched');
            const lastMsg = mockTelegramDispatches[mockTelegramDispatches.length - 1].payload.text;
            assert.ok(lastMsg.includes('طلب جديد'), 'Must fall back to default template on empty custom template');
        });

        await challengeTest('CH-03-03', 'FALLBACK', 'Checkout succeeds with 200 OK when template has unclosed/broken HTML tags', async () => {
            updateSettings({
                telegram: {
                    templates: {
                        ORDER_CREATED: {
                            enabled: true,
                            activeTemplate: '<b>BROKEN UNCLOSED TAG: {{customer_name}} <i>Unclosed italic',
                            updatedAt: new Date().toISOString()
                        }
                    }
                }
            }, 'admin');

            const checkoutRes = await executeRequest(sendOrderHandler, {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin: 'https://orva-store.com' },
                socket: { remoteAddress: '127.0.0.1' },
                body: {
                    fullName: 'Empirical Broken HTML Customer',
                    phone: '0553' + Math.floor(100000 + Math.random() * 900000),
                    wilaya: '16',
                    commune: 'الجزائر الوسطى',
                    packId: 'pack1',
                    quantity: 1
                }
            });

            assert.strictEqual(checkoutRes.statusCode, 200, 'Order must succeed 200 despite broken HTML');
            assert.strictEqual(checkoutRes.body.success, true);
        });

        await challengeTest('CH-03-04', 'FALLBACK', 'Checkout succeeds with 200 OK when template contains malicious XSS injection payloads', async () => {
            updateSettings({
                telegram: {
                    templates: {
                        ORDER_CREATED: {
                            enabled: true,
                            activeTemplate: 'Order: {{order_id}} <script>evil()</script><iframe src="javascript:alert(1)"> <img src=x onerror=alert(2)>',
                            updatedAt: new Date().toISOString()
                        }
                    }
                }
            }, 'admin');

            mockTelegramDispatches.length = 0;
            const checkoutRes = await executeRequest(sendOrderHandler, {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin: 'https://orva-store.com' },
                socket: { remoteAddress: '127.0.0.1' },
                body: {
                    fullName: 'Empirical Injection Customer',
                    phone: '0554' + Math.floor(100000 + Math.random() * 900000),
                    wilaya: '16',
                    commune: 'الجزائر الوسطى',
                    packId: 'pack1',
                    quantity: 1
                }
            });

            assert.strictEqual(checkoutRes.statusCode, 200);
            assert.strictEqual(checkoutRes.body.success, true);
            await new Promise((r) => setTimeout(r, 200));
            if (mockTelegramDispatches.length > 0) {
                const text = mockTelegramDispatches[mockTelegramDispatches.length - 1].payload.text;
                assert.ok(!text.includes('<script>'), 'Must not render unescaped <script>');
                assert.ok(!text.includes('<iframe'), 'Must not render unescaped <iframe>');
            }
        });

        await challengeTest('CH-03-05', 'FALLBACK', 'Checkout succeeds with 200 OK when template references exclusively unknown variables', async () => {
            updateSettings({
                telegram: {
                    templates: {
                        ORDER_CREATED: {
                            enabled: true,
                            activeTemplate: 'Order Info: {{nonexistent_alpha}} {{phantom_var_99}} {{bogus_variable_xyz}}',
                            updatedAt: new Date().toISOString()
                        }
                    }
                }
            }, 'admin');

            mockTelegramDispatches.length = 0;
            const checkoutRes = await executeRequest(sendOrderHandler, {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin: 'https://orva-store.com' },
                socket: { remoteAddress: '127.0.0.1' },
                body: {
                    fullName: 'Empirical Unknown Var Customer',
                    phone: '0555' + Math.floor(100000 + Math.random() * 900000),
                    wilaya: '16',
                    commune: 'الجزائر الوسطى',
                    packId: 'pack1',
                    quantity: 1
                }
            });

            assert.strictEqual(checkoutRes.statusCode, 200);
            assert.strictEqual(checkoutRes.body.success, true);
            await new Promise((r) => setTimeout(r, 200));
            if (mockTelegramDispatches.length > 0) {
                const text = mockTelegramDispatches[mockTelegramDispatches.length - 1].payload.text;
                assert.ok(!text.includes('undefined'), 'Must NEVER render literal "undefined"');
                assert.ok(!text.includes('null'), 'Must NEVER render literal "null"');
            }
        });

        await challengeTest('CH-03-06', 'FALLBACK', 'Checkout succeeds with 200 OK when Telegram API suffers complete outage (HTTP 500 & TIMEOUT)', async () => {
            mockTelegramError = 'HTTP_500';
            const checkoutRes1 = await executeRequest(sendOrderHandler, {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin: 'https://orva-store.com' },
                socket: { remoteAddress: '127.0.0.1' },
                body: {
                    fullName: 'Outage Customer 500',
                    phone: '0556' + Math.floor(100000 + Math.random() * 900000),
                    wilaya: '16',
                    commune: 'الجزائر الوسطى',
                    packId: 'pack1',
                    quantity: 1
                }
            });
            assert.strictEqual(checkoutRes1.statusCode, 200, 'HTTP 500 outage must NOT fail checkout');
            assert.strictEqual(checkoutRes1.body.success, true);

            mockTelegramError = 'TIMEOUT';
            const checkoutRes2 = await executeRequest(sendOrderHandler, {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin: 'https://orva-store.com' },
                socket: { remoteAddress: '127.0.0.1' },
                body: {
                    fullName: 'Outage Customer Timeout',
                    phone: '0557' + Math.floor(100000 + Math.random() * 900000),
                    wilaya: '16',
                    commune: 'الجزائر الوسطى',
                    packId: 'pack1',
                    quantity: 1
                }
            });
            assert.strictEqual(checkoutRes2.statusCode, 200, 'Telegram timeout must NOT fail checkout');
            assert.strictEqual(checkoutRes2.body.success, true);
            mockTelegramError = null;
        });

        await challengeTest('CH-03-07', 'FALLBACK', 'Direct buildMessage fallback verification across disabled, empty, and invalid inputs', () => {
            const defaultMsg = buildDefaultMessage('ORDER_CREATED', 'ORD-CHALLENGE', { customerName: 'Test' });

            // 1. Disabled/null custom template
            const out1 = buildMessage('ORDER_CREATED', 'ORD-CHALLENGE', { customerName: 'Test' }, null);
            assert.strictEqual(out1, defaultMsg, 'Null custom template must return default');

            // 2. Empty string
            const out2 = buildMessage('ORDER_CREATED', 'ORD-CHALLENGE', { customerName: 'Test' }, '   \n  ');
            assert.strictEqual(out2, defaultMsg, 'Whitespace custom template must return default');

            // 3. Non-string object
            const out3 = buildMessage('ORDER_CREATED', 'ORD-CHALLENGE', { customerName: 'Test' }, { broken: true });
            assert.strictEqual(out3, defaultMsg, 'Object custom template must return default');
        });

        // =============================================================================
        // CATEGORY 4: CSRF REJECTION ON MALICIOUS ORIGIN / REFERER HEADERS
        // =============================================================================
        console.log('\n--- CATEGORY 4: CSRF & ORIGIN SECURITY ENFORCEMENTS ---');

        const maliciousOrigins = [
            { label: 'Untrusted Domain', origin: 'https://attacker.com' },
            { label: 'Subdomain Hijack', origin: 'https://orva-store.com.attacker.com' },
            { label: 'Prefix Hijack', origin: 'https://evil-orva-store.com' },
            { label: 'Scheme Downgrade', origin: 'http://orva-store.com' },
            { label: 'Sandboxed Null Origin', origin: 'null' },
            { label: 'Data URI Origin', origin: 'data:text/html,alert(1)' },
            { label: 'Localhost Port Hijack', origin: 'http://localhost:9999' }
        ];

        for (let i = 0; i < maliciousOrigins.length; i++) {
            const { label, origin } = maliciousOrigins[i];
            await challengeTest(`CH-04-0${i + 1}`, 'CSRF', `Reject mutating request with malicious Origin (${label}: ${origin})`, async () => {
                const res = await executeRequest(adminSettingsHandler, {
                    method: 'POST',
                    headers: {
                        authorization: AUTH_HEADER.authorization,
                        origin: origin
                    },
                    body: { action: 'toggle_template', event: 'ORDER_CREATED', enabled: false }
                });
                assert.strictEqual(res.statusCode, 403, `Must reject with 403 Forbidden for Origin: ${origin}`);
                assert.strictEqual(res.body.error, 'CSRF_REJECTED', 'Must return error code CSRF_REJECTED');
            });
        }

        await challengeTest('CH-04-08', 'CSRF', 'Sec-Fetch-Site: cross-site is rejected with 403 CSRF_REJECTED even with allowed origin', async () => {
            const res = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: {
                    authorization: AUTH_HEADER.authorization,
                    origin: 'https://orva-store.com',
                    'sec-fetch-site': 'cross-site'
                },
                body: { action: 'toggle_template', event: 'ORDER_CREATED', enabled: true }
            });
            assert.strictEqual(res.statusCode, 403);
            assert.strictEqual(res.body.error, 'CSRF_REJECTED');
        });

        await challengeTest('CH-04-09', 'CSRF', 'Untrusted Referer is rejected with 403 CSRF_REJECTED when Origin is omitted', async () => {
            const res = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: {
                    authorization: AUTH_HEADER.authorization,
                    referer: 'https://malicious-forum.net/csrf-exploit.html'
                },
                body: { action: 'activate_template', event: 'ORDER_CREATED' }
            });
            assert.strictEqual(res.statusCode, 403);
            assert.strictEqual(res.body.error, 'CSRF_REJECTED');
        });

        await challengeTest('CH-04-10', 'CSRF', 'Legitimate allowed origins succeed with 200 OK', async () => {
            const allowed = [
                'https://orva-store.com',
                'https://staging.orva-store.com',
                'http://localhost:3000'
            ];
            for (const origin of allowed) {
                const res = await executeRequest(adminSettingsHandler, {
                    method: 'POST',
                    headers: {
                        authorization: AUTH_HEADER.authorization,
                        origin: origin
                    },
                    body: { action: 'toggle_template', event: 'ORDER_CREATED', enabled: true }
                });
                assert.strictEqual(res.statusCode, 200, `Origin ${origin} must be accepted 200 OK`);
                assert.strictEqual(res.body.success, true);
            }
        });

        if (phpBin) {
            await challengeTest('CH-04-11', 'CSRF_PHP', 'PHP 8.3 CLI rejects untrusted Origins with 403 CSRF_REJECTED', async () => {
                const out1 = runPhpCli(`
                    define('ORVA_API', true);
                    \$_SERVER['REQUEST_METHOD'] = 'POST';
                    \$_SERVER['HTTP_ORIGIN'] = 'https://attacker.com';
                    \$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . (getenv('ADMIN_API_TOKEN') ?: 'orva-admin-2026-secure');
                    require 'api/admin-settings.php';
                `);
                assert.ok(out1.includes('CSRF_REJECTED'), 'PHP must reject https://attacker.com');

                const out2 = runPhpCli(`
                    define('ORVA_API', true);
                    \$_SERVER['REQUEST_METHOD'] = 'POST';
                    \$_SERVER['HTTP_ORIGIN'] = 'https://orva-store.com.attacker.com';
                    \$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . (getenv('ADMIN_API_TOKEN') ?: 'orva-admin-2026-secure');
                    require 'api/admin-settings.php';
                `);
                assert.ok(out2.includes('CSRF_REJECTED'), 'PHP must reject subdomain hijack');
            });

            await challengeTest('CH-04-12', 'CSRF_PHP', 'PHP 8.3 CLI accepts legitimate origins (orva-store.com & staging)', async () => {
                const out = runPhpCli(`
                    define('ORVA_API', true);
                    \$_SERVER['REQUEST_METHOD'] = 'POST';
                    \$_SERVER['HTTP_ORIGIN'] = 'https://staging.orva-store.com';
                    \$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . (getenv('ADMIN_API_TOKEN') ?: 'orva-admin-2026-secure');
                    \$_SERVER['CONTENT_TYPE'] = 'application/json';
                    require 'api/admin-settings.php';
                `, { action: 'toggle_template', event: 'ORDER_CREATED', enabled: true });

                const parsed = JSON.parse(out);
                assert.strictEqual(parsed.success, true, 'PHP must accept staging origin');
            });
        }

    } finally {
        deactivateMocks();

        // Restore original files
        if (backupSettings) fs.writeFileSync(SETTINGS_FILE, backupSettings);
        if (backupInventory) fs.writeFileSync(INVENTORY_FILE, backupInventory, 'utf8');
        if (backupLedger) fs.writeFileSync(LEDGER_FILE, backupLedger, 'utf8');
        console.log('\n[CLEANUP] Sandbox state, inventory, and encrypted settings restored.');
    }

    // =============================================================================
    // FINAL EMPIRICAL SUMMARY & VERDICT
    // =============================================================================
    console.log('\n================================================================================');
    console.log('   ORVA STORE — RESILIENCE CHALLENGER 2 EMPIRICAL SUMMARY');
    console.log('================================================================================');
    console.log(`TOTAL EXECUTED: ${totalCount}`);
    console.log(`PASSED:         ${passedCount} (${Math.round((passedCount / totalCount) * 100)}%)`);
    console.log(`FAILED:         ${failedCount}`);
    console.log('================================================================================');

    if (failedCount > 0) {
        console.error('💥 EMPIRICAL CHALLENGE FAILED — DEFECTS DISCOVERED:');
        failureDetails.forEach(f => {
            console.error(`  - [${f.id}] [${f.category}] ${f.description}: ${f.error}`);
        });
        process.exit(1);
    } else {
        console.log('🎉 VERDICT: 100% EMPIRICAL CHALLENGE PASSED — ZERO REGRESSIONS, RESILIENT ISOLATION VERIFIED');
        process.exit(0);
    }
})();
