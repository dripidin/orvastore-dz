<?php
// ==============================================================================
// ORVA STORE — Admin Session Store + Login Lockout (PHP 8.3)
// Random session IDs; password never accepted as Bearer/cookie credential.
// ==============================================================================

if (!defined('ORVA_API') && php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('Direct access not permitted.');
}

if (!function_exists('orva_admin_session_paths')) {
    function orva_admin_session_paths(): array
    {
        $root = dirname(__DIR__);
        $private = $root . '/data/private';
        if (!is_dir($private)) {
            @mkdir($private, 0700, true);
        }
        $locks = $root . '/data/locks';
        if (!is_dir($locks)) {
            @mkdir($locks, 0755, true);
        }
        return [
            'sessions' => $private . '/admin-sessions.json',
            'lockouts' => $locks . '/auth-lockouts.json',
        ];
    }

    function orva_admin_read_json(string $file): array
    {
        if (!file_exists($file)) {
            return [];
        }
        $raw = @file_get_contents($file);
        $data = json_decode($raw ?: '[]', true);
        return is_array($data) ? $data : [];
    }

    function orva_admin_write_json(string $file, array $data): bool
    {
        $dir = dirname($file);
        if (!is_dir($dir)) {
            @mkdir($dir, 0700, true);
        }
        $tmp = $file . '.' . getmypid() . '.' . bin2hex(random_bytes(3)) . '.tmp';
        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        if ($json === false || @file_put_contents($tmp, $json, LOCK_EX) === false) {
            @unlink($tmp);
            return false;
        }
        if (!@rename($tmp, $file)) {
            if (!@copy($tmp, $file)) {
                @unlink($tmp);
                return false;
            }
            @unlink($tmp);
        }
        @chmod($file, 0600);
        return true;
    }

    function orva_admin_client_ip(): string
    {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
        return preg_replace('/[^0-9a-fA-F:.]/', '', (string)$ip) ?: '0.0.0.0';
    }

    function orva_admin_lockout_key(): string
    {
        return hash('sha256', 'orva-auth|' . orva_admin_client_ip());
    }

    /**
     * @return array{locked:bool,retryAfter?:int}
     */
    function orva_admin_check_lockout(): array
    {
        $paths = orva_admin_session_paths();
        $all = orva_admin_read_json($paths['lockouts']);
        $key = orva_admin_lockout_key();
        $row = $all[$key] ?? null;
        if (!is_array($row)) {
            return ['locked' => false];
        }
        $until = (int)($row['lockedUntil'] ?? 0);
        if ($until > time()) {
            return ['locked' => true, 'retryAfter' => $until - time()];
        }
        return ['locked' => false];
    }

    function orva_admin_record_failed_login(): void
    {
        $paths = orva_admin_session_paths();
        $all = orva_admin_read_json($paths['lockouts']);
        $key = orva_admin_lockout_key();
        $row = is_array($all[$key] ?? null) ? $all[$key] : ['failures' => 0, 'lockedUntil' => 0];
        $failures = (int)($row['failures'] ?? 0) + 1;
        $row['failures'] = $failures;
        $row['lastFailureAt'] = gmdate('c');
        if ($failures >= 5) {
            $row['lockedUntil'] = time() + 15 * 60;
            $row['failures'] = 0;
        }
        $all[$key] = $row;
        // Prune old lockout rows (> 24h)
        foreach ($all as $k => $v) {
            if (!is_array($v)) {
                unset($all[$k]);
                continue;
            }
            $lockedUntil = (int)($v['lockedUntil'] ?? 0);
            $last = strtotime((string)($v['lastFailureAt'] ?? '')) ?: 0;
            if ($lockedUntil < time() && $last < time() - 86400) {
                unset($all[$k]);
            }
        }
        orva_admin_write_json($paths['lockouts'], $all);
    }

    function orva_admin_clear_lockout(): void
    {
        $paths = orva_admin_session_paths();
        $all = orva_admin_read_json($paths['lockouts']);
        $key = orva_admin_lockout_key();
        if (isset($all[$key])) {
            unset($all[$key]);
            orva_admin_write_json($paths['lockouts'], $all);
        }
    }

    function orva_admin_create_session(int $ttlSeconds = 28800): string
    {
        $paths = orva_admin_session_paths();
        $all = orva_admin_read_json($paths['sessions']);
        $now = time();
        foreach ($all as $sid => $meta) {
            if (!is_array($meta) || (int)($meta['expiresAt'] ?? 0) <= $now) {
                unset($all[$sid]);
            }
        }
        $sessionId = bin2hex(random_bytes(32));
        $all[$sessionId] = [
            'createdAt' => gmdate('c'),
            'expiresAt' => $now + $ttlSeconds,
            'ipHash' => hash('sha256', orva_admin_client_ip()),
        ];
        orva_admin_write_json($paths['sessions'], $all);
        return $sessionId;
    }

    function orva_admin_destroy_session(?string $sessionId): void
    {
        $sessionId = trim((string)$sessionId);
        if ($sessionId === '') {
            return;
        }
        $paths = orva_admin_session_paths();
        $all = orva_admin_read_json($paths['sessions']);
        if (isset($all[$sessionId])) {
            unset($all[$sessionId]);
            orva_admin_write_json($paths['sessions'], $all);
        }
    }

    function orva_admin_session_is_valid(?string $sessionId): bool
    {
        $sessionId = trim((string)$sessionId);
        if ($sessionId === '' || strlen($sessionId) < 32) {
            return false;
        }
        $paths = orva_admin_session_paths();
        $all = orva_admin_read_json($paths['sessions']);
        $meta = $all[$sessionId] ?? null;
        if (!is_array($meta)) {
            return false;
        }
        if ((int)($meta['expiresAt'] ?? 0) <= time()) {
            unset($all[$sessionId]);
            orva_admin_write_json($paths['sessions'], $all);
            return false;
        }
        return true;
    }

    /**
     * Authorize admin request.
     * Accepts:
     *  - Bearer ADMIN_API_TOKEN (machine/API clients)
     *  - Cookie orva_admin_session matching a live random session
     *  - Legacy cookie equal to ADMIN_API_TOKEN (transition only)
     * Never accepts ADMIN_PASSWORD as Bearer or cookie.
     *
     * @return array{ok:bool,type:string}
     */
    function orva_admin_authorize(string $expectedToken): array
    {
        $expectedToken = trim($expectedToken);
        $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if ($authHeader === '' && function_exists('apache_request_headers')) {
            $headers = apache_request_headers();
            $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
        }

        if (preg_match('/Bearer\s+(\S+)/i', $authHeader, $matches)) {
            $token = trim($matches[1]);
            if ($expectedToken !== '' && hash_equals($expectedToken, $token)) {
                return ['ok' => true, 'type' => 'bearer'];
            }
            // Password must never authenticate as Bearer
            return ['ok' => false, 'type' => ''];
        }

        $cookieVal = trim((string)($_COOKIE['orva_admin_session'] ?? ''));
        if ($cookieVal === '') {
            return ['ok' => false, 'type' => ''];
        }

        if (orva_admin_session_is_valid($cookieVal)) {
            return ['ok' => true, 'type' => 'cookie'];
        }

        // Legacy compatibility: older deployments stored ADMIN_API_TOKEN in the cookie
        if ($expectedToken !== '' && hash_equals($expectedToken, $cookieVal)) {
            return ['ok' => true, 'type' => 'cookie_legacy'];
        }

        return ['ok' => false, 'type' => ''];
    }
}
