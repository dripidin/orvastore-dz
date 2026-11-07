<?php
// ==============================================================================
// ORVA STORE — Admin Authentication Gateway (/api/auth)
// Stabilization: random session IDs, login lockout, password never as Bearer
// ==============================================================================

define('ORVA_API', true);
$config = require __DIR__ . '/config.php';
require_once dirname(__DIR__) . '/lib/admin-session.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// CORS: restricted to known origins, no wildcard for credentialed requests
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

function readRequiredSecret(string $envKey, string $configFallback): string {
    $val = getenv($envKey);
    if ($val === false) $val = $_ENV[$envKey] ?? '';
    $val = trim((string) $val);
    if ($val !== '') return $val;
    return trim((string) $configFallback);
}

$expectedPassword = readRequiredSecret('ADMIN_PASSWORD', $config['admin']['password'] ?? '');
$expectedToken    = readRequiredSecret('ADMIN_API_TOKEN', $config['admin']['token'] ?? '');

if ($expectedPassword === '' || $expectedToken === '') {
    http_response_code(503);
    error_log('[ORVA Auth] CRITICAL: ADMIN_PASSWORD or ADMIN_API_TOKEN is not configured.');
    echo json_encode(['success' => false, 'error' => 'SERVER_MISCONFIGURED']);
    exit;
}

$rawInput = file_get_contents('php://input');
$body = json_decode($rawInput, true) ?? [];
$action = strtolower(trim($body['action'] ?? 'login'));

function isHttps(): bool {
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
}

function setSessionCookie(string $token, int $maxAge, bool $httpsOnly): void {
    setcookie('orva_admin_session', $token, [
        'expires'  => $maxAge > 0 ? time() + $maxAge : time() - 3600,
        'path'     => '/',
        'secure'   => $httpsOnly,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

// ---------------------------------------------------------------------------
// session check
// ---------------------------------------------------------------------------
if ($action === 'session') {
    $auth = orva_admin_authorize($expectedToken);
    if (!$auth['ok']) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'UNAUTHORIZED_ACCESS']);
    } else {
        http_response_code(200);
        echo json_encode(['success' => true, 'message' => 'AUTHENTICATED']);
    }
    exit;
}

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------
if ($action === 'logout') {
    $cookieVal = (string)($_COOKIE['orva_admin_session'] ?? '');
    orva_admin_destroy_session($cookieVal);
    setSessionCookie('', 0, isHttps());
    http_response_code(200);
    echo json_encode(['success' => true, 'message' => 'SIGNED_OUT']);
    exit;
}

// ---------------------------------------------------------------------------
// login / auth — password only, never the API token
// ---------------------------------------------------------------------------
if ($action !== 'login' && $action !== 'auth') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'INVALID_ACTION']);
    exit;
}

$lock = orva_admin_check_lockout();
if (!empty($lock['locked'])) {
    http_response_code(429);
    header('Retry-After: ' . (int)($lock['retryAfter'] ?? 900));
    echo json_encode([
        'success' => false,
        'error' => 'LOGIN_LOCKED',
        'message' => 'Too many failed login attempts. Try again in 15 minutes.',
        'retryAfter' => (int)($lock['retryAfter'] ?? 900),
    ]);
    exit;
}

$inputPassword = trim($body['password'] ?? '');
if ($inputPassword === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'MISSING_PASSWORD']);
    exit;
}

if (hash_equals($expectedPassword, $inputPassword)) {
    orva_admin_clear_lockout();
    $sessionId = orva_admin_create_session(28800);
    setSessionCookie($sessionId, 28800, isHttps());
    http_response_code(200);
    echo json_encode(['success' => true, 'message' => 'AUTHENTICATED']);
} else {
    orva_admin_record_failed_login();
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'INVALID_PASSWORD']);
}
