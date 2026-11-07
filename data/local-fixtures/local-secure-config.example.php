<?php
/**
 * EXAMPLE ONLY — copy to data/private/local-secure-config.php (gitignored).
 * Synthetic local credentials. Never use Production secrets. Never deploy.
 */
return [
    'APP_ENV' => 'local',
    'SUPABASE_SCHEMA' => 'staging',
    'ADMIN_PASSWORD' => 'local-dev-admin-password',
    'ADMIN_API_TOKEN' => 'local-dev-admin-token',
    'staging_pdo' => [
        'enabled' => true,
        'mode' => 'mock',
        'allow_live' => false,
        // Leave DSN empty for mock. Real local Postgres only, never hosted:
        // 'dsn' => 'pgsql:host=127.0.0.1;port=5432;dbname=orva_staging_local;sslmode=disable',
        // 'user' => 'staging_login',
        // 'password' => 'local-only-password',
    ],
];
