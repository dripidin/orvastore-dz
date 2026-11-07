'use strict';
/**
 * Durable Postgres idempotency with in_progress reclaim.
 */
const { getPgPool } = require('./supabaseServer');
const { assertDbSchema, qualifyTable, isLocalUnconfigured } = require('./db-authority');

const IN_PROGRESS_TTL_MS = 15 * 60 * 1000;

function schema() {
    return assertDbSchema(process.env.SUPABASE_SCHEMA || 'public');
}

function shouldUsePgIdempotency() {
    if (isLocalUnconfigured()) return false;
    return Boolean(getPgPool());
}

async function withIdempotencyLockPg(key, executionFn) {
    if (!key) return executionFn();
    const pool = getPgPool();
    if (!pool) {
        const err = new Error('STORAGE_UNAVAILABLE');
        err.code = 'STORAGE_UNAVAILABLE';
        err.statusCode = 503;
        throw err;
    }

    const table = qualifyTable(schema(), 'idempotency_records');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const existing = await client.query(
            `SELECT * FROM ${table} WHERE key = $1 FOR UPDATE`,
            [key]
        );
        if (existing.rows[0]) {
            const row = existing.rows[0];
            if (row.status === 'completed' && row.response) {
                await client.query('COMMIT');
                const resp = typeof row.response === 'string' ? JSON.parse(row.response) : row.response;
                return { ...resp, idempotent: true };
            }
            if (row.status === 'in_progress') {
                const age = Date.now() - new Date(row.updated_at || row.created_at).getTime();
                if (age < IN_PROGRESS_TTL_MS) {
                    await client.query('COMMIT');
                    const err = new Error('IDEMPOTENCY_IN_PROGRESS');
                    err.code = 'IDEMPOTENCY_IN_PROGRESS';
                    err.statusCode = 409;
                    throw err;
                }
                // reclaim stale
                await client.query(
                    `UPDATE ${table} SET status = 'in_progress', updated_at = NOW() WHERE key = $1`,
                    [key]
                );
            } else {
                await client.query(
                    `UPDATE ${table} SET status = 'in_progress', updated_at = NOW() WHERE key = $1`,
                    [key]
                );
            }
        } else {
            await client.query(
                `INSERT INTO ${table} (key, status, response, created_at, updated_at)
                 VALUES ($1, 'in_progress', '{}'::jsonb, NOW(), NOW())`,
                [key]
            );
        }
        await client.query('COMMIT');
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        client.release();
        if (e.code === '23505') {
            // unique race — re-enter
            return withIdempotencyLockPg(key, executionFn);
        }
        throw e;
    }

    try {
        const result = await executionFn();
        await client.query(
            `UPDATE ${table}
             SET status = 'completed', response = $2::jsonb, order_id = $3, updated_at = NOW()
             WHERE key = $1`,
            [key, JSON.stringify(result || {}), result && result.orderId ? String(result.orderId) : null]
        );
        return result;
    } catch (execErr) {
        try {
            await client.query(
                `UPDATE ${table} SET status = 'failed', updated_at = NOW() WHERE key = $1 AND status = 'in_progress'`,
                [key]
            );
        } catch (_) {}
        throw execErr;
    } finally {
        client.release();
    }
}

module.exports = {
    withIdempotencyLockPg,
    shouldUsePgIdempotency,
};
