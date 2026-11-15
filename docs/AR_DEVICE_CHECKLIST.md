# SIGMA CAR — AR Quick Look device checklist (PLAN.md T6.4)

**Status: UNVERIFIED.** No real iPhone or iPad has been used yet. The automated browser E2E (19/19) emulates iOS
user agents in desktop Chrome. It cannot open Quick Look or measure scale. Use this checklist on real devices, and
do not mark any model `arScaleCertified` without a recorded device result.

## Before testing

- **Site:** the deployed site must use HTTPS (Pages preview or production), since Quick Look needs a secure origin.
- **Browser:** use Safari, not an in-app browser (Zalo, Facebook, Messenger). The AR page already asks users to open
  in-app links in Safari.
- **Devices:** at least one iPhone (iOS 17 or later) and one iPad (iPadOS 17 or later).

## Steps per vehicle

Test at least 3 vehicles, for example `tesla-cybertruck`, `vinfast-vf9` (large file) and `vinfast-vf3` (small car).

1. Open `/ar?vehicle=<id>`. The page shows the 3D preview and the "Xem AR" button.
2. Tap the button. Quick Look should open (it should not download the file).
3. Place the car on the floor and check its length with a tape measure or the iOS Measure app. It should match
   `dimensionsMeters` in `data/ar-manifest.json` within about 5%.
4. Pinch to zoom. Scaling stays locked (`allowsContentScaling=0`), so the car must not grow or shrink.
5. Switch colour on the detail page, re-open AR, and check that the colour matches.
6. For `vinfast-vf9`, note the load time over 4G and over Wi-Fi.

## Results

Fill in one row per device and vehicle.

| Date | Device / OS | Vehicle | Quick Look opened | Measured length vs manifest | Colour OK | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |

Only after a passing row exists for a vehicle on both iPhone and iPad should `arScaleCertified: true` be proposed for
it in `data/ar-manifest.json`. That is a protected file, so the change needs a separate approved task.

## Android (ARCore) and iOS Safari hand-off (added with PLAN N.17)

- [ ] Android Chrome (ARCore-supported phone): "Xem AR" note says "Google ARCore (WebXR)"; tap → camera opens, reticle with car footprint appears on the floor; tap places the car at real scale; drag rotates; "Đặt lại" re-scans; "Thoát AR" returns to the 3D view.
- [ ] Android: change colour before and during AR — the placed car changes colour.
- [ ] Android: "Mở bằng Google Scene Viewer" opens Scene Viewer in AR; without ARCore / Google app the page returns with the "Không mở được Google Scene Viewer" notice.
- [ ] Android in an in-app browser (Zalo/Facebook): AR either works or shows a clear message.
- [ ] iPhone: scan the desktop QR with the Camera app while Chrome is the default browser → page jumps to Safari; Quick Look opens there.
- [ ] iPhone in Zalo/Facebook in-app browser: "Mở bằng Safari" panel; button opens Safari (iOS 17+), copy-link works otherwise.
