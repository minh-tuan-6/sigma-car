// backend/infrastructure/security.js
// Cryptographic security, password hashing, token validation, rate-limiting, and sanitization

const crypto = require('crypto');
const config = require('../config');

// In-memory sliding window rate-limiter
const rateLimitMap = new Map();

const Security = {
  // Hash password using crypto.scrypt with cryptographically secure random salt
  async hashPassword(password) {
    if (!password || typeof password !== 'string' || password.length < 6) {
      throw new Error('Mật khẩu phải có tối thiểu 6 ký tự.');
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
    const keyBuffer = Buffer.from(key, 'hex');

    return new Promise((resolve) => {
      crypto.scrypt(password, salt, 64, (err, derivedKey) => {
        if (err) return resolve(false);
        try {
          const match = crypto.timingSafeEqual(keyBuffer, derivedKey);
          resolve(match);
        } catch (e) {
          resolve(false);
        }
      });
    });
  },

  // Sign JWT-like cryptographic bearer token
  createToken(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + (config.sessionExpiryHours * 3600);
    const bodyPayload = { ...payload, exp, iat: Math.floor(Date.now() / 1000) };
    const body = Buffer.from(JSON.stringify(bodyPayload)).toString('base64url');

    const signature = crypto
      .createHmac('sha256', config.jwtSecret)
      .update(`${header}.${body}`)
      .digest('base64url');

    return `${header}.${body}.${signature}`;
  },

  // Verify and decode bearer token
  verifyToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', config.jwtSecret)
      .update(`${header}.${body}`)
      .digest('base64url');

    if (signature !== expectedSignature) {
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

  // Check rate limit by key (IP or User ID)
  checkRateLimit(key, maxLimit = config.rateLimitMax, windowMs = 60000) {
    const now = Date.now();
    let record = rateLimitMap.get(key);

    if (!record || now - record.startTime > windowMs) {
      record = { count: 1, startTime: now };
      rateLimitMap.set(key, record);
      return { allowed: true, remaining: maxLimit - 1 };
    }

    record.count++;
    if (record.count > maxLimit) {
      return { allowed: false, remaining: 0, resetInMs: windowMs - (now - record.startTime) };
    }

    return { allowed: true, remaining: maxLimit - record.count };
  },

  // Sanitize string to prevent basic XSS injections
  sanitizeString(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .trim();
  },

  // Sanitize user entity before sending to client (strip hashes, secrets)
  sanitizeUser(user) {
    if (!user) return null;
    const { passwordHash, salt, ...safeUser } = user;
    return safeUser;
  }
};

module.exports = Security;
