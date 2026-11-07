<?php
/**
 * Local / server PDO helper for inventory & rate-limit authority.
 * Refuses hosted Supabase pooler hosts unless ORVA_PG_ALLOW_HOSTED=true (never set in this task).
 */
if (!defined('ORVA_API') && php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('Direct access not permitted.');
}

if (!function_exists('orva_pg_app_env')) {
    function orva_pg_app_env(): string
    {
        global $config;
        $env = getenv('APP_ENV');
        if ($env === false || $env === '') {
            $env = $_ENV['APP_ENV'] ?? ($config['app_env'] ?? 'production');
        }
        return strtolower(trim((string)$env));
    }

    function orva_pg_schema(): string
    {
        global $config;
        $schema = getenv('SUPABASE_SCHEMA');
        if ($schema === false || $schema === '') {
            $schema = $_ENV['SUPABASE_SCHEMA'] ?? ($config['supabase']['schema'] ?? 'public');
        }
        $schema = trim((string)$schema);
        if ($schema !== 'public' && $schema !== 'staging') {
            throw new RuntimeException('INVALID_DB_SCHEMA');
        }
        if (orva_pg_app_env() === 'staging' && $schema === 'public') {
            throw new RuntimeException('STAGING_SCHEMA_ISOLATION_VIOLATION');
        }
        return $schema;
    }

    function orva_pg_table(string $table): string
    {
        if (!preg_match('/^[a-z_][a-z0-9_]*$/i', $table)) {
            throw new RuntimeException('INVALID_DB_TABLE');
        }
        return orva_pg_schema() . '.' . $table;
    }

    function orva_pg_database_url(): string
    {
        $url = getenv('DATABASE_URL');
        if ($url === false || $url === '') {
            $url = $_ENV['DATABASE_URL'] ?? '';
        }
        return trim((string)$url);
    }

    function orva_pg_is_configured(): bool
    {
        return orva_pg_database_url() !== '';
    }

    function orva_pg_dsn_is_hosted(string $url): bool
    {
        $host = parse_url($url, PHP_URL_HOST) ?: '';
        $host = strtolower((string)$host);
        if ($host === '' || $host === 'localhost' || $host === '127.0.0.1' || $host === '::1') {
            return false;
        }
        if (str_contains($host, 'supabase.co') || str_contains($host, 'pooler.supabase')) {
            return true;
        }
        return true; // any non-loopback treated as hosted for this local-only task
    }

    function orva_pg_allow_hosted(): bool
    {
        return strtolower((string)(getenv('ORVA_PG_ALLOW_HOSTED') ?: ($_ENV['ORVA_PG_ALLOW_HOSTED'] ?? ''))) === 'true';
    }

    /**
     * Local JSON fixtures are allowed when APP_ENV is local/dev/test and either:
     * - no DATABASE_URL, or
     * - DATABASE_URL points at a hosted host that local mode refuses (isolation).
     * This is not a silent fallback after a live connection failure.
     */
    function orva_pg_is_local_unconfigured(): bool
    {
        $env = orva_pg_app_env();
        if (!in_array($env, ['local', 'development', 'test'], true)) {
            return false;
        }
        if (getenv('VERCEL') || !empty($_ENV['VERCEL'])) {
            return false;
        }
        $url = orva_pg_database_url();
        if ($url === '') {
            return true;
        }
        if (!orva_pg_allow_hosted() && orva_pg_dsn_is_hosted($url)) {
            return true;
        }
        return false;
    }

    /**
     * @return PDO
     */
    function orva_pg_pdo(): PDO
    {
        static $pdo = null;
        if ($pdo instanceof PDO) {
            return $pdo;
        }
        $url = orva_pg_database_url();
        if ($url === '') {
            throw new RuntimeException('DATABASE_URL_MISSING');
        }
        if (!orva_pg_allow_hosted() && orva_pg_dsn_is_hosted($url)) {
            throw new RuntimeException('ORVA_PG_HOSTED_BLOCKED');
        }

        $parts = parse_url($url);
        if (!$parts || empty($parts['host'])) {
            throw new RuntimeException('DATABASE_URL_INVALID');
        }
        $db = isset($parts['path']) ? ltrim($parts['path'], '/') : 'postgres';
        $port = $parts['port'] ?? 5432;
        $user = $parts['user'] ?? 'postgres';
        $pass = $parts['pass'] ?? '';
        $dsn = sprintf('pgsql:host=%s;port=%d;dbname=%s', $parts['host'], (int)$port, $db);
        $pdo = new PDO($dsn, urldecode((string)$user), urldecode((string)$pass), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        return $pdo;
    }
}
