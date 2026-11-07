'use strict';
// =============================================================================
// Yamaha Sac / ORVA Store — Local Full-Stack Development Server
// Serves Static Frontend + Vercel Serverless API Endpoints + Local Excel DB
// =============================================================================

require('dotenv').config({ path: '.env.local' });

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { getEffectiveSettings } = require('./lib/admin-settings-store');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;

// API Route Handlers
const routes = {
    '/api/orders': require('./api/orders'),
    '/api/delivery': require('./api/delivery'),
    '/api/send-order': require('./api/send-order'),
    '/api/risk': require('./api/risk'),
    '/api/auth': require('./api/auth'),
    '/api/admin-settings': require('./api/admin-settings'),
    '/api/publish-page': require('./api/publish-page'),
    '/api/products-catalog': require('./api/products-catalog')
};

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.txt': 'text/plain; charset=utf-8',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function storefrontPageForFile(filePath) {
    const relative = path.relative(PUBLIC_DIR, filePath).replace(/\\/g, '/');
    if (relative === 'index.html') return '/';
    if (['pack1.html', 'pack2.html', 'pack3.html', 'yamaha-archive.html'].includes(relative)) return `/${relative}`;
    if (relative.startsWith('products/') && relative.endsWith('.html')) return `/${relative}`;
    return null;
}

function applyMetaPixelSettings(html, storefrontPage) {
    // Client loader owns injection on Hostinger/static pages — avoid double-firing on Node.
    if (html.includes('meta-pixel-loader.js')) return html;
    const pixel = getEffectiveSettings().metaPixel;
    const included = pixel.enabled && (pixel.scope === 'all' || pixel.pages.includes(storefrontPage));
    const marker = /<!-- Meta Pixel Code -->[\s\S]*?<!-- End Meta Pixel Code -->/i;
    const existing = html.match(marker)?.[0];

    if (!included) return existing ? html.replace(marker, '') : html;
    if (existing) {
        const id = pixel.pixelId;
        const updated = existing
            .replace(/(fbq\(\s*['"]set['"]\s*,\s*['"]autoConfig['"]\s*,\s*false\s*,\s*['"])\d+(['"]\s*\))/g, `$1${id}$2`)
            .replace(/(fbq\(\s*['"]init['"]\s*,\s*['"])\d+(['"]\s*\))/g, `$1${id}$2`)
            .replace(/(facebook\.com\/tr\?id=)\d+/g, `$1${id}`);
        return html.replace(marker, updated);
    }

    const snippet = `<!-- Meta Pixel Code -->\n<script>\n!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?\nn.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;\nn.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;\nt.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}\n(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');\nfbq('init','${pixel.pixelId}');\nfbq('track','PageView');\n</script>\n<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${pixel.pixelId}&ev=PageView&noscript=1" /></noscript>\n<!-- End Meta Pixel Code -->`;
    return html.replace(/<\/head>/i, `${snippet}\n</head>`);
}

function serveFile(res, filePath, ext) {
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    fs.readFile(filePath, (readErr, content) => {
        if (readErr) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Server Error reading file');
            return;
        }
        const storefrontPage = ext === '.html' ? storefrontPageForFile(filePath) : null;
        if (storefrontPage) {
            let html = content.toString('utf8');
            try {
                html = applyMetaPixelSettings(html, storefrontPage);
            } catch (_) {
                // A damaged settings file must not stop storefront pages from loading.
            }
            res.writeHead(200, {
                'Content-Type': contentType,
                'Cache-Control': 'no-store, max-age=0',
                'Pragma': 'no-cache'
            });
            res.end(html);
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
}

function serveStatic(req, res, pathname, query = {}) {
    const decodedPath = decodeURIComponent(pathname);
    const normalizedPath = decodedPath.replace(/\\/g, '/').toLowerCase();

    if (normalizedPath.startsWith('/api/')) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'NOT_FOUND' }));
        return;
    }
    if (
        /(^|\/)\.env(?:\.|$)/i.test(normalizedPath) ||
        normalizedPath.includes('/data/private/') ||
        normalizedPath.endsWith('/data/private') ||
        normalizedPath.startsWith('/backups/') ||
        normalizedPath === '/backups' ||
        (normalizedPath.startsWith('/data/') && !normalizedPath.startsWith('/data/preview/')) ||
        (/\.(json|env|log|md|ps1|sh|sql|yml|yaml|lock|enc|bak|tmp|swp|ini|cfg)$/i.test(normalizedPath) && !normalizedPath.startsWith('/_next/'))
    ) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
    }

    // ── 1. A/B Testing Routing for Admin ─────────────────────────────
    if (decodedPath === '/admin' || decodedPath === '/admin/') {
        const isClassic = query.v === 'classic' || (req.headers.cookie && req.headers.cookie.includes('orva_admin_theme=classic'));
        if (isClassic) {
            return serveFile(res, path.join(PUBLIC_DIR, 'admin.html'), '.html');
        } else {
            const ecommercePage = path.join(PUBLIC_DIR, 'admin', 'dashboard', 'ecommerce', 'index.html');
            if (fs.existsSync(ecommercePage)) {
                return serveFile(res, ecommercePage, '.html');
            }
            return serveFile(res, path.join(PUBLIC_DIR, 'admin', 'index.html'), '.html');
        }
    }

    // ── 2. Next.js Static Asset Routing (/_next/*) ────────────────────
    if (decodedPath.startsWith('/_next/')) {
        const assetPath = path.join(PUBLIC_DIR, 'admin', decodedPath);
        if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
            return serveFile(res, assetPath, path.extname(assetPath).toLowerCase());
        }
    }

    // ── 2b. Favicon Fallback ─────────────────────────────────────────
    if (decodedPath === '/favicon.ico') {
        const rootFavicon = path.join(PUBLIC_DIR, 'favicon.ico');
        if (fs.existsSync(rootFavicon) && fs.statSync(rootFavicon).isFile()) {
            return serveFile(res, rootFavicon, '.ico');
        }
        const adminFavicon = path.join(PUBLIC_DIR, 'admin', 'favicon.ico');
        if (fs.existsSync(adminFavicon) && fs.statSync(adminFavicon).isFile()) {
            return serveFile(res, adminFavicon, '.ico');
        }
    }

    // ── 2c. Isolated Storefront Preview Serving (/preview/*) ──────────
    if (decodedPath.startsWith('/preview/') || decodedPath.startsWith('/data/preview/')) {
        const clientIp = (
            req.headers['x-forwarded-for'] ||
            req.headers['x-real-ip'] ||
            (req.socket && req.socket.remoteAddress) ||
            ''
        ).split(',')[0].trim();
        const isLocal = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1' || !clientIp;
        const cookieHeader = String(req.headers.cookie || '');
        const hasAdminSession = cookieHeader.includes('orva_admin_session=');

        if (!isLocal && !hasAdminSession && process.env.NODE_ENV === 'production') {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Forbidden: Preview is restricted to administrators.');
            return;
        }

        const cleanPreviewSub = decodedPath.startsWith('/data/') ? decodedPath : path.join('data', decodedPath);
        const previewFile = path.join(PUBLIC_DIR, cleanPreviewSub);
        if (fs.existsSync(previewFile) && fs.statSync(previewFile).isFile()) {
            return serveFile(res, previewFile, '.html');
        }
    }

    // ── 3. Next.js Dashboard Routes (/dashboard/* or /admin/dashboard/*) ─
    if (decodedPath.startsWith('/admin/dashboard') || decodedPath.startsWith('/dashboard')) {
        // Canonical order management is ecommerce#orders (no /orders/ static export).
        if (
            decodedPath === '/admin/dashboard/orders' ||
            decodedPath === '/admin/dashboard/orders/' ||
            decodedPath === '/dashboard/orders' ||
            decodedPath === '/dashboard/orders/'
        ) {
            res.writeHead(302, { Location: '/admin/dashboard/ecommerce/#orders' });
            res.end();
            return;
        }

        const cleanSub = decodedPath.replace(/^\/admin/, '');

        // Direct static files under admin (RSC .txt payloads, manifest json, etc.)
        const directFile = path.join(PUBLIC_DIR, 'admin', cleanSub);
        if (fs.existsSync(directFile) && fs.statSync(directFile).isFile()) {
            return serveFile(res, directFile, path.extname(directFile).toLowerCase());
        }

        // Map route.txt to route/index.txt for Next.js App Router export
        if (cleanSub.endsWith('.txt')) {
            const nestedTxt = path.join(PUBLIC_DIR, 'admin', cleanSub.slice(0, -4), 'index.txt');
            if (fs.existsSync(nestedTxt) && fs.statSync(nestedTxt).isFile()) {
                return serveFile(res, nestedTxt, '.txt');
            }
        }

        // Map Next.js Turbopack subsegment dot paths (e.g. __next.!...sub.path.__PAGE__.txt)
        const nextDotMatch = cleanSub.match(/^(.*\/)(__next\.[^.]+)\.(.*)(\.txt)$/);
        if (nextDotMatch) {
            const transformed = path.join(
                PUBLIC_DIR,
                'admin',
                nextDotMatch[1] + nextDotMatch[2],
                nextDotMatch[3].replace(/\./g, '/') + nextDotMatch[4]
            );
            if (fs.existsSync(transformed) && fs.statSync(transformed).isFile()) {
                return serveFile(res, transformed, '.txt');
            }
        }

        const candidate1 = path.join(PUBLIC_DIR, 'admin', cleanSub, 'index.html');
        const candidate2 = path.join(PUBLIC_DIR, 'admin', cleanSub + '.html');

        // Trailing slash redirect for directory-based routes (matching trailingSlash: true)
        if (!decodedPath.endsWith('/') && fs.existsSync(candidate1)) {
            const searchIdx = req.url.indexOf('?');
            const search = searchIdx !== -1 ? req.url.slice(searchIdx) : '';
            const pathnameOnly = searchIdx !== -1 ? req.url.slice(0, searchIdx) : req.url;
            res.writeHead(308, { Location: pathnameOnly + '/' + search });
            res.end();
            return;
        }

        if (fs.existsSync(candidate1)) return serveFile(res, candidate1, '.html');
        if (fs.existsSync(candidate2)) return serveFile(res, candidate2, '.html');
    }

    let filePath = path.resolve(PUBLIC_DIR, `.${decodedPath === '/' ? '/index.html' : decodedPath}`);

    // Prevent directory traversal
    const relativePath = path.relative(PUBLIC_DIR, filePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        const indexHtml = path.join(filePath, 'index.html');
        if (fs.existsSync(indexHtml)) {
            filePath = indexHtml;
        }
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            if (fs.existsSync(filePath + '.html')) {
                filePath = filePath + '.html';
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('404 Not Found: ' + pathname);
                return;
            }
        }

        const ext = path.extname(filePath).toLowerCase();
        serveFile(res, filePath, ext);
    });
}

function createVercelResponse(res) {
    const resShim = {
        _headers: {},
        statusCode: 200,
        setHeader(key, val) {
            this._headers[key] = val;
            res.setHeader(key, val);
            return this;
        },
        status(code) {
            this.statusCode = code;
            res.statusCode = code;
            return this;
        },
        json(data) {
            if (!res.headersSent) {
                res.writeHead(this.statusCode, {
                    'Content-Type': 'application/json; charset=utf-8',
                    ...this._headers
                });
            }
            res.end(JSON.stringify(data));
        },
        send(data) {
            if (!res.headersSent) {
                res.writeHead(this.statusCode, this._headers);
            }
            res.end(data);
        },
        end(data) {
            if (!res.headersSent) {
                res.writeHead(this.statusCode, this._headers);
            }
            res.end(data);
        }
    };
    return resShim;
}

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // CORS pre-flight — dev server restricts to allowed origins only
    const reqOrigin = req.headers['origin'] || '';
    const devOrigins = [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:8080',
        'http://127.0.0.1:3000',
        'https://orva-store.com',
        'https://www.orva-store.com'
    ];
    if (devOrigins.includes(reqOrigin)) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Origin', reqOrigin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Sec-Fetch-Site');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Match API route
    const handler = routes[pathname];
    if (handler) {
        let bodyRaw = '';
        let bodyTooLarge = false;
        let bodySize = 0;
        const maxBodyBytes = pathname === '/api/admin-settings' ? 24 * 1024 : 2 * 1024 * 1024;
        req.on('data', chunk => {
            bodySize += Buffer.byteLength(chunk);
            if (bodySize > maxBodyBytes) {
                bodyTooLarge = true;
                bodyRaw = '';
                return;
            }
            if (!bodyTooLarge) bodyRaw += chunk;
        });
        req.on('end', async () => {
            if (bodyTooLarge) {
                return createVercelResponse(res).status(413).json({ success: false, error: 'PAYLOAD_TOO_LARGE' });
            }
            let body = {};
            if (bodyRaw) {
                try {
                    body = JSON.parse(bodyRaw);
                } catch (e) {
                    body = bodyRaw;
                }
            }

            req.query = parsedUrl.query || {};
            req.body = body;

            const vRes = createVercelResponse(res);
            try {
                await handler(req, vRes);
            } catch (err) {
                console.error(`[API Error] ${pathname}:`, err);
                if (!res.headersSent) {
                    vRes.status(500).json({ success: false, error: err.message });
                }
            }
        });
        return;
    }

    // Static files & A/B testing router
    serveStatic(req, res, pathname, parsedUrl.query || {});
});

server.on('error', (err) => {
    console.error('[Server Error]:', err);
});

process.on('uncaughtException', (err) => {
    console.error('[Uncaught Exception]:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Unhandled Rejection]:', reason);
});

// Keep event loop active
setInterval(() => { }, 3600000);

server.listen(PORT, () => {
    console.log('\n================================================================');
    console.log(`🚀 Yamaha Sac / ORVA Store — Local Dev Server Running on Port ${PORT}`);
    console.log('================================================================');
    console.log(`✨ Modern Dashboard (Next.js):  http://localhost:${PORT}/admin`);
    console.log(`⏪ Classic Dashboard (v1):       http://localhost:${PORT}/admin?v=classic (or /admin.html)`);
    console.log(`🛍️ Storefront Page (Pack 1):    http://localhost:${PORT}/pack1.html`);
    console.log(`🛍️ Storefront Page (Pack 2):    http://localhost:${PORT}/pack2.html`);
    console.log(`📁 Local Excel Database:        ${path.join(__dirname, 'data', 'excel')}`);
    console.log('================================================================\n');
});
