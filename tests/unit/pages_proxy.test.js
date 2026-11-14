// Unit tests for the Cloudflare Pages Function reverse proxy (functions/api/v1/[[path]].js).
// The function uses only Web-standard APIs (Request/Response/Headers/fetch), which Node 18+ provides.

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const PROXY_FILE = pathToFileURL(path.resolve(__dirname, '..', '..', 'functions', 'api', 'v1', '[[path]].js')).href;
const ORIGIN = 'https://api.sigmacar.test';

let proxy;
before(async () => {
  proxy = await import(PROXY_FILE);
});

function recordingFetch(responder) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return responder(url, init);
  };
  fn.calls = calls;
  return fn;
}

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
});

describe('Pages Function proxy: configuration', () => {
  it('returns a JSON 503 BACKEND_NOT_CONFIGURED (never HTML) when SIGMA_BACKEND_ORIGIN is missing', async () => {
    const res = await proxy.handleProxy(new Request('https://sigma-car.pages.dev/api/v1/vehicles'), {});
    assert.strictEqual(res.status, 503);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.strictEqual(res.headers.get('x-sigma-proxy-error'), 'BACKEND_NOT_CONFIGURED');
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'BACKEND_NOT_CONFIGURED');
  });

  it('rejects non-https, path-bearing or credentialed origins', () => {
    for (const bad of ['http://api.x.test', 'https://api.x.test/base', 'https://u:p@api.x.test', 'ftp://x', 'not a url']) {
      assert.ok(proxy.resolveBackendOrigin({ SIGMA_BACKEND_ORIGIN: bad }).error, bad);
    }
    assert.deepStrictEqual(proxy.resolveBackendOrigin({ SIGMA_BACKEND_ORIGIN: 'https://api.x.test/' }), { origin: 'https://api.x.test' });
    assert.deepStrictEqual(proxy.resolveBackendOrigin({ SIGMA_BACKEND_ORIGIN: 'http://localhost:3000', SIGMA_BACKEND_ALLOW_HTTP: 'true' }), { origin: 'http://localhost:3000' });
  });
});

describe('Pages Function proxy: forwarding', () => {
  it('preserves method, path, query, body and status; forwards client IP; strips spoofable headers', async () => {
    const f = recordingFetch(() => json(201, { success: true, data: { id: 'q1' } }, { 'X-Request-Id': 'req_abc' }));
    const req = new Request('https://sigma-car.pages.dev/api/v1/quotes?branch=hn&x=1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok',
        'CF-Connecting-IP': '203.0.113.9',
        'X-Forwarded-For': '6.6.6.6',
        'X-Sigma-Proxy-Secret': 'client-forged'
      },
      body: JSON.stringify({ items: [1] })
    });
    const res = await proxy.handleProxy(req, { SIGMA_BACKEND_ORIGIN: ORIGIN, SIGMA_PROXY_SHARED_SECRET: 's'.repeat(40) }, { fetch: f });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.headers.get('x-request-id'), 'req_abc');
    assert.strictEqual(res.headers.get('x-sigma-proxy'), '1');
    assert.deepStrictEqual(await res.json(), { success: true, data: { id: 'q1' } });

    assert.strictEqual(f.calls.length, 1);
    const { url, init } = f.calls[0];
    assert.strictEqual(url, `${ORIGIN}/api/v1/quotes?branch=hn&x=1`);
    assert.strictEqual(init.method, 'POST');
    assert.strictEqual(init.redirect, 'manual');
    assert.strictEqual(new TextDecoder().decode(init.body), JSON.stringify({ items: [1] }));
    assert.strictEqual(init.headers.get('authorization'), 'Bearer tok');
    assert.strictEqual(init.headers.get('x-forwarded-for'), '203.0.113.9', 'client-supplied XFF must be replaced');
    assert.strictEqual(init.headers.get('x-sigma-proxy-secret'), 's'.repeat(40), 'client-forged secret must be replaced by the configured one');
    assert.strictEqual(init.headers.get('x-forwarded-proto'), 'https');
  });

  it('cannot be turned into an open proxy (upstream host is fixed; dot-segments are normalised)', async () => {
    const f = recordingFetch(() => json(200, { success: true }));
    const env = { SIGMA_BACKEND_ORIGIN: ORIGIN };
    await proxy.handleProxy(new Request('https://sigma-car.pages.dev/api/v1///evil.example/x'), env, { fetch: f });
    assert.ok(f.calls.every(c => new URL(c.url).origin === ORIGIN));
    const escaped = await proxy.handleProxy(new Request('https://sigma-car.pages.dev/api/v1/../../admin'), env, { fetch: f });
    assert.strictEqual(escaped.status, 404);
  });

  it('maps upstream HTML (tunnel error page / static site) to JSON 502 UPSTREAM_INVALID_RESPONSE', async () => {
    const f = recordingFetch(() => new Response('<!DOCTYPE html><title>Bad gateway</title>', { status: 502, headers: { 'Content-Type': 'text/html' } }));
    const res = await proxy.handleProxy(new Request('https://x.pages.dev/api/v1/vehicles'), { SIGMA_BACKEND_ORIGIN: ORIGIN }, { fetch: f });
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.headers.get('x-sigma-proxy-error'), 'UPSTREAM_INVALID_RESPONSE');
  });

  it('maps network failure to 502 BACKEND_UNREACHABLE and timeouts to 504 UPSTREAM_TIMEOUT', async () => {
    const down = await proxy.handleProxy(new Request('https://x.pages.dev/api/v1/vehicles'), { SIGMA_BACKEND_ORIGIN: ORIGIN }, {
      fetch: async () => { throw new TypeError('fetch failed'); }
    });
    assert.strictEqual(down.status, 502);
    assert.strictEqual(down.headers.get('x-sigma-proxy-error'), 'BACKEND_UNREACHABLE');

    const slow = await proxy.handleProxy(new Request('https://x.pages.dev/api/v1/vehicles'), { SIGMA_BACKEND_ORIGIN: ORIGIN, SIGMA_PROXY_TIMEOUT_MS: '1000' }, {
      fetch: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    });
    assert.strictEqual(slow.status, 504);
    assert.strictEqual(slow.headers.get('x-sigma-proxy-error'), 'UPSTREAM_TIMEOUT');
  });

  it('passes upstream API errors (401/404/409) through unchanged', async () => {
    for (const status of [401, 404, 409, 429]) {
      const f = recordingFetch(() => json(status, { success: false, error: { code: `E${status}` } }));
      const res = await proxy.handleProxy(new Request('https://x.pages.dev/api/v1/cart'), { SIGMA_BACKEND_ORIGIN: ORIGIN }, { fetch: f });
      assert.strictEqual(res.status, status);
      assert.strictEqual(res.headers.get('x-sigma-proxy-error'), null);
      assert.strictEqual((await res.json()).error.code, `E${status}`);
    }
  });

  it('keeps redirects and cookies on the Pages host', async () => {
    const f = recordingFetch(() => new Response(null, {
      status: 302,
      headers: [['Location', `${ORIGIN}/api/v1/auth/me`], ['Set-Cookie', 'sid=1; Domain=api.sigmacar.test; Path=/; HttpOnly'], ['Content-Type', 'application/json']]
    }));
    const res = await proxy.handleProxy(new Request('https://x.pages.dev/api/v1/auth/login', { method: 'POST', body: '{}' }), { SIGMA_BACKEND_ORIGIN: ORIGIN }, { fetch: f });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), '/api/v1/auth/me');
    assert.doesNotMatch(res.headers.get('set-cookie'), /Domain=/i);
  });

  it('rejects oversized request bodies with 413 before contacting the backend', async () => {
    const f = recordingFetch(() => json(200, {}));
    const res = await proxy.handleProxy(new Request('https://x.pages.dev/api/v1/media', {
      method: 'POST', headers: { 'Content-Length': String(11 * 1024 * 1024) }, body: 'x'
    }), { SIGMA_BACKEND_ORIGIN: ORIGIN }, { fetch: f });
    assert.strictEqual(res.status, 413);
    assert.strictEqual(f.calls.length, 0);
  });
});
