// backend/application/promotion-service.js
// Server-authoritative promotions, eligibility, boundary & usage cap enforcement

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const Security = require('../infrastructure/security');

function createError(message, statusCode = 400, code = 'PROMO_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function findPromoInState(state, code) {
  if (!code) return null;
  const clean = String(code).trim().toUpperCase();
  return (state.promotions || []).find(p => String(p.code || '').toUpperCase() === clean) || null;
}

function evaluatePromoInState(state, { code, subtotal, items = [], branchId = null, userId = null, nowMs = Date.now() }) {
  if (!code || !String(code).trim()) return null;
  const promo = findPromoInState(state, code);
  if (!promo) {
    throw createError(`Mã khuyến mãi "${String(code).trim().toUpperCase()}" không tồn tại.`, 404, 'PROMO_NOT_FOUND');
  }
  if (!promo.isActive) {
    throw createError(`Mã khuyến mãi "${promo.code}" hiện đang tạm ngưng.`, 409, 'PROMO_INACTIVE');
  }

  if (promo.startsAt && Date.parse(promo.startsAt) > nowMs) {
    throw createError(`Mã khuyến mãi "${promo.code}" chưa đến thời gian áp dụng.`, 409, 'PROMO_NOT_STARTED');
  }
  if (promo.expiresAt && Date.parse(promo.expiresAt) < nowMs) {
    throw createError(`Mã khuyến mãi "${promo.code}" đã hết hạn sử dụng.`, 409, 'PROMO_EXPIRED');
  }

  if (promo.branchId && branchId && promo.branchId !== branchId) {
    throw createError(`Mã khuyến mãi "${promo.code}" không áp dụng tại chi nhánh ${branchId}.`, 409, 'PROMO_BRANCH_MISMATCH');
  }

  const limit = Number.isInteger(promo.usageLimit) ? promo.usageLimit : null;
  const used = promo.usedCount || 0;
  if (limit !== null && used >= limit) {
    throw createError(`Mã khuyến mãi "${promo.code}" đã hết lượt sử dụng.`, 409, 'PROMO_EXHAUSTED');
  }

  const perUserLimit = Number.isInteger(promo.perUserLimit) ? promo.perUserLimit : null;
  if (perUserLimit !== null && userId) {
    const userRedemptions = Array.isArray(promo.redeemedByUsers)
      ? promo.redeemedByUsers.filter(u => u === userId).length
      : 0;
    if (userRedemptions >= perUserLimit) {
      throw createError(`Bạn đã sử dụng hết lượt cho phép của mã "${promo.code}".`, 409, 'PROMO_USER_CAP_REACHED');
    }
  }

  const minVal = Number(promo.minOrderValue || 0);
  if (subtotal < minVal) {
    throw createError(
      `Đơn hàng tối thiểu từ ${minVal.toLocaleString('vi-VN')} VNĐ mới áp dụng được mã "${promo.code}".`,
      422,
      'PROMO_MIN_ORDER_NOT_MET'
    );
  }

  if (promo.fuelRestriction) {
    const hasMatchingFuel = items.some(it => String(it.fuel || '').toLowerCase() === String(promo.fuelRestriction).toLowerCase());
    if (!hasMatchingFuel) {
      throw createError(`Mã "${promo.code}" chỉ áp dụng cho dòng xe nhiên liệu ${promo.fuelRestriction.toUpperCase()}.`, 422, 'PROMO_ELIGIBILITY_FAILED');
    }
  }

  let discountAmount = 0;
  if (promo.discountType === 'percent') {
    discountAmount = Math.round(subtotal * (Number(promo.discountValue || 0) / 100));
    if (Number.isFinite(promo.maxDiscountAmount) && promo.maxDiscountAmount > 0) {
      discountAmount = Math.min(discountAmount, Math.round(promo.maxDiscountAmount));
    }
  } else {
    discountAmount = Math.round(Number(promo.discountValue || 0));
  }
  discountAmount = Math.max(0, Math.min(subtotal, discountAmount));

  return {
    promoId: promo.id,
    code: promo.code,
    name: promo.name,
    discountType: promo.discountType,
    discountAmount
  };
}

function redeemPromoInState(state, { code, subtotal, items = [], branchId = null, userId = null, orderId = null, nowMs = Date.now() }) {
  const evaluated = evaluatePromoInState(state, { code, subtotal, items, branchId, userId, nowMs });
  if (!evaluated) return null;
  const promo = findPromoInState(state, code);
  promo.usedCount = (promo.usedCount || 0) + 1;
  if (!Array.isArray(promo.redeemedByUsers)) promo.redeemedByUsers = [];
  if (userId) promo.redeemedByUsers.push(userId);
  if (!Array.isArray(promo.redemptions)) promo.redemptions = [];
  promo.redemptions.push({
    orderId,
    userId,
    discountAmount: evaluated.discountAmount,
    redeemedAt: new Date(nowMs).toISOString()
  });
  return evaluated;
}

const PromotionService = {
  evaluatePromoInState,
  redeemPromoInState,

  async listPromotions({ activeOnly = true, branchId = null } = {}) {
    const now = Date.now();
    let list = [...(dbState.promotions || [])];
    if (activeOnly) {
      list = list.filter(p => p.isActive && (!p.expiresAt || Date.parse(p.expiresAt) >= now));
    }
    if (branchId && branchId !== 'all') {
      list = list.filter(p => !p.branchId || p.branchId === branchId);
    }
    return list.map(p => ({
      id: p.id,
      code: p.code,
      name: p.name,
      discountType: p.discountType,
      discountValue: p.discountValue,
      maxDiscountAmount: p.maxDiscountAmount || null,
      minOrderValue: p.minOrderValue || 0,
      fuelRestriction: p.fuelRestriction || null,
      usageLimit: p.usageLimit ?? null,
      maxUses: p.usageLimit ?? null,
      usedCount: p.usedCount || 0,
      startsAt: p.startsAt || null,
      expiresAt: p.expiresAt || null,
      isActive: Boolean(p.isActive)
    }));
  },

  async validateCode({ code, subtotal, items = [], branchId = null, userId = null }) {
    return evaluatePromoInState(dbState, {
      code,
      subtotal: Math.max(0, Math.round(Number(subtotal) || 0)),
      items,
      branchId,
      userId
    });
  },

  async createPromotion(data, user) {
    if (!user || !['admin', 'seller'].includes(user.role)) {
      throw createError('Bạn không có quyền tạo chương trình khuyến mãi.', 403, 'FORBIDDEN');
    }
    const cleanCode = String(data.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (cleanCode.length < 3) {
      throw createError('Mã khuyến mãi tối thiểu 3 ký tự chữ/số.', 400, 'VALIDATION_ERROR');
    }
    const discountType = data.discountType === 'percent' ? 'percent' : 'fixed';
    const discountValue = Number(data.discountValue);
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      throw createError('Giá trị giảm giá phải lớn hơn 0.', 400, 'VALIDATION_ERROR');
    }
    if (discountType === 'percent' && discountValue > 80) {
      throw createError('Tỷ lệ giảm phần trăm không được vượt quá 80%.', 400, 'VALIDATION_ERROR');
    }
    const rawLimit = data.usageLimit !== undefined && data.usageLimit !== null && data.usageLimit !== ''
      ? data.usageLimit
      : (data.maxUses !== undefined && data.maxUses !== null && data.maxUses !== '' ? data.maxUses : null);
    const usageLimit = rawLimit !== null ? parseInt(rawLimit, 10) : null;
    if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 1)) {
      throw createError('Giới hạn lượt dùng phải là số nguyên >= 1.', 400, 'VALIDATION_ERROR');
    }
    const fuelResRaw = data.fuelRestriction || (Array.isArray(data.fuelTypes) ? data.fuelTypes[0] : null);
    const normalizedFuelRes = (fuelResRaw && fuelResRaw !== 'all') ? String(fuelResRaw).toLowerCase() : null;

    return runInTransaction(async (state) => {
      if (findPromoInState(state, cleanCode)) {
        throw createError(`Mã khuyến mãi "${cleanCode}" đã tồn tại.`, 409, 'DUPLICATE_PROMO');
      }
      const created = {
        id: `promo_${crypto.randomUUID().slice(0, 8)}`,
        code: cleanCode,
        name: Security.sanitizeString(data.name || cleanCode),
        discountType,
        discountValue: Math.round(discountValue),
        maxDiscountAmount: data.maxDiscountAmount ? Math.round(Number(data.maxDiscountAmount)) : null,
        minOrderValue: Math.max(0, Math.round(Number(data.minOrderValue) || 0)),
        fuelRestriction: normalizedFuelRes,
        branchId: user.role === 'seller' ? (user.branchId || null) : (data.branchId || null),
        usageLimit,
        usedCount: 0,
        perUserLimit: data.perUserLimit ? parseInt(data.perUserLimit, 10) : null,
        startsAt: data.startsAt || new Date().toISOString(),
        expiresAt: data.expiresAt || null,
        isActive: data.isActive !== false,
        createdBy: user.userId,
        createdAt: new Date().toISOString()
      };
      state.promotions.push(created);
      return created;
    });
  }
};

module.exports = PromotionService;
