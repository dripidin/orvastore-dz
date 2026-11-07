'use strict';
/**
 * Fail if Vercel would see conflicting api basenames without PHP ignore.
 * Run: node scripts/vercel-path-conflicts.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const apiDir = path.join(root, 'api');
const files = fs.readdirSync(apiDir).filter((f) => fs.statSync(path.join(apiDir, f)).isFile());
const byBase = new Map();

for (const f of files) {
  const ext = path.extname(f).toLowerCase();
  if (!['.js', '.php', '.ts', '.mjs'].includes(ext)) continue;
  const base = path.basename(f, ext);
  if (!byBase.has(base)) byBase.set(base, []);
  byBase.get(base).push(f);
}

const conflicts = [...byBase.entries()].filter(([, list]) => list.length > 1);
const ignorePath = path.join(root, '.vercelignore');
const ignore = fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, 'utf8') : '';
const phpIgnored = /api\/\*\.php/.test(ignore) || /\*\*\/\*\.php/.test(ignore);

if (conflicts.length && !phpIgnored) {
  console.error('Vercel path conflicts (add .vercelignore api/*.php):');
  for (const [base, list] of conflicts) console.error(`  ${base}: ${list.join(', ')}`);
  process.exit(1);
}

console.log(
  phpIgnored
    ? `OK: ${conflicts.length} basename pair(s); .vercelignore excludes PHP for Vercel.`
    : 'OK: no api basename conflicts.'
);
