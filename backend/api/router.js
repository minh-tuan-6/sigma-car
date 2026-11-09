// backend/api/router.js
// Versioned RESTful API Route Dispatcher for SIGMACAR (/api/v1/...)

const url = require('url');
const { sendJSON, sendError, authenticate, authorize, checkRateLimit, parseBody } = require('./middleware');
const AuthService = require('../application/auth-service');
const VehicleRepository = require('../infrastructure/repositories/vehicle-repository');
const OrderService = require('../application/order-service');
const OrderRepository = require('../infrastructure/repositories/order-repository');
const AppointmentRepository = require('../infrastructure/repositories/appointment-repository');
const FinancingService = require('../application/financing-service');
const AnalyticsService = require('../application/analytics-service');
const AIService = require('../application/ai-service');
const EcommerceService = require('../application/ecommerce-service');
const UserRepository = require('../infrastructure/repositories/user-repository');
const { ROLES, SERVICE_CENTERS } = require('../domain/constants');

async function handleApiRequest(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

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
      const minPrice = query.minPrice ? parseFloat(query.minPrice) : undefined;
      const maxPrice = query.maxPrice ? parseFloat(query.maxPrice) : undefined;
      const vehicles = await VehicleRepository.findAll({
        category: query.category,
        fuel: query.fuel,
        minPrice,
        maxPrice,
        search: query.search,
        sort: query.sort,
        type: query.type
      });
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

    if (pathname.startsWith('/api/v1/vehicles/') && method === 'GET') {
      const id = pathname.replace('/api/v1/vehicles/', '');
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
    // FINANCING CALCULATOR ROUTE
    // -------------------------------------------------------------
    if (pathname === '/api/v1/financing/calculate' && method === 'POST') {
      const body = await parseBody(req);
      const result = FinancingService.calculateLoan({
        vehiclePrice: parseFloat(body.vehiclePrice),
        downPaymentPercent: parseFloat(body.downPaymentPercent || '30'),
        annualInterestRatePercent: parseFloat(body.annualInterestRatePercent || '7.9'),
        termMonths: parseInt(body.termMonths || '60', 10)
      });
      return sendJSON(res, 200, { success: true, data: result });
    }

    // -------------------------------------------------------------
    // ORDERS & DEPOSITS ROUTES
    // -------------------------------------------------------------
    if (pathname === '/api/v1/orders/deposit' && method === 'POST') {
      const body = await parseBody(req);
      // Optional authenticated user or guest buyer info
      const authUser = authenticate(req);
      const userId = authUser ? authUser.userId : `guest_${Date.now()}`;

      const order = await OrderService.createDepositOrder({
        userId,
        buyerName: body.buyerName,
        buyerPhone: body.buyerPhone,
        vehicleId: body.vehicleId,
        branchId: body.branchId,
        paymentMethod: body.paymentMethod
      });

      return sendJSON(res, 201, { success: true, message: 'Đặt cọc thành công!', data: order });
    }

    if (pathname === '/api/v1/orders' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;

      const orders = await OrderRepository.findByQuery({
        userId: user.userId,
        branchId: user.branchId,
        userRole: user.role
      });
      return sendJSON(res, 200, { success: true, count: orders.length, data: orders });
    }

    if (pathname.startsWith('/api/v1/orders/') && pathname.endsWith('/status') && method === 'PATCH') {
      const user = authorize(req, res, [ROLES.SELLER, ROLES.ADMIN]);
      if (!user) return;

      const orderId = pathname.replace('/api/v1/orders/', '').replace('/status', '');
      const body = await parseBody(req);
      const updated = await OrderService.updateOrderStatus(orderId, body.status, user);
      return sendJSON(res, 200, { success: true, data: updated });
    }

    if (pathname.startsWith('/api/v1/orders/') && pathname.endsWith('/complete-payment') && method === 'POST') {
      const user = authorize(req, res);
      if (!user) return;

      const orderId = pathname.replace('/api/v1/orders/', '').replace('/complete-payment', '');
      const body = await parseBody(req);
      const updated = await OrderService.completePayment(orderId, user, body);
      return sendJSON(res, 200, { success: true, message: 'Thanh toán hoàn tất thành công! Xe đã được chuyển vào Gara của bạn.', data: updated });
    }

    // -------------------------------------------------------------
    // TEST DRIVE APPOINTMENTS ROUTES
    // -------------------------------------------------------------
    if (pathname === '/api/v1/appointments' && method === 'POST') {
      const body = await parseBody(req);
      const authUser = authenticate(req);
      const userId = authUser ? authUser.userId : `guest_${Date.now()}`;

      const appt = await AppointmentRepository.create({
        userId,
        customerName: body.customerName,
        phone: body.phone || body.customerPhone,
        email: body.email || body.customerEmail,
        carName: body.carName || body.vehicleModel,
        branchId: body.branchId || 'hn-caugiay',
        branchName: body.branchName || 'Showroom SIGMACAR Cầu Giấy (Hà Nội)',
        preferredDate: body.preferredDate || body.date,
        timeSlot: body.timeSlot
      });

      return sendJSON(res, 201, { success: true, message: 'Đặt lịch lái thử thành công!', data: appt });
    }

    if (pathname === '/api/v1/appointments' && method === 'GET') {
      const user = authorize(req, res);
      if (!user) return;

      const list = await AppointmentRepository.findByQuery({
        userId: user.userId,
        branchId: user.branchId,
        userRole: user.role
      });
      return sendJSON(res, 200, { success: true, count: list.length, data: list });
    }

    if (pathname.startsWith('/api/v1/appointments/') && pathname.endsWith('/status') && method === 'PATCH') {
      const user = authorize(req, res);
      if (!user) return;

      const apptId = pathname.replace('/api/v1/appointments/', '').replace('/status', '');
      const body = await parseBody(req);
      const updated = await AppointmentRepository.transitionStatus(apptId, body.status, user.userId, user.role);
      return sendJSON(res, 200, { success: true, data: updated });
    }

    // -------------------------------------------------------------
    // ANALYTICS ROUTE (Restricted to Sellers & Admins)
    // -------------------------------------------------------------
    if ((pathname === '/api/v1/analytics/overview' || pathname === '/api/v1/analytics/summary') && method === 'GET') {
      const user = authorize(req, res, [ROLES.SELLER, ROLES.ADMIN]);
      if (!user) return;

      const data = AnalyticsService.getSellerOverview({
        branchId: user.role === ROLES.SELLER ? user.branchId : undefined
      });
      return sendJSON(res, 200, { success: true, data });
    }

    // -------------------------------------------------------------
    // AI CHATBOT & LIVE RAG ROUTES
    // -------------------------------------------------------------
    if (pathname === '/api/v1/ai/chat' && method === 'POST') {
      const body = await parseBody(req);
      const currentUser = authenticate(req); // null if guest, user object if logged in
      const result = await AIService.chat({
        message: body.message,
        history: body.history || [],
        currentUser
      });
      return sendJSON(res, 200, { success: true, data: result });
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
      const user = authorize(req, res, [ROLES.ADMIN, ROLES.SELLER]);
      if (!user) return;
      const users = await UserRepository.findAll();
      return sendJSON(res, 200, { success: true, count: users.length, data: users });
    }

    if (pathname.startsWith('/api/v1/admin/users/') && pathname.endsWith('/role') && method === 'PATCH') {
      const user = authorize(req, res, [ROLES.ADMIN]);
      if (!user) return;
      const targetId = pathname.replace('/api/v1/admin/users/', '').replace('/role', '');
      const body = await parseBody(req);
      if (!Object.values(ROLES).includes(body.role)) {
        return sendError(res, 400, 'Vai trò phân quyền không hợp lệ.', 'INVALID_ROLE');
      }
      const updated = await UserRepository.updateRoleByAdmin(targetId, body.role, body.branchId, body.branchName);
      return sendJSON(res, 200, { success: true, message: `Đã cập nhật vai trò người dùng thành "${body.role}"!`, data: updated });
    }

    // -------------------------------------------------------------
    // SECTION 2: AUTOMATED 7-DAY RETURNS CENTER ROUTES
    // -------------------------------------------------------------
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
      const created = await EcommerceService.createReturnRequest(user, body);
      return sendJSON(res, 201, {
        success: true,
        message: `Đã gửi yêu cầu đổi trả thành công! Mã hồ sơ của bạn là ${created.returnCode}.`,
        data: created
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
      const ticket = EcommerceService.lookupTicketByCode(parsedUrl.query.code, currentUser);
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
      const user = authorize(req, res);
      if (!user) return;
      const ticketId = decodeURIComponent(pathname.replace('/api/v1/support/tickets/', '').replace('/reply', ''));
      const body = await parseBody(req);
      const updated = await EcommerceService.replyToSupportTicket(user, ticketId, body);
      return sendJSON(res, 200, {
        success: true,
        message: 'Đã gửi phản hồi trong luồng hỗ trợ!',
        data: updated
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
      const executed = await EcommerceService.executeCampaignSend(user, campaignId, body);
      return sendJSON(res, 200, {
        success: true,
        message: `Chiến dịch "${executed.name}" đã được xử lý cho ${executed.stats.sentCount} người nhận đủ điều kiện!`,
        data: executed
      });
    }

    if (pathname === '/api/v1/unsubscribe' && method === 'POST') {
      const currentUser = authenticate(req);
      const body = await parseBody(req);
      const result = await EcommerceService.unsubscribeMarketing({
        userId: currentUser ? currentUser.userId : body.userId,
        email: body.email || (currentUser ? currentUser.email : ''),
        reason: body.reason
      });
      return sendJSON(res, 200, {
        success: true,
        message: 'Đã hủy đăng ký nhận bản tin tiếp thị thành công. Bạn vẫn sẽ nhận được các thông báo giao dịch và bảo hành quan trọng.',
        data: result
      });
    }

    // Unmatched API endpoint
    return sendError(res, 404, `API route not found: ${method} ${pathname}`, 'ROUTE_NOT_FOUND');
  } catch (err) {
    console.error(`API Error on ${method} ${pathname}:`, err.message);
    const statusCode = err.statusCode || 400;
    const errorCode = err.code || (statusCode === 401 ? 'UNAUTHORIZED' : statusCode === 409 ? 'SLOT_CONFLICT' : 'BAD_REQUEST');
    return sendError(res, statusCode, err.message, errorCode);
  }
}

module.exports = {
  handleApiRequest
};
