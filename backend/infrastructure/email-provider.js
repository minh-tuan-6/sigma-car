// backend/infrastructure/email-provider.js
// Transactional Email / Webhook Adapter with honest sandbox fallback & test hooks (no secrets logged)

const net = require('net');
const tls = require('tls');

const __testHooks = {
  forceFailCount: 0,
  forceTimeoutCount: 0,
  lastDeliveryMode: null,
  sentReceipts: []
};

function sanitizeLogRecipient(email) {
  if (!email || typeof email !== 'string') return '***';
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const local = parts[0];
  return `${local.slice(0, 2)}***@${parts[1]}`;
}

async function sendViaSmtp({ host, port, secure, user, pass, from, to, subject, textBody }) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, timeout: 8000 })
      : net.connect({ host, port, timeout: 8000 });

    let stage = 'GREETING';
    let buffer = '';

    const cleanup = () => {
      try { socket.end(); } catch (_) {}
      try { socket.destroy(); } catch (_) {}
    };

    const fail = (msg) => {
      cleanup();
      const err = new Error(msg);
      err.code = 'SMTP_DELIVERY_FAILED';
      reject(err);
    };

    socket.on('timeout', () => fail('SMTP connection timeout'));
    socket.on('error', (err) => fail(`SMTP transport error: ${err.message}`));

    const sendLine = (line) => socket.write(`${line}\r\n`);

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line) continue;
        const code = parseInt(line.slice(0, 3), 10);
        if (Number.isNaN(code) || line[3] === '-') continue;

        if (stage === 'GREETING' && code === 220) {
          stage = 'EHLO';
          sendLine(`EHLO sigmacar.local`);
        } else if (stage === 'EHLO' && code === 250) {
          if (user && pass) {
            stage = 'AUTH';
            const token = Buffer.from(`\0${user}\0${pass}`, 'utf8').toString('base64');
            sendLine(`AUTH PLAIN ${token}`);
          } else {
            stage = 'MAIL_FROM';
            sendLine(`MAIL FROM:<${from}>`);
          }
        } else if (stage === 'AUTH' && code === 235) {
          stage = 'MAIL_FROM';
          sendLine(`MAIL FROM:<${from}>`);
        } else if (stage === 'MAIL_FROM' && code === 250) {
          stage = 'RCPT_TO';
          sendLine(`RCPT TO:<${to}>`);
        } else if (stage === 'RCPT_TO' && (code === 250 || code === 251)) {
          stage = 'DATA';
          sendLine('DATA');
        } else if (stage === 'DATA' && code === 354) {
          stage = 'BODY';
          const safeHeaders = [
            `From: SIGMACAR <${from}>`,
            `To: <${to}>`,
            `Subject: ${String(subject || '').replace(/[\r\n]+/g, ' ')}`,
            'Content-Type: text/plain; charset=UTF-8',
            '',
            String(textBody || '').replace(/\r?\n\./g, '\r\n..'),
            '.'
          ].join('\r\n');
          socket.write(`${safeHeaders}\r\n`);
        } else if (stage === 'BODY' && code === 250) {
          stage = 'QUIT';
          sendLine('QUIT');
          cleanup();
          resolve({
            delivered: true,
            mode: 'smtp_live',
            providerId: `smtp_${Date.now()}`,
            messageId: `smtp_${Date.now()}`,
            recipientMasked: sanitizeLogRecipient(to)
          });
        } else if (code >= 400) {
          fail(`SMTP rejected at ${stage} with code ${code}`);
        }
      }
    });
  });
}

const EmailProvider = {
  __testHooks,

  getProviderConfig() {
    const smtpHost = process.env.SMTP_HOST || '';
    const webhookUrl = process.env.EMAIL_WEBHOOK_URL || '';
    if (smtpHost) {
      return {
        configured: true,
        mode: 'smtp_live',
        host: smtpHost,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        from: process.env.EMAIL_FROM || 'no-reply@sigmacar.vn'
      };
    }
    if (webhookUrl) {
      return {
        configured: true,
        mode: 'webhook_live',
        webhookUrl,
        from: process.env.EMAIL_FROM || 'no-reply@sigmacar.vn'
      };
    }
    return {
      configured: false,
      mode: 'queued_local_sandbox',
      from: 'no-reply@sigmacar.local'
    };
  },

  async send({ to, subject, textBody, htmlBody, metadata = {} }) {
    if (__testHooks.forceTimeoutCount > 0) {
      __testHooks.forceTimeoutCount -= 1;
      const err = new Error('Simulated email provider timeout');
      err.code = 'PROVIDER_TIMEOUT';
      throw err;
    }
    if (__testHooks.forceFailCount > 0) {
      __testHooks.forceFailCount -= 1;
      const err = new Error('Simulated email provider failure');
      err.code = 'PROVIDER_UNAVAILABLE';
      throw err;
    }

    const cfg = this.getProviderConfig();
    __testHooks.lastDeliveryMode = cfg.mode;

    if (!to) {
      return {
        delivered: false,
        mode: cfg.mode,
        status: 'skipped_no_recipient',
        recipientMasked: '***',
        note: 'Không có địa chỉ email người nhận.'
      };
    }

    if (cfg.mode === 'smtp_live') {
      return sendViaSmtp({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
        from: cfg.from,
        to,
        subject,
        textBody
      });
    }

    if (cfg.mode === 'webhook_live') {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(cfg.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ from: cfg.from, to, subject, textBody, htmlBody, metadata })
        });
        if (!res.ok) {
          const err = new Error(`Email webhook returned HTTP ${res.status}`);
          err.code = 'WEBHOOK_EMAIL_FAILED';
          throw err;
        }
        const msgId = `whk_${Date.now()}`;
        return {
          delivered: true,
          mode: 'webhook_live',
          providerId: msgId,
          messageId: msgId,
          recipientMasked: sanitizeLogRecipient(to)
        };
      } finally {
        clearTimeout(timer);
      }
    }

    // No external SMTP credentials configured: keep honest sandbox/local delivery status without faking real SMTP send
    const sandboxId = `sbx_mail_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const sandboxReceipt = {
      delivered: false,
      mode: 'queued_local_sandbox',
      status: 'sandbox_queued',
      providerId: sandboxId,
      messageId: sandboxId,
      recipientMasked: sanitizeLogRecipient(to),
      subject: String(subject || '').slice(0, 140),
      recordedAt: new Date().toISOString(),
      note: 'Chưa cấu hình SMTP_HOST/EMAIL_WEBHOOK_URL — thông báo được lưu cục bộ trong hộp thư tài khoản.'
    };
    __testHooks.sentReceipts.push(sandboxReceipt);
    if (__testHooks.sentReceipts.length > 50) __testHooks.sentReceipts.shift();
    return sandboxReceipt;
  },

  async sendEmail(payload = {}) {
    return this.send({
      to: payload.to,
      subject: payload.subject,
      textBody: payload.textBody ?? payload.text ?? '',
      htmlBody: payload.htmlBody ?? payload.html ?? '',
      metadata: {
        ...(payload.metadata || {}),
        ...(payload.idempotencyKey ? { idempotencyKey: payload.idempotencyKey } : {})
      }
    });
  }
};

module.exports = EmailProvider;
