# AR & API Test Report (Apple AR Quick Look)

Run on 2026-11-14 on Windows 11 with Node v23.11.0 and Google Chrome (installed build, headless, SwiftShader software GL).
**No physical iPhone or iPad was available.** Nothing below shows that AR Quick Look opens, places, tracks or renders the vehicle correctly on a device.

## Commands and results

| Command | Result |
|---|---|
| `npm test` (unit + integration + security) | **209 / 209 pass** |
| `npm run test:e2e` (real Chrome via playwright-core 1.49.1) | **19 / 19 pass** |
| `npm run build` | OK. 24 static AR manifests (schema v2), 13 USDZ files shipped, 45 files > 25 MiB kept out of `dist/` (Pages limit) and listed. With `SIGMACAR_USDZ_PUBLIC_BASE_URL` set, the snapshots point those colours at the external host |
| `npx wrangler@3.99.0 pages dev dist` | `/ar/tesla-cybertruck` → `ar.html`; USDZ served with a single `Content-Type: model/vnd.usdz+zip` + immutable cache; `USDZExporter.js` served; manifest falls back to the static snapshot when the API is unreachable |
| `node tests/test_ar_full_suite.js`, `test_ar_phase1.js`, `test_gyro.js`, `test_models.js`, `test_viewer_camera_integration.js` (legacy) | 7/7, 6/6, 12/12, 10/10, 8/8 |
| `npm run usdz:build` (all vehicles, no size limit) | **58 files = 24 vehicles × every colour, 0 failures**, 2 min 46 s, 2,415 MB; each streamed to disk and validated (`inspectUsdz`) before use. Regenerated Cybertruck files are byte-for-byte the same size and content as the committed ones, apart from internal IDs |
| `node scripts/build_usdz.js --all --dry-run` | All 24 vehicles converted in Chrome; sizes in `APPLE_AR_ARCHITECTURE.md` §5 |

`npm test` still rewrites `data/sigmacar_store.json`. This happens on the original commit too. Restore it with `git checkout -- data/sigmacar_store.json`.

## Coverage against the brief (§10)

| Requirement | Test |
|---|---|
| iOS/iPadOS compatibility detection | Unit: iPhone, iPad, iPadOS desktop-class UA, in-app browser, `supports()` throwing, insecure context. E2E: iPhone and iPad emulation |
| Unsupported Android and desktop | Unit: Android/Windows/Mac (Mac with `rel="ar"` still refused). E2E: Android with a WebXR runtime claiming `immersive-ar` → 0 XR calls, 0 camera calls, 0 Quick Look launches, no `intent:` navigation, exact message; desktop → message + QR, no AR button |
| Dedicated AR route | E2E: detail → `/ar/tesla-cybertruck?color=2&return=/#detail`; full-screen canvas = viewport; only ✕ + swatches visible; no nav/header/debug; `wrangler` routing |
| External model loading | E2E: external CDN `.gltf` + `.bin` (missing texture is non-fatal); unit + integration: URL policy, progress, retry, timeout, abort, cache, HTML sniffing |
| USDZ availability | Unit: manifest v2 sanitising, resolver order, URL policy, pre-built files match `data/usdz-assets.json` (size + SHA-256 + structure). Integration: API lists 4 pre-built files, served as `model/vnd.usdz+zip` with zip magic. E2E: pre-built, external, HTML-instead-of-USDZ → conversion, large prebuilt (VF9 89.7 MB) served with Content-Length and launched, large model without a file converted on the device in full (~94 MB) | 
| Vehicle colour selection | Unit: only body paint changes (metalness/roughness/clearcoat, glass, rims kept); tint without reload vs. variant GLB. E2E: variant swap, in-place tint with no new download, paint colour verified inside the generated USDZ (1 of 10 materials) |
| Selected colour persistence | E2E: colour from the detail page → AR page; colour changed in AR → back on the detail page (`AppState.vehicleConfigs`) |
| Quick Look launch behaviour | Unit: href builder and anchor contract. E2E (recorded, not executed): `rel="ar"`, `<img>` first child, `download` only for blob, `allowsContentScaling=0`, `canonicalWebPageURL`, launched with active user activation, never without a tap |
| Model loading errors | E2E: no-CORS host → `NETWORK_OR_CORS` + retry; invalid id; unknown vehicle → `NOT_FOUND` |
| Navigation back to the showroom | E2E: ✕ → `/#detail?carId=…&colorIdx=3` |
| Removal of obsolete integrations | Unit: removed files absent; no WebXR/camera/intent API in `js/ar` or `ar.html`; viewer only `immersive-vr`; `_headers`. E2E: `enterWebXR({ar:true})` makes 0 `requestSession` calls |
| Regression | E2E: home, 3D showroom, 360°/VR controls, cart, legacy `#ar-live` redirect, no uncaught page errors; full `npm test` |

## Bugs found by these tests and fixed

1. `inspectUsdzHeader()` reported a short HTML body (< 30 bytes) as `TOO_SHORT` instead of `HTML_INSTEAD_OF_USDZ` (unit test).
2. The first framing cut off the vehicle's bumper on a 390 px-wide iPhone and left the car low on screen (seen in screenshots; camera distance and target fixed; the vehicle's scale is untouched).
3. Two overlapping `_headers` rules for `.usdz` would have joined `Content-Type` values with a comma on Pages; reduced to one rule and verified with `wrangler`.
4. Found during asset preparation: three.js `USDZExporter` writes text USDA, so VinFast VF9 (1.9 MB Draco GLB) became an 89.7 MB USDZ. (A 24 MiB on-device guard added for this was later removed on request; large files are now pre-built and hosted externally, or converted on the device without a limit.)
5. `server.js` sent no `Content-Length` and ignored `Range`, so the page's 1 KiB USDZ probe pulled whole 90 MB files. In the E2E run this stalled every later page load (7 steps timed out). Fixed: `Content-Length`, `Accept-Ranges`, `206`/`416` single-range responses, and the read stream is destroyed when the client disconnects.
6. `buildArManifest()` crashed for a vehicle with no AR registry entry (`fileSizeBytes` read from `null`). All current vehicles have one, so it had not happened yet.

## Measurements (real, but not representative of iPhones)

| Metric | Value | Conditions |
|---|---|---|
| Manifest API | 14–26 ms (3 runs) | local server |
| Cybertruck GLB download + parse | 35–41 ms (3 runs) | local server, desktop Chrome |
| Pre-built Cybertruck USDZ | 988,016–988,138 B | per colour |
| On-device conversion, VinFast VF9 (no size limit) | 4.6–10.8 s, 94,033,905 B | desktop Chrome, SwiftShader. iPhone time and memory unknown |
| On-device conversion, Honda Civic EG6 | 2.2–3.4 s (3 runs), 4,485,812 B | desktop Chrome, SwiftShader. iPhone time unknown |
| Conversion of all 24 vehicles (dry run) | 0.06–7.2 s each | desktop Chrome |
| Size estimate vs. real USDZ | 0.29×–1.08× | 24 vehicles |

## Not tested: physical device checklist (required before claiming AR works)

iPhone (Safari, iOS 15+) and iPad (Safari, iPadOS desktop-class mode):

1. Open `/ar/tesla-cybertruck` from the detail page. Check the full-screen car, colour bar and "Xem AR" button, with no camera prompt from the page.
2. Tap "Xem AR". AR Quick Look should open in AR mode with the colour selected on the page.
3. Place the car on the floor. Check it is anchored when walking around, and measure the size against a tape measure (5.68 m). Check that pinch does **not** resize it (`allowsContentScaling=0`).
4. Close Quick Look, pick another colour, tap again. The new colour should open.
5. Open `/ar/honda-civic-eg6-1991` and pick a colour. Watch for "Đang chuẩn bị AR…" and record the conversion time. Then open Quick Look. Check the generated file opens, its colour, and any missing faces caused by single-sided export.
6. `/ar/vinfast-vf9` (89.7 MB USDZ): time the download and Quick Look opening on Wi-Fi and on cellular; check stability on an older iPhone. Repeat with the external base URL unset (on-device conversion of ~94 MB) and note whether Safari runs out of memory (the page must show `OUT_OF_MEMORY`, not hang).
7. Tap Share in Quick Look. It should share the `/ar/...` page URL, not a blob.
8. Open the page from Facebook/Zalo in-app browsers. Expect the "mở bằng Safari" message, or check whether Quick Look works there.
9. Return to the showroom with ✕. The colour should be kept.
10. Check memory and stability on an older device (e.g. iPhone XR) during conversion.

Android phone: open `/ar/...`. Expect the message only, no camera, no Scene Viewer.
