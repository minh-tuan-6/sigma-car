# SIGMA CAR — Cloudflare Workers Compatibility Matrix

How each runtime dependency of the backend behaves on Cloudflare Workers, and what the migration does about it.

**How this was established**

- Cloudflare documentation, read 2026-11-14:
  - Node.js compatibility: <https://developers.cloudflare.com/workers/runtime-apis/nodejs/>
  - `node:crypto`: <https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/>
  - `process`: <https://developers.cloudflare.com/workers/runtime-apis/nodejs/process/>
  - Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>
  - D1 limits: <https://developers.cloudflare.com/d1/platform/limits/>
  - D1 Worker API: <https://developers.cloudflare.com/d1/worker-api/d1-database/>
  - Pages Functions bindings: <https://developers.cloudflare.com/pages/functions/bindings/>
- **Measured in `workerd`, the open-source Workers runtime**, run locally by Wrangler 4.154.0 with
  `compatibility_date = "2026-10-01"` and `compatibility_flags = ["nodejs_compat"]`.
- Rows marked *(workerd)* were checked by running code. Local `workerd` is the same runtime as production but not
  the same hardware or network, so production numbers can differ.

## 1. Platform facts the design depends on

| Fact | Value | Source |
|---|---|---|
| CPU time per HTTP request | Free 10 ms, Paid 30 s default (max 5 min) | Workers limits |
| Memory per isolate | 128 MB | Workers limits |
| Worker size | 64 MiB uncompressed, no compressed limit | Workers limits |
| Subrequests per request | Free 50, Paid 10,000 | Workers limits |
| D1 database size | Free 500 MB, Paid 10 GB | D1 limits |
| D1 row / string / BLOB size | 2,000,000 bytes | D1 limits |
| D1 SQL statement length | 100,000 bytes | D1 limits |
| D1 bound parameters per query | 100 | D1 limits |
| D1 queries per Worker invocation | Free 50, Paid 1,000; a `batch()` counts as one | D1 limits |
| D1 query/batch duration | 30 s | D1 limits |
| D1 `batch()` | "Batched statements are SQL transactions … If a statement in the sequence fails … it aborts or rolls back the entire sequence." No interactive `BEGIN`/`COMMIT` from a Worker. | D1 Worker API |
| `process.env` | populated from vars and secrets when `nodejs_compat` is on and the date is ≥ 2025-04-01. *(workerd: also populated at module top level, before the first request)* | process docs + probe |
| Pages Function → Worker | Service binding, `context.env.<NAME>.fetch(request)`; configured in the Pages project (dashboard or Wrangler config); `wrangler pages dev --service NAME=script` locally | Pages bindings |

## 2. Dependency matrix

Classification: **F** fully compatible · **C** compatible with configuration · **A** compatible with a small
adapter · **R** requires architectural replacement · **U** unsupported/blocked · **I** needs further investigation.

| Dependency | Where | Class | Reason | Solution | Risk | Behaviour after migration |
|---|---|---|---|---|---|---|
| `node:crypto` (`scrypt`, `createHmac`, `createHash`, `randomBytes`, `randomUUID`, `timingSafeEqual`) | 32 files; `security.js:14–48` | **C** | Supported with `nodejs_compat` (only argon2, randomUUIDv7, DSA/DH keygen, ed448/x448 are not). *(workerd: `scryptSync('Admin@123456', seed salt)` returns the same 64 bytes as Node)* | `nodejs_compat` | Low | Identical hashes and tokens; existing password hashes and JWTs remain valid with the same `JWT_SECRET`. |
| scrypt CPU cost | `security.js:21,39` | **C** (plan) | *(workerd, local machine)* 31–45 ms per hash vs a 10 ms Free-plan CPU budget. Node on the same machine: ≈ 54 ms. | Free plan: depends on per-isolate tolerance, verify on Cloudflare (`CLOUDFLARE_FREE_PLAN.md`); Paid: no issue. Lowering N would invalidate stored hashes and weaken security — not done. | High on Free | Hashing endpoints may hit error 1102 on Free if overruns are frequent; everything else is unaffected. |
| `Buffer` | middleware, media, security | **C** | Supported (`nodejs_compat`). *(workerd)* | — | Low | Identical. |
| `node:url` `url.parse(…, true)` | `router.js:51` | **C** | Supported. *(workerd: same query object)* | — | Low | Identical. |
| `process.env` at module load | `config/index.js`, `payment-gateway.js:6`, `ai-service.js` | **C** | *(workerd: populated at top level)* | Vars + secrets in Wrangler config; the Worker entry also copies bindings into `process.env` before loading the backend (defensive) | Low | Same configuration model. |
| `process.uptime()` | `router.js:64` (health) | **C** | Exists; the Workers clock does not advance during execution, so it reports `0`. *(workerd)* | Accepted | Low | `/health` `uptimeSeconds` is `0` (informational field). |
| `process.pid` | `storage-engine.js:190` (tmp file name) | **F** | Returns `1`; the code path is not used with D1. | — | — | — |
| `node:fs` + `path` — JSON database file | `storage-engine.js:131–206` | **R** | Workers `fs` is a per-request virtual file system (`/tmp` writable but not persistent, *workerd*); data would vanish. | **D1 state store driver** (plan §3); the file path stays for Node. | High | Same in-memory model, persisted to D1 atomically. |
| `node:fs` — `.env` loader | `config/index.js:9` | **F** | `existsSync` returns false. *(workerd)* | — | — | Env comes from bindings. |
| `node:fs` — AR data sources | `ar-manifest-service.js:38,165` | **A** | Repository files are not on the Worker's file system. | Inject the three JSON sources (bundled at build time) and a file-existence check that matches what Pages actually serves. | Medium (AR protected) | Same manifest as the static snapshot that `npm run build` emits for Pages. |
| `node:fs` — media blobs | `media-storage.js:122–152` | **R** | No persistent disk; R2 must not become mandatory. | **D1 blob driver**: `media_blobs` table, files split into 512 KiB chunks (row limit 2 MB). | Medium | Same 5 MB limit, same sniffing/quarantine; bytes in D1 instead of `data/runtime_media/`. |
| `node:http` server | `server.js` | **R** | Workers have a `fetch` handler, not a listening server. | Worker entry + **Node `req`/`res` shim** so `router.js` runs unchanged. | Medium | Same status codes, headers and bodies (compared in tests). |
| `req.on('data'/'end')`, `req.socket.remoteAddress`, `res.writeHead/setHeader/end` | `middleware.js:126–211`, `router.js` | **A** | Node stream objects. | Shim built on `node:events`/`node:stream` (supported). Client IP from `CF-Connecting-IP` set by the Pages Function. | Medium | Identical parsing limits and error codes. |
| CORS / security headers from `server.js` | `server.js:47–62` | **A** | Lived in `server.js`. | Moved to `backend/api/http-common.js`, used by both `server.js` and the Worker. | Low | Identical headers. |
| `node:net` / `node:tls` SMTP | `email-provider.js:4–100` | **I** | `net` listed as supported, `tls` as partially supported; STARTTLS upgrade not verified. | Use `EMAIL_WEBHOOK_URL` (fetch) on Workers; default sandbox queue unchanged. | Medium | Webhook and sandbox modes identical; live SMTP unverified. |
| `fetch` (LLM, charging data, email webhook) | `ai-service.js`, `ai-tools.js`, `email-provider.js` | **F** | Native in Workers. | — | Low | Identical; counts towards the subrequest limit. |
| `AbortController`, `AbortSignal.timeout`, `setTimeout` | several | **F** | Supported. | — | Low | Identical. |
| `@google/genai` (npm) | `ai-service.js:6` | **C** | Bundles with Wrangler/esbuild *(workerd: bundle builds, 2.3 MB uncompressed for the whole backend)*; runtime call not tested without an API key. REST fallback uses `fetch`. | — | Low | Same; with no key the local fallback answers (as today). |
| In-memory AI knowledge base and `meta.aiConfig` | `ai-service.js:30–60` | **A** | Built from `dbState` at module load, before the Worker has loaded D1. | Re-sync from state after each D1 load that changes `vehicles` or `meta`. | Low | Same answers; every isolate converges on the stored config. |
| In-memory rate limiter `Map` | `security.js:8,150` | **C** | Works, but per isolate instead of per process. | Unchanged code; optional `API_RATE_LIMITER` Rate Limiting binding (cross-isolate, counted per Cloudflare location). | Medium | Same 429 contract; limits approximate across isolates. |
| Process mutex `acquireLock` | `storage-engine.js:104` | **F** | Works inside one isolate (`setTimeout` polling). Cross-isolate safety comes from the D1 revision guard. | — | Low | Serialisable writes. |
| `node:sqlite` | `database.js:22` | **U** (not needed) | Not available in Workers; only used by `scripts/migrate-json-to-sql.js` and tests. Required lazily, so not bundled. | Not on the request path. | — | — |
| Native addons, `child_process`, `worker_threads` | — | — | Not used. | — | — | — |
| Timers / background jobs | — | **F** | No timers exist; jobs run via admin endpoints. | Optional Cron Triggers documented, not enabled (would change behaviour). | — | Identical. |

## 3. Bundle check

`wrangler deploy --dry-run` of an entry that requires `backend/api/router.js` (whole backend + `@google/genai` +
`js/data.js`) succeeded with no unresolved modules: **2,307 KiB, 363 KiB gzip**, against the 64 MiB limit.
