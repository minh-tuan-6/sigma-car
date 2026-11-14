// backend/api/http-common.js
// HTTP behaviour shared by the Node server (server.js) and the Cloudflare Worker (backend/cloudflare/runtime.js),
// so both runtimes send the same CORS and security headers for every API response.

const config = require('../config');

function applyCorsAndSecurityHeaders(req, res) {
  const origin = req.headers.origin;
  const allowedOrigins = (config.cors && config.cors.allowedOrigins) || [];
  if (origin && (allowedOrigins.includes(origin) || (config.env !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (config.env !== 'production') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Request-Id, X-Ticket-Token, Idempotency-Key');
  res.setHeader('Permissions-Policy', 'camera=(self), xr-spatial-tracking=(self), gyroscope=(self), accelerometer=(self), magnetometer=(self)');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

module.exports = {
  applyCorsAndSecurityHeaders
};
