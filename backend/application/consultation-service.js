// backend/application/consultation-service.js
// Persisted AI Consultation Conversations, Budget/Need Constraints & Consent-Gated Fit Context

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const Security = require('../infrastructure/security');
const VehicleRepository = require('../infrastructure/repositories/vehicle-repository');
const FinancingService = require('./financing-service');
const AIService = require('./ai-service');
const MediaService = require('./media-service');

const MAX_MESSAGE_CHARS = 2000;
const DEFAULT_IMAGE_TTL_HOURS = 24;
const ALLOWED_USAGES = new Set(['urban', 'family', 'highway', 'cargo', 'luxury']);
const ALLOWED_CHARGING = new Set(['home', 'public_only', 'none', 'unknown']);

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|above|prior)\s+instructions?/gi,
  /disregard\s+(all\s+)?(previous|system)\s+prompt/gi,
  /\bsystem\s*:\s*/gi,
  /reveal\s+(your\s+)?(api\s*key|secret|prompt)/gi,
  /grant\s+(me\s+)?(100%|free|unlimited)\s+discount/gi,
  /override\s+(price|system|policy)/gi
];

function createError(message, statusCode = 400, code = 'BAD_REQUEST') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function sanitizeUntrustedText(text) {
  let clean = Security.sanitizeString(String(text || '').slice(0, MAX_MESSAGE_CHARS));
  for (const rx of PROMPT_INJECTION_PATTERNS) {
    clean = clean.replace(rx, '[nội dung điều hướng bị lọc]');
  }
  return clean.trim();
}

function toNullableNonNegativeNumber(val, fieldName, max = 1000000000000) {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  if (!Number.isFinite(num) || num < 0 || num > max) {
    throw createError(`Giá trị "${fieldName}" không hợp lệ (phải là số >= 0).`, 422, 'INVALID_PREFERENCE');
  }
  return num;
}

function normalizePreferences(input = {}, existing = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const budgetVnd = src.budgetVnd !== undefined
    ? toNullableNonNegativeNumber(src.budgetVnd, 'budgetVnd')
    : (existing.budgetVnd ?? null);
  const monthlyBudgetVnd = src.monthlyBudgetVnd !== undefined
    ? toNullableNonNegativeNumber(src.monthlyBudgetVnd, 'monthlyBudgetVnd')
    : (existing.monthlyBudgetVnd ?? null);
  const downPaymentVnd = src.downPaymentVnd !== undefined
    ? toNullableNonNegativeNumber(src.downPaymentVnd, 'downPaymentVnd')
    : (existing.downPaymentVnd ?? null);

  let termMonths = src.termMonths !== undefined ? Number(src.termMonths) : (existing.termMonths || 60);
  if (!Number.isInteger(termMonths) || termMonths < 12 || termMonths > 120) {
    termMonths = 60;
  }

  let passengers = src.passengers !== undefined
    ? (src.passengers === null || src.passengers === '' ? null : Number(src.passengers))
    : (existing.passengers ?? null);
  if (passengers !== null && (!Number.isInteger(passengers) || passengers < 1 || passengers > 16)) {
    throw createError('Số chỗ ngồi mong muốn phải là số nguyên từ 1 đến 16.', 422, 'INVALID_PREFERENCE');
  }

  const dailyKm = src.dailyKm !== undefined
    ? toNullableNonNegativeNumber(src.dailyKm, 'dailyKm', 2000)
    : (existing.dailyKm ?? null);

  let usage = src.usage !== undefined ? String(src.usage || '').trim().toLowerCase() : (existing.usage || null);
  if (usage && !ALLOWED_USAGES.has(usage)) usage = null;

  let chargingAccess = src.chargingAccess !== undefined
    ? String(src.chargingAccess || '').trim().toLowerCase()
    : (existing.chargingAccess || 'unknown');
  if (!ALLOWED_CHARGING.has(chargingAccess)) chargingAccess = 'unknown';

  const retentionDaysRaw = src.retentionDays !== undefined ? Number(src.retentionDays) : (existing.retentionDays || 30);
  const retentionDays = Number.isFinite(retentionDaysRaw) ? Math.min(365, Math.max(1, Math.round(retentionDaysRaw))) : 30;

  return {
    budgetVnd,
    monthlyBudgetVnd,
    downPaymentVnd,
    termMonths,
    passengers,
    dailyKm,
    usage: usage || null,
    chargingAccess,
    retentionDays,
    updatedAt: new Date().toISOString()
  };
}

function parseQueryConstraints(message = '') {
  const q = String(message || '').toLowerCase();
  const parsed = {};
  const tyMatch = q.match(/(?:dưới|tối đa|ngân sách|tầm|khoảng)\s*(\d+(?:[.,]\d+)?)\s*tỷ/i);
  if (tyMatch) {
    const val = Number(tyMatch[1].replace(',', '.'));
    if (Number.isFinite(val) && val > 0) parsed.budgetVnd = Math.round(val * 1e9);
  } else {
    const trMatch = q.match(/(?:dưới|tối đa|ngân sách|tầm|khoảng)\s*(\d+(?:[.,]\d+)?)\s*(?:triệu|tr)/i);
    if (trMatch) {
      const val = Number(trMatch[1].replace(',', '.'));
      if (Number.isFinite(val) && val > 0) parsed.budgetVnd = Math.round(val * 1e6);
    }
  }
  const seatMatch = q.match(/\b([456789]|1\d)\s*chỗ\b/i);
  if (seatMatch) parsed.passengers = Number(seatMatch[1]);
  if (q.includes('xe điện') || q.includes('thuần điện') || /\bev\b/.test(q)) parsed.preferFuel = 'ev';
  else if (q.includes('xe xăng') || q.includes('động cơ xăng')) parsed.preferFuel = 'gas';
  else if (q.includes('hybrid')) parsed.preferFuel = 'hybrid';
  return parsed;
}

function parseDimensionsMeters(dimStr) {
  if (!dimStr || typeof dimStr !== 'string') return null;
  const nums = dimStr.match(/\d+(?:[.,]\d+)?/g);
  if (!nums || nums.length < 3) return null;
  const vals = nums.slice(0, 3).map(s => {
    const clean = Number(s.replace(/\./g, '').replace(',', '.'));
    return clean;
  });
  // Handle Vietnamese format "4.975 x 1.964 x 1.680 mm" -> 4.975m
  const rawDecimals = nums.slice(0, 3).map(s => Number(s.replace(',', '.')));
  const isMm = dimStr.toLowerCase().includes('mm');
  const toMeters = (idx) => {
    const dec = rawDecimals[idx];
    if (Number.isFinite(dec) && dec > 1 && dec < 12) return dec;
    const intMm = vals[idx];
    if (Number.isFinite(intMm) && intMm > 1000) return +(intMm / 1000).toFixed(3);
    if (isMm && Number.isFinite(dec) && dec > 100) return +(dec / 1000).toFixed(3);
    return null;
  };
  const lengthM = toMeters(0);
  const widthM = toMeters(1);
  const heightM = toMeters(2);
  if (!lengthM || !widthM || !heightM) return null;
  return { lengthMeters: lengthM, widthMeters: widthM, heightMeters: heightM };
}

function scoreAndConstrainVehicles(vehicles, prefs = {}, queryHints = {}) {
  const effectiveBudget = prefs.budgetVnd ?? queryHints.budgetVnd ?? null;
  const effectiveMonthlyBudget = prefs.monthlyBudgetVnd ?? null;
  const effectivePassengers = prefs.passengers ?? queryHints.passengers ?? null;
  const effectiveCharging = prefs.chargingAccess || 'unknown';
  const effectiveUsage = prefs.usage || null;
  const downPaymentVnd = prefs.downPaymentVnd ?? null;
  const termMonths = prefs.termMonths || 60;

  const activeCars = (vehicles || []).filter(v => v && !v.archived && !v.deletedAt && Number(v.price) > 0);
  const evaluated = activeCars.map(v => {
    const price = Number(v.price);
    let downPct = 30;
    if (downPaymentVnd !== null) {
      downPct = price > 0 ? Math.min(99, Math.max(0, (downPaymentVnd / price) * 100)) : 30;
    }
    let loan = null;
    try {
      loan = FinancingService.calculateLoan({
        vehiclePrice: price,
        downPaymentPercent: downPct,
        termMonths,
        repaymentMethod: 'annuity'
      });
    } catch {
      loan = null;
    }

    const fitsBudget = effectiveBudget === null || price <= effectiveBudget;
    const estimatedMonthlyVnd = loan ? loan.monthlyPayment : null;
    const fitsMonthlyBudget = effectiveMonthlyBudget === null || (estimatedMonthlyVnd !== null && estimatedMonthlyVnd <= effectiveMonthlyBudget);
    const seats = Number.isFinite(Number(v.seats)) ? Number(v.seats) : null;
    const fitsPassengers = effectivePassengers === null || (seats !== null && seats >= effectivePassengers);
    const fitsFuelPreference = !queryHints.preferFuel || v.fuel === queryHints.preferFuel;

    const missingData = [];
    if (v.dimensions == null) missingData.push('Chưa công bố kích thước phủ bì chính thức');
    if (v.range == null && v.fuel === 'ev') missingData.push('Chưa công bố tầm hoạt động tiêu chuẩn');
    if (seats == null) missingData.push('Chưa có số chỗ ngồi chuẩn');
    if (v.isUsed && v.measuredBatterySoH == null) missingData.push('Chưa có kết quả đo SoH pin thực tế');

    const reasons = [];
    let score = 0;

    if (effectiveBudget !== null) {
      if (fitsBudget) {
        score += 40;
        reasons.push(`Giá ${v.priceFormatted || (price / 1e9).toFixed(2) + ' tỷ'} nằm trong ngân sách tối đa ${(effectiveBudget / 1e9).toFixed(2)} tỷ VNĐ`);
      } else {
        score -= 100;
      }
    }
    if (effectiveMonthlyBudget !== null) {
      if (fitsMonthlyBudget) {
        score += 30;
        reasons.push(`Trả góp ước tính ~${Math.round(estimatedMonthlyVnd / 1e6)} tr/tháng (kỳ hạn ${termMonths} tháng) trong hạn mức`);
      } else {
        score -= 100;
      }
    }
    if (effectivePassengers !== null) {
      if (fitsPassengers) {
        score += 25;
        reasons.push(`Đáp ứng ${seats} chỗ ngồi (>= ${effectivePassengers} chỗ yêu cầu)`);
      } else {
        score -= 80;
      }
    }
    if (effectiveCharging === 'none' && v.fuel === 'ev') {
      score -= 25;
      missingData.push('Bạn chưa có nguồn sạc tại nhà: cần kiểm tra trạm sạc công cộng quanh khu vực sinh sống');
    } else if (effectiveCharging === 'home' && v.fuel === 'ev') {
      score += 15;
      reasons.push('Phù hợp sạc điện thuận tiện tại nhà');
    }
    if (effectiveUsage === 'urban' && (v.category === 'Hatchback' || v.category === 'Compact' || v.category === 'Sedan' || v.category === 'SUV')) {
      score += 10;
    } else if (effectiveUsage === 'family' && seats !== null && seats >= 5) {
      score += 12;
      reasons.push(`Cấu hình ${seats} chỗ phù hợp di chuyển gia đình`);
    } else if (effectiveUsage === 'highway' && Number(v.range) >= 450) {
      score += 12;
      reasons.push(`Tầm hoạt động ${v.range} km phù hợp đi đường trường`);
    } else if (effectiveUsage === 'cargo' && (v.category === 'Truck' || v.category === 'MPV' || v.category === 'SUV')) {
      score += 12;
    }
    if (queryHints.preferFuel && v.fuel === queryHints.preferFuel) {
      score += 20;
    }
    if (Number(v.stockQuantity ?? v.stock ?? 0) > 0) score += 5;

    return {
      carId: v.id,
      name: v.name,
      brand: v.brand || 'Chưa cập nhật',
      category: v.category || 'Chưa phân loại',
      fuel: v.fuel || null,
      price,
      priceFormatted: v.priceFormatted || `${(price / 1e9).toFixed(3)} tỷ VNĐ`,
      seats,
      range: Number(v.range) > 0 ? `${v.range} km` : null,
      stock: typeof v.stockQuantity === 'number' ? v.stockQuantity : (typeof v.stock === 'number' ? v.stock : 0),
      estimatedMonthlyVnd,
      fitsBudget,
      fitsMonthlyBudget,
      fitsPassengers,
      fitsFuelPreference,
      score,
      reasons,
      missingData
    };
  });

  const strictMatches = evaluated
    .filter(item => item.fitsBudget && item.fitsMonthlyBudget && item.fitsPassengers && item.fitsFuelPreference)
    .sort((a, b) => b.score - a.score || a.price - b.price)
    .slice(0, 3);

  const flaggedAlternatives = strictMatches.length === 0
    ? evaluated
        .filter(item => item.fitsPassengers)
        .sort((a, b) => Math.abs((a.price || 0) - (effectiveBudget || a.price || 0)) - Math.abs((b.price || 0) - (effectiveBudget || b.price || 0)))
        .slice(0, 2)
        .map(item => ({
          ...item,
          exceedsBudget: !item.fitsBudget || !item.fitsMonthlyBudget,
          warning: !item.fitsBudget
            ? 'Vượt ngân sách mục tiêu đã đặt — chỉ mang tính tham khảo'
            : (!item.fitsMonthlyBudget ? 'Khoản trả góp ước tính vượt hạn mức hàng tháng' : 'Cần cân nhắc lại tiêu chí nhiên liệu')
        }))
    : [];

  return {
    constraintsApplied: {
      budgetVnd: effectiveBudget,
      monthlyBudgetVnd: effectiveMonthlyBudget,
      passengers: effectivePassengers,
      dailyKm: prefs.dailyKm ?? null,
      usage: effectiveUsage,
      chargingAccess: effectiveCharging
    },
    top3: strictMatches,
    flaggedAlternatives
  };
}

const ConsultationService = {
  scoreAndConstrainVehicles,
  parseDimensionsMeters,
  sanitizeUntrustedText,

  getPreferences(user) {
    if (!user || !user.userId) {
      throw createError('Vui lòng đăng nhập để xem hồ sơ nhu cầu tư vấn.', 401, 'UNAUTHORIZED');
    }
    const existing = (dbState.aiPreferences || []).find(p => p.userId === user.userId);
    if (existing) return existing;
    return {
      userId: user.userId,
      budgetVnd: null,
      monthlyBudgetVnd: null,
      downPaymentVnd: null,
      termMonths: 60,
      passengers: null,
      dailyKm: null,
      usage: null,
      chargingAccess: 'unknown',
      retentionDays: 30,
      imageConsentRevokedAt: null
    };
  },

  async updatePreferences(user, payload = {}) {
    if (!user || !user.userId) {
      throw createError('Vui lòng đăng nhập để lưu hồ sơ nhu cầu tư vấn.', 401, 'UNAUTHORIZED');
    }
    const revokeConsent = payload.revokeImageConsent === true;
    const saved = await runInTransaction(async (state) => {
      if (!Array.isArray(state.aiPreferences)) state.aiPreferences = [];
      let existing = state.aiPreferences.find(p => p.userId === user.userId);
      const normalized = normalizePreferences(payload, existing || {});
      if (!existing) {
        existing = {
          userId: user.userId,
          ...normalized,
          imageConsentRevokedAt: revokeConsent ? new Date().toISOString() : null,
          createdAt: new Date().toISOString()
        };
        state.aiPreferences.push(existing);
      } else {
        Object.assign(existing, normalized);
        if (revokeConsent) existing.imageConsentRevokedAt = new Date().toISOString();
      }
      if (revokeConsent && Array.isArray(state.mediaAssets)) {
        const nowIso = new Date().toISOString();
        state.mediaAssets.forEach(asset => {
          if (asset.ownerId === user.userId && asset.purpose === 'consultation' && !asset.deletedAt) {
            asset.expiresAt = nowIso;
          }
        });
      }
      return { ...existing };
    });

    if (revokeConsent) {
      await MediaService.purgeExpiredMedia({ nowMs: Date.now() + 1000 });
    }
    return saved;
  },

  listConversations(user, { limit = 20, offset = 0 } = {}) {
    if (!user || !user.userId) {
      throw createError('Vui lòng đăng nhập để xem lịch sử tư vấn.', 401, 'UNAUTHORIZED');
    }
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const owned = (dbState.aiConversations || [])
      .filter(c => c.ownerId === user.userId && !c.deletedAt)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

    const slice = owned.slice(safeOffset, safeOffset + safeLimit).map(c => ({
      id: c.id,
      title: c.title,
      messageCount: Array.isArray(c.messages) ? c.messages.length : 0,
      hasAttachments: Array.isArray(c.mediaIds) && c.mediaIds.length > 0,
      constraintsSnapshot: c.constraintsSnapshot || null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
    }));
    return { items: slice, total: owned.length, limit: safeLimit, offset: safeOffset };
  },

  async createConversation(user, { title = 'Phiên tư vấn chọn xe', preferences = null } = {}) {
    if (!user || !user.userId) {
      throw createError('Vui lòng đăng nhập để tạo phiên tư vấn.', 401, 'UNAUTHORIZED');
    }
    const cleanTitle = Security.sanitizeString(String(title || 'Phiên tư vấn chọn xe')).slice(0, 120) || 'Phiên tư vấn chọn xe';
    let userPrefs = this.getPreferences(user);
    if (preferences && typeof preferences === 'object') {
      userPrefs = await this.updatePreferences(user, preferences);
    }

    return runInTransaction(async (state) => {
      if (!Array.isArray(state.aiConversations)) state.aiConversations = [];
      const now = new Date().toISOString();
      const conv = {
        id: `AICONV-${crypto.randomUUID().slice(0, 10)}`,
        ownerId: user.userId,
        title: cleanTitle,
        constraintsSnapshot: userPrefs,
        messages: [],
        mediaIds: [],
        deletedAt: null,
        createdAt: now,
        updatedAt: now
      };
      state.aiConversations.unshift(conv);
      return { ...conv };
    });
  },

  getConversationMessages(user, conversationId, { limit = 50, offset = 0 } = {}) {
    if (!user || !user.userId) {
      throw createError('Vui lòng đăng nhập để đọc hội thoại.', 401, 'UNAUTHORIZED');
    }
    const conv = (dbState.aiConversations || []).find(c => c.id === conversationId && !c.deletedAt);
    if (!conv) {
      throw createError('Không tìm thấy phiên tư vấn hoặc phiên đã bị xóa.', 404, 'CONVERSATION_NOT_FOUND');
    }
    if (conv.ownerId !== user.userId) {
      throw createError('Bạn không có quyền truy cập lịch sử tư vấn của người dùng khác.', 403, 'FORBIDDEN');
    }
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const allMsgs = Array.isArray(conv.messages) ? conv.messages : [];
    const items = allMsgs.slice(safeOffset, safeOffset + safeLimit);
    return {
      conversation: {
        id: conv.id,
        title: conv.title,
        constraintsSnapshot: conv.constraintsSnapshot || null,
        mediaIds: conv.mediaIds || [],
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt
      },
      messages: items,
      total: allMsgs.length,
      limit: safeLimit,
      offset: safeOffset
    };
  },

  async deleteConversation(user, conversationId) {
    if (!user || !user.userId) {
      throw createError('Vui lòng đăng nhập để xóa phiên tư vấn.', 401, 'UNAUTHORIZED');
    }
    const deletedInfo = await runInTransaction(async (state) => {
      const conv = (state.aiConversations || []).find(c => c.id === conversationId && !c.deletedAt);
      if (!conv) {
        throw createError('Không tìm thấy phiên tư vấn để xóa.', 404, 'CONVERSATION_NOT_FOUND');
      }
      if (conv.ownerId !== user.userId) {
        throw createError('Bạn không có quyền xóa phiên tư vấn của người dùng khác.', 403, 'FORBIDDEN');
      }
      const nowIso = new Date().toISOString();
      conv.deletedAt = nowIso;
      conv.messages = [];
      const linkedMediaIds = Array.isArray(conv.mediaIds) ? [...conv.mediaIds] : [];
      if (Array.isArray(state.mediaAssets) && linkedMediaIds.length > 0) {
        state.mediaAssets.forEach(asset => {
          if (linkedMediaIds.includes(asset.id) && asset.ownerId === user.userId && !asset.deletedAt) {
            asset.expiresAt = nowIso;
          }
        });
      }
      return { id: conv.id, deletedAt: nowIso, expiredMediaIds: linkedMediaIds };
    });

    await MediaService.purgeExpiredMedia({ nowMs: Date.now() + 1000 });
    return { deleted: true, ...deletedInfo };
  },

  evaluateFitContext({ measuredSpaceDimensions = null, vehicles = [] } = {}) {
    if (!measuredSpaceDimensions || typeof measuredSpaceDimensions !== 'object') {
      return {
        evaluated: false,
        measurementLimited: true,
        disclaimer: 'Đánh giá không gian từ ảnh chỉ mang tính ước lượng trực quan (qualitative), không thay thế đo đạc thực tế tại vị trí đỗ.'
      };
    }
    const L = toNullableNonNegativeNumber(measuredSpaceDimensions.lengthMeters, 'lengthMeters', 50);
    const W = toNullableNonNegativeNumber(measuredSpaceDimensions.widthMeters, 'widthMeters', 50);
    const H = toNullableNonNegativeNumber(measuredSpaceDimensions.heightMeters, 'heightMeters', 20);
    if (!L && !W && !H) {
      return {
        evaluated: false,
        measurementLimited: true,
        disclaimer: 'Chưa có kích thước đo thực tế; chỉ có thể nhận xét định tính.'
      };
    }

    const comparisons = (vehicles || []).map(v => {
      const dims = parseDimensionsMeters(v.dimensions);
      if (!dims) {
        return {
          carId: v.id,
          name: v.name,
          status: 'dimensions_unavailable',
          reason: 'Chưa công bố kích thước D x R x C chuẩn trong dữ liệu hệ thống.'
        };
      }
      const clearanceW = W ? +(W - dims.widthMeters).toFixed(2) : null;
      const clearanceL = L ? +(L - dims.lengthMeters).toFixed(2) : null;
      const clearanceH = H ? +(H - dims.heightMeters).toFixed(2) : null;
      const fits = (clearanceW === null || clearanceW >= 0.4) &&
                   (clearanceL === null || clearanceL >= 0.3) &&
                   (clearanceH === null || clearanceH >= 0.15);
      return {
        carId: v.id,
        name: v.name,
        vehicleDimensionsMeters: dims,
        clearanceMeters: { length: clearanceL, width: clearanceW, height: clearanceH },
        status: fits ? 'likely_fits_measured' : 'tight_or_exceeds',
        reason: fits
          ? `Đủ khoảng hở cơ bản theo số đo bạn cung cấp (dư rộng ${clearanceW ?? '?'}m, dư dài ${clearanceL ?? '?'}m)`
          : 'Không gian đo được khá chật hoặc chưa đủ khoảng mở cửa tối thiểu (+0.4m chiều rộng).'
      };
    });

    return {
      evaluated: true,
      measuredSpaceDimensions: { lengthMeters: L, widthMeters: W, heightMeters: H },
      comparisons,
      measurementLimited: true,
      disclaimer: 'Kết quả đối chiếu dựa trên số đo người dùng tự cung cấp và kích thước niêm yết (không suy luận từ ảnh); luôn cần đo thực tế trước khi nhận xe.'
    };
  },

  async chatInConsultation({
    user,
    conversationId = null,
    message = '',
    preferences = null,
    image = null,
    imageConsent = false,
    measuredSpaceDimensions = null,
    retentionHours = DEFAULT_IMAGE_TTL_HOURS
  } = {}) {
    if (!user || !user.userId) {
      throw createError('Vui lòng đăng nhập để sử dụng phiên tư vấn có lưu trữ.', 401, 'UNAUTHORIZED');
    }

    const sanitizedPrompt = sanitizeUntrustedText(message);
    if (!sanitizedPrompt && !image && !measuredSpaceDimensions) {
      throw createError('Vui lòng nhập câu hỏi hoặc thông tin nhu cầu cần tư vấn.', 422, 'EMPTY_MESSAGE');
    }

    let userPrefs = this.getPreferences(user);
    if (preferences && typeof preferences === 'object') {
      userPrefs = await this.updatePreferences(user, preferences);
    }

    let conv = null;
    if (conversationId) {
      conv = (dbState.aiConversations || []).find(c => c.id === conversationId && !c.deletedAt);
      if (!conv) throw createError('Không tìm thấy phiên tư vấn.', 404, 'CONVERSATION_NOT_FOUND');
      if (conv.ownerId !== user.userId) {
        throw createError('Bạn không có quyền ghi vào phiên tư vấn của người dùng khác.', 403, 'FORBIDDEN');
      }
    } else {
      conv = await this.createConversation(user, {
        title: sanitizedPrompt ? sanitizedPrompt.slice(0, 60) : 'Tư vấn chọn xe & không gian đỗ'
      });
    }

    let uploadedMedia = null;
    if (image) {
      if (imageConsent !== true) {
        throw createError(
          'Cần xác nhận đồng ý rõ ràng (imageConsent: true) trước khi tải ảnh bãi đỗ/không gian và phân tích.',
          422,
          'CONSENT_REQUIRED'
        );
      }
      const uploadRes = await MediaService.uploadPrivateMedia(user, {
        fileName: image.fileName || 'parking-space.jpg',
        mimeType: image.mimeType || 'image/jpeg',
        dataBase64: image.dataBase64,
        purpose: 'consultation',
        linkedEntityId: conv.id,
        retentionDays: 1
      });
      if (uploadRes.rejected) {
        throw createError(`Tệp ảnh bị từ chối hoặc cách ly: ${uploadRes.message || 'Nội dung không an toàn'}`, 422, 'MEDIA_QUARANTINED');
      }
      const hours = Math.min(168, Math.max(1, Number(retentionHours) || DEFAULT_IMAGE_TTL_HOURS));
      const ttlIso = new Date(Date.now() + hours * 3600000).toISOString();
      await runInTransaction(async (state) => {
        const asset = (state.mediaAssets || []).find(m => m.id === uploadRes.id);
        if (asset) asset.expiresAt = ttlIso;
      });
      uploadedMedia = {
        mediaId: uploadRes.id,
        signedUrl: uploadRes.signedUrl,
        expiresAt: ttlIso,
        purpose: 'consultation',
        exifStripped: true
      };
    }

    const allVehicles = await VehicleRepository.findAll();
    const queryHints = parseQueryConstraints(sanitizedPrompt);
    const recommendationResult = scoreAndConstrainVehicles(allVehicles, userPrefs, queryHints);

    const candidateVehicles = recommendationResult.top3.length > 0
      ? recommendationResult.top3.map(r => allVehicles.find(v => v.id === r.carId)).filter(Boolean)
      : allVehicles.slice(0, 3);
    const fitContext = this.evaluateFitContext({ measuredSpaceDimensions, vehicles: candidateVehicles });

    let aiReplyText = '';
    const existingHistory = (conv.messages || []).slice(-10).map(m => ({ role: m.role, text: m.text }));
    const isAutoPrompt = !sanitizedPrompt || AIService._isAutomotiveQuery(sanitizedPrompt) || Boolean(queryHints.budgetVnd || queryHints.passengers);
    const hasActiveConstraint = Boolean(
      (isAutoPrompt && (
        recommendationResult.constraintsApplied.budgetVnd ||
        recommendationResult.constraintsApplied.monthlyBudgetVnd ||
        recommendationResult.constraintsApplied.passengers ||
        recommendationResult.constraintsApplied.usage ||
        recommendationResult.constraintsApplied.chargingAccess !== 'unknown'
      )) ||
      image ||
      measuredSpaceDimensions
    );

    if (hasActiveConstraint) {
      const lines = [];
      if (recommendationResult.top3.length > 0) {
        lines.push(`Dựa trên tiêu chí thực tế trên kho SIGMACAR, Top ${recommendationResult.top3.length} mẫu xe phù hợp nhất:`);
        recommendationResult.top3.forEach((car, idx) => {
          const reasonStr = car.reasons.length ? car.reasons.join('; ') : 'Phù hợp tiêu chí lọc cơ bản';
          const missingStr = car.missingData.length ? ` (Lưu ý thiếu dữ liệu: ${car.missingData.join(', ')})` : '';
          lines.push(`${idx + 1}. **${car.name}** — ${car.priceFormatted}${car.estimatedMonthlyVnd ? ` (~${(car.estimatedMonthlyVnd / 1e6).toFixed(1)} tr/tháng)` : ''}: ${reasonStr}${missingStr}`);
        });
      } else {
        lines.push('Hiện không có mẫu xe nào trong kho đáp ứng đồng thời toàn bộ ràng buộc ngân sách / số chỗ hiện tại.');
        if (recommendationResult.flaggedAlternatives.length > 0) {
          lines.push('Phương án tham khảo gần nhất (đã gắn cờ vượt/khác điều kiện):');
          recommendationResult.flaggedAlternatives.forEach(alt => {
            lines.push(`- **${alt.name}** (${alt.priceFormatted}): ${alt.warning}`);
          });
        }
      }
      if (uploadedMedia) {
        lines.push(`\n📷 **Ảnh không gian đã được lưu riêng tư có thời hạn** (tự động xóa sau ${Math.min(168, Math.max(1, Number(retentionHours) || DEFAULT_IMAGE_TTL_HOURS))} giờ, EXIF đã được lược bỏ). ${fitContext.disclaimer}`);
      }
      if (fitContext.evaluated && fitContext.comparisons) {
        lines.push('\n📏 **Đối chiếu kích thước tự đo:**');
        fitContext.comparisons.forEach(c => lines.push(`- **${c.name}**: ${c.reason}`));
      }
      aiReplyText = lines.join('\n');
    } else {
      const baseRes = await AIService.chat({
        message: sanitizedPrompt,
        history: existingHistory,
        currentUser: user
      });
      aiReplyText = baseRes.text || '';
    }

    const nowIso = new Date().toISOString();
    const userMsg = {
      id: `AIMSG-${crypto.randomUUID().slice(0, 8)}`,
      role: 'user',
      text: sanitizedPrompt || '[Gửi ảnh không gian / tiêu chí tư vấn]',
      mediaId: uploadedMedia ? uploadedMedia.mediaId : null,
      createdAt: nowIso
    };
    const assistantMsg = {
      id: `AIMSG-${crypto.randomUUID().slice(0, 8)}`,
      role: 'assistant',
      text: aiReplyText,
      top3: recommendationResult.top3,
      flaggedAlternatives: recommendationResult.flaggedAlternatives,
      fitContext,
      createdAt: new Date(Date.now() + 1).toISOString()
    };

    const updatedConv = await runInTransaction(async (state) => {
      const stored = (state.aiConversations || []).find(c => c.id === conv.id && !c.deletedAt);
      if (!stored) throw createError('Phiên tư vấn không còn tồn tại.', 404, 'CONVERSATION_NOT_FOUND');
      if (!Array.isArray(stored.messages)) stored.messages = [];
      if (!Array.isArray(stored.mediaIds)) stored.mediaIds = [];
      stored.messages.push(userMsg, assistantMsg);
      if (uploadedMedia) stored.mediaIds.push(uploadedMedia.mediaId);
      stored.constraintsSnapshot = userPrefs;
      stored.updatedAt = assistantMsg.createdAt;
      return { ...stored };
    });

    return {
      conversationId: updatedConv.id,
      userMessage: userMsg,
      assistantMessage: assistantMsg,
      constraintsApplied: recommendationResult.constraintsApplied,
      top3: recommendationResult.top3,
      flaggedAlternatives: recommendationResult.flaggedAlternatives,
      uploadedMedia,
      fitContext,
      retentionPolicy: 'Ảnh tư vấn lưu trữ riêng tư có TTL tự động hết hạn và bị xóa ngay khi người dùng xóa phiên tư vấn hoặc thu hồi đồng ý.'
    };
  }
};

module.exports = ConsultationService;
