-- SIGMA CAR — D1 schema v1: state store for the storage engine (see docs/CLOUDFLARE_D1_MIGRATION_PLAN.md §3–4)
-- Applied with: wrangler d1 migrations apply DB -c wrangler.api.toml [--local | --env staging --remote]
-- Wrangler records applied files in its own d1_migrations table. Every statement is idempotent (IF NOT EXISTS / OR IGNORE).

-- One row per record of every collection (collections created at runtime need no migration).
CREATE TABLE IF NOT EXISTS state_documents (
  collection  TEXT NOT NULL CHECK (length(collection) BETWEEN 1 AND 64),
  doc_key     TEXT NOT NULL CHECK (length(doc_key) BETWEEN 1 AND 600),
  pos         REAL NOT NULL,
  doc         TEXT NOT NULL CHECK (json_valid(doc)),
  updated_at  TEXT NOT NULL,
  record_id   TEXT GENERATED ALWAYS AS (json_extract(doc, '$.id')) VIRTUAL,
  PRIMARY KEY (collection, doc_key)
);

CREATE INDEX IF NOT EXISTS idx_state_documents_order ON state_documents (collection, pos);

-- Integrity backstops for rules the application already enforces (the application check runs first).
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email
  ON state_documents (lower(json_extract(doc, '$.email'))) WHERE collection = 'users';
CREATE UNIQUE INDEX IF NOT EXISTS ux_carts_user
  ON state_documents (json_extract(doc, '$.userId')) WHERE collection = 'carts';
CREATE UNIQUE INDEX IF NOT EXISTS ux_webhook_events_event
  ON state_documents (json_extract(doc, '$.eventId')) WHERE collection = 'webhookEvents';

-- Reporting / verification lookups.
CREATE INDEX IF NOT EXISTS ix_orders_user ON state_documents (json_extract(doc, '$.userId')) WHERE collection = 'orders';
CREATE INDEX IF NOT EXISTS ix_orders_vehicle ON state_documents (json_extract(doc, '$.vehicleId')) WHERE collection = 'orders';
CREATE INDEX IF NOT EXISTS ix_payment_intents_order ON state_documents (json_extract(doc, '$.orderId')) WHERE collection = 'paymentIntents';
CREATE INDEX IF NOT EXISTS ix_branch_inventory_vehicle ON state_documents (json_extract(doc, '$.vehicleId')) WHERE collection = 'branchInventory';

-- Non-array top-level values of the state (today: "meta").
CREATE TABLE IF NOT EXISTS state_meta (
  key         TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 64),
  value       TEXT NOT NULL CHECK (json_valid(value)),
  updated_at  TEXT NOT NULL
);

-- Global optimistic lock. A commit sets rev = base + 1 as its first statement; if another isolate committed first,
-- the trigger aborts and D1 rolls back the whole batch.
CREATE TABLE IF NOT EXISTS state_revision (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  rev         INTEGER NOT NULL,
  updated_at  TEXT NOT NULL
);
INSERT OR IGNORE INTO state_revision (id, rev, updated_at) VALUES (1, 0, '1970-01-01T00:00:00.000Z');

CREATE TRIGGER IF NOT EXISTS state_revision_guard
BEFORE UPDATE OF rev ON state_revision
WHEN NEW.rev <> OLD.rev + 1
BEGIN
  SELECT RAISE(ABORT, 'SIGMA_REVISION_CONFLICT');
END;

-- Revision at which each collection last changed (lets isolates reload only what changed).
CREATE TABLE IF NOT EXISTS state_collection_revision (
  collection  TEXT PRIMARY KEY,
  rev         INTEGER NOT NULL
);

-- Private media bytes (replaces data/runtime_media/ on Workers). Base64 text chunks of <= 512 KiB raw.
CREATE TABLE IF NOT EXISTS media_blobs (
  storage_key TEXT NOT NULL CHECK (length(storage_key) BETWEEN 1 AND 255),
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  data_b64    TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (storage_key, chunk_index)
);

-- JSON → D1 data imports (scripts/d1/json-to-d1.js).
CREATE TABLE IF NOT EXISTS data_migrations (
  id             TEXT PRIMARY KEY,
  source_sha256  TEXT NOT NULL,
  mode           TEXT NOT NULL,
  applied_at     TEXT NOT NULL,
  summary        TEXT NOT NULL CHECK (json_valid(summary))
);
