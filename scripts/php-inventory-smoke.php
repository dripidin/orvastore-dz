<?php
/**
 * PHP inventory smoke — uses ORVA_INVENTORY_STATE_PATH when set; otherwise a temp fixture.
 * Never mutates the operational data/inventory-state.json unless explicitly pointed there.
 */
define('ORVA_API', true);

$root = dirname(__DIR__);
$useTemp = true;
$stateEnv = getenv('ORVA_INVENTORY_STATE_PATH') ?: ($_ENV['ORVA_INVENTORY_STATE_PATH'] ?? '');
if ($stateEnv !== '' && is_file($stateEnv)) {
    $useTemp = false;
}

if ($useTemp) {
    $tmp = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'orva-php-smoke-' . bin2hex(random_bytes(4));
    mkdir($tmp . DIRECTORY_SEPARATOR . 'locks', 0755, true);
    $state = $tmp . DIRECTORY_SEPARATOR . 'inventory-state.json';
    file_put_contents($state, json_encode([
        'version' => 2,
        'inventory' => [
            'ORVA-STAB-TEST' => [
                'sku' => 'ORVA-STAB-TEST',
                'available' => 3,
                'reserved' => 0,
                'totalPhysical' => 3,
            ],
        ],
        'reservations' => [],
    ], JSON_PRETTY_PRINT));
    putenv('ORVA_INVENTORY_STATE_PATH=' . $state);
    $_ENV['ORVA_INVENTORY_STATE_PATH'] = $state;
    putenv('ORVA_INVENTORY_LOCKS_DIR=' . $tmp . DIRECTORY_SEPARATOR . 'locks');
    $_ENV['ORVA_INVENTORY_LOCKS_DIR'] = $tmp . DIRECTORY_SEPARATOR . 'locks';
}

putenv('ORVA_INVENTORY_BACKEND=json');
$_ENV['ORVA_INVENTORY_BACKEND'] = 'json';
putenv('APP_ENV=local');
$_ENV['APP_ENV'] = 'local';

require_once $root . '/lib/inventory-store.php';

$orderId = 'PHP-STAB-' . bin2hex(random_bytes(4));
$reserve = orva_inventory_reserve('ORVA-STAB-TEST', 1, $orderId);
if (empty($reserve['ok']) || empty($reserve['created'])) {
    fwrite(STDERR, 'reserve_failed ' . json_encode($reserve) . PHP_EOL);
    exit(1);
}
$dup = orva_inventory_reserve('ORVA-STAB-TEST', 1, $orderId);
if (empty($dup['alreadyReserved'])) {
    fwrite(STDERR, 'duplicate_not_detected' . PHP_EOL);
    exit(1);
}
$release = orva_inventory_release($orderId, 'TEST_CLEANUP', 1);
if (empty($release['ok'])) {
    fwrite(STDERR, 'release_failed' . PHP_EOL);
    exit(1);
}
$release2 = orva_inventory_release($orderId, 'TEST_CLEANUP', 1);
if (empty($release2['alreadyReleased'])) {
    fwrite(STDERR, 'release_not_idempotent' . PHP_EOL);
    exit(1);
}
echo "PHP_INVENTORY_SMOKE_OK\n";
