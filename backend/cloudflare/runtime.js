// backend/cloudflare/runtime.js
// Cloudflare Workers runtime for the SIGMACAR API: runs the unchanged backend/api/router.js against Cloudflare D1.
//
//   Request ─▶ checks (binding, config) ─▶ D1 sync ─▶ Node req/res shim ─▶ handleApiRequest() ─▶ flush ─▶ Response
//
// Everything that touches the backend is loaded lazily on the first request, after the Worker's environment has been
// copied into process.env, so a configuration error (e.g. missing JWT_SECRET in production) becomes a JSON 503
// instead of a Worker that fails to start.

const { createNodeRequest, createNodeResponse, headersToNodeObject, toWebResponse } = require('./node-http-shim');

const PAGES_MAX_FILE_BYTES = 25 * 1024 * 1024;

const state = {
  backend: null,
  db: null,
  initError: null
};

function jsonError(status, code, message, extraHeaders = {}) {
  return new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      ...extraHeaders
    }
  });
}

// Copies string vars/secrets into process.env (nodejs_compat already does this for compatibility dates >= 2025-04-01;
// kept for older dates and for running the handler under Node in tests).
function exposeEnv(env) {
  if (typeof process === 'undefined' || !process.env) return;
  for (const [key, value] of Object.entries(env || {})) {
    if (typeof value === 'string' && process.env[key] === undefined) process.env[key] = value;
  }
  // Bracket form on purpose: the bundler replaces the dotted form with a constant (wrangler.api.toml [define]).
  const lazyKey = 'SIGMACAR_LAZY_INIT';
  process.env[lazyKey] = 'true';
}

// Same answer as the static snapshots that `npm run build` publishes on Pages: a pre-built USDZ is offered only if
// Pages actually hosts it (<= 25 MiB) or the external base URL serves it.
function pagesHostsFile(usdzIndex, rel) {
  for (const list of Object.values((usdzIndex && usdzIndex.vehicles) || {})) {
    for (const e of Array.isArray(list) ? list : []) {
      if (e && e.path === rel) return e.staticHostable !== false && Number(e.bytes) > 0 && Number(e.bytes) <= PAGES_MAX_FILE_BYTES;
    }
  }
  return false;
}

// Evaluates every backend module. The Worker entry calls this in global scope, so the cost lands in the Worker's
// startup budget (1 s) instead of the first request's CPU budget (10 ms on Workers Free). An initialisation error is
// remembered for the isolate's lifetime: a bundled CommonJS module that threw stays cached half-initialised, so it
// must never be required again and silently "succeed".
function preload(env) {
  if (state.modules) return state.modules;
  if (state.initError) throw state.initError;
  if (env) exposeEnv(env);
  else exposeEnv({});
  try {
    state.modules = {
      StorageEngine: require('../infrastructure/storage-engine'),
      D1StateStore: require('../infrastructure/persistence/d1-state-store').D1StateStore,
      D1BlobStore: require('../infrastructure/persistence/d1-blob-store').D1BlobStore,
      MediaStorage: require('../infrastructure/media-storage'),
      ArManifestService: require('../application/ar-manifest-service'),
      handleApiRequest: require('../api/router').handleApiRequest,
      applyCorsAndSecurityHeaders: require('../api/http-common').applyCorsAndSecurityHeaders,
      sendError: require('../api/middleware').sendError,
      AIService: require('../application/ai-service'),
      arSources: {
        registry: require('../../data/ar-manifest.json'),
        bindings: require('../../assets/models/manifests/bindings.json'),
        usdzIndex: require('../../data/usdz-assets.json')
      }
    };
  } catch (err) {
    state.initError = err;
    throw err;
  }
  return state.modules;
}

function loadBackend(env, deps) {
  if (state.backend) return state.backend;
  const {
    StorageEngine, D1StateStore, D1BlobStore, MediaStorage, ArManifestService,
    handleApiRequest, applyCorsAndSecurityHeaders, sendError, AIService, arSources
  } = preload(env);

  const sources = deps.arSources || arSources;
  ArManifestService.configureSources({
    registry: sources.registry,
    bindings: sources.bindings,
    usdzIndex: sources.usdzIndex,
    fileExists: (rel) => pagesHostsFile(sources.usdzIndex, rel),
    defaults: { staticHostOnly: true }
  });

  // Cloudflare Workers AI binding (wrangler.api.toml [env.*.ai]) — the default AI provider on Cloudflare.
  if (env.AI && typeof AIService.setWorkersAiBinding === 'function') AIService.setWorkersAiBinding(env.AI);

  StorageEngine.configureStorage({ driver: new D1StateStore(env.DB) });
  MediaStorage.setBlobDriver(new D1BlobStore(env.DB));

  // The AI knowledge base and stored provider config are built from the state at module load in Node; on Workers the
  // state arrives later from D1, so rebuild them whenever vehicles or meta are (re)loaded.
  StorageEngine.onStateReload((changed) => {
    if (!changed || changed.has('vehicles') || changed.has('certifiedVehicles') || changed.has('meta')) {
      try {
        if (typeof AIService._loadPersistedConfig === 'function') AIService._loadPersistedConfig();
        if (typeof AIService.syncKnowledgeBase === 'function') {
          Promise.resolve(AIService.syncKnowledgeBase()).catch(() => {});
        }
      } catch (_) {
        // the AI layer has its own local fallback; never fail a request because of it
      }
    }
  });

  state.db = env.DB;
  state.backend = { StorageEngine, handleApiRequest, applyCorsAndSecurityHeaders, sendError };
  return state.backend;
}

async function handle(request, env = {}, ctx = null, deps = {}) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (!url.pathname.startsWith('/api/v1/')) {
    return jsonError(404, 'ROUTE_NOT_FOUND', 'Không tìm thấy đường dẫn API.');
  }
  if (!env || !env.DB) {
    return jsonError(503, 'STORAGE_NOT_CONFIGURED', 'Máy chủ API SIGMACAR chưa được cấu hình cơ sở dữ liệu (thiếu binding D1 "DB").');
  }

  let backend;
  try {
    backend = loadBackend(env, deps);
  } catch (err) {
    // e.g. "[FATAL] Production boot aborted: JWT_SECRET must be set…" — log it, never return it.
    console.error('[sigmacar-api] initialisation failed:', err && err.message);
    return jsonError(503, 'CONFIG_ERROR', 'Máy chủ API SIGMACAR chưa được cấu hình đúng (biến môi trường hoặc bí mật).');
  }
  const { StorageEngine, handleApiRequest, applyCorsAndSecurityHeaders, sendError } = backend;

  const headers = headersToNodeObject(request.headers);
  const clientIp = request.headers.get('cf-connecting-ip') || '127.0.0.1';
  let body = null;
  if (method !== 'GET' && method !== 'HEAD') {
    body = Buffer.from(await request.arrayBuffer());
  }
  const req = createNodeRequest({ method, url: url.pathname + url.search, headers, body, remoteAddress: clientIp });
  const res = createNodeResponse();

  applyCorsAndSecurityHeaders(req, res);
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return toWebResponse(await res.done, method);
  }

  // Optional cross-isolate limiter (Workers Rate Limiting binding; Cloudflare counts it per location, not globally).
  // The router's own per-isolate limiter still applies.
  if (env.API_RATE_LIMITER && typeof env.API_RATE_LIMITER.limit === 'function' && url.pathname !== '/api/v1/health') {
    try {
      const { success } = await env.API_RATE_LIMITER.limit({ key: clientIp });
      if (!success) {
        sendError(res, 429, 'Quá nhiều yêu cầu trong thời gian ngắn. Vui lòng thử lại sau giây lát.', 'RATE_LIMITED');
        return toWebResponse(await res.done, method);
      }
    } catch (_) {
      // limiter unavailable: fall back to the in-isolate limiter
    }
  }

  try {
    await StorageEngine.syncFromDriver();
  } catch (err) {
    sendError(res, err.statusCode || 503, err.statusCode ? err.message : 'Hệ thống lưu trữ tạm thời không khả dụng.', err.code || 'STORAGE_UNAVAILABLE');
    return toWebResponse(await res.done, method);
  }

  try {
    await handleApiRequest(req, res);
  } catch (unhandledErr) {
    // Same as server.js
    if (!res.headersSent) {
      sendError(res, unhandledErr.statusCode || 500, unhandledErr.message || 'Lỗi máy chủ nội bộ.', unhandledErr.code || 'INTERNAL_ERROR');
    }
  }
  if (!res.writableEnded) {
    if (!res.headersSent) sendError(res, 500, 'Máy chủ không trả về phản hồi.', 'INTERNAL_ERROR');
    else res.end();
  }
  const out = await res.done;

  // Persist changes made outside runInTransaction (Node writes them with the next save).
  try {
    await StorageEngine.flushToDriver();
  } catch (err) {
    console.error('[sigmacar-api] flush failed:', err && err.code);
  }
  return toWebResponse(out, method);
}

module.exports = {
  handle,
  preload,
  pagesHostsFile,
  _state: state
};
