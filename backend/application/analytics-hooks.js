// backend/application/analytics-hooks.js
// Server-side funnel instrumentation (PLAN.md T4.9). Called INSIDE an existing runInTransaction callback right after
// the business write, so it adds no extra D1 query (the store commits the whole state batch once).
// Events are marked source: 'server' and are deduplicated per business object (one test_drive per appointment, one
// checkout per order, ...). It never throws: analytics must not break a booking, checkout, payment or handover.

const crypto = require('crypto');

const SERVER_EVENTS = new Set(['test_drive', 'checkout', 'order_paid', 'handover']);
const MAX_EVENTS = 5000; // same cap as AnalyticsEventService.recordEvent

function cohortDate(isoTs, tzOffsetMinutes = 420) {
  const ms = Date.parse(isoTs) || Date.now();
  return new Date(ms + tzOffsetMinutes * 60000).toISOString().slice(0, 10);
}

/**
 * @param {object} state  transaction state passed to runInTransaction
 * @param {{type: string, aggregateId: string, userId?: string, targetId?: string, branchId?: string, promoCode?: string, isDemo?: boolean}} evt
 */
function trackInState(state, evt = {}) {
  try {
    if (!state || !evt || !SERVER_EVENTS.has(evt.type) || !evt.aggregateId) return null;
    if (!Array.isArray(state.analyticsEvents)) state.analyticsEvents = [];
    const dedupeKey = `server:${evt.type}:${evt.aggregateId}`;
    if (state.analyticsEvents.some(e => e.dedupeKey === dedupeKey)) return null;
    const nowIso = new Date().toISOString();
    const record = {
      id: `EVT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      sessionId: evt.userId ? String(evt.userId).slice(0, 64) : 'server',
      userId: evt.userId || null,
      eventType: evt.type,
      targetId: evt.targetId ? String(evt.targetId).slice(0, 64) : null,
      branchId: evt.branchId ? String(evt.branchId).slice(0, 48) : null,
      promoCode: evt.promoCode ? String(evt.promoCode).toUpperCase().slice(0, 32) : null,
      aggregateId: String(evt.aggregateId).slice(0, 80),
      source: 'server',
      dedupeKey,
      consentGranted: true,
      cohortDate: cohortDate(nowIso),
      createdAt: nowIso,
      ...(evt.isDemo ? { isDemo: true } : {})
    };
    state.analyticsEvents.unshift(record);
    if (state.analyticsEvents.length > MAX_EVENTS) state.analyticsEvents.length = MAX_EVENTS;
    return record;
  } catch (e) {
    return null;
  }
}

module.exports = { trackInState, SERVER_EVENTS };
