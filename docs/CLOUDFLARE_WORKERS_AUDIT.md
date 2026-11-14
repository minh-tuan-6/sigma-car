# SIGMA CAR — Backend Audit for Cloudflare Workers + D1

Phase 0 audit, 2026-11-14, repository at commit `746889f`. Every statement below comes from reading the code in this
repository, running it, or the Cloudflare documentation pages cited in `CLOUDFLARE_WORKERS_COMPATIBILITY.md`.
No files were changed during the audit.

Companion documents:

| Document | Content |
|---|---|
| `CLOUDFLARE_WORKERS_COMPATIBILITY.md` | Per-dependency Workers compatibility matrix |
| `CLOUDFLARE_D1_MIGRATION_PLAN.md` | Target design, D1 schema, data migration, stages, tests, rollback |
| `WORKERS_MIGRATION_BASELINE.md` | Test and build results before any change |

---

## 1. Current architecture

```text
Browser (index.html, ar.html, js/**)                    — static files on Cloudflare Pages (dist/)
   │  same-origin fetch  /api/v1/*                       — js/api-client.js, js/ar/manifest/manifest-client.js
   ▼
Pages Function  functions/api/v1/[[path]].js             — reverse proxy, fixed upstream SIGMA_BACKEND_ORIGIN,
   │  + X-Sigma-Proxy-Secret, X-Forwarded-*                strips client proxy-secret, 25 s timeout, HTML guard
   ▼
Node.js  server.js  (http.createServer)                  — CORS + security headers, static allowlist, /api/v1 router
   ▼
backend/api/router.js  (171 endpoints, one function)     — auth, rate limit, body parsing, dispatch
   ▼
backend/application/*  (32 services) + backend/workers/* (3 "workers", run only when an admin endpoint is called)
   ▼
backend/infrastructure/storage-engine.js                 — the database: ONE in-memory object (dbState) holding
                                                           every collection; runInTransaction() = process mutex +
                                                           JSON snapshot rollback + full-file atomic rewrite
   ▼
data/sigmacar_store.json  (tmp file + rename)
```

**Production status found during the audit.** The Pages Function returns `503 BACKEND_NOT_CONFIGURED` because no
`SIGMA_BACKEND_ORIGIN` is set (docs/API_FIX_REPORT.md, docs/CLOUDFLARE_DEPLOYMENT.md). No production Node backend
has been running, so **no production business data exists anywhere**. The only data is the repository snapshot
`data/sigmacar_store.json` (catalog + demo records, see §5.6).

## 2. Backend architecture audit

| # | Area | Finding (file) |
|---|---|---|
| 1 | HTTP server / entry | `server.js`: Node `http.createServer`; `/api/v1/*` → `handleApiRequest(req, res)`; `/api/llm-status`, legacy `/api/ollama-proxy` (disabled by default); static allowlist; `server.requestTimeout`. No framework. |
| 2 | Routing | `backend/api/router.js`: one 1,886-line function of `if (pathname … && method …)` blocks. Uses Node `req`/`res` objects directly (`res.writeHead`, `res.end`, `res.setHeader`, `req.headers`, `req.on('data')`). |
| 3 | Controllers | Inline in the router; they call services and serialise with `sendJSON`/`sendError` (`backend/api/middleware.js`). |
| 4 | Application services | 32 files in `backend/application/`. They read `dbState.<collection>` synchronously and write inside `runInTransaction(async state => …)`. |
| 5 | Domain | `backend/domain/constants.js`, `state-machines.js`, `authorization.js` (pure JS, runtime-independent; `authorization.resolveActor` reads `dbState.users`). |
| 6 | Persistence | `storage-engine.js` (in-memory state + JSON file) and 10 thin repositories over it. `backend/infrastructure/database.js` + `migrations/M1–M7.sql` + `scripts/migrate-json-to-sql.js` are a **one-way, lossy export** (36 tables for 60 collections; e.g. `vehicles` has 22 columns for 52 JSON fields). The runtime never reads SQL. |
| 7 | Authentication | `security.js`: HS256 JWT built with `crypto.createHmac`, `timingSafeEqual`, `exp`, random `jti`; `authorization.resolveActor` re-reads the user on every request and rejects tokens whose `sessionVersion` is stale or whose user is disabled. Bearer header only. |
| 8 | Authorization | Role lists per route (`authorize(req, res, [ROLES…])`) + service-level ownership and branch-scope checks (`domain/authorization.js`). |
| 9 | Sessions / cookies | No cookies are set anywhere (`Set-Cookie` does not occur in `backend/` or `server.js`). Logout/password change bump `sessionVersion`. |
| 10 | Rate limiting | `Security.checkRateLimit`: in-memory `Map`, fixed 60 s window, 240 req/min/IP default; separate login limit. Client IP from socket, or `CF-Connecting-IP`/`X-Forwarded-For` only when `TRUST_PROXY=true` or the proxy secret is valid. |
| 11 | Background jobs / timers | **None scheduled.** `server.js` starts no timers. Outbox, campaign queue, payment reconciliation, reservation expiry and media purge run only when an admin calls their endpoint. |
| 12 | File uploads | `POST /media/upload`: base64 JSON body, ≤ 5 MB, magic-byte sniffing, EXIF strip, EICAR quarantine; bytes written to `data/runtime_media/` (`media-storage.js`), metadata in `mediaAssets`; HMAC-signed download links. |
| 13 | Email | `email-provider.js`: SMTP over `net`/`tls` sockets when `SMTP_HOST` is set; HTTP webhook when `EMAIL_WEBHOOK_URL` is set; otherwise a local sandbox queue (default; nothing is sent). |
| 14 | Payments | `payment-gateway.js`: **sandbox only** (Napas/VNPay/MoMo sandbox labels, manual transfer). No network calls; provider refs generated locally; HMAC-SHA256 webhook verification; refunds simulated. No live provider exists in the code. |
| 15 | External APIs | `charging-provider.js` / `ai-tools.js` (`fetch` with timeout to a charging dataset), LLM APIs. |
| 16 | AI | `ai-service.js`: `@google/genai` SDK with REST fallback, Groq/OpenAI via `fetch`, local rule-based fallback. Keeps an in-memory knowledge base built from `dbState.vehicles` **at module load**, and an admin-editable provider config persisted in `dbState.meta.aiConfig`. |
| 17 | AR manifest | `ar-manifest-service.js`: reads `data/ar-manifest.json`, `assets/models/manifests/bindings.json`, `data/usdz-assets.json` with `fs`, and checks USDZ file existence with `fs.existsSync`. Pure computation otherwise. Same builder emits the static snapshots in `dist/data/ar/`. |
| 18 | Configuration | `backend/config/index.js`: reads `.env` with `fs` and `process.env` **at module load**; refuses production boot without a strong `JWT_SECRET`; ephemeral random JWT secret outside production. |
| 19 | Logging / errors | `console.*`; router `catch` returns `err.message` to the client with `err.statusCode || 400`; `server.js` catches anything else as 500. |
| 20 | Node-specific dependencies | `fs`, `path`, `http`, `net`, `tls`, `url.parse`, `crypto` (32 files), `Buffer`, `process.env/uptime/pid`, `node:sqlite` (export script only), npm `@google/genai`. No native addons, no `child_process`, no `worker_threads`. |

### 2.1 Node runtime dependency graph

```text
server.js ── http, fs, path (static files, listen)                  ← replaced by a Worker entry (no static serving)
  └─ router.js ── url.parse, process.uptime
       ├─ middleware.js ── crypto, Buffer, req.on('data'), req.socket ← Node req/res shim
       ├─ config/index.js ── fs (.env), path, process.env            ← env injection before first request
       ├─ storage-engine.js ── fs, path, process.pid                 ← D1 state store driver (the real change)
       │    └─ every service and repository (dbState, runInTransaction)
       ├─ media-storage.js ── fs, path, Buffer                       ← D1 blob driver
       ├─ email-provider.js ── net, tls (SMTP)                       ← webhook mode; SMTP unverified
       ├─ ar-manifest-service.js ── fs, path                         ← bundled JSON sources
       ├─ ai-service.js ── @google/genai, fetch                      ← works with fetch; KB/config re-sync after load
       └─ security.js / payment-gateway.js / … ── crypto             ← node:crypto supported
database.js ── node:sqlite, fs   (scripts/tests only, not on the request path)
```

## 3. Workers compatibility (summary)

Full matrix: `CLOUDFLARE_WORKERS_COMPATIBILITY.md`. Only two components need an architectural replacement:
the **storage engine's file persistence** and the **media blob directory**. Everything else runs with
`nodejs_compat`, a request/response shim, or a narrowly scoped data-source injection.

## 4. API inventory

171 endpoints, all under `/api/v1/`. Generated from `router.js` by static analysis (route conditions, `authorize`
role lists, `body.*`/`query.*` fields read in the route block, service calls, and the collections those service
modules touch), then checked by hand for the special cases.

Common contract for every endpoint:

- Success: `{"success": true, "data": …}` (some add `"message"`), `Content-Type: application/json; charset=utf-8`,
  `Cache-Control: no-store` (AR manifest: `public, max-age=60`), `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `X-Request-Id`.
- Error: `{"success": false, "error": {"code", "message", "details"?}}`. 401 `UNAUTHORIZED`, 403 `FORBIDDEN`,
  403 `PROXY_SECRET_REQUIRED`, 404 `ROUTE_NOT_FOUND`, 413 `PAYLOAD_TOO_LARGE`, 400 `BAD_JSON`, 429 `RATE_LIMITED`,
  409 version conflicts with `details.currentVersion`, service-specific codes otherwise.
- Request bodies: JSON ≤ `MAX_JSON_BODY_BYTES` (1 MiB); the Pages proxy caps at 10 MiB.
- Auth: `Authorization: Bearer <JWT>`. "optional" = the route calls `authenticate(req)` and works anonymously.
- `server.js` adds CORS (`Access-Control-Allow-*`), `Permissions-Policy`, `Referrer-Policy` and answers `OPTIONS` with 204.

The "Collections" column lists what the handler's modules can touch (reads or writes), which is wider than what a
single call uses. The AR showroom uses rows 7–10 (catalog, detail, AR manifest) and the static `/data/ar/<id>.json`
snapshot as a fallback (`js/ar/manifest/manifest-client.js`).

| # | Method | Path | Auth | Handler | Request | Success | Collections (via handler module) | External | Workers path (planned; verification in CLOUDFLARE_WORKERS_TEST_REPORT.md) | Migration risk |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/health` | public (before proxy-secret and rate-limit checks) | inline (router.js:57) | — | 200 | vehicles (count only) | — | process.uptime (nodejs_compat); storageMode reports "d1" | low |
| 2 | POST | `/api/v1/auth/register` | public | AuthService.register (router.js:80) | JSON body (passed whole to service) | 201 | users | — | D1 state store adapter | high |
| 3 | POST | `/api/v1/auth/login` | public | AuthService.login (router.js:86) | JSON body (passed whole to service) | 200 | users | — | D1 state store adapter | high |
| 4 | POST | `/api/v1/auth/logout` | any signed-in user | AuthService.logout (router.js:92) | — | 200 | users | — | D1 state store adapter | high |
| 5 | POST | `/api/v1/auth/refresh` | any signed-in user | AuthService.refreshToken (router.js:99) | — | 200 | users | — | D1 state store adapter | high |
| 6 | GET | `/api/v1/auth/me` | any signed-in user | AuthService.getProfile (router.js:106) | — | 200 | users | — | D1 state store adapter | low |
| 7 | GET | `/api/v1/vehicles` | public | VehicleRepository.findPaginated, VehicleRepository.findAll (router.js:116) | query: category, fuel, brand, minPrice, maxPrice, minRange, maxRange, minBatteryKwh, maxMonthlyPayment, usage, inStock, search, sort, type, includeArchived, page, pageSize, paginated | 200 | branchInventory, certifiedVehicles, inventoryMovements, orders, reservations, vehicles | — | D1 state store adapter | low |
| 8 | GET | `/api/v1/vehicles/certified` | public | VehicleRepository.findCertified (router.js:152) | query: maxPrice, search | 200 | branchInventory, certifiedVehicles, inventoryMovements, orders, reservations, vehicles | — | D1 state store adapter | low |
| 9 | GET | `/api/v1/vehicles/:id/related` | public | VehicleRepository.findRelated (router.js:161) | — | 200 | branchInventory, certifiedVehicles, inventoryMovements, orders, reservations, vehicles | — | D1 state store adapter | low |
| 10 | GET | `/api/v1/vehicles/:id/ar-manifest` | public | VehicleRepository.findById, ArManifestService.buildArManifest (router.js:167) | — | 200 | branchInventory, certifiedVehicles, inventoryMovements, orders, reservations, vehicles | — | D1 state store adapter; bundled AR sources | low |
| 11 | GET | `/api/v1/vehicles/:id` | public | VehicleRepository.findById (router.js:183) | — | 200 | branchInventory, certifiedVehicles, inventoryMovements, orders, reservations, vehicles | — | D1 state store adapter | low |
| 12 | POST | `/api/v1/vehicles` | admin, seller | VehicleRepository.create (router.js:192) | JSON body (passed whole to service) | 201 | branchInventory, certifiedVehicles, inventoryMovements, orders, reservations, vehicles | — | D1 state store adapter | medium |
| 13 | PUT | `/api/v1/vehicles/:id` | admin, seller | VehicleRepository.update (router.js:200) | JSON body (passed whole to service) | 200 | branchInventory, certifiedVehicles, inventoryMovements, orders, reservations, vehicles | — | D1 state store adapter | medium |
| 14 | DELETE | `/api/v1/vehicles/:id` | admin | VehicleRepository.delete (router.js:209) | — | 200 | branchInventory, certifiedVehicles, inventoryMovements, orders, reservations, vehicles | — | D1 state store adapter | medium |
| 15 | POST | `/api/v1/financing/calculate` | public | FinancingService.calculateLoan (router.js:220) | JSON body: vehiclePrice, downPaymentPercent, annualInterestRatePercent, termMonths, repaymentMethod, includeSchedule, monthlyIncome, monthlyObligation | 200 | certifiedVehicles, financingApplications, orders, vehicles | — | D1 state store adapter | medium |
| 16 | POST | `/api/v1/financing/applications` | any signed-in user | FinancingService.submitApplication (router.js:235) | JSON body (passed whole to service) | 201 | certifiedVehicles, financingApplications, orders, vehicles | — | D1 state store adapter | medium |
| 17 | GET | `/api/v1/financing/applications` | any signed-in user | FinancingService.listApplications (router.js:243) | — | 200 | certifiedVehicles, financingApplications, orders, vehicles | — | D1 state store adapter | low |
| 18 | PATCH | `/api/v1/financing/applications/:id/review` | any signed-in user | FinancingService.reviewApplication (router.js:250) | JSON body (passed whole to service) | 200 | certifiedVehicles, financingApplications, orders, vehicles | — | D1 state store adapter | medium |
| 19 | GET | `/api/v1/financing/applications/:id` | any signed-in user | FinancingService.getApplicationById (router.js:259) | — | 200 | certifiedVehicles, financingApplications, orders, vehicles | — | D1 state store adapter | low |
| 20 | POST | `/api/v1/orders/deposit` | any signed-in user | OrderService.createDepositOrder (router.js:270) | JSON body: buyerName, buyerPhone, vehicleId, branchId, paymentMethod | 201 | branchInventory, certifiedVehicles, inventoryMovements, orders, paymentIntents, reservations, users, vehicles | — | D1 state store adapter | high |
| 21 | GET | `/api/v1/orders` | any signed-in user | OrderRepository.findByQuery (router.js:287) | — | 200 | orders, paymentIntents, users | — | D1 state store adapter | low |
| 22 | GET | `/api/v1/orders/:id/timeline` | any signed-in user | OrderService.getOrderTimeline (router.js:300) | — | 200 | branchInventory, certifiedVehicles, inventoryMovements, orders, paymentIntents, reservations, users, vehicles | — | D1 state store adapter | low |
| 23 | GET | `/api/v1/orders/:id` | any signed-in user | OrderRepository.findById (router.js:308) | — | 200 | orders, paymentIntents, users | — | D1 state store adapter | low |
| 24 | GET | `/api/v1/inventory` | admin, seller | InventoryRepository.listInventory (router.js:328) | query: branchId, vehicleId | 200 | branchInventory, certifiedVehicles, inventoryMovements, orders, reservations, vehicles | — | D1 state store adapter | low |
| 25 | POST | `/api/v1/inventory/expire` | admin | InventoryRepository.expireStaleReservations (router.js:338) | — | 200 | branchInventory, certifiedVehicles, inventoryMovements, orders, reservations, vehicles | — | D1 state store adapter | medium |
| 26 | GET | `/api/v1/inventory/:id` | public | InventoryRepository.getByVehicle (router.js:345) | — | 200 | branchInventory, certifiedVehicles, inventoryMovements, orders, reservations, vehicles | — | D1 state store adapter | low |
| 27 | PATCH | `/api/v1/inventory/:id` | admin, seller | InventoryRepository.adjustStock (router.js:351) | JSON body: branchId, delta, stockOnHand, reason, expectedVersion | 200 | branchInventory, certifiedVehicles, inventoryMovements, orders, reservations, vehicles | — | D1 state store adapter | medium |
| 28 | GET | `/api/v1/promotions` | public | PromotionService.listPromotions (router.js:368) | query: activeOnly, branchId | 200 | promotions | — | D1 state store adapter | low |
| 29 | POST | `/api/v1/promotions/validate` | optional (token enriches) | PromotionService.validateCode (router.js:376) | JSON body: code, subtotal, items, branchId | 200 | promotions | — | D1 state store adapter | high |
| 30 | POST | `/api/v1/promotions` | admin, seller | PromotionService.createPromotion (router.js:389) | JSON body (passed whole to service) | 201 | promotions | — | D1 state store adapter | high |
| 31 | POST | `/api/v1/quotes` | optional (token enriches) | PricingService.createQuote (router.js:397) | JSON body: items, promoCode, deliveryMethod, branchId, downPaymentPercent, termMonths, annualInterestRatePercent | 201 | accessories, bundles, certifiedVehicles, quotes, vehicles | — | D1 state store adapter | high |
| 32 | GET | `/api/v1/cart` | any signed-in user | CartService.getCart (router.js:413) | — | 200 | accessories, bundles, carts, certifiedVehicles, vehicles | — | D1 state store adapter | low |
| 33 | POST | `/api/v1/cart/items` | any signed-in user | CartService.addItem (router.js:420) | JSON body (passed whole to service) | 201 | accessories, bundles, carts, certifiedVehicles, vehicles | — | D1 state store adapter | high |
| 34 | PATCH | `/api/v1/cart/items/:id` | any signed-in user | CartService.updateItem (router.js:428) | JSON body (passed whole to service) | 200 | accessories, bundles, carts, certifiedVehicles, vehicles | — | D1 state store adapter | high |
| 35 | PATCH | `/api/v1/cart` | any signed-in user | CartService.updateItem (router.js:437) | JSON body (passed whole to service) | 200 | accessories, bundles, carts, certifiedVehicles, vehicles | — | D1 state store adapter | high |
| 36 | DELETE | `/api/v1/cart/items/:id` | any signed-in user | CartService.removeItem (router.js:445) | query: expectedVersion | 200 | accessories, bundles, carts, certifiedVehicles, vehicles | — | D1 state store adapter | high |
| 37 | POST | `/api/v1/cart/promo` | any signed-in user | CartService.applyPromo (router.js:454) | JSON body (passed whole to service) | 200 | accessories, bundles, carts, certifiedVehicles, vehicles | — | D1 state store adapter | high |
| 38 | POST | `/api/v1/cart/merge` | any signed-in user | CartService.mergeGuestItems (router.js:462) | JSON body (passed whole to service) | 200 | accessories, bundles, carts, certifiedVehicles, vehicles | — | D1 state store adapter | high |
| 39 | POST | `/api/v1/cart/bundle` | any signed-in user | CartService.addBundleQuote (router.js:470) | JSON body: bundleQuoteId, expectedVersion | 200 | accessories, bundles, carts, certifiedVehicles, vehicles | — | D1 state store adapter | high |
| 40 | DELETE | `/api/v1/cart` | any signed-in user | CartService.clearCart (router.js:482) | — | 200 | accessories, bundles, carts, certifiedVehicles, vehicles | — | D1 state store adapter | high |
| 41 | POST | `/api/v1/checkout` | any signed-in user | CheckoutService.checkout (router.js:489) | JSON body: idempotencyKey | ? | accessories, branchInventory, carts, certifiedVehicles, idempotencyRecords, inventoryMovements, orders, quotes, reservations, vehicles | — | D1 state store adapter | high |
| 42 | POST | `/api/v1/payments/intents` | any signed-in user | PaymentService.createPaymentIntent (router.js:502) | JSON body: idempotencyKey, orderId, mode, provider | 201 | branchInventory, certifiedVehicles, inventoryMovements, orders, paymentIntents, paymentLedger, reservations, vehicles, webhookEvents | payment gateway (sandbox, in-process) | D1 state store adapter | high |
| 43 | GET | `/api/v1/payments/intents/:id` | any signed-in user | PaymentService.getOrderPaymentHistory (router.js:517) | — | 200 | branchInventory, certifiedVehicles, inventoryMovements, orders, paymentIntents, paymentLedger, reservations, vehicles, webhookEvents | payment gateway (sandbox, in-process) | D1 state store adapter | low |
| 44 | POST | `/api/v1/payments/webhooks/:id` | public | PaymentService.handleWebhook (router.js:525) | JSON body (passed whole to service) | 200 | branchInventory, certifiedVehicles, inventoryMovements, orders, paymentIntents, paymentLedger, reservations, vehicles, webhookEvents | payment gateway (sandbox, in-process) | D1 state store adapter | high |
| 45 | POST | `/api/v1/payments/sandbox/simulate` | any signed-in user | PaymentService.simulateSandboxEvent (router.js:538) | JSON body: intentId, status, amount | 200 | branchInventory, certifiedVehicles, inventoryMovements, orders, paymentIntents, paymentLedger, reservations, vehicles, webhookEvents | payment gateway (sandbox, in-process) | D1 state store adapter | high |
| 46 | POST | `/api/v1/payments/reconcile` | admin | PaymentReconciliation.runReconciliationCycle (router.js:554) | — | 200 | branchInventory, certifiedVehicles, inventoryMovements, orders, paymentIntents, paymentLedger, reservations, vehicles | — | D1 state store adapter | high |
| 47 | PATCH | `/api/v1/orders/:id/status` | seller, admin, buyer | OrderService.updateOrderStatus (router.js:561) | JSON body: status, orderStatus, note | 200 | branchInventory, certifiedVehicles, inventoryMovements, orders, paymentIntents, reservations, users, vehicles | — | D1 state store adapter | high |
| 48 | POST | `/api/v1/orders/:id/complete-payment` | any signed-in user | OrderService.completePayment (router.js:571) | JSON body (passed whole to service) | 200 | branchInventory, certifiedVehicles, inventoryMovements, orders, paymentIntents, reservations, users, vehicles | — | D1 state store adapter | high |
| 49 | GET | `/api/v1/appointments/slots` | public | AppointmentService.getAvailableSlots (router.js:584) | query: branchId, date, category, capacity | 200 | appointments, certifiedVehicles, serviceAppointments, users, vehicles | — | D1 state store adapter | low |
| 50 | POST | `/api/v1/appointments` | optional (token enriches) | AppointmentService.createTestDriveAppointment (router.js:594) | JSON body (passed whole to service) | 201 | appointments, certifiedVehicles, serviceAppointments, users, vehicles | — | D1 state store adapter | medium |
| 51 | GET | `/api/v1/appointments` | any signed-in user | AppointmentRepository.findByQuery (router.js:601) | — | 200 | appointments, users | — | D1 state store adapter | low |
| 52 | PATCH | `/api/v1/appointments/:id/reschedule` | any signed-in user | AppointmentService.rescheduleAppointment (router.js:614) | JSON body (passed whole to service) | 200 | appointments, certifiedVehicles, serviceAppointments, users, vehicles | — | D1 state store adapter | medium |
| 53 | PATCH | `/api/v1/appointments/:id/status` | any signed-in user | AppointmentRepository.transitionStatus (router.js:623) | JSON body: status | 200 | appointments, users | — | D1 state store adapter | medium |
| 54 | GET | `/api/v1/notifications` | any signed-in user | NotificationService.listForUser (router.js:636) | — | 200 | notifications, outboxEvents, users | — | D1 state store adapter | low |
| 55 | PATCH | `/api/v1/notifications/:id/read` | any signed-in user | NotificationService.markRead (router.js:643) | — | 200 | notifications, outboxEvents, users | — | D1 state store adapter | medium |
| 56 | GET | `/api/v1/admin/outbox` | admin | NotificationService.listOutboxAdmin (router.js:651) | — | 200 | notifications, outboxEvents, users | — | D1 state store adapter | low |
| 57 | POST | `/api/v1/admin/outbox/process` | admin | OutboxWorker.processOutboxBatch (router.js:658) | JSON body: batchSize | 200 | notifications, outboxEvents | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | high |
| 58 | POST | `/api/v1/media/upload` | any signed-in user | MediaService.uploadPrivateMedia (router.js:666) | JSON body (passed whole to service) | 201 | auditLogs, mediaAssets | blob storage | D1 state store adapter; D1 blob adapter | high |
| 59 | GET | `/api/v1/media/:id/sign` | any signed-in user | MediaService.getSignedUrlForAsset (router.js:677) | — | 200 | auditLogs, mediaAssets | blob storage | D1 state store adapter; D1 blob adapter | low |
| 60 | GET | `/api/v1/media/:id` | optional (token enriches) | MediaService.getAuthorizedMedia (router.js:685) | query: token, exp, meta | 200 | auditLogs, mediaAssets | blob storage | D1 state store adapter; D1 blob adapter | low |
| 61 | DELETE | `/api/v1/media/:id` | any signed-in user | MediaService.deleteMedia (router.js:705) | — | 200 | auditLogs, mediaAssets | blob storage | D1 state store adapter; D1 blob adapter | high |
| 62 | POST | `/api/v1/admin/media/purge` | admin | MediaService.purgeExpiredMedia (router.js:713) | — | 200 | auditLogs, mediaAssets | blob storage | D1 state store adapter; D1 blob adapter | high |
| 63 | GET | `/api/v1/policies` | public | PolicyService.getActivePolicies (router.js:720) | query: asOf | 200 | auditLogs, consentEvents, policyVersions | — | D1 state store adapter | low |
| 64 | POST | `/api/v1/policies` | admin | PolicyService.publishPolicy (router.js:725) | JSON body (passed whole to service) | 201 | auditLogs, consentEvents, policyVersions | — | D1 state store adapter | medium |
| 65 | POST | `/api/v1/registration/estimate` | public | RegistrationService.calculateEstimate (router.js:733) | JSON body (passed whole to service) | 200 | certifiedVehicles, mediaAssets, orders, registrationCases, vehicles | — | D1 state store adapter | medium |
| 66 | GET | `/api/v1/registration/cases` | any signed-in user | RegistrationService.getCasesForUser (router.js:739) | — | 200 | certifiedVehicles, mediaAssets, orders, registrationCases, vehicles | — | D1 state store adapter | low |
| 67 | POST | `/api/v1/registration/cases` | any signed-in user | RegistrationService.createOrUpdateCase (router.js:746) | JSON body (passed whole to service) | 201 | certifiedVehicles, mediaAssets, orders, registrationCases, vehicles | — | D1 state store adapter | medium |
| 68 | POST | `/api/v1/registration/cases/:id/submit` | any signed-in user | RegistrationService.submitCase (router.js:754) | — | 200 | certifiedVehicles, mediaAssets, orders, registrationCases, vehicles | — | D1 state store adapter | medium |
| 69 | PATCH | `/api/v1/registration/cases/:id/status` | seller, admin | RegistrationService.transitionCaseStatus (router.js:762) | JSON body (passed whole to service) | 200 | certifiedVehicles, mediaAssets, orders, registrationCases, vehicles | — | D1 state store adapter | medium |
| 70 | GET | `/api/v1/registration/cases/:id` | any signed-in user | RegistrationService.getCaseById (router.js:771) | — | 200 | certifiedVehicles, mediaAssets, orders, registrationCases, vehicles | — | D1 state store adapter | low |
| 71 | POST | `/api/v1/handovers` | seller, admin, service_staff | HandoverService.executeHandover (router.js:779) | JSON body (passed whole to service) | 201 | certifiedVehicles, financingApplications, handovers, orders, vehicleOwnerships, vehicles, warranties | — | D1 state store adapter | medium |
| 72 | GET | `/api/v1/handovers` | any signed-in user | HandoverService.listHandovers (router.js:787) | — | 200 | certifiedVehicles, financingApplications, handovers, orders, vehicleOwnerships, vehicles, warranties | — | D1 state store adapter | low |
| 73 | POST | `/api/v1/contracts/generate` | any signed-in user | ContractService.generateForOrder (router.js:794) | JSON body: orderId | 201 | contracts, orders | — | D1 state store adapter | medium |
| 74 | GET | `/api/v1/contracts` | any signed-in user | ContractService.listForUser (router.js:802) | query: orderId | 200 | contracts, orders | — | D1 state store adapter | low |
| 75 | GET | `/api/v1/contracts/:id/document` | any signed-in user | ContractService.getContractDocument (router.js:809) | query: format | 200 | contracts, orders | — | D1 state store adapter | low |
| 76 | POST | `/api/v1/contracts/:id/acknowledge` | any signed-in user | ContractService.acknowledgeContract (router.js:822) | JSON body (passed whole to service) | 200 | contracts, orders | — | D1 state store adapter | medium |
| 77 | GET | `/api/v1/garage` | any signed-in user | GarageService.getMyGarage (router.js:831) | — | 200 | certifiedVehicles, configurations, handovers, orders, serviceRecords, users, vehicleOwnerships, vehicles, warranties | — | D1 state store adapter | low |
| 78 | GET | `/api/v1/analytics/overview` | seller, admin | AnalyticsService.getSellerOverview (router.js:841) | query: branchId, dateFrom, dateTo, tzOffsetMinutes | 200 | appointments, certifiedVehicles, orders, refunds, supportTickets, vehicles | — | D1 state store adapter | low |
| 79 | GET | `/api/v1/analytics/export` | seller, admin | AnalyticsService.exportSellerCsv (router.js:860) | query: branchId, dateFrom, dateTo, tzOffsetMinutes | 200 text/csv | appointments, certifiedVehicles, orders, refunds, supportTickets, vehicles | — | D1 state store adapter | low |
| 80 | POST | `/api/v1/analytics/events` | optional (token enriches) | AnalyticsEventService.recordEvent (router.js:885) | JSON body: sessionId, eventType, targetId, branchId, promoCode, consentGranted, tzOffsetMinutes | 202 | analyticsEvents | — | D1 state store adapter | medium |
| 81 | GET | `/api/v1/analytics/funnel` | seller, admin | AnalyticsEventService.getFunnelMetrics (router.js:901) | query: dateFrom, dateTo, branchId, promoCode | 200 | analyticsEvents | — | D1 state store adapter | low |
| 82 | POST | `/api/v1/ai/chat` | optional (token enriches) | ConsultationService.chatInConsultation, AIService.chat (router.js:916) | JSON body: image, imageConsent, conversationId, persist, preferences, measuredSpaceDimensions, message, retentionHours, history | 200 | aiConversations, aiPreferences, branchInventory, certifiedVehicles, inventoryMovements, mediaAssets, meta, orders, reservations, vehicles | LLM APIs (fetch) | D1 state store adapter; fetch OK | medium |
| 83 | GET | `/api/v1/ai/preferences` | any signed-in user | ConsultationService.getPreferences (router.js:952) | — | 200 | aiConversations, aiPreferences, branchInventory, certifiedVehicles, inventoryMovements, mediaAssets, orders, reservations, vehicles | — | D1 state store adapter | low |
| 84 | PUT | `/api/v1/ai/preferences` | any signed-in user | ConsultationService.updatePreferences (router.js:959) | JSON body (passed whole to service) | 200 | aiConversations, aiPreferences, branchInventory, certifiedVehicles, inventoryMovements, mediaAssets, orders, reservations, vehicles | — | D1 state store adapter | medium |
| 85 | GET | `/api/v1/ai/conversations` | any signed-in user | ConsultationService.listConversations (router.js:967) | — | 200 | aiConversations, aiPreferences, branchInventory, certifiedVehicles, inventoryMovements, mediaAssets, orders, reservations, vehicles | — | D1 state store adapter | low |
| 86 | POST | `/api/v1/ai/conversations` | any signed-in user | ConsultationService.createConversation (router.js:974) | JSON body (passed whole to service) | 201 | aiConversations, aiPreferences, branchInventory, certifiedVehicles, inventoryMovements, mediaAssets, orders, reservations, vehicles | — | D1 state store adapter | medium |
| 87 | GET | `/api/v1/ai/conversations/:id/messages` | any signed-in user | ConsultationService.getConversationMessages (router.js:982) | — | 200 | aiConversations, aiPreferences, branchInventory, certifiedVehicles, inventoryMovements, mediaAssets, orders, reservations, vehicles | — | D1 state store adapter | low |
| 88 | DELETE | `/api/v1/ai/conversations/:id` | any signed-in user | ConsultationService.deleteConversation (router.js:990) | — | 200 | aiConversations, aiPreferences, branchInventory, certifiedVehicles, inventoryMovements, mediaAssets, orders, reservations, vehicles | — | D1 state store adapter | medium |
| 89 | GET | `/api/v1/ai/rag/status` | admin | AIService.getPublicConfig (router.js:998) | — | 200 | branchInventory, certifiedVehicles, inventoryMovements, meta, orders, reservations, vehicles | LLM APIs (fetch) | D1 state store adapter; fetch OK | low |
| 90 | POST | `/api/v1/ai/rag/sync` | admin | AIService.syncKnowledgeBase (router.js:1005) | — | 200 | branchInventory, certifiedVehicles, inventoryMovements, meta, orders, reservations, vehicles | LLM APIs (fetch) | D1 state store adapter; fetch OK | medium |
| 91 | GET | `/api/v1/config/llm` | admin | AIService.getPublicConfig (router.js:1012) | — | 200 | branchInventory, certifiedVehicles, inventoryMovements, meta, orders, reservations, vehicles | LLM APIs (fetch) | D1 state store adapter; fetch OK | low |
| 92 | POST | `/api/v1/config/llm` | admin | AIService.updateConfig (router.js:1018) | JSON body (passed whole to service) | 200 | branchInventory, certifiedVehicles, inventoryMovements, meta, orders, reservations, vehicles | LLM APIs (fetch) | D1 state store adapter; fetch OK | medium |
| 93 | POST | `/api/v1/ai/test-connection` | admin | AIService.chat (router.js:1026) | JSON body: message | 200 | branchInventory, certifiedVehicles, inventoryMovements, meta, orders, reservations, vehicles | LLM APIs (fetch) | D1 state store adapter; fetch OK | medium |
| 94 | PUT | `/api/v1/auth/profile` | any signed-in user | AuthService.updateProfile (router.js:1038) | JSON body (passed whole to service) | 200 | users | — | D1 state store adapter | high |
| 95 | PUT | `/api/v1/auth/password` | any signed-in user | AuthService.changePassword (router.js:1046) | JSON body (passed whole to service) | 200 | users | — | D1 state store adapter | high |
| 96 | PUT | `/api/v1/auth/preferences` | any signed-in user | AuthService.updatePreferences (router.js:1054) | JSON body (passed whole to service) | 200 | users | — | D1 state store adapter | high |
| 97 | POST | `/api/v1/auth/saved-cars` | any signed-in user | AuthService.toggleSavedCar (router.js:1062) | JSON body: vehicleId | 200 | users | — | D1 state store adapter | high |
| 98 | GET | `/api/v1/admin/users` | admin | UserRepository.findAll (router.js:1074) | — | 200 | users | — | D1 state store adapter | low |
| 99 | GET | `/api/v1/seller/customers` | seller, admin | OrderRepository.findByQuery, AppointmentRepository.findByQuery (router.js:1081) | — | 200 | appointments, orders, paymentIntents, users | — | D1 state store adapter | low |
| 100 | POST | `/api/v1/admin/users` | admin | UserRepository.create (router.js:1123) | JSON body: email, fullName, role, password, branchId, phone, branchIds, branchName | 201 | users | — | D1 state store adapter | high |
| 101 | DELETE | `/api/v1/admin/users/:id` | admin | UserRepository.delete (router.js:1153) | — | 200 | users | — | D1 state store adapter | high |
| 102 | PATCH | `/api/v1/admin/users/:id/role` | admin | UserRepository.updateRoleByAdmin (router.js:1161) | JSON body: role, branchId, branchName, branchIds, disabledAt | 200 | users | — | D1 state store adapter | high |
| 103 | GET | `/api/v1/returns/estimate` | any signed-in user | EcommerceService.getReturnEstimate (router.js:1176) | — | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | low |
| 104 | GET | `/api/v1/returns` | any signed-in user | EcommerceService.getReturnsData (router.js:1183) | — | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | low |
| 105 | POST | `/api/v1/returns` | any signed-in user | EcommerceService.createReturnRequest (router.js:1190) | JSON body: requireEvidence | 201 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 106 | GET | `/api/v1/refunds` | any signed-in user | RefundService.listRefunds (router.js:1205) | — | 200 | branchInventory, certifiedVehicles, inventoryMovements, orders, paymentIntents, paymentLedger, refunds, reservations, returnRequests, vehicles | payment gateway (sandbox, in-process) | D1 state store adapter | low |
| 107 | POST | `/api/v1/refunds` | admin, seller | RefundService.executeRefund (router.js:1212) | JSON body: idempotencyKey | ? | branchInventory, certifiedVehicles, inventoryMovements, orders, paymentIntents, paymentLedger, refunds, reservations, returnRequests, vehicles | payment gateway (sandbox, in-process) | D1 state store adapter | high |
| 108 | PATCH | `/api/v1/returns/:id/status` | admin, seller, service_staff | EcommerceService.updateReturnStatus (router.js:1227) | JSON body (passed whole to service) | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 109 | POST | `/api/v1/returns/:id/supplement` | any signed-in user | EcommerceService.submitReturnSupplement (router.js:1240) | JSON body (passed whole to service) | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 110 | GET | `/api/v1/warranties` | any signed-in user | EcommerceService.getWarrantyAndMaintenanceData (router.js:1256) | — | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | low |
| 111 | POST | `/api/v1/warranties/activate` | any signed-in user | EcommerceService.activateElectronicWarranty (router.js:1263) | JSON body (passed whole to service) | 201 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 112 | GET | `/api/v1/service-centers` | public | (inline) (router.js:1275) | — | 200 | — | — | D1 state store adapter | low |
| 113 | POST | `/api/v1/maintenance/appointments` | any signed-in user | EcommerceService.createServiceAppointment (router.js:1279) | JSON body (passed whole to service) | 201 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 114 | PATCH | `/api/v1/maintenance/appointments/:id/status` | any signed-in user | EcommerceService.updateServiceAppointmentStatus (router.js:1291) | JSON body (passed whole to service) | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 115 | POST | `/api/v1/maintenance/records` | admin, seller, service_staff | EcommerceService.createServiceRecord (router.js:1304) | JSON body (passed whole to service) | 201 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 116 | GET | `/api/v1/workshop/resources` | any signed-in user | WorkshopService.listResources (router.js:1319) | — | 200 | certifiedVehicles, jobEvents, orders, partsLedger, serviceBays, serviceCenters, serviceRecords, technicians, vehicleOwnerships, vehicles, warranties, warrantyClaims, workshopJobs | — | D1 state store adapter | low |
| 117 | POST | `/api/v1/workshop/resources` | admin, seller, service_staff | WorkshopService.upsertCenterOrBayOrTech (router.js:1326) | JSON body: kind, payload | 201 | certifiedVehicles, jobEvents, orders, partsLedger, serviceBays, serviceCenters, serviceRecords, technicians, vehicleOwnerships, vehicles, warranties, warrantyClaims, workshopJobs | — | D1 state store adapter | medium |
| 118 | GET | `/api/v1/workshop/availability` | public | WorkshopService.getScheduleAvailability (router.js:1334) | — | 200 | certifiedVehicles, jobEvents, orders, partsLedger, serviceBays, serviceCenters, serviceRecords, technicians, vehicleOwnerships, vehicles, warranties, warrantyClaims, workshopJobs | — | D1 state store adapter | low |
| 119 | GET | `/api/v1/workshop/jobs` | any signed-in user | WorkshopService.listJobs (router.js:1339) | — | 200 | certifiedVehicles, jobEvents, orders, partsLedger, serviceBays, serviceCenters, serviceRecords, technicians, vehicleOwnerships, vehicles, warranties, warrantyClaims, workshopJobs | — | D1 state store adapter | low |
| 120 | POST | `/api/v1/workshop/jobs` | any signed-in user | WorkshopService.createJob (router.js:1346) | JSON body (passed whole to service) | 201 | certifiedVehicles, jobEvents, orders, partsLedger, serviceBays, serviceCenters, serviceRecords, technicians, vehicleOwnerships, vehicles, warranties, warrantyClaims, workshopJobs | — | D1 state store adapter | medium |
| 121 | PATCH | `/api/v1/workshop/jobs/:id/reassign` | admin, seller, service_staff | WorkshopService.reassignJob (router.js:1358) | JSON body (passed whole to service) | 200 | certifiedVehicles, jobEvents, orders, partsLedger, serviceBays, serviceCenters, serviceRecords, technicians, vehicleOwnerships, vehicles, warranties, warrantyClaims, workshopJobs | — | D1 state store adapter | medium |
| 122 | POST | `/api/v1/workshop/jobs/:id/cancel` | any signed-in user | WorkshopService.cancelJob (router.js:1367) | JSON body: reason | 200 | certifiedVehicles, jobEvents, orders, partsLedger, serviceBays, serviceCenters, serviceRecords, technicians, vehicleOwnerships, vehicles, warranties, warrantyClaims, workshopJobs | — | D1 state store adapter | medium |
| 123 | POST | `/api/v1/workshop/jobs/:id/complete` | admin, seller, service_staff | WorkshopService.completeJob (router.js:1376) | JSON body (passed whole to service) | 200 | certifiedVehicles, jobEvents, orders, partsLedger, serviceBays, serviceCenters, serviceRecords, technicians, vehicleOwnerships, vehicles, warranties, warrantyClaims, workshopJobs | — | D1 state store adapter | medium |
| 124 | GET | `/api/v1/warranty-claims` | any signed-in user | WarrantyClaimService.listClaims (router.js:1389) | — | 200 | auditLogs, jobEvents, mediaAssets, orders, partsLedger, serviceBays, serviceCenters, technicians, warranties, warrantyClaims, workshopJobs | — | D1 state store adapter | low |
| 125 | POST | `/api/v1/warranty-claims` | any signed-in user | WarrantyClaimService.submitClaim (router.js:1396) | JSON body (passed whole to service) | 201 | auditLogs, jobEvents, mediaAssets, orders, partsLedger, serviceBays, serviceCenters, technicians, warranties, warrantyClaims, workshopJobs | — | D1 state store adapter | medium |
| 126 | PATCH | `/api/v1/warranty-claims/:id/review` | admin, seller, service_staff | WarrantyClaimService.reviewClaim (router.js:1408) | JSON body (passed whole to service) | 200 | auditLogs, jobEvents, mediaAssets, orders, partsLedger, serviceBays, serviceCenters, technicians, warranties, warrantyClaims, workshopJobs | — | D1 state store adapter | medium |
| 127 | GET | `/api/v1/reviews` | optional (token enriches) | EcommerceService.getReviewsAndQuestions (router.js:1424) | — | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | low |
| 128 | POST | `/api/v1/reviews` | any signed-in user | EcommerceService.createReview (router.js:1430) | JSON body (passed whole to service) | 201 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 129 | PUT | `/api/v1/reviews/:id` | any signed-in user | EcommerceService.updateReview (router.js:1444) | JSON body (passed whole to service) | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 130 | DELETE | `/api/v1/reviews/:id` | any signed-in user | EcommerceService.deleteReview (router.js:1453) | — | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 131 | POST | `/api/v1/reviews/:id/helpful` | any signed-in user | EcommerceService.toggleHelpfulVote (router.js:1461) | — | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 132 | POST | `/api/v1/reviews/:id/report` | any signed-in user | EcommerceService.reportReview (router.js:1473) | JSON body (passed whole to service) | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 133 | PATCH | `/api/v1/reviews/:id/moderate` | admin, seller, support_staff | EcommerceService.moderateReview (router.js:1486) | JSON body (passed whole to service) | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 134 | POST | `/api/v1/questions` | any signed-in user | EcommerceService.createQuestion (router.js:1499) | JSON body (passed whole to service) | 201 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 135 | POST | `/api/v1/questions/:id/answer` | any signed-in user | EcommerceService.answerQuestion (router.js:1511) | JSON body (passed whole to service) | 201 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 136 | POST | `/api/v1/questions/:id/report` | any signed-in user | EcommerceService.reportQuestion (router.js:1524) | JSON body (passed whole to service) | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 137 | PATCH | `/api/v1/questions/:id/moderate` | admin, seller, support_staff | EcommerceService.moderateQuestion (router.js:1533) | JSON body (passed whole to service) | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 138 | PUT | `/api/v1/questions/:id` | any signed-in user | EcommerceService.updateQuestion (router.js:1542) | JSON body (passed whole to service) | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 139 | DELETE | `/api/v1/questions/:id` | any signed-in user | EcommerceService.deleteQuestion (router.js:1551) | — | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 140 | GET | `/api/v1/support/center` | optional (token enriches) | EcommerceService.getSupportCenterData (router.js:1562) | — | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | low |
| 141 | GET | `/api/v1/support/tickets/lookup` | optional (token enriches) | EcommerceService.lookupTicketByCode (router.js:1568) | query: accessToken, code | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | low |
| 142 | POST | `/api/v1/support/tickets` | optional (token enriches) | EcommerceService.createSupportTicket (router.js:1575) | JSON body (passed whole to service) | 201 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 143 | POST | `/api/v1/support/tickets/:id/reply` | optional (token enriches) | EcommerceService.replyToSupportTicket (router.js:1586) | query: accessToken; JSON body: accessToken | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 144 | POST | `/api/v1/support/tickets/:id/rate` | optional (token enriches) | EcommerceService.rateSupportTicket (router.js:1602) | query: accessToken; JSON body: accessToken | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 145 | PATCH | `/api/v1/support/tickets/:id` | admin, seller, support_staff, service_staff | EcommerceService.updateSupportTicketAdmin (router.js:1618) | JSON body (passed whole to service) | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 146 | GET | `/api/v1/campaigns` | admin, seller, support_staff | EcommerceService.getCampaignsOverview (router.js:1634) | — | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | low |
| 147 | POST | `/api/v1/campaigns` | admin, seller | EcommerceService.saveCampaign (router.js:1641) | JSON body (passed whole to service) | 201 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 148 | POST | `/api/v1/campaigns/process-queue` | admin, seller | CampaignWorker.processCampaignQueue (router.js:1653) | JSON body (passed whole to service) | 200 | campaignDeadLetters, campaignDeliveries, emailCampaigns, users | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 149 | POST | `/api/v1/campaigns/webhooks/delivery` | public | CampaignWorker.handleProviderReceiptWebhook (router.js:1661) | JSON body (passed whole to service) | 200 | campaignDeadLetters, campaignDeliveries, emailCampaigns, users | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 150 | GET | `/api/v1/campaigns/:id/deliveries` | admin, seller, support_staff | EcommerceService.getCampaignDeliveries (router.js:1668) | — | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | low |
| 151 | PATCH | `/api/v1/campaigns/:id/status` | admin, seller | EcommerceService.updateCampaignStatus (router.js:1676) | JSON body (passed whole to service) | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 152 | POST | `/api/v1/campaigns/:id/test-send` | admin, seller | EcommerceService.sendTestCampaignEmail (router.js:1689) | JSON body (passed whole to service) | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 153 | POST | `/api/v1/campaigns/:id/execute` | admin, seller | EcommerceService.executeCampaignSend (router.js:1702) | JSON body (passed whole to service) | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 154 | POST | `/api/v1/unsubscribe` | optional (token enriches) | EcommerceService.unsubscribeMarketing (router.js:1715) | query: token; JSON body: token, userId, email, reason | 200 | auditLogs, campaignDeadLetters, campaignDeliveries, certifiedVehicles, emailCampaigns, faqs, handovers, mediaAssets, orders, partsLedger, questions, returnRequests, reviews, serviceAppointments, serviceBays, serviceRecords, supportTickets, users, vehicleOwnership, vehicles, warranties, workshopJobs | email provider | D1 state store adapter; email: webhook OK, SMTP unverified | medium |
| 155 | GET | `/api/v1/cms/public` | public | ContentService.getPublicPublished (router.js:1735) | — | 200 | cmsAuditLogs, cmsContents | — | D1 state store adapter | low |
| 156 | GET | `/api/v1/cms` | admin, seller, support_staff | ContentService.listAllForStaff (router.js:1740) | — | 200 | cmsAuditLogs, cmsContents | — | D1 state store adapter | low |
| 157 | POST | `/api/v1/cms` | admin, seller, support_staff | ContentService.saveDraft (router.js:1747) | JSON body (passed whole to service) | 201 | cmsAuditLogs, cmsContents | — | D1 state store adapter | medium |
| 158 | POST | `/api/v1/cms/:id/publish` | admin, seller, support_staff | ContentService.publishOrSchedule (router.js:1755) | JSON body (passed whole to service) | 200 | cmsAuditLogs, cmsContents | — | D1 state store adapter | medium |
| 159 | POST | `/api/v1/cms/:id/rollback` | admin, seller, support_staff | ContentService.rollbackVersion (router.js:1768) | JSON body (passed whole to service) | 200 | cmsAuditLogs, cmsContents | — | D1 state store adapter | medium |
| 160 | GET | `/api/v1/charging/stations` | public | ChargingService.findStations (router.js:1777) | — | 200 | — | charging data provider (fetch) | D1 state store adapter | low |
| 161 | GET | `/api/v1/cost-estimates/assumptions` | public | TcoService.getAssumptions (router.js:1785) | query: region | 200 | certifiedVehicles, tcoAssumptions, vehicles | — | D1 state store adapter | low |
| 162 | POST | `/api/v1/cost-estimates/tco` | public | TcoService.estimate (router.js:1790) | JSON body (passed whole to service) | 200 | certifiedVehicles, tcoAssumptions, vehicles | — | D1 state store adapter | medium |
| 163 | GET | `/api/v1/configurations` | any signed-in user | ConfigurationService.listForUser (router.js:1796) | — | 200 | accessories, certifiedVehicles, configurations, vehicles | — | D1 state store adapter | low |
| 164 | POST | `/api/v1/configurations` | any signed-in user | ConfigurationService.saveConfiguration (router.js:1803) | JSON body (passed whole to service) | 201 | accessories, certifiedVehicles, configurations, vehicles | — | D1 state store adapter | medium |
| 165 | GET | `/api/v1/configurations/:id` | any signed-in user | ConfigurationService.getById (router.js:1811) | — | 200 | accessories, certifiedVehicles, configurations, vehicles | — | D1 state store adapter | low |
| 166 | PATCH/PUT | `/api/v1/configurations/:id` | any signed-in user | ConfigurationService.saveConfiguration (router.js:1819) | JSON body (passed whole to service) | 200 | accessories, certifiedVehicles, configurations, vehicles | — | D1 state store adapter | medium |
| 167 | DELETE | `/api/v1/configurations/:id` | any signed-in user | ConfigurationService.deleteConfiguration (router.js:1828) | — | 200 | accessories, certifiedVehicles, configurations, vehicles | — | D1 state store adapter | medium |
| 168 | GET | `/api/v1/accessories` | public | AccessoryService.listAll (router.js:1836) | query: vehicleId, category, kind, inStockOnly, compatibleOnly, q | 200 | accessories, certifiedVehicles, vehicles | — | D1 state store adapter | low |
| 169 | GET | `/api/v1/accessories/:id` | public | AccessoryService.getBySku (router.js:1848) | query: vehicleId | 200 | accessories, certifiedVehicles, vehicles | — | D1 state store adapter | low |
| 170 | GET | `/api/v1/bundles/recommend` | public | BundleService.recommendForVehicle (router.js:1857) | query: vehicleId, usage | 200 | accessories, bundles, certifiedVehicles, vehicles | — | D1 state store adapter | low |
| 171 | POST | `/api/v1/bundles/quote` | any signed-in user | BundleService.createQuote (router.js:1865) | JSON body (passed whole to service) | 201 | accessories, bundles, certifiedVehicles, vehicles | — | D1 state store adapter | medium |

## 5. Database audit

### 5.1 Model

`dbState` is one JavaScript object. Each top-level key is a collection (an array of plain objects) except `meta`.
`ALL_COLLECTIONS` lists 52 collections; **8 more are created on demand by services** and persisted the same way:
`cmsContents`, `cmsAuditLogs`, `workshopJobs`, `jobEvents`, `partsLedger`, `vehicleOwnership`,
`campaignDeliveries`, `campaignDeadLetters`. Any persistence layer must therefore accept collections it does not
know in advance.

| Property | Finding |
|---|---|
| Identifiers | Every record in the snapshot has a string `id` (checked: 0 missing, 0 duplicates). Formats are mixed and meaningful: `usr_admin_01`, vehicle slugs (`honda-civic-eg6-1991`), `inv_<vehicle>_<branch>`, `cart_<uuid>`, `ORD-…`. They must be kept verbatim. |
| Relationships | By id fields inside documents (`userId`, `vehicleId`, `orderId`, `intentId`, `branchId`, …). No enforcement; services check existence. |
| Uniqueness | Enforced in code: user email (normalised), one cart per user, webhook `eventId`, idempotency keys, promo codes. |
| Ordering | **Array order is behaviour.** 41 call sites `unshift()` new records so "newest first" lists need no sort; others `splice()` deletions. Order must survive a round trip. |
| Timestamps | ISO strings set by services (`createdAt`, `updatedAt`, …). |
| Versions | Optimistic `version` fields on carts, branch inventory, configurations, etc. (409 on mismatch). |
| `meta` | `version`, `initializedAt`, `lastSavedAt`, `legacyVehicleArchives`, and `aiConfig` (admin LLM settings, see S2). |
| Size | Snapshot 203 KB: vehicles 114 KB (24 rows, largest 5.8 KB), all other collections < 6 KB. After boot normalisation 145 `branchInventory`, 8 accessories, 3 promotions, 2 policies are added. |

### 5.2 Transactions and concurrency

- 97 `runInTransaction` call sites. Each takes a **process-wide mutex**, snapshots the whole state with
  `JSON.stringify`, runs the callback against the live state, then rewrites the whole file. An exception restores
  the snapshot. This gives serialisable, all-or-nothing semantics across *all* collections, for free.
- All 97 callbacks were scanned: none performs network I/O. The external calls inside them are synchronous and
  local (sandbox `PaymentGateway`, in-memory `AIService.learnVehicle`). Re-running a callback on fresh state is
  therefore safe.
- Reads happen outside the mutex on the live object.
- Multi-collection operations that rely on this: checkout (cart → order + reservation + inventory + promotion usage
  + outbox), payment webhook (dedupe by `eventId` + intent + ledger + order status), refunds, inventory adjustments,
  registration, handover (ownership + warranty), outbox leasing, campaign sends.

### 5.3 Race conditions a naive SQL translation would introduce

A straight "one query per repository call" port would break the invariants above:

1. **Lost updates** on counters and stock (`promotions.usedCount`, `branchInventory.reservedQty/stockOnHand`):
   read-modify-write across separate queries from two isolates.
2. **Double checkout / double reservation**: two requests both see stock 1 before either writes.
3. **Duplicate webhook processing**: two deliveries of the same `eventId` both pass the duplicate check.
4. **Partial writes**: an order without its reservation or ledger row if a later statement fails.
5. **Duplicate users/carts**: check-then-insert for email or cart-per-user.
6. **Outbox double send**: two workers lease the same job.

D1 has no interactive transactions from a Worker; only `batch()` is atomic (it "aborts or rolls back the entire
sequence" when a statement fails). The design in `CLOUDFLARE_D1_MIGRATION_PLAN.md` §3 keeps the existing
callbacks and commits their whole effect in one `batch()` guarded by a revision check, so every one of these
cases stays impossible.

### 5.4 Initialisation and seeding

- Module load calls `loadFromDisk()` unless `SIGMACAR_LAZY_INIT=true`.
- File present → parse (a corrupt file aborts boot; it is never overwritten) → `ensureExtendedCollections()`
  (backfills inventory, promotions, accessories, policies, `sessionVersion`).
- File missing → dev: `seedInitialData()` (demo users with known passwords + catalog + sample records) and save;
  production: empty state and save.

### 5.5 Backup and recovery

None built in. The file is rewritten atomically (tmp + rename); a write failure rolls the in-memory state back
and returns the error. Docker keeps the file on a volume.

### 5.6 What data exists

| Source | Content |
|---|---|
| `data/sigmacar_store.json` (git) | 24 vehicles, 5 certified vehicles, 7 FAQs, 3 campaigns; **4 demo users** whose password hashes use the fixed salt `a1b2c3d4e5f60718` and the passwords written in `storage-engine.js` (`Admin@123456`, …); 4 demo orders, 2 returns, 2 tickets, 2 reviews, 1 question, 1 warranty, 2 service records, 1 audit log. |
| Production | None (backend never configured). |

`npm test` rewrites `data/sigmacar_store.json` as a side effect (pre-existing; restore with `git checkout`).

## 6. Security audit

| # | Finding | Severity | Status / proposal |
|---|---|---|---|
| S1 | `payment-gateway.js` falls back to the hard-coded webhook secret `sigmacar-sandbox-webhook-hmac-key-v1` when `PAYMENT_WEBHOOK_SECRET` is unset — **also in production**. Anyone who reads the repository can sign a "payment succeeded" webhook for any intent. (`config.payments.webhookSecret` is empty in production, but the gateway does not use it.) | High | Pre-existing in Node. Preserved unchanged by default; fail-closed in production is proposed and needs approval (it also disables the admin sandbox simulator when no secret is set). The deployment guide makes the secret mandatory. |
| S2 | `POST /config/llm` stores LLM API keys in `meta.aiConfig` in plain text (file today, D1 row after migration). Responses mask them. | Medium | Preserved. Recommended: set keys as Worker secrets and stop storing them (needs approval: changes admin UI behaviour). |
| S3 | The repository snapshot contains demo accounts with publicly known passwords. | High if imported | Production import excludes them by default (`--exclude-demo-accounts`); approval gate. |
| S4 | JWT: HS256 only, header `alg` ignored (no algorithm confusion), constant-time compare, `exp` enforced, live `sessionVersion` revocation. | OK | Preserved; same secret ⇒ existing tokens stay valid. |
| S5 | Passwords: scrypt (N=16384, r=8, p=1, 64-byte key, 16-byte random salt), `timingSafeEqual`. | OK | Preserved byte-for-byte (`node:crypto` scrypt is supported in Workers). CPU cost exceeds the Free plan budget — see risk R1. |
| S6 | No cookie auth ⇒ CSRF not applicable. CORS: production allows only `CORS_ALLOWED_ORIGINS` (default none, same-origin through the proxy). | OK | Preserved. |
| S7 | Rate limiting is per process memory. | Medium | Per isolate on Workers (weaker, see R3); optional Cloudflare Rate Limiting binding as a cross-isolate layer (counted per Cloudflare location). |
| S8 | Proxy secret (`PROXY_SHARED_SECRET`) protects the backend from direct calls. | OK | Kept. With a service binding and no public route the Worker is unreachable from the internet; the secret stays as defence in depth. |
| S9 | Error disclosure: the router returns `err.message` for every error, including unexpected ones (e.g. `ENOSPC …` from a failed save). | Low | Preserved for business errors. New storage failures on Workers return a fixed message (`503 STORAGE_UNAVAILABLE`) instead of D1 internals. |
| S10 | SQL injection: no SQL on the request path today. | — | The D1 driver uses bound parameters only; table/collection names never come from requests. Tested. |
| S11 | Secrets: none hard-coded except S1 and the dev-only defaults in `config/index.js`; `.env.example` contains placeholders. `build_dist.js` verifies no private files reach `dist/`. | OK | Worker secrets via `wrangler secret put`; nothing in `wrangler.api.toml`. |
| S12 | Admin endpoints all require the `admin` role server-side (16 routes) and re-validate the actor on each request. | OK | Preserved. |
| S13 | Campaign delivery webhook uses `EMAIL_WEBHOOK_SECRET` (empty in production ⇒ verification fails closed). | OK | Preserved. |

## 7. Target architecture (summary)

```text
Browser ──/api/v1/*──▶ Pages Function (unchanged contract) ──service binding SIGMA_API──▶ Worker "sigmacar-api"
                                         │ (falls back to SIGMA_BACKEND_ORIGIN proxy if no binding)      │
                                                                                                         ▼
                                                    same router.js / services, Node req/res shim, D1 state store
                                                                                                         ▼
                                                                                         Cloudflare D1 (binding DB)
```

Details, alternatives considered and the reasons for each choice: `CLOUDFLARE_D1_MIGRATION_PLAN.md`.

## 8. Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | scrypt login/register/password change costs more CPU than the Workers **Free** plan budget per request (10 ms). | On Free, those requests depend on Cloudflare's undocumented per-isolate tolerance for infrequent overruns. | Analysed in `CLOUDFLARE_FREE_PLAN.md`: verification procedure on Cloudflare and free fallbacks; Workers Paid removes the limit. Changing the hash parameters would weaken security and invalidate stored hashes — not done. |
| R2 | The state-store design loads the whole dataset into each isolate (128 MB limit) and diffs it on each write. | Fine at today's size (≈ 0.3 MB); grows with `analyticsEvents`/`auditLogs`. | Per-collection revisions (only changed collections reload); sizes measured; documented thresholds and the next step (row-level repositories for the append-only logs). |
| R3 | Rate limiting per isolate instead of per process. | A client spread over isolates/locations gets a higher effective limit. | Optional Rate Limiting binding (cross-isolate, but counted per Cloudflare location); documented. |
| R4 | All writes serialise on one revision; conflicts retry. | Throughput limited to roughly one commit per D1 round trip. | Adequate for this workload; measured; documented. |
| R5 | SMTP over `node:net`/`node:tls` on Workers is unverified (TLS is "partially supported"). | Live SMTP email may not work. | Use `EMAIL_WEBHOOK_URL` on Workers; default sandbox queue unchanged. |
| R6 | Staging/production behaviour on the real Cloudflare network is unverified until a staging deploy is authorised. | Unknown runtime differences. | Local tests run in `workerd` (the Workers runtime) with Miniflare D1; staging checklist. |

## 9. Blockers and required approvals

**Critical blocker check: none unresolved.** The only critical architectural decision — how to persist a
whole-state transactional engine on D1 without changing behaviour — has a solution that keeps every service
untouched (plan §3). A relational rewrite of the 32 services was rejected because it would change behaviour in
ways that cannot be fully proven equivalent.

Approvals needed before the corresponding external step (none blocks local implementation):

| # | Decision | Needed before |
|---|---|---|
| P1 | Cloudflare plan: Free (target; hashing check per `CLOUDFLARE_FREE_PLAN.md`) or Workers Paid (R1) | staging deploy |
| P2 | Staging deployment + credentials (`wrangler login`) | staging |
| P3 | What production D1 is seeded with: catalog only (default) vs. catalog + demo records; demo accounts never | production import |
| P4 | S1 fail-closed webhook secret in production; S2 LLM keys as secrets only | optional hardening |
| P5 | Production cutover (add the service binding to the Pages project) | production |
