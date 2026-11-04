'use strict';
// =============================================================================
// ORVA STORE — Central System Settings & Dynamic Credentials Store (Phase 8D.1.1)
// Authenticated Encryption (AES-256-GCM) at Rest, Atomic File Writes, Zero PII Leakage
// Manages: RedEx, Ecotrack, Telegram, and Meta Pixel & CAPI
// Security: Independent 256-bit Key, Fail-Closed, Cross-Process Mutex, Node/PHP Parity
// =============================================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LEGACY_PIXEL_ID = '2340414976777036'; // Legacy Decommissioned Pixel ID (Phase 8D)
const DEFAULT_PIXEL_ID = ''; // Dynamic: must be provided via settings or META_PIXEL_ID
const DEFAULT_REDEX_URL = 'https://redex.ecotrack.dz';
const DEFAULT_ECOTRACK_URL = 'https://api.ecotrack.dz';
const STOREFRONT_PAGES = ['/', '/pack1.html', '/pack2.html', '/yamaha-archive.html'];
const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'private', 'admin-settings.enc');
const BACKUPS_DIR = path.join(__dirname, '..', 'data', 'private', 'backups');
const AUDIT_FILE = path.join(__dirname, '..', 'data', 'inventory-audit.json');
const LOCKS_DIR = path.join(__dirname, '..', 'data', 'locks');
const SETTINGS_LOCK_DIR = path.join(LOCKS_DIR, 'admin-settings.lock');
const AAD_STRING = 'orva-admin-settings-v1';

function hasOwn(value, key) {
    return value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Validate and decode a 256-bit (32-byte) key representation.
 * Supports Base64 (standard), 64-char Hex, or 32-byte raw string.
 * Fails closed without falling back to any other secret.
 */
function parseEncryptionKey(rawSecret) {
    if (rawSecret === undefined || rawSecret === null) {
        throw new Error('ADMIN_SETTINGS_KEY_UNAVAILABLE');
    }
    if (typeof rawSecret !== 'string') {
        throw new Error('ADMIN_SETTINGS_KEY_INVALID');
    }
    const trimmed = rawSecret.trim();
    if (!trimmed) {
        throw new Error('ADMIN_SETTINGS_KEY_UNAVAILABLE');
    }

    // 1. Base64 representation of 32 bytes (44 chars, e.g. "...")
    if (/^[A-Za-z0-9+/]{42,43}={0,2}$/.test(trimmed) || trimmed.length === 44) {
        try {
            const buf = Buffer.from(trimmed, 'base64');
            if (buf.length === 32) return buf;
        } catch (_) {}
    }

    // 2. 64-character Hex string (32 bytes)
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        try {
            const buf = Buffer.from(trimmed, 'hex');
            if (buf.length === 32) return buf;
        } catch (_) {}
    }

    // 3. Raw 32-byte UTF-8 string
    const utf8Buf = Buffer.from(trimmed, 'utf8');
    if (utf8Buf.length === 32) {
        return utf8Buf;
    }

    throw new Error('ADMIN_SETTINGS_KEY_INVALID');
}

/**
 * Process liveness check for lock ownership.
 */
function isProcessAlive(pid) {
    if (!pid || typeof pid !== 'number') return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        if (err.code === 'ESRCH') return false;
        return true; // EPERM means process exists
    }
}

/**
 * Reclaim orphaned or crashed locks.
 * Critical Rules 1 & 2: A live process must NEVER lose its lock regardless of elapsed time.
 */
function tryReclaimStaleLock() {
    try {
        if (!fs.existsSync(SETTINGS_LOCK_DIR)) return false;
        const stat = fs.statSync(SETTINGS_LOCK_DIR);
        const ownerFile = path.join(SETTINGS_LOCK_DIR, 'owner.json');

        let isDead = false;
        let isCorruptedOrMissing = false;

        if (fs.existsSync(ownerFile)) {
            try {
                const owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
                if (owner && typeof owner.pid === 'number') {
                    if (!isProcessAlive(owner.pid)) {
                        isDead = true;
                    } else {
                        // Live owner! Never break lock.
                        return false;
                    }
                } else {
                    isCorruptedOrMissing = true;
                }
            } catch (_) {
                isCorruptedOrMissing = true;
            }
        } else {
            isCorruptedOrMissing = true;
        }

        if (isDead || (isCorruptedOrMissing && (Date.now() - stat.mtimeMs > 8000))) {
            try { fs.unlinkSync(ownerFile); } catch (_) {}
            try { fs.rmdirSync(SETTINGS_LOCK_DIR); } catch (_) {}
            return true;
        }
    } catch (_) {}
    return false;
}

let activeLockDepth = 0;
let activeLockToken = null;

/**
 * Cross-Process Lock for Settings Store.
 * Uses canonical atomic directory creation supported natively across all operating systems.
 * Interoperates with PHP 8.3 via data/locks/admin-settings.lock.
 * Re-entrant in the same process; auto-reclaims dead or corrupted locks; strictly protects live owners.
 */
function withSettingsLock(fn, timeoutMs = 8000) {
    if (!fs.existsSync(LOCKS_DIR)) {
        fs.mkdirSync(LOCKS_DIR, { recursive: true });
    }

    const ownerFile = path.join(SETTINGS_LOCK_DIR, 'owner.json');

    // In-process re-entrancy
    if (activeLockDepth > 0 && activeLockToken) {
        activeLockDepth++;
        try {
            return fn();
        } finally {
            activeLockDepth--;
        }
    }

    const start = Date.now();
    let acquired = false;
    const token = crypto.randomBytes(16).toString('hex');

    while (!acquired) {
        try {
            fs.mkdirSync(SETTINGS_LOCK_DIR);
            acquired = true;
            try {
                fs.writeFileSync(ownerFile, JSON.stringify({
                    pid: process.pid,
                    token: token,
                    time: Date.now(),
                    runtime: 'node'
                }), { encoding: 'utf8', mode: 0o600 });
            } catch (_) {}
            activeLockDepth = 1;
            activeLockToken = token;
        } catch (err) {
            if (err.code === 'EEXIST') {
                tryReclaimStaleLock();
                if (Date.now() - start > timeoutMs) {
                    throw new Error('SETTINGS_LOCK_TIMEOUT');
                }
                const waitTill = Date.now() + 25;
                while (Date.now() < waitTill) {}
            } else {
                throw err;
            }
        }
    }

    try {
        return fn();
    } finally {
        activeLockDepth--;
        if (activeLockDepth <= 0) {
            activeLockDepth = 0;
            try {
                if (fs.existsSync(ownerFile)) {
                    const currentOwner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
                    if (currentOwner && currentOwner.pid === process.pid && currentOwner.token === token) {
                        try { fs.unlinkSync(ownerFile); } catch (_) {}
                        try { fs.rmdirSync(SETTINGS_LOCK_DIR); } catch (_) {}
                    }
                }
            } catch (_) {}
            activeLockToken = null;
        }
    }
}

function createAdminSettingsStore(options = {}) {
    const filePath = options.filePath || SETTINGS_FILE;

    /**
     * Resolve independent encryption key strictly from ADMIN_SETTINGS_ENCRYPTION_KEY.
     * ZERO fallback to ADMIN_API_TOKEN, ADMIN_PASSWORD, or any application secret.
     */
    function getEncryptionKey() {
        const raw = options.secret !== undefined
            ? options.secret
            : (process.env.ADMIN_SETTINGS_ENCRYPTION_KEY || '');
        if (!raw) {
            throw new Error('ADMIN_SETTINGS_KEY_UNAVAILABLE');
        }
        return parseEncryptionKey(raw);
    }

    function readOverrides() {
        if (!fs.existsSync(filePath)) return {};

        const raw = fs.readFileSync(filePath, 'utf8');
        if (!raw || !raw.trim()) return {};

        let envelope;
        try {
            envelope = JSON.parse(raw);
        } catch (e) {
            throw new Error('ADMIN_SETTINGS_FILE_INVALID');
        }

        if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
            throw new Error('ADMIN_SETTINGS_FILE_INVALID');
        }

        if (envelope.version !== 1 || !envelope.iv || !envelope.tag || !envelope.ciphertext) {
            throw new Error('ADMIN_SETTINGS_FILE_INVALID');
        }

        const key = getEncryptionKey();
        const iv = Buffer.from(envelope.iv, 'base64');
        const tag = Buffer.from(envelope.tag, 'base64');
        const ciphertext = Buffer.from(envelope.ciphertext, 'base64');

        if (iv.length !== 12 || tag.length !== 16) {
            throw new Error('ADMIN_SETTINGS_FILE_INVALID');
        }

        try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(tag);
            decipher.setAAD(Buffer.from(AAD_STRING, 'utf8'));

            const cleartext = Buffer.concat([
                decipher.update(ciphertext),
                decipher.final(),
            ]).toString('utf8');

            const overrides = JSON.parse(cleartext);
            if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
                throw new Error('ADMIN_SETTINGS_FILE_INVALID');
            }
            return overrides;
        } catch (err) {
            if (err.message === 'ADMIN_SETTINGS_KEY_UNAVAILABLE' || err.message === 'ADMIN_SETTINGS_KEY_INVALID') {
                throw err;
            }
            throw new Error('CIPHERTEXT_TAMPERED');
        }
    }

    function writeOverrides(overrides) {
        const key = getEncryptionKey();
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        cipher.setAAD(Buffer.from(AAD_STRING, 'utf8'));

        const ciphertext = Buffer.concat([
            cipher.update(JSON.stringify(overrides), 'utf8'),
            cipher.final(),
        ]);

        const envelope = JSON.stringify({
            version: 1,
            algorithm: 'aes-256-gcm',
            keyId: 'v1',
            iv: iv.toString('base64'),
            tag: cipher.getAuthTag().toString('base64'),
            ciphertext: ciphertext.toString('base64'),
        });

        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
        try {
            fs.writeFileSync(tempPath, envelope, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
            try { fs.chmodSync(tempPath, 0o600); } catch (_) {}
            fs.renameSync(tempPath, filePath);
            try { fs.chmodSync(filePath, 0o600); } catch (_) {}
        } finally {
            try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
        }
    }

    function logSettingsAudit(integration, action, adminIdentifier = 'admin') {
        try {
            if (!fs.existsSync(path.dirname(AUDIT_FILE))) {
                fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
            }
            let audit = [];
            if (fs.existsSync(AUDIT_FILE)) {
                try { audit = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8')); } catch (_) { audit = []; }
            }
            if (!Array.isArray(audit)) audit = [];
            audit.push({
                timestamp: new Date().toISOString(),
                action: 'SETTINGS_UPDATE',
                integration,
                subAction: action,
                admin: adminIdentifier
            });
            if (audit.length > 1000) audit = audit.slice(-1000);
            const tmp = `${AUDIT_FILE}.${process.pid}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(audit, null, 2), 'utf8');
            fs.renameSync(tmp, AUDIT_FILE);
        } catch (_) {}
    }

    /**
     * Unredacted effective settings for server components (never returned over HTTP).
     * Fails closed if encryption key is configured but cannot authenticate.
     */
    function getEffectiveSettings() {
        let overrides = {};
        try {
            overrides = readOverrides();
        } catch (err) {
            // If settings file exists and fails to decrypt, throw to fail closed
            if (fs.existsSync(filePath)) {
                throw err;
            }
        }

        const redex = overrides.redex || {};
        const ecotrack = overrides.ecotrack || {};
        const telegram = overrides.telegram || {};
        const metaPixel = overrides.metaPixel || {};

        // Environment fallbacks
        const envRedexToken = process.env.REDEX_API_TOKEN || '';
        const envEcoToken = process.env.ECOTRACK_API_TOKEN || '';
        const envTelegramToken = process.env.TELEGRAM_BOT_TOKEN || '';
        const envTelegramChatId = process.env.TELEGRAM_CHAT_ID || '';
        const envPixelId = process.env.META_PIXEL_ID || '';
        const envMetaCapiToken = process.env.META_ACCESS_TOKEN || '';

        // Pixel validation (reject decommissioned legacy ID)
        let resolvedPixelId = hasOwn(metaPixel, 'pixelId') ? metaPixel.pixelId : envPixelId;
        if (resolvedPixelId === LEGACY_PIXEL_ID) resolvedPixelId = '';

        return {
            redex: {
                enabled: typeof redex.enabled === 'boolean' ? redex.enabled : true,
                baseUrl: redex.baseUrl || process.env.REDEX_BASE_URL || DEFAULT_REDEX_URL,
                apiToken: hasOwn(redex, 'apiToken') ? redex.apiToken : envRedexToken,
                updatedAt: redex.updatedAt || null
            },
            ecotrack: {
                enabled: typeof ecotrack.enabled === 'boolean' ? ecotrack.enabled : true,
                baseUrl: ecotrack.baseUrl || process.env.ECOTRACK_API_BASE_URL || DEFAULT_ECOTRACK_URL,
                apiToken: hasOwn(ecotrack, 'apiToken') ? ecotrack.apiToken : envEcoToken,
                updatedAt: ecotrack.updatedAt || null
            },
            telegram: {
                enabled: typeof telegram.enabled === 'boolean' ? telegram.enabled : true,
                botToken: hasOwn(telegram, 'botToken') ? telegram.botToken : envTelegramToken,
                chatId: hasOwn(telegram, 'chatId') ? telegram.chatId : envTelegramChatId,
                templates: telegram.templates && typeof telegram.templates === 'object' ? telegram.templates : {},
                updatedAt: telegram.updatedAt || null
            },
            metaPixel: {
                enabled: typeof metaPixel.enabled === 'boolean' ? metaPixel.enabled : true,
                pixelId: resolvedPixelId,
                capiEnabled: typeof metaPixel.capiEnabled === 'boolean' ? metaPixel.capiEnabled : true,
                capiToken: hasOwn(metaPixel, 'capiToken') ? metaPixel.capiToken : envMetaCapiToken,
                scope: metaPixel.scope === 'selected' ? 'selected' : 'all',
                pages: Array.isArray(metaPixel.pages)
                    ? metaPixel.pages.filter((page) => STOREFRONT_PAGES.includes(page))
                    : STOREFRONT_PAGES.slice(),
                updatedAt: metaPixel.updatedAt || null
            }
        };
    }

    function getPublicTemplatesProjection(storedTemplates = {}) {
        let registry = null;
        try {
            const engine = require('./telegram-template-engine');
            registry = engine.getEventRegistry();
        } catch (_) {}

        const events = registry ? Object.keys(registry) : [
            'ORDER_CREATED',
            'SHIPMENT_CREATED',
            'SHIPMENT_FAILED',
            'STATUS_UPDATED',
            'ORDER_CANCELLED',
            'ADMIN_ALERT'
        ];

        const projection = {};
        for (const evt of events) {
            const stored = (storedTemplates && typeof storedTemplates === 'object' && storedTemplates[evt]) || null;
            const defaultTpl = registry && registry[evt] ? registry[evt].defaultTemplate : '';
            const hasCustomActive = Boolean(stored && typeof stored.activeTemplate === 'string' && stored.activeTemplate.trim());

            projection[evt] = {
                enabled: stored && typeof stored.enabled === 'boolean' ? stored.enabled : true,
                activeTemplate: hasCustomActive ? stored.activeTemplate : defaultTpl,
                draftTemplate: (stored && typeof stored.draftTemplate === 'string') ? stored.draftTemplate : '',
                isCustomActive: hasCustomActive && (stored ? stored.enabled !== false : false),
                updatedAt: (stored && stored.updatedAt) || null
            };
        }
        return projection;
    }

    /**
     * Client-safe public settings status breakdown (ZERO raw tokens returned).
     */
    function getPublicSettings() {
        let overrides = {};
        try {
            overrides = readOverrides();
        } catch (err) {
            if (fs.existsSync(filePath)) {
                throw err;
            }
        }
        const effective = getEffectiveSettings();
        const redexOverrides = overrides.redex || {};
        const ecoOverrides = overrides.ecotrack || {};
        const telegramOverrides = overrides.telegram || {};
        const metaOverrides = overrides.metaPixel || {};

        const isRedexConfigured = Boolean(effective.redex.apiToken);
        const isEcoConfigured = Boolean(effective.ecotrack.apiToken);
        const isTgConfigured = Boolean(effective.telegram.botToken && effective.telegram.chatId);
        const isPixelConfigured = Boolean(effective.metaPixel.pixelId);
        const isCapiConfigured = Boolean(effective.metaPixel.capiToken);

        return {
            redex: {
                enabled: effective.redex.enabled,
                baseUrl: effective.redex.baseUrl,
                isConfigured: isRedexConfigured,
                tokenConfigured: isRedexConfigured,
                tokenSource: hasOwn(redexOverrides, 'apiToken')
                    ? (redexOverrides.apiToken ? 'saved' : 'none')
                    : (process.env.REDEX_API_TOKEN ? 'environment' : 'none'),
                updatedAt: effective.redex.updatedAt,
                status: !effective.redex.enabled ? 'disabled' : (isRedexConfigured ? 'configured' : 'unconfigured')
            },
            ecotrack: {
                enabled: effective.ecotrack.enabled,
                baseUrl: effective.ecotrack.baseUrl,
                isConfigured: isEcoConfigured,
                tokenConfigured: isEcoConfigured,
                tokenSource: hasOwn(ecoOverrides, 'apiToken')
                    ? (ecoOverrides.apiToken ? 'saved' : 'none')
                    : (process.env.ECOTRACK_API_TOKEN ? 'environment' : 'none'),
                updatedAt: effective.ecotrack.updatedAt,
                status: !effective.ecotrack.enabled ? 'disabled' : (isEcoConfigured ? 'configured' : 'unconfigured')
            },
            telegram: {
                enabled: effective.telegram.enabled,
                isConfigured: isTgConfigured,
                botTokenConfigured: Boolean(effective.telegram.botToken),
                botTokenSource: hasOwn(telegramOverrides, 'botToken')
                    ? (telegramOverrides.botToken ? 'saved' : 'none')
                    : (process.env.TELEGRAM_BOT_TOKEN ? 'environment' : 'none'),
                chatId: effective.telegram.chatId,
                chatIdConfigured: Boolean(effective.telegram.chatId),
                chatIdSource: hasOwn(telegramOverrides, 'chatId')
                    ? (telegramOverrides.chatId ? 'saved' : 'none')
                    : (process.env.TELEGRAM_CHAT_ID ? 'environment' : 'none'),
                templates: getPublicTemplatesProjection(telegramOverrides.templates),
                updatedAt: effective.telegram.updatedAt,
                status: !effective.telegram.enabled ? 'disabled' : (isTgConfigured ? 'configured' : 'unconfigured')
            },
            metaPixel: {
                enabled: effective.metaPixel.enabled,
                pixelId: effective.metaPixel.pixelId,
                isConfigured: isPixelConfigured,
                hasCapiToken: isCapiConfigured,
                pixelIdConfigured: isPixelConfigured,
                pixelIdSource: hasOwn(metaOverrides, 'pixelId')
                    ? (metaOverrides.pixelId ? 'saved' : 'none')
                    : (process.env.META_PIXEL_ID ? 'environment' : 'none'),
                capiEnabled: effective.metaPixel.capiEnabled,
                capiConfigured: isCapiConfigured,
                capiSource: hasOwn(metaOverrides, 'capiToken')
                    ? (metaOverrides.capiToken ? 'saved' : 'none')
                    : (process.env.META_ACCESS_TOKEN ? 'environment' : 'none'),
                scope: effective.metaPixel.scope,
                pages: effective.metaPixel.pages,
                updatedAt: effective.metaPixel.updatedAt,
                status: isPixelConfigured ? 'configured' : 'unconfigured',
                activationStatus: isPixelConfigured ? 'READY' : 'BLOCKED_AWAITING_NEW_PIXEL_ID'
            }
        };
    }

    /**
     * Public storefront configuration (anonymous endpoint, zero admin data).
     */
    function getPublicStorefrontConfig() {
        const effective = getEffectiveSettings();
        return {
            pixelId: effective.metaPixel.enabled ? effective.metaPixel.pixelId : '',
            browserPixelEnabled: effective.metaPixel.enabled && Boolean(effective.metaPixel.pixelId),
            scope: effective.metaPixel.scope,
            pages: effective.metaPixel.pages
        };
    }

    /**
     * Update credentials and settings with cross-process concurrency protection.
     * Retains existing values when fields are left blank or omitted.
     * Clears explicitly when clear... is true.
     */
    function updateSettings(patch, adminIdentifier = 'admin') {
        return withSettingsLock(() => {
            const overrides = readOverrides();
            const now = new Date().toISOString();

            // 1. RedEx
            if (patch.redex) {
                const current = overrides.redex || {};
                const next = { ...current };
                let changed = false;

                if (typeof patch.redex.enabled === 'boolean') { next.enabled = patch.redex.enabled; changed = true; }
                if (typeof patch.redex.baseUrl === 'string' && patch.redex.baseUrl.trim()) {
                    next.baseUrl = patch.redex.baseUrl.trim().replace(/\/+$/, '');
                    changed = true;
                }
                if (patch.redex.clearApiToken) {
                    next.apiToken = '';
                    changed = true;
                } else if (typeof patch.redex.apiToken === 'string' && patch.redex.apiToken.trim()) {
                    next.apiToken = patch.redex.apiToken.trim();
                    changed = true;
                }

                if (changed) {
                    next.updatedAt = now;
                    overrides.redex = next;
                    logSettingsAudit('redex', patch.redex.clearApiToken ? 'CLEAR_TOKEN' : 'UPDATE', adminIdentifier);
                }
            }

            // 2. Ecotrack
            if (patch.ecotrack) {
                const current = overrides.ecotrack || {};
                const next = { ...current };
                let changed = false;

                if (typeof patch.ecotrack.enabled === 'boolean') { next.enabled = patch.ecotrack.enabled; changed = true; }
                if (typeof patch.ecotrack.baseUrl === 'string' && patch.ecotrack.baseUrl.trim()) {
                    next.baseUrl = patch.ecotrack.baseUrl.trim().replace(/\/+$/, '');
                    changed = true;
                }
                if (patch.ecotrack.clearApiToken) {
                    next.apiToken = '';
                    changed = true;
                } else if (typeof patch.ecotrack.apiToken === 'string' && patch.ecotrack.apiToken.trim()) {
                    next.apiToken = patch.ecotrack.apiToken.trim();
                    changed = true;
                }

                if (changed) {
                    next.updatedAt = now;
                    overrides.ecotrack = next;
                    logSettingsAudit('ecotrack', patch.ecotrack.clearApiToken ? 'CLEAR_TOKEN' : 'UPDATE', adminIdentifier);
                }
            }

            // 3. Telegram
            if (patch.telegram) {
                const current = overrides.telegram || {};
                const next = { ...current };
                let changed = false;

                if (typeof patch.telegram.enabled === 'boolean') { next.enabled = patch.telegram.enabled; changed = true; }
                if (patch.telegram.clearBotToken) {
                    next.botToken = '';
                    changed = true;
                } else if (typeof patch.telegram.botToken === 'string' && patch.telegram.botToken.trim()) {
                    next.botToken = patch.telegram.botToken.trim();
                    changed = true;
                }
                if (patch.telegram.clearChatId) {
                    next.chatId = '';
                    changed = true;
                } else if (typeof patch.telegram.chatId === 'string') {
                    next.chatId = patch.telegram.chatId.trim();
                    changed = true;
                }
                if (patch.telegram.templates && typeof patch.telegram.templates === 'object') {
                    next.templates = { ...(current.templates || {}), ...patch.telegram.templates };
                    changed = true;
                }

                if (changed) {
                    next.updatedAt = now;
                    overrides.telegram = next;
                    logSettingsAudit('telegram', (patch.telegram.clearBotToken || patch.telegram.clearChatId) ? 'CLEAR' : 'UPDATE', adminIdentifier);
                }
            }

            // 4. Meta Pixel & CAPI
            if (patch.metaPixel) {
                const current = overrides.metaPixel || {};
                const next = { ...current };
                let changed = false;

                if (typeof patch.metaPixel.enabled === 'boolean') { next.enabled = patch.metaPixel.enabled; changed = true; }
                if (patch.metaPixel.clearPixelId) {
                    next.pixelId = '';
                    changed = true;
                } else if (typeof patch.metaPixel.pixelId === 'string' && patch.metaPixel.pixelId.trim()) {
                    const pid = patch.metaPixel.pixelId.trim();
                    if (pid === LEGACY_PIXEL_ID) throw new Error('LEGACY_PIXEL_DECOMMISSIONED');
                    next.pixelId = pid;
                    changed = true;
                }
                if (typeof patch.metaPixel.capiEnabled === 'boolean') { next.capiEnabled = patch.metaPixel.capiEnabled; changed = true; }
                if (patch.metaPixel.clearCapiToken) {
                    next.capiToken = '';
                    changed = true;
                } else if (typeof patch.metaPixel.capiToken === 'string' && patch.metaPixel.capiToken.trim()) {
                    next.capiToken = patch.metaPixel.capiToken.trim();
                    changed = true;
                }
                if (patch.metaPixel.scope === 'all' || patch.metaPixel.scope === 'selected') {
                    next.scope = patch.metaPixel.scope;
                    changed = true;
                }
                if (Array.isArray(patch.metaPixel.pages)) {
                    next.pages = patch.metaPixel.pages.filter(p => STOREFRONT_PAGES.includes(p));
                    changed = true;
                }

                if (changed) {
                    next.updatedAt = now;
                    overrides.metaPixel = next;
                    logSettingsAudit('metaPixel', (patch.metaPixel.clearPixelId || patch.metaPixel.clearCapiToken) ? 'CLEAR' : 'UPDATE', adminIdentifier);
                }
            }

            writeOverrides(overrides);
            return getPublicSettings();
        });
    }

    /**
     * Telegram Template Management Methods (Phase 8F Milestone 2):
     * Persists templates under overrides.telegram.templates[event] inside admin-settings.enc.
     */
    function saveTemplateDraft(event, draftTemplate, enabled, adminIdentifier = 'admin') {
        return withSettingsLock(() => {
            const overrides = readOverrides();
            if (!overrides.telegram) overrides.telegram = {};
            if (!overrides.telegram.templates) overrides.telegram.templates = {};

            const current = overrides.telegram.templates[event] || {};
            const now = new Date().toISOString();
            const next = {
                ...current,
                draftTemplate: typeof draftTemplate === 'string' ? draftTemplate : '',
                updatedAt: now
            };
            if (typeof enabled === 'boolean') {
                next.enabled = enabled;
            } else if (current.enabled === undefined) {
                next.enabled = true;
            }

            overrides.telegram.templates[event] = next;
            overrides.telegram.updatedAt = now;
            writeOverrides(overrides);
            logSettingsAudit('telegram', 'SAVE_DRAFT', adminIdentifier);
            return getPublicSettings();
        });
    }

    function activateTemplate(event, adminIdentifier = 'admin') {
        return withSettingsLock(() => {
            const overrides = readOverrides();
            if (!overrides.telegram) overrides.telegram = {};
            if (!overrides.telegram.templates) overrides.telegram.templates = {};

            const current = overrides.telegram.templates[event] || {};
            const draft = current.draftTemplate;
            let activeText = '';
            if (typeof draft === 'string' && draft.trim()) {
                activeText = draft;
            } else {
                let engine = null;
                try { engine = require('./telegram-template-engine'); } catch (_) {}
                const defaultTpl = engine?.getEventRegistry()?.[event]?.defaultTemplate || '';
                activeText = current.activeTemplate || defaultTpl;
            }

            const now = new Date().toISOString();
            current.activeTemplate = activeText;
            current.enabled = true;
            current.updatedAt = now;
            overrides.telegram.templates[event] = current;
            overrides.telegram.updatedAt = now;
            writeOverrides(overrides);
            logSettingsAudit('telegram', 'ACTIVATE_TEMPLATE', adminIdentifier);
            return getPublicSettings();
        });
    }

    function restoreTemplateDefault(event, adminIdentifier = 'admin') {
        return withSettingsLock(() => {
            const overrides = readOverrides();
            if (overrides.telegram && overrides.telegram.templates && overrides.telegram.templates[event]) {
                delete overrides.telegram.templates[event];
                overrides.telegram.updatedAt = new Date().toISOString();
                writeOverrides(overrides);
                logSettingsAudit('telegram', 'RESTORE_DEFAULT', adminIdentifier);
            }
            return getPublicSettings();
        });
    }

    function toggleTemplate(event, enabled, adminIdentifier = 'admin') {
        return withSettingsLock(() => {
            const overrides = readOverrides();
            if (!overrides.telegram) overrides.telegram = {};
            if (!overrides.telegram.templates) overrides.telegram.templates = {};

            const current = overrides.telegram.templates[event] || { draftTemplate: '', activeTemplate: '' };
            current.enabled = Boolean(enabled);
            const now = new Date().toISOString();
            current.updatedAt = now;
            overrides.telegram.templates[event] = current;
            overrides.telegram.updatedAt = now;
            writeOverrides(overrides);
            logSettingsAudit('telegram', enabled ? 'ENABLE_TEMPLATE' : 'DISABLE_TEMPLATE', adminIdentifier);
            return getPublicSettings();
        });
    }

    /**
     * Safe Key Migration Helper (Phase 8D.1.1):
     * Decrypts legacy settings file using legacy derived key and re-encrypts with independent key.
     */
    function migrateExistingSettingsKey(migrationOptions = {}) {
        const legacySecret = migrationOptions.legacySecret || process.env.ADMIN_API_TOKEN;
        const newSecret = migrationOptions.newSecret || process.env.ADMIN_SETTINGS_ENCRYPTION_KEY;
        const targetPath = migrationOptions.targetFile || migrationOptions.filePath || filePath;

        if (!legacySecret) throw new Error('LEGACY_SECRET_REQUIRED');
        if (!newSecret) throw new Error('NEW_KEY_REQUIRED');

        const newKey = parseEncryptionKey(newSecret);

        if (!fs.existsSync(targetPath)) {
            return { migrated: false, reason: 'NO_FILE' };
        }

        const raw = fs.readFileSync(targetPath, 'utf8');
        const envelope = JSON.parse(raw);

        // Check if already readable with new key
        try {
            const decipherNew = crypto.createDecipheriv('aes-256-gcm', newKey, Buffer.from(envelope.iv, 'base64'));
            decipherNew.setAuthTag(Buffer.from(envelope.tag, 'base64'));
            decipherNew.setAAD(Buffer.from(AAD_STRING, 'utf8'));
            const clearNew = Buffer.concat([decipherNew.update(Buffer.from(envelope.ciphertext, 'base64')), decipherNew.final()]).toString('utf8');
            JSON.parse(clearNew);
            return { migrated: false, alreadyMigrated: true };
        } catch (_) {}

        // Decrypt with legacy derived key (with or without AAD)
        const legacyKey = crypto.createHash('sha256').update('orva-admin-settings-v1\0').update(legacySecret).digest();
        let cleartext;
        try {
            const decipherOld = crypto.createDecipheriv('aes-256-gcm', legacyKey, Buffer.from(envelope.iv, 'base64'));
            decipherOld.setAuthTag(Buffer.from(envelope.tag, 'base64'));
            cleartext = Buffer.concat([decipherOld.update(Buffer.from(envelope.ciphertext, 'base64')), decipherOld.final()]).toString('utf8');
        } catch (_) {
            try {
                const decipherOld = crypto.createDecipheriv('aes-256-gcm', legacyKey, Buffer.from(envelope.iv, 'base64'));
                decipherOld.setAuthTag(Buffer.from(envelope.tag, 'base64'));
                decipherOld.setAAD(Buffer.from(AAD_STRING, 'utf8'));
                cleartext = Buffer.concat([decipherOld.update(Buffer.from(envelope.ciphertext, 'base64')), decipherOld.final()]).toString('utf8');
            } catch (err) {
                throw new Error(`LEGACY_DECRYPTION_FAILED: ${err.message}`);
            }
        }

        const data = JSON.parse(cleartext);

        // Backup before re-encrypting
        fs.copyFileSync(targetPath, `${targetPath}.legacy_backup`);

        // Re-encrypt with new key
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', newKey, iv);
        cipher.setAAD(Buffer.from(AAD_STRING, 'utf8'));
        const ciphertext = Buffer.concat([
            cipher.update(JSON.stringify(data), 'utf8'),
            cipher.final()
        ]);

        const newEnvelope = JSON.stringify({
            version: 1,
            algorithm: 'aes-256-gcm',
            keyId: 'v1',
            iv: iv.toString('base64'),
            tag: cipher.getAuthTag().toString('base64'),
            ciphertext: ciphertext.toString('base64')
        });

        const tempPath = `${targetPath}.${process.pid}.migrated.tmp`;
        fs.writeFileSync(tempPath, newEnvelope, { encoding: 'utf8', mode: 0o600 });
        try { fs.chmodSync(tempPath, 0o600); } catch (_) {}
        fs.renameSync(tempPath, targetPath);
        try { fs.chmodSync(targetPath, 0o600); } catch (_) {}

        return { migrated: true, integrations: Object.keys(data) };
    }

    return {
        getEffectiveSettings,
        getPublicSettings,
        getPublicStorefrontConfig,
        updateSettings,
        saveTemplateDraft,
        saveTemplate: saveTemplateDraft,
        activateTemplate,
        restoreTemplateDefault,
        restoreTemplate: restoreTemplateDefault,
        restoreDefaultTemplate: restoreTemplateDefault,
        toggleTemplate,
        readEncryptedStore: () => readOverrides(),
        writeEncryptedStore: (overrides) => writeOverrides(overrides),
        createEncryptedBackup: (customPath) => {
            return withSettingsLock(() => {
                if (!fs.existsSync(filePath)) {
                    throw new Error('NO_SETTINGS_FILE_TO_BACKUP');
                }
                readOverrides();
                const target = customPath || path.join(BACKUPS_DIR, `admin-settings-${Date.now()}.enc.backup`);
                fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
                const tmp = `${target}.${process.pid}.tmp`;
                fs.copyFileSync(filePath, tmp);
                try { fs.chmodSync(tmp, 0o600); } catch (_) {}
                fs.renameSync(tmp, target);
                try { fs.chmodSync(target, 0o600); } catch (_) {}
                return { success: true, backupPath: target, timestamp: new Date().toISOString() };
            });
        },
        restoreEncryptedBackup: (backupPath) => {
            return withSettingsLock(() => {
                if (!fs.existsSync(backupPath)) {
                    throw new Error('BACKUP_FILE_NOT_FOUND');
                }
                const testStore = createAdminSettingsStore({ secret: options.secret, filePath: backupPath });
                const data = testStore.readEncryptedStore();
                if (!data || typeof data !== 'object') {
                    throw new Error('CORRUPT_BACKUP_FILE');
                }
                const tmp = `${filePath}.${process.pid}.restore.tmp`;
                fs.copyFileSync(backupPath, tmp);
                try { fs.chmodSync(tmp, 0o600); } catch (_) {}
                fs.renameSync(tmp, filePath);
                try { fs.chmodSync(filePath, 0o600); } catch (_) {}
                return { success: true, restoredIntegrations: Object.keys(data) };
            });
        },
        migrateExistingSettingsKey
    };
}

const defaultStore = createAdminSettingsStore();

module.exports = {
    SETTINGS_FILE,
    BACKUPS_DIR,
    AUDIT_FILE,
    LOCKS_DIR,
    AAD_STRING,
    DEFAULT_REDEX_URL,
    DEFAULT_ECOTRACK_URL,
    DEFAULT_PIXEL_ID,
    LEGACY_PIXEL_ID,
    STOREFRONT_PAGES,
    parseEncryptionKey,
    withSettingsLock,
    createAdminSettingsStore,
    getEffectiveSettings: () => defaultStore.getEffectiveSettings(),
    getPublicSettings: () => defaultStore.getPublicSettings(),
    getPublicStorefrontConfig: () => defaultStore.getPublicStorefrontConfig(),
    updateSettings: (patch, adminId) => defaultStore.updateSettings(patch, adminId),
    saveTemplateDraft: (event, draft, enabled, adminId) => defaultStore.saveTemplateDraft(event, draft, enabled, adminId),
    saveTemplate: (event, draft, enabled, adminId) => defaultStore.saveTemplate(event, draft, enabled, adminId),
    activateTemplate: (event, adminId) => defaultStore.activateTemplate(event, adminId),
    restoreTemplateDefault: (event, adminId) => defaultStore.restoreTemplateDefault(event, adminId),
    restoreTemplate: (event, adminId) => defaultStore.restoreTemplate(event, adminId),
    restoreDefaultTemplate: (event, adminId) => defaultStore.restoreDefaultTemplate(event, adminId),
    toggleTemplate: (event, enabled, adminId) => defaultStore.toggleTemplate(event, enabled, adminId),
    readEncryptedStore: () => defaultStore.readEncryptedStore(),
    writeEncryptedStore: (overrides) => defaultStore.writeEncryptedStore(overrides),
    createEncryptedBackup: (customPath) => defaultStore.createEncryptedBackup(customPath),
    restoreEncryptedBackup: (backupPath) => defaultStore.restoreEncryptedBackup(backupPath),
    migrateExistingSettingsKey: (opts) => defaultStore.migrateExistingSettingsKey(opts)
};
