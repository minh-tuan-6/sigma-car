// backend/workers/payment-reconciliation.js
// Restart-safe background job: expires unpaid reservations & intents, runs daily ledger reconciliation without PII

const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const { PAYMENT_INTENT_STATUS, PAYMENT_STATUS } = require('../domain/constants');
const InventoryRepository = require('../infrastructure/repositories/inventory-repository');

async function runReconciliationCycle({ nowMs = Date.now() } = {}) {
  return runInTransaction(async (state) => {
    const expiryRes = InventoryRepository.expireStaleReservationsInState(state, nowMs);

    let expiredIntentsCount = 0;
    for (const intent of (state.paymentIntents || [])) {
      if (intent.status !== PAYMENT_INTENT_STATUS.PENDING && intent.status !== PAYMENT_INTENT_STATUS.CREATED) continue;
      const expMs = Date.parse(intent.expiresAt);
      if (Number.isFinite(expMs) && expMs <= nowMs) {
        intent.status = PAYMENT_INTENT_STATUS.EXPIRED;
        intent.updatedAt = new Date(nowMs).toISOString();
        expiredIntentsCount += 1;

        const order = (state.orders || []).find(o => o.id === intent.orderId);
        if (order && (order.paidAmount || 0) === 0 && order.paymentStatus === PAYMENT_STATUS.PENDING_PAYMENT) {
          order.paymentStatus = PAYMENT_STATUS.UNPAID;
          order.updatedAt = new Date(nowMs).toISOString();
        }
      }
    }

    // Reconcile ledger sum against order paidAmount (zero PII emitted)
    const ledgerSumByOrder = new Map();
    for (const entry of (state.paymentLedger || [])) {
      const sign = String(entry.entryType || '').startsWith('REFUND') ? -1 : 1;
      ledgerSumByOrder.set(
        entry.orderId,
        (ledgerSumByOrder.get(entry.orderId) || 0) + sign * Math.round(Number(entry.amount || 0))
      );
    }

    const mismatches = [];
    const exceptionOrders = [];
    let totalLedgerCollected = 0;

    for (const order of (state.orders || [])) {
      if (order.exceptionStatus) {
        exceptionOrders.push({ orderId: order.id, exceptionStatus: order.exceptionStatus });
      }
      if (!order.paymentLedgerTracked && !ledgerSumByOrder.has(order.id)) continue;
      const ledgerAmt = ledgerSumByOrder.get(order.id) || 0;
      totalLedgerCollected += ledgerAmt;
      const recordedPaid = Math.round(Number(order.paidAmount || 0));
      if (ledgerAmt !== recordedPaid) {
        mismatches.push({
          orderId: order.id,
          ledgerAmount: ledgerAmt,
          orderPaidAmount: recordedPaid
        });
      }
    }

    return {
      ranAt: new Date(nowMs).toISOString(),
      expiredReservationsCount: expiryRes.expiredCount,
      expiredIntentsCount,
      totalLedgerCollected,
      mismatchesCount: mismatches.length,
      exceptionsCount: exceptionOrders.length,
      mismatches,
      exceptionOrders
    };
  });
}

module.exports = {
  runReconciliationCycle
};
