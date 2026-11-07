<?php
/**
 * PHP JSON inventory acceptance against an isolated state file.
 * Args: [statePath] [locksDir]
 */
if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "CLI only\n");
    exit(2);
}

$statePath = $argv[1] ?? (getenv('ORVA_INVENTORY_STATE_PATH') ?: '');
$locksDir = $argv[2] ?? (getenv('ORVA_INVENTORY_LOCKS_DIR') ?: '');
if ($statePath === '' || $locksDir === '') {
    fwrite(STDERR, "Usage: php php-json-inventory-acceptance.php <statePath> <locksDir>\n");
    exit(2);
}

putenv('APP_ENV=local');
$_ENV['APP_ENV'] = 'local';
putenv('ORVA_INVENTORY_BACKEND=json');
$_ENV['ORVA_INVENTORY_BACKEND'] = 'json';
putenv('ORVA_INVENTORY_STATE_PATH=' . $statePath);
$_ENV['ORVA_INVENTORY_STATE_PATH'] = $statePath;
putenv('ORVA_INVENTORY_LOCKS_DIR=' . $locksDir);
$_ENV['ORVA_INVENTORY_LOCKS_DIR'] = $locksDir;
putenv('ORVA_INVENTORY_REQUIRE_PG');
unset($_ENV['ORVA_INVENTORY_REQUIRE_PG']);

define('ORVA_API', true);
require_once dirname(__DIR__) . '/lib/inventory-store.php';

if (orva_inventory_backend() !== 'json') {
    fwrite(STDERR, "backend_not_json\n");
    exit(1);
}
if (orva_inventory_use_pg()) {
    fwrite(STDERR, "pg_selected_unexpectedly\n");
    exit(1);
}

$orderId = 'PHP-JSON-' . bin2hex(random_bytes(4));
$reserve = orva_inventory_reserve('ORVA-JSON-TEST', 1, $orderId);
if (empty($reserve['ok']) || empty($reserve['created'])) {
    fwrite(STDERR, 'reserve_failed ' . json_encode($reserve) . "\n");
    exit(1);
}
$dup = orva_inventory_reserve('ORVA-JSON-TEST', 1, $orderId);
if (empty($dup['alreadyReserved'])) {
    fwrite(STDERR, "duplicate_not_detected\n");
    exit(1);
}
$bind = orva_inventory_bind_order($orderId);
if (empty($bind['ok'])) {
    fwrite(STDERR, 'bind_failed ' . json_encode($bind) . "\n");
    exit(1);
}
$release = orva_inventory_release($orderId, 'TEST_CLEANUP', 1);
if (empty($release['ok'])) {
    fwrite(STDERR, "release_failed\n");
    exit(1);
}
$release2 = orva_inventory_release($orderId, 'TEST_CLEANUP', 1);
if (empty($release2['alreadyReleased'])) {
    fwrite(STDERR, "release_not_idempotent\n");
    exit(1);
}

$miss = orva_inventory_reserve('ORVA-NO-SUCH-SKU', 1, 'PHP-JSON-MISS-001');
if (!empty($miss['ok']) || ($miss['code'] ?? '') !== 'INVENTORY_SKU_MISSING') {
    fwrite(STDERR, 'missing_sku_not_rejected ' . json_encode($miss) . "\n");
    exit(1);
}

echo "PHP_JSON_INVENTORY_ACCEPTANCE_OK\n";
