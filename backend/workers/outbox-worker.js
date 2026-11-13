// backend/workers/outbox-worker.js
// Transactional Outbox Lease Worker with Exponential Backoff & Dead-Letter Queue (DLQ)

const crypto = require('crypto');
const { runInTransaction } = require('../infrastructure/storage-engine');
const EmailProvider = require('../infrastructure/email-provider');

const workerId = `wrk_${crypto.randomBytes(4).toString('hex')}`;

const OutboxWorker = {
  async processOutboxBatch({ nowMs = Date.now(), batchSize = 20, leaseDurationMs = 30000 } = {}) {
    // Step 1: Claim eligible jobs atomically under lease inside transaction
    const claimed = await runInTransaction(async (state) => {
      if (!Array.isArray(state.outboxEvents)) state.outboxEvents = [];
      const candidates = state.outboxEvents.filter(job => {
        if (['sent', 'sandbox_queued', 'dead_letter', 'cancelled'].includes(job.status)) return false;
        if (job.status === 'processing') {
          const leaseEnd = job.leaseExpiresAt ? new Date(job.leaseExpiresAt).getTime() : 0;
          if (leaseEnd > nowMs) return false;
        }
        const readyAt = job.nextAttemptAt ? new Date(job.nextAttemptAt).getTime() : 0;
        return readyAt <= nowMs;
      }).slice(0, batchSize);

      const leaseUntil = new Date(nowMs + leaseDurationMs).toISOString();
      for (const job of candidates) {
        job.status = 'processing';
        job.leaseOwner = workerId;
        job.leaseExpiresAt = leaseUntil;
        job.updatedAt = new Date(nowMs).toISOString();
      }
      return candidates.map(j => ({ ...j }));
    });

    const summary = {
      claimed: claimed.length,
      delivered: 0,
      sandboxQueued: 0,
      retried: 0,
      deadLettered: 0
    };

    // Step 2: Execute external I/O outside transaction lock, then persist results atomically
    for (const job of claimed) {
      let receipt = null;
      let sendError = null;
      try {
        receipt = await EmailProvider.send({
          to: job.recipientEmail,
          subject: job.subject,
          textBody: job.textBody,
          metadata: {
            outboxId: job.id,
            eventType: job.eventType,
            aggregateId: job.aggregateId,
            dedupeKey: job.dedupeKey
          }
        });
      } catch (err) {
        sendError = err;
      }

      await runInTransaction(async (state) => {
        const stored = state.outboxEvents.find(e => e.id === job.id);
        if (!stored) return;
        // Skip stale update if another worker took over lease after expiry
        if (stored.leaseOwner && stored.leaseOwner !== workerId) return;

        const doneAtIso = new Date().toISOString();
        const linkedNotif = (state.notifications || []).find(n => n.outboxId === stored.id);

        if (sendError) {
          stored.attempts = (stored.attempts || 0) + 1;
          stored.lastError = String(sendError.message || 'Delivery failed').slice(0, 240);
          stored.leaseOwner = null;
          stored.leaseExpiresAt = null;
          stored.updatedAt = doneAtIso;

          if (stored.attempts >= (stored.maxAttempts || 3)) {
            stored.status = 'dead_letter';
            if (linkedNotif) linkedNotif.deliveryStatus = 'dead_letter';
            summary.deadLettered += 1;
          } else {
            const backoffMs = Math.min(300000, 1000 * Math.pow(2, stored.attempts));
            stored.status = 'pending';
            stored.nextAttemptAt = new Date(nowMs + backoffMs).toISOString();
            if (linkedNotif) linkedNotif.deliveryStatus = 'retrying';
            summary.retried += 1;
          }
          return;
        }

        stored.attempts = (stored.attempts || 0) + 1;
        stored.leaseOwner = null;
        stored.leaseExpiresAt = null;
        stored.deliveryMode = receipt.mode;
        stored.providerId = receipt.providerId || null;
        stored.updatedAt = doneAtIso;

        if (receipt.delivered) {
          stored.status = 'sent';
          stored.sentAt = doneAtIso;
          if (linkedNotif) linkedNotif.deliveryStatus = 'sent';
          summary.delivered += 1;
        } else {
          // Honest no-SMTP fallback: queued locally, never marked as delivered via external SMTP
          stored.status = receipt.status === 'skipped_no_recipient' ? 'sandbox_queued' : 'sandbox_queued';
          stored.sandboxNote = receipt.note || 'No external email provider configured.';
          if (linkedNotif) linkedNotif.deliveryStatus = 'sandbox_queued';
          summary.sandboxQueued += 1;
        }
      });
    }

    return summary;
  }
};

module.exports = OutboxWorker;
