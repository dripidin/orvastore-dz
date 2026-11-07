<?php
/**
 * ORVA STORE — PHP Risk Engine (Hostinger path)
 * Port of Services plan ecom riskEngine.js for LiteSpeed/PHP orders.
 * Stores events in data/risk-events.json (no Redis / no extra deps).
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
    if (str_starts_with($digits, '213') && strlen($digits) >= 12) {
        $digits = '0' . substr($digits, 3);
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
 * @param array{storeId?:string,orderId?:string,actorPhone?:string,actorIpHash?:string,deviceId?:string,honeypotValue?:string,formDurationMs?:int|null} $ctx
 * @return array{score:int,level:string,decision:string,reasons:array<int,string>}
 */
function orva_risk_evaluate(array $ctx): array
{
    $cfg = orva_risk_config();
    $weights = $cfg['SCORE_WEIGHTS'];
    $eventsFile = $cfg['EVENTS_FILE'];
    $events = orva_risk_prune(orva_risk_read_events($eventsFile), (int)$cfg['RETENTION_DAYS']);
    $since = time() - ((int)$cfg['RATE_LIMIT']['windowMinutes'] * 60);
    $triggered = [];
    $total = 0;

    // Honeypot
    if (trim((string)($ctx['honeypotValue'] ?? '')) !== '') {
        $total += (int)$weights['HONEYPOT_TRIGGERED'];
        $triggered[] = 'Honeypot field triggered (automated submission detected)';
    }

    // Rapid submission
    $ms = $ctx['formDurationMs'] ?? null;
    if ($ms !== null && is_numeric($ms)) {
        $secs = ((float)$ms) / 1000.0;
        if ($secs < (float)$cfg['MIN_FORM_SECONDS']) {
            $total += (int)$weights['RAPID_SUBMISSION'];
            $triggered[] = 'Form submitted in ' . round($secs, 1) . 's (suspiciously fast)';
        }
    }

    // Invalid Algerian phone
    $phone = orva_risk_normalize_phone((string)($ctx['actorPhone'] ?? ''));
    if ($phone !== '' && !preg_match($cfg['PHONE_REGEX'], $phone)) {
        $total += (int)$weights['INVALID_PHONE_PATTERN'];
        $triggered[] = 'Phone number does not match Algerian format';
    }

    $createdInWindow = array_filter($events, static function ($e) use ($since) {
        $ts = strtotime((string)($e['created_at'] ?? '')) ?: 0;
        return $ts >= $since && (($e['event_type'] ?? '') === 'REQUEST_CREATED' || ($e['event_type'] ?? '') === 'REQUEST_BLOCKED');
    });

    // Rate limit by IP hash / device
    $ipHash = (string)($ctx['actorIpHash'] ?? '');
    $deviceId = (string)($ctx['deviceId'] ?? '');
    $rateHits = 0;
    foreach ($createdInWindow as $e) {
        if (($ipHash !== '' && ($e['ip_hash'] ?? '') === $ipHash)
            || ($deviceId !== '' && ($e['device_id'] ?? '') === $deviceId)) {
            $rateHits++;
        }
    }
    if ($rateHits >= (int)$cfg['RATE_LIMIT']['maxRequests']) {
        $total += (int)$weights['RATE_LIMIT_HIT'];
        $triggered[] = "Rate limit exceeded ({$rateHits} orders in window)";
    }

    // Repeated phone
    if ($phone !== '') {
        $phoneHits = 0;
        foreach ($createdInWindow as $e) {
            $ePhone = orva_risk_normalize_phone((string)($e['actor_phone'] ?? ''));
            if ($ePhone === $phone || (strlen($phone) >= 8 && str_ends_with($ePhone, substr($phone, -8)))) {
                $phoneHits++;
            }
        }
        if ($phoneHits >= (int)$cfg['RATE_LIMIT']['maxRequests']) {
            $total += (int)$weights['REPEATED_PHONE'];
            $triggered[] = "Phone {$phone} reached max attempts ({$phoneHits} prior)";
        } elseif ($phoneHits === 1) {
            $total += 15;
            $triggered[] = "Second attempt for phone {$phone}";
        }
    }

    // Previous rejection / block
    foreach ($events as $e) {
        $type = (string)($e['event_type'] ?? '');
        if ($type !== 'REQUEST_REJECTED' && $type !== 'ACTOR_BLOCKED' && $type !== 'REQUEST_BLOCKED') {
            continue;
        }
        $match = false;
        if ($phone !== '' && orva_risk_normalize_phone((string)($e['actor_phone'] ?? '')) === $phone) {
            $match = true;
        }
        if ($deviceId !== '' && ($e['device_id'] ?? '') === $deviceId) {
            $match = true;
        }
        if ($match) {
            $total += (int)$weights['PREVIOUS_REJECTION'];
            $triggered[] = 'Actor has prior rejected/blocked requests';
            break;
        }
    }

    // Multi-device identity (same device, many phones)
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
