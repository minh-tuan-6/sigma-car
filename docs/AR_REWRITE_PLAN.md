# AR Rewrite Plan & Tracker — Apple-only (AR Quick Look)

Supersedes the AR rows (D–H) of `AR_IMPLEMENTATION_PLAN.md`; its API rows (A–C) still apply.
Legend: ✅ done and verified locally · 🟡 done, needs a physical iPhone/iPad · ⛔ not possible with the chosen architecture or blocked externally · ➖ removed on purpose

| # | Step (brief §12) | Status | Evidence / notes |
|---|---|---|---|
| 1 | Audit the current AR implementation | ✅ | WebXR engine (`js/ar/core/*`), Scene Viewer intent (`fallback/platform-fallback.js`), XR capture, hotspots, door animations, `XREstimatedLight`; showroom viewer `enterWebXR({ar:true})` / `checkWebXRSupport()` still requested `immersive-ar` (unreachable from the UI, but present) |
| 2 | Identify AR dependencies | ✅ | All imports were checked with grep before deletion; the removed modules were referenced only inside `js/ar` and `tests/unit/ar_engine.test.js` |
| 3 | Decide the feasible Apple architecture | ✅ | Option A (web AR Quick Look). The in-camera colour bar requires Option B (native app), which is documented and not built (`APPLE_AR_ARCHITECTURE.md` §1, §9) |
| 4 | Preserve website and showroom UI | ✅ | AR buttons unchanged (E2E records the markup); `js/app.js` only comment changes; viewer change has no UI; showroom, 360°/VR, cart regression in E2E |
| 5 | Rewrite the AR engine | ✅ | `js/ar/` 21 files; 11 WebXR/Scene Viewer modules deleted |
| 6 | Dedicated AR page `/ar/:vehicleId` | ✅ | Full-screen vehicle, ✕, colour bar, one AR button; safe areas; `100dvh`; E2E layout check (only allowed controls visible) |
| 7 | External USDZ support | ✅ | `appleAr.usdz[]` (https / same-origin), probe of the first 1 KiB, HTML responses rejected, uninspectable cross-origin files still launched; E2E with a fake CDN |
| 7b | USDZ asset preparation | ✅ / ⛔ | `npm run usdz:build` (pre-built Cybertruck ×4, 0.94 MB) and on-device conversion (7/24 vehicles fit). 17/24 vehicles are too heavy for the text-USDA exporter; they need an offline binary USDZ (macOS tools), which is not available here |
| 8 | Vehicle colour selection | ✅ | Variant GLB or in-place paint tint; persisted to the website; USDZ per colour; paint verified in the exported USDZ (unit + E2E) |
| 8b | Colour bar inside the live AR camera | ⛔ | Not possible in AR Quick Look; needs a native ARKit app (Option B) |
| 9 | Integrate AR Quick Look | ✅ / 🟡 | `<a rel="ar">` + `<img>`, `download` for blob files, `allowsContentScaling=0`, `canonicalWebPageURL`, launched inside the tap (E2E checks `userActivation`). **Opening Quick Look and AR placement need a device test** |
| 10 | Disable AR camera on Android and desktop | ✅ | E2E: Android with a WebXR runtime that claims `immersive-ar` → no XR call, no camera, no intent, message shown; desktop → message + QR |
| 11 | Remove obsolete AR code | ✅ | Unit test asserts the files are gone and that `js/ar` + `ar.html` contain no `navigator.xr`, `requestSession`, `immersive-ar`, `intent://`, `getUserMedia`, `hit-test` |
| 12 | Tests and build | ✅ | `npm test` 207/207, E2E 18/18, legacy AR scripts pass, `npm run build` OK, `wrangler pages dev` headers OK |
| 13 | Final report | ✅ | `AR_TEST_REPORT.md`, `APPLE_AR_ARCHITECTURE.md` |

## Removed on purpose (were part of the WebXR engine)

| Feature | Why |
|---|---|
| WebXR session, hit-test reticle, tap-to-place, move/rotate gestures | ARKit inside Quick Look does placement and gestures natively |
| Scene Viewer (Android) and every Android AR path | Brief: AR Camera on iPhone/iPad only |
| Hotspots / info panels, door animations, wheel-finish chips, screenshot button | Brief: minimal page with no descriptions, floating panels or extra buttons; Quick Look cannot show them anyway |
| Diagnostics panel | Brief: no debug information on screen. Test data is still published to `window.__sigmaAr` (invisible) |

## Next steps for the owner

1. Test on an iPhone and an iPad with the checklist in `AR_TEST_REPORT.md`.
2. Produce binary USDZ files for the 17 large vehicles on a Mac (Reality Converter or `usdzconvert`), one per colour. Declare them in `data/ar-manifest.json` (`configurations[].usdzUrl`), or host them and reference them by URL.
3. Decide whether an in-camera colour bar justifies a native iOS app or App Clip (Option B).
4. Deploy (needs your authorization and credentials; see `CLOUDFLARE_DEPLOYMENT.md`).
