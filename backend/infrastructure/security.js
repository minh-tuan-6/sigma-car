// backend/infrastructure/security.js
// Cryptographic security, password hashing, token validation, rate-limiting, and sanitization

const crypto = require('crypto');
const config = require('../config');

// In-memory sliding window rate-limiter
const rateLimitMap = new Map();

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:']);

const Security = {
  // Hash password using crypto.scrypt with cryptographically secure random salt
  async hashPassword(password) {
    if (!password || typeof password !== 'string' || password.length < 6) {
      const err = new Error('Mật khẩu phải có tối thiểu 6 ký tự.');
      err.statusCode = 422;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    const salt = crypto.randomBytes(16).toString('hex');
    return new Promise((resolve, reject) => {
      crypto.scrypt(password, salt, 64, (err, derivedKey) => {
        if (err) return reject(err);
        resolve(`${salt}:${derivedKey.toString('hex')}`);
      });
    });
  },

  // Verify password against stored hash with timingSafeEqual
  async verifyPassword(password, storedCombinedHash) {
    if (!password || !storedCombinedHash || !storedCombinedHash.includes(':')) {
      return false;
    }
    const [salt, key] = storedCombinedHash.split(':');
    if (!salt || !key) return false;
    const keyBuffer = Buffer.from(key, 'hex');

    return new Promise((resolve) => {
      crypto.scrypt(password, salt, 64, (err, derivedKey) => {
        if (err || derivedKey.length !== keyBuffer.length) return resolve(false);
        try {
          resolve(crypto.timingSafeEqual(keyBuffer, derivedKey));
        } catch (e) {
          resolve(false);
        }
      });
    });
  },

  // Sign JWT-like cryptographic bearer token with sessionVersion & unique jti
  createToken(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const nowSec = Math.floor(Date.now() / 1000);
    const exp = nowSec + (config.sessionExpiryHours * 3600);
    const bodyPayload = {
      ...payload,
      sessionVersion: payload.sessionVersion ?? 1,
      jti: crypto.randomUUID(),
      exp,
      iat: nowSec
    };
    const body = Buffer.from(JSON.stringify(bodyPayload)).toString('base64url');

    const signature = crypto
      .createHmac('sha256', config.jwtSecret)
      .update(`${header}.${body}`)
      .digest('base64url');

    return `${header}.${body}.${signature}`;
  },

  // Verify and decode bearer token using timingSafeEqual
  verifyToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', config.jwtSecret)
      .update(`${header}.${body}`)
      .digest('base64url');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        return null; // Expired
      }
      return payload;
    } catch (e) {
      return null;
    }
  },

  // Sign a purpose-bound HMAC token (e.g. 'marketing_unsubscribe') independent of login JWT sessions
  signPurposeToken({ purpose, userId = null, email = null, ttlSeconds = 7 * 86400 } = {}) {
    if (!purpose) throw new Error('Purpose is required for signed token.');
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      purpose: String(purpose),
      sub: userId || null,
      email: email ? String(email).toLowerCase().trim() : null,
      iat: nowSec,
      exp: nowSec + Math.max(60, Number(ttlSeconds) || 86400)
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', config.jwtSecret).update(`purpose.${encoded}`).digest('base64url');
    return `${encoded}.${sig}`;
  },

  verifyPurposeToken(token, expectedPurpose) {
    if (!token || typeof token !== 'string' || !expectedPurpose) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', config.jwtSecret).update(`purpose.${encoded}`).digest('base64url');
    const a = Buffer.from(signature);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      if (payload.purpose !== String(expectedPurpose)) return null;
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload;
    } catch (e) {
      return null;
    }
  },

  hashSecret(secretValue) {
    return crypto.createHash('sha256').update(String(secretValue || '')).digest('hex');
  },

  verifySecretHash(rawSecret, expectedHash) {
    if (!rawSecret || !expectedHash) return false;
    const actualHash = this.hashSecret(rawSecret);
    const b1 = Buffer.from(actualHash, 'hex');
    const b2 = Buffer.from(String(expectedHash), 'hex');
    if (b1.length !== b2.length) return false;
    return crypto.timingSafeEqual(b1, b2);
  },

  // Check rate limit by key (IP or User ID)
  checkRateLimit(key, maxLimit = config.rateLimitMax, windowMs = 60000) {
    const now = Date.now();
    let record = rateLimitMap.get(key);

    if (!record || now - record.startTime > windowMs) {
      record = { count: 1, startTime: now };
      rateLimitMap.set(key, record);
      return { allowed: true, remaining: Math.max(0, maxLimit - 1) };
    }

    record.count++;
    if (record.count > maxLimit) {
      return { allowed: false, remaining: 0, resetInMs: windowMs - (now - record.startTime) };
    }

    return { allowed: true, remaining: maxLimit - record.count };
  },

  resetRateLimit(keyPrefix = null) {
    if (!keyPrefix) {
      rateLimitMap.clear();
      return;
    }
    for (const k of rateLimitMap.keys()) {
      if (String(k).startsWith(keyPrefix)) rateLimitMap.delete(k);
    }
  },

  normalizeEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
  },

  // Sanitize plain string for XSS safety
  sanitizeString(str, maxLength = 2000) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .trim()
      .slice(0, maxLength);
  },

  // Sanitize rich HTML (removes script/iframe/object/svg event attributes and unsafe URLs)
  escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  sanitizeHtml(html) {
    if (typeof html !== 'string') return '';
    let clean = html
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
      .replace(/<(object|embed|form|input|button|meta|link|base|svg)[^>]*>/gi, '')
      .replace(/<\/(object|embed|form|svg)>/gi, '')
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(href|src)\s*=\s*(["'])\s*(javascript:|vbscript:|data:text\/html)[^"']*\2/gi, '$1=$2#$2');
    return clean.trim();
  },

  // Validate safe URL schemes
  sanitizeUrl(urlInput, { allowRelative = true, allowHash = true } = {}) {
    if (typeof urlInput !== 'string') return '';
    const raw = urlInput.trim();
    if (!raw) return '';
    if (allowHash && raw.startsWith('#') && !/[<>"']/.test(raw)) return raw;
    if (allowRelative && (raw.startsWith('/') || raw.startsWith('assets/'))) {
      if (raw.startsWith('//') || /[<>"'\r\n]/.test(raw)) return '';
      return raw;
    }
    try {
      const parsed = new URL(raw);
      if (SAFE_URL_PROTOCOLS.has(parsed.protocol)) {
        return parsed.toString();
      }
    } catch (e) {
      return '';
    }
    return '';
  },

  isValidFiniteNumber(val, { min = -Infinity, max = Infinity, integer = false } = {}) {
    if (typeof val !== 'number' || !Number.isFinite(val)) return false;
    if (integer && !Number.isInteger(val)) return false;
    return val >= min && val <= max;
  },

  // Sanitize user entity before sending to client (strip hashes, secrets)
  sanitizeUser(user) {
    if (!user) return null;
    const {
      passwordHash,
      salt,
      sessionTokens,
      resetTokenHash,
      ...safeUser
    } = user;
    return {
      ...safeUser,
      branchIds: Array.isArray(safeUser.branchIds)
        ? safeUser.branchIds
        : (safeUser.branchId ? [safeUser.branchId] : [])
    };
  }
};

module.exports = Security;
