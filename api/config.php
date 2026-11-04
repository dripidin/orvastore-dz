<?php
// ==============================================================================
// ORVA STORE — Server Configuration for Hostinger LiteSpeed (PHP 8.3)
// Security: Direct web access is blocked by .htaccess and the check below.
// Phase 8D: Dynamic environment credentials; legacy secrets decommissioned.
// Phase 8D.1: AES-256-GCM dynamic credential store integration.
// ==============================================================================

if (!defined('ORVA_API')) {
    http_response_code(403);
    exit('Direct access not permitted.');
}

$config = [
    // ── Runtime Environment ──────────────────────────────────────────────────
    'app_env' => getenv('APP_ENV') ?: ($_ENV['APP_ENV'] ?? 'production'),

    // ── Supabase Cloud Database ──────────────────────────────────────────────
    'supabase' => [
        'url' => getenv('SUPABASE_URL') ?: ($_ENV['SUPABASE_URL'] ?? 'https://olmsjkhdfghyydogcvvy.supabase.co'),
        'anon_key' => getenv('SUPABASE_ANON_KEY') ?: ($_ENV['SUPABASE_ANON_KEY'] ?? 'sb_publishable_7c9dtcV6aM5B32hwxWxPGw_JLLC7tmu'),
        'schema' => getenv('SUPABASE_SCHEMA') ?: ($_ENV['SUPABASE_SCHEMA'] ?? 'public'),
        'staging_token' => getenv('SUPABASE_STAGING_TOKEN') ?: ($_ENV['SUPABASE_STAGING_TOKEN'] ?? ''),
    ],

    // ── Telegram Instant Order Notifications ──────────────────────────────────
    'telegram' => [
        'bot_token' => getenv('TELEGRAM_BOT_TOKEN') ?: ($_ENV['TELEGRAM_BOT_TOKEN'] ?? ''),
        'chat_id' => getenv('TELEGRAM_CHAT_ID') ?: ($_ENV['TELEGRAM_CHAT_ID'] ?? ''),
    ],

    // ── Meta Conversions API (CAPI) ──────────────────────────────────────────
    // Legacy Pixel ID decommissioned. Dynamic configuration required.
    'meta' => [
        'pixel_id' => getenv('META_PIXEL_ID') ?: ($_ENV['META_PIXEL_ID'] ?? ''),
        'access_token' => getenv('META_ACCESS_TOKEN') ?: ($_ENV['META_ACCESS_TOKEN'] ?? ''),
    ],

    // ── Courier Gateway (Ecotrack / RedEx) ────────────────────────────────────
    'ecotrack' => [
        'base_url' => getenv('ECOTRACK_API_BASE_URL') ?: ($_ENV['ECOTRACK_API_BASE_URL'] ?? 'https://redex.ecotrack.dz'),
        'api_token' => getenv('ECOTRACK_API_TOKEN') ?: (getenv('REDEX_API_TOKEN') ?: ($_ENV['ECOTRACK_API_TOKEN'] ?? ($_ENV['REDEX_API_TOKEN'] ?? ''))),
    ],

    'redex' => [
        'base_url' => getenv('REDEX_API_BASE_URL') ?: ($_ENV['REDEX_API_BASE_URL'] ?? 'https://redex.ecotrack.dz'),
        'api_token' => getenv('REDEX_API_TOKEN') ?: ($_ENV['REDEX_API_TOKEN'] ?? ''),
    ],

    // ── Admin Security (Configured via Server Environment Variables) ────────
    'admin' => [
        'password' => getenv('ADMIN_PASSWORD') ?: ($_ENV['ADMIN_PASSWORD'] ?? ''),
        'token' => getenv('ADMIN_API_TOKEN') ?: ($_ENV['ADMIN_API_TOKEN'] ?? ''),
    ]
];

// Check for external protected configuration outside web root or in data/private
$isStagingEnvironment = (basename(dirname(__DIR__)) === 'staging') || (strpos($_SERVER['HTTP_HOST'] ?? '', 'staging') !== false);
$candidateFiles = [
    $isStagingEnvironment ? dirname(dirname(dirname(__DIR__))) . '/staging-secure-config.php' : dirname(dirname(__DIR__)) . '/secure-config.php',
    dirname(dirname(dirname(__DIR__))) . '/secure-config.php',
    dirname(dirname(__DIR__)) . '/secure-config.php',
    dirname(__DIR__) . '/data/private/secret-keys.php'
];
$extConf = null;
foreach ($candidateFiles as $candidate) {
    if (file_exists($candidate)) {
        $loaded = @include $candidate;
        if (is_array($loaded)) {
            $extConf = $loaded;
            break;
        }
    }
}

if (is_array($extConf)) {
    if (!empty($extConf['APP_ENV'])) $config['app_env'] = $extConf['APP_ENV'];
    if (!empty($extConf['SUPABASE_URL'])) $config['supabase']['url'] = $extConf['SUPABASE_URL'];
    if (!empty($extConf['SUPABASE_ANON_KEY'])) $config['supabase']['anon_key'] = $extConf['SUPABASE_ANON_KEY'];
    if (!empty($extConf['SUPABASE_SCHEMA'])) $config['supabase']['schema'] = $extConf['SUPABASE_SCHEMA'];
    if (!empty($extConf['SUPABASE_STAGING_TOKEN'])) $config['supabase']['staging_token'] = $extConf['SUPABASE_STAGING_TOKEN'];
    if (!empty($extConf['ADMIN_PASSWORD'])) $config['admin']['password'] = $extConf['ADMIN_PASSWORD'];
    if (!empty($extConf['ADMIN_API_TOKEN'])) $config['admin']['token'] = $extConf['ADMIN_API_TOKEN'];
    if (isset($extConf['supabase']) && is_array($extConf['supabase'])) {
        $config['supabase'] = array_merge($config['supabase'], $extConf['supabase']);
    }
    if (isset($extConf['admin']) && is_array($extConf['admin'])) {
        $config['admin'] = array_merge($config['admin'], $extConf['admin']);
    }
    if (isset($extConf['telegram']) && is_array($extConf['telegram'])) {
        $config['telegram'] = array_merge($config['telegram'], $extConf['telegram']);
    }
    if (isset($extConf['ecotrack']) && is_array($extConf['ecotrack'])) {
        $config['ecotrack'] = array_merge($config['ecotrack'], $extConf['ecotrack']);
    }
}

// ── Strict Staging / Production Schema Isolation Guard ───────────────────────
if (($config['app_env'] ?? '') === 'staging') {
    $schema = trim((string)($config['supabase']['schema'] ?? ''));
    if (empty($schema) || $schema === 'public') {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'success' => false,
            'error' => 'STAGING_SCHEMA_CONFIG_FATAL',
            'message' => 'Staging environment is strictly prohibited from targeting the production public schema. SUPABASE_SCHEMA must be explicitly configured to staging.'
        ]);
        exit(1);
    }
}

// Merge encrypted overrides from data/private/admin-settings.enc if present
$encFile = dirname(__DIR__) . '/data/private/admin-settings.enc';
if (file_exists($encFile)) {
    try {
        $rawSecret = $_SERVER['ADMIN_SETTINGS_ENCRYPTION_KEY'] ?? (getenv('ADMIN_SETTINGS_ENCRYPTION_KEY') ?: ($_ENV['ADMIN_SETTINGS_ENCRYPTION_KEY'] ?? ''));
        if (empty($rawSecret) && is_array($extConf) && !empty($extConf['ADMIN_SETTINGS_ENCRYPTION_KEY'])) {
            $rawSecret = $extConf['ADMIN_SETTINGS_ENCRYPTION_KEY'];
        }
        if (!empty($rawSecret)) {
            $trimmed = trim($rawSecret);
            $key = null;
            if (strlen($trimmed) === 44 || preg_match('/^[A-Za-z0-9+\/]{42,43}={0,2}$/', $trimmed)) {
                $decoded = base64_decode($trimmed, true);
                if ($decoded !== false && strlen($decoded) === 32) $key = $decoded;
            } elseif (strlen($trimmed) === 64 && ctype_xdigit($trimmed)) {
                $decoded = hex2bin($trimmed);
                if ($decoded !== false && strlen($decoded) === 32) $key = $decoded;
            } elseif (strlen($trimmed) === 32) {
                $key = $trimmed;
            }

            if ($key !== null) {
                $raw = @file_get_contents($encFile);
                if ($raw) {
                    $envelope = json_decode($raw, true);
                    if (is_array($envelope) && ($envelope['version'] ?? 0) === 1 && !empty($envelope['iv']) && !empty($envelope['tag']) && !empty($envelope['ciphertext'])) {
                        $cleartext = openssl_decrypt(
                            base64_decode($envelope['ciphertext']),
                            'aes-256-gcm',
                            $key,
                            OPENSSL_RAW_DATA,
                            base64_decode($envelope['iv']),
                            base64_decode($envelope['tag']),
                            'orva-admin-settings-v1'
                        );
                        if ($cleartext !== false) {
                            $overrides = json_decode($cleartext, true);
                            if (is_array($overrides)) {
                                if (!empty($overrides['telegram']['botToken'])) {
                                    $config['telegram']['bot_token'] = $overrides['telegram']['botToken'];
                                }
                                if (!empty($overrides['telegram']['chatId'])) {
                                    $config['telegram']['chat_id'] = $overrides['telegram']['chatId'];
                                }
                                if (!empty($overrides['metaPixel']['pixelId'])) {
                                    $config['meta']['pixel_id'] = $overrides['metaPixel']['pixelId'];
                                }
                                if (!empty($overrides['metaPixel']['capiToken'])) {
                                    $config['meta']['access_token'] = $overrides['metaPixel']['capiToken'];
                                }
                                if (!empty($overrides['ecotrack']['apiToken'])) {
                                    $config['ecotrack']['api_token'] = $overrides['ecotrack']['apiToken'];
                                }
                                if (!empty($overrides['redex']['apiToken'])) {
                                    $config['redex']['api_token'] = $overrides['redex']['apiToken'];
                                }
                            }
                        }
                    }
                }
            }
        }
    } catch (Throwable $e) {
        // Fall back gracefully to environment variables without crashing orders
    }
}

// ── Centralized Supabase REST Request Helper ─────────────────────────────────
if (!function_exists('orva_supabase_rest_request')) {
    /**
     * Executes Supabase PostgREST operations with strict schema profile routing.
     *
     * Invariants:
     * - Staging environment MUST use Accept-Profile: staging and Content-Profile: staging.
     * - Staging environment MUST fail closed if schema is missing or attempts to use public.
     * - Production environment continues using public with standard PostgREST headers.
     */
    function orva_supabase_rest_request(
        string $method,
        string $url,
        $data = null,
        array $runtimeConfig = [],
        string $adminToken = '',
        array $extraHeaders = []
    ): array {
        $schema = trim((string)($runtimeConfig['supabase']['schema'] ?? 'public'));
        $appEnv = trim((string)($runtimeConfig['app_env'] ?? 'production'));

        // Guard against cross-environment schema leakage
        if ($appEnv === 'staging' && ($schema === '' || $schema === 'public')) {
            throw new RuntimeException('STAGING_SCHEMA_ISOLATION_VIOLATION: Staging request attempted without valid staging schema profile.');
        }

        $supabaseKey = $runtimeConfig['supabase']['anon_key'] ?? '';
        $authToken = $supabaseKey;
        if ($schema === 'staging' && !empty($runtimeConfig['supabase']['staging_token'])) {
            $authToken = $runtimeConfig['supabase']['staging_token'];
        }

        $headers = [
            'apikey: ' . $supabaseKey,
            'Authorization: Bearer ' . $authToken,
            'Content-Type: application/json'
        ];

        if (!empty($adminToken)) {
            $headers[] = 'x-admin-token: ' . $adminToken;
        }

        // PostgREST Custom Schema Profile Routing
        if ($schema !== '' && $schema !== 'public') {
            $upperMethod = strtoupper($method);
            if ($upperMethod === 'GET' || $upperMethod === 'HEAD') {
                $headers[] = 'Accept-Profile: ' . $schema;
            } elseif ($upperMethod === 'POST' || $upperMethod === 'PATCH' || $upperMethod === 'PUT' || $upperMethod === 'DELETE') {
                $headers[] = 'Content-Profile: ' . $schema;
                $headers[] = 'Accept-Profile: ' . $schema;
            }
        }

        foreach ($extraHeaders as $extra) {
            $headers[] = $extra;
        }

        // Allow test-mode mock interceptor if set in environment
        if (getenv('ORVA_TEST_MOCK_SUPABASE') === 'true') {
            return [
                'code' => 200,
                'data' => ['success' => true, 'mocked' => true, 'schema' => $schema, 'method' => $method],
                'raw'  => json_encode(['success' => true]),
                'headers_sent' => $headers
            ];
        }

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));
        curl_setopt($ch, CURLOPT_TIMEOUT, 8);

        if ($data !== null) {
            $payloadStr = is_string($data) ? $data : json_encode($data);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $payloadStr);
        }

        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        return [
            'code' => $httpCode,
            'data' => json_decode($response, true) ?? $response,
            'raw'  => $response,
            'headers_sent' => $headers
        ];
    }
}

return $config;
