# AR & API Implementation Tracker

> **2026-11-14 update:** rows D–H (WebXR engine, Scene Viewer, hotspots, doors, capture) were replaced by the Apple-only AR Quick Look rewrite. See `AR_REWRITE_PLAN.md` and `APPLE_AR_ARCHITECTURE.md`. Rows A–C (API) still apply.

Status legend: ✅ done & verified locally · 🟡 done, needs physical-device or production verification · ⛔ blocked (external) · ➖ not applicable / intentionally not done

| # | Task | Status | Files | Notes / test evidence | Outstanding |
|---|---|---|---|---|---|
| A | Repository audit | ✅ | `docs/API_AND_AR_AUDIT.md` | Code read, production reproduced with curl, GLBs parsed | — |
| B | API root cause | ✅ | — | Pages static-only; `/api/v1/*` → `index.html` 200 / POST 405 | — |
| C1 | Pages Function proxy | ✅ | `functions/api/v1/[[path]].js` | 9 unit tests, 5 real-backend tests, `wrangler pages dev` verified | Set env vars in Pages ⛔ |
| C2 | Client outage degradation + health | ✅ | `js/api-client.js` | 5 tests | — |
| C3 | Trusted client IP, proxy secret | ✅ | `backend/api/middleware.js`, `backend/api/router.js` | 403 bypass, per-IP rate limit tests | — |
| C4 | Config bugs: `config.storage`, `config.env` (prod CORS `*`) | ✅ | `backend/config/index.js` | Original behaviour reproduced, fix verified | — |
| C5 | Backend container | 🟡 | `Dockerfile`, `scripts/docker-entrypoint.sh`, `.dockerignore` | File set booted in production mode locally | Docker not installed here; image never built. Host + HTTPS hostname ⛔ |
| C6 | Routing (`/ar/*`, dead `/*` rule) | ✅ | `_redirects`, `_headers`, `server.js` | Verified with wrangler | — |
| D | Modular AR engine | ✅ | `js/ar/**` (26 files) | 36 unit + 6 HTTP integration tests | — |
| E | Dedicated AR page `/ar/:id` | ✅ | `ar.html`, `css/ar.css`, `js/ar/ar-app.js`, `js/app.js` | E2E steps 1–12 in Chrome | — |
| F1 | External GLB/glTF loading (progress, timeout, retry, cancel, cache, validation) | ✅ | `js/ar/models/*` | External-origin .gltf + .bin (Node + Chrome), CORS failure, 404, SPA-HTML, abort | — |
| F2 | Draco | ✅ | vendored decoder | `vinfast-vf9` decoded in Chrome | — |
| F3 | Meshopt / KTX2 | 🟡 | `model-loader.js` | Wired lazily. No repository asset uses them, so they have not been exercised with real files | Test with a real Meshopt/KTX2 asset |
| F4 | AR manifest API + static snapshots | ✅ | `backend/application/ar-manifest-service.js`, `scripts/build_dist.js` | Integration tests; 24 snapshots built | — |
| G1 | WebXR session, hit-test, reticle, placement | 🟡 | `core/*` | Logic unit-tested with XR-shaped mocks; wiring verified in Chrome with a mocked `navigator.xr` | **Physical ARCore device test** |
| G2 | Gestures (tap / rotate / twist), selection, hotspots | 🟡 | `interaction-manager.js`, `vehicle/*` | Unit tests; hotspot + component pick in Chrome preview | Device test inside dom-overlay |
| G3 | Colour (tint + variant GLB), wheel finish | ✅ | `vehicle-controller.js`, `material-configurator.js` | Swap to variant GLB verified in Chrome | — |
| G4 | Door animations | ➖ | `animation-controller.js` | Engine supports clips; **no GLB has door clips**, so the feature is disabled honestly | Needs authored assets |
| G5 | Light estimation, shadows | 🟡 | `scene-manager.js` | Shadow catcher in preview; `XREstimatedLight` only when the session grants it | Device test |
| G6 | Capture | 🟡 | `capture-manager.js` | Preview JPEG verified. XR capture needs `camera-access` and is experimental/unverified | Device test |
| H1 | Android fallback (Scene Viewer) | 🟡 | `platform-fallback.js` | Intent format unit-tested | Device test; needs public HTTPS model URL |
| H2 | iOS (Quick Look) | ⛔ | — | Code path exists; **no USDZ assets** → iOS gets a labelled 3D preview | Produce USDZ files |
| H3 | Desktop preview + QR | ✅ | — | E2E | — |
| I | Regression | ✅ | tests | `npm test` 202/202, E2E 16/16, legacy AR scripts pass | — |
| J | Reports | ✅ | `docs/*` | — | — |

## Decisions

- **Same-origin proxy instead of a cross-origin API base.** No CORS, auth unchanged, and secrets stay server-side.
- **Backend in a container, not ported to Workers.** The storage engine depends on synchronous fs and a single writer; porting it would mean rewriting the business layer.
- **Separate AR document with Three 0.170.** This isolates AR from the r128 showroom and provides XREstimatedLight, KTX2 and Meshopt. It is vendored so there is no runtime CDN dependency.
- **Wheels = finish preview.** No wheel geometry exists. The IDs and finishes match the showroom so the configuration round-trips.
- **No paid/3rd-party WebAR SDK added.** Interactive camera AR on iOS Safari would require one (e.g. 8th Wall, Zappar, Niantic); all are licensed products. This needs an owner decision.
