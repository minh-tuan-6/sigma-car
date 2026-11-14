# SIGMACAR Apple AR Architecture (AR Quick Look)

Status: implemented on 2026-11-14 and verified in desktop Chrome with iPhone/iPad emulation. **Not yet verified on a physical iPhone or iPad** (see `AR_TEST_REPORT.md`).

The AR camera is available only on iPhone and iPad, through Apple **AR Quick Look**, which is ARKit's built-in viewer. Every other device sees the 3D vehicle and a one-line notice that AR Camera needs a compatible iPhone/iPad. WebXR, ARCore and Google Scene Viewer have been removed.

## 1. Implementation decision: Option A (web AR Quick Look)

| | Option A: AR Quick Look from the website | Option B: native ARKit + RealityKit app |
|---|---|---|
| Runs on the existing Cloudflare Pages site | Yes | No: needs an iOS app (or App Clip) built in Xcode and distributed through the App Store |
| Camera, plane detection, placement, tracking, lighting | Yes, native ARKit inside Quick Look | Yes |
| Real-world scale | Yes; the page locks it with `allowsContentScaling=0` | Yes |
| Colour selection **before** entering AR | Yes (implemented) | Yes |
| Colour bar **inside** the live camera | **No.** Quick Look cannot show web HTML and runs no page JavaScript while open | Yes (SwiftUI overlay + runtime material change) |

The project is web-only, so Option A was implemented. Requirement 4 (a persistent colour bar inside the live AR camera) **cannot be met by Option A**. Following the brief, the colour bar is on the dedicated AR page: the user picks a colour, and Quick Look opens with a USDZ in that colour. No fake in-camera colour bar was built. Section 9 lists what Option B would need.

### What AR Quick Look provides (and what it does not)

| Provided by Apple (native) | Not available to a web page |
|---|---|
| Full-screen camera, horizontal plane detection, tap/drag placement, rotate, real-scale anchoring, environment lighting and shadows | Custom HTML, buttons or colour swatches inside the camera view |
| "Object" (3D) / "AR" toggle and the share sheet | Changing materials while it is open |
| `allowsContentScaling=0` (no pinch-resize) and `canonicalWebPageURL` (what Share sends) | Hotspots, info panels, analytics events from inside the session |
| An optional Apple Pay or custom-action banner (documented; **not used**: it is a single banner, not a colour picker) | Switching USD variants (Quick Look has no variant UI) |

## 2. Runtime flow (`/ar/:vehicleId`)

```
"Xem AR" / "Trải nghiệm AR" button (unchanged look) → window.openArLive(id)
  → saves the configuration (sessionStorage) → /ar/<id>?color=<i>&return=/#<route>
ar.html → js/ar/ar-app.js
  1. detectAppleArSupport()           feature detection: <a>.relList.supports('ar'); no permission prompt
  2. fetchArManifest()                GET /api/v1/vehicles/:id/ar-manifest → fallback /data/ar/<id>.json
  3. ModelLoader + VehicleController  GLB/glTF (same-origin or external HTTPS), progress, cache, validation,
                                      normalised to metres / +Y up / grounded / centred
  4. full-screen 3D view + colour bar (no camera on this page)
  5. iPhone/iPad only: UsdzResolver.prepare(colour)
        exact-colour USDZ (pre-built or external, probed) → else on-device conversion (no size limit) → else colourless file
  6. tap "Xem AR" → launchQuickLook(href)  synchronously, inside the user gesture
  7. ✕ → back to the showroom page with the chosen colour
```

Android, Windows, Linux, macOS and iOS in-app browsers stop after step 4. They show the notice, and desktop also shows a QR code. No AR, camera, WebXR or intent call is ever made on them; the E2E suite asserts this.

## 3. Modules (`js/ar/`, 21 files)

| File | Role |
|---|---|
| `ar-app.js` | Page controller: boot, colour changes, AR preparation, launch, cleanup, error states, `window.__sigmaAr` (test data; nothing on screen) |
| `apple/apple-ar-support.js` | iOS/iPadOS detection: `relList.supports('ar')` decides; device class (incl. iPadOS desktop-class UA via touch points) only labels the message |
| `apple/quick-look.js` | `buildQuickLookHref()` (fragment parameters) and `launchQuickLook()` (`<a rel="ar">` + `<img>` child, `download` for blob files) |
| `apple/usdz-builder.js` | `buildVehicleUsdz()` (three.js `USDZExporter`, horizontal plane anchoring), progress phases, real-cause error mapping, informational size estimate, `inspectUsdz()` / `inspectUsdzHeader()` spec checks |
| `apple/usdz-resolver.js` | Chooses the USDZ per colour, probes declared files, caches generated files per colour, revokes blob URLs |
| `manifest/manifest-schema.js`, `manifest/manifest-client.js` | Manifest v2 validation (re-derives features from data); API first, static snapshot only when the API is unreachable |
| `models/*` (6 files) | URL policy (models and USDZ), streamed download (progress, timeout, retry, abort, HTML sniffing), cache, glTF validation, normalisation, Draco/Meshopt/KTX2 decoders |
| `vehicle/vehicle-controller.js`, `vehicle/material-configurator.js` | Model lifecycle; paint re-tint by verified material name, or the colour's own GLB |
| `core/scene-manager.js`, `core/resource-tracker.js`, `core/emitter.js` | Renderer, studio lighting, render loop; deterministic disposal |
| `ui/apple-ar-ui.js`, `ui/qr-code.js` | Close button, status card, notice, colour bar, AR button; QR hand-off |
| `config/config-sync.js` | Shared configuration contract with `js/app.js`; safe return URLs |

The vendored libraries are `js/vendor/three` (r170: GLTFLoader, DRACOLoader, KTX2Loader, Meshopt decoder, OrbitControls, RoomEnvironment, **USDZExporter + fflate**) and `js/vendor/qrcode`. The WebXR light estimator is no longer vendored.

## 4. External model loading

- **3D view:** `model.glbUrl` and per-colour `variants[].glbUrl` accept site-relative paths or any `https://` URL. Loopback `http` is allowed for development only. Credentials in URLs, other schemes, path traversal and non-glTF extensions are rejected on the server (`sanitizeModelUrl`) and again on the client (`validateModelUrl`). Every `.bin` or texture referenced inside a glTF passes the same policy. External hosts must send CORS headers; otherwise the page shows `NETWORK_OR_CORS` with a retry.
- **AR:** `appleAr.usdz[].url` accepts the same kinds of URL and must end in `.usdz` (`validateUsdzUrl`). Quick Look downloads the file itself, so CORS is **not** required to launch. When CORS allows it, the page first reads the first 1 KiB (`Range: bytes=0-1023`) and rejects HTML or non-USDZ responses; for example, a Pages SPA fallback served instead of a missing file. Without CORS the file is "unverified" and still offered.
- The server never fetches model URLs, so there is no proxy or open fetch to abuse.

## 5. USDZ asset workflow

Quick Look cannot open GLB/glTF. The GLB is never handed to it. **No conversion is rejected because of its size**: models are converted in full, with no polygon reduction and no texture downscaling below the source resolution (cap 8192 px).

```
vehicle GLB(s) ──npm run usdz:build──▶ headless Chrome runs the AR page's own modules
   (every vehicle, every paint colour)    load → normalise to metres → apply paint → USDZExporter
                                          → stream to disk → inspectUsdz() → move into place
                                          → data/usdz-assets.json (bytes, SHA-256, staticHostable)
        ≤ 25 MiB ──▶ assets/models/usdz/… ──▶ Cloudflare Pages (static) ─┐
        > 25 MiB ──▶ assets/models/usdz/… (git-ignored) ──npm run usdz:upload──▶ R2 / any HTTPS host ─┤
                                                                                                    ▼
                         AR manifest (API + Pages snapshots) lists one USDZ per colour ──▶ AR Quick Look
```

| Source | How it is produced | Used when |
|---|---|---|
| **Pre-built** | `npm run usdz:build` (all vehicles; `-- --vehicle <id>` for one). The URL carries `?v=<sha256>` because the files are cached as immutable | First choice for every colour |
| **External** (CDN, e.g. a binary USDZ made with Apple Reality Converter) | `data/ar-manifest.json` → `configurations[].usdzUrl` (per colour), `usdzUrl` (any colour), or vehicle `model3d.usdzPath` | No pre-built file for the colour |
| **On-device conversion** | `buildVehicleUsdz()` on the iPhone/iPad from the model being shown, with the selected paint applied. Progress is shown ("Đang tạo tệp AR…", and for big models "có thể mất vài chục giây") | No pre-built/external file is reachable for the colour. No size limit; a real failure is reported with its cause (`OUT_OF_MEMORY`, `TEXTURE_EXPORT_FAILED`, `INVALID_USDZ`, `COMPRESSED_TEXTURES`, …) |
| Colour-independent file | `usdzUrl` / `usdzPath` | Last resort; the button says "AR hiển thị màu mặc định" |

### Where large files are served from

Cloudflare Pages refuses any single static file above **25 MiB**. That is the platform's limit, not this project's; a deployment containing such a file fails. Pre-built files above it are handled like this:

- `npm run build` leaves them out of `dist/` and prints the list.
- With `SIGMACAR_USDZ_PUBLIC_BASE_URL` set (Pages build variable and backend env), the manifest points those colours at `<base>/<vehicleId>/<colour>.usdz?v=<sha>`. Upload them with `node scripts/upload_usdz.js --bucket <r2-bucket> --execute`; the key layout matches. This needs your Cloudflare credentials and was not run.
- Without it, the Pages snapshots omit them, so the page converts those colours on the device. The API served by the backend still lists the site path; on Pages that path returns the SPA's HTML, which the page detects ("HTML_INSTEAD_OF_USDZ"), and it then converts on the device.
- `server.js` serves every file directly, so local and self-hosted setups use all pre-built files.
- They are written to `assets/models/usdz/.gitignore`, so 2.36 GB of build output is not committed. A fresh clone regenerates them with `npm run usdz:build`.

### Result of the full pipeline run (2026-11-14)

58 USDZ files: all 24 vehicles × every paint colour (one colour-independent file where the model has no paint layer). 0 failures, 2 min 46 s, 2,415 MB in total. 13 files are ≤ 25 MiB (deployable on Pages); 45 need external hosting.

| ≤ 25 MiB (Pages) | > 25 MiB (external base URL or on-device conversion) |
|---|---|
| tesla-cybertruck 0.94 MB ×4 · honda-accord-euro-r 1.25 · honda-civic-eg6-1991 4.28 ×4 · maybach-exelero-2005 5.62 · honda-prelude-bp1 6.31 · lamborghini-terzo-millennio 10.93 · ferrari-f50-1995 13.93 | lamborghini-aventador-sv 27.8 · honda-civic-type-r-2018 28.8 ×4 · hyundai-elantra-n-2024 31.7 ×4 · vinfast-vf3 33.2 ×5 · toyota-camry 35.1 ×4 · bugatti-chiron 40.3 · honda-civic-rs 43.8 ×4 · porsche-911-carrera-4s-2024 47.3 ×5 · vinfast-fadil 49.3 · tesla-roadster-2 64.3 · subaru-impreza-2024 69.2 · lucid-air-sapphire 72.6 ×2 · rolls-royce-boat-tail 73.4 ×2 · vinfast-lux-a20 77.2 · land-rover-defender-110 81.5 ×4 · vinfast-vf9 89.7 ×4 · suzuki-ciaz-2021 90.9 |

The sizes come from the exporter's format: plain-text USDA inside an uncompressed zip (the USDZ spec forbids compression), so Draco-compressed GLBs grow a lot when decoded. A binary USDC layer would be much smaller with identical geometry. That needs Apple's USD tools (macOS) or Blender, which are not available in this environment; it is the way to bring most vehicles under 25 MiB without any quality loss.

The pre-export size estimate (`auditExportable`) is informational only: it drives the "may take a while" hint and diagnostics, and never blocks.

### Conversion fidelity (reported per file, never hidden)

- Only `MeshStandardMaterial`/`MeshPhysicalMaterial` meshes are exported; unlit and multi-material meshes are skipped and counted.
- glTF `doubleSided` is not carried over: USD preview surfaces are single-sided (`USDZ_SINGLE_SIDED` warning). Thin single-sided geometry may show holes from behind.
- Paint is written as the linear-sRGB `diffuseColor` of the body material only (verified in tests). Metalness, roughness, clearcoat and textures are exported as authored; Quick Look's own renderer and lighting will look different from the web view.
- KTX2 (compressed) textures are refused for on-device conversion (the exporter cannot decode them without extra tooling). No current model uses them.

## 6. iOS / iPadOS support

- `canLaunchAr` = `relList.supports('ar')` **and** an iPhone/iPad device class **and** a secure context.
- iPadOS 13+ "desktop website" mode reports a Mac user agent; more than one touch point identifies it as an iPad.
- A real Mac never launches: Quick Look on macOS has no AR camera.
- iOS in-app browsers (Facebook, Zalo, …) without `rel="ar"` get "hãy mở trang bằng Safari".
- No camera permission is ever requested by the page; Quick Look owns the camera.

## 7. Colour selection

- The colours come from the existing vehicle colour data (`vehicle.colors`, which the website uses). The selection is shared with the website through `sessionStorage["sigmacar_vehicle_configs_v1"]` and `?color=`. It is restored when returning to the showroom.
- **Cheapest path first:** a colour with its own authored GLB (Cybertruck) loads that file once and caches it. Otherwise only the verified body-paint materials are re-tinted in place, with no reload. Glass, lights, tyres, rims and trim are never touched.
- 11 of 24 vehicles have no separable paint material. Their colour bar is hidden, with a short caption that the 3D model shows its original colour.
- While a USDZ is being prepared the AR button reads "Đang chuẩn bị AR…" and is disabled. Converted colours are cached, so switching back is instant.

## 8. Website integration and preserved UI

- The existing AR buttons (`openArLive`) keep their markup and styles. Only the destination page changed.
- The 3D showroom's "AR" mode pill already navigated to `/ar/:id`.
- In the shared viewer (`js/car-3d-viewer.js`), `enterWebXR({ ar: true })` now returns `apple-quick-look-only` without requesting a session. `checkWebXRSupport()` reports AR as unsupported. The VR-headset path (`immersive-vr`) is unchanged.
- No homepage, detail, showroom, 360°, VR, cart, checkout, auth or admin UI was modified.

## 9. What a native ARKit app (Option B) would add

An in-camera colour bar needs a native host, because Quick Look exposes no API for it:

- An iOS/iPadOS app (or an App Clip launched from the website) using ARKit + RealityKit: `ARView`/`RealityView` with horizontal plane anchoring, a SwiftUI colour bar overlaid on the camera, and runtime changes to `PhysicallyBasedMaterial.baseColor` on the paint material only.
- Assets as USDZ or `.reality` files with the paint material named consistently (the manifest already carries the material names).
- Xcode, an Apple Developer account and App Store review. This is outside a Cloudflare Pages site, so it was not created.

Reality Composer `.reality` files with tap behaviours are another native-authored route that Quick Look can open. They were not evaluated here and would need verification on a device.

## 10. Files

- **Added:** `js/ar/apple/*` (4 files), `js/ar/ui/apple-ar-ui.js`, `js/ar/ui/qr-code.js`, `scripts/build_usdz.js`, `scripts/upload_usdz.js`, `data/usdz-assets.json`, `assets/models/usdz/**` (58 files; the 45 above 25 MiB are git-ignored), `assets/models/usdz/.gitignore`, `js/vendor/three/addons/exporters/USDZExporter.js`, `js/vendor/three/addons/libs/fflate.module.js`, `.gitattributes`, this document, `docs/AR_REWRITE_PLAN.md`.
- **Rewritten:** `ar.html`, `css/ar.css`, `js/ar/ar-app.js`, `js/ar/core/scene-manager.js`, `js/ar/vehicle/vehicle-controller.js`, `js/ar/vehicle/material-configurator.js`, `js/ar/manifest/manifest-schema.js` (v2), `backend/application/ar-manifest-service.js` (v2), `tests/unit/ar_engine.test.js`, `tests/e2e/ar-flow.e2e.js`.
- **Modified:** `js/ar/models/url-policy.js` (USDZ policy), `js/car-3d-viewer.js` (no `immersive-ar`), `js/app.js` (comments only), `_headers`, `scripts/vendor_ar_libs.js`, `package.json` (`usdz:build`), `tests/integration/api_proxy_ar_manifest.test.js`, `tests/integration/ar_model_loading.test.js`, `docs/AR_TEST_REPORT.md`, `docs/CLOUDFLARE_DEPLOYMENT.md`.
- **Removed:** the WebXR engine: `core/session-manager.js`, `core/hit-test-manager.js`, `core/placement-reticle.js`, `core/placement-controller.js`, `core/interaction-manager.js`, `core/capability-detector.js`, `fallback/platform-fallback.js` (Scene Viewer intent), `capture/capture-manager.js`, `vehicle/hotspot-manager.js`, `vehicle/animation-controller.js`, `ui/ar-ui.js`, the vendored `XREstimatedLight.js`, and `docs/AR_ARCHITECTURE.md` (described the removed engine). Before deletion, every import was checked: none of these files was referenced outside `js/ar` and its tests.
