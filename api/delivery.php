<?php
// ==============================================================================
// ORVA STORE — Admin Delivery & Orders Gateway (/api/delivery)
// Queries Supabase REST API directly for Hostinger LiteSpeed + PHP 8.3
// Phase 5D: Hardened — no fallback secrets, no ?token= query auth, restricted CORS
// ==============================================================================

define('ORVA_API', true);
$config = require __DIR__ . '/config.php';

// CORS: restricted to known origins, no wildcard for credentialed endpoints
$allowedOrigins = [
    'https://orva-store.com',
    'https://www.orva-store.com',
    'https://staging.orva-store.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:8080',
];
$requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($requestOrigin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Credentials: true');
    header("Access-Control-Allow-Origin: {$requestOrigin}");
    header('Vary: Origin');
}
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, Sec-Fetch-Site');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$rawInput = file_get_contents('php://input');
$body = json_decode($rawInput, true) ?? [];
$action = $_GET['action'] ?? ($body['action'] ?? '');
$supabaseUrl = rtrim($config['supabase']['url'], '/');
$supabaseKey = $config['supabase']['anon_key'];

// Load admin token from environment — NO hardcoded fallback
$adminToken = '';
$envToken = getenv('ADMIN_API_TOKEN');
if ($envToken === false) $envToken = $_ENV['ADMIN_API_TOKEN'] ?? '';
$adminToken = trim((string) $envToken);
if ($adminToken === '') $adminToken = trim((string) ($config['admin']['token'] ?? ''));
if ($adminToken === '') {
    http_response_code(503);
    error_log('[ORVA Delivery] CRITICAL: ADMIN_API_TOKEN is not configured.');
    echo json_encode(['success' => false, 'error' => 'SERVER_MISCONFIGURED']);
    exit;
}

// ── Auth Verification Helper (Returns auth type: 'bearer', 'cookie', or '') ──
function getAdminAuthType(string $expectedToken): string {
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (empty($authHeader) && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    }

    if (preg_match('/Bearer\s+(\S+)/i', $authHeader, $matches)) {
        if (hash_equals($expectedToken, $matches[1])) {
            return 'bearer';
        }
    }

    // Session cookie (HttpOnly, set by /api/auth)
    $cookieVal = (string) ($_COOKIE['orva_admin_session'] ?? '');
    if ($cookieVal !== '' && hash_equals($expectedToken, $cookieVal)) {
        return 'cookie';
    }

    return '';
}

// ── Helper: Supabase REST Request ────────────────────────────────────────────
function supabaseRequest(string $method, string $url, $data = null, string $supabaseKey = '', string $adminToken = '') {
    global $config;
    return orva_supabase_rest_request($method, $url, $data, $config, $adminToken, ['Prefer: return=representation']);
}

// ── 1. Login / Auth Actions — Delegated to /api/auth ─────────────────────────
// Login is handled exclusively by api/auth.php. Delivery gateway only accepts
// already-authenticated requests (valid session cookie or Bearer token).
if ($action === 'login' || $action === 'auth') {
    http_response_code(405);
    echo json_encode([
        'success' => false,
        'error'   => 'USE_AUTH_ENDPOINT',
        'message' => 'Login must be performed via POST /api/auth'
    ]);
    exit;
}

// ── State-Changing Actions Definition & Method Enforcement ──────────────────
$stateChangingActions = ['update_status', 'status', 'change_status', 'modify_order', 'switch_order', 'delete', 'create', 'push_order'];
$requestMethod = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if (in_array($action, $stateChangingActions, true)) {
    $allowedMethods = ($action === 'delete') ? ['POST', 'DELETE'] : ['POST', 'PATCH'];
    if (!in_array($requestMethod, $allowedMethods, true)) {
        http_response_code(405);
        header('Allow: ' . implode(', ', $allowedMethods));
        echo json_encode([
            'success' => false,
            'error'   => 'METHOD_NOT_ALLOWED',
            'message' => "Action '{$action}' requires " . implode(' or ', $allowedMethods)
        ]);
        exit;
    }
}

// ── Enforce Authentication & CSRF on All Administrative Endpoints ───────────
$adminActions = ['get_all_orders', 'orders', 'update_status', 'status', 'change_status', 'modify_order', 'switch_order', 'delete', 'analytics', 'create', 'push_order'];
if (in_array($action, $adminActions, true)) {
    $authType = getAdminAuthType($adminToken);
    if ($authType === '') {
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'error' => 'UNAUTHORIZED_ACCESS',
            'message' => 'Authorization: Bearer <ADMIN_API_TOKEN> or valid session cookie required.'
        ]);
        exit;
    }

    // CSRF & Origin Gate for Cookie Auth
    if ($authType === 'cookie') {
        $secFetchSite = strtolower($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '');
        if ($secFetchSite === 'cross-site') {
            http_response_code(403);
            echo json_encode([
                'success' => false,
                'error'   => 'CSRF_REJECTED',
                'message' => 'Cross-site request blocked by Sec-Fetch-Site policy.'
            ]);
            exit;
        }

        if (in_array($action, $stateChangingActions, true)) {
            if (empty($requestOrigin)) {
                http_response_code(403);
                echo json_encode([
                    'success' => false,
                    'error'   => 'CSRF_ORIGIN_REQUIRED',
                    'message' => 'Origin header is required for state-changing browser sessions.'
                ]);
                exit;
            }
            if (!in_array($requestOrigin, $allowedOrigins, true)) {
                http_response_code(403);
                echo json_encode([
                    'success' => false,
                    'error'   => 'CSRF_ORIGIN_DISALLOWED',
                    'message' => 'Origin header is not permitted for state-changing browser sessions.'
                ]);
                exit;
            }
        }
    }
}

// ── 2. Get All Orders ─────────────────────────────────────────────────────────
if ($action === 'get_all_orders' || $action === 'orders') {
    $url = "{$supabaseUrl}/rest/v1/orders?select=*&order=created_at.desc&limit=500";
    $res = supabaseRequest('GET', $url, null, $supabaseKey, $adminToken);

    if ($res['code'] < 200 || $res['code'] >= 300 || !is_array($res['data'])) {
        http_response_code(502);
        echo json_encode(['success' => false, 'error_code' => 'ORDERS_READ_FAILED']);
        exit;
    }

    $rows = $res['data'];
    $normalized = [];

    foreach ($rows as $r) {
        if (strtolower($r['status'] ?? '') === 'deleted') continue;

        $remarks = $r['remarks'] ?? [];
        if (is_string($remarks)) {
            $decoded = json_decode($remarks, true);
            $remarks = is_array($decoded) ? $decoded : [$remarks];
        }

        $normalized[] = [
            'orderId'            => $r['order_id'] ?? '',
            'storeId'            => $r['store_id'] ?? 'orvastore',
            'fullName'           => $r['full_name'] ?? '',
            'phone'              => $r['phone'] ?? '',
            'wilaya'             => $r['wilaya'] ?? '',
            'commune'            => $r['commune'] ?? '',
            'deliveryType'       => $r['delivery_type'] ?? null,
            'deliveryTime'       => $r['delivery_time'] ?? null,
            'quantity'           => isset($r['quantity']) && is_numeric($r['quantity']) ? (int)$r['quantity'] : null,
            'productName'        => $r['product_name'] ?? null,
            'productTotal'       => $r['product_total'] ?? null,
            'shippingFee'        => $r['shipping_fee'] ?? null,
            'priceNum'           => isset($r['price_num']) && is_numeric($r['price_num']) ? (int)$r['price_num'] : null,
            'grandTotal'         => $r['grand_total'] ?? null,
            'status'             => $r['status'] ?? 'pending',
            'in_redex'           => (bool)($r['in_redex'] ?? false),
            'redex_tracking_code'=> $r['redex_tracking_code'] ?? null,
            'remarks'            => $remarks,
            'created_at'         => $r['created_at'] ?? null,
            'riskScore'          => (int)($r['risk_score'] ?? 0),
            'riskLevel'          => $r['risk_level'] ?? 'LOW'
        ];
    }

    echo json_encode([
        'success' => true,
        'count'   => count($normalized),
        'data'    => $normalized
    ]);
    exit;
}

// ── 3. Update Order Status ────────────────────────────────────────────────────
if ($action === 'update_status' || $action === 'status' || $action === 'change_status') {
    $rawInput = file_get_contents('php://input');
    $body = json_decode($rawInput, true) ?? [];
    // Strictly read mutation parameters from body (NEVER from $_GET)
    $targetId = trim($body['orderId'] ?? $body['id'] ?? '');
    $newStatus = trim($body['status'] ?? '');

    if (empty($targetId) || empty($newStatus)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Missing orderId or status']);
        exit;
    }

    $patchUrl = "{$supabaseUrl}/rest/v1/orders?order_id=eq." . urlencode($targetId);
    $res = supabaseRequest('PATCH', $patchUrl, [
        'status' => $newStatus,
        'updated_at' => date('c')
    ], $supabaseKey, $adminToken);

    echo json_encode([
        'success' => true,
        'message' => "Order {$targetId} status updated to {$newStatus}",
        'orderId' => $targetId,
        'status'  => $newStatus
    ]);
    exit;
}

// ── 4. Order-Switch / In-Place Modification & Audit Workflow ──────────────────
if ($action === 'modify_order' || $action === 'switch_order') {
    $rawInput = file_get_contents('php://input');
    $body = json_decode($rawInput, true) ?? [];

    $orderId = trim($body['orderId'] ?? $body['id'] ?? '');
    if (empty($orderId)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Missing orderId parameter']);
        exit;
    }

    // 1. Fetch current order record
    $fetchUrl = "{$supabaseUrl}/rest/v1/orders?order_id=eq." . urlencode($orderId) . "&limit=1";
    $fetchRes = supabaseRequest('GET', $fetchUrl, null, $supabaseKey, $adminToken);
    $currentOrder = (is_array($fetchRes['data']) && !empty($fetchRes['data'])) ? $fetchRes['data'][0] : null;

    if (!$currentOrder) {
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => "Order {$orderId} not found"]);
        exit;
    }

    // The current dashboard's Switch Order flow changes recipient/delivery details in place.
    // Keep the older modify_order contract separate for the classic admin UI.
    if ($action === 'switch_order') {
        if ($fetchRes['code'] < 200 || $fetchRes['code'] >= 300) {
            http_response_code(502);
            echo json_encode(['success' => false, 'error_code' => 'ORDER_LOOKUP_FAILED']);
            exit;
        }

        $remarks = $currentOrder['remarks'] ?? [];
        if (is_string($remarks)) {
            $decodedRemarks = json_decode($remarks, true);
            $remarks = is_array($decodedRemarks) ? $decodedRemarks : [$remarks];
        }
        if (!is_array($remarks)) $remarks = [];

        $idempotencyKey = trim((string)($body['idempotencyKey'] ?? ''));
        if (!preg_match('/^[A-Za-z0-9._:-]{8,100}$/', $idempotencyKey)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error_code' => 'INVALID_IDEMPOTENCY_KEY']);
            exit;
        }

        foreach ($remarks as $remark) {
            if (is_array($remark) && ($remark['idempotency_key'] ?? '') === $idempotencyKey) {
                echo json_encode([
                    'success' => true,
                    'orderId' => $orderId,
                    'status' => $currentOrder['status'] ?? '',
                    'redexComment' => $remark['redex_comment'] ?? ''
                ]);
                exit;
            }
        }

        $currentStatus = strtolower(trim((string)($currentOrder['status'] ?? '')));
        if (in_array($currentStatus, ['delivered', 'cancelled', 'deleted'], true)) {
            http_response_code(422);
            echo json_encode(['success' => false, 'error_code' => 'CANNOT_SWITCH_TERMINAL_ORDER']);
            exit;
        }
        $operatorOverride = ($body['operatorOverride'] ?? false) === true;
        if (($currentStatus === 'shipped' || !empty($currentOrder['in_redex'])) && !$operatorOverride) {
            http_response_code(409);
            echo json_encode(['success' => false, 'error_code' => 'SHIPPED_ORDER_OVERRIDE_REQUIRED']);
            exit;
        }

        $reason = trim((string)($body['reason'] ?? ''));
        $fullName = trim((string)($body['fullName'] ?? $currentOrder['full_name'] ?? ''));
        $phone = trim((string)($body['phone'] ?? $currentOrder['phone'] ?? ''));
        $wilaya = trim((string)($body['wilaya'] ?? $currentOrder['wilaya'] ?? ''));
        $commune = trim((string)($body['commune'] ?? $currentOrder['commune'] ?? ''));
        $deliveryType = trim((string)($body['deliveryType'] ?? $currentOrder['delivery_type'] ?? ''));
        $shippingFee = trim((string)($body['shippingFee'] ?? ''));
        $grandTotal = trim((string)($body['grandTotal'] ?? ''));

        if (mb_strlen($reason) < 3 || $fullName === '' || $phone === '' || $wilaya === '' || $deliveryType === '') {
            http_response_code(400);
            echo json_encode(['success' => false, 'error_code' => 'INVALID_SWITCH_FIELDS']);
            exit;
        }

        $parseDzdAmount = static function (string $value): ?int {
            $digits = preg_replace('/\D+/', '', $value);
            if ($digits === '' || strlen($digits) > 12) return null;
            $amount = (int)$digits;
            return (string)$amount === $digits ? $amount : null;
        };
        $shippingAmount = $parseDzdAmount($shippingFee);
        $grandAmount = $parseDzdAmount($grandTotal);
        $productAmount = isset($currentOrder['price_num']) ? (int)$currentOrder['price_num'] : null;
        $financialFieldsUnchanged = $shippingFee === (string)($currentOrder['shipping_fee'] ?? '')
            && $grandTotal === (string)($currentOrder['grand_total'] ?? '');
        $invalidFinancialFields = $shippingAmount === null || $grandAmount === null
            || ($productAmount === null
                ? !$financialFieldsUnchanged
                : ($productAmount < 0 || $grandAmount !== $productAmount + $shippingAmount));
        if ($invalidFinancialFields) {
            http_response_code(422);
            echo json_encode(['success' => false, 'error_code' => 'INVALID_SWITCH_TOTAL']);
            exit;
        }

        $nextSequence = 1;
        foreach ($remarks as $remark) {
            if (is_array($remark) && (($remark['event'] ?? '') === 'ORDER_CONVERSION' || ($remark['switch_status'] ?? '') === 'switched')) {
                $nextSequence++;
            }
        }
        $timestamp = gmdate('c');
        $operatorName = trim((string)($body['claimedOperatorName'] ?? ''));
        $operator = $operatorName !== '' ? 'Orva Admin [' . mb_substr($operatorName, 0, 50) . ']' : 'Orva Admin [Shared Session]';
        $redexComment = "[ORVA STORE — تعديل بيانات المستلم والتوصيل]\n"
            . "─────────────────────────────────────────────\n"
            . "• رقم الطلبية: {$orderId}\n"
            . "• المنتج والكمية: {$currentOrder['product_name']} — {$currentOrder['quantity']}\n"
            . "• المبلغ المسجل (COD): {$grandTotal}\n"
            . "• العميل: {$fullName} | الهاتف: {$phone}\n"
            . "• العنوان: {$wilaya} — {$commune} ({$deliveryType})\n"
            . "• سبب التعديل: {$reason}\n"
            . "• تاريخ التعديل: {$timestamp} (المسؤول: {$operator})\n"
            . "─────────────────────────────────────────────\n"
            . "ملاحظة للموزع: يرجى تحديث بيانات المستلم والوجهة يدويًا؛ لا يتم إرسال التعديل إلى Redex آليًا.";

        $diff = [];
        foreach ([
            'full_name' => [$currentOrder['full_name'] ?? '', $fullName],
            'phone' => [$currentOrder['phone'] ?? '', $phone],
            'wilaya' => [$currentOrder['wilaya'] ?? '', $wilaya],
            'commune' => [$currentOrder['commune'] ?? '', $commune],
            'delivery_type' => [$currentOrder['delivery_type'] ?? '', $deliveryType],
            'shipping_fee' => [$currentOrder['shipping_fee'] ?? '', $shippingFee],
            'grand_total' => [$currentOrder['grand_total'] ?? '', $grandTotal]
        ] as $field => [$before, $after]) {
            if ((string)$before !== (string)$after) $diff[$field] = ['from' => $before, 'to' => $after];
        }
        $diff['origin_hub'] = 'بسكرة (07 - Biskra Hub)';

        $remarks[] = [
            'event' => 'ORDER_CONVERSION',
            'switch_status' => 'switched',
            'conversion_sequence' => $nextSequence,
            'idempotency_key' => $idempotencyKey,
            'timestamp_utc' => $timestamp,
            'operator' => $operator,
            'reason' => $reason,
            'override_applied' => $operatorOverride,
            'redex_tracking_code' => $currentOrder['redex_tracking_code'] ?? null,
            'redex_comment' => $redexComment,
            'diff' => $diff
        ];

        $switchUpdate = [
            'full_name' => $fullName,
            'phone' => $phone,
            'wilaya' => $wilaya,
            'commune' => $commune,
            'delivery_type' => $deliveryType,
            'shipping_fee' => $shippingFee,
            'grand_total' => $grandTotal,
            'remarks' => json_encode($remarks, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'updated_at' => $timestamp
        ];
        $switchResult = supabaseRequest('PATCH', "{$supabaseUrl}/rest/v1/orders?order_id=eq." . urlencode($orderId), $switchUpdate, $supabaseKey, $adminToken);
        if ($switchResult['code'] < 200 || $switchResult['code'] >= 300 || (is_array($switchResult['data']) && count($switchResult['data']) === 0)) {
            http_response_code($switchResult['code'] === 404 ? 404 : 502);
            echo json_encode(['success' => false, 'error_code' => 'ORDER_SWITCH_UPDATE_FAILED']);
            exit;
        }

        echo json_encode([
            'success' => true,
            'orderId' => $orderId,
            'status' => $currentOrder['status'] ?? '',
            'redexComment' => $redexComment,
            'updatedOrder' => is_array($switchResult['data']) && isset($switchResult['data'][0]) ? $switchResult['data'][0] : null
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    // 2. Prepare new fields
    $newProduct     = trim($body['productName'] ?? $currentOrder['product_name']);
    $newPriceNum    = isset($body['priceNum']) ? (int)$body['priceNum'] : (int)$currentOrder['price_num'];
    $newGrandTotal  = trim($body['grandTotal'] ?? ($newPriceNum . ' د.ج'));
    $newShippingFee = trim($body['shippingFee'] ?? $currentOrder['shipping_fee'] ?? '500 د.ج');
    $newFullName    = trim($body['fullName'] ?? $currentOrder['full_name']);
    $newPhone       = trim($body['phone'] ?? $currentOrder['phone']);
    $newWilaya      = trim($body['wilaya'] ?? $currentOrder['wilaya']);
    $newCommune     = trim($body['commune'] ?? $currentOrder['commune']);
    $newDelivery    = trim($body['deliveryType'] ?? $currentOrder['delivery_type']);
    $reason         = trim($body['reason'] ?? 'Order modified by administrator');
    $operator       = trim($body['operator'] ?? 'Admin Operator');

    // 3. Prepare remarks
    $remarks = $currentOrder['remarks'] ?? [];
    if (is_string($remarks)) {
        $decoded = json_decode($remarks, true);
        $remarks = is_array($decoded) ? $decoded : [$remarks];
    }
    $timestamp = date('Y-m-d H:i:s');
    $remarks[] = "[{$timestamp}] Modifié par {$operator}: {$reason} | Nouveau pack: {$newProduct} ({$newGrandTotal})";

    // 4. Record snapshot in public.audit_logs
    $auditPayload = [
        'action'      => 'ORDER_SWITCH',
        'entity_type' => 'order',
        'entity_id'   => $orderId,
        'actor'       => $operator,
        'payload'     => [
            'before' => [
                'product_name' => $currentOrder['product_name'],
                'price_num'    => $currentOrder['price_num'],
                'grand_total'  => $currentOrder['grand_total'],
                'full_name'    => $currentOrder['full_name'],
                'phone'        => $currentOrder['phone'],
                'wilaya'       => $currentOrder['wilaya'],
                'commune'      => $currentOrder['commune'],
                'status'       => $currentOrder['status']
            ],
            'after' => [
                'product_name' => $newProduct,
                'price_num'    => $newPriceNum,
                'grand_total'  => $newGrandTotal,
                'full_name'    => $newFullName,
                'phone'        => $newPhone,
                'wilaya'       => $newWilaya,
                'commune'      => $newCommune,
                'reason'       => $reason
            ],
            'reason'    => $reason,
            'timestamp' => date('c')
        ]
    ];
    supabaseRequest('POST', "{$supabaseUrl}/rest/v1/audit_logs", $auditPayload, $supabaseKey, $adminToken);

    // 5. Update public.orders in-place
    $updateData = [
        'product_name'  => $newProduct,
        'product_total' => $newGrandTotal,
        'price_num'     => $newPriceNum,
        'grand_total'   => $newGrandTotal,
        'shipping_fee'  => $newShippingFee,
        'full_name'     => $newFullName,
        'phone'         => $newPhone,
        'wilaya'        => $newWilaya,
        'commune'       => $newCommune,
        'delivery_type' => $newDelivery,
        'remarks'       => json_encode($remarks),
        'updated_at'    => date('c')
    ];
    $updateRes = supabaseRequest('PATCH', "{$supabaseUrl}/rest/v1/orders?order_id=eq." . urlencode($orderId), $updateData, $supabaseKey, $adminToken);

    // 6. Generate Copy-Ready Redex Transfer Comment
    $redexComment = "[ORVA STORE — تعديل طلبية / تغيير العرض]\n"
        . "─────────────────────────────────────────────\n"
        . "• رقم الطلبية: {$orderId}\n"
        . "• العرض الجديد: {$newProduct}\n"
        . "• المبلغ الإجمالي النهائي (COD): {$newGrandTotal}\n"
        . "• العميل: {$newFullName} | الهاتف: {$newPhone}\n"
        . "• العنوان: {$newWilaya} — {$newCommune} ({$newDelivery})\n"
        . "• سبب التعديل: {$reason}\n"
        . "• تاريخ التعديل: {$timestamp} (المسؤول: {$operator})\n"
        . "─────────────────────────────────────────────\n"
        . "ملاحظة للموزع: يرجى تسليم العرض الجديد المذكور أعلاه وتحصيل المبلغ الإجمالي المحدث.";

    echo json_encode([
        'success'       => true,
        'message'       => "Order {$orderId} modified and audited successfully.",
        'orderId'       => $orderId,
        'redexComment'  => $redexComment,
        'updatedOrder'  => array_merge($currentOrder, $updateData)
    ]);
    exit;
}

// ── 3.5. Test Courier Connection (Safe GET /api/v1/get/wilayas) ───────────────
if ($action === 'test_courier' || $action === 'test_ecotrack') {
    $ecoUrl = rtrim($config['ecotrack']['base_url'] ?? 'https://redex.ecotrack.dz', '/');
    $ecoToken = $config['ecotrack']['api_token'] ?? '';

    if (empty($ecoToken)) {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'configured' => false,
            'reachable' => false,
            'authenticated' => false,
            'operational' => false,
            'error' => 'MISSING_API_TOKEN',
            'message' => 'Courier API token is not configured.'
        ]);
        exit;
    }

    $ch = curl_init("{$ecoUrl}/api/v1/get/wilayas");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Authorization: Bearer ' . $ecoToken,
        'Accept: application/json'
    ]);
    curl_setopt($ch, CURLOPT_TIMEOUT, 8);
    $resStr = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200) {
        echo json_encode([
            'success' => true,
            'configured' => true,
            'reachable' => true,
            'authenticated' => true,
            'operational' => true,
            'baseUrl' => $ecoUrl,
            'message' => 'Courier connection verified and authenticated successfully.'
        ]);
    } else {
        http_response_code($httpCode === 401 ? 401 : 502);
        echo json_encode([
            'success' => false,
            'configured' => true,
            'reachable' => ($httpCode > 0),
            'authenticated' => false,
            'operational' => false,
            'statusCode' => $httpCode,
            'error' => $httpCode === 401 ? 'AUTHENTICATION_FAILED' : 'COURIER_UNAVAILABLE',
            'message' => $httpCode === 401 ? 'Invalid courier API token' : "Courier returned HTTP {$httpCode}"
        ]);
    }
    exit;
}

// ── 4.5. Push Order to Delivery Platform (Ecotrack / RedEx) ──────────────────
if ($action === 'create' || $action === 'push_order') {
    $rawInput = file_get_contents('php://input');
    $body = json_decode($rawInput, true) ?? [];
    $orderId = trim((string)($body['orderId'] ?? $body['id'] ?? ''));
    $courierId = trim((string)($body['courierId'] ?? 'redex'));
    $deliveryType = trim((string)($body['deliveryType'] ?? 'home'));

    if (empty($orderId)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Missing orderId parameter']);
        exit;
    }

    // 1. Fetch existing order to check duplicate shipment
    $getOrderUrl = "{$supabaseUrl}/rest/v1/orders?order_id=eq." . urlencode($orderId) . "&select=*";
    $orderData = supabaseRequest('GET', $getOrderUrl, null, $supabaseKey, $adminToken);
    $existingOrder = (is_array($orderData['data']) && count($orderData['data']) > 0) ? $orderData['data'][0] : null;

    if ($existingOrder && !empty($existingOrder['redex_tracking_code'])) {
        // Return existing shipment info — zero duplicate creation!
        echo json_encode([
            'success' => true,
            'orderId' => $orderId,
            'duplicatePrevented' => true,
            'trackingCode' => $existingOrder['redex_tracking_code'],
            'trackingNumber' => $existingOrder['redex_tracking_code'],
            'courierId' => $courierId,
            'courierName' => ucfirst($courierId),
            'message' => "Shipment already exists for order {$orderId}."
        ]);
        exit;
    }

    // 2. Check credentials
    $ecoUrl = rtrim($config['ecotrack']['base_url'] ?? 'https://redex.ecotrack.dz', '/');
    $ecoToken = $config['ecotrack']['api_token'] ?? '';

    if (empty($ecoToken)) {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'error' => 'COURIER_NOT_CONFIGURED',
            'message' => 'Courier API token is not configured on server. Manual dispatch or token configuration required.'
        ]);
        exit;
    }

    // 3. Prepare real payload for provider
    $fullName = $body['fullName'] ?? ($existingOrder['customer_name'] ?? 'Client');
    $phone = $body['phone'] ?? ($existingOrder['customer_phone'] ?? '0555000000');
    $wilayaCode = intval($body['wilayaCode'] ?? 16);
    $commune = $body['commune'] ?? 'Alger Centre';
    $price = intval($body['price'] ?? ($existingOrder['grand_total'] ?? 4950));
    $isStopdesk = ($deliveryType === 'desk' || str_contains(strtolower($deliveryType), 'stop'));

    $ecotrackPayload = [
        'nom_client' => $fullName,
        'telephone' => $phone,
        'telephone_2' => $body['phone2'] ?? null,
        'adresse' => $body['address'] ?? ($isStopdesk ? 'Bureau Stop Desk' : 'Centre Ville'),
        'code_wilaya' => (string)$wilayaCode,
        'commune' => $commune,
        'montant' => $price,
        'remarque' => $body['remarks'] ?? ($isStopdesk ? 'Stop Desk' : 'Domicile'),
        'produit' => $body['productName'] ?? 'ORVA Store Order',
        'type' => 1,
        'stop_desk' => $isStopdesk ? 1 : 0,
        'reference' => $orderId
    ];

    $ch = curl_init("{$ecoUrl}/api/v1/create/order");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($ecotrackPayload));
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Authorization: Bearer ' . $ecoToken,
        'Content-Type: application/json',
        'Accept: application/json'
    ]);
    curl_setopt($ch, CURLOPT_TIMEOUT, 8);
    $resStr = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $resData = json_decode($resStr, true) ?? [];

    if ($httpCode !== 200 && $httpCode !== 201) {
        http_response_code($httpCode >= 400 && $httpCode < 600 ? $httpCode : 502);
        echo json_encode([
            'success' => false,
            'error' => 'COURIER_DISPATCH_FAILED',
            'message' => $resData['message'] ?? "Courier provider returned HTTP {$httpCode}",
            'details' => $resData
        ]);
        exit;
    }

    $realTracking = trim((string)($resData['tracking'] ?? ''));
    if (empty($realTracking)) {
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'error' => 'INVALID_COURIER_RESPONSE',
            'message' => 'Provider did not return a valid tracking number'
        ]);
        exit;
    }

    // 4. Update Supabase with REAL tracking number (never synthetic)
    $patchUrl = "{$supabaseUrl}/rest/v1/orders?order_id=eq." . urlencode($orderId);
    supabaseRequest('PATCH', $patchUrl, [
        'status' => 'shipped',
        'in_redex' => true,
        'redex_tracking_code' => $realTracking,
        'delivery_type' => ($isStopdesk ? 'استلام من المكتب (Stop Desk)' : 'توصيل للمنزل'),
        'updated_at' => date('c')
    ], $supabaseKey, $adminToken);

    echo json_encode([
        'success' => true,
        'orderId' => $orderId,
        'trackingCode' => $realTracking,
        'trackingNumber' => $realTracking,
        'courierId' => $courierId,
        'courierName' => ucfirst($courierId),
        'message' => "Order {$orderId} dispatched successfully to {$courierId} with real tracking {$realTracking}."
    ]);
    exit;
}

// ── 5. Delete Order ───────────────────────────────────────────────────────────
if ($action === 'delete') {
    $rawInput = file_get_contents('php://input');
    $body = json_decode($rawInput, true) ?? [];
    // Strictly from body (NEVER from $_GET)
    $targetId = trim($body['orderId'] ?? $body['id'] ?? '');

    if (empty($targetId)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Missing order id']);
        exit;
    }

    $patchUrl = "{$supabaseUrl}/rest/v1/orders?order_id=eq." . urlencode($targetId);
    supabaseRequest('PATCH', $patchUrl, [
        'status' => 'deleted',
        'updated_at' => date('c')
    ], $supabaseKey, $adminToken);

    echo json_encode([
        'success' => true,
        'message' => "Order {$targetId} deleted successfully",
        'orderId' => $targetId
    ]);
    exit;
}

// ── 6. Analytics ──────────────────────────────────────────────────────────────
if ($action === 'analytics') {
    $url = "{$supabaseUrl}/rest/v1/orders?select=status,price_num,created_at&limit=500";
    $res = supabaseRequest('GET', $url, null, $supabaseKey, $adminToken);

    $rows = is_array($res['data']) ? $res['data'] : [];
    $totalOrders = count($rows);
    $totalRevenue = 0;
    $delivered = 0;
    $pending = 0;

    foreach ($rows as $r) {
        $st = strtolower($r['status'] ?? '');
        if ($st === 'deleted') continue;
        if ($st === 'delivered') $delivered++;
        if ($st === 'pending') $pending++;
        $totalRevenue += (int)($r['price_num'] ?? 0);
    }

    echo json_encode([
        'success' => true,
        'data' => [
            'totalOrders'   => $totalOrders,
            'totalRevenue'  => $totalRevenue,
            'deliveredCount'=> $delivered,
            'pendingCount'  => $pending
        ]
    ]);
    exit;
}

// Default status response
echo json_encode(['success' => true, 'message' => 'ORVA Logistics Gateway Active (Hardened)']);
