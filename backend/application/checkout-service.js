// backend/application/checkout-service.js
// Atomic UoW checkout: idempotency keys, quote staleness verification, stock reservation & promo redemption

const crypto = require('crypto');
const { runInTransaction } = require('../infrastructure/storage-engine');
const { ORDER_STATUS, PAYMENT_STATUS, SHOWROOM_BRANCHES } = require('../domain/constants');
const Security = require('../infrastructure/security');
const InventoryRepository = require('../infrastructure/repositories/inventory-repository');
const PricingService = require('./pricing-service');
const PromotionService = require('./promotion-service');
const NotificationService = require('./notification-service');

function createError(message, statusCode = 400, code = 'CHECKOUT_ERROR', extra = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function buildPayloadHash(payload) {
  const canonical = {
    source: payload.source || 'direct',
    branchId: payload.branchId || 'hn-caugiay',
    deliveryMethod: payload.deliveryMethod || 'showroom',
    quoteId: payload.quoteId || null,
    promoCode: payload.promoCode ? String(payload.promoCode).trim().toUpperCase() : null,
    paymentMode: payload.paymentMode === 'full' ? 'full' : 'deposit',
    buyerName: String(payload.buyerName || '').trim(),
    buyerPhone: String(payload.buyerPhone || '').trim(),
    items: Array.isArray(payload.items)
      ? payload.items.map(i => ({
          itemType: i.itemType || i.type || 'vehicle',
          itemId: i.itemId || i.vehicleId || i.id,
          quantity: Number(i.quantity || 1),
          trimName: i.trimName || null,
          colorName: i.colorName || null
        }))
      : []
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

const CheckoutService = {
  async checkout({ user, idempotencyKey, payload = {}, __testHooks = null }) {
    if (!user || !user.userId) {
      throw createError('Vui lòng đăng nhập để hoàn tất đặt hàng.', 401, 'UNAUTHORIZED');
    }

    const buyerName = Security.sanitizeString(payload.buyerName || user.fullName || '');
    const buyerPhone = Security.sanitizeString(payload.buyerPhone || user.phone || '');
    if (!buyerName || !buyerPhone) {
      throw createError('Vui lòng cung cấp đầy đủ Họ tên và Số điện thoại người nhận xe.', 400, 'VALIDATION_ERROR');
    }
    if (payload.acceptedPolicy !== true) {
      throw createError('Vui lòng xác nhận đồng ý Điều khoản Đặt cọc & Mua bán xe SIGMACAR.', 422, 'POLICY_ACCEPTANCE_REQUIRED');
    }

    const branchId = payload.branchId || SHOWROOM_BRANCHES[0].id;
    const branch = SHOWROOM_BRANCHES.find(b => b.id === branchId);
    if (!branch) {
      throw createError(`Showroom/chi nhánh "${branchId}" không hợp lệ.`, 400, 'INVALID_BRANCH');
    }

    const cleanIdemKey = idempotencyKey ? String(idempotencyKey).trim() : null;
    const reqHash = buildPayloadHash({ ...payload, branchId, buyerName, buyerPhone });

    return runInTransaction(async (state) => {
      if (!Array.isArray(state.idempotencyRecords)) state.idempotencyRecords = [];
      const nowMs = Date.now();

      if (cleanIdemKey) {
        const existingIdem = state.idempotencyRecords.find(r =>
          r.scope === 'checkout' && r.userId === user.userId && r.key === cleanIdemKey
        );
        if (existingIdem) {
          if (existingIdem.payloadHash !== reqHash) {
            throw createError(
              'Khóa idempotency đã được sử dụng với nội dung đơn hàng khác.',
              409,
              'IDEMPOTENCY_PAYLOAD_MISMATCH'
            );
          }
          const existingOrder = (state.orders || []).find(o => o.id === existingIdem.orderId);
          if (existingOrder) {
            return {
              idempotentReplay: true,
              order: existingOrder,
              nextAction: {
                type: 'INITIATE_PAYMENT',
                orderId: existingOrder.id,
                orderStatus: existingOrder.orderStatus,
                paymentStatus: existingOrder.paymentStatus
              }
            };
          }
        }
      }

      // Pre-validate referenced quote expiry & hydrate lines when omitted
      let refQuote = null;
      if (payload.quoteId) {
        refQuote = (state.quotes || []).find(q => q.id === payload.quoteId);
        if (!refQuote) {
          throw createError('Báo giá không tồn tại.', 404, 'QUOTE_NOT_FOUND');
        }
        if (refQuote.userId && refQuote.userId !== user.userId) {
          throw createError('Bạn không có quyền sử dụng báo giá của tài khoản khác.', 403, 'FORBIDDEN');
        }
        if (refQuote.expiresAt && Date.parse(refQuote.expiresAt) < nowMs) {
          throw createError('Báo giá đã hết hiệu lực (15 phút). Vui lòng tính lại báo giá mới.', 409, 'QUOTE_EXPIRED');
        }
      }

      // Resolve source items (cart vs explicit items vs referenced quote)
      const source = payload.source === 'cart' ? 'cart' : 'direct';
      let checkoutItems = Array.isArray(payload.items) && payload.items.length > 0
        ? payload.items
        : (refQuote && Array.isArray(refQuote.lines) ? refQuote.lines : []);
      let userCart = null;

      if (source === 'cart') {
        userCart = (state.carts || []).find(c => c.userId === user.userId);
        if (!userCart || !Array.isArray(userCart.items) || userCart.items.length === 0) {
          throw createError('Giỏ hàng hiện đang trống.', 400, 'EMPTY_CART');
        }
        checkoutItems = userCart.items;
      }

      const effectivePromo = payload.promoCode !== undefined
        ? payload.promoCode
        : (userCart ? userCart.promoCode : (refQuote?.promo?.code || null));

      const breakdown = PricingService.buildQuoteBreakdownInState(state, {
        items: checkoutItems,
        promoCode: effectivePromo,
        deliveryMethod: payload.deliveryMethod || refQuote?.deliveryMethod || 'showroom',
        branchId,
        userId: user.userId,
        nowMs
      });

      // Validate referenced quote snapshot for staleness/price drift
      if (refQuote && refQuote.quoteHash !== breakdown.quoteHash) {
        throw createError('Giá xe hoặc ưu đãi vừa thay đổi kể từ lúc lập báo giá. Vui lòng cập nhật lại đơn hàng.', 409, 'QUOTE_STALE_PRICE_CHANGED');
      }

      // Reserve inventory atomically for all vehicle / certified lines (15 min TTL)
      const orderId = `ORD-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
      const orderNumber = `SG-2026-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 90 + 10)}`;
      const reservationIds = [];
      let reservationExpiresAt = null;

      for (const line of breakdown.lines) {
        if (line.itemType === 'vehicle' || line.itemType === 'certified') {
          const resOut = InventoryRepository.reserveStockInState(state, {
            vehicleId: line.itemId,
            branchId,
            quantity: line.quantity,
            userId: user.userId,
            orderId,
            cartId: userCart ? userCart.id : null,
            ttlMs: 15 * 60 * 1000,
            nowMs
          });
          reservationIds.push(resOut.reservation.id);
          reservationExpiresAt = resOut.reservation.expiresAt;
        } else if (line.itemType === 'accessory') {
          const acc = (state.accessories || []).find(a => a.id === line.itemId);
          const available = acc ? Math.max(0, Math.round(Number(acc.quantity ?? acc.stock ?? 0))) : 0;
          if (!acc || available < line.quantity) {
            throw createError(`Phụ kiện "${line.name}" chỉ còn ${available} sản phẩm trong kho (không đủ ${line.quantity}).`, 409, 'INSUFFICIENT_ACCESSORY_STOCK');
          }
          acc.quantity = available - line.quantity;
        }
      }

      // Optional failure hook to prove full transactional rollback (no leaked stock / orphan order)
      if (__testHooks && __testHooks.failAfterReserve) {
        throw createError('Simulated crash after stock reservation', 500, 'SIMULATED_FAILURE');
      }

      // Redeem promo code inside same transaction
      let redeemedPromo = null;
      if (effectivePromo && String(effectivePromo).trim()) {
        redeemedPromo = PromotionService.redeemPromoInState(state, {
          code: effectivePromo,
          subtotal: breakdown.itemsSubtotal,
          items: breakdown.lines,
          branchId,
          userId: user.userId,
          orderId,
          nowMs
        });
      }

      const primaryLine = breakdown.lines[0];
      const nowIso = new Date(nowMs).toISOString();
      const newOrder = {
        id: orderId,
        orderNumber,
        userId: user.userId,
        buyerId: user.userId,
        buyerName,
        buyerPhone,
        deliveryAddress: payload.deliveryAddress ? Security.sanitizeString(payload.deliveryAddress) : '',
        deliveryMethod: breakdown.deliveryMethod,
        vehicleId: primaryLine.itemId,
        vehicleName: breakdown.lines.length > 1 ? `${primaryLine.name} (+${breakdown.lines.length - 1} sp)` : primaryLine.name,
        items: breakdown.lines,
        unitPrice: breakdown.totalAmount,
        itemsSubtotal: breakdown.itemsSubtotal,
        deliveryFee: breakdown.deliveryFee,
        discountAmount: breakdown.discountAmount,
        promoCode: redeemedPromo ? redeemedPromo.code : null,
        totalAmount: breakdown.totalAmount,
        depositAmount: breakdown.depositAmount,
        paidAmount: 0,
        paymentMode: payload.paymentMode === 'full' ? 'full' : 'deposit',
        paymentMethod: payload.paymentMethod ? Security.sanitizeString(payload.paymentMethod) : 'Chuyển khoản QR Napas 24/7',
        img: primaryLine.image || 'assets/model-e.jpg',
        branchId: branch.id,
        branchName: branch.name,
        quoteId: payload.quoteId || null,
        quoteSnapshot: {
          policyVersion: breakdown.policyVersion,
          quoteHash: breakdown.quoteHash,
          financingSnapshot: breakdown.financingSnapshot
        },
        acceptedPolicyVersion: breakdown.policyVersion,
        acceptedPolicyAt: nowIso,
        reservationId: reservationIds[0] || null,
        reservationIds,
        reservationExpiresAt,
        reservedInventory: reservationIds.length > 0,
        inventoryRestored: false,
        orderStatus: ORDER_STATUS.PENDING,
        paymentStatus: PAYMENT_STATUS.UNPAID,
        history: [
          {
            status: ORDER_STATUS.PENDING,
            timestamp: nowIso,
            updatedBy: user.userId,
            note: `Tạo đơn checkout (${breakdown.lines.length} dòng sản phẩm, chờ thanh toán ${payload.paymentMode === 'full' ? 'toàn bộ' : 'tiền cọc'}).`
          }
        ],
        createdAt: nowIso,
        updatedAt: nowIso
      };

      state.orders.push(newOrder);

      if (userCart) {
        userCart.items = [];
        userCart.promoCode = null;
        userCart.version = (userCart.version || 1) + 1;
        userCart.updatedAt = nowIso;
      }

      if (cleanIdemKey) {
        state.idempotencyRecords.push({
          id: `idem_${crypto.randomUUID().slice(0, 8)}`,
          scope: 'checkout',
          userId: user.userId,
          key: cleanIdemKey,
          payloadHash: reqHash,
          orderId: newOrder.id,
          createdAt: nowIso
        });
      }

      NotificationService.enqueueOutboxInState(state, {
        eventType: 'order_confirmed',
        aggregateType: 'order',
        aggregateId: newOrder.id,
        userId: newOrder.userId,
        templateId: 'order_confirmed',
        payload: {
          orderId: newOrder.id,
          orderNumber: newOrder.orderNumber,
          buyerName: newOrder.buyerName,
          vehicleName: newOrder.vehicleName,
          branchName: newOrder.branchName
        },
        dedupeKey: `order_created:${newOrder.id}`
      });

      return {
        idempotentReplay: false,
        order: newOrder,
        nextAction: {
          type: 'INITIATE_PAYMENT',
          orderId: newOrder.id,
          orderStatus: newOrder.orderStatus,
          paymentStatus: newOrder.paymentStatus,
          payableAmount: payload.paymentMode === 'full' ? newOrder.totalAmount : newOrder.depositAmount,
          reservationExpiresAt
        }
      };
    });
  }
};

module.exports = CheckoutService;
