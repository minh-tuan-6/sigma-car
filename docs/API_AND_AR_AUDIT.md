# SIGMACAR — API & AR Audit

Audit date: 2026-11-14. Repository state audited: `main` @ `7e0a38a` (clean working tree).
Everything below was verified by reading the code and/or by real HTTP requests; nothing is assumed from file names.

## 1. Architecture (as found)

| Layer | Finding | Evidence |
|---|---|---|
| Frontend | Vanilla-JS hash-routed SPA (`#home`, `#detail?carId=…`, `#vr-ar`, `#ar-live`, …). One `index.html`, ~20 classic `<script>` files, no bundler. `js/app.js` is a 12.3k-line controller. | `index.html:788-811`, `js/app.js:597-725` (`parseHashRoute`, `navigateTo`) |
| 3D rendering | Three.js **r128** (2021) global UMD build + r128 `GLTFLoader`/`DRACOLoader`/`OrbitControls`, plus `@google/model-viewer` (lazy). | `js/libs/three.min.js` header `REVISION "128"` |
| Backend | Node.js `http.createServer` (no framework). Single dispatcher with ~170 `if (pathname …)` route branches under `/api/v1/*`. Health probe at `GET /api/v1/health`. | `server.js`, `backend/api/router.js:56` |
| Persistence | In-process JSON document store (`data/sigmacar_store.json`, 52 collections) with atomic file writes; optional `node:sqlite` migration runner. **Synchronous `fs`** throughout. | `backend/infrastructure/storage-engine.js` (4,782 lines), `backend/infrastructure/database.js` |
| Auth | HMAC-signed bearer tokens in `Authorization` header (no cookies). Token stored in `localStorage` (`sigmacar_auth_token`). Live actor re-validation per request. | `backend/api/middleware.js:50-77`, `js/api-client.js:48-60` |
| Config | `.env` auto-loaded; production refuses to boot without a strong `JWT_SECRET`; `CORS_ALLOWED_ORIGINS` allowlist (empty in production ⇒ no CORS). | `backend/config/index.js` |
| API client | `API_BASE = window.SIGMACAR_API_BASE \|\| localStorage.sigmacar_api_base \|\| '/api/v1'` (same-origin relative). Detects `200 text/html` and 404/405-without-JSON as "static host" and degrades to read-only catalog; writes throw `BACKEND_UNAVAILABLE`. Demo Sandbox is opt-in only. | `js/api-client.js:3, 83-170, 173-305` |
| Deployment | Cloudflare Pages, static only. `npm run build` → `dist/` with `index.html, _headers, _redirects, css/, js/, assets/, data/ar-manifest.json, data/public-catalog.json`. `backend/` is excluded (`.wranglerignore`, build allowlist). **No `functions/` directory, no `wrangler.toml`, no `_routes.json`.** | `scripts/build_dist.js`, `.wranglerignore` |
| SPA fallback | `_redirects`: `/*  /index.html  200` | `_redirects` |
| Backend hosting | Only a local *quick* Cloudflare Tunnel script (`cloudflared tunnel --url http://localhost:3000`) — ephemeral `trycloudflare.com` hostname, not wired to Pages. | `run_cloudflare.bat`, `package.json` `tunnel` script |
| CI | GitHub Actions: syntax checks, data audit, unit/integration/security tests, migration dry-run, build. No deploy step. | `.github/workflows/ci.yml` |
| Payments | Sandbox gateway only (`PAYMENT_GATEWAY_SANDBOX=true` default). Not touched by this work. | `backend/infrastructure/payment-gateway.js` |

## 2. Production API failure — reproduction

Run 2026-11-14 against `https://sigma-car.pages.dev` with `curl`:

| Request | Status | Content-Type | Body |
|---|---|---|---|
| `GET /api/v1/vehicles` | **200** | `text/html; charset=utf-8` | `index.html` (50,782 bytes) |
| `GET /api/v1/health` | **200** | `text/html` | `index.html` |
| `GET /api/v1/cart` | **200** | `text/html` | `index.html` |
| `GET /api/v1/cms/public` | **200** | `text/html` | `index.html` |
| `POST /api/v1/auth/login` | **405** | (none) | empty |
| `GET /data/public-catalog.json` | 200 | `application/json` | real catalog snapshot |
| `GET /ar/cybertruck` | 200 | `text/html` | `index.html` (no AR route exists) |

### Confirmed root cause

**There is no backend behind `sigma-car.pages.dev`.** Cloudflare Pages only serves the static `dist/` folder; every `/api/v1/*` path falls through `_redirects` (`/* /index.html 200`) and returns the SPA shell as HTTP 200 HTML. Non-GET methods on static assets return 405. The Node backend was never deployed anywhere reachable, and nothing routes `/api/v1/*` to it.

The frontend correctly recognises this (HTML-with-200 ⇒ static host) and shows *"Chưa Kết nối Backend Server (Chế độ Xem Tĩnh)"*. **The client-side detection is not the defect** — it is accurately reporting a missing backend.

Ruled out: DNS/TLS (Pages responds normally), CORS (same-origin requests; no preflight involved), mixed content (relative URLs), auth (no request ever reaches an auth layer), database (no server process exists to connect to one).

### Why the backend cannot simply be "put on Pages"

- `server.js` uses Node's `http` server, `fs.createReadStream`, `fs.realpathSync`.
- The store writes `data/sigmacar_store.json` with synchronous `fs` and atomic rename. Workers/Pages Functions have no writable filesystem and no `node:http` server.
- Porting 52 collections + 4.8k lines of storage logic to D1/KV would be a rewrite of the business layer, which the brief forbids.

⇒ The backend must run on a Node runtime with a persistent disk (container/VM), and Pages must forward `/api/v1/*` to it.

### Secondary defects found

| # | Defect | Impact | File |
|---|---|---|---|
| A1 | No proxy or API base configured for production. | All live features unavailable. | — |
| A2 | Rate limiter keys on `req.socket.remoteAddress`. Behind any proxy/tunnel all users share one bucket (240 req/min total). | Would cause global 429s as soon as a proxy is added. | `backend/api/middleware.js:80` |
| A3 | If a proxy returns a JSON 502/503 the client throws instead of degrading to read-only catalog, so a backend outage would blank the catalog. | Worse UX than today once a proxy exists. | `js/api-client.js:126-140` |
| A4 | `vehicleConfigs` (colour/wheels) lives only in memory. | Selected configuration lost on any full-page navigation (e.g. to a dedicated AR page). | `js/app.js:37, 55-77` |
| A5 | Production CORS allowlist is empty ⇒ a cross-origin API base (`SIGMACAR_API_BASE`) would be blocked unless `CORS_ALLOWED_ORIGINS` is set. | Direct-connection alternative needs config. | `backend/config/index.js` |

## 3. Existing AR implementation — findings

| Component | What it actually does | Problem |
|---|---|---|
| `js/ar-adapter.js` (1,414 lines) — "AR Trực tiếp" (`#ar-live`) | `getUserMedia` camera `<video>`/2D canvas with a transparent WebGL canvas on top; "world lock" is simulated from `deviceorientation` gyro data. | **Not spatially tracked AR.** No surface detection, no real-world scale anchoring; the car floats over the video. The brief explicitly forbids presenting this as AR. |
| `js/ar-adapter.js` model-viewer path | `<model-viewer ar ar-modes="webxr scene-viewer quick-look">` → `activateAR()`. | Real AR only when model-viewer's own WebXR/Scene Viewer path triggers; no custom interaction, no USDZ for any vehicle (`usdzUrl: null` everywhere) so iOS Quick Look never works. |
| `js/car-3d-viewer.js` (3,041 lines) | 3D showroom (OrbitControls, gyro, hotspots, paint & rim finish) plus an embedded `immersive-ar` request. | Mixed responsibilities (showroom + camera + gyro + XR) in one class; AR runs inside the showroom DOM, not a dedicated page. |
| Loading | Bundled relative GLBs only; Draco via r128 decoder. | No external URL validation, no progress/timeout/retry/cancel contract, no KTX2/Meshopt. |
| Scale | Showroom normalises every model to 4.4 m max dimension. | Not real-world scale. Legacy hotspot `pos` values are authored in this 4.4 m frame. |
| Manifest | `data/ar-manifest.json` / `js/ar-manifest.js` (24 vehicles; 1 `verified`: Tesla Cybertruck with 4 per-colour AR GLBs). `assets/models/manifests/bindings.json` lists detected paint/rim materials. | No API endpoint; consumed client-side only. |
| Routing | `#ar-live?carId=`, `#ar-home`, `#vr-ar`. All AR CTAs call `window.openArLive(carId, config)`. | No dedicated route; `/ar/:id` returns the SPA shell. |

### Real asset inventory (parsed from GLB JSON chunks, not guessed)

- 24 studio GLBs (0.4–9.9 MB) + 4 Cybertruck AR variants (`Material_Body`, `Material_Rims`, …; ground-normalised, 1:1 scale).
- **No GLB contains door animations.** Only `subaru_impreza_2024.glb` has clips (`Mesh_12.001|Mesh_12.001Action.004/.005`) with no door semantics.
- **No GLB contains alternative wheel geometry.** "Wheel" variants in the showroom are rim-material finishes (`car-3d-viewer.js:1131 setWheelType`).
- Draco is used by 17 models; no KTX2 or Meshopt assets exist today.
- No USDZ files exist for any vehicle.

## 4. Files requiring modification

API: `functions/api/v1/[[path]].js` (new proxy), `backend/api/middleware.js` (trusted client IP), `backend/api/router.js` (AR manifest route), `backend/application/ar-manifest-service.js` (new), `js/api-client.js` (proxy-error degradation), `scripts/build_dist.js`, `_redirects`, `_headers`, `server.js` (serve `/ar/*`), `Dockerfile` (new), `wrangler.toml` (new).

AR: new `ar.html`, `css/ar.css`, `js/ar/**` engine, `js/vendor/**` (three r170 ESM, pinned), `js/app.js` (route `openArLive` to `/ar/:id`, persist configuration, retire `#ar-live` page), `index.html` (drop eager `ar-adapter.js`).

Preserved: 3D showroom (`#vr-ar`, `car-3d-viewer.js`), `#ar-home` AI page, cart/checkout/payments, Demo Sandbox, all business logic.
