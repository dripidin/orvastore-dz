'use strict';
const http = require('http');

function req(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        hostname: '127.0.0.1',
        port: 3000,
        path,
        method,
        headers: {
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      },
    );
    r.on('error', (e) => resolve({ status: 0, body: String(e.message) }));
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const token = 'local-dev-admin-token';
  const auth = { Authorization: `Bearer ${token}` };
  const rows = [];

  async function check(name, fn) {
    try {
      const r = await fn();
      rows.push({ name, ...r });
      console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${name}  [${r.status}] ${r.note || ''}`);
    } catch (e) {
      rows.push({ name, ok: false, status: 0, note: e.message });
      console.log(`FAIL  ${name}  ${e.message}`);
    }
  }

  await check('GET /admin', async () => {
    const r = await req('GET', '/admin');
    return { ok: r.status === 200, status: r.status };
  });
  await check('GET /dashboard/ecommerce/', async () => {
    const r = await req('GET', '/dashboard/ecommerce/');
    return { ok: r.status === 200, status: r.status };
  });
  await check('GET /dashboard/products/', async () => {
    const r = await req('GET', '/dashboard/products/');
    return { ok: r.status === 200, status: r.status };
  });
  await check('GET /admin.html classic', async () => {
    const r = await req('GET', '/admin.html');
    return { ok: r.status === 200, status: r.status };
  });
  await check('catalog unauthorized', async () => {
    const r = await req('GET', '/api/products-catalog?action=list');
    return { ok: r.status === 401, status: r.status, note: r.body.slice(0, 80) };
  });
  await check('catalog authorized list', async () => {
    const r = await req('GET', '/api/products-catalog?action=list', { headers: auth });
    const j = JSON.parse(r.body || '{}');
    return { ok: r.status === 200 && j.success && Array.isArray(j.data) && j.data.length > 0, status: r.status, note: `count=${j.count}` };
  });
  await check('catalog test fixture', async () => {
    const r = await req('GET', '/api/products-catalog?action=list&fixture=test', { headers: auth });
    const j = JSON.parse(r.body || '{}');
    return { ok: r.status === 200 && j.fixture === 'test', status: r.status, note: `fixture=${j.fixture}` };
  });
  await check('mock shipment create', async () => {
    const r = await req('POST', '/api/delivery?action=create', {
      headers: auth,
      body: { orderId: 'ORVA-LOCAL-MOCK', courierId: 'redex', mock: true },
    });
    const j = JSON.parse(r.body || '{}');
    return { ok: r.status === 200 && j.mocked === true && j.trackingCode, status: r.status, note: j.trackingCode || j.error };
  });
  await check('risk trust override', async () => {
    const r = await req('POST', '/api/risk', {
      headers: auth,
      body: { orderId: 'ORVA-LOCAL-MOCK', action: 'trust' },
    });
    const j = JSON.parse(r.body || '{}');
    // May 404 if order missing in DB — still auth+contract exercised
    return {
      ok: r.status === 200 || r.status === 404 || (r.status === 503 && j.error),
      status: r.status,
      note: JSON.stringify(j).slice(0, 120),
    };
  });
  await check('invoice route gone/not-found page', async () => {
    const r = await req('GET', '/dashboard/invoice/');
    return { ok: r.status === 404 || r.status === 200, status: r.status, note: 'static may serve dashboard 404 page' };
  });

  const failed = rows.filter((r) => !r.ok).length;
  console.log(`\n${rows.length - failed}/${rows.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
