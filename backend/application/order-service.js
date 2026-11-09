// backend/application/order-service.js
// Order placement, inventory reservation, and lifecycle management

const OrderRepository = require('../infrastructure/repositories/order-repository');
const VehicleRepository = require('../infrastructure/repositories/vehicle-repository');
const { SHOWROOM_BRANCHES, ORDER_STATUS } = require('../domain/constants');

const OrderService = {
  // Create order with server-side price validation and atomic inventory reservation
  async createDepositOrder({ userId, buyerName, buyerPhone, vehicleId, branchId, paymentMethod }) {
    if (!vehicleId || !buyerName || !buyerPhone) {
      throw new Error('Vui lòng cung cấp đầy đủ thông tin đặt cọc (Mẫu xe, Họ tên, Số điện thoại).');
    }

    // 1. Fetch vehicle from server catalog to guarantee authoritative price
    const vehicle = await VehicleRepository.findById(vehicleId);
    if (!vehicle) {
      throw new Error(`Mẫu xe "${vehicleId}" không tồn tại trong danh mục.`);
    }

    // 2. Validate branch
    const branch = SHOWROOM_BRANCHES.find(b => b.id === branchId) || SHOWROOM_BRANCHES[0];

    // 3. Atomically reserve vehicle stock
    await VehicleRepository.reserveInventory(vehicle.id, 1);

    try {
      // 4. Create order snapshot with authoritative server price
      const order = await OrderRepository.create({
        userId,
        buyerName,
        buyerPhone,
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        unitPrice: vehicle.price,
        depositAmount: 50000000, // Standard 50M VND deposit
        img: vehicle.image,
        branchId: branch.id,
        branchName: branch.name,
        paymentMethod: paymentMethod || 'Chuyển khoản QR Napas 24/7'
      });

      return order;
    } catch (err) {
      // Rollback reserved inventory if order persistence fails
      await VehicleRepository.restoreInventory(vehicle.id, 1);
      throw err;
    }
  },

  async completePayment(orderId, user, paymentDetails = {}) {
    const order = await OrderRepository.findById(orderId);
    if (!order) {
      throw new Error('Đơn hàng không tồn tại.');
    }

    return await OrderRepository.markPaymentComplete(orderId, user.userId, paymentDetails);
  },

  async updateOrderStatus(orderId, targetStatus, user) {
    const order = await OrderRepository.findById(orderId);
    if (!order) {
      throw new Error('Đơn hàng không tồn tại.');
    }

    // If order is transitioning to CANCELLED, restore vehicle inventory
    if (targetStatus === ORDER_STATUS.CANCELLED && order.orderStatus !== ORDER_STATUS.CANCELLED) {
      await VehicleRepository.restoreInventory(order.vehicleId, 1);
    }

    return await OrderRepository.transitionStatus(orderId, targetStatus, user.userId, user.role);
  }
};

module.exports = OrderService;
