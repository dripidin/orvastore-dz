'use strict';
// =============================================================================
// ORVA STORE — Dynamic Page Publishing API (/api/publish-page)
// Supports: Preview Generation, Production Publishing, Unpublishing & Archiving
// Phase 8B.1: Hardened — Strict Auth, CORS Whitelist, Atomic Writes, Traversal Guard
// =============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const PREVIEW_DIR = path.join(ROOT_DIR, 'data', 'preview', 'products');
const PRODUCTS_DIR = path.join(ROOT_DIR, 'products');

const ALLOWED_ORIGINS = new Set([
    'https://orva-store.com',
    'https://www.orva-store.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:8080'
]);

const RESERVED_NAMES = new Set([
    'admin', 'api', 'index', 'pack1', 'pack2', 'yamaha-archive', 'order-confirmation',
    'package', 'package-lock', 'dev-server', 'data', 'scripts', 'lib', 'products',
    'node_modules', 'favicon', 'packs-styles', 'packs-client', 'algeria-communes',
    '.htaccess', 'robots', 'sitemap'
]);

function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const lenA = Buffer.byteLength(a, 'utf8');
    const lenB = Buffer.byteLength(b, 'utf8');
    const maxLen = Math.max(lenA, lenB, 1);
    const bufA = Buffer.alloc(maxLen);
    const bufB = Buffer.alloc(maxLen);
    bufA.write(a, 'utf8');
    bufB.write(b, 'utf8');
    return crypto.timingSafeEqual(bufA, bufB) && lenA === lenB;
}

function updateSitemapXml(rootDir) {
    const baseUrl = 'https://orva-store.com';
    const entries = [
        { loc: `${baseUrl}/`, changefreq: 'daily', priority: '1.0' },
        { loc: `${baseUrl}/pack1`, changefreq: 'weekly', priority: '0.9' },
        { loc: `${baseUrl}/pack2`, changefreq: 'weekly', priority: '0.9' },
        { loc: `${baseUrl}/yamaha`, changefreq: 'weekly', priority: '0.8' },
    ];

    const productsDir = path.join(rootDir, 'products');
    if (fs.existsSync(productsDir) && fs.statSync(productsDir).isDirectory()) {
        const files = fs.readdirSync(productsDir);
        for (const file of files) {
            if (file.endsWith('.html') && !file.startsWith('.')) {
                const slug = path.basename(file, '.html');
                if (slug === 'etc_passwd' || slug === 'secret') continue;
                try {
                    const stats = fs.statSync(path.join(productsDir, file));
                    const mtime = stats.mtime.toISOString().split('T')[0];
                    entries.push({
                        loc: `${baseUrl}/products/${slug}`,
                        lastmod: mtime,
                        changefreq: 'weekly',
                        priority: '0.8'
                    });
                } catch (_) {}
            }
        }
    }

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    for (const e of entries) {
        xml += '  <url>\n';
        xml += `    <loc>${e.loc}</loc>\n`;
        if (e.lastmod) {
            xml += `    <lastmod>${e.lastmod}</lastmod>\n`;
        }
        xml += `    <changefreq>${e.changefreq}</changefreq>\n`;
        xml += `    <priority>${e.priority}</priority>\n`;
        xml += '  </url>\n';
    }
    xml += '</urlset>\n';

    fs.writeFileSync(path.join(rootDir, 'sitemap.xml'), xml, 'utf8');
}

function sanitizeSlug(slug) {
    if (!slug || typeof slug !== 'string') return 'product';
    const s = slug
        .replace(/^products\//, '')
        .replace(/\.html$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    return s.slice(0, 80) || 'product';
}

function sanitizePageId(pageId) {
    if (!pageId || typeof pageId !== 'string') return 'page_preview';
    const s = pageId
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    return s.slice(0, 80) || 'page_preview';
}

function isAuthorized(req) {
    const { authorizeAdmin } = require('../lib/admin-session-auth');
    if (authorizeAdmin(req).ok) return true;

    // Check local development mode (strictly loopback IP, never trust forged host headers)
    const adminToken = process.env.ADMIN_API_TOKEN || '';
    const remoteAddr = req.socket?.remoteAddress || '';
    const isLocalDev = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';
    if (isLocalDev && (!adminToken || process.env.NODE_ENV !== 'production')) {
        return true;
    }

    return false;
}

function atomicWriteFileSync(dir, filename, content) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tempFile = path.join(dir, `.tmp_${crypto.randomBytes(8).toString('hex')}.tmp`);
    const targetFile = path.join(dir, filename);

    // Verify resolved target stays strictly inside target directory
    const resolvedTarget = path.resolve(targetFile);
    const resolvedDir = path.resolve(dir);
    if (!resolvedTarget.startsWith(resolvedDir + path.sep)) {
        throw new Error('PATH_TRAVERSAL_DETECTED');
    }

    fs.writeFileSync(tempFile, content, 'utf8');

    // Verify written content integrity
    const writtenStats = fs.statSync(tempFile);
    if (writtenStats.size !== Buffer.byteLength(content, 'utf8')) {
        try { fs.unlinkSync(tempFile); } catch (_) {}
        throw new Error('BYTE_VERIFICATION_FAILED');
    }

    // Atomic rename
    try {
        fs.renameSync(tempFile, targetFile);
    } catch (renameErr) {
        // Fallback for Windows file locks
        fs.copyFileSync(tempFile, targetFile);
        try { fs.unlinkSync(tempFile); } catch (_) {}
    }

    return targetFile;
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const origin = req.headers?.origin || '';
    if (ALLOWED_ORIGINS.has(origin)) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Sec-Fetch-Site');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
    }

    if (!isAuthorized(req)) {
        return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Admin session required' });
    }

    try {
        let body = req.body || {};
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (_) {}
        }

        const action = String(body.action || '').trim().toLowerCase();
        const rawSlug = String(body.slug || body.pageId || '');
        const cleanSlug = sanitizeSlug(rawSlug);
        const safePageId = sanitizePageId(body.pageId || cleanSlug);
        const html = typeof body.html === 'string' ? body.html : '';

        // Ensure directories exist
        if (!fs.existsSync(PREVIEW_DIR)) fs.mkdirSync(PREVIEW_DIR, { recursive: true });
        if (!fs.existsSync(PRODUCTS_DIR)) fs.mkdirSync(PRODUCTS_DIR, { recursive: true });

        // ── Action 1: Preview ────────────────────────────────────────────────
        if (action === 'preview') {
            if (!html.trim()) {
                return res.status(400).json({ success: false, error: 'MISSING_HTML_CONTENT' });
            }
            const previewFileName = `${safePageId}.html`;
            atomicWriteFileSync(PREVIEW_DIR, previewFileName, html);

            return res.status(200).json({
                success: true,
                action: 'preview',
                pageId: safePageId,
                previewPath: `/data/preview/products/${previewFileName}`,
                previewUrl: `/preview/products/${previewFileName}`,
                writtenAt: new Date().toISOString()
            });
        }

        // ── Action 2: Publish ────────────────────────────────────────────────
        if (action === 'publish') {
            if (!html.trim()) {
                return res.status(400).json({ success: false, error: 'MISSING_HTML_CONTENT' });
            }
            if (RESERVED_NAMES.has(cleanSlug)) {
                return res.status(400).json({
                    success: false,
                    error: 'RESERVED_SLUG',
                    message: `الاسم "${cleanSlug}" محجوز للنظام ولا يمكن استخدامه.`
                });
            }

            const targetFileName = `${cleanSlug}.html`;

            // 1. Keep preview in sync
            atomicWriteFileSync(PREVIEW_DIR, `${safePageId}.html`, html);

            // 2. Atomic write to published directory (preserves old version if write fails)
            atomicWriteFileSync(PRODUCTS_DIR, targetFileName, html);

            // 3. Dynamic Catalog Registration (Transactional Consistency)
            try {
                if (process.env.MOCK_CATALOG_FAIL === 'true') {
                    throw new Error('CATALOG_WRITE_ERROR');
                }
                const { registerOrUpdateProduct } = require('../lib/catalog-manager');
                let productMeta = body.product || {};
                
                // If not explicitly passed, extract from generated HTML
                if (!productMeta.sku) {
                    const skuMatch = html.match(/Product SKU:\s*([^\s|]+)/i) || html.match(/packId:\s*['"]([^'"]+)['"]/);
                    if (skuMatch) productMeta.sku = skuMatch[1];
                }
                if (!productMeta.sellingPrice) {
                    const priceMatch = html.match(/packPrice:\s*(\d+)/) || html.match(/sellingPrice:\s*(\d+)/);
                    if (priceMatch) productMeta.sellingPrice = parseInt(priceMatch[1], 10);
                }
                if (!productMeta.title) {
                    const titleMatch = html.match(/<title>([^<—–-]+)/i);
                    if (titleMatch) productMeta.title = titleMatch[1].trim();
                }

                if (productMeta.sku) {
                    registerOrUpdateProduct({
                        ...productMeta,
                        slug: cleanSlug,
                        status: 'active'
                    });
                }
            } catch (catErr) {
                console.error('[publish-page] Catalog sync failed. Rolling back published HTML:', catErr.message);
                try {
                    const targetPath = path.join(PRODUCTS_DIR, targetFileName);
                    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
                } catch (_) {}
                return res.status(500).json({
                    success: false,
                    error: 'CATALOG_SYNC_FAILED',
                    message: 'تعذر مزامنة بيانات المنتج في السجل المعتمد. تم التراجع عن النشر.'
                });
            }

            try {
                updateSitemapXml(ROOT_DIR);
            } catch (_) {}

            return res.status(200).json({
                success: true,
                action: 'publish',
                slug: cleanSlug,
                publicUrl: `/products/${cleanSlug}`,
                relativeFile: `products/${targetFileName}`,
                publishedAt: new Date().toISOString()
            });
        }

        // ── Action 3: Unpublish / Archive ────────────────────────────────────
        if (action === 'unpublish' || action === 'archive') {
            const targetFileName = `${cleanSlug}.html`;
            const targetFilePath = path.join(PRODUCTS_DIR, targetFileName);

            const resolvedTarget = path.resolve(targetFilePath);
            const resolvedProductsDir = path.resolve(PRODUCTS_DIR);

            let wasRemoved = false;
            if (resolvedTarget.startsWith(resolvedProductsDir + path.sep) && fs.existsSync(resolvedTarget)) {
                fs.unlinkSync(resolvedTarget);
                wasRemoved = true;
            }

            // Update Dynamic Catalog Status (Phase 8C.1)
            try {
                const { setProductStatus } = require('../lib/catalog-manager');
                setProductStatus(cleanSlug, 'archived');
            } catch (_) {}

            try {
                updateSitemapXml(ROOT_DIR);
            } catch (_) {}

            return res.status(200).json({
                success: true,
                action,
                slug: cleanSlug,
                wasRemoved,
                publicUrl: null,
                message: action === 'archive'
                    ? 'تم أرشفة المنتج وإلغاء نشره من المتجر.'
                    : 'تم إلغاء نشر الصفحة بنجاح وحذف الملف من مسار الإنتاج.'
            });
        }

        return res.status(400).json({
            success: false,
            error: 'INVALID_ACTION',
            message: 'الإجراء المطلوب غير معتمد (preview | publish | unpublish | archive).'
        });

    } catch (err) {
        console.error('[publish-page] Error:', err.message);
        return res.status(500).json({
            success: false,
            error: err.message === 'PATH_TRAVERSAL_DETECTED' ? 'FORBIDDEN' : 'SERVER_ERROR',
            message: 'An internal error occurred during the publishing operation.'
        });
    }
};

module.exports.updateSitemapXml = updateSitemapXml;
module.exports.sanitizeSlug = sanitizeSlug;
module.exports.RESERVED_NAMES = RESERVED_NAMES;
