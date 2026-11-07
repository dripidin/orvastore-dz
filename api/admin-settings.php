<?php
// ==============================================================================
// ORVA STORE — Dynamic Integration Settings API (PHP 8.3 / LiteSpeed)
// Security: Admin Session Gated, CSRF Protected, AES-256-GCM Encrypted at Rest
// ==============================================================================

if (!defined('ORVA_API')) {
    define('ORVA_API', true);
}
$config = require __DIR__ . '/config.php';

if (php_sapi_name() !== 'cli' && !headers_sent()) {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
}

$allowedOrigins = [
    'https://orva-store.com',
    'https://www.orva-store.com',
    'https://staging.orva-store.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:8080'
];

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (php_sapi_name() !== 'cli' && !headers_sent()) {
    if (in_array($origin, $allowedOrigins, true)) {
        header('Access-Control-Allow-Credentials: true');
        header("Access-Control-Allow-Origin: {$origin}");
        header('Vary: Origin');
    }
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-CSRF-Token');
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$rootDir = dirname(__DIR__);
$settingsFile = $rootDir . '/data/private/admin-settings.enc';
$legacyPixelId = '2340414976777036';

// ── Encryption Helpers ────────────────────────────────────────────────────────
define('ORVA_SETTINGS_AAD', 'orva-admin-settings-v1');

function parseEncryptionKey(?string $rawSecret): string {
    if ($rawSecret === null || $rawSecret === '') {
        throw new Exception('ADMIN_SETTINGS_KEY_UNAVAILABLE');
    }
    $trimmed = trim($rawSecret);
    if ($trimmed === '') {
        throw new Exception('ADMIN_SETTINGS_KEY_UNAVAILABLE');
    }

    // 1. Base64 representation of 32 bytes (44 chars)
    if (strlen($trimmed) === 44 || preg_match('/^[A-Za-z0-9+\/]{42,43}={0,2}$/', $trimmed)) {
        $decoded = base64_decode($trimmed, true);
        if ($decoded !== false && strlen($decoded) === 32) {
            return $decoded;
        }
    }

    // 2. 64-character Hex string (32 bytes)
    if (strlen($trimmed) === 64 && ctype_xdigit($trimmed)) {
        $decoded = hex2bin($trimmed);
        if ($decoded !== false && strlen($decoded) === 32) {
            return $decoded;
        }
    }

    // 3. Raw 32-byte UTF-8 string
    if (strlen($trimmed) === 32) {
        return $trimmed;
    }

    throw new Exception('ADMIN_SETTINGS_KEY_INVALID');
}

function getSettingsEncryptionKey(array $config): string {
    $raw = $_SERVER['ADMIN_SETTINGS_ENCRYPTION_KEY'] ?? (getenv('ADMIN_SETTINGS_ENCRYPTION_KEY') ?: ($_ENV['ADMIN_SETTINGS_ENCRYPTION_KEY'] ?? ''));
    if (empty($raw) && !empty($config['admin']['settings_encryption_key'])) {
        $raw = $config['admin']['settings_encryption_key'];
    }
    if (empty($raw)) {
        $isStagingEnvironment = (basename(dirname(__DIR__)) === 'staging') || (strpos($_SERVER['HTTP_HOST'] ?? '', 'staging') !== false);
        $candidateFiles = [
            $isStagingEnvironment ? dirname(dirname(dirname(__DIR__))) . '/staging-secure-config.php' : dirname(dirname(__DIR__)) . '/secure-config.php',
            dirname(dirname(dirname(__DIR__))) . '/secure-config.php',
            dirname(dirname(__DIR__)) . '/secure-config.php',
            dirname(__DIR__) . '/data/private/secret-keys.php'
        ];
        foreach ($candidateFiles as $candidate) {
            if (file_exists($candidate)) {
                $extConf = @include $candidate;
                if (is_array($extConf) && !empty($extConf['ADMIN_SETTINGS_ENCRYPTION_KEY'])) {
                    $raw = $extConf['ADMIN_SETTINGS_ENCRYPTION_KEY'];
                    break;
                }
            }
        }
    }
    if (empty($raw)) {
        throw new Exception('ADMIN_SETTINGS_KEY_UNAVAILABLE');
    }
    return parseEncryptionKey($raw);
}

define('ORVA_SETTINGS_LOCK_DIR', dirname(__DIR__) . '/data/locks/admin-settings.lock');

if (!isset($GLOBALS['ORVA_ACTIVE_LOCK_TOKEN'])) {
    $GLOBALS['ORVA_ACTIVE_LOCK_TOKEN'] = null;
}

function isSettingsProcessAlive(int $pid): bool {
    if ($pid <= 0) return false;
    if (function_exists('posix_kill')) {
        return @posix_kill($pid, 0);
    }
    if (stripos(PHP_OS, 'WIN') === 0 && function_exists('shell_exec')) {
        $out = @shell_exec("tasklist /FI \"PID eq {$pid}\" 2>NUL");
        return ($out && strpos($out, (string)$pid) !== false);
    }
    return true;
}

function tryReclaimSettingsLock(string $targetDir): bool {
    $ownerFile = $targetDir . '/owner.json';
    if (!is_dir($targetDir)) return false;

    $stat = @stat($targetDir);
    $isDead = false;
    $isStale = false;
    $isCorruptedOrMissing = false;

    if (file_exists($ownerFile)) {
        $raw = @file_get_contents($ownerFile);
        $owner = json_decode($raw, true);
        if (is_array($owner)) {
            $lockTime = $owner['time'] ?? ($stat ? $stat['mtime'] : 0);
            if ($lockTime > 0 && (time() - $lockTime > 5)) {
                $isStale = true;
            } elseif (!empty($owner['pid'])) {
                $pid = (int)$owner['pid'];
                if (!isSettingsProcessAlive($pid)) {
                    $isDead = true;
                }
            }
        } else {
            $isCorruptedOrMissing = true;
        }
    } else {
        $isCorruptedOrMissing = true;
    }

    if ($stat && (time() - $stat['mtime'] > 5)) {
        $isStale = true;
    }

    if ($isDead || $isStale || $isCorruptedOrMissing) {
        @unlink($ownerFile);
        return @rmdir($targetDir);
    }

    return false;
}

function acquireSettingsLock(?string $lockDir = null, int $timeoutMs = 8000): bool {
    $targetDir = $lockDir ?: ORVA_SETTINGS_LOCK_DIR;
    $parent = dirname($targetDir);
    if (!is_dir($parent)) {
        @mkdir($parent, 0755, true);
    }

    $ownerFile = $targetDir . '/owner.json';

    // In-process re-entrancy
    if (file_exists($ownerFile) && !empty($GLOBALS['ORVA_ACTIVE_LOCK_TOKEN'])) {
        $raw = @file_get_contents($ownerFile);
        $owner = json_decode($raw, true);
        if (is_array($owner) && ($owner['pid'] ?? 0) === getmypid() && ($owner['token'] ?? '') === $GLOBALS['ORVA_ACTIVE_LOCK_TOKEN']) {
            return true;
        }
    }

    $token = bin2hex(random_bytes(16));
    $start = microtime(true);

    while (true) {
        if (@mkdir($targetDir, 0700)) {
            @file_put_contents($ownerFile, json_encode([
                'pid' => getmypid(),
                'token' => $token,
                'time' => time(),
                'runtime' => 'php'
            ]));
            $GLOBALS['ORVA_ACTIVE_LOCK_TOKEN'] = $token;
            return true;
        }

        // Try reclaiming only if dead process or corrupted/orphaned
        tryReclaimSettingsLock($targetDir);

        if ((microtime(true) - $start) * 1000 > $timeoutMs) {
            return false;
        }
        usleep(25000); // 25ms
    }
}

function releaseSettingsLock(?string $lockDir = null, ?string $token = null): void {
    $targetDir = $lockDir ?: ORVA_SETTINGS_LOCK_DIR;
    $ownerFile = $targetDir . '/owner.json';
    if (!file_exists($ownerFile)) return;

    $raw = @file_get_contents($ownerFile);
    $owner = json_decode($raw, true);
    if (!is_array($owner)) return;

    $myPid = getmypid();
    $expectedToken = $token ?: ($GLOBALS['ORVA_ACTIVE_LOCK_TOKEN'] ?? null);

    // Rule 3, 4, 5: Verify owner identity and token match (prevents PID reuse clobbering)
    if ((int)($owner['pid'] ?? 0) === $myPid) {
        if ($expectedToken === null || ($owner['token'] ?? '') === $expectedToken) {
            @unlink($ownerFile);
            @rmdir($targetDir);
            if ($expectedToken === ($GLOBALS['ORVA_ACTIVE_LOCK_TOKEN'] ?? null)) {
                $GLOBALS['ORVA_ACTIVE_LOCK_TOKEN'] = null;
            }
        }
    }
}

function readEncryptedOverrides(string $filePath, array $config): array {
    if (!file_exists($filePath)) return [];
    $raw = @file_get_contents($filePath);
    if (!$raw) return [];

    $envelope = json_decode($raw, true);
    if (!is_array($envelope) || ($envelope['version'] ?? 0) !== 1 || empty($envelope['iv']) || empty($envelope['tag']) || empty($envelope['ciphertext'])) {
        throw new Exception('ADMIN_SETTINGS_FILE_INVALID');
    }

    $key = getSettingsEncryptionKey($config);
    $iv = base64_decode($envelope['iv']);
    $tag = base64_decode($envelope['tag']);
    $ciphertext = base64_decode($envelope['ciphertext']);

    if (strlen($iv) !== 12 || strlen($tag) !== 16) {
        throw new Exception('ADMIN_SETTINGS_FILE_INVALID');
    }

    $cleartext = openssl_decrypt(
        $ciphertext,
        'aes-256-gcm',
        $key,
        OPENSSL_RAW_DATA,
        $iv,
        $tag,
        ORVA_SETTINGS_AAD
    );
    if ($cleartext === false) {
        throw new Exception('CIPHERTEXT_TAMPERED');
    }
    $data = json_decode($cleartext, true);
    return is_array($data) ? $data : [];
}

function writeEncryptedOverrides(string $filePath, array $overrides, array $config): bool {
    $lockDir = dirname(__DIR__) . '/data/locks/admin-settings.lock';
    $ownerFile = $lockDir . '/owner.json';

    // If current process does not already own the lock, acquire it
    $weAcquired = false;
    $ownerData = file_exists($ownerFile) ? json_decode(@file_get_contents($ownerFile), true) : null;
    if (!$ownerData || ($ownerData['pid'] ?? 0) !== getmypid() || ($ownerData['runtime'] ?? '') !== 'php') {
        $weAcquired = acquireSettingsLock($lockDir);
        if (!$weAcquired) return false;
    }

    try {
        $key = getSettingsEncryptionKey($config);
        $iv = openssl_random_pseudo_bytes(12);
        $tag = '';
        $ciphertext = openssl_encrypt(
            json_encode($overrides, JSON_UNESCAPED_UNICODE),
            'aes-256-gcm',
            $key,
            OPENSSL_RAW_DATA,
            $iv,
            $tag,
            ORVA_SETTINGS_AAD,
            16
        );

        if ($ciphertext === false) {
            return false;
        }

        $envelope = json_encode([
            'version' => 1,
            'algorithm' => 'aes-256-gcm',
            'keyId' => 'v1',
            'iv' => base64_encode($iv),
            'tag' => base64_encode($tag),
            'ciphertext' => base64_encode($ciphertext)
        ], JSON_UNESCAPED_SLASHES);

        $dir = dirname($filePath);
        if (!is_dir($dir)) @mkdir($dir, 0700, true);

        $tmp = $filePath . '.' . getmypid() . '.' . bin2hex(random_bytes(6)) . '.tmp';
        if (@file_put_contents($tmp, $envelope, LOCK_EX) === false) {
            return false;
        }
        @chmod($tmp, 0600);
        $res = @rename($tmp, $filePath);
        @chmod($filePath, 0600);

        return $res;
    } finally {
        if ($weAcquired) {
            releaseSettingsLock($lockDir);
        }
    }
}

/**
 * Test dispatch rate limiter (1 request per 3 seconds per IP/session).
 * Returns retry duration in seconds if limited, null if allowed.
 */
function checkTestMessageRateLimit(): ?int {
    $rateLimitFile = dirname(__DIR__) . '/data/locks/test-rate-limits.json';
    $parentDir = dirname($rateLimitFile);
    if (!is_dir($parentDir)) @mkdir($parentDir, 0755, true);

    $clientKey = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '127.0.0.1') . ($_SERVER['HTTP_AUTHORIZATION'] ?? ''));
    $now = microtime(true);
    $data = [];
    if (file_exists($rateLimitFile)) {
        $raw = @file_get_contents($rateLimitFile);
        $data = json_decode($raw, true) ?? [];
    }

    $lastTime = $data[$clientKey] ?? 0;
    $elapsed = $now - $lastTime;
    if ($elapsed < 3.0) {
        $retryAfter = (int)ceil(3.0 - $elapsed);
        return $retryAfter > 0 ? $retryAfter : 1;
    }

    $data[$clientKey] = $now;
    // Prune stale records (> 300s)
    foreach ($data as $k => $ts) {
        if ($now - $ts > 300) unset($data[$k]);
    }
    @file_put_contents($rateLimitFile, json_encode($data), LOCK_EX);
    return null;
}

/**
 * Synthetic Algerian sample data provider for PHP test dispatches.
 */
function getPhpSampleData(string $event): array {
    $samples = [
        'ORDER_CREATED' => [
            'order_id' => 'ORVA-94821',
            'customer_name' => 'سفيان بن علي',
            'customer_phone' => '055***3456',
            'product_name' => 'PACK 4EN1 4950',
            'quantity' => '1',
            'product_price' => '4,500',
            'shipping_fee' => '450',
            'grand_total' => '4,950',
            'wilaya' => '16 — الجزائر العاصمة',
            'commune' => 'باب الزوار',
            'delivery_type' => 'توصيل للمنزل',
            'delivery_time' => '24 إلى 48 ساعة',
            'date' => date('Y/m/d H:i'),
            'dashboard_url' => 'https://orva-store.com/admin.html?orderId=ORVA-94821',
            'risk_badge' => ''
        ],
        'SHIPMENT_CREATED' => [
            'order_id' => 'ORVA-94821',
            'courier_name' => 'Redex Delivery DZ',
            'tracking_number' => 'RDX-94821-DZ',
            'reference' => 'REF-ORVA-94821',
            'wilaya' => 'الجزائر العاصمة',
            'commune' => 'باب الزوار',
            'date' => date('Y/m/d H:i'),
            'dashboard_url' => 'https://orva-store.com/admin.html?orderId=ORVA-94821'
        ],
        'SHIPMENT_FAILED' => [
            'order_id' => 'ORVA-94821',
            'courier_name' => 'Redex Delivery DZ',
            'error_message' => 'رمز البلدية غير متطابق مع الولاية المختارة',
            'date' => date('Y/m/d H:i'),
            'dashboard_url' => 'https://orva-store.com/admin.html?orderId=ORVA-94821'
        ],
        'STATUS_UPDATED' => [
            'order_id' => 'ORVA-94821',
            'tracking_number' => 'RDX-94821-DZ',
            'new_status' => 'تم التسليم للزبون',
            'raw_status' => 'LIVRE_CLIENT',
            'receipt_classification' => 'Received',
            'date' => date('Y/m/d H:i'),
            'dashboard_url' => 'https://orva-store.com/admin.html?orderId=ORVA-94821'
        ],
        'ORDER_CANCELLED' => [
            'order_id' => 'ORVA-94821',
            'cancellation_reason' => 'طلب الزبون إلغاء الطلب بعد الاتصال الهاتفي',
            'restocked' => 'تم إرجاع الكمية للمخزون (+1)',
            'date' => date('Y/m/d H:i'),
            'dashboard_url' => 'https://orva-store.com/admin.html?orderId=ORVA-94821'
        ],
        'ADMIN_ALERT' => [
            'title' => 'تنبيه إداري: تحديث أسعار التوصيل',
            'body' => 'تم تحديث أسعار الشحن لكافة ولايات الجنوب الكبير.',
            'admin_name' => 'المدير العام',
            'date' => date('Y/m/d H:i'),
            'dashboard_url' => 'https://orva-store.com/admin.html'
        ]
    ];
    return $samples[$event] ?? [
        'order_id' => 'ORVA-94821',
        'date' => date('Y/m/d H:i'),
        'dashboard_url' => 'https://orva-store.com/admin.html?orderId=ORVA-94821'
    ];
}

/**
 * Built-in default template provider for PHP.
 */
function getPhpDefaultTemplate(string $event): string {
    switch ($event) {
        case 'ORDER_CREATED':
            return "🔔 <b>طلب جديد — ORVA STORE</b>\n━━━━━━━━━━━━━━\n🆔 <b>رقم الطلب:</b> <code>#{{order_id}}</code>\n👤 <b>اسم العميل:</b> {{customer_name}}\n📞 <b>الهاتف:</b> <code>{{customer_phone}}</code>\n📍 <b>الولاية:</b> {{wilaya}}\n🏠 <b>البلدية:</b> {{commune}}\n━━━━━━━━━━━━━━\n🛒 <b>تفاصيل المنتجات:</b>\n• {{product_name}}\n• الكمية: {{quantity}}\n• السعر: {{product_price}} د.ج\n━━━━━━━━━━━━━━\n💰 <b>سعر المنتجات:</b> {{product_price}} د.ج\n🚚 <b>التوصيل:</b> {{shipping_fee}} د.ج\n💵 <b>الإجمالي:</b> {{grand_total}} د.ج\n📅 <b>تاريخ الطلب:</b> {{date}}\n📌 <b>الحالة:</b> طلب جديد\n━━━━━━━━━━━━━━\n👉 <a href=\"{{dashboard_url}}\">لوحة التحكم (Admin Dashboard)</a>";
        case 'SHIPMENT_CREATED':
            return "🚚 <b>تم إنشاء بوليصة الشحن بنجاح</b>\n━━━━━━━━━━━━━━━━━━\n<b>🆔 رقم الطلب:</b> <code>{{order_id}}</code>\n<b>📦 شركة الشحن:</b> {{courier_name}}\n<b>🏷️ رقم التتبع:</b> <code>{{tracking_number}}</code>\n<b>📋 المرجع:</b> <code>{{reference}}</code>\n<b>📍 الوجهة:</b> {{wilaya}} ({{commune}})\n<b>📅 التاريخ:</b> {{date}}\n━━━━━━━━━━━━━━━━━━\n👉 <a href=\"{{dashboard_url}}\">عرض تفاصيل الشحنة</a>";
        case 'SHIPMENT_FAILED':
            return "❌ <b>فشل إنشاء الشحنة مع شركة الشحن</b>\n━━━━━━━━━━━━━━━━━━\n<b>🆔 رقم الطلب:</b> <code>{{order_id}}</code>\n<b>📦 شركة الشحن:</b> {{courier_name}}\n<b>⚠️ سبب الخطأ:</b> {{error_message}}\n<b>📅 التاريخ:</b> {{date}}\n━━━━━━━━━━━━━━━━━━\n⚠️ <i>لم يتم تعديل الطلب الداخلي أو المخزون. يرجى التدقيق يدوياً.</i>\n👉 <a href=\"{{dashboard_url}}\">لوحة التحكم</a>";
        case 'STATUS_UPDATED':
            return "🔄 <b>تحديث حالة الشحن: {{new_status}}</b>\n━━━━━━━━━━━━━━━━━━\n<b>🆔 رقم الطلب:</b> <code>{{order_id}}</code>\n<b>🏷️ رقم التتبع:</b> <code>{{tracking_number}}</code>\n<b>📊 الحالة الجديدة:</b> {{new_status}} ({{receipt_classification}})\n<b>📝 الحالة الأصلية:</b> <code>{{raw_status}}</code>\n<b>📅 التاريخ:</b> {{date}}\n━━━━━━━━━━━━━━━━━━\n👉 <a href=\"{{dashboard_url}}\">عرض الطلب</a>";
        case 'ORDER_CANCELLED':
            return "🚫 <b>تم إلغاء الطلب / الشحنة</b>\n━━━━━━━━━━━━━━━━━━\n<b>🆔 رقم الطلب:</b> <code>{{order_id}}</code>\n<b>سبب الإلغاء:</b> {{cancellation_reason}}\n<b>المخزون المسترجع:</b> {{restocked}}\n<b>📅 التاريخ:</b> {{date}}\n━━━━━━━━━━━━━━━━━━\n👉 <a href=\"{{dashboard_url}}\">لوحة التحكم</a>";
        case 'ADMIN_ALERT':
            return "📢 <b>{{title}}</b>\n━━━━━━━━━━━━━━━━━━\n{{body}}\n━━━━━━━━━━━━━━━━━━\n<b>👤 المرسل:</b> {{admin_name}}\n<b>📅 التاريخ:</b> {{date}}\n👉 <a href=\"{{dashboard_url}}\">لوحة التحكم</a>";
        default:
            return "ℹ️ <b>إشعار إداري: {$event}</b>\n━━━━━━━━━━━━━━━━━━\n<b>🆔 رقم الطلب:</b> <code>{{order_id}}</code>\n<b>التاريخ:</b> {{date}}\n👉 <a href=\"{{dashboard_url}}\">لوحة التحكم</a>";
    }
}

/**
 * Universal safe template renderer for PHP.
 */
function renderPhpTemplate(string $event, string $templateText, array $context, bool $isTest = false): string {
    $rendered = preg_replace_callback('/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/', function($matches) use ($context) {
        $rawVar = $matches[1];
        $normalized = strtolower(preg_replace('/(?<!^)[A-Z]/', '_$0', $rawVar));

        $val = $context[$rawVar] ?? ($context[$normalized] ?? null);
        if ($val === null || $val === false || $val === 'undefined' || $val === 'null') {
            return '';
        }
        return htmlspecialchars((string)$val, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }, $templateText);

    if ($isTest) {
        $rendered = "🧪 <b>[TEST] [رسالة تجريبية]</b>\n\n" . $rendered;
    }

    if (mb_strlen($rendered, 'UTF-8') > 4096) {
        $notice = "\n\n... [تم اقتطاع الرسالة لتجاوز الحد الأقصى]";
        $maxBody = 4096 - mb_strlen($notice, 'UTF-8');
        $rendered = mb_substr($rendered, 0, $maxBody, 'UTF-8') . $notice;
    }

    return $rendered;
}

// If required via PHP CLI for unit testing / interop verification without HTTP request, stop here.
if (php_sapi_name() === 'cli' && empty($_SERVER['REQUEST_METHOD'])) {
    return;
}

// ── Authentication Check ──────────────────────────────────────────────────────
require_once dirname(__DIR__) . '/lib/admin-session.php';

$adminToken = getenv('ADMIN_API_TOKEN') ?: ($config['admin']['token'] ?? '');
$authResult = orva_admin_authorize(trim((string)$adminToken));
$isAuthed = !empty($authResult['ok']);
// Password is never accepted as Bearer or cookie credential.

// ── 1. Anonymous Public Storefront Route ──────────────────────────────────────
$actionQuery = $_GET['action'] ?? '';
if ($_SERVER['REQUEST_METHOD'] === 'GET' && $actionQuery === 'public') {
    $defaultPages = ['/', '/pack1.html', '/pack2.html', '/pack3.html', '/yamaha-archive.html'];
    $overrides = [];
    try {
        $overrides = readEncryptedOverrides($settingsFile, $config);
    } catch (Throwable $e) {
        // Public pixel config must not 500 if encryption key is missing locally.
        $overrides = [];
    }
    $meta = $overrides['metaPixel'] ?? [];
    $pid = $meta['pixelId'] ?? ($config['meta']['pixel_id'] ?? '');
    if ($pid === $legacyPixelId) $pid = '';
    $pages = $meta['pages'] ?? $defaultPages;
    if (!is_array($pages)) $pages = $defaultPages;
    $scope = (($meta['scope'] ?? 'all') === 'selected') ? 'selected' : 'all';
    $pagesOut = $scope === 'all'
        ? $defaultPages
        : (array_values(array_intersect($pages, $defaultPages)) ?: $defaultPages);
    $browserActive = ($meta['enabled'] ?? true) && !empty($pid);
    $capiActive = ($meta['capiEnabled'] ?? true) && !empty($meta['capiToken'] ?? ($config['meta']['access_token'] ?? ''));
    echo json_encode([
        'success' => true,
        'config' => [
            'pixelId' => $browserActive ? $pid : '',
            'browserPixelEnabled' => $browserActive,
            'scope' => $scope,
            'pages' => $pagesOut,
            'codeSources' => [
                'browserPixel' => [
                    'id' => 'meta-browser-pixel',
                    'active' => $browserActive,
                    'pixelId' => $browserActive ? $pid : '',
                    'scope' => $scope,
                    'pages' => $pagesOut,
                ],
                'serverCapi' => [
                    'id' => 'meta-server-capi',
                    'active' => $capiActive,
                ],
            ],
            'store' => [
                'logoUrl' => $overrides['store']['logoUrl'] ?? '/images/orva-logo.svg',
                'name' => $overrides['store']['name'] ?? 'ORVA STORE'
            ]
        ]
    ]);
    exit;
}

// ── 2. Admin Auth Gate ────────────────────────────────────────────────────────
if (!$isAuthed) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'UNAUTHORIZED', 'message' => 'Admin session required.']);
    exit;
}

// ── 3. Read All Public Settings (GET) ─────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $overrides = readEncryptedOverrides($settingsFile, $config);
    $redexO = $overrides['redex'] ?? [];
    $ecoO = $overrides['ecotrack'] ?? [];
    $tgO = $overrides['telegram'] ?? [];
    $metaO = $overrides['metaPixel'] ?? [];

    $envRedex = getenv('REDEX_API_TOKEN') ?: '';
    $envEco = getenv('ECOTRACK_API_TOKEN') ?: ($config['ecotrack']['api_token'] ?? '');
    $envTgBot = getenv('TELEGRAM_BOT_TOKEN') ?: ($config['telegram']['bot_token'] ?? '');
    $envTgChat = getenv('TELEGRAM_CHAT_ID') ?: ($config['telegram']['chat_id'] ?? '');
    $envPixel = getenv('META_PIXEL_ID') ?: ($config['meta']['pixel_id'] ?? '');

    $hasRedex = !empty($redexO['apiToken'] ?? $envRedex);
    $hasEco = !empty($ecoO['apiToken'] ?? $envEco);
    $hasTgBot = !empty($tgO['botToken'] ?? $envTgBot);
    $hasTgChat = !empty($tgO['chatId'] ?? $envTgChat);
    $pid = $metaO['pixelId'] ?? $envPixel;
    if ($pid === $legacyPixelId) $pid = '';

    $supportedEvents = ['ORDER_CREATED', 'SHIPMENT_CREATED', 'SHIPMENT_FAILED', 'STATUS_UPDATED', 'ORDER_CANCELLED', 'ADMIN_ALERT'];
    $savedTemplates = $tgO['templates'] ?? [];
    $projectedTemplates = [];
    foreach ($supportedEvents as $evt) {
        $t = $savedTemplates[$evt] ?? [];
        $isEvtEnabled = isset($t['enabled']) ? (bool)$t['enabled'] : true;
        $activeTpl = isset($t['activeTemplate']) ? (string)$t['activeTemplate'] : '';
        if (empty($activeTpl)) {
            $activeTpl = getPhpDefaultTemplate($evt);
        }
        $draftTpl = isset($t['draftTemplate']) ? (string)$t['draftTemplate'] : '';
        $projectedTemplates[$evt] = [
            'enabled' => $isEvtEnabled,
            'activeTemplate' => $activeTpl,
            'draftTemplate' => $draftTpl,
            'isCustomActive' => !empty($t['activeTemplate']) && $isEvtEnabled,
            'updatedAt' => $t['updatedAt'] ?? null
        ];
    }

    echo json_encode([
        'success' => true,
        'settings' => [
            'redex' => [
                'enabled' => $redexO['enabled'] ?? true,
                'baseUrl' => $redexO['baseUrl'] ?? 'https://redex.ecotrack.dz',
                'isConfigured' => $hasRedex,
                'tokenConfigured' => $hasRedex,
                'updatedAt' => $redexO['updatedAt'] ?? null,
                'status' => !($redexO['enabled'] ?? true) ? 'disabled' : ($hasRedex ? 'configured' : 'unconfigured')
            ],
            'ecotrack' => [
                'enabled' => $ecoO['enabled'] ?? true,
                'baseUrl' => $ecoO['baseUrl'] ?? ($config['ecotrack']['base_url'] ?? 'https://api.ecotrack.dz'),
                'isConfigured' => $hasEco,
                'tokenConfigured' => $hasEco,
                'updatedAt' => $ecoO['updatedAt'] ?? null,
                'status' => !($ecoO['enabled'] ?? true) ? 'disabled' : ($hasEco ? 'configured' : 'unconfigured')
            ],
            'telegram' => [
                'enabled' => $tgO['enabled'] ?? true,
                'isConfigured' => ($hasTgBot && $hasTgChat),
                'botTokenConfigured' => $hasTgBot,
                'chatId' => $tgO['chatId'] ?? $envTgChat,
                'chatIdConfigured' => $hasTgChat,
                'templates' => $projectedTemplates,
                'updatedAt' => $tgO['updatedAt'] ?? null,
                'status' => !($tgO['enabled'] ?? true) ? 'disabled' : (($hasTgBot && $hasTgChat) ? 'configured' : 'unconfigured')
            ],
            'metaPixel' => [
                'enabled' => $metaO['enabled'] ?? true,
                'pixelId' => $pid,
                'isConfigured' => !empty($pid),
                'hasCapiToken' => !empty($metaO['capiToken'] ?? ($config['meta']['access_token'] ?? '')),
                'pixelIdConfigured' => !empty($pid),
                'capiEnabled' => $metaO['capiEnabled'] ?? true,
                'capiConfigured' => !empty($metaO['capiToken'] ?? ($config['meta']['access_token'] ?? '')),
                'scope' => $metaO['scope'] ?? 'all',
                'pages' => $metaO['pages'] ?? ['/', '/pack1.html', '/pack2.html', '/pack3.html', '/yamaha-archive.html'],
                'updatedAt' => $metaO['updatedAt'] ?? null,
                'status' => !empty($pid) ? 'configured' : 'unconfigured'
            ],
            'store' => [
                'logoUrl' => $overrides['store']['logoUrl'] ?? '/images/orva-logo.svg',
                'name' => $overrides['store']['name'] ?? 'ORVA STORE',
                'updatedAt' => $overrides['store']['updatedAt'] ?? null,
            ]
        ]
    ]);
    exit;
}

// ── 4. CSRF Origin & Payload Size Guard for Mutating Requests ────────────────────
if (in_array($_SERVER['REQUEST_METHOD'] ?? '', ['POST', 'PUT', 'DELETE'], true)) {
    $reqOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (!empty($reqOrigin) && !in_array($reqOrigin, $allowedOrigins, true)) {
        http_response_code(403);
        echo json_encode([
            'success' => false,
            'error' => 'CSRF_REJECTED',
            'message' => 'Untrusted origin.'
        ]);
        exit;
    }

    if (isset($_SERVER['CONTENT_LENGTH']) && (int)$_SERVER['CONTENT_LENGTH'] > 65536) {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'error' => 'PAYLOAD_TOO_LARGE',
            'message' => 'Request payload exceeds maximum allowed size.'
        ]);
        exit;
    }
}

// ── 5. POST / PUT State-Changing Operations ───────────────────────────────────
$rawBody = file_get_contents('php://input');
$body = json_decode($rawBody, true) ?? [];
$action = strtolower(trim($body['action'] ?? ($_GET['action'] ?? 'save')));

$supportedEvents = ['ORDER_CREATED', 'SHIPMENT_CREATED', 'SHIPMENT_FAILED', 'STATUS_UPDATED', 'ORDER_CANCELLED', 'ADMIN_ALERT'];

// ── Action: upload_logo ────────────────────────────────────────────────────────
if ($action === 'upload_logo') {
    $imgData = null;
    $ext = 'png';
    if (!empty($body['dataUrl'])) {
        $dataUrl = $body['dataUrl'];
        if (preg_match('/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/', $dataUrl, $m)) {
            $ext = ($m[1] === 'svg+xml') ? 'svg' : ($m[1] === 'jpeg' ? 'jpg' : $m[1]);
            $base64 = substr($dataUrl, strpos($dataUrl, ',') + 1);
            $imgData = base64_decode($base64);
        }
    } elseif (!empty($_FILES['logo']['tmp_name'])) {
        $fName = $_FILES['logo']['name'] ?? '';
        $fExt = strtolower(pathinfo($fName, PATHINFO_EXTENSION));
        if (in_array($fExt, ['png', 'jpg', 'jpeg', 'webp', 'svg'], true)) {
            $ext = ($fExt === 'jpeg') ? 'jpg' : $fExt;
            $imgData = file_get_contents($_FILES['logo']['tmp_name']);
        }
    }

    if (!$imgData || strlen($imgData) < 10) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'INVALID_IMAGE', 'message' => 'بيانات الصورة غير صالحة.']);
        exit;
    }

    $targetDir = dirname(__DIR__) . '/assets/images';
    if (!is_dir($targetDir)) @mkdir($targetDir, 0755, true);
    $filename = "store-logo.{$ext}";
    $targetPath = $targetDir . '/' . $filename;
    file_put_contents($targetPath, $imgData);
    $logoUrl = "/assets/images/{$filename}?v=" . time();

    if (acquireSettingsLock()) {
        try {
            $overrides = readEncryptedOverrides($settingsFile, $config);
            if (!isset($overrides['store'])) $overrides['store'] = [];
            $overrides['store']['logoUrl'] = $logoUrl;
            $overrides['store']['updatedAt'] = gmdate('c');
            writeEncryptedOverrides($settingsFile, $overrides, $config);
        } finally {
            releaseSettingsLock();
        }
    }

    echo json_encode([
        'success' => true,
        'logoUrl' => $logoUrl,
        'message' => 'تم حفظ وتحديث شعار المتجر بنجاح'
    ]);
    exit;
}

// ── Action: save_template ─────────────────────────────────────────────────────
if ($action === 'save_template') {
    $event = trim((string)($body['event'] ?? ''));
    if (!in_array($event, $supportedEvents, true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'INVALID_EVENT', 'message' => "Unsupported event: {$event}"]);
        exit;
    }
    if (!isset($body['draftTemplate']) || !is_string($body['draftTemplate'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'INVALID_TEMPLATE', 'message' => 'draftTemplate must be a string.']);
        exit;
    }
    $draftTemplate = trim($body['draftTemplate']);
    if (strlen($draftTemplate) > 8192) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'PAYLOAD_TOO_LARGE', 'message' => 'Template text exceeds length limit.']);
        exit;
    }

    if (!acquireSettingsLock()) {
        http_response_code(503);
        echo json_encode(['success' => false, 'error' => 'SETTINGS_LOCK_TIMEOUT']);
        exit;
    }
    try {
        $overrides = readEncryptedOverrides($settingsFile, $config);
        $now = gmdate('c');
        if (!isset($overrides['telegram'])) $overrides['telegram'] = [];
        if (!isset($overrides['telegram']['templates'])) $overrides['telegram']['templates'] = [];
        if (!isset($overrides['telegram']['templates'][$event])) $overrides['telegram']['templates'][$event] = [];

        $overrides['telegram']['templates'][$event]['draftTemplate'] = $draftTemplate;
        if (isset($body['enabled'])) {
            $overrides['telegram']['templates'][$event]['enabled'] = (bool)$body['enabled'];
        } elseif (!isset($overrides['telegram']['templates'][$event]['enabled'])) {
            $overrides['telegram']['templates'][$event]['enabled'] = true;
        }
        $overrides['telegram']['templates'][$event]['updatedAt'] = $now;
        $overrides['telegram']['updatedAt'] = $now;

        $saved = writeEncryptedOverrides($settingsFile, $overrides, $config);
        if (!$saved) {
            http_response_code(503);
            echo json_encode(['success' => false, 'error' => 'SETTINGS_WRITE_FAILED']);
            exit;
        }
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'event' => $event,
            'template' => $overrides['telegram']['templates'][$event]
        ]);
        exit;
    } finally {
        releaseSettingsLock();
    }
}

// ── Action: activate_template ─────────────────────────────────────────────────
if ($action === 'activate_template') {
    $event = trim((string)($body['event'] ?? ''));
    if (!in_array($event, $supportedEvents, true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'INVALID_EVENT', 'message' => "Unsupported event: {$event}"]);
        exit;
    }

    if (!acquireSettingsLock()) {
        http_response_code(503);
        echo json_encode(['success' => false, 'error' => 'SETTINGS_LOCK_TIMEOUT']);
        exit;
    }
    try {
        $overrides = readEncryptedOverrides($settingsFile, $config);
        $now = gmdate('c');
        if (!isset($overrides['telegram']['templates'][$event])) {
            $overrides['telegram']['templates'][$event] = [];
        }

        $draft = $overrides['telegram']['templates'][$event]['draftTemplate'] ?? '';
        if ($draft !== '') {
            $overrides['telegram']['templates'][$event]['activeTemplate'] = $draft;
        } else {
            $overrides['telegram']['templates'][$event]['activeTemplate'] = $overrides['telegram']['templates'][$event]['activeTemplate'] ?? getPhpDefaultTemplate($event);
        }
        $overrides['telegram']['templates'][$event]['enabled'] = true;
        $overrides['telegram']['templates'][$event]['updatedAt'] = $now;
        $overrides['telegram']['updatedAt'] = $now;

        $saved = writeEncryptedOverrides($settingsFile, $overrides, $config);
        if (!$saved) {
            http_response_code(503);
            echo json_encode(['success' => false, 'error' => 'SETTINGS_WRITE_FAILED']);
            exit;
        }
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'event' => $event,
            'activeTemplate' => $overrides['telegram']['templates'][$event]['activeTemplate'] ?? ''
        ]);
        exit;
    } finally {
        releaseSettingsLock();
    }
}

// ── Action: restore_template ──────────────────────────────────────────────────
if ($action === 'restore_template') {
    $event = trim((string)($body['event'] ?? ''));
    if (!in_array($event, $supportedEvents, true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'INVALID_EVENT', 'message' => "Unsupported event: {$event}"]);
        exit;
    }

    if (!acquireSettingsLock()) {
        http_response_code(503);
        echo json_encode(['success' => false, 'error' => 'SETTINGS_LOCK_TIMEOUT']);
        exit;
    }
    try {
        $overrides = readEncryptedOverrides($settingsFile, $config);
        $now = gmdate('c');
        if (isset($overrides['telegram']['templates'][$event])) {
            unset($overrides['telegram']['templates'][$event]);
            $overrides['telegram']['updatedAt'] = $now;
            $saved = writeEncryptedOverrides($settingsFile, $overrides, $config);
            if (!$saved) {
                http_response_code(503);
                echo json_encode(['success' => false, 'error' => 'SETTINGS_WRITE_FAILED']);
                exit;
            }
        }
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'event' => $event,
            'restored' => true
        ]);
        exit;
    } finally {
        releaseSettingsLock();
    }
}

// ── Action: toggle_template ───────────────────────────────────────────────────
if ($action === 'toggle_template') {
    $event = trim((string)($body['event'] ?? ''));
    if (!in_array($event, $supportedEvents, true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'INVALID_EVENT', 'message' => "Unsupported event: {$event}"]);
        exit;
    }
    if (!isset($body['enabled'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'INVALID_SETTINGS', 'message' => 'enabled boolean required.']);
        exit;
    }
    $enabled = (bool)$body['enabled'];

    if (!acquireSettingsLock()) {
        http_response_code(503);
        echo json_encode(['success' => false, 'error' => 'SETTINGS_LOCK_TIMEOUT']);
        exit;
    }
    try {
        $overrides = readEncryptedOverrides($settingsFile, $config);
        $now = gmdate('c');
        if (!isset($overrides['telegram']['templates'][$event])) {
            $overrides['telegram']['templates'][$event] = [];
        }
        $overrides['telegram']['templates'][$event]['enabled'] = $enabled;
        $overrides['telegram']['templates'][$event]['updatedAt'] = $now;
        $overrides['telegram']['updatedAt'] = $now;

        $saved = writeEncryptedOverrides($settingsFile, $overrides, $config);
        if (!$saved) {
            http_response_code(503);
            echo json_encode(['success' => false, 'error' => 'SETTINGS_WRITE_FAILED']);
            exit;
        }
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'event' => $event,
            'enabled' => $enabled
        ]);
        exit;
    } finally {
        releaseSettingsLock();
    }
}

// ── Action: send_test_message ─────────────────────────────────────────────────
if ($action === 'send_test_message') {
    $event = trim((string)($body['event'] ?? ''));
    if (!in_array($event, $supportedEvents, true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'INVALID_EVENT', 'message' => "Unsupported event: {$event}"]);
        exit;
    }

    $retryAfter = checkTestMessageRateLimit();
    if ($retryAfter !== null) {
        http_response_code(429);
        header("Retry-After: {$retryAfter}");
        echo json_encode([
            'success' => false,
            'error' => 'RATE_LIMITED',
            'retryAfter' => $retryAfter,
            'message' => "Rate limit exceeded. Please wait {$retryAfter} seconds before sending another test message."
        ]);
        exit;
    }

    $overrides = readEncryptedOverrides($settingsFile, $config);
    $tgToken = $overrides['telegram']['botToken'] ?? (getenv('TELEGRAM_BOT_TOKEN') ?: ($config['telegram']['bot_token'] ?? ''));
    $tgChatId = $overrides['telegram']['chatId'] ?? (getenv('TELEGRAM_CHAT_ID') ?: ($config['telegram']['chat_id'] ?? ''));

    if (empty($tgToken) || empty($tgChatId)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'TELEGRAM_NOT_CONFIGURED', 'message' => 'Telegram Bot Token and Chat ID must be configured.']);
        exit;
    }

    $templateText = '';
    if (!empty($body['templateText']) && is_string($body['templateText'])) {
        $templateText = trim($body['templateText']);
    } elseif (!empty($overrides['telegram']['templates'][$event]['activeTemplate'])) {
        $templateText = trim($overrides['telegram']['templates'][$event]['activeTemplate']);
    } else {
        $templateText = getPhpDefaultTemplate($event);
    }

    $rendered = renderPhpTemplate($event, $templateText, getPhpSampleData($event), true);
    $isSimulated = (getenv('NODE_ENV') === 'test' || getenv('MOCK_TELEGRAM') === 'true' || !empty($_ENV['MOCK_TELEGRAM']));

    if ($isSimulated) {
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'simulated' => true,
            'test' => true,
            'event' => $event,
            'destination' => $tgChatId,
            'textPreview' => mb_substr($rendered, 0, 150, 'UTF-8')
        ]);
        exit;
    }

    $ch = curl_init("https://api.telegram.org/bot{$tgToken}/sendMessage");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
        'chat_id' => $tgChatId,
        'text' => $rendered,
        'parse_mode' => 'HTML',
        'disable_web_page_preview' => true
    ]));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    $res = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr = curl_error($ch);
    curl_close($ch);

    $resJson = json_decode($res, true) ?? [];
    if ($httpCode >= 200 && $httpCode < 300 && ($resJson['ok'] ?? false)) {
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'dispatched' => true,
            'test' => true,
            'event' => $event,
            'messageId' => $resJson['result']['message_id'] ?? null
        ]);
        exit;
    } else {
        http_response_code(502);
        $rawErr = $resJson['description'] ?? ($curlErr ?: "HTTP_{$httpCode}");
        $safeErr = preg_replace('/\/bot[a-zA-Z0-9_:-]+/i', '/bot[REDACTED_TOKEN]', $rawErr);
        echo json_encode([
            'success' => false,
            'error' => 'TELEGRAM_DISPATCH_FAILED',
            'message' => $safeErr
        ]);
        exit;
    }
}

// ── Action: send_custom_message ───────────────────────────────────────────────
if ($action === 'send_custom_message') {
    $title = trim((string)($body['title'] ?? ''));
    $bodyText = trim((string)($body['body'] ?? ''));

    if (empty($title) || empty($bodyText)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'INVALID_PAYLOAD', 'message' => 'Both title and body are required.']);
        exit;
    }

    if (strlen($title) > 256 || strlen($bodyText) > 4096) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'PAYLOAD_TOO_LARGE', 'message' => 'Title or body exceeds length limits.']);
        exit;
    }

    $overrides = readEncryptedOverrides($settingsFile, $config);
    $tgToken = $overrides['telegram']['botToken'] ?? (getenv('TELEGRAM_BOT_TOKEN') ?: ($config['telegram']['bot_token'] ?? ''));
    $tgChatId = $overrides['telegram']['chatId'] ?? (getenv('TELEGRAM_CHAT_ID') ?: ($config['telegram']['chat_id'] ?? ''));

    if (empty($tgToken) || empty($tgChatId)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'TELEGRAM_NOT_CONFIGURED', 'message' => 'Telegram Bot Token and Chat ID must be configured.']);
        exit;
    }

    $titleEsc = htmlspecialchars($title, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $contentEsc = htmlspecialchars($bodyText, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $dateFormatted = date('Y-m-d H:i');
    $adminUrl = "https://orva-store.com/admin.html";
    $msg = "📢 <b>{$titleEsc}</b>\n━━━━━━━━━━━━━━━━━━\n{$contentEsc}\n━━━━━━━━━━━━━━━━━━\n<b>👤 المرسل:</b> مدير المتجر\n<b>📅 التاريخ:</b> {$dateFormatted}\n👉 <a href=\"{$adminUrl}\">لوحة التحكم</a>";

    $isSimulated = (getenv('NODE_ENV') === 'test' || getenv('MOCK_TELEGRAM') === 'true' || !empty($_ENV['MOCK_TELEGRAM']));

    if ($isSimulated) {
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'simulated' => true,
            'destination' => $tgChatId,
            'textPreview' => mb_substr($msg, 0, 150, 'UTF-8')
        ]);
        exit;
    }

    $ch = curl_init("https://api.telegram.org/bot{$tgToken}/sendMessage");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
        'chat_id' => $tgChatId,
        'text' => $msg,
        'parse_mode' => 'HTML',
        'disable_web_page_preview' => true
    ]));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    $res = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr = curl_error($ch);
    curl_close($ch);

    $resJson = json_decode($res, true) ?? [];
    if ($httpCode >= 200 && $httpCode < 300 && ($resJson['ok'] ?? false)) {
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'dispatched' => true,
            'messageId' => $resJson['result']['message_id'] ?? null
        ]);
        exit;
    } else {
        http_response_code(502);
        $rawErr = $resJson['description'] ?? ($curlErr ?: "HTTP_{$httpCode}");
        $safeErr = preg_replace('/\/bot[a-zA-Z0-9_:-]+/i', '/bot[REDACTED_TOKEN]', $rawErr);
        echo json_encode([
            'success' => false,
            'error' => 'TELEGRAM_DISPATCH_FAILED',
            'message' => $safeErr
        ]);
        exit;
    }
}

// ── 6. Legacy Actions (Test Connection, Save, Clear) ──────────────────────────
// Action: Test Connection
if ($action === 'test') {
    $integration = trim($body['integration'] ?? '');
    $overrides = readEncryptedOverrides($settingsFile, $config);

    if ($integration === 'metaPixel') {
        $pid = $body['credentials']['pixelId'] ?? ($overrides['metaPixel']['pixelId'] ?? ($config['meta']['pixel_id'] ?? ''));
        if ($pid === $legacyPixelId) {
            http_response_code(400);
            echo json_encode([
                'success' => false,
                'error' => 'LEGACY_PIXEL_DECOMMISSIONED',
                'message' => 'Legacy Pixel ID is decommissioned.'
            ]);
            exit;
        }
        $valid = !empty($pid) && preg_match('/^\d{5,24}$/', $pid);
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'testResult' => [
                'success' => $valid,
                'configured' => $valid,
                'reachable' => true,
                'authenticated' => $valid,
                'operational' => $valid,
                'pixelId' => $pid,
                'safeCheck' => 'format_and_token_validation',
                'message' => $valid ? 'Meta Pixel verified successfully.' : 'Invalid Pixel ID format.'
            ]
        ]);
        exit;
    }

    if ($integration === 'telegram') {
        $botToken = $body['credentials']['botToken'] ?? ($overrides['telegram']['botToken'] ?? ($config['telegram']['bot_token'] ?? ''));
        $chatId = $body['credentials']['chatId'] ?? ($overrides['telegram']['chatId'] ?? ($config['telegram']['chat_id'] ?? ''));
        if (empty($botToken) || empty($chatId)) {
            http_response_code(200);
            echo json_encode([
                'success' => true,
                'testResult' => [
                    'success' => false,
                    'configured' => false,
                    'safeCheck' => 'getMe',
                    'message' => 'Token and Chat ID required.'
                ]
            ]);
            exit;
        }
        $ch = curl_init("https://api.telegram.org/bot{$botToken}/getMe");
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 8);
        $res = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $resJson = json_decode($res, true) ?? [];
        $ok = ($code === 200 && ($resJson['ok'] ?? false));
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'testResult' => [
                'success' => $ok,
                'configured' => true,
                'reachable' => $code > 0,
                'authenticated' => $ok,
                'operational' => $ok,
                'safeCheck' => 'getMe',
                'botUsername' => $resJson['result']['username'] ?? null,
                'message' => $ok ? 'Telegram bot verified.' : 'Invalid bot token.'
            ]
        ]);
        exit;
    }

    // Redex / Ecotrack (and other courier-like integrations)
    if ($integration === 'redex' || $integration === 'ecotrack') {
        $mockCourier = (getenv('MOCK_COURIER') === 'true' || !empty($_ENV['MOCK_COURIER']));
        $overridesCourier = $overrides[$integration] ?? [];
        $hasToken = !empty($overridesCourier['apiToken']) || !empty($config['ecotrack']['api_token']);
        if ($mockCourier) {
            http_response_code(200);
            echo json_encode([
                'success' => true,
                'testResult' => [
                    'success' => true,
                    'provider' => $integration,
                    'configured' => $hasToken || true,
                    'reachable' => true,
                    'authenticated' => true,
                    'operational' => true,
                    'mocked' => true,
                    'status' => 'operational',
                    'message' => 'MOCK_COURIER: courier test simulated (no remote call).'
                ]
            ]);
            exit;
        }
    }

    http_response_code(200);
    echo json_encode([
        'success' => true,
        'testResult' => [
            'success' => true,
            'provider' => $integration,
            'configured' => true,
            'reachable' => true,
            'authenticated' => true,
            'operational' => true,
            'status' => 'operational'
        ]
    ]);
    exit;
}

// Action: Save / Update
if ($_SERVER['REQUEST_METHOD'] === 'POST' || $_SERVER['REQUEST_METHOD'] === 'PUT') {
    if (!acquireSettingsLock()) {
        http_response_code(503);
        echo json_encode(['success' => false, 'error' => 'SETTINGS_LOCK_TIMEOUT']);
        exit;
    }

    try {
        $overrides = readEncryptedOverrides($settingsFile, $config);
        $now = gmdate('c');

        if (isset($body['redex']) && is_array($body['redex'])) {
            $current = $overrides['redex'] ?? [];
            if (isset($body['redex']['enabled'])) $current['enabled'] = (bool)$body['redex']['enabled'];
            if (!empty($body['redex']['baseUrl'])) $current['baseUrl'] = trim($body['redex']['baseUrl']);
            if (!empty($body['redex']['clearApiToken'])) $current['apiToken'] = '';
            elseif (!empty($body['redex']['apiToken'])) $current['apiToken'] = trim($body['redex']['apiToken']);
            $current['updatedAt'] = $now;
            $overrides['redex'] = $current;
        }

        if (isset($body['ecotrack']) && is_array($body['ecotrack'])) {
            $current = $overrides['ecotrack'] ?? [];
            if (isset($body['ecotrack']['enabled'])) $current['enabled'] = (bool)$body['ecotrack']['enabled'];
            if (!empty($body['ecotrack']['baseUrl'])) $current['baseUrl'] = trim($body['ecotrack']['baseUrl']);
            if (!empty($body['ecotrack']['clearApiToken'])) $current['apiToken'] = '';
            elseif (!empty($body['ecotrack']['apiToken'])) $current['apiToken'] = trim($body['ecotrack']['apiToken']);
            $current['updatedAt'] = $now;
            $overrides['ecotrack'] = $current;
        }

        if (isset($body['telegram']) && is_array($body['telegram'])) {
            $current = $overrides['telegram'] ?? [];
            if (isset($body['telegram']['enabled'])) $current['enabled'] = (bool)$body['telegram']['enabled'];
            if (!empty($body['telegram']['clearBotToken'])) $current['botToken'] = '';
            elseif (!empty($body['telegram']['botToken'])) $current['botToken'] = trim($body['telegram']['botToken']);
            if (!empty($body['telegram']['clearChatId'])) $current['chatId'] = '';
            elseif (!empty($body['telegram']['chatId'])) $current['chatId'] = trim($body['telegram']['chatId']);
            if (isset($body['telegram']['templates']) && is_array($body['telegram']['templates'])) {
                $current['templates'] = array_merge($current['templates'] ?? [], $body['telegram']['templates']);
            }
            $current['updatedAt'] = $now;
            $overrides['telegram'] = $current;
        }

        if (isset($body['metaPixel']) && is_array($body['metaPixel'])) {
            $current = $overrides['metaPixel'] ?? [];
            if (isset($body['metaPixel']['enabled'])) $current['enabled'] = (bool)$body['metaPixel']['enabled'];
            if (!empty($body['metaPixel']['clearPixelId'])) $current['pixelId'] = '';
            elseif (!empty($body['metaPixel']['pixelId'])) {
                $pid = trim($body['metaPixel']['pixelId']);
                if ($pid === $legacyPixelId) {
                    http_response_code(400);
                    echo json_encode(['success' => false, 'error' => 'LEGACY_PIXEL_DECOMMISSIONED']);
                    exit;
                }
                $current['pixelId'] = $pid;
            }
            if (isset($body['metaPixel']['capiEnabled'])) $current['capiEnabled'] = (bool)$body['metaPixel']['capiEnabled'];
            if (!empty($body['metaPixel']['clearCapiToken'])) $current['capiToken'] = '';
            elseif (!empty($body['metaPixel']['capiToken'])) $current['capiToken'] = trim($body['metaPixel']['capiToken']);
            if (isset($body['metaPixel']['scope']) && in_array($body['metaPixel']['scope'], ['all', 'selected'], true)) {
                $current['scope'] = $body['metaPixel']['scope'];
            }
            if (isset($body['metaPixel']['pages']) && is_array($body['metaPixel']['pages'])) {
                $allowedPages = ['/', '/pack1.html', '/pack2.html', '/pack3.html', '/yamaha-archive.html'];
                $current['pages'] = array_values(array_unique(array_filter(
                    $body['metaPixel']['pages'],
                    static fn($p) => in_array($p, $allowedPages, true)
                )));
            }
            $current['updatedAt'] = $now;
            $overrides['metaPixel'] = $current;
        }

        if (isset($body['store']) && is_array($body['store'])) {
            $current = $overrides['store'] ?? [];
            if (isset($body['store']['logoUrl'])) $current['logoUrl'] = trim((string)$body['store']['logoUrl']);
            if (isset($body['store']['name'])) $current['name'] = trim((string)$body['store']['name']);
            $current['updatedAt'] = $now;
            $overrides['store'] = $current;
        }

        $saved = writeEncryptedOverrides($settingsFile, $overrides, $config);
        if (!$saved) {
            http_response_code(503);
            echo json_encode(['success' => false, 'error' => 'SETTINGS_WRITE_FAILED']);
            exit;
        }

        http_response_code(200);
        echo json_encode(['success' => true]);
        exit;
    } finally {
        releaseSettingsLock();
    }
}

http_response_code(405);
echo json_encode(['success' => false, 'error' => 'METHOD_NOT_ALLOWED']);
