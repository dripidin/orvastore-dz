<?php
/**
 * ORVA STORE — Staging-only PostgreSQL repository (PDO / local mock).
 *
 * Security model (hosted, when enabled later — NOT executed here):
 * - Connect as staging_login (LOGIN, restricted)
 * - SET ROLE staging_user (NOLOGIN, NOBYPASSRLS)
 * - All SQL uses fully qualified staging.* objects
 * - No service_role, no JWT minting, no Production schema access
 *
 * Local default: mock fixture store. Never connects to hosted Supabase unless
 * STAGING_PDO_ALLOW_LIVE=true is explicitly set (forbidden for this task).
 */

if (!defined('ORVA_API') && php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('Direct access not permitted.');
}

final class OrvaStagingDb
{
    public const SCHEMA = 'staging';
    public const LOGIN_ROLE = 'staging_login';
    public const APP_ROLE = 'staging_user';

    private string $mode; // mock|pdo
    private array $cfg;
    private ?PDO $pdo = null;
    private string $fixturePath;
    private array $lastDiagnostics = [];

    public function __construct(array $runtimeConfig)
    {
        $this->cfg = $runtimeConfig;
        $pdoCfg = $runtimeConfig['staging_pdo'] ?? [];
        $requested = strtolower(trim((string)($pdoCfg['mode'] ?? 'auto')));
        $this->fixturePath = (string)($pdoCfg['fixture_path'] ?? (dirname(__DIR__) . '/data/local-fixtures/orders-store.json'));

        $driverOk = extension_loaded('pdo_pgsql') && in_array('pgsql', PDO::getAvailableDrivers(), true);
        $allowLive = $this->truthy($pdoCfg['allow_live'] ?? false);

        if ($requested === 'mock' || (!$driverOk && $requested !== 'pdo')) {
            $this->mode = 'mock';
        } elseif ($requested === 'pdo' || $requested === 'auto') {
            if (!$driverOk) {
                $this->mode = 'mock';
            } elseif (!$allowLive && $this->looksLikeHostedDsn((string)($pdoCfg['dsn'] ?? ''))) {
                // Refuse accidental hosted connections during local work.
                $this->mode = 'mock';
                $this->lastDiagnostics['refused_hosted_dsn'] = true;
            } else {
                $this->mode = 'pdo';
            }
        } else {
            $this->mode = 'mock';
        }

        $this->lastDiagnostics = array_merge($this->lastDiagnostics, [
            'mode' => $this->mode,
            'requested_mode' => $requested,
            'pdo_pgsql' => $driverOk,
            'schema' => self::SCHEMA,
            'login_role' => self::LOGIN_ROLE,
            'app_role' => self::APP_ROLE,
            'emulate_prepares' => false,
            'persistent' => false,
        ]);
    }

    public function getMode(): string
    {
        return $this->mode;
    }

    public function diagnostics(): array
    {
        $safe = $this->lastDiagnostics;
        $safe['fixture_exists'] = is_file($this->fixturePath);
        $safe['connected'] = $this->pdo instanceof PDO;
        // Never include DSN, password, or tokens.
        return $safe;
    }

    public function connect(): void
    {
        if ($this->mode === 'mock') {
            $this->ensureFixture();
            return;
        }

        if ($this->pdo instanceof PDO) {
            return;
        }

        $pdoCfg = $this->cfg['staging_pdo'] ?? [];
        $dsn = trim((string)($pdoCfg['dsn'] ?? ''));
        $user = trim((string)($pdoCfg['user'] ?? ''));
        $pass = (string)($pdoCfg['password'] ?? '');
        $timeout = (int)($pdoCfg['connect_timeout'] ?? 5);
        if ($timeout < 1) {
            $timeout = 5;
        }

        if ($dsn === '' || $user === '') {
            throw new RuntimeException('STAGING_PDO_CONFIG_MISSING');
        }

        if (!$this->truthy($pdoCfg['allow_live'] ?? false) && $this->looksLikeHostedDsn($dsn)) {
            throw new RuntimeException('STAGING_PDO_HOSTED_BLOCKED');
        }

        $options = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_PERSISTENT => false,
            PDO::ATTR_TIMEOUT => $timeout,
        ];

        $this->pdo = new PDO($dsn, $user, $pass, $options);

        // Session bootstrap: search_path + SET ROLE to NOLOGIN app role.
        $this->pdo->exec('SET search_path TO staging, pg_temp');
        $stmt = $this->pdo->prepare('SET ROLE ' . self::APP_ROLE);
        // ROLE identifier cannot be bound; constant only.
        $stmt->execute();

        $check = $this->pdo->query("SELECT current_user AS cu, current_setting('search_path') AS sp")->fetch();
        $this->lastDiagnostics['session_user'] = $check['cu'] ?? null;
        $this->lastDiagnostics['search_path'] = $check['sp'] ?? null;
        $this->lastDiagnostics['connected'] = true;
    }

    public function beginTransaction(): void
    {
        $this->connect();
        if ($this->mode === 'pdo') {
            $this->pdo->beginTransaction();
        }
    }

    public function commit(): void
    {
        if ($this->mode === 'pdo' && $this->pdo && $this->pdo->inTransaction()) {
            $this->pdo->commit();
        }
    }

    public function rollBack(): void
    {
        if ($this->mode === 'pdo' && $this->pdo && $this->pdo->inTransaction()) {
            $this->pdo->rollBack();
        }
    }

    /**
     * @param array<string,mixed> $order
     * @return array{code:int,data:mixed,raw:string,backend:string}
     */
    public function insertOrder(array $order): array
    {
        $this->connect();
        $row = $this->normalizeOrderRow($order);

        if ($this->mode === 'mock') {
            $store = $this->readFixture();
            foreach ($store['orders'] as $existing) {
                if (($existing['order_id'] ?? '') === $row['order_id']) {
                    return $this->resp(409, ['error' => 'DUPLICATE_ORDER_ID'], 'mock');
                }
            }
            $store['orders'][] = $row;
            $this->writeFixture($store);
            return $this->resp(201, [$row], 'mock');
        }

        $sql = 'INSERT INTO staging.orders (
            order_id, store_id, full_name, phone, wilaya, commune,
            delivery_type, delivery_time, quantity, product_name, product_total,
            shipping_fee, price_num, grand_total, status, in_redex, redex_tracking_code,
            client_ip_hash, device_id, risk_score, risk_level, risk_decision, risk_reasons
        ) VALUES (
            :order_id, :store_id, :full_name, :phone, :wilaya, :commune,
            :delivery_type, :delivery_time, :quantity, :product_name, :product_total,
            :shipping_fee, :price_num, :grand_total, :status, :in_redex, :redex_tracking_code,
            :client_ip_hash, :device_id, :risk_score, :risk_level, :risk_decision, :risk_reasons
        ) RETURNING *';

        $stmt = $this->pdo->prepare($sql);
        $stmt->bindValue(':order_id', $row['order_id'], PDO::PARAM_STR);
        $stmt->bindValue(':store_id', $row['store_id'], PDO::PARAM_STR);
        $stmt->bindValue(':full_name', $row['full_name'], PDO::PARAM_STR);
        $stmt->bindValue(':phone', $row['phone'], PDO::PARAM_STR);
        $stmt->bindValue(':wilaya', $row['wilaya'], PDO::PARAM_STR);
        $stmt->bindValue(':commune', $row['commune'], PDO::PARAM_STR);
        $stmt->bindValue(':delivery_type', $row['delivery_type'], PDO::PARAM_STR);
        $stmt->bindValue(':delivery_time', $row['delivery_time'], PDO::PARAM_STR);
        $stmt->bindValue(':quantity', (int)$row['quantity'], PDO::PARAM_INT);
        $stmt->bindValue(':product_name', $row['product_name'], PDO::PARAM_STR);
        $stmt->bindValue(':product_total', $row['product_total'], PDO::PARAM_STR);
        $stmt->bindValue(':shipping_fee', $row['shipping_fee'], PDO::PARAM_STR);
        $stmt->bindValue(':price_num', $row['price_num']);
        $stmt->bindValue(':grand_total', $row['grand_total'], PDO::PARAM_STR);
        $stmt->bindValue(':status', $row['status'], PDO::PARAM_STR);
        $stmt->bindValue(':in_redex', (bool)$row['in_redex'], PDO::PARAM_BOOL);
        $stmt->bindValue(':redex_tracking_code', $row['redex_tracking_code'], $row['redex_tracking_code'] === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $stmt->bindValue(':client_ip_hash', $row['client_ip_hash'], $row['client_ip_hash'] === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $stmt->bindValue(':device_id', $row['device_id'], $row['device_id'] === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $stmt->bindValue(':risk_score', (int)$row['risk_score'], PDO::PARAM_INT);
        $stmt->bindValue(':risk_level', $row['risk_level'], PDO::PARAM_STR);
        $stmt->bindValue(':risk_decision', $row['risk_decision'], PDO::PARAM_STR);
        $stmt->bindValue(':risk_reasons', $row['risk_reasons'], PDO::PARAM_STR);
        $stmt->execute();
        $inserted = $stmt->fetch() ?: $row;
        return $this->resp(201, [$inserted], 'pdo');
    }

    /**
     * @return array{code:int,data:mixed,raw:string,backend:string}
     */
    public function listOrders(int $limit = 500): array
    {
        $this->connect();
        $limit = max(1, min(500, $limit));

        if ($this->mode === 'mock') {
            $store = $this->readFixture();
            $rows = $store['orders'];
            usort($rows, static function ($a, $b) {
                return strcmp((string)($b['created_at'] ?? ''), (string)($a['created_at'] ?? ''));
            });
            return $this->resp(200, array_slice($rows, 0, $limit), 'mock');
        }

        $sql = 'SELECT * FROM staging.orders ORDER BY created_at DESC LIMIT :lim';
        $stmt = $this->pdo->prepare($sql);
        $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
        $stmt->execute();
        return $this->resp(200, $stmt->fetchAll(), 'pdo');
    }

    /**
     * @return array{code:int,data:mixed,raw:string,backend:string}
     */
    public function getOrderById(string $orderId): array
    {
        $this->connect();
        $orderId = trim($orderId);

        if ($this->mode === 'mock') {
            $store = $this->readFixture();
            foreach ($store['orders'] as $row) {
                if (($row['order_id'] ?? '') === $orderId) {
                    return $this->resp(200, [$row], 'mock');
                }
            }
            return $this->resp(200, [], 'mock');
        }

        $sql = 'SELECT * FROM staging.orders WHERE order_id = :order_id LIMIT 1';
        $stmt = $this->pdo->prepare($sql);
        $stmt->bindValue(':order_id', $orderId, PDO::PARAM_STR);
        $stmt->execute();
        $row = $stmt->fetch();
        return $this->resp(200, $row ? [$row] : [], 'pdo');
    }

    /**
     * @param array<string,mixed> $fields
     * @return array{code:int,data:mixed,raw:string,backend:string}
     */
    public function updateOrder(string $orderId, array $fields): array
    {
        $this->connect();
        $orderId = trim($orderId);
        $allowed = [
            'status', 'updated_at', 'in_redex', 'redex_tracking_code', 'remarks',
            'notes', 'full_name', 'phone', 'wilaya', 'commune', 'delivery_type',
            'delivery_time', 'quantity', 'product_name', 'product_total',
            'shipping_fee', 'price_num', 'grand_total',
            'risk_score', 'risk_level', 'risk_decision', 'risk_reasons'
        ];
        $set = [];
        $params = [':order_id' => $orderId];
        foreach ($fields as $key => $value) {
            if (!in_array($key, $allowed, true)) {
                continue;
            }
            // Refuse unqualified / cross-schema keys
            if (strpos($key, '.') !== false || strpos($key, ';') !== false) {
                throw new RuntimeException('STAGING_PDO_INVALID_COLUMN');
            }
            $bind = ':' . $key;
            $set[] = $key . ' = ' . $bind;
            $params[$bind] = $value;
        }
        if ($set === []) {
            return $this->getOrderById($orderId);
        }
        if (!isset($params[':updated_at'])) {
            $set[] = 'updated_at = :updated_at';
            $params[':updated_at'] = gmdate('c');
        }

        if ($this->mode === 'mock') {
            $store = $this->readFixture();
            $found = false;
            foreach ($store['orders'] as &$row) {
                if (($row['order_id'] ?? '') === $orderId) {
                    foreach ($fields as $k => $v) {
                        if (in_array($k, $allowed, true)) {
                            $row[$k] = $v;
                        }
                    }
                    $row['updated_at'] = $params[':updated_at'];
                    $found = true;
                    $updated = $row;
                    break;
                }
            }
            unset($row);
            if (!$found) {
                return $this->resp(404, [], 'mock');
            }
            $this->writeFixture($store);
            return $this->resp(200, [$updated], 'mock');
        }

        $sql = 'UPDATE staging.orders SET ' . implode(', ', $set) . ' WHERE order_id = :order_id RETURNING *';
        $stmt = $this->pdo->prepare($sql);
        foreach ($params as $bind => $value) {
            if (is_bool($value)) {
                $stmt->bindValue($bind, $value, PDO::PARAM_BOOL);
            } elseif (is_int($value)) {
                $stmt->bindValue($bind, $value, PDO::PARAM_INT);
            } elseif ($value === null) {
                $stmt->bindValue($bind, null, PDO::PARAM_NULL);
            } else {
                $stmt->bindValue($bind, $value);
            }
        }
        $stmt->execute();
        $updated = $stmt->fetch();
        return $this->resp(200, $updated ? [$updated] : [], 'pdo');
    }

    /**
     * @return array{code:int,data:mixed,raw:string,backend:string}
     */
    public function deleteOrder(string $orderId): array
    {
        $this->connect();
        $orderId = trim($orderId);

        if ($this->mode === 'mock') {
            $store = $this->readFixture();
            $before = count($store['orders']);
            $store['orders'] = array_values(array_filter(
                $store['orders'],
                static fn($r) => ($r['order_id'] ?? '') !== $orderId
            ));
            $this->writeFixture($store);
            $deleted = $before - count($store['orders']);
            return $this->resp(200, ['deleted' => $deleted], 'mock');
        }

        $sql = 'DELETE FROM staging.orders WHERE order_id = :order_id';
        $stmt = $this->pdo->prepare($sql);
        $stmt->bindValue(':order_id', $orderId, PDO::PARAM_STR);
        $stmt->execute();
        return $this->resp(200, ['deleted' => $stmt->rowCount()], 'pdo');
    }

    /**
     * @param array<string,mixed> $payload
     * @return array{code:int,data:mixed,raw:string,backend:string}
     */
    public function insertAuditLog(array $payload): array
    {
        $this->connect();
        $row = [
            'idempotency_key' => $payload['idempotency_key'] ?? null,
            'action' => (string)($payload['action'] ?? 'unknown'),
            'entity_type' => (string)($payload['entity_type'] ?? 'order'),
            'entity_id' => (string)($payload['entity_id'] ?? ''),
            'actor' => $payload['actor'] ?? 'system',
            'payload' => $payload['payload'] ?? new stdClass(),
            'request_hash' => $payload['request_hash'] ?? null,
            'created_at' => gmdate('c'),
        ];

        if ($this->mode === 'mock') {
            $store = $this->readFixture();
            $store['audit_logs'][] = $row;
            $this->writeFixture($store);
            return $this->resp(201, [$row], 'mock');
        }

        $sql = 'INSERT INTO staging.audit_logs (
            idempotency_key, action, entity_type, entity_id, actor, payload, request_hash
        ) VALUES (
            :idempotency_key, :action, :entity_type, :entity_id, :actor, CAST(:payload AS jsonb), :request_hash
        ) RETURNING *';
        $stmt = $this->pdo->prepare($sql);
        $stmt->bindValue(':idempotency_key', $row['idempotency_key'], $row['idempotency_key'] === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $stmt->bindValue(':action', $row['action'], PDO::PARAM_STR);
        $stmt->bindValue(':entity_type', $row['entity_type'], PDO::PARAM_STR);
        $stmt->bindValue(':entity_id', $row['entity_id'], PDO::PARAM_STR);
        $stmt->bindValue(':actor', $row['actor'], PDO::PARAM_STR);
        $stmt->bindValue(':payload', json_encode($row['payload'], JSON_UNESCAPED_UNICODE), PDO::PARAM_STR);
        $stmt->bindValue(':request_hash', $row['request_hash'], $row['request_hash'] === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $stmt->execute();
        return $this->resp(201, [$stmt->fetch() ?: $row], 'pdo');
    }

    /**
     * Map a PostgREST-style URL used by existing PHP endpoints onto repository methods.
     *
     * @return array{code:int,data:mixed,raw:string,backend:string}|null null if URL is not handled
     */
    public function handleRestShim(string $method, string $url, $data = null): ?array
    {
        $method = strtoupper($method);
        $parts = parse_url($url);
        $path = $parts['path'] ?? '';
        $query = [];
        if (!empty($parts['query'])) {
            parse_str($parts['query'], $query);
        }

        if (preg_match('#/rest/v1/orders/?$#', $path) || preg_match('#/orders/?$#', $path)) {
            if ($method === 'POST') {
                return $this->insertOrder(is_array($data) ? $data : []);
            }
            if ($method === 'GET') {
                if (!empty($query['order_id']) && preg_match('/^eq\.(.+)$/', (string)$query['order_id'], $m)) {
                    return $this->getOrderById(rawurldecode($m[1]));
                }
                $limit = 500;
                if (!empty($query['limit']) && is_numeric($query['limit'])) {
                    $limit = (int)$query['limit'];
                }
                return $this->listOrders($limit);
            }
            if ($method === 'PATCH' && !empty($query['order_id']) && preg_match('/^eq\.(.+)$/', (string)$query['order_id'], $m)) {
                return $this->updateOrder(rawurldecode($m[1]), is_array($data) ? $data : []);
            }
            if ($method === 'DELETE' && !empty($query['order_id']) && preg_match('/^eq\.(.+)$/', (string)$query['order_id'], $m)) {
                return $this->deleteOrder(rawurldecode($m[1]));
            }
        }

        if (preg_match('#/rest/v1/audit_logs/?$#', $path) || preg_match('#/audit_logs/?$#', $path)) {
            if ($method === 'POST') {
                return $this->insertAuditLog(is_array($data) ? $data : []);
            }
        }

        return null;
    }

    /** Assert SQL fragments always target staging.* (unit-test helper). */
    public static function assertStagingQualified(string $sql): bool
    {
        if (!preg_match('/\bstaging\.(orders|audit_logs|order_items)\b/i', $sql)) {
            return false;
        }
        if (preg_match('/\bpublic\.(orders|audit_logs)\b/i', $sql)) {
            return false;
        }
        return true;
    }

    private function normalizeOrderRow(array $order): array
    {
        $now = gmdate('c');
        return [
            'id' => $order['id'] ?? self::uuidV4(),
            'order_id' => (string)($order['order_id'] ?? ''),
            'store_id' => (string)($order['store_id'] ?? 'orvastore'),
            'full_name' => (string)($order['full_name'] ?? ''),
            'phone' => (string)($order['phone'] ?? ''),
            'wilaya' => (string)($order['wilaya'] ?? ''),
            'commune' => (string)($order['commune'] ?? ''),
            'delivery_type' => (string)($order['delivery_type'] ?? ''),
            'delivery_time' => (string)($order['delivery_time'] ?? ''),
            'quantity' => (int)($order['quantity'] ?? 1),
            'product_name' => (string)($order['product_name'] ?? ''),
            'product_total' => (string)($order['product_total'] ?? ''),
            'shipping_fee' => (string)($order['shipping_fee'] ?? ''),
            'price_num' => $order['price_num'] ?? 0,
            'grand_total' => (string)($order['grand_total'] ?? ''),
            'status' => (string)($order['status'] ?? 'pending'),
            'in_redex' => (bool)($order['in_redex'] ?? false),
            'redex_tracking_code' => $order['redex_tracking_code'] ?? null,
            'remarks' => $order['remarks'] ?? [],
            'client_ip' => $order['client_ip'] ?? null,
            'client_ip_hash' => $order['client_ip_hash'] ?? null,
            'device_id' => $order['device_id'] ?? null,
            'risk_score' => (int)($order['risk_score'] ?? 0),
            'risk_level' => (string)($order['risk_level'] ?? 'LOW'),
            'risk_decision' => (string)($order['risk_decision'] ?? 'ALLOW'),
            'risk_reasons' => (string)($order['risk_reasons'] ?? ''),
            'created_at' => (string)($order['created_at'] ?? $now),
            'updated_at' => (string)($order['updated_at'] ?? $now),
        ];
    }

    private function ensureFixture(): void
    {
        $dir = dirname($this->fixturePath);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        if (!is_file($this->fixturePath)) {
            $seed = dirname(__DIR__) . '/data/local-fixtures/orders-store.example.json';
            if (is_file($seed)) {
                copy($seed, $this->fixturePath);
            } else {
                $this->writeFixture(['orders' => [], 'audit_logs' => []]);
            }
        }
    }

    private function readFixture(): array
    {
        $this->ensureFixture();
        $raw = file_get_contents($this->fixturePath);
        $data = json_decode((string)$raw, true);
        if (!is_array($data)) {
            $data = ['orders' => [], 'audit_logs' => []];
        }
        $data['orders'] = isset($data['orders']) && is_array($data['orders']) ? $data['orders'] : [];
        $data['audit_logs'] = isset($data['audit_logs']) && is_array($data['audit_logs']) ? $data['audit_logs'] : [];
        return $data;
    }

    private function writeFixture(array $data): void
    {
        $this->ensureFixture();
        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        file_put_contents($this->fixturePath, $json . "\n", LOCK_EX);
    }

    private function resp(int $code, $data, string $backend): array
    {
        return [
            'code' => $code,
            'data' => $data,
            'raw' => json_encode($data),
            'backend' => $backend,
            'headers_sent' => ['X-Orva-Orders-Backend: ' . $backend],
        ];
    }

    private function truthy($value): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        $v = strtolower(trim((string)$value));
        return in_array($v, ['1', 'true', 'yes', 'on'], true);
    }

    private function looksLikeHostedDsn(string $dsn): bool
    {
        $d = strtolower($dsn);
        return str_contains($d, 'supabase.co')
            || str_contains($d, 'pooler.supabase.com')
            || str_contains($d, 'olmsjkhdfghyydogcvvy');
    }

    private static function uuidV4(): string
    {
        $data = random_bytes(16);
        $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
        $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }
}

if (!function_exists('orva_staging_pdo_enabled')) {
    function orva_staging_pdo_enabled(array $config): bool
    {
        $flag = $config['staging_pdo']['enabled'] ?? false;
        $enabled = false;
        if (is_bool($flag)) {
            $enabled = $flag;
        } else {
            $v = strtolower(trim((string)$flag));
            $enabled = in_array($v, ['1', 'true', 'yes', 'on'], true);
        }
        if (!$enabled) {
            return false;
        }
        // Production must never activate PDO path unless APP_ENV is staging/local/development.
        $env = strtolower(trim((string)($config['app_env'] ?? 'production')));
        return in_array($env, ['staging', 'local', 'development', 'dev'], true);
    }
}

if (!function_exists('orva_staging_db')) {
    function orva_staging_db(array $config): OrvaStagingDb
    {
        static $instance = null;
        static $key = null;
        $fingerprint = ($config['app_env'] ?? '') . '|' . json_encode($config['staging_pdo'] ?? []);
        if ($instance === null || $key !== $fingerprint) {
            $instance = new OrvaStagingDb($config);
            $key = $fingerprint;
        }
        return $instance;
    }
}

if (!function_exists('orva_orders_storage_request')) {
    /**
     * Staging PDO (or mock) when enabled; otherwise PostgREST via orva_supabase_rest_request.
     */
    function orva_orders_storage_request(
        string $method,
        string $url,
        $data = null,
        array $runtimeConfig = [],
        string $adminToken = '',
        array $extraHeaders = []
    ): array {
        if (orva_staging_pdo_enabled($runtimeConfig)) {
            $db = orva_staging_db($runtimeConfig);
            $handled = $db->handleRestShim($method, $url, $data);
            if ($handled !== null) {
                return $handled;
            }
            throw new RuntimeException('STAGING_PDO_UNHANDLED_URL');
        }
        return orva_supabase_rest_request($method, $url, $data, $runtimeConfig, $adminToken, $extraHeaders);
    }
}
