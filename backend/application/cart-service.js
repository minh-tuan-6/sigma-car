// backend/application/cart-service.js
// Authenticated Cart management, accessory compatibility validation, quote calculation, and guest merge

const crypto = require('crypto');
const CartRepository = require('../infrastructure/repositories/cart-repository');
const PricingService = require('./pricing-service');
const PromotionService = require('./promotion-service');
const { SHOWROOM_BRANCHES } = require('../domain/constants');

function createError(message, statusCode = 400, code = 'CART_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function validateAccessoryCompatibility(state, accessoryItem, cartItems, targetVehicleId = null) {
  const AccessoryService = require('./accessory-service');
  const refVehicleId = targetVehicleId || (cartItems.find(i => i.itemType !== 'accessory')?.itemId || null);
  if (refVehicleId) {
    const vehicle = (state.vehicles || []).find(v => v.id === refVehicleId) ||
      (state.certifiedVehicles || []).find(v => v.id === refVehicleId) || null;
    if (vehicle) {
      const fit = AccessoryService.evaluateFitForVehicle(accessoryItem, vehicle);
      if (fit.compatible === false) {
        throw createError(`Phụ kiện "${accessoryItem.name}" không tương thích với mẫu xe ${vehicle.name}: ${fit.fitReason}`, 422, 'INCOMPATIBLE_ACCESSORY');
      }
      return true;
    }
  }
  const compatible = accessoryItem.compatibility;
  if (!Array.isArray(compatible) || compatible.length === 0 || compatible.includes('all')) {
    return true;
  }
  if (refVehicleId && !compatible.includes(refVehicleId)) {
    throw createError(`Phụ kiện "${accessoryItem.name}" không tương thích với mẫu xe ${refVehicleId}.`, 422, 'INCOMPATIBLE_ACCESSORY');
  }
  return true;
}

function enrichCartWithQuote(cart, state, userId) {
  const normalizedBranch = SHOWROOM_BRANCHES.some(b => b.id === cart.branchId) ? cart.branchId : SHOWROOM_BRANCHES[0].id;
  if (!cart.items || cart.items.length === 0) {
    return {
      ...cart,
      branchId: normalizedBranch,
      items: [],
      summary: {
        itemsCount: 0,
        itemsSubtotal: 0,
        discountAmount: 0,
        deliveryFee: 0,
        totalAmount: 0,
        depositAmount: 0,
        promo: null,
        promoError: null
      }
    };
  }

  let quoteBreakdown = null;
  let promoError = null;
  try {
    quoteBreakdown = PricingService.buildQuoteBreakdownInState(state, {
      items: cart.items,
      promoCode: cart.promoCode,
      deliveryMethod: cart.deliveryMethod || 'showroom',
      branchId: normalizedBranch,
      userId
    });
  } catch (e) {
    promoError = e.message;
    // Fallback quote without invalid promo so buyer sees items + clear promo error
    quoteBreakdown = PricingService.buildQuoteBreakdownInState(state, {
      items: cart.items,
      promoCode: null,
      deliveryMethod: cart.deliveryMethod || 'showroom',
      branchId: normalizedBranch,
      userId
    });
  }

  const enrichedItems = cart.items.map((line, idx) => {
    const priced = quoteBreakdown.lines[idx] || {};
    return {
      ...line,
      name: priced.name || line.name,
      unitPrice: priced.unitPrice ?? 0,
      lineTotal: priced.lineTotal ?? 0,
      image: priced.image || line.image || null,
      fuel: priced.fuel || null,
      isCertified: priced.isCertified || false
    };
  });

  return {
    ...cart,
    branchId: normalizedBranch,
    items: enrichedItems,
    summary: {
      itemsCount: enrichedItems.reduce((s, i) => s + (i.quantity || 1), 0),
      itemsSubtotal: quoteBreakdown.itemsSubtotal,
      promoDiscountAmount: quoteBreakdown.promoDiscountAmount || 0,
      bundleDiscountAmount: quoteBreakdown.bundleDiscountAmount || 0,
      discountAmount: quoteBreakdown.discountAmount,
      deliveryFee: quoteBreakdown.deliveryFee,
      totalAmount: quoteBreakdown.totalAmount,
      depositAmount: quoteBreakdown.depositAmount,
      promo: quoteBreakdown.promo,
      promoError
    }
  };
}

const CartService = {
  async getCart(userId) {
    const { dbState } = require('../infrastructure/storage-engine');
    const cart = await CartRepository.getOrCreateByUserId(userId);
    return enrichCartWithQuote(cart, dbState, userId);
  },

  async addItem(userId, payload = {}) {
    const qty = payload.quantity !== undefined ? Number(payload.quantity) : 1;
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
      throw createError('Số lượng sản phẩm phải từ 1 đến 20.', 422, 'INVALID_QUANTITY');
    }

    const updatedCart = await CartRepository.mutateCart(userId, payload.expectedVersion, (cart, state) => {
      if (payload.branchId && SHOWROOM_BRANCHES.some(b => b.id === payload.branchId)) {
        cart.branchId = payload.branchId;
      }

      const resolved = PricingService.resolveCatalogItemInState(state, payload);
      if (resolved.itemType === 'accessory') {
        const acc = (state.accessories || []).find(a => a.id === resolved.itemId);
        if (acc) {
          validateAccessoryCompatibility(state, acc, cart.items, payload.vehicleId);
          const stock = Math.max(0, Math.round(Number(acc.quantity ?? acc.stock ?? 0)));
          const existingSame = cart.items.find(i => i.itemType === 'accessory' && i.itemId === resolved.itemId);
          const nextQty = (existingSame ? existingSame.quantity : 0) + qty;
          if (nextQty > stock) {
            throw createError(`Phụ kiện "${acc.name}" chỉ còn ${stock} sản phẩm trong kho.`, 409, 'INSUFFICIENT_ACCESSORY_STOCK');
          }
        }
      }

      const existing = cart.items.find(i =>
        i.itemType === resolved.itemType &&
        i.itemId === resolved.itemId &&
        (i.colorName || null) === (resolved.colorName || null) &&
        (i.trimName || null) === (resolved.trimName || null) &&
        (i.wheelId || null) === (resolved.wheelId || null) &&
        (i.configurationId || null) === (payload.configurationId || null)
      );

      if (resolved.isCertified && (existing || qty > 1)) {
        throw createError(`Xe Certified "${resolved.name}" chỉ cho phép tối đa 1 chiếc theo số VIN.`, 409, 'CPO_UNIQUE_UNIT');
      }

      if (existing) {
        existing.quantity = Math.min(20, existing.quantity + qty);
      } else {
        cart.items.push({
          lineId: `cl_${crypto.randomUUID().slice(0, 8)}`,
          itemType: resolved.itemType,
          itemId: resolved.itemId,
          name: resolved.name,
          image: resolved.image,
          quantity: qty,
          colorName: resolved.colorName || null,
          colorHex: payload.colorHex || null,
          trimName: resolved.trimName || null,
          wheelId: resolved.wheelId || null,
          wheelName: resolved.wheelName || null,
          configurationId: payload.configurationId || null,
          addedAt: new Date().toISOString()
        });
      }
    });

    const { dbState } = require('../infrastructure/storage-engine');
    return enrichCartWithQuote(updatedCart, dbState, userId);
  },

  async updateItem(userId, lineId, payload = {}) {
    const updatedCart = await CartRepository.mutateCart(userId, payload.expectedVersion, (cart, state) => {
      if (payload.branchId !== undefined) {
        if (!SHOWROOM_BRANCHES.some(b => b.id === payload.branchId)) {
          throw createError(`Chi nhánh "${payload.branchId}" không hợp lệ.`, 400, 'INVALID_BRANCH');
        }
        cart.branchId = payload.branchId;
      }
      if (payload.deliveryMethod !== undefined) {
        if (!Object.prototype.hasOwnProperty.call(PricingService.DELIVERY_FEES_VND, payload.deliveryMethod)) {
          throw createError('Phương thức giao xe không hợp lệ.', 400, 'INVALID_DELIVERY_METHOD');
        }
        cart.deliveryMethod = payload.deliveryMethod;
      }

      if (!lineId) return;
      const line = cart.items.find(i => i.lineId === lineId);
      if (!line) {
        throw createError('Không tìm thấy sản phẩm trong giỏ hàng.', 404, 'LINE_NOT_FOUND');
      }

      if (payload.quantity !== undefined) {
        const qty = Number(payload.quantity);
        if (!Number.isInteger(qty) || qty < 0 || qty > 20) {
          throw createError('Số lượng cập nhật phải là số nguyên từ 0 đến 20.', 422, 'INVALID_QUANTITY');
        }
        if (qty === 0) {
          cart.items = cart.items.filter(i => i.lineId !== lineId);
          return;
        }
        if (line.itemType === 'certified' && qty > 1) {
          throw createError('Xe Certified chỉ cho phép số lượng 1 chiếc.', 409, 'CPO_UNIQUE_UNIT');
        }
        line.quantity = qty;
      }
      if (payload.colorName !== undefined) {
        const resolved = PricingService.resolveCatalogItemInState(state, { ...line, colorName: payload.colorName });
        line.colorName = resolved.colorName;
      }
    });

    const { dbState } = require('../infrastructure/storage-engine');
    return enrichCartWithQuote(updatedCart, dbState, userId);
  },

  async removeItem(userId, lineId, expectedVersion) {
    const updatedCart = await CartRepository.mutateCart(userId, expectedVersion, (cart) => {
      const prevLen = cart.items.length;
      cart.items = cart.items.filter(i => i.lineId !== lineId);
      if (cart.items.length === prevLen) {
        throw createError('Không tìm thấy sản phẩm trong giỏ hàng.', 404, 'LINE_NOT_FOUND');
      }
    });
    const { dbState } = require('../infrastructure/storage-engine');
    return enrichCartWithQuote(updatedCart, dbState, userId);
  },

  async applyPromo(userId, { code, expectedVersion } = {}) {
    const updatedCart = await CartRepository.mutateCart(userId, expectedVersion, (cart, state) => {
      if (!code || !String(code).trim()) {
        cart.promoCode = null;
        return;
      }
      const cleanCode = String(code).trim().toUpperCase();
      if (cart.items.length > 0) {
        const breakdown = PricingService.buildQuoteBreakdownInState(state, {
          items: cart.items,
          promoCode: null,
          branchId: cart.branchId,
          userId
        });
        PromotionService.evaluatePromoInState(state, {
          code: cleanCode,
          subtotal: breakdown.itemsSubtotal,
          items: breakdown.lines,
          branchId: cart.branchId,
          userId
        });
      }
      cart.promoCode = cleanCode;
    });
    const { dbState } = require('../infrastructure/storage-engine');
    return enrichCartWithQuote(updatedCart, dbState, userId);
  },

  async mergeGuestItems(userId, { items = [], guestItems = [], branchId, expectedVersion } = {}) {
    const mergeList = Array.isArray(items) && items.length > 0 ? items : (Array.isArray(guestItems) ? guestItems : []);
    if (mergeList.length === 0) {
      return this.getCart(userId);
    }
    const updatedCart = await CartRepository.mutateCart(userId, expectedVersion, (cart, state) => {
      if (branchId && SHOWROOM_BRANCHES.some(b => b.id === branchId) && cart.items.length === 0) {
        cart.branchId = branchId;
      }
      for (const rawItem of mergeList.slice(0, 20)) {
        try {
          const resolved = PricingService.resolveCatalogItemInState(state, rawItem);
          const qty = Math.min(20, Math.max(1, parseInt(rawItem.quantity, 10) || 1));
          const existing = cart.items.find(i =>
            i.itemType === resolved.itemType &&
            i.itemId === resolved.itemId &&
            (i.colorName || null) === (resolved.colorName || null) &&
            (i.trimName || null) === (resolved.trimName || null)
          );
          if (existing) {
            if (!resolved.isCertified) existing.quantity = Math.min(20, existing.quantity + qty);
          } else {
            cart.items.push({
              lineId: `cl_${crypto.randomUUID().slice(0, 8)}`,
              itemType: resolved.itemType,
              itemId: resolved.itemId,
              name: resolved.name,
              image: resolved.image,
              quantity: resolved.isCertified ? 1 : qty,
              colorName: resolved.colorName || null,
              colorHex: rawItem.colorHex || null,
              trimName: resolved.trimName || null,
              configurationId: rawItem.configurationId || null,
              addedAt: new Date().toISOString()
            });
          }
        } catch (e) {
          // Skip invalid/archived guest draft items safely without crashing login flow
        }
      }
    });
    const { dbState } = require('../infrastructure/storage-engine');
    return enrichCartWithQuote(updatedCart, dbState, userId);
  },

  async addBundleQuote(userId, bundleQuoteId, expectedVersion = undefined) {
    if (!bundleQuoteId) {
      throw createError('Thiếu mã báo giá gói phụ kiện (bundleQuoteId).', 422, 'BUNDLE_QUOTE_REQUIRED');
    }
    const updatedCart = await CartRepository.mutateCart(userId, expectedVersion, (cart, state) => {
      const bQuote = (state.bundles || []).find(b => b.id === bundleQuoteId);
      if (!bQuote) {
        throw createError('Không tìm thấy báo giá gói phụ kiện.', 404, 'BUNDLE_QUOTE_NOT_FOUND');
      }
      if (bQuote.userId && bQuote.userId !== userId) {
        throw createError('Báo giá gói phụ kiện thuộc người dùng khác.', 403, 'FORBIDDEN');
      }
      if (new Date(bQuote.expiresAt).getTime() <= Date.now()) {
        throw createError('Báo giá gói phụ kiện đã hết hạn (30 phút). Vui lòng tạo lại báo giá mới.', 409, 'BUNDLE_QUOTE_EXPIRED');
      }
      // Remove any previous lines linked to the exact same bundleQuoteId so repeat clicks are idempotent
      cart.items = cart.items.filter(i => i.bundleQuoteId !== bQuote.id);

      const BundleService = require('./bundle-service');
      const liveCheck = BundleService.calculateBreakdownInState(state, {
        vehicleId: bQuote.vehicleId,
        items: bQuote.lines.map(l => ({ sku: l.sku, quantity: l.quantity }))
      });

      for (const line of liveCheck.lines) {
        cart.items.push({
          lineId: `cl_${crypto.randomUUID().slice(0, 8)}`,
          itemType: 'accessory',
          itemId: line.sku,
          name: line.name,
          image: line.image,
          quantity: line.quantity,
          bundleQuoteId: bQuote.id,
          bundlePolicyVersion: bQuote.policyVersion,
          vehicleId: bQuote.vehicleId || null,
          addedAt: new Date().toISOString()
        });
      }
    });
    const { dbState } = require('../infrastructure/storage-engine');
    return enrichCartWithQuote(updatedCart, dbState, userId);
  },

  async clearCart(userId) {
    const updatedCart = await CartRepository.mutateCart(userId, undefined, (cart) => {
      cart.items = [];
      cart.promoCode = null;
    });
    const { dbState } = require('../infrastructure/storage-engine');
    return enrichCartWithQuote(updatedCart, dbState, userId);
  }
};

module.exports = CartService;
