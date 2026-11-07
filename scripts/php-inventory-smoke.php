<?php
define('ORVA_API', true);
require __DIR__ . '/../lib/inventory-store.php';

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
// Must NOT release on duplicate path — only release the created one intentionally once
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
