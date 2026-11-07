<?php
/**
 * PHP CLI recovery runner for Hostinger shared hosting (when Node CLI is unavailable).
 *
 * Same eligibility rules as lib/inventory-recovery.js / scripts/recover-abandoned-reservations.js:
 * - Only lifecycle=CHECKOUT_PENDING
 * - Age >= threshold (default 15 minutes)
 * - Order reconcile must confirm order does NOT exist
 * - Never release NULL lifecycle (historical) or ORDER_BOUND
 * - Fail closed if order lookup is unavailable
 * - File lock for single-flight execution
 * - Sanitized logging only
 *
 * Usage:
 *   php scripts/recover-abandoned-reservations.php --dry-run
 *   php scripts/recover-abandoned-reservations.php --apply --threshold-ms=900000
 *
 * Cron (PROPOSAL — do not create remotely yet):
 *   every 15 minutes: flock + php scripts/recover-abandoned-reservations.php --apply
 *   See docs/HOSTINGER_INVENTORY_RECOVERY_CRON_PROPOSAL.md
 */

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "CLI only\n");
    exit(2);
}

define('ORVA_API', true);

$root = dirname(__DIR__);
$opts = getopt('', ['dry-run', 'apply', 'threshold-ms::', 'help']);
if (isset($opts['help'])) {
    fwrite(STDOUT, "Usage: php scripts/recover-abandoned-reservations.php [--dry-run|--apply] [--threshold-ms=900000]\n");
    exit(0);
}
$dryRun = isset($opts['dry-run']) || !isset($opts['apply']);
$thresholdMs = isset($opts['threshold-ms']) ? (int)$opts['threshold-ms'] : 15 * 60 * 1000;
if ($thresholdMs < 60 * 1000) {
    $thresholdMs = 15 * 60 * 1000;
}

$config = require $root . '/api/config.php';
require_once $root . '/lib/inventory-store.php';

$lockDir = $root . '/data/locks';
if (!is_dir($lockDir)) {
    @mkdir($lockDir, 0755, true);
}
$lockPath = $lockDir . '/inventory-recovery.lock';
$lockFp = fopen($lockPath, 'c+');
if (!$lockFp || !flock($lockFp, LOCK_EX | LOCK_NB)) {
    fwrite(STDERR, json_encode(['ok' => false, 'error' => 'RECOVERY_LOCK_BUSY'], JSON_UNESCAPED_UNICODE) . "\n");
    exit(3);
}

/**
 * Order existence check via Staging/Production storage helpers already used by delivery.php.
 * Fail closed: if lookup throws or is misconfigured → treat as processing (do not release).
 */
function orva_recovery_reconcile_order(string $orderId, array $config): array
{
    $orderId = trim($orderId);
    if ($orderId === '' || !preg_match('/^[A-Za-z0-9._:-]{6,64}$/', $orderId)) {
        return ['exists' => true, 'processing' => true];
    }
    try {
        if (!function_exists('orva_orders_storage_request')) {
            // Soft-load delivery helpers without executing HTTP entrypoint.
            // Prefer REST GET through config-backed helper if available.
            $url = rtrim((string)($config['supabase']['url'] ?? ''), '/') . '/rest/v1/orders?order_id=eq.' . rawurlencode($orderId) . '&select=order_id,status&limit=1';
            if ($url === '/rest/v1/orders?order_id=eq.' . rawurlencode($orderId) . '&select=order_id,status&limit=1') {
                throw new RuntimeException('SUPABASE_URL_MISSING');
            }
            // Minimal curl GET with service/staging credentials from config gates.
            $key = (string)($config['supabase']['service_role_key'] ?? '');
            $schema = (string)($config['supabase']['schema'] ?? 'public');
            if ($key === '') {
                throw new RuntimeException('SERVER_CREDENTIAL_MISSING');
            }
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HTTPHEADER => [
                    'apikey: ' . $key,
                    'Authorization: Bearer ' . $key,
                    'Accept: application/json',
                    'Accept-Profile: ' . $schema,
                ],
                CURLOPT_TIMEOUT => 15,
            ]);
            $body = curl_exec($ch);
            $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            if ($code < 200 || $code >= 300) {
                throw new RuntimeException('ORDER_LOOKUP_HTTP_' . $code);
            }
            $rows = json_decode((string)$body, true);
            if (!is_array($rows)) {
                throw new RuntimeException('ORDER_LOOKUP_INVALID_JSON');
            }
            if (count($rows) === 0) {
                return ['exists' => false];
            }
            return ['exists' => true, 'status' => $rows[0]['status'] ?? null];
        }
    } catch (Throwable $e) {
        error_log('[orva-recovery] reconcile fail-closed: ' . $e->getMessage());
        return ['exists' => true, 'processing' => true];
    }
    return ['exists' => true, 'processing' => true];
}

function orva_recovery_age_ms(?string $iso): float
{
    if ($iso === null || $iso === '') {
        return INF;
    }
    $t = strtotime($iso);
    if ($t === false) {
        return INF;
    }
    return (microtime(true) * 1000) - ($t * 1000);
}

$summary = [
    'ok' => true,
    'dryRun' => $dryRun,
    'thresholdMs' => $thresholdMs,
    'scanned' => 0,
    'eligible' => 0,
    'released' => 0,
    'skippedBound' => 0,
    'skippedHistorical' => 0,
    'skippedYoung' => 0,
    'skippedOrderExists' => 0,
    'skippedProcessing' => 0,
    'skippedAlreadyTerminal' => 0,
    'releasedOrderIdPrefixes' => [],
    'preservedHistorical' => true,
    'runner' => 'php-cli',
];

try {
    if (orva_inventory_use_pg()) {
        // PG path: mirror Node recoverAbandonedCheckoutReservationsPg eligibility.
        $pdo = orva_pg_pdo();
        $ledger = orva_pg_table('inventory_reservations');
        $items = orva_pg_table('inventory_items');
        $audit = orva_pg_table('inventory_audit');
        $pdo->beginTransaction();
        $rows = $pdo->query(
            "SELECT * FROM {$ledger} WHERE status = 'RESERVED' AND lifecycle = 'CHECKOUT_PENDING' FOR UPDATE"
        )->fetchAll(PDO::FETCH_ASSOC);
        $summary['scanned'] = count($rows);
        $cutoffMs = $thresholdMs;
        foreach ($rows as $row) {
            $age = orva_recovery_age_ms($row['created_at'] ?? $row['updated_at'] ?? null);
            if ($age < $cutoffMs) {
                $summary['skippedYoung']++;
                continue;
            }
            $summary['eligible']++;
            $verdict = orva_recovery_reconcile_order((string)$row['order_id'], $config);
            if (!empty($verdict['processing'])) {
                $summary['skippedProcessing']++;
                continue;
            }
            if (!empty($verdict['exists'])) {
                if (!$dryRun) {
                    $upd = $pdo->prepare(
                        "UPDATE {$ledger} SET lifecycle = 'ORDER_BOUND', updated_at = NOW()
                         WHERE order_id = :oid AND sku = :sku AND status = 'RESERVED'"
                    );
                    $upd->execute(['oid' => $row['order_id'], 'sku' => $row['sku']]);
                }
                $summary['skippedOrderExists']++;
                continue;
            }
            if ($dryRun) {
                $summary['released']++;
                $summary['releasedOrderIdPrefixes'][] = substr((string)$row['order_id'], 0, 12);
                continue;
            }
            $qty = (int)$row['quantity'];
            $pdo->prepare(
                "UPDATE {$items}
                 SET reserved = GREATEST(0, reserved - :q),
                     available = LEAST(total_physical, available + :q2),
                     updated_at = NOW()
                 WHERE sku = :sku"
            )->execute(['q' => $qty, 'q2' => $qty, 'sku' => $row['sku']]);
            $pdo->prepare(
                "UPDATE {$ledger}
                 SET status = 'RELEASED', release_reason = 'CHECKOUT_CRASH_RECOVERY', updated_at = NOW()
                 WHERE order_id = :oid AND sku = :sku AND status = 'RESERVED' AND lifecycle = 'CHECKOUT_PENDING'"
            )->execute(['oid' => $row['order_id'], 'sku' => $row['sku']]);
            $pdo->prepare(
                "INSERT INTO {$audit} (sku, order_id, change_type, quantity, previous_available, new_available, created_at)
                 VALUES (:sku, :oid, 'CHECKOUT_CRASH_RECOVERY', :q, 0, 0, NOW())"
            )->execute(['sku' => $row['sku'], 'oid' => $row['order_id'], 'q' => $qty]);
            $summary['released']++;
            $summary['releasedOrderIdPrefixes'][] = substr((string)$row['order_id'], 0, 12);
        }
        if ($dryRun) {
            $pdo->rollBack();
        } else {
            $pdo->commit();
        }
        // Count historical RESERVED with null lifecycle for reporting (read-only)
        $hist = (int)$pdo->query(
            "SELECT COUNT(*) FROM {$ledger} WHERE status = 'RESERVED' AND (lifecycle IS NULL OR lifecycle = '')"
        )->fetchColumn();
        $summary['historicalReservedNullLifecycle'] = $hist;
    } else {
        // JSON path — same eligibility; uses inventory lock.
        $fp = orva_inventory_acquire_lock();
        try {
            $state = orva_inventory_load_state();
            foreach (($state['reservations'] ?? []) as $orderId => $res) {
                $summary['scanned']++;
                $status = strtoupper((string)($res['status'] ?? ''));
                if ($status === 'RELEASED' || $status === 'SETTLED') {
                    $summary['skippedAlreadyTerminal']++;
                    continue;
                }
                if ($status !== 'RESERVED') {
                    continue;
                }
                $lifecycle = strtoupper((string)($res['lifecycle'] ?? ''));
                if ($lifecycle === 'ORDER_BOUND') {
                    $summary['skippedBound']++;
                    continue;
                }
                if ($lifecycle !== 'CHECKOUT_PENDING') {
                    $summary['skippedHistorical']++;
                    continue;
                }
                $age = orva_recovery_age_ms($res['timestamp'] ?? $res['updatedAt'] ?? null);
                if ($age < $thresholdMs) {
                    $summary['skippedYoung']++;
                    continue;
                }
                $summary['eligible']++;
                $verdict = orva_recovery_reconcile_order((string)$orderId, $config);
                if (!empty($verdict['processing'])) {
                    $summary['skippedProcessing']++;
                    continue;
                }
                if (!empty($verdict['exists'])) {
                    if (!$dryRun) {
                        $state['reservations'][$orderId]['lifecycle'] = 'ORDER_BOUND';
                        $state['reservations'][$orderId]['boundAt'] = gmdate('c');
                    }
                    $summary['skippedOrderExists']++;
                    continue;
                }
                if ($dryRun) {
                    $summary['released']++;
                    $summary['releasedOrderIdPrefixes'][] = substr((string)$orderId, 0, 12);
                    continue;
                }
                $sku = strtoupper((string)($res['sku'] ?? ''));
                $qty = (int)($res['quantity'] ?? 0);
                if ($sku !== '' && isset($state['inventory'][$sku]) && $qty > 0) {
                    $item = &$state['inventory'][$sku];
                    $actual = min((int)$item['reserved'], $qty);
                    $item['reserved'] = (int)$item['reserved'] - $actual;
                    $item['available'] = min((int)$item['totalPhysical'], (int)$item['available'] + $actual);
                }
                $state['reservations'][$orderId]['status'] = 'RELEASED';
                $state['reservations'][$orderId]['releasedAt'] = gmdate('c');
                $state['reservations'][$orderId]['releaseReason'] = 'CHECKOUT_CRASH_RECOVERY';
                $summary['released']++;
                $summary['releasedOrderIdPrefixes'][] = substr((string)$orderId, 0, 12);
            }
            if (!$dryRun) {
                orva_inventory_save_state($state);
            }
        } finally {
            orva_inventory_release_lock($fp);
        }
    }
} catch (Throwable $e) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    $summary['ok'] = false;
    $summary['error'] = 'RECOVERY_FAILED';
    error_log('[orva-recovery] ' . $e->getMessage());
    flock($lockFp, LOCK_UN);
    fclose($lockFp);
    fwrite(STDOUT, json_encode($summary, JSON_UNESCAPED_UNICODE) . "\n");
    exit(1);
}

flock($lockFp, LOCK_UN);
fclose($lockFp);
fwrite(STDOUT, json_encode($summary, JSON_UNESCAPED_UNICODE) . "\n");
exit($summary['ok'] ? 0 : 1);
