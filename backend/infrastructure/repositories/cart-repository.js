// backend/infrastructure/repositories/cart-repository.js
// Persistent per-user cart repository with optimistic versioning

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../storage-engine');
const { SHOWROOM_BRANCHES } = require('../../domain/constants');

function createError(message, statusCode = 400, code = 'CART_ERROR', extra = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  Object.assign(err, extra);
  return err;
}

const CartRepository = {
  async findByUserId(userId) {
    if (!userId) return null;
    const cart = (dbState.carts || []).find(c => c.userId === userId) || null;
    return cart ? { ...cart, items: Array.isArray(cart.items) ? [...cart.items] : [] } : null;
  },

  async getOrCreateByUserId(userId) {
    const existing = await this.findByUserId(userId);
    if (existing) return existing;

    return runInTransaction(async (state) => {
      if (!Array.isArray(state.carts)) state.carts = [];
      const again = state.carts.find(c => c.userId === userId);
      if (again) return { ...again, items: [...(again.items || [])] };

      const created = {
        id: `cart_${crypto.randomUUID()}`,
        userId,
        branchId: SHOWROOM_BRANCHES[0].id,
        promoCode: null,
        items: [],
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.carts.push(created);
      return { ...created, items: [] };
    });
  },

  async mutateCart(userId, expectedVersion, mutator) {
    return runInTransaction(async (state) => {
      if (!Array.isArray(state.carts)) state.carts = [];
      let cart = state.carts.find(c => c.userId === userId);
      if (!cart) {
        cart = {
          id: `cart_${crypto.randomUUID()}`,
          userId,
          branchId: SHOWROOM_BRANCHES[0].id,
          promoCode: null,
          items: [],
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        state.carts.push(cart);
      }

      if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== cart.version) {
        throw createError(
          `Giỏ hàng vừa được cập nhật từ phiên khác (Phiên bản hiện tại: v${cart.version}).`,
          409,
          'CART_VERSION_CONFLICT',
          { currentVersion: cart.version, currentCart: { ...cart } }
        );
      }

      await mutator(cart, state);
      cart.version = (cart.version || 1) + 1;
      cart.updatedAt = new Date().toISOString();
      return { ...cart, items: [...cart.items] };
    });
  }
};

module.exports = CartRepository;
