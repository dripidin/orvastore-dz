<?php
// ==============================================================================
// ORVA STORE — Server-Side Analytics & Traffic Metrics API
// Website: orva-store.com | PHP 8.3
// Handles non-blocking visitor events (POST) & admin traffic metrics (GET)
// ==============================================================================

define('ORVA_API', true);
require_once __DIR__ . '/config.php';

// ── CORS & Headers ────────────────────────────────────────────────────────────
$allowedOrigins = [
    'https://orva-store.com',
    'https://www.orva-store.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:8000',
    'http://127.0.0.1:8000'
];

$requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($requestOrigin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Credentials: true');
    header("Access-Control-Allow-Origin: {$requestOrigin}");
    header('Vary: Origin');
}
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$ledgerFile = dirname(__DIR__) . '/data/private/analytics-ledger.json';
$privateDir = dirname(__DIR__) . '/data/private';
if (!is_dir($privateDir)) {
    @mkdir($privateDir, 0700, true);
}

// ── Authentication Helper for GET requests ────────────────────────────────────
function isAuthenticatedAdmin(array $config): bool {
    $expectedToken = trim((string)($config['admin']['token'] ?? ''));
    if ($expectedToken === '') {
        $expectedToken = trim((string)getenv('ADMIN_API_TOKEN'));
    }
    if ($expectedToken === '') return false;

    // Check Bearer Token
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (empty($authHeader) && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    }

    if (preg_match('/Bearer\s+(\S+)/i', $authHeader, $matches)) {
        if (hash_equals($expectedToken, $matches[1])) {
            return true;
        }
    }

    // Check Session Cookie
    $cookieVal = (string)($_COOKIE['orva_admin_session'] ?? '');
    if ($cookieVal !== '' && hash_equals($expectedToken, $cookieVal)) {
        return true;
    }

    return false;
}

// ── GET: Return Aggregated Store Traffic & Conversion Metrics ─────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (!isAuthenticatedAdmin($config)) {
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'error' => 'UNAUTHORIZED_ACCESS',
            'message' => 'Admin authorization required to view analytics.'
        ]);
        exit;
    }

    $ledger = [];
    if (file_exists($ledgerFile)) {
        $content = @file_get_contents($ledgerFile);
        if ($content) {
            $ledger = json_decode($content, true) ?: [];
        }
    }

    $totalPageViews = $ledger['totalPageViews'] ?? 0;
    $uniqueSessions = count($ledger['sessions'] ?? []);
    $events = $ledger['recentEvents'] ?? [];
    $pages = $ledger['pages'] ?? [];
    $conversions = $ledger['conversions'] ?? 0;

    // Calculate real-time conversion rate
    $conversionRate = $uniqueSessions > 0 ? round(($conversions / $uniqueSessions) * 100, 2) : 0;

    // Formatted top pages
    $topPages = [];
    foreach ($pages as $p => $views) {
        $topPages[] = ['path' => $p, 'views' => $views];
    }
    usort($topPages, fn($a, $b) => $b['views'] <=> $a['views']);

    echo json_encode([
        'success' => true,
        'data' => [
            'totalPageViews' => $totalPageViews,
            'uniqueSessions' => $uniqueSessions,
            'conversions' => $conversions,
            'conversionRate' => $conversionRate,
            'topPages' => array_slice($topPages, 0, 10),
            'recentEvents' => array_slice(array_reverse($events), 0, 25),
            'lastUpdated' => $ledger['lastUpdated'] ?? date('c')
        ]
    ]);
    exit;
}

// ── POST: Record Visitor Event (Non-blocking beacon/fetch) ─────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw = file_get_contents('php://input');
    $payload = json_decode($raw, true) ?: [];

    $event = preg_replace('/[^a-zA-Z0-9_\-]/', '', substr((string)($payload['event'] ?? 'page_view'), 0, 32));
    $page = filter_var(substr((string)($payload['page'] ?? '/'), 0, 128), FILTER_SANITIZE_URL);
    $referrer = filter_var(substr((string)($payload['referrer'] ?? ''), 0, 256), FILTER_SANITIZE_URL);
    $sessionId = preg_replace('/[^a-zA-Z0-9_\-]/', '', substr((string)($payload['sessionId'] ?? ''), 0, 64));

    if (empty($sessionId)) {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
        $sessionId = substr(hash('sha256', $ip . date('Y-m-d')), 0, 16);
    }

    // Atomic update of analytics ledger
    $fp = fopen($ledgerFile, 'c+');
    if ($fp && flock($fp, LOCK_EX)) {
        $size = filesize($ledgerFile);
        $content = $size > 0 ? fread($fp, $size) : '';
        $ledger = $content ? json_decode($content, true) : null;
        if (!is_array($ledger)) {
            $ledger = [
                'totalPageViews' => 0,
                'sessions' => [],
                'pages' => [],
                'conversions' => 0,
                'recentEvents' => [],
                'lastUpdated' => date('c')
            ];
        }

        $ledger['totalPageViews']++;

        // Cap / prune session map: keep at most 2,000 and drop entries older than 24h
        if (!isset($ledger['sessions']) || !is_array($ledger['sessions'])) {
            $ledger['sessions'] = [];
        }
        $nowTs = time();
        foreach ($ledger['sessions'] as $sid => $seenAt) {
            $seenTs = is_numeric($seenAt) ? (int)$seenAt : (strtotime((string)$seenAt) ?: 0);
            if ($seenTs < $nowTs - 86400) {
                unset($ledger['sessions'][$sid]);
            }
        }
        $ledger['sessions'][$sessionId] = date('c');
        if (count($ledger['sessions']) > 2000) {
            asort($ledger['sessions']);
            $ledger['sessions'] = array_slice($ledger['sessions'], -2000, null, true);
        }

        // Page breakdown
        $cleanPage = $page ?: '/';
        $ledger['pages'][$cleanPage] = ($ledger['pages'][$cleanPage] ?? 0) + 1;

        // Ignore client-claimed purchase conversions on the public endpoint.
        // Trusted purchase counting remains on the order persistence path.

        // Recent events queue (cap at 100)
        $ledger['recentEvents'][] = [
            'event' => $event,
            'page' => $cleanPage,
            'time' => date('H:i:s'),
            'date' => date('Y-m-d')
        ];
        if (count($ledger['recentEvents']) > 100) {
            array_shift($ledger['recentEvents']);
        }

        $ledger['lastUpdated'] = date('c');

        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($ledger, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        fflush($fp);
        flock($fp, LOCK_UN);
        fclose($fp);
    }

    http_response_code(200);
    echo json_encode(['success' => true, 'recorded' => true]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'METHOD_NOT_ALLOWED']);

