# SIGMA CAR — Additive Completion Plan (27 feature groups)

**Status:** audit and plan only. No application code, data, configuration, database or deployment was changed.
`PLAN.md` is the only file written. **Nothing in this plan is approved for implementation yet.**

| | |
|---|---|
| Audited code | `HEAD d01fc77` (`main`), working tree as of 2026-11-14 |
| Method | Read-only source review of the frontend, router, services, repositories, D1 store and tests. No test was run for this audit. |
| Replaces | The earlier untracked `PLAN.md` (868 lines, Vietnamese). It contained claims that don't match the code, so it was not used as evidence (see §M). |

## Evidence legend

Every finding cites `file:line`. Line numbers refer to the audited tree and will drift after edits.

| Tag | Meaning |
|---|---|
| **[V]** | Verified: I re-read the code path myself during this audit. |
| **[R]** | Read: found during the audit's code review with file:line, but not re-read a second time. Treat as very likely, and confirm in the task's first step. |
| **[I]** | Inference: a deduction from code or data, not traced end to end. |
| **[U]** | Unverified: it needs a runtime or device check. |

"Works" in this plan always means *the code path exists and is wired*. Only the automated suites listed in §J have been
run (in earlier sessions). Nothing here was observed in a browser or on a device during this audit.

---

## A. Executive summary

### A.1 Actual architecture (verified)

**Frontend:** a vanilla-JS single-page app.
- `index.html` hosts the app; `js/app.js` (11,594 lines) holds the views and the hash router (`#home`, `#new-cars`, `#detail`, `#compare`, `#tco`, `#charging`, `#cart`, `#checkout`, `#test-drive`, `#ai-advisor`, `#profile`, `#seller-dashboard`, `#support`, `#vr-ar` …).
- `js/api-client.js` (2,146 lines) is the HTTP client, with an offline fallback to `js/static-sandbox.js` and the static catalog `js/data.js`.
- Feature views live in their own files: `js/p3-views.js`, `js/tco-view.js`, `js/charging-view.js`, `js/registration-view.js`, `js/cart-view.js`, `js/checkout-view.js`, `js/content-admin.js` and `js/consultation-state.js`.

**3D and AR:**
- 3D: `js/car-3d-viewer.js` (Three.js).
- AR: a separate page, `ar.html` with `js/ar/**`, using Apple AR Quick Look only.
- USDZ files are prebuilt by `scripts/build_usdz.js` and indexed in `data/usdz-assets.json`.

**Backend:** one router for both runtimes.
- `backend/api/router.js` (1,886 lines, about 160 route conditions) dispatches to 32 services in `backend/application/`, plus `backend/domain/` (roles, authorization, state machines) and `backend/infrastructure/` (repositories, storage engine, security, gateways).
- **Node:** `server.js`.
- **Cloudflare Workers:** `backend/cloudflare/worker.mjs` → `runtime.js` → `node-http-shim.js` → the same router.

**Persistence:**
- An in-memory document state (`backend/infrastructure/storage-engine.js:19-37`, 52 named collections).
- Stored as a JSON file in Node, or in D1 through `backend/infrastructure/persistence/d1-state-store.js` as one row per document.
- D1 schema: `backend/infrastructure/d1/migrations/0001_state_store.sql` (`state_documents`, `state_meta`, `state_revision` with a conflict trigger, `media_blobs`, `data_migrations`) and `0002_incremental_sync.sql` (`rev` column and `state_deletions`).

**Legacy schema files are not live.** `backend/infrastructure/migrations/M*.sql`, `migrations/*.sql` and `backend/infrastructure/database.js` (SQLite) are required by no runtime code [V]. New work must not target them.

**Cloudflare:**
- Pages project `sigma-car`.
- Pages Function `functions/api/v1/[[path]].js` forwards `/api/v1/*` to the Worker through the service binding `SIGMA_API`.
- `wrangler.api.toml` defines the environments default (local), staging (a D1 id is now set, `database_name = "Server"`) and production (placeholder id).
- The target is the Workers/D1/Pages Free plans (`docs/CLOUDFLARE_FREE_PLAN.md`).

### A.2 Audit result

| Status | Count | Features |
|---|---:|---|
| COMPLETE | 1 | 8 Smart Bundle |
| PARTIAL | 15 | 1, 2, 3, 5, 6, 11, 12, 16, 17, 18, 22, 23, 24, 25, 27 |
| BROKEN | 10 | 4, 9, 10, 13, 14, 15, 19, 20, 21, 26 |
| MISSING | 0 | — (every group has at least a backend foundation) |
| UNVERIFIED | 1 | 7 AR / Quick Look (code complete, never checked on a real iPhone/iPad) |

**Status rule used.**
- **BROKEN:** a confirmed defect makes a required sub-flow fail (a runtime error, an always-rejected request, data silently not saved or loaded) or opens a security hole.
- **PARTIAL:** what exists works, but required sub-parts are absent or wrong in a non-blocking way.

### A.3 Critical findings

1. **Payment bypass (P0 security) [V].** A buyer can mark their own order as paid by sending `{"verifiedByWebhook": true, "amount": N}` to `POST /api/v1/orders/:id/complete-payment`.
   - The router passes the raw body through: `router.js:575-577` → `order-service.js:84` → `order-repository.js:159,168-174`.
   - No legitimate caller sets `verifiedByWebhook` (it is grep-verified to appear only at `order-repository.js:159`).
2. **The campaign delivery webhook HMAC always uses a public default secret [V].**
   - `backend/workers/campaign-worker.js:11` reads `config.webhookSecrets`, which `backend/config/index.js` never defines. The fallback is `'sigma-dev-campaign-webhook-secret'`.
   - Anyone can forge delivery receipts.
3. **The last-admin guard can be bypassed through `disabledAt` [V].** `router.js:1169` passes `body.disabledAt` to `user-repository.js:128`, but the guard at `:138` checks role demotion only.
4. **Frontend↔API wiring defects break whole areas even though the backend is sound.** All are verified:
   - The admin Inventory tab throws a ReferenceError: `inventoryRows`/`promotionsList` are locals of `renderSellerDashboard` (`app.js:6419-6420`) but are used in the sibling `renderSellerSubView` (`app.js:6544`, `6951`, `6955`).
   - Product reviews never load: `ApiClient.reviews.getForVehicle` doesn't exist (`app.js:3587` vs `api-client.js:1211`).
   - Financing applications never load: `listApplications` vs `getApplications` (`app.js:6436`, `8694` vs `api-client.js:582`).
   - Favorites are never saved or loaded: `app.js:10841-10868` makes no API call, and `app.js:8709` reads `savedCarIds` while the server returns `savedCars` (`auth-service.js:268-281`).
   - Order timeline events render blank (`app.js:10577-10581` reads `label/detail/at`; history entries are `status/note/timestamp`).
   - Return stage labels don't match the server (`app.js:6669-6680` vs `constants.js:92-103`).
   - Ticket status options don't match the server (`app.js:7158` vs `constants.js:75-82`).
   - The test-drive "complete" action always fails (`app.js:7933` sends `'Đã hoàn thành'`; the state machine `state-machines.js:28-35` has no Pending→Completed transition).
5. **The analytics conversion funnel is almost empty [R].** Only `vehicle_view` events are ever recorded (`app.js:2827`, `4711`), so test-drive and checkout conversion are always 0.

### A.4 Strategy and expected impact

- **Phase 0:** close the 3 security defects with small server-side guards.
- **Phase 1:** fix the wiring defects, mostly with **additive aliases in `js/api-client.js`** or one-line field corrections, so the large `js/app.js` changes as little as possible.
- **Phases 2–4:** add the missing sub-features as **new isolated modules** (services, routes and small view files), each registered through one existing extension point.
- **Phase 5:** add synthetic demo data through new scripts, kept isolated and removable.
- **Phase 6:** regression tests.
- **No SQL migration is needed.** Any new array collection is persisted by the existing D1 state codec automatically (`state-codec.js:80`, verified; `partsLedger` already works this way without being in the collection list).
- **Expected footprint:** 34 new files and 32 existing files touched (§F), most at Level 1. No structural change. Ten tasks need explicit approval (§K).

---

## B. Feature audit matrix (all 27)

Change levels (§10 of the brief):
- **L0** = new files only.
- **L1** = tiny integration change.
- **L2** = limited patch.
- **L3** = structural; not authorised.

| ID | Feature | Status | Evidence (key) | Missing parts / defects | Action | Level |
|---|---|---|---|---|---|---|
| 1.2.1 | AI Advisor | PARTIAL | prefs UI `consultation-state.js:139-259` → `router.js:959` → `consultation-service.js:323`; scoring `:151-262`; top-3 `:264-281`; image upload `:567-599` → `mediaAssets` [R] | No height/weight inputs; `dailyKm` not in the UI and unused in scoring; **no image analysis** (the image is only stored, `:643-645`); errors misrouted (`app.js:2592` reads `statusCode`, the client sets `status`, `api-client.js:183`) [V]; guest preferences not sent (`consultation-state.js:451`) | T1.11, T3.1, T3.2 (approval) | L1/L2 |
| 1.2.2 | Comparison | PARTIAL | `p3-views.js:25-240`; max 4 `app.js:798-809`; diff toggle `p3-views.js:117-135` [R] | No weight or charging-time rows; the battery row reads `c.battery` (nonexistent, `:90`); used-car rows read `isUsed`/`measuredBatterySoH` (`:66,95`) instead of `isCertified`/`batteryHealth` | T1.12 | L1 |
| 1.2.3 | TCO | PARTIAL | `tco-view.js` → `api-client.js:1948,1952` → `router.js:1785,1790` → `tco-service.js:86-209` (formulas, disclaimer) [R] | Input is km/month (no daily input); no consumption inputs (always defaults 15 kWh / 7 L); **hybrid energy cost = 0** (`tco-service.js:133,144`) [V]; charging-tariff handoff `sigmacar_tco_preferred_tariff` is written (`charging-view.js:210`) but never read | T1.13, T1.16 | L1/L2 |
| 1.2.4 | Discovery | **BROKEN** | filters/sort client-side `app.js:143-322`, `1518+`; compare buttons `app.js:10760,10833` [R] | **Favorites never persisted or loaded** [V]; profile "remove" calls a toggle and can *add* the car on the server (`app.js:10485-10490`); no power filter; the backend query API `vehicles.query` is unused (acceptable) | T1.3, T3.3 | L1 |
| 1.2.5 | Product Detail | PARTIAL | `renderVehicleDetail` `app.js:2803-3569`; inventory `:3519` → `router.js:345`; registration widget `:3556`; test drive `:811`; financing `:10900` [R] | Reviews broken (root cause in 1.2.19); no videos (no data field, no player); variants: `trimsHTML` (`app.js:2922`) needs `car.trims`, which no record has; warranty is static text | T1.1, T3.4, T3.5 | L1/L2 |
| 1.2.6 | 3D Configurator *(protected)* | PARTIAL | viewer `car-3d-viewer.js` (render, orbit, `setBodyColor:1123`, hotspots `:964-1070`); save `p3-views.js:567-586` → `router.js:1796-1834` → `configurations` [R] | "Deposit now" calls an undefined `openDepositModal` (`app.js:5394`, falls back to the detail page; configuration lost) [V]; **wheel prices differ** between UI (`data.js` ≈:3933 / `app.js:4716`: 25M/65M) and server (`configuration-service.js:13-17`, `pricing-service.js:76-80`: 18M/45M); no trim/interior selection; `configurationId` not passed to the cart | T1.10, T3.6 (approval) | L1 |
| 1.2.7 | AR / Quick Look *(protected)* | **UNVERIFIED** | `ar.html`, `js/ar/apple/quick-look.js`, `apple-ar-support.js`; `data/usdz-assets.json` (24 vehicles, 58 files, all present on disk); `model-normalizer.js:27-90` [R] | Code is complete for iOS. No real-device check; `ar-manifest.json` has 0 vehicles with `arScaleCertified`. Android has no AR **by design** (`apple-ar-support.js:103`), with a 3D fallback | T6.4 (device verification only, no code) | — |
| 1.2.8 | Smart Bundle | **COMPLETE** | `router.js:1836-1870` → `accessory-service.js`, `bundle-service.js:9-178` (tiers, cap, 30-minute quote) → `cart-service.js:315-357`; UI `p3-views.js:310-470`; test `tests/integration/p3_experience.test.js` [R] | None required. (Observation: the UI always sends usage `'family'`, `p3-views.js:316`; not a required item, so **no task**.) | SKIP | — |
| 1.2.9 | Test Drive | **BROKEN** | booking `app.js:2290-2360` → `router.js:584,594` → `appointment-service.js:63-152` [R] | Admin "complete" always rejected [V]; no Confirm action; reload goes to a nonexistent tab `'dash-appointments'` (`app.js:7935`); slot fields mismatch (`app.js:2318-2327` reads `remaining`, the API returns `remainingCapacity`) so every slot shows "Đã kín" (full); booking sends `carName`, not `vehicleId` | T1.7 | L1 |
| 1.2.10 | Ordering & Payment | **BROKEN** | checkout `checkout-view.js:396-486` → `router.js:489,502` → `payment-service.js:21-117`; HMAC webhook `payment-gateway.js:36-51` [R] | **P0 payment bypass** [V]; the legacy "complete payment" form always gets 409 (`app.js:8896-8905`); **no installment mode** (only `deposit`/`full`/`balance`, `payment-service.js:38`); the refund policy (`policy-service.js:18-20`) is shown but not enforced | T0.1, T1.9, T3.7 (approval), T3.8 | L1/L2 |
| 1.2.11 | Registration | PARTIAL | `registration-service.js:28-270`; widget `registration-view.js:55-255`; routes `router.js:733-774` [R] | No staff progression UI (`ApiClient.registration.updateStatus`, `api-client.js:1863`, has no caller); fees not linked to the order total (`pricing-service.js:230`) | T2.6, T3.9 (approval) | L1 |
| 1.2.12 | Cart & Checkout | PARTIAL | `cart-service.js`, `checkout-service.js` (idempotency, price-change check, reservations, `orders.push:251`) [R] | Wheel choice dropped in the main add-to-cart path (`cart-view.js:48-57`); `configurationId` never sent (`cart-service.js:153,175` supports it) | T1.10 | L1 |
| 1.2.13 | Smart Financing | **BROKEN** | calculator `app.js:10871-10939` → `router.js:220` → `financing-service.js:140-235` (annuity, equal principal, DTI `:98-135`); application `:240-335` [R] | **Applications never load** for staff or buyers [V] → review and withdraw unreachable; offline calculator lacks `firstMonthPayment`/`affordability` (`api-client.js:281-310`); no flat-rate method; application never linked to an order | T1.2, T1.18, T3.10 | L1/L2 |
| 1.2.14 | Order Tracking | **BROKEN** | `router.js:300-306` → `order-service.js:107-130`; history `order-repository.js:108,184,258` [V] | **Timeline events render blank** [V]; sandbox returns `timeline`, not `events` (`static-sandbox.js:1591`); no live refresh; the notification template ignores status (`notification-service.js:9-12`); inbox reads `subject`/`status` instead of `title`/`deliveryStatus` (`app.js:10035-10037`) | T1.4, T2.1, T2.2 | L1 |
| 1.2.15 | Self-service Return | **BROKEN** | `router.js:1176-1245` → `ecommerce-service.js:110-619`; refunds `refund-service.js:42-204` [R] | **Uploaded photos make every request fail**: names come from signed URLs with no extension (`api-client.js:1000`) and `validateAttachments` throws (`ecommerce-service.js:85-95`) [V]; `mediaIds` dropped (`api-client.js:1002-1016`) [V]; **stage labels mismatch** [V]; admin "Hoàn tất" marks the order refunded with no ledger entry (`ecommerce-service.js:533-538`) [V]; odometer cap uses the absolute reading, not distance since handover (`:334`) | T1.5, T2.3 (approval) | L1/L2 |
| 1.2.16 | Warranty & Maintenance | PARTIAL | activation `ecommerce-service.js:755-886`; milestones `constants.js:142`; booking and history `:888-1151` [R] | Activation allowed on undelivered orders (`:790`); no VIN lookup endpoint (QR box is decorative, `app.js:9657`); computed `reminders` dropped (`api-client.js:1100-1126`); upcoming-appointment card hardcoded (`app.js:9796-9816`); `durationYears: 8` hardcoded (`api-client.js:1069`) | T1.14, T2.4 | L1/L2 |
| 1.2.17 | Battery & Charging | PARTIAL | `charging-view.js` → `router.js:1777` → `charging-service.js` → `charging-provider.js:4-102` (5 documented static stations, costs) [R] | **Battery swap stations and battery rental policy absent** (only `priceNote` strings, `data.js:3184,3344`); tariff handoff to TCO not read | T1.16, T2.5 | L0/L1 |
| 1.2.18 | My Garage | PARTIAL | `router.js:831` → `garage-service.js:8-104` (owned vehicles, service history, `savedConfigs:95`) [R] | Favorites broken (root cause in 1.2.4); saved configurations returned but not rendered in the garage tab; **no saved AI recommendations or TCO results**; field mismatches (UI `img`/`batterySoh` vs service `image`/`measuredBatterySoH`) | T1.3, T1.17, T2.7 | L1 |
| 1.2.19 | Reviews & Community | **BROKEN** | backend `router.js:1424-1556` → `ecommerce-service.js:1156-1804` (server-derived `verifiedPurchase:1473`, moderation, report, helpful) [V] | **Section never loads** (`getForVehicle` missing) [V]; delete/helpful call `delete`/`toggleHelpful`, but the client defines `remove`/`voteHelpful` (`app.js:4081,4095`) [V]; Q&A answer sends a string, so the server rejects it (`app.js:4140`, `api-client.js:1332`); "✓ ĐÃ MUA XE" badge hardcoded for all reviews (`app.js:3780`); review media and replies are UI placeholders (`app.js:3770,3797-3827`) | T1.1 | L1/L2 |
| 1.2.20 | Support Center | **BROKEN** | FAQ, tickets, replies, CSAT, SLA `ecommerce-service.js:1849-2233`; own tickets via `/support/center` [R] | **Admin status save → 422** (options `'Mới tiếp nhận'`, `'Chờ khách hàng phản hồi'` are invalid) [V]; guest lookup needs `accessToken`, which is never shown or sent (`api-client.js:1405`, `app.js:6372`); attachments fail as in returns (`app.js:6357`) [I]; `'Trung bình'` priority coerced | T1.6 | L1 |
| 1.2.21 | Product & Inventory | **BROKEN** | CRUD `router.js:192-215` → `vehicle-repository.js:330-463`; stock `router.js:328-351` → `inventory-repository.js:96-378`; promotions `router.js:368-389` [R] | **Inventory tab ReferenceError** [V]; list via nonexistent `inventory.list` (`app.js:6435`); **sellers always 403 on stock adjust** (`inventory-repository.js:375` passes a string to a record-based check, `authorization.js:136`) [V]; promotion label reads `p.active` vs `isActive`; no variants; no accessory CRUD; no promotion edit/deactivate; no movement-log view; vehicle whitelist drops many fields (`vehicle-repository.js:10-17`); public stock endpoint exposes staff `actorId` (`inventory-repository.js:330-339`) | T1.8, T0.4, T4.1–T4.4 | L1/L2 |
| 1.2.22 | Order & Customer Mgmt | PARTIAL | orders tab `app.js:6555` → `router.js:561`; handover `router.js:779` → `handover-service.js:76`; users `router.js:1074` [R] | Financing and test-drive panels broken (fixed by T1.2/T1.7); seller CRM empty (`/seller/customers`, `router.js:1081`, has no client method); `/payments/reconcile` has no UI; created admins may get one-branch scope (`router.js:1145` + `order-repository.js:47-49`) [I, verify] | T4.5, T4.6 | L1/L2 |
| 1.2.23 | After-sales Mgmt | PARTIAL | maintenance `router.js:1279-1304`; workshop `router.js:1319-1381` → `workshop-service.js`; claims `router.js:1389-1413`; UI `content-admin.js:225-393` [R] | No parts create/restock (`partsLedger` only seeded, `service-repository.js:115`); no service-center/bay/technician management UI (API exists, `router.js:1326`); no warranty void/status action | T4.7, T4.8 | L0/L1 |
| 1.2.24 | Analytics | PARTIAL | revenue/orders `analytics-service.js:30-162`; time filters `router.js:849-856`; CSV `router.js:860`; CSS bar chart `content-admin.js:80-107` [R] | Funnel stages never recorded (only `vehicle_view`); no popular vehicles/accessories; branch filter list incomplete; `POST /analytics/events` unauthenticated (injectable) | T4.9, T4.10 | L1 |
| 1.2.25 | Content & Security | PARTIAL | CMS `content-service.js:140-315`; review moderation `ecommerce-service.js:1615`; scrypt/JWT/session revocation `security.js:13-95`, `authorization.js:42-44`; idempotency (checkout, intents, refunds, webhooks) [R] | **No endpoint or UI to view `auditLogs`**; no Q&A moderation UI; default staff password `'Seller@123456'` when none sent (`router.js:1134`); payment bypass (T0.1) | T4.11, T4.12, T0.5 | L1 |
| 1.2.26 | Email & Notifications | **BROKEN** | templates and outbox `notification-service.js:8-177`; worker `outbox-worker.js`; consent, campaigns, signed unsubscribe `ecommerce-service.js:2264-2680` [R] | **Forgeable delivery webhook** [V]; outbox and campaigns drain only by manual admin call (no scheduler, `worker.mjs` has `fetch` only) [V]; deliveries endpoint has no client/UI | T0.2, T4.13, T4.14 (approval) | L1/L2 |
| 1.2.27 | Roles & Permissions | PARTIAL | roles `constants.js:4-12`; `authorize` `middleware.js:64-78`; ownership `authorization.js:62-171`; self-registration forced to buyer `auth-service.js:61` [R] | Last-admin bypass via `disabledAt` [V]; role changes not audit-logged; `ROLE_CAPABILITIES` (`constants.js:14-24`) defined but never enforced; Add Staff sends only `branchName` (`app.js:8451`), so every staff member gets `hn-caugiay` scope | T0.3, T4.15, T4.16 | L1/L2 |

---

## C. Protected components inventory

These must not be rewritten. Any task touching them is limited to the exact lines in §F.

| Component | Files | Responsibility | Evidence of function | Regression risk |
|---|---|---|---|---|
| SPA shell, views, design system | `index.html`, `js/app.js`, `css/style.css` | All pages, layout, routing | Browser E2E 19/19 (Task 4 report) | Any edit in `app.js` (11.6k lines, global state) can break unrelated views. Edits limited to cited lines. |
| API client and offline fallback | `js/api-client.js`, `js/static-sandbox.js`, `js/data.js` | HTTP, auth token, offline demo | `tests/unit/api_client_connectivity.test.js`, `static_sandbox.test.js` | Changing existing method signatures breaks callers, so **only add aliases**. |
| 3D showroom | `js/car-3d-viewer.js`, `js/p3-views.js` (configurator part), `js/libs`, `js/vendor`, `assets/**/*.glb` | Rendering, orbit, color, wheels, hotspots, exploded view | `tests/test_viewer_camera_integration.js`, `tests/test_models.js` | No engine changes at all; only button handlers outside the viewer. |
| AR | `ar.html`, `css/ar.css`, `js/ar/**`, `js/ar-manifest.js`, `data/ar-manifest.json`, `data/usdz-assets.json`, `scripts/build_usdz.js`, `backend/application/ar-manifest-service.js` | Quick Look, USDZ resolution, device detection | `tests/unit/ar_engine.test.js`, `tests/integration/ar_model_loading.test.js`, `api_proxy_ar_manifest.test.js`, E2E AR flow | No changes planned. |
| Router and middleware | `backend/api/router.js`, `middleware.js`, `http-common.js` | All `/api/v1/*` contracts | `tests/integration/*`, `tests/workers/contract.workers.js` (85 recorded requests) | New routes are inserted as **new blocks before the 404 fallback**; existing blocks are edited only for T0.x. |
| Auth and security | `backend/application/auth-service.js`, `backend/infrastructure/security.js`, `backend/domain/authorization.js`, `constants.js` | scrypt (N=16384), JWT, sessions, RBAC/ABAC | `tests/security/p0_regression.test.js`, `rbac.test.js` | Never weaken hashing or change the token format. |
| Checkout, payment, financing | `cart-service.js`, `checkout-service.js`, `pricing-service.js`, `payment-service.js`, `financing-service.js`, `payment-gateway.js`, `order-repository.js` | Money paths | `tests/integration/p1_commerce.test.js`, `tests/unit/financing.test.js` | Only T0.1 touches them before approval. |
| Persistence and D1 | `storage-engine.js`, `persistence/*`, `d1/migrations/0001-0002`, `scripts/d1/*` | Transactions, incremental D1 sync | `tests/unit/d1_state_store.test.js` (31), `npm run test:worker-runtime` | **No new SQL migration needed.** Never write D1 rows outside the state store (that would break `state_deletions`/`rev` sync). |
| Cloudflare wiring | `functions/api/v1/[[path]].js`, `wrangler.api.toml`, `_headers`, `_redirects`, `scripts/build_dist.js` | Pages → Worker binding, headers, routing | `tests/unit/pages_service_binding.test.js`, `workers_free_plan.test.js` | No binding or route changes; cron is approval-only (T4.14). |

---

## D. Additive roadmap

| Phase | Goal | Tasks | Depends on |
|---|---|---|---|
| 0 | Close security defects | T0.1–T0.5 | — |
| 1 | Fix confirmed wiring defects | T1.1–T1.18 | Phase 0 (T1.9 depends on T0.1) |
| 2 | Customer-lifecycle additions | T2.1–T2.7 | Phase 1 |
| 3 | Discovery, sales and AI additions | T3.1–T3.10 | Phase 1 |
| 4 | Administration additions | T4.1–T4.16 | Phase 1 |
| 5 | Synthetic demo data | T5.1–T5.5 | T1.1, T4.9, T5.1 |
| 6 | Integration, regression, device checks | T6.1–T6.4 | each preceding task |

Phases 2, 3 and 4 are independent of each other. Each task is one reviewable change with its own tests.

---

## E. Detailed tasks

Every task follows the same rules:
- The first step re-reads the cited lines (they may have drifted). If the finding no longer holds, stop and report.
- **Done when:** the listed tests pass, plus the full regression set in §J.
- **Rollback:** revert the task's commit (one commit per task). The only exception is noted under Phase 5.
- **API impact:** none unless stated. New endpoints are additive; existing responses only gain optional fields.

### Phase 0 — Security

- [x] **T0.1 — Block the client-forged payment flag** (F1.2.10, F1.2.25; BROKEN)
  - **Preserve:** the admin settlement path (`transactionRef`/`adminVerified` for admins) and the verified-intent path.
  - **Change:** in `router.js:575-577`, drop `verifiedByWebhook` from the body, and drop `amount` for non-admins, before calling `OrderService.completePayment`. About 4 lines; Level 2.
  - **Tests:** new `tests/security/payment_bypass.test.js`:
    - buyer + `{verifiedByWebhook:true, amount:N}` → 409 `PAYMENT_VERIFICATION_REQUIRED`;
    - buyer + a verified `paymentIntentId` → 200;
    - admin + `transactionRef` → 200.
    - Also run `p1_commerce` and `p0_regression`.
- [x] **T0.2 — Real secret for the campaign delivery webhook** (F1.2.26; BROKEN)
  - **Change:**
    - `campaign-worker.js:11`: use `config.notifications.emailWebhookSecret` (already defined in `config/index.js:139-152`) with the dev fallback only when `NODE_ENV !== 'production'`.
    - In production without a secret, the webhook answers 503 `CONFIG_ERROR`, mirroring the payment webhook rule (`config/index.js:142`).
    - About 5 lines; Level 2.
  - **Secrets:** no secret is created or rotated by this task. The operator sets `EMAIL_WEBHOOK_SECRET` (already documented in `docs/CLOUDFLARE_WORKERS_DEPLOYMENT.md` §3).
  - **Tests:** extend `tests/integration/p4_ops.test.js`:
    - a receipt signed with the dev default is rejected under production config;
    - a correctly signed receipt is accepted.
- [x] **T0.3 — Last-admin guard covers disabling** (F1.2.27; PARTIAL)
  - **Change:** `user-repository.js:138`: apply the `LAST_ADMIN_PROTECTED` check when `disabledAt` is set on an active admin. About 3 lines; Level 2.
  - **Tests:** extend `tests/security/rbac.test.js`: disabling the only admin → 409; disabling a second admin → 200.
- [x] **T0.4 — Stop leaking staff ids on the public stock endpoint** (F1.2.21)
  - **Change:** `inventory-repository.js:330-339`: omit `actorId` from `recentMovements` when the caller is anonymous or a buyer. The field is removed, the response shape is otherwise unchanged. Level 1.
  - **Tests:** anonymous `GET /inventory/:id` has no `actorId`; admin still sees it. Add to `ecommerce_subsystems.test.js`.
- [x] **T0.5 — No silent default staff password** (F1.2.25)
  - **Change:** `router.js:1134`: when `password` is missing, return 422 instead of using `'Seller@123456'`. Level 1.
  - **API impact:** callers that relied on the default now get 422. Grep shows the UI sends a password (`app.js:8451`) [R]; confirm before merging.
  - **Tests:** `rbac.test.js`: create a user without a password → 422.

### Phase 1 — Wiring defects

- [x] **T1.1 — Reviews and Q&A on the product page** (F1.2.19 BROKEN, F1.2.5)
  - **Preserve:** the existing `reviews.getByVehicle/remove/voteHelpful` methods and their callers.
  - **New in `api-client.js`** (additive methods on the `reviews` object at `:1210`):
    - `getForVehicle({vehicleId, star, verifiedOnly, sort})` returns the raw `{stats, reviews, questions, currentUserEligibility}` shape that `app.js:3593-3597` expects;
    - `delete` = `remove`, `toggleHelpful` = `voteHelpful`;
    - `answer` accepts a string.
    - About 25 lines; Level 1.
  - **Change in `app.js:3768-3803`:** render the server fields:
    - use `isOwner`, `helpfulCount`, `viewerVotedHelpful` and `media`;
    - show the verified badge only when `r.verifiedPurchase === true`, replacing the hardcoded `app.js:3780`.
    - Level 2, about 15 lines. Visual markup unchanged.
  - **Verify first:** whether `GET /reviews` returns `currentUserEligibility`. If not, derive it client-side from the login state. No server change.
  - **Tests:** a unit test of the alias mapping (new `tests/unit/reviews_client.test.js`); `ecommerce_subsystems` still green; E2E: open `#detail` and see the reviews list.
- [x] **T1.2 — Financing applications list** (F1.2.13 BROKEN, F1.2.22)
  - **Change:** add `listApplications(...a){ return this.getApplications(...a); }` at `api-client.js:585`. Level 1.
  - **Tests:** unit test (`api_client_connectivity`); manual check that the staff review panel shows applications.
- [x] **T1.3 — Favorites persist** (F1.2.4 BROKEN, F1.2.18)
  - **Change:**
    - `app.js:10847-10864`: when logged in, call `ApiClient.auth.toggleSavedCar(id)` and roll back the local toggle on error.
    - `app.js:8709`: also read `meProfile.savedCars`.
    - `app.js:10485-10490`: call the toggle only if the id is in the server set.
    - About 12 lines; Level 1.
  - **Tests:** integration `POST /auth/saved-cars` twice → added then removed (exists [R], confirm); E2E: heart → reload → still saved.
- [x] **T1.4 — Order timeline renders** (F1.2.14 BROKEN)
  - **Change:**
    - `api-client.js:615-618` `getTimeline`: map each event to also carry `label` (status), `detail` (note) and `at` (timestamp). The existing fields are kept. Level 1.
    - `static-sandbox.js:1591`: also return `events`. Level 1.
  - **Tests:** unit test of the mapping; buyer and seller timeline modals show entries.
- [x] **T1.5 — Returns submit and progress correctly** (F1.2.15 BROKEN)
  - **Change in `api-client.js:1000-1016`:**
    - forward `mediaIds`;
    - derive photo `name` from the uploaded file name (or `photo-<n>.jpg`), not from the signed URL.
    - Level 1.
  - **Change in `app.js:6669-6680` and `9167-9175`:** use the canonical labels from `RETURN_STATUS` (`constants.js:92-103`), i.e. `'Đã duyệt yêu cầu'` and `'Từ chối tiếp nhận'`. Level 1.
  - **Tests:** integration test: a return with 2 uploaded photos → 201; an admin stage change to `'Đã duyệt yêu cầu'` → 200.
  - **Not in this task:** the refund-bypass and odometer rules change business logic; see T2.3 (approval).
- [x] **T1.6 — Support tickets** (F1.2.20 BROKEN)
  - **Change:**
    - `app.js:7158`: option values from `TICKET_STATUS` (`constants.js:75-82`). Level 1.
    - `app.js:6372`: show `created.accessToken` with the ticket code and store it in `sessionStorage`. Level 1.
    - `api-client.js:1405-1406` (and `replyTicket`): send `accessToken` when present. Level 1.
    - `app.js:6357`: attachment names from the file name. Level 1.
  - **Tests:** integration: staff status update with each canonical status → 200; guest lookup with token → 200, without → 403/404 (existing behaviour kept).
- [x] **T1.7 — Test-drive slots and staff actions** (F1.2.9 BROKEN)
  - **Change:**
    - `app.js:2318-2327`: read `s.remainingCapacity ?? s.remaining`, `s.isAvailable` and top-level `homeServiceDistricts`.
    - `app.js:6939`, `7928-7938`: add a "Xác nhận" (Confirm, sends `'Đã xác nhận'`) action and send `'Hoàn thành'`; reload `'dash-testdrives'`.
    - Booking also sends `vehicleId` when known.
    - About 20 lines; Level 1. **No state-machine change.**
  - **Tests:** integration: Pending → Đã xác nhận → Hoàn thành → 200 each; slot response field names are pinned by a test.
- [x] **T1.8 — Admin Inventory tab** (F1.2.21 BROKEN)
  - **Change:**
    - Store `inventoryRows` and `promotionsList` in `AppState._sellerCache` where `renderSellerDashboard` fills the cache, and unpack them at `app.js:6553`. Level 1.
    - `app.js:6435`: call `inventory.getAll`. Level 1.
    - `app.js:7058`: use `p.isActive ?? p.active`. Level 1.
    - `inventory-repository.js:375`: `Authorization.hasBranchAccess(user, branchId)` (exported? verify; otherwise pass `{branchId}`). Level 2.
  - **Tests:**
    - `rbac.test.js`: a seller adjusts stock in their own branch → 200 and in another branch → 403; admin → 200.
    - Manual: the Inventory tab renders.
- [x] **T1.9 — Legacy "complete payment" form** (F1.2.10)
  - **Change:** `app.js:8896-8905`: replace the direct `/complete-payment` submit with opening the existing payment panel (`renderOrderPaymentPanel`, `checkout-view.js:180-190`), which creates a sandbox intent. Level 2. **Depends on T0.1.**
  - **Tests:** E2E: the remaining balance is paid via the sandbox → order shows Fully_Paid.
- [ ] **T1.10 — Configurator handoff to checkout and cart** (F1.2.6, F1.2.12)
  - **Change:**
    - `app.js:5393-5399`: call `navigateTo('checkout', {vehicleId, colorName, wheelId, configurationId})` instead of the undefined `openDepositModal`.
    - Pass `wheelId` through checkout params (`app.js:707-718`, `checkout-view.js:288-294`) and `configurationId` (`p3-views.js:595-612`).
    - Level 1. **The 3D viewer is not touched.**
  - **Not in this task:** wheel price reconciliation is a business decision (§K, R-6). Until it is decided, the server price stays authoritative, as it already is at checkout.
  - **Tests:** the existing `p3_experience` and checkout suites; a new integration test that a cart item keeps `wheelId`.
- [x] **T1.11 — AI advisor error routing** (F1.2.1)
  - **Change:** `app.js:2592`: check `consultErr.status ?? consultErr.statusCode`. Level 1.
  - **Tests:** unit/integration: a 4xx error reaches the user instead of the local fallback.
- [x] **T1.12 — Comparison rows** (F1.2.2)
  - **Change:** in the `specs` array at `p3-views.js:59-114`:
    - battery reads `evSpecs.batteryCapacity`;
    - certified cars detected via `isCertified || type === 'certified'` with SoH from `batteryHealth`;
    - add rows "Khối lượng" (`dimensionsDetail.curbWeight`) and "Thời gian sạc nhanh" (`evSpecs.fastCharge`).
    - Uses the same row markup; Level 1.
  - **Tests:** new `tests/unit/compare_specs.test.js` on the spec extraction.
- [ ] **T1.13 — TCO inputs and the hybrid default** (F1.2.3)
  - **Change in `tco-view.js:106-125,179-189`:**
    - add an optional "km/ngày" (km per day) input that fills km/month as ×30 (shown as a labelled assumption);
    - add optional kWh/100km and L/100km inputs.
    - The service already accepts both fields. Level 1.
  - **Change in `tco-service.js:133,144`:** the hybrid defaults become explicit, documented assumptions listed in `formulas[]`. Level 2.
  - **The default values need approval (§K, R-7).** The current 0/0 result is wrong, but the replacement number is a business assumption.
  - **Tests:** `tests/integration/p3_experience.test.js` (or a new unit test): a hybrid with no catalog data → non-zero cost with the assumption listed.
- [x] **T1.14 — Warranty activation rule and reminders** (F1.2.16)
  - **Change:**
    - `ecommerce-service.js:790`: require `Delivered`/`Completed` before activation. Level 2.
    - `api-client.js:1100-1126`: pass through `reminders`. Level 1.
    - `app.js:9796-9816`: render the next real `serviceAppointments` entry instead of the hardcoded card. Level 1.
  - **Tests:** activate on a Confirmed order → 409; on a Delivered order → 201.
- [x] **T1.15 — Staff branch on creation; verify admin order scope** (F1.2.27, F1.2.22)
  - **Change:**
    - `app.js:8417-8455`: option values are branch ids; send `branchId` and `branchName`. Level 1.
    - **Verify** the [I] finding that an admin created through `POST /admin/users` sees only one branch's orders (`router.js:1145`, `order-repository.js:47-49`). If confirmed, set `branchId: 'all'` for created admins at `router.js:1145`. Level 2.
  - **Tests:** `rbac.test.js`: a new seller for `hcm-q1` sees only `hcm-q1` orders; a new admin sees all.
- [x] **T1.16 — Charging tariff handed to TCO** (F1.2.17, F1.2.3)
  - **Change:** `tco-view.js`: on load, read `localStorage['sigmacar_tco_preferred_tariff']` (in a try/catch) to prefill the electricity price. Level 1.
  - **Tests:** unit test with a stubbed `localStorage`.
- [x] **T1.17 — Garage field mapping and saved configurations** (F1.2.18)
  - **Change:**
    - `app.js:9539-9541,9856`: map `image → img` and `measuredBatterySoH → batterySoh`.
    - Render `serverGarage.savedConfigs` with the existing card style.
    - Level 1.
  - **Tests:** E2E profile garage tab shows a saved configuration.
- [x] **T1.18 — Offline financing result** (F1.2.13)
  - **Change:** `api-client.js:281-310`: compute `firstMonthPayment`/`firstMonthPrincipal` and honour `repaymentMethod`, reusing the same formulas as `financing-service.js:26-96`. Level 1.
  - **Tests:** `tests/unit/financing.test.js`: offline and server results agree within 1 VND.

### Phase 2 — Customer lifecycle additions

- [x] **T2.1 — Status-aware order notification** (F1.2.14)
  - **Change:**
    - Add an `order_status_updated` template that uses `p.status` in `notification-service.js:8-61`. A new template entry is additive; Level 1.
    - `order-repository.js:266-281`: use it for status transitions. Level 1.
    - `app.js:10035-10037`: read `title ?? subject` and `deliveryStatus ?? status`. Level 1.
  - **Tests:** a status change creates a notification containing the new status.
- [x] **T2.2 — Live timeline refresh** (F1.2.14)
  - **Change:** `app.js:10566`: while the timeline modal is open, re-fetch every 30 s; stop on close or when the tab is hidden. Level 1.
  - **Free plan:** about 120 requests per open hour, so negligible against 100k/day.
  - **Tests:** unit/E2E with fake timers.
- [ ] **T2.3 — Return rules: refund ledger and odometer** (F1.2.15) — `REQUIRES_APPROVAL — NON-MINIMAL MODIFICATION`
  - This changes refund and return business rules:
    - `ecommerce-service.js:531-538`: forbid `COMPLETED` unless a `refunds` record exists;
    - `:334`, `:403`: compare `odo - order.handoverOdoKm`.
  - Level 2, but it touches the money path.
- [x] **T2.4 — Warranty lookup by VIN** (F1.2.16)
  - **New:** `backend/application/warranty-lookup-service.js`, exposing `lookupByVin(vin, user)`. It returns coverage status, start/end dates and model only — no owner data.
  - **Route:** `GET /api/v1/warranties/lookup?vin=` (login required; buyers see their own VINs; staff see their branch).
  - **Integration:** one new route block before `router.js:1256`. Level 1.
  - **Client:** `ApiClient.warranties.lookup` (additive). Wire the decorative QR/lookup box at `app.js:9657-9663`.
  - **Tests:** a new unit test for the service; RBAC: another buyer's VIN → 404.
- [x] **T2.5 — Battery swap stations and battery rental policy** (F1.2.17 MISSING sub-parts)
  - **New files:**
    - `data/battery-ecosystem.json`: reference data, clearly marked `"source": "demo_reference"` with `lastReviewed`. No real-time claims.
    - `backend/application/battery-service.js`.
    - `js/battery-view.js`, rendered inside the existing `#charging` page through one mount call in `charging-view.js`.
  - **Routes:** `GET /api/v1/charging/swap-stations` and `GET /api/v1/charging/battery-rental` (public, read-only).
  - **Integration:** two route blocks next to `router.js:1777`. Level 1. One `<script>` tag in `index.html`. Level 1.
  - **Offline:** `static-sandbox.js` gains the two GET handlers. Level 1.
  - **Tests:** new `tests/integration/battery_ecosystem.test.js`.
- [x] **T2.6 — Staff registration progression** (F1.2.11)
  - **Change:** `registration-view.js:94-255`: inside `openOrderRegistrationModal`, add staff-only status and plate controls that call the existing `ApiClient.registration.updateStatus` (`api-client.js:1863`). Level 1.
  - **Tests:** seller moves a case through the server's allowed states; a buyer does not see the controls.
- [x] **T2.7 — Garage: saved TCO results and AI recommendations** (F1.2.18 MISSING sub-parts)
  - **New files:**
    - `backend/application/garage-extras-service.js`, using two new collections, `savedTcoResults` and `savedRecommendations`. These persist automatically in D1 (verified `state-codec.js:80`).
    - `js/garage-extras-view.js`.
  - **Routes** (owner-only, max 20 per user):
    - `GET`/`POST /api/v1/garage/tco-results`, `DELETE /api/v1/garage/tco-results/:id`;
    - the same three for `/api/v1/garage/recommendations`.
  - **Integration:**
    - route blocks after `router.js:831`;
    - a "Lưu kết quả" (save result) button in `tco-view.js` and on the advisor recommendation cards (`consultation-state.js:80-123`), Level 1 each;
    - the garage view mounts `garage-extras-view.js` (one call in `app.js` near `:9539`). Level 1.
  - **API:** `/garage` stays unchanged (the extras come from their own endpoints).
  - **Tests:** a new integration test for CRUD plus ownership (another user → 404).

### Phase 3 — Discovery, sales and AI additions

- [x] **T3.1 — Advisor: height, weight and daily distance** (F1.2.1)
  - **Change:**
    - Optional inputs in `buildSidebarControlsHtml`/`readUiPreferences` (`consultation-state.js:149-259`). Level 1.
    - Accept `heightCm`, `weightKg` and `dailyKm` in `normalizePreferences` (`consultation-service.js:50-100`). Level 1.
    - A new scoring helper, `backend/application/advisor-fit-rules.js`, called once from `scoreAndConstrainVehicles` (`:151-262`). Level 1. It adds:
      - a comfort note when the body class/seat count suits tall or heavy occupants;
      - a range check of `dailyKm` against the published range.
  - **Data limit:** the catalog has no headroom or seat-height data [V], so height/weight produce **advisory reasons only, never a hard filter**, and the UI says so.
  - **Tests:** unit tests for the helper; existing `consultation` tests unchanged.
- [ ] **T3.2 — Advisor image analysis** (F1.2.1) — `REQUIRES_APPROVAL`
  - It sends customer photos to a third-party AI provider (Gemini via the existing `ai-service.js`).
  - It needs a privacy and consent decision, and an API key with a free quota.
  - **Proposed design (if approved):**
    - New `backend/application/image-analysis-service.js`, called after upload in `chatInConsultation` (`consultation-service.js:599`).
    - It extracts only what the user asked for (e.g. garage dimensions or a parking photo).
    - The result is merged into `fitContext` (`:608`); without a key, it falls back to the current behaviour.
- [x] **T3.3 — Power filter** (F1.2.4)
  - **Change:** a min-power input next to `app.js:1673-1681` and a predicate in `filterAndSortVehicles` (`app.js:270-291`). Level 1.
  - **Tests:** `tests/unit/filter_sort.test.js` gets a power case.
- [x] **T3.4 — Product videos** (F1.2.5)
  - **Data:** add an optional `videos: [{url, title, poster}]` field to the vehicle records. Admin data entry goes through the existing `PUT /vehicles/:id` once T4.1 whitelists the field.
  - **New:** `js/vehicle-media-view.js`, mounted beside `galleryStripHTML` (`app.js:3045`, one call; Level 1). It renders nothing when there are no videos.
  - **CSP:** a hosted video needs `media-src` in `_headers` to allow its origin. That needs approval (R-9). Self-hosted files under `assets/` need no change.
  - **Tests:** unit test for the renderer; existing detail page unchanged when `videos` is absent.
- [ ] **T3.5 — Variants (trims) data** (F1.2.5, F1.2.21)
  - `trimsHTML` (`app.js:2922-2946`) already renders `car.trims`. This task only adds data, through admin `PUT /vehicles/:id` after T4.1 (`trims` already partly expected by `configuration-service.js:127-176` [R]).
  - **Data shape:** `trims: [{id, name, priceDelta, specsDelta}]`.
  - **Tests:** detail page renders trims for a vehicle that has them.
- [ ] **T3.6 — Trim and interior choice in the configurator** (F1.2.6) — `REQUIRES_APPROVAL`
  - It adds controls to the protected 3D panel. The viewer engine itself is unchanged; only the panel in `p3-views.js`/`app.js:5163` sends `trimId`.
- [ ] **T3.7 — Installment ordering mode** (F1.2.10) — `REQUIRES_APPROVAL — NON-MINIMAL MODIFICATION`
  - It changes the checkout, payment and pricing state machines (`payment-service.js:38`, `checkout-service.js:28,219`).
  - **Smaller alternative (no approval needed, T3.8):** keep payment modes unchanged and link a financing application to the order.
- [x] **T3.8 — Link financing to the order** (F1.2.10, F1.2.13)
  - **Change:** on the checkout success step (`checkout-view.js`), offer "Đăng ký trả góp cho đơn này" (apply for instalments on this order). It opens the existing financing modal and passes `orderId` (already supported, `financing-service.js:257`). Level 1.
  - **Tests:** an application created with `orderId` appears in the order view.
- [ ] **T3.9 — Registration fees in the order total** (F1.2.11) — `REQUIRES_APPROVAL`
  - It changes order totals in `pricing-service.js:230`.
  - **No-approval alternative:** show the estimate as a separate, non-charged line in the checkout summary. Level 1.
- [x] **T3.10 — Flat-rate repayment method** (F1.2.13; optional)
  - **Change:** add a `flat` method to the calculator branch in `financing-service.js:26-96`. It is a new case, and the existing methods are untouched. Level 2.
  - Plus an `<option>` in `index.html:734-737`. Level 1.
  - **Tests:** extend `tests/unit/financing.test.js`; the existing annuity and equal-principal results stay identical.

### Phase 4 — Administration additions

- [x] **T4.1 — Vehicle field whitelist** (F1.2.21)
  - **Change:** `vehicle-repository.js:10-17`: add the fields the admin form already sends (power, acceleration, battery, dimensions, features, warranty, rangeFormatted), plus `trims` and `videos`. They are validated with the existing sanitisers. Level 2.
  - **Tests:** a POST and PUT round-trip keeps the fields; unknown fields are still dropped.
- [x] **T4.2 — Promotion edit and deactivate** (F1.2.21)
  - **Change:**
    - New methods `update`/`setActive` in `promotion-service.js` (additive). Level 1.
    - A route `PATCH /api/v1/promotions/:id` (admin) and client methods.
    - Edit and toggle buttons in the Inventory tab.
    - The list fetches all promotions for staff (`includeInactive=true`, a new optional query parameter).
  - **Tests:** a deactivated code fails `/promotions/validate`.
- [x] **T4.3 — Accessory administration** (F1.2.21)
  - **Change:**
    - New `create`/`update`/`archive` methods in `accessory-service.js` (additive). Level 1.
    - Routes `POST /accessories` and `PATCH /accessories/:id` (admin).
    - A new view `js/admin-accessories-view.js`, mounted from the Inventory tab with one call.
  - **Tests:** CRUD plus RBAC; existing bundle tests unchanged.
- [x] **T4.4 — Inventory movement log** (F1.2.21)
  - **Change:**
    - New route `GET /api/v1/inventory/movements?vehicleId=&branchId=&limit=` (staff, branch-scoped), reading `inventoryMovements` through a new function in `inventory-repository.js` (additive). Level 1.
    - A table in the Inventory tab.
  - **Tests:** a seller sees only their own branch's movements.
- [x] **T4.5 — Seller CRM** (F1.2.22)
  - **Change:** `ApiClient.seller.customers()` → existing `GET /seller/customers` (`router.js:1081`). `app.js:6433`: load it for sellers; admins keep the current user list. Level 1.
  - **Tests:** seller sees only branch customers.
- [x] **T4.6 — Payment reconciliation button** (F1.2.22)
  - **Change:** admin-only button calling the existing `POST /payments/reconcile` (`router.js:554`). Level 1.
  - **Tests:** existing reconcile tests; the button is hidden for sellers.
- [x] **T4.7 — Parts restock** (F1.2.23)
  - **Change:**
    - New `backend/application/parts-service.js` with `listParts`/`restock`/`create`, writing `partsLedger` movements with an audit entry.
    - Routes `GET /api/v1/workshop/parts`, `POST /api/v1/workshop/parts`, `POST /api/v1/workshop/parts/:id/restock` (service_staff and admin, branch-scoped). Level 1.
    - Panel in `content-admin.js` workshop section. Level 1.
  - **Preserve:** reservation, consumption and release in `workshop-service.js:299-510` are untouched.
  - **Tests:** a restock raises the available quantity; reservation still works.
- [x] **T4.8 — Service centers, bays and technicians UI** (F1.2.23)
  - **Change:** a new `js/admin-service-centers-view.js` using the existing `POST /workshop/resources` (`router.js:1326`), plus an `ApiClient.workshop.upsertResource` method. Level 1.
  - **Tests:** existing workshop tests; UI smoke test.
- [x] **T4.9 — Funnel instrumentation (server-side)** (F1.2.24)
  - **New:** `backend/application/analytics-hooks.js`, exposing `track(type, payload)`. It wraps `AnalyticsEventService.recordEvent` and never throws.
  - **Integration** (one call each, after the successful write, Level 1 ×4):
    - `appointment-service.js` (test_drive);
    - `checkout-service.js` near `:272` (checkout);
    - `payment-service.js` near `:319` (order_paid);
    - `handover-service.js` (handover).
  - **D1 Free budget:** the call runs inside the existing transaction, so it adds 0 extra D1 queries per request (the batch already exists).
  - **Tests:** funnel counts rise after a booking or checkout in the integration test; existing analytics tests unchanged.
- [x] **T4.10 — Popular vehicles and accessories, branch list** (F1.2.24)
  - **Change:**
    - New `backend/application/analytics-ranking-service.js` and route `GET /api/v1/analytics/top-products?dateFrom=&dateTo=&branchId=` (staff, branch-scoped like `/analytics/overview`). Level 1.
    - A ranking list in `content-admin.js:109+`. Level 1.
    - Complete the branch dropdown from the server branch list. Level 1.
  - **Tests:** a ranking over seeded orders.
- [x] **T4.11 — Audit log viewer** (F1.2.25)
  - **Change:**
    - New `backend/application/audit-log-service.js` with filters and pagination over `auditLogs` and `cmsAuditLogs`.
    - Route `GET /api/v1/admin/audit-logs` (admin only), inserted before `router.js:1173`. Level 1.
    - `ApiClient.admin.getAuditLogs`; new `js/admin-audit-view.js` added as a new admin tab (one nav entry plus one renderer call in `app.js`). Level 1.
  - **Tests:** admin → 200; seller → 403.
- [x] **T4.12 — Q&A moderation UI** (F1.2.25)
  - **Change:** in the reviews tab (`app.js:7068`), list reported questions and call the existing `PATCH /questions/:id/moderate` (`router.js:1533`). Level 1.
  - **Tests:** existing moderation tests; UI smoke test.
- [x] **T4.13 — Campaign deliveries view** (F1.2.26)
  - **Change:** `ApiClient.campaigns.getDeliveries` → existing `GET /campaigns/:id/deliveries` (`router.js:1668`); table in the campaign tab. Level 1.
- [ ] **T4.14 — Scheduled outbox and campaign processing** (F1.2.26) — `REQUIRES_APPROVAL`
  - **Proposal:**
    - add a `scheduled()` handler to `backend/cloudflare/worker.mjs` that calls `OutboxWorker.processOutboxBatch` and `CampaignWorker.processCampaignQueue`;
    - add a `[triggers] crons` entry to `wrangler.api.toml`.
  - **Why it needs approval:**
    - it changes behaviour (the docs say cron is deliberately not configured);
    - it adds a Cloudflare trigger;
    - each run must fit the Free plan's 10 ms CPU limit, so it must be measured first (batch size about 5).
  - Until approved, the admin "process outbox" button (new, Level 1) is the manual path.
- [x] **T4.15 — Audit role changes and user deletion** (F1.2.27)
  - **Change:** inside `updateRoleByAdmin` and `delete` (`user-repository.js:128-180`), push an `auditLogs` entry using the shape at `ecommerce-service.js:72`. The entry records actor, target, old and new role, and branch. Level 2. The admin id must be passed in from `router.js:1169`. Level 1.
  - **Tests:** a role change creates exactly one audit entry visible through T4.11.
- [ ] **T4.16 — Enforce `ROLE_CAPABILITIES`** (F1.2.27) — `REQUIRES_APPROVAL — NON-MINIMAL MODIFICATION`
  - It changes the authorization architecture for every route. The current role lists at the routes are correct and tested (`rbac.test.js`).
  - **Recommendation:** leave it as is. Alternatively, add a test that the matrix matches the route role lists, without enforcing it.

### Phase 5 — Synthetic demo data

The design is in §I.

- [x] **T5.1 — Generator** (new `scripts/demo/generate-demo-data.js`, Level 0)
  - It produces `data/demo/sigmacar_demo_<batch>.json`, deterministic from a seed.
  - No D1 access; no network.
- [x] **T5.2 — Exclude demo records from real metrics**
  - **Change:**
    - `analytics-service.js:30-33`: filter `!x.isDemo` by default, plus an optional admin-only `includeDemo=true` query parameter.
    - The same filter in `analytics-event-service.js` and `analytics-ranking-service.js` (T4.10).
    - Level 2, about 6 lines.
  - **Tests:** revenue with and without demo data is identical by default.
- [x] **T5.3 — Demo badge**
  - **Change:** in the review renderer (after T1.1), when `r.verifiedPurchase && r.isDemo`, show `Đã mua hàng xác minh · Demo`, and "· Demo" on demo authors. Level 1.
  - **Change:** `ecommerce-service.js:1214-1233` sanitizer: pass `isDemo` through. Level 1; an additive field.
- [ ] **T5.4 — Import to a non-production database only**
  - Use the existing importer: `node scripts/d1/json-to-d1.js --execute --env staging --merge` with the generated file. The importer never overwrites rows (verified in Task 4).
  - **Production is out of scope.**
- [x] **T5.5 — Removal** (new `scripts/demo/remove-demo-data.js`, Level 0)
  - It generates SQL that deletes `isDemo` rows **and** records each deletion in `state_deletions` with a bumped `state_revision`, mirroring `d1-state-store.js` commit semantics.
  - A raw `DELETE` would leave running Workers with stale cached rows.
  - It has a `--dry-run` that prints the counts.
  - **Rollback for Phase 5:** run the removal script. Restore from D1 Time Travel if needed (7 days on Free).

### Phase 6 — Tests and verification

- [x] **T6.1** Run the full regression set in §J after every task; record the results in `docs/` (only when implementation is approved).
- [x] **T6.2** Contract test: re-record `tests/workers/contract.workers.js`. Every new endpoint must answer identically in Node and the Worker.
- [x] **T6.3** Free-plan check: extend `tests/unit/workers_free_plan.test.js` with the new endpoints. Each should make 1–3 D1 queries and stay well under 10 ms CPU, measured as before.
- [ ] **T6.4** AR device verification (F1.2.7, no code changes):
  - on a real iPhone and iPad, open `/ar?vehicle=<id>` for at least 3 vehicles;
  - confirm Quick Look opens, the scale is 1:1 and colors match;
  - record which models can be marked `arScaleCertified`.

---

## F. Existing file modification register

These are the only existing files the plan would touch. Each change is minimal and backward compatible.

| Existing file | Why modification is necessary | Exact scope | Level | Regression risk |
|---|---|---|---|---|
| `backend/api/router.js` | Security fixes T0.1/T0.5; new routes (T2.4, T2.5, T2.7, T4.2–T4.4, T4.7, T4.10, T4.11) | T0.1: about 4 lines in `:571-578`; T0.5: about 3 lines at `:1134`; T1.15: 1 line at `:1145` (if confirmed); T4.15: pass the actor at `:1169`; new route blocks inserted, existing blocks unchanged | L1/L2 | Medium: central file; covered by the integration and contract suites |
| `backend/infrastructure/repositories/order-repository.js` | Status-aware notification | T2.1: template name in `:266-281` | L1 | Low |
| `backend/workers/campaign-worker.js` | Forgeable webhook | T0.2: `:11` secret source and a production guard | L2 | Low |
| `backend/infrastructure/repositories/user-repository.js` | Last-admin bypass; audit entries | T0.3: `:138`; T4.15: audit push in `updateRoleByAdmin`/`delete` | L2 | Medium (authorization); `rbac.test.js` |
| `backend/infrastructure/repositories/inventory-repository.js` | Seller 403; public `actorId`; movements read | T1.8: `:375`; T0.4: `:330-339`; T4.4: new function | L1/L2 | Medium; RBAC tests |
| `backend/infrastructure/repositories/vehicle-repository.js` | Fields dropped | T4.1: whitelist `:10-17` | L2 | Medium: data shape; round-trip tests |
| `backend/application/ecommerce-service.js` | Warranty rule; demo flag; (T2.3 approval only) | T1.14: `:790`; T5.3: sanitizer `:1214-1233`; T2.3: `:334,403,531-538` | L1/L2 | Medium; `ecommerce_subsystems` |
| `backend/application/tco-service.js` | Hybrid default 0 | T1.13: `:133,144` + `formulas[]` entry | L2 | Low; values need approval |
| `backend/application/notification-service.js` | New template | T2.1: one template entry `:8-61` | L1 | Low |
| `backend/application/consultation-service.js` | New preference fields and fit helper | T3.1: `normalizePreferences` `:50-100`, one call in `:151-262` | L1 | Low |
| `backend/application/promotion-service.js` | Edit/deactivate | T4.2: new methods only | L1 | Low |
| `backend/application/accessory-service.js` | Admin CRUD | T4.3: new methods only | L1 | Low (bundles depend on reads) |
| `backend/application/appointment-service.js`, `checkout-service.js`, `payment-service.js`, `handover-service.js` | Funnel events | T4.9: one `track()` call each | L1 | Low (non-throwing hook) |
| `backend/application/analytics-service.js`, `analytics-event-service.js` | Exclude demo data | T5.2: filters at `:30-33` and equivalents | L2 | Medium (revenue numbers); tests |
| `backend/application/financing-service.js` | Flat-rate method (optional) | T3.10: new branch in `:26-96` | L2 | Medium (money); exact-value tests |
| `js/api-client.js` | Wiring aliases and mappings | T1.1 `:1210-1335`; T1.2 `:585`; T1.4 `:615`; T1.5 `:1000-1016`; T1.6 `:1405`; T1.14 `:1100`; T1.18 `:281-310`; new methods for T2.4, T4.2–T4.13 | L1 | Low: additive only; existing signatures kept |
| `js/app.js` | Wiring fixes and mount points | Lines cited in T1.1, T1.3, T1.5–T1.11, T1.14, T1.15, T1.17, T2.1, T2.2, T2.7, T3.3, T3.4, T4.5, T4.6, T4.11, T4.12 | L1 (T1.1 render, T1.9: L2) | **High file risk** (11.6k lines): edit only the cited lines; no reformatting |
| `js/static-sandbox.js` | Offline parity | T1.4 `:1591`; T2.5 two GET handlers | L1 | Low |
| `js/p3-views.js` | Compare rows; `configurationId` | T1.12 `:59-114`; T1.10 `:595-612` | L1 | Low (viewer untouched) |
| `js/tco-view.js` | Inputs, tariff, save button | T1.13, T1.16, T2.7 | L1 | Low |
| `js/checkout-view.js` | `wheelId`; link financing | T1.10 `:288-294`; T3.8 success step | L1 | Medium (checkout); E2E |
| `js/cart-view.js` | `wheelId` parameter | T1.10 `:48-57` (optional parameter) | L1 | Low |
| `js/consultation-state.js` | Advisor inputs; save button | T3.1 `:149-259`; T2.7 `:80-123` | L1 | Low |
| `js/registration-view.js` | Staff controls | T2.6 inside `:94-255` | L1 | Low |
| `js/charging-view.js` | Mount the battery view | T2.5: one call | L1 | Low |
| `js/content-admin.js` | Ranking, parts panel | T4.7, T4.10 | L1 | Low |
| `index.html` | New `<script>` tags; flat-rate option | T2.5, T2.7, T3.4, T4.3, T4.8, T4.11: one tag each; T3.10 one `<option>` | L1 | Low (no layout change) |
| `.gitignore` | Keep generated demo files out of Git | T5.1: add `data/demo/` | L1 | None |

**Approval-only entries** (not to be done without approval):
- `backend/cloudflare/worker.mjs` and `wrangler.api.toml` (T4.14);
- `_headers` (T3.4 hosted video);
- `pricing-service.js`, `payment-service.js` and `checkout-service.js` beyond T4.9 (T3.7, T3.9).

---

## G. New files register

| New file | Purpose | Feature | Integration point |
|---|---|---|---|
| `tests/security/payment_bypass.test.js` | Pin T0.1 | 1.2.10 | `npm test` glob |
| `tests/unit/reviews_client.test.js` | Pin alias mapping | 1.2.19 | `npm test` |
| `tests/unit/compare_specs.test.js` | Compare rows | 1.2.2 | `npm test` |
| `backend/application/warranty-lookup-service.js` | VIN lookup | 1.2.16 | route before `router.js:1256` |
| `data/battery-ecosystem.json` | Swap and rental reference data | 1.2.17 | `battery-service.js` |
| `backend/application/battery-service.js` | Swap stations, rental policy | 1.2.17 | routes near `router.js:1777` |
| `js/battery-view.js` | Battery UI inside `#charging` | 1.2.17 | `charging-view.js` mount |
| `tests/integration/battery_ecosystem.test.js` | Tests | 1.2.17 | `npm test` |
| `backend/application/garage-extras-service.js` | Saved TCO results and recommendations | 1.2.18 | routes after `router.js:831` |
| `js/garage-extras-view.js` | Garage UI | 1.2.18 | `app.js` garage tab mount |
| `tests/integration/garage_extras.test.js` | Tests | 1.2.18 | `npm test` |
| `backend/application/advisor-fit-rules.js` | Height, weight, daily-km reasons | 1.2.1 | `consultation-service.js` scoring |
| `tests/unit/advisor_fit_rules.test.js` | Tests | 1.2.1 | `npm test` |
| `backend/application/image-analysis-service.js` | *(only if T3.2 approved)* | 1.2.1 | after upload in `consultation-service.js:599` |
| `js/vehicle-media-view.js` | Product videos | 1.2.5 | beside `app.js:3045` |
| `js/admin-accessories-view.js` | Accessory CRUD UI | 1.2.21 | Inventory tab |
| `tests/integration/admin_catalog.test.js` | Promotions, accessories, movements, whitelist | 1.2.21 | `npm test` |
| `backend/application/parts-service.js` | Parts list and restock | 1.2.23 | routes near `router.js:1319` |
| `js/admin-service-centers-view.js` | Centers, bays, technicians UI | 1.2.23 | after-sales tab |
| `tests/integration/parts_service.test.js` | Tests | 1.2.23 | `npm test` |
| `backend/application/analytics-hooks.js` | Non-throwing funnel tracking | 1.2.24 | 4 service calls |
| `backend/application/analytics-ranking-service.js` | Top vehicles and accessories | 1.2.24 | new route |
| `tests/integration/analytics_funnel.test.js` | Funnel and ranking tests | 1.2.24 | `npm test` |
| `backend/application/audit-log-service.js` | Audit log query | 1.2.25 | `GET /admin/audit-logs` |
| `js/admin-audit-view.js` | Audit tab | 1.2.25 | admin nav |
| `tests/integration/audit_logs.test.js` | Tests (incl. T4.15) | 1.2.25, 1.2.27 | `npm test` |
| `tests/integration/wiring_regressions.test.js` | API-side checks for T1.5–T1.8, T1.14, T1.15 | many | `npm test` |
| `scripts/demo/generate-demo-data.js` | Demo generator | §I | manual |
| `scripts/demo/names-vi.json` | Humorous Vietnamese name parts | §I | generator |
| `scripts/demo/review-templates-vi.json` | Review texts (humorous and realistic) | §I | generator |
| `scripts/demo/remove-demo-data.js` | Removal SQL with `state_deletions` | §I | manual |
| `tests/unit/demo_data.test.js` | Isolation invariants (§I.4) | §I | `npm test` |
| `docs/DEMO_DATA.md` | How to generate, import and remove | §I | — |
| `docs/AR_DEVICE_CHECKLIST.md` | T6.4 checklist and results | 1.2.7 | — |

Total: **34** new files (33 if T3.2 is not approved).

---

## H. API and database extension plan

### H.1 Reuse (no change)

These are already present and correct [R]:
- `/bundles/*`, `/cart/*`, `/checkout`, `/payments/intents*` and webhooks;
- `/financing/*`, `/registration/*`, `/appointments/*`, `/returns*`, `/refunds`;
- `/warranties*`, `/maintenance/*`, `/workshop/*`, `/warranty-claims*`;
- `/reviews*`, `/questions*`, `/support/*`, `/campaigns*`, `/unsubscribe`, `/cms*`;
- `/configurations*`, `/charging/stations`, `/cost-estimates/*`, `/analytics/*`, `/garage`, `/seller/customers`.

### H.2 New endpoints (all additive, all under `/api/v1`)

| Method and path | Auth | Task |
|---|---|---|
| `GET /warranties/lookup?vin=` | login; ownership/branch | T2.4 |
| `GET /charging/swap-stations`, `GET /charging/battery-rental` | public | T2.5 |
| `GET`/`POST /garage/tco-results`, `DELETE /garage/tco-results/:id` | owner | T2.7 |
| `GET`/`POST /garage/recommendations`, `DELETE /garage/recommendations/:id` | owner | T2.7 |
| `PATCH /promotions/:id`; `GET /promotions?includeInactive=true` (new optional parameter) | admin | T4.2 |
| `POST /accessories`, `PATCH /accessories/:id` | admin | T4.3 |
| `GET /inventory/movements` | staff, branch | T4.4 |
| `GET`/`POST /workshop/parts`, `POST /workshop/parts/:id/restock` | service_staff, admin | T4.7 |
| `GET /analytics/top-products` | staff, branch | T4.10 |
| `GET /admin/audit-logs` | admin | T4.11 |
| Optional parameter `includeDemo=true` on `/analytics/overview`, `/analytics/export` | admin | T5.2 |

### H.3 Backward compatibility

- No existing path, method, status code or field is renamed or removed.
- Only these behaviour changes happen, and each is a fix:
  - T0.1 rejects a forged flag;
  - T0.2 rejects receipts signed with the public default in production;
  - T0.3 rejects disabling the last admin;
  - T0.4 hides `actorId` from anonymous callers;
  - T0.5 requires a password;
  - T1.14 rejects activation before delivery.
- Each one is pinned by a test, and the contract suite (`tests/workers/contract.workers.js`) is re-recorded only for these intended differences.

### H.4 Database

- **D1 tables:** none added. Existing tables:
  - `state_documents` (one row per document; `collection`, `doc_key`, `pos`, `doc`, `rev`);
  - `state_meta`, `state_revision` with its guard trigger;
  - `state_collection_revision` (no longer written since 0002);
  - `state_deletions`, `media_blobs`, `data_migrations`.
- **New collections** (documents in `state_documents`, persisted automatically by `state-codec.js:80`):
  - `savedTcoResults`, `savedRecommendations` (T2.7).
  - `partsLedger` already exists the same way.
- **No migration needed.** If a later query needs a `json_extract` index (as `0001` does for orders), add `0003_*.sql` with `CREATE INDEX IF NOT EXISTS` only. That is additive and reversible with `DROP INDEX`.
- **Do not use** `backend/infrastructure/migrations/*.sql`, `migrations/*.sql` or `backend/infrastructure/database.js`. They are not loaded by any runtime [V].
- **Data preservation:**
  - New fields are optional, and readers default them.
  - No existing document is rewritten by a migration.
  - Demo data is removable (§I.5).
  - Before any non-local import, take a D1 export and note the Time Travel bookmark (`docs/CLOUDFLARE_WORKERS_DEPLOYMENT.md` §7).

---

## I. Synthetic demo data plan

The plan only covers the design. Nothing is generated or inserted in this phase.

### I.1 Scope

| Collection | Count | Notes |
|---|---:|---|
| `users` (role `buyer`) | 80 | Humorous Vietnamese names (e.g. *Nguyễn Văn Tốc Độ*, *Trần Thị Bốc Đầu*, *Lê Văn Hết Pin*, *Phạm Văn Full Bình*, *Đặng Thị Quên Sạc*, *Lý Văn Chạy Deadline*, *Nguyễn Thị Một Vạch Pin*, *Phan Văn Cạn Ví*), built from `names-vi.json` parts |
| `orders` | 120 | 90 Delivered/Completed, 20 Confirmed, 10 Cancelled; real catalog vehicle ids and prices |
| `reviews` | 200 | 60% realistic text, 40% humorous; ratings skewed 3–5★ |
| `questions` | 40 | with staff answers from a demo staff name |
| `appointments` | 60 | test drives, mixed showroom and home, mixed statuses |
| `supportTickets` | 40 | all priorities and statuses, with replies |
| `warranties` | 90 | one per delivered order, VIN `DEMO…` prefix (not a valid real VIN) |
| `serviceRecords`, `serviceAppointments` | 120 / 30 | maintenance milestones from `MAINTENANCE_MILESTONES` |
| `analyticsEvents` | 3,000 | view → test drive → checkout → paid, over 90 days |
| `notifications` | 150 | in-app only |

The volume is about 4,000 rows, far below the D1 Free limits (100k written rows per day, 500 MB). The state store loads collections per isolate, so check the cold-load time with the T6.3 measurement before and after the import.

### I.2 Marking

- Every record gets `isDemo: true`, `demoBatchId: "<batch>"` and an id prefix `demo-` (for example `demo-usr-0001`).
- The reserved TLD keeps addresses undeliverable: emails look like `demo-usr-0001@demo.sigmacar.invalid`.
- Phones use a fictional `0900 000 xxx` range.

### I.3 Verified demo purchases

- A review gets `verifiedPurchase: true` only if the generator also creates a demo order that is:
  - `Delivered` or `Completed`;
  - owned by the same demo user (`userId`);
  - for the same `vehicleId`.
- This is the same relationship the server already uses (`ecommerce-service.js:1156-1169`) [V]. The flag is derived from the order, never set independently, and `tests/unit/demo_data.test.js` asserts it.
- The UI shows **`Đã mua hàng xác minh · Demo`** (T5.3).

### I.4 Isolation invariants (enforced by `tests/unit/demo_data.test.js`)

1. **No demo user can log in.**
   - `passwordHash` is absent and `disabledAt` is set.
   - Verify that `auth-service.js` login handles a missing hash with the normal "wrong credentials" error. This is the first step of T5.1.
2. **Demo data never sends anything.**
   - `marketingConsent: false` for every demo user.
   - The generator writes no `outboxEvents` and no `emailCampaigns`.
   - Notifications are in-app only.
3. **No payment artefacts.** Demo orders carry no `paymentIntents`, `paymentLedger`, `webhookEvents` or `refunds`.
4. **Not counted in real metrics.** Demo records are excluded from revenue, orders, funnel and rankings by default (T5.2).
5. **No collisions.** No demo id collides with an existing id; the importer refuses to overwrite in any case.
6. **No real people.** No real person's name, email, phone or VIN is used. Names are generated from humorous parts, not taken from real customers.

### I.5 Placement and cleanup

- **Load only into local or staging D1** (`--env staging --merge`). Production is excluded unless separately approved.
- **Remove** with `scripts/demo/remove-demo-data.js --batch <id>` (`--dry-run` first).
- Removal goes through `state_deletions` and a revision bump, so running Workers drop their cached rows.
- **Fallback:** D1 Time Travel restore (7 days on Free).

---

## J. Regression prevention

Run after every task. Earlier counts come from the Task 4/5 reports (run in earlier sessions; **not re-run for this audit**):

| Suite | Command | Baseline |
|---|---|---|
| Unit, integration and security (Node) | `npm test` | 280/280 |
| Same suites through the Worker runtime and D1 driver | `npm run test:worker-runtime` | 80 pass, 1 skipped |
| Node vs Worker contract in `workerd` | `npm run test:workers` | 7/7 (83/85 identical, 2 documented differences) |
| Browser E2E incl. AR flow | `npm run test:e2e` | 19/19 |
| Build | `npm run build` | OK |
| Legacy AR/3D scripts | `node tests/test_ar_full_suite.js` etc. | 7/7, 6/6, 10/10, 8/8, 12/12 |

Coverage per protected area:

| Area | Check |
|---|---|
| UI, layout, responsive | E2E screenshots of `#home`, `#new-cars`, `#detail`, `#compare`, `#cart`, `#checkout`, `#profile`, `#seller-dashboard` at 1280 px and 390 px, before and after each Phase 1 task; diff must show only the intended element |
| Navigation | E2E hash-route walk |
| APIs | integration suites, plus the contract suite re-recorded only for intended differences |
| Authentication | `p0_regression`, `rbac`; scrypt parameters unchanged (`workers_free_plan.test.js` pins them) |
| Checkout | `p1_commerce`, `e2e-workflow` |
| Financing | `tests/unit/financing.test.js`: exact VND values unchanged for annuity and equal principal |
| Database | `d1_state_store` (31), `d1_migration_tool`, worker-runtime suite |
| 3D | `test_viewer_camera_integration.js`, `test_models.js`; manual orbit, color and hotspot check |
| AR Quick Look and USDZ | `ar_engine`, `ar_model_loading`, `api_proxy_ar_manifest`, E2E AR; real device (T6.4) |
| Cloudflare Pages and Workers | `pages_service_binding`, `pages_proxy`, `workers_free_plan`; `wrangler deploy --dry-run` |

---

## K. Risk and approval register

| # | Item | Why it needs approval | Recommendation |
|---|---|---|---|
| R-1 | T2.3 refund ledger and odometer rules | Changes return and refund business logic (money) | Approve; low effort, real defect |
| R-2 | T3.2 AI image analysis | Sends customer photos to a third party; consent, privacy and API key | Decide; the fallback is the current behaviour |
| R-3 | T3.6 trim and interior in the configurator | Protected 3D panel | Optional |
| R-4 | T3.7 installment ordering mode | Checkout and payment state machines, L3-like | Prefer T3.8 instead |
| R-5 | T3.9 registration fees in the order total | Changes order totals | Prefer the display-only alternative |
| R-6 | Wheel prices (UI 25M/65M vs server 18M/45M) | Business decision on the correct price | Decide; then one shared list |
| R-7 | TCO hybrid default consumption (T1.13) | Business assumption shown to customers | Provide a sourced value |
| R-8 | T4.14 cron for outbox and campaigns | Behaviour change; Cloudflare trigger; 10 ms CPU per run on Free | Measure first, then decide |
| R-9 | Hosted product videos (`_headers` CSP `media-src`) | Security header change | Self-host under `assets/` to avoid it |
| R-10 | T4.16 capability enforcement | Authorization architecture | Do not do; add a consistency test instead |
| R-11 | Any import into production D1, including demo data | Production data | Not planned |
| R-12 | T0.5 and T1.14 behaviour changes | A caller may rely on the old behaviour | Low; confirm the callers in the first step |
| — | Unauthenticated `POST /analytics/events` | Event injection skews analytics | Tracked; T4.9 moves the important events server-side, which makes injection less important. No change planned. |
| — | Free-plan CPU for login, registration and password change (scrypt) | Known from `docs/CLOUDFLARE_FREE_PLAN.md` | Unchanged by this plan; verify per §6 step 7 of that doc |

Tasks blocked pending approval: **T2.3, T3.2, T3.6, T3.7, T3.9, T4.14, T4.16, and the decisions R-6, R-7, R-9** (10 items).

---

## L. Final execution checklist (dependency order)

Each task is one commit and is individually testable. COMPLETE feature 1.2.8 has no task.

1. [x] T0.1 payment bypass
2. [x] T0.2 campaign webhook secret
3. [x] T0.3 last-admin guard
4. [x] T0.4 public `actorId`
5. [x] T0.5 no default staff password
6. [x] T1.1 reviews and Q&A wiring
7. [x] T1.2 financing list alias
8. [x] T1.3 favorites
9. [x] T1.4 timeline mapping
10. [x] T1.5 returns submit and stage labels
11. [x] T1.6 support tickets
12. [x] T1.7 test-drive slots and actions
13. [x] T1.8 admin Inventory tab
14. [x] T1.9 legacy payment form (after T0.1)
15. [ ] T1.10 configurator → checkout/cart (wheel price stays server-side until R-6) — PARTIAL — wheel/configurationId blocked by R-6
16. [x] T1.11 advisor error routing
17. [x] T1.12 comparison rows
18. [ ] T1.13 TCO inputs (hybrid value after R-7) — PARTIAL — hybrid default blocked by R-7
19. [x] T1.14 warranty rule and reminders
20. [x] T1.15 staff branch / admin scope (verify first)
21. [x] T1.16 tariff → TCO
22. [x] T1.17 garage mapping and saved configurations
23. [x] T1.18 offline financing result
24. [x] T2.1 status notification
25. [x] T2.2 live timeline
26. [x] T2.4 VIN lookup
27. [x] T2.5 battery swap and rental
28. [x] T2.6 registration staff controls
29. [x] T2.7 garage extras
30. [x] T3.1 advisor height, weight, daily km
31. [x] T3.3 power filter
32. [x] T3.4 product videos (self-hosted)
33. [ ] T3.5 trims data — SKIPPED — needs real product data
34. [x] T3.8 financing ↔ order link
35. [x] T3.10 flat-rate method (optional)
36. [x] T4.1 vehicle whitelist
37. [x] T4.2 promotions edit
38. [x] T4.3 accessory admin
39. [x] T4.4 movement log
40. [x] T4.5 seller CRM
41. [x] T4.6 reconcile button
42. [x] T4.7 parts restock
43. [x] T4.8 service centers UI
44. [x] T4.9 funnel instrumentation
45. [x] T4.10 rankings and branch list
46. [x] T4.11 audit log viewer
47. [x] T4.12 Q&A moderation UI
48. [x] T4.13 campaign deliveries view
49. [x] T4.15 role-change audit
50. [x] T5.1 demo generator
51. [x] T5.2 demo exclusion in analytics (before any import)
52. [x] T5.3 demo badge
53. [ ] T5.4 staging import — BLOCKED — not authorised
54. [x] T5.5 removal script
55. [x] T6.1–T6.4 regression, contract, Free-plan and AR device checks — COMPLETE (T6.1–T6.3); T6.4 UNVERIFIED (needs a real device)

After approval only: T2.3, T3.2, T3.6, T3.7, T3.9, T4.14, T4.16.

---

## M. Note on the previous `PLAN.md`

The earlier untracked `PLAN.md` was replaced by this document. A copy of it is kept outside the repository, in the
session scratchpad. It was not used as evidence because several statements don't match the code:

- It lists repositories that don't exist, such as `review-repository.js`, `support-repository.js`, `warranty-repository.js`, `audit-repository.js` and `session-repository.js`. The real set is `appointment`, `cart`, `configuration`, `content`, `inventory`, `notification`, `order`, `service`, `user` and `vehicle`.
- It describes D1 columns that don't exist (`doc_id`, `sort_order`, `payload_json`) and places tables in the wrong migration.
- It reports 0 MISSING and only 4 BROKEN groups, without the payment-bypass, inventory-tab, reviews, financing-list, timeline, returns and ticket-status defects listed above.

---

## N. Implementation progress

Appended after the audit; sections A–M above are unchanged audit evidence. Local code and local tests only: nothing
committed, pushed or deployed, and no remote database was touched. Statuses: COMPLETE (implemented and verified by
tests that were run), PARTIAL (safe sub-part done, rest blocked), BLOCKED (needs an approval in §K), SKIPPED, UNVERIFIED.

### N.1 Phase 0 — Security (all COMPLETE)

| Task | Change | Tests (run) |
|---|---|---|
| T0.1 | `backend/application/order-service.js` `completePayment`: never forwards `verifiedByWebhook`; non-admins can pass only `paymentIntentId` + `paymentMethod` (the amount comes from the verified intent). Done in the service (not the router) so every caller is covered. Also closes a second hole found during preflight: a buyer with a real deposit intent could add `amount = full price`. | new `tests/security/payment_bypass.test.js` (6) — 2 of them fail against the original code, all pass after |
| T0.2 | `backend/workers/campaign-worker.js`: HMAC key = `config.notifications.emailWebhookSecret` (EMAIL_WEBHOOK_SECRET; dev default outside production). Empty in production ⇒ 503 `CONFIG_ERROR` (fail closed). Payment webhooks unchanged. | new `tests/unit/campaign_webhook_secret.test.js` (4); `p4_ops` unchanged |
| T0.3 | `user-repository.js` `updateRoleByAdmin`: disabling the last active admin ⇒ 409 `LAST_ADMIN_PROTECTED` (same as demotion). Re-enabling is never blocked. | new `tests/security/last_admin_guard.test.js` |
| T0.4 | `router.js` `GET /inventory/:id`: `actorId` and `referenceId` (internal order ids) removed from `recentMovements` for anonymous callers and buyers; staff unchanged. No frontend reads these fields. | new `tests/security/inventory_privacy.test.js` (3) |
| T0.5 | `router.js` `POST /admin/users`: missing password ⇒ 400 `VALIDATION_ERROR` (router's existing validation style; the plan said 422). The UI form already requires a password. `p0_regression` SIG-P0-003 relied on the old default and now sends a password. | `last_admin_guard.test.js`, `p0_regression` |

### N.2 Phase 1 — Wiring defects

| Task | Status | Change |
|---|---|---|
| T1.1 | COMPLETE | `api-client.js`: `reviews.getForVehicle` (raw server shape), `delete`, `toggleHelpful` aliases; `answerQuestion` accepts a string. `app.js` review card: `isOwner`, `helpfulCount`, `viewerVotedHelpful`, the review's own `media` (hard-coded sample photos removed), verified badge only when `verifiedPurchase` (+ `· Demo` label for `isDemo`), two missing avatar images replaced by existing assets. Browser check: original files show "Không thể tải mục đánh giá", fixed files render the section. |
| T1.2 | COMPLETE | `financing.listApplications` alias. |
| T1.3 | COMPLETE | `auth.setSavedCar(id, wanted)` (toggles back if the server state had drifted); card heart persists; profile hydrates `savedCars`; profile "remove" can no longer add a car. |
| T1.4 | COMPLETE | `orders.getTimeline` adds `label/detail/at`; offline sandbox returns `events`. |
| T1.5 | COMPLETE | `returns.create` forwards `mediaIds` and stops resending signed media URLs as photos; return stage labels use `RETURN_STATUS`. Business-rule part (refund ledger, odometer) is T2.3 — BLOCKED. |
| T1.6 | COMPLETE | Ticket status options = `TICKET_STATUS`; guest `accessToken` stored per session, sent on lookup/reply/rate and shown in the confirmation toast; attachment names without query string. |
| T1.7 | COMPLETE | `appointments.getSlots` maps `remainingCapacity`/`isAvailable`/`homeServiceDistricts`; staff "Xác nhận" + "Hoàn thành" with canonical statuses, reload `dash-testdrives`; booking sends `vehicleId`. Browser check: slots were all "Đã kín" before, now show capacity. |
| T1.8 | COMPLETE | Inventory tab ReferenceError fixed (cache unpacked); `inventory.list` alias; promotion label reads `isActive`; `inventory-repository.js` branch check gets a record (sellers can adjust their own branch). Browser check: original files throw `inventoryRows is not defined`, fixed files render 24 rows. |
| T1.9 | COMPLETE | Legacy pay form opens the existing order payment panel (`#checkout` with `orderId`) instead of self-certifying. |
| T1.10 | PARTIAL | "Đặt cọc ngay" in the 3D showroom goes to checkout with the vehicle and catalog colour (was an undefined function). Passing `wheelId`/`configurationId` is BLOCKED by R-6: the server would charge 18M/45M while the configurator shows 25M/65M. 3D viewer untouched. |
| T1.11 | COMPLETE | Advisor error check reads `err.status`. |
| T1.12 | COMPLETE | Compare rows read `evSpecs.batteryCapacity`, certified flags and `batteryHealth`; new rows "Khối lượng không tải", "Thời gian sạc nhanh". |
| T1.13 | PARTIAL | Optional km/ngày (×30), kWh/100km (EV only) and L/100km (petrol/hybrid only) inputs. Hybrid default consumption is BLOCKED by R-7 (a hybrid still shows 0 unless the user enters L/100km). |
| T1.14 | COMPLETE | Warranty activation requires Delivered/Completed; `reminders` passed through; "Lịch hẹn sắp tới" shows the real next service appointment or reminder. |
| T1.15 | COMPLETE | Add Staff sends `branchId` (option attribute; labels unchanged); verified the [I] finding — created admins were limited to one branch — and created admins now get `branchId: 'all'`. |
| T1.16 | COMPLETE | TCO page reads the station tariff saved from the charging page (one-time handoff). |
| T1.17 | COMPLETE (moved) | Garage field mapping (`image`, `fuel`, `measuredBatterySoH`). Rendering saved configurations is done in T2.7's garage-extras view instead of a second `app.js` edit. |
| T1.18 | COMPLETE | Offline financing mirrors the server (first/last month, method, DTI); exact equality tested for 3 cases. |

Phase 1 tests (run): new `tests/unit/api_client_wiring.test.js` (15), new `tests/integration/wiring_regressions.test.js` (4).

### N.3 Test isolation fix (pre-existing issue)

`tests/ai_service.test.js` (unchanged assertions) rewrote `data/sigmacar_store.json` on every `npm test` and raced with
`p1_commerce` SIG-P1-001 ("dry-run must not touch the store"), which failed once during this work. The storage engine
ignores `SIGMACAR_STORAGE_MODE` by design but honours `SIGMACAR_DATA_FILE`, so new `tests/helpers/isolated-store.js`
points such tests at a temporary copy. The repository seed file now stays unchanged after test runs.

### N.4 Regression runs

| Point | `npm test` | `test:worker-runtime` | `test:workers` | `test:e2e` | `build` |
|---|---|---|---|---|---|
| Before work | 280/280 (earlier session) | 80 + 1 skipped | 7/7 | 19/19 | OK |
| After Phase 0 | 294/294 | 90 + 1 skipped | 7/7 | 19/19 | OK |
| After Phase 1 | 313/313 | 94 + 1 skipped | 7/7 | 19/19 | OK |
| After Phase 2 | 320/320 | 101 + 1 skipped | 7/7 | 19/19 | OK |
| After Phases 3–5 | 356/356 | 109 + 1 skipped | 7/7 (after the N.10 normaliser fix; 6/7 before it) | 19/19 | OK |

Legacy AR/3D scripts after Phases 3–5 (`tests/test_ar_full_suite.js`, `test_ar_phase1.js`, `test_gyro.js`,
`test_models.js`, `test_viewer_camera_integration.js`): all exited 0 (6/6 and 10/10 where the script prints totals).

Browser smoke check (local Chrome, desktop 1280 px and mobile 390 px, original vs patched frontend files): no page
errors after the fixes; unchanged pages identical by eye (byte differences come from animations); changed pages keep
their layout.

### N.5 Phase 2 — Customer lifecycle

| Task | Status | Change / evidence |
|---|---|---|
| T2.1 | COMPLETE | New `order_status_updated` template (Vietnamese status labels); status changes use it; inbox reads `title` / `deliveryStatus`. Test: `tests/integration/phase2_lifecycle.test.js`. |
| T2.2 | COMPLETE | Timeline modal re-fetches every 30 s while open and visible; timer cleared on close. Browser check with a fake clock: 1 call on open, 2 after 31 s, still 2 after closing + 65 s. |
| T2.3 | BLOCKED | Refund ledger / odometer rules — approval R-1. |
| T2.4 | COMPLETE | New `warranty-lookup-service.js`, `GET /warranties/lookup?vin=` (owner / branch staff / admin; others 404; no personal fields); the garage QR box now runs the lookup. API tests. |
| T2.5 | COMPLETE | New `data/battery-ecosystem.json` (marked `demo_reference`), `battery-service.js`, `GET /charging/swap-stations`, `GET /charging/battery-rental`, `js/battery-view.js` under the charging page; offline fallback reads the same public file (added to the `server.js` and `build_dist.js` public allowlists). API tests + browser check (desktop/mobile). |
| T2.6 | COMPLETE | Staff-only "next step" control in the registration modal (server transitions unchanged). Browser check: admin moves a submitted case to `tax_filing`; the buyer does not see the control. |
| T2.7 | COMPLETE | New `garage-extras-service.js` (collections `savedTcoResults`, `savedRecommendations`; owner-only; whitelisted fields), routes `GET/POST /garage/{tco-results,recommendations}`, `DELETE …/:id`; `js/garage-extras-view.js` in the "Xe đã lưu" tab (saved 3D configurations, TCO results, AI recommendations); "Lưu vào Gara" on TCO results and "💾 Lưu" on advisor cards. API + browser checks. |

### N.6 Phase 3 — Discovery, sales and AI

| Task | Status | Change / evidence |
|---|---|---|
| T3.1 | COMPLETE | `advisor-fit-rules.js`: daily km vs EV range; height/weight give advisory reasons/notes only (catalog has no headroom data), never exclude a car. Optional inputs in the advisor sidebar; `heightCm`/`weightKg` validated in `normalizePreferences`. Test: `tests/unit/advisor_fit_rules.test.js`. |
| T3.2 | BLOCKED | Third-party image analysis — approval R-2. |
| T3.3 | COMPLETE | "Công suất tối thiểu (HP)" filter (state, URL, summary, reset) using `hp` or the power string. Test: `tests/unit/power_filter.test.js`; browser: `?minPowerHp=1000` → 4 cars. |
| T3.4 | COMPLETE (no data) | `js/vehicle-media-view.js` renders an optional `videos` field under the gallery, self-hosted `assets/*.mp4|webm` only (R-9 not needed); `.mp4/.webm` MIME types in `server.js`. No video files exist yet, so nothing is shown today. Test: `tests/unit/vehicle_media_view.test.js`. |
| T3.5 | SKIPPED | Trim data needs real product variants and prices; inventing them would be fabricated product data. `trims` is now storable (T4.1) and already rendered by the detail page. |
| T3.6 / T3.7 / T3.9 | BLOCKED | Approvals R-3, R-4, R-5. |
| T3.8 | COMPLETE | "Đăng ký trả góp cho đơn này" on the order payment panel opens the existing financing modal with `orderId` (server ownership check already existed and is covered by `p2_services`). Needed exposing `window.openLoanCalculatorModal` / `window.showToast` from `app.js` (they were scoped inside `DOMContentLoaded`; this also makes the existing `charging-view.js` toasts work). Browser check: button → modal. |
| T3.10 | COMPLETE | Flat-rate ("lãi phẳng") method in `financing-service.js`, the offline calculator and the method dropdown. Annuity / equal-principal outputs are byte-identical to HEAD (pinned in `tests/unit/financing_flat_rate.test.js`); offline = server for flat rate too. |

### N.7 Phase 4 — Administration

| Task | Status | Change / evidence |
|---|---|---|
| T4.1 | COMPLETE | Vehicle whitelist adds the admin form's fields + `trims` / `videos`, with element-wise validation (features sanitised, trims normalised, videos self-hosted only). |
| T4.2 | COMPLETE | `PATCH /promotions/:id` (admin any; seller own-branch only); inactive codes listed only for staff (`?activeOnly=false` is ignored for anonymous callers — previously public). |
| T4.3 | COMPLETE | `POST /accessories`, `PATCH /accessories/:sku` (admin); archived SKUs hidden from the catalog; seeded compatibility rules untouched. |
| T4.4 | COMPLETE | `GET /inventory/movements` (staff, branch-scoped; registered before `/inventory/:vehicleId`). |
| T4.5 / T4.6 | COMPLETE | Seller CRM list (existing `/seller/customers`) and admin "Chạy đối soát" (existing `/payments/reconcile`) in the dashboard. |
| T4.7 | COMPLETE | `parts-service.js`: list / create / restock with `partsMovements` + audit entries; reservation logic unchanged. |
| T4.8 | COMPLETE | Service center / bay / technician form using the existing `POST /workshop/resources`. |
| T4.9 | COMPLETE | `analytics-hooks.js`: test_drive / checkout / order_paid / handover recorded server-side inside the existing transaction (0 extra D1 queries), deduplicated per business object, never throws. `GET /analytics/funnel` adds `serverVerifiedCounts` (source `server`) — the existing `counts` and the public `POST /analytics/events` contract are unchanged (restricting that endpoint would break `p4_ops`; see N.9). |
| T4.10 | COMPLETE | `analytics-ranking-service.js` + `GET /analytics/top-products` (same scope rules as the overview via the now-exported `getScopedRecords`). |
| T4.11 | COMPLETE | `audit-log-service.js` + `GET /admin/audit-logs` (admin, filters, paging); shown in the CRM tab for admins (no navigation change). |
| T4.12 / T4.13 | COMPLETE | Q&A moderation and campaign delivery history panels (existing endpoints). |
| T4.14 | BLOCKED | Cron trigger — approval R-8. |
| T4.15 | COMPLETE | Role changes and user deletions write `USER_ROLE_UPDATED` / `USER_DELETED` audit entries (acting admin passed from the router). |
| T4.16 | BLOCKED | Capability enforcement — approval R-10. |

UI for T4.2–T4.13 lives in one new module, `js/admin-extras-view.js`, mounted below the active dashboard tab
(`app.js`: one `<div>` + one call) instead of the four view files listed in §G. Tests:
`tests/integration/phase4_admin.test.js` (8); browser check of every dashboard tab as admin and the CRM tab as seller.

### N.8 Phase 5 — Synthetic demo data

| Task | Status | Change / evidence |
|---|---|---|
| T5.1 | COMPLETE | `scripts/demo/generate-demo-data.js` (+ `names-vi.json`, `review-templates-vi.json`): deterministic, offline, writes git-ignored `data/demo/`. Volumes exactly as §I.1; accepted by `json-to-d1.js --validate` (0 errors). |
| T5.2 | COMPLETE | `isDemo` records excluded from overview, CSV, rankings and funnel; admin-only `includeDemo=true`. |
| T5.3 | COMPLETE | Review sanitizer passes `isDemo`; the card shows "✓ Đã mua hàng xác minh · Demo". |
| T5.4 | BLOCKED | Staging import not authorised. Procedure (backup, dry run, `--merge`) in `docs/DEMO_DATA.md`. |
| T5.5 | COMPLETE | `scripts/demo/remove-demo-data.js` writes SQL that bumps `state_revision`, records `state_deletions` and deletes only `isDemo` rows of the batch; verified on the real D1 schema (SQLite shim). |

Tests: `tests/unit/demo_data.test.js` (10) — volumes, flags, logins refused, no outbound/payment artefacts,
verified ⇔ matching delivered order, real catalog ids only, determinism, removal SQL, batch-id injection rejected.

### N.9 Phase 6 — Verification

| Task | Status | Notes |
|---|---|---|
| T6.1 | COMPLETE | Full suites at every phase boundary (N.4). |
| T6.2 | COMPLETE | Node vs Worker contract test 7/7 (see N.10). |
| T6.3 | COMPLETE | `workers_free_plan.test.js` measures the new endpoints through the Worker runtime + D1 driver: 1–3 D1 queries, ~1–4 ms CPU each (machine estimate). `GET /workshop/parts` writes 41 rows once (existing workshop seeding on first access, same as `/workshop/resources`). |
| T6.4 | UNVERIFIED | Needs a real iPhone/iPad; checklist in `docs/AR_DEVICE_CHECKLIST.md`. No model marked `arScaleCertified`. |

Residual risk (not changed, needs approval): the public `POST /analytics/events` still accepts every funnel event type
(existing contract, asserted by `p4_ops`). Real stages are now also recorded server-side (`serverVerifiedCounts`).

### N.10 Test fix: flaky Node-vs-Worker comparison (pre-existing)

`tests/workers/contract.workers.js` compares Node and Worker responses after masking random values. Sandbox payment
references are `<PROVIDER>_<Date.now() base36>_<hex>`; with the current date the base36 part is often all letters, which
the existing "opaque id" fallback cannot mask inside a sentence, so the test failed twice (6/7) on an unchanged note.
One normaliser rule now masks these references; the test passed 7/7 twice afterwards.
