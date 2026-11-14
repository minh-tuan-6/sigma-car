# SIGMA CAR — Cloudflare Workers + D1 Migration Plan

Input: `CLOUDFLARE_WORKERS_AUDIT.md` (what exists) and `CLOUDFLARE_WORKERS_COMPATIBILITY.md` (what runs on Workers).
This document fixes the design, the D1 schema, the data migration, the stages, the tests and the rollback.

## 1. Goals and non-goals

- Same `/api/v1/*` contract, same business behaviour, same data, same frontend and AR files.
- No Node host, no always-on PC, no mandatory R2.
- The Node backend keeps working unchanged (JSON file) and stays the rollback target.
- Non-goals: rewriting services, changing response formats, changing password hashing, enabling live payments,
  adding cron jobs.

## 2. Target architecture

```text
Browser ──same origin /api/v1/*──▶ Pages Function functions/api/v1/[[path]].js
                                     │ env.SIGMA_API (service binding) present?
                                     ├─ yes → env.SIGMA_API.fetch(…)   ← no public hop, no extra DNS name
                                     └─ no  → SIGMA_BACKEND_ORIGIN proxy (current behaviour, unchanged)
                                                     │
                                                     ▼
                         Worker "sigmacar-api"  (wrangler.api.toml, main = backend/cloudflare/worker.mjs)
                           workers_dev = false, no routes → reachable only through the binding
                           ├─ http-common.js   CORS + security headers (shared with server.js)
                           ├─ node-http-shim   Request → Node-like req/res → Response
                           ├─ router.js and all services UNCHANGED
                           ├─ storage-engine.js with the D1 state-store driver
                           ├─ media-storage.js with the D1 blob driver
                           └─ ar-manifest-service.js with bundled sources
                                                     │ binding DB
                                                     ▼
                                              Cloudflare D1
```

### Routing options evaluated

| Option | Verdict |
|---|---|
| **Service binding from the existing Pages Function** | **Chosen.** Same origin, same proxy code path (header sanitising, timeout, HTML guard, body limit), no public Worker URL, documented for Pages Functions. One small change to the function: use the binding when it exists. |
| Worker route `example.com/api/v1/*` on the zone | Would bypass the Pages Function; needs a custom domain on a zone; two handlers for the same path during cutover. Rejected. |
| Pages Function → public `*.workers.dev` URL via `SIGMA_BACKEND_ORIGIN` | Works with zero code change, but adds a public hop and exposes the Worker. Kept only as the existing fallback. |
| Move the backend into Pages Functions | Mixes the backend into the Pages build, harder rollback. Rejected. |

## 3. Persistence design

### 3.1 Options evaluated

| Option | Behaviour preserved? | Verdict |
|---|---|---|
| A. Relational rewrite: one SQL table per entity, repositories issue queries | Every one of the 97 transactions and every in-memory read would be rewritten (≈ 24k lines). Invariants of §5.2 of the audit would have to be re-proved one by one. The existing M1–M7 SQL is lossy. | Rejected: changes behaviour in ways that cannot be fully verified. |
| B. Durable Object as the single writer + D1 | Strong serialisation, but adds a second storage product and a second hop. | Not needed: the revision guard below gives the same guarantee with D1 alone. |
| **C. D1 state store** — the engine's in-memory model persisted to D1 rows; each transaction commits its diff in one atomic `batch()` guarded by a global revision | Services, repositories and transaction callbacks are unchanged. Same serialisable all-or-nothing semantics across isolates. | **Chosen.** |

### 3.2 How C works

- **Rows.** Each record of each collection is one row `(collection, doc_key, pos, doc)`. `doc_key` is the
  record `id` (60 collections, all records have string ids). `pos` (REAL) keeps array order. Non-array top-level
  values (`meta`) live in `state_meta`. Collections created at runtime need no migration.
- **Load.** One `batch()` reads the global revision, the per-collection revisions and the rows of the collections
  that changed since the isolate last loaded them (all of them on the first request). A batch is a transaction,
  so the snapshot is consistent.
- **Request start.** One query (`SELECT rev`); reload only if another isolate committed.
- **`runInTransaction(action)`.**
  1. Take the isolate lock (existing mutex).
  2. Refresh from D1 (as above).
  3. JSON snapshot (existing).
  4. Run the unchanged callback.
  5. Diff the state against what was loaded/committed. Only changed rows are written.
  6. Commit with one `batch()`: the first statement is `UPDATE state_revision SET rev = base + 1`. A trigger
     raises `SIGMA_REVISION_CONFLICT` when `rev` is no longer `base`. Then the upserts, deletes, `state_meta` and
     the per-collection revisions.
  7. On conflict: roll back to the snapshot, refresh, and run the callback again (max 5 attempts). This is safe
     because no callback does network I/O (audit §5.2).
  8. On any other D1 error: roll back and return `503 STORAGE_UNAVAILABLE`.
- **Writes outside a transaction.** Node persists them at the next save. The Worker flushes any remaining diff at
  the end of each request, with the same guard.
- **Order.** New rows get positions between their neighbours (`unshift` → `first − 1`, `push` → `last + 1`,
  middle → midpoint), so prepending to a log writes one row, not the whole collection. If existing rows are
  reordered, the collection is renumbered.
- **Boot normalisation.** `ensureExtendedCollections()` runs after the first full load in an isolate, as Node
  runs it at boot. The data import stores the normalised state, so it is normally a no-op.
- **Empty database.** Non-production with dev seeding enabled → the dev seed is committed (same as Node creating
  the file). Production → empty state, nothing written (Node writes an empty file).
- **AI.** After a load that changes `vehicles` or `meta`, the AI knowledge base and stored provider config are
  re-synced (Node builds them at boot).

### 3.3 Failure behaviour

| Event | Result |
|---|---|
| Two isolates commit at once | One wins; the other re-runs its callback on fresh state. No lost update, no duplicate. |
| Callback throws | State rolled back, nothing written (same as Node). |
| D1 unreachable or batch fails | State rolled back, `503 STORAGE_UNAVAILABLE` with a fixed message; D1 internals are not leaked. |
| Five conflicts in a row | `503 STORAGE_BUSY` (Node: `lock timeout` error after 5 s). |
| `DB` binding missing | Every request `503 STORAGE_NOT_CONFIGURED`; nothing else runs. |
| Missing/weak `JWT_SECRET` in production | Every request `503 CONFIG_ERROR` (Node refuses to boot). |

## 4. D1 schema

File `backend/infrastructure/d1/migrations/0001_state_store.sql`, applied with `wrangler d1 migrations apply`
(tracked by Wrangler in `d1_migrations`).

| Table | Columns | Keys / constraints | Purpose |
|---|---|---|---|
| `state_documents` | `collection TEXT`, `doc_key TEXT`, `pos REAL`, `doc TEXT`, `updated_at TEXT`, generated `record_id` = `json_extract(doc,'$.id')` | PK `(collection, doc_key)`; `CHECK (json_valid(doc))`; `CHECK (length(collection) BETWEEN 1 AND 64)` | One row per record, verbatim JSON |
| `state_meta` | `key TEXT PK`, `value TEXT` (`json_valid`), `updated_at` | — | `meta` object |
| `state_revision` | `id INTEGER PK CHECK (id = 1)`, `rev INTEGER`, `updated_at` | trigger `state_revision_guard`: `RAISE(ABORT,'SIGMA_REVISION_CONFLICT')` unless `NEW.rev = OLD.rev + 1` | Global optimistic lock |
| `state_collection_revision` | `collection TEXT PK`, `rev INTEGER` | — | Partial reloads |
| `media_blobs` | `storage_key TEXT`, `chunk_index INTEGER`, `data_b64 TEXT`, `bytes INTEGER`, `created_at` | PK `(storage_key, chunk_index)` | Media bytes in 512 KiB chunks |
| `data_migrations` | `id TEXT PK`, `source_sha256`, `mode`, `applied_at`, `summary` (JSON) | — | Data import tracking |

Indexes:

| Index | Type | Why |
|---|---|---|
| `(collection, pos)` | regular | ordered load |
| `lower(json_extract(doc,'$.email'))` WHERE `collection='users'` | **UNIQUE** | email uniqueness |
| `json_extract(doc,'$.userId')` WHERE `collection='carts'` | **UNIQUE** | one cart per user |
| `json_extract(doc,'$.eventId')` WHERE `collection='webhookEvents'` | **UNIQUE** | webhook idempotency |
| `json_extract(doc,'$.userId')` / `orderId` / `vehicleId` | partial | SQL reporting and verification queries |

The unique indexes duplicate rules the code already enforces. The code, running under the revision guard, remains
the primary check; the indexes stop a bug from storing a duplicate. Data types: SQLite `TEXT` JSON keeps numbers,
booleans, nulls and nesting exactly as JSON does (the round trip is verified byte-for-byte in tests).

## 5. JSON → D1 data migration

Tool: `scripts/d1/json-to-d1.js`. It uses the same codec module as the runtime, so imported rows match what the
Worker writes.

| Flag | Effect |
|---|---|
| `--source <file>` | JSON store (default `data/sigmacar_store.json`). Never modified. |
| `--validate` | Parse, normalise (same as Node boot), validate. Writes nothing. |
| `--dry-run` | `--validate` + write the SQL file and the report. Executes nothing. |
| `--catalog-only` | Only catalog/reference collections (vehicles, certified vehicles, branch inventory, accessories, promotions, policies, FAQs, bundles, service centres…) and `meta`. **Default for production.** |
| `--exclude-demo-accounts` | Drop users whose hash uses the public demo salt, and refuse if other records still reference them. |
| `--execute --local` / `--execute --env staging` / `--execute --env production --confirm-production` | Apply schema migrations, then the SQL file, through Wrangler. Production also needs the explicit flag. |
| `--verify --local` / `--verify --env …` | Read D1 back and compare. |
| `--export-json <file> --local/--env …` | Rebuild a `sigmacar_store.json` from D1 (rollback path). |

Validation: arrays only; objects with string ids; duplicate ids; row size < 1.9 MB; required fields per entity
(users, vehicles, orders, payment intents, carts, inventory); referential checks (orders → users/vehicles, intents
→ orders, ledger → intents, carts → users, inventory → catalog, reviews → vehicles), reported as warnings when the
source already contains them.

Idempotency: rows are inserted with `ON CONFLICT DO NOTHING`, so a re-run never duplicates or overwrites live
data. A run is recorded in `data_migrations` (source SHA-256). An import into a non-empty database is refused
unless `--merge` is given. The revision is bumped so running isolates reload.

Verification compares per collection:

- row counts and the set of ids;
- the SHA-256 of each record's canonical JSON;
- order (`pos`);
- totals of money fields (orders, payment intents, ledger, refunds);
- password hashes and `sessionVersion`;
- referential integrity re-checked on the D1 copy.

The report is `docs/D1_DATA_MIGRATION_REPORT.md`.

## 6. Authentication and security

- Same `JWT_SECRET` as a Worker secret ⇒ existing tokens stay valid; same scrypt ⇒ existing hashes verify.
  Sessions are not invalidated.
- `PROXY_SHARED_SECRET` kept on the Worker (defence in depth; the Worker has no public route).
- `TRUST_PROXY=true` on the Worker: the client IP comes from `CF-Connecting-IP`, which the Pages Function sets.
- Secrets only via `wrangler secret put`; `wrangler.api.toml` holds no secret and no real database ID.
- Findings S1/S2 stay unchanged unless approved (audit §6).

## 7. Stages

| Stage | Content | Exit criterion |
|---|---|---|
| 1 Baseline | `WORKERS_MIGRATION_BASELINE.md` | recorded |
| 2 Abstraction | Driver hooks in `storage-engine.js` and `media-storage.js`; source injection in `ar-manifest-service.js`; `http-common.js` | full existing suite still green |
| 3 D1 | schema, codec, D1 state store, blob store, D1 test shim (node:sqlite) | unit tests: round trip, order, conflicts, rollback, injection, failures |
| 4 Worker | `worker.mjs`, shim, `wrangler.api.toml`, Pages binding | runs in `workerd` with local D1 |
| 5 Contract | same request script against Node and Worker; existing integration suites against the Worker | no unexplained difference |
| 6 E2E | browser suite through `wrangler pages dev` + service binding + Worker | AR and commerce flows pass |
| 7 Staging | deploy commands prepared; deploy only with credentials + approval | — |
| 8 Readiness | cutover checklist, rollback drill (D1 → JSON export → Node) | — |

## 8. Testing strategy

- **`npm test`** (fast, Node): existing 209 tests; new unit tests for the codec, the D1 state store (against a
  `node:sqlite` D1 shim with the same batch-is-a-transaction semantics), the blob store, the HTTP shim, the
  migration tool, the Pages binding path, and the whole Worker handler running in Node against the shim.
- **`npm run test:workers`** (real `workerd` + Miniflare D1 via Wrangler):
  - the Node-vs-Worker contract comparison;
  - the existing integration suites pointed at the Worker;
  - a concurrency test with parallel checkouts and promo usage.
- **`npm run test:e2e`** unchanged, plus the same browser flow through Pages + binding + Worker.

## 9. Rollback

Documented in `CLOUDFLARE_WORKERS_ROLLBACK.md`. In short:

- Removing the `SIGMA_API` binding from the Pages project (or setting `SIGMA_BACKEND_ORIGIN` back) returns
  traffic to the previous path.
- D1 data is exported to `sigmacar_store.json` with `--export-json` for a Node backend.
- The original JSON file and storage code are never modified or deleted.
- D1 Time Travel restores the database to any minute in the last 30 days on the Paid plan (7 days on Free).
