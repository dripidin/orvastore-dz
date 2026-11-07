<?php
// ==============================================================================
// ORVA STORE — Native PHP 8.3 Order Dispatcher for Hostinger LiteSpeed
// Stabilization: order-id safety, inventory lifecycle, exact product/wilaya checks
// ==============================================================================

define('ORVA_API', true);
$config = require __DIR__ . '/config.php';
require_once dirname(__DIR__) . '/lib/inventory-store.php';
require_once dirname(__DIR__) . '/lib/risk-engine.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Requested-With, Idempotency-Key, X-Idempotency-Key');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode([
        'success' => false,
        'error' => 'METHOD_NOT_ALLOWED',
        'message' => 'Please send a POST request.'
    ]);
    exit;
}

function orva_tg_escape(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function orva_resolve_product_exact(array $catalog, array $aliases, string $identifier): ?string
{
    $raw = strtolower(trim($identifier));
    if ($raw === '') {
        return null;
    }
    if (isset($catalog[$raw])) {
        return $raw;
    }
    if (isset($aliases[$raw]) && isset($catalog[$aliases[$raw]])) {
        return $aliases[$raw];
    }
    // Exact SKU match against product rows
    foreach ($catalog as $key => $product) {
        $sku = strtolower(trim((string)($product['sku'] ?? '')));
        $id = strtolower(trim((string)($product['id'] ?? '')));
        if ($raw === $sku || $raw === $id) {
            return $key;
        }
    }
    return null;
}

function orva_generate_order_id(): string
{
    return 'ORVA-' . strtoupper(bin2hex(random_bytes(6)));
}

// ── 1. Read JSON Request Body ─────────────────────────────────────────────────
$rawInput = file_get_contents('php://input');
$data = json_decode($rawInput, true);

if (!$data || !is_array($data)) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => 'INVALID_JSON_PAYLOAD',
        'message' => 'Invalid JSON payload received.'
    ]);
    exit;
}

$rootDir = dirname(__DIR__);
$catalogFile = $rootDir . '/data/products-catalog.json';
$tariffsFile = $rootDir . '/data/wilayas-tariffs.json';
$communesFile = $rootDir . '/data/algeria-communes.json';
$idempotencyFile = $rootDir . '/data/idempotency-records.json';
$locksDir = $rootDir . '/data/locks';
if (!is_dir($locksDir)) {
    @mkdir($locksDir, 0755, true);
}

// ── 3. Extract Idempotency Key ────────────────────────────────────────────────
$idempotencyKey = null;
$headers = function_exists('apache_request_headers') ? apache_request_headers() : [];
$idempotencyKey = $_SERVER['HTTP_IDEMPOTENCY_KEY'] ?? $_SERVER['HTTP_X_IDEMPOTENCY_KEY'] ?? ($headers['Idempotency-Key'] ?? ($headers['idempotency-key'] ?? null));

if (!$idempotencyKey) {
    $idempotencyKey = $data['idempotencyKey'] ?? ($data['idempotency_key'] ?? null);
}
if ($idempotencyKey) {
    $idempotencyKey = trim((string)$idempotencyKey);
}

// Cross-Process Idempotency Lock & Double-Checked Verification
$idempLockFp = null;
if ($idempotencyKey) {
    $idempLockFile = $locksDir . '/idemp_' . md5($idempotencyKey) . '.lock';
    $idempLockFp = fopen($idempLockFile, 'c+');
    if ($idempLockFp) {
        flock($idempLockFp, LOCK_EX);
    }

    if (file_exists($idempotencyFile)) {
        $idempRecords = json_decode((string)file_get_contents($idempotencyFile), true) ?? [];
        if (isset($idempRecords[$idempotencyKey])) {
            if ($idempLockFp) {
                flock($idempLockFp, LOCK_UN);
                fclose($idempLockFp);
            }
            $stored = $idempRecords[$idempotencyKey]['response'] ?? $idempRecords[$idempotencyKey];
            if (is_array($stored)) {
                $stored['idempotent'] = true;
                http_response_code(200);
                echo json_encode($stored);
                exit;
            }
        }
    }
}

// ── 4. Authoritative Dynamic Product Catalog (fail closed) ────────────────────
if (!file_exists($catalogFile)) {
    if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }
    http_response_code(503);
    echo json_encode([
        'success' => false,
        'error' => 'CATALOG_UNAVAILABLE',
        'message' => 'كتالوج المنتجات غير متاح حالياً. يرجى المحاولة لاحقاً.'
    ]);
    exit;
}

$catalogData = json_decode((string)file_get_contents($catalogFile), true);
if (!is_array($catalogData) || empty($catalogData['products']) || !is_array($catalogData['products'])) {
    if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }
    http_response_code(503);
    echo json_encode([
        'success' => false,
        'error' => 'CATALOG_UNAVAILABLE',
        'message' => 'كتالوج المنتجات غير متاح حالياً. يرجى المحاولة لاحقاً.'
    ]);
    exit;
}
$catalog = $catalogData['products'];
$aliases = is_array($catalogData['aliases'] ?? null) ? $catalogData['aliases'] : [];

// ── 5. Authoritative 58 Wilayas Tariff Engine ─────────────────────────────────
if (!file_exists($tariffsFile)) {
    if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }
    http_response_code(503);
    echo json_encode(['success' => false, 'error' => 'TARIFFS_UNAVAILABLE', 'message' => 'تعذر تحميل تعريفة التوصيل.']);
    exit;
}
$wilayas = json_decode((string)file_get_contents($tariffsFile), true);
if (!is_array($wilayas) || count($wilayas) < 1) {
    if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }
    http_response_code(503);
    echo json_encode(['success' => false, 'error' => 'TARIFFS_UNAVAILABLE', 'message' => 'تعذر تحميل تعريفة التوصيل.']);
    exit;
}

$communesByWilaya = [];
if (file_exists($communesFile)) {
    $decodedCommunes = json_decode((string)file_get_contents($communesFile), true);
    if (is_array($decodedCommunes)) {
        $communesByWilaya = $decodedCommunes;
    }
}

// ── 6. Field Extraction & Validation ──────────────────────────────────────────
$fullName     = trim((string)($data['fullName'] ?? ''));
$phone        = trim((string)($data['phone'] ?? ''));
$rawWilaya    = trim((string)($data['wilaya'] ?? ''));
$wilayaIdRaw  = $data['wilayaId'] ?? $data['wilaya_id'] ?? null;
$commune      = trim((string)($data['commune'] ?? ''));
$deliveryType = trim((string)($data['deliveryType'] ?? ''));
$quantity     = $data['quantity'] ?? 1;
$clientOrderId = trim((string)($data['orderId'] ?? ''));
$eventId      = trim((string)($data['eventId'] ?? $data['event_id'] ?? ''));

// Validate Name
if (mb_strlen($fullName, 'UTF-8') < 3) {
    if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'INVALID_FULL_NAME', 'message' => 'يرجى كتابة الاسم الكامل بشكل صحيح (3 أحرف على الأقل).']);
    exit;
}

// Validate Phone
$cleanPhone = preg_replace('/[\s\-\.]/', '', $phone);
if (!preg_match('/^(?:0|\+?213)(5|6|7)[0-9]{8}$/', $cleanPhone)) {
    if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'INVALID_PHONE', 'message' => 'رقم الهاتف غير صالح. يرجى إدخال رقم هاتف جزائري (05/06/07).']);
    exit;
}

// Validate Quantity (1 to 10 integer)
if (!is_numeric($quantity) || (int)$quantity != $quantity || (int)$quantity < 1 || (int)$quantity > 10) {
    if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'INVALID_QUANTITY', 'message' => 'الكمية المطلوبة يجب أن تكون عدداً صحيحاً بين 1 و 10 قطع.']);
    exit;
}
$quantity = (int)$quantity;

// Resolve Product — exact SKU / id / alias only (no substring matching)
$reqIdent = trim((string)($data['sku'] ?? $data['productId'] ?? $data['packId'] ?? $data['productName'] ?? ''));
$catalogKey = orva_resolve_product_exact($catalog, $aliases, $reqIdent);

if (!$catalogKey || !isset($catalog[$catalogKey])) {
    if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'PRODUCT_UNAVAILABLE', 'message' => 'المنتج المطلوب غير متاح في الكتالوج.']);
    exit;
}

$product = $catalog[$catalogKey];
$status = strtolower(trim((string)($product['status'] ?? '')));
if ($status === 'archived' || $status === 'draft' || empty($product['allowOrders'])) {
    if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'PRODUCT_INACTIVE', 'message' => 'هذا المنتج متوقف حالياً عن البيع.']);
    exit;
}

if (!isset($product['sellingPrice']) || !is_numeric($product['sellingPrice'])) {
    if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }
    http_response_code(503);
    echo json_encode(['success' => false, 'error' => 'PRODUCT_PRICE_MISSING', 'message' => 'سعر المنتج غير مهيأ على الخادم.']);
    exit;
}

// Resolve Wilaya by authoritative ID only
$selectedWilaya = null;
$wilayaId = null;
if ($wilayaIdRaw !== null && $wilayaIdRaw !== '') {
    $wilayaId = (int)$wilayaIdRaw;
} elseif (preg_match('/^\d{1,2}$/', $rawWilaya)) {
    $wilayaId = (int)$rawWilaya;
} elseif (preg_match('/^(\d{1,2})\b/', $rawWilaya, $wm)) {
    // Accept "16 - الجزائر" style only when it begins with the official id
    $wilayaId = (int)$wm[1];
}

if ($wilayaId !== null && $wilayaId >= 1 && $wilayaId <= 58) {
    foreach ($wilayas as $w) {
        if ((int)($w['id'] ?? 0) === $wilayaId) {
            $selectedWilaya = $w;
            break;
        }
    }
}

if (!$selectedWilaya) {
    if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'INVALID_WILAYA', 'message' => 'يرجى اختيار ولاية صحيحة من قائمة الـ 58 ولاية.']);
    exit;
}

$wilayaId = (int)$selectedWilaya['id'];
$communeList = $communesByWilaya[(string)$wilayaId] ?? $communesByWilaya[$wilayaId] ?? null;
if (!is_array($communeList) || $commune === '') {
    if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => 'INVALID_COMMUNE_FOR_WILAYA',
        'message' => 'البلدية غير مطابقة للولاية المختارة.'
    ]);
    exit;
}

$communeMatched = false;
foreach ($communeList as $c) {
    if (strcasecmp(trim((string)$c), $commune) === 0) {
        $commune = trim((string)$c);
        $communeMatched = true;
        break;
    }
}
if (!$communeMatched) {
    if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => 'INVALID_COMMUNE_FOR_WILAYA',
        'message' => 'البلدية "' . $commune . '" غير مطابقة للولاية المختارة.'
    ]);
    exit;
}

// Resolve Delivery Method & Tariff (server authoritative)
$isStopdesk = (
    str_contains(strtolower($deliveryType), 'desk') ||
    str_contains(strtolower($deliveryType), 'stop') ||
    str_contains($deliveryType, 'مكتب')
);

$actualDeliveryType = 'توصيل للمنزل';
if ($isStopdesk) {
    if ($selectedWilaya['stopdesk'] !== null) {
        $authoritativeShipping = (int)$selectedWilaya['stopdesk'];
        $actualDeliveryType = 'توصيل للمكتب (Stop Desk)';
    } else {
        $authoritativeShipping = (int)$selectedWilaya['domicile'];
        $actualDeliveryType = 'توصيل للمنزل (Stop Desk غير متوفر)';
    }
} else {
    $authoritativeShipping = (int)$selectedWilaya['domicile'];
    $actualDeliveryType = 'توصيل للمنزل';
}

$unitPrice = (int)$product['sellingPrice'];
$calculatedProductTotal = $unitPrice * $quantity;
$calculatedGrandTotal = $calculatedProductTotal + $authoritativeShipping;

$productTotalStr = $calculatedProductTotal . ' د.ج';
$shippingFeeStr  = $authoritativeShipping . ' د.ج';
$grandTotalStr   = $calculatedGrandTotal . ' د.ج';
$deliveryTime    = $selectedWilaya['time'];
$cleanLocation   = $selectedWilaya['canonicalName'] . ' — ' . $commune;

// ── 7. Order ID: collision-resistant server ID; reject explicit duplicates ────
if ($clientOrderId !== '') {
    if (!preg_match('/^[A-Za-z0-9._:-]{6,64}$/', $clientOrderId)) {
        if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'error' => 'INVALID_ORDER_ID',
            'message' => 'معرف الطلب غير صالح.'
        ]);
        exit;
    }
    if (orva_inventory_has_active_reservation($clientOrderId)) {
        if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }
        http_response_code(409);
        echo json_encode([
            'success' => false,
            'error' => 'DUPLICATE_ORDER_ID',
            'message' => 'معرف الطلب مستخدم مسبقاً. يرجى إعادة المحاولة.'
        ]);
        exit;
    }
    $orderId = $clientOrderId;
} else {
    $orderId = orva_generate_order_id();
}
if ($eventId === '') {
    $eventId = 'order_' . $orderId . '_' . time();
}

// ── 7b. Risk Engine (Services plan ecom scoring) ──────────────────────────────
$clientIp = preg_replace('/[^0-9a-fA-F:.]/', '', (string)($_SERVER['REMOTE_ADDR'] ?? '')) ?: '';
$deviceId = trim((string)($data['deviceId'] ?? $data['device_id'] ?? ''));
$formDurationMs = $data['formDurationMs'] ?? $data['form_duration_ms'] ?? null;
$honeypotValue = trim((string)($data['honeypot'] ?? $data['website'] ?? ''));
$riskCtx = [
    'storeId' => 'orvastore',
    'orderId' => $orderId,
    'actorPhone' => $cleanPhone,
    'actorIpHash' => orva_risk_hash_ip($clientIp),
    'deviceId' => $deviceId,
    'honeypotValue' => $honeypotValue,
    'formDurationMs' => is_numeric($formDurationMs) ? (int)$formDurationMs : null,
];
$riskResult = orva_risk_evaluate($riskCtx);

if (($riskResult['decision'] ?? '') === 'BLOCK') {
    orva_risk_record($riskCtx, $riskResult);
    if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }
    http_response_code(429);
    echo json_encode([
        'success' => false,
        'error' => 'REQUEST_BLOCKED',
        'message' => 'عذراً، لا يمكن معالجة طلبك في الوقت الحالي. يرجى التحقق من معلوماتك والمحاولة مرة أخرى.'
    ]);
    exit;
}

$orderStatus = (($riskResult['decision'] ?? '') === 'REVIEW') ? 'review' : 'pending';
$riskScore = (int)($riskResult['score'] ?? 0);
$riskLevel = (string)($riskResult['level'] ?? 'LOW');
$riskDecision = (string)($riskResult['decision'] ?? 'ALLOW');
$riskReasons = is_array($riskResult['reasons'] ?? null) ? $riskResult['reasons'] : [];
$riskReasonsStr = implode('|', $riskReasons);
$riskBadge = $riskDecision === 'REVIEW'
    ? "\n⚠️ فحص يدوي (REVIEW) — نقاط الخطر: {$riskScore}/100"
    : ($riskScore > 0 ? "\n🟡 مؤشر خطر: {$riskScore}/100" : '');

// ── 8. Atomic Inventory Reservation ───────────────────────────────────────────
$sku = strtoupper(trim((string)$product['sku']));
$createdReservation = false;
$reserveResult = orva_inventory_reserve($sku, $quantity, $orderId);

if (!$reserveResult['ok']) {
    if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }
    $code = $reserveResult['code'] ?? 'INSUFFICIENT_STOCK';
    $statusCode = ($code === 'INVENTORY_SKU_MISSING') ? 409 : 400;
    if ($code === 'ORDER_ID_ALREADY_RESERVED') {
        $statusCode = 409;
    }
    http_response_code($statusCode);
    echo json_encode([
        'success' => false,
        'error' => $code,
        'message' => $reserveResult['message'] ?? 'تعذر حجز المخزون.'
    ]);
    exit;
}

if (!empty($reserveResult['alreadyReserved'])) {
    // Should be unreachable after the pre-check; treat as conflict, never roll back foreign stock
    if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }
    http_response_code(409);
    echo json_encode([
        'success' => false,
        'error' => 'DUPLICATE_ORDER_ID',
        'message' => 'معرف الطلب مستخدم مسبقاً. يرجى إعادة المحاولة.'
    ]);
    exit;
}

$createdReservation = !empty($reserveResult['created']);

// ── 9. Save Order to Database ─────────────────────────────────────────────────
$supabaseUrl = rtrim($config['supabase']['url'], '/') . '/rest/v1/orders';
$supabaseResp = null;
try {
    $supabaseResp = orva_orders_storage_request('POST', $supabaseUrl, [
        'order_id'            => $orderId,
        'store_id'            => 'orvastore',
        'full_name'           => $fullName,
        'phone'               => $phone,
        'wilaya'              => $cleanLocation,
        'commune'             => $commune,
        'delivery_type'       => $actualDeliveryType,
        'delivery_time'       => $deliveryTime,
        'quantity'            => $quantity,
        'product_name'        => $product['name'] ?? $product['title'],
        'product_total'       => $productTotalStr,
        'shipping_fee'        => $shippingFeeStr,
        'price_num'           => $calculatedGrandTotal,
        'grand_total'         => $grandTotalStr,
        'status'              => $orderStatus,
        'in_redex'            => false,
        'redex_tracking_code' => null,
        'client_ip_hash'      => $riskCtx['actorIpHash'],
        'device_id'           => $deviceId !== '' ? $deviceId : null,
        'risk_score'          => $riskScore,
        'risk_level'          => $riskLevel,
        'risk_decision'       => $riskDecision,
        'risk_reasons'        => $riskReasonsStr,
    ], $config, '', ['Prefer: return=minimal']);
} catch (Throwable $e) {
    if ($createdReservation) {
        orva_inventory_release($orderId, 'STORAGE_EXCEPTION_ROLLBACK', $quantity);
    }
    if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }
    $errCode = 'STORAGE_UNAVAILABLE';
    $msg = $e->getMessage();
    if (strpos($msg, 'STAGING_TOKEN_REQUIRED') !== false) {
        $errCode = 'STAGING_TOKEN_REQUIRED';
    } elseif (strpos($msg, 'STAGING_SCHEMA_ISOLATION_VIOLATION') !== false) {
        $errCode = 'STAGING_SCHEMA_ISOLATION_VIOLATION';
    }
    http_response_code(503);
    echo json_encode([
        'success' => false,
        'error' => $errCode,
        'message' => 'تعذر حفظ الطلب في قاعدة البيانات. يرجى المحاولة لاحقاً.'
    ]);
    exit;
}

$supabaseHttp = (int)($supabaseResp['code'] ?? 0);

// Verify persistence succeeded — roll back ONLY reservation created by this request
if ($supabaseHttp !== 200 && $supabaseHttp !== 201) {
    if ($createdReservation) {
        orva_inventory_release($orderId, 'STORAGE_FAILURE_ROLLBACK', $quantity);
    }
    if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }

    // Unique violation / conflict: do not pretend success
    $conflict = ($supabaseHttp === 409);
    http_response_code($conflict ? 409 : 503);
    echo json_encode([
        'success' => false,
        'error' => $conflict ? 'DUPLICATE_ORDER_ID' : 'STORAGE_UNAVAILABLE',
        'message' => $conflict
            ? 'معرف الطلب مستخدم مسبقاً. يرجى إعادة المحاولة.'
            : 'تعذر حفظ الطلب في قاعدة البيانات. يرجى المحاولة لاحقاً.'
    ]);
    exit;
}

// ── 10. Decoupled Notifications (Telegram failure must not invalidate order) ──
$tgToken   = $config['telegram']['bot_token'] ?? '';
$tgChatId  = $config['telegram']['chat_id'] ?? '';
$tgEnabled = $config['telegram']['enabled'] ?? true;

if ($tgToken && $tgChatId && $tgEnabled) {
    try {
        $ledgerFile = __DIR__ . '/../data/telegram-dispatch-ledger.json';
        $ledgerKey = "ORDER_CREATED_{$orderId}_none";
        $ledger = [];
        if (file_exists($ledgerFile)) {
            $ledger = json_decode((string)file_get_contents($ledgerFile), true) ?? [];
        }

        if (!isset($ledger[$ledgerKey])) {
            $dateFormatted = date('Y-m-d H:i');
            $adminUrl = "https://orva-store.com/dashboard/ecommerce?orderId=" . urlencode($orderId);

            $customTemplate = null;
            $templates = $config['telegram']['templates'] ?? [];
            if (isset($templates['ORDER_CREATED']) && is_array($templates['ORDER_CREATED'])) {
                $tplConf = $templates['ORDER_CREATED'];
                if (($tplConf['enabled'] ?? true) && !empty($tplConf['activeTemplate']) && trim($tplConf['activeTemplate']) !== '') {
                    $candidateTpl = trim($tplConf['activeTemplate']);
                    if (strpos($candidateTpl, '***') === false && strpos($candidateTpl, 'إخفاء جزئي') === false) {
                        $customTemplate = $candidateTpl;
                    }
                }
            }

            $tgMsg = '';
            if ($customTemplate !== null) {
                $context = [
                    'order_id' => $orderId,
                    'orderId' => $orderId,
                    'id' => $orderId,
                    'customer_name' => $fullName,
                    'customerName' => $fullName,
                    'fullName' => $fullName,
                    'name' => $fullName,
                    'customer_phone' => $phone,
                    'customerPhone' => $phone,
                    'phone' => $phone,
                    'raw_phone' => $phone,
                    'masked_phone' => $phone,
                    'maskedPhone' => $phone,
                    'product_name' => $product['shortTitle'] ?? ($product['title'] ?? ($product['name'] ?? 'منتج ORVA')),
                    'productName' => $product['shortTitle'] ?? ($product['title'] ?? ($product['name'] ?? 'منتج ORVA')),
                    'productTitle' => $product['shortTitle'] ?? ($product['title'] ?? ($product['name'] ?? 'منتج ORVA')),
                    'quantity' => (string)$quantity,
                    'qty' => (string)$quantity,
                    'product_price' => $productTotalStr,
                    'productPrice' => $productTotalStr,
                    'shipping_fee' => $shippingFeeStr,
                    'shippingFee' => $shippingFeeStr,
                    'grand_total' => $grandTotalStr,
                    'grandTotal' => $grandTotalStr,
                    'total' => $grandTotalStr,
                    'wilaya' => $cleanLocation,
                    'location' => $cleanLocation,
                    'commune' => $commune,
                    'city' => $commune,
                    'delivery_type' => $actualDeliveryType,
                    'deliveryType' => $actualDeliveryType,
                    'delivery_time' => $deliveryTime,
                    'deliveryTime' => $deliveryTime,
                    'date' => $dateFormatted,
                    'dateTime' => $dateFormatted,
                    'dashboard_url' => $adminUrl,
                    'dashboardUrl' => $adminUrl,
                    'risk_score' => (string)$riskScore,
                    'risk_decision' => $riskDecision,
                    'risk_badge' => $riskBadge
                ];

                $rendered = preg_replace_callback('/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/', function ($matches) use ($context) {
                    $rawVar = $matches[1];
                    $normVar = strtolower(preg_replace('/(?<!^)[A-Z]/', '_$0', $rawVar));
                    $val = $context[$rawVar] ?? ($context[$normVar] ?? null);
                    if ($val === null || $val === false || $val === 'undefined' || $val === 'null') {
                        return '';
                    }
                    return orva_tg_escape((string)$val);
                }, $customTemplate);

                if (mb_strlen($rendered, 'UTF-8') > 4096) {
                    $notice = "\n\n... [تم اقتطاع الرسالة لتجاوز الحد الأقصى]";
                    $maxBody = 4096 - mb_strlen($notice, 'UTF-8');
                    $rendered = mb_substr($rendered, 0, $maxBody, 'UTF-8') . $notice;
                }

                if (trim($rendered) !== '') {
                    $tgMsg = $rendered;
                }
            }

            if ($tgMsg === '') {
                $safeOrderId = orva_tg_escape($orderId);
                $safeName = orva_tg_escape($fullName);
                $safePhone = orva_tg_escape($phone);
                $safeLocation = orva_tg_escape($cleanLocation);
                $safeCommune = orva_tg_escape($commune !== '' ? $commune : 'الجزائر');
                $safeProduct = orva_tg_escape((string)($product['shortTitle'] ?? $product['name'] ?? 'منتج'));
                $safeProductTotal = orva_tg_escape($productTotalStr);
                $safeShipping = orva_tg_escape($shippingFeeStr);
                $safeGrand = orva_tg_escape($grandTotalStr);
                $safeDate = orva_tg_escape($dateFormatted);
                $safeAdminUrl = orva_tg_escape($adminUrl);

                $tgMsg = "🔔 <b>طلب جديد — ORVA STORE</b>\n" .
                         "━━━━━━━━━━━━━━\n" .
                         "🆔 <b>رقم الطلب:</b> <code>#{$safeOrderId}</code>\n" .
                         "👤 <b>اسم العميل:</b> {$safeName}\n" .
                         "📞 <b>الهاتف:</b> <code>{$safePhone}</code>\n" .
                         "📍 <b>الولاية:</b> {$safeLocation}\n" .
                         "🏠 <b>البلدية:</b> {$safeCommune}\n" .
                         "━━━━━━━━━━━━━━\n" .
                         "🛒 <b>تفاصيل المنتجات:</b>\n" .
                         "• {$safeProduct}\n" .
                         "• الكمية: {$quantity}\n" .
                         "• السعر: {$safeProductTotal}\n" .
                         "━━━━━━━━━━━━━━\n" .
                         "💰 <b>سعر المنتجات:</b> {$safeProductTotal}\n" .
                         "🚚 <b>التوصيل:</b> {$safeShipping}\n" .
                         "💵 <b>الإجمالي:</b> <b>{$safeGrand}</b>\n" .
                         "📅 <b>تاريخ الطلب:</b> {$safeDate}\n" .
                         "📌 <b>الحالة:</b> طلب جديد\n" .
                         "━━━━━━━━━━━━━━\n" .
                         "👉 <a href=\"{$safeAdminUrl}\">لوحة التحكم (Admin Dashboard)</a>";
            }

            $tgCh = curl_init("https://api.telegram.org/bot{$tgToken}/sendMessage");
            curl_setopt($tgCh, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($tgCh, CURLOPT_POST, true);
            curl_setopt($tgCh, CURLOPT_POSTFIELDS, json_encode([
                'chat_id' => $tgChatId,
                'text' => $tgMsg,
                'parse_mode' => 'HTML',
                'disable_web_page_preview' => true
            ]));
            curl_setopt($tgCh, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
            curl_setopt($tgCh, CURLOPT_TIMEOUT, 4);
            @curl_exec($tgCh);
            @curl_close($tgCh);

            $ledger[$ledgerKey] = [
                'event' => 'ORDER_CREATED',
                'orderId' => $orderId,
                'trackingCode' => '',
                'status' => 'DISPATCHED',
                'isCustom' => ($customTemplate !== null),
                'timestamp' => gmdate('c')
            ];
            @file_put_contents($ledgerFile, json_encode($ledger, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
        }
    } catch (Throwable $e) {
        error_log('[ORVA send-order] Telegram dispatch skipped: ' . $e->getMessage());
    }
}

// ── 10b. Persist risk event (post-save) ───────────────────────────────────────
try {
    orva_risk_record($riskCtx, $riskResult);
} catch (Throwable $e) {
    error_log('[ORVA send-order] risk event skipped: ' . $e->getMessage());
}

// ── 11. Record Idempotency & Respond ──────────────────────────────────────────
$successResponse = [
    'success' => true,
    'orderId' => $orderId,
    'eventId' => $eventId,
    'sku' => $product['sku'],
    'productName' => $product['name'] ?? $product['title'],
    'quantity' => $quantity,
    'productTotal' => $productTotalStr,
    'shippingFee' => $shippingFeeStr,
    'grandTotal' => $grandTotalStr,
    'deliveryType' => $actualDeliveryType,
    'deliveryTime' => $deliveryTime,
    'riskScore' => $riskScore,
    'riskDecision' => $riskDecision,
    'message' => $riskDecision === 'REVIEW'
        ? 'تم استلام طلبك وسيتم مراجعته قريباً.'
        : 'تم استلام طلبكم بنجاح.'
];

if ($idempotencyKey) {
    $idempRecords = [];
    if (file_exists($idempotencyFile)) {
        $idempRecords = json_decode((string)file_get_contents($idempotencyFile), true) ?? [];
    }
    // Drop entries older than 24h to keep file lean
    $cutoff = time() - 86400;
    foreach ($idempRecords as $k => $row) {
        $ts = strtotime((string)($row['timestamp'] ?? '')) ?: 0;
        if ($ts < $cutoff) {
            unset($idempRecords[$k]);
        }
    }
    $idempRecords[$idempotencyKey] = [
        'timestamp' => gmdate('c'),
        'response' => $successResponse
    ];
    file_put_contents($idempotencyFile, json_encode($idempRecords, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);

    if ($idempLockFp) {
        flock($idempLockFp, LOCK_UN);
        fclose($idempLockFp);
    }
} elseif ($idempLockFp) {
    flock($idempLockFp, LOCK_UN);
    fclose($idempLockFp);
}

http_response_code(200);
echo json_encode($successResponse);
