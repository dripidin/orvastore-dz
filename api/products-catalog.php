<?php
/**
 * ORVA STORE — Products Catalog Admin API
 * Source of truth: data/products-catalog.json (or isolated local test copy).
 * Auth: admin session / bearer (same gate as delivery).
 */
define('ORVA_API', true);
$config = require __DIR__ . '/config.php';
require_once dirname(__DIR__) . '/lib/admin-session.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, Sec-Fetch-Site');
header('Access-Control-Allow-Credentials: true');

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
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$adminToken = '';
$envToken = getenv('ADMIN_API_TOKEN');
if ($envToken === false) {
    $envToken = $_ENV['ADMIN_API_TOKEN'] ?? '';
}
$adminToken = trim((string)$envToken);
if ($adminToken === '') {
    $adminToken = trim((string)($config['admin']['token'] ?? ''));
}
$auth = orva_admin_authorize($adminToken);
if (!$auth['ok']) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'UNAUTHORIZED']);
    exit;
}

$rootDir = dirname(__DIR__);
$useTest = isset($_GET['fixture']) && $_GET['fixture'] === 'test';
$host = $_SERVER['HTTP_HOST'] ?? '';
$isLocalHost = (bool)preg_match('/^(localhost|127\.0\.0\.1)(:\d+)?$/i', $host);
if ($useTest && !$isLocalHost) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'TEST_FIXTURE_LOCAL_ONLY']);
    exit;
}

$catalogFile = $useTest
    ? $rootDir . '/data/local-fixtures/products-catalog.test.json'
    : $rootDir . '/data/products-catalog.json';

if ($useTest && !is_file($catalogFile)) {
    $seed = $rootDir . '/data/products-catalog.json';
    $dir = dirname($catalogFile);
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    if (is_file($seed)) {
        copy($seed, $catalogFile);
    } else {
        file_put_contents($catalogFile, json_encode(['version' => 1, 'products' => new stdClass()], JSON_PRETTY_PRINT));
    }
}

function orva_catalog_read(string $file): array
{
    if (!is_file($file)) {
        return ['version' => 1, 'products' => []];
    }
    $data = json_decode((string)file_get_contents($file), true);
    if (!is_array($data)) {
        return ['version' => 1, 'products' => []];
    }
    if (!isset($data['products']) || !is_array($data['products'])) {
        $data['products'] = [];
    }
    return $data;
}

function orva_catalog_write(string $file, array $data): bool
{
    $data['lastUpdated'] = gmdate('c');
    $tmp = $file . '.' . getmypid() . '.tmp';
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    if ($json === false || file_put_contents($tmp, $json . "\n", LOCK_EX) === false) {
        @unlink($tmp);
        return false;
    }
    return rename($tmp, $file);
}

function orva_catalog_to_admin_product(string $key, array $p): array
{
    $status = strtolower((string)($p['status'] ?? 'active'));
    if (!in_array($status, ['active', 'draft', 'archived'], true)) {
        $status = 'active';
    }
    return [
        'id' => (string)($p['id'] ?? $key),
        'catalogKey' => $key,
        'sku' => (string)($p['sku'] ?? ''),
        'title' => (string)($p['title'] ?? $p['name'] ?? $key),
        'subtitle' => (string)($p['shortTitle'] ?? $p['name'] ?? ''),
        'description' => (string)($p['desc'] ?? $p['description'] ?? ''),
        'images' => is_array($p['images'] ?? null) ? $p['images'] : [],
        'sellingPrice' => (int)($p['sellingPrice'] ?? 0),
        'purchaseCost' => (int)($p['purchaseCost'] ?? 0),
        'marketingCostPerOrder' => (int)($p['marketingCostPerOrder'] ?? 0),
        'stockQuantity' => (int)($p['stockQuantity'] ?? 0),
        'lowStockThreshold' => (int)($p['lowStockThreshold'] ?? 5),
        'status' => $status,
        'allowOrders' => (bool)($p['allowOrders'] ?? ($status === 'active')),
        'slug' => (string)($p['slug'] ?? ''),
        'createdAt' => (string)($p['createdAt'] ?? ''),
        'updatedAt' => (string)($p['updatedAt'] ?? ''),
    ];
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = $_GET['action'] ?? '';
$body = [];
if ($method === 'POST' || $method === 'PUT') {
    $body = json_decode((string)file_get_contents('php://input'), true) ?? [];
    if ($action === '' && isset($body['action'])) {
        $action = (string)$body['action'];
    }
}
if ($action === '') {
    $action = $method === 'GET' ? 'list' : '';
}

if ($action === 'list' || $action === 'get') {
    $catalog = orva_catalog_read($catalogFile);
    $list = [];
    foreach ($catalog['products'] as $key => $row) {
        if (!is_array($row)) {
            continue;
        }
        $list[] = orva_catalog_to_admin_product((string)$key, $row);
    }
    echo json_encode([
        'success' => true,
        'fixture' => $useTest ? 'test' : 'live',
        'count' => count($list),
        'data' => $list,
    ]);
    exit;
}

if (($auth['type'] ?? '') === 'cookie') {
    $sec = strtolower((string)($_SERVER['HTTP_SEC_FETCH_SITE'] ?? ''));
    if ($sec === 'cross-site') {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'CSRF_REJECTED']);
        exit;
    }
}

if ($action === 'upsert' || $action === 'update') {
    $product = $body['product'] ?? $body;
    if (!is_array($product)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'INVALID_PRODUCT']);
        exit;
    }
    $catalogKey = trim((string)($product['catalogKey'] ?? $body['catalogKey'] ?? ''));
    $sku = strtoupper(trim((string)($product['sku'] ?? '')));
    if ($sku === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'MISSING_SKU']);
        exit;
    }
    if ($catalogKey === '') {
        $catalogKey = strtolower(preg_replace('/[^a-zA-Z0-9]+/', '-', $sku) ?? $sku);
    }

    $price = (int)($product['sellingPrice'] ?? -1);
    if ($price < 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'INVALID_PRICE']);
        exit;
    }

    $status = strtolower(trim((string)($product['status'] ?? 'active')));
    if (!in_array($status, ['active', 'draft', 'archived'], true)) {
        $status = 'active';
    }

    $catalog = orva_catalog_read($catalogFile);
    $existing = is_array($catalog['products'][$catalogKey] ?? null) ? $catalog['products'][$catalogKey] : [];
    $now = gmdate('c');
    $merged = array_merge($existing, [
        'id' => (string)($product['id'] ?? $existing['id'] ?? ('prod_' . $catalogKey)),
        'sku' => $sku,
        'slug' => (string)($product['slug'] ?? $existing['slug'] ?? ''),
        'title' => trim((string)($product['title'] ?? $existing['title'] ?? $sku)),
        'name' => trim((string)($product['name'] ?? $product['subtitle'] ?? $existing['name'] ?? $sku)),
        'shortTitle' => trim((string)($product['subtitle'] ?? $product['shortTitle'] ?? $existing['shortTitle'] ?? '')),
        'desc' => trim((string)($product['description'] ?? $product['desc'] ?? $existing['desc'] ?? '')),
        'sellingPrice' => $price,
        'purchaseCost' => (int)($product['purchaseCost'] ?? $existing['purchaseCost'] ?? 0),
        'marketingCostPerOrder' => (int)($product['marketingCostPerOrder'] ?? $existing['marketingCostPerOrder'] ?? 0),
        'stockQuantity' => (int)($product['stockQuantity'] ?? $existing['stockQuantity'] ?? 0),
        'lowStockThreshold' => (int)($product['lowStockThreshold'] ?? $existing['lowStockThreshold'] ?? 5),
        'status' => $status,
        'allowOrders' => array_key_exists('allowOrders', $product)
            ? (bool)$product['allowOrders']
            : ($status === 'active'),
        'images' => is_array($product['images'] ?? null) ? $product['images'] : ($existing['images'] ?? []),
        'updatedAt' => $now,
        'createdAt' => (string)($existing['createdAt'] ?? $now),
    ]);
    $catalog['products'][$catalogKey] = $merged;
    if (!orva_catalog_write($catalogFile, $catalog)) {
        http_response_code(503);
        echo json_encode(['success' => false, 'error' => 'WRITE_FAILED']);
        exit;
    }
    echo json_encode([
        'success' => true,
        'data' => orva_catalog_to_admin_product($catalogKey, $merged),
    ]);
    exit;
}

if ($action === 'adjust_stock') {
    $catalogKey = trim((string)($body['catalogKey'] ?? $body['id'] ?? ''));
    $change = (int)($body['change'] ?? 0);
    if ($catalogKey === '' || $change === 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'INVALID_STOCK_ADJUSTMENT']);
        exit;
    }
    $catalog = orva_catalog_read($catalogFile);
    if (!isset($catalog['products'][$catalogKey]) || !is_array($catalog['products'][$catalogKey])) {
        // try match by id
        foreach ($catalog['products'] as $k => $row) {
            if (is_array($row) && (($row['id'] ?? '') === $catalogKey || ($row['sku'] ?? '') === $catalogKey)) {
                $catalogKey = (string)$k;
                break;
            }
        }
    }
    if (!isset($catalog['products'][$catalogKey]) || !is_array($catalog['products'][$catalogKey])) {
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => 'NOT_FOUND']);
        exit;
    }
    $row = $catalog['products'][$catalogKey];
    $stock = max(0, (int)($row['stockQuantity'] ?? 0) + $change);
    $row['stockQuantity'] = $stock;
    $row['updatedAt'] = gmdate('c');
    $catalog['products'][$catalogKey] = $row;
    if (!orva_catalog_write($catalogFile, $catalog)) {
        http_response_code(503);
        echo json_encode(['success' => false, 'error' => 'WRITE_FAILED']);
        exit;
    }
    echo json_encode([
        'success' => true,
        'data' => orva_catalog_to_admin_product($catalogKey, $row),
        'inventory' => [
            'productId' => $row['id'] ?? $catalogKey,
            'availableQuantity' => $stock,
            'reservedQuantity' => 0,
            'totalPhysicalQuantity' => $stock,
        ],
    ]);
    exit;
}

http_response_code(400);
echo json_encode(['success' => false, 'error' => 'UNKNOWN_ACTION']);
