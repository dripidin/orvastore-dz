'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (e) {
    console.error(`[FAIL] ${name}`);
    console.error('       Error:', e.message);
    throw e;
  }
}

async function testAsync(name, fn) {
  total++;
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (e) {
    console.error(`[FAIL] ${name}`);
    console.error('       Error:', e.message);
    throw e;
  }
}

async function run() {
  console.log('='.repeat(80));
  console.log('ORVA STORE — FINAL DASHBOARD, ANALYTICS & CLEANUP VERIFICATION');
  console.log('='.repeat(80));

  // 1. Supabase Orders Hygiene
  await testAsync('Supabase DB: All test orders purged, genuine October orders intact', async () => {
    const { Client } = require('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();

    const testCountRes = await client.query(`
      SELECT count(*) as cnt FROM public.orders
      WHERE full_name ILIKE '%test%'
         OR full_name ILIKE '%rapid customer%'
         OR full_name ILIKE '%customer while throttled%'
         OR order_id LIKE 'TEST-%'
         OR order_id LIKE 'IDEMP-%'
         OR order_id LIKE 'ORVA-ACCEPT-%';
    `);
    assert.strictEqual(parseInt(testCountRes.rows[0].cnt, 10), 0, 'Zero test orders must remain in public.orders');

    const genuineRes = await client.query('SELECT count(*) as cnt FROM public.orders;');
    const totalOrders = parseInt(genuineRes.rows[0].cnt, 10);
    assert.ok(totalOrders >= 200, `Genuine store orders must be preserved (found ${totalOrders})`);

    await client.end();
  });

  // 2. Legacy Dashboard Decommissioning from Production Packager
  test('Packager: Legacy admin.html, admin.css, admin.js excluded from dist-hostinger', () => {
    const dist = path.join(__dirname, '..', 'dist-hostinger');
    assert.ok(!fs.existsSync(path.join(dist, 'admin.html')), 'dist-hostinger/admin.html must not exist');
    assert.ok(!fs.existsSync(path.join(dist, 'admin.css')), 'dist-hostinger/admin.css must not exist');
    assert.ok(!fs.existsSync(path.join(dist, 'admin.js')), 'dist-hostinger/admin.js must not exist');
    assert.ok(fs.existsSync(path.join(dist, 'api', 'analytics.php')), 'dist-hostinger/api/analytics.php must exist');
  });

  // 3. Routing Rules in .htaccess
  test('.htaccess: Redirects /admin and /admin.html to /dashboard/ecommerce & routes /api/analytics', () => {
    const htaccess = fs.readFileSync(path.join(__dirname, '..', '.htaccess'), 'utf8');
    assert.ok(htaccess.includes('RewriteRule ^admin(?:\\.html)?/?$ /dashboard/ecommerce [R=301,L]'), 'Must 301 redirect legacy admin paths');
    assert.ok(!htaccess.includes('v=classic'), 'A/B classic switch must be removed');
    assert.ok(htaccess.includes('RewriteRule ^api/analytics/?$ api/analytics.php [L,QSA]'), 'Must route /api/analytics');
  });

  // 4. Dev Environment Banner Clean Null Return
  test('Dashboard UI: DevEnvironmentBanner renders null and stores live mode', () => {
    const bannerPath = path.join(__dirname, '..', 'orvastore Dashbaord v0.9', 'next-shadcn-admin-dashboard-baseui-main', 'src', 'components', 'dev-environment-banner.tsx');
    const content = fs.readFileSync(bannerPath, 'utf8');
    assert.ok(content.includes('return null'), 'DevEnvironmentBanner must cleanly return null');
  });

  // 5. Store Traffic Live Analytics Integration
  test('Store Traffic: Uses live API, zero simulation buttons', () => {
    const trafficPath = path.join(__dirname, '..', 'orvastore Dashbaord v0.9', 'next-shadcn-admin-dashboard-baseui-main', 'src', 'app', '(main)', 'dashboard', 'store-traffic', 'page.tsx');
    const content = fs.readFileSync(trafficPath, 'utf8');
    assert.ok(content.includes('fetch("/api/analytics"'), 'Must fetch /api/analytics');
    assert.ok(!content.includes('mock-visitor-analytics-repository'), 'Must not import mock visitor repository');
    assert.ok(!content.includes('seedDemoAnalyticsCohort'), 'Must not import synthetic cohort seeder');
  });

  // 6. Beacon Tracking Snippet
  test('Storefront: Non-blocking analytics beacon injected into scripts', () => {
    const scriptJs = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
    const packsJs = fs.readFileSync(path.join(__dirname, '..', 'packs-client.js'), 'utf8');
    assert.ok(scriptJs.includes('sendBeacon(\'/api/analytics\''), 'script.js must include beacon tracking');
    assert.ok(packsJs.includes('sendBeacon(\'/api/analytics\''), 'packs-client.js must include beacon tracking');
  });

  console.log('='.repeat(80));
  console.log(`TOTAL SCENARIOS: ${total} | PASSED: ${passed} | FAILED: ${total - passed}`);
  console.log('='.repeat(80));
  if (passed === total) {
    console.log('🎉 VERDICT: ALL TESTS PASSED (100% SUCCESS)');
  }
}

run().catch(err => {
  console.error('Fatal test runner failure:', err);
  process.exit(1);
});

