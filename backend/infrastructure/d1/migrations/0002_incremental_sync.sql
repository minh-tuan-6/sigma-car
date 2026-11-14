-- SIGMA CAR — D1 schema v2: incremental sync (docs/CLOUDFLARE_FREE_PLAN.md).
-- Every written row carries the global revision of the commit that wrote it, and deletions are recorded, so an isolate
-- that is behind reads ONLY the rows changed since its revision (indexed) instead of whole collections. This keeps CPU
-- and D1 "rows read" proportional to changes — important on the Workers/D1 Free plans.
-- Rows that existed before this migration get rev 0; isolates loaded them already (full load on isolate start).
ALTER TABLE state_documents ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_state_documents_rev ON state_documents (rev);

CREATE TABLE IF NOT EXISTS state_deletions (
  collection  TEXT NOT NULL,
  doc_key     TEXT NOT NULL,
  rev         INTEGER NOT NULL,
  PRIMARY KEY (collection, doc_key)
);
CREATE INDEX IF NOT EXISTS idx_state_deletions_rev ON state_deletions (rev);
