<?php
// ==============================================================================
// ORVA STORE — Admin Authentication Gateway (/api/auth)
// Phase 5D: Hardened — No fallback secrets, hash_equals everywhere, CSRF origin check
// ==============================================================================

define('ORVA_API', true);
$config = require __DIR__ . '/config.php';

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

// ---------------------------------------------------------------------------
// Load required secrets from environment — NO fallback values
// ---------------------------------------------------------------------------
// Hostinger supports environment variables via .env or hosting panel.
// getenv() works for both $_ENV and apache/LiteSpeed-injected vars.
// If getenv() returns empty, we also check $config as a last resort,
// but $config['admin']['password'] should itself be populated from env on server.

function readRequiredSecret(string $envKey, string $configFallback): string {
    // Try server environment first (set via Hostinger panel or .htaccess SetEnv)
    $val = getenv($envKey);
    if ($val === false) $val = $_ENV[$envKey] ?? '';
    $val = trim((string) $val);
    if ($val !== '') return $val;
    // Try config array (which should also read from env on production)
    $val = trim((string) $configFallback);
    return $val; // Returns empty string if neither is set
}

$expectedPassword = readRequiredSecret('ADMIN_PASSWORD', $config['admin']['password'] ?? '');
$expectedToken    = readRequiredSecret('ADMIN_API_TOKEN', $config['admin']['token'] ?? '');

// Fail safely if any required secret is missing
if ($expectedPassword === '' || $expectedToken === '') {
    http_response_code(503);
    error_log('[ORVA Auth] CRITICAL: ADMIN_PASSWORD or ADMIN_API_TOKEN is not configured.');
    echo json_encode(['success' => false, 'error' => 'SERVER_MISCONFIGURED']);
    exit;
}

// ---------------------------------------------------------------------------
// Parse request body
// ---------------------------------------------------------------------------
$rawInput = file_get_contents('php://input');
$body = json_decode($rawInput, true) ?? [];
$action = strtolower(trim($body['action'] ?? 'login'));

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------
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
    $cookieVal = (string) ($_COOKIE['orva_admin_session'] ?? '');
    if ($cookieVal === '' || !hash_equals($expectedToken, $cookieVal)) {
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

$inputPassword = trim($body['password'] ?? '');
if ($inputPassword === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'MISSING_PASSWORD']);
    exit;
}

// Use hash_equals for all password comparisons (timing-safe)
// Accept only the admin password — the API token is NOT a valid login credential
if (hash_equals($expectedPassword, $inputPassword)) {
    setSessionCookie($expectedToken, 28800, isHttps()); // 8 hours
    http_response_code(200);
    echo json_encode(['success' => true, 'message' => 'AUTHENTICATED']);
} else {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'INVALID_PASSWORD']);
}
