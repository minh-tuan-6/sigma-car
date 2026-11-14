// backend/application/garage-extras-service.js
// My Garage extras (PLAN.md T2.7): owner-scoped saved TCO results and saved AI recommendations.
// Stored as two new document collections (savedTcoResults, savedRecommendations); the D1 state store persists any
// array collection without a schema change. Only whitelisted, sanitised fields are stored.

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const Security = require('../infrastructure/security');

const MAX_PER_USER = 20;
const KINDS = {
  'tco-results': 'savedTcoResults',
  recommendations: 'savedRecommendations'
};

function createError(message, statusCode = 400, code = 'GARAGE_EXTRAS_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

const str = (v, max = 200) => (v === undefined || v === null ? null : Security.sanitizeString(String(v)).slice(0, max));
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

function findVehicle(id) {
  if (!id) return null;
  return (dbState.vehicles || []).find(v => v.id === id) || (dbState.certifiedVehicles || []).find(v => v.id === id) || null;
}

function requireUser(user) {
  if (!user || !user.userId) throw createError('Vui lòng đăng nhập để dùng Gara của tôi.', 401, 'UNAUTHORIZED');
}

function collectionFor(kind) {
  const name = KINDS[kind];
  if (!name) throw createError('Loại dữ liệu Gara không hợp lệ.', 404, 'NOT_FOUND');
  return name;
}

function sanitizeCarSummary(c) {
  if (!c || typeof c !== 'object') return null;
  const v = findVehicle(c.vehicleId);
  if (!v) return null;
  return {
    vehicleId: v.id,
    vehicleName: v.name,
    fuelType: str(c.fuelType, 20),
    monthlyEnergy: num(c.monthlyEnergy),
    annualOperating: num(c.annualOperating),
    fiveYearTotal: num(c.fiveYearTotal)
  };
}

function buildTcoRecord(payload) {
  const carA = sanitizeCarSummary(payload.carA);
  const carB = sanitizeCarSummary(payload.carB);
  if (!carA) throw createError('Kết quả TCO cần ít nhất một mẫu xe hợp lệ (carA.vehicleId).', 422, 'VALIDATION_ERROR');
  return {
    title: str(payload.title, 120) || `So sánh ${carA.vehicleName}${carB ? ` vs ${carB.vehicleName}` : ''}`,
    region: str(payload.region, 30),
    monthlyKm: num(payload.monthlyKm),
    carA,
    carB,
    fiveYearSavings: num(payload.fiveYearSavings),
    formulaVersion: str(payload.formulaVersion, 40)
  };
}

function buildRecommendationRecord(payload) {
  const v = findVehicle(payload.vehicleId);
  if (!v) throw createError('Mẫu xe được gợi ý không tồn tại trong danh mục.', 422, 'VALIDATION_ERROR');
  const reasons = Array.isArray(payload.reasons) ? payload.reasons.slice(0, 6).map(r => str(r, 300)).filter(Boolean) : [];
  return {
    vehicleId: v.id,
    vehicleName: v.name,
    score: num(payload.score),
    reasons,
    query: str(payload.query, 300),
    conversationId: str(payload.conversationId, 80)
  };
}

const GarageExtrasService = {
  KINDS: Object.keys(KINDS),

  list(user, kind) {
    requireUser(user);
    const name = collectionFor(kind);
    return (dbState[name] || [])
      .filter(r => r.userId === user.userId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  },

  async save(user, kind, payload = {}) {
    requireUser(user);
    const name = collectionFor(kind);
    const body = payload && typeof payload === 'object' ? payload : {};
    const fields = kind === 'tco-results' ? buildTcoRecord(body) : buildRecommendationRecord(body);
    return runInTransaction(async (state) => {
      if (!Array.isArray(state[name])) state[name] = [];
      const mine = state[name].filter(r => r.userId === user.userId);
      if (mine.length >= MAX_PER_USER) {
        throw createError(`Gara chỉ lưu tối đa ${MAX_PER_USER} mục mỗi loại. Vui lòng xóa bớt mục cũ.`, 409, 'GARAGE_LIMIT_REACHED');
      }
      const record = {
        id: `${kind === 'tco-results' ? 'TCO' : 'REC'}-${crypto.randomUUID().slice(0, 12)}`,
        userId: user.userId,
        ...fields,
        createdAt: new Date().toISOString()
      };
      state[name].push(record);
      return record;
    });
  },

  async remove(user, kind, id) {
    requireUser(user);
    const name = collectionFor(kind);
    return runInTransaction(async (state) => {
      const list = Array.isArray(state[name]) ? state[name] : [];
      const idx = list.findIndex(r => r.id === id && r.userId === user.userId);
      // Another user's record answers exactly like a missing one (no ownership oracle).
      if (idx === -1) throw createError('Không tìm thấy mục đã lưu.', 404, 'NOT_FOUND');
      const [removed] = list.splice(idx, 1);
      return { id: removed.id, deleted: true };
    });
  }
};

module.exports = GarageExtrasService;
