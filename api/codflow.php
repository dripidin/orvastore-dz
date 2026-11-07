<?php
// ==============================================================================
// ORVA STORE — CodFlow Integration Bridge (/api/codflow)
// Phase 0: authenticated, allowlisted reverse proxy to the CodFlow cod-server API.
//
// Invariants:
// - The CodFlow API key never reaches the browser. It lives in server env only.
// - Only authenticated OrvaStore admins (session cookie or Bearer token) may call.
// - Only allowlisted /api/* paths are forwarded. /__health and /__flags are
//   answered locally and are never proxied.
// - Upstream redirects are never followed. TLS verification is never disabled.
// - Secret-bearing response fields are redacted before they reach the browser.
// - multipart/form-data is NOT proxied: PHP consumes it into $_POST/$_FILES, so
//   php://input is empty. Image uploads must use POST /api/images/presign and a
//   direct browser PUT to R2 (JSON only through this bridge).
//
// Rollback: remove the `api/codflow` rewrite from .htaccess. Nothing else
// references this file until a feature flag is enabled.
// ==============================================================================

define('ORVA_API', true);
$config = require __DIR__ . '/config.php';

const ORVA_CODFLOW_VERSION = '1.0.0';
const ORVA_CODFLOW_RATE_LIMIT = 120;
const ORVA_CODFLOW_RATE_WINDOW = 60;
const ORVA_CODFLOW_MAX_PATH_LENGTH = 512;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function orva_codflow_request_id(): string
{
    $incoming = $_SERVER['HTTP_X_ORVA_REQUEST_ID'] ?? '';
    if (is_string($incoming) && preg_match('/^[A-Za-z0-9._-]{8,64}$/', $incoming)) {
        return $incoming;
    }
    try {
        return bin2hex(random_bytes(16));
    } catch (Throwable $e) {
        return uniqid('orva', true);
    }
}

function orva_codflow_respond(int $status, $payload, array $extraHeaders = []): void
{
    http_response_code($status);
    foreach ($extraHeaders as $name => $value) {
        header($name . ': ' . $value);
    }
    if ($status !== 204) {
        echo json_encode(
            $payload,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
        );
    }
    exit;
}

function orva_codflow_fail(int $status, string $code, string $message, array $extra = []): void
{
    orva_codflow_respond(
        $status,
        array_merge(['success' => false, 'error' => $code, 'message' => $message], $extra)
    );
}

/**
 * Returns 'bearer', 'cookie', or '' — mirrors api/delivery.php so both admin
 * surfaces accept exactly the same credentials.
 */
function orva_codflow_auth_type(string $expectedToken): string
{
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($authHeader === '' && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    }

    if (preg_match('/Bearer\s+(\S+)/i', $authHeader, $matches)) {
        if (hash_equals($expectedToken, $matches[1])) {
            return 'bearer';
        }
    }

    $cookieVal = (string) ($_COOKIE['orva_admin_session'] ?? '');
    if ($cookieVal !== '' && hash_equals($expectedToken, $cookieVal)) {
        return 'cookie';
    }

    return '';
}

/**
 * Fixed-window, per-token rate limiter. Uses APCu when available, otherwise a
 * locked file in the system temp directory. Fails open on infrastructure errors
 * so a temp-dir problem cannot take the dashboard offline.
 *
 * @return array{0: bool, 1: int} [allowed, remaining]
 */
function orva_codflow_rate_limit(string $token): array
{
    $limit = ORVA_CODFLOW_RATE_LIMIT;
    $window = ORVA_CODFLOW_RATE_WINDOW;
    $bucket = (int) floor(time() / $window);
    $identity = hash('sha256', 'orva-codflow|' . $token . '|' . ($_SERVER['REMOTE_ADDR'] ?? ''));

    if (function_exists('apcu_inc')) {
        $key = 'orva_cf_' . substr($identity, 0, 24) . '_' . $bucket;
        $count = apcu_inc($key, 1, $ok, $window + 10);
        if (!$ok) {
            apcu_add($key, 1, $window + 10);
            $count = 1;
        }
        return [$count <= $limit, max(0, $limit - (int) $count)];
    }

    $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'orva-codflow-rate';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true)) {
        error_log('[ORVA CodFlow] rate-limit directory unavailable; failing closed');
        return [false, 0];
    }

    // Opportunistic cleanup of stale buckets (2% of requests).
    if (random_int(1, 50) === 1) {
        foreach (glob($dir . DIRECTORY_SEPARATOR . '*.json') ?: [] as $stale) {
            if (@filemtime($stale) < time() - ($window * 5)) {
                @unlink($stale);
            }
        }
    }

    $file = $dir . DIRECTORY_SEPARATOR . substr($identity, 0, 32) . '_' . $bucket . '.json';
    $handle = @fopen($file, 'c+');
    if ($handle === false) {
        error_log('[ORVA CodFlow] rate-limit file unavailable; failing closed');
        return [false, 0];
    }

    $count = 1;
    if (flock($handle, LOCK_EX)) {
        $raw = stream_get_contents($handle);
        $count = (int) ($raw !== '' ? json_decode($raw, true) : 0) + 1;
        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, (string) $count);
        fflush($handle);
        flock($handle, LOCK_UN);
    }
    fclose($handle);

    return [$count <= $limit, max(0, $limit - $count)];
}

/**
 * Parses CODFLOW_FLAGS into a complete flag object. Unknown keys and invalid
 * values are ignored; every key always falls back to a safe default.
 */
function orva_codflow_flags(string $raw): array
{
    $defaults = [
        'orders' => 'off',
        'products' => 'off',
        'customers' => 'off',
        'delivery' => 'off',
        'store' => 'off',
        'auth' => 'bridge',
    ];
    $allowed = [
        'orders' => ['off', 'read', 'write'],
        'products' => ['off', 'read', 'write'],
        'customers' => ['off', 'read', 'write'],
        'delivery' => ['off', 'read', 'write'],
        'store' => ['off', 'read', 'write'],
        'auth' => ['bridge', 'jwt'],
    ];

    $raw = trim($raw);
    if ($raw === '') {
        return $defaults;
    }

    $flags = $defaults;
    foreach (explode(',', $raw) as $pair) {
        $pair = trim($pair);
        if ($pair === '') {
            continue;
        }
        $parts = explode(':', $pair, 2);
        if (count($parts) !== 2) {
            continue;
        }
        $key = strtolower(trim($parts[0]));
        $value = strtolower(trim($parts[1]));
        if (isset($allowed[$key]) && in_array($value, $allowed[$key], true)) {
            $flags[$key] = $value;
        }
    }

    return $flags;
}

/**
 * Validates CODFLOW_API_URL. HTTPS is always required except for an explicit
 * localhost development override. Credentials, query strings, fragments, and
 * path prefixes are rejected; the upstream URL is an origin only.
 */
function orva_codflow_base_url(string $rawUrl, bool $allowInsecureLocal): ?string
{
    $rawUrl = trim($rawUrl);
    if ($rawUrl === '') {
        return null;
    }

    $parts = parse_url($rawUrl);
    if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host'])) {
        return null;
    }
    if (!empty($parts['user']) || !empty($parts['pass']) || !empty($parts['query']) || !empty($parts['fragment'])) {
        return null;
    }
    $pathPart = $parts['path'] ?? '';
    if ($pathPart !== '' && $pathPart !== '/') {
        return null;
    }

    $scheme = strtolower($parts['scheme']);
    $host = strtolower($parts['host']);

    if ($scheme === 'https') {
        return rtrim($rawUrl, '/');
    }
    if ($scheme === 'http' && $allowInsecureLocal && in_array($host, ['localhost', '127.0.0.1', '::1'], true)) {
        return rtrim($rawUrl, '/');
    }

    return null;
}

/**
 * Recursively redacts known secret-bearing keys. Values that are null or empty
 * stay untouched so the UI can still distinguish "not configured" from "hidden".
 */
function orva_codflow_redact($value)
{
    if (!is_array($value)) {
        return $value;
    }

    $redacted = [];
    foreach ($value as $key => $item) {
        if (is_string($key) && orva_codflow_is_secret_key($key)) {
            $redacted[$key] = (is_string($item) && $item !== '') ? '[REDACTED]' : $item;
        } else {
            $redacted[$key] = orva_codflow_redact($item);
        }
    }
    return $redacted;
}

function orva_codflow_is_secret_key(string $key): bool
{
    static $secretKeys = [
        'apitoken',
        'apikey',
        'apiuserguid',
        'webhooksecret',
        'keyhash',
        'secret',
        'clientsecret',
        'apisecret',
        'signingsecret',
        'password',
        'passwordhash',
        'smtppassword',
        'otpapikey',
        'turnstilesecret',
        'emailapikey',
        'accesstoken',
        'refreshtoken',
        'privatekey',
    ];

    $normalized = strtolower(preg_replace('/[^a-z0-9]/i', '', $key) ?? '');
    return in_array($normalized, $secretKeys, true);
}

/**
 * Executes one upstream request. Never follows redirects, never disables TLS
 * verification, and never forwards browser cookies or Authorization headers.
 *
 * @return array{status:int, body:string, contentType:string, latencyMs:int, error:?string, cfRay:?string}
 */
function orva_codflow_http(
    string $method,
    string $url,
    string $apiKey,
    int $timeoutMs,
    ?string $body,
    string $contentType
): array {
    $startedAt = microtime(true);

    if (!function_exists('curl_init')) {
        return [
            'status' => 0,
            'body' => '',
            'contentType' => '',
            'latencyMs' => 0,
            'error' => 'CURL_UNAVAILABLE',
            'cfRay' => null,
        ];
    }

    $responseHeaders = [];
    $headers = [
        'X-API-Key: ' . $apiKey,
        'Accept: application/json',
        'User-Agent: OrvaStore-Codflow-Bridge/' . ORVA_CODFLOW_VERSION,
    ];
    if ($contentType !== '') {
        $headers[] = 'Content-Type: ' . $contentType;
    }

    $handle = curl_init($url);
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_CONNECTTIMEOUT_MS => min(5000, $timeoutMs),
        CURLOPT_TIMEOUT_MS => $timeoutMs,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_MAXREDIRS => 0,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_ENCODING => '',
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_HEADERFUNCTION => function ($ch, string $line) use (&$responseHeaders): int {
            $separator = strpos($line, ':');
            if ($separator !== false) {
                $name = strtolower(trim(substr($line, 0, $separator)));
                $value = trim(substr($line, $separator + 1));
                if ($name !== '') {
                    $responseHeaders[$name] = $value;
                }
            }
            return strlen($line);
        },
    ]);

    if ($body !== null && $body !== '') {
        curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
    }

    $responseBody = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
    $errorNumber = curl_errno($handle);
    $errorMessage = curl_error($handle);
    $responseContentType = (string) curl_getinfo($handle, CURLINFO_CONTENT_TYPE);
    curl_close($handle);

    $latencyMs = (int) round((microtime(true) - $startedAt) * 1000);

    if ($responseBody === false || $errorNumber !== 0) {
        return [
            'status' => $status,
            'body' => '',
            'contentType' => $responseContentType,
            'latencyMs' => $latencyMs,
            'error' => $errorMessage !== '' ? $errorMessage : ('CURL_ERROR_' . $errorNumber),
            'cfRay' => $responseHeaders['cf-ray'] ?? null,
        ];
    }

    return [
        'status' => $status,
        'body' => (string) $responseBody,
        'contentType' => $responseContentType,
        'latencyMs' => $latencyMs,
        'error' => null,
        'cfRay' => $responseHeaders['cf-ray'] ?? null,
    ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap: headers, CORS, request id
// ─────────────────────────────────────────────────────────────────────────────

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header_remove('X-Powered-By');

$allowedOrigins = [
    'https://orva-store.com',
    'https://www.orva-store.com',
    'https://staging.orva-store.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:8080',
];
$requestOrigin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
if (in_array($requestOrigin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Credentials: true');
    header("Access-Control-Allow-Origin: {$requestOrigin}");
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Orva-Request-Id');
header('Access-Control-Expose-Headers: X-Orva-Request-Id, X-Orva-Upstream-Status, X-RateLimit-Limit, X-RateLimit-Remaining');

$requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($requestMethod === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$requestId = orva_codflow_request_id();
header('X-Orva-Request-Id: ' . $requestId);

try {
    // ── Authentication ───────────────────────────────────────────────────────
    $adminToken = trim((string) ($config['admin']['token'] ?? ''));
    $envToken = getenv('ADMIN_API_TOKEN');
    if ($envToken === false) {
        $envToken = $_ENV['ADMIN_API_TOKEN'] ?? '';
    }
    if (trim((string) $envToken) !== '') {
        $adminToken = trim((string) $envToken);
    }
    if ($adminToken === '') {
        error_log('[ORVA CodFlow] CRITICAL: ADMIN_API_TOKEN is not configured. req=' . $requestId);
        orva_codflow_fail(503, 'SERVER_MISCONFIGURED', 'Admin authentication is not configured on this server.', ['requestId' => $requestId]);
    }

    $authType = orva_codflow_auth_type($adminToken);
    if ($authType === '') {
        orva_codflow_fail(401, 'ORVA_SESSION_REQUIRED', 'A valid OrvaStore admin session is required.', ['requestId' => $requestId]);
    }

    if ($authType === 'cookie') {
        $secFetchSite = strtolower((string) ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? ''));
        if ($secFetchSite === 'cross-site') {
            orva_codflow_fail(403, 'CSRF_REJECTED', 'Cross-site request rejected.', ['requestId' => $requestId]);
        }
        if ($requestOrigin !== '' && !in_array($requestOrigin, $allowedOrigins, true)) {
            orva_codflow_fail(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed.', ['requestId' => $requestId]);
        }
    }

    [$rateAllowed, $rateRemaining] = orva_codflow_rate_limit($adminToken);
    header('X-RateLimit-Limit: ' . ORVA_CODFLOW_RATE_LIMIT);
    header('X-RateLimit-Remaining: ' . $rateRemaining);
    if (!$rateAllowed) {
        header('Retry-After: ' . ORVA_CODFLOW_RATE_WINDOW);
        orva_codflow_fail(429, 'RATE_LIMITED', 'Too many requests. Try again shortly.', ['requestId' => $requestId]);
    }

    // ── Local endpoints (never proxied) ──────────────────────────────────────
    $path = $_GET['path'] ?? '';
    if (!is_string($path)) {
        orva_codflow_fail(400, 'INVALID_PATH', 'The path parameter must be a string.', ['requestId' => $requestId]);
    }
    $path = trim($path);

    $flags = orva_codflow_flags((string) ($config['codflow']['flags'] ?? ''));
    $allowInsecureLocal = filter_var($config['codflow']['allow_insecure_local'] ?? 'false', FILTER_VALIDATE_BOOLEAN);
    $baseUrl = orva_codflow_base_url((string) ($config['codflow']['api_url'] ?? ''), $allowInsecureLocal);
    $apiKey = trim((string) ($config['codflow']['api_key'] ?? ''));
    $configured = $baseUrl !== null && $apiKey !== '';

    $timeoutMs = (int) ($config['codflow']['timeout_ms'] ?? 20000);
    if ($timeoutMs < 1000) {
        $timeoutMs = 1000;
    }
    if ($timeoutMs > 60000) {
        $timeoutMs = 60000;
    }

    if ($path === '/__flags') {
        orva_codflow_respond(200, ['success' => true, 'data' => $flags], ['X-Orva-Upstream-Status' => 'local']);
    }

    if ($path === '/__health') {
        $upstream = null;
        $probe = isset($_GET['probe']) && $_GET['probe'] === '1';
        if ($probe && $configured) {
            // dashboard-stats only needs dashboard:view, matching the Phase 0 scope grant.
            $probeResult = orva_codflow_http(
                'GET',
                $baseUrl . '/api/analytics/dashboard-stats',
                $apiKey,
                min(3000, $timeoutMs),
                null,
                ''
            );
            $upstream = [
                'reachable' => $probeResult['error'] === null && $probeResult['status'] > 0,
                'status' => $probeResult['status'],
                'latencyMs' => $probeResult['latencyMs'],
                'error' => $probeResult['error'],
            ];
        }

        orva_codflow_respond(200, [
            'success' => true,
            'data' => [
                'bridge' => 'ok',
                'version' => ORVA_CODFLOW_VERSION,
                'configured' => $configured,
                'upstreamHost' => $baseUrl !== null ? (parse_url($baseUrl, PHP_URL_HOST) ?: null) : null,
                'flags' => $flags,
                'auth' => 'bridge',
                'upstream' => $upstream,
                'timestamp' => gmdate('c'),
            ],
        ], ['X-Orva-Upstream-Status' => 'local']);
    }

    // ── Path validation ──────────────────────────────────────────────────────
    if ($path === '' || strlen($path) > ORVA_CODFLOW_MAX_PATH_LENGTH) {
        orva_codflow_fail(400, 'INVALID_PATH', 'The path parameter is missing or too long.', ['requestId' => $requestId]);
    }
    if ($path[0] !== '/'
        || strpos($path, '?') !== false
        || strpos($path, '#') !== false
        || strpos($path, '%') !== false
        || strpos($path, '..') !== false
        || strpos($path, '//') !== false
        || preg_match('/[\\\\\x00-\x1F\x7F]/', $path) === 1
        || preg_match('#^[a-z][a-z0-9+.-]*:#i', $path) === 1
    ) {
        orva_codflow_fail(400, 'INVALID_PATH', 'The path parameter is malformed.', ['requestId' => $requestId]);
    }

    $allowedPathPattern = '#^/api/(?:orders|products|product-groups|customers|customer-groups|customer-tags|drivers|wilayas|delivery-companies|shipping-profiles|driver-payments|stores|reviews|offers|stock|analytics|activity-logs|abandoned-orders|store-pages|landing-pages|checkout-form|whatsapp-widget|images|users)(?:/|$)#';
    if (preg_match($allowedPathPattern, $path) !== 1) {
        orva_codflow_fail(403, 'PATH_NOT_ALLOWED', 'This CodFlow path is not allowed by the bridge.', ['requestId' => $requestId]);
    }

    // ── Method and body validation ───────────────────────────────────────────
    if (!in_array($requestMethod, ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], true)) {
        header('Allow: GET, POST, PATCH, PUT, DELETE, OPTIONS');
        orva_codflow_fail(405, 'METHOD_NOT_ALLOWED', 'This HTTP method is not allowed.', ['requestId' => $requestId]);
    }

    $rawBody = file_get_contents('php://input');
    if ($rawBody === false) {
        $rawBody = '';
    }
    $contentType = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? ''))[0]));

    if ($contentType === 'multipart/form-data') {
        orva_codflow_fail(
            501,
            'MULTIPART_NOT_SUPPORTED',
            'Multipart uploads cannot be proxied by PHP. Use POST /api/images/presign and upload directly to R2.',
            ['requestId' => $requestId]
        );
    }
    if ($rawBody !== '' && !in_array($contentType, ['application/json', 'application/x-www-form-urlencoded'], true)) {
        orva_codflow_fail(415, 'UNSUPPORTED_CONTENT_TYPE', 'Only JSON and form-urlencoded bodies are supported.', ['requestId' => $requestId]);
    }

    // ── Configuration gate ───────────────────────────────────────────────────
    if (!$configured) {
        orva_codflow_fail(
            503,
            'CODFLOW_NOT_CONFIGURED',
            'CodFlow is not configured on this server yet. Set CODFLOW_API_URL and CODFLOW_API_KEY.',
            ['requestId' => $requestId]
        );
    }

    // ── Query forwarding ─────────────────────────────────────────────────────
    $queryPairs = [];
    foreach ($_GET as $key => $value) {
        if ($key === 'path') {
            continue;
        }
        if (!is_string($key) || preg_match('/^[A-Za-z0-9_.\-\[\]]{1,64}$/', $key) !== 1 || is_array($value)) {
            orva_codflow_fail(400, 'INVALID_QUERY', 'The query string contains an unsupported parameter.', ['requestId' => $requestId]);
        }
        $queryPairs[] = rawurlencode($key) . '=' . rawurlencode((string) $value);
    }

    // ── Upstream request ─────────────────────────────────────────────────────
    $upstreamUrl = $baseUrl . $path . ($queryPairs !== [] ? '?' . implode('&', $queryPairs) : '');
    $result = orva_codflow_http(
        $requestMethod,
        $upstreamUrl,
        $apiKey,
        $timeoutMs,
        $rawBody !== '' ? $rawBody : null,
        $contentType
    );

    header('X-Orva-Upstream-Status: ' . $result['status']);

    if ($result['error'] !== null) {
        error_log(sprintf(
            '[ORVA CodFlow] upstream failure method=%s path=%s error=%s status=%d latency=%dms req=%s',
            $requestMethod,
            $path,
            $result['error'],
            $result['status'],
            $result['latencyMs'],
            $requestId
        ));
        orva_codflow_fail(
            502,
            'CODFLOW_UNAVAILABLE',
            'CodFlow is unreachable or timed out. The legacy admin remains available.',
            ['requestId' => $requestId]
        );
    }

    if ($result['status'] === 401) {
        error_log(sprintf(
            '[ORVA CodFlow] CodFlow rejected the bridge API key path=%s req=%s cf=%s',
            $path,
            $requestId,
            $result['cfRay'] ?? '-'
        ));
        orva_codflow_fail(
            502,
            'CODFLOW_AUTH_FAILED',
            'CodFlow rejected the bridge credentials. Rotate CODFLOW_API_KEY.',
            ['requestId' => $requestId]
        );
    }

    if ($result['status'] === 204) {
        orva_codflow_respond(204, null, ['X-Orva-Upstream-Status' => '204']);
    }

    $trimmedBody = trim($result['body']);
    $decoded = null;
    if ($trimmedBody !== '') {
        $decoded = json_decode($trimmedBody, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            error_log(sprintf(
                '[ORVA CodFlow] non-JSON upstream response method=%s path=%s status=%d content-type=%s req=%s',
                $requestMethod,
                $path,
                $result['status'],
                $result['contentType'],
                $requestId
            ));
            $status = ($result['status'] >= 200 && $result['status'] < 300) ? 502 : $result['status'];
            orva_codflow_fail(
                $status,
                'CODFLOW_INVALID_RESPONSE',
                'CodFlow returned a non-JSON response.',
                ['requestId' => $requestId, 'upstreamStatus' => $result['status']]
            );
        }
    }

    $payload = orva_codflow_redact($decoded);
    if ($payload === null) {
        $payload = ['success' => true, 'data' => null];
    } elseif (!is_array($payload)) {
        $payload = ['success' => true, 'data' => $payload];
    }

    if ($result['status'] >= 400) {
        $code = is_array($payload) ? (string) ($payload['code'] ?? $payload['error'] ?? '-') : '-';
        error_log(sprintf(
            '[ORVA CodFlow] upstream error method=%s path=%s status=%d code=%s latency=%dms req=%s cf=%s',
            $requestMethod,
            $path,
            $result['status'],
            $code,
            $result['latencyMs'],
            $requestId,
            $result['cfRay'] ?? '-'
        ));
    } elseif ($result['latencyMs'] > 2000) {
        error_log(sprintf(
            '[ORVA CodFlow] slow upstream method=%s path=%s status=%d latency=%dms req=%s',
            $requestMethod,
            $path,
            $result['status'],
            $result['latencyMs'],
            $requestId
        ));
    }

    orva_codflow_respond($result['status'], $payload);
} catch (Throwable $error) {
    error_log(sprintf(
        '[ORVA CodFlow] fatal error req=%s message=%s',
        $requestId,
        $error->getMessage()
    ));
    orva_codflow_fail(500, 'BRIDGE_INTERNAL_ERROR', 'Unexpected bridge error.', ['requestId' => $requestId]);
}
