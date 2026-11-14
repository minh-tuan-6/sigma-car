# SIGMA CAR — Cloudflare Workers + D1 Migration: Test Report

Executed on 2026-11-14 on Windows 11 with:

- Node v23.11.0;
- Wrangler 4.154.0 with `workerd` (the Workers runtime) and Miniflare D1;
- Chrome through playwright-core 1.49.1.

Everything ran **locally**. Nothing was deployed, and no remote D1 database was created. Baseline (before any
change): `WORKERS_MIGRATION_BASELINE.md`.

## 1. Summary

| Command | Runtime under test | Result |
|---|---|---|
| `npm test` | Node (unchanged backend) + new unit tests | **267 / 267 pass** (baseline 209 + 58 new). Pre-existing flake: `SIG-P1-001` failed in 2 of 10 runs here and in 4 of 10 runs on the untouched baseline commit (parallel test processes write the same repo store file) |
| `npm run test:worker-runtime` | the existing integration + security suites with `/api/v1` served by `backend/cloudflare/runtime.js` and D1 persistence (D1StateStore on a `node:sqlite` D1 shim) | **80 pass, 0 fail, 1 skipped** (JSON-disk ENOSPC test; its D1 equivalent passes) |
| `npm run test:workers` | **workerd + local D1** — Node vs Worker contract comparison, cross-runtime tokens, D1 persistence, concurrency, production-like rollback drill | **7 / 7 pass** |
| `npm run build` | Pages bundle | OK (unchanged: 24 AR snapshots, 13 USDZ files in `dist/`, 45 > 25 MiB kept out) |
| `npm run test:e2e` | browser suite, Node backend (previous architecture) | **19 / 19 pass** (unchanged frontend and AR) |
| `node tests/workers/e2e-pages-worker.js` | browser suite through `wrangler pages dev` → `SIGMA_API` binding → Worker → D1 | every step that can pass on Pages passed through the Worker path (§6); the VF9 pre-built step cannot pass on Pages by design |
| Legacy AR scripts (`tests/test_*.js`) | — | 7/7, 6/6, 10/10, 8/8, 12/12 (as baseline); `migrate-json-to-sql.js --dry-run` OK |
| `wrangler deploy --dry-run` (default, `--env production`) | bundle | OK: 2,440 KiB / 386 KiB gzip; bindings `DB`, vars as configured |

## 2. New automated tests

| File | Tests | What it proves |
|---|---|---|
| `tests/unit/d1_state_store.test.js` | 29 | Covers: the schema, the conflict trigger and the unique backstops; an exact round trip of the whole state (values, nesting, order, `meta`); minimal writes (unshift/push/splice touch only the changed rows); records without ids or with duplicate ids. It also covers: the optimistic lock (the loser writes nothing); a transaction re-run after a lost race with no lost update (promo counter +2); 25 concurrent transactions in one isolate (+25); rollback on action errors; `503 STORAGE_UNAVAILABLE` on D1 failures without leaking SQL; a clear `STORAGE_NOT_MIGRATED`; `409 DUPLICATE_RECORD`; injection-proof ids and values; flushing of writes made outside a transaction; dev seeding versus an empty production start; runtime-created collections; and 5 MB media in 512 KiB chunks. |
| `tests/unit/worker_runtime.test.js` | 12 | The Worker handler: `503 STORAGE_NOT_CONFIGURED`; JSON 404 outside `/api/v1`; dev seed and `storageMode: d1`; the same CORS and security headers as `server.js` plus OPTIONS 204; body limits (`BAD_JSON`, 413); the Rate Limiting binding returning 429; recovery after a D1 failure; register/login/cart rows in D1 (scrypt format unchanged); media bytes in `media_blobs` and not on disk; the AR manifest **identical** to the Pages static snapshot; the request/response shim. |
| `tests/unit/worker_runtime_config.test.js` | 1 | A production Worker without `JWT_SECRET` returns `503 CONFIG_ERROR`; the reason is logged and not returned. |
| `tests/unit/pages_service_binding.test.js` | 6 | The Pages Function prefers the binding over the HTTP origin; strips client secrets and forwarding headers; forwards method and body; keeps the HTML guard, the 413 body limit and non-API rejection; returns 502/504 on a failing or hanging Worker; falls back to `SIGMA_BACKEND_ORIGIN`. |
| `tests/unit/d1_migration_tool.test.js` | 10 | The source stays read-only and normalisation is deterministic; corrupt sources are refused; validation errors and warnings; catalog-only and demo detection; the import is complete and matches its metrics; idempotent re-runs that never overwrite; the revision bump lets the Worker load the import; SQL escaping; tamper detection. |
| `tests/workers/contract.workers.js` | 4 | See §3. |
| `tests/workers/rollback-drill.workers.js` | 3 | See §5. |

## 3. Node vs Worker contract comparison (workerd + local D1)

`tests/workers/contract.workers.js` starts both backends:

- **Node:** `node server.js` with a JSON store.
- **Worker:** `wrangler dev -c wrangler.api.toml`, on a D1 database filled by `json-to-d1.js` from the **same seed
  file**, with the **same `JWT_SECRET`**.

It then runs one scripted sequence of 85 requests against both. For every step it compares:

- the status code;
- 11 contract headers (content type, cache, nosniff, frame, CORS ×3, permissions, referrer, disposition, vary);
- the presence and format of `X-Request-Id`;
- the JSON body field by field.

Timestamps, JWTs and UUIDs are masked. Server-generated random identifiers must have the same shape. CSV and binary
bodies are compared as well.

The sequence covers:

- the public catalog: list, filters, pagination, search, certified, detail, related, 404;
- AR manifests: Cybertruck, Ferrari, VF9, 404;
- inventory, financing, promotions, policies, service centres, accessories, bundles, TCO, CMS, slots, workshop, reviews;
- protocol errors: unknown route, bad JSON, preflight, missing or garbage token;
- login for 3 roles, wrong password, RBAC 403, register (with a forged `role: admin`), duplicate register, profile, saved car;
- cart add (vehicle and accessory), valid and invalid promo, version conflict 409, quote;
- checkout, idempotent replay, idempotency-key mismatch 409;
- payment intent, webhook with a bad signature 401, settled webhook, replayed webhook (deduped), payment history;
- order list, detail and timeline, another buyer 403, seller confirms, buyer blocked;
- test-drive booking and double booking;
- notifications, analytics event, support ticket;
- configuration save, list and delete; AI chat (local fallback);
- media upload (700 KB), download, another user 403, spoofed type 422;
- admin users, analytics overview, CSV export, seller customers, LLM config;
- password change → old token 401; logout → token 401.

**Result: 83 / 85 identical. The 2 differences are intended and documented:**

| Step | Node | Worker | Why |
|---|---|---|---|
| `GET /health` | `storageMode: "json"` | `storageMode: "d1"` (and `uptimeSeconds` 0, masked) | informational field; the Workers clock does not advance during a request |
| `GET /vehicles/vinfast-vf9/ar-manifest` | lists its 4 local USDZ files (89–94 MB) | lists none → the page converts on the device | Pages cannot host files > 25 MiB (`build_dist.js` leaves them out). The Worker returns exactly the static snapshot `dist/data/ar/vinfast-vf9.json`; with `SIGMACAR_USDZ_PUBLIC_BASE_URL` set, both list the external URLs. On Pages, the Node path would list URLs that 404. |

Other checks in the same run:

- **Sessions:** a token issued by Node is accepted by the Worker (`/auth/me` 200), so existing sessions stay valid.
- **D1 persistence:** after the sequence, the D1 rows hold the new user, the order (`Deposit_Paid`, `Confirmed`) and
  2 media chunks (716,808 bytes).
- **Concurrency in workerd:** 12 parallel registrations of one e-mail gave exactly 1 × 201 and 11 × 409, with 1 row in
  D1. 30 parallel analytics events gave 30 × 202 and 30 rows: no lost writes.

## 4. Existing suites through the Worker runtime

`npm run test:worker-runtime` runs `tests/integration/*` and `tests/security/*` unchanged. Every `/api/v1` request
goes through `runtime.handle()` → shim → `router.js` → D1 driver (SQLite shim with D1 batch semantics). Services the
tests call directly also persist through the D1 driver.

The first run had 69 / 81 passing. Each failure was investigated:

| Cause | Fix |
|---|---|
| **Bug:** positional row keys began with `\u0000`; SQLite `length()` stops at NUL, so the `doc_key` CHECK failed for records without an id (`aiPreferences`, `partsLedger`). 5 tests. | Separator changed to `\u001f`; regression test added. |
| Harness: the Node harness inherits the boot normalisation (branch inventory, promotions) from the file it loads at module load; the Worker harness did not. 2 tests. | Worker harness applies `ensureExtendedCollections()`, as an isolate does when it loads D1. |
| Harness: `SIGMACAR_LAZY_INIT`, set by the runtime, leaked into a child `server.js` that a suite spawns. 1 test. | The harness restores the variable. |
| Intended AR difference (§3). 1 test. | The test asserts the Pages-correct manifest in Worker mode; the Node assertion is unchanged. |
| JSON-file ENOSPC test (disk semantics). 1 test. | Skipped in Worker mode with a reason; its D1 equivalent is in `d1_state_store.test.js`. |

Final: **80 / 81 pass, 1 skipped with reason, 0 fail**.

## 5. Production-like Worker and rollback drill

`tests/workers/rollback-drill.workers.js` runs, in `workerd`:

1. A local D1 prepared like production: `--catalog-only --exclude-demo-accounts`, plus `create-admin.js`.
2. The Worker with `NODE_ENV=production` and dev seeding off.
3. Writes through the Worker.
4. D1 → JSON export.
5. `node server.js` in production mode on that file.

Result: **3 / 3 pass**:
- the demo admin login is refused (401);
- the catalog serves 24 vehicles;
- the bootstrap admin logs in;
- register → cart → checkout through the Worker work;
- after the export, Node accepts the Worker-issued token;
- Node lists the order;
- the admin user list is identical;
- the password hashed by the Worker verifies on Node.

## 6. Browser E2E

| Run | Result |
|---|---|
| `npm run test:e2e` — previous architecture (`server.js`), unchanged frontend | **19 / 19** |
| Pages + binding + Worker, full suite (`node tests/workers/e2e-pages-worker.js`), 3 runs | 9, 15 and 11 / 19 |
| Same stack, steps 11–19 in a fresh browser (`E2E_ONLY=…`) | **9 / 9**, 1–4 s per step |
| **Control:** the same `wrangler pages dev` with the *previous* Node backend behind the HTTP proxy (`--node-backend`) | 16 / 19, with the same kind of failures |

Through Pages → `SIGMA_API` → Worker → D1, every step passed in at least one run except one:

- steps 1–8: detail page, desktop, layout, colour bar, close, paint tint, iPhone pre-built, iPhone on-device;
- VF9 converted on the device in full;
- steps 11–19: external USDZ, iPad, in-app browser, Android, model errors, 3D showroom, legacy links, regression,
  no uncaught page errors.

The exception is **"VF9 pre-built file is served"**. It fails on any Pages deployment, with either backend, because
the 90 MB file is not in `dist/` (Pages limit, documented in the AR report). The page then converts on the device,
and that path passes.

**Why the full suite is unstable on this machine.** The full-suite failures are navigation timeouts that start after
the 94 MB on-device conversion step. Pages took 13–80 s each, against 1–4 s in a fresh browser. In one run the
browser closed. The control run shows the same pattern with the old backend, and the API itself answers in 11–22 ms
through the binding (probe below). So the cause is browser memory and CPU on this machine combined with
`wrangler pages dev`, not the Worker.

Probe of the local stack (`--probe`): Pages → binding → Worker → D1 health 14–18 ms; vehicle list (125 KB) 17–22 ms;
AR manifest 11–12 ms; 1.9 MB GLB 30–53 ms; 8 parallel GLB downloads 164 ms.

### Performance notes (Node, idle machine)

The state store's per-write overhead is the diff of the in-memory state:

- **today's data (177 KB):** 0.7 ms per write; the existing rollback snapshot 0.7 ms;
- **4 MB (20k analytics events + 5k audit logs added):** 21 ms per write. An `unshift` still writes 1 row.

Measured in `workerd` on this machine, scrypt costs 31–45 ms per hash: the only part of the API over the Workers Free
10 ms budget (see `CLOUDFLARE_FREE_PLAN.md`).

## 7. Not verified (needs Cloudflare credentials, approval or devices)

| Item | Status |
|---|---|
| Real Cloudflare network: D1 latency, Pages → Worker binding in production, multi-location isolates | **unverified**; local `workerd` + Miniflare only |
| Behaviour under real multi-isolate write contention | **unverified** remotely; revision guard tested with simulated isolates and in a single workerd process |
| CPU time per request on Cloudflare (the Free 10 ms limit) | local `workerd` measurement only: scrypt 31–45 ms per hash; every other endpoint ≈ 1–5 ms (estimate). Free-plan analysis: `CLOUDFLARE_FREE_PLAN.md` |
| SMTP e-mail from Workers (`node:net`/`node:tls`) | **unverified**; use `EMAIL_WEBHOOK_URL` |
| `@google/genai` / Groq / OpenAI calls from Workers | **unverified** (no API keys used); local fallback verified |
| AR Quick Look on a physical iPhone/iPad | **unverified** (unchanged from the AR report) |
| Staging deployment | **not performed** (no credentials, no authorization) |

Staging checklist, to run once deployed (`CLOUDFLARE_WORKERS_DEPLOYMENT.md` §6):

1. `/api/v1/health` gives `storageMode: d1` and the header `X-Sigma-Proxy: 1`.
2. Log in as the bootstrap admin.
3. Register a buyer → cart → checkout → admin sandbox payment simulation (`POST /payments/sandbox/simulate`) →
   order `Deposit_Paid`.
4. Upload media, then download it.
5. On the AR page, the manifest is served for 3 vehicles.
6. `npx.cmd wrangler tail sigmacar-api-staging` shows no errors for the run.
7. `node scripts/d1/json-to-d1.js --verify --env staging` (catalog part unchanged).

## 8. Free-plan round (2026-11-14, after `CLOUDFLARE_FREE_PLAN.md` changes)

| Command | Result |
|---|---|
| `npm test` (incl. `tests/unit/workers_free_plan.test.js`, 11 tests, and 2 new incremental-sync tests) | **280 / 280 pass** |
| `npm run test:worker-runtime` | 80 pass, 1 skipped (reason as before), 0 fail |
| `npm run test:workers` (workerd: contract 83/85 identical + 2 documented, cross-runtime tokens, D1 rows, concurrency, rollback drill) | **7 / 7 pass** |
| `npm run test:e2e` (unchanged frontend/AR) | **19 / 19** |
| `npm run build`, legacy AR scripts, `wrangler deploy --env production --dry-run` | OK; 7/7, 6/6, 10/10, 8/8, 12/12; 2,443 KiB / 386 KiB gzip |
| `wrangler dev` in `workerd`, development (no `JWT_SECRET`) and production mode | startup OK, health and login OK, no global-scope errors |

**Regression caught in this round.** The first version of the startup preload failed in `workerd` ("Disallowed
operation called within global scope") because two modules created random values at load time. The fix makes those
values lazy; details in `CLOUDFLARE_FREE_PLAN.md` §4. Only the `workerd` suite (`npm run test:workers`) detects this
class of error; the Node suites cannot.

Not done in this round: the Pages + binding browser E2E. The frontend, AR and Pages Function did not change since
§6, and the Worker changes are covered by the `workerd` contract test and the rollback drill.
