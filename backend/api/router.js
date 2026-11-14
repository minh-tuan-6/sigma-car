// backend/api/router.js
// Versioned RESTful API Route Dispatcher for SIGMACAR (/api/v1/...)

const url = require('url');
const { ensureRequestId, sendJSON, sendError, authenticate, authorize, checkRateLimit, enforceProxySecret, parseBody } = require('./middleware');
const ArManifestService = require('../application/ar-manifest-service');
const AuthService = require('../application/auth-service');
const VehicleRepository = require('../infrastructure/repositories/vehicle-repository');
const InventoryRepository = require('../infrastructure/repositories/inventory-repository');
const OrderService = require('../application/order-service');
const OrderRepository = require('../infrastructure/repositories/order-repository');
const AppointmentRepository = require('../infrastructure/repositories/appointment-repository');
const FinancingService = require('../application/financing-service');
const AnalyticsService = require('../application/analytics-service');
const AIService = require('../application/ai-service');
const EcommerceService = require('../application/ecommerce-service');
const PromotionService = require('../application/promotion-service');
const PricingService = require('../application/pricing-service');
const CartService = require('../application/cart-service');
const CheckoutService = require('../application/checkout-service');
const PaymentService = require('../application/payment-service');
const PaymentReconciliation = require('../workers/payment-reconciliation');
const NotificationService = require('../application/notification-service');
const OutboxWorker = require('../workers/outbox-worker');
const MediaService = require('../application/media-service');
const PolicyService = require('../application/policy-service');
const AppointmentService = require('../application/appointment-service');
const RegistrationService = require('../application/registration-service');
const HandoverService = require('../application/handover-service');
const RefundService = require('../application/refund-service');
const GarageService = require('../application/garage-service');
const ContractService = require('../application/contract-service');
const TcoService = require('../application/tco-service');
const ConfigurationService = require('../application/configuration-service');
const AccessoryService = require('../application/accessory-service');
const BundleService = require('../application/bundle-service');
const ConsultationService = require('../application/consultation-service');
const WorkshopService = require('../application/workshop-service');
const WarrantyClaimService = require('../application/warranty-claim-service');
const AnalyticsEventService = require('../application/analytics-event-service');
const ContentService = require('../application/content-service');
const ChargingService = require('../application/charging-service');
const CampaignWorker = require('../workers/campaign-worker');
const UserRepository = require('../infrastructure/repositories/user-repository');
const Authorization = require('../domain/authorization');
const Security = require('../infrastructure/security');
const StorageEngine = require('../infrastructure/storage-engine');
const { ROLES, SHOWROOM_BRANCHES } = require('../domain/constants');

async function handleApiRequest(req, res) {
  ensureRequestId(req, res);
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Health & readiness probe
  if (pathname === '/api/v1/health' && method === 'GET') {
    const cfg = StorageEngine.getStorageConfig();
    return sendJSON(res, 200, {
      success: true,
      data: {
        status: 'ok',
        storageMode: cfg.mode,
        uptimeSeconds: Math.round(process.uptime()),
        vehiclesCount: Array.isArray(StorageEngine.dbState.vehicles) ? StorageEngine.dbState.vehicles.length : 0
      }
    });
  }

  // Reject direct traffic that bypasses the Cloudflare proxy when PROXY_SHARED_SECRET is configured
  if (!enforceProxySecret(req, res)) return;

  // Rate Limiting
  if (!checkRateLimit(req, res)) return;

  try {
    // -------------------------------------------------------------
    // AUTHENTICATION ROUTES
    // -------------------------------------------------------------
    if (pathname === '/api/v1/auth/register' && method === 'POST') {
      const body = await parseBody(req);
      const result = await AuthService.register(body);
      return sendJSON(res, 201, { success: true, data: result });
    }

    if (pathname === '/api/v1/auth/login' && method === 'POST') {
      const body = await parseBody(req);
      const result = await AuthService.login(body);
      return sendJSON(res, 200, { success: true, data: result });
    }

    if (pathname === '/api/v1/auth/logout' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const result = await AuthService.logout(user.userId);
      return sendJSON(res, 200, { success: true, data: result });
    }

    if (pathname === '/api/v1/auth/refresh' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const result = await AuthService.refreshToken(user.userId);
      return sendJSON(res, 200, { success: true, data: result });
    }

    if (pathname === '/api/v1/auth/me' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const profile = await AuthService.getProfile(user.userId);
      return sendJSON(res, 200, { success: true, data: profile });
    }

    // -------------------------------------------------------------
    // VEHICLE CATALOG ROUTES
    // -------------------------------------------------------------
    if (pathname === '/api/v1/vehicles' && method === 'GET') {
      const query = parsedUrl.query;
      const filters = {
        category: query.category,
        fuel: query.fuel,
        brand: query.brand,
        minPrice: query.minPrice !== undefined && query.minPrice !== '' ? parseFloat(query.minPrice) : undefined,
        maxPrice: query.maxPrice !== undefined && query.maxPrice !== '' ? parseFloat(query.maxPrice) : undefined,
        minRange: query.minRange !== undefined && query.minRange !== '' ? parseFloat(query.minRange) : undefined,
        maxRange: query.maxRange !== undefined && query.maxRange !== '' ? parseFloat(query.maxRange) : undefined,
        minBatteryKwh: query.minBatteryKwh !== undefined && query.minBatteryKwh !== '' ? parseFloat(query.minBatteryKwh) : undefined,
        maxMonthlyPayment: query.maxMonthlyPayment !== undefined && query.maxMonthlyPayment !== '' ? parseFloat(query.maxMonthlyPayment) : undefined,
        usage: query.usage,
        inStock: query.inStock,
        search: query.search,
        sort: query.sort,
        type: query.type,
        includeArchived: query.includeArchived === 'true'
      };
      if (query.page !== undefined || query.pageSize !== undefined || query.paginated === '1') {
        const paged = await VehicleRepository.findPaginated({
          ...filters,
          page: query.page,
          pageSize: query.pageSize
        });
        return sendJSON(res, 200, {
          success: true,
          count: paged.items.length,
          pagination: paged.pagination,
          data: paged.items
        });
      }
      const vehicles = await VehicleRepository.findAll(filters);
      return sendJSON(res, 200, { success: true, count: vehicles.length, data: vehicles });
    }

    if (pathname === '/api/v1/vehicles/certified' && method === 'GET') {
      const query = parsedUrl.query;
      const cpo = await VehicleRepository.findCertified({
        maxPrice: query.maxPrice ? parseFloat(query.maxPrice) : undefined,
        search: query.search
      });
      return sendJSON(res, 200, { success: true, count: cpo.length, data: cpo });
    }

    if (pathname.startsWith('/api/v1/vehicles/') && pathname.endsWith('/related') && method === 'GET') {
      const id = decodeURIComponent(pathname.replace('/api/v1/vehicles/', '').replace('/related', ''));
      const related = await VehicleRepository.findRelated(id, 3);
      return sendJSON(res, 200, { success: true, data: related });
    }

    if (pathname.startsWith('/api/v1/vehicles/') && pathname.endsWith('/ar-manifest') && method === 'GET') {
      const id = decodeURIComponent(pathname.slice('/api/v1/vehicles/'.length, -'/ar-manifest'.length));
      if (!id || id.includes('/')) {
        return sendError(res, 400, 'Mã xe không hợp lệ.', 'BAD_REQUEST');
      }
      const vehicle = await VehicleRepository.findById(id);
      if (!vehicle) {
        return sendError(res, 404, `Không tìm thấy thông tin xe với mã "${id}".`, 'NOT_FOUND');
      }
      const manifest = ArManifestService.buildArManifest(vehicle);
      if (!manifest) {
        return sendError(res, 404, `Xe "${id}" chưa có mô hình 3D hỗ trợ AR.`, 'AR_MODEL_UNAVAILABLE');
      }
      return sendJSON(res, 200, { success: true, data: manifest }, { 'Cache-Control': 'public, max-age=60' });
    }

    if (pathname.startsWith('/api/v1/vehicles/') && method === 'GET') {
      const id = decodeURIComponent(pathname.replace('/api/v1/vehicles/', ''));
      const vehicle = await VehicleRepository.findById(id);
      if (!vehicle) {
        return sendError(res, 404, `Không tìm thấy thông tin xe với mã "${id}".`, 'NOT_FOUND');
      }
      return sendJSON(res, 200, { success: true, data: vehicle });
    }

    if (pathname === '/api/v1/vehicles' && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER]);
      if (!user) return;
      const body = await parseBody(req);
      const created = await VehicleRepository.create(body);
      return sendJSON(res, 201, { success: true, message: 'Thêm mới xe thành công và đã tự động đồng bộ vào Live RAG!', data: created });
    }

    if (pathname.startsWith('/api/v1/vehicles/') && method === 'PUT') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER]);
      if (!user) return;
      const id = pathname.replace('/api/v1/vehicles/', '');
      const body = await parseBody(req);
      const updated = await VehicleRepository.update(id, body);
      return sendJSON(res, 200, { success: true, message: 'Cập nhật xe thành công và đã tự động đồng bộ vào Live RAG!', data: updated });
    }

    if (pathname.startsWith('/api/v1/vehicles/') && method === 'DELETE') {
      const user = authorize(req, res, [ROLES.ADMIN]);
      if (!user) return;
      const id = pathname.replace('/api/v1/vehicles/', '');
      const removed = await VehicleRepository.delete(id);
      return sendJSON(res, 200, { success: true, message: 'Xóa xe thành công và đã gỡ bỏ khỏi Live RAG!', data: removed });
    }

    // -------------------------------------------------------------
    // FINANCING CALCULATOR & APPLICATION ROUTES
    // -------------------------------------------------------------
    if (pathname === '/api/v1/financing/calculate' && method === 'POST') {
      const body = await parseBody(req);
      const result = FinancingService.calculateLoan({
        vehiclePrice: Number(body.vehiclePrice),
        downPaymentPercent: body.downPaymentPercent !== undefined && body.downPaymentPercent !== '' ? Number(body.downPaymentPercent) : 30,
        annualInterestRatePercent: body.annualInterestRatePercent !== undefined && body.annualInterestRatePercent !== '' ? Number(body.annualInterestRatePercent) : 7.9,
        termMonths: body.termMonths !== undefined && body.termMonths !== '' ? Number(body.termMonths) : 60,
        repaymentMethod: body.repaymentMethod || 'annuity',
        includeSchedule: Boolean(body.includeSchedule),
        monthlyIncome: body.monthlyIncome,
        monthlyObligation: body.monthlyObligation
      });
      return sendJSON(res, 200, { success: true, data: result });
    }

    if (pathname === '/api/v1/financing/applications' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const app = await FinancingService.submitApplication(user, body);
      return sendJSON(res, 201, { success: true, message: 'Đã nộp hồ sơ dự toán trả góp thành công!', data: app });
    }

    if (pathname === '/api/v1/financing/applications' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const list = FinancingService.listApplications(user);
      return sendJSON(res, 200, { success: true, count: list.length, data: list });
    }

    if (pathname.startsWith('/api/v1/financing/applications/') && pathname.endsWith('/review') && method === 'PATCH') {
      const user = authorize(req, res);
      if (!user) return;
      const appId = decodeURIComponent(pathname.replace('/api/v1/financing/applications/', '').replace('/review', ''));
      const body = await parseBody(req);
      const updated = await FinancingService.reviewApplication(user, appId, body);
      return sendJSON(res, 200, { success: true, message: `Đã cập nhật hồ sơ trả góp sang "${updated.status}"!`, data: updated });
    }

    if (pathname.startsWith('/api/v1/financing/applications/') && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const appId = decodeURIComponent(pathname.replace('/api/v1/financing/applications/', ''));
      const app = FinancingService.getApplicationById(user, appId);
      return sendJSON(res, 200, { success: true, data: app });
    }

    // -------------------------------------------------------------
    // ORDERS & DEPOSITS ROUTES
    // -------------------------------------------------------------
    if (pathname === '/api/v1/orders/deposit' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);

      const order = await OrderService.createDepositOrder({
        userId: user.userId,
        buyerName: body.buyerName || user.fullName,
        buyerPhone: body.buyerPhone,
        vehicleId: body.vehicleId,
        branchId: body.branchId,
        paymentMethod: body.paymentMethod
      });

      return sendJSON(res, 201, { success: true, message: 'Tạo đơn giữ suất đặt cọc thành công!', data: order });
    }

    if (pathname === '/api/v1/orders' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;

      const orders = await OrderRepository.findByQuery({
        userId: user.userId,
        branchId: user.branchId,
        branchIds: user.branchIds,
        userRole: user.role
      });
      return sendJSON(res, 200, { success: true, count: orders.length, data: orders });
    }

    if (pathname.startsWith('/api/v1/orders/') && pathname.endsWith('/timeline') && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const orderId = decodeURIComponent(pathname.replace('/api/v1/orders/', '').replace('/timeline', ''));
      const timeline = await OrderService.getOrderTimeline(orderId, user);
      return sendJSON(res, 200, { success: true, data: timeline });
    }

    if (pathname.startsWith('/api/v1/orders/') && !pathname.endsWith('/status') && !pathname.endsWith('/complete-payment') && !pathname.endsWith('/timeline') && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const orderId = decodeURIComponent(pathname.replace('/api/v1/orders/', ''));
      const order = await OrderRepository.findById(orderId);
      if (!order) {
        return sendError(res, 404, 'Đơn hàng không tồn tại.', 'ORDER_NOT_FOUND');
      }
      Authorization.assertAuthorized(
        Authorization.canReadOrder(user, order),
        'Bạn không có quyền truy cập đơn hàng này.',
        403,
        'FORBIDDEN'
      );
      return sendJSON(res, 200, { success: true, data: order });
    }

    // -------------------------------------------------------------
    // INVENTORY LEDGER, PROMOTIONS, QUOTES, CART, CHECKOUT & PAYMENTS (P1)
    // -------------------------------------------------------------
    if (pathname === '/api/v1/inventory' && method === 'GET') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER]);
      if (!user) return;
      const rows = await InventoryRepository.listInventory(user, {
        branchId: parsedUrl.query.branchId,
        vehicleId: parsedUrl.query.vehicleId
      });
      return sendJSON(res, 200, { success: true, count: rows.length, data: rows });
    }

    if (pathname === '/api/v1/inventory/expire' && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN]);
      if (!user) return;
      const result = await InventoryRepository.expireStaleReservations(Date.now());
      return sendJSON(res, 200, { success: true, data: result });
    }

    if (pathname.startsWith('/api/v1/inventory/') && method === 'GET') {
      const vehicleId = decodeURIComponent(pathname.replace('/api/v1/inventory/', ''));
      const summary = await InventoryRepository.getByVehicle(vehicleId);
      return sendJSON(res, 200, { success: true, data: summary });
    }

    if (pathname.startsWith('/api/v1/inventory/') && method === 'PATCH') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER]);
      if (!user) return;
      const vehicleId = decodeURIComponent(pathname.replace('/api/v1/inventory/', ''));
      const body = await parseBody(req);
      const updated = await InventoryRepository.adjustStock({
        vehicleId,
        branchId: body.branchId || user.branchId || 'hn-caugiay',
        delta: body.delta,
        stockOnHand: body.stockOnHand,
        reason: body.reason,
        expectedVersion: body.expectedVersion,
        user
      });
      return sendJSON(res, 200, { success: true, message: 'Đã cập nhật tồn kho chi nhánh thành công!', data: updated });
    }

    if (pathname === '/api/v1/promotions' && method === 'GET') {
      const list = await PromotionService.listPromotions({
        activeOnly: parsedUrl.query.activeOnly !== 'false',
        branchId: parsedUrl.query.branchId
      });
      return sendJSON(res, 200, { success: true, count: list.length, data: list });
    }

    if (pathname === '/api/v1/promotions/validate' && method === 'POST') {
      const user = authenticate(req);
      const body = await parseBody(req);
      const promoRes = await PromotionService.validateCode({
        code: body.code,
        subtotal: body.subtotal,
        items: body.items || [],
        branchId: body.branchId,
        userId: user ? user.userId : null
      });
      return sendJSON(res, 200, { success: true, data: promoRes });
    }

    if (pathname === '/api/v1/promotions' && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER]);
      if (!user) return;
      const body = await parseBody(req);
      const created = await PromotionService.createPromotion(body, user);
      return sendJSON(res, 201, { success: true, message: `Đã tạo mã khuyến mãi "${created.code}" thành công!`, data: created });
    }

    if (pathname === '/api/v1/quotes' && method === 'POST') {
      const user = authenticate(req);
      const body = await parseBody(req);
      const quote = await PricingService.createQuote({
        items: body.items,
        promoCode: body.promoCode,
        deliveryMethod: body.deliveryMethod,
        branchId: body.branchId,
        downPaymentPercent: body.downPaymentPercent,
        termMonths: body.termMonths,
        annualInterestRatePercent: body.annualInterestRatePercent,
        userId: user ? user.userId : null
      });
      return sendJSON(res, 201, { success: true, data: quote });
    }

    if (pathname === '/api/v1/cart' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const cart = await CartService.getCart(user.userId);
      return sendJSON(res, 200, { success: true, data: cart });
    }

    if (pathname === '/api/v1/cart/items' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const cart = await CartService.addItem(user.userId, body);
      return sendJSON(res, 201, { success: true, message: 'Đã thêm sản phẩm vào giỏ hàng!', data: cart });
    }

    if (pathname.startsWith('/api/v1/cart/items/') && method === 'PATCH') {
      const user = authorize(req, res);
      if (!user) return;
      const lineId = decodeURIComponent(pathname.replace('/api/v1/cart/items/', ''));
      const body = await parseBody(req);
      const cart = await CartService.updateItem(user.userId, lineId, body);
      return sendJSON(res, 200, { success: true, data: cart });
    }

    if (pathname === '/api/v1/cart' && method === 'PATCH') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const cart = await CartService.updateItem(user.userId, null, body);
      return sendJSON(res, 200, { success: true, data: cart });
    }

    if (pathname.startsWith('/api/v1/cart/items/') && method === 'DELETE') {
      const user = authorize(req, res);
      if (!user) return;
      const lineId = decodeURIComponent(pathname.replace('/api/v1/cart/items/', ''));
      const expectedVersion = parsedUrl.query.expectedVersion ? Number(parsedUrl.query.expectedVersion) : undefined;
      const cart = await CartService.removeItem(user.userId, lineId, expectedVersion);
      return sendJSON(res, 200, { success: true, data: cart });
    }

    if (pathname === '/api/v1/cart/promo' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const cart = await CartService.applyPromo(user.userId, body);
      return sendJSON(res, 200, { success: true, data: cart });
    }

    if (pathname === '/api/v1/cart/merge' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const cart = await CartService.mergeGuestItems(user.userId, body);
      return sendJSON(res, 200, { success: true, data: cart });
    }

    if (pathname === '/api/v1/cart/bundle' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const cart = await CartService.addBundleQuote(user.userId, body.bundleQuoteId, body.expectedVersion);
      return sendJSON(res, 200, {
        success: true,
        message: 'Đã thêm gói phụ kiện báo giá vào giỏ hàng thành công!',
        data: cart
      });
    }

    if (pathname === '/api/v1/cart' && method === 'DELETE') {
      const user = authorize(req, res);
      if (!user) return;
      const cart = await CartService.clearCart(user.userId);
      return sendJSON(res, 200, { success: true, data: cart });
    }

    if (pathname === '/api/v1/checkout' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const idempotencyKey = req.headers['idempotency-key'] || body.idempotencyKey || null;
      const result = await CheckoutService.checkout({ user, idempotencyKey, payload: body });
      return sendJSON(res, result.idempotentReplay ? 200 : 201, {
        success: true,
        message: 'Đã khởi tạo đơn hàng thành công (đang giữ chỗ 15 phút, chờ xác nhận thanh toán).',
        data: result
      });
    }

    if (pathname === '/api/v1/payments/intents' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const idempotencyKey = req.headers['idempotency-key'] || body.idempotencyKey || null;
      const intent = await PaymentService.createPaymentIntent({
        orderId: body.orderId,
        user,
        mode: body.mode || 'deposit',
        provider: body.provider || 'napas_qr_sandbox',
        idempotencyKey
      });
      return sendJSON(res, 201, { success: true, data: intent });
    }

    if (pathname.startsWith('/api/v1/payments/intents/') && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const orderId = decodeURIComponent(pathname.replace('/api/v1/payments/intents/', ''));
      const history = await PaymentService.getOrderPaymentHistory(orderId, user);
      return sendJSON(res, 200, { success: true, data: history });
    }

    if (pathname.startsWith('/api/v1/payments/webhooks/') && method === 'POST') {
      const provider = decodeURIComponent(pathname.replace('/api/v1/payments/webhooks/', ''));
      const body = await parseBody(req);
      const signature = req.headers['x-webhook-signature'] || req.headers['x-signature'] || req.headers['x-hub-signature-256'] || '';
      const result = await PaymentService.handleWebhook({
        provider,
        rawBody: req.rawBody || JSON.stringify(body),
        signature,
        event: body
      });
      return sendJSON(res, 200, { success: true, data: result });
    }

    if (pathname === '/api/v1/payments/sandbox/simulate' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SANDBOX_SIMULATOR !== 'true' && user.role !== ROLES.ADMIN) {
        return sendError(res, 403, 'Sandbox payment simulator bị khóa ở môi trường Production.', 'FORBIDDEN');
      }
      const body = await parseBody(req);
      const result = await PaymentService.simulateSandboxEvent({
        intentId: body.intentId,
        status: body.status || 'succeeded',
        amount: body.amount,
        user
      });
      return sendJSON(res, 200, { success: true, data: result });
    }

    if (pathname === '/api/v1/payments/reconcile' && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN]);
      if (!user) return;
      const summary = await PaymentReconciliation.runReconciliationCycle({ nowMs: Date.now() });
      return sendJSON(res, 200, { success: true, data: summary });
    }

    if (pathname.startsWith('/api/v1/orders/') && pathname.endsWith('/status') && method === 'PATCH') {
      const user = authorize(req, res, [ROLES.SELLER, ROLES.ADMIN, ROLES.BUYER]);
      if (!user) return;

      const orderId = decodeURIComponent(pathname.replace('/api/v1/orders/', '').replace('/status', ''));
      const body = await parseBody(req);
      const updated = await OrderService.updateOrderStatus(orderId, body.status || body.orderStatus, user, body.note || '');
      return sendJSON(res, 200, { success: true, data: updated });
    }

    if (pathname.startsWith('/api/v1/orders/') && pathname.endsWith('/complete-payment') && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;

      const orderId = decodeURIComponent(pathname.replace('/api/v1/orders/', '').replace('/complete-payment', ''));
      const body = await parseBody(req);
      const updated = await OrderService.completePayment(orderId, user, body);
      return sendJSON(res, 200, { success: true, message: 'Ghi nhận thanh toán hợp lệ thành công.', data: updated });
    }

    // -------------------------------------------------------------
    // TEST DRIVE APPOINTMENTS & AVAILABILITY SLOTS ROUTES
    // -------------------------------------------------------------
    if (pathname === '/api/v1/appointments/slots' && method === 'GET') {
      const data = AppointmentService.getAvailableSlots({
        branchId: parsedUrl.query.branchId || 'hn-caugiay',
        date: parsedUrl.query.date,
        category: parsedUrl.query.category || 'test_drive',
        capacity: parsedUrl.query.capacity
      });
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/appointments' && method === 'POST') {
      const body = await parseBody(req);
      const authUser = authenticate(req);
      const appt = await AppointmentService.createTestDriveAppointment(authUser, body);
      return sendJSON(res, 201, { success: true, message: 'Đặt lịch lái thử thành công!', data: appt });
    }

    if (pathname === '/api/v1/appointments' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;

      const list = await AppointmentRepository.findByQuery({
        userId: user.userId,
        branchId: user.branchId,
        branchIds: user.branchIds,
        userRole: user.role
      });
      return sendJSON(res, 200, { success: true, count: list.length, data: list });
    }

    if (pathname.startsWith('/api/v1/appointments/') && pathname.endsWith('/reschedule') && method === 'PATCH') {
      const user = authorize(req, res);
      if (!user) return;
      const apptId = decodeURIComponent(pathname.replace('/api/v1/appointments/', '').replace('/reschedule', ''));
      const body = await parseBody(req);
      const updated = await AppointmentService.rescheduleAppointment(user, apptId, body);
      return sendJSON(res, 200, { success: true, message: 'Đã cập nhật lịch hẹn lái thử thành công!', data: updated });
    }

    if (pathname.startsWith('/api/v1/appointments/') && pathname.endsWith('/status') && method === 'PATCH') {
      const user = authorize(req, res);
      if (!user) return;

      const apptId = decodeURIComponent(pathname.replace('/api/v1/appointments/', '').replace('/status', ''));
      const body = await parseBody(req);
      const updated = await AppointmentRepository.transitionStatus(apptId, body.status, user.userId, user.role, user);
      return sendJSON(res, 200, { success: true, data: updated });
    }

    // -------------------------------------------------------------
    // P2: NOTIFICATIONS, OUTBOX, PRIVATE MEDIA, POLICIES, REGISTRATION, HANDOVER, CONTRACTS & GARAGE
    // -------------------------------------------------------------
    if (pathname === '/api/v1/notifications' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const items = NotificationService.listForUser(user);
      return sendJSON(res, 200, { success: true, count: items.length, data: items });
    }

    if (pathname.startsWith('/api/v1/notifications/') && pathname.endsWith('/read') && method === 'PATCH') {
      const user = authorize(req, res);
      if (!user) return;
      const notifId = decodeURIComponent(pathname.replace('/api/v1/notifications/', '').replace('/read', ''));
      const updated = await NotificationService.markRead(user, notifId);
      return sendJSON(res, 200, { success: true, data: updated });
    }

    if (pathname === '/api/v1/admin/outbox' && method === 'GET') {
      const user = authorize(req, res, [ROLES.ADMIN]);
      if (!user) return;
      const items = NotificationService.listOutboxAdmin();
      return sendJSON(res, 200, { success: true, count: items.length, data: items });
    }

    if (pathname === '/api/v1/admin/outbox/process' && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN]);
      if (!user) return;
      const body = await parseBody(req);
      const summary = await OutboxWorker.processOutboxBatch({ batchSize: Number(body.batchSize || 20) });
      return sendJSON(res, 200, { success: true, data: summary });
    }

    if (pathname === '/api/v1/media/upload' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const uploaded = await MediaService.uploadPrivateMedia(user, body);
      if (uploaded.rejected) {
        return sendError(res, 422, uploaded.message || 'Tệp bị cách ly bảo mật.', 'MEDIA_QUARANTINED');
      }
      return sendJSON(res, 201, { success: true, data: uploaded });
    }

    if (pathname.startsWith('/api/v1/media/') && pathname.endsWith('/sign') && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const mediaId = decodeURIComponent(pathname.replace('/api/v1/media/', '').replace('/sign', ''));
      const signed = MediaService.getSignedUrlForAsset(user, mediaId);
      return sendJSON(res, 200, { success: true, data: signed });
    }

    if (pathname.startsWith('/api/v1/media/') && method === 'GET') {
      const currentUser = authenticate(req);
      const mediaId = decodeURIComponent(pathname.replace('/api/v1/media/', ''));
      const { asset, buffer } = await MediaService.getAuthorizedMedia(mediaId, {
        user: currentUser,
        token: parsedUrl.query.token || null,
        exp: parsedUrl.query.exp || null
      });
      if (parsedUrl.query.meta === '1') {
        return sendJSON(res, 200, { success: true, data: asset });
      }
      res.writeHead(200, {
        'Content-Type': asset.mimeType,
        'Content-Length': buffer.length,
        'Cache-Control': 'private, no-store'
      });
      res.end(buffer);
      return;
    }

    if (pathname.startsWith('/api/v1/media/') && method === 'DELETE') {
      const user = authorize(req, res);
      if (!user) return;
      const mediaId = decodeURIComponent(pathname.replace('/api/v1/media/', ''));
      const result = await MediaService.deleteMedia(user, mediaId);
      return sendJSON(res, 200, { success: true, data: result });
    }

    if (pathname === '/api/v1/admin/media/purge' && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN]);
      if (!user) return;
      const result = await MediaService.purgeExpiredMedia();
      return sendJSON(res, 200, { success: true, data: result });
    }

    if (pathname === '/api/v1/policies' && method === 'GET') {
      const data = PolicyService.getActivePolicies(parsedUrl.query.asOf || null);
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/policies' && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN]);
      if (!user) return;
      const body = await parseBody(req);
      const created = await PolicyService.publishPolicy(user, body);
      return sendJSON(res, 201, { success: true, data: created });
    }

    if (pathname === '/api/v1/registration/estimate' && method === 'POST') {
      const body = await parseBody(req);
      const estimate = RegistrationService.calculateEstimate(body);
      return sendJSON(res, 200, { success: true, data: estimate });
    }

    if (pathname === '/api/v1/registration/cases' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const list = RegistrationService.getCasesForUser(user);
      return sendJSON(res, 200, { success: true, count: list.length, data: list });
    }

    if (pathname === '/api/v1/registration/cases' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const regCase = await RegistrationService.createOrUpdateCase(user, body);
      return sendJSON(res, 201, { success: true, message: 'Đã lưu hồ sơ đăng ký & biển số!', data: regCase });
    }

    if (pathname.startsWith('/api/v1/registration/cases/') && pathname.endsWith('/submit') && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const caseId = decodeURIComponent(pathname.replace('/api/v1/registration/cases/', '').replace('/submit', ''));
      const updated = await RegistrationService.submitCase(user, caseId);
      return sendJSON(res, 200, { success: true, message: 'Đã nộp hồ sơ đăng ký thành công!', data: updated });
    }

    if (pathname.startsWith('/api/v1/registration/cases/') && pathname.endsWith('/status') && method === 'PATCH') {
      const user = authorize(req, res, [ROLES.SELLER, ROLES.ADMIN]);
      if (!user) return;
      const caseId = decodeURIComponent(pathname.replace('/api/v1/registration/cases/', '').replace('/status', ''));
      const body = await parseBody(req);
      const updated = await RegistrationService.transitionCaseStatus(user, caseId, body);
      return sendJSON(res, 200, { success: true, message: `Đã cập nhật trạng thái hồ sơ đăng ký -> ${updated.status}!`, data: updated });
    }

    if (pathname.startsWith('/api/v1/registration/cases/') && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const caseId = decodeURIComponent(pathname.replace('/api/v1/registration/cases/', ''));
      const regCase = RegistrationService.getCaseById(user, caseId);
      return sendJSON(res, 200, { success: true, data: regCase });
    }

    if (pathname === '/api/v1/handovers' && method === 'POST') {
      const user = authorize(req, res, [ROLES.SELLER, ROLES.ADMIN, ROLES.SERVICE_STAFF]);
      if (!user) return;
      const body = await parseBody(req);
      const result = await HandoverService.executeHandover(user, body);
      return sendJSON(res, 201, { success: true, message: `Hoàn tất bàn giao xe VIN ${result.handover.vin}!`, data: result });
    }

    if (pathname === '/api/v1/handovers' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const items = HandoverService.listHandovers(user);
      return sendJSON(res, 200, { success: true, count: items.length, data: items });
    }

    if (pathname === '/api/v1/contracts/generate' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const contract = await ContractService.generateForOrder(user, body.orderId, body);
      return sendJSON(res, 201, { success: true, data: contract });
    }

    if (pathname === '/api/v1/contracts' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const list = ContractService.listForUser(user, parsedUrl.query.orderId || null);
      return sendJSON(res, 200, { success: true, count: list.length, data: list });
    }

    if (pathname.startsWith('/api/v1/contracts/') && pathname.endsWith('/document') && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const contractId = decodeURIComponent(pathname.replace('/api/v1/contracts/', '').replace('/document', ''));
      const doc = ContractService.getContractDocument(user, contractId);
      if (parsedUrl.query.format === 'html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(doc.html);
        return;
      }
      return sendJSON(res, 200, { success: true, data: doc });
    }

    if (pathname.startsWith('/api/v1/contracts/') && pathname.endsWith('/acknowledge') && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const contractId = decodeURIComponent(pathname.replace('/api/v1/contracts/', '').replace('/acknowledge', ''));
      const body = await parseBody(req);
      const ack = await ContractService.acknowledgeContract(user, contractId, body);
      return sendJSON(res, 200, { success: true, message: `Đã xác nhận hợp đồng ${ack.contractCode}!`, data: ack });
    }

    if (pathname === '/api/v1/garage' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const data = GarageService.getMyGarage(user);
      return sendJSON(res, 200, { success: true, data });
    }

    // -------------------------------------------------------------
    // ANALYTICS & FUNNEL ROUTES (SIG-P4-006, SIG-P4-007)
    // -------------------------------------------------------------
    if ((pathname === '/api/v1/analytics/overview' || pathname === '/api/v1/analytics/summary') && method === 'GET') {
      const user = authorize(req, res, [ROLES.SELLER, ROLES.ADMIN]);
      if (!user) return;

      const allowedBranchIds = Array.isArray(user.branchIds) && user.branchIds.length > 0
        ? user.branchIds.filter(Boolean)
        : (user.branchId && user.branchId !== 'all' ? [user.branchId] : []);

      const data = AnalyticsService.getSellerOverview({
        branchId: parsedUrl.query.branchId || null,
        branchIds: allowedBranchIds,
        userRole: user.role,
        dateFrom: parsedUrl.query.dateFrom || null,
        dateTo: parsedUrl.query.dateTo || null,
        tzOffsetMinutes: parsedUrl.query.tzOffsetMinutes
      });
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/analytics/export' && method === 'GET') {
      const user = authorize(req, res, [ROLES.SELLER, ROLES.ADMIN]);
      if (!user) return;

      const allowedBranchIds = Array.isArray(user.branchIds) && user.branchIds.length > 0
        ? user.branchIds.filter(Boolean)
        : (user.branchId && user.branchId !== 'all' ? [user.branchId] : []);

      const csv = AnalyticsService.exportSellerCsv({
        branchId: parsedUrl.query.branchId || null,
        branchIds: allowedBranchIds,
        userRole: user.role,
        dateFrom: parsedUrl.query.dateFrom || null,
        dateTo: parsedUrl.query.dateTo || null,
        tzOffsetMinutes: parsedUrl.query.tzOffsetMinutes
      });
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="sigmacar-analytics.csv"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.end(`\uFEFF${csv}`);
    }

    if (pathname === '/api/v1/analytics/events' && method === 'POST') {
      const currentUser = authenticate(req);
      const body = await parseBody(req);
      const data = await AnalyticsEventService.recordEvent({
        user: currentUser,
        sessionId: body.sessionId,
        eventType: body.eventType,
        targetId: body.targetId,
        branchId: body.branchId,
        promoCode: body.promoCode,
        consentGranted: body.consentGranted !== false,
        tzOffsetMinutes: body.tzOffsetMinutes
      });
      return sendJSON(res, 202, { success: true, data });
    }

    if (pathname === '/api/v1/analytics/funnel' && method === 'GET') {
      const user = authorize(req, res, [ROLES.SELLER, ROLES.ADMIN]);
      if (!user) return;
      const data = AnalyticsEventService.getFunnelMetrics(user, {
        dateFrom: parsedUrl.query.dateFrom || null,
        dateTo: parsedUrl.query.dateTo || null,
        branchId: parsedUrl.query.branchId || null,
        promoCode: parsedUrl.query.promoCode || null
      });
      return sendJSON(res, 200, { success: true, data });
    }

    // -------------------------------------------------------------
    // AI CHATBOT & LIVE RAG ROUTES
    // -------------------------------------------------------------
    if (pathname === '/api/v1/ai/chat' && method === 'POST') {
      const body = await parseBody(req);
      const currentUser = authenticate(req); // null if guest, user object if logged in
      if (body.image && body.imageConsent !== true) {
        return sendError(res, 422, 'Cần xác nhận đồng ý (imageConsent: true) trước khi tải ảnh bãi đỗ/không gian và phân tích.', 'CONSENT_REQUIRED');
      }
      if (currentUser && (body.conversationId || body.persist || body.preferences || body.image || body.measuredSpaceDimensions)) {
        const result = await ConsultationService.chatInConsultation({
          user: currentUser,
          conversationId: body.conversationId || null,
          message: body.message || '',
          preferences: body.preferences || null,
          image: body.image || null,
          imageConsent: body.imageConsent === true,
          measuredSpaceDimensions: body.measuredSpaceDimensions || null,
          retentionHours: body.retentionHours
        });
        return sendJSON(res, 200, {
          success: true,
          data: {
            text: result.assistantMessage.text,
            ...result
          }
        });
      }
      if (body.conversationId || body.image) {
        return sendError(res, 401, 'Vui lòng đăng nhập để lưu hội thoại hoặc tải ảnh tư vấn riêng tư.', 'UNAUTHORIZED');
      }
      const result = await AIService.chat({
        message: body.message,
        history: body.history || [],
        currentUser
      });
      return sendJSON(res, 200, { success: true, data: result });
    }

    if (pathname === '/api/v1/ai/preferences' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const data = ConsultationService.getPreferences(user);
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/ai/preferences' && method === 'PUT') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const data = await ConsultationService.updatePreferences(user, body);
      return sendJSON(res, 200, { success: true, message: 'Đã cập nhật hồ sơ nhu cầu tư vấn.', data });
    }

    if (pathname === '/api/v1/ai/conversations' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const data = ConsultationService.listConversations(user, parsedUrl.query);
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/ai/conversations' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const data = await ConsultationService.createConversation(user, body);
      return sendJSON(res, 201, { success: true, data });
    }

    if (pathname.startsWith('/api/v1/ai/conversations/') && pathname.endsWith('/messages') && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const convId = decodeURIComponent(pathname.replace('/api/v1/ai/conversations/', '').replace('/messages', ''));
      const data = ConsultationService.getConversationMessages(user, convId, parsedUrl.query);
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname.startsWith('/api/v1/ai/conversations/') && method === 'DELETE') {
      const user = authorize(req, res);
      if (!user) return;
      const convId = decodeURIComponent(pathname.replace('/api/v1/ai/conversations/', ''));
      const data = await ConsultationService.deleteConversation(user, convId);
      return sendJSON(res, 200, { success: true, message: 'Đã xóa phiên tư vấn và hết hạn ảnh đính kèm.', data });
    }

    if (pathname === '/api/v1/ai/rag/status' && method === 'GET') {
      const user = authorize(req, res, [ROLES.ADMIN]);
      if (!user) return;
      const status = AIService.getPublicConfig();
      return sendJSON(res, 200, { success: true, data: status });
    }

    if (pathname === '/api/v1/ai/rag/sync' && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN]);
      if (!user) return;
      const result = await AIService.syncKnowledgeBase();
      return sendJSON(res, 200, { success: true, message: 'Đồng bộ cơ sở dữ liệu xe vào RAG thành công!', data: result });
    }

    if (pathname === '/api/v1/config/llm' && method === 'GET') {
      const user = authorize(req, res, [ROLES.ADMIN]);
      if (!user) return;
      return sendJSON(res, 200, { success: true, data: AIService.getPublicConfig() });
    }

    if (pathname === '/api/v1/config/llm' && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN]);
      if (!user) return;
      const body = await parseBody(req);
      const updated = await AIService.updateConfig(body, user);
      return sendJSON(res, 200, { success: true, message: 'Cấu hình mô hình AI đã được cập nhật thành công!', data: updated });
    }

    if (pathname === '/api/v1/ai/test-connection' && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN]);
      if (!user) return;
      const body = await parseBody(req);
      const prompt = body.message || 'Xin chào! Kiểm tra kết nối AI SIGMACAR.';
      const result = await AIService.chat({ message: prompt, currentUser: user });
      return sendJSON(res, 200, { success: true, message: 'Kiểm tra kết nối thành công!', data: result });
    }

    // -------------------------------------------------------------
    // USER PROFILE, PREFERENCES, SAVED CARS & RBAC ADMIN ROUTES
    // -------------------------------------------------------------
    if (pathname === '/api/v1/auth/profile' && method === 'PUT') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const updated = await AuthService.updateProfile(user.userId, body);
      return sendJSON(res, 200, { success: true, message: 'Đã cập nhật thông tin cá nhân thành công!', data: updated });
    }

    if (pathname === '/api/v1/auth/password' && method === 'PUT') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const result = await AuthService.changePassword(user.userId, body);
      return sendJSON(res, 200, { success: true, message: 'Đổi mật khẩu thành công!', data: result });
    }

    if (pathname === '/api/v1/auth/preferences' && method === 'PUT') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const updated = await AuthService.updatePreferences(user.userId, body);
      return sendJSON(res, 200, { success: true, message: 'Cập nhật tùy chọn bảo mật & thông báo thành công!', data: updated });
    }

    if (pathname === '/api/v1/auth/saved-cars' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const result = await AuthService.toggleSavedCar(user.userId, body.vehicleId);
      return sendJSON(res, 200, {
        success: true,
        message: result.saved ? 'Đã lưu xe vào danh sách yêu thích!' : 'Đã bỏ lưu mẫu xe khỏi danh sách.',
        data: result
      });
    }

    if (pathname === '/api/v1/admin/users' && method === 'GET') {
      const user = authorize(req, res, [ROLES.ADMIN]);
      if (!user) return;
      const users = await UserRepository.findAll();
      return sendJSON(res, 200, { success: true, count: users.length, data: users });
    }

    if (pathname === '/api/v1/seller/customers' && method === 'GET') {
      const user = authorize(req, res, [ROLES.SELLER, ROLES.ADMIN]);
      if (!user) return;
      const scopedOrders = await OrderRepository.findByQuery({
        userId: user.userId,
        branchId: user.branchId,
        branchIds: user.branchIds,
        userRole: user.role
      });
      const scopedAppts = await AppointmentRepository.findByQuery({
        userId: user.userId,
        branchId: user.branchId,
        branchIds: user.branchIds,
        userRole: user.role
      });
      const customerMap = new Map();
      scopedOrders.forEach(o => {
        if (o.userId && !customerMap.has(o.userId)) {
          customerMap.set(o.userId, {
            id: o.userId,
            fullName: o.buyerName,
            phone: o.buyerPhone,
            branchId: o.branchId,
            source: 'order'
          });
        }
      });
      scopedAppts.forEach(a => {
        if (a.userId && !customerMap.has(a.userId)) {
          customerMap.set(a.userId, {
            id: a.userId,
            fullName: a.customerName,
            phone: a.phone,
            branchId: a.branchId,
            source: 'appointment'
          });
        }
      });
      const list = Array.from(customerMap.values());
      return sendJSON(res, 200, { success: true, count: list.length, data: list });
    }

    if (pathname === '/api/v1/admin/users' && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN]);
      if (!user) return;
      const body = await parseBody(req);
      if (!body.email || !body.fullName) {
        return sendError(res, 400, 'Họ tên và email là bắt buộc.', 'VALIDATION_ERROR');
      }
      const targetRole = body.role || ROLES.SELLER;
      if (!Object.values(ROLES).includes(targetRole)) {
        return sendError(res, 400, 'Vai trò phân quyền không hợp lệ.', 'INVALID_ROLE');
      }
      const rawPassword = body.password || 'Seller@123456';
      if (String(rawPassword).length < 6) {
        return sendError(res, 400, 'Mật khẩu phải có tối thiểu 6 ký tự.', 'WEAK_PASSWORD');
      }
      const passwordHash = await Security.hashPassword(rawPassword);
      const branch = SHOWROOM_BRANCHES.find(b => b.id === body.branchId) || SHOWROOM_BRANCHES[0];
      const createdStaff = await UserRepository.create({
        fullName: Security.sanitizeString(body.fullName),
        email: body.email,
        phone: Security.sanitizeString(body.phone || ''),
        role: targetRole,
        branchId: targetRole === ROLES.BUYER ? null : (body.branchId || branch.id),
        branchIds: targetRole === ROLES.BUYER ? [] : (Array.isArray(body.branchIds) ? body.branchIds : [body.branchId || branch.id]),
        branchName: targetRole === ROLES.BUYER ? null : (body.branchName || branch.name),
        passwordHash
      });
      return sendJSON(res, 201, { success: true, message: 'Đã tạo tài khoản thành công!', data: Security.sanitizeUser(createdStaff) });
    }

    if (pathname.startsWith('/api/v1/admin/users/') && !pathname.endsWith('/role') && method === 'DELETE') {
      const user = authorize(req, res, [ROLES.ADMIN]);
      if (!user) return;
      const targetId = decodeURIComponent(pathname.replace('/api/v1/admin/users/', ''));
      const deleted = await UserRepository.delete(targetId);
      return sendJSON(res, 200, { success: true, message: 'Đã xóa tài khoản thành công!', data: deleted });
    }

    if (pathname.startsWith('/api/v1/admin/users/') && pathname.endsWith('/role') && method === 'PATCH') {
      const user = authorize(req, res, [ROLES.ADMIN]);
      if (!user) return;
      const targetId = decodeURIComponent(pathname.replace('/api/v1/admin/users/', '').replace('/role', ''));
      const body = await parseBody(req);
      if (!Object.values(ROLES).includes(body.role)) {
        return sendError(res, 400, 'Vai trò phân quyền không hợp lệ.', 'INVALID_ROLE');
      }
      const updated = await UserRepository.updateRoleByAdmin(targetId, body.role, body.branchId, body.branchName, body.branchIds, body.disabledAt);
      return sendJSON(res, 200, { success: true, message: `Đã cập nhật phân quyền người dùng thành "${body.role}"!`, data: updated });
    }

    // -------------------------------------------------------------
    // SECTION 2: AUTOMATED 7-DAY RETURNS CENTER & LEDGER REFUNDS ROUTES
    // -------------------------------------------------------------
    if (pathname === '/api/v1/returns/estimate' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const estimate = EcommerceService.getReturnEstimate(user, parsedUrl.query);
      return sendJSON(res, 200, { success: true, data: estimate });
    }

    if (pathname === '/api/v1/returns' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const data = EcommerceService.getReturnsData(user, parsedUrl.query);
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/returns' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const created = await EcommerceService.createReturnRequest(user, {
        ...body,
        requireEvidence: body.requireEvidence !== undefined ? body.requireEvidence : true
      });
      return sendJSON(res, 201, {
        success: true,
        message: `Đã gửi yêu cầu đổi trả thành công! Mã hồ sơ của bạn là ${created.returnCode}.`,
        data: created
      });
    }

    if (pathname === '/api/v1/refunds' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const list = RefundService.listRefunds(user);
      return sendJSON(res, 200, { success: true, count: list.length, data: list });
    }

    if (pathname === '/api/v1/refunds' && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER]);
      if (!user) return;
      const body = await parseBody(req);
      const idempotencyKey = req.headers['idempotency-key'] || body.idempotencyKey || null;
      const result = await RefundService.executeRefund(user, { ...body, idempotencyKey });
      return sendJSON(res, result.status === 'succeeded' ? 201 : 502, {
        success: result.status === 'succeeded',
        message: result.status === 'succeeded'
          ? `Đã hoàn tất giao dịch hoàn tiền ${result.id}!`
          : `Giao dịch hoàn tiền ${result.id} thất bại tại cổng thanh toán (chờ xử lý lại).`,
        data: result
      });
    }

    if (pathname.startsWith('/api/v1/returns/') && pathname.endsWith('/status') && method === 'PATCH') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER, ROLES.SERVICE_STAFF]);
      if (!user) return;
      const returnId = decodeURIComponent(pathname.replace('/api/v1/returns/', '').replace('/status', ''));
      const body = await parseBody(req);
      const updated = await EcommerceService.updateReturnStatus(user, returnId, body);
      return sendJSON(res, 200, {
        success: true,
        message: `Đã cập nhật tiến độ hồ sơ ${updated.returnCode} sang "${updated.status}"!`,
        data: updated
      });
    }

    if (pathname.startsWith('/api/v1/returns/') && pathname.endsWith('/supplement') && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const returnId = decodeURIComponent(pathname.replace('/api/v1/returns/', '').replace('/supplement', ''));
      const body = await parseBody(req);
      const updated = await EcommerceService.submitReturnSupplement(user, returnId, body);
      return sendJSON(res, 200, {
        success: true,
        message: 'Đã gửi bổ sung thông tin và cập nhật lịch thu hồi xe thành công!',
        data: updated
      });
    }

    // -------------------------------------------------------------
    // SECTION 3: DIGITAL WARRANTY & MAINTENANCE ROUTES
    // -------------------------------------------------------------
    if (pathname === '/api/v1/warranties' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const data = EcommerceService.getWarrantyAndMaintenanceData(user);
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/warranties/activate' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const activated = await EcommerceService.activateElectronicWarranty(user, body);
      return sendJSON(res, 201, {
        success: true,
        message: `Kích hoạt Bảo hành Điện tử thành công! Mã chứng nhận: ${activated.warrantyCode}`,
        data: activated
      });
    }

    if (pathname === '/api/v1/service-centers' && method === 'GET') {
      return sendJSON(res, 200, { success: true, count: SERVICE_CENTERS.length, data: SERVICE_CENTERS });
    }

    if (pathname === '/api/v1/maintenance/appointments' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const created = await EcommerceService.createServiceAppointment(user, body);
      return sendJSON(res, 201, {
        success: true,
        message: `Đặt lịch dịch vụ thành công! Mã lịch hẹn: ${created.appointmentCode}`,
        data: created
      });
    }

    if (pathname.startsWith('/api/v1/maintenance/appointments/') && pathname.endsWith('/status') && method === 'PATCH') {
      const user = authorize(req, res);
      if (!user) return;
      const apptId = decodeURIComponent(pathname.replace('/api/v1/maintenance/appointments/', '').replace('/status', ''));
      const body = await parseBody(req);
      const updated = await EcommerceService.updateServiceAppointmentStatus(user, apptId, body);
      return sendJSON(res, 200, {
        success: true,
        message: `Đã cập nhật lịch hẹn dịch vụ ${updated.appointmentCode} sang "${updated.status}"!`,
        data: updated
      });
    }

    if (pathname === '/api/v1/maintenance/records' && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER, ROLES.SERVICE_STAFF]);
      if (!user) return;
      const body = await parseBody(req);
      const created = await EcommerceService.createServiceRecord(user, body);
      return sendJSON(res, 201, {
        success: true,
        message: `Đã ghi nhận hồ sơ bảo dưỡng/sửa chữa (${created.invoiceCode}) thành công!`,
        data: created
      });
    }

    // -------------------------------------------------------------
    // SECTION 3B: WORKSHOP SCHEDULING, PARTS LEDGER & WARRANTY CLAIMS (SIG-P4-001..003)
    // -------------------------------------------------------------
    if (pathname === '/api/v1/workshop/resources' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const data = WorkshopService.listResources(user, parsedUrl.query);
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/workshop/resources' && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER, ROLES.SERVICE_STAFF]);
      if (!user) return;
      const body = await parseBody(req);
      const data = await WorkshopService.upsertCenterOrBayOrTech(user, body.kind, body.payload || body);
      return sendJSON(res, 201, { success: true, message: 'Đã cập nhật tài nguyên xưởng dịch vụ!', data });
    }

    if (pathname === '/api/v1/workshop/availability' && method === 'GET') {
      const data = WorkshopService.getScheduleAvailability(parsedUrl.query);
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/workshop/jobs' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const data = WorkshopService.listJobs(user, parsedUrl.query);
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/workshop/jobs' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const job = await WorkshopService.createJob(user, body);
      return sendJSON(res, 201, {
        success: true,
        message: `Đã tạo lệnh dịch vụ xưởng ${job.jobCode} thành công!`,
        data: job
      });
    }

    if (pathname.startsWith('/api/v1/workshop/jobs/') && pathname.endsWith('/reassign') && method === 'PATCH') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER, ROLES.SERVICE_STAFF]);
      if (!user) return;
      const jobId = decodeURIComponent(pathname.replace('/api/v1/workshop/jobs/', '').replace('/reassign', ''));
      const body = await parseBody(req);
      const updated = await WorkshopService.reassignJob(user, jobId, body);
      return sendJSON(res, 200, { success: true, message: `Đã điều phối lại lệnh xưởng ${updated.jobCode}!`, data: updated });
    }

    if (pathname.startsWith('/api/v1/workshop/jobs/') && pathname.endsWith('/cancel') && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const jobId = decodeURIComponent(pathname.replace('/api/v1/workshop/jobs/', '').replace('/cancel', ''));
      const body = await parseBody(req);
      const cancelled = await WorkshopService.cancelJob(user, jobId, body.reason);
      return sendJSON(res, 200, { success: true, message: `Đã hủy lệnh xưởng ${cancelled.jobCode} và hoàn tồn kho phụ tùng.`, data: cancelled });
    }

    if (pathname.startsWith('/api/v1/workshop/jobs/') && pathname.endsWith('/complete') && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER, ROLES.SERVICE_STAFF]);
      if (!user) return;
      const jobId = decodeURIComponent(pathname.replace('/api/v1/workshop/jobs/', '').replace('/complete', ''));
      const body = await parseBody(req);
      const completed = await WorkshopService.completeJob(user, jobId, body);
      return sendJSON(res, 200, {
        success: true,
        message: `Đã nghiệm thu lệnh ${completed.job.jobCode} và xuất hóa đơn ${completed.invoiceSnapshot.invoiceCode}!`,
        data: completed
      });
    }

    if (pathname === '/api/v1/warranty-claims' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const data = WarrantyClaimService.listClaims(user, parsedUrl.query);
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/warranty-claims' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const created = await WarrantyClaimService.submitClaim(user, body);
      return sendJSON(res, 201, {
        success: true,
        message: `Đã gửi hồ sơ yêu cầu bảo hành ${created.claimCode}!`,
        data: created
      });
    }

    if (pathname.startsWith('/api/v1/warranty-claims/') && pathname.endsWith('/review') && method === 'PATCH') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER, ROLES.SERVICE_STAFF]);
      if (!user) return;
      const claimId = decodeURIComponent(pathname.replace('/api/v1/warranty-claims/', '').replace('/review', ''));
      const body = await parseBody(req);
      const updated = await WarrantyClaimService.reviewClaim(user, claimId, body);
      return sendJSON(res, 200, {
        success: true,
        message: `Đã cập nhật thẩm định hồ sơ ${updated.claimCode} (${updated.status}).`,
        data: updated
      });
    }

    // -------------------------------------------------------------
    // SECTION 4: VERIFIED REVIEWS & COMMUNITY Q&A ROUTES
    // -------------------------------------------------------------
    if (pathname === '/api/v1/reviews' && method === 'GET') {
      const currentUser = authenticate(req);
      const data = EcommerceService.getReviewsAndQuestions(parsedUrl.query, currentUser);
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/reviews' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const created = await EcommerceService.createReview(user, body);
      return sendJSON(res, 201, {
        success: true,
        message: created.verifiedPurchase
          ? 'Cảm ơn bạn đã gửi đánh giá! Hệ thống đã gắn nhãn "Đã mua hàng" xác thực cho bài viết của bạn.'
          : 'Cảm ơn bạn đã gửi đánh giá chia sẻ trải nghiệm tới cộng đồng SIGMACAR!',
        data: created
      });
    }

    if (pathname.startsWith('/api/v1/reviews/') && method === 'PUT') {
      const user = authorize(req, res);
      if (!user) return;
      const reviewId = decodeURIComponent(pathname.replace('/api/v1/reviews/', ''));
      const body = await parseBody(req);
      const updated = await EcommerceService.updateReview(user, reviewId, body);
      return sendJSON(res, 200, { success: true, message: 'Đã cập nhật nội dung đánh giá thành công!', data: updated });
    }

    if (pathname.startsWith('/api/v1/reviews/') && method === 'DELETE') {
      const user = authorize(req, res);
      if (!user) return;
      const reviewId = decodeURIComponent(pathname.replace('/api/v1/reviews/', ''));
      const deleted = await EcommerceService.deleteReview(user, reviewId);
      return sendJSON(res, 200, { success: true, message: 'Đã xóa đánh giá của bạn.', data: deleted });
    }

    if (pathname.startsWith('/api/v1/reviews/') && pathname.endsWith('/helpful') && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const reviewId = decodeURIComponent(pathname.replace('/api/v1/reviews/', '').replace('/helpful', ''));
      const result = await EcommerceService.toggleHelpfulVote(user, reviewId);
      return sendJSON(res, 200, {
        success: true,
        message: result.voted ? 'Đã bình chọn đánh giá hữu ích!' : 'Đã bỏ bình chọn hữu ích.',
        data: result
      });
    }

    if (pathname.startsWith('/api/v1/reviews/') && pathname.endsWith('/report') && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const reviewId = decodeURIComponent(pathname.replace('/api/v1/reviews/', '').replace('/report', ''));
      const body = await parseBody(req);
      const result = await EcommerceService.reportReview(user, reviewId, body);
      return sendJSON(res, 200, {
        success: true,
        message: 'Đã gửi báo cáo nội dung tới bộ phận Kiểm duyệt Cộng đồng SIGMACAR.',
        data: result
      });
    }

    if (pathname.startsWith('/api/v1/reviews/') && pathname.endsWith('/moderate') && method === 'PATCH') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF]);
      if (!user) return;
      const reviewId = decodeURIComponent(pathname.replace('/api/v1/reviews/', '').replace('/moderate', ''));
      const body = await parseBody(req);
      const updated = await EcommerceService.moderateReview(user, reviewId, body);
      return sendJSON(res, 200, {
        success: true,
        message: `Đã cập nhật trạng thái kiểm duyệt đánh giá sang "${updated.moderationStatus}".`,
        data: updated
      });
    }

    if (pathname === '/api/v1/questions' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const created = await EcommerceService.createQuestion(user, body);
      return sendJSON(res, 201, {
        success: true,
        message: 'Đã đăng câu hỏi thành công! Chuyên gia hoặc chủ xe SIGMACAR sẽ sớm phản hồi.',
        data: created
      });
    }

    if (pathname.startsWith('/api/v1/questions/') && pathname.endsWith('/answer') && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const questionId = decodeURIComponent(pathname.replace('/api/v1/questions/', '').replace('/answer', ''));
      const body = await parseBody(req);
      const updated = await EcommerceService.answerQuestion(user, questionId, body);
      return sendJSON(res, 201, {
        success: true,
        message: 'Đã gửi câu trả lời vào thảo luận!',
        data: updated
      });
    }

    if (pathname.startsWith('/api/v1/questions/') && pathname.endsWith('/report') && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const questionId = decodeURIComponent(pathname.replace('/api/v1/questions/', '').replace('/report', ''));
      const body = await parseBody(req);
      const result = await EcommerceService.reportQuestion(user, questionId, body);
      return sendJSON(res, 200, { success: true, message: 'Đã gửi báo cáo câu hỏi tới bộ phận kiểm duyệt.', data: result });
    }

    if (pathname.startsWith('/api/v1/questions/') && pathname.endsWith('/moderate') && method === 'PATCH') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF]);
      if (!user) return;
      const questionId = decodeURIComponent(pathname.replace('/api/v1/questions/', '').replace('/moderate', ''));
      const body = await parseBody(req);
      const updated = await EcommerceService.moderateQuestion(user, questionId, body);
      return sendJSON(res, 200, { success: true, message: `Đã kiểm duyệt câu hỏi (${updated.status}).`, data: updated });
    }

    if (pathname.startsWith('/api/v1/questions/') && method === 'PUT') {
      const user = authorize(req, res);
      if (!user) return;
      const questionId = decodeURIComponent(pathname.replace('/api/v1/questions/', ''));
      const body = await parseBody(req);
      const updated = await EcommerceService.updateQuestion(user, questionId, body);
      return sendJSON(res, 200, { success: true, message: 'Đã cập nhật câu hỏi!', data: updated });
    }

    if (pathname.startsWith('/api/v1/questions/') && method === 'DELETE') {
      const user = authorize(req, res);
      if (!user) return;
      const questionId = decodeURIComponent(pathname.replace('/api/v1/questions/', ''));
      const result = await EcommerceService.deleteQuestion(user, questionId);
      return sendJSON(res, 200, { success: true, message: 'Đã xóa câu hỏi.', data: result });
    }

    // -------------------------------------------------------------
    // SECTION 5: CUSTOMER SUPPORT CENTER & TICKETING ROUTES
    // -------------------------------------------------------------
    if (pathname === '/api/v1/support/center' && method === 'GET') {
      const currentUser = authenticate(req);
      const data = EcommerceService.getSupportCenterData(currentUser, parsedUrl.query);
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/support/tickets/lookup' && method === 'GET') {
      const currentUser = authenticate(req);
      const accessToken = parsedUrl.query.accessToken || req.headers['x-ticket-token'] || null;
      const ticket = EcommerceService.lookupTicketByCode(parsedUrl.query.code, currentUser, accessToken);
      return sendJSON(res, 200, { success: true, data: ticket });
    }

    if (pathname === '/api/v1/support/tickets' && method === 'POST') {
      const currentUser = authenticate(req);
      const body = await parseBody(req);
      const created = await EcommerceService.createSupportTicket(currentUser, body);
      return sendJSON(res, 201, {
        success: true,
        message: `Đã gửi yêu cầu hỗ trợ thành công! Mã tra cứu của bạn là ${created.ticketCode}.`,
        data: created
      });
    }

    if (pathname.startsWith('/api/v1/support/tickets/') && pathname.endsWith('/reply') && method === 'POST') {
      const currentUser = authenticate(req);
      const body = await parseBody(req);
      const accessToken = body.accessToken || parsedUrl.query.accessToken || req.headers['x-ticket-token'] || null;
      if (!currentUser && !accessToken) {
        return sendError(res, 401, 'Vui lòng đăng nhập hoặc cung cấp accessToken hợp lệ để phản hồi ticket.', 'UNAUTHORIZED');
      }
      const ticketId = decodeURIComponent(pathname.replace('/api/v1/support/tickets/', '').replace('/reply', ''));
      const updated = await EcommerceService.replyToSupportTicket(currentUser, ticketId, { ...body, accessToken });
      return sendJSON(res, 200, {
        success: true,
        message: 'Đã gửi phản hồi trong luồng hỗ trợ!',
        data: updated
      });
    }

    if (pathname.startsWith('/api/v1/support/tickets/') && pathname.endsWith('/rate') && method === 'POST') {
      const currentUser = authenticate(req);
      const body = await parseBody(req);
      const accessToken = body.accessToken || parsedUrl.query.accessToken || req.headers['x-ticket-token'] || null;
      if (!currentUser && !accessToken) {
        return sendError(res, 401, 'Vui lòng đăng nhập hoặc cung cấp accessToken hợp lệ để đánh giá.', 'UNAUTHORIZED');
      }
      const ticketId = decodeURIComponent(pathname.replace('/api/v1/support/tickets/', '').replace('/rate', ''));
      const rated = await EcommerceService.rateSupportTicket(currentUser, ticketId, { ...body, accessToken });
      return sendJSON(res, 200, {
        success: true,
        message: 'Cảm ơn Quý khách đã đánh giá chất lượng phục vụ!',
        data: rated
      });
    }

    if (pathname.startsWith('/api/v1/support/tickets/') && method === 'PATCH') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF, ROLES.SERVICE_STAFF]);
      if (!user) return;
      const ticketId = decodeURIComponent(pathname.replace('/api/v1/support/tickets/', ''));
      const body = await parseBody(req);
      const updated = await EcommerceService.updateSupportTicketAdmin(user, ticketId, body);
      return sendJSON(res, 200, {
        success: true,
        message: `Đã cập nhật yêu cầu hỗ trợ ${updated.ticketCode}!`,
        data: updated
      });
    }

    // -------------------------------------------------------------
    // SECTION 6: EMAIL CAMPAIGNS & UNSUBSCRIBE ROUTES
    // -------------------------------------------------------------
    if (pathname === '/api/v1/campaigns' && method === 'GET') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF]);
      if (!user) return;
      const data = EcommerceService.getCampaignsOverview(user);
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/campaigns' && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER]);
      if (!user) return;
      const body = await parseBody(req);
      const saved = await EcommerceService.saveCampaign(user, body);
      return sendJSON(res, 201, {
        success: true,
        message: 'Đã lưu mẫu chiến dịch Email thành công!',
        data: saved
      });
    }

    if (pathname === '/api/v1/campaigns/process-queue' && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER]);
      if (!user) return;
      const body = await parseBody(req);
      const result = await CampaignWorker.processCampaignQueue(body || {});
      return sendJSON(res, 200, { success: true, data: result });
    }

    if (pathname === '/api/v1/campaigns/webhooks/delivery' && method === 'POST') {
      const body = await parseBody(req);
      const signature = req.headers['x-webhook-signature'] || req.headers['x-signature'] || req.headers['x-hub-signature-256'] || '';
      const result = await CampaignWorker.handleProviderReceiptWebhook(req.rawBody || JSON.stringify(body), signature);
      return sendJSON(res, 200, { success: true, data: result });
    }

    if (pathname.startsWith('/api/v1/campaigns/') && pathname.endsWith('/deliveries') && method === 'GET') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF]);
      if (!user) return;
      const campaignId = decodeURIComponent(pathname.replace('/api/v1/campaigns/', '').replace('/deliveries', ''));
      const data = EcommerceService.getCampaignDeliveries(user, campaignId);
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname.startsWith('/api/v1/campaigns/') && pathname.endsWith('/status') && method === 'PATCH') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER]);
      if (!user) return;
      const campaignId = decodeURIComponent(pathname.replace('/api/v1/campaigns/', '').replace('/status', ''));
      const body = await parseBody(req);
      const updated = await EcommerceService.updateCampaignStatus(user, campaignId, body);
      return sendJSON(res, 200, {
        success: true,
        message: `Đã chuyển trạng thái chiến dịch sang "${updated.status}"!`,
        data: updated
      });
    }

    if (pathname.startsWith('/api/v1/campaigns/') && pathname.endsWith('/test-send') && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER]);
      if (!user) return;
      const campaignId = decodeURIComponent(pathname.replace('/api/v1/campaigns/', '').replace('/test-send', ''));
      const body = await parseBody(req);
      const result = await EcommerceService.sendTestCampaignEmail(user, campaignId, body);
      return sendJSON(res, 200, {
        success: true,
        message: result.note,
        data: result
      });
    }

    if (pathname.startsWith('/api/v1/campaigns/') && pathname.endsWith('/execute') && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER]);
      if (!user) return;
      const campaignId = decodeURIComponent(pathname.replace('/api/v1/campaigns/', '').replace('/execute', ''));
      const body = await parseBody(req);
      const executed = await EcommerceService.executeCampaignSend(user, campaignId, body || {});
      return sendJSON(res, 200, {
        success: true,
        message: `Chiến dịch "${executed.name}" đã được đưa vào hàng đợi xử lý (${executed.stats?.eligibleRecipients || 0} người nhận hợp lệ)!`,
        data: executed
      });
    }

    if (pathname === '/api/v1/unsubscribe' && method === 'POST') {
      const currentUser = authenticate(req);
      const body = await parseBody(req);
      const result = await EcommerceService.unsubscribeMarketing({
        token: body.token || parsedUrl.query.token || null,
        userId: body.userId || null,
        email: body.email || null,
        reason: body.reason,
        currentUser
      });
      return sendJSON(res, 200, {
        success: true,
        message: 'Đã hủy đăng ký nhận bản tin tiếp thị thành công. Bạn vẫn sẽ nhận được các thông báo giao dịch và bảo hành quan trọng.',
        data: result
      });
    }

    // -------------------------------------------------------------
    // SECTION 7: CMS EDITORIAL PUBLISHING & EV CHARGING STATIONS (SIG-P4-008, SIG-P4-009)
    // -------------------------------------------------------------
    if (pathname === '/api/v1/cms/public' && method === 'GET') {
      const data = await ContentService.getPublicPublished(parsedUrl.query);
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/cms' && method === 'GET') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF]);
      if (!user) return;
      const data = ContentService.listAllForStaff(user);
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/cms' && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF]);
      if (!user) return;
      const body = await parseBody(req);
      const saved = await ContentService.saveDraft(user, body);
      return sendJSON(res, 201, { success: true, message: 'Đã lưu bản nháp nội dung CMS!', data: saved });
    }

    if (pathname.startsWith('/api/v1/cms/') && pathname.endsWith('/publish') && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF]);
      if (!user) return;
      const contentId = decodeURIComponent(pathname.replace('/api/v1/cms/', '').replace('/publish', ''));
      const body = await parseBody(req);
      const updated = await ContentService.publishOrSchedule(user, contentId, body);
      return sendJSON(res, 200, {
        success: true,
        message: updated.status === 'scheduled' ? 'Đã đặt lịch xuất bản nội dung CMS!' : 'Đã xuất bản nội dung CMS công khai!',
        data: updated
      });
    }

    if (pathname.startsWith('/api/v1/cms/') && pathname.endsWith('/rollback') && method === 'POST') {
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF]);
      if (!user) return;
      const contentId = decodeURIComponent(pathname.replace('/api/v1/cms/', '').replace('/rollback', ''));
      const body = await parseBody(req);
      const updated = await ContentService.rollbackVersion(user, contentId, body);
      return sendJSON(res, 200, { success: true, message: 'Đã khôi phục phiên bản nội dung CMS!', data: updated });
    }

    if (pathname === '/api/v1/charging/stations' && method === 'GET') {
      const data = await ChargingService.findStations(parsedUrl.query);
      return sendJSON(res, 200, { success: true, data });
    }

    // -------------------------------------------------------------
    // P3 EXPERIENCE: TCO ESTIMATOR, CONFIGURATIONS, ACCESSORIES & BUNDLES
    // -------------------------------------------------------------
    if (pathname === '/api/v1/cost-estimates/assumptions' && method === 'GET') {
      const data = TcoService.getAssumptions(parsedUrl.query.region || 'hcm');
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/cost-estimates/tco' && method === 'POST') {
      const body = await parseBody(req);
      const data = TcoService.estimate(body);
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/configurations' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const data = ConfigurationService.listForUser(user);
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/configurations' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const data = await ConfigurationService.saveConfiguration(user, body);
      return sendJSON(res, 201, { success: true, message: 'Đã lưu cấu hình cá nhân hóa thành công!', data });
    }

    if (pathname.startsWith('/api/v1/configurations/') && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;
      const configId = decodeURIComponent(pathname.replace('/api/v1/configurations/', ''));
      const data = ConfigurationService.getById(user, configId);
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname.startsWith('/api/v1/configurations/') && (method === 'PATCH' || method === 'PUT')) {
      const user = authorize(req, res);
      if (!user) return;
      const configId = decodeURIComponent(pathname.replace('/api/v1/configurations/', ''));
      const body = await parseBody(req);
      const data = await ConfigurationService.saveConfiguration(user, body, configId);
      return sendJSON(res, 200, { success: true, message: 'Đã cập nhật cấu hình xe!', data });
    }

    if (pathname.startsWith('/api/v1/configurations/') && method === 'DELETE') {
      const user = authorize(req, res);
      if (!user) return;
      const configId = decodeURIComponent(pathname.replace('/api/v1/configurations/', ''));
      const data = await ConfigurationService.deleteConfiguration(user, configId);
      return sendJSON(res, 200, { success: true, message: 'Đã xóa cấu hình xe.', data });
    }

    if (pathname === '/api/v1/accessories' && method === 'GET') {
      const data = AccessoryService.listAll({
        vehicleId: parsedUrl.query.vehicleId || null,
        category: parsedUrl.query.category || null,
        kind: parsedUrl.query.kind || null,
        inStockOnly: parsedUrl.query.inStockOnly === 'true',
        compatibleOnly: parsedUrl.query.compatibleOnly === 'true',
        q: parsedUrl.query.q || ''
      });
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname.startsWith('/api/v1/accessories/') && method === 'GET') {
      const sku = decodeURIComponent(pathname.replace('/api/v1/accessories/', ''));
      const data = AccessoryService.getBySku(sku, parsedUrl.query.vehicleId || null);
      if (!data) {
        return sendError(res, 404, 'Không tìm thấy phụ kiện hoặc phụ tùng theo mã SKU.', 'ACCESSORY_NOT_FOUND');
      }
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/bundles/recommend' && method === 'GET') {
      const data = BundleService.recommendForVehicle({
        vehicleId: parsedUrl.query.vehicleId || null,
        usage: parsedUrl.query.usage || null
      });
      return sendJSON(res, 200, { success: true, data });
    }

    if (pathname === '/api/v1/bundles/quote' && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const data = await BundleService.createQuote(user, body);
      return sendJSON(res, 201, { success: true, message: 'Đã tạo báo giá gói phụ kiện!', data });
    }

    // Unmatched API endpoint
    return sendError(res, 404, `API route not found: ${method} ${pathname}`, 'ROUTE_NOT_FOUND');
  } catch (err) {
    console.error(`API Error on ${method} ${pathname}:`, err.message);
    const statusCode = err.statusCode || 400;
    const errorCode = err.code || (statusCode === 401 ? 'UNAUTHORIZED' : statusCode === 409 ? 'SLOT_CONFLICT' : 'BAD_REQUEST');
    const details = err.currentVersion !== undefined ? { currentVersion: err.currentVersion, currentRecord: err.currentRecord, currentCart: err.currentCart } : undefined;
    return sendError(res, statusCode, err.message, errorCode, details);
  }
}

module.exports = {
  handleApiRequest
};
