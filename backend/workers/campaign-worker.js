// backend/workers/campaign-worker.js
// Queued Email Campaign Delivery Worker, Retry/DLQ & Provider Receipt Reconciliation (SIG-P4-013)

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const NotificationRepository = require('../infrastructure/repositories/notification-repository');
const EmailProvider = require('../infrastructure/email-provider');
const config = require('../config');
const { CAMPAIGN_STATUS } = require('../domain/constants');

function signCampaignWebhook(rawBody, secret = (config.webhookSecrets?.campaign_provider || 'sigma-dev-campaign-webhook-secret')) {
  return crypto.createHmac('sha256', secret).update(String(rawBody || '')).digest('hex');
}

function verifyCampaignWebhookSignature(rawBody, sigHeader) {
  if (!sigHeader || typeof sigHeader !== 'string') return false;
  const clean = sigHeader.replace(/^sha256=/i, '').trim();
  const expected = signCampaignWebhook(rawBody);
  const a = Buffer.from(clean);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function recalculateCampaignStatsInState(state, campaignId) {
  const camp = (state.emailCampaigns || []).find(c => c.id === campaignId);
  if (!camp) return null;
  const rows = (state.campaignDeliveries || []).filter(d => d.campaignId === campaignId);
  const queuedCount = rows.filter(r => r.deliveryStatus === 'queued').length;
  const sentCount = rows.filter(r => ['sent', 'delivered', 'bounced'].includes(r.deliveryStatus)).length;
  const deliveredCount = rows.filter(r => r.deliveryStatus === 'delivered').length;
  const bouncedCount = rows.filter(r => r.deliveryStatus === 'bounced').length;
  const failedCount = rows.filter(r => r.deliveryStatus === 'failed').length;
  const skippedUnsubscribedCount = rows.filter(r => r.deliveryStatus === 'skipped_unsubscribed').length;

  camp.stats = {
    eligibleRecipients: rows.length,
    queuedCount,
    sentCount,
    deliveredCount,
    bouncedCount,
    failedCount,
    skippedUnsubscribedCount
  };
  return camp.stats;
}

const CampaignWorker = {
  signCampaignWebhook,
  verifyCampaignWebhookSignature,
  recalculateCampaignStatsInState,

  async processCampaignQueue({ campaignId = null, nowMs = Date.now(), chunkSize = 50, maxAttempts = 3 } = {}) {
    NotificationRepository.ensureCampaignDeliveries(dbState);

    // Promote due scheduled campaigns first (clock boundary check)
    const dueScheduled = (dbState.emailCampaigns || []).filter(c =>
      c.status === CAMPAIGN_STATUS.SCHEDULED &&
      c.scheduledAt &&
      Date.parse(c.scheduledAt) <= nowMs &&
      (!campaignId || c.id === campaignId)
    );
    for (const sc of dueScheduled) {
      await runInTransaction(async (state) => {
        const stored = state.emailCampaigns.find(c => c.id === sc.id);
        if (stored && stored.status === CAMPAIGN_STATUS.SCHEDULED && Date.parse(stored.scheduledAt) <= nowMs) {
          stored.status = 'Queued';
          stored.updatedAt = new Date(nowMs).toISOString();
        }
      });
    }

    const candidates = (dbState.campaignDeliveries || []).filter(d =>
      (!campaignId || d.campaignId === campaignId) &&
      ['queued', 'retry_scheduled'].includes(d.deliveryStatus) &&
      (!d.nextAttemptAt || Date.parse(d.nextAttemptAt) <= nowMs)
    ).slice(0, Math.max(1, Number(chunkSize) || 50));

    let sent = 0;
    let skipped = 0;
    let retried = 0;
    let deadLettered = 0;
    const touchedCampaigns = new Set();
    if (campaignId) touchedCampaigns.add(campaignId);

    for (const delivery of candidates) {
      touchedCampaigns.add(delivery.campaignId);
      const user = (dbState.users || []).find(u => u.id === delivery.recipientUserId);

      // Last-minute consent & suppression guard BEFORE calling provider
      if (!user || user.securityPrefs?.marketingConsent === false || user.disabled || user.deletedAt) {
        await runInTransaction(async (state) => {
          const row = state.campaignDeliveries.find(r => r.id === delivery.id);
          if (row && ['queued', 'retry_scheduled'].includes(row.deliveryStatus)) {
            row.deliveryStatus = 'skipped_unsubscribed';
            row.failureReason = 'Khách hàng đã hủy nhận tin trước thời điểm phát hành';
            row.updatedAt = new Date(nowMs).toISOString();
            recalculateCampaignStatsInState(state, row.campaignId);
          }
        });
        skipped++;
        continue;
      }

      // Skip already-sent recipients (replay-safe idempotency)
      if (delivery.providerMessageId && ['sent', 'delivered'].includes(delivery.deliveryStatus)) {
        continue;
      }

      try {
        const sendRes = await EmailProvider.sendEmail({
          to: delivery.recipientEmail,
          subject: delivery.renderedSubject,
          html: delivery.renderedHtml,
          text: delivery.renderedText || delivery.renderedSubject,
          idempotencyKey: `camp_${delivery.campaignId}_${delivery.recipientUserId}`
        });

        await runInTransaction(async (state) => {
          const row = state.campaignDeliveries.find(r => r.id === delivery.id);
          if (!row || !['queued', 'retry_scheduled'].includes(row.deliveryStatus)) return;
          row.attempts = (row.attempts || 0) + 1;
          row.providerMessageId = sendRes.messageId;
          row.deliveryMode = sendRes.mode || 'sandbox_queue';
          // Delivery receipts settle 'delivered'; send alone marks 'sent' ONLY (never fakes delivered without receipt!)
          row.deliveryStatus = 'sent';
          row.sentAt = new Date(nowMs).toISOString();
          row.updatedAt = row.sentAt;
          recalculateCampaignStatsInState(state, row.campaignId);
        });
        sent++;
      } catch (err) {
        await runInTransaction(async (state) => {
          const row = state.campaignDeliveries.find(r => r.id === delivery.id);
          if (!row) return;
          row.attempts = (row.attempts || 0) + 1;
          row.lastError = err.message || 'SMTP/Provider send failure';
          row.updatedAt = new Date(nowMs).toISOString();
          if (row.attempts >= maxAttempts) {
            row.deliveryStatus = 'failed';
            row.failureReason = row.lastError;
            NotificationRepository.ensureCampaignDeliveries(state);
            state.campaignDeadLetters.unshift({ ...row, deadLetteredAt: row.updatedAt });
            deadLettered++;
          } else {
            const backoffMs = Math.pow(2, row.attempts) * 30000;
            row.deliveryStatus = 'retry_scheduled';
            row.nextAttemptAt = new Date(nowMs + backoffMs).toISOString();
            retried++;
          }
          recalculateCampaignStatsInState(state, row.campaignId);
        });
      }
    }

    // Update campaign completion status when zero queued/retry rows remain
    for (const cId of touchedCampaigns) {
      await runInTransaction(async (state) => {
        const camp = state.emailCampaigns.find(c => c.id === cId);
        if (!camp) return;
        const pendingRows = (state.campaignDeliveries || []).filter(r =>
          r.campaignId === cId && ['queued', 'retry_scheduled'].includes(r.deliveryStatus)
        );
        if (pendingRows.length === 0 && camp.status !== CAMPAIGN_STATUS.SENT) {
          camp.status = CAMPAIGN_STATUS.SENT;
          camp.sentAt = new Date(nowMs).toISOString();
          camp.updatedAt = camp.sentAt;
        }
        recalculateCampaignStatsInState(state, cId);
      });
    }

    return { processed: candidates.length, sent, skipped, retried, deadLettered };
  },

  async handleProviderReceiptWebhook(rawBody, signatureHeader) {
    if (!verifyCampaignWebhookSignature(rawBody, signatureHeader)) {
      const err = new Error('Chữ ký webhook trạng thái gửi email không hợp lệ.');
      err.statusCode = 401;
      err.code = 'INVALID_WEBHOOK_SIGNATURE';
      throw err;
    }

    let payload = null;
    try {
      payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    } catch (e) {
      const err = new Error('JSON webhook không hợp lệ.');
      err.statusCode = 400;
      throw err;
    }

    const { providerMessageId, deliveryId, eventType, reason = '' } = payload || {};
    const statusMap = {
      delivered: 'delivered',
      bounce: 'bounced',
      bounced: 'bounced',
      complained: 'bounced',
      dropped: 'failed'
    };
    const nextStatus = statusMap[String(eventType || '').toLowerCase()];
    if (!nextStatus) {
      const err = new Error(`Loại callback "${eventType}" không được hỗ trợ.`);
      err.statusCode = 422;
      throw err;
    }

    return runInTransaction(async (state) => {
      NotificationRepository.ensureCampaignDeliveries(state);
      const row = state.campaignDeliveries.find(r =>
        (deliveryId && r.id === deliveryId) ||
        (providerMessageId && r.providerMessageId === providerMessageId)
      );
      if (!row) {
        const err = new Error('Không tìm thấy bản ghi gửi thư khớp mã nhà cung cấp.');
        err.statusCode = 404;
        throw err;
      }

      // Idempotent duplicate webhook replay guard
      if (row.deliveryStatus === nextStatus) {
        return { delivery: { ...row }, idempotentReplay: true, stats: recalculateCampaignStatsInState(state, row.campaignId) };
      }

      const nowIso = new Date().toISOString();
      row.deliveryStatus = nextStatus;
      row.updatedAt = nowIso;
      if (nextStatus === 'delivered') {
        row.deliveredAt = nowIso;
      } else {
        row.failureReason = reason || eventType;
      }
      const stats = recalculateCampaignStatsInState(state, row.campaignId);
      return { delivery: { ...row }, idempotentReplay: false, stats };
    });
  }
};

module.exports = CampaignWorker;
