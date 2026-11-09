// server.js
// SIGMACAR Production-Grade Full-Stack Server

const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./backend/config');
const { handleApiRequest } = require('./backend/api/router');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf'
};

const server = http.createServer(async (req, res) => {
  // Global CORS & Security Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = req.url.split('?')[0];

  // 1. API Route Handling (/api/v1/...)
  if (reqUrl.startsWith('/api/v1/')) {
    return await handleApiRequest(req, res);
  }

  // 2. Legacy / LLM status health check
  if (reqUrl === '/api/llm-status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: 'active',
      engine: 'SigmaAuto-0.5B-EV',
      domain: 'Automotive Electric Vehicles & Certified Pre-Owned',
      knowledgeBaseLoaded: true,
      supportedIntegrations: ['local-automotive', 'ollama (http://localhost:11434)', 'groq / openai-compatible']
    }));
    return;
  }

  // 3. Ollama proxy (bypasses browser CORS for local LLM)
  if (reqUrl === '/api/ollama-proxy' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const ollamaReq = http.request(`${config.ai.ollamaEndpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (ollamaRes) => {
        res.writeHead(ollamaRes.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
        ollamaRes.pipe(res);
      });

      ollamaReq.on('error', (e) => {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Ollama is not running locally on port 11434', details: e.message }));
      });

      ollamaReq.write(body);
      ollamaReq.end();
    });
    return;
  }

  // 4. Static File Serving with Safe Path Sanitization
  let filePath = path.normalize(path.join(__dirname, decodeURIComponent(reqUrl === '/' ? '/index.html' : reqUrl)));
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden: Path traversal prohibited');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + reqUrl);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const noCacheExts = ['.html', '.js', '.css', '.json'];
    const cacheHeader = noCacheExts.includes(ext)
      ? 'no-cache, no-store, must-revalidate'
      : 'public, max-age=3600';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheHeader,
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

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
