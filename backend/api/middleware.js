// backend/api/middleware.js
// Authentication, Authorization, Rate Limiting, and Response Serializers

const Security = require('../infrastructure/security');

// Standard JSON response serializer
function sendJSON(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  });
  res.end(JSON.stringify(payload));
}

// Standard Error serializer
function sendError(res, statusCode, message, errorCode = 'ERROR') {
  sendJSON(res, statusCode, {
    success: false,
    error: {
      code: errorCode,
      message
    }
  });
}

// Authentication middleware
function authenticate(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  return Security.verifyToken(token);
}

// Check role permission
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

  return user;
}

// Rate limiter check
function checkRateLimit(req, res) {
  const ip = req.socket.remoteAddress || '127.0.0.1';
  const check = Security.checkRateLimit(ip);
  if (!check.allowed) {
    sendError(res, 429, 'Quá nhiều yêu cầu trong thời gian ngắn. Vui lòng thử lại sau giây lát.', 'RATE_LIMITED');
    return false;
  }
  return true;
}

// Parse incoming JSON body
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) { // 1MB limit
        reject(new Error('Request payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Malformed JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

module.exports = {
  sendJSON,
  sendError,
  authenticate,
  authorize,
  checkRateLimit,
  parseBody
};
