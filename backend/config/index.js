// backend/config/index.js
// Centralized configuration loader & production security validation for SIGMACAR Platform

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Auto-load .env if present at project root
const envPath = path.join(__dirname, '..', '..', '.env');
if (fs.existsSync(envPath)) {
  try {
    const envRaw = fs.readFileSync(envPath, 'utf8');
    envRaw.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    });
  } catch (err) {
    console.warn('[Config] Failed to parse .env file:', err.message);
  }
}

const KNOWN_WEAK_SECRETS = new Set([
  'sigmacar_default_secure_secret_key_2026',
  'sigmacar_super_secret_jwt_key_production_ready_2026_change_me',
  'changeme',
  'secret',
  'jwt_secret'
]);

function resolveJwtSecret(nodeEnv) {
  const envSecret = process.env.JWT_SECRET ? String(process.env.JWT_SECRET).trim() : '';
  const isProd = nodeEnv === 'production';

  if (isProd) {
    if (!envSecret || envSecret.length < 32 || KNOWN_WEAK_SECRETS.has(envSecret)) {
      throw new Error(
        '[FATAL] Production boot aborted: JWT_SECRET must be set via environment variable (>= 32 chars, non-default).'
      );
    }
    return { jwtSecret: envSecret, isEphemeralJwtSecret: false };
  }

  if (envSecret && !KNOWN_WEAK_SECRETS.has(envSecret)) {
    return { jwtSecret: envSecret, isEphemeralJwtSecret: false };
  }

  // Non-production ephemeral random secret generated once per runtime process
  return {
    jwtSecret: crypto.randomBytes(32).toString('hex'),
    isEphemeralJwtSecret: true
  };
}

function buildConfig(envOverrides = {}) {
  const nodeEnv = envOverrides.NODE_ENV || process.env.NODE_ENV || 'development';
  const { jwtSecret, isEphemeralJwtSecret } = resolveJwtSecret(nodeEnv);

  const corsRaw = envOverrides.CORS_ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGINS || '';
  const parsedOrigins = corsRaw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const defaultDevOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ];

  const storageMode = envOverrides.SIGMACAR_STORAGE_MODE || process.env.SIGMACAR_STORAGE_MODE || 'json';
  const defaultStoreFile = path.resolve(__dirname, '..', '..', 'data', 'sigmacar_store.json');
  const dataFile = envOverrides.SIGMACAR_DATA_FILE || process.env.SIGMACAR_DATA_FILE || defaultStoreFile;
  const allowDevSeed = nodeEnv !== 'production' && (envOverrides.SIGMACAR_ALLOW_DEV_SEED ?? process.env.SIGMACAR_ALLOW_DEV_SEED) !== 'false';

  return {
    port: parseInt(envOverrides.PORT || process.env.PORT || '3000', 10),
    nodeEnv,
    jwtSecret,
    isEphemeralJwtSecret,
    sessionExpiryHours: parseInt(process.env.SESSION_EXPIRY_HOURS || '24', 10),
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_PER_MINUTE || '240', 10),
    loginRateLimitMax: parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '20', 10),
    maxJsonBodyBytes: parseInt(process.env.MAX_JSON_BODY_BYTES || String(1024 * 1024), 10),
    requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '30000', 10),

    cors: {
      allowedOrigins: parsedOrigins.length > 0 ? parsedOrigins : (nodeEnv === 'production' ? [] : defaultDevOrigins),
      allowWildcardInDev: nodeEnv !== 'production' && parsedOrigins.length === 0
    },

    // Database Configuration
    database: {
      url: process.env.DATABASE_URL || dataFile,
      dataFile,
      sqliteFile: process.env.SIGMACAR_SQLITE_FILE || path.resolve(__dirname, '..', '..', 'data', 'sigmacar.sqlite'),
      dialect: process.env.DATABASE_DIALECT || (storageMode === 'sqlite' ? 'sqlite' : 'json-adapter'),
      storageMode,
      allowDevSeed,
      isProductionDBConnected: Boolean(process.env.DATABASE_URL && String(process.env.DATABASE_URL).startsWith('postgres'))
    },

    // Payment & Webhook Provider Configuration
    payments: {
      provider: process.env.PAYMENT_PROVIDER || 'sandbox-sigmapay',
      sandboxEnabled: process.env.PAYMENT_GATEWAY_SANDBOX !== 'false',
      webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || (nodeEnv === 'production' ? '' : 'whsec_sigmacar_dev_sandbox_key_2026'),
      reservationTtlMinutes: parseInt(process.env.RESERVATION_TTL_MINUTES || '30', 10)
    },

    // Email & Support Provider Configuration
    notifications: {
      emailProvider: process.env.EMAIL_PROVIDER || 'dev-outbox',
      smtpConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
      emailWebhookSecret: process.env.EMAIL_WEBHOOK_SECRET || (nodeEnv === 'production' ? '' : 'whsec_email_dev_sandbox_2026'),
      fromAddress: process.env.NOTIFICATION_EMAIL_SENDER || 'noreply@sigmacar.vn'
    },

    // Centralized AI Configuration
    ai: {
      provider: process.env.AI_PROVIDER || 'local-automotive',
      allowLocalFallback: process.env.ALLOW_LOCAL_FALLBACK !== 'false',
      enableLegacyOllamaProxy: process.env.ENABLE_LEGACY_OLLAMA_PROXY === 'true',
      gemini: {
        apiKey: process.env.GEMINI_API_KEY || '',
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        timeoutMs: 15000,
        temperature: 0.7,
        maxOutputTokens: 2048
      },
      groq: {
        apiKey: process.env.GROQ_API_KEY || process.env.AI_API_KEY || '',
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions'
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        endpoint: 'https://api.openai.com/v1/chat/completions'
      },
      ollama: {
        endpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434',
        model: process.env.OLLAMA_MODEL || 'qwen2.5:0.5b'
      }
    }
  };
}

const config = buildConfig();
config.buildConfig = buildConfig;

module.exports = config;
