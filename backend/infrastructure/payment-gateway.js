// backend/infrastructure/payment-gateway.js
// Sandbox payment gateway adapter with cryptographic HMAC-SHA256 webhook signing & timing-safe verification

const crypto = require('crypto');

const DEFAULT_SANDBOX_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'sigmacar-sandbox-webhook-hmac-key-v1';

const SUPPORTED_PROVIDERS = {
  napas_qr_sandbox: {
    id: 'napas_qr_sandbox',
    label: 'Chuyển khoản QR Napas 24/7 (Sandbox)',
    mode: 'sandbox'
  },
  vnpay_sandbox: {
    id: 'vnpay_sandbox',
    label: 'Cổng thanh toán VNPAY QR (Sandbox)',
    mode: 'sandbox'
  },
  momo_sandbox: {
    id: 'momo_sandbox',
    label: 'Ví điện tử MoMo (Sandbox)',
    mode: 'sandbox'
  },
  manual_transfer: {
    id: 'manual_transfer',
    label: 'Chuyển khoản Ngân hàng trực tiếp (Xác nhận Kế toán)',
    mode: 'manual'
  }
};

function getWebhookSecret(provider) {
  const envKey = `PAYMENT_WEBHOOK_SECRET_${String(provider || '').toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  return process.env[envKey] || process.env.PAYMENT_WEBHOOK_SECRET || DEFAULT_SANDBOX_WEBHOOK_SECRET;
}

function signWebhookPayload(rawBody, secret) {
  const key = secret || DEFAULT_SANDBOX_WEBHOOK_SECRET;
  return crypto.createHmac('sha256', key).update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody)).digest('hex');
}

function verifyWebhookSignature(rawBody, signatureHeader, provider) {
  if (!signatureHeader || typeof signatureHeader !== 'string') return false;
  const normalized = signatureHeader.trim().replace(/^sha256=/i, '');
  if (!/^[a-f0-9]{64}$/i.test(normalized)) return false;

  const expected = signWebhookPayload(rawBody, getWebhookSecret(provider));
  const bufA = Buffer.from(normalized.toLowerCase(), 'utf8');
  const bufB = Buffer.from(expected.toLowerCase(), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function initiateProviderIntent({ intentId, orderId, orderNumber, amount, currency = 'VND', provider = 'napas_qr_sandbox' }) {
  const providerMeta = SUPPORTED_PROVIDERS[provider];
  if (!providerMeta) {
    const err = new Error(`Cổng thanh toán "${provider}" không được hỗ trợ.`);
    err.statusCode = 400;
    err.code = 'UNSUPPORTED_PAYMENT_PROVIDER';
    throw err;
  }

  const providerRef = `${provider.toUpperCase()}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const checkoutUrl = `/#/checkout?orderId=${encodeURIComponent(orderId)}&intentId=${encodeURIComponent(intentId)}&provider=${encodeURIComponent(provider)}`;
  const qrPayload = `SIGMACAR|${providerMeta.id}|${orderNumber || orderId}|${amount}|${currency}|${providerRef}`;

  return {
    provider: providerMeta.id,
    providerLabel: providerMeta.label,
    providerMode: providerMeta.mode,
    providerRef,
    checkoutUrl,
    qrPayload
  };
}

function executeRefund({ refundId, orderId, amount, provider = 'napas_qr_sandbox', providerRef = null, simulateOutcome = 'succeeded' }) {
  const providerMeta = SUPPORTED_PROVIDERS[provider] || SUPPORTED_PROVIDERS.napas_qr_sandbox;
  if (simulateOutcome === 'failed' || simulateOutcome === 'timeout') {
    return {
      status: 'failed',
      provider: providerMeta.id,
      providerMode: providerMeta.mode,
      transactionRef: null,
      failureReason: simulateOutcome === 'timeout'
        ? 'Cổng thanh toán phản hồi quá thời gian (Timeout). Cần đối soát và thử lại thủ công.'
        : 'Cổng thanh toán từ chối giao dịch hoàn tiền (Tài khoản thụ hưởng hoặc cổng không khả dụng).'
    };
  }

  return {
    status: 'succeeded',
    provider: providerMeta.id,
    providerMode: providerMeta.mode,
    transactionRef: `RFND_${providerMeta.id.toUpperCase()}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    originalProviderRef: providerRef || null,
    refundedAmount: Number(amount),
    settledAt: new Date().toISOString()
  };
}

module.exports = {
  SUPPORTED_PROVIDERS,
  getWebhookSecret,
  signWebhookPayload,
  verifyWebhookSignature,
  initiateProviderIntent,
  executeRefund
};
