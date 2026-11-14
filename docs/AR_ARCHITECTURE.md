# AR Architecture

Replaces the camera-overlay "AR Trực tiếp" engine (`js/ar-adapter.js` + the `#ar-live` page in `js/app.js`). That engine put a 3D canvas over a `getUserMedia` video and faked world-locking with the gyroscope. It had no surface detection, no real anchoring and no real scale. It has been removed. The previous root-level `AR_IMPLEMENTATION_PLAN.md` and `docs/AR_IMPLEMENTATION_REPORT.md` describe that old engine and are superseded by this document.

The 3D showroom (`#vr-ar`, `js/car-3d-viewer.js`, Three r128) is unchanged.

## Page and routing

| URL | Served by | Notes |
|---|---|---|
| `/ar/:vehicleId?color=<idx>&wheel=<id>&return=/#<route>` | `ar.html` | `_redirects`: `/ar/* /ar 200`; `server.js` maps the same paths locally |
| `#ar-live?carId=…` (legacy links) | `js/app.js` | redirects to `/ar/:id` |

Every AR call to action on the site goes through `window.openArLive(carId, config)` (in `js/app.js`). This function persists the configuration and navigates to `/ar/:id`. The AR page is a separate document. It loads only its own ES modules: the 12k-line SPA is not loaded, nothing touches the camera until the user taps "Bắt đầu AR", and there is no conflict between Three r128 (showroom) and the pinned Three **0.170.0** used here (vendored in `js/vendor/`, see `scripts/vendor_ar_libs.js`). The AR page needs r170 for `XREstimatedLight`, a modern `KTX2Loader`, and the Meshopt decoder.

## Modules (`js/ar/`)

```
ar-app.js                       orchestration: boot, preview, XR lifecycle, frame loop, errors, diagnostics
core/
  capability-detector.js        AR Capability Detector + chooseExperience() (webxr | scene-viewer | quick-look | preview-3d)
  session-manager.js            AR Session Manager / Camera-XR lifecycle (single session, interruption, visibility)
  scene-manager.js              Vehicle Scene Manager: renderer, env light, shadow catcher, light estimation, one render loop, context loss
  hit-test-manager.js           Surface Hit-Test Manager: horizontal-only filter, N-frame stability, smoothing
  placement-reticle.js          Placement Reticle + real-size footprint outline (length × width)
  placement-controller.js       Vehicle Placement Controller (pure state machine)
  interaction-manager.js        Vehicle Interaction Manager: GestureArbiter (tap / drag-rotate / twist), XR select arbitration
  resource-tracker.js           Resource Cleanup Manager (GPU objects, listeners, timers)
  emitter.js
models/
  url-policy.js                 model + dependent-resource URL validation
  fetch-with-progress.js        streaming download: progress, timeout, abort, bounded retry, size cap, HTML sniffing
  asset-cache.js                Model Asset Cache: memory LRU + Cache Storage, in-flight de-duplication
  model-validator.js            GLB container / glTF JSON / required-extension validation
  model-loader.js               External Model Loader: GLTFLoader + lazy Draco / Meshopt / KTX2, resource guard
  model-normalizer.js           orientation, real-world scale, ground at y=0
vehicle/
  vehicle-controller.js         model lifecycle, colour-variant swaps keeping placement, component picking
  material-configurator.js      Vehicle Material Configurator (exact verified names, protected materials)
  animation-controller.js       Vehicle Animation Controller (clips that exist only)
  hotspot-manager.js            Hotspot Manager (DOM buttons projected each frame; textContent only)
manifest/
  manifest-client.js            API → static snapshot fallback (only when the API is unreachable)
  manifest-schema.js            client-side validation; features re-derived conservatively
config/config-sync.js           Vehicle Configuration Sync (sessionStorage contract shared with app.js)
fallback/platform-fallback.js   Platform Fallback Manager: Scene Viewer intent, Quick Look, QR hand-off, messages
capture/capture-manager.js      Screenshot / Capture Manager
ui/ar-ui.js                     AR UI Overlay (DOM state only)
```

## Runtime flow

```
/ar/:id → parse & validate id
        → [parallel] capability detection (no permission prompt; XR query bounded to 2.5 s)
                     manifest: GET /api/v1/vehicles/:id/ar-manifest  ─(API unreachable only)→ /data/ar/:id.json
        → model download (progress) → validate → parse (Draco/Meshopt/KTX2 as needed) → normalise → configure
        → interactive 3D preview (OrbitControls)
        → mode decision:
            webxr        → "Bắt đầu AR" (user gesture) → requestSession('immersive-ar',
                              required: hit-test; optional: dom-overlay, local-floor, light-estimation, anchors, camera-access)
                           → scanning → stable horizontal surface → reticle + footprint → tap / "Đặt xe" → placed
                           → drag/twist rotate · move · reset · colour · wheels · hotspots · component tap · capture
                           → exit (button / system) → back to preview (session interruption shows a restart notice)
            scene-viewer → Android intent (native AR, real scale: resizable=false)
            quick-look   → only when a USDZ exists (none do today)
            preview-3d   → explicit "Xem 3D (không phải AR)" label + reason; desktop shows a QR code to /ar/:id
```

Placement rules: no placement without a stable horizontal hit (≥ 3 consecutive frames, ≤ 20° tilt). Taps while placed are interactions and never re-place the car. A 600 ms cooldown prevents double placement. Pinch is intentionally not mapped to scale, so the car always stays 1:1.

## Manifest (`GET /api/v1/vehicles/:vehicleId/ar-manifest`, schema v1)

Built by `backend/application/ar-manifest-service.js` from the vehicle record, `data/ar-manifest.json` and `assets/models/manifests/bindings.json`. The same builder emits `dist/data/ar/*.json` at build time.

```json
{
  "schemaVersion": 1, "vehicleId": "tesla-cybertruck", "name": "Tesla Cybertruck", "readiness": "verified",
  "model": { "glbUrl": "assets/models/ar/tesla_cybertruck_ar_v1.glb", "usdzUrl": null, "unit": "meters",
             "scaleMode": "certified", "dimensionsMeters": { "length": 5.682, "width": 2.2, "height": 1.791 } },
  "variants": [{ "colorIndex": 1, "glbUrl": "assets/models/ar/tesla_cybertruck_ar_stealth_black.glb" }],
  "colors": [{ "index": 0, "name": "…", "hex": "#94A3B8" }],
  "wheels": [{ "id": "wheel-22-forged", "label": "22\" Forged", "finish": { "color": "#B45309", "roughness": 0.3, "metalness": 0.95 } }],
  "materials": { "body": ["Material_Body"], "rims": ["Material_Rims"], "protectedPatterns": ["glass", "…"] },
  "animations": { "openDoors": null, "closeDoors": null },
  "hotspots": [{ "id": "hotspot-body", "name": "…", "position": [1.55, 0.775, 0.904] }],
  "features": { "changeColor": true, "changeWheels": true, "doorAnimations": false, "hotspots": true, "quickLook": false }
}
```

- Relative `glbUrl`s are **site-root relative**; absolute `https://` URLs (external CDNs) are supported.
- `scaleMode`: `certified` (use as is, but verified: >15 % mismatch → rescale + warning), `fit-to-length` (scale to `dimensionsMeters.length`), `as-authored` (implausible sizes → assumed 4.5 m + warning).
- Hotspot positions are converted from the showroom's 4.4 m normalised frame to metres.
- Names are never invented. The Cybertruck AR material names come from a verified override (the GLB JSON was parsed during the audit). Other names come from `bindings.json`, with `Trim` false-positives removed. The client re-checks every name against the loaded GLB and disables controls that do not match.
- Door animations: none of the 28 GLBs contains door clips, so the feature is reported `false`. The engine supports doors as soon as a manifest names a clip that exists in the file.
- Wheels: no GLB contains alternative wheel geometry. "Mâm xe" applies the same rim finishes as the showroom (`setWheelType`) and is labelled as a finish preview.

## Configuration sync

`sessionStorage["sigmacar_vehicle_configs_v1"][vehicleId] = { colorIdx, colorHex, colorName, wheelId, rotationAngle }`. Written by `setVehicleConfig` in `app.js` and by the AR page, and read by both. URL params on `/ar/:id` take precedence. "Back" returns to `?return=` (validated: same-origin `/#route` only) with `carId` and `colorIdx`. "Đặt cọc / Báo giá" opens the existing `#checkout?source=ar&vehicleId=…&colorName=…` flow, so no business logic is duplicated.

## Security notes

- Model and dependency URLs: HTTPS (or loopback http in dev), no credentials, allowed extensions only. Dependency `data:` URIs are limited to binary/image MIME types.
- Manifest strings are rendered with `textContent` only. Vehicle ids match `^[a-z0-9][a-z0-9-]{0,79}$`.
- No metadata is executed; `return` URLs are allowlisted (no open redirect).
- `credentials: 'omit'` for model fetches; CORS is required from external hosts.
