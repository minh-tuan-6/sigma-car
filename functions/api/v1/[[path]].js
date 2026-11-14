// functions/api/v1/[[path]].js
// Cloudflare Pages Function: same-origin reverse proxy  https://<pages-host>/api/v1/*  →  SIGMA_BACKEND_ORIGIN/api/v1/*
//
// Why: Cloudflare Pages only serves static files. Without this function every /api/v1/* request fell through
// _redirects (/* /index.html 200) and returned the SPA shell as HTTP 200 text/html (see docs/API_AND_AR_AUDIT.md).
//
// Environment (Pages → Settings → Variables and Secrets):
//   SIGMA_BACKEND_ORIGIN       required  e.g. https://api.sigmacar.example  (origin only, https)
//   SIGMA_PROXY_SHARED_SECRET  optional  secret, sent as X-Sigma-Proxy-Secret; set the same value as
//                                        PROXY_SHARED_SECRET on the backend so it rejects direct traffic
//   SIGMA_PROXY_TIMEOUT_MS     optional  upstream timeout, default 25000
//   SIGMA_BACKEND_ALLOW_HTTP   optional  "true" only for local `wrangler pages dev` against http://localhost
//
// Security: the upstream host is fixed by configuration; the client controls only the path under /api/v1/
// and the query string, so this is not an open proxy. Secrets never reach browser JavaScript.

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'transfer-encoding', 'upgrade', 'host', 'content-length'
]);

const PROXY_ERROR_HEADER = 'X-Sigma-Proxy-Error';
const DEFAULT_TIMEOUT_MS = 25000;
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

function proxyError(status, code, message) {
  return new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      [PROXY_ERROR_HEADER]: code
    }
  });
}

export function resolveBackendOrigin(env) {
  const raw = env && typeof env.SIGMA_BACKEND_ORIGIN === 'string' ? env.SIGMA_BACKEND_ORIGIN.trim() : '';
  if (!raw) return { error: 'BACKEND_NOT_CONFIGURED' };
  let u;
  try {
    u = new URL(raw);
  } catch (_) {
    return { error: 'BACKEND_ORIGIN_INVALID' };
  }
  const allowHttp = env.SIGMA_BACKEND_ALLOW_HTTP === 'true';
  if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) return { error: 'BACKEND_ORIGIN_INVALID' };
  if (u.username || u.password || (u.pathname && u.pathname !== '/') || u.search || u.hash) return { error: 'BACKEND_ORIGIN_INVALID' };
  return { origin: u.origin };
}

function buildUpstreamHeaders(request, env, inUrl) {
  const out = new Headers();
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower.startsWith('cf-') || lower.startsWith('x-forwarded-') || lower === 'x-real-ip') continue;
    if (lower === 'x-sigma-proxy-secret') continue; // never let clients supply it
    out.set(name, value);
  }
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) {
    out.set('X-Forwarded-For', clientIp);
    out.set('CF-Connecting-IP', clientIp);
  }
  out.set('X-Forwarded-Host', inUrl.host);
  out.set('X-Forwarded-Proto', inUrl.protocol.replace(':', ''));
  if (env.SIGMA_PROXY_SHARED_SECRET) out.set('X-Sigma-Proxy-Secret', env.SIGMA_PROXY_SHARED_SECRET);
  return out;
}

function buildClientHeaders(upstream, upstreamOrigin) {
  const out = new Headers();
  for (const [name, value] of upstream.headers) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === 'set-cookie') continue;
    if (lower === 'location') {
      // Keep redirects on the Pages origin instead of leaking the backend host.
      out.set(name, value.startsWith(upstreamOrigin) ? value.slice(upstreamOrigin.length) || '/' : value);
      continue;
    }
    out.set(name, value);
  }
  // Re-emit cookies without a Domain attribute so they bind to the Pages host.
  const cookies = typeof upstream.headers.getSetCookie === 'function' ? upstream.headers.getSetCookie() : [];
  for (const c of cookies) out.append('Set-Cookie', c.replace(/;\s*Domain=[^;]*/gi, ''));
  out.set('X-Sigma-Proxy', '1');
  return out;
}

export async function handleProxy(request, env = {}, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const inUrl = new URL(request.url);

  if (!inUrl.pathname.startsWith('/api/v1/')) {
    return proxyError(404, 'ROUTE_NOT_FOUND', 'Không tìm thấy đường dẫn API.');
  }

  const resolved = resolveBackendOrigin(env);
  if (resolved.error === 'BACKEND_NOT_CONFIGURED') {
    return proxyError(503, 'BACKEND_NOT_CONFIGURED', 'Máy chủ API SIGMACAR chưa được cấu hình cho môi trường này (thiếu SIGMA_BACKEND_ORIGIN).');
  }
  if (resolved.error) {
    return proxyError(500, resolved.error, 'Cấu hình SIGMA_BACKEND_ORIGIN không hợp lệ (yêu cầu https://host, không kèm đường dẫn).');
  }

  const upstreamUrl = new URL(inUrl.pathname + inUrl.search, resolved.origin);
  if (upstreamUrl.origin !== resolved.origin || !upstreamUrl.pathname.startsWith('/api/v1/')) {
    return proxyError(400, 'BAD_PROXY_PATH', 'Đường dẫn API không hợp lệ.');
  }

  const method = request.method.toUpperCase();
  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > MAX_REQUEST_BODY_BYTES) {
      return proxyError(413, 'PAYLOAD_TOO_LARGE', 'Dung lượng dữ liệu gửi lên vượt quá giới hạn cho phép.');
    }
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_REQUEST_BODY_BYTES) {
      return proxyError(413, 'PAYLOAD_TOO_LARGE', 'Dung lượng dữ liệu gửi lên vượt quá giới hạn cho phép.');
    }
  }

  const timeoutMs = Math.min(Math.max(Number(env.SIGMA_PROXY_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS, 1000), 100000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let upstream;
  try {
    upstream = await fetchImpl(upstreamUrl.toString(), {
      method,
      headers: buildUpstreamHeaders(request, env, inUrl),
      body,
      redirect: 'manual',
      signal: controller.signal
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return proxyError(504, 'UPSTREAM_TIMEOUT', 'Máy chủ API SIGMACAR phản hồi quá thời gian chờ.');
    }
    return proxyError(502, 'BACKEND_UNREACHABLE', 'Không thể kết nối tới máy chủ API SIGMACAR.');
  } finally {
    clearTimeout(timer);
  }

  // A tunnel/CDN error page or a misconfigured origin pointing at a static site returns HTML, never valid API JSON.
  const ctype = (upstream.headers.get('content-type') || '').toLowerCase();
  if (ctype.includes('text/html')) {
    return proxyError(502, 'UPSTREAM_INVALID_RESPONSE', `Máy chủ API trả về HTML thay vì JSON (HTTP ${upstream.status}).`);
  }

  return new Response(method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: buildClientHeaders(upstream, resolved.origin)
  });
}

export async function onRequest(context) {
  return handleProxy(context.request, context.env || {});
}
