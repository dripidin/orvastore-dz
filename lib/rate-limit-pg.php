<?php
/**
 * Atomic fail-closed rate limit (PHP) — mirrors lib/db.js checkAndRecordRateLimit.
 * 24h window, max 2 attempts by normalized phone OR device_id OR privacy-preserving IP hash.
 */
if (!defined('ORVA_API') && php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('Direct access not permitted.');
}

require_once __DIR__ . '/orva-pg.php';

if (!function_exists('orva_rate_limit_hash_ip')) {
    function orva_rate_limit_hash_ip(string $ip): ?string
    {
        $ip = trim($ip);
        if ($ip === '') {
            return null;
        }
        return substr(hash('sha256', $ip), 0, 32);
    }

    function orva_rate_limit_normalize_phone(string $phone): ?string
    {
        $digits = preg_replace('/\D+/', '', $phone);
        return $digits !== '' ? $digits : null;
    }

    /**
     * @return array{allowed:bool,count:int,message?:string,localBypass?:bool,httpStatus?:int,code?:string}
     */
    function orva_rate_limit_check_and_record(?string $ip, ?string $deviceId, ?string $phone): array
    {
        $denyMsg = 'عذراً، لقد تم تسجيل طلبك مسبقاً (الحد الأقصى محاولتين). سيتصل بك فريقنا لتأكيد طلبك.';
        $ipHash = $ip ? orva_rate_limit_hash_ip($ip) : null;
        $cleanPhone = $phone ? orva_rate_limit_normalize_phone($phone) : null;
        $cleanDevice = $deviceId !== null && trim($deviceId) !== '' ? trim($deviceId) : null;

        // Local fixture isolation (incl. hosted DATABASE_URL refused) — not a live outage fallback.
        if (orva_pg_is_local_unconfigured()) {
            return ['allowed' => true, 'count' => 1, 'localBypass' => true];
        }
        if (!orva_pg_is_configured()) {
            return [
                'allowed' => false,
                'count' => 0,
                'code' => 'RATE_LIMIT_STORAGE_UNAVAILABLE',
                'message' => 'خدمة التحقق غير متاحة حالياً. يرجى المحاولة لاحقاً.',
                'httpStatus' => 503,
            ];
        }

        try {
            $pdo = orva_pg_pdo();
            $rl = orva_pg_table('rate_limits');
            $pdo->beginTransaction();

            $lock = $pdo->prepare('SELECT pg_advisory_xact_lock(hashtext(:k))');
            if ($cleanPhone) {
                $lock->execute(['k' => 'orva-rl:phone:' . $cleanPhone]);
            }
            if ($cleanDevice) {
                $lock->execute(['k' => 'orva-rl:device:' . $cleanDevice]);
            }
            if ($ipHash) {
                $lock->execute(['k' => 'orva-rl:ip:' . $ipHash]);
            }

            $countStmt = $pdo->prepare(
                "SELECT COUNT(*)::int AS c FROM {$rl}
                 WHERE created_at >= NOW() - INTERVAL '24 hours'
                   AND (
                     (:phone::text IS NOT NULL AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = :phone)
                     OR (:device::text IS NOT NULL AND device_id = :device)
                     OR (:ip::text IS NOT NULL AND ip = :ip)
                   )"
            );
            $countStmt->execute([
                'phone' => $cleanPhone,
                'device' => $cleanDevice,
                'ip' => $ipHash,
            ]);
            $count = (int)$countStmt->fetchColumn();
            if ($count >= 2) {
                $pdo->commit();
                return ['allowed' => false, 'count' => $count, 'message' => $denyMsg, 'httpStatus' => 429];
            }

            $ins = $pdo->prepare(
                "INSERT INTO {$rl} (ip, device_id, phone, created_at) VALUES (:ip, :device, :phone, NOW())"
            );
            $ins->execute([
                'ip' => $ipHash,
                'device' => $cleanDevice,
                'phone' => $cleanPhone,
            ]);
            $pdo->commit();
            return ['allowed' => true, 'count' => $count + 1];
        } catch (Throwable $e) {
            if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            error_log('[orva_rate_limit] ' . $e->getMessage());
            return [
                'allowed' => false,
                'count' => 0,
                'code' => 'RATE_LIMIT_STORAGE_UNAVAILABLE',
                'message' => 'خدمة التحقق غير متاحة حالياً. يرجى المحاولة لاحقاً.',
                'httpStatus' => 503,
            ];
        }
    }
}
