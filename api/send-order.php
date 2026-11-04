<?php
// ==============================================================================
// ORVA STORE — Native PHP 8.3 Order Dispatcher for Hostinger LiteSpeed
// Phase 8C.1: Dynamic Catalog, Key-Based Idempotency, Atomic Inventory Parity
// ==============================================================================

define('ORVA_API', true);
$config = require __DIR__ . '/config.php';

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

// ── 2. Anti-Spam / Honeypot Filter ────────────────────────────────────────────
if (!empty($data['honeypot'])) {
    http_response_code(200);
    echo json_encode([
        'success' => true,
        'orderId' => 'BOT_DISCARDED',
        'message' => 'Order received.'
    ]);
    exit;
}

$rootDir = dirname(__DIR__);
$catalogFile = $rootDir . '/data/products-catalog.json';
$tariffsFile = $rootDir . '/data/wilayas-tariffs.json';
$inventoryFile = $rootDir . '/data/inventory-state.json';
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
    $idempotencyKey = $data['idempotencyKey'] ?? ($data['idempotency_key'] ?? ($data['orderId'] ?? null));
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
        $idempRecords = json_decode(file_get_contents($idempotencyFile), true) ?? [];
        if (isset($idempRecords[$idempotencyKey])) {
            if ($idempLockFp) {
                flock($idempLockFp, LOCK_UN);
                fclose($idempLockFp);
            }
            $stored = $idempRecords[$idempotencyKey]['response'] ?? $idempRecords[$idempotencyKey];
            $stored['idempotent'] = true;
            http_response_code(200);
            echo json_encode($stored);
            exit;
        }
    }
}

// ── 4. Authoritative Dynamic Product Catalog ──────────────────────────────────
$catalog = [];
if (file_exists($catalogFile)) {
    $catalogData = json_decode(file_get_contents($catalogFile), true) ?? [];
    $catalog = $catalogData['products'] ?? [];
    $aliases = $catalogData['aliases'] ?? [];
} else {
    // Fallback baseline
    $catalog = [
        'orva-p1-pro' => ['sku' => 'ORVA-P1-PRO', 'name' => 'PACK 4EN1 4950', 'shortTitle' => 'عرض 4 في 1', 'sellingPrice' => 4950, 'status' => 'active', 'allowOrders' => true],
        'orva-p2-elite' => ['sku' => 'ORVA-P2-ELITE', 'name' => 'PACK 5EN1 13390', 'shortTitle' => 'عرض 5 في 1', 'sellingPrice' => 13390, 'status' => 'active', 'allowOrders' => true],
        'orva-p3-ultra' => ['sku' => 'ORVA-P3-ULTRA', 'name' => 'PACK 3 ULTRA 15950', 'shortTitle' => 'عرض 6 في 1', 'sellingPrice' => 15950, 'status' => 'active', 'allowOrders' => true],
        'orva-sac-yam' => ['sku' => 'ORVA-SAC-YAM', 'name' => 'SAC BANANE YAMAHA 4400', 'shortTitle' => 'حقيبة ياماها', 'sellingPrice' => 4400, 'status' => 'active', 'allowOrders' => true],
        'orva-sac-bundle' => ['sku' => 'ORVA-SAC-BUNDLE', 'name' => 'SAC YAMAHA BUNDLE 4900', 'shortTitle' => 'عرض حقيبة ياماها', 'sellingPrice' => 4900, 'status' => 'active', 'allowOrders' => true]
    ];
    $aliases = [
        'pack1' => 'orva-p1-pro', 'pack2' => 'orva-p2-elite', 'pack3' => 'orva-p3-ultra', 'yamaha' => 'orva-sac-yam'
    ];
}

// ── 5. Authoritative 58 Wilayas Tariff Engine ─────────────────────────────────
$wilayas = [];
if (file_exists($tariffsFile)) {
    $wilayas = json_decode(file_get_contents($tariffsFile), true) ?? [];
}

// ── 6. Field Extraction & Validation ──────────────────────────────────────────
$fullName     = trim((string)($data['fullName'] ?? ''));
$phone        = trim((string)($data['phone'] ?? ''));
$rawWilaya    = trim((string)($data['wilaya'] ?? ''));
$commune      = trim((string)($data['commune'] ?? ''));
$deliveryType = trim((string)($data['deliveryType'] ?? ''));
$quantity     = $data['quantity'] ?? 1;
$orderId      = trim((string)($data['orderId'] ?? ($idempotencyKey ?: ('ORVA-' . rand(10000, 99999)))));
$eventId      = trim((string)($data['eventId'] ?? $data['event_id'] ?? ('order_' . $orderId . '_' . time())));

// Validate Name
if (mb_strlen($fullName, 'UTF-8') < 3) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'INVALID_FULL_NAME', 'message' => 'يرجى كتابة الاسم الكامل بشكل صحيح (3 أحرف على الأقل).']);
    exit;
}

// Validate Phone
$cleanPhone = preg_replace('/[\s\-\.]/', '', $phone);
if (!preg_match('/^(?:0|\+?213)(5|6|7)[0-9]{8}$/', $cleanPhone)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'INVALID_PHONE', 'message' => 'رقم الهاتف غير صالح. يرجى إدخال رقم هاتف جزائري (05/06/07).']);
    exit;
}

// Validate Quantity (1 to 10 integer)
if (!is_numeric($quantity) || (int)$quantity != $quantity || (int)$quantity < 1 || (int)$quantity > 10) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'INVALID_QUANTITY', 'message' => 'الكمية المطلوبة يجب أن تكون عدداً صحيحاً بين 1 و 10 قطع.']);
    exit;
}
$quantity = (int)$quantity;

// Resolve Product
$reqIdent = strtolower(trim((string)($data['sku'] ?? $data['productId'] ?? $data['packId'] ?? $data['productName'] ?? '')));
$catalogKey = null;

if (isset($catalog[$reqIdent])) {
    $catalogKey = $reqIdent;
} elseif (isset($aliases[$reqIdent])) {
    $catalogKey = $aliases[$reqIdent];
} else {
    foreach ($aliases as $alias => $target) {
        if (str_contains($reqIdent, $alias)) {
            $catalogKey = $target;
            break;
        }
    }
}

if (!$catalogKey || !isset($catalog[$catalogKey])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'PRODUCT_UNAVAILABLE', 'message' => 'المنتج المطلوب غير متاح في الكتالوج.']);
    exit;
}

$product = $catalog[$catalogKey];
if ($product['status'] === 'archived' || $product['status'] === 'draft' || empty($product['allowOrders'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'PRODUCT_INACTIVE', 'message' => 'هذا المنتج متوقف حالياً عن البيع.']);
    exit;
}

// Resolve Wilaya
$selectedWilaya = null;
$wNum = (int)$rawWilaya;
foreach ($wilayas as $w) {
    if (($wNum >= 1 && $w['id'] === $wNum) ||
        str_contains($rawWilaya, $w['name']) ||
        str_contains($rawWilaya, $w['canonicalName'])) {
        $selectedWilaya = $w;
        break;
    }
}

if (!$selectedWilaya) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'INVALID_WILAYA', 'message' => 'يرجى اختيار ولاية صحيحة من قائمة الـ 58 ولاية.']);
    exit;
}

// Resolve Delivery Method & Tariff
$isStopdesk = (
    str_contains(strtolower($deliveryType), 'desk') ||
    str_contains(strtolower($deliveryType), 'stop') ||
    str_contains($deliveryType, 'مكتب')
);

$authoritativeShipping = 500;
$actualDeliveryType = 'توصيل للمنزل';

if ($isStopdesk) {
    if ($selectedWilaya['stopdesk'] !== null) {
        $authoritativeShipping = $selectedWilaya['stopdesk'];
        $actualDeliveryType = 'توصيل للمكتب (Stop Desk)';
    } else {
        $authoritativeShipping = $selectedWilaya['domicile'];
        $actualDeliveryType = 'توصيل للمنزل (Stop Desk غير متوفر)';
    }
} else {
    $authoritativeShipping = $selectedWilaya['domicile'];
    $actualDeliveryType = 'توصيل للمنزل';
}

// Authoritative Financial Calculation
$unitPrice = $product['sellingPrice'] ?? ($product['price'] ?? 4950);
$calculatedProductTotal = $unitPrice * $quantity;
$calculatedGrandTotal = $calculatedProductTotal + $authoritativeShipping;

$productTotalStr = $calculatedProductTotal . ' د.ج';
$shippingFeeStr  = $authoritativeShipping . ' د.ج';
$grandTotalStr   = $calculatedGrandTotal . ' د.ج';
$deliveryTime    = $selectedWilaya['time'];

$cleanLocation = $selectedWilaya['canonicalName'];
if (!empty($commune) && !str_contains($cleanLocation, $commune)) {
    $cleanLocation .= ' — ' . $commune;
}

// ── 7. Atomic Inventory Reservation ───────────────────────────────────────────
$sku = $product['sku'];
$invLockFile = $locksDir . '/inventory.lock';
$invLockFp = fopen($invLockFile, 'c+');
if ($invLockFp) {
    flock($invLockFp, LOCK_EX);
}

$invState = ['inventory' => [], 'reservations' => []];
if (file_exists($inventoryFile)) {
    $invState = json_decode(file_get_contents($inventoryFile), true) ?? ['inventory' => [], 'reservations' => []];
    if (!isset($invState['reservations'])) $invState['reservations'] = [];
}
if (!isset($invState['inventory'][$sku])) {
    $invState['inventory'][$sku] = [
        'sku' => $sku,
        'available' => 20,
        'reserved' => 0,
        'totalPhysical' => 20
    ];
}

$invItem = &$invState['inventory'][$sku];

// Idempotent check by orderId: if already reserved, don't decrement available again
$alreadyReserved = false;
if (isset($invState['reservations'][$orderId]) && $invState['reservations'][$orderId]['status'] === 'RESERVED') {
    $alreadyReserved = true;
}

if (!$alreadyReserved) {
    if ($invItem['available'] < $quantity) {
        if ($invLockFp) { flock($invLockFp, LOCK_UN); fclose($invLockFp); }
        if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'error' => 'INSUFFICIENT_STOCK',
            'message' => 'عذراً، الكمية المطلوبة غير متوفرة حالياً في المخزون.'
        ]);
        exit;
    }

    // Reserve stock atomically
    $invItem['available'] -= $quantity;
    $invItem['reserved'] += $quantity;
    $invState['reservations'][$orderId] = [
        'sku' => $sku,
        'quantity' => $quantity,
        'status' => 'RESERVED',
        'timestamp' => gmdate('c')
    ];
    $invState['lastUpdated'] = gmdate('c');
    file_put_contents($inventoryFile, json_encode($invState, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

if ($invLockFp) {
    flock($invLockFp, LOCK_UN);
    fclose($invLockFp);
}

// ── 8. Save Order to Database ─────────────────────────────────────────────────
$supabaseUrl = rtrim($config['supabase']['url'], '/') . '/rest/v1/orders';
$supabaseResp = orva_supabase_rest_request('POST', $supabaseUrl, [
    'order_id'            => $orderId,
    'store_id'            => 'orvastore',
    'full_name'           => $fullName,
    'phone'               => $phone,
    'wilaya'              => $cleanLocation,
    'commune'             => $commune ?: 'غير محدد',
    'delivery_type'       => $actualDeliveryType,
    'delivery_time'       => $deliveryTime,
    'quantity'            => $quantity,
    'product_name'        => $product['name'] ?? $product['title'],
    'product_total'       => $productTotalStr,
    'shipping_fee'        => $shippingFeeStr,
    'price_num'           => $calculatedGrandTotal,
    'grand_total'         => $grandTotalStr,
    'status'              => 'pending',
    'in_redex'            => false,
    'redex_tracking_code' => null
], $config, '', ['Prefer: return=minimal']);

$supabaseHttp = $supabaseResp['code'];

// Verify persistence succeeded
if ($supabaseHttp !== 200 && $supabaseHttp !== 201) {
    // Roll back inventory reservation using static shared inventory lock
    $invLockFp = fopen($invLockFile, 'c+');
    if ($invLockFp) flock($invLockFp, LOCK_EX);
    $invState = json_decode(file_get_contents($inventoryFile), true) ?? ['inventory' => [], 'reservations' => []];
    if (isset($invState['reservations'][$orderId]) && $invState['reservations'][$orderId]['status'] === 'RESERVED') {
        $invState['reservations'][$orderId]['status'] = 'RELEASED';
        $invState['reservations'][$orderId]['releasedAt'] = gmdate('c');
        $invState['reservations'][$orderId]['releaseReason'] = 'STORAGE_FAILURE_ROLLBACK';
        if (isset($invState['inventory'][$sku])) {
            $invState['inventory'][$sku]['reserved'] = max(0, $invState['inventory'][$sku]['reserved'] - $quantity);
            $invState['inventory'][$sku]['available'] = min($invState['inventory'][$sku]['totalPhysical'], $invState['inventory'][$sku]['available'] + $quantity);
        }
        $invState['lastUpdated'] = gmdate('c');
        file_put_contents($inventoryFile, json_encode($invState, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    }
    if ($invLockFp) { flock($invLockFp, LOCK_UN); fclose($invLockFp); }
    if ($idempLockFp) { flock($idempLockFp, LOCK_UN); fclose($idempLockFp); }

    http_response_code(503);
    echo json_encode([
        'success' => false,
        'error' => 'STORAGE_UNAVAILABLE',
        'message' => 'تعذر حفظ الطلب في قاعدة البيانات. يرجى المحاولة لاحقاً.'
    ]);
    exit;
}

// ── 9. Decoupled Notifications with Deduplication Ledger & Templates (Phase 8D/8F) ──
$tgToken   = $config['telegram']['bot_token'] ?? '';
$tgChatId  = $config['telegram']['chat_id'] ?? '';
$tgEnabled = $config['telegram']['enabled'] ?? true;

if ($tgToken && $tgChatId && $tgEnabled) {
    $ledgerFile = __DIR__ . '/../data/telegram-dispatch-ledger.json';
    $ledgerKey = "ORDER_CREATED_{$orderId}_none";
    $ledger = [];
    if (file_exists($ledgerFile)) {
        $ledger = json_decode(file_get_contents($ledgerFile), true) ?? [];
    }

    if (!isset($ledger[$ledgerKey])) {
        // 1. Mask customer phone for administrative privacy
        $maskedPhone = $phone;
        if (strlen($phone) >= 8) {
            $maskedPhone = substr($phone, 0, 3) . '***' . substr($phone, -4);
        }

        $dateFormatted = date('Y-m-d H:i');
        $adminUrl = "https://orva-store.com/admin.html?orderId=" . urlencode($orderId);

        // 2. Resolve Custom Active Template for ORDER_CREATED
        $customTemplate = null;
        $templates = $config['telegram']['templates'] ?? [];
        if (isset($templates['ORDER_CREATED']) && is_array($templates['ORDER_CREATED'])) {
            $tplConf = $templates['ORDER_CREATED'];
            if (($tplConf['enabled'] ?? true) && !empty($tplConf['activeTemplate']) && trim($tplConf['activeTemplate']) !== '') {
                $customTemplate = trim($tplConf['activeTemplate']);
            }
        }

        $tgMsg = '';
        if ($customTemplate !== null) {
            // Context variables map with canonical keys & common aliases
            $context = [
                'order_id' => $orderId,
                'orderId' => $orderId,
                'id' => $orderId,
                'customer_name' => $fullName,
                'customerName' => $fullName,
                'fullName' => $fullName,
                'name' => $fullName,
                'customer_phone' => $maskedPhone,
                'customerPhone' => $maskedPhone,
                'phone' => $maskedPhone,
                'maskedPhone' => $maskedPhone,
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
                'commune' => $commune ?: '',
                'city' => $commune ?: '',
                'delivery_type' => $actualDeliveryType,
                'deliveryType' => $actualDeliveryType,
                'delivery_time' => $deliveryTime,
                'deliveryTime' => $deliveryTime,
                'date' => $dateFormatted,
                'dateTime' => $dateFormatted,
                'dashboard_url' => $adminUrl,
                'dashboardUrl' => $adminUrl,
                'risk_score' => (string)($riskScore ?? 0),
                'risk_decision' => (string)($riskDecision ?? 'ALLOW'),
                'risk_badge' => ''
            ];

            // Render template and escape dynamic variable values
            $rendered = preg_replace_callback('/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/', function($matches) use ($context) {
                $rawVar = $matches[1];
                $normVar = strtolower(preg_replace('/(?<!^)[A-Z]/', '_$0', $rawVar));
                $val = $context[$rawVar] ?? ($context[$normVar] ?? null);
                if ($val === null || $val === false || $val === 'undefined' || $val === 'null') {
                    return '';
                }
                return htmlspecialchars((string)$val, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
            }, $customTemplate);

            // Length cap at 4,096 chars
            if (mb_strlen($rendered, 'UTF-8') > 4096) {
                $notice = "\n\n... [تم اقتطاع الرسالة لتجاوز الحد الأقصى]";
                $maxBody = 4096 - mb_strlen($notice, 'UTF-8');
                $rendered = mb_substr($rendered, 0, $maxBody, 'UTF-8') . $notice;
            }

            if (trim($rendered) !== '') {
                $tgMsg = $rendered;
            }
        }

        // 3. Transparent Fallback to Default Message if template disabled/missing/empty
        if (empty($tgMsg)) {
            $tgMsg = "👑 <b>طلب جديد: {$product['shortTitle']} — " . number_format($calculatedGrandTotal) . " د.ج</b>\n" .
                     "━━━━━━━━━━━━━━━━━━\n" .
                     "<b>🆔 رقم الطلب:</b> <code>{$orderId}</code>\n" .
                     "<b>👤 الاسم:</b> {$fullName}\n" .
                     "<b>📱 الهاتف:</b> <code>{$maskedPhone}</code>\n" .
                     "<b>📍 المكان:</b> {$cleanLocation}\n" .
                     "<b>🚚 التوصيل:</b> {$actualDeliveryType}\n" .
                     "<b>⚡ المدة:</b> {$deliveryTime}\n" .
                     "<b>📦 العرض والكمية:</b> {$quantity} قطعة — <b>{$product['shortTitle']}</b>\n" .
                     "<b>💵 سعر العرض:</b> {$productTotalStr}\n" .
                     "<b>🚚 مصاريف التوصيل:</b> {$shippingFeeStr}\n" .
                     "━━━━━━━━━━━━━━━━━━\n" .
                     "<b>💰 المجموع الكلي (COD):</b> <b>{$grandTotalStr}</b>\n" .
                     "<b>📅 التاريخ:</b> {$dateFormatted}\n" .
                     "━━━━━━━━━━━━━━━━━━\n" .
                     "📌 <b>الطلبية محفوظة في قاعدة البيانات وجاهزة للتأكيد.</b>\n" .
                     "👉 <a href=\"{$adminUrl}\">لوحة التحكم (Admin Dashboard)</a>";
        }

        // 4. Safe Non-blocking HTTP Dispatch via cURL
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

        // 5. Deduplication Ledger Recording
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
}

// ── 10. Record Idempotency & Respond ──────────────────────────────────────────
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
    'message' => 'تم استلام طلبكم بنجاح.'
];

if ($idempotencyKey) {
    $idempRecords = [];
    if (file_exists($idempotencyFile)) {
        $idempRecords = json_decode(file_get_contents($idempotencyFile), true) ?? [];
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
}

http_response_code(200);
echo json_encode($successResponse);
