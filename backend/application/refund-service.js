// backend/application/refund-service.js
// Ledger-Verified Refund Execution, Gateway Idempotency & Returned Vehicle Quarantine

const crypto = require('crypto');
const { runInTransaction, dbState } = require('../infrastructure/storage-engine');
const PaymentGateway = require('../infrastructure/payment-gateway');
const InventoryRepository = require('../infrastructure/repositories/inventory-repository');
const Authorization = require('../domain/authorization');
const Security = require('../infrastructure/security');
const NotificationService = require('./notification-service');
const { ROLES, RETURN_STATUS, PAYMENT_STATUS } = require('../domain/constants');

function createError(message, statusCode, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

const RefundService = {
  getRefundableBalanceInState(state, orderId) {
    const order = state.orders.find(o => o.id === orderId);
    const creditTypes = new Set(['PAYMENT_CAPTURED', 'PARTIAL_PAYMENT_CAPTURED', 'LATE_PAYMENT_EXCEPTION_CREDIT', 'payment_received']);
    const paidFromLedger = (state.paymentLedger || [])
      .filter(l => l.orderId === orderId && creditTypes.has(l.entryType))
      .reduce((sum, l) => sum + Number(l.amount || 0), 0);
    const totalSettled = paidFromLedger > 0
      ? paidFromLedger
      : Number((order && order.paidAmount) || 0);

    const alreadyRefunded = (state.refunds || [])
      .filter(r => r.orderId === orderId && r.status === 'succeeded')
      .reduce((sum, r) => sum + Number(r.amount || 0), 0);

    return {
      totalSettled,
      alreadyRefunded,
      remainingRefundable: Math.max(0, totalSettled - alreadyRefunded)
    };
  },

  async executeRefund(user, { returnId = null, orderId, amount, reason = 'Hoàn tiền theo yêu cầu đổi trả / hủy đơn', idempotencyKey = null, simulateOutcome = 'succeeded' } = {}) {
    if (!user || ![ROLES.ADMIN, ROLES.SELLER].includes(user.role)) {
      throw createError('Chỉ Quản trị viên hoặc Đại lý được phân quyền mới có thể xử lý giao dịch hoàn tiền.', 403, 'FORBIDDEN');
    }

    const reqAmount = Number(amount);
    if (!Number.isFinite(reqAmount) || reqAmount <= 0) {
      throw createError('Số tiền hoàn phải là số dương hợp lệ.', 422, 'INVALID_REFUND_AMOUNT');
    }

    return runInTransaction(async (state) => {
      if (!Array.isArray(state.refunds)) state.refunds = [];
      if (!Array.isArray(state.paymentLedger)) state.paymentLedger = [];

      const order = state.orders.find(o => o.id === orderId || o.orderNumber === orderId);
      if (!order) {
        throw createError('Không tìm thấy đơn hàng để hoàn tiền.', 404, 'ORDER_NOT_FOUND');
      }

      if (user.role !== ROLES.ADMIN && !Authorization.hasBranchAccess(user, order.branchId)) {
        throw createError('Đơn hàng thuộc chi nhánh khác phạm vi quản lý.', 403, 'FORBIDDEN');
      }

      if (idempotencyKey) {
        const dup = state.refunds.find(r => r.idempotencyKey === idempotencyKey && r.orderId === order.id);
        if (dup) return dup;
      }

      const linkedReturn = returnId
        ? state.returnRequests.find(r => r.id === returnId || r.returnCode === returnId)
        : null;
      if (returnId && !linkedReturn) {
        throw createError('Không tìm thấy hồ sơ đổi trả liên kết.', 404, 'RETURN_NOT_FOUND');
      }
      if (linkedReturn) {
        const existingSuccess = state.refunds.find(r => r.returnId === linkedReturn.id && r.status === 'succeeded');
        if (existingSuccess) {
          throw createError(`Hồ sơ ${linkedReturn.returnCode} đã được hoàn tiền thành công trước đó (${existingSuccess.id}).`, 409, 'DUPLICATE_REFUND');
        }
      }

      const balance = this.getRefundableBalanceInState(state, order.id);
      if (balance.totalSettled <= 0) {
        throw createError('Đơn hàng chưa ghi nhận khoản tiền đã thanh toán hợp lệ nào trên sổ cái.', 409, 'NO_SETTLED_PAYMENT');
      }
      if (reqAmount > balance.remainingRefundable) {
        throw createError(
          `Số tiền yêu cầu hoàn (${reqAmount.toLocaleString('vi-VN')} VNĐ) vượt quá số dư đã thanh toán còn lại (${balance.remainingRefundable.toLocaleString('vi-VN')} VNĐ).`,
          409,
          'REFUND_EXCEEDS_SETTLED'
        );
      }

      const lastIntent = (state.paymentIntents || []).find(p => p.orderId === order.id && p.status === 'Paid');
      const refundId = `RF-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const gwResult = PaymentGateway.executeRefund({
        refundId,
        orderId: order.id,
        amount: reqAmount,
        provider: (lastIntent && lastIntent.provider) || 'napas_qr_sandbox',
        providerRef: lastIntent && lastIntent.providerRef,
        simulateOutcome
      });

      const nowIso = new Date().toISOString();
      const refundRecord = {
        id: refundId,
        returnId: linkedReturn ? linkedReturn.id : null,
        orderId: order.id,
        branchId: order.branchId,
        amount: reqAmount,
        reason: Security.sanitizeString(reason),
        idempotencyKey: idempotencyKey || null,
        provider: gwResult.provider,
        transactionRef: gwResult.transactionRef,
        status: gwResult.status, // 'succeeded' | 'failed'
        failureReason: gwResult.failureReason || null,
        processedBy: user.userId,
        processedAt: nowIso
      };
      state.refunds.unshift(refundRecord);

      if (gwResult.status !== 'succeeded') {
        // Honest failure handling: DO NOT mark Refunded or mutate order paymentStatus!
        if (linkedReturn) {
          linkedReturn.financials.refundStatus = `Hoàn tiền thất bại: ${gwResult.failureReason}`;
          linkedReturn.updatedAt = nowIso;
          linkedReturn.history.push({
            status: linkedReturn.status,
            note: `Giao dịch hoàn tiền ${refundId} thất bại tại cổng thanh toán (chờ xử lý thủ công).`,
            updatedBy: user.fullName || user.role,
            timestamp: nowIso
          });
        }
        return refundRecord;
      }

      // Settled proof received: write ledger debit entry cleanly
      state.paymentLedger.push({
        id: `LDG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        orderId: order.id,
        refundId,
        entryType: 'refund_settled',
        amount: -reqAmount,
        currency: 'VND',
        provider: gwResult.provider,
        providerRef: gwResult.transactionRef,
        recordedAt: nowIso
      });

      const updatedBalance = this.getRefundableBalanceInState(state, order.id);
      order.refundedAmount = (order.refundedAmount || 0) + reqAmount;
      if (updatedBalance.remainingRefundable === 0) {
        order.paymentStatus = PAYMENT_STATUS.REFUNDED;
      }

      if (linkedReturn) {
        linkedReturn.status = RETURN_STATUS.COMPLETED;
        linkedReturn.financials.refundStatus = 'Đã hoàn tiền qua cổng thanh toán & đối soát sổ cái';
        linkedReturn.financials.actualRefundAmount = reqAmount;
        linkedReturn.updatedAt = nowIso;
        linkedReturn.history.push({
          status: RETURN_STATUS.COMPLETED,
          note: `Hoàn tất hoàn tiền ${reqAmount.toLocaleString('vi-VN')} VNĐ (Mã GD: ${gwResult.transactionRef}). Xe thu hồi chuyển khu vực kiểm định cách ly.`,
          updatedBy: user.fullName || user.role,
          timestamp: nowIso
        });

        // Quarantine returned physical vehicle instead of placing directly back into sellable stock
        const rows = InventoryRepository.ensureBranchRowsInState(state, order.vehicleId);
        const branchRow = rows.find(r => r.branchId === order.branchId) || rows[0];
        if (branchRow) {
          branchRow.quarantinedQty = (branchRow.quarantinedQty || 0) + 1;
          branchRow.version = (branchRow.version || 1) + 1;
          branchRow.updatedAt = nowIso;
          InventoryRepository.appendMovementInState(state, {
            vehicleId: order.vehicleId,
            branchId: branchRow.branchId,
            delta: 0,
            reason: 'RETURN_QUARANTINE_HOLD',
            referenceId: linkedReturn.returnCode,
            actorId: user.userId,
            versionAfter: branchRow.version
          });
        }
      }

      NotificationService.enqueueOutboxInState(state, {
        eventType: 'refund_settled',
        aggregateType: 'refund',
        aggregateId: refundId,
        userId: order.userId,
        templateId: 'return_updated',
        payload: {
          returnCode: (linkedReturn && linkedReturn.returnCode) || order.orderNumber || order.id,
          status: linkedReturn ? RETURN_STATUS.COMPLETED : 'Đã hoàn tiền'
        },
        dedupeKey: `refund_settled:${refundId}`
      });

      return refundRecord;
    });
  },

  listRefunds(user) {
    const all = dbState.refunds || [];
    if (!user) return [];
    if (user.role === ROLES.ADMIN) return [...all];
    if (Authorization.isStaffRole(user.role)) return all.filter(r => Authorization.hasBranchAccess(user, r.branchId));
    const userOrders = new Set((dbState.orders || []).filter(o => o.userId === user.userId).map(o => o.id));
    return all.filter(r => userOrders.has(r.orderId));
  }
};

module.exports = RefundService;
