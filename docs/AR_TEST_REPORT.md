# AR & API Test Report

Run on 2026-11-14 on Windows 11 with Node v23.11.0 and Google Chrome (installed build, headless, SwiftShader software GL).

## Commands and results

| Command | Result |
|---|---|
| `npm test` (unit + integration + security) | **202 / 202 pass** (137 pre-existing + 65 new) |
| `npm run test:e2e` (real Chrome via playwright-core 1.49.1) | **16 / 16 pass** |
| `npm run build` | OK. 24 static AR manifests, no forbidden files, every file < 25 MiB |
| `node tests/test_ar_full_suite.js` (legacy) | 7/7. The "dist/ must exist" check also failed on the untouched original until a build had run |
| `node tests/test_ar_phase1.js`, `test_gyro.js`, `test_models.js`, `test_viewer_camera_integration.js` (legacy) | all exit 0 |
| `npx wrangler@3.99.0 pages dev dist` + local backend | Routing verified (see API_FIX_REPORT §4) |
| `node --check` on `functions/**` and `js/ar/**` | OK |

New test files: `tests/unit/pages_proxy.test.js` (9), `tests/unit/api_client_connectivity.test.js` (5), `tests/unit/ar_engine.test.js` (36), `tests/integration/api_proxy_ar_manifest.test.js` (10), `tests/integration/ar_model_loading.test.js` (6), `tests/e2e/ar-flow.e2e.js` (16 steps).

Legacy scripts updated: `test_ar_full_suite.js` and `test_gyro.js` (assertions about the deleted adapter replaced). `test_camera_ar.js` was deleted because it only tested the removed `getUserMedia` overlay.

## Coverage against the brief

| Area | Covered by |
|---|---|
| API base URL, health, JSON validation, auth passthrough, proxy behaviour, backend unavailable | unit + integration + wrangler |
| CORS | proxy is same-origin; backend production CORS verified (no `*`); model CORS failure in Chrome |
| Cart/checkout | cart through the proxy; checkout hand-off URL; existing P1/P4 commerce suites unchanged and passing |
| Model URL loading / invalid URLs / download failures | unit (mock fetch) + HTTP integration + Chrome (external origin) |
| Missing textures | Chrome: missing `textures/missing.png` → warning, model still shown |
| Missing buffers | Node HTTP: `.bin` 404 → `MISSING_RESOURCE` |
| Incorrect dimensions | unit: cm-authored, Z-up, sideways, certified mismatch, degenerate |
| Missing animation clips | unit: named clip absent → doors disabled |
| Material configuration | unit + Chrome (variant GLB swap, rim finish) |
| Unsupported WebXR devices | unit matrix (Android/iOS/iPadOS/desktop/in-app/insecure) + Chrome desktop |
| Session lifecycle | unit (single session, user vs system end, error mapping) + Chrome with mocked `navigator.xr` (gesture-gated request, permission denial) |
| Hit-test handling / placement state | unit with XR-shaped frame objects |
| Interaction controls | unit (gesture arbiter) + Chrome preview (hotspot, component pick) |
| Resource cleanup | unit (dispose counts, idempotent tracker) |
| Navigation showroom ↔ AR with config preserved | Chrome E2E steps 1–12 |

## Bugs found by these tests and fixed

1. Manifest asset paths were resolved against `/ar/:id`, so every model 404'd (`/ar/assets/...`). Now resolved against the site root.
2. A slow drag that paused before release could slip through as a placement. Drag is now timestamped at release.
3. Desktop screenshots opened a Web Share sheet instead of saving. Share is now used on mobile only.
4. `isSessionSupported('immersive-ar')` stalled about 11 s on desktop Chrome/Windows. It is now bounded to 2.5 s and overlapped with model download.
5. `/ar/* /ar/index.html 200` is ignored by Pages as a loop. Changed to `/ar/* /ar 200` with `ar.html`.
6. On Pages, a missing `.glb` returns `index.html` labelled `model/gltf-binary`. The loader now sniffs the body for HTML.

## Measurements (real, but not representative of phones)

From the E2E run (desktop Chrome, **SwiftShader software rendering**, local server):

| Metric | Value |
|---|---|
| Manifest API (Cybertruck) | 10–14 ms |
| Capability detection (desktop, XR query hits the 2.5 s bound) | ~2,505 ms (runs in parallel with loading) |
| Cybertruck AR GLB (407,164 B): download + parse | 838–963 ms |
| VinFast VF9 GLB (1,981,208 B, Draco + texture) | 398–870 ms |
| Preview FPS with software GL | 12–13 fps (CPU rasteriser; GPU devices will differ) |
| Memory cache after two Cybertruck variants | 814,328 B |
| Preview screenshot | 46,605 B JPEG |

No phone FPS, memory, or AR tracking numbers were recorded, because no AR-capable device was available.

## Not tested: physical device checklist (required before claiming AR works)

Android (Chrome, ARCore-certified phone, HTTPS deployment):
1. `/ar/tesla-cybertruck` → "Bắt đầu AR" → camera permission prompt only after the tap.
2. Real camera feed, scanning hint, reticle and footprint appear only on floors (not on walls or tables at an angle).
3. Tap / "Đặt xe" places the car; it stays anchored while walking around; size matches a tape measure (5.68 m).
4. Drag and twist rotate; tapping the car does not re-place it; "Di chuyển" and "Đặt lại" work.
5. Colour swap while placed keeps position; wheel finish; hotspots track the car; info card.
6. Lighting with light estimation; shadow under the car.
7. Switch apps mid-session → interruption notice → restart works.
8. Capture: check whether `camera-access` is granted, and whether the saved photo contains the camera image (experimental path).
9. Exit → back to the detail page with colour/wheels preserved.
10. Scene Viewer button on a non-WebXR Android browser.
11. Record FPS from the diagnostics panel ("Chẩn đoán") and memory from `chrome://inspect`.

iOS: verify the labelled 3D-preview fallback. Quick Look cannot be tested until USDZ assets exist.

## Pre-existing issue (not introduced here)

`npm test` rewrites `data/sigmacar_store.json` (the store's on-load schema migration persists to the repo file). The same happens on the original commit. Restore it with `git checkout -- data/sigmacar_store.json` after test runs.
