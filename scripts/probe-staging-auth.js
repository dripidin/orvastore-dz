'use strict';
const https = require('https');

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'staging.orva-store.com',
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: raw.slice(0, 500) }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const session = await request('POST', '/api/auth', { action: 'session' });
  console.log('session', session.status, session.body);
  const sendOpts = await request('OPTIONS', '/api/send-order');
  console.log('send-order OPTIONS', sendOpts.status);
  const pack1 = await request('GET', '/pack1.html');
  console.log('pack1', pack1.status, (pack1.headers['content-type'] || '').slice(0, 40));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
