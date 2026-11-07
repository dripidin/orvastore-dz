<?php
/**
 * Local / Staging diagnostics — no secrets.
 * Enabled only when APP_ENV is local|development|dev|staging.
 */
define('ORVA_API', true);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

$config = require __DIR__ . '/config.php';
$env = strtolower(trim((string)($config['app_env'] ?? 'production')));
if (!in_array($env, ['local', 'development', 'dev', 'staging'], true)) {
    http_response_code(404);
    echo json_encode(['success' => false, 'error' => 'NOT_AVAILABLE']);
    exit;
}

$pdoEnabled = orva_staging_pdo_enabled($config);
$diag = [
    'success' => true,
    'app_env' => $env,
    'supabase_schema' => $config['supabase']['schema'] ?? null,
    'staging_pdo_enabled' => $pdoEnabled,
    'php_version' => PHP_VERSION,
    'extensions' => [
        'pdo' => extension_loaded('pdo'),
        'pdo_pgsql' => extension_loaded('pdo_pgsql'),
        'pgsql' => extension_loaded('pgsql'),
        'openssl' => extension_loaded('openssl'),
    ],
    'pdo_drivers' => PDO::getAvailableDrivers(),
    'real_postgresql_integration' => 'NOT_TESTED',
];

if ($pdoEnabled) {
    $db = orva_staging_db($config);
    $diag['repository'] = $db->diagnostics();
    $diag['orders_backend'] = $db->getMode();
} else {
    $diag['orders_backend'] = 'postgrest';
}

// Never include passwords, DSN, tokens, or admin credentials.
echo json_encode($diag, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
