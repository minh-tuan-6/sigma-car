// server.js
// SIGMACAR Production-Grade Full-Stack Server

const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./backend/config');
const { handleApiRequest } = require('./backend/api/router');
const { authorize, parseBody, sendError } = require('./backend/api/middleware');
const { ROLES } = require('./backend/domain/constants');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.usdz': 'model/vnd.usdz+zip',
  '.wasm': 'application/wasm'
};

const ROOT_DIR = fs.realpathSync(__dirname);
const ALLOWED_PUBLIC_FILES = new Set([
  '/index.html',
  '/ar.html',
  '/data/ar-manifest.json',
  '/data/public-catalog.json',
  '/favicon.ico'
]);
const ALLOWED_PUBLIC_PREFIXES = ['/css/', '/js/', '/assets/'];

function isPublicAssetPath(cleanPath) {
  if (!cleanPath || typeof cleanPath !== 'string') return false;
  if (cleanPath.includes('..') || cleanPath.includes('\\') || cleanPath.includes('\0')) return false;
  if (ALLOWED_PUBLIC_FILES.has(cleanPath)) return true;
  return ALLOWED_PUBLIC_PREFIXES.some(prefix => cleanPath.startsWith(prefix));
}

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

const server = http.createServer(async (req, res) => {
  applyCorsAndSecurityHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let decodedPathname;
  try {
    const rawPathname = (req.url || '/').split('?')[0];
    decodedPathname = decodeURIComponent(rawPathname);
  } catch (uriErr) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: { code: 'BAD_URI', message: 'Đường dẫn URL không hợp lệ.' } }));
    return;
  }

  // 1. API Route Handling (/api/v1/...)
  if (decodedPathname.startsWith('/api/v1/')) {
    try {
      return await handleApiRequest(req, res);
    } catch (unhandledErr) {
      if (!res.headersSent) {
        return sendError(res, unhandledErr.statusCode || 500, unhandledErr.message || 'Lỗi máy chủ nội bộ.', unhandledErr.code || 'INTERNAL_ERROR');
      }
      return;
    }
  }

  // 2. Public LLM capability summary (non-sensitive metadata only)
  if (decodedPathname === '/api/llm-status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: 'active',
      engine: config.ai.defaultProvider || 'local-automotive',
      domain: 'Automotive Electric Vehicles & Certified Pre-Owned',
      knowledgeBaseLoaded: true
    }));
    return;
  }

  // 3. Disabled by default: gated & admin-protected Ollama dev proxy
  if (decodedPathname === '/api/ollama-proxy' && req.method === 'POST') {
    if (!config.http || !config.http.enableLegacyOllamaProxy) {
      return sendError(res, 404, 'Proxy endpoint is disabled.', 'ROUTE_NOT_FOUND');
    }
    const adminUser = authorize(req, res, [ROLES.ADMIN]);
    if (!adminUser) return;
    try {
      const bodyObj = await parseBody(req, 64 * 1024);
      const endpoint = new URL(`${config.ai.ollamaBaseUrl || 'http://127.0.0.1:11434'}/api/generate`);
      const ollamaReq = http.request(endpoint, {
        method: 'POST',
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' }
      }, (ollamaRes) => {
        res.writeHead(ollamaRes.statusCode || 502, { 'Content-Type': 'application/json; charset=utf-8' });
        ollamaRes.pipe(res);
      });
      ollamaReq.on('timeout', () => {
        ollamaReq.destroy();
        if (!res.headersSent) sendError(res, 504, 'Ollama proxy timeout', 'GATEWAY_TIMEOUT');
      });
      ollamaReq.on('error', (e) => {
        if (!res.headersSent) sendError(res, 503, `Ollama service unavailable: ${e.message}`, 'SERVICE_UNAVAILABLE');
      });
      ollamaReq.write(JSON.stringify(bodyObj));
      ollamaReq.end();
    } catch (e) {
      return sendError(res, e.statusCode || 400, e.message, e.code || 'BAD_REQUEST');
    }
    return;
  }

  // 4. Static File Serving — strict public allowlist only (fail-closed against .env, .git, backend/, data/sigmacar_store.json)
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('405 Method Not Allowed');
    return;
  }

  let targetReqPath = decodedPathname === '/' ? '/index.html' : decodedPathname;
  // Dedicated AR page: /ar and /ar/:vehicleId are served by ar.html (mirrors the Cloudflare `_redirects` rewrite)
  if (/^\/ar(\/[^/]*)?\/?$/.test(targetReqPath)) {
    targetReqPath = '/ar.html';
  }
  if (!isPublicAssetPath(targetReqPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const candidatePath = path.resolve(ROOT_DIR, '.' + targetReqPath);
  if (candidatePath !== ROOT_DIR && !candidatePath.startsWith(ROOT_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden: Path traversal prohibited');
    return;
  }

  fs.stat(candidatePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    let realFile;
    try {
      realFile = fs.realpathSync(candidatePath);
    } catch (realErr) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    if (!realFile.startsWith(ROOT_DIR + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }

    const ext = path.extname(realFile).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const noCacheExts = ['.html', '.js', '.css', '.json'];
    const cacheHeader = noCacheExts.includes(ext)
      ? 'no-cache, no-store, must-revalidate'
      : 'public, max-age=3600';

    // Content-Length and single byte-range support: large assets (USDZ up to ~90 MB) report download progress,
    // and a client that only needs the header (AR page USDZ probe: Range bytes=0-1023) does not pull the whole file.
    const size = fs.statSync(realFile).size;
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': cacheHeader,
      'Pragma': 'no-cache',
      'Expires': '0',
      'Accept-Ranges': 'bytes'
    };
    let start = 0;
    let end = size - 1;
    let status = 200;
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
    if (range && (range[1] !== '' || range[2] !== '')) {
      if (range[1] === '') {
        start = Math.max(0, size - Number(range[2]));
      } else {
        start = Number(range[1]);
        if (range[2] !== '') end = Math.min(end, Number(range[2]));
      }
      if (start > end || start >= size) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Content-Type': 'text/plain; charset=utf-8' });
        res.end();
        return;
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length'] = String(end - start + 1);
    res.writeHead(status, headers);

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = fs.createReadStream(realFile, { start, end });
    // Stop reading (and release the file handle) when the client goes away mid-download.
    res.on('close', () => stream.destroy());
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
});

server.requestTimeout = (config.http && config.http.requestTimeoutMs) || 30000;

if (require.main === module) {
  server.listen(config.port, () => {
    console.log(`====================================================`);
    console.log(`🚗 SIGMACAR Production Platform is active!`);
    console.log(`👉 Web Client: http://localhost:${config.port}`);
    console.log(`🚀 REST API:   http://localhost:${config.port}/api/v1/vehicles`);
    console.log(`====================================================`);
  });
}

module.exports = server;
