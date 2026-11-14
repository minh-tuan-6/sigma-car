#!/usr/bin/env node
// scripts/demo/remove-demo-data.js — remove one synthetic demo batch from a D1 state store (PLAN.md T5.5, §I.5)
//
//   node scripts/demo/remove-demo-data.js --batch demo-2026 [--out .d1-migration/remove-demo-2026.sql]
//
// Writes SQL only; it never connects to a database. The printed wrangler commands run it (count first, then remove).
// A raw DELETE is NOT enough: running Workers keep the D1 state cached and reload only rows whose revision changed
// (migration 0002). So, exactly like D1StateStore.commit(), the SQL
//   1. bumps state_revision by one (the state_revision_guard trigger only allows +1),
//   2. records every removed row in state_deletions at that revision,
//   3. deletes only rows whose JSON has isDemo = 1 AND demoBatchId = <batch>.
// Real records (no isDemo flag) can never match. Back up first (docs/CLOUDFLARE_WORKERS_DEPLOYMENT.md §7).

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BATCH_PATTERN = /^[a-z0-9-]{3,40}$/;

function buildSql(batchId, nowIso = new Date().toISOString()) {
  if (!BATCH_PATTERN.test(String(batchId || ''))) throw new Error('--batch must be 3–40 characters [a-z0-9-]');
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(nowIso)) throw new Error('invalid timestamp');
  const match = `json_extract(doc, '$.isDemo') = 1 AND json_extract(doc, '$.demoBatchId') = '${batchId}'`;
  return [
    `-- Remove SIGMACAR demo batch "${batchId}" (generated ${nowIso}). Real records cannot match: they have no isDemo flag.`,
    `UPDATE state_revision SET rev = rev + 1, updated_at = '${nowIso}' WHERE id = 1;`,
    'INSERT INTO state_deletions (collection, doc_key, rev)',
    '  SELECT collection, doc_key, (SELECT rev FROM state_revision WHERE id = 1) FROM state_documents',
    `  WHERE ${match}`,
    '  ON CONFLICT (collection, doc_key) DO UPDATE SET rev = excluded.rev;',
    `DELETE FROM state_documents WHERE ${match};`,
    ''
  ].join('\n');
}

function buildCountSql(batchId) {
  if (!BATCH_PATTERN.test(String(batchId || ''))) throw new Error('--batch must be 3–40 characters [a-z0-9-]');
  return `SELECT collection, COUNT(*) AS rows FROM state_documents WHERE json_extract(doc, '$.isDemo') = 1 AND json_extract(doc, '$.demoBatchId') = '${batchId}' GROUP BY collection ORDER BY collection;`;
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--batch') args.batch = argv[++i];
    else if (k === '--out') args.out = path.resolve(argv[++i]);
    else if (k === '-h' || k === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 15).join('\n')); return 0; }
    else { console.error(`Unknown option ${k}`); return 2; }
  }
  let sql;
  try { sql = buildSql(args.batch); } catch (e) { console.error(e.message); return 2; }
  const out = args.out || path.join(ROOT, '.d1-migration', `remove-${args.batch}.sql`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, sql);
  const rel = path.relative(ROOT, out);
  console.log(`Wrote ${rel}. Nothing was executed.`);
  console.log('1) Count what would be removed (read-only):');
  console.log(`   npx.cmd wrangler d1 execute DB --env staging --remote -c wrangler.api.toml --command "${buildCountSql(args.batch)}"`);
  console.log('2) Remove (only after reviewing the count and taking a backup):');
  console.log(`   npx.cmd wrangler d1 execute DB --env staging --remote -c wrangler.api.toml --file ${rel}`);
  console.log('   (use --local instead of --env staging --remote for the local development database)');
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { buildSql, buildCountSql, BATCH_PATTERN };
