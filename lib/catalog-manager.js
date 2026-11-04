'use strict';
// =============================================================================
// ORVA STORE — Dynamic Catalog Manager (Phase 8C.1)
// Authoritative Single Source of Truth for Server-Side Product Pricing
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const CATALOG_FILE = path.join(ROOT_DIR, 'data', 'products-catalog.json');
const TARIFFS_FILE = path.join(ROOT_DIR, 'data', 'wilayas-tariffs.json');

function loadCatalog() {
    try {
        if (fs.existsSync(CATALOG_FILE)) {
            const raw = fs.readFileSync(CATALOG_FILE, 'utf8');
            return JSON.parse(raw);
        }
    } catch (err) {
        console.warn('[CatalogManager] Error reading catalog file:', err.message);
    }
    return { version: 1, lastUpdated: new Date().toISOString(), products: {}, aliases: {} };
}

function saveCatalog(catalog) {
    catalog.lastUpdated = new Date().toISOString();
    const tempFile = `${CATALOG_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.mkdirSync(path.dirname(CATALOG_FILE), { recursive: true });
    fs.writeFileSync(tempFile, JSON.stringify(catalog, null, 2), 'utf8');
    fs.renameSync(tempFile, CATALOG_FILE);
}

function registerOrUpdateProduct(productData) {
    if (!productData || !productData.sku) {
        throw new Error('MISSING_PRODUCT_SKU');
    }

    const catalog = loadCatalog();
    const key = productData.sku.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const slug = (productData.slug || key).toLowerCase().replace(/[^a-z0-9_-]/g, '_');

    // Never accept or store purchaseCost or marketingCost here (strict privacy boundary)
    const entry = {
        id: productData.id || `prod_${key}`,
        sku: String(productData.sku).trim(),
        slug: slug,
        title: String(productData.title || productData.name || 'منتج جديد').trim(),
        name: String(productData.name || productData.title || 'منتج جديد').trim(),
        shortTitle: String(productData.shortTitle || productData.title || 'عرض خاص').trim(),
        desc: String(productData.desc || productData.description || '').trim(),
        sellingPrice: Math.max(0, parseInt(productData.sellingPrice || productData.price, 10) || 4950),
        status: productData.status || 'active',
        stockQuantity: Math.max(0, parseInt(productData.stockQuantity || productData.stock, 10) || 20),
        allowOrders: productData.status !== 'archived' && productData.status !== 'draft'
    };

    catalog.products[key] = entry;

    // Register aliases
    catalog.aliases[key] = key;
    catalog.aliases[entry.sku.toLowerCase()] = key;
    catalog.aliases[slug] = key;
    if (productData.id) catalog.aliases[productData.id.toLowerCase()] = key;

    saveCatalog(catalog);
    return entry;
}

function setProductStatus(skuOrSlug, status) {
    if (!skuOrSlug) return null;
    const catalog = loadCatalog();
    const resolvedKey = resolveProductKey(catalog, skuOrSlug);
    if (!resolvedKey || !catalog.products[resolvedKey]) return null;

    const prod = catalog.products[resolvedKey];
    prod.status = status;
    prod.allowOrders = (status === 'active' || status === 'published');
    saveCatalog(catalog);
    return prod;
}

function resolveProductKey(catalog, identifier) {
    if (!identifier) return null;
    const raw = String(identifier).trim().toLowerCase();
    if (catalog.products[raw]) return raw;
    if (catalog.aliases[raw]) return catalog.aliases[raw];

    for (const [alias, targetKey] of Object.entries(catalog.aliases)) {
        if (raw === alias || raw.includes(alias)) {
            return targetKey;
        }
    }
    return null;
}

function resolveProduct(identifier) {
    if (!identifier) return null;
    const catalog = loadCatalog();
    const key = resolveProductKey(catalog, identifier);
    if (key && catalog.products[key]) {
        return catalog.products[key];
    }
    return null;
}

let cachedTariffs = null;
function loadTariffs() {
    if (cachedTariffs) return cachedTariffs;
    try {
        if (fs.existsSync(TARIFFS_FILE)) {
            cachedTariffs = JSON.parse(fs.readFileSync(TARIFFS_FILE, 'utf8'));
            return cachedTariffs;
        }
    } catch (err) {
        console.warn('[CatalogManager] Error loading tariffs file:', err.message);
    }
    return [];
}

function resolveWilaya(wilayaIdentifier) {
    if (wilayaIdentifier === undefined || wilayaIdentifier === null) return null;
    const tariffs = loadTariffs();

    const num = parseInt(wilayaIdentifier, 10);
    if (!isNaN(num) && num >= 1 && num <= 58) {
        return tariffs.find(w => w.id === num) || null;
    }

    const str = String(wilayaIdentifier).trim().toLowerCase();
    for (const w of tariffs) {
        if (str.includes(w.name.toLowerCase()) || 
            str.includes(w.canonicalName.toLowerCase()) ||
            str.startsWith(`${w.id} -`) ||
            str.startsWith(`${w.id}-`)) {
            return w;
        }
    }
    return null;
}

module.exports = {
    loadCatalog,
    saveCatalog,
    registerOrUpdateProduct,
    setProductStatus,
    resolveProduct,
    loadTariffs,
    resolveWilaya
};

