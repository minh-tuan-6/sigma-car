// backend/application/analytics-event-service.js
// Consent-Aware Analytics Event Ingestion, Session Deduplication & Promotion Attribution (SIG-P4-007)

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const Security = require('../infrastructure/security');
const { ROLES } = require('../domain/constants');

const VALID_FUNNEL_EVENTS = new Set([
  'vehicle_view',
  'test_drive',
  'quote',
  'checkout',
  'order_paid',
  'handover'
]);

const ESSENTIAL_OPERATIONAL_EVENTS = new Set(['checkout', 'order_paid', 'handover']);

function createError(message, statusCode = 400, code = 'ANALYTICS_EVENT_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function getCohortDateStr(isoTs, tzOffsetMinutes = 420) {
  const ms = Date.parse(isoTs) || Date.now();
  const localMs = ms + Number(tzOffsetMinutes || 420) * 60000;
  return new Date(localMs).toISOString().slice(0, 10);
}

const AnalyticsEventService = {
  async recordEvent({
    user = null,
    sessionId,
    eventType,
    targetId = null,
    branchId = null,
    promoCode = null,
    consentGranted = true,
    tzOffsetMinutes = 420,
    nowIso = new Date().toISOString()
  } = {}) {
    const cleanType = String(eventType || '').trim().toLowerCase();
    if (!VALID_FUNNEL_EVENTS.has(cleanType)) {
      throw createError(`Loại sự kiện funnel "${eventType}" không hợp lệ.`, 422, 'INVALID_EVENT_TYPE');
    }

    const isEssential = ESSENTIAL_OPERATIONAL_EVENTS.has(cleanType);
    const hasOptOut = consentGranted === false || (user && user.trackingConsent === false);
    if (!isEssential && hasOptOut) {
      return { recorded: false, skippedReason: 'OPT_OUT_NON_ESSENTIAL', eventType: cleanType };
    }

    const cleanSession = Security.sanitizeString(String(sessionId || (user && user.userId) || 'anon').trim()).slice(0, 64);
    const cleanTarget = targetId ? Security.sanitizeString(String(targetId).trim()).slice(0, 64) : null;
    const cleanBranch = branchId ? Security.sanitizeString(String(branchId).trim()).slice(0, 48) : null;
    const cleanPromo = promoCode ? Security.sanitizeString(String(promoCode).trim().toUpperCase()).slice(0, 32) : null;
    const cohortDate = getCohortDateStr(nowIso, tzOffsetMinutes);

    // Deterministic dedupe key per session + eventType + targetId + day cohort so refresh/retry does not inflate conversions
    const dedupeKey = `${cleanSession}:${cleanType}:${cleanTarget || 'none'}:${cohortDate}`;

    return runInTransaction(async (state) => {
      if (!Array.isArray(state.analyticsEvents)) state.analyticsEvents = [];
      const existing = state.analyticsEvents.find(e => e.dedupeKey === dedupeKey);
      if (existing) {
        return { recorded: false, deduplicated: true, event: existing };
      }

      const evt = {
        id: `EVT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        sessionId: cleanSession,
        userId: user ? user.userId : null,
        eventType: cleanType,
        targetId: cleanTarget,
        branchId: cleanBranch,
        promoCode: cleanPromo,
        dedupeKey,
        consentGranted: !hasOptOut,
        cohortDate,
        createdAt: nowIso
      };
      state.analyticsEvents.unshift(evt);
      if (state.analyticsEvents.length > 5000) state.analyticsEvents.length = 5000;
      return { recorded: true, deduplicated: false, event: evt };
    });
  },

  getFunnelMetrics(user, { dateFrom = null, dateTo = null, branchId = null, promoCode = null } = {}) {
    if (!user || ![ROLES.ADMIN, ROLES.SELLER].includes(user.role)) {
      throw createError('Không có quyền xem báo cáo phễu chuyển đổi.', 403, 'FORBIDDEN');
    }

    const isSeller = user.role !== ROLES.ADMIN;
    const allowedBranches = Array.isArray(user.branchIds) && user.branchIds.length > 0
      ? user.branchIds.filter(Boolean)
      : (user.branchId && user.branchId !== 'all' ? [user.branchId] : []);

    if (branchId && branchId !== 'all' && isSeller && !allowedBranches.includes(branchId)) {
      throw createError('Bạn không có quyền truy cập phễu chuyển đổi của chi nhánh khác.', 403, 'BRANCH_SCOPE_DENIED');
    }

    let events = Array.isArray(dbState.analyticsEvents) ? [...dbState.analyticsEvents] : [];
    if (isSeller) {
      events = allowedBranches.length > 0
        ? events.filter(e => e.branchId && allowedBranches.includes(e.branchId))
        : [];
    } else if (branchId && branchId !== 'all') {
      events = events.filter(e => e.branchId === branchId);
    }

    if (dateFrom) {
      const fromStr = String(dateFrom).slice(0, 10);
      events = events.filter(e => (e.cohortDate || (e.createdAt || '').slice(0, 10)) >= fromStr);
    }
    if (dateTo) {
      const toStr = String(dateTo).slice(0, 10);
      events = events.filter(e => (e.cohortDate || (e.createdAt || '').slice(0, 10)) <= toStr);
    }
    if (promoCode) {
      const cleanPromo = String(promoCode).trim().toUpperCase();
      events = events.filter(e => e.promoCode === cleanPromo);
    }

    const counts = {
      vehicle_view: 0,
      test_drive: 0,
      quote: 0,
      checkout: 0,
      order_paid: 0,
      handover: 0
    };
    const promoBreakdown = {};
    for (const evt of events) {
      if (counts[evt.eventType] !== undefined) counts[evt.eventType]++;
      if (evt.promoCode) {
        if (!promoBreakdown[evt.promoCode]) {
          promoBreakdown[evt.promoCode] = { promoCode: evt.promoCode, quotes: 0, checkouts: 0, paidOrders: 0 };
        }
        if (evt.eventType === 'quote') promoBreakdown[evt.promoCode].quotes++;
        if (evt.eventType === 'checkout') promoBreakdown[evt.promoCode].checkouts++;
        if (evt.eventType === 'order_paid') promoBreakdown[evt.promoCode].paidOrders++;
      }
    }

    const viewToTestDriveRate = counts.vehicle_view > 0
      ? Number(((counts.test_drive / counts.vehicle_view) * 100).toFixed(1))
      : 0;
    const quoteToCheckoutRate = counts.quote > 0
      ? Number(((counts.checkout / counts.quote) * 100).toFixed(1))
      : 0;
    const checkoutToHandoverRate = counts.checkout > 0
      ? Number(((counts.handover / counts.checkout) * 100).toFixed(1))
      : 0;

    return {
      scope: { branchId: branchId || (isSeller ? allowedBranches.join(',') : 'all'), dateFrom: dateFrom || null, dateTo: dateTo || null },
      counts,
      rates: {
        viewToTestDriveRate,
        quoteToCheckoutRate,
        checkoutToHandoverRate
      },
      promoAttribution: Object.values(promoBreakdown)
    };
  }
};

module.exports = AnalyticsEventService;
