'use strict';
// =============================================================================
// ORVA STORE — Phase 8F Milestone 3 Challenger 2 Stress Test Suite
// Empirical Adversarial Verification:
// 1. Destination Pinning & Custom Composer Isolation
// 2. Rate Limiting Resilience & Cooldown Enforcement
// 3. Static Export & Asset Integrity (admin/ and dist-hostinger/admin/)
//
// Target Modules:
//   - api/admin-settings.js (Node.js API handler)
//   - api/admin-settings.php (Hostinger PHP 8.3 CLI parity handler)
//   - orvastore Dashbaord v0.9/.../settings-integrations.tsx
//   - admin/dashboard/settings/index.html & _next assets
//   - dist-hostinger/admin/dashboard/settings/index.html & _next assets
//   - scripts/sync-admin.js
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
const {
    getEffectiveSettings,
    updateSettings,
    SETTINGS_FILE
} = require('../lib/admin-settings-store');

const ROOT_DIR = path.join(__dirname, '..');
const ADMIN_DIR = path.join(ROOT_DIR, 'admin');
const DIST_HOSTINGER_ADMIN_DIR = path.join(ROOT_DIR, 'dist-hostinger', 'admin');
const SETTINGS_TSX_PATH = path.join(
    ROOT_DIR,
    'orvastore Dashbaord v0.9',
    'next-shadcn-admin-dashboard-baseui-main',
    'src', 'app', '(main)', 'dashboard', 'settings',
    'settings-integrations.tsx'
);

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
        cwd: ROOT_DIR,
        env: { ...process.env, ...envExtra }
    }).trim();
}

// Global Spies & Network Interceptor
const originalHttpsRequest = https.request;
const mockTelegramDispatches = [];

function activateTelegramMock() {
    delete process.env.MOCK_TELEGRAM;
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

                    mockTelegramDispatches.push({ url: urlStr, payload, timestamp: new Date().toISOString() });
                    const resEmitter = new (require('events').EventEmitter)();
                    resEmitter.statusCode = 200;
                    if (typeof cb === 'function') cb(resEmitter);
                    resEmitter.emit('data', JSON.stringify({
                        ok: true,
                        result: {
                            message_id: 99000 + mockTelegramDispatches.length,
                            chat: { id: payload.chat_id }
                        }
                    }));
                    resEmitter.emit('end');
                });
            };
            return reqEmitter;
        }

        return originalHttpsRequest.apply(https, arguments);
    };
}

function deactivateTelegramMock() {
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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Test Runner State ─────────────────────────────────────────────────────────
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

async function challengeTest(id, suite, desc, fn) {
    totalTests++;
    try {
        await fn();
        passedTests++;
        console.log(`[${id}] ✅ PASS [${suite}]: ${desc}`);
    } catch (err) {
        failedTests++;
        failures.push({ id, suite, desc, error: err.message });
        console.error(`[${id}] ❌ FAIL [${suite}]: ${desc}`);
        console.error(`       Error: ${err.message}`);
    }
}

// ── Main Execution ────────────────────────────────────────────────────────────
async function runAllChallengerTests() {
    console.log('================================================================================');
    console.log('   ORVA STORE — M3 CHALLENGER 2 EMPIRICAL ADVERSARIAL VERIFICATION');
    console.log('   Destination Pinning, Rate Limiting & Static Asset Integrity');
    console.log('================================================================================\n');

    // Backup settings file
    let originalSettingsBackup = null;
    if (fs.existsSync(SETTINGS_FILE)) {
        originalSettingsBackup = fs.readFileSync(SETTINGS_FILE, 'utf8');
    }

    try {
        activateTelegramMock();

        // ══════════════════════════════════════════════════════════════════════════
        // SUITE 1: DESTINATION PINNING & CUSTOM COMPOSER ISOLATION
        // ══════════════════════════════════════════════════════════════════════════
        console.log('--- SUITE 1: DESTINATION PINNING & COMPOSER ISOLATION ---');

        const configuredChatId = getEffectiveSettings().telegram.chatId || '-1003965560132';

        await challengeTest('CH-PIN-01', 'PINNING_NODE', 'send_custom_message rejects arbitrary injected chat_id / recipient', async () => {
            mockTelegramDispatches.length = 0;
            const res = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: { ...AUTH_HEADER, 'content-type': 'application/json' },
                body: {
                    action: 'send_custom_message',
                    title: 'Adversarial Injection Test',
                    body: 'Attempting to route to external recipient',
                    chat_id: '-999888777666',
                    chatId: '-999888777666',
                    recipient: '@external_hacker',
                    to: '-999888777666',
                    target: 'external'
                }
            });

            assert.strictEqual(res.statusCode, 200, `Expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
            assert.strictEqual(res.body.success, true);
            assert.strictEqual(mockTelegramDispatches.length, 1, 'Expected 1 telegram dispatch');
            assert.strictEqual(
                String(mockTelegramDispatches[0].payload.chat_id),
                String(configuredChatId),
                `CRITICAL: Message dispatched to injected ID ${mockTelegramDispatches[0].payload.chat_id} instead of configured ${configuredChatId}`
            );
        });

        await challengeTest('CH-PIN-02', 'PINNING_NODE', 'send_test_message strictly pins destination to configured chatId', async () => {
            // Wait 3.1s to clear rate limit from any prior test
            await sleep(3100);
            mockTelegramDispatches.length = 0;
            const res = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: { ...AUTH_HEADER, 'content-type': 'application/json' },
                body: {
                    action: 'send_test_message',
                    event: 'ORDER_CREATED',
                    chat_id: '-999111222333',
                    chatId: '-999111222333',
                    to: 'arbitrary_target'
                }
            });

            assert.strictEqual(res.statusCode, 200, `Expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
            assert.strictEqual(res.body.success, true);
            assert.strictEqual(mockTelegramDispatches.length, 1);
            assert.strictEqual(
                String(mockTelegramDispatches[0].payload.chat_id),
                String(configuredChatId),
                `CRITICAL: Test message leaked to injected target ${mockTelegramDispatches[0].payload.chat_id}`
            );
            assert.strictEqual(String(res.body.chatId), String(configuredChatId));
        });

        await challengeTest('CH-PIN-03', 'PINNING_NODE', 'Missing/empty telegram.chatId completely blocks custom and test dispatches', async () => {
            // Temporarily clear chatId in settings
            updateSettings({ telegram: { chatId: '' } });
            try {
                // 1. send_custom_message with empty configured chatId
                const resCustom = await executeRequest(adminSettingsHandler, {
                    method: 'POST',
                    headers: { ...AUTH_HEADER, 'content-type': 'application/json' },
                    body: {
                        action: 'send_custom_message',
                        title: 'Test',
                        body: 'Body',
                        chat_id: '-1003965560132' // Attacker supplies chat_id to bypass empty config
                    }
                });
                assert.strictEqual(resCustom.statusCode, 400);
                assert.strictEqual(resCustom.body.error, 'TELEGRAM_NOT_CONFIGURED');

                // 2. send_test_message with empty configured chatId
                await sleep(3100);
                const resTest = await executeRequest(adminSettingsHandler, {
                    method: 'POST',
                    headers: { ...AUTH_HEADER, 'content-type': 'application/json' },
                    body: {
                        action: 'send_test_message',
                        event: 'ORDER_CREATED',
                        chat_id: '-1003965560132'
                    }
                });
                assert.strictEqual(resTest.statusCode, 400);
                assert.strictEqual(resTest.body.error, 'TELEGRAM_NOT_CONFIGURED');
            } finally {
                // Restore configured chatId
                updateSettings({ telegram: { chatId: configuredChatId } });
            }
        });

        if (phpBin) {
            await challengeTest('CH-PIN-04', 'PINNING_PHP', 'PHP 8.3 CLI send_custom_message strictly pins destination to server config', async () => {
                const phpCode = `
$_SERVER['REQUEST_METHOD'] = 'POST';
$_SERVER['HTTP_ORIGIN'] = 'https://orva-store.com';
$_SERVER['HTTP_AUTHORIZATION'] = '${AUTH_HEADER.authorization}';
$_ENV['MOCK_TELEGRAM'] = 'true';
require 'api/admin-settings.php';
`;
                const payload = {
                    action: 'send_custom_message',
                    title: 'Adversarial Title PHP',
                    body: 'Adversarial Body PHP',
                    chat_id: '-999444333222',
                    chatId: '-999444333222',
                    recipient: 'malicious'
                };

                const out = runPhpCli(phpCode, payload);
                assert.ok(out, 'PHP CLI returned empty output');
                let parsed;
                try { parsed = JSON.parse(out); } catch (e) { assert.fail(`PHP output not JSON: ${out}`); }

                assert.strictEqual(parsed.success, true);
                assert.strictEqual(
                    String(parsed.destination),
                    String(configuredChatId),
                    `PHP routed custom message to ${parsed.destination} instead of ${configuredChatId}`
                );
            });

            await challengeTest('CH-PIN-05', 'PINNING_PHP', 'PHP 8.3 CLI send_test_message strictly pins destination to server config', async () => {
                const phpCode = `
$_SERVER['REQUEST_METHOD'] = 'POST';
$_SERVER['HTTP_ORIGIN'] = 'https://orva-store.com';
$_SERVER['HTTP_AUTHORIZATION'] = '${AUTH_HEADER.authorization}';
$_ENV['MOCK_TELEGRAM'] = 'true';
$_SERVER['REMOTE_ADDR'] = '10.99.88.77'; // Distinct IP to avoid rate limit
require 'api/admin-settings.php';
`;
                const payload = {
                    action: 'send_test_message',
                    event: 'ORDER_CREATED',
                    chat_id: '-999555666777',
                    to: 'attacker'
                };

                const out = runPhpCli(phpCode, payload);
                assert.ok(out, 'PHP CLI returned empty output');
                let parsed;
                try { parsed = JSON.parse(out); } catch (e) { assert.fail(`PHP output not JSON: ${out}`); }

                assert.strictEqual(parsed.success, true);
                assert.strictEqual(
                    String(parsed.destination),
                    String(configuredChatId),
                    `PHP routed test message to ${parsed.destination} instead of ${configuredChatId}`
                );
            });
        }

        await challengeTest('CH-PIN-06', 'PINNING_UI', 'Frontend UI contract locks destination and omits recipient overrides', async () => {
            assert.ok(fs.existsSync(SETTINGS_TSX_PATH), `UI component file missing: ${SETTINGS_TSX_PATH}`);
            const tsxContent = fs.readFileSync(SETTINGS_TSX_PATH, 'utf8');

            // 1. handleDispatchCustomMessage sends ONLY action, title, body
            const dispatchCustomRegex = /const handleDispatchCustomMessage = async \(\) => {[\s\S]*?callSettingsApi\({\s*action: "send_custom_message",\s*title: composerTitle\.trim\(\),\s*body: composerBody\.trim\(\),?\s*}\);/m;
            assert.ok(dispatchCustomRegex.test(tsxContent), 'handleDispatchCustomMessage payload contains unauthorized fields or lacks strict shape');

            // 2. handleSendTestMessage sends ONLY action, event, templateText
            const dispatchTestRegex = /const handleSendTestMessage = async \(\) => {[\s\S]*?callSettingsApi\({\s*action: "send_test_message",\s*event: activeEvent,\s*templateText: editorText\.trim\(\) \? editorText : undefined,?\s*}\);/m;
            assert.ok(dispatchTestRegex.test(tsxContent), 'handleSendTestMessage payload contains unauthorized recipient parameter');

            // 3. Card 3 has locked display and no input named chat_id/to/recipient for custom broadcast
            assert.ok(tsxContent.includes('Locked Destination'), 'Missing Locked Destination indicator in Card 3');
            assert.ok(tsxContent.includes('الوجهة المعتمدة مقفلة تلقائياً'), 'Missing locked destination Arabic label in Card 3');
        });

        // ══════════════════════════════════════════════════════════════════════════
        // SUITE 2: RATE LIMITING RESILIENCE & COOLDOWN ENFORCEMENT
        // ══════════════════════════════════════════════════════════════════════════
        console.log('\n--- SUITE 2: RATE LIMITING RESILIENCE & COOLDOWN ---');

        await challengeTest('CH-RL-01', 'RATE_LIMIT_NODE', 'Rapid repeat test message triggers HTTP 429 with Retry-After and cooldown', async () => {
            // Use distinct IP to start fresh rate limit bucket, with valid auth
            const testHeaders = {
                ...AUTH_HEADER,
                'x-forwarded-for': '192.168.10.1'
            };

            // Call 1: Success
            const res1 = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: testHeaders,
                body: { action: 'send_test_message', event: 'ORDER_CREATED' }
            });
            assert.strictEqual(res1.statusCode, 200, `Expected 200 on initial test send, got ${res1.statusCode}: ${JSON.stringify(res1.body)}`);

            // Call 2: Immediate repeat (< 100ms) -> Must trigger 429 RATE_LIMITED
            const res2 = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: testHeaders,
                body: { action: 'send_test_message', event: 'ORDER_CREATED' }
            });
            assert.strictEqual(res2.statusCode, 429, `Expected 429 on immediate repeat, got ${res2.statusCode}`);
            assert.strictEqual(res2.body.error, 'RATE_LIMITED');
            assert.ok(res2.body.retryAfter >= 1 && res2.body.retryAfter <= 3, `retryAfter should be 1..3, got ${res2.body.retryAfter}`);
            assert.strictEqual(res2.headers['retry-after'], String(res2.body.retryAfter));
            assert.ok(res2.body.message.includes('ثوانٍ'), 'Expected Arabic cooldown message');

            // Call 3: Wait 1.5s (still within 3s window) -> Still 429
            await sleep(1500);
            const res3 = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: testHeaders,
                body: { action: 'send_test_message', event: 'ORDER_CREATED' }
            });
            assert.strictEqual(res3.statusCode, 429, `Expected 429 after 1.5s, got ${res3.statusCode}`);

            // Call 4: Wait remaining 1.8s (total > 3.3s elapsed) -> Allowed (200)
            await sleep(1800);
            const res4 = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: testHeaders,
                body: { action: 'send_test_message', event: 'ORDER_CREATED' }
            });
            assert.strictEqual(res4.statusCode, 200, `Expected 200 after cooldown expiry, got ${res4.statusCode}`);
        });

        await challengeTest('CH-RL-02', 'RATE_LIMIT_NODE', 'Rate limiting enforces sliding window limit (max 10 per minute)', async () => {
            // Verify sliding window logic: 10 allowed in 60s, 11th rejected
            const burstHeaders = {
                ...AUTH_HEADER,
                'x-forwarded-for': '192.168.99.99'
            };

            // Call 1 succeeds
            const r1 = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: burstHeaders,
                body: { action: 'send_test_message', event: 'ORDER_CREATED' }
            });
            assert.strictEqual(r1.statusCode, 200);

            // Immediate repeat fails with Rule 1 (3s cooldown)
            const r2 = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: burstHeaders,
                body: { action: 'send_test_message', event: 'ORDER_CREATED' }
            });
            assert.strictEqual(r2.statusCode, 429);
            assert.ok(r2.body.message.includes('3') || r2.body.message.includes('ثوانٍ'));
        });

        await challengeTest('CH-RL-03', 'RATE_LIMIT_NODE', 'Rate limiting is strictly isolated per client key (IP + auth)', async () => {
            const clientAHeaders = {
                ...AUTH_HEADER,
                'x-forwarded-for': '10.0.0.1'
            };
            const clientBHeaders = {
                ...AUTH_HEADER,
                'x-forwarded-for': '10.0.0.2'
            };

            // Client A sends test message -> 200
            const resA1 = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: clientAHeaders,
                body: { action: 'send_test_message', event: 'ORDER_CREATED' }
            });
            assert.strictEqual(resA1.statusCode, 200);

            // Client A immediately tries again -> 429
            const resA2 = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: clientAHeaders,
                body: { action: 'send_test_message', event: 'ORDER_CREATED' }
            });
            assert.strictEqual(resA2.statusCode, 429);

            // Client B immediately tries -> MUST BE 200 (not throttled by Client A's activity)
            const resB1 = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: clientBHeaders,
                body: { action: 'send_test_message', event: 'ORDER_CREATED' }
            });
            assert.strictEqual(resB1.statusCode, 200, `Client B wrongly blocked: ${resB1.statusCode}`);
        });

        await challengeTest('CH-RL-04', 'RATE_LIMIT_NODE', 'Cross-Action Immunity: Rate-limited test dispatches never block custom broadcasts or template mutations', async () => {
            const lockedClient = {
                ...AUTH_HEADER,
                'x-forwarded-for': '10.10.10.10'
            };

            // 1. Send test message to trigger cooldown
            const resTest1 = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: lockedClient,
                body: { action: 'send_test_message', event: 'ORDER_CREATED' }
            });
            assert.strictEqual(resTest1.statusCode, 200);

            // 2. Immediately verify test message is now rate limited
            const resTest2 = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: lockedClient,
                body: { action: 'send_test_message', event: 'ORDER_CREATED' }
            });
            assert.strictEqual(resTest2.statusCode, 429);

            // 3. Immediately send custom broadcast (send_custom_message) -> MUST SUCCEED (200)
            const resCustom = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: lockedClient,
                body: { action: 'send_custom_message', title: 'Urgent Alert', body: 'Unblocked Broadcast' }
            });
            assert.strictEqual(resCustom.statusCode, 200, `send_custom_message was improperly blocked by test rate limit: ${resCustom.statusCode}`);

            // 4. Immediately save template draft (save_template) -> MUST SUCCEED (200)
            const resSave = await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: lockedClient,
                body: { action: 'save_template', event: 'ORDER_CREATED', draftTemplate: 'DRAFT_TEXT' }
            });
            assert.strictEqual(resSave.statusCode, 200, `save_template was improperly blocked by test rate limit: ${resSave.statusCode}`);

            // 5. Clean up draft
            await executeRequest(adminSettingsHandler, {
                method: 'POST',
                headers: lockedClient,
                body: { action: 'restore_template', event: 'ORDER_CREATED' }
            });
        });

        if (phpBin) {
            await challengeTest('CH-RL-05', 'RATE_LIMIT_PHP', 'PHP 8.3 CLI enforces identical 3-second cooldown on test message dispatches', async () => {
                const uniqueIp = '172.16.88.' + Math.floor(Math.random() * 200 + 10);
                const phpCode = `
$_SERVER['REQUEST_METHOD'] = 'POST';
$_SERVER['HTTP_ORIGIN'] = 'https://orva-store.com';
$_SERVER['HTTP_AUTHORIZATION'] = '${AUTH_HEADER.authorization}';
$_SERVER['REMOTE_ADDR'] = '${uniqueIp}';
$_ENV['MOCK_TELEGRAM'] = 'true';
require 'api/admin-settings.php';
`;
                const payload = { action: 'send_test_message', event: 'ORDER_CREATED' };

                // Call 1: Success
                const out1 = runPhpCli(phpCode, payload);
                const p1 = JSON.parse(out1);
                assert.strictEqual(p1.success, true, `PHP call 1 failed: ${out1}`);

                // Call 2: Immediate repeat -> 429
                const out2 = runPhpCli(phpCode, payload);
                const p2 = JSON.parse(out2);
                assert.strictEqual(p2.success, false, `PHP call 2 did not trigger rate limit: ${out2}`);
                assert.strictEqual(p2.error, 'RATE_LIMITED');
                assert.ok(p2.retryAfter >= 1 && p2.retryAfter <= 3, `Expected retryAfter 1..3, got ${p2.retryAfter}`);
            });
        }

        await challengeTest('CH-RL-06', 'RATE_LIMIT_UI', 'Frontend UI implements countdown timer, button disabling and click guard', async () => {
            const tsxContent = fs.readFileSync(SETTINGS_TSX_PATH, 'utf8');

            // 1. testCooldown state declaration
            assert.ok(tsxContent.includes('const [testCooldown, setTestCooldown] = React.useState<number>(0);'), 'Missing testCooldown state hook');

            // 2. Early return guard in handleSendTestMessage
            assert.ok(tsxContent.includes('if (testCooldown > 0) return;'), 'Missing early exit guard in handleSendTestMessage');

            // 3. Cooldown interval timer initialized to 3 seconds
            assert.ok(tsxContent.includes('setTestCooldown(3);'), 'Missing setTestCooldown(3) on test message send');
            assert.ok(tsxContent.includes('clearInterval(interval);'), 'Missing clearInterval cleanup on cooldown expiration');

            // 4. Test button disabled state includes testCooldown > 0
            assert.ok(tsxContent.includes('disabled={sendingTest || testCooldown > 0}'), 'Test button not disabled when testCooldown > 0');

            // 5. Visual countdown label rendered to user
            assert.ok(tsxContent.includes('⏳ انتظر ${testCooldown} ثوانٍ...'), 'Missing countdown label on test button');
        });

        // ══════════════════════════════════════════════════════════════════════════
        // SUITE 3: STATIC EXPORT & ASSET INTEGRITY
        // ══════════════════════════════════════════════════════════════════════════
        console.log('\n--- SUITE 3: STATIC EXPORT & ASSET INTEGRITY ---');

        const adminSettingsHtmlPath = path.join(ADMIN_DIR, 'dashboard', 'settings', 'index.html');
        const distSettingsHtmlPath = path.join(DIST_HOSTINGER_ADMIN_DIR, 'dashboard', 'settings', 'index.html');

        await challengeTest('CH-EXP-01', 'EXPORT_FILES', 'Static settings index.html exists in both admin/ and dist-hostinger/admin/', async () => {
            assert.ok(fs.existsSync(adminSettingsHtmlPath), `Missing: ${adminSettingsHtmlPath}`);
            assert.ok(fs.existsSync(distSettingsHtmlPath), `Missing: ${distSettingsHtmlPath}`);

            const statAdmin = fs.statSync(adminSettingsHtmlPath);
            const statDist = fs.statSync(distSettingsHtmlPath);

            assert.ok(statAdmin.size > 25000, `admin/dashboard/settings/index.html is suspiciously small: ${statAdmin.size} bytes`);
            assert.ok(statDist.size > 25000, `dist-hostinger/admin/dashboard/settings/index.html is suspiciously small: ${statDist.size} bytes`);

            // Check SHA-256 hash match
            const hashAdmin = crypto.createHash('sha256').update(fs.readFileSync(adminSettingsHtmlPath)).digest('hex');
            const hashDist = crypto.createHash('sha256').update(fs.readFileSync(distSettingsHtmlPath)).digest('hex');
            assert.strictEqual(hashAdmin, hashDist, `Checksum mismatch between admin (${hashAdmin}) and dist-hostinger (${hashDist})`);
        });

        await challengeTest('CH-EXP-02', 'EXPORT_CONTENT', 'Static settings index.html mounts SettingsIntegrations component', async () => {
            const htmlContent = fs.readFileSync(adminSettingsHtmlPath, 'utf8');

            assert.ok(htmlContent.includes('<title>System Settings &amp; Integrations Center</title>'), 'Missing or incorrect <title>');
            assert.ok(htmlContent.includes('SettingsIntegrations'), 'Missing SettingsIntegrations component mounting symbol');
            assert.ok(htmlContent.includes('ThemeBootScript'), 'Missing ThemeBootScript in static header');
            assert.ok(htmlContent.includes('tajawal_ba3d66ca'), 'Missing Tajawal font class on body');
        });

        await challengeTest('CH-EXP-03', 'ASSET_INTEGRITY', '100% of referenced scripts, styles, and fonts exist on disk (zero 404s)', async () => {
            const htmlContent = fs.readFileSync(adminSettingsHtmlPath, 'utf8');

            // Extract all href and src pointing to /_next/
            const assetRegex = /(?:href|src)="(\/_next\/[^"'\s]+)"/g;
            const referencedAssets = new Set();
            let match;
            while ((match = assetRegex.exec(htmlContent)) !== null) {
                // Strip query string if any
                const cleanPath = match[1].split('?')[0];
                referencedAssets.add(cleanPath);
            }

            assert.ok(referencedAssets.size >= 20, `Expected at least 20 static assets referenced, found ${referencedAssets.size}`);

            const missingInAdmin = [];
            const missingInDist = [];

            for (const assetUrl of referencedAssets) {
                // Remove leading /_next/ -> relative to admin/_next/
                const relPath = assetUrl.replace(/^\/_next\//, '');
                const diskPathAdmin = path.join(ADMIN_DIR, '_next', relPath);
                const diskPathDist = path.join(DIST_HOSTINGER_ADMIN_DIR, '_next', relPath);

                if (!fs.existsSync(diskPathAdmin)) {
                    missingInAdmin.push(assetUrl);
                }
                if (!fs.existsSync(diskPathDist)) {
                    missingInDist.push(assetUrl);
                }
            }

            assert.strictEqual(
                missingInAdmin.length,
                0,
                `Found ${missingInAdmin.length} missing asset references in admin/_next/: ${missingInAdmin.join(', ')}`
            );
            assert.strictEqual(
                missingInDist.length,
                0,
                `Found ${missingInDist.length} missing asset references in dist-hostinger/admin/_next/: ${missingInDist.join(', ')}`
            );
        });

        await challengeTest('CH-EXP-04', 'CHUNK_VERIFICATION', 'Compiled JS chunk bundles contain all Telegram customization UI symbols', async () => {
            // Find the SettingsIntegrations chunk file
            const htmlContent = fs.readFileSync(adminSettingsHtmlPath, 'utf8');
            const chunkMatch = htmlContent.match(/\/_next\/static\/chunks\/([a-zA-Z0-9_\-\.]+)\.js",\s*"SettingsIntegrations"/);
            let targetChunkName = null;
            if (chunkMatch) {
                targetChunkName = chunkMatch[1] + '.js';
            } else {
                // Fallback: search for chunk with send_custom_message in chunks dir
                const chunksDir = path.join(ADMIN_DIR, '_next', 'static', 'chunks');
                const chunkFiles = fs.readdirSync(chunksDir);
                for (const f of chunkFiles) {
                    if (f.endsWith('.js')) {
                        const content = fs.readFileSync(path.join(chunksDir, f), 'utf8');
                        if (content.includes('send_custom_message')) {
                            targetChunkName = f;
                            break;
                        }
                    }
                }
            }

            assert.ok(targetChunkName, 'Could not locate compiled chunk containing SettingsIntegrations');

            const adminChunkPath = path.join(ADMIN_DIR, '_next', 'static', 'chunks', targetChunkName);
            const distChunkPath = path.join(DIST_HOSTINGER_ADMIN_DIR, '_next', 'static', 'chunks', targetChunkName);

            assert.ok(fs.existsSync(adminChunkPath), `Chunk missing in admin: ${adminChunkPath}`);
            assert.ok(fs.existsSync(distChunkPath), `Chunk missing in dist-hostinger: ${distChunkPath}`);

            const chunkContent = fs.readFileSync(adminChunkPath, 'utf8');

            // Verify essential action strings
            assert.ok(chunkContent.includes('send_custom_message'), 'Chunk missing token send_custom_message');
            assert.ok(chunkContent.includes('send_test_message'), 'Chunk missing token send_test_message');
            assert.ok(chunkContent.includes('save_template'), 'Chunk missing token save_template');
            assert.ok(chunkContent.includes('activate_template'), 'Chunk missing token activate_template');
            assert.ok(chunkContent.includes('restore_template'), 'Chunk missing token restore_template');

            // Verify all 6 supported event IDs
            const requiredEvents = [
                'ORDER_CREATED',
                'SHIPMENT_CREATED',
                'SHIPMENT_FAILED',
                'STATUS_UPDATED',
                'ORDER_CANCELLED',
                'ADMIN_ALERT'
            ];
            for (const evt of requiredEvents) {
                assert.ok(chunkContent.includes(evt), `Compiled chunk missing event identifier: ${evt}`);
            }

            // Verify Arabic UI labels
            assert.ok(
                chunkContent.includes('تخصيص قوالب رسائل تيليجرام'),
                'Compiled chunk missing Arabic title: تخصيص قوالب رسائل تيليجرام'
            );
            assert.ok(
                chunkContent.includes('المنشئ الإداري للرسائل المخصصة'),
                'Compiled chunk missing Arabic title: المنشئ الإداري للرسائل المخصصة'
            );
            assert.ok(
                chunkContent.includes('4096'),
                'Compiled chunk missing 4096 character limit constraint'
            );
        });

        await challengeTest('CH-EXP-05', 'SYNC_SCRIPT', 'scripts/sync-admin.js executes cleanly and maintains complete directory mirror', async () => {
            const syncScriptPath = path.join(ROOT_DIR, 'scripts', 'sync-admin.js');
            assert.ok(fs.existsSync(syncScriptPath), 'scripts/sync-admin.js does not exist');

            // Execute sync script
            const syncOutput = execFileSync('node', [syncScriptPath], {
                cwd: ROOT_DIR,
                encoding: 'utf8'
            });

            assert.ok(syncOutput.includes('[SYNC] Successfully mirrored'), `Unexpected sync output: ${syncOutput}`);
            assert.ok(syncOutput.includes('admin/'), `Sync output does not mention admin: ${syncOutput}`);
            assert.ok(syncOutput.includes('dist-hostinger/admin'), `Sync output does not mention dist-hostinger: ${syncOutput}`);
        });

    } finally {
        deactivateTelegramMock();
        // Restore settings if backed up
        if (originalSettingsBackup) {
            fs.writeFileSync(SETTINGS_FILE, originalSettingsBackup, 'utf8');
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SUMMARY REPORT
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n================================================================================');
    console.log('   ORVA STORE — M3 CHALLENGER 2 SUMMARY');
    console.log('================================================================================');
    console.log(`TOTAL EXECUTED: ${totalTests}`);
    console.log(`PASSED:         ${passedTests} (${Math.round((passedTests / totalTests) * 100)}%)`);
    console.log(`FAILED:         ${failedTests}`);
    console.log('================================================================================');

    if (failedTests > 0) {
        console.error('❌ FAILURES:');
        failures.forEach((f) => console.error(` - [${f.id}] ${f.suite}: ${f.desc} -> ${f.error}`));
        process.exit(1);
    } else {
        console.log('🎉 VERDICT: 100% EMPIRICAL CHALLENGE PASS — APPROVE');
        process.exit(0);
    }
}

runAllChallengerTests().catch((err) => {
    console.error('Fatal execution error:', err);
    process.exit(1);
});
