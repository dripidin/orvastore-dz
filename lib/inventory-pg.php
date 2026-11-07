<?php
/**
 * PostgreSQL inventory repository (PHP) — mirrors lib/inventory-pg.js against the
 * proposal schema in supabase/proposals/2026-11-07-public-inventory-idempotency.sql.
 *
 * Fail-closed when DATABASE_URL is configured but unavailable.
 * Hosted Supabase pooler hosts are refused unless ORVA_PG_ALLOW_HOSTED=true.
 */
if (!defined('ORVA_API') && php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('Direct access not permitted.');
}

require_once __DIR__ . '/orva-pg.php';

if (!function_exists('orva_inventory_pg_reserve')) {
    function orva_inventory_pg_unavailable(string $op, Throwable $e): array
    {
        error_log('[orva_inventory_pg] ' . $op . ' ' . $e->getMessage());
        return [
            'ok' => false,
            'code' => 'INVENTORY_UNAVAILABLE',
            'message' => 'خدمة المخزون غير متاحة حالياً. يرجى المحاولة لاحقاً.',
            'httpStatus' => 503,
        ];
    }

    /**
     * @return array{ok:bool,code?:string,message?:string,created?:bool,alreadyReserved?:bool,state?:array,httpStatus?:int}
     */
    function orva_inventory_pg_reserve(string $sku, int $quantity, string $orderId): array
    {
        $sku = strtoupper(trim($sku));
        $orderId = trim($orderId);
        if ($sku === '' || $orderId === '' || $quantity < 1) {
            return ['ok' => false, 'code' => 'INVALID_RESERVATION', 'message' => 'Invalid reservation request.'];
        }

        try {
            $pdo = orva_pg_pdo();
            $items = orva_pg_table('inventory_items');
            $ledger = orva_pg_table('inventory_reservations');
            $audit = orva_pg_table('inventory_audit');

            $pdo->beginTransaction();

            $lock = $pdo->prepare('SELECT pg_advisory_xact_lock(hashtext(:k))');
            $lock->execute(['k' => 'orva-inv:' . $orderId]);

            $stmt = $pdo->prepare(
                "SELECT * FROM {$ledger} WHERE order_id = :oid AND sku = :sku FOR UPDATE"
            );
            $stmt->execute(['oid' => $orderId, 'sku' => $sku]);
            $existing = $stmt->fetch();
            if ($existing) {
                $status = strtoupper((string)($existing['status'] ?? ''));
                if ($status === 'RESERVED' || $status === 'SETTLED') {
                    $st = $pdo->prepare(
                        "SELECT sku, available, reserved, total_physical FROM {$items} WHERE sku = :sku"
                    );
                    $st->execute(['sku' => $sku]);
                    $row = $st->fetch() ?: null;
                    $pdo->commit();
                    return [
                        'ok' => true,
                        'created' => false,
                        'alreadyReserved' => true,
                        'code' => 'ORDER_ID_ALREADY_RESERVED',
                        'message' => 'Order identifier already has an active reservation.',
                        'state' => $row ? [
                            'sku' => $row['sku'],
                            'available' => (int)$row['available'],
                            'reserved' => (int)$row['reserved'],
                            'totalPhysical' => (int)$row['total_physical'],
                        ] : null,
                    ];
                }
            }

            $upd = $pdo->prepare(
                "UPDATE {$items}
                 SET available = available - :q,
                     reserved = reserved + :q,
                     updated_at = NOW()
                 WHERE sku = :sku AND available >= :q2
                 RETURNING sku, available, reserved, total_physical"
            );
            $upd->execute(['q' => $quantity, 'sku' => $sku, 'q2' => $quantity]);
            $inv = $upd->fetch();
            if (!$inv) {
                $miss = $pdo->prepare("SELECT sku FROM {$items} WHERE sku = :sku");
                $miss->execute(['sku' => $sku]);
                $pdo->rollBack();
                if (!$miss->fetch()) {
                    return [
                        'ok' => false,
                        'code' => 'INVENTORY_SKU_MISSING',
                        'message' => 'المخزون غير مهيأ لهذا المنتج. يرجى المحاولة لاحقاً.',
                    ];
                }
                return [
                    'ok' => false,
                    'code' => 'INSUFFICIENT_STOCK',
                    'message' => 'عذراً، الكمية المطلوبة غير متوفرة حالياً في المخزون.',
                ];
            }

            $opId = 'RSV-' . $orderId . '-' . $sku;
            $pdo->prepare(
                "INSERT INTO {$ledger} (operation_id, order_id, sku, quantity, status, lifecycle, created_at, updated_at)
                 VALUES (:op, :oid, :sku, :q, 'RESERVED', 'CHECKOUT_PENDING', NOW(), NOW())
                 ON CONFLICT (order_id, sku) DO UPDATE
                   SET status = 'RESERVED',
                       quantity = EXCLUDED.quantity,
                       lifecycle = 'CHECKOUT_PENDING',
                       updated_at = NOW()
                 WHERE {$ledger}.status NOT IN ('SETTLED')"
            )->execute(['op' => $opId, 'oid' => $orderId, 'sku' => $sku, 'q' => $quantity]);

            $prevAvail = (int)$inv['available'] + $quantity;
            $pdo->prepare(
                "INSERT INTO {$audit} (sku, order_id, change_type, quantity, previous_available, new_available, created_at)
                 VALUES (:sku, :oid, 'RESERVE', :q, :prev, :new, NOW())"
            )->execute([
                'sku' => $sku,
                'oid' => $orderId,
                'q' => $quantity,
                'prev' => $prevAvail,
                'new' => (int)$inv['available'],
            ]);

            $pdo->commit();
            return [
                'ok' => true,
                'created' => true,
                'alreadyReserved' => false,
                'state' => [
                    'sku' => $inv['sku'],
                    'available' => (int)$inv['available'],
                    'reserved' => (int)$inv['reserved'],
                    'totalPhysical' => (int)$inv['total_physical'],
                ],
            ];
        } catch (Throwable $e) {
            if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            return orva_inventory_pg_unavailable('reserve', $e);
        }
    }

    /**
     * @return array{ok:bool,code?:string,alreadyReleased?:bool,alreadySettled?:bool,httpStatus?:int}
     */
    function orva_inventory_pg_release(string $orderId, string $reason = 'ORDER_CANCELLED', ?int $expectedQty = null): array
    {
        $orderId = trim($orderId);
        if ($orderId === '') {
            return ['ok' => false, 'code' => 'MISSING_ORDER_ID'];
        }

        try {
            $pdo = orva_pg_pdo();
            $items = orva_pg_table('inventory_items');
            $ledger = orva_pg_table('inventory_reservations');
            $audit = orva_pg_table('inventory_audit');

            $pdo->beginTransaction();

            // Match Node: lock by order_id; sku from ledger (PHP callers often omit sku).
            $stmt = $pdo->prepare("SELECT * FROM {$ledger} WHERE order_id = :oid FOR UPDATE");
            $stmt->execute(['oid' => $orderId]);
            $row = $stmt->fetch();
            if (!$row) {
                $pdo->commit();
                return ['ok' => true, 'code' => 'NO_RESERVATION', 'alreadyReleased' => true];
            }
            $status = strtoupper((string)($row['status'] ?? ''));
            if ($status === 'RELEASED') {
                $pdo->commit();
                return ['ok' => true, 'alreadyReleased' => true];
            }
            if ($status === 'SETTLED') {
                $pdo->commit();
                return ['ok' => true, 'alreadySettled' => true, 'code' => 'ALREADY_SETTLED'];
            }

            $sku = strtoupper((string)($row['sku'] ?? ''));
            $qty = (int)($row['quantity'] ?? 0);
            if ($expectedQty !== null) {
                $qty = min($qty, max(0, $expectedQty));
            }

            $upd = $pdo->prepare(
                "UPDATE {$items}
                 SET reserved = GREATEST(0, reserved - :q),
                     available = LEAST(total_physical, available + :q2),
                     updated_at = NOW()
                 WHERE sku = :sku
                 RETURNING sku, available, reserved, total_physical"
            );
            $upd->execute(['q' => $qty, 'q2' => $qty, 'sku' => $sku]);
            $inv = $upd->fetch();

            $pdo->prepare(
                "UPDATE {$ledger} SET status = 'RELEASED', release_reason = :r, updated_at = NOW()
                 WHERE order_id = :oid AND sku = :sku AND status = 'RESERVED'"
            )->execute(['r' => $reason, 'oid' => $orderId, 'sku' => $sku]);

            if ($inv) {
                $pdo->prepare(
                    "INSERT INTO {$audit} (sku, order_id, change_type, quantity, previous_available, new_available, created_at)
                     VALUES (:sku, :oid, 'RELEASE', :q, :prev, :new, NOW())"
                )->execute([
                    'sku' => $sku,
                    'oid' => $orderId,
                    'q' => $qty,
                    'prev' => (int)$inv['available'] - $qty,
                    'new' => (int)$inv['available'],
                ]);
            }

            $pdo->commit();
            return [
                'ok' => true,
                'alreadyReleased' => false,
                'quantity' => $qty,
                'sku' => $sku,
                'state' => $inv ? [
                    'available' => (int)$inv['available'],
                    'reserved' => (int)$inv['reserved'],
                    'totalPhysical' => (int)$inv['total_physical'],
                ] : null,
            ];
        } catch (Throwable $e) {
            if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            return orva_inventory_pg_unavailable('release', $e);
        }
    }

    /**
     * @return array{ok:bool,code?:string,alreadySettled?:bool,httpStatus?:int}
     */
    function orva_inventory_pg_settle(string $orderId): array
    {
        $orderId = trim($orderId);
        if ($orderId === '') {
            return ['ok' => false, 'code' => 'MISSING_ORDER_ID'];
        }

        try {
            $pdo = orva_pg_pdo();
            $items = orva_pg_table('inventory_items');
            $ledger = orva_pg_table('inventory_reservations');
            $audit = orva_pg_table('inventory_audit');

            $pdo->beginTransaction();
            $stmt = $pdo->prepare("SELECT * FROM {$ledger} WHERE order_id = :oid FOR UPDATE");
            $stmt->execute(['oid' => $orderId]);
            $row = $stmt->fetch();
            if (!$row) {
                $pdo->commit();
                return ['ok' => true, 'code' => 'NO_RESERVATION', 'alreadySettled' => true];
            }
            $status = strtoupper((string)($row['status'] ?? ''));
            if ($status === 'SETTLED') {
                $pdo->commit();
                return ['ok' => true, 'alreadySettled' => true];
            }
            if ($status === 'RELEASED') {
                $pdo->commit();
                return ['ok' => false, 'code' => 'ALREADY_RELEASED'];
            }

            $sku = strtoupper((string)($row['sku'] ?? ''));
            $qty = (int)($row['quantity'] ?? 0);

            $upd = $pdo->prepare(
                "UPDATE {$items}
                 SET reserved = GREATEST(0, reserved - :q),
                     total_physical = GREATEST(0, total_physical - :q2),
                     updated_at = NOW()
                 WHERE sku = :sku
                 RETURNING sku, available, reserved, total_physical"
            );
            $upd->execute(['q' => $qty, 'q2' => $qty, 'sku' => $sku]);
            $inv = $upd->fetch();

            $pdo->prepare(
                "UPDATE {$ledger} SET status = 'SETTLED', updated_at = NOW()
                 WHERE order_id = :oid AND sku = :sku AND status = 'RESERVED'"
            )->execute(['oid' => $orderId, 'sku' => $sku]);

            if ($inv) {
                $pdo->prepare(
                    "INSERT INTO {$audit} (sku, order_id, change_type, quantity, previous_available, new_available, created_at)
                     VALUES (:sku, :oid, 'SETTLE', :q, :prev, :new, NOW())"
                )->execute([
                    'sku' => $sku,
                    'oid' => $orderId,
                    'q' => $qty,
                    'prev' => (int)$inv['available'],
                    'new' => (int)$inv['available'],
                ]);
            }

            $pdo->commit();
            return [
                'ok' => true,
                'alreadySettled' => false,
                'quantity' => $qty,
                'sku' => $sku,
            ];
        } catch (Throwable $e) {
            if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            return orva_inventory_pg_unavailable('settle', $e);
        }
    }

    function orva_inventory_pg_has_active(string $orderId): bool
    {
        $orderId = trim($orderId);
        if ($orderId === '') {
            return false;
        }
        try {
            $pdo = orva_pg_pdo();
            $ledger = orva_pg_table('inventory_reservations');
            $stmt = $pdo->prepare(
                "SELECT 1 FROM {$ledger} WHERE order_id = :oid AND status IN ('RESERVED','SETTLED') LIMIT 1"
            );
            $stmt->execute(['oid' => $orderId]);
            return (bool)$stmt->fetchColumn();
        } catch (Throwable $e) {
            throw new RuntimeException('INVENTORY_UNAVAILABLE', 0, $e);
        }
    }
}
