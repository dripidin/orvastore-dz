<?php
/**
 * ORVA STORE — PHP Risk Engine (Hostinger / LiteSpeed)
 * Port of Services plan ecom trust&risk skill.
 * Implements strict anti-fraud & anti-competitor protections:
 * - Foreign / Non-Algerian check
 * - Max 3 orders per phone
 * - Max 3 orders per device
 * - Max 2 orders per IP
 * - Max 3 quantity per order
 * - Honeypot & rapid submission checks
 */

if (!defined('ORVA_API') && php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('Direct access not permitted.');
}

function orva_risk_config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $cfg = require __DIR__ . '/risk-config.php';
    }
    return $cfg;
}

function orva_risk_hash(string $value): string
{
    return substr(hash('sha256', $value), 0, 32);
}

function orva_risk_hash_ip(?string $ip): string
{
    $ip = trim((string)$ip);
    return $ip === '' ? '' : orva_risk_hash($ip);
}

function orva_risk_normalize_phone(string $phone): string
{
    $digits = preg_replace('/\D+/', '', $phone) ?? '';
    if (str_starts_with($digits, '213') && strlen($digits) >= 11) {
        $digits = '0' . substr($digits, 3);
    } elseif (str_starts_with($digits, '00213') && strlen($digits) >= 13) {
        $digits = '0' . substr($digits, 5);
    }
    return $digits;
}

function orva_risk_read_events(string $file): array
{
    if (!is_file($file)) {
        return [];
    }
    $raw = @file_get_contents($file);
    $data = json_decode((string)$raw, true);
    return is_array($data) ? $data : [];
}

function orva_risk_write_events(string $file, array $events): void
{
    $dir = dirname($file);
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    $tmp = $file . '.tmp';
    file_put_contents($tmp, json_encode(array_values($events), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n", LOCK_EX);
    rename($tmp, $file);
}

function orva_risk_prune(array $events, int $retentionDays): array
{
    $cut = time() - ($retentionDays * 86400);
    return array_values(array_filter($events, static function ($e) use ($cut) {
        $ts = strtotime((string)($e['created_at'] ?? '')) ?: 0;
        return $ts >= $cut;
    }));
}

function orva_risk_score_to_level(int $score, array $cfg): string
{
    if ($score >= (int)$cfg['THRESHOLDS']['HIGH']) {
        return 'HIGH';
    }
    if ($score >= (int)$cfg['THRESHOLDS']['MEDIUM']) {
        return 'MEDIUM';
    }
    return 'LOW';
}

function orva_risk_level_to_decision(string $level, int $score): string
{
    if ($score >= 80) {
        return 'BLOCK';
    }
    if ($level === 'HIGH') {
        return 'REVIEW';
    }
    return 'ALLOW';
}

/**
 * @param array{
 *   storeId?:string,
 *   orderId?:string,
 *   actorPhone?:string,
 *   actorIp?:string,
 *   actorIpHash?:string,
 *   countryCode?:string,
 *   deviceId?:string,
 *   honeypotValue?:string,
 *   formDurationMs?:int|null,
 *   quantity?:int
 * } $ctx
 * @return array{score:int,level:string,decision:string,reasons:array<int,string>,userMessage:string|null}
 */
function orva_risk_evaluate(array $ctx): array
{
    $cfg = orva_risk_config();
    $weights = $cfg['SCORE_WEIGHTS'];
    $eventsFile = $cfg['EVENTS_FILE'];
    $events = orva_risk_prune(orva_risk_read_events($eventsFile), (int)$cfg['RETENTION_DAYS']);
    $since = time() - ((int)$cfg['WINDOW_MINUTES'] * 60);
    $triggered = [];
    $total = 0;
    $userMessage = null;

    // 1. Quantity Check: max 3 items per order
    $quantity = (int)($ctx['quantity'] ?? 1);
    if ($quantity > (int)$cfg['MAX_QUANTITY_PER_ORDER']) {
        $total += (int)$weights['QUANTITY_EXCEEDED'];
        $triggered[] = "Quantity ({$quantity}) exceeds limit of {$cfg['MAX_QUANTITY_PER_ORDER']}";
        $userMessage = 'عذراً، أقصى كمية مسموح بطلبها هي 3 قطع لكل طلبية.';
    }

    // 2. Geographic / Algeria Only Check
    $country = strtoupper(trim((string)($ctx['countryCode'] ?? '')));
    $rawIp = trim((string)($ctx['actorIp'] ?? ''));
    $isLocal = ($rawIp === '127.0.0.1' || $rawIp === '::1' || str_starts_with($rawIp, '192.168.') || str_starts_with($rawIp, '10.'));
    
    if (!$isLocal && $country !== '' && $country !== 'DZ') {
        $total += (int)$weights['NON_ALGERIAN_GEO'];
        $triggered[] = "Non-Algerian IP country detected: {$country}";
        $userMessage = 'نعتذر، خدمة التوصيل متوفرة فقط داخل دولة الجزائر (Algeria).';
    }

    // 3. Honeypot check (Automated bot trap)
    if (trim((string)($ctx['honeypotValue'] ?? '')) !== '') {
        $total += (int)$weights['HONEYPOT_TRIGGERED'];
        $triggered[] = 'Honeypot field triggered (automated submission detected)';
        $userMessage = $userMessage ?? 'عذراً، تعذر إرسال الطلب (كشف نظام الحماية نشاطاً آلياً).';
    }

    // 4. Rapid submission check
    $ms = $ctx['formDurationMs'] ?? null;
    if ($ms !== null && is_numeric($ms)) {
        $secs = ((float)$ms) / 1000.0;
        if ($secs < (float)$cfg['MIN_FORM_SECONDS']) {
            $total += (int)$weights['RAPID_SUBMISSION'];
            $triggered[] = 'Form submitted in ' . round($secs, 1) . 's (suspiciously fast)';
        }
    }

    // 5. Algerian Phone Format check
    $phone = orva_risk_normalize_phone((string)($ctx['actorPhone'] ?? ''));
    if ($phone === '' || !preg_match($cfg['PHONE_REGEX'], $phone)) {
        $total += (int)$weights['INVALID_PHONE_PATTERN'];
        $triggered[] = 'Phone number does not match valid Algerian format (05, 06, 07)';
        $userMessage = $userMessage ?? 'يرجى إدخال رقم هاتف جزائري صحيح يبدأ بـ 05 أو 06 أو 07 ويتكون من 10 أرقام.';
    }

    $createdInWindow = array_filter($events, static function ($e) use ($since) {
        $ts = strtotime((string)($e['created_at'] ?? '')) ?: 0;
        return $ts >= $since && (($e['event_type'] ?? '') === 'REQUEST_CREATED' || ($e['event_type'] ?? '') === 'REQUEST_BLOCKED');
    });

    // 6. Rate Limit by IP (Max 2 per IP in 24h)
    $ipHash = (string)($ctx['actorIpHash'] ?? '');
    if ($ipHash !== '') {
        $ipHits = 0;
        foreach ($createdInWindow as $e) {
            if (($e['ip_hash'] ?? '') === $ipHash) {
                $ipHits++;
            }
        }
        if ($ipHits >= (int)$cfg['MAX_IP_ORDERS']) {
            $total += (int)$weights['IP_LIMIT_EXCEEDED'];
            $triggered[] = "IP rate limit exceeded ({$ipHits} orders from this IP in window)";
            $userMessage = $userMessage ?? 'تم الوصول إلى الحد الأقصى للطلبات من شبكة الإنترنت الحالية (طلبان خلال 24 ساعة).';
        }
    }

    // 7. Rate Limit by Device ID (Max 3 per device in 24h)
    $deviceId = (string)($ctx['deviceId'] ?? '');
    if ($deviceId !== '') {
        $deviceHits = 0;
        foreach ($createdInWindow as $e) {
            if (($e['device_id'] ?? '') === $deviceId) {
                $deviceHits++;
            }
        }
        if ($deviceHits >= (int)$cfg['MAX_DEVICE_ORDERS']) {
            $total += (int)$weights['DEVICE_LIMIT_EXCEEDED'];
            $triggered[] = "Device rate limit exceeded ({$deviceHits} orders from this device in window)";
            $userMessage = $userMessage ?? 'تم الوصول إلى الحد الأقصى للطلبات من هذا الجهاز (3 طلبات خلال 24 ساعة).';
        }
    }

    // 8. Rate Limit by Phone Number (Max 3 per phone in 24h)
    if ($phone !== '') {
        $phoneHits = 0;
        foreach ($createdInWindow as $e) {
            $ePhone = orva_risk_normalize_phone((string)($e['actor_phone'] ?? ''));
            if ($ePhone === $phone || (strlen($phone) >= 8 && str_ends_with($ePhone, substr($phone, -8)))) {
                $phoneHits++;
            }
        }
        if ($phoneHits >= (int)$cfg['MAX_PHONE_ORDERS']) {
            $total += (int)$weights['PHONE_LIMIT_EXCEEDED'];
            $triggered[] = "Phone {$phone} reached max attempts ({$phoneHits} prior)";
            $userMessage = $userMessage ?? 'عذراً، تم تسجيل 3 طلبات بهذا الرقم مسبقاً خلال 24 ساعة. سيتصل بك فريقنا لتأكيد طلبك.';
        } elseif ($phoneHits === 1 || $phoneHits === 2) {
            $total += 10;
            $triggered[] = "Subsequent attempt #{$phoneHits} for phone {$phone}";
        }
    }

    // 9. Multi-device identity (same device, multiple phone numbers)
    if ($deviceId !== '') {
        $phones = [];
        foreach ($events as $e) {
            if (($e['device_id'] ?? '') !== $deviceId) {
                continue;
            }
            $p = orva_risk_normalize_phone((string)($e['actor_phone'] ?? ''));
            if ($p !== '') {
                $phones[$p] = true;
            }
        }
        if (count($phones) >= (int)$cfg['MULTI_DEVICE_THRESHOLD']) {
            $total += (int)$weights['MULTI_DEVICE_IDENTITY'];
            $triggered[] = 'Device linked to ' . count($phones) . ' different phone numbers';
        }
    }

    $score = max(0, min(100, $total));
    $level = orva_risk_score_to_level($score, $cfg);
    $decision = orva_risk_level_to_decision($level, $score);

    return [
        'score' => $score,
        'level' => $level,
        'decision' => $decision,
        'reasons' => $triggered,
        'userMessage' => ($decision === 'BLOCK') ? $userMessage : null
    ];
}

/**
 * Persist a risk event after evaluation.
 */
function orva_risk_record(array $ctx, array $evaluation): void
{
    $cfg = orva_risk_config();
    $file = $cfg['EVENTS_FILE'];
    $events = orva_risk_prune(orva_risk_read_events($file), (int)$cfg['RETENTION_DAYS']);
    $events[] = [
        'event_id' => 'EVT-' . time() . '-' . bin2hex(random_bytes(2)),
        'event_type' => ($evaluation['decision'] ?? '') === 'BLOCK' ? 'REQUEST_BLOCKED' : 'REQUEST_CREATED',
        'store_id' => $ctx['storeId'] ?? 'orvastore',
        'order_id' => $ctx['orderId'] ?? '',
        'actor_phone' => orva_risk_normalize_phone((string)($ctx['actorPhone'] ?? '')),
        'device_id' => (string)($ctx['deviceId'] ?? ''),
        'ip_hash' => (string)($ctx['actorIpHash'] ?? ''),
        'metadata' => [
            'score' => $evaluation['score'] ?? 0,
            'decision' => $evaluation['decision'] ?? 'ALLOW',
            'level' => $evaluation['level'] ?? 'LOW',
            'reasons' => $evaluation['reasons'] ?? [],
        ],
        'created_at' => gmdate('c'),
    ];
    orva_risk_write_events($file, $events);
}