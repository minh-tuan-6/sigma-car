// backend/infrastructure/repositories/notification-repository.js
// Repository for Campaign Delivery Jobs, Per-Recipient Receipts & Signed Unsubscribe Audit

const { dbState } = require('../storage-engine');

const NotificationRepository = {
  ensureCampaignDeliveries(state = dbState) {
    if (!state) return [];
    if (!Array.isArray(state.campaignDeliveries)) {
      state.campaignDeliveries = [];
    }
    if (!Array.isArray(state.campaignDeadLetters)) {
      state.campaignDeadLetters = [];
    }
    return state.campaignDeliveries;
  }
};

module.exports = NotificationRepository;
