<?php
/**
 * Read-only Staging config status probe.
 * Returns ONLY booleans / non-secret metadata.
 * Auth: HTTP header X-Orva-Probe must match ORVA_CONFIG_PROBE_KEY env
 * or the contents of ../../staging-config-probe.token (domain root).
 * Remove after connectivity work is complete.
 */
define('ORVA_API', true);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

$probeKey = $_SERVER['HTTP_X_ORVA_PROBE'] ?? '';
$expected = getenv('ORVA_CONFIG_PROBE_KEY') ?: ($_ENV['ORVA_CONFIG_PROBE_KEY'] ?? '');
$domainRoot = dirname(dirname(__DIR__));
$tokenFile = $domainRoot . '/staging-config-probe.token';
$tokenOk = false;
if ($expected !== '' && is_string($probeKey) && hash_equals($expected, $probeKey)) {
    $tokenOk = true;
} elseif (is_readable($tokenFile)) {
    $fileTok = trim((string)@file_get_contents($tokenFile));
    if ($fileTok !== '' && hash_equals($fileTok, $probeKey)) {
        $tokenOk = true;
    }
}
if (!$tokenOk) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'PROBE_FORBIDDEN']);
    exit;
}

$apiDir = __DIR__;
$stagingRoot = dirname($apiDir);
$isStagingPath = (basename($stagingRoot) === 'staging');
$host = (string)($_SERVER['HTTP_HOST'] ?? '');
$hostLooksStaging = (stripos($host, 'staging') !== false);

$candidateOutside = dirname(dirname(dirname($apiDir))) . '/staging-secure-config.php';
$candidatePrivate = $stagingRoot . '/data/private/secret-keys.php';

$loadedFrom = null;
$extConf = null;
foreach ([$candidateOutside, $candidatePrivate] as $candidate) {
    if (is_readable($candidate)) {
        $loaded = require $candidate;
        if (is_array($loaded)) {
            $extConf = $loaded;
            $loadedFrom = ($candidate === $candidateOutside) ? 'outside_webroot' : 'data_private';
            break;
        }
    }
}

$permsOutside = null;
$existsOutside = file_exists($candidateOutside);
if ($existsOutside) {
    $permsOutside = substr(sprintf('%o', @fileperms($candidateOutside)), -4);
}

$token = '';
if (is_array($extConf) && !empty($extConf['SUPABASE_STAGING_TOKEN'])) {
    $token = (string)$extConf['SUPABASE_STAGING_TOKEN'];
}
if ($token === '') {
    $token = (string)(getenv('SUPABASE_STAGING_TOKEN') ?: ($_ENV['SUPABASE_STAGING_TOKEN'] ?? ''));
}

$appEnv = is_array($extConf) && !empty($extConf['APP_ENV'])
    ? (string)$extConf['APP_ENV']
    : (string)(getenv('APP_ENV') ?: ($_ENV['APP_ENV'] ?? 'production'));
$schema = is_array($extConf) && !empty($extConf['SUPABASE_SCHEMA'])
    ? (string)$extConf['SUPABASE_SCHEMA']
    : (string)(getenv('SUPABASE_SCHEMA') ?: ($_ENV['SUPABASE_SCHEMA'] ?? 'public'));

$serviceRole = '';
if (is_array($extConf) && !empty($extConf['SUPABASE_SERVICE_ROLE_KEY'])) {
    $serviceRole = (string)$extConf['SUPABASE_SERVICE_ROLE_KEY'];
}
if ($serviceRole === '') {
    $serviceRole = (string)(getenv('SUPABASE_SERVICE_ROLE_KEY') ?: ($_ENV['SUPABASE_SERVICE_ROLE_KEY'] ?? ''));
}

$jwtLooksValidShape = false;
$jwtAlg = null;
$jwtRole = null;
$jwtIss = null;
$jwtExp = null;
$jwtKid = null;
if ($token !== '' && substr_count($token, '.') === 2) {
    $parts = explode('.', $token);
    $hdrJson = base64_decode(strtr($parts[0], '-_', '+/'), true);
    $payJson = base64_decode(strtr($parts[1], '-_', '+/'), true);
    $hdr = $hdrJson ? json_decode($hdrJson, true) : null;
    $pay = $payJson ? json_decode($payJson, true) : null;
    if (is_array($hdr) && is_array($pay)) {
        $jwtLooksValidShape = true;
        $jwtAlg = $hdr['alg'] ?? null;
        $jwtKid = $hdr['kid'] ?? null;
        $jwtRole = $pay['role'] ?? null;
        $jwtIss = $pay['iss'] ?? null;
        $jwtExp = isset($pay['exp']) ? (int)$pay['exp'] : null;
    }
}

echo json_encode([
    'success' => true,
    'host' => $host,
    'path_is_staging' => $isStagingPath,
    'host_looks_staging' => $hostLooksStaging,
    'external_config' => [
        'loaded' => is_array($extConf),
        'loaded_from' => $loadedFrom,
        'outside_exists' => $existsOutside,
        'outside_readable' => is_readable($candidateOutside),
        'outside_perms' => $permsOutside,
        'private_fallback_exists' => file_exists($candidatePrivate),
    ],
    'app_env' => $appEnv,
    'supabase_schema' => $schema,
    'staging_token' => [
        'present' => $token !== '',
        'length' => strlen($token),
        'jwt_shape_ok' => $jwtLooksValidShape,
        'alg' => $jwtAlg,
        'kid_present' => $jwtKid !== null && $jwtKid !== '',
        'role_claim' => $jwtRole,
        'iss_claim' => $jwtIss,
        'exp_in_future' => $jwtExp !== null ? ($jwtExp > time()) : null,
        'exp_epoch' => $jwtExp,
    ],
    'service_role_key_present' => $serviceRole !== '',
    'admin_password_present' => is_array($extConf) && !empty($extConf['ADMIN_PASSWORD']),
    'admin_token_present' => is_array($extConf) && !empty($extConf['ADMIN_API_TOKEN']),
    'encryption_key_present' => is_array($extConf) && !empty($extConf['ADMIN_SETTINGS_ENCRYPTION_KEY']),
    'telegram_bot_present' => is_array($extConf) && (
        !empty($extConf['TELEGRAM_BOT_TOKEN']) || !empty(($extConf['telegram']['bot_token'] ?? ''))
    ),
], JSON_UNESCAPED_SLASHES);
