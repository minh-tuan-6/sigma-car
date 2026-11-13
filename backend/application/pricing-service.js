// backend/application/pricing-service.js
// Server-authoritative quote engine: validates line items, computes integer VND breakdown, stores versioned quotes

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const { SHOWROOM_BRANCHES } = require('../domain/constants');
const PromotionService = require('./promotion-service');
const FinancingService = require('./financing-service');

const DELIVERY_FEES_VND = {
  showroom: 0,
  home_city: 2500000,
  intercity: 8000000
};

function createError(message, statusCode = 400, code = 'PRICING_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function resolveCatalogItemInState(state, line) {
  const itemId = String(line.itemId || line.vehicleId || line.id || '').trim();
  const itemType = String(line.itemType || line.type || 'vehicle').toLowerCase();

  if (itemType === 'accessory') {
    const AccessoryService = require('./accessory-service');
    AccessoryService.ensureSkusInState(state);
    const acc = (state.accessories || []).find(a => a.id === itemId);
    if (!acc) throw createError(`Phụ kiện "${itemId}" không tồn tại.`, 404, 'ITEM_NOT_FOUND');
    return {
      itemType: 'accessory',
      itemId: acc.id,
      name: acc.name,
      unitPrice: Math.round(Number(acc.price)),
      fuel: null,
      image: acc.image || null,
      isCertified: false
    };
  }

  const cleanId = itemId.toLowerCase().replace(/^sigma-/, '');
  const vehicle = (state.vehicles || []).find(v => v.id === itemId || v.id === cleanId);
  if (vehicle) {
    if (vehicle.archived) {
      throw createError(`Mẫu xe "${vehicle.name}" hiện đã ngừng kinh doanh.`, 422, 'ITEM_ARCHIVED');
    }
    let trimDelta = 0;
    let resolvedTrimName = line.trimName || null;
    if (line.trimName && Array.isArray(vehicle.trims) && vehicle.trims.length > 0) {
      const matchedTrim = vehicle.trims.find(t => String(t.name).toLowerCase() === String(line.trimName).toLowerCase());
      if (!matchedTrim) {
        throw createError(`Phiên bản "${line.trimName}" không thuộc mẫu xe ${vehicle.name}.`, 422, 'INVALID_TRIM');
      }
      if (Number.isFinite(matchedTrim.price) && matchedTrim.price > 0) {
        trimDelta = Math.round(matchedTrim.price) - Math.round(vehicle.price);
      } else if (Number.isFinite(matchedTrim.priceDelta)) {
        trimDelta = Math.round(matchedTrim.priceDelta);
      }
      resolvedTrimName = matchedTrim.name;
    }

    let colorName = line.colorName || null;
    if (colorName && Array.isArray(vehicle.colors) && vehicle.colors.length > 0) {
      const matchedColor = vehicle.colors.find(c => String(c.name).toLowerCase() === String(colorName).toLowerCase());
      if (!matchedColor) {
        throw createError(`Màu sắc "${colorName}" không khả dụng trên mẫu xe ${vehicle.name}.`, 422, 'INVALID_COLOR');
      }
      colorName = matchedColor.name;
    }

    let wheelDelta = 0;
    let wheelName = line.wheelName || null;
    if (line.wheelId) {
      const DEFAULT_WHEELS = [
        { id: 'wheel-21-sport', name: '21" Sport Wheels', price: 0 },
        { id: 'wheel-20-aero', name: '20" Aero Blade Range Wheels', price: 18000000 },
        { id: 'wheel-22-forged', name: '22" Forged Turbine Carbon', price: 45000000 }
      ];
      const wheelPool = Array.isArray(vehicle.wheels) && vehicle.wheels.length > 0 ? vehicle.wheels : DEFAULT_WHEELS;
      const matchedWheel = wheelPool.find(w => w.id === line.wheelId);
      if (matchedWheel) {
        wheelDelta = Math.round(Number(matchedWheel.price || 0));
        wheelName = matchedWheel.name;
      }
    }

    const activeBasePrice = Number.isFinite(vehicle.salePrice) && vehicle.salePrice > 0 && vehicle.salePrice < vehicle.price
      ? Math.round(vehicle.salePrice)
      : Math.round(Number(vehicle.price));

    return {
      itemType: 'vehicle',
      itemId: vehicle.id,
      name: vehicle.name,
      unitPrice: Math.max(1, activeBasePrice + trimDelta + wheelDelta),
      fuel: vehicle.fuel || 'gas',
      image: vehicle.image || null,
      trimName: resolvedTrimName,
      colorName,
      wheelId: line.wheelId || null,
      wheelName,
      isCertified: false
    };
  }

  const cpo = (state.certifiedVehicles || []).find(v => v.id === itemId || v.id === cleanId);
  if (cpo) {
    return {
      itemType: 'certified',
      itemId: cpo.id,
      name: cpo.name,
      unitPrice: Math.round(Number(cpo.price)),
      fuel: cpo.fuel || 'ev',
      image: cpo.image || null,
      vin: cpo.vin || null,
      isCertified: true
    };
  }

  throw createError(`Sản phẩm "${itemId}" không tồn tại trong hệ thống.`, 404, 'ITEM_NOT_FOUND');
}

function buildQuoteBreakdownInState(state, {
  items = [],
  promoCode = null,
  deliveryMethod = 'showroom',
  branchId = 'hn-caugiay',
  downPaymentPercent = 30,
  termMonths = 60,
  annualInterestRatePercent = 7.9,
  userId = null,
  nowMs = Date.now()
}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw createError('Danh sách sản phẩm để lập báo giá không được để trống.', 400, 'EMPTY_ITEMS');
  }
  if (!SHOWROOM_BRANCHES.some(b => b.id === branchId)) {
    throw createError(`Showroom/chi nhánh "${branchId}" không hợp lệ.`, 400, 'INVALID_BRANCH');
  }
  if (!Object.prototype.hasOwnProperty.call(DELIVERY_FEES_VND, deliveryMethod)) {
    throw createError(`Hình thức giao xe "${deliveryMethod}" không hợp lệ.`, 400, 'INVALID_DELIVERY_METHOD');
  }

  const normalizedLines = [];
  let vehiclesSubtotal = 0;
  let accessoriesSubtotal = 0;
  let vehicleDepositRequired = 0;

  for (const rawLine of items) {
    const qty = Number(rawLine.quantity ?? 1);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
      throw createError('Số lượng mỗi sản phẩm phải là số nguyên từ 1 đến 20.', 422, 'INVALID_QUANTITY');
    }
    const resolved = resolveCatalogItemInState(state, rawLine);
    if (resolved.isCertified && qty !== 1) {
      throw createError(`Xe qua sử dụng "${resolved.name}" chỉ có thể mua số lượng 1 chiếc theo số VIN.`, 422, 'CPO_MAX_QUANTITY');
    }

    const lineTotal = Math.round(resolved.unitPrice * qty);
    if (resolved.itemType === 'accessory') {
      accessoriesSubtotal += lineTotal;
    } else {
      vehiclesSubtotal += lineTotal;
      vehicleDepositRequired += Math.min(lineTotal, 50000000 * qty);
    }

    normalizedLines.push({
      lineId: rawLine.lineId || `ql_${crypto.randomUUID().slice(0, 8)}`,
      itemType: resolved.itemType,
      itemId: resolved.itemId,
      name: resolved.name,
      fuel: resolved.fuel,
      image: resolved.image,
      trimName: resolved.trimName || null,
      colorName: resolved.colorName || null,
      quantity: qty,
      unitPrice: resolved.unitPrice,
      lineTotal,
      isCertified: resolved.isCertified
    });
  }

  const itemsSubtotal = vehiclesSubtotal + accessoriesSubtotal;
  const deliveryFee = DELIVERY_FEES_VND[deliveryMethod];

  let appliedPromo = null;
  let promoDiscountAmount = 0;
  if (promoCode && String(promoCode).trim()) {
    appliedPromo = PromotionService.evaluatePromoInState(state, {
      code: promoCode,
      subtotal: itemsSubtotal,
      items: normalizedLines,
      branchId,
      userId,
      nowMs
    });
    promoDiscountAmount = appliedPromo ? appliedPromo.discountAmount : 0;
  }

  let bundleDiscountAmount = 0;
  const bundleIds = Array.from(new Set(items.map(i => i && i.bundleQuoteId).filter(Boolean)));
  if (bundleIds.length > 0 && Array.isArray(state.bundles)) {
    const BundleService = require('./bundle-service');
    for (const bId of bundleIds) {
      const bQuote = state.bundles.find(b => b.id === bId);
      if (!bQuote || (bQuote.userId && userId && bQuote.userId !== userId)) continue;
      if (bQuote.expiresAt && new Date(bQuote.expiresAt).getTime() <= nowMs) continue;
      const matchingLines = [];
      items.forEach((rawLine, idx) => {
        if (rawLine && rawLine.bundleQuoteId === bId && normalizedLines[idx]) {
          matchingLines.push({ sku: normalizedLines[idx].itemId, quantity: normalizedLines[idx].quantity });
        }
      });
      if (matchingLines.length >= 2) {
        try {
          const bd = BundleService.calculateBreakdownInState(state, {
            vehicleId: bQuote.vehicleId || null,
            items: matchingLines
          });
          bundleDiscountAmount += bd.discountAmount || 0;
        } catch (e) {}
      }
    }
  }

  const discountAmount = Math.min(itemsSubtotal, promoDiscountAmount + bundleDiscountAmount);
  const taxableBase = Math.max(0, itemsSubtotal - discountAmount);
  const registrationFeeEstimate = null; // Authoritative registration calculated per province in RegistrationService
  const totalAmount = Math.max(0, taxableBase + deliveryFee);
  const depositAmount = vehicleDepositRequired > 0
    ? Math.min(totalAmount, vehicleDepositRequired)
    : totalAmount;

  let financingSnapshot = null;
  if (totalAmount > 0) {
    financingSnapshot = FinancingService.calculateLoan({
      vehiclePrice: totalAmount,
      downPaymentPercent: Number(downPaymentPercent),
      annualInterestRatePercent: Number(annualInterestRatePercent),
      termMonths: Number(termMonths)
    });
  }

  const hashPayload = JSON.stringify({
    lines: normalizedLines.map(l => [l.itemType, l.itemId, l.trimName, l.colorName, l.quantity, l.unitPrice]),
    discountAmount,
    deliveryFee,
    totalAmount,
    branchId,
    policyVersion: '2026.1'
  });
  const quoteHash = crypto.createHash('sha256').update(hashPayload).digest('hex').slice(0, 24);

  return {
    currency: 'VND',
    policyVersion: '2026.1',
    branchId,
    deliveryMethod,
    lines: normalizedLines,
    itemsSubtotal,
    vehiclesSubtotal,
    accessoriesSubtotal,
    deliveryFee,
    promo: appliedPromo,
    promoDiscountAmount,
    bundleDiscountAmount,
    discountAmount,
    registrationFeeEstimate,
    registrationNote: 'Phí trước bạ & biển số chính xác được tính theo tỉnh/thành trong bước Hồ sơ Đăng ký xe.',
    totalAmount,
    depositAmount,
    financingSnapshot,
    quoteHash
  };
}

const PricingService = {
  DELIVERY_FEES_VND,
  resolveCatalogItemInState,
  buildQuoteBreakdownInState,

  async createQuote({ items, promoCode, deliveryMethod, branchId, downPaymentPercent, termMonths, annualInterestRatePercent, userId }) {
    return runInTransaction(async (state) => {
      const nowMs = Date.now();
      const breakdown = buildQuoteBreakdownInState(state, {
        items,
        promoCode,
        deliveryMethod,
        branchId,
        downPaymentPercent,
        termMonths,
        annualInterestRatePercent,
        userId,
        nowMs
      });

      const quote = {
        id: `qt_${crypto.randomUUID()}`,
        userId: userId || null,
        version: 1,
        ...breakdown,
        createdAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + 15 * 60 * 1000).toISOString()
      };
      if (!Array.isArray(state.quotes)) state.quotes = [];
      state.quotes.push(quote);
      return quote;
    });
  },

  async findQuoteById(quoteId) {
    return (dbState.quotes || []).find(q => q.id === quoteId) || null;
  }
};

module.exports = PricingService;
