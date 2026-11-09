// backend/infrastructure/repositories/order-repository.js
// OrderRepository interface with transactional persistence & audit logging

const { dbState, runInTransaction } = require('../storage-engine');
const { ORDER_STATUS, PAYMENT_STATUS, ROLES } = require('../../domain/constants');
const { canUserTransitionOrder } = require('../../domain/state-machines');

const OrderRepository = {
  async findById(orderId) {
    return dbState.orders.find(o => o.id === orderId || o.orderNumber === orderId) || null;
  },

  async findByQuery({ userId, branchId, userRole } = {}) {
    let list = [...dbState.orders];

    // Record-level isolation:
    // Buyers can only see their own orders
    if (userRole === ROLES.BUYER && userId) {
      list = list.filter(o => o.userId === userId);
    } 
    // Sellers can only see orders assigned to their store branch
    else if (userRole === ROLES.SELLER && branchId) {
      list = list.filter(o => o.branchId === branchId);
    }
    // Admins see all orders

    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async create(orderData) {
    return runInTransaction(async (state) => {
      // Idempotency / duplicate check within short time window
      const recentDup = state.orders.find(o => 
        o.userId === orderData.userId && 
        o.vehicleId === orderData.vehicleId && 
        o.orderStatus === ORDER_STATUS.PENDING &&
        (Date.now() - new Date(o.createdAt).getTime()) < 30000 // 30 seconds
      );
      if (recentDup) {
        throw new Error('Đơn hàng của bạn đang được xử lý. Vui lòng không gửi yêu cầu trùng lặp.');
      }

      const id = `ORD-${Date.now().toString().slice(-6)}`;
      const orderNumber = `SG-2026-${Date.now().toString().slice(-4)}`;

      const newOrder = {
        id,
        orderNumber,
        userId: orderData.userId,
        buyerId: orderData.userId,
        buyerName: orderData.buyerName,
        buyerPhone: orderData.buyerPhone,
        vehicleId: orderData.vehicleId,
        vehicleName: orderData.vehicleName,
        unitPrice: orderData.unitPrice,
        depositAmount: orderData.depositAmount || 50000000,
        img: orderData.img || 'assets/model-e.jpg',
        branchId: orderData.branchId,
        branchName: orderData.branchName,
        orderStatus: ORDER_STATUS.PENDING,
        paymentStatus: PAYMENT_STATUS.DEPOSIT_PAID,
        paymentMethod: orderData.paymentMethod || 'Chuyển khoản QR Napas 24/7',
        history: [
          {
            status: ORDER_STATUS.PENDING,
            timestamp: new Date().toISOString(),
            updatedBy: orderData.userId,
            note: 'Khách hàng tạo đơn và đặt cọc thành công.'
          }
        ],
        createdAt: new Date().toISOString()
      };

      state.orders.push(newOrder);
      return newOrder;
    });
  },

  async markPaymentComplete(orderId, updatedByUserId, paymentDetails = {}) {
    return runInTransaction(async (state) => {
      const order = state.orders.find(o => o.id === orderId);
      if (!order) {
        const err = new Error(`Không tìm thấy đơn hàng "${orderId}".`);
        err.statusCode = 404;
        throw err;
      }

      order.orderStatus = ORDER_STATUS.DELIVERED;
      order.paymentStatus = PAYMENT_STATUS.FULLY_PAID;
      order.paidAmount = order.unitPrice || order.depositAmount;
      if (paymentDetails.paymentMethod) {
        order.paymentMethod = paymentDetails.paymentMethod;
      }
      order.completedAt = new Date().toISOString();
      order.history = order.history || [];
      order.history.push({
        status: ORDER_STATUS.DELIVERED,
        timestamp: new Date().toISOString(),
        updatedBy: updatedByUserId,
        note: `Khách hàng đã thanh toán hoàn tất 100% qua ${order.paymentMethod}. Phương tiện đã chính thức được kích hoạt vào Gara.`
      });

      return order;
    });
  },

  async transitionStatus(orderId, targetStatus, updatedByUserId, userRole, note = '') {
    return runInTransaction(async (state) => {
      const order = state.orders.find(o => o.id === orderId);
      if (!order) {
        const err = new Error(`Không tìm thấy đơn hàng "${orderId}".`);
        err.statusCode = 404;
        throw err;
      }

      // Check RBAC and state machine transition rules
      const check = canUserTransitionOrder(userRole, order.orderStatus, targetStatus);
      if (!check.allowed) {
        const err = new Error(check.reason);
        err.statusCode = 403;
        err.code = 'FORBIDDEN';
        throw err;
      }

      // Record state change in auditable history
      order.orderStatus = targetStatus;
      order.history.push({
        status: targetStatus,
        timestamp: new Date().toISOString(),
        updatedBy: updatedByUserId,
        role: userRole,
        note: note || `Chuyển trạng thái sang ${targetStatus}`
      });

      return order;
    });
  }
};

module.exports = OrderRepository;
