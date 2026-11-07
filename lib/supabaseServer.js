'use strict';
// =============================================================================
// Supabase Client & PostgreSQL Pool for ORVA Store (server-only)
// Production-shaped: SERVICE_ROLE only. Staging: never service_role.
// =============================================================================

const { createClient } = require('@supabase/supabase-js');
const { Pool } = require('pg');
const {
    assertDbSchema,
    getAppEnv,
    stagingForbidsServiceRole,
} = require('./db-authority');

const APP_ENV = getAppEnv();

function requireSupabaseUrl() {
    const url = String(
        process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    ).trim();
    if (!url) {
        const err = new Error('SERVER_MISCONFIGURED');
        err.code = 'SERVER_MISCONFIGURED';
        err.message = 'SUPABASE_URL is required on the server (no hardcoded fallback).';
        throw err;
    }
    return url;
}

function requireServiceRoleKey() {
    stagingForbidsServiceRole();
    if (APP_ENV === 'staging') {
        const err = new Error('SERVER_MISCONFIGURED');
        err.code = 'SERVER_MISCONFIGURED';
        err.message = 'Staging must not use SUPABASE_SERVICE_ROLE_KEY; use staging_login / staging token.';
        throw err;
    }
    const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!key) {
        const err = new Error('SERVER_MISCONFIGURED');
        err.code = 'SERVER_MISCONFIGURED';
        err.message = 'SUPABASE_SERVICE_ROLE_KEY is required for server-side Supabase access.';
        throw err;
    }
    // Never accept a publishable/anon key disguised as service role
    if (key.startsWith('sb_publishable_') || key.includes('anon')) {
        const err = new Error('SERVER_MISCONFIGURED');
        err.code = 'SERVER_MISCONFIGURED';
        err.message = 'SUPABASE_SERVICE_ROLE_KEY must be the service_role secret, not anon/publishable.';
        throw err;
    }
    return key;
}

const SUPABASE_SCHEMA = (() => {
    try {
        return assertDbSchema(process.env.SUPABASE_SCHEMA || (APP_ENV === 'staging' ? 'staging' : 'public'));
    } catch (_) {
        return APP_ENV === 'staging' ? 'staging' : 'public';
    }
})();

let supabaseInstance = null;
let pgPoolInstance = null;

/**
 * Server Supabase client (service_role). Throws SERVER_MISCONFIGURED if missing.
 * Staging must not call this — use staging PDO / staging token paths instead.
 */
function getSupabase(overrideSchema = null) {
    const targetSchema = assertDbSchema(overrideSchema || SUPABASE_SCHEMA);
    if (APP_ENV === 'staging' || targetSchema === 'staging') {
        stagingForbidsServiceRole();
        const err = new Error('SERVER_MISCONFIGURED');
        err.code = 'SERVER_MISCONFIGURED';
        err.message = 'getSupabase(service_role) is forbidden for staging; use staging_login path.';
        throw err;
    }

    const url = requireSupabaseUrl();
    const key = requireServiceRoleKey();

    if (!supabaseInstance) {
        supabaseInstance = createClient(url, key, {
            auth: { persistSession: false, autoRefreshToken: false },
            db: { schema: targetSchema },
        });
    }
    return supabaseInstance;
}

function getPgPool() {
    const connectionString = String(process.env.DATABASE_URL || '').trim();
    if (!connectionString) {
        return null;
    }
    const { getAppEnv, isHostedDatabaseUrl, allowHostedPg } = require('./db-authority');
    const env = getAppEnv();
    if (
        (env === 'local' || env === 'development' || env === 'test')
        && isHostedDatabaseUrl(connectionString)
        && !allowHostedPg()
    ) {
        console.warn('[PG-POOL] Hosted DATABASE_URL blocked in local mode (set ORVA_PG_ALLOW_HOSTED=true to override)');
        return null;
    }
    if (!pgPoolInstance) {
        let host = '';
        try {
            host = String(new URL(connectionString).hostname || '').toLowerCase();
        } catch (_) {
            host = '';
        }
        const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
        const sslDisabled = process.env.PGSSL_DISABLE === 'true' || isLoopback;
        pgPoolInstance = new Pool({
            connectionString,
            ssl: sslDisabled
                ? false
                : { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' },
            max: 10,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
        });
        pgPoolInstance.on('error', (err) => {
            console.error('[PG-POOL] Unexpected idle client error:', err.message);
        });
    }
    return pgPoolInstance;
}

module.exports = {
    getSupabase,
    getPgPool,
    requireSupabaseUrl,
    requireServiceRoleKey,
    get SUPABASE_URL() {
        try {
            return requireSupabaseUrl();
        } catch (_) {
            return '';
        }
    },
    SUPABASE_SCHEMA,
    APP_ENV,
};
