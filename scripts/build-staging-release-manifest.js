'use strict';
/**
 * Build a Staging release file manifest + SHA-256 of the sorted path list.
 * Does not create a ZIP. Does not commit.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const EXCLUDE_PREFIXES = [
    'tools/pgsql-portable/',
    'tools/orva-pgdata/',
    'tools/pgsql-extract-tmp/',
    'tools/pgsql/',
    'data/private/',
    'node_modules/',
    '.git/',
    'orvastore Dashbaord v0.9/',
    'review-artifacts/',
];

const EXCLUDE_NAMES = new Set([
    '.env.local',
    '.env',
    'orva-local-pg.env',
    'orva-local-pg.pw',
]);

const EXCLUDE_SUFFIXES = [
    '.jar',
    '.txz',
    '.enc',
    '.pem',
];

const EXCLUDE_GLOBS_CONTAINS = [
    'pg-integration-orva-local-results',
    'php-pg-parity-results',
    'reservation-count-49-vs-51',
];

function trackedFiles() {
    const out = execSync('git ls-files -z', { cwd: ROOT, encoding: 'buffer' });
    return out
        .toString('utf8')
        .split('\0')
        .filter(Boolean);
}

function untrackedCandidates() {
    // Stabilization files that should be part of the intended Staging commit (not yet tracked).
    return [
        'lib/db-authority.js',
        'lib/idempotency-pg.js',
        'lib/inventory-pg.js',
        'lib/inventory-pg.php',
        'lib/inventory-recovery.js',
        'lib/orva-pg.php',
        'lib/rate-limit-pg.php',
        'scripts/recover-abandoned-reservations.js',
        'scripts/recover-abandoned-reservations.php',
        'scripts/inventory-seed-dry-run.js',
        'supabase/proposals/2026-11-07-public-inventory-idempotency.sql',
        'supabase/proposals/2026-11-07-public-inventory-idempotency-rate-limit.md',
        'docs/HOSTINGER_INVENTORY_RECOVERY_CRON_PROPOSAL.md',
        'ORVA_STORE_BACKEND_STABILIZATION_LOCAL_REPORT.md',
        'ORVA_STORE_STAGING_RELEASE_PREPARATION.md',
    ].filter((p) => fs.existsSync(path.join(ROOT, p)));
}

function isExcluded(rel) {
    const norm = rel.replace(/\\/g, '/');
    if (EXCLUDE_NAMES.has(path.basename(norm))) return true;
    if (EXCLUDE_PREFIXES.some((p) => norm.startsWith(p))) return true;
    if (EXCLUDE_SUFFIXES.some((s) => norm.endsWith(s))) return true;
    if (EXCLUDE_GLOBS_CONTAINS.some((s) => norm.includes(s))) return true;
    if (norm.startsWith('tools/') && /\.(jar|txz|tar)$/i.test(norm)) return true;
    return false;
}

function main() {
    const tracked = trackedFiles().filter((f) => !isExcluded(f));
    const extra = untrackedCandidates().filter((f) => !isExcluded(f));
    const all = Array.from(new Set([...tracked, ...extra])).sort();
    const listBody = all.join('\n') + '\n';
    const checksum = crypto.createHash('sha256').update(listBody, 'utf8').digest('hex');

    const warnings = [];
    if (tracked.includes('data/inventory-state.json')) {
        warnings.push(
            'data/inventory-state.json is Git-tracked; Staging deploy must NOT overwrite live Hostinger inventory with a developer workstation copy. Prefer server-side preserve / exclude from rsync deploy.'
        );
    }
    if (tracked.includes('data/reservation-reconciliation-report.json')) {
        warnings.push('reservation reconciliation reports are tracked; exclude from website docroot if packaging a ZIP.');
    }

    const manifest = {
        generatedAt: new Date().toISOString(),
        baseBranch: 'release/v1.0',
        proposedStagingBranch: 'staging',
        fileCount: all.length,
        manifestListSha256: checksum,
        warnings,
        excludedLocalOnly: [
            'tools/pgsql-portable/',
            'tools/orva-pgdata/',
            'data/private/orva-local-pg.env',
            '.env.local',
            'local PG test result JSON',
            'orvastore Dashbaord v0.9/ (source; deploy uses admin/ export)',
        ],
        includesAdminExport: all.some((f) => f.startsWith('admin/')),
        adminFileCount: all.filter((f) => f.startsWith('admin/')).length,
        proposedNewFiles: extra,
        // Do not embed full path list in chat-facing report size; write sidecar
    };

    const outDir = path.join(ROOT, 'data', 'local-fixtures');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'staging-release-manifest-files.txt'), listBody);
    fs.writeFileSync(
        path.join(outDir, 'staging-release-manifest.json'),
        JSON.stringify(manifest, null, 2)
    );
    console.log(JSON.stringify(manifest, null, 2));
}

main();
