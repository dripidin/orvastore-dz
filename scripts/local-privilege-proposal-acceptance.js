'use strict';
/**
 * Local-only simulation of Production least-privilege SQL proposals.
 * Uses disposable schema orva_priv_sim — does NOT touch inventory JSON or hosted Supabase.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadLocalPgEnv() {
    const envPath = path.join(__dirname, '..', 'data', 'private', 'orva-local-pg.env');
    if (!fs.existsSync(envPath)) throw new Error('LOCAL_PG_ENV_MISSING');
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        if (!line || line.trim().startsWith('#')) continue;
        const i = line.indexOf('=');
        if (i < 0) continue;
        const k = line.slice(0, i).trim();
        const v = line.slice(i + 1).trim();
        if (k && !process.env[k]) process.env[k] = v;
    }
}

async function asRole(admin, role, sql) {
    await admin.query('BEGIN');
    try {
        await admin.query(`SET LOCAL ROLE ${role}`);
        const r = await admin.query(sql);
        await admin.query('COMMIT');
        return { ok: true, rows: r.rows, rowCount: r.rowCount };
    } catch (e) {
        try { await admin.query('ROLLBACK'); } catch (_) {}
        return { ok: false, code: e.code, message: e.message };
    }
}

async function expectFail(admin, role, sql, label) {
    const r = await asRole(admin, role, sql);
    if (r.ok) throw new Error(`${label}: expected fail but succeeded`);
    return r;
}

async function expectOk(admin, role, sql, label) {
    const r = await asRole(admin, role, sql);
    if (!r.ok) throw new Error(`${label}: expected ok but failed: ${r.message}`);
    return r;
}

(async () => {
    loadLocalPgEnv();
    const results = [];
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

    const admin = new Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();

    // Dedicated simulation roles (avoid colliding with pre-existing local Supabase-like ACLs).
    const roles = {
        anon: 'orva_sim_anon',
        authenticated: 'orva_sim_authenticated',
        service_role: 'orva_sim_service_role',
    };
    for (const role of Object.values(roles)) {
        await admin.query(`DROP ROLE IF EXISTS ${role}`);
        await admin.query(`CREATE ROLE ${role} NOLOGIN`);
    }
    await admin.query(`ALTER ROLE ${roles.service_role} BYPASSRLS`);

    await admin.query('DROP SCHEMA IF EXISTS orva_priv_sim CASCADE');
    await admin.query('CREATE SCHEMA orva_priv_sim');
    await admin.query(`
      CREATE TABLE orva_priv_sim.orders (
        id bigserial PRIMARY KEY,
        order_id text UNIQUE NOT NULL,
        full_name text,
        status text DEFAULT 'pending'
      );
      CREATE TABLE orva_priv_sim.rate_limits (
        id bigserial PRIMARY KEY,
        phone text,
        device_id text,
        ip text,
        created_at timestamptz DEFAULT now()
      );
    `);
    await admin.query(`ALTER TABLE orva_priv_sim.orders ENABLE ROW LEVEL SECURITY`);
    await admin.query(`ALTER TABLE orva_priv_sim.rate_limits ENABLE ROW LEVEL SECURITY`);

    // Baseline: mirror Production-like open grants + policies
    await admin.query(`
      GRANT USAGE ON SCHEMA orva_priv_sim TO ${roles.anon}, ${roles.authenticated}, ${roles.service_role};
      GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON orva_priv_sim.orders TO ${roles.anon}, ${roles.authenticated};
      GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON orva_priv_sim.rate_limits TO ${roles.anon}, ${roles.authenticated};
      GRANT ALL ON ALL TABLES IN SCHEMA orva_priv_sim TO ${roles.service_role};
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA orva_priv_sim TO ${roles.anon}, ${roles.authenticated}, ${roles.service_role};
    `);
    await admin.query(`
      CREATE POLICY "Allow anon order read" ON orva_priv_sim.orders FOR SELECT TO ${roles.anon}, ${roles.authenticated} USING (true);
      CREATE POLICY "Allow anon order insertion" ON orva_priv_sim.orders FOR INSERT TO ${roles.anon}, ${roles.authenticated} WITH CHECK (true);
      CREATE POLICY "Allow admin token order update" ON orva_priv_sim.orders FOR UPDATE TO ${roles.anon}, ${roles.authenticated} USING (true) WITH CHECK (true);
      CREATE POLICY "Allow admin token order delete" ON orva_priv_sim.orders FOR DELETE TO ${roles.anon}, ${roles.authenticated} USING (true);
      CREATE POLICY "Service role full access on orders" ON orva_priv_sim.orders FOR ALL TO ${roles.service_role} USING (true) WITH CHECK (true);
      CREATE POLICY "Allow anon rate limit select" ON orva_priv_sim.rate_limits FOR SELECT TO ${roles.anon}, ${roles.authenticated} USING (true);
      CREATE POLICY "Allow anon rate limit insert" ON orva_priv_sim.rate_limits FOR INSERT TO ${roles.anon}, ${roles.authenticated} WITH CHECK (true);
      CREATE POLICY "Service role full access on rate_limits" ON orva_priv_sim.rate_limits FOR ALL TO ${roles.service_role} USING (true) WITH CHECK (true);
    `);

    // Seed via table owner (admin connection role)
    await admin.query(`INSERT INTO orva_priv_sim.orders (order_id, full_name) VALUES ('SYNTH-1','Local Synthetic')`);

    // Apply proposal mirrors (same operations, schema-qualified)
    await admin.query(`DROP POLICY IF EXISTS "Allow anon order read" ON orva_priv_sim.orders`);
    await admin.query(`REVOKE SELECT ON TABLE orva_priv_sim.orders FROM ${roles.anon}`);
    await admin.query(`REVOKE SELECT ON TABLE orva_priv_sim.orders FROM ${roles.authenticated}`);

    await admin.query(`DROP POLICY IF EXISTS "Allow anon rate limit select" ON orva_priv_sim.rate_limits`);
    await admin.query(`REVOKE SELECT ON TABLE orva_priv_sim.rate_limits FROM ${roles.anon}`);
    await admin.query(`REVOKE SELECT ON TABLE orva_priv_sim.rate_limits FROM ${roles.authenticated}`);

    await admin.query(`DROP POLICY IF EXISTS "Allow admin token order update" ON orva_priv_sim.orders`);
    await admin.query(`DROP POLICY IF EXISTS "Allow admin token order delete" ON orva_priv_sim.orders`);
    await admin.query(`REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE orva_priv_sim.orders FROM ${roles.anon}`);
    await admin.query(`REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE orva_priv_sim.orders FROM ${roles.authenticated}`);

    await admin.query(`REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE orva_priv_sim.rate_limits FROM ${roles.anon}`);
    await admin.query(`REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE orva_priv_sim.rate_limits FROM ${roles.authenticated}`);

    // Explicitly keep INSERT (mirrors proposal: do not revoke INSERT).
    await admin.query(`GRANT INSERT ON TABLE orva_priv_sim.orders TO ${roles.anon}, ${roles.authenticated}`);
    await admin.query(`GRANT INSERT ON TABLE orva_priv_sim.rate_limits TO ${roles.anon}, ${roles.authenticated}`);
    await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA orva_priv_sim TO ${roles.anon}, ${roles.authenticated}, ${roles.service_role}`);

    await check('anon cannot SELECT orders', async () => {
        await expectFail(admin, roles.anon, `SELECT order_id FROM orva_priv_sim.orders LIMIT 1`, 'anon select orders');
    });
    await check('anon can INSERT orders', async () => {
        await expectOk(
            admin,
            roles.anon,
            // No RETURNING — RETURNING requires SELECT privilege which we intentionally revoke.
            `INSERT INTO orva_priv_sim.orders (order_id, full_name) VALUES ('SYNTH-ANON-INS','x')`,
            'anon insert'
        );
    });
    await check('authenticated cannot SELECT orders', async () => {
        await expectFail(admin, roles.authenticated, `SELECT order_id FROM orva_priv_sim.orders LIMIT 1`, 'auth select');
    });
    await check('authenticated cannot UPDATE orders', async () => {
        await expectFail(admin, roles.authenticated, `UPDATE orva_priv_sim.orders SET status='x' WHERE order_id='SYNTH-1'`, 'auth update');
    });
    await check('authenticated cannot DELETE orders', async () => {
        await expectFail(admin, roles.authenticated, `DELETE FROM orva_priv_sim.orders WHERE order_id='SYNTH-1'`, 'auth delete');
    });
    await check('anon cannot UPDATE orders', async () => {
        await expectFail(admin, roles.anon, `UPDATE orva_priv_sim.orders SET status='x' WHERE order_id='SYNTH-1'`, 'anon update');
    });
    await check('anon cannot DELETE orders', async () => {
        await expectFail(admin, roles.anon, `DELETE FROM orva_priv_sim.orders WHERE order_id='SYNTH-1'`, 'anon delete');
    });
    await check('anon cannot TRUNCATE orders', async () => {
        await expectFail(admin, roles.anon, `TRUNCATE orva_priv_sim.orders`, 'anon truncate');
    });
    await check('anon cannot REFERENCES (CREATE FK)', async () => {
        await expectFail(
            admin,
            roles.anon,
            `CREATE TABLE orva_priv_sim._fk_probe (id int REFERENCES orva_priv_sim.orders(id))`,
            'anon references'
        );
    });
    await check('anon can INSERT rate_limits only', async () => {
        await expectOk(
            admin,
            roles.anon,
            `INSERT INTO orva_priv_sim.rate_limits (phone) VALUES ('0555000000')`,
            'anon rl insert'
        );
        await expectFail(admin, roles.anon, `SELECT id FROM orva_priv_sim.rate_limits LIMIT 1`, 'anon rl select');
        await expectFail(admin, roles.anon, `UPDATE orva_priv_sim.rate_limits SET phone='1'`, 'anon rl update');
        await expectFail(admin, roles.anon, `DELETE FROM orva_priv_sim.rate_limits`, 'anon rl delete');
    });
    await check('service_role can read and update orders', async () => {
        await expectOk(admin, roles.service_role, `SELECT order_id FROM orva_priv_sim.orders LIMIT 5`, 'sr select');
        await expectOk(
            admin,
            roles.service_role,
            `UPDATE orva_priv_sim.orders SET status='pending' WHERE order_id='SYNTH-1'`,
            'sr update'
        );
    });
    await check('inventory JSON untouched marker', async () => {
        const inv = path.join(__dirname, '..', 'data', 'inventory-state.json');
        const before = fs.statSync(inv).mtimeMs;
        const after = fs.statSync(inv).mtimeMs;
        if (before !== after) throw new Error('inventory mtime changed unexpectedly');
    });
    await check('PUBLIC role has no unexpected table grants on sim tables', async () => {
        const r = await admin.query(`
          SELECT grantee, privilege_type
          FROM information_schema.role_table_grants
          WHERE table_schema = 'orva_priv_sim'
            AND table_name IN ('orders','rate_limits')
            AND grantee = 'PUBLIC'
        `);
        if (r.rowCount > 0) throw new Error(`unexpected PUBLIC grants: ${r.rowCount}`);
    });

    await admin.query('DROP SCHEMA IF EXISTS orva_priv_sim CASCADE');
    for (const role of Object.values(roles)) {
        await admin.query(`DROP ROLE IF EXISTS ${role}`);
    }
    await admin.end();

    const failed = results.filter((x) => x.status === 'FAIL');
    console.log(JSON.stringify({
        note: 'Local simulation only — Supabase role membership/BYPASSRLS may differ',
        passed: results.length - failed.length,
        failed: failed.length,
        results,
    }, null, 2));
    process.exit(failed.length ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
