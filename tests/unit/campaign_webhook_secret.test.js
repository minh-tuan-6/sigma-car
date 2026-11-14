// tests/unit/campaign_webhook_secret.test.js
// T0.2 — campaign delivery receipts are verified with the configured EMAIL_WEBHOOK_SECRET, never a public default.

require('../helpers/isolated-store'); // never touch data/ from a unit test

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const config = require('../../backend/config');
const CampaignWorker = require('../../backend/workers/campaign-worker');

const hmac = (body, key) => crypto.createHmac('sha256', key).update(body).digest('hex');

describe('T0.2 campaign delivery webhook secret', () => {
  const original = config.notifications.emailWebhookSecret;
  afterEach(() => { config.notifications.emailWebhookSecret = original; });

  const body = JSON.stringify({ deliveryId: 'd-1', eventType: 'delivered' });

  it('uses the configured secret', () => {
    config.notifications.emailWebhookSecret = 'configured-secret-for-test';
    assert.equal(CampaignWorker.verifyCampaignWebhookSignature(body, hmac(body, 'configured-secret-for-test')), true);
    assert.equal(CampaignWorker.verifyCampaignWebhookSignature(body, `sha256=${hmac(body, 'configured-secret-for-test')}`), true);
  });

  it('rejects a receipt signed with the old public default key', () => {
    config.notifications.emailWebhookSecret = 'configured-secret-for-test';
    assert.equal(CampaignWorker.verifyCampaignWebhookSignature(body, hmac(body, 'sigma-dev-campaign-webhook-secret')), false);
  });

  it('fails closed with 503 CONFIG_ERROR when no secret is configured (production without EMAIL_WEBHOOK_SECRET)', async () => {
    config.notifications.emailWebhookSecret = '';
    assert.equal(CampaignWorker.verifyCampaignWebhookSignature(body, hmac(body, '')), false);
    await assert.rejects(
      () => CampaignWorker.handleProviderReceiptWebhook(body, hmac(body, '')),
      (err) => err.statusCode === 503 && err.code === 'CONFIG_ERROR'
    );
  });

  it('production config leaves the secret empty when EMAIL_WEBHOOK_SECRET is unset', () => {
    const prev = process.env.EMAIL_WEBHOOK_SECRET;
    const prevJwt = process.env.JWT_SECRET;
    delete process.env.EMAIL_WEBHOOK_SECRET;
    process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
    try {
      const built = config.buildConfig({ NODE_ENV: 'production' });
      assert.equal(built.notifications.emailWebhookSecret, '');
    } finally {
      if (prev !== undefined) process.env.EMAIL_WEBHOOK_SECRET = prev;
      if (prevJwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prevJwt;
    }
  });
});
