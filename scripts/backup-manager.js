'use strict';
// =============================================================================
// ORVA STORE — Automated Backup & Disaster Recovery Manager
// Website: orva-store.com
// LiteSpeed Web Server + PHP 8.3 + Static Export
// =============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const DEFAULT_BACKUPS_DIR = path.join(WORKSPACE_ROOT, 'backups');

// Files and patterns to strictly EXCLUDE (Secret & Security Protection)
const EXCLUDED_PATTERNS = [
    /(^|[/\\])\.env/i,
    /(^|[/\\])\.git/i,
    /(^|[/\\])node_modules/i,
    /(^|[/\\])data[/\\]private/i,
    /(^|[/\\])data[/\\]locks/i,
    /(^|[/\\])config\.php$/i,
    /\.lock$/i,
    /\.tmp$/i,
    /\.bak$/i,
    /(^|[/\\])backups/i
];

function isExcluded(relPath) {
    return EXCLUDED_PATTERNS.some(pat => pat.test(relPath));
}

function computeFileHash(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    return {
        sha256: crypto.createHash('sha256').update(fileBuffer).digest('hex'),
        size: fileBuffer.length
    };
}

/**
 * Collects list of files eligible for backup.
 */
function getBackupFileList(rootDir) {
    const eligibleFiles = [];

    // 1. Root storefront HTML and configs
    const rootCandidates = [
        'index.html',
        'pack1.html',
        'pack2.html',
        'admin.html',
        'yamaha-archive.html',
        '.htaccess',
        'robots.txt',
        'sitemap.xml',
        'styles.css',
        'packs-styles.css',
        'script.js',
        'packs-client.js',
        'algeria-communes.js'
    ];

    for (const file of rootCandidates) {
        const fullPath = path.join(rootDir, file);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile() && !isExcluded(file)) {
            eligibleFiles.push(file);
        }
    }

    // 2. Published product pages
    const productsDir = path.join(rootDir, 'products');
    if (fs.existsSync(productsDir) && fs.statSync(productsDir).isDirectory()) {
        const productFiles = fs.readdirSync(productsDir);
        for (const pf of productFiles) {
            const rel = path.join('products', pf);
            const full = path.join(rootDir, rel);
            if (pf.endsWith('.html') && fs.statSync(full).isFile() && !isExcluded(rel)) {
                eligibleFiles.push(rel.replace(/\\/g, '/'));
            }
        }
    }

    // 3. Authoritative data files (never private/secrets)
    const dataCandidates = [
        'data/.htaccess',
        'data/products-catalog.json',
        'data/inventory-state.json',
        'data/inventory-audit.json',
        'data/wilayas-tariffs.json',
        'data/shipments-registry.json',
        'data/telegram-dispatch-ledger.json',
        'data/idempotency-records.json'
    ];

    for (const df of dataCandidates) {
        const fullPath = path.join(rootDir, df);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile() && !isExcluded(df)) {
            eligibleFiles.push(df.replace(/\\/g, '/'));
        }
    }

    // 4. API configurations and handlers (excluding secrets)
    const apiCandidates = [
        'api/.htaccess',
        'api/send-order.php',
        'api/auth.php',
        'api/delivery.php',
        'api/publish-page.php',
        'api/send-order.js',
        'api/delivery.js',
        'api/publish-page.js'
    ];

    for (const af of apiCandidates) {
        const fullPath = path.join(rootDir, af);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile() && !isExcluded(af)) {
            eligibleFiles.push(af.replace(/\\/g, '/'));
        }
    }

    return eligibleFiles;
}

/**
 * Creates a complete backup with SHA-256 manifest.
 */
function createBackup(options = {}) {
    const rootDir = options.rootDir || WORKSPACE_ROOT;
    const backupsDir = options.backupsDir || DEFAULT_BACKUPS_DIR;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupId = options.tag ? `backup-${options.tag}-${timestamp}` : `backup-${timestamp}`;
    const targetDir = path.join(backupsDir, backupId);

    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    const filesToBackup = getBackupFileList(rootDir);
    const manifestFiles = [];
    let totalBytes = 0;

    for (const relPath of filesToBackup) {
        const srcPath = path.join(rootDir, relPath);
        const destPath = path.join(targetDir, relPath);

        const destFolder = path.dirname(destPath);
        if (!fs.existsSync(destFolder)) {
            fs.mkdirSync(destFolder, { recursive: true });
        }

        fs.copyFileSync(srcPath, destPath);

        const { sha256, size } = computeFileHash(destPath);
        totalBytes += size;
        manifestFiles.push({
            path: relPath,
            sha256,
            size,
            mtime: fs.statSync(srcPath).mtime.toISOString()
        });
    }

    // Compute manifest hash
    const manifestContent = JSON.stringify(manifestFiles);
    const manifestHash = crypto.createHash('sha256').update(manifestContent).digest('hex');

    const manifest = {
        version: '1.0.0',
        backupId,
        createdAt: new Date().toISOString(),
        totalFiles: manifestFiles.length,
        totalBytes,
        manifestHash,
        files: manifestFiles
    };

    const manifestPath = path.join(targetDir, 'backup-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    // Optionally create tar.gz archive if tar is supported
    let archiveFile = null;
    try {
        const tarPath = path.join(backupsDir, `${backupId}.tar.gz`);
        execSync(`tar -czf "${tarPath}" -C "${targetDir}" .`, { stdio: 'pipe' });
        if (fs.existsSync(tarPath)) {
            archiveFile = tarPath;
        }
    } catch (_) {
        // Tar command optional; directory backup is always preserved
    }

    return {
        success: true,
        backupId,
        backupDir: targetDir,
        archiveFile,
        manifestPath,
        manifest
    };
}

/**
 * Verifies and restores a backup to a target directory, confirming byte-for-byte SHA-256 match.
 */
function verifyRestore(backupDirOrArchive, testRestoreDir) {
    if (!fs.existsSync(testRestoreDir)) {
        fs.mkdirSync(testRestoreDir, { recursive: true });
    }

    let sourceDir = backupDirOrArchive;

    // If it's a tar.gz archive, extract it
    if (backupDirOrArchive.endsWith('.tar.gz') || backupDirOrArchive.endsWith('.tar')) {
        execSync(`tar -xzf "${backupDirOrArchive}" -C "${testRestoreDir}"`, { stdio: 'pipe' });
        sourceDir = testRestoreDir;
    } else {
        // Copy files from sourceDir to testRestoreDir
        copyRecursive(sourceDir, testRestoreDir);
    }

    const manifestPath = path.join(testRestoreDir, 'backup-manifest.json');
    if (!fs.existsSync(manifestPath)) {
        return {
            success: false,
            error: 'MISSING_MANIFEST',
            message: 'backup-manifest.json was not found in the restored directory.'
        };
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const mismatched = [];
    let verifiedCount = 0;

    for (const item of manifest.files) {
        const restoredFilePath = path.join(testRestoreDir, item.path);
        if (!fs.existsSync(restoredFilePath)) {
            mismatched.push({ path: item.path, error: 'FILE_MISSING' });
            continue;
        }

        const { sha256, size } = computeFileHash(restoredFilePath);
        if (size !== item.size) {
            mismatched.push({ path: item.path, error: 'SIZE_MISMATCH', expected: item.size, actual: size });
            continue;
        }
        if (sha256 !== item.sha256) {
            mismatched.push({ path: item.path, error: 'SHA256_MISMATCH', expected: item.sha256, actual: sha256 });
            continue;
        }

        verifiedCount++;
    }

    return {
        success: mismatched.length === 0,
        backupId: manifest.backupId,
        totalFiles: manifest.totalFiles,
        verifiedCount,
        mismatched,
        manifest
    };
}

function copyRecursive(src, dest) {
    const stats = fs.statSync(src);
    if (stats.isDirectory()) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        const items = fs.readdirSync(src);
        for (const item of items) {
            copyRecursive(path.join(src, item), path.join(dest, item));
        }
    } else {
        fs.copyFileSync(src, dest);
    }
}

/**
 * Lists all backups in the backups directory.
 */
function listBackups(backupsDir = DEFAULT_BACKUPS_DIR) {
    if (!fs.existsSync(backupsDir)) return [];
    const entries = fs.readdirSync(backupsDir);
    const backups = [];

    for (const entry of entries) {
        const fullPath = path.join(backupsDir, entry);
        const manifestPath = path.join(fullPath, 'backup-manifest.json');
        if (fs.existsSync(manifestPath)) {
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                backups.push({
                    id: manifest.backupId,
                    createdAt: manifest.createdAt,
                    totalFiles: manifest.totalFiles,
                    totalBytes: manifest.totalBytes,
                    path: fullPath
                });
            } catch (_) {}
        }
    }

    return backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = {
    createBackup,
    verifyRestore,
    listBackups,
    getBackupFileList,
    computeFileHash,
    isExcluded,
    DEFAULT_BACKUPS_DIR
};

