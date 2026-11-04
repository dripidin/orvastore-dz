'use strict';
// =============================================================================
// ORVA STORE — Phase 8F Adversarial Stress Test Suite
// Empirical Challenger: Notification Dispatching & Fallback Resilience
// Module: lib/telegram-notifier.js
// =============================================================================

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const assert = require('node:assert');
const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');

const {
    dispatchTelegramNotification,
    buildMessage,
    buildDefaultMessage,
    maskPhone,
    sanitizeError,
    readLedger,
    resetTestLedger
} = require('../lib/telegram-notifier');

const {
    getEffectiveSettings,
    updateSettings,
    SETTINGS_FILE
} = require('../lib/admin-settings-store');

const sendOrderHandler = require('../api/send-order');

const LEDGER_FILE = path.join(__dirname, '..', 'data', 'telegram-dispatch-ledger.json');

// =============================================================================
// Mock HTTPS Interceptor for api.telegram.org
// =============================================================================
const originalHttpsRequest = https.request;
const recordedRequests = [];
let mockBehaviorQueue = []; // Array of handler functions or response objects
let fallbackBehavior = { statusCode: 200, ok: true, result: { message_id: 11111 } };

function installTelegramMock() {
    recordedRequests.length = 0;
    mockBehaviorQueue.length = 0;
    fallbackBehavior = { statusCode: 200, ok: true, result: { message_id: 11111 } };

    https.request = function(options, callback) {
        const urlStr = typeof options === 'string'
            ? options
            : ((options.protocol || 'https:') + '//' + (options.hostname || '') + (options.path || ''));

        if (urlStr.includes('api.telegram.org')) {
            const req = new (require('node:events').EventEmitter)();
            req._chunks = [];
            req.write = function(chunk) {
                if (chunk) req._chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            };
            req.end = function(chunk) {
                if (chunk) req.write(chunk);
                process.nextTick(() => {
                    const rawBody = Buffer.concat(req._chunks).toString('utf8');
                    let parsedPayload = {};
                    try { parsedPayload = JSON.parse(rawBody); } catch (_) { parsedPayload = { raw: rawBody }; }

                    const reqRecord = {
                        url: urlStr,
                        path: options.path,
                        method: options.method || 'POST',
                        headers: options.headers || {},
                        payload: parsedPayload,
                        timestamp: new Date().toISOString()
                    };
                    recordedRequests.push(reqRecord);

                    // Determine mock behavior
                    let behavior = mockBehaviorQueue.length > 0 ? mockBehaviorQueue.shift() : fallbackBehavior;

                    if (typeof behavior === 'function') {
                        behavior = behavior(reqRecord);
                    }

                    if (behavior.type === 'TIMEOUT') {
                        req.emit('timeout');
                        req.emit('error', new Error('TELEGRAM_TIMEOUT'));
                        return;
                    }

                    if (behavior.type === 'NETWORK_ERROR') {
                        req.emit('error', new Error('ENOTFOUND api.telegram.org'));
                        return;
                    }

                    if (behavior.type === 'CONN_RESET') {
                        req.emit('error', new Error('read ECONNRESET'));
                        return;
                    }

                    const res = new (require('node:events').EventEmitter)();
                    res.statusCode = behavior.statusCode || 200;
                    res.headers = { 'content-type': 'application/json' };
                    if (typeof callback === 'function') callback(res);

                    const resBody = JSON.stringify(behavior.body || {
                        ok: behavior.ok !== false,
                        result: behavior.result || { message_id: Math.floor(100000 + Math.random() * 900000) },
                        description: behavior.description
                    });
                    res.emit('data', resBody);
                    res.emit('end');
                });
            };
            req.destroy = function(err) {
                req.emit('error', err || new Error('Request destroyed'));
            };
            return req;
        }

        return originalHttpsRequest.apply(https, arguments);
    };
}

function uninstallTelegramMock() {
    https.request = originalHttpsRequest;
}

// In-process API handler execution
function executeHandler(handler, req) {
    return new Promise((resolve) => {
        let statusCode = 200;
        let responseHeaders = {};
        let responseBody = null;

        const res = {
            setHeader: (k, v) => { responseHeaders[k.toLowerCase()] = v; },
            getHeader: (k) => responseHeaders[k.toLowerCase()],
            status: (code) => {
                statusCode = code;
                return res;
            },
            json: (data) => {
                responseBody = data;
                resolve({ statusCode, headers: responseHeaders, body: data });
            },
            send: (data) => {
                responseBody = data;
                resolve({ statusCode, headers: responseHeaders, body: data });
            },
            end: () => {
                resolve({ statusCode, headers: responseHeaders, body: responseBody });
            }
        };

        try {
            const p = handler(req, res);
            if (p && typeof p.then === 'function') {
                p.catch(err => {
                    resolve({ statusCode: 500, headers: responseHeaders, body: { error: err.message } });
                });
            }
        } catch (err) {
            resolve({ statusCode: 500, headers: responseHeaders, body: { error: err.message } });
        }
    });
}

// Console warning interceptor
const capturedWarnings = [];
const originalConsoleWarn = console.warn;
function captureWarningsStart() {
    capturedWarnings.length = 0;
    console.warn = function(...args) {
        capturedWarnings.push(args.join(' '));
        // Also call original for debugging if needed
    };
}
function captureWarningsEnd() {
    console.warn = originalConsoleWarn;
}

// Settings and Ledger backup
let ledgerBackup = null;
let settingsBackup = null;

function saveState() {
    try {
        if (fs.existsSync(LEDGER_FILE)) {
            ledgerBackup = fs.readFileSync(LEDGER_FILE);
        }
    } catch (_) {}
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            settingsBackup = fs.readFileSync(SETTINGS_FILE);
        }
    } catch (_) {}
}

function restoreState() {
    try {
        if (ledgerBackup !== null) {
            fs.writeFileSync(LEDGER_FILE, ledgerBackup);
        } else if (fs.existsSync(LEDGER_FILE)) {
            fs.unlinkSync(LEDGER_FILE);
        }
    } catch (_) {}
    try {
        if (settingsBackup !== null && fs.existsSync(SETTINGS_FILE)) {
            fs.writeFileSync(SETTINGS_FILE, settingsBackup);
        }
    } catch (_) {}
}

// Test Runner Harness
let passedCount = 0;
let failedCount = 0;
const results = [];

function assertTest(name, condition, details = '') {
    if (condition) {
        passedCount++;
        console.log(`  ✅ PASS: ${name} ${details ? `(${details})` : ''}`);
        results.push({ name, passed: true, details });
    } else {
        failedCount++;
        console.error(`  ❌ FAIL: ${name} ${details ? `(${details})` : ''}`);
        results.push({ name, passed: false, details });
    }
}

// =============================================================================
// MAIN ADVERSARIAL CHALLENGE EXECUTION
// =============================================================================
async function runAdversarialChallenges() {
    console.log('================================================================================');
    console.log('   ORVA STORE — TELEGRAM NOTIFIER ADVERSARIAL STRESS TEST SUITE');
    console.log('   Focus: Fallback Resilience, Malformed Inputs, Order Decoupling, Deduplication');
    console.log('================================================================================\n');

    saveState();
    installTelegramMock();
    resetTestLedger();

    // Guard environment for live HTTP mock testing
    const originalNodeEnv = process.env.NODE_ENV;
    const originalMockTg = process.env.MOCK_TELEGRAM;

    function setLiveMockMode() {
        process.env.NODE_ENV = 'development';
        delete process.env.MOCK_TELEGRAM;
    }

    function restoreEnvMode() {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalMockTg !== undefined) {
            process.env.MOCK_TELEGRAM = originalMockTg;
        } else {
            delete process.env.MOCK_TELEGRAM;
        }
    }

    try {
        // =====================================================================
        // CHALLENGE 1: Custom template returning fatal Telegram HTML entity errors
        // =====================================================================
        console.log('--- CHALLENGE 1: HTML Entity Parsing Error & Fallback Resilience ---');
        setLiveMockMode();

        // 1.1 Custom template returning fatal entity parsing error on 1st request -> auto retries with default message
        {
            resetTestLedger();
            recordedRequests.length = 0;
            mockBehaviorQueue.length = 0;

            // First request fails with Telegram entity parse error
            mockBehaviorQueue.push({
                statusCode: 400,
                ok: false,
                body: {
                    ok: false,
                    error_code: 400,
                    description: "Bad Request: can't parse entities: Character '<' is reserved and must be escaped"
                }
            });
            // Second request (retry) succeeds with default template
            mockBehaviorQueue.push({
                statusCode: 200,
                ok: true,
                body: { ok: true, result: { message_id: 88801 } }
            });

            captureWarningsStart();
            const orderId = 'ORVA-ADV-ENTITY-01';
            const customTpl = '<b>New Order Alert:</b> <unclosed_bad_tag> {{order_id}} <script>';

            const res = await dispatchTelegramNotification({
                event: 'ORDER_CREATED',
                orderId: orderId,
                data: { fullName: 'Samir Benali', grandTotal: 7500, phone: '0555123456' },
                credentials: {
                    botToken: 'adv_bot_token_123',
                    chatId: '-100advchat',
                    template: customTpl,
                    mock: false
                }
            });
            captureWarningsEnd();

            // Assertions
            assertTest('1.1.1 Dispatcher catches parse error and succeeds on fallback', res.success === true);
            assertTest('1.1.2 Dispatcher sets fallback: true flag in return object', res.fallback === true);
            assertTest('1.1.3 Dispatcher performed exactly 2 HTTP requests (1 custom, 1 fallback default)', recordedRequests.length === 2, `Actual: ${recordedRequests.length}`);

            // Inspect request 1 payload (custom template)
            const req1Text = recordedRequests[0]?.payload?.text || '';
            assertTest('1.1.4 First request contained custom template text', req1Text.includes('New Order Alert:'));

            // Inspect request 2 payload (default template)
            const req2Text = recordedRequests[1]?.payload?.text || '';
            assertTest('1.1.5 Second request contained built-in default template text', req2Text.includes('طلب جديد') && req2Text.includes(orderId));

            // Verify diagnostic warning was logged
            const warningLogged = capturedWarnings.some(w =>
                w.includes('[Telegram Notifier Warning]') &&
                w.includes('Custom template rejected by Telegram HTML parser') &&
                w.includes("can't parse entities")
            );
            assertTest('1.1.6 Diagnostic warning logged to console.warn with Telegram parse error reason', warningLogged);

            // Verify ledger recorded status DISPATCHED with fallback: true
            const ledger = readLedger();
            const ledgerEntry = ledger[`ORDER_CREATED_${orderId}_none`];
            assertTest('1.1.7 Ledger recorded status DISPATCHED with fallback: true',
                ledgerEntry && ledgerEntry.status === 'DISPATCHED' && ledgerEntry.fallback === true
            );
        }

        // 1.2 Custom template from activeTemplate in settings triggers entity error
        {
            resetTestLedger();
            recordedRequests.length = 0;
            mockBehaviorQueue.length = 0;

            mockBehaviorQueue.push({
                statusCode: 400,
                ok: false,
                body: {
                    ok: false,
                    error_code: 400,
                    description: "Bad Request: can't parse entities: Tag 'i' must be closed"
                }
            });
            mockBehaviorQueue.push({
                statusCode: 200,
                ok: true,
                body: { ok: true, result: { message_id: 88802 } }
            });

            captureWarningsStart();
            const orderId = 'ORVA-ADV-ENTITY-02';
            // We use credentials.template with another entity error syntax
            const res = await dispatchTelegramNotification({
                event: 'SHIPMENT_CREATED',
                orderId: orderId,
                data: { courierName: 'Yalidine Express', trackingNumber: 'TRK-ADV-02' },
                credentials: {
                    botToken: 'adv_bot_token_123',
                    chatId: '-100advchat',
                    template: '<i>Unclosed tag shipment: {{tracking_code}}',
                    mock: false
                }
            });
            captureWarningsEnd();

            assertTest('1.2.1 SHIPMENT_CREATED fallback retry succeeded', res.success === true && res.fallback === true);
            assertTest('1.2.2 Second request dispatched built-in shipment default message',
                recordedRequests[1]?.payload?.text.includes('تم إنشاء بوليصة الشحن بنجاح')
            );
        }

        // 1.3 Non-entity Telegram error (e.g. 401 Unauthorized or 403 Forbidden) MUST NOT trigger template retry
        {
            resetTestLedger();
            recordedRequests.length = 0;
            mockBehaviorQueue.length = 0;

            mockBehaviorQueue.push({
                statusCode: 401,
                ok: false,
                body: { ok: false, error_code: 401, description: 'Unauthorized' }
            });

            captureWarningsStart();
            const orderId = 'ORVA-ADV-AUTH-01';
            const res = await dispatchTelegramNotification({
                event: 'ORDER_CREATED',
                orderId: orderId,
                data: { grandTotal: 5000 },
                credentials: {
                    botToken: 'bad_token',
                    chatId: '-100bad',
                    template: '<b>Valid Template</b> {{order_id}}',
                    mock: false
                }
            });
            captureWarningsEnd();

            assertTest('1.3.1 Non-entity error returns success: false without throwing', res.success === false);
            assertTest('1.3.2 Non-entity error does NOT retry (exactly 1 request made)', recordedRequests.length === 1);
            assertTest('1.3.3 Fallback flag is NOT set on auth rejection', res.fallback === undefined);
        }

        // 1.4 Double failure: Entity error on custom template, AND retry with default also fails (e.g. network drops)
        {
            resetTestLedger();
            recordedRequests.length = 0;
            mockBehaviorQueue.length = 0;

            // 1st request: entity error
            mockBehaviorQueue.push({
                statusCode: 400,
                ok: false,
                body: { ok: false, error_code: 400, description: "can't parse entities: tag error" }
            });
            // 2nd request (retry): connection drops
            mockBehaviorQueue.push({ type: 'CONN_RESET' });

            captureWarningsStart();
            const orderId = 'ORVA-ADV-DOUBLE-FAIL';
            const res = await dispatchTelegramNotification({
                event: 'ORDER_CREATED',
                orderId: orderId,
                data: { grandTotal: 6000 },
                credentials: {
                    botToken: 'adv_token',
                    chatId: '-100adv',
                    template: '<b>Bad <</b> {{order_id}}',
                    mock: false
                }
            });
            captureWarningsEnd();

            assertTest('1.4.1 Double failure caught cleanly with zero uncaught rejections', res.success === false);
            assertTest('1.4.2 Both attempts executed before aborting', recordedRequests.length === 2);
            assertTest('1.4.3 Error contains sanitized message', typeof res.error === 'string' && res.error.length > 0);
        }

        // 1.5 Default template itself triggering entity error (no custom template): no infinite loop
        {
            resetTestLedger();
            recordedRequests.length = 0;
            mockBehaviorQueue.length = 0;

            mockBehaviorQueue.push({
                statusCode: 400,
                ok: false,
                body: { ok: false, error_code: 400, description: "can't parse entities: unexpected error" }
            });

            captureWarningsStart();
            const orderId = 'ORVA-ADV-DEFAULT-PARSE';
            const res = await dispatchTelegramNotification({
                event: 'ORDER_CREATED',
                orderId: orderId,
                data: { grandTotal: 6000 },
                credentials: {
                    botToken: 'adv_token',
                    chatId: '-100adv',
                    template: null, // No custom template
                    mock: false
                }
            });
            captureWarningsEnd();

            assertTest('1.5.1 Default template error does NOT retry in infinite loop (exactly 1 request)', recordedRequests.length === 1);
            assertTest('1.5.2 Returns clean error failure', res.success === false);
        }

        // =====================================================================
        // CHALLENGE 2: Invoking dispatchTelegramNotification with Malformed / Null Inputs
        // =====================================================================
        console.log('\n--- CHALLENGE 2: Null / Empty / Malformed Arguments Robustness ---');

        // 2.1 data: null, orderId: null, credentials: null
        {
            let res = null;
            let threw = false;
            try {
                res = await dispatchTelegramNotification({ data: null, orderId: null, credentials: null });
            } catch (e) {
                threw = true;
            }
            assertTest('2.1.1 { data: null, orderId: null, credentials: null } does not throw', threw === false);
            assertTest('2.1.2 Missing event or orderId returns success: false error', res && res.success === false && res.error === 'MISSING_EVENT_OR_ORDER_ID');
        }

        // 2.2 Empty object {}
        {
            let res = null;
            let threw = false;
            try {
                res = await dispatchTelegramNotification({});
            } catch (e) {
                threw = true;
            }
            assertTest('2.2.1 dispatchTelegramNotification({}) does not throw', threw === false);
            assertTest('2.2.2 Empty object returns MISSING_EVENT_OR_ORDER_ID', res && res.error === 'MISSING_EVENT_OR_ORDER_ID');
        }

        // 2.3 event: 'ORDER_CREATED', orderId: null
        {
            const res = await dispatchTelegramNotification({ event: 'ORDER_CREATED', orderId: null });
            assertTest('2.3.1 event present but orderId null returns MISSING_EVENT_OR_ORDER_ID', res && res.error === 'MISSING_EVENT_OR_ORDER_ID');
        }

        // 2.4 event: null, orderId: 'ORVA-VALID-ID'
        {
            const res = await dispatchTelegramNotification({ event: null, orderId: 'ORVA-VALID-ID' });
            assertTest('2.4.1 event null but orderId present returns MISSING_EVENT_OR_ORDER_ID', res && res.error === 'MISSING_EVENT_OR_ORDER_ID');
        }

        // 2.5 data: null with valid event, orderId and mock credentials (CRITICAL: line 253/safeData regression guard)
        {
            let res = null;
            let threw = false;
            try {
                res = await dispatchTelegramNotification({
                    event: 'ORDER_CREATED',
                    orderId: 'ORVA-NULL-DATA-REGRESSION',
                    data: null,
                    credentials: { mock: true, botToken: 'mock_tok', chatId: '-100mock' }
                });
            } catch (e) {
                threw = true;
            }
            assertTest('2.5.1 data: null does not throw TypeError on trackingNumber', threw === false);
            assertTest('2.5.2 data: null successfully resolves simulated dispatch', res && res.success === true && res.simulated === true);
        }

        // 2.6 credentials: null with valid event and orderId
        {
            let res = null;
            let threw = false;
            try {
                res = await dispatchTelegramNotification({
                    event: 'ORDER_CREATED',
                    orderId: 'ORVA-NULL-CREDS-01',
                    data: {},
                    credentials: null
                });
            } catch (e) {
                threw = true;
            }
            assertTest('2.6.1 credentials: null does not throw TypeError on creds.botToken', threw === false);
            assertTest('2.6.2 credentials: null returns structured response object', res && typeof res === 'object' && typeof res.success === 'boolean');
        }

        // 2.7 Unknown event name: 'UNKNOWN_EVENT_TEST_XYZ' with data: null and credentials: null
        {
            let res = null;
            let threw = false;
            try {
                res = await dispatchTelegramNotification({
                    event: 'UNKNOWN_EVENT_TEST_XYZ',
                    orderId: 'ORVA-UNKNOWN-01',
                    data: null,
                    credentials: { mock: true, botToken: 'mock_tok', chatId: '-100mock' }
                });
            } catch (e) {
                threw = true;
            }
            assertTest('2.7.1 Unknown event name does not crash or throw', threw === false);
            assertTest('2.7.2 Unknown event falls back to default case with structured simulated success', res && res.success === true);
            assertTest('2.7.3 Unknown event message includes event name safely', res?.messageText?.includes('UNKNOWN_EVENT_TEST_XYZ'));
        }

        // 2.8 data as non-object primitives: string, number, boolean
        {
            let threw = false;
            try {
                await dispatchTelegramNotification({
                    event: 'ORDER_CREATED',
                    orderId: 'ORVA-PRIMITIVE-DATA-1',
                    data: 'primitive_string_value',
                    credentials: { mock: true, botToken: 'mock_tok', chatId: '-100mock' }
                });
                await dispatchTelegramNotification({
                    event: 'ORDER_CREATED',
                    orderId: 'ORVA-PRIMITIVE-DATA-2',
                    data: 123456,
                    credentials: { mock: true, botToken: 'mock_tok', chatId: '-100mock' }
                });
                await dispatchTelegramNotification({
                    event: 'ORDER_CREATED',
                    orderId: 'ORVA-PRIMITIVE-DATA-3',
                    data: true,
                    credentials: { mock: true, botToken: 'mock_tok', chatId: '-100mock' }
                });
            } catch (e) {
                threw = true;
            }
            assertTest('2.8.1 data passed as primitive strings/numbers/booleans handled safely without throwing', threw === false);
        }

        // 2.9 Prototype pollution attempt via data
        {
            const maliciousData = JSON.parse('{"__proto__":{"isAdmin":true},"trackingNumber":"TRK-POLLUTION"}');
            const res = await dispatchTelegramNotification({
                event: 'SHIPMENT_CREATED',
                orderId: 'ORVA-POLLUTION-01',
                data: maliciousData,
                credentials: { mock: true, botToken: 'mock_tok', chatId: '-100mock' }
            });
            assertTest('2.9.1 Prototype pollution payload processed safely', res.success === true);
            assertTest('2.9.2 Object prototype remains unpolluted', ({}).isAdmin === undefined);
        }

        // 2.10 Empty string event and orderId
        {
            const res = await dispatchTelegramNotification({ event: '', orderId: '' });
            assertTest('2.10.1 Empty strings event and orderId return MISSING_EVENT_OR_ORDER_ID', res.error === 'MISSING_EVENT_OR_ORDER_ID');
        }

        // =====================================================================
        // CHALLENGE 3: Order Decoupling Under Network Failure / Rejection
        // =====================================================================
        console.log('\n--- CHALLENGE 3: Order Decoupling Under Telegram Failures ---');
        setLiveMockMode();

        // 3.1 Checkout submission under Telegram API TIMEOUT
        {
            mockBehaviorQueue.length = 0;
            fallbackBehavior = { type: 'TIMEOUT' };
            const phone = '0551' + Math.floor(100000 + Math.random() * 900000);

            const res = await executeHandler(sendOrderHandler, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    origin: 'https://orva-store.com',
                    'x-forwarded-for': '127.0.0.1'
                },
                socket: { remoteAddress: '127.0.0.1' },
                body: {
                    fullName: 'Decoupled Timeout User',
                    phone: phone,
                    wilaya: '16',
                    commune: 'الجزائر الوسطى',
                    packId: 'pack1',
                    quantity: 1,
                    deliveryType: 'home'
                }
            });

            assertTest('3.1.1 Order succeeds (HTTP 200) under Telegram TIMEOUT', res.statusCode === 200, `Status: ${res.statusCode}`);
            assertTest('3.1.2 Order body returns success: true and valid orderId', res.body?.success === true && res.body?.orderId);
        }

        // 3.2 Checkout submission under Telegram DNS / Network Failure
        {
            mockBehaviorQueue.length = 0;
            fallbackBehavior = { type: 'NETWORK_ERROR' };
            const phone = '0552' + Math.floor(100000 + Math.random() * 900000);

            const res = await executeHandler(sendOrderHandler, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    origin: 'https://orva-store.com',
                    'x-forwarded-for': '127.0.0.1'
                },
                socket: { remoteAddress: '127.0.0.1' },
                body: {
                    fullName: 'Decoupled DNS User',
                    phone: phone,
                    wilaya: '16',
                    commune: 'الجزائر الوسطى',
                    packId: 'pack1',
                    quantity: 1,
                    deliveryType: 'home'
                }
            });

            assertTest('3.2.1 Order succeeds (HTTP 200) under Telegram DNS Failure (ENOTFOUND)', res.statusCode === 200);
            assertTest('3.2.2 Order body contains confirmed orderId and grandTotal', res.body?.success === true && res.body?.grandTotal);
        }

        // 3.3 Checkout submission under Telegram HTTP 500 Internal Server Error
        {
            mockBehaviorQueue.length = 0;
            fallbackBehavior = { statusCode: 500, ok: false, body: { ok: false, error_code: 500, description: 'Internal Server Error' } };
            const phone = '0553' + Math.floor(100000 + Math.random() * 900000);

            const res = await executeHandler(sendOrderHandler, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    origin: 'https://orva-store.com',
                    'x-forwarded-for': '127.0.0.1'
                },
                socket: { remoteAddress: '127.0.0.1' },
                body: {
                    fullName: 'Decoupled 500 User',
                    phone: phone,
                    wilaya: '16',
                    commune: 'الجزائر الوسطى',
                    packId: 'pack1',
                    quantity: 1,
                    deliveryType: 'home'
                }
            });

            assertTest('3.3.1 Order succeeds (HTTP 200) under Telegram HTTP 500 Outage', res.statusCode === 200);
            assertTest('3.3.2 Response does not leak Telegram internal error details to client', !JSON.stringify(res.body).includes('Telegram'));
        }

        // 3.4 Checkout submission under Telegram HTTP 401 Unauthorized
        {
            mockBehaviorQueue.length = 0;
            fallbackBehavior = { statusCode: 401, ok: false, body: { ok: false, error_code: 401, description: 'Unauthorized' } };
            const phone = '0554' + Math.floor(100000 + Math.random() * 900000);

            const res = await executeHandler(sendOrderHandler, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    origin: 'https://orva-store.com',
                    'x-forwarded-for': '127.0.0.1'
                },
                socket: { remoteAddress: '127.0.0.1' },
                body: {
                    fullName: 'Decoupled 401 User',
                    phone: phone,
                    wilaya: '16',
                    commune: 'الجزائر الوسطى',
                    packId: 'pack1',
                    quantity: 1,
                    deliveryType: 'home'
                }
            });

            assertTest('3.4.1 Order succeeds (HTTP 200) under Telegram HTTP 401 Unauthorized', res.statusCode === 200);
            assertTest('3.4.2 Order creation is 100% completed and customer receives confirmation', res.body?.success === true);
        }

        // 3.5 Checkout submission under Telegram HTTP 429 Rate Limit (Flood wait)
        {
            mockBehaviorQueue.length = 0;
            fallbackBehavior = {
                statusCode: 429,
                ok: false,
                body: { ok: false, error_code: 429, description: 'Too Many Requests: retry after 30', parameters: { retry_after: 30 } }
            };
            const phone = '0555' + Math.floor(100000 + Math.random() * 900000);

            const res = await executeHandler(sendOrderHandler, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    origin: 'https://orva-store.com',
                    'x-forwarded-for': '127.0.0.1'
                },
                socket: { remoteAddress: '127.0.0.1' },
                body: {
                    fullName: 'Decoupled 429 User',
                    phone: phone,
                    wilaya: '16',
                    commune: 'الجزائر الوسطى',
                    packId: 'pack1',
                    quantity: 1,
                    deliveryType: 'home'
                }
            });

            assertTest('3.5.1 Order succeeds (HTTP 200) when Telegram API returns HTTP 429 Flood Wait', res.statusCode === 200);
            assertTest('3.5.2 Client is not blocked by Telegram rate limits', res.body?.success === true);
        }

        // Wait for background async dispatches from Challenge 3 to fully settle
        await new Promise(r => setTimeout(r, 150));

        // =====================================================================
        // CHALLENGE 4: Ledger Deduplication & Redundant Network Request Prevention
        // =====================================================================
        console.log('\n--- CHALLENGE 4: Ledger Deduplication & Network Efficiency ---');
        setLiveMockMode();

        // 4.1 First dispatch sends HTTP request, second identical dispatch returns deduplicated with ZERO extra HTTP calls
        {
            resetTestLedger();
            recordedRequests.length = 0;
            mockBehaviorQueue.length = 0;
            fallbackBehavior = { statusCode: 200, ok: true, result: { message_id: 70001 } };

            const orderId = 'ORVA-DEDUP-TEST-01';
            const params = {
                event: 'ORDER_CREATED',
                orderId: orderId,
                data: { fullName: 'Dedup Customer', grandTotal: 9900 },
                credentials: { botToken: 'test_token', chatId: '-100test', mock: false }
            };

            // Attempt 1: First dispatch
            const res1 = await dispatchTelegramNotification(params);
            assertTest('4.1.1 First dispatch succeeds', res1.success === true);
            assertTest('4.1.2 First dispatch sent exactly 1 HTTP request to Telegram', recordedRequests.length === 1, `Actual: ${recordedRequests.length}`);

            // Attempt 2: Duplicate dispatch with identical parameters
            const res2 = await dispatchTelegramNotification(params);
            assertTest('4.1.3 Duplicate dispatch returns success: true', res2.success === true);
            assertTest('4.1.4 Duplicate dispatch returns deduplicated: true flag', res2.deduplicated === true);
            assertTest('4.1.5 Duplicate dispatch sent ZERO additional network requests (count remains 1)', recordedRequests.length === 1, `Count: ${recordedRequests.length}`);

            // Attempt 3: Third identical dispatch
            const res3 = await dispatchTelegramNotification(params);
            assertTest('4.1.6 Third identical dispatch still returns deduplicated: true', res3.deduplicated === true);
            assertTest('4.1.7 Total HTTP requests after 3 dispatches is still exactly 1', recordedRequests.length === 1);
        }

        // 4.2 Different event with same orderId MUST dispatch independently (distinct ledger key)
        {
            const orderId = 'ORVA-DEDUP-TEST-01'; // Same orderId as 4.1
            const initialReqCount = recordedRequests.length; // 1

            const res = await dispatchTelegramNotification({
                event: 'SHIPMENT_CREATED',
                orderId: orderId,
                data: { trackingNumber: 'TRK-DIFF-EVENT' },
                credentials: { botToken: 'test_token', chatId: '-100test', mock: false }
            });

            assertTest('4.2.1 Different event for same orderId is not blocked by deduplication', res.success === true);
            assertTest('4.2.2 Exactly 1 new HTTP request was sent for different event', recordedRequests.length === initialReqCount + 1);

            // Duplicate of the second event
            const resDup = await dispatchTelegramNotification({
                event: 'SHIPMENT_CREATED',
                orderId: orderId,
                data: { trackingNumber: 'TRK-DIFF-EVENT' },
                credentials: { botToken: 'test_token', chatId: '-100test', mock: false }
            });
            assertTest('4.2.3 Duplicate of second event is properly deduplicated', resDup.deduplicated === true);
            assertTest('4.2.4 Request count did not increase on duplicate second event', recordedRequests.length === initialReqCount + 1);
        }

        // 4.3 Same event and orderId, but DIFFERENT tracking numbers: MUST dispatch independently
        {
            const orderId = 'ORVA-DEDUP-TEST-02';
            const initialReqCount = recordedRequests.length;

            // Tracking A
            const resA1 = await dispatchTelegramNotification({
                event: 'STATUS_UPDATED',
                orderId: orderId,
                data: { trackingNumber: 'TRK-AAA-01', statusLabelAr: 'في الطريق' },
                credentials: { botToken: 'test_token', chatId: '-100test', mock: false }
            });
            assertTest('4.3.1 First tracking number dispatches successfully', resA1.success === true);
            assertTest('4.3.2 1 request sent for Tracking A', recordedRequests.length === initialReqCount + 1);

            // Tracking B (different tracking for same order)
            const resB1 = await dispatchTelegramNotification({
                event: 'STATUS_UPDATED',
                orderId: orderId,
                data: { trackingNumber: 'TRK-BBB-02', statusLabelAr: 'تم التسليم' },
                credentials: { botToken: 'test_token', chatId: '-100test', mock: false }
            });
            assertTest('4.3.3 Different tracking number for same order is NOT falsely deduplicated', resB1.success === true && !resB1.deduplicated);
            assertTest('4.3.4 1 additional request sent for Tracking B', recordedRequests.length === initialReqCount + 2);

            // Retry Tracking A (should be deduplicated)
            const resA2 = await dispatchTelegramNotification({
                event: 'STATUS_UPDATED',
                orderId: orderId,
                data: { trackingNumber: 'TRK-AAA-01', statusLabelAr: 'في الطريق' },
                credentials: { botToken: 'test_token', chatId: '-100test', mock: false }
            });
            assertTest('4.3.5 Re-dispatch with Tracking A is correctly recognized as duplicate', resA2.deduplicated === true);
            assertTest('4.3.6 Re-dispatch with Tracking A sent ZERO network requests', recordedRequests.length === initialReqCount + 2);
        }

        // 4.4 Failed dispatch does NOT poison the ledger (retries are permitted when network restores)
        {
            resetTestLedger();
            recordedRequests.length = 0;
            mockBehaviorQueue.length = 0;

            // Attempt 1: Fails due to network error
            mockBehaviorQueue.push({ type: 'NETWORK_ERROR' });
            // Attempt 2: Succeeds
            mockBehaviorQueue.push({ statusCode: 200, ok: true, result: { message_id: 88899 } });

            const orderId = 'ORVA-RETRY-AFTER-FAIL';
            const params = {
                event: 'ORDER_CREATED',
                orderId: orderId,
                data: { grandTotal: 3000 },
                credentials: { botToken: 'test_tok', chatId: '-100test', mock: false }
            };

            const failRes = await dispatchTelegramNotification(params);
            assertTest('4.4.1 Failed initial dispatch returns success: false', failRes.success === false);

            // Verify failed dispatch did NOT write DISPATCHED to ledger
            const ledger = readLedger();
            assertTest('4.4.2 Failed dispatch did not poison ledger with DISPATCHED status',
                !ledger[`ORDER_CREATED_${orderId}_none`] || ledger[`ORDER_CREATED_${orderId}_none`].status !== 'DISPATCHED'
            );

            // Attempt 2: Network is restored -> retry MUST be allowed (not falsely blocked as duplicate)
            const successRes = await dispatchTelegramNotification(params);
            assertTest('4.4.3 Retry after network restoration succeeds and is NOT blocked by false deduplication',
                successRes.success === true && !successRes.deduplicated
            );

            // Attempt 3: Now that it succeeded, next identical dispatch MUST be deduplicated
            const dupRes = await dispatchTelegramNotification(params);
            assertTest('4.4.4 Subsequent identical dispatch is properly deduplicated', dupRes.deduplicated === true);
        }

        // 4.5 Corrupted / Malformed Ledger JSON file resilience
        {
            // Inject malformed JSON into ledger file
            fs.mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
            fs.writeFileSync(LEDGER_FILE, '{ corrupted invalid json content [[[', 'utf8');

            let readResult = null;
            let threw = false;
            try {
                readResult = readLedger();
            } catch (e) {
                threw = true;
            }
            assertTest('4.5.1 readLedger() handles corrupted JSON without crashing', threw === false);
            assertTest('4.5.2 readLedger() returns safe empty object {} on syntax error',
                readResult && typeof readResult === 'object' && Object.keys(readResult).length === 0
            );

            // Dispatches continue to succeed despite corrupted ledger file
            const res = await dispatchTelegramNotification({
                event: 'ORDER_CREATED',
                orderId: 'ORVA-CORRUPT-LEDGER-01',
                data: { grandTotal: 4000 },
                credentials: { mock: true, botToken: 'm_tok', chatId: '-100m' }
            });
            assertTest('4.5.3 Dispatch completes successfully and repairs ledger on disk', res.success === true);

            // Verify ledger is now valid JSON again
            const repairedLedger = readLedger();
            assertTest('4.5.4 Repaired ledger is readable and contains new order entry',
                repairedLedger['ORDER_CREATED_ORVA-CORRUPT-LEDGER-01_none']?.status === 'SIMULATED'
            );
        }

    } finally {
        restoreEnvMode();
        uninstallTelegramMock();
        restoreState();
        captureWarningsEnd();
    }

    // =========================================================================
    // SUMMARY REPORT
    // =========================================================================
    console.log('\n================================================================================');
    console.log('   ORVA STORE — ADVERSARIAL STRESS TEST SUMMARY');
    console.log('================================================================================');
    console.log(`TOTAL SCENARIOS EXECUTED: ${passedCount + failedCount}`);
    console.log(`PASSED:                   ${passedCount}`);
    console.log(`FAILED:                   ${failedCount}`);
    console.log('================================================================================');

    if (failedCount === 0 && passedCount > 0) {
        console.log('🎉 VERDICT: APPROVE — 100% ADVERSARIAL CHALLENGES EMPIRICALLY PASSED');
        console.log('================================================================================\n');
        process.exit(0);
    } else {
        console.error(`⚠️ VERDICT: REQUEST_CHANGES — ${failedCount} ADVERSARIAL SCENARIOS FAILED`);
        console.log('================================================================================\n');
        process.exit(1);
    }
}

// Execute suite
runAdversarialChallenges().catch(err => {
    console.error('Fatal unhandled error in adversarial test suite:', err);
    process.exit(1);
});
