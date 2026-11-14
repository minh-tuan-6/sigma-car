// backend/api/middleware.js
// Authentication, Authorization, Rate Limiting, and Response Serializers

const crypto = require('crypto');
const Security = require('../infrastructure/security');
const Authorization = require('../domain/authorization');
const config = require('../config');

function ensureRequestId(req, res) {
  if (!req.requestId) {
    const incoming = req.headers && req.headers['x-request-id'];
    req.requestId = (typeof incoming === 'string' && /^[a-zA-Z0-9._-]{4,64}$/.test(incoming))
      ? incoming
      : `req_${crypto.randomBytes(6).toString('hex')}`;
  }
  if (res && !res.headersSent) {
    res.setHeader('X-Request-Id', req.requestId);
  }
  return req.requestId;
}

// Standard JSON response serializer
function sendJSON(res, statusCode, payload, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...extraHeaders
  };
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(payload));
}

// Standard Error serializer
function sendError(res, statusCode, message, errorCode = 'ERROR', details = undefined) {
  const errBody = {
    code: errorCode,
    message
  };
  if (details !== undefined) {
    errBody.details = details;
  }
  sendJSON(res, statusCode, {
    success: false,
    error: errBody
  });
}

// Authentication middleware: verifies token signature AND validates against live user store
function authenticate(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7).trim();
  if (!token) return null;
  const claims = Security.verifyToken(token);
  if (!claims) return null;
  return Authorization.resolveActor(claims);
}

// Check role permission with live actor validation
function authorize(req, res, allowedRoles) {
  const user = authenticate(req);
  if (!user) {
    sendError(res, 401, 'Vui lòng đăng nhập để truy cập tài nguyên này.', 'UNAUTHORIZED');
    return null;
  }

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    sendError(res, 403, 'Bạn không có quyền truy cập chức năng này.', 'FORBIDDEN');
    return null;
  }

  req.actor = user;
  return user;
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ab.length !== bb.length || ab.length === 0) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// True when the request carries the shared secret injected by the Cloudflare Pages Function proxy.
function hasValidProxySecret(req) {
  const secret = config.http && config.http.proxySharedSecret;
  if (!secret) return false;
  return safeEqual(req.headers && req.headers['x-sigma-proxy-secret'], secret);
}

// When PROXY_SHARED_SECRET is configured, only the proxy may call the API directly.
// Returns false (and responds 403) for requests that bypass the proxy.
function enforceProxySecret(req, res) {
  const secret = config.http && config.http.proxySharedSecret;
  if (!secret) return true;
  if (hasValidProxySecret(req)) return true;
  sendError(res, 403, 'Yêu cầu phải đi qua cổng API SIGMACAR.', 'PROXY_SECRET_REQUIRED');
  return false;
}

// Resolve the real client IP. Forwarded headers are only honoured when the operator opted in (TRUST_PROXY=true)
// or the request is authenticated as coming from our proxy; otherwise they are attacker-controlled.
function getClientIp(req) {
  const socketIp = (req.socket && req.socket.remoteAddress) || '127.0.0.1';
  const trust = (config.http && config.http.trustProxy) || hasValidProxySecret(req);
  if (!trust || !req.headers) return socketIp;
  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.trim() && cfIp.length <= 64) return cfIp.trim();
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    const first = xff.split(',')[0].trim();
    if (first && first.length <= 64) return first;
  }
  return socketIp;
}

// Rate limiter check
function checkRateLimit(req, res) {
  const ip = getClientIp(req);
  const check = Security.checkRateLimit(ip);
  if (!check.allowed) {
    sendError(res, 429, 'Quá nhiều yêu cầu trong thời gian ngắn. Vui lòng thử lại sau giây lát.', 'RATE_LIMITED');
    return false;
  }
  return true;
}

// Parse incoming JSON body with strict byte cap and early stream abort
async function parseBody(req, maxBytes = (config.http && config.http.maxJsonBodyBytes) || 1024 * 1024) {
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    const err = new Error('Dung lượng dữ liệu gửi lên vượt quá giới hạn cho phép.');
    err.statusCode = 413;
    err.code = 'PAYLOAD_TOO_LARGE';
    req.destroy();
    throw err;
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    req.on('data', chunk => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      totalBytes += buf.length;
      if (totalBytes > maxBytes) {
        const err = new Error('Dung lượng dữ liệu gửi lên vượt quá giới hạn cho phép.');
        err.statusCode = 413;
        err.code = 'PAYLOAD_TOO_LARGE';
        fail(err);
        req.destroy();
        return;
      }
      chunks.push(buf);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const rawBufferStr = Buffer.concat(chunks).toString('utf8');
      req.rawBody = rawBufferStr;
      const raw = rawBufferStr.trim();
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') {
          const err = new Error('Payload JSON phải là đối tượng hoặc mảng hợp lệ.');
          err.statusCode = 400;
          err.code = 'BAD_JSON';
          return reject(err);
        }
        resolve(parsed);
      } catch (e) {
        const err = new Error('Dữ liệu JSON không hợp lệ.');
        err.statusCode = 400;
        err.code = 'BAD_JSON';
        reject(err);
      }
    });

    req.on('error', (err) => fail(err));
    req.on('aborted', () => {
      const err = new Error('Kết nối gửi dữ liệu bị gián đoạn.');
      err.statusCode = 400;
      err.code = 'REQUEST_ABORTED';
      fail(err);
    });
  });
}

module.exports = {
  ensureRequestId,
  sendJSON,
  sendError,
  authenticate,
  authorize,
  checkRateLimit,
  getClientIp,
  enforceProxySecret,
  parseBody
};
