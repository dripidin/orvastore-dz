'use strict';
/**
 * Shared DB authority helpers — schema allowlist, order-id validation, env mode.
 * Used by lib/db.js, inventory-manager, idempotency-manager.
 */

const ORDER_ID_RE = /^[A-Za-z0-9._:-]{6,64}$/;
const ALLOWED_SCHEMAS = new Set(['public', 'staging']);

function getAppEnv() {
    return String(process.env.APP_ENV || 'production').trim().toLowerCase();
}

function assertDbSchema(raw) {
    const schema = String(raw || process.env.SUPABASE_SCHEMA || 'public').trim();
    if (!ALLOWED_SCHEMAS.has(schema)) {
        const err = new Error('INVALID_DB_SCHEMA');
        err.code = 'INVALID_DB_SCHEMA';
        err.statusCode = 500;
        throw err;
    }
    if (getAppEnv() === 'staging' && schema === 'public') {
        const err = new Error('STAGING_SCHEMA_ISOLATION_VIOLATION');
        err.code = 'STAGING_SCHEMA_ISOLATION_VIOLATION';
        err.statusCode = 500;
        throw err;
    }
    return schema;
}

function qualifyTable(schema, table) {
    const s = assertDbSchema(schema);
    const t = String(table || '').trim();
    if (!/^[a-z_][a-z0-9_]*$/i.test(t)) {
        const err = new Error('INVALID_DB_TABLE');
        err.code = 'INVALID_DB_TABLE';
        throw err;
    }
    return `${s}.${t}`;
}

function assertValidOrderId(orderId) {
    const id = String(orderId || '').trim();
    if (!ORDER_ID_RE.test(id)) {
        const err = new Error('INVALID_ORDER_ID');
        err.code = 'INVALID_ORDER_ID';
        err.statusCode = 400;
        throw err;
    }
    return id;
}

function isHostedDatabaseUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return false;
    try {
        const host = String(new URL(raw).hostname || '').toLowerCase();
        if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
        return true;
    } catch (_) {
        return true;
    }
}

function allowHostedPg() {
    return String(process.env.ORVA_PG_ALLOW_HOSTED || '').trim().toLowerCase() === 'true';
}

function isLocalUnconfigured() {
    const env = getAppEnv();
    if (env !== 'local' && env !== 'development' && env !== 'test') return false;
    if (process.env.VERCEL) return false;
    const dbUrl = String(process.env.DATABASE_URL || '').trim();
    // Local isolation: refuse hosted DATABASE_URL unless explicitly allowed.
    // This is intentional fixture mode — not a silent fallback after a live DB outage.
    if (dbUrl && isHostedDatabaseUrl(dbUrl) && !allowHostedPg()) {
        return true;
    }
    const hasDb = Boolean(dbUrl);
    const hasUrl = Boolean(String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim());
    const hasRole = Boolean(String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim());
    // JSON fallback only when neither DB URL nor full Supabase server pair is configured
    return !hasDb && !(hasUrl && hasRole);
}

function dbConfigured() {
    return Boolean(String(process.env.DATABASE_URL || '').trim())
        || (Boolean(String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim())
            && Boolean(String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()));
}

function stagingForbidsServiceRole() {
    const env = getAppEnv();
    const schema = String(process.env.SUPABASE_SCHEMA || '').trim();
    if (env === 'staging' || schema === 'staging') {
        if (String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) {
            const err = new Error('STAGING_SERVICE_ROLE_FORBIDDEN');
            err.code = 'STAGING_SERVICE_ROLE_FORBIDDEN';
            err.statusCode = 503;
            throw err;
        }
    }
}

module.exports = {
    ORDER_ID_RE,
    ALLOWED_SCHEMAS,
    getAppEnv,
    assertDbSchema,
    qualifyTable,
    assertValidOrderId,
    isLocalUnconfigured,
    isHostedDatabaseUrl,
    allowHostedPg,
    dbConfigured,
    stagingForbidsServiceRole,
};
