<?php
// ==============================================================================
// ORVA STORE — PHP Inventory Store (Hostinger LiteSpeed)
// Atomic reserve / release / settle with orderId idempotency.
// Fail-closed: missing SKU never invents stock.
// ==============================================================================

if (!defined('ORVA_API') && php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('Direct access not permitted.');
}

if (!function_exists('orva_inventory_paths')) {
    function orva_inventory_paths(): array
    {
        $root = dirname(__DIR__);
        return [
            'root' => $root,
            'file' => $root . '/data/inventory-state.json',
            'lock' => $root . '/data/locks/inventory.lock',
            'locksDir' => $root . '/data/locks',
            'audit' => $root . '/data/inventory-audit.json',
        ];
    }

    function orva_inventory_ensure_lock_dir(): void
    {
        $paths = orva_inventory_paths();
        if (!is_dir($paths['locksDir'])) {
            @mkdir($paths['locksDir'], 0755, true);
        }
    }

    /**
     * @return resource|false
     */
    function orva_inventory_acquire_lock()
    {
        orva_inventory_ensure_lock_dir();
        $paths = orva_inventory_paths();
        $fp = fopen($paths['lock'], 'c+');
        if ($fp) {
            flock($fp, LOCK_EX);
        }
        return $fp;
    }

    /**
     * @param resource|false $fp
     */
    function orva_inventory_release_lock($fp): void
    {
        if ($fp) {
            flock($fp, LOCK_UN);
            fclose($fp);
        }
    }

    function orva_inventory_load_state(): array
    {
        $paths = orva_inventory_paths();
        if (!file_exists($paths['file'])) {
            return [
                'version' => 2,
                'lastUpdated' => gmdate('c'),
                'inventory' => [],
                'reservations' => [],
            ];
        }
        $raw = @file_get_contents($paths['file']);
        // Strip UTF-8 BOM (common from Windows editors / PowerShell) so json_decode succeeds.
        if (is_string($raw) && strncmp($raw, "\xEF\xBB\xBF", 3) === 0) {
            $raw = substr($raw, 3);
        }
        $data = json_decode($raw ?: '[]', true);
        if (!is_array($data)) {
            $data = [];
        }
        if (!isset($data['inventory']) || !is_array($data['inventory'])) {
            $data['inventory'] = [];
        }
        if (!isset($data['reservations']) || !is_array($data['reservations'])) {
            $data['reservations'] = [];
        }
        return $data;
    }

    function orva_inventory_save_state(array $state): bool
    {
        $paths = orva_inventory_paths();
        $state['lastUpdated'] = gmdate('c');
        $dir = dirname($paths['file']);
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        $tmp = $paths['file'] . '.' . getmypid() . '.' . bin2hex(random_bytes(4)) . '.tmp';
        $json = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        if ($json === false) {
            return false;
        }
        if (@file_put_contents($tmp, $json, LOCK_EX) === false) {
            @unlink($tmp);
            return false;
        }
        if (!@rename($tmp, $paths['file'])) {
            if (!@copy($tmp, $paths['file'])) {
                @unlink($tmp);
                return false;
            }
            @unlink($tmp);
        }
        return true;
    }

    function orva_inventory_append_audit(array $entry): void
    {
        $paths = orva_inventory_paths();
        $audit = [];
        if (file_exists($paths['audit'])) {
            $decoded = json_decode((string)@file_get_contents($paths['audit']), true);
            if (is_array($decoded)) {
                $audit = $decoded;
            }
        }
        $audit[] = array_merge([
            'id' => 'adj_' . time() . '_' . bin2hex(random_bytes(3)),
            'timestamp' => gmdate('c'),
        ], $entry);
        // Keep audit from growing without bound in PHP path
        if (count($audit) > 5000) {
            $audit = array_slice($audit, -4000);
        }
        @file_put_contents(
            $paths['audit'],
            json_encode($audit, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE),
            LOCK_EX
        );
    }

    /**
     * @return array{ok:bool,code?:string,message?:string,created?:bool,alreadyReserved?:bool,state?:array}
     */
    function orva_inventory_reserve(string $sku, int $quantity, string $orderId): array
    {
        $sku = strtoupper(trim($sku));
        $orderId = trim($orderId);
        if ($sku === '' || $orderId === '' || $quantity < 1) {
            return ['ok' => false, 'code' => 'INVALID_RESERVATION', 'message' => 'Invalid reservation request.'];
        }

        $fp = orva_inventory_acquire_lock();
        try {
            $state = orva_inventory_load_state();

            if (isset($state['reservations'][$orderId])) {
                $existing = $state['reservations'][$orderId];
                $status = strtoupper((string)($existing['status'] ?? ''));
                if ($status === 'RESERVED' || $status === 'SETTLED') {
                    return [
                        'ok' => true,
                        'created' => false,
                        'alreadyReserved' => true,
                        'code' => 'ORDER_ID_ALREADY_RESERVED',
                        'message' => 'Order identifier already has an active reservation.',
                        'state' => $state['inventory'][$sku] ?? null,
                    ];
                }
            }

            if (!isset($state['inventory'][$sku])) {
                return [
                    'ok' => false,
                    'code' => 'INVENTORY_SKU_MISSING',
                    'message' => 'المخزون غير مهيأ لهذا المنتج. يرجى المحاولة لاحقاً.',
                ];
            }

            $item = &$state['inventory'][$sku];
            $available = (int)($item['available'] ?? 0);
            if ($available < $quantity) {
                return [
                    'ok' => false,
                    'code' => 'INSUFFICIENT_STOCK',
                    'message' => 'عذراً، الكمية المطلوبة غير متوفرة حالياً في المخزون.',
                ];
            }

            $availableBefore = $available;
            $reservedBefore = (int)($item['reserved'] ?? 0);
            $item['available'] = $available - $quantity;
            $item['reserved'] = $reservedBefore + $quantity;

            if ((int)$item['totalPhysical'] !== (int)$item['available'] + (int)$item['reserved']) {
                return [
                    'ok' => false,
                    'code' => 'INVENTORY_INVARIANT_VIOLATION',
                    'message' => 'Inventory invariant failed.',
                ];
            }

            $state['reservations'][$orderId] = [
                'sku' => $sku,
                'quantity' => $quantity,
                'status' => 'RESERVED',
                'timestamp' => gmdate('c'),
            ];

            if (!orva_inventory_save_state($state)) {
                return [
                    'ok' => false,
                    'code' => 'INVENTORY_WRITE_FAILED',
                    'message' => 'تعذر تحديث المخزون.',
                ];
            }

            orva_inventory_append_audit([
                'sku' => $sku,
                'orderId' => $orderId,
                'action' => 'RESERVE',
                'quantity' => $quantity,
                'availableBefore' => $availableBefore,
                'availableAfter' => $item['available'],
                'reservedBefore' => $reservedBefore,
                'reservedAfter' => $item['reserved'],
                'totalPhysical' => $item['totalPhysical'],
            ]);

            return [
                'ok' => true,
                'created' => true,
                'alreadyReserved' => false,
                'state' => $item,
            ];
        } finally {
            orva_inventory_release_lock($fp);
        }
    }

    /**
     * Release reserved stock back to available (cancel / failed create).
     * Idempotent by orderId.
     *
     * @return array{ok:bool,code?:string,alreadyReleased?:bool,alreadySettled?:bool}
     */
    function orva_inventory_release(string $orderId, string $reason = 'ORDER_CANCELLED', ?int $expectedQty = null): array
    {
        $orderId = trim($orderId);
        if ($orderId === '') {
            return ['ok' => false, 'code' => 'MISSING_ORDER_ID'];
        }

        $fp = orva_inventory_acquire_lock();
        try {
            $state = orva_inventory_load_state();
            if (!isset($state['reservations'][$orderId])) {
                return ['ok' => true, 'code' => 'NO_RESERVATION', 'alreadyReleased' => true];
            }

            $res = &$state['reservations'][$orderId];
            $status = strtoupper((string)($res['status'] ?? ''));
            if ($status === 'RELEASED') {
                return ['ok' => true, 'alreadyReleased' => true];
            }
            if ($status === 'SETTLED') {
                return ['ok' => true, 'alreadySettled' => true, 'code' => 'ALREADY_SETTLED'];
            }

            $sku = strtoupper((string)($res['sku'] ?? ''));
            $qty = (int)($res['quantity'] ?? 0);
            if ($expectedQty !== null) {
                $qty = min($qty, max(0, $expectedQty));
            }
            if ($sku === '' || $qty < 1 || !isset($state['inventory'][$sku])) {
                $res['status'] = 'RELEASED';
                $res['releasedAt'] = gmdate('c');
                $res['releaseReason'] = $reason;
                orva_inventory_save_state($state);
                return ['ok' => false, 'code' => 'RESERVATION_SKU_MISSING'];
            }

            $item = &$state['inventory'][$sku];
            $availableBefore = (int)$item['available'];
            $reservedBefore = (int)$item['reserved'];
            $actual = min($reservedBefore, $qty);
            $item['reserved'] = $reservedBefore - $actual;
            $item['available'] = min((int)$item['totalPhysical'], $availableBefore + $actual);

            $res['status'] = 'RELEASED';
            $res['releasedAt'] = gmdate('c');
            $res['releaseReason'] = $reason;

            if ((int)$item['totalPhysical'] !== (int)$item['available'] + (int)$item['reserved']) {
                return ['ok' => false, 'code' => 'INVENTORY_INVARIANT_VIOLATION'];
            }

            orva_inventory_save_state($state);
            orva_inventory_append_audit([
                'sku' => $sku,
                'orderId' => $orderId,
                'action' => 'RELEASE',
                'reason' => $reason,
                'quantity' => $actual,
                'availableBefore' => $availableBefore,
                'availableAfter' => $item['available'],
                'reservedBefore' => $reservedBefore,
                'reservedAfter' => $item['reserved'],
                'totalPhysical' => $item['totalPhysical'],
            ]);

            return ['ok' => true, 'alreadyReleased' => false, 'quantity' => $actual, 'sku' => $sku];
        } finally {
            orva_inventory_release_lock($fp);
        }
    }

    /**
     * Courier handoff: reserved decreases and totalPhysical decreases once.
     * Idempotent by orderId.
     *
     * @return array{ok:bool,code?:string,alreadySettled?:bool}
     */
    function orva_inventory_settle(string $orderId): array
    {
        $orderId = trim($orderId);
        if ($orderId === '') {
            return ['ok' => false, 'code' => 'MISSING_ORDER_ID'];
        }

        $fp = orva_inventory_acquire_lock();
        try {
            $state = orva_inventory_load_state();
            if (!isset($state['reservations'][$orderId])) {
                return ['ok' => true, 'code' => 'NO_RESERVATION', 'alreadySettled' => true];
            }

            $res = &$state['reservations'][$orderId];
            $status = strtoupper((string)($res['status'] ?? ''));
            if ($status === 'SETTLED') {
                return ['ok' => true, 'alreadySettled' => true];
            }
            if ($status === 'RELEASED') {
                return ['ok' => false, 'code' => 'ALREADY_RELEASED'];
            }

            $sku = strtoupper((string)($res['sku'] ?? ''));
            $qty = (int)($res['quantity'] ?? 0);
            if ($sku === '' || $qty < 1 || !isset($state['inventory'][$sku])) {
                return ['ok' => false, 'code' => 'RESERVATION_SKU_MISSING'];
            }

            $item = &$state['inventory'][$sku];
            $availableBefore = (int)$item['available'];
            $reservedBefore = (int)$item['reserved'];
            $actual = min($reservedBefore, $qty);
            $item['reserved'] = $reservedBefore - $actual;
            $item['totalPhysical'] = max(0, (int)$item['totalPhysical'] - $actual);

            if ((int)$item['totalPhysical'] !== (int)$item['available'] + (int)$item['reserved']) {
                return ['ok' => false, 'code' => 'INVENTORY_INVARIANT_VIOLATION'];
            }

            $res['status'] = 'SETTLED';
            $res['settledAt'] = gmdate('c');

            orva_inventory_save_state($state);
            orva_inventory_append_audit([
                'sku' => $sku,
                'orderId' => $orderId,
                'action' => 'SETTLE',
                'quantity' => $actual,
                'availableBefore' => $availableBefore,
                'availableAfter' => $item['available'],
                'reservedBefore' => $reservedBefore,
                'reservedAfter' => $item['reserved'],
                'totalPhysical' => $item['totalPhysical'],
            ]);

            return ['ok' => true, 'alreadySettled' => false, 'quantity' => $actual, 'sku' => $sku];
        } finally {
            orva_inventory_release_lock($fp);
        }
    }

    function orva_inventory_has_active_reservation(string $orderId): bool
    {
        $orderId = trim($orderId);
        if ($orderId === '') {
            return false;
        }
        $state = orva_inventory_load_state();
        if (!isset($state['reservations'][$orderId])) {
            return false;
        }
        $status = strtoupper((string)($state['reservations'][$orderId]['status'] ?? ''));
        return $status === 'RESERVED' || $status === 'SETTLED';
    }
}
