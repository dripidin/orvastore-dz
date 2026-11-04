'use strict';
// =============================================================================
// ORVA STORE — Static Admin Dashboard Synchronization Script (Phase 8F / M3)
// Synchronizes compiled Next.js export (out/) to admin/ and dist-hostinger/admin/
// Purges stale _next asset chunks to ensure clean hash alignment
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'orvastore Dashbaord v0.9', 'next-shadcn-admin-dashboard-baseui-main', 'out');
const ADMIN_DIR = path.join(ROOT, 'admin');
const DIST_ADMIN_DIR = path.join(ROOT, 'dist-hostinger', 'admin');

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function syncFolder(src, dest) {
    if (!fs.existsSync(src)) {
        throw new Error(`Source directory does not exist: ${src}. Run npm run build in dashboard first.`);
    }
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    // 1. Purge obsolete _next directory to eliminate stale hashed chunks
    // Resilient against Windows EBUSY / EPERM file locks via native retries and fallback
    const oldNext = path.join(dest, '_next');
    if (fs.existsSync(oldNext)) {
        try {
            fs.rmSync(oldNext, {
                recursive: true,
                force: true,
                maxRetries: 5,
                retryDelay: 200
            });
        } catch (err) {
            console.warn(`[SYNC-WARN] Transient lock encountered while purging ${oldNext} (${err.code || err.message}). Proceeding with overwrite copy.`);
        }
    }

    // 2. Cleanly mirror all static export assets with retry resilience
    let copied = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            fs.cpSync(src, dest, { recursive: true, force: true });
            copied = true;
            break;
        } catch (err) {
            if ((err.code === 'EBUSY' || err.code === 'EPERM') && attempt < 3) {
                console.warn(`[SYNC-WARN] Copy locked on attempt ${attempt}/3 (${err.code}). Retrying in 250ms...`);
                sleepSync(250);
            } else {
                throw err;
            }
        }
    }
    console.log(`[SYNC] Successfully mirrored ${src} -> ${dest}`);
}

console.log('================================================================================');
console.log('   ORVA STORE — SYNCHRONIZING ADMIN DASHBOARD STATIC EXPORT');
console.log('================================================================================');
syncFolder(OUT_DIR, ADMIN_DIR);
syncFolder(OUT_DIR, DIST_ADMIN_DIR);
console.log('[SYNC] Completed! Both admin/ and dist-hostinger/admin/ are synchronized.');
