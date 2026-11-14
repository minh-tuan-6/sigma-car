#!/usr/bin/env node
// scripts/d1/create-admin.js
// Creates the first administrator in a D1 database that has no demo accounts (production must not use the demo
// accounts with public passwords). The record is built by the application's own UserRepository.create() and scrypt
// hashing, so it is identical in shape to admins created through the API; only the salted hash is written.
//
// PowerShell:
//   $env:SIGMA_ADMIN_PASSWORD = '<a long password, >= 12 chars>'
//   node scripts/d1/create-admin.js --email admin@example.com --name "Quản trị viên" --env staging
//   Remove-Item Env:SIGMA_ADMIN_PASSWORD
// Targets: --local [--persist-to <dir>] | --env staging | --env production --confirm-production
// The password is read from SIGMA_ADMIN_PASSWORD (never from the command line, so it stays out of shell history).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

function parse(argv) {
  const a = { config: path.join(ROOT, 'wrangler.api.toml') };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--email') a.email = v();
    else if (k === '--name') a.name = v();
    else if (k === '--phone') a.phone = v();
    else if (k === '--local') a.local = true;
    else if (k === '--persist-to') a.persistTo = path.resolve(v());
    else if (k === '--env') a.env = v();
    else if (k === '--confirm-production') a.confirmProduction = true;
    else if (k === '--config') a.config = path.resolve(v());
    else throw new Error(`Unknown option ${k}`);
  }
  return a;
}

function q(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function wrangler(a, extra) {
  const pkgDir = path.dirname(require.resolve('wrangler/package.json', { paths: [ROOT] }));
  const bin = path.join(pkgDir, require(path.join(pkgDir, 'package.json')).bin.wrangler);
  const target = a.local ? ['--local', ...(a.persistTo ? ['--persist-to', a.persistTo] : [])] : ['--env', a.env, '--remote'];
  const r = spawnSync(process.execPath, [bin, ...extra, '-c', a.config, ...target], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true', SIGMA_ADMIN_PASSWORD: '' }
  });
  if (r.status !== 0) throw new Error(`wrangler failed: ${(r.stderr || r.stdout).slice(-1500)}`);
  return r.stdout;
}

async function main() {
  const a = parse(process.argv.slice(2));
  if (!a.email || !a.name) throw new Error('--email and --name are required');
  if (!a.local && !a.env) throw new Error('Choose a target: --local or --env <staging|production>');
  if (a.env === 'production' && !a.confirmProduction) throw new Error('Refusing to write to production without --confirm-production');
  const password = process.env.SIGMA_ADMIN_PASSWORD || '';
  if (password.length < 12) throw new Error('Set SIGMA_ADMIN_PASSWORD (at least 12 characters) in the environment');

  process.env.SIGMACAR_LAZY_INIT = 'true';
  const StorageEngine = require('../../backend/infrastructure/storage-engine');
  StorageEngine.configureStorage({ driver: null, mode: 'memory', allowDevSeed: false });
  StorageEngine.resetToEmpty();
  const Security = require('../../backend/infrastructure/security');
  const UserRepository = require('../../backend/infrastructure/repositories/user-repository');
  const { ROLES, SHOWROOM_BRANCHES } = require('../../backend/domain/constants');
  const passwordHash = await Security.hashPassword(password);
  await UserRepository.create({
    email: a.email,
    fullName: a.name,
    phone: a.phone || '',
    role: ROLES.ADMIN,
    branchId: 'all',
    branchIds: SHOWROOM_BRANCHES.map(b => b.id),
    passwordHash
  });
  const user = StorageEngine.dbState.users[0];
  const nowIso = new Date().toISOString();
  const doc = JSON.stringify(user);

  const sql = [
    `INSERT INTO state_documents (collection, doc_key, pos, doc, updated_at, rev)`,
    `  SELECT 'users', ${q(user.id)}, COALESCE((SELECT MAX(pos) FROM state_documents WHERE collection = 'users'), -1) + 1, ${q(doc)}, ${q(nowIso)}, (SELECT rev + 1 FROM state_revision WHERE id = 1)`,
    `  WHERE NOT EXISTS (SELECT 1 FROM state_documents WHERE collection = 'users' AND lower(json_extract(doc, '$.email')) = ${q(user.email)});`,
    `INSERT INTO state_collection_revision (collection, rev) SELECT 'users', rev + 1 FROM state_revision WHERE id = 1 ON CONFLICT (collection) DO UPDATE SET rev = excluded.rev;`,
    `UPDATE state_revision SET rev = rev + 1, updated_at = ${q(nowIso)} WHERE id = 1;`
  ].join('\n');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sigmacar-admin-')), 'admin.sql');
  fs.writeFileSync(file, sql, { mode: 0o600 });
  try {
    wrangler(a, ['d1', 'execute', 'DB', '--file', file, '--yes']);
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
  const check = wrangler(a, ['d1', 'execute', 'DB', '--json', '--command',
    `SELECT doc_key, json_extract(doc, '$.role') AS role FROM state_documents WHERE collection = 'users' AND lower(json_extract(doc, '$.email')) = ${q(user.email)}`]);
  const rows = JSON.parse(check.slice(check.indexOf('[')))[0].results;
  if (rows.length !== 1 || rows[0].role !== 'admin') throw new Error(`Verification failed: ${JSON.stringify(rows)}`);
  if (rows[0].doc_key !== user.id) {
    console.log(`An account with ${user.email} already existed (${rows[0].doc_key}); nothing was changed.`);
  } else {
    console.log(`Admin ${user.email} created (${user.id}). Running Workers pick it up on their next request.`);
  }
}

main().catch((err) => {
  console.error(`create-admin: ${err.message}`);
  process.exitCode = 1;
});
