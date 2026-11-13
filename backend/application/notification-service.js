// backend/application/notification-service.js
// Transactional Notification Templates, User Inbox & Atomic Outbox Enqueue Helpers

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const Security = require('../infrastructure/security');

const TEMPLATES = {
  order_confirmed: (p) => ({
    subject: `[SIGMACAR] Xác nhận đơn hàng ${p.orderNumber || p.orderId}`,
    textBody: `Xin chào ${p.buyerName || 'Quý khách'}, đơn hàng ${p.orderNumber || p.orderId} cho mẫu xe ${p.vehicleName || 'SIGMACAR'} tại ${p.branchName || 'Showroom SIGMACAR'} đã được ghi nhận.`
  }),
  payment_settled: (p) => ({
    subject: `[SIGMACAR] Biên nhận thanh toán đơn ${p.orderNumber || p.orderId}`,
    textBody: `Thanh toán số tiền ${Number(p.amount || 0).toLocaleString('vi-VN')} VNĐ cho đơn ${p.orderNumber || p.orderId} đã được đối soát hợp lệ.`
  }),
  appointment_booked: (p) => ({
    subject: `[SIGMACAR] Xác nhận lịch hẹn lái thử ${p.appointmentId || ''}`,
    textBody: `Lịch lái thử xe ${p.carName || 'SIGMACAR'} ngày ${p.preferredDate} khung giờ ${p.timeSlot} tại ${p.branchName || 'Showroom'} đã được ghi nhận.`
  }),
  appointment_rescheduled: (p) => ({
    subject: `[SIGMACAR] Cập nhật thời gian lịch hẹn ${p.appointmentId || ''}`,
    textBody: `Lịch hẹn lái thử ${p.carName || ''} đã chuyển sang ngày ${p.preferredDate}, khung giờ ${p.timeSlot}.`
  }),
  financing_submitted: (p) => ({
    subject: `[SIGMACAR] Tiếp nhận hồ sơ trả góp ${p.applicationId || ''}`,
    textBody: `Hồ sơ dự toán tài chính ${p.applicationId} cho xe ${p.vehicleName || 'SIGMACAR'} (kỳ hạn ${p.termMonths} tháng) đã được chuyển bộ phận thẩm định.`
  }),
  financing_reviewed: (p) => ({
    subject: `[SIGMACAR] Kết quả thẩm định hồ sơ trả góp ${p.applicationId || ''}`,
    textBody: `Hồ sơ tài chính ${p.applicationId} hiện có trạng thái: ${p.status}. ${p.decisionNote || ''}`
  }),
  handover_completed: (p) => ({
    subject: `[SIGMACAR] Biên bản bàn giao xe VIN ${p.vin || ''} — Đơn ${p.orderId || ''}`,
    textBody: `Chúc mừng ${p.buyerName || 'Quý khách'} đã nhận bàn giao xe ${p.vehicleName || ''} (VIN: ${p.vin}) thành công.`
  }),
  warranty_activated: (p) => ({
    subject: `[SIGMACAR] Chứng nhận Bảo hành Điện tử ${p.warrantyCode || ''}`,
    textBody: `Bảo hành chính hãng mã ${p.warrantyCode} cho số khung VIN ${p.vin} có hiệu lực từ ${p.startDate} đến ${p.endDate}.`
  }),
  return_updated: (p) => ({
    subject: `[SIGMACAR] Cập nhật hồ sơ đổi trả 7 ngày ${p.returnCode || ''}`,
    textBody: `Hồ sơ đổi trả ${p.returnCode} đã chuyển sang trạng thái "${p.status}".`
  }),
  ticket_replied: (p) => ({
    subject: `[SIGMACAR] Phản hồi yêu cầu hỗ trợ ${p.ticketCode || ''}`,
    textBody: `Yêu cầu hỗ trợ ${p.ticketCode} (${p.subject || ''}) có phản hồi mới từ bộ phận CSKH.`
  }),
  service_reminder: (p) => ({
    subject: `[SIGMACAR] Xác nhận & Nhắc lịch dịch vụ ${p.appointmentCode || ''}`,
    textBody: `Lịch bảo dưỡng xe ${p.vehicleName || ''} tại ${p.serviceCenterName || ''} lúc ${p.timeSlot} ngày ${p.preferredDate} đã được ghi nhận.`
  }),
  registration_updated: (p) => ({
    subject: `[SIGMACAR] Tiến độ đăng ký biển số đơn ${p.orderId || ''}`,
    textBody: `Hồ sơ đăng ký xe đơn ${p.orderId} đã cập nhật trạng thái: ${p.status}${p.plateNumber ? ` (Biển số: ${p.plateNumber})` : ''}.`
  }),
  contract_acknowledged: (p) => ({
    subject: `[SIGMACAR] Xác nhận hợp đồng điện tử ${p.contractCode || ''}`,
    textBody: `Hợp đồng ${p.contractCode} (phiên bản ${p.version}) cho đơn ${p.orderId} đã được xác nhận.`
  })
};

function renderTemplate(templateId, payload = {}) {
  const fn = TEMPLATES[templateId];
  if (fn) return fn(payload);
  return {
    subject: payload.subject || `[SIGMACAR] Thông báo hệ thống`,
    textBody: payload.message || 'Cập nhật trạng thái dịch vụ từ SIGMACAR.'
  };
}

function redactPayloadForStorage(payload = {}) {
  const safe = {};
  for (const [k, v] of Object.entries(payload)) {
    const lk = k.toLowerCase();
    if (lk.includes('token') || lk.includes('secret') || lk.includes('password') || lk.includes('pin')) continue;
    safe[k] = v;
  }
  return safe;
}

const NotificationService = {
  renderTemplate,

  /**
   * Append an outbox event strictly inside caller's active runInTransaction(state) UoW.
   * Ensures idempotent dedupeKey and records transactional eligibility.
   */
  enqueueOutboxInState(state, {
    eventType,
    aggregateType,
    aggregateId,
    userId = null,
    recipientEmail = null,
    recipientPhone = null,
    channel = 'email',
    category = 'transactional',
    templateId,
    payload = {},
    dedupeKey = null
  }) {
    if (!Array.isArray(state.outboxEvents)) state.outboxEvents = [];
    if (!Array.isArray(state.notifications)) state.notifications = [];

    const effectiveDedupeKey = dedupeKey || `${eventType}:${aggregateType}:${aggregateId}`;
    const existing = state.outboxEvents.find(ev => ev.dedupeKey === effectiveDedupeKey && ev.status !== 'cancelled');
    if (existing) {
      return existing;
    }

    let resolvedEmail = recipientEmail;
    let userPrefs = null;
    if (userId && Array.isArray(state.users)) {
      const targetUser = state.users.find(u => u.id === userId);
      if (targetUser) {
        if (!resolvedEmail) resolvedEmail = targetUser.email || null;
        userPrefs = targetUser.securityPrefs || null;
      }
    }

    // Marketing notifications respect marketingConsent; transactional emails are always mandatory
    if (category === 'marketing' && userPrefs && userPrefs.marketingConsent === false) {
      return null;
    }

    const nowIso = new Date().toISOString();
    const safePayload = redactPayloadForStorage(payload);
    const rendered = renderTemplate(templateId || eventType, safePayload);
    const jobId = `OBX-${crypto.randomUUID().slice(0, 8)}`;

    const outboxJob = {
      id: jobId,
      eventType,
      aggregateType,
      aggregateId,
      dedupeKey: effectiveDedupeKey,
      channel,
      category,
      templateId: templateId || eventType,
      userId,
      recipientEmail: resolvedEmail ? Security.sanitizeString(resolvedEmail) : null,
      recipientPhone: recipientPhone ? Security.sanitizeString(recipientPhone) : null,
      subject: rendered.subject,
      textBody: rendered.textBody,
      payload: safePayload,
      status: 'pending', // pending | processing | sent | sandbox_queued | dead_letter | cancelled
      attempts: 0,
      maxAttempts: 3,
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: nowIso,
      lastError: null,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    state.outboxEvents.push(outboxJob);

    // Also project an immediate unread in-app notification for authenticated owners
    if (userId) {
      state.notifications.unshift({
        id: `NTF-${crypto.randomUUID().slice(0, 8)}`,
        outboxId: jobId,
        userId,
        category,
        eventType,
        aggregateType,
        aggregateId,
        title: rendered.subject,
        message: rendered.textBody,
        deliveryStatus: 'queued',
        readAt: null,
        createdAt: nowIso
      });
    }

    return outboxJob;
  },

  listForUser(user) {
    if (!user || !user.userId) return [];
    const list = (dbState.notifications || []).filter(n => n.userId === user.userId);
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 100);
  },

  async markRead(user, notifId) {
    return runInTransaction(async (state) => {
      const notif = (state.notifications || []).find(n => n.id === notifId && n.userId === user.userId);
      if (!notif) {
        const err = new Error('Không tìm thấy thông báo.');
        err.statusCode = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }
      notif.readAt = notif.readAt || new Date().toISOString();
      return notif;
    });
  },

  listOutboxAdmin() {
    return [...(dbState.outboxEvents || [])]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 200)
      .map(({ textBody, ...rest }) => rest);
  }
};

module.exports = NotificationService;
