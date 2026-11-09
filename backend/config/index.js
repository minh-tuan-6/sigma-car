// backend/config/index.js
// Centralized configuration loader for SIGMACAR Platform

const fs = require('fs');
const path = require('path');

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

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'sigmacar_default_secure_secret_key_2026',
  sessionExpiryHours: parseInt(process.env.SESSION_EXPIRY_HOURS || '24', 10),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_PER_MINUTE || '120', 10),
  
  // Database Configuration
  database: {
    url: process.env.DATABASE_URL || './data/sigmacar_store.json',
    dialect: process.env.DATABASE_DIALECT || 'json-adapter',
    isProductionDBConnected: false
  },

  // Centralized AI Configuration (Default: Sigma AI Local Automotive Engine)
  ai: {
    provider: process.env.AI_PROVIDER || 'local-automotive',
    allowLocalFallback: process.env.ALLOW_LOCAL_FALLBACK !== 'false',
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

module.exports = config;
