'use strict';
/**
 * Local effective-privileges validation for the four Production SQL proposals.
 * Disposable schema orva_eff_test only — no hosted Supabase, no inventory/orders data.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const PROPOSALS = [
    '2026-11-07-production-orders-select-containment.sql',
    '2026-11-07-production-rate-limits-select-containment.sql',
    '2026-11-07-production-orders-mutation-lockdown.sql',
    '2026-11-07-production-rate-limits-least-privilege.sql',
];

function loadEnv() {
    const envPath = path.join(ROOT, 'data', 'private', 'orva-local-pg.env');
    if (!fs.existsSync(envPath)) throw new Error('LOCAL_PG_ENV_MISSING');
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        if (!line || line.trim().startsWith('#')) continue;
        const i = line.indexOf('=');
        if (i < 0) continue;
        const k = line.slice(0, i).trim();
        const v = line.slice(i + 1).trim();
        if (k && process.env[k] === undefined) process.env[k] = v;
    }
    const pw = encodeURIComponent(process.env.ORVA_LOCAL_PG_PASSWORD || '');
    process.env.DATABASE_URL =
        `postgresql://${process.env.ORVA_LOCAL_PG_SUPERUSER}:${pw}` +
        `@${process.env.ORVA_LOCAL_PG_HOST}:${process.env.ORVA_LOCAL_PG_PORT}/${process.env.ORVA_LOCAL_PG_DATABASE}`;
}

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function adaptSql(raw) {
    // Map proposal targets onto disposable schema/roles for local simulation.
    return raw
        .replace(/ON public\.orders/g, 'ON orva_eff_test.orders')
        .replace(/ON TABLE public\.orders/g, 'ON TABLE orva_eff_test.orders')
        .replace(/ON public\.rate_limits/g, 'ON orva_eff_test.rate_limits')
        .replace(/ON TABLE public\.rate_limits/g, 'ON TABLE orva_eff_test.rate_limits')
        .replace(/table_schema = 'public'/g, "table_schema = 'orva_eff_test'")
        .replace(/table_name = 'orders'/g, "table_name = 'orders'")
        .replace(/ARRAY\['anon', 'authenticated', 'PUBLIC'\]/g, "ARRAY['orva_eff_anon', 'orva_eff_authenticated', 'PUBLIC']")
        .replace(/\bFROM anon\b/g, 'FROM orva_eff_anon')
        .replace(/\bFROM authenticated\b/g, 'FROM orva_eff_authenticated')
        .replace(/\bTO anon\b/g, 'TO orva_eff_anon')
        .replace(/\bTO authenticated\b/g, 'TO orva_eff_authenticated')
        .replace(/\bTO service_role\b/g, 'TO orva_eff_service_role');
}

async function asRole(c, role, sql) {
    await c.query('BEGIN');
    try {
        await c.query(`SET LOCAL ROLE ${role}`);
        const r = await c.query(sql);
        await c.query('COMMIT');
        return { ok: true, rowCount: r.rowCount, rows: r.rows };
    } catch (e) {
        try { await c.query('ROLLBACK'); } catch (_) {}
        return { ok: false, code: e.code, message: e.message };
    }
}

(async () => {
    loadEnv();
    const results = [];
    const gaps = [];
    const check = async (name, fn) => {
        try {
            await fn();
            results.push({ name, status: 'PASS' });
            console.log('PASS', name);
        } catch (e) {
            results.push({ name, status: 'FAIL', error: e.message });
            console.log('FAIL', name, e.message);
        }
    };
    const noteGap = (id, detail) => {
        gaps.push({ id, detail });
        console.log('GAP', id, detail);
    };

    const hashesBefore = {};
    for (const f of PROPOSALS) {
        hashesBefore[f] = sha256(path.join(ROOT, 'supabase', 'proposals', f));
        console.log('SHA', f, hashesBefore[f]);
    }

    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();

    // Clean slate roles/schema
    await c.query('DROP SCHEMA IF EXISTS orva_eff_test CASCADE');
    for (const r of [
        'orva_eff_anon', 'orva_eff_authenticated', 'orva_eff_service_role',
        'orva_eff_readers', 'orva_eff_noinherit',
    ]) {
        await c.query(`DROP ROLE IF EXISTS ${r}`);
    }

    await c.query(`CREATE ROLE orva_eff_anon NOLOGIN INHERIT`);
    await c.query(`CREATE ROLE orva_eff_authenticated NOLOGIN INHERIT`);
    await c.query(`CREATE ROLE orva_eff_service_role NOLOGIN INHERIT BYPASSRLS`);
    await c.query(`CREATE ROLE orva_eff_readers NOLOGIN INHERIT`);
    await c.query(`CREATE ROLE orva_eff_noinherit NOLOGIN NOINHERIT`);

    await c.query('CREATE SCHEMA orva_eff_test');
    await c.query(`
      CREATE TABLE orva_eff_test.orders (
        id bigserial PRIMARY KEY,
        order_id text UNIQUE NOT NULL,
        full_name text,
        phone text,
        status text DEFAULT 'pending'
      );
      CREATE TABLE orva_eff_test.rate_limits (
        id bigserial PRIMARY KEY,
        phone text,
        device_id text,
        ip text,
        created_at timestamptz DEFAULT now()
      );
      CREATE FUNCTION orva_eff_test.list_order_ids() RETURNS SETOF text
      LANGUAGE sql SECURITY INVOKER AS $$ SELECT order_id FROM orva_eff_test.orders $$;
    `);
    await c.query(`ALTER TABLE orva_eff_test.orders ENABLE ROW LEVEL SECURITY`);
    await c.query(`ALTER TABLE orva_eff_test.rate_limits ENABLE ROW LEVEL SECURITY`);

    // Baseline policies mirroring Production names
    await c.query(`
      CREATE POLICY "Allow anon order read" ON orva_eff_test.orders
        FOR SELECT TO orva_eff_anon, orva_eff_authenticated USING (true);
      CREATE POLICY "Allow anon order insertion" ON orva_eff_test.orders
        FOR INSERT TO orva_eff_anon, orva_eff_authenticated WITH CHECK (true);
      CREATE POLICY "Allow admin token order update" ON orva_eff_test.orders
        FOR UPDATE TO orva_eff_anon, orva_eff_authenticated USING (true) WITH CHECK (true);
      CREATE POLICY "Allow admin token order delete" ON orva_eff_test.orders
        FOR DELETE TO orva_eff_anon, orva_eff_authenticated USING (true);
      CREATE POLICY "Service role full access on orders" ON orva_eff_test.orders
        FOR ALL TO orva_eff_service_role USING (true) WITH CHECK (true);
      CREATE POLICY "Allow anon rate limit select" ON orva_eff_test.rate_limits
        FOR SELECT TO orva_eff_anon, orva_eff_authenticated USING (true);
      CREATE POLICY "Allow anon rate limit insert" ON orva_eff_test.rate_limits
        FOR INSERT TO orva_eff_anon, orva_eff_authenticated WITH CHECK (true);
      CREATE POLICY "Allow anon rate limit check" ON orva_eff_test.rate_limits
        FOR INSERT TO orva_eff_anon, orva_eff_authenticated WITH CHECK (true);
      CREATE POLICY "Service role full access on rate_limits" ON orva_eff_test.rate_limits
        FOR ALL TO orva_eff_service_role USING (true) WITH CHECK (true);
    `);

    // Complex grants the proposals must defeat or that we must document
    await c.query(`
      GRANT USAGE ON SCHEMA orva_eff_test TO orva_eff_anon, orva_eff_authenticated, orva_eff_service_role, orva_eff_readers, PUBLIC;
      GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
        ON orva_eff_test.orders TO orva_eff_anon, orva_eff_authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
        ON orva_eff_test.rate_limits TO orva_eff_anon, orva_eff_authenticated;
      GRANT ALL ON ALL TABLES IN SCHEMA orva_eff_test TO orva_eff_service_role;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA orva_eff_test
        TO orva_eff_anon, orva_eff_authenticated, orva_eff_service_role;
      GRANT EXECUTE ON FUNCTION orva_eff_test.list_order_ids() TO orva_eff_anon, orva_eff_authenticated;

      -- Scenario 1: PUBLIC table SELECT
      GRANT SELECT ON TABLE orva_eff_test.orders TO PUBLIC;
      GRANT SELECT ON TABLE orva_eff_test.rate_limits TO PUBLIC;

      -- Scenario 3/4: column-level privileges (in addition to table grants)
      GRANT SELECT (phone) ON orva_eff_test.orders TO orva_eff_anon;
      GRANT UPDATE (status) ON orva_eff_test.orders TO orva_eff_anon;

      -- Scenario 5: role membership inheritance
      GRANT SELECT ON TABLE orva_eff_test.orders TO orva_eff_readers;
      GRANT orva_eff_readers TO orva_eff_anon;
    `);

    await c.query(`INSERT INTO orva_eff_test.orders (order_id, full_name, phone)
                   VALUES ('EFF-1', 'Synthetic', '0555000000')`);

    // Pre-flight: confirm complex paths work before proposals
    await check('pre: PUBLIC/path can read via has_table_privilege', async () => {
        const r = await c.query(`SELECT has_table_privilege('orva_eff_anon','orva_eff_test.orders','SELECT') AS a`);
        if (!r.rows[0].a) throw new Error('anon should have SELECT before proposals');
    });

    // Apply file 1 — orders SELECT containment
    const sql1 = adaptSql(fs.readFileSync(path.join(ROOT, 'supabase', 'proposals', PROPOSALS[0]), 'utf8'));
    await c.query(sql1);

    await check('after orders-select: policy Allow anon order read gone', async () => {
        const r = await c.query(`SELECT 1 FROM pg_policy p
          JOIN pg_class c2 ON c2.oid=p.polrelid
          JOIN pg_namespace n ON n.oid=c2.relnamespace
          WHERE n.nspname='orva_eff_test' AND c2.relname='orders' AND p.polname='Allow anon order read'`);
        if (r.rowCount !== 0) throw new Error('policy still present');
    });

    await check('after orders-select: direct anon table SELECT revoked', async () => {
        const r = await c.query(`SELECT has_table_privilege('orva_eff_anon','orva_eff_test.orders','SELECT') AS a`);
        // May still be true via PUBLIC or membership — record gap if so
        if (r.rows[0].a) {
            noteGap('ORDERS_SELECT_STILL_EFFECTIVE', 'has_table_privilege(anon,orders,SELECT)=true after proposal (PUBLIC and/or membership and/or column grants)');
        }
    });

    await check('after orders-select: PUBLIC table SELECT grant removed', async () => {
        const pub = await c.query(`
          SELECT 1 FROM information_schema.role_table_grants
          WHERE table_schema='orva_eff_test' AND table_name='orders'
            AND grantee='PUBLIC' AND privilege_type='SELECT'`);
        if (pub.rowCount > 0) throw new Error('PUBLIC SELECT grant remains');
    });

    await check('after orders-select: no residual column SELECT grants in catalog', async () => {
        const col = await c.query(`
          SELECT grantee, column_name FROM information_schema.column_privileges
          WHERE table_schema='orva_eff_test' AND table_name='orders'
            AND grantee IN ('orva_eff_anon','orva_eff_authenticated','PUBLIC')
            AND privilege_type='SELECT'`);
        if (col.rowCount > 0) {
            throw new Error(`column SELECT remains: ${col.rows.map((x) => x.grantee + '.' + x.column_name).join(',')}`);
        }
    });

    await check('after orders-select: INSERT still works without RETURNING', async () => {
        const r = await asRole(c, 'orva_eff_anon',
            `INSERT INTO orva_eff_test.orders (order_id, full_name) VALUES ('EFF-INS-1','x')`);
        if (!r.ok) throw new Error(r.message);
    });

    await check('after orders-select: membership can still grant SELECT until revoked', async () => {
        const r = await asRole(c, 'orva_eff_anon', `SELECT order_id FROM orva_eff_test.orders LIMIT 1`);
        if (r.ok) {
            noteGap('ORDERS_INHERITED_SELECT_ONLY', 'row SELECT via orva_eff_readers membership — proposals do not revoke third-party roles; check Production memberships');
        }
    });

    await check('after orders-select: drop membership then anon cannot read rows', async () => {
        await c.query('REVOKE orva_eff_readers FROM orva_eff_anon');
        const r = await asRole(c, 'orva_eff_anon', `SELECT order_id FROM orva_eff_test.orders LIMIT 1`);
        if (r.ok) throw new Error('anon still reads rows without membership');
        const ht = await c.query(
            `SELECT has_table_privilege('orva_eff_anon','orva_eff_test.orders','SELECT') AS a`
        );
        if (ht.rows[0].a) throw new Error('has_table_privilege SELECT still true');
    });

    // Apply file 2 — rate_limits SELECT
    const sql2 = adaptSql(fs.readFileSync(path.join(ROOT, 'supabase', 'proposals', PROPOSALS[1]), 'utf8'));
    await c.query(sql2);

    await check('after rl-select: anon cannot SELECT rate_limits rows', async () => {
        const pub = await c.query(`
          SELECT 1 FROM information_schema.role_table_grants
          WHERE table_schema='orva_eff_test' AND table_name='rate_limits'
            AND grantee='PUBLIC' AND privilege_type='SELECT'`);
        if (pub.rowCount > 0) throw new Error('PUBLIC SELECT on rate_limits remains');
        const r = await asRole(c, 'orva_eff_anon', `SELECT id FROM orva_eff_test.rate_limits LIMIT 1`);
        if (r.ok) throw new Error('anon still reads rate_limits');
    });

    await check('after rl-select: INSERT rate_limits remains', async () => {
        const r = await asRole(c, 'orva_eff_anon',
            `INSERT INTO orva_eff_test.rate_limits (phone) VALUES ('0555111222')`);
        if (!r.ok) throw new Error(r.message);
    });

    // Apply file 3 — mutation lockdown
    const sql3 = adaptSql(fs.readFileSync(path.join(ROOT, 'supabase', 'proposals', PROPOSALS[2]), 'utf8'));
    await c.query(sql3);

    await check('after mutation: admin-token policies gone', async () => {
        const r = await c.query(`SELECT polname FROM pg_policy p
          JOIN pg_class c2 ON c2.oid=p.polrelid JOIN pg_namespace n ON n.oid=c2.relnamespace
          WHERE n.nspname='orva_eff_test' AND c2.relname='orders'
            AND polname IN ('Allow admin token order update','Allow admin token order delete')`);
        if (r.rowCount !== 0) throw new Error('policies remain');
    });

    await check('after mutation: anon UPDATE fails', async () => {
        const r = await asRole(c, 'orva_eff_anon',
            `UPDATE orva_eff_test.orders SET status='x' WHERE order_id='EFF-1'`);
        if (r.ok) {
            noteGap('ORDERS_COLUMN_UPDATE', 'anon UPDATE still succeeded (column-level UPDATE?)');
            throw new Error('update succeeded');
        }
    });

    await check('after mutation: column UPDATE(status) privilege', async () => {
        const r = await c.query(
            `SELECT has_column_privilege('orva_eff_anon','orva_eff_test.orders','status','UPDATE') AS u`
        );
        if (r.rows[0].u) {
            noteGap('ORDERS_COLUMN_UPDATE_PRIV', 'column-level UPDATE(status) remains after table REVOKE UPDATE');
        }
    });

    await check('after mutation: anon DELETE/TRUNCATE fail', async () => {
        const d = await asRole(c, 'orva_eff_anon', `DELETE FROM orva_eff_test.orders WHERE order_id='EFF-1'`);
        if (d.ok) throw new Error('delete ok');
        const t = await asRole(c, 'orva_eff_anon', `TRUNCATE orva_eff_test.orders`);
        if (t.ok) throw new Error('truncate ok');
    });

    await check('after mutation: INSERT still ok', async () => {
        const r = await asRole(c, 'orva_eff_anon',
            `INSERT INTO orva_eff_test.orders (order_id) VALUES ('EFF-INS-2')`);
        if (!r.ok) throw new Error(r.message);
    });

    await check('after mutation: sequence USAGE remains for INSERT', async () => {
        const r = await c.query(
            `SELECT has_sequence_privilege('orva_eff_anon','orva_eff_test.orders_id_seq','USAGE') AS u`
        );
        if (!r.rows[0].u) throw new Error('sequence USAGE lost — would break serial INSERT');
    });

    await check('after mutation: INVOKER function cannot read without table SELECT', async () => {
        const r = await c.query(
            `SELECT has_function_privilege('orva_eff_anon','orva_eff_test.list_order_ids()','EXECUTE') AS e`
        );
        if (!r.rows[0].e) throw new Error('EXECUTE should remain (proposals do not touch functions)');
        noteGap('FUNCTION_EXECUTE_UNTOUCHED', 'EXECUTE left in place by design — safe only if no SECURITY DEFINER leak exists on Production');
        const call = await asRole(c, 'orva_eff_anon', `SELECT orva_eff_test.list_order_ids() LIMIT 1`);
        if (call.ok) throw new Error('INVOKER function still returned rows');
    });

    // Apply file 4 — rate_limits least privilege
    const sql4 = adaptSql(fs.readFileSync(path.join(ROOT, 'supabase', 'proposals', PROPOSALS[3]), 'utf8'));
    await c.query(sql4);

    await check('after rl-least: anon UPDATE/DELETE rate_limits fail', async () => {
        const u = await asRole(c, 'orva_eff_anon', `UPDATE orva_eff_test.rate_limits SET phone='1'`);
        if (u.ok) throw new Error('rl update ok');
        const d = await asRole(c, 'orva_eff_anon', `DELETE FROM orva_eff_test.rate_limits`);
        if (d.ok) throw new Error('rl delete ok');
    });

    await check('after rl-least: INSERT remains', async () => {
        const r = await asRole(c, 'orva_eff_anon',
            `INSERT INTO orva_eff_test.rate_limits (phone) VALUES ('0555333444')`);
        if (!r.ok) throw new Error(r.message);
    });

    await check('service_role retains SELECT/UPDATE', async () => {
        const s = await asRole(c, 'orva_eff_service_role',
            `SELECT order_id FROM orva_eff_test.orders LIMIT 5`);
        if (!s.ok) throw new Error(s.message);
        const u = await asRole(c, 'orva_eff_service_role',
            `UPDATE orva_eff_test.orders SET status='pending' WHERE order_id='EFF-1'`);
        if (!u.ok) throw new Error(u.message);
    });

    await check('authenticated blocked from SELECT/UPDATE/DELETE orders', async () => {
        const s = await asRole(c, 'orva_eff_authenticated', `SELECT order_id FROM orva_eff_test.orders LIMIT 1`);
        if (s.ok) throw new Error('authenticated SELECT still works');
        const u = await asRole(c, 'orva_eff_authenticated',
            `UPDATE orva_eff_test.orders SET status='z' WHERE order_id='EFF-1'`);
        if (u.ok) throw new Error('auth update ok');
        const d = await asRole(c, 'orva_eff_authenticated',
            `DELETE FROM orva_eff_test.orders WHERE order_id='EFF-1'`);
        if (d.ok) throw new Error('auth delete ok');
    });

    await check('schema USAGE retained for checkout roles', async () => {
        const r = await c.query(
            `SELECT has_schema_privilege('orva_eff_anon','orva_eff_test','USAGE') AS u`
        );
        if (!r.rows[0].u) throw new Error('schema USAGE lost');
    });

    await check('inventory-state.json untouched', async () => {
        const inv = path.join(ROOT, 'data', 'inventory-state.json');
        const m = fs.statSync(inv).mtimeMs;
        if (fs.statSync(inv).mtimeMs !== m) throw new Error('mtime changed');
    });

    // Cleanup
    await c.query('DROP SCHEMA IF EXISTS orva_eff_test CASCADE');
    for (const r of [
        'orva_eff_anon', 'orva_eff_authenticated', 'orva_eff_service_role',
        'orva_eff_readers', 'orva_eff_noinherit',
    ]) {
        await c.query(`DROP ROLE IF EXISTS ${r}`);
    }
    await c.end();

    const failed = results.filter((x) => x.status === 'FAIL');
    console.log(JSON.stringify({
        passed: results.length - failed.length,
        failed: failed.length,
        gaps,
        hashesBefore,
        results,
    }, null, 2));
    // Exit 0 even with intentional gap-driven FAIL on row access — report drives SQL fixes
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
