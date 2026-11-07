<?php
define('ORVA_API', true);
require dirname(__DIR__) . '/lib/risk-engine.php';

$allow = orva_risk_evaluate([
    'storeId' => 'orvastore',
    'orderId' => 'ORVA-TEST1',
    'actorPhone' => '0555123456',
    'actorIpHash' => orva_risk_hash_ip('127.0.0.1'),
    'deviceId' => 'dev-a',
    'honeypotValue' => '',
    'formDurationMs' => 15000,
]);
echo 'ALLOW_CASE=' . json_encode($allow) . PHP_EOL;

$block = orva_risk_evaluate([
    'storeId' => 'orvastore',
    'orderId' => 'ORVA-BOT',
    'actorPhone' => '0555123456',
    'actorIpHash' => orva_risk_hash_ip('127.0.0.1'),
    'deviceId' => 'dev-b',
    'honeypotValue' => 'http://spam',
    'formDurationMs' => 500,
]);
echo 'BLOCK_CASE=' . json_encode($block) . PHP_EOL;

if (($allow['decision'] ?? '') !== 'ALLOW') {
    fwrite(STDERR, "Expected ALLOW for clean order\n");
    exit(1);
}
if (($block['decision'] ?? '') !== 'BLOCK' || ($block['score'] ?? 0) < 80) {
    fwrite(STDERR, "Expected BLOCK for honeypot+fast\n");
    exit(1);
}
echo "OK\n";
