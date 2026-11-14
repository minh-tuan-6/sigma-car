// backend/application/audit-log-service.js
// Read-only audit log viewer (PLAN.md T4.11). Merges the general auditLogs collection (orders/returns/reviews,
// media, policies, warranty claims, parts, role changes) with cmsAuditLogs. Admin only (enforced by the route).

const { dbState } = require('../infrastructure/storage-engine');

const MAX_LIMIT = 200;

function normalize(entry, source) {
  return {
    id: entry.id,
    source,
    action: entry.action || null,
    actorId: entry.actorId || 'system',
    actorName: entry.actorName || null,
    actorRole: entry.actorRole || null,
    targetId: entry.targetId || entry.contentId || null,
    detail: entry.detail || '',
    timestamp: entry.timestamp || entry.createdAt || null
  };
}

const AuditLogService = {
  list({ action, actorId, targetId, source, q, dateFrom, dateTo, limit, offset } = {}) {
    let rows = [
      ...(Array.isArray(dbState.auditLogs) ? dbState.auditLogs : []).map(e => normalize(e, 'system')),
      ...(Array.isArray(dbState.cmsAuditLogs) ? dbState.cmsAuditLogs : []).map(e => normalize(e, 'cms'))
    ];
    if (source && source !== 'all') rows = rows.filter(r => r.source === source);
    if (action) rows = rows.filter(r => String(r.action || '').toUpperCase() === String(action).toUpperCase());
    if (actorId) rows = rows.filter(r => r.actorId === actorId);
    if (targetId) rows = rows.filter(r => r.targetId === targetId);
    if (q && String(q).trim()) {
      const term = String(q).trim().toLowerCase();
      rows = rows.filter(r => `${r.action} ${r.detail} ${r.actorName || ''} ${r.targetId || ''}`.toLowerCase().includes(term));
    }
    const fromMs = dateFrom ? Date.parse(dateFrom) : NaN;
    const toMs = dateTo ? Date.parse(dateTo) + (String(dateTo).length <= 10 ? 86399999 : 0) : NaN;
    if (Number.isFinite(fromMs)) rows = rows.filter(r => Date.parse(r.timestamp) >= fromMs);
    if (Number.isFinite(toMs)) rows = rows.filter(r => Date.parse(r.timestamp) <= toMs);

    rows.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    const total = rows.length;
    const lim = Math.min(MAX_LIMIT, Math.max(1, parseInt(limit, 10) || 50));
    const off = Math.max(0, parseInt(offset, 10) || 0);
    const actions = Array.from(new Set(rows.map(r => r.action).filter(Boolean))).sort();
    return { total, limit: lim, offset: off, actions, items: rows.slice(off, off + lim) };
  }
};

module.exports = AuditLogService;
