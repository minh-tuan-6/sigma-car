// backend/application/order-service.js
// Order placement, inventory reservation, and lifecycle management

const OrderRepository = require('../infrastructure/repositories/order-repository');
const VehicleRepository = require('../infrastructure/repositories/vehicle-repository');
const Authorization = require('../domain/authorization');
const Security = require('../infrastructure/security');
const { SHOWROOM_BRANCHES, normalizeOrderStatus } = require('../domain/constants');

const OrderService = {
  // Create order with server-side price validation and atomic inventory reservation
  async createDepositOrder({ userId, buyerName, buyerPhone, vehicleId, branchId, paymentMethod }) {
    if (!vehicleId || !buyerName || !buyerPhone) {
      const err = new Error('Vui lòng cung cấp đầy đủ thông tin đặt cọc (Mẫu xe, Họ tên, Số điện thoại).');
      err.statusCode = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    // 1. Fetch vehicle from server catalog to guarantee authoritative price
    const vehicle = await VehicleRepository.findById(vehicleId);
    if (!vehicle || vehicle.archived) {
      const err = new Error(`Mẫu xe "${vehicleId}" không tồn tại hoặc đã ngừng kinh doanh.`);
      err.statusCode = 404;
      err.code = 'VEHICLE_NOT_FOUND';
      throw err;
    }

    // 2. Validate branch strictly when branchId provided
    let branch = SHOWROOM_BRANCHES[0];
    if (branchId) {
      const matched = SHOWROOM_BRANCHES.find(b => b.id === branchId);
      if (!matched) {
        const err = new Error(`Showroom/chi nhánh "${branchId}" không hợp lệ.`);
        err.statusCode = 400;
        err.code = 'INVALID_BRANCH';
        throw err;
      }
      branch = matched;
    }

    // 3. Atomically reserve vehicle stock at chosen branch
    await VehicleRepository.reserveInventory(vehicle.id, 1, branch.id);

    try {
      // 4. Create order snapshot with authoritative server price
      const order = await OrderRepository.create({
        userId,
        buyerName: Security.sanitizeString(buyerName),
        buyerPhone: Security.sanitizeString(buyerPhone),
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        unitPrice: vehicle.price,
        depositAmount: 50000000, // Standard 50M VND deposit
        img: vehicle.image,
        branchId: branch.id,
        branchName: branch.name,
        paymentMethod: paymentMethod ? Security.sanitizeString(paymentMethod) : 'Chuyển khoản QR Napas 24/7'
      });

      return order;
    } catch (err) {
      // Rollback reserved inventory if order persistence fails
      await VehicleRepository.restoreInventory(vehicle.id, 1, branch.id);
      throw err;
    }
  },

  async completePayment(orderId, user, paymentDetails = {}) {
    const order = await OrderRepository.findById(orderId);
    if (!order) {
      const err = new Error('Đơn hàng không tồn tại.');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    Authorization.assertAuthorized(
      Authorization.canReadOrder(user, order),
      'Bạn không có quyền thao tác thanh toán cho đơn hàng này.',
      403,
      'FORBIDDEN'
    );

    return await OrderRepository.markPaymentComplete(order.id, user, paymentDetails);
  },

  async updateOrderStatus(orderId, targetStatus, user, note = '') {
    const canonicalTarget = normalizeOrderStatus(targetStatus);
    if (!canonicalTarget) {
      const err = new Error(`Trạng thái đơn hàng "${targetStatus}" không hợp lệ.`);
      err.statusCode = 409;
      err.code = 'INVALID_ORDER_STATUS';
      throw err;
    }
    // Single transactional transition: authorization & state machine run BEFORE stock restoration
    return await OrderRepository.transitionStatus(
      orderId,
      canonicalTarget,
      user.userId,
      user.role,
      note,
      user
    );
  },

  async getOrderTimeline(orderId, user) {
    const order = await OrderRepository.findById(orderId);
    if (!order) {
      const err = new Error('Không tìm thấy đơn hàng.');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }
    Authorization.assertAuthorized(
      Authorization.canReadOrder(user, order),
      'Bạn không có quyền xem tiến độ đơn hàng này.',
      403,
      'FORBIDDEN'
    );
    const events = Array.isArray(order.history) ? order.history : [];
    return {
      orderId: order.id,
      orderNumber: order.orderNumber || order.id,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      updatedAt: order.updatedAt || order.createdAt,
      events
    };
  }
};

module.exports = OrderService;
