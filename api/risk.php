<?php
/**
 * ORVA STORE — Admin Risk Override API (Hostinger PHP path)
 * Mirrors api/risk.js: GET evaluation, POST trust/block overrides.
 */
define('ORVA_API', true);
$config = require __DIR__ . '/config.php';
require_once dirname(__DIR__) . '/lib/admin-session.php';
require_once dirname(__DIR__) . '/lib/risk-engine.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, Sec-Fetch-Site');
header('Access-Control-Allow-Credentials: true');

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'https://orva-store.com',
    'https://www.orva-store.com',
];
if (in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
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

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? '';
    if ($action === 'health') {
        echo json_encode(['ok' => true, 'engine' => 'php-risk-engine', 'eventsFile' => is_file(orva_risk_config()['EVENTS_FILE'])]);
        exit;
    }
    if (!$auth['ok']) {
        http_response_code(401);
        echo json_encode(['error' => 'UNAUTHORIZED']);
        exit;
    }
    $orderId = trim((string)($_GET['orderId'] ?? ''));
    if ($orderId === '') {
        http_response_code(400);
        echo json_encode(['error' => 'MISSING_ORDER_ID']);
        exit;
    }
    $url = rtrim($config['supabase']['url'], '/') . '/rest/v1/orders?order_id=eq.' . rawurlencode($orderId) . '&select=*';
    try {
        $resp = orva_orders_storage_request('GET', $url, null, $config, $adminToken);
    } catch (Throwable $e) {
        http_response_code(503);
        echo json_encode(['error' => 'STORAGE_UNAVAILABLE']);
        exit;
    }
    $rows = $resp['data'] ?? [];
    if (!is_array($rows) || $rows === []) {
        http_response_code(404);
        echo json_encode(['error' => 'NOT_FOUND']);
        exit;
    }
    $r = $rows[0];
    $reasonsRaw = $r['risk_reasons'] ?? '';
    $reasons = is_array($reasonsRaw)
        ? $reasonsRaw
        : array_values(array_filter(array_map('trim', explode('|', (string)$reasonsRaw))));
    echo json_encode([
        'orderId' => $r['order_id'] ?? $orderId,
        'score' => (int)($r['risk_score'] ?? 0),
        'level' => $r['risk_level'] ?? 'LOW',
        'decision' => $r['risk_decision'] ?? 'ALLOW',
        'reasons' => $reasons,
    ]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'METHOD_NOT_ALLOWED']);
    exit;
}

if (!$auth['ok']) {
    http_response_code(401);
    echo json_encode(['error' => 'UNAUTHORIZED']);
    exit;
}

// Cookie CSRF gate
if (($auth['type'] ?? '') === 'cookie') {
    $secFetchSite = strtolower((string)($_SERVER['HTTP_SEC_FETCH_SITE'] ?? ''));
    if ($secFetchSite === 'cross-site') {
        http_response_code(403);
        echo json_encode(['error' => 'CSRF_REJECTED']);
        exit;
    }
    if ($origin === '' || !in_array($origin, $allowedOrigins, true)) {
        http_response_code(403);
        echo json_encode(['error' => $origin === '' ? 'CSRF_ORIGIN_REQUIRED' : 'CSRF_ORIGIN_DISALLOWED']);
        exit;
    }
}

$body = json_decode((string)file_get_contents('php://input'), true) ?? [];
$action = trim((string)($body['action'] ?? ''));
$orderId = trim((string)($body['orderId'] ?? ''));
$valid = ['trust', 'block', 'reject', 'confirm', 'unblock', 'watchlist'];
if ($action === '' || !in_array($action, $valid, true)) {
    http_response_code(400);
    echo json_encode(['error' => 'INVALID_ACTION']);
    exit;
}

if ($action === 'watchlist') {
    // Local file watchlist (no Redis)
    $file = dirname(__DIR__) . '/data/risk-watchlist.json';
    $list = [];
    if (is_file($file)) {
        $decoded = json_decode((string)file_get_contents($file), true);
        $list = is_array($decoded) ? $decoded : [];
    }
    $identifier = trim((string)($body['identifier'] ?? ''));
    if ($identifier === '') {
        http_response_code(400);
        echo json_encode(['error' => 'MISSING_IDENTIFIER']);
        exit;
    }
    $entry = [
        'identifier' => $identifier,
        'identifierType' => $body['identifierType'] ?? 'PHONE',
        'reason' => $body['reason'] ?? 'Manual watchlist',
        'created_at' => gmdate('c'),
    ];
    $list[] = $entry;
    @file_put_contents($file, json_encode($list, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n", LOCK_EX);
    echo json_encode(['success' => true, 'action' => $action, 'entry' => $entry]);
    exit;
}

if ($orderId === '') {
    http_response_code(400);
    echo json_encode(['error' => 'MISSING_ORDER_ID']);
    exit;
}

$decisionMap = [
    'trust' => 'ALLOW',
    'confirm' => 'ALLOW',
    'unblock' => 'ALLOW',
    'reject' => 'BLOCK',
    'block' => 'BLOCK',
];
$newDecision = $decisionMap[$action] ?? 'ALLOW';
$patch = [
    'risk_decision' => $newDecision,
];
if ($action === 'reject') {
    $patch['status'] = 'rejected';
} elseif ($action === 'confirm') {
    $patch['status'] = 'confirmed';
}
if ($action === 'trust') {
    $patch['risk_score'] = 0;
    $patch['risk_level'] = 'LOW';
} elseif ($action === 'block' || $action === 'reject') {
    $patch['risk_score'] = 100;
    $patch['risk_level'] = 'HIGH';
}

$url = rtrim($config['supabase']['url'], '/') . '/rest/v1/orders?order_id=eq.' . rawurlencode($orderId);
try {
    $resp = orva_orders_storage_request('PATCH', $url, $patch, $config, $adminToken, ['Prefer: return=representation']);
} catch (Throwable $e) {
    http_response_code(503);
    echo json_encode(['error' => 'STORAGE_UNAVAILABLE']);
    exit;
}

$code = (int)($resp['code'] ?? 0);
if ($code < 200 || $code >= 300) {
    http_response_code($code >= 400 ? $code : 503);
    echo json_encode(['error' => 'UPDATE_FAILED', 'code' => $code]);
    exit;
}

// Record admin override event
$eventType = $action === 'block' ? 'ACTOR_BLOCKED' : ($action === 'reject' ? 'REQUEST_REJECTED' : ($action === 'trust' ? 'ACTOR_TRUSTED' : 'ADMIN_OVERRIDE'));
orva_risk_record(
    ['storeId' => 'orvastore', 'orderId' => $orderId, 'actorPhone' => '', 'actorIpHash' => '', 'deviceId' => ''],
    ['score' => (int)($patch['risk_score'] ?? 0), 'level' => $patch['risk_level'] ?? 'LOW', 'decision' => $newDecision, 'reasons' => [$eventType]]
);

echo json_encode(['success' => true, 'updated' => ['orderId' => $orderId, 'riskDecision' => $newDecision, 'action' => $action]]);
