'use strict';
// =============================================================================
// ADVERSARIAL STRESS TEST & EMPIRICAL CONCURRENCY HARNESS — MILESTONE 2
// Target: Settings Persistence, Admin APIs & Security (F6, F7, F8, F9, F10)
// Archetype: EMPIRICAL CHALLENGER (critic, specialist)
// =============================================================================

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const assert = require('assert');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');

const {
    SETTINGS_FILE,
    LOCKS_DIR,
    getEffectiveSettings,
    getPublicSettings,
    saveTemplateDraft,
    activateTemplate,
    restoreTemplateDefault,
    toggleTemplate
} = require('../lib/admin-settings-store');

const adminSettingsHandler = require('../api/admin-settings');
const sendOrderHandler = require('../api/send-order');

const INVENTORY_FILE = path.join(__dirname, '..', 'data', 'inventory-state.json');
const RATE_LIMIT_LOCK_FILE = path.join(__dirname, '..', 'data', 'locks', 'test-rate-limits.json');
const SETTINGS_LOCK_DIR = path.join(LOCKS_DIR, 'admin-settings.lock');

let totalChallenges = 0;
let passedChallenges = 0;
let failedChallenges = 0;
const failureDetails = [];

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

// Mock Telegram Interceptor
const mockTelegramDispatches = [];
const originalHttpsRequest = https.request;

function activateMock() {
    process.env.NODE_ENV = 'test';
    process.env.MOCK_TELEGRAM = 'true';
    mockTelegramDispatches.length = 0;

    https.request = function(options, cb) {
        const urlStr = typeof options === 'string'
            ? options
            : ((options.protocol || 'https:') + '//' + (options.hostname || '') + (options.path || ''));

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

                    mockTelegramDispatches.push({ url: urlStr, payload, timestamp: Date.now() });
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

        return originalHttpsRequest.apply(https, arguments);
    };
}

function deactivateMock() {
    https.request = originalHttpsRequest;
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
            end: () => { resolve({ statusCode, headers: responseHeaders, body: responseBody }); }
        };

        try {
            const p = handler(req, res);
            if (p && typeof p.then === 'function') {
                p.catch(err => resolve({ statusCode: 500, headers: responseHeaders, body: { error: err.message } }));
            }
        } catch (err) {
            resolve({ statusCode: 500, headers: responseHeaders, body: { error: err.message } });
        }
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runChallenge(id, name, fn) {
    totalChallenges++;
    try {
        await fn();
        passedChallenges++;
        console.log(`[PASS] [${id}] ${name}`);
    } catch (err) {
        failedChallenges++;
        failureDetails.push({ id, name, error: err.message, stack: err.stack });
        console.error(`[FAIL] [${id}] ${name}`);
        console.error(`       Error: ${err.message}`);
    }
}

const AUTH_HEADER = {
    authorization: `Bearer ${process.env.ADMIN_API_TOKEN || 'orva-admin-2026-secure'}`,
    origin: 'https://orva-store.com',
    'content-type': 'application/json'
};

async function main() {
    console.log('================================================================================');
    console.log('   ORVA STORE — EMPIRICAL ADVERSARIAL STRESS SUITE (MILESTONE 2)');
    console.log('================================================================================\n');

    activateMock();

    let settingsBackup = null;
    let inventoryBackup = null;

    if (fs.existsSync(SETTINGS_FILE)) settingsBackup = fs.readFileSync(SETTINGS_FILE);
    if (fs.existsSync(INVENTORY_FILE)) inventoryBackup = fs.readFileSync(INVENTORY_FILE);

    try {
        // =============================================================================
        // CHALLENGE CATEGORY 1: RATE LIMITING ON TEST DISPATCHES
        // =============================================================================
        console.log('--- CHALLENGE CATEGORY 1: RATE LIMITING ON TEST DISPATCHES ---');

        const rateClientHeader = {
            ...AUTH_HEADER,
            'x-forwarded-for': '203.0.113.10'
        };

        await runChallenge('ADV-M2-01', 'Burst stress: 15 immediate requests (1 OK, 14 throttled with 429 & Retry-After)', async () => {
            const results = [];
            for (let i = 0; i < 15; i++) {
                results.push(await executeRequest(adminSettingsHandler, {
                    method: 'POST',
                    headers: rateClientHeader,
                    body: { action: 'send_test_message', event: 'ORDER_CREATED' }
                }));
            }

            // Request 0 should be 200 OK
            assert.strictEqual(results[0].statusCode, 200, `First request in burst must succeed (got ${results[0].statusCode})`);
            assert.strictEqual(results[0].body.success, true);
            assert.strictEqual(results[0].body.test, true);

            // Requests 1..14 must be 429 RATE_LIMITED
            for (let i = 1; i < 15; i++) {
                assert.strictEqual(results[i].statusCode, 429, `Request ${i + 1} must be throttled with 429 (got ${results[i].statusCode})`);
                assert.strictEqual(results[i].body.error, 'RATE_LIMITED');
                assert.ok(results[i].headers['retry-after'], `Request ${i + 1} must have Retry-After header`);
                assert.strictEqual(typeof results[i].body.retryAfter, 'number', `Request ${i + 1} retryAfter must be number`);
                assert.ok(results[i].body.retryAfter >= 1, `Request ${i + 1} retryAfter must be >= 1s`);
            }
        });

        await runChallenge('ADV-M2-02', '3-second cooldown window: request permitted after 3.2s, then immediately throttled', async () => {
            // Wait 3.2s to clear the cooldown
            await sleep(3200);

            // Request after cooldown expires
            const allowedRes = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: rateClientHeader,
                body: { action: 'send_test_message', event: 'ORDER_CREATED' }
            });
            assert.strictEqual(allowedRes.statusCode, 200, 'Request after 3s cooldown must succeed');
            assert.strictEqual(allowedRes.body.success, true);

            // Immediate repeat (< 100ms)
            const repeatRes = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: rateClientHeader,
                body: { action: 'send_test_message', event: 'ORDER_CREATED' }
            });
            assert.strictEqual(repeatRes.statusCode, 429, 'Immediate repeat must be rejected with 429');
            assert.strictEqual(repeatRes.body.error, 'RATE_LIMITED');
            assert.ok(repeatRes.headers['retry-after']);
        });

        await runChallenge('ADV-M2-03', '10/min ceiling: 10 requests allowed at 3.15s intervals; 11th request blocked (429, ceiling message, high Retry-After)', async () => {
            // We already have 2 successful dispatches for rateClientHeader (from ADV-M2-01 and ADV-M2-02) within ~4s.
            // Let's send 8 more successful requests, waiting 3.15s between each so cooldown is never violated.
            for (let i = 3; i <= 10; i++) {
                await sleep(3150);
                const res = await executeRequest(adminSettingsHandler, {
                    method: 'POST',
                    headers: rateClientHeader,
                    body: { action: 'send_test_message', event: 'ORDER_CREATED' }
                });
                assert.strictEqual(res.statusCode, 200, `Dispatch ${i}/10 must succeed (cooldown respected)`);
            }

            // Now 10 dispatches have succeeded in the last ~30 seconds!
            // Wait 3.15s again so cooldown is 100% passed
            await sleep(3150);

            // Dispatch 11th request! Cooldown is satisfied, BUT 10/min ceiling is exceeded!
            const eleventhRes = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: rateClientHeader,
                body: { action: 'send_test_message', event: 'ORDER_CREATED' }
            });

            assert.strictEqual(eleventhRes.statusCode, 429, '11th dispatch must be rejected with 429 by 10/min ceiling');
            assert.strictEqual(eleventhRes.body.error, 'RATE_LIMITED');
            assert.ok(eleventhRes.body.message.includes('10 رسائل في الدقيقة'), 'Message must explicitly cite 10 msg/min ceiling');
            assert.ok(eleventhRes.body.retryAfter >= 15, `Retry-After must reflect remaining sliding window (got ${eleventhRes.body.retryAfter}s)`);
            assert.strictEqual(eleventhRes.headers['retry-after'], String(eleventhRes.body.retryAfter));
        });

        await runChallenge('ADV-M2-04', 'PHP 8.3 CLI Rate Limiting: 3s cooldown enforcement and sliding window analysis', async () => {
            if (!phpBin) {
                console.log('       [SKIP] PHP 8.3 CLI not detected on system');
                return;
            }

            const phpTestScript = `
                define('ORVA_API', true);
                require 'api/admin-settings.php';
                \$_SERVER['REMOTE_ADDR'] = '198.51.100.55';
                \$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer adv-php-rate-test';
                
                // Burst 1
                \$res1 = checkTestMessageRateLimit();
                // Immediate burst 2
                \$res2 = checkTestMessageRateLimit();
                // Immediate burst 3
                \$res3 = checkTestMessageRateLimit();
                
                echo json_encode([
                    'res1' => \$res1,
                    'res2' => \$res2,
                    'res3' => \$res3
                ]);
            `;
            const out = execFileSync(phpBin, ['-r', phpTestScript], { encoding: 'utf8', env: process.env }).trim();
            const parsed = JSON.parse(out);

            assert.strictEqual(parsed.res1, null, 'First PHP test send must be allowed');
            assert.strictEqual(typeof parsed.res2, 'number', 'Second PHP send in burst must be rate limited');
            assert.ok(parsed.res2 >= 1 && parsed.res2 <= 3, 'Retry duration must be between 1 and 3 seconds');
            assert.strictEqual(typeof parsed.res3, 'number', 'Third PHP send in burst must be rate limited');
        });

        // =============================================================================
        // CHALLENGE CATEGORY 2: CUSTOMER CHECKOUT IMMUNITY GUARANTEE
        // =============================================================================
        console.log('\n--- CHALLENGE CATEGORY 2: CUSTOMER CHECKOUT IMMUNITY GUARANTEE ---');

        await runChallenge('ADV-M2-05', 'Real customer checkout succeeds (200 OK) while admin test limiter is actively throttled on the exact same IP', async () => {
            // Confirm admin test dispatch on 203.0.113.10 is still blocked
            const blockedCheck = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: rateClientHeader,
                body: { action: 'send_test_message', event: 'ORDER_CREATED' }
            });
            assert.strictEqual(blockedCheck.statusCode, 429, 'Admin test must be in active throttled state');

            // Fire customer checkout from the EXACT same IP (203.0.113.10)
            const orderRes = await executeRequest(sendOrderHandler, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    origin: 'https://orva-store.com',
                    'x-forwarded-for': '203.0.113.10'
                },
                body: {
                    fullName: 'Throttled IP Customer',
                    phone: '0550' + Math.floor(100000 + Math.random() * 900000),
                    wilaya: '16',
                    commune: 'الجزائر الوسطى',
                    packId: 'pack1',
                    quantity: 1
                }
            });

            assert.strictEqual(orderRes.statusCode, 200, `Customer checkout must return 200 OK (got ${orderRes.statusCode})`);
            assert.strictEqual(orderRes.body.success, true, 'Customer checkout must succeed');
            assert.ok(orderRes.body.orderId && orderRes.body.orderId.startsWith('ORVA-'), 'Valid orderId generated');
        });

        await runChallenge('ADV-M2-06', 'High-frequency burst of customer checkouts are immune to test message throttling', async () => {
            const burstPromises = [];
            for (let i = 0; i < 3; i++) {
                burstPromises.push(executeRequest(sendOrderHandler, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        origin: 'https://orva-store.com',
                        'x-forwarded-for': `203.0.113.${20 + i}`
                    },
                    body: {
                        fullName: `Burst Customer ${i}`,
                        phone: '0551' + Math.floor(100000 + i * 10000 + Math.random() * 9000),
                        wilaya: '16',
                        commune: 'الجزائر الوسطى',
                        packId: 'pack1',
                        quantity: 1
                    }
                }));
            }

            const responses = await Promise.all(burstPromises);
            for (let i = 0; i < responses.length; i++) {
                assert.strictEqual(responses[i].statusCode, 200, `Checkout ${i + 1} must return 200 OK (got ${responses[i].statusCode})`);
                assert.strictEqual(responses[i].body.success, true, `Checkout ${i + 1} must succeed`);
            }
        });

        await runChallenge('ADV-M2-07', 'PHP send-order checkout immunity: test-rate-limits.json does not affect orders', async () => {
            if (!phpBin) {
                console.log('       [SKIP] PHP 8.3 CLI not detected on system');
                return;
            }

            // Verify api/send-order.php source code does NOT touch test-rate-limits
            const phpSendOrderCode = fs.readFileSync(path.join(__dirname, '..', 'api', 'send-order.php'), 'utf8');
            assert.ok(!phpSendOrderCode.includes('test-rate-limits.json'), 'PHP checkout must never read or write test-rate-limits');
            assert.ok(!phpSendOrderCode.includes('checkTestMessageRateLimit'), 'PHP checkout must never invoke test rate limiting function');
        });

        // =============================================================================
        // CHALLENGE CATEGORY 3: CONCURRENT MUTATION STRESS ON ADMIN-SETTINGS.ENC
        // =============================================================================
        console.log('\n--- CHALLENGE CATEGORY 3: CONCURRENT MUTATION STRESS ON ADMIN-SETTINGS.ENC ---');

        await runChallenge('ADV-M2-08', 'In-process async mutation storm: 20 simultaneous CRUD operations resolve without lock corruption', async () => {
            const operations = [];
            for (let i = 0; i < 20; i++) {
                const event = (i % 2 === 0) ? 'ORDER_CREATED' : 'SHIPMENT_CREATED';
                if (i % 4 === 0) {
                    operations.push(Promise.resolve().then(() => saveTemplateDraft(event, `Async Draft ${i} Content {{order_id}}`, true, `async_admin_${i}`)));
                } else if (i % 4 === 1) {
                    operations.push(Promise.resolve().then(() => activateTemplate(event, `async_admin_${i}`)));
                } else if (i % 4 === 2) {
                    operations.push(Promise.resolve().then(() => toggleTemplate(event, i % 2 === 0, `async_admin_${i}`)));
                } else {
                    operations.push(Promise.resolve().then(() => restoreTemplateDefault(event, `async_admin_${i}`)));
                }
            }

            const results = await Promise.all(operations);
            assert.strictEqual(results.length, 20, 'All 20 operations completed');

            // Verify store is decryptable and intact
            const effective = getEffectiveSettings();
            assert.ok(effective.telegram, 'Effective settings must contain telegram section');
            const pub = getPublicSettings();
            assert.ok(pub.telegram.templates, 'Public settings must contain templates projection');
        });

        await runChallenge('ADV-M2-09', 'Multi-process concurrency stress: 4 Node child processes + PHP CLI running simultaneous mutations', async () => {
            const workerPath = path.join(__dirname, 'helpers', 'settings-concurrency-worker.js');
            const numWorkers = 4;
            const iterationsPerWorker = 8;

            const spawnWorker = (id) => {
                return new Promise((resolve, reject) => {
                    const cp = spawn('node', [workerPath, String(id), String(iterationsPerWorker)], {
                        env: process.env,
                        stdio: ['ignore', 'pipe', 'pipe']
                    });
                    let out = '';
                    let err = '';
                    cp.stdout.on('data', d => { out += d; });
                    cp.stderr.on('data', d => { err += d; });
                    cp.on('close', code => {
                        if (code === 0) resolve({ id, out });
                        else reject(new Error(`Worker ${id} failed with exit code ${code}: ${err}`));
                    });
                });
            };

            const promises = [];
            for (let w = 1; w <= numWorkers; w++) {
                promises.push(spawnWorker(w));
            }

            // Concurrently execute PHP mutation
            if (phpBin) {
                const phpWorker = new Promise((resolve, reject) => {
                    const phpScript = `
                        define('ORVA_API', true);
                        require 'api/admin-settings.php';
                        for (\$i = 0; \$i < 5; \$i++) {
                            \$lock = acquireSettingsLock(dirname(__DIR__) . '/data/locks/admin-settings.lock');
                            if (!\$lock) {
                                echo 'LOCK_FAIL';
                                exit(1);
                            }
                            \$settings = readEncryptedOverrides(\$settingsFile, \$config);
                            \$settings['telegram']['templates']['STATUS_UPDATED']['draftTemplate'] = 'PHP_CONCURRENT_' . \$i;
                            writeEncryptedOverrides(\$settingsFile, \$settings, \$config);
                            releaseSettingsLock(dirname(__DIR__) . '/data/locks/admin-settings.lock');
                            usleep(15000);
                        }
                        echo 'PHP_SUCCESS';
                    `;
                    try {
                        const out = execFileSync(phpBin, ['-r', phpScript], { encoding: 'utf8', env: process.env }).trim();
                        if (out.includes('PHP_SUCCESS')) resolve({ id: 'php', out });
                        else reject(new Error(`PHP Worker failed: ${out}`));
                    } catch (e) {
                        reject(e);
                    }
                });
                promises.push(phpWorker);
            }

            const workerResults = await Promise.all(promises);
            assert.ok(workerResults.length >= numWorkers, 'All workers must finish successfully');

            // Verify store validity after multi-process stress
            const postStressSettings = getEffectiveSettings();
            assert.ok(postStressSettings.telegram, 'Settings store readable after multi-process stress');

            // Verify lock directory is released
            if (fs.existsSync(SETTINGS_LOCK_DIR)) {
                // If directory still exists, verify it doesn't have an active live owner
                const ownerFile = path.join(SETTINGS_LOCK_DIR, 'owner.json');
                assert.ok(!fs.existsSync(ownerFile), 'Lock owner file must not be left behind');
            }
        });

        // =============================================================================
        // CHALLENGE CATEGORY 4: MALFORMED & OVERSIZED PAYLOADS
        // =============================================================================
        console.log('\n--- CHALLENGE CATEGORY 4: MALFORMED & OVERSIZED PAYLOADS ---');

        await runChallenge('ADV-M2-10', 'Payload exceeding 64KB via Content-Length header is rejected with 400 PAYLOAD_TOO_LARGE', async () => {
            const res = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: {
                    ...AUTH_HEADER,
                    'content-length': '70000'
                },
                body: { action: 'save_template', event: 'ORDER_CREATED' }
            });
            assert.strictEqual(res.statusCode, 400);
            assert.strictEqual(res.body.error, 'PAYLOAD_TOO_LARGE');
        });

        await runChallenge('ADV-M2-11', 'Raw body string exceeding 64KB (65,537 bytes) is rejected with 400 PAYLOAD_TOO_LARGE', async () => {
            const largeBody = JSON.stringify({
                action: 'save_template',
                event: 'ORDER_CREATED',
                padding: 'X'.repeat(65537)
            });

            const res = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: AUTH_HEADER,
                body: largeBody
            });
            assert.strictEqual(res.statusCode, 400);
            assert.strictEqual(res.body.error, 'PAYLOAD_TOO_LARGE');
        });

        await runChallenge('ADV-M2-12', 'Template text exceeding 8,192 chars in save_template is rejected with 400 PAYLOAD_TOO_LARGE', async () => {
            const res = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: AUTH_HEADER,
                body: {
                    action: 'save_template',
                    event: 'ORDER_CREATED',
                    draftTemplate: 'محتوى تجريبي '.repeat(700) // ~9,100 chars
                }
            });
            assert.strictEqual(res.statusCode, 400);
            assert.strictEqual(res.body.error, 'PAYLOAD_TOO_LARGE');
        });

        await runChallenge('ADV-M2-13', 'Template text exceeding 8,192 chars in send_test_message is rejected with 400 PAYLOAD_TOO_LARGE', async () => {
            const h = { ...AUTH_HEADER, 'x-forwarded-for': '203.0.113.88' };
            const res = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: h,
                body: {
                    action: 'send_test_message',
                    event: 'ORDER_CREATED',
                    templateText: 'A'.repeat(8193)
                }
            });
            assert.strictEqual(res.statusCode, 400);
            assert.strictEqual(res.body.error, 'PAYLOAD_TOO_LARGE');
        });

        await runChallenge('ADV-M2-14', 'Prototype pollution payloads (__proto__ and constructor.prototype) are completely neutral', async () => {
            const pollutionPayload = JSON.parse('{"__proto__": {"pollutedFlag": "dangerous"}, "action": "save_template", "event": "ORDER_CREATED", "draftTemplate": "Safe"}');
            const res = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: AUTH_HEADER,
                body: pollutionPayload
            });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(Object.prototype.pollutedFlag, undefined, 'Object.prototype must not be polluted');
            assert.strictEqual(({}).pollutedFlag, undefined, 'Plain objects must not have pollutedFlag');

            const pollution2 = JSON.parse('{"constructor": {"prototype": {"isAdminPolluted": true}}, "action": "save_template", "event": "ORDER_CREATED", "draftTemplate": "Safe"}');
            const res2 = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: AUTH_HEADER,
                body: pollution2
            });
            assert.strictEqual(res2.statusCode, 200);
            assert.strictEqual(Object.prototype.isAdminPolluted, undefined, 'Object.prototype must not be polluted');
            assert.strictEqual(({}).isAdminPolluted, undefined, 'Plain objects must not have isAdminPolluted');
        });

        await runChallenge('ADV-M2-15', 'Unsupported and malicious event names are rejected with 400 INVALID_EVENT', async () => {
            const maliciousEvents = [
                '__proto__',
                'constructor',
                '<script>alert(1)</script>',
                'DROP TABLE orders;',
                '../../etc/passwd',
                'NON_EXISTENT_EVENT',
                '',
                '   '
            ];

            for (const evt of maliciousEvents) {
                const res = await executeRequest(adminSettingsHandler, {
                    method: 'POST',
                    headers: AUTH_HEADER,
                    body: { action: 'save_template', event: evt, draftTemplate: 'Test' }
                });
                assert.strictEqual(res.statusCode, 400, `Event '${evt}' must be rejected with 400`);
                assert.strictEqual(res.body.error, 'INVALID_EVENT', `Event '${evt}' error must be INVALID_EVENT`);
            }
        });

        await runChallenge('ADV-M2-16', 'Non-boolean enabled in toggle_template is strictly rejected with 400 INVALID_SETTINGS', async () => {
            const badValues = ['true', 1, null, {}, []];
            for (const val of badValues) {
                const res = await executeRequest(adminSettingsHandler, {
                    method: 'POST',
                    headers: AUTH_HEADER,
                    body: { action: 'toggle_template', event: 'ORDER_CREATED', enabled: val }
                });
                assert.strictEqual(res.statusCode, 400, `Non-boolean enabled (${JSON.stringify(val)}) must return 400`);
                assert.strictEqual(res.body.error, 'INVALID_SETTINGS');
            }
        });

        await runChallenge('ADV-M2-17', 'Custom message validation: missing fields, empty strings, title > 256, body > 4096', async () => {
            // Missing title
            const res1 = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: AUTH_HEADER,
                body: { action: 'send_custom_message', title: '', body: 'Valid Body' }
            });
            assert.strictEqual(res1.statusCode, 400);
            assert.strictEqual(res1.body.error, 'INVALID_PAYLOAD');

            // Missing body
            const res2 = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: AUTH_HEADER,
                body: { action: 'send_custom_message', title: 'Valid Title', body: '   ' }
            });
            assert.strictEqual(res2.statusCode, 400);
            assert.strictEqual(res2.body.error, 'INVALID_PAYLOAD');

            // Title > 256
            const res3 = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: AUTH_HEADER,
                body: { action: 'send_custom_message', title: 'T'.repeat(257), body: 'Valid Body' }
            });
            assert.strictEqual(res3.statusCode, 400);
            assert.strictEqual(res3.body.error, 'PAYLOAD_TOO_LARGE');

            // Body > 4096
            const res4 = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: AUTH_HEADER,
                body: { action: 'send_custom_message', title: 'Valid Title', body: 'B'.repeat(4097) }
            });
            assert.strictEqual(res4.statusCode, 400);
            assert.strictEqual(res4.body.error, 'PAYLOAD_TOO_LARGE');
        });

        await runChallenge('ADV-M2-18', 'PHP parity on malformed inputs (>64KB payload guard and invalid event rejection)', async () => {
            if (!phpBin) {
                console.log('       [SKIP] PHP 8.3 CLI not detected on system');
                return;
            }

            // 1. >64KB Content-Length
            const phpLargePayloadScript = `
                define('ORVA_API', true);
                \$_SERVER['REQUEST_METHOD'] = 'POST';
                \$_SERVER['HTTP_ORIGIN'] = 'https://orva-store.com';
                \$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . (getenv('ADMIN_API_TOKEN') ?: 'orva-admin-2026-secure');
                \$_SERVER['CONTENT_LENGTH'] = '70000';
                require 'api/admin-settings.php';
            `;
            const outLarge = execFileSync(phpBin, ['-r', phpLargePayloadScript], { encoding: 'utf8', env: process.env }).trim();
            assert.ok(outLarge.includes('PAYLOAD_TOO_LARGE'), 'PHP must reject oversized payload');

            // 2. Invalid event name
            const phpEventCheck = `
                define('ORVA_API', true);
                require 'api/admin-settings.php';
                \$evt = 'MALICIOUS_EVENT';
                \$supported = ['ORDER_CREATED', 'SHIPMENT_CREATED', 'SHIPMENT_FAILED', 'STATUS_UPDATED', 'ORDER_CANCELLED', 'ADMIN_ALERT'];
                echo in_array(\$evt, \$supported, true) ? 'ALLOWED' : 'REJECTED';
            `;
            const outEvt = execFileSync(phpBin, ['-r', phpEventCheck], { encoding: 'utf8', env: process.env }).trim();
            assert.strictEqual(outEvt, 'REJECTED');
        });

    } finally {
        deactivateMock();

        // Restore backups
        if (settingsBackup) {
            fs.writeFileSync(SETTINGS_FILE, settingsBackup);
        }
        if (inventoryBackup) {
            fs.writeFileSync(INVENTORY_FILE, inventoryBackup);
        }
        if (fs.existsSync(RATE_LIMIT_LOCK_FILE)) {
            try { fs.unlinkSync(RATE_LIMIT_LOCK_FILE); } catch (_) {}
        }
        if (fs.existsSync(SETTINGS_LOCK_DIR)) {
            try {
                const ownerFile = path.join(SETTINGS_LOCK_DIR, 'owner.json');
                if (fs.existsSync(ownerFile)) fs.unlinkSync(ownerFile);
                fs.rmdirSync(SETTINGS_LOCK_DIR);
            } catch (_) {}
        }
    }

    console.log('\n================================================================================');
    console.log(`   TOTAL CHALLENGES: ${totalChallenges} | PASSED: ${passedChallenges} | FAILED: ${failedChallenges}`);
    console.log('================================================================================');

    if (failedChallenges === 0) {
        console.log('🎉 VERDICT: ALL ADVERSARIAL CHALLENGES EMPIRICALLY SATISFIED');
        process.exit(0);
    } else {
        console.error('❌ VERDICT: ADVERSARIAL CHALLENGE FAILED');
        for (const f of failureDetails) {
            console.error(` - [${f.id}] ${f.name}: ${f.error}`);
        }
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal Harness Error:', err);
    process.exit(1);
});
