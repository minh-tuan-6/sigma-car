// backend/infrastructure/repositories/order-repository.js
// OrderRepository interface with transactional persistence, fail-closed branch isolation & audit logging

const { dbState, runInTransaction } = require('../storage-engine');
const { ORDER_STATUS, PAYMENT_STATUS, PAYMENT_INTENT_STATUS, ROLES, normalizeOrderStatus } = require('../../domain/constants');
const { canUserTransitionOrder } = require('../../domain/state-machines');
const Authorization = require('../../domain/authorization');
const InventoryRepository = require('./inventory-repository');
const NotificationService = require('../../application/notification-service');

function restoreStockInState(state, vehicleId, quantity = 1, branchId = 'hn-caugiay', actorId = 'system', referenceId = null) {
  if (!vehicleId) return null;
  const found = InventoryRepository.findVehicleRecordInState(state, vehicleId);
  if (!found) return null;
  const rows = InventoryRepository.ensureBranchRowsInState(state, found.record.id);
  const row = rows.find(r => r.branchId === branchId) || rows[0];
  if (row) {
    if ((row.reservedQty || 0) >= quantity) {
      row.reservedQty -= quantity;
    } else {
      row.stockOnHand = (row.stockOnHand || 0) + quantity;
    }
    row.version = (row.version || 1) + 1;
    row.updatedAt = new Date().toISOString();
    InventoryRepository.appendMovementInState(state, {
      vehicleId: found.record.id,
      branchId: row.branchId,
      delta: quantity,
      reason: 'ORDER_CANCEL_RESTORE',
      referenceId,
      actorId,
      versionAfter: row.version
    });
  }
  InventoryRepository.syncAggregateVehicleStockInState(state, found.record.id);
  return found.record;
}

const OrderRepository = {
  async findById(orderId) {
    return dbState.orders.find(o => o.id === orderId || o.orderNumber === orderId) || null;
  },

  async findByQuery({ userId, branchId, branchIds, userRole } = {}) {
    let list = [...dbState.orders];

    if (userRole === ROLES.ADMIN) {
      if (branchId && branchId !== 'all') {
        list = list.filter(o => o.branchId === branchId);
      }
    } else if (userRole === ROLES.BUYER) {
      if (!userId) return [];
      list = list.filter(o => o.userId === userId || o.buyerId === userId);
    } else if (userRole === ROLES.SELLER) {
      const allowed = Array.isArray(branchIds) && branchIds.length > 0
        ? branchIds.filter(Boolean)
        : (branchId ? [branchId] : []);
      if (allowed.length === 0) return [];
      list = list.filter(o => o.branchId && allowed.includes(o.branchId));
    } else {
      return [];
    }

    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async create(orderData) {
    return runInTransaction(async (state) => {
      // Idempotency / duplicate check within short time window
      const recentDup = state.orders.find(o =>
        o.userId === orderData.userId &&
        o.vehicleId === orderData.vehicleId &&
        o.orderStatus === ORDER_STATUS.PENDING &&
        (Date.now() - new Date(o.createdAt).getTime()) < 30000
      );
      if (recentDup) {
        const err = new Error('Đơn hàng của bạn đang được xử lý. Vui lòng không gửi yêu cầu trùng lặp.');
        err.statusCode = 409;
        err.code = 'DUPLICATE_ORDER';
        throw err;
      }

      const id = `ORD-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
      const orderNumber = `SG-2026-${Date.now().toString().slice(-4)}`;
      const now = new Date().toISOString();

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
        paidAmount: 0,
        img: orderData.img || 'assets/model-e.jpg',
        branchId: orderData.branchId,
        branchName: orderData.branchName,
        orderStatus: ORDER_STATUS.PENDING,
        // Never mark paid at order creation before payment gateway confirmation
        paymentStatus: PAYMENT_STATUS.UNPAID,
        paymentMethod: orderData.paymentMethod || 'Chuyển khoản QR Napas 24/7',
        reservedInventory: true,
        inventoryRestored: false,
        history: [
          {
            status: ORDER_STATUS.PENDING,
            timestamp: now,
            updatedBy: orderData.userId,
            note: 'Khách hàng tạo đơn giữ suất đặt cọc (chờ xác nhận thanh toán).'
          }
        ],
        createdAt: now
      };

      state.orders.push(newOrder);
      return newOrder;
    });
  },

  async markPaymentComplete(orderId, actorOrUserId, paymentDetails = {}) {
    return runInTransaction(async (state) => {
      const order = state.orders.find(o => o.id === orderId || o.orderNumber === orderId);
      if (!order) {
        const err = new Error(`Không tìm thấy đơn hàng "${orderId}".`);
        err.statusCode = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }

      const actor = typeof actorOrUserId === 'object' && actorOrUserId !== null
        ? actorOrUserId
        : state.users.find(u => u.id === actorOrUserId);
      const actorId = (actor && (actor.userId || actor.id)) || actorOrUserId;
      const actorRole = actor && actor.role;

      if (actor) {
        const isOwner = order.userId === actorId || order.buyerId === actorId;
        const isPrivileged = actorRole === ROLES.ADMIN;
        if (!isOwner && !isPrivileged) {
          const err = new Error('Bạn không có quyền xác nhận thanh toán cho đơn hàng này.');
          err.statusCode = 403;
          err.code = 'FORBIDDEN';
          throw err;
        }
      }

      // Require verified payment intent or Admin/webhook settlement rather than blind buyer self-delivery
      const verifiedIntent = paymentDetails.paymentIntentId
        ? (state.paymentIntents || []).find(p =>
            p.id === paymentDetails.paymentIntentId &&
            p.orderId === order.id &&
            (p.status === PAYMENT_INTENT_STATUS.SUCCEEDED || p.status === 'Paid')
          )
        : null;
      const isWebhook = Boolean(paymentDetails.verifiedByWebhook);
      const isAdminSettlement = actorRole === ROLES.ADMIN && Boolean(paymentDetails.transactionRef || paymentDetails.adminVerified);

      if (!verifiedIntent && !isWebhook && !isAdminSettlement) {
        const err = new Error('Thanh toán chỉ được ghi nhận sau khi giao dịch được xác thực qua cổng thanh toán hoặc webhook ngân hàng.');
        err.statusCode = 409;
        err.code = 'PAYMENT_VERIFICATION_REQUIRED';
        throw err;
      }

      const settledAmount = Number(
        paymentDetails.amount ||
        (verifiedIntent && verifiedIntent.amount) ||
        order.unitPrice ||
        order.depositAmount
      );
      order.paidAmount = Math.max(order.paidAmount || 0, settledAmount);
      order.paymentStatus = order.paidAmount >= (order.unitPrice || 0)
        ? PAYMENT_STATUS.FULLY_PAID
        : PAYMENT_STATUS.DEPOSIT_PAID;
      if (paymentDetails.paymentMethod) {
        order.paymentMethod = paymentDetails.paymentMethod;
      }
      order.paymentConfirmedAt = new Date().toISOString();
      order.history = order.history || [];
      order.history.push({
        status: order.orderStatus,
        paymentStatus: order.paymentStatus,
        timestamp: order.paymentConfirmedAt,
        updatedBy: actorId,
        note: `Ghi nhận thanh toán ${order.paymentStatus} qua ${order.paymentMethod}.`
      });

      return order;
    });
  },

  async transitionStatus(orderId, targetStatusRaw, updatedByUserId, userRole, note = '', actorOverride = null) {
    return runInTransaction(async (state) => {
      const order = state.orders.find(o => o.id === orderId || o.orderNumber === orderId);
      if (!order) {
        const err = new Error(`Không tìm thấy đơn hàng "${orderId}".`);
        err.statusCode = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }

      const targetStatus = normalizeOrderStatus(targetStatusRaw);
      const actor = actorOverride || state.users.find(u => u.id === updatedByUserId) || { userId: updatedByUserId, role: userRole };
      const normalizedActor = { ...actor, userId: actor.userId || actor.id || updatedByUserId };

      // 1. Check owner / branch scope BEFORE any state or stock mutation (CR-04)
      const scopeCheck = Authorization.canMutateOrderStatus(normalizedActor, order, targetStatus);
      if (!scopeCheck.allowed) {
        const err = new Error(scopeCheck.reason);
        err.statusCode = scopeCheck.statusCode || 403;
        err.code = scopeCheck.code || 'FORBIDDEN';
        throw err;
      }

      // 2. Check RBAC and state machine transition rules
      const check = canUserTransitionOrder(normalizedActor.role, order.orderStatus, targetStatus);
      if (!check.allowed) {
        const err = new Error(check.reason);
        err.statusCode = check.statusCode || 403;
        err.code = check.code || 'FORBIDDEN';
        throw err;
      }

      const prevStatus = order.orderStatus;

      // 3. Only restore stock AFTER authorization + transition pass, and never twice
      if (targetStatus === ORDER_STATUS.CANCELLED && prevStatus !== ORDER_STATUS.CANCELLED && !order.inventoryRestored) {
        if (Array.isArray(order.reservationIds) && order.reservationIds.length > 0) {
          for (const resId of order.reservationIds) {
            InventoryRepository.releaseReservationInState(state, resId, {
              reason: 'ORDER_CANCELLED',
              actorId: normalizedActor.userId
            });
          }
        } else if (order.reservationId) {
          InventoryRepository.releaseReservationInState(state, order.reservationId, {
            reason: 'ORDER_CANCELLED',
            actorId: normalizedActor.userId
          });
        } else {
          restoreStockInState(state, order.vehicleId, 1, order.branchId || 'hn-caugiay', normalizedActor.userId, order.id);
        }
        order.inventoryRestored = true;
      }

      // 4. Record state change in auditable history
      const now = new Date().toISOString();
      order.orderStatus = targetStatus;
      order.updatedAt = now;
      if (targetStatus === ORDER_STATUS.DELIVERED && !order.deliveredAt) {
        order.deliveredAt = now;
      }
      order.history = order.history || [];
      order.history.push({
        status: targetStatus,
        timestamp: now,
        updatedBy: normalizedActor.userId,
        role: normalizedActor.role,
        note: note || `Chuyển trạng thái sang ${targetStatus}`
      });

      NotificationService.enqueueOutboxInState(state, {
        eventType: 'order_status_updated',
        aggregateType: 'order',
        aggregateId: order.id,
        userId: order.userId,
        templateId: 'order_confirmed',
        payload: {
          orderId: order.id,
          orderNumber: order.orderNumber || order.id,
          buyerName: order.buyerName,
          vehicleName: order.vehicleName,
          branchName: order.branchName,
          status: targetStatus
        },
        dedupeKey: `order_status:${order.id}:${targetStatus}`
      });

      return order;
    });
  }
};

module.exports = OrderRepository;
