# Cloudflare Deployment

Two deployables:

1. **Static site + API proxy** → Cloudflare Pages (`dist/` + `functions/`).
2. **Backend API** → any Node host with a persistent disk, via `Dockerfile`.

Nothing here has been deployed by this change. All steps below require the project owner's accounts.

## 1. Backend API

The store is a JSON file written atomically to disk, so the host **must** provide a persistent volume and run **one instance** (no horizontal scaling with this storage engine).

```bash
docker build -t sigmacar-api .
docker run -d --name sigmacar-api -p 8080:8080 -v sigmacar-data:/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e PROXY_SHARED_SECRET="$(openssl rand -hex 32)" \
  -e TRUST_PROXY=true \
  sigmacar-api
```

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | yes | ≥ 32 chars, non-default. Production refuses to boot otherwise. |
| `PROXY_SHARED_SECRET` | recommended | ≥ 32 chars. Same value as `SIGMA_PROXY_SHARED_SECRET` on Pages. Direct calls get 403. |
| `TRUST_PROXY` | recommended | `true` → rate-limit per real client IP. |
| `SIGMACAR_DATA_FILE` | preset | `/data/sigmacar_store.json` in the image. |
| `SIGMACAR_SEED_FROM_REPO` | first boot only | `true` copies `data/sigmacar_store.json` (catalog **and demo accounts with public passwords**) to the empty volume. Otherwise production starts with an empty store. Rotate/remove demo users before go-live. |
| `GEMINI_API_KEY`, `PAYMENT_*`, `SMTP_*` … | optional | Unchanged; see `.env.example`. Payments stay in sandbox unless explicitly reconfigured. |

The API must be reachable over **HTTPS** at a stable hostname (e.g. `https://api.sigmacar.example`). Options: a platform URL (Fly/Render/Railway), or a **named** Cloudflare Tunnel (`cloudflared tunnel create` + DNS route). The existing `run_cloudflare.bat` quick tunnel is not suitable: its `trycloudflare.com` hostname changes on every run.

Health check: `GET /api/v1/health` (exempt from the proxy secret).

## 2. Cloudflare Pages

Project settings (Git integration):

| Setting | Value |
|---|---|
| Build command | `npm ci && npm run build` |
| Build output directory | `dist` |
| Root directory | repository root (so `functions/` is picked up) |
| Node version | 20+ (`NODE_VERSION=24` matches CI) |

Environment variables (Settings → Variables and Secrets, **Production** and **Preview**):

| Variable | Type | Value |
|---|---|---|
| `SIGMA_BACKEND_ORIGIN` | variable | `https://api.sigmacar.example` (origin only, https, no path) |
| `SIGMA_PROXY_SHARED_SECRET` | **secret** | same as backend `PROXY_SHARED_SECRET` |
| `SIGMA_PROXY_TIMEOUT_MS` | variable (optional) | default `25000` |

Direct upload alternative (from the repo root so `./functions` is included):

```bash
npm ci && npm run build
npx wrangler pages deploy dist --project-name sigma-car
npx wrangler pages secret put SIGMA_PROXY_SHARED_SECRET --project-name sigma-car
```

Local reproduction of Cloudflare routing (used for verification):

```bash
npm run build
PORT=3911 node server.js &
npx wrangler@3.99.0 pages dev dist --port 8799 \
  --binding SIGMA_BACKEND_ORIGIN=http://127.0.0.1:3911 --binding SIGMA_BACKEND_ALLOW_HTTP=true
```

Routing facts verified with `wrangler pages dev`:
- Functions take precedence over `_redirects` for `/api/v1/*`.
- `/ar/*` → `ar.html` must be written as `/ar/* /ar 200`. Targets ending in `/index.html` or `.html` are treated as loops and ignored.
- A missing asset (e.g. `/assets/models/x.glb`) returns `index.html` with status 200, labelled with the `_headers` content type (`model/gltf-binary`). The AR loader sniffs for HTML because of this.

## 3. Production verification steps

```bash
B=https://sigma-car.pages.dev
curl -si $B/api/v1/health | head -5                       # 200 application/json, data.status = ok
curl -s  "$B/api/v1/vehicles?page=1&pageSize=1" | head -c 200
curl -s  $B/api/v1/vehicles/tesla-cybertruck/ar-manifest | head -c 200
curl -si -X POST -H 'content-type: application/json' -d '{}' $B/api/v1/auth/login | head -1   # 400/401 JSON, not 405
curl -si https://api.sigmacar.example/api/v1/vehicles | head -1      # 403 PROXY_SECRET_REQUIRED (direct bypass)
curl -s  $B/ar/tesla-cybertruck | grep -o '<title>[^<]*'               # "Xem AR — SIGMACAR"
```

Then in a browser: the "Chưa Kết nối Backend" banner must not appear; log in, add to cart, create a quote.

If something is wrong, the `X-Sigma-Proxy-Error` response header names the cause: `BACKEND_NOT_CONFIGURED`, `BACKEND_ORIGIN_INVALID`, `BACKEND_UNREACHABLE`, `UPSTREAM_TIMEOUT`, or `UPSTREAM_INVALID_RESPONSE`.

## 4. Model hosting for AR

- Models in `assets/models/` are served by Pages (25 MiB per-file limit; the build enforces it).
- External CDNs work if they serve HTTPS with `Access-Control-Allow-Origin` covering the site origin. Without CORS, the page shows `NETWORK_OR_CORS`. A `.gltf` needs its `.bin`/textures reachable relative to its URL.
- AR is Apple AR Quick Look only (see `APPLE_AR_ARCHITECTURE.md`). USDZ files under `assets/models/usdz/` are served by Pages with `Content-Type: model/vnd.usdz+zip` (one `_headers` rule; overlapping rules would join values with a comma). Regenerate them with `npm run usdz:build -- --vehicle <id>` whenever a source GLB changes; a unit test fails if a file no longer matches `data/usdz-assets.json`.
- External USDZ files (e.g. binary USDZ made on a Mac for the large models) need HTTPS. CORS is optional (Quick Look downloads them itself), but with `Access-Control-Allow-Origin` the page can verify the file before offering it.
- AR Quick Look needs the page on HTTPS in Safari on iPhone/iPad; it cannot be tested from `localhost` on a desktop.
