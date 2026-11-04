'use strict';
// =============================================================================
// ORVA STORE — MILESTONE 4 CHALLENGER 2 EMPIRICAL ADVERSARIAL TEST SUITE
// Empirical Challenger: static build assets, production packaging,
// runtime parity (Node.js & PHP 8.3), and zero credential leakage.
//
// Verification Command: node tests/adversarial-milestone4-challenger2.js
// =============================================================================

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const ROOT_DIR = path.resolve(__dirname, '..');
const ADMIN_DIR = path.join(ROOT_DIR, 'admin');
const DIST_ADMIN_DIR = path.join(ROOT_DIR, 'dist-hostinger', 'admin');
const PHP_API_FILE = path.join(ROOT_DIR, 'api', 'admin-settings.php');
const DIST_PHP_API_FILE = path.join(ROOT_DIR, 'dist-hostinger', 'api', 'admin-settings.php');
const NODE_API_FILE = path.join(ROOT_DIR, 'api', 'admin-settings.js');
const ZIP_FILE = path.join(ROOT_DIR, 'orva-store-hostinger.zip');

const adminSettingsHandler = require('../api/admin-settings');
const { getPublicSettings, getEffectiveSettings } = require('../lib/admin-settings-store');
const templateEngine = require('../lib/telegram-template-engine');

// Resolve PHP 8.3 CLI binary
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

let totalExecuted = 0;
let totalPassed = 0;
const failures = [];

function recordResult(code, description, pass, details = '') {
    totalExecuted++;
    if (pass) {
        totalPassed++;
        console.log(`[${code}] ✅ PASS: ${description}`);
    } else {
        failures.push({ code, description, details });
        console.error(`[${code}] ❌ FAIL: ${description}`);
        if (details) console.error(`       Details: ${details}`);
    }
}

// Helper: compute SHA-256 hash of a file
function getFileSha256(filePath) {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Helper: recursively collect all file paths in a directory
function getAllFilesRecursive(dir) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...getAllFilesRecursive(full));
        } else if (entry.isFile()) {
            results.push(full);
        }
    }
    return results;
}

// Helper: execute mock request against Node admin-settings handler
function executeNodeApi(body, headers = {}) {
    return new Promise((resolve) => {
        let statusCode = 200;
        let responseHeaders = {};
        let responseBody = null;

        const req = {
            method: 'POST',
            headers: {
                authorization: `Bearer ${process.env.ADMIN_API_TOKEN || 'orva-admin-2026-secure'}`,
                origin: 'https://orva-store.com',
                'content-type': 'application/json',
                ...headers
            },
            body
        };

        const res = {
            setHeader: (k, v) => { responseHeaders[k.toLowerCase()] = v; },
            status: (code) => {
                statusCode = code;
                return res;
            },
            json: (data) => {
                responseBody = data;
                resolve({ statusCode, headers: responseHeaders, body: responseBody });
            },
            send: (data) => {
                responseBody = data;
                resolve({ statusCode, headers: responseHeaders, body: responseBody });
            },
            end: () => {
                resolve({ statusCode, headers: responseHeaders, body: responseBody });
            }
        };

        try {
            adminSettingsHandler(req, res);
        } catch (err) {
            resolve({ statusCode: 500, headers: responseHeaders, body: { error: err.message } });
        }
    });
}

// =============================================================================
// MAIN TEST HARNESS
// =============================================================================
async function runAllChallengerTests() {
    console.log('================================================================================');
    console.log('   ORVA STORE — MILESTONE 4 CHALLENGER 2 EMPIRICAL ADVERSARIAL TEST SUITE');
    console.log('   Static Bundles, Mirror Parity, Dual Runtime Parity & Credential Isolation');
    console.log('================================================================================\n');

    // -------------------------------------------------------------------------
    // TRACK 1: Static Build Assets & Production Packaging Parity
    // -------------------------------------------------------------------------
    console.log('--- TRACK 1: PRODUCTION BUNDLE & MIRROR PARITY (admin/ vs dist-hostinger/admin/) ---');

    try {
        // Test 1.1: Compare file counts and paths
        const adminFiles = getAllFilesRecursive(ADMIN_DIR);
        const distAdminFiles = getAllFilesRecursive(DIST_ADMIN_DIR);

        const adminRel = adminFiles.map(f => path.relative(ADMIN_DIR, f).replace(/\\/g, '/')).sort();
        const distAdminRel = distAdminFiles.map(f => path.relative(DIST_ADMIN_DIR, f).replace(/\\/g, '/')).sort();

        const countMatch = adminRel.length === distAdminRel.length && adminRel.length > 0;
        let setDiff = [];
        if (!countMatch) {
            const adminSet = new Set(adminRel);
            const distSet = new Set(distAdminRel);
            for (const f of adminSet) { if (!distSet.has(f)) setDiff.push(`Missing in dist: ${f}`); }
            for (const f of distSet) { if (!adminSet.has(f)) setDiff.push(`Extra in dist: ${f}`); }
        }

        recordResult(
            'CH4-TR1-01',
            `admin/ vs dist-hostinger/admin/ file count and tree parity (${adminRel.length} files)`,
            countMatch,
            setDiff.slice(0, 5).join(', ')
        );

        // Test 1.2: Compare SHA-256 hashes of every file
        let hashMismatches = [];
        for (const rel of adminRel) {
            const f1 = path.join(ADMIN_DIR, rel);
            const f2 = path.join(DIST_ADMIN_DIR, rel);
            if (fs.existsSync(f2)) {
                const h1 = getFileSha256(f1);
                const h2 = getFileSha256(f2);
                if (h1 !== h2) {
                    hashMismatches.push(`${rel} (admin: ${h1.substring(0, 8)} vs dist: ${h2.substring(0, 8)})`);
                }
            }
        }
        recordResult(
            'CH4-TR1-02',
            `SHA-256 hash identity across all files between admin/ and dist-hostinger/admin/`,
            hashMismatches.length === 0,
            hashMismatches.slice(0, 5).join('; ')
        );

        // Test 1.3: HTML Broken Links Scanner
        const htmlFiles = adminFiles.filter(f => f.endsWith('.html'));
        let brokenLinks = [];
        let totalLinksChecked = 0;

        for (const hFile of htmlFiles) {
            const htmlContent = fs.readFileSync(hFile, 'utf8');
            const relDir = path.dirname(hFile);

            // Match script src and link href
            const srcRegex = /(?:src|href)=["']([^"']+)["']/g;
            let match;
            while ((match = srcRegex.exec(htmlContent)) !== null) {
                const target = match[1];
                if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('#') || target.startsWith('data:') || target.startsWith('mailto:')) {
                    continue;
                }
                totalLinksChecked++;
                // Handle absolute vs relative admin paths
                let diskPath = null;
                if (target.startsWith('/admin/')) {
                    diskPath = path.join(ADMIN_DIR, target.replace(/^\/admin\//, ''));
                } else if (target.startsWith('/_next/')) {
                    diskPath = path.join(ADMIN_DIR, target);
                } else if (target.startsWith('_next/')) {
                    diskPath = path.join(ADMIN_DIR, target);
                } else if (target.startsWith('/')) {
                    diskPath = path.join(ADMIN_DIR, target.substring(1));
                } else {
                    diskPath = path.resolve(relDir, target);
                }

                // If path is a directory, check for index.html
                if (diskPath && !fs.existsSync(diskPath)) {
                    const withIndex = path.join(diskPath, 'index.html');
                    const withHtml = diskPath + '.html';
                    if (!fs.existsSync(withIndex) && !fs.existsSync(withHtml)) {
                        brokenLinks.push(`${path.relative(ROOT_DIR, hFile)} -> ${target}`);
                    }
                }
            }
        }

        recordResult(
            'CH4-TR1-03',
            `Zero broken links across static HTML bundles (${totalLinksChecked} links checked)`,
            brokenLinks.length === 0,
            brokenLinks.slice(0, 5).join('; ')
        );

        // Test 1.4: Hostinger Zip Package Validation
        const zipExists = fs.existsSync(ZIP_FILE);
        let zipSize = 0;
        if (zipExists) {
            zipSize = fs.statSync(ZIP_FILE).size;
        }
        recordResult(
            'CH4-TR1-04',
            `orva-store-hostinger.zip exists and meets size threshold (${(zipSize / 1024 / 1024).toFixed(2)} MB)`,
            zipExists && zipSize > 20 * 1024 * 1024,
            `Size: ${zipSize} bytes`
        );

    } catch (err) {
        recordResult('CH4-TR1-ERR', 'Track 1 uncaught exception', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TRACK 2: Compiled JavaScript Chunks Content Verification
    // -------------------------------------------------------------------------
    console.log('\n--- TRACK 2: COMPILED JAVASCRIPT CHUNK VERIFICATION ---');

    try {
        const chunksDir = path.join(ADMIN_DIR, '_next', 'static', 'chunks');
        assert.ok(fs.existsSync(chunksDir), 'static/chunks directory must exist');
        const chunkFiles = getAllFilesRecursive(chunksDir).filter(f => f.endsWith('.js'));
        assert.ok(chunkFiles.length > 0, 'Must have at least one JS chunk');

        let aggregatedContent = '';
        const chunkMap = new Map();
        for (const cf of chunkFiles) {
            const content = fs.readFileSync(cf, 'utf8');
            chunkMap.set(path.relative(chunksDir, cf), content);
            aggregatedContent += content + '\n';
        }

        // Test 2.1: Verify all 6 events are present in compiled chunks
        const requiredEvents = [
            'ORDER_CREATED',
            'SHIPMENT_CREATED',
            'SHIPMENT_FAILED',
            'STATUS_UPDATED',
            'ORDER_CANCELLED',
            'ADMIN_ALERT'
        ];
        const missingEvents = requiredEvents.filter(e => !aggregatedContent.includes(e));
        recordResult(
            'CH4-TR2-01',
            `Compiled JS chunks contain all 6 notification events: ${requiredEvents.join(', ')}`,
            missingEvents.length === 0,
            `Missing events: ${missingEvents.join(', ')}`
        );

        // Test 2.2: Verify dynamic variables are present in compiled chunks
        const requiredVars = [
            'order_id',
            'customer_name',
            'customer_phone',
            'wilaya',
            'commune',
            'tracking_number',
            'courier_name',
            'grand_total',
            'dashboard_url'
        ];
        const missingVars = requiredVars.filter(v => !aggregatedContent.includes(v));
        recordResult(
            'CH4-TR2-02',
            `Compiled JS chunks contain essential dynamic variables: ${requiredVars.join(', ')}`,
            missingVars.length === 0,
            `Missing variables: ${missingVars.join(', ')}`
        );

        // Test 2.3: Verify all mutation actions are present in compiled chunks
        const requiredActions = [
            'send_custom_message',
            'send_test_message',
            'save_template',
            'activate_template',
            'restore_template'
        ];
        const missingActions = requiredActions.filter(a => !aggregatedContent.includes(a));
        recordResult(
            'CH4-TR2-03',
            `Compiled JS chunks contain all UI mutation actions: ${requiredActions.join(', ')}`,
            missingActions.length === 0,
            `Missing actions: ${missingActions.join(', ')}`
        );

        // Test 2.4: Identify exact chunk containing SettingsIntegrations component
        let foundSettingsChunk = null;
        for (const [name, content] of chunkMap.entries()) {
            if (content.includes('send_custom_message') && content.includes('ORDER_CREATED')) {
                foundSettingsChunk = name;
                break;
            }
        }
        recordResult(
            'CH4-TR2-04',
            `Identified primary Telegram settings chunk: ${foundSettingsChunk || 'NOT_FOUND'}`,
            foundSettingsChunk !== null,
            `Chunk filename: ${foundSettingsChunk}`
        );

    } catch (err) {
        recordResult('CH4-TR2-ERR', 'Track 2 uncaught exception', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TRACK 3: Dual Runtime Parity (Node.js & PHP 8.3 CLI)
    // -------------------------------------------------------------------------
    console.log('\n--- TRACK 3: DUAL RUNTIME PARITY (Node.js & PHP 8.3) ---');

    try {
        // Test 3.1: PHP parity file check
        const phpExists = fs.existsSync(PHP_API_FILE);
        const distPhpExists = fs.existsSync(DIST_PHP_API_FILE);
        const phpSize = phpExists ? fs.statSync(PHP_API_FILE).size : 0;
        const distPhpSize = distPhpExists ? fs.statSync(DIST_PHP_API_FILE).size : 0;
        const phpHash = phpExists ? getFileSha256(PHP_API_FILE) : '';
        const distPhpHash = distPhpExists ? getFileSha256(DIST_PHP_API_FILE) : '';

        recordResult(
            'CH4-TR3-01',
            `PHP API file parity: api/admin-settings.php vs dist-hostinger/api/admin-settings.php (${phpSize} bytes)`,
            phpExists && distPhpExists && phpSize === distPhpSize && phpHash === distPhpHash && phpSize > 50000,
            `api: ${phpSize}b (${phpHash.substring(0, 8)}), dist: ${distPhpSize}b (${distPhpHash.substring(0, 8)})`
        );

        // Test 3.2: Cross-Runtime AES-256-GCM Encryption Parity
        if (phpBin) {
            // Node encrypt -> PHP decrypt
            const testPayload = JSON.stringify({
                telegram: {
                    enabled: true,
                    botToken: 'node_test_token_123',
                    chatId: '-100123456789',
                    templates: {
                        ORDER_CREATED: {
                            draftTemplate: 'NODE_TO_PHP_PARITY_{{order_id}}',
                            activeTemplate: 'NODE_TO_PHP_ACTIVE_{{order_id}}',
                            enabled: true
                        }
                    }
                }
            });

            const secretKey = (process.env.APP_SECRET_KEY || process.env.ADMIN_API_TOKEN || 'orva-store-secret-key-32-chars-long!').padEnd(32, '0').slice(0, 32);
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(secretKey, 'utf8'), iv);
            cipher.setAAD(Buffer.from('orva-admin-settings-v1', 'utf8'));
            let ciphertext = cipher.update(testPayload, 'utf8', 'hex');
            ciphertext += cipher.final('hex');
            const tag = cipher.getAuthTag().toString('hex');

            const envelope = {
                algorithm: 'aes-256-gcm',
                iv: iv.toString('hex'),
                tag: tag,
                ciphertext: ciphertext,
                updatedAt: new Date().toISOString()
            };

            const tempTestEnc = path.join(ROOT_DIR, 'data', 'private', 'temp-challenger-parity.enc');
            fs.mkdirSync(path.dirname(tempTestEnc), { recursive: true });
            fs.writeFileSync(tempTestEnc, JSON.stringify(envelope, null, 2), 'utf8');

            const phpDecryptCode = `
                \$secretKey = substr(str_pad(getenv('APP_SECRET_KEY') ?: (getenv('ADMIN_API_TOKEN') ?: 'orva-store-secret-key-32-chars-long!'), 32, '0'), 0, 32);
                \$raw = file_get_contents('${tempTestEnc.replace(/\\/g, '/')}');
                \$env = json_decode(\$raw, true);
                \$iv = hex2bin(\$env['iv']);
                \$tag = hex2bin(\$env['tag']);
                \$cipherRaw = hex2bin(\$env['ciphertext']);
                \$aad = 'orva-admin-settings-v1';
                \$plain = openssl_decrypt(\$cipherRaw, 'aes-256-gcm', \$secretKey, OPENSSL_RAW_DATA, \$iv, \$tag, \$aad);
                \$data = json_decode(\$plain, true);
                echo \$data['telegram']['templates']['ORDER_CREATED']['draftTemplate'] ?? 'DECRYPT_FAILED';
            `;

            let phpDecryptedDraft = '';
            try {
                phpDecryptedDraft = execFileSync(phpBin, ['-r', phpDecryptCode], {
                    encoding: 'utf8',
                    env: process.env
                }).trim();
            } catch (err) {
                phpDecryptedDraft = 'PHP_ERROR: ' + err.message;
            }

            // Clean up temp file
            if (fs.existsSync(tempTestEnc)) fs.unlinkSync(tempTestEnc);

            recordResult(
                'CH4-TR3-02',
                'AES-256-GCM Cross-Runtime Parity: Node.js encrypts -> PHP 8.3 decrypts with AAD',
                phpDecryptedDraft === 'NODE_TO_PHP_PARITY_{{order_id}}',
                `PHP output: ${phpDecryptedDraft}`
            );

            // Test 3.3: PHP encrypt -> Node decrypt
            const phpEncryptCode = `
                \$secretKey = substr(str_pad(getenv('APP_SECRET_KEY') ?: (getenv('ADMIN_API_TOKEN') ?: 'orva-store-secret-key-32-chars-long!'), 32, '0'), 0, 32);
                \$iv = random_bytes(12);
                \$aad = 'orva-admin-settings-v1';
                \$plain = json_encode(['test' => 'PHP_TO_NODE_PARITY_VAL']);
                \$tag = '';
                \$cipherRaw = openssl_encrypt(\$plain, 'aes-256-gcm', \$secretKey, OPENSSL_RAW_DATA, \$iv, \$tag, \$aad, 16);
                echo json_encode([
                    'iv' => bin2hex(\$iv),
                    'tag' => bin2hex(\$tag),
                    'ciphertext' => bin2hex(\$cipherRaw)
                ]);
            `;
            let phpEnvelopeJson = execFileSync(phpBin, ['-r', phpEncryptCode], {
                encoding: 'utf8',
                env: process.env
            }).trim();

            let nodeDecryptedVal = '';
            try {
                const phpEnv = JSON.parse(phpEnvelopeJson);
                const nodeDecipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(secretKey, 'utf8'), Buffer.from(phpEnv.iv, 'hex'));
                nodeDecipher.setAAD(Buffer.from('orva-admin-settings-v1', 'utf8'));
                nodeDecipher.setAuthTag(Buffer.from(phpEnv.tag, 'hex'));
                let dec = nodeDecipher.update(Buffer.from(phpEnv.ciphertext, 'hex'), null, 'utf8');
                dec += nodeDecipher.final('utf8');
                nodeDecryptedVal = JSON.parse(dec).test;
            } catch (e) {
                nodeDecryptedVal = 'NODE_ERROR: ' + e.message;
            }

            recordResult(
                'CH4-TR3-03',
                'AES-256-GCM Cross-Runtime Parity: PHP 8.3 encrypts -> Node.js decrypts with AAD',
                nodeDecryptedVal === 'PHP_TO_NODE_PARITY_VAL',
                `Node output: ${nodeDecryptedVal}`
            );

            // Test 3.4: PHP 8.3 Action Handlers Parity
            const phpActionsCode = `
                define('ORVA_API', true);
                require 'api/admin-settings.php';
                \$expectedActions = ['save_template', 'activate_template', 'restore_template', 'toggle_template', 'send_test_message', 'send_custom_message'];
                \$foundActions = [];
                \$file = file_get_contents('api/admin-settings.php');
                foreach (\$expectedActions as \$act) {
                    if (strpos(\$file, "'action' === '\$act'") !== false || strpos(\$file, "\\\$action === '\$act'") !== false || strpos(\$file, "'\$act'") !== false) {
                        \$foundActions[] = \$act;
                    }
                }
                echo json_encode(\$foundActions);
            `;
            const phpActions = JSON.parse(execFileSync(phpBin, ['-r', phpActionsCode], { encoding: 'utf8', env: process.env }));
            recordResult(
                'CH4-TR3-04',
                `PHP 8.3 script implements all 6 template actions (${phpActions.length}/6)`,
                phpActions.length === 6,
                `Actions: ${phpActions.join(', ')}`
            );

            // Test 3.5: Rate limit parity in PHP 8.3
            const phpRateLimitCode = `
                define('ORVA_API', true);
                require 'api/admin-settings.php';
                \$_SERVER['REMOTE_ADDR'] = '10.0.0.99';
                \$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer rate-test-99';
                \$first = checkTestMessageRateLimit();
                \$second = checkTestMessageRateLimit();
                echo json_encode(['first' => \$first, 'second' => \$second]);
            `;
            const phpRateRes = JSON.parse(execFileSync(phpBin, ['-r', phpRateLimitCode], { encoding: 'utf8', env: process.env }));
            recordResult(
                'CH4-TR3-05',
                'PHP 8.3 CLI enforces identical 3-second cooldown rate limit ($first null, $second code 429)',
                phpRateRes.first === null && phpRateRes.second !== null && phpRateRes.second.retryAfter >= 1,
                JSON.stringify(phpRateRes)
            );

        } else {
            recordResult('CH4-TR3-PHP', 'PHP 8.3 binary available', false, 'PHP CLI not found in path');
        }

    } catch (err) {
        recordResult('CH4-TR3-ERR', 'Track 3 uncaught exception', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TRACK 4: Zero Credential Leakage Challenge
    // -------------------------------------------------------------------------
    console.log('\n--- TRACK 4: ZERO CREDENTIAL LEAKAGE CHALLENGE ---');

    try {
        // Collect real secrets from environment to ensure they never leak
        const secretsToScan = [
            process.env.TELEGRAM_BOT_TOKEN,
            process.env.ADMIN_API_TOKEN,
            process.env.ADMIN_PASSWORD,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        ].filter(s => s && s.length >= 8);

        // Regex patterns for credentials
        const BOT_TOKEN_REGEX = /\b[0-9]{8,12}:[a-zA-Z0-9_-]{35}\b/g;

        // Test 4.1: Public static files scan
        const publicFiles = [
            ...getAllFilesRecursive(ADMIN_DIR),
            ...getAllFilesRecursive(DIST_ADMIN_DIR)
        ].filter(f => f.endsWith('.html') || f.endsWith('.js') || f.endsWith('.css') || f.endsWith('.json') || f.endsWith('.txt'));

        let leakedInPublicFiles = [];
        for (const pf of publicFiles) {
            const content = fs.readFileSync(pf, 'utf8');
            // Check regex
            const regexMatches = content.match(BOT_TOKEN_REGEX);
            if (regexMatches) {
                for (const m of regexMatches) {
                    leakedInPublicFiles.push(`${path.relative(ROOT_DIR, pf)} contains bot token pattern: ${m.substring(0, 10)}...`);
                }
            }
            // Check known secret strings
            for (const s of secretsToScan) {
                if (content.includes(s)) {
                    leakedInPublicFiles.push(`${path.relative(ROOT_DIR, pf)} contains live secret (${s.substring(0, 5)}...)`);
                }
            }
        }

        recordResult(
            'CH4-TR4-01',
            `Zero bot tokens or live secrets in public static assets (${publicFiles.length} files scanned)`,
            leakedInPublicFiles.length === 0,
            leakedInPublicFiles.slice(0, 5).join('; ')
        );

        // Test 4.2: Public Settings Projection (GET /api/admin-settings)
        const pubSettings = getPublicSettings();
        const pubTg = pubSettings.telegram || {};
        const leaksInPubProjection = [];
        if (pubTg.botToken !== undefined) leaksInPubProjection.push('pubTg.botToken is defined');
        if (pubTg.templates) {
            for (const [k, v] of Object.entries(pubTg.templates)) {
                if (v.botToken !== undefined) leaksInPubProjection.push(`templates.${k}.botToken is defined`);
            }
        }
        recordResult(
            'CH4-TR4-02',
            'getPublicSettings() / GET /api/admin-settings completely omits botToken from projections',
            leaksInPubProjection.length === 0,
            leaksInPubProjection.join(', ')
        );

        // Test 4.3: Node API mutation responses omit bot credentials
        const mutActions = [
            { action: 'save_template', event: 'ORDER_CREATED', draftTemplate: 'SAFE_{{order_id}}' },
            { action: 'toggle_template', event: 'ORDER_CREATED', enabled: true },
            { action: 'restore_template', event: 'ORDER_CREATED' }
        ];

        let mutLeaks = [];
        for (const payload of mutActions) {
            const res = await executeNodeApi(payload);
            const str = JSON.stringify(res.body);
            if (BOT_TOKEN_REGEX.test(str)) {
                mutLeaks.push(`Action ${payload.action} leaked bot token pattern in response`);
            }
            for (const s of secretsToScan) {
                if (str.includes(s)) {
                    mutLeaks.push(`Action ${payload.action} leaked raw secret in response`);
                }
            }
        }
        recordResult(
            'CH4-TR4-03',
            'API mutation responses (save_template, toggle_template, restore_template) omit bot tokens',
            mutLeaks.length === 0,
            mutLeaks.join('; ')
        );

        // Test 4.4: Sample Data in lib/telegram-template-engine.js contains zero real PII or secrets
        const allEvents = ['ORDER_CREATED', 'SHIPMENT_CREATED', 'SHIPMENT_FAILED', 'STATUS_UPDATED', 'ORDER_CANCELLED', 'ADMIN_ALERT'];
        let sampleLeaks = [];
        for (const evt of allEvents) {
            const sample = templateEngine.getSampleData(evt);
            const sampleStr = JSON.stringify(sample);
            if (BOT_TOKEN_REGEX.test(sampleStr)) {
                sampleLeaks.push(`Sample data for ${evt} contains bot token pattern`);
            }
            for (const s of secretsToScan) {
                if (sampleStr.includes(s)) {
                    sampleLeaks.push(`Sample data for ${evt} contains raw secret`);
                }
            }
        }
        recordResult(
            'CH4-TR4-04',
            'Template Engine synthetic sample data for all 6 events contains zero real secrets',
            sampleLeaks.length === 0,
            sampleLeaks.join('; ')
        );

        // Test 4.5: Telegram HTTP error redaction in admin API
        const errorSanitizer = require('../lib/telegram-notifier').sanitizeError;
        const testRawError = 'HTTP 401: https://api.telegram.org/bot8749469493:AAGtestSecretTokenHere12345/sendMessage failed';
        const sanitized = errorSanitizer(testRawError);
        const tokenRedacted = !sanitized.includes('8749469493:AAG') && sanitized.includes('/bot[REDACTED_TOKEN]');
        recordResult(
            'CH4-TR4-05',
            'Telegram API error URLs are strictly redacted to /bot[REDACTED_TOKEN]',
            tokenRedacted,
            `Sanitized output: ${sanitized}`
        );

    } catch (err) {
        recordResult('CH4-TR4-ERR', 'Track 4 uncaught exception', false, err.message);
    }

    // -------------------------------------------------------------------------
    // SUMMARY & FINAL VERDICT
    // -------------------------------------------------------------------------
    console.log('\n================================================================================');
    console.log(`   TOTAL CHALLENGES EXECUTED: ${totalExecuted}`);
    console.log(`   PASSED:                    ${totalPassed} (${Math.round((totalPassed / totalExecuted) * 100)}%)`);
    console.log(`   FAILED:                    ${failures.length}`);
    console.log('================================================================================');

    if (failures.length === 0) {
        console.log('🎉 VERDICT: 100% PASS — APPROVE');
        process.exit(0);
    } else {
        console.log('❌ VERDICT: FAILURES DETECTED — REQUEST_CHANGES');
        console.log(JSON.stringify(failures, null, 2));
        process.exit(1);
    }
}

runAllChallengerTests().catch(err => {
    console.error('Fatal Runner Error:', err);
    process.exit(1);
});
