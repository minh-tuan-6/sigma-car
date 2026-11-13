// backend/application/bundle-service.js
// Smart Accessory Bundle Recommender & Versioned Server Quote Engine (SIG-P3-011)

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const AccessoryService = require('./accessory-service');
const Security = require('../infrastructure/security');

const BUNDLE_POLICY = {
  version: 'BUNDLE-POL-2026.1',
  maxDiscountCapVnd: 2500000,
  tiers: [
    { minDistinctSkus: 4, discountRate: 0.10, label: 'Gói Toàn Diện (Từ 4 món - Giảm 10%, tối đa 2.500.000đ)' },
    { minDistinctSkus: 3, discountRate: 0.08, label: 'Gói Chuyên Sâu (Từ 3 món - Giảm 8%, tối đa 2.500.000đ)' },
    { minDistinctSkus: 2, discountRate: 0.05, label: 'Gói Khởi Đầu (Từ 2 món - Giảm 5%, tối đa 2.500.000đ)' }
  ]
};

function createError(message, statusCode = 400, code = 'BUNDLE_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

const BundleService = {
  recommendForVehicle({ vehicleId, usage = 'family' } = {}) {
    if (!vehicleId) {
      throw createError('Vui lòng chọn mẫu xe để hệ thống gợi ý gói phụ kiện tương thích.', 422, 'VEHICLE_REQUIRED');
    }
    const { vehicle, items } = AccessoryService.listAll({
      vehicleId,
      kind: 'accessory',
      inStockOnly: true,
      compatibleOnly: true
    });
    if (!vehicle) {
      throw createError(`Không tìm thấy mẫu xe "${vehicleId}".`, 404, 'VEHICLE_NOT_FOUND');
    }

    const usageLow = String(usage || 'family').toLowerCase();
    const priorityOrder = usageLow === 'sport' || usageLow === 'performance'
      ? ['ACC-005', 'ACC-001', 'ACC-003', 'ACC-006']
      : usageLow === 'commute' || usageLow === 'city'
        ? ['ACC-001', 'ACC-003', 'ACC-006', 'ACC-007']
        : ['ACC-001', 'ACC-002', 'ACC-003', 'ACC-005'];

    const selected = [];
    for (const sku of priorityOrder) {
      const found = items.find(i => i.sku === sku);
      if (found) selected.push({ ...found, recommendedQty: 1, reason: found.fitReason });
    }
    for (const extra of items) {
      if (selected.length >= 4) break;
      if (!selected.some(s => s.sku === extra.sku)) {
        selected.push({ ...extra, recommendedQty: 1, reason: extra.fitReason });
      }
    }

    const quotePreview = this.calculateBreakdownInState(dbState, {
      vehicleId: vehicle.id,
      items: selected.map(s => ({ sku: s.sku, quantity: s.recommendedQty }))
    });

    return {
      vehicle,
      usage: Security.sanitizeString(usageLow),
      recommendedItems: selected.map(s => ({
        sku: s.sku,
        name: s.name,
        brand: s.brand,
        price: s.price,
        priceFormatted: s.priceFormatted,
        image: s.image,
        quantity: s.recommendedQty,
        stockQuantity: s.stockQuantity,
        fitReason: s.reason
      })),
      quotePreview
    };
  },

  calculateBreakdownInState(state, { vehicleId = null, items = [] } = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      throw createError('Gói phụ kiện phải có ít nhất 01 sản phẩm hợp lệ.', 422, 'EMPTY_BUNDLE');
    }

    const vehicle = vehicleId
      ? ((state.vehicles || []).find(v => v.id === vehicleId) || (state.certifiedVehicles || []).find(v => v.id === vehicleId) || null)
      : null;
    if (vehicleId && !vehicle) {
      throw createError(`Không tìm thấy mẫu xe "${vehicleId}".`, 404, 'VEHICLE_NOT_FOUND');
    }

    // Deduplicate SKU quantities cleanly
    const qtyBySku = new Map();
    for (const rawLine of items) {
      const sku = String(rawLine.sku || rawLine.itemId || rawLine.id || '').trim();
      const qty = Number(rawLine.quantity ?? 1);
      if (!sku) throw createError('Thiếu mã phụ kiện (SKU).', 422, 'INVALID_SKU');
      if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
        throw createError(`Số lượng cho mã "${sku}" phải là số nguyên từ 1 đến 50.`, 422, 'INVALID_QUANTITY');
      }
      qtyBySku.set(sku, (qtyBySku.get(sku) || 0) + qty);
    }

    const lines = [];
    let itemsSubtotal = 0;

    for (const [sku, qty] of qtyBySku.entries()) {
      const acc = (state.accessories || []).find(a => a.id === sku);
      if (!acc) {
        throw createError(`Phụ kiện "${sku}" không tồn tại trong hệ thống.`, 404, 'ACCESSORY_NOT_FOUND');
      }
      if (vehicle) {
        const fit = AccessoryService.evaluateFitForVehicle(acc, vehicle);
        if (fit.compatible === false) {
          throw createError(`Phụ kiện "${acc.name}" (${sku}) không tương thích với xe ${vehicle.name}: ${fit.fitReason}`, 422, 'INCOMPATIBLE_ACCESSORY');
        }
      }
      const stock = Math.max(0, Math.round(Number(acc.quantity ?? acc.stock ?? 0)));
      if (qty > stock) {
        throw createError(`Phụ kiện "${acc.name}" chỉ còn ${stock} sản phẩm trong kho (yêu cầu ${qty}).`, 409, 'INSUFFICIENT_ACCESSORY_STOCK');
      }

      const unitPrice = Math.round(Number(acc.price || 0));
      const lineTotal = unitPrice * qty;
      itemsSubtotal += lineTotal;
      lines.push({
        sku: acc.id,
        name: acc.name,
        brand: acc.brand,
        image: acc.image,
        quantity: qty,
        availableStock: stock,
        unitPrice,
        lineTotal
      });
    }

    const distinctCount = lines.length;
    const matchedTier = BUNDLE_POLICY.tiers.find(t => distinctCount >= t.minDistinctSkus) || null;
    const rawDiscount = matchedTier ? Math.round(itemsSubtotal * matchedTier.discountRate) : 0;
    const discountAmount = Math.min(rawDiscount, BUNDLE_POLICY.maxDiscountCapVnd);
    const totalAmount = Math.max(0, itemsSubtotal - discountAmount);

    return {
      vehicleId: vehicle ? vehicle.id : null,
      vehicleName: vehicle ? vehicle.name : null,
      policyVersion: BUNDLE_POLICY.version,
      tierLabel: matchedTier ? matchedTier.label : 'Mua lẻ tiêu chuẩn (Chưa đạt ngưỡng giảm giá gói >= 2 SKU)',
      distinctSkuCount: distinctCount,
      lines,
      itemsSubtotal,
      discountAmount,
      totalAmount
    };
  },

  async createQuote(user, { vehicleId = null, items = [] } = {}) {
    return runInTransaction(async (state) => {
      if (!Array.isArray(state.bundles)) state.bundles = [];
      const breakdown = this.calculateBreakdownInState(state, { vehicleId, items });
      const nowMs = Date.now();
      const expiresAt = new Date(nowMs + 30 * 60 * 1000).toISOString();

      const bundleQuote = {
        id: `BND-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        userId: user ? user.userId : null,
        ...breakdown,
        status: 'active',
        expiresAt,
        createdAt: new Date(nowMs).toISOString()
      };
      state.bundles.unshift(bundleQuote);
      if (state.bundles.length > 200) state.bundles.length = 200;
      return bundleQuote;
    });
  }
};

module.exports = BundleService;
