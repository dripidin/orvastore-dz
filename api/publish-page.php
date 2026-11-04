<?php
// ==============================================================================
// ORVA STORE — Dynamic Page Publishing API for Hostinger LiteSpeed (PHP 8.3)
// Supports: Preview Generation, Production Publishing, Unpublishing & Archiving
// Phase 8B.1: Hardened — Strict Auth, CORS Whitelist, Atomic Writes, Traversal Guard
// ==============================================================================

define('ORVA_API', true);
$config = require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

// ── 1. Strict CORS Whitelist ──────────────────────────────────────────────────
$allowedOrigins = [
    'https://orva-store.com',
    'https://www.orva-store.com',
    'https://staging.orva-store.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:8080',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Credentials: true');
    header("Access-Control-Allow-Origin: {$origin}");
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, Sec-Fetch-Site');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Allow: POST, OPTIONS');
    echo json_encode(['success' => false, 'error' => 'METHOD_NOT_ALLOWED']);
    exit;
}

// ── 2. Authentication Check ───────────────────────────────────────────────────
function readSecret(string $envKey, string $fallback): string {
    $val = getenv($envKey);
    if ($val === false) $val = $_ENV[$envKey] ?? '';
    $val = trim((string) $val);
    if ($val !== '') return $val;
    return trim((string) $fallback);
}

function updateSitemapXml(string $rootDir): void {
    $baseUrl = 'https://orva-store.com';
    $entries = [
        ['loc' => $baseUrl . '/', 'changefreq' => 'daily', 'priority' => '1.0'],
        ['loc' => $baseUrl . '/pack1', 'changefreq' => 'weekly', 'priority' => '0.9'],
        ['loc' => $baseUrl . '/pack2', 'changefreq' => 'weekly', 'priority' => '0.9'],
        ['loc' => $baseUrl . '/yamaha', 'changefreq' => 'weekly', 'priority' => '0.8'],
    ];

    $productsDir = $rootDir . '/products';
    if (is_dir($productsDir)) {
        $files = scandir($productsDir);
        if ($files !== false) {
            foreach ($files as $file) {
                if (str_ends_with($file, '.html') && !str_starts_with($file, '.')) {
                    $slug = basename($file, '.html');
                    if ($slug === 'etc_passwd' || $slug === 'secret') continue;
                    $mtime = date('Y-m-d', filemtime($productsDir . '/' . $file));
                    $entries[] = [
                        'loc' => $baseUrl . '/products/' . $slug,
                        'lastmod' => $mtime,
                        'changefreq' => 'weekly',
                        'priority' => '0.8'
                    ];
                }
            }
        }
    }

    $xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
    $xml .= "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n";
    foreach ($entries as $e) {
        $xml .= "  <url>\n";
        $xml .= "    <loc>" . htmlspecialchars($e['loc']) . "</loc>\n";
        if (!empty($e['lastmod'])) {
            $xml .= "    <lastmod>" . $e['lastmod'] . "</lastmod>\n";
        }
        $xml .= "    <changefreq>" . $e['changefreq'] . "</changefreq>\n";
        $xml .= "    <priority>" . $e['priority'] . "</priority>\n";
        $xml .= "  </url>\n";
    }
    $xml .= "</urlset>\n";

    @file_put_contents($rootDir . '/sitemap.xml', $xml, LOCK_EX);
}

$adminToken = readSecret('ADMIN_API_TOKEN', $config['admin']['token'] ?? '');
$isAuthed = false;

// Check Authorization header (Bearer token)
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
if (empty($authHeader) && function_exists('apache_request_headers')) {
    $reqHeaders = apache_request_headers();
    $authHeader = $reqHeaders['Authorization'] ?? $reqHeaders['authorization'] ?? '';
}

if (str_starts_with($authHeader, 'Bearer ')) {
    $token = trim(substr($authHeader, 7));
    if ($adminToken !== '' && hash_equals($adminToken, $token)) {
        $isAuthed = true;
    }
}

// Check session cookie (HttpOnly)
if (!$isAuthed && isset($_COOKIE['orva_admin_session'])) {
    $cookieToken = trim((string)$_COOKIE['orva_admin_session']);
    if ($adminToken !== '' && hash_equals($adminToken, $cookieToken)) {
        $isAuthed = true;
    }
}

// Check local development environment by REMOTE_ADDR (never trust spoofed HTTP_HOST)
$remoteAddr = $_SERVER['REMOTE_ADDR'] ?? '';
$isLocalDev = ($remoteAddr === '127.0.0.1' || $remoteAddr === '::1');
if (!$isAuthed && $isLocalDev && $adminToken === '') {
    // Permitted only in local development when no admin token is configured yet
    $isAuthed = true;
}

if (!$isAuthed) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'UNAUTHORIZED', 'message' => 'Admin session required']);
    exit;
}

// ── 3. Read & Validate JSON Payload ──────────────────────────────────────────
$rawInput = file_get_contents('php://input');
$data = json_decode($rawInput, true);

if (!$data || !is_array($data)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'INVALID_JSON_PAYLOAD']);
    exit;
}

// ── 4. Slug Sanitization & Confined Path Security ─────────────────────────────
function sanitizeSlug(string $slug): string {
    $s = preg_replace('/^products\//', '', $slug);
    $s = preg_replace('/\.html$/', '', $s);
    $s = strtolower(trim($s));
    $s = preg_replace('/[^a-z0-9_-]/', '_', $s);
    $s = preg_replace('/_+/', '_', $s);
    $s = trim($s, '_');
    return substr($s, 0, 80) ?: 'product';
}

function sanitizePageId(string $id): string {
    $s = strtolower(trim($id));
    $s = preg_replace('/[^a-z0-9_-]/', '_', $s);
    $s = preg_replace('/_+/', '_', $s);
    $s = trim($s, '_');
    return substr($s, 0, 80) ?: 'page_preview';
}

$action = strtolower(trim($data['action'] ?? ''));
$rawSlug = (string)($data['slug'] ?? $data['pageId'] ?? '');
$cleanSlug = sanitizeSlug($rawSlug);
$safePageId = sanitizePageId((string)($data['pageId'] ?? $cleanSlug));
$html = (string)($data['html'] ?? '');

$reservedNames = [
    'admin', 'api', 'index', 'pack1', 'pack2', 'yamaha-archive', 'order-confirmation',
    'package', 'package-lock', 'dev-server', 'data', 'scripts', 'lib', 'products',
    'node_modules', 'favicon', 'packs-styles', 'packs-client', 'algeria-communes',
    '.htaccess', 'robots', 'sitemap'
];

$rootDir = dirname(__DIR__);
$previewDir = $rootDir . '/data/preview/products';
$productsDir = $rootDir . '/products';

if (!is_dir($previewDir)) {
    @mkdir($previewDir, 0755, true);
}
if (!is_dir($productsDir)) {
    @mkdir($productsDir, 0755, true);
}

// ── Helper: Atomic File Write with Verification ──────────────────────────────
function atomicWriteFile(string $dir, string $filename, string $content): bool {
    if (!is_dir($dir) || !is_writable($dir)) {
        return false;
    }

    $tempFile = $dir . '/.tmp_' . bin2hex(random_bytes(8)) . '.tmp';
    $targetFile = $dir . '/' . $filename;

    $bytesWritten = @file_put_contents($tempFile, $content, LOCK_EX);
    if ($bytesWritten === false || $bytesWritten !== strlen($content)) {
        @unlink($tempFile);
        return false;
    }

    // Atomic move on POSIX / Windows
    if (!@rename($tempFile, $targetFile)) {
        // Fallback for Windows cross-lock issue: copy then unlink
        if (!@copy($tempFile, $targetFile)) {
            @unlink($tempFile);
            return false;
        }
        @unlink($tempFile);
    }

    @chmod($targetFile, 0644);
    return true;
}

// ── Action 1: Preview ────────────────────────────────────────────────────────
if ($action === 'preview') {
    if (trim($html) === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'MISSING_HTML_CONTENT']);
        exit;
    }

    $previewFileName = "{$safePageId}.html";
    $success = atomicWriteFile($previewDir, $previewFileName, $html);

    if (!$success) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'WRITE_FAILED', 'message' => 'Failed to write preview file']);
        exit;
    }

    http_response_code(200);
    echo json_encode([
        'success' => true,
        'action' => 'preview',
        'pageId' => $safePageId,
        'previewPath' => "/data/preview/products/{$previewFileName}",
        'previewUrl' => "/preview/products/{$previewFileName}",
        'writtenAt' => gmdate('c')
    ]);
    exit;
}

// ── Action 2: Publish ────────────────────────────────────────────────────────
if ($action === 'publish') {
    if (trim($html) === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'MISSING_HTML_CONTENT']);
        exit;
    }
    if (in_array($cleanSlug, $reservedNames, true)) {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'error' => 'RESERVED_SLUG',
            'message' => "الاسم '{$cleanSlug}' محجوز للنظام ولا يمكن استخدامه."
        ]);
        exit;
    }

    $targetFileName = "{$cleanSlug}.html";

    // 1. Keep preview updated
    atomicWriteFile($previewDir, "{$safePageId}.html", $html);

    // 2. Atomic write to published directory (prevents corruption of old file on failure)
    $success = atomicWriteFile($productsDir, $targetFileName, $html);
    if (!$success) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'PUBLISH_FAILED', 'message' => 'Failed to publish product file']);
        exit;
    }

    // 3. Dynamic Catalog Registration (Transactional Consistency)
    $catalogFilePath = $rootDir . '/data/products-catalog.json';
    if (file_exists($catalogFilePath)) {
        $catalogData = json_decode(file_get_contents($catalogFilePath), true) ?? [];
        $prodMeta = $data['product'] ?? [];
        if (empty($prodMeta['sku']) && preg_match('/Product SKU:\s*([^\s|]+)/i', $html, $m)) {
            $prodMeta['sku'] = trim($m[1]);
        }
        if (empty($prodMeta['sellingPrice']) && preg_match('/packPrice:\s*(\d+)/', $html, $m)) {
            $prodMeta['sellingPrice'] = (int)$m[1];
        }
        if (empty($prodMeta['title']) && preg_match('/<title>([^<—–-]+)/i', $html, $m)) {
            $prodMeta['title'] = trim($m[1]);
        }

        if (!empty($prodMeta['sku'])) {
            $prodKey = strtolower(preg_replace('/[^a-zA-Z0-9_-]/', '_', $prodMeta['sku']));
            $catalogData['products'][$prodKey] = [
                'id' => $prodMeta['id'] ?? ('prod_' . $prodKey),
                'sku' => $prodMeta['sku'],
                'slug' => $cleanSlug,
                'title' => $prodMeta['title'] ?? 'منتج جديد',
                'name' => $prodMeta['name'] ?? ($prodMeta['title'] ?? 'منتج جديد'),
                'shortTitle' => $prodMeta['shortTitle'] ?? ($prodMeta['title'] ?? 'عرض خاص'),
                'sellingPrice' => (int)($prodMeta['sellingPrice'] ?? 4950),
                'status' => 'active',
                'stockQuantity' => (int)($prodMeta['stockQuantity'] ?? 20),
                'allowOrders' => true
            ];
            $catalogData['aliases'][$prodKey] = $prodKey;
            $catalogData['aliases'][strtolower($prodMeta['sku'])] = $prodKey;
            $catalogData['aliases'][$cleanSlug] = $prodKey;
            $catalogData['lastUpdated'] = gmdate('c');
            $writeRes = @file_put_contents($catalogFilePath, json_encode($catalogData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
            if ($writeRes === false) {
                // Roll back published HTML file
                @unlink($productsDir . '/' . $targetFileName);
                http_response_code(500);
                echo json_encode([
                    'success' => false,
                    'error' => 'CATALOG_SYNC_FAILED',
                    'message' => 'تعذر حفظ بيانات المنتج في السجل المعتمد. تم التراجع عن النشر.'
                ]);
                exit;
            }
        }
    }

    // Dynamic Sitemap Sync
    updateSitemapXml($rootDir);

    http_response_code(200);
    echo json_encode([
        'success' => true,
        'action' => 'publish',
        'slug' => $cleanSlug,
        'publicUrl' => "/products/{$cleanSlug}",
        'relativeFile' => "products/{$targetFileName}",
        'publishedAt' => gmdate('c')
    ]);
    exit;
}

// ── Action 3: Unpublish / Archive ────────────────────────────────────────────
if ($action === 'unpublish' || $action === 'archive') {
    $targetFileName = "{$cleanSlug}.html";
    $targetFilePath = $productsDir . '/' . $targetFileName;

    // Verify resolved path stays strictly within productsDir
    $realTarget = realpath($targetFilePath);
    $realProductsDir = realpath($productsDir);

    $wasRemoved = false;
    if ($realTarget && $realProductsDir && str_starts_with($realTarget, $realProductsDir)) {
        $wasRemoved = @unlink($realTarget);
    } elseif (file_exists($targetFilePath)) {
        $wasRemoved = @unlink($targetFilePath);
    }

    // Dynamic Catalog Status Update (Phase 8C.1)
    $catalogFilePath = $rootDir . '/data/products-catalog.json';
    if (file_exists($catalogFilePath)) {
        $catalogData = json_decode(file_get_contents($catalogFilePath), true) ?? [];
        $prodKey = $catalogData['aliases'][$cleanSlug] ?? $cleanSlug;
        if (isset($catalogData['products'][$prodKey])) {
            $catalogData['products'][$prodKey]['status'] = 'archived';
            $catalogData['products'][$prodKey]['allowOrders'] = false;
            $catalogData['lastUpdated'] = gmdate('c');
            @file_put_contents($catalogFilePath, json_encode($catalogData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
        }
    }

    // Dynamic Sitemap Sync
    updateSitemapXml($rootDir);

    http_response_code(200);
    echo json_encode([
        'success' => true,
        'action' => $action,
        'slug' => $cleanSlug,
        'wasRemoved' => $wasRemoved,
        'publicUrl' => null,
        'message' => $action === 'archive'
            ? 'تم أرشفة المنتج وإلغاء نشره من المتجر.'
            : 'تم إلغاء نشر الصفحة بنجاح وحذف الملف من مسار الإنتاج.'
    ]);
    exit;
}

http_response_code(400);
echo json_encode([
    'success' => false,
    'error' => 'INVALID_ACTION',
    'message' => 'الإجراء المطلوب غير معتمد (preview | publish | unpublish | archive).'
]);
