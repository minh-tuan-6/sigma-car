# API Fix Report

Date: 2026-11-14. Evidence for the diagnosis is in [API_AND_AR_AUDIT.md](API_AND_AR_AUDIT.md) §2.

## 1. Confirmed root cause

`https://sigma-car.pages.dev` is a **static-only** Cloudflare Pages deployment. No backend is deployed and nothing routes `/api/v1/*` anywhere, so every API GET returned the SPA `index.html` with **HTTP 200 `text/html`** (50,782 bytes) and every POST returned **405**. The frontend's "Chưa Kết nối Backend Server (Chế độ Xem Tĩnh)" banner was an accurate report of that, not the bug.

The Node backend (`server.js`, `http.createServer`, synchronous-`fs` JSON store) cannot run on Pages/Workers unchanged.

**Affected endpoints:** all of `/api/v1/*` — vehicles, certified, cart, quotes, orders, appointments, returns, warranties, reviews, support, campaigns, promotions, CMS, analytics (overview/funnel/events), inventory, registration estimate, admin users, auth.

## 2. Fix architecture

```
Browser ── same-origin /api/v1/* ──▶ Cloudflare Pages Function  functions/api/v1/[[path]].js
                                          │  fixed upstream = SIGMA_BACKEND_ORIGIN (https)
                                          │  + X-Sigma-Proxy-Secret, X-Forwarded-For
                                          ▼
                                     SIGMACAR backend (Docker: server.js + backend/, volume /data)
```

Same-origin proxying was chosen over a direct cross-origin API base because it needs no CORS, keeps bearer-token auth unchanged, and lets the existing relative `API_BASE = '/api/v1'` work as is. (A direct base is still possible: `window.SIGMACAR_API_BASE` + backend `CORS_ALLOWED_ORIGINS`.)

## 3. Changes

| Area | File | Change |
|---|---|---|
| Proxy | `functions/api/v1/[[path]].js` (new) | Forwards method, path, query, body, status and headers. Fixed upstream (not an open proxy; dot-segment escapes → 404). Strips hop-by-hop, `cf-*`, client-supplied `X-Forwarded-*` and `X-Sigma-Proxy-Secret`; sets `X-Forwarded-For` from `CF-Connecting-IP`. `redirect: manual` with `Location` rewritten to the Pages host, `Set-Cookie` `Domain` stripped. Timeout (default 25 s). 10 MiB body cap. Every failure is JSON with `X-Sigma-Proxy-Error`: `BACKEND_NOT_CONFIGURED` 503, `BACKEND_ORIGIN_INVALID` 500, `BACKEND_UNREACHABLE` 502, `UPSTREAM_TIMEOUT` 504, `UPSTREAM_INVALID_RESPONSE` 502 (upstream answered HTML). |
| Client | `js/api-client.js` | Proxy outage codes degrade exactly like the old static-host case (public reads from the bundled catalog, writes throw `BACKEND_UNAVAILABLE`, banner shown). Real API errors (401/404/409/429…) are **not** masked. Added `checkHealth()` and `lastBackendIssue`. Demo Sandbox unchanged and still opt-in only. |
| Backend | `backend/api/middleware.js` | `getClientIp()` honours `CF-Connecting-IP`/`X-Forwarded-For` only with `TRUST_PROXY=true` or a valid proxy secret (otherwise all users behind the proxy would share one rate-limit bucket). `enforceProxySecret()` rejects direct calls with 403 `PROXY_SECRET_REQUIRED` when `PROXY_SHARED_SECRET` is set (health probe exempt). |
| Backend | `backend/config/index.js` | **Bug fix:** the storage engine reads `config.storage`, which did not exist → `SIGMACAR_DATA_FILE` was ignored and dev seeding was always on. Now exported (`dataFile`, `allowDevSeed`). **Bug fix:** `server.js` reads `config.env`, which did not exist → production CORS fell through to `Access-Control-Allow-Origin: *` (verified on the original commit). Now set. Added `config.http` (`trustProxy`, `proxySharedSecret`, limits) that `server.js`/middleware already referenced. |
| Backend | `backend/application/ar-manifest-service.js` (new), `backend/api/router.js` | `GET /api/v1/vehicles/:id/ar-manifest` (see AR docs). |
| Hosting | `Dockerfile`, `scripts/docker-entrypoint.sh`, `.dockerignore` (new) | Container for the API with a persistent `/data` volume; optional one-time seed from the repo snapshot. |
| Routing | `_redirects` | Added `/ar/* /ar 200`. Removed `/* /index.html 200`, which `wrangler pages dev` reports as an infinite loop and **ignores** (SPA fallback is Pages' default without a `404.html`). |
| Build/CI | `scripts/build_dist.js`, `.github/workflows/ci.yml`, `package.json` | Ships `ar.html` and static AR manifest snapshots; CI installs dev deps (AR tests), syntax-checks the function and `js/ar/**`. |

## 4. Verification (local — production not deployed)

| Check | Result |
|---|---|
| Proxy unit tests (`tests/unit/pages_proxy.test.js`) | 9/9 |
| Real proxy → real backend (`tests/integration/api_proxy_ar_manifest.test.js`): health, paginated vehicles (query forwarded), POST login + authenticated `/auth/me`, 401 passthrough, cart, AR manifest; backend with `PROXY_SHARED_SECRET`: direct call 403, forged secret 403, per-client-IP rate limit (A: 200,200,200,429; B: 200) | 10/10 |
| Client degradation (`tests/unit/api_client_connectivity.test.js`) | 5/5 |
| **`wrangler pages dev dist`** (Cloudflare's runtime, wrangler 3.99.0) with a local backend | `/api/v1/health`, `/vehicles?page=1&pageSize=2`, `/vehicles/tesla-cybertruck/ar-manifest` → 200 JSON; `/cart` → 401 JSON; POST `/auth/login` → 200 JSON; backend killed → `/vehicles` and `/auth/login` → **502 `BACKEND_UNREACHABLE` JSON**; `/ar/tesla-cybertruck` → AR page; unknown path → SPA shell; no redirect warnings |
| Production-mode boot with the Docker file set (Docker not installed here; layout simulated) | health/vehicles/AR manifest OK; volume seeded via entrypoint; foreign `Origin` gets no ACAO |
| Full regression `npm test` | 202/202 (137 pre-existing + 65 new) |

Not done: deploying the backend or changing the live Pages project — both need credentials/authorization (see [CLOUDFLARE_DEPLOYMENT.md](CLOUDFLARE_DEPLOYMENT.md)). Until `SIGMA_BACKEND_ORIGIN` is set, production will answer `503 BACKEND_NOT_CONFIGURED` JSON and the site stays in read-only mode, now with an explicit reason.

## 5. Not changed

Payment providers/behaviour, checkout/cart business logic, auth scheme, Demo Sandbox semantics.
