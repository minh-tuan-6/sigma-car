// backend/application/parts-service.js
// Workshop parts catalogue management (PLAN.md T4.7): list, create, restock.
// Reuses the existing partsLedger collection (seeded by ServiceRepository); reservation / consumption / release in
// workshop-service.js are unchanged. Every stock change is recorded in partsMovements and in auditLogs.

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const ServiceRepository = require('../infrastructure/repositories/service-repository');
const Security = require('../infrastructure/security');

const ALLOWED_FUELS = new Set(['ev', 'gas', 'hybrid']);

function createError(message, statusCode = 400, code = 'PARTS_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function requireStaff(user) {
  if (!user || !['admin', 'service_staff'].includes(user.role)) {
    throw createError('Chỉ Quản trị viên hoặc nhân viên xưởng được quản lý phụ tùng.', 403, 'FORBIDDEN');
  }
}

function audit(state, user, action, sku, detail) {
  if (!Array.isArray(state.auditLogs)) state.auditLogs = [];
  state.auditLogs.unshift({
    id: `AUD-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`,
    action,
    actorId: user.userId,
    actorName: user.fullName || user.email || user.userId,
    targetId: sku,
    detail,
    timestamp: new Date().toISOString()
  });
}

function movement(state, user, { sku, delta, reason }) {
  if (!Array.isArray(state.partsMovements)) state.partsMovements = [];
  const entry = { id: `PMV-${crypto.randomUUID().slice(0, 12)}`, sku, delta, reason, actorId: user.userId, createdAt: new Date().toISOString() };
  state.partsMovements.push(entry);
  return entry;
}

const view = (p) => ({ ...p, availableStock: Math.max(0, (p.stockOnHand || 0) - (p.stockReserved || 0)) });

const PartsService = {
  listParts({ q, lowStockOnly } = {}) {
    ServiceRepository.ensureInitialized(dbState);
    let list = (dbState.partsLedger || []).map(view);
    if (q && String(q).trim()) {
      const term = String(q).trim().toLowerCase();
      list = list.filter(p => String(p.sku).toLowerCase().includes(term) || String(p.name || '').toLowerCase().includes(term));
    }
    if (lowStockOnly) list = list.filter(p => p.availableStock <= 5);
    return list;
  },

  async createPart(data = {}, user) {
    requireStaff(user);
    const sku = String(data.sku || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40);
    if (sku.length < 3) throw createError('Mã phụ tùng (SKU) tối thiểu 3 ký tự chữ/số.', 400, 'VALIDATION_ERROR');
    if (!data.name || String(data.name).trim().length < 3) throw createError('Tên phụ tùng tối thiểu 3 ký tự.', 400, 'VALIDATION_ERROR');
    const unitPrice = Number(data.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw createError('Đơn giá phụ tùng không hợp lệ.', 400, 'VALIDATION_ERROR');
    const stock = data.stockOnHand === undefined ? 0 : Number(data.stockOnHand);
    if (!Number.isInteger(stock) || stock < 0 || stock > 100000) throw createError('Tồn kho ban đầu phải là số nguyên >= 0.', 400, 'VALIDATION_ERROR');
    const fuels = Array.isArray(data.compatibleFuels) ? data.compatibleFuels.map(f => String(f).toLowerCase()).filter(f => ALLOWED_FUELS.has(f)) : [];
    const vehicleIds = Array.isArray(data.compatibleVehicleIds) ? data.compatibleVehicleIds.map(v => Security.sanitizeString(String(v)).slice(0, 80)).filter(Boolean) : [];

    return runInTransaction(async (state) => {
      ServiceRepository.ensureInitialized(state);
      if (state.partsLedger.some(p => p.sku === sku)) throw createError(`Mã phụ tùng "${sku}" đã tồn tại.`, 409, 'DUPLICATE_PART');
      const part = {
        sku,
        name: Security.sanitizeString(String(data.name)).slice(0, 160),
        category: Security.sanitizeString(String(data.category || 'Phụ tùng chung')).slice(0, 80),
        unitPrice: Math.round(unitPrice),
        stockOnHand: stock,
        stockReserved: 0,
        compatibleFuels: fuels,
        compatibleVehicleIds: vehicleIds
      };
      state.partsLedger.push(part);
      if (stock > 0) movement(state, user, { sku, delta: stock, reason: 'Khởi tạo tồn kho' });
      audit(state, user, 'PART_CREATED', sku, `Thêm phụ tùng ${part.name} (tồn ${stock})`);
      return view(part);
    });
  },

  async restock(sku, data = {}, user) {
    requireStaff(user);
    const qty = Number(data.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10000) throw createError('Số lượng nhập kho phải là số nguyên từ 1 đến 10.000.', 400, 'VALIDATION_ERROR');
    const reason = Security.sanitizeString(String(data.reason || 'Nhập kho phụ tùng')).slice(0, 200);
    return runInTransaction(async (state) => {
      ServiceRepository.ensureInitialized(state);
      const part = state.partsLedger.find(p => p.sku === String(sku || '').trim().toUpperCase());
      if (!part) throw createError(`Không tìm thấy mã phụ tùng "${sku}".`, 404, 'PART_NOT_FOUND');
      part.stockOnHand = (part.stockOnHand || 0) + qty;
      const mv = movement(state, user, { sku: part.sku, delta: qty, reason });
      audit(state, user, 'PART_RESTOCKED', part.sku, `Nhập thêm ${qty} (${reason}); tồn mới ${part.stockOnHand}`);
      return { part: view(part), movement: mv };
    });
  }
};

module.exports = PartsService;
