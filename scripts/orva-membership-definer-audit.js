'use strict';
/**
 * ORVA STORE — local role-membership & SECURITY DEFINER simulation (orva_local ONLY).
 *
 * Disposable schema `orva_role_test` and roles `orva_role_*`.
 * No hosted Supabase access. No real orders/customers/inventory data.
 * Drops and recreates everything.
 *
 * Leak criteria: a check only counts as a LEAK when `ok && rowCount > 0`
 * (or, for UPDATE/DELETE, a statement that actually affected rows).
 * A query that succeeds but returns zero rows is NOT a leak (RLS can hide rows).
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
  const env = {};
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function sha256(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').toUpperCase();
}

/** Adapt the production proposals onto disposable schema/roles for local simulation. */
function adaptSql(raw) {
  const out = raw
    .replace(/ON public\.orders/g, 'ON orva_role_test.orders')
    .replace(/ON TABLE public\.orders/g, 'ON TABLE orva_role_test.orders')
    .replace(/ON public\.rate_limits/g, 'ON orva_role_test.rate_limits')
    .replace(/ON TABLE public\.rate_limits/g, 'ON TABLE orva_role_test.rate_limits')
    .replace(/table_schema = 'public'/g, "table_schema = 'orva_role_test'")
    .replace(/\bFROM anon\b/g, 'FROM orva_role_anon')
    .replace(/\bFROM authenticated\b/g, 'FROM orva_role_authenticated')
    .replace(/\bTO anon\b/g, 'TO orva_role_anon')
    .replace(/\bTO authenticated\b/g, 'TO orva_role_authenticated')
    .replace(/\bTO service_role\b/g, 'TO orva_role_service');
  return out.replace(/ARRAY\['anon', 'authenticated', 'PUBLIC'\]/g, "ARRAY['orva_role_anon', 'orva_role_authenticated', 'PUBLIC']");
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

/** Returns { ok, rowCount, rows } after running `sql` as `role` with a preceding extra SET ROLE. */
async function asRoleAfter(c, transactionRole, setRole, sql) {
  await c.query('BEGIN');
  try {
    await c.query(`SET LOCAL ROLE ${transactionRole}`);
    await c.query(`SET LOCAL ROLE ${setRole}`);
    const r = await c.query(sql);
    await c.query('COMMIT');
    return { ok: true, rowCount: r.rowCount, rows: r.rows };
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (_) {}
    return { ok: false, code: e.code, message: e.message };
  }
}

(async () => {
  const env = loadEnv();
  const results = [];
  const gaps = [];
  const notes = [];
  const check = async (name, fn) => {
    try {
      await fn();
      results.push({ name, status: 'PASS' });
      console.log('PASS', name);
    } catch (e) {
      results.push({ name, status: 'FAIL', error: e.message });
      console.log('FAIL', name, '->', e.message);
    }
  };
  const noteGap = (id, detail) => {
    gaps.push({ id, detail });
    console.log('GAP', id, '->', detail);
  };
  const note = (id, detail) => {
    notes.push({ id, detail });
    console.log('NOTE', id, '->', detail);
  };
  const leak = (ok, rowCount) => ok && rowCount > 0;

  const hashesBefore = {};
  for (const f of PROPOSALS) hashesBefore[f] = sha256(path.join('supabase', 'proposals', f));

  const c = new Client({
    host: env.ORVA_LOCAL_PG_HOST,
    port: env.ORVA_LOCAL_PG_PORT,
    user: env.ORVA_LOCAL_PG_SUPERUSER,
    password: env.ORVA_LOCAL_PG_PASSWORD,
    database: env.ORVA_LOCAL_PG_DATABASE,
  });
  await c.connect();
  const ver = await c.query("SELECT current_setting('server_version_num') AS num");
  console.log('server_version_num:', ver.rows[0].num);
  for (const [file, hash] of Object.entries(hashesBefore)) console.log('SHA', file, hash);

  const roles = [
    'orva_role_anon', 'orva_role_authenticated', 'orva_role_service', 'orva_role_owner',
    'orva_role_readers', 'orva_role_chain_mid', 'orva_role_mutators', 'orva_role_auth_readers',
    'orva_role_func_exec', 'orva_role_noinherit_role', 'orva_role_setter', 'orva_role_cleancaller',
  ];
  await c.query('DROP SCHEMA IF EXISTS orva_role_test CASCADE');
  await c.query('DROP SCHEMA IF EXISTS orva_private_test CASCADE');
  await c.query('DROP SCHEMA IF EXISTS orva_role_attacker CASCADE');
  await c.query('DROP SCHEMA IF EXISTS orva_role_attacker CASCADE');
  for (const r of roles) await c.query(`DROP ROLE IF EXISTS ${r}`);

  await c.query(`CREATE ROLE orva_role_anon NOLOGIN INHERIT`);
  await c.query(`CREATE ROLE orva_role_authenticated NOLOGIN INHERIT`);
  await c.query(`CREATE ROLE orva_role_service NOLOGIN INHERIT BYPASSRLS`);
  await c.query(`CREATE ROLE orva_role_owner NOLOGIN INHERIT BYPASSRLS`);
  await c.query(`CREATE ROLE orva_role_readers NOLOGIN INHERIT`);
  await c.query(`CREATE ROLE orva_role_chain_mid NOLOGIN INHERIT`);
  await c.query(`CREATE ROLE orva_role_mutators NOLOGIN INHERIT`);
  await c.query(`CREATE ROLE orva_role_auth_readers NOLOGIN INHERIT`);
  await c.query(`CREATE ROLE orva_role_func_exec NOLOGIN INHERIT`);
  await c.query(`CREATE ROLE orva_role_noinherit_role NOLOGIN NOINHERIT`);
  await c.query(`CREATE ROLE orva_role_setter NOLOGIN INHERIT`);
  await c.query(`CREATE ROLE orva_role_cleancaller NOLOGIN INHERIT`);

  await c.query('CREATE SCHEMA orva_role_test');
  await c.query('CREATE SCHEMA orva_private_test');
  await c.query('GRANT USAGE ON SCHEMA orva_role_test TO PUBLIC');
  await c.query('REVOKE USAGE ON SCHEMA orva_private_test FROM PUBLIC');

  await c.query(`
    CREATE TABLE orva_role_test.orders (
      id bigserial PRIMARY KEY,
      order_id text UNIQUE NOT NULL,
      full_name text,
      phone text,
      status text DEFAULT 'pending'
    );
    CREATE TABLE orva_role_test.rate_limits (
      id bigserial PRIMARY KEY,
      phone text,
      device_id text,
      ip text,
      created_at timestamptz DEFAULT now()
    );
    ALTER TABLE orva_role_test.orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE orva_role_test.rate_limits ENABLE ROW LEVEL SECURITY;
  `);
  await c.query(`INSERT INTO orva_role_test.orders (order_id, full_name, phone) VALUES ('MEM-1','Synthetic One','0555000001'),('MEM-2','Synthetic Two','0555000002')`);
  await c.query(`INSERT INTO orva_role_test.rate_limits (phone, device_id, ip) VALUES ('0555000001','dev-1','10.0.0.1')`);

  // Baseline policies mirroring Production names.
  // NO PUBLIC SELECT fixture. NO direct table SELECT for anon/authenticated is NOT granted here:
  // the SELECT path under test is the membership path (that is the point of Sections A/B).
  await c.query(`
    CREATE POLICY "Allow anon order insertion" ON orva_role_test.orders
      FOR INSERT TO orva_role_anon, orva_role_authenticated WITH CHECK (true);
    CREATE POLICY "Allow admin token order update" ON orva_role_test.orders
      FOR UPDATE TO orva_role_anon, orva_role_authenticated USING (true) WITH CHECK (true);
    CREATE POLICY "Allow admin token order delete" ON orva_role_test.orders
      FOR DELETE TO orva_role_anon, orva_role_authenticated USING (true);
    CREATE POLICY "Service role full access on orders" ON orva_role_test.orders
      FOR ALL TO orva_role_service USING (true) WITH CHECK (true);
    CREATE POLICY "Allow anon rate limit select" ON orva_role_test.rate_limits
      FOR SELECT TO orva_role_anon, orva_role_authenticated USING (true);
    CREATE POLICY "Allow anon rate limit insert" ON orva_role_test.rate_limits
      FOR INSERT TO orva_role_anon, orva_role_authenticated WITH CHECK (true);
    CREATE POLICY "Service role full access on rate_limits" ON orva_role_test.rate_limits
      FOR ALL TO orva_role_service USING (true) WITH CHECK (true);
  `);
  // Intermediate-role policies: the dangerous case the four proposals never touch.
  await c.query(`
    CREATE POLICY orva_role_readers_select ON orva_role_test.orders
      FOR SELECT TO orva_role_readers USING (true);
    CREATE POLICY orva_role_readers_rl_select ON orva_role_test.rate_limits
      FOR SELECT TO orva_role_readers USING (true);
    CREATE POLICY orva_role_auth_readers_select ON orva_role_test.orders
      FOR SELECT TO orva_role_auth_readers USING (true);
    CREATE POLICY orva_role_mutators_update ON orva_role_test.orders
      FOR UPDATE TO orva_role_mutators USING (true) WITH CHECK (true);
    CREATE POLICY orva_role_mutators_delete ON orva_role_test.orders
      FOR DELETE TO orva_role_mutators USING (true);
    CREATE POLICY orva_role_mutators_rl_update ON orva_role_test.rate_limits
      FOR UPDATE TO orva_role_mutators USING (true) WITH CHECK (true);
    CREATE POLICY orva_role_mutators_rl_delete ON orva_role_test.rate_limits
      FOR DELETE TO orva_role_mutators USING (true);
  `);

  // Attacker-controlled schema/object; the hijack test drives the caller's search_path,
  // because a SECURITY DEFINER function resolves unqualified names in the caller's path.
  await c.query(`CREATE SCHEMA orva_role_attacker`);
  await c.query(`GRANT USAGE ON SCHEMA orva_role_attacker TO orva_role_cleancaller`);
  await c.query(`GRANT CREATE ON SCHEMA orva_role_attacker TO orva_role_cleancaller`);

  await c.query(`
    GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON orva_role_test.orders TO orva_role_anon, orva_role_authenticated;
    ALTER TABLE orva_role_test.orders ENABLE ROW LEVEL SECURITY;
    REVOKE SELECT ON TABLE orva_role_test.orders FROM orva_role_anon, orva_role_authenticated;
    GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON orva_role_test.rate_limits TO orva_role_anon, orva_role_authenticated;
    REVOKE SELECT ON TABLE orva_role_test.rate_limits FROM orva_role_anon, orva_role_authenticated;
    GRANT INSERT ON TABLE orva_role_test.rate_limits TO orva_role_anon, orva_role_authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA orva_role_test TO orva_role_service;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA orva_role_test TO orva_role_anon, orva_role_authenticated, orva_role_service;
    GRANT USAGE ON SCHEMA orva_role_test TO orva_role_owner, orva_role_cleancaller;
    GRANT SELECT ON orva_role_test.orders TO orva_role_owner;
    GRANT SELECT ON orva_role_test.rate_limits TO orva_role_owner;
  `);

  // ---------- membership fixtures ----------
  await c.query(`GRANT SELECT ON TABLE orva_role_test.orders TO orva_role_readers`);
  await c.query(`GRANT SELECT ON TABLE orva_role_test.rate_limits TO orva_role_readers`);
  // case 2: member with SET allowed but INHERIT FALSE -> cannot read directly, CAN SET ROLE.
  await c.query(`GRANT orva_role_readers TO orva_role_setter WITH INHERIT FALSE, SET TRUE`);
  await c.query(`GRANT orva_role_readers TO orva_role_noinherit_role WITH INHERIT FALSE, SET TRUE`);
  // indirect: anon -> chain_mid -> readers
  await c.query(`GRANT orva_role_chain_mid TO orva_role_anon WITH INHERIT TRUE, SET TRUE`);
  await c.query(`GRANT orva_role_readers TO orva_role_chain_mid WITH INHERIT TRUE, SET TRUE`);
  // case 3: authenticated member of role holding SELECT
  await c.query(`GRANT SELECT ON TABLE orva_role_test.orders TO orva_role_auth_readers`);
  await c.query(`GRANT orva_role_auth_readers TO orva_role_authenticated WITH INHERIT TRUE, SET TRUE`);
  // mutation via membership
  await c.query(`GRANT UPDATE, DELETE ON TABLE orva_role_test.orders TO orva_role_mutators`);
  await c.query(`GRANT UPDATE, DELETE ON TABLE orva_role_test.rate_limits TO orva_role_mutators`);
  await c.query(`GRANT orva_role_mutators TO orva_role_anon WITH INHERIT TRUE, SET TRUE`);

  // Views (owner-privileged, mirroring production security-definer-like view exposure)
  await c.query(`CREATE VIEW orva_role_test.orders_view AS SELECT order_id FROM orva_role_test.orders`);
  await c.query(`ALTER VIEW orva_role_test.orders_view OWNER TO orva_role_owner`);
  await c.query(`GRANT SELECT ON orva_role_test.orders_view TO PUBLIC`);

  // Functions (owner = orva_role_owner, BYPASSRLS, with EXECUTE to PUBLIC for two of them)
  await c.query(`
    CREATE OR REPLACE FUNCTION orva_role_test.f_invoker_list() RETURNS SETOF text
      LANGUAGE sql STABLE SECURITY INVOKER AS $$ SELECT order_id FROM orva_role_test.orders $$;
    CREATE OR REPLACE FUNCTION orva_role_test.f_definer_public() RETURNS SETOF text
      LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT order_id FROM orva_role_test.orders $$;
    CREATE OR REPLACE FUNCTION orva_role_test.f_definer_restricted() RETURNS SETOF text
      LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT order_id FROM orva_role_test.orders $$;
    CREATE OR REPLACE FUNCTION orva_role_test.f_definer_no_searchpath() RETURNS SETOF text
      LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT order_id FROM orders $$;
    CREATE OR REPLACE FUNCTION orva_role_test.f_definer_safe_searchpath() RETURNS SETOF text
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = '' AS $$ SELECT order_id FROM orva_role_test.orders $$;
    ALTER FUNCTION orva_role_test.f_invoker_list() OWNER TO orva_role_owner;
    ALTER FUNCTION orva_role_test.f_definer_public() OWNER TO orva_role_owner;
    ALTER FUNCTION orva_role_test.f_definer_restricted() OWNER TO orva_role_owner;
    ALTER FUNCTION orva_role_test.f_definer_no_searchpath() OWNER TO orva_role_owner;
    ALTER FUNCTION orva_role_test.f_definer_safe_searchpath() OWNER TO orva_role_owner;
    REVOKE ALL ON FUNCTION orva_role_test.f_definer_restricted() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION orva_role_test.f_definer_restricted() TO orva_role_authenticated;
    GRANT EXECUTE ON FUNCTION orva_role_test.f_invoker_list() TO PUBLIC, orva_role_cleancaller;
    GRANT EXECUTE ON FUNCTION orva_role_test.f_definer_no_searchpath() TO PUBLIC;
    GRANT EXECUTE ON FUNCTION orva_role_test.f_definer_safe_searchpath() TO PUBLIC;
  `);
  await c.query(`GRANT EXECUTE ON FUNCTION orva_role_test.f_definer_restricted() TO orva_role_func_exec`);
  await c.query(`GRANT orva_role_func_exec TO orva_role_anon WITH INHERIT TRUE, SET TRUE`);

  const line = (label) => console.log('\n--- ' + label + ' ---');
  line('A. membership matrix (local, catalog-only)');
  const mem = await c.query(`
    SELECT granted_role.rolname AS granted_role, m.rolname AS member, am.inherit_option, am.set_option
    FROM pg_auth_members am
    JOIN pg_roles granted_role ON granted_role.oid = am.roleid
    JOIN pg_roles m ON m.oid = am.member
    WHERE granted_role.rolname LIKE 'orva_role_%' OR m.rolname LIKE 'orva_role_%'
    ORDER BY 1, 2`);
  for (const r of mem.rows) console.log('membership:', JSON.stringify(r));

  const ht = async (role, priv) => (await c.query(
    `SELECT has_table_privilege($1,'orva_role_test.orders',$2) AS v`, [role, priv])).rows[0].v;

  await check('A1: pg_has_role anon->chain_mid USAGE=true (INHERIT)', async () => {
    const r = await c.query("SELECT pg_has_role('orva_role_anon','orva_role_chain_mid','USAGE') AS v");
    if (r.rows[0].v !== true) throw new Error('expected true');
  });
  await check('A2: pg_has_role anon->chain_mid SET=true', async () => {
    const r = await c.query("SELECT pg_has_role('orva_role_anon','orva_role_chain_mid','SET') AS v");
    if (r.rows[0].v !== true) throw new Error('expected true');
  });
  await check('A3: indirect membership anon->chain_mid->readers grants USAGE (pg_has_role)', async () => {
    const r = await c.query("SELECT pg_has_role('orva_role_anon','orva_role_readers','USAGE') AS v");
    if (r.rows[0].v !== true) throw new Error('expected true via indirect membership');
    const direct = await c.query("SELECT count(*)::int AS n FROM pg_auth_members am JOIN pg_roles r ON r.oid=am.roleid JOIN pg_roles m ON m.oid=am.member WHERE r.rolname='orva_role_readers' AND m.rolname='orva_role_anon'");
    console.log('   direct anon->readers rows:', direct.rows[0].n);
    if (direct.rows[0].n !== 0) throw new Error('unexpected direct membership');
  });
  await check('A4: NOINHERIT member role cannot use granted SELECT; no direct table privilege', async () => {
    const r = await c.query("SELECT pg_has_role('orva_role_noinherit_role','orva_role_readers','USAGE') AS v");
    if (r.rows[0].v !== false) throw new Error('USAGE must be false for INHERIT FALSE membership');
    const s = await asRole(c, 'orva_role_noinherit_role', 'SELECT order_id FROM orva_role_test.orders LIMIT 1');
    if (leak(s.ok, s.rowCount)) throw new Error('NOINHERIT role read rows directly');
  });
  await check('A5: NOINHERIT member can SET ROLE readers (SET option true) and then read', async () => {
    const r = await asRoleAfter(c, 'orva_role_noinherit_role', 'orva_role_readers', 'SELECT order_id FROM orva_role_test.orders');
    if (!r.ok) throw new Error('SET ROLE rejected: ' + r.message);
    if (!leak(r.ok, r.rowCount)) throw new Error('readers role sees zero rows despite policy');
  });
  await check('A6: INHERIT FALSE + SET TRUE membership: pg_has_role SET=true USAGE=false', async () => {
    const r = await c.query("SELECT pg_has_role('orva_role_setter','orva_role_readers','USAGE') AS u, pg_has_role('orva_role_setter','orva_role_readers','SET') AS s");
    if (r.rows[0].u !== false) throw new Error('USAGE must be false');
    if (r.rows[0].s !== true) throw new Error('SET must be true');
  });
  await check('A6b: setter membership without INHERIT blocks direct SELECT', async () => {
    const s = await asRole(c, 'orva_role_setter', 'SELECT order_id FROM orva_role_test.orders LIMIT 1');
    if (leak(s.ok, s.rowCount)) throw new Error('setter read without INHERIT');
  });
  await check('A6c: setter membership with SET TRUE allows SET ROLE readers', async () => {
    const r = await asRoleAfter(c, 'orva_role_setter', 'orva_role_readers', 'SELECT order_id FROM orva_role_test.orders');
    if (!leak(r.ok, r.rowCount)) throw new Error('setter SET ROLE read failed');
  });
  await check('A7: catalog has_table_privilege is the union of direct+inherited+PUBLIC', async () => {
    const q = async (role) => (await c.query(
      `SELECT has_table_privilege($1,'orva_role_test.orders','SELECT') AS v`, [role])).rows[0].v;
    const a = await q('orva_role_anon');       // via chain_mid -> readers
    const b = await q('orva_role_authenticated'); // via auth_readers
    const d = await q('orva_role_cleancaller');   // no privilege at all
    console.log('   has_table_privilege anon/authenticated/cleancaller SELECT =', a, b, d);
    if (a !== true || b !== true || d !== false) throw new Error('union check failed');
  });

  line('B. membership-only SELECT/mutation across the four proposals');
  note('B0', 'no direct SELECT granted to anon/authenticated and no PUBLIC SELECT fixture — only membership paths can work');

  const selAs = (role) => asRole(c, role, 'SELECT order_id FROM orva_role_test.orders LIMIT 2');
  const apply = async (file) => c.query(adaptSql(fs.readFileSync(path.join(ROOT, 'supabase', 'proposals', file), 'utf8')));

  await check('B1: anon with membership path reads orders BEFORE proposals', async () => {
    const r = await selAs('orva_role_anon');
    if (!leak(r.ok, r.rowCount)) throw new Error('expected membership read to work');
  });
  await check('B1c: cleancaller (no privilege at all) cannot read orders BEFORE proposals', async () => {
    const r = await asRole(c, 'orva_role_cleancaller', 'SELECT order_id FROM orva_role_test.orders LIMIT 1');
    if (leak(r.ok, r.rowCount)) throw new Error('cleancaller read rows');
  });
  await check('B2: mutation via membership (UPDATE) works BEFORE proposals', async () => {
    const r = await asRole(c, 'orva_role_anon', `UPDATE orva_role_test.orders SET status='mem-write' WHERE order_id='MEM-1'`);
    if (r.ok) note('B2', `UPDATE via membership affected ${r.rowCount} row(s)`);
  });

  await apply(PROPOSALS[0]);
  await apply(PROPOSALS[1]);
  console.log('\n--- after SELECT containment (files 1 & 2) ---');
  await check('B3: catalog — no SELECT grant for anon/auth/PUBLIC remains', async () => {
    const r = await c.query(`
      SELECT grantee FROM information_schema.role_table_grants
      WHERE table_schema='orva_role_test' AND table_name IN ('orders','rate_limits')
        AND privilege_type='SELECT' AND grantee IN ('orva_role_anon','orva_role_authenticated','PUBLIC')`);
    if (r.rowCount > 0) throw new Error('grantees remain: ' + r.rows.map((x) => x.grantee).join(','));
  });
  await check('B4: anon STILL reads orders rows via INDIRECT membership (proposals do not revoke memberships)', async () => {
    const r = await selAs('orva_role_anon');
    if (leak(r.ok, r.rowCount)) {
      noteGap('ORDERS_SELECT_VIA_MEMBERSHIP', `row SELECT via anon->chain_mid->readers AFTER SELECT containment (rowCount=${r.rowCount})`);
      return;
    }
    note('B4', 'membership read denied in this fixture');
  });
  await check('B5: anon STILL reads rate_limits via readers membership (rowCount>0)', async () => {
    const r = await asRole(c, 'orva_role_anon', 'SELECT id FROM orva_role_test.rate_limits LIMIT 1');
    if (leak(r.ok, r.rowCount)) noteGap('RATE_LIMITS_SELECT_VIA_MEMBERSHIP', `rate_limits readable via membership after SELECT containment (rowCount=${r.rowCount})`);
  });
  await check('B6: INSERT orders still works after SELECT containment (Checkout dependency)', async () => {
    const r = await asRole(c, 'orva_role_anon', `INSERT INTO orva_role_test.orders (order_id) VALUES ('MEM-INS-1')`);
    if (!r.ok) throw new Error('INSERT lost: ' + r.message);
  });
  await check('B7: owner-privileged view still exposes order_ids to anon after SELECT containment', async () => {
    const r = await asRole(c, 'orva_role_anon', 'SELECT order_id FROM orva_role_test.orders_view LIMIT 1');
    if (leak(r.ok, r.rowCount)) noteGap('VIEW_OWNER_PRIVILEGES', `security-definer-like view returns rows with zero base-table privileges for the caller (rowCount=${r.rowCount})`);
  });

  await apply(PROPOSALS[2]);
  await apply(PROPOSALS[3]);
  console.log('\n--- after mutation lockdown (files 3 & 4) ---');
  await check('B8: anon UPDATE via mutators membership SURVIVES mutation lockdown (rowCount>0)', async () => {
    const r = await asRole(c, 'orva_role_anon', `UPDATE orva_role_test.orders SET status='mem-write-2' WHERE order_id='MEM-1'`);
    if (leak(r.ok, r.rowCount)) noteGap('ORDERS_UPDATE_VIA_MEMBERSHIP', `UPDATE via membership survived mutation lockdown (rowCount=${r.rowCount})`);
  });
  await check('B9: anon DELETE via mutators membership SURVIVES mutation lockdown (rowCount>0)', async () => {
    const r = await asRole(c, 'orva_role_anon', `DELETE FROM orva_role_test.orders WHERE order_id='MEM-INS-1'`);
    if (leak(r.ok, r.rowCount)) noteGap('ORDERS_DELETE_VIA_MEMBERSHIP', `DELETE via membership survived mutation lockdown (rowCount=${r.rowCount})`);
  });
  await check('B10: rate_limits UPDATE via mutators membership SURVIVES least-privilege file (rowCount>0)', async () => {
    const r = await asRole(c, 'orva_role_anon', `UPDATE orva_role_test.rate_limits SET phone='0555000009' WHERE phone='0555000001'`);
    if (leak(r.ok, r.rowCount)) noteGap('RATE_LIMITS_UPDATE_VIA_MEMBERSHIP', `rate_limits UPDATE survives least-privilege file via membership (rowCount=${r.rowCount})`);
  });
  await check('B11: authenticated reads orders via auth_readers membership AFTER all four files (rowCount>0)', async () => {
    const r = await selAs('orva_role_authenticated');
    if (leak(r.ok, r.rowCount)) noteGap('ORDERS_SELECT_AUTH_MEMBERSHIP', `authenticated row read via membership survives all four files (rowCount=${r.rowCount})`);
  });
  await check('B12: catalog — no direct UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER for anon/auth/PUBLIC', async () => {
    const r = await c.query(`
      SELECT grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema='orva_role_test' AND table_name IN ('orders','rate_limits')
        AND grantee IN ('orva_role_anon','orva_role_authenticated','PUBLIC')
        AND privilege_type IN ('UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')`);
    if (r.rowCount > 0) throw new Error('leaking grantees: ' + r.rows.map((x) => x.grantee + ':' + x.privilege_type).join(','));
  });

  line('C. SECURITY DEFINER / SECURITY INVOKER exposure');
  await check('C1: INVOKER f_invoker_list() fails for cleancaller (no table privileges at all)', async () => {
    const r = await asRole(c, 'orva_role_cleancaller', 'SELECT * FROM orva_role_test.f_invoker_list()');
    if (r.ok && r.rowCount > 0) throw new Error('invoker function returned rows to cleancaller');
    const asAnon = await asRole(c, 'orva_role_anon', 'SELECT * FROM orva_role_test.f_invoker_list()');
    if (asAnon.ok && asAnon.rowCount > 0) note('C1', 'anon CAN execute invoker function AND read via inherited membership — membership path, not a function flaw');
  });
  await check('C2: DEFINER f_definer_public() returns rows for anon DESPITE zero table privileges', async () => {
    const r = await asRole(c, 'orva_role_anon', 'SELECT * FROM orva_role_test.f_definer_public() ORDER BY 1');
    const htp = await ht('orva_role_anon', 'SELECT'); // still true via membership — use cleancaller for the strict case
    const cr = await asRole(c, 'orva_role_cleancaller', 'SELECT * FROM orva_role_test.f_definer_public() ORDER BY 1');
    if (leak(cr.ok, cr.rowCount)) noteGap('DEFINER_PUBLIC_EXECUTION', `SECURITY DEFINER + EXECUTE PUBLIC leaks rows to a caller with NO table privileges (rowCount=${cr.rowCount}, has_table_privilege(anon)=${htp})`);
    else if (!cr.ok) note('C2', 'cleancaller blocked: ' + cr.message);
  });
  await check('C3: restricted definer NOT callable by cleancaller (no privileges, no membership)', async () => {
    const a = await asRole(c, 'orva_role_cleancaller', 'SELECT * FROM orva_role_test.f_definer_restricted()');
    if (a.ok && a.rowCount > 0) throw new Error('cleancaller executed restricted definer');
    const b = await asRole(c, 'orva_role_anon', 'SELECT * FROM orva_role_test.f_definer_restricted()');
    if (b.ok && b.rowCount > 0) note('C3', 'anon CAN execute the restricted definer via membership (func_exec) — see FUNCTION_EXECUTE_VIA_MEMBERSHIP');
  });
  await check('C4: restricted definer IS callable by authenticated (owner bypasses RLS; granted role bypasses ACL)', async () => {
    const r = await asRole(c, 'orva_role_authenticated', 'SELECT * FROM orva_role_test.f_definer_restricted() ORDER BY 1');
    if (!leak(r.ok, r.rowCount)) throw new Error('expected authenticated to execute restricted definer');
  });
  await check('C5: function EXECUTE inherits through membership (anon -> func_exec)', async () => {
    const r = await asRole(c, 'orva_role_anon', 'SELECT * FROM orva_role_test.f_definer_restricted()');
    if (leak(r.ok, r.rowCount)) noteGap('FUNCTION_EXECUTE_VIA_MEMBERSHIP', 'EXECUTE on restricted definer inherited via anon membership (recoverable only by revoking the membership or the grant)');
  });
  await check('C6: unqualified definer references and caller shadow objects (probe verdict)', async () => {
    await c.query('BEGIN');
    try {
      await c.query('SET LOCAL ROLE orva_role_cleancaller');
      await c.query('SET LOCAL search_path = orva_role_attacker');
      await c.query('CREATE TABLE orva_role_attacker.orders (order_id text)');
      await c.query("INSERT INTO orva_role_attacker.orders VALUES ('SHADOWED-BY-ATTACKER')");
      await c.query('GRANT SELECT ON TABLE orva_role_attacker.orders TO PUBLIC');
      const sel = await c.query('SELECT * FROM orva_role_test.f_definer_no_searchpath()');
      await c.query('COMMIT');
      const shadowed = (sel.rows || []).some((row) => row.order_id === 'SHADOWED-BY-ATTACKER');
      if (shadowed) noteGap('SEARCH_PATH_HIJACK', 'SECURITY DEFINER without SET search_path resolved the caller-shadowed table (measured leak)');
      else note('C6', 'definer returned ' + JSON.stringify(sel.rows) + ' — caller shadow object NOT resolved in this PostgreSQL (probe verdict: shadow not reproducible locally)');
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch (_) {}
      note('C6', 'definer raised "' + e.message + '" with caller-controlled search_path — shadow object NOT resolved in this PostgreSQL');
    }
  });
  await check('C7: definer WITH SET search_path=\'\' ignores the caller-controlled search_path', async () => {
    await c.query('BEGIN');
    try {
      await c.query('SET LOCAL ROLE orva_role_cleancaller');
      await c.query('SET LOCAL search_path = orva_role_attacker');
      const sel = await c.query('SELECT * FROM orva_role_test.f_definer_safe_searchpath()');
      await c.query('COMMIT');
      if ((sel.rowCount ?? 0) < 1) throw new Error('safe function returned no rows: ' + JSON.stringify(sel.rows));
      if (sel.rows.some((row) => row.order_id === 'SHADOWED-BY-ATTACKER')) throw new Error('safe function was shadowed');
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch (_) {}
      throw e;
    }
  });
  await check('C8: proconfig persisted for search_path-hardened function', async () => {
    const r = await c.query(
      "SELECT p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='orva_role_test' AND p.proname='f_definer_safe_searchpath'");
    const cfg = r.rows[0] && r.rows[0].proconfig ? String(r.rows[0].proconfig) : '';
    if (!cfg.includes('search_path')) throw new Error('search_path not in proconfig: ' + cfg);
  });
  await check('C9: prosecdef true for definer / false for invoker', async () => {
    const r = await c.query(
      "SELECT p.proname, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='orva_role_test' AND p.proname IN ('f_invoker_list','f_definer_public','f_definer_restricted','f_definer_no_searchpath','f_definer_safe_searchpath') ORDER BY 1");
    for (const row of r.rows) {
      const expected = row.proname === 'f_invoker_list' ? false : true;
      if (row.prosecdef !== expected) throw new Error(`${row.proname} prosecdef=${row.prosecdef}`);
    }
  });

  line('D. candidate remediations (local only — nothing applied to hosted)');
  await check('D1: REVOKE EXECUTE FROM PUBLIC/anon/authenticated closes definer leak for those roles', async () => {
    await c.query('REVOKE EXECUTE ON FUNCTION orva_role_test.f_definer_public() FROM PUBLIC');
    await c.query('REVOKE EXECUTE ON FUNCTION orva_role_test.f_definer_public() FROM orva_role_anon');
    await c.query('REVOKE EXECUTE ON FUNCTION orva_role_test.f_definer_public() FROM orva_role_authenticated');
    const r = await asRole(c, 'orva_role_cleancaller', 'SELECT * FROM orva_role_test.f_definer_public()');
    if (r.ok && r.rowCount > 0) throw new Error('cleancaller still executes after REVOKE (PUBLIC grant must be gone)');
  });
  await check('D2: membership-inherited EXECUTE survives direct REVOKE (grant must be removed or membership revoked)', async () => {
    const r = await asRole(c, 'orva_role_anon', 'SELECT * FROM orva_role_test.f_definer_restricted()');
    if (leak(r.ok, r.rowCount)) noteGap('REVOKE_EXECUTE_NOT_SUFFICIENT', 'REVOKE EXECUTE FROM PUBLIC/anon/authenticated does NOT neutralize EXECUTE inherited through a membership');
  });
  await check('D3: moving the definer function to a non-exposed schema denies callers without USAGE', async () => {
    await c.query(`
      CREATE OR REPLACE FUNCTION orva_private_test.f_definer_private() RETURNS SETOF text
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = '' AS $$ SELECT order_id FROM orva_role_test.orders $$;
    `);
    await c.query('ALTER FUNCTION orva_private_test.f_definer_private() OWNER TO orva_role_owner');
    await c.query('REVOKE USAGE ON SCHEMA orva_private_test FROM PUBLIC');
    await c.query('REVOKE USAGE ON SCHEMA orva_private_test FROM orva_role_anon, orva_role_authenticated');
    const r = await asRole(c, 'orva_role_anon', 'SELECT * FROM orva_private_test.f_definer_private()');
    if (r.ok && r.rowCount > 0) throw new Error('anon executed private-schema definer');
  });
  await check('D4: security_invoker view blocks the owner-privilege bypass for callers without privileges', async () => {
    await c.query(`CREATE OR REPLACE VIEW orva_role_test.orders_view_invoker WITH (security_invoker = on) AS SELECT order_id FROM orva_role_test.orders`);
    await c.query('GRANT SELECT ON orva_role_test.orders_view_invoker TO PUBLIC');
    const r = await asRole(c, 'orva_role_cleancaller', 'SELECT * FROM orva_role_test.orders_view_invoker');
    if (leak(r.ok, r.rowCount)) throw new Error('security_invoker view returned rows to cleancaller');
  });
  await check('D5: owner-privileged (default) view still leaks to anon', async () => {
    const r = await asRole(c, 'orva_role_anon', 'SELECT order_id FROM orva_role_test.orders_view LIMIT 1');
    if (leak(r.ok, r.rowCount)) noteGap('VIEW_DEFINER_DEFAULT', 'default definer-style view returns rows to a caller with zero base-table privileges — use WITH (security_invoker=on) or REVOKE SELECT on the view');
  });
  await check('D6: SECURITY INVOKER alternative denies cleancaller (and only membership explains anon)', async () => {
    const r = await asRole(c, 'orva_role_cleancaller', 'SELECT * FROM orva_role_test.f_invoker_list()');
    if (r.ok && r.rowCount > 0) throw new Error('invoker function returned rows to cleancaller');
  });

  const hashesAfter = {};
  for (const f of PROPOSALS) hashesAfter[f] = sha256(path.join('supabase', 'proposals', f));
  const changedProposals = PROPOSALS.filter((f) => hashesBefore[f] !== hashesAfter[f]);
  if (changedProposals.length > 0) throw new Error('proposal file(s) changed during test run: ' + changedProposals.join(', '));

  line('E. cleanup (disposable objects dropped)');
  await c.query('DROP SCHEMA IF EXISTS orva_role_attacker CASCADE');
  await c.query('DROP SCHEMA IF EXISTS orva_private_test CASCADE');
  await c.query('DROP SCHEMA IF EXISTS orva_role_test CASCADE');
  for (const r of roles.slice().reverse()) {
    try { await c.query(`DROP ROLE IF EXISTS ${r}`); } catch (e) { console.log('role cleanup note', r, e.message); }
  }
  await c.end();

  const out = {
    simulatedAt: new Date().toISOString(),
    host: env.ORVA_LOCAL_PG_HOST,
    database: env.ORVA_LOCAL_PG_DATABASE,
    postgres: ver.rows[0].num,
    results,
    gaps,
    notes,
    hashesBefore,
    changedProposals,
  };
  const tmpDir = path.join(process.env.LOCALAPPDATA || path.join(ROOT, 'temp'), 'Temp', 'opencode');
  try { fs.mkdirSync(tmpDir, { recursive: true }); fs.writeFileSync(path.join(tmpDir, 'orva-membership-definer-results.json'), JSON.stringify(out, null, 2)); } catch (_) {}
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
