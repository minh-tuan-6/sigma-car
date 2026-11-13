// backend/application/payment-service.js
// Payment intents, cryptographic HMAC webhook settlement, idempotent ledger & late callback handling

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const { ORDER_STATUS, PAYMENT_STATUS, PAYMENT_INTENT_STATUS } = require('../domain/constants');
const Authorization = require('../domain/authorization');
const PaymentGateway = require('../infrastructure/payment-gateway');
const InventoryRepository = require('../infrastructure/repositories/inventory-repository');
const NotificationService = require('./notification-service');

function createError(message, statusCode = 400, code = 'PAYMENT_ERROR', extra = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  Object.assign(err, extra);
  return err;
}

const PaymentService = {
  async createPaymentIntent({ orderId, user, mode = 'deposit', provider = 'napas_qr_sandbox', idempotencyKey = null }) {
    if (!user || !user.userId) {
      throw createError('Vui lòng đăng nhập để khởi tạo giao dịch thanh toán.', 401, 'UNAUTHORIZED');
    }

    const orderSnapshot = (dbState.orders || []).find(o => o.id === orderId || o.orderNumber === orderId);
    if (!orderSnapshot) {
      throw createError(`Không tìm thấy đơn hàng "${orderId}".`, 404, 'ORDER_NOT_FOUND');
    }

    Authorization.assertAuthorized(
      Authorization.canReadOrder(user, orderSnapshot),
      'Bạn không có quyền khởi tạo thanh toán cho đơn hàng này.',
      403,
      'FORBIDDEN'
    );

    const normalizedMode = mode === 'full' || mode === 'balance' ? mode : 'deposit';

    return runInTransaction(async (state) => {
      if (!Array.isArray(state.paymentIntents)) state.paymentIntents = [];
      const order = state.orders.find(o => o.id === orderSnapshot.id);
      if ([ORDER_STATUS.CANCELLED, ORDER_STATUS.FAILED].includes(order.orderStatus)) {
        throw createError('Đơn hàng đã hủy hoặc thất bại, không thể tiếp tục thanh toán.', 409, 'ORDER_NOT_PAYABLE');
      }

      const cleanIdem = idempotencyKey ? String(idempotencyKey).trim() : null;
      if (cleanIdem) {
        const existingIntent = state.paymentIntents.find(p =>
          p.orderId === order.id && p.userId === user.userId && p.idempotencyKey === cleanIdem
        );
        if (existingIntent) {
          if (existingIntent.mode !== normalizedMode || existingIntent.provider !== provider) {
            throw createError('Idempotency key đã gắn với yêu cầu thanh toán khác.', 409, 'IDEMPOTENCY_PAYLOAD_MISMATCH');
          }
          return existingIntent;
        }
      }

      const totalDue = Math.max(0, Math.round(order.totalAmount || order.unitPrice || 0));
      const depositDue = Math.max(0, Math.min(totalDue, Math.round(order.depositAmount || 50000000)));
      const alreadyPaid = Math.max(0, Math.round(order.paidAmount || 0));

      let targetAmount = 0;
      if (normalizedMode === 'deposit') {
        targetAmount = Math.max(0, depositDue - alreadyPaid);
      } else {
        targetAmount = Math.max(0, totalDue - alreadyPaid);
      }

      if (targetAmount <= 0) {
        throw createError('Khoản thanh toán này đã được tất toán trước đó.', 409, 'ALREADY_PAID');
      }

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const intentId = `pi_${crypto.randomUUID().slice(0, 12)}`;
      const gatewayRes = PaymentGateway.initiateProviderIntent({
        intentId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        amount: targetAmount,
        currency: 'VND',
        provider
      });

      const intent = {
        id: intentId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId: user.userId,
        branchId: order.branchId,
        mode: normalizedMode,
        provider: gatewayRes.provider,
        providerLabel: gatewayRes.providerLabel,
        providerRef: gatewayRes.providerRef,
        checkoutUrl: gatewayRes.checkoutUrl,
        qrPayload: gatewayRes.qrPayload,
        amount: targetAmount,
        currency: 'VND',
        status: PAYMENT_INTENT_STATUS.PENDING,
        idempotencyKey: cleanIdem,
        expiresAt: new Date(nowMs + 15 * 60 * 1000).toISOString(),
        createdAt: nowIso,
        updatedAt: nowIso
      };

      state.paymentIntents.push(intent);

      if (order.paymentStatus === PAYMENT_STATUS.UNPAID || order.paymentStatus === PAYMENT_STATUS.FAILED) {
        order.paymentStatus = PAYMENT_STATUS.PENDING_PAYMENT;
        order.paymentMethod = gatewayRes.providerLabel;
        order.updatedAt = nowIso;
      }

      return intent;
    });
  },

  async getOrderPaymentHistory(orderId, user) {
    const order = (dbState.orders || []).find(o => o.id === orderId || o.orderNumber === orderId);
    if (!order) {
      throw createError(`Không tìm thấy đơn hàng "${orderId}".`, 404, 'ORDER_NOT_FOUND');
    }
    Authorization.assertAuthorized(
      Authorization.canReadOrder(user, order),
      'Bạn không có quyền xem lịch sử thanh toán của đơn hàng này.',
      403,
      'FORBIDDEN'
    );

    const intents = (dbState.paymentIntents || [])
      .filter(p => p.orderId === order.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const ledger = (dbState.paymentLedger || [])
      .filter(l => l.orderId === order.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      totalAmount: order.totalAmount || order.unitPrice || 0,
      depositAmount: order.depositAmount || 0,
      paidAmount: order.paidAmount || 0,
      exceptionStatus: order.exceptionStatus || null,
      intents,
      ledger
    };
  },

  async handleWebhook({ provider, rawBody, signature, event }) {
    const bodyString = typeof rawBody === 'string' ? rawBody : JSON.stringify(event || {});
    if (!PaymentGateway.verifyWebhookSignature(bodyString, signature, provider)) {
      throw createError('Chữ ký xác thực webhook thanh toán không hợp lệ.', 401, 'INVALID_WEBHOOK_SIGNATURE');
    }

    const evt = event || (typeof rawBody === 'string' ? JSON.parse(rawBody) : {});
    const eventId = String(evt.eventId || evt.id || '').trim();
    if (!eventId) {
      throw createError('Thiếu eventId trong payload webhook.', 400, 'VALIDATION_ERROR');
    }

    return runInTransaction(async (state) => {
      if (!Array.isArray(state.webhookEvents)) state.webhookEvents = [];
      if (!Array.isArray(state.paymentIntents)) state.paymentIntents = [];
      if (!Array.isArray(state.paymentLedger)) state.paymentLedger = [];

      const duplicate = state.webhookEvents.find(w => w.eventId === eventId);
      if (duplicate) {
        return { ok: true, duplicate: true, eventId };
      }

      const payloadHash = crypto.createHash('sha256').update(bodyString).digest('hex');
      const intent = state.paymentIntents.find(p =>
        (evt.intentId && p.id === evt.intentId) ||
        (evt.providerRef && p.providerRef === evt.providerRef)
      );
      if (!intent) {
        throw createError('Không tìm thấy PaymentIntent tương ứng.', 404, 'INTENT_NOT_FOUND');
      }

      const order = state.orders.find(o => o.id === intent.orderId);
      if (!order) {
        throw createError('Không tìm thấy đơn hàng tương ứng PaymentIntent.', 404, 'ORDER_NOT_FOUND');
      }

      const nowIso = new Date().toISOString();
      const evtStatus = String(evt.status || '').toLowerCase();
      const evtCurrency = String(evt.currency || 'VND').toUpperCase();
      const evtAmount = Math.round(Number(evt.amount || 0));

      state.webhookEvents.push({
        id: `wh_${crypto.randomUUID().slice(0, 10)}`,
        provider: provider || intent.provider,
        eventId,
        payloadHash,
        processedAt: nowIso
      });

      if (evtStatus === 'failed' || evtStatus === 'cancelled' || evtStatus === 'expired') {
        if (intent.status !== PAYMENT_INTENT_STATUS.SUCCEEDED) {
          intent.status = evtStatus === 'expired' ? PAYMENT_INTENT_STATUS.EXPIRED : PAYMENT_INTENT_STATUS.FAILED;
          intent.failureReason = evt.reason || 'Giao dịch không thành công tại cổng thanh toán.';
          intent.updatedAt = nowIso;
          if (order.paidAmount === 0) {
            order.paymentStatus = PAYMENT_STATUS.FAILED;
            order.updatedAt = nowIso;
          }
          order.history = order.history || [];
          order.history.push({
            status: order.orderStatus,
            paymentStatus: order.paymentStatus,
            timestamp: nowIso,
            updatedBy: 'payment_webhook',
            note: `Thanh toán thất bại (${intent.id}): ${intent.failureReason}`
          });
        }
        return { ok: true, status: intent.status, intent, order };
      }

      if (evtStatus !== 'succeeded') {
        throw createError(`Trạng thái sự kiện webhook không hợp lệ: ${evt.status}`, 400, 'INVALID_WEBHOOK_STATUS');
      }

      if (evtCurrency !== intent.currency || !Number.isFinite(evtAmount) || evtAmount <= 0) {
        throw createError('Đơn vị tiền tệ hoặc số tiền giao dịch không hợp lệ.', 422, 'CURRENCY_OR_AMOUNT_INVALID');
      }

      if (intent.status === PAYMENT_INTENT_STATUS.SUCCEEDED) {
        return { ok: true, duplicate: true, alreadySettled: true, intent, order };
      }

      // Check amount parity (detect partial vs expected mismatch)
      const isPartialMismatch = evtAmount < intent.amount;

      // Ensure reservation or re-acquire stock cleanly on late callback
      let lateOutOfStock = false;
      const resIds = Array.isArray(order.reservationIds) && order.reservationIds.length > 0
        ? order.reservationIds
        : (order.reservationId ? [order.reservationId] : []);

      for (const rId of resIds) {
        const res = (state.reservations || []).find(r => r.id === rId);
        if (!res) continue;
        if (res.status === 'active') {
          InventoryRepository.convertReservationInState(state, res.id, order.id, 'payment_webhook');
        } else if (res.status === 'expired' || res.status === 'released') {
          // Late callback after expiry: attempt atomic reacquisition without allowing negative stock
          try {
            const reacquired = InventoryRepository.reserveStockInState(state, {
              vehicleId: res.vehicleId,
              branchId: res.branchId,
              quantity: res.quantity,
              userId: order.userId,
              orderId: order.id
            });
            InventoryRepository.convertReservationInState(state, reacquired.reservation.id, order.id, 'payment_webhook_late_reacquire');
            order.reservationIds.push(reacquired.reservation.id);
          } catch (stockErr) {
            lateOutOfStock = true;
            order.exceptionStatus = 'late_payment_out_of_stock';
          }
        }
      }

      intent.status = PAYMENT_INTENT_STATUS.SUCCEEDED;
      intent.settledAmount = evtAmount;
      intent.providerEventId = eventId;
      intent.settledAt = nowIso;
      intent.updatedAt = nowIso;

      const ledgerEntry = {
        id: `led_${crypto.randomUUID().slice(0, 12)}`,
        orderId: order.id,
        paymentIntentId: intent.id,
        provider: provider || intent.provider,
        providerRef: intent.providerRef,
        eventId,
        entryType: lateOutOfStock
          ? 'LATE_PAYMENT_EXCEPTION_CREDIT'
          : (isPartialMismatch ? 'PARTIAL_PAYMENT_CAPTURED' : 'PAYMENT_CAPTURED'),
        amount: evtAmount,
        currency: 'VND',
        createdAt: nowIso
      };
      state.paymentLedger.push(ledgerEntry);

      order.paidAmount = Math.round((order.paidAmount || 0) + evtAmount);
      const totalRequired = Math.max(0, Math.round(order.totalAmount || order.unitPrice || 0));
      const depositRequired = Math.max(0, Math.round(order.depositAmount || 50000000));

      if (order.paidAmount >= totalRequired && totalRequired > 0 && !isPartialMismatch) {
        order.paymentStatus = PAYMENT_STATUS.FULLY_PAID;
      } else if (order.paidAmount >= depositRequired && !isPartialMismatch) {
        order.paymentStatus = PAYMENT_STATUS.DEPOSIT_PAID;
      } else {
        order.paymentStatus = PAYMENT_STATUS.PARTIALLY_PAID;
      }

      if (isPartialMismatch && !order.exceptionStatus) {
        order.exceptionStatus = 'partial_settlement_mismatch';
      }

      order.paymentConfirmedAt = nowIso;
      order.updatedAt = nowIso;
      order.history = order.history || [];
      order.history.push({
        status: order.orderStatus, // NEVER auto-flip to Delivered
        paymentStatus: order.paymentStatus,
        timestamp: nowIso,
        updatedBy: 'payment_webhook',
        note: lateOutOfStock
          ? `Nhận tiền trễ sau khi hết giữ chỗ (${evtAmount.toLocaleString('vi-VN')} đ) — cần điều phối kho / hoàn tiền thủ công.`
          : `Xác nhận thanh toán ${evtAmount.toLocaleString('vi-VN')} đ qua ${intent.providerLabel} (${intent.providerRef}).`
      });

      NotificationService.enqueueOutboxInState(state, {
        eventType: 'payment_settled',
        aggregateType: 'payment_intent',
        aggregateId: intent.id,
        userId: order.userId,
        templateId: 'payment_settled',
        payload: {
          orderId: order.id,
          orderNumber: order.orderNumber || order.id,
          amount: evtAmount
        },
        dedupeKey: `payment_settled:${intent.id}`
      });

      return { ok: true, intent, order, ledgerEntry, lateOutOfStock, isPartialMismatch };
    });
  },

  async simulateSandboxEvent({ intentId, status = 'succeeded', amount, user }) {
    if (!user || !user.userId) {
      throw createError('Yêu cầu đăng nhập.', 401, 'UNAUTHORIZED');
    }
    const intent = (dbState.paymentIntents || []).find(p => p.id === intentId);
    if (!intent) {
      throw createError('Không tìm thấy PaymentIntent.', 404, 'INTENT_NOT_FOUND');
    }
    const order = (dbState.orders || []).find(o => o.id === intent.orderId);
    if (!order || (!Authorization.canReadOrder(user, order) && user.role !== 'admin')) {
      throw createError('Bạn không có quyền mô phỏng giao dịch cho đơn hàng này.', 403, 'FORBIDDEN');
    }

    const eventPayload = {
      eventId: `evt_sbx_${crypto.randomUUID().slice(0, 10)}`,
      intentId: intent.id,
      providerRef: intent.providerRef,
      status,
      amount: amount !== undefined ? Number(amount) : intent.amount,
      currency: intent.currency || 'VND'
    };
    const rawBody = JSON.stringify(eventPayload);
    const signature = PaymentGateway.signWebhookPayload(rawBody, PaymentGateway.getWebhookSecret(intent.provider));

    return this.handleWebhook({
      provider: intent.provider,
      rawBody,
      signature: `sha256=${signature}`,
      event: eventPayload
    });
  }
};

module.exports = PaymentService;
