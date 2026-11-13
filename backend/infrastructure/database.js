// backend/infrastructure/database.js
// Unified Persistence & SQL Migration Runner Adapter (PostgreSQL-compatible DDL / built-in node:sqlite)

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(file => ({
      name: file,
      path: path.join(MIGRATIONS_DIR, file),
      sql: fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    }));
}

function openSqliteDatabase(targetPath = ':memory:') {
  const { DatabaseSync } = require('node:sqlite');
  if (targetPath !== ':memory:') {
    const dir = path.dirname(path.resolve(targetPath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  const db = new DatabaseSync(targetPath);
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

function applyMigrationsToSqlite(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const files = getMigrationFiles();
  const applied = [];
  const checkStmt = db.prepare('SELECT name FROM schema_migrations WHERE name = ?');
  const markStmt = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');

  for (const mig of files) {
    const already = checkStmt.get(mig.name);
    if (!already) {
      db.exec(mig.sql);
      markStmt.run(mig.name, new Date().toISOString());
      applied.push(mig.name);
    }
  }

  return { totalFiles: files.length, newlyApplied: applied };
}

module.exports = {
  MIGRATIONS_DIR,
  getMigrationFiles,
  openSqliteDatabase,
  applyMigrationsToSqlite
};
