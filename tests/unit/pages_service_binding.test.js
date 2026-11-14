// Pages Function → Worker through the SIGMA_API service binding (functions/api/v1/[[path]].js).
// The binding path must keep every guarantee of the HTTP proxy path: fixed upstream, header sanitising, proxy secret,
// timeout, HTML guard, body limit, cookie/redirect rewriting.

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const PROXY_FILE = pathToFileURL(path.resolve(__dirname, '..', '..', 'functions', 'api', 'v1', '[[path]].js')).href;
let proxy;
before(async () => {
  proxy = await import(PROXY_FILE);
});

function binding(responder) {
  const calls = [];
  return {
    calls,
    async fetch(request) {
      calls.push(request);
      return responder(request);
    }
  };
}

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
});

describe('Pages Function: SIGMA_API service binding', () => {
  it('prefers the binding over SIGMA_BACKEND_ORIGIN and never calls the public network', async () => {
    const api = binding(() => json(200, { success: true, data: [] }));
    let networkCalls = 0;
    const res = await proxy.handleProxy(
      new Request('https://sigma-car.pages.dev/api/v1/vehicles?brand=Tesla'),
      { SIGMA_API: api, SIGMA_BACKEND_ORIGIN: 'https://old-node.example' },
      { fetch: async () => { networkCalls++; return json(500, {}); } }
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(networkCalls, 0);
    assert.strictEqual(api.calls.length, 1);
    const sent = new URL(api.calls[0].url);
    assert.strictEqual(sent.origin, proxy.SERVICE_BINDING_ORIGIN);
    assert.strictEqual(sent.pathname + sent.search, '/api/v1/vehicles?brand=Tesla');
    assert.strictEqual(res.headers.get('x-sigma-proxy'), '1');
  });

  it('strips client-supplied secrets and forwarding headers, then adds the configured ones', async () => {
    const api = binding(() => json(200, { success: true }));
    await proxy.handleProxy(new Request('https://sigma-car.pages.dev/api/v1/auth/me', {
      headers: {
        Authorization: 'Bearer abc',
        'X-Sigma-Proxy-Secret': 'forged',
        'X-Forwarded-For': '6.6.6.6',
        'CF-Connecting-IP': '203.0.113.9'
      }
    }), { SIGMA_API: api, SIGMA_PROXY_SHARED_SECRET: 's'.repeat(40) });
    const h = api.calls[0].headers;
    assert.strictEqual(h.get('authorization'), 'Bearer abc');
    assert.strictEqual(h.get('x-sigma-proxy-secret'), 's'.repeat(40));
    assert.strictEqual(h.get('x-forwarded-for'), '203.0.113.9');
    assert.strictEqual(h.get('cf-connecting-ip'), '203.0.113.9');
    assert.strictEqual(h.get('x-forwarded-host'), 'sigma-car.pages.dev');
  });

  it('forwards the request body and method, and passes API errors through unchanged', async () => {
    const api = binding(async (req) => {
      const body = await req.text();
      return json(409, { success: false, error: { code: 'CART_VERSION_CONFLICT', echo: body } });
    });
    const res = await proxy.handleProxy(new Request('https://sigma-car.pages.dev/api/v1/cart', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 3 })
    }), { SIGMA_API: api });
    assert.strictEqual(api.calls[0].method, 'PATCH');
    assert.strictEqual(res.status, 409);
    const data = await res.json();
    assert.strictEqual(data.error.code, 'CART_VERSION_CONFLICT');
    assert.strictEqual(data.error.echo, '{"expectedVersion":3}');
  });

  it('keeps the HTML guard, the body limit and non-API path rejection', async () => {
    const htmlApi = binding(() => new Response('<html>oops</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    const r1 = await proxy.handleProxy(new Request('https://sigma-car.pages.dev/api/v1/vehicles'), { SIGMA_API: htmlApi });
    assert.strictEqual(r1.status, 502);
    assert.strictEqual(r1.headers.get('x-sigma-proxy-error'), 'UPSTREAM_INVALID_RESPONSE');

    const api = binding(() => json(200, {}));
    const big = await proxy.handleProxy(new Request('https://sigma-car.pages.dev/api/v1/media/upload', {
      method: 'POST', headers: { 'Content-Length': String(11 * 1024 * 1024) }, body: 'x'
    }), { SIGMA_API: api });
    assert.strictEqual(big.status, 413);
    assert.strictEqual(api.calls.length, 0);

    const other = await proxy.handleProxy(new Request('https://sigma-car.pages.dev/assets/x.glb'), { SIGMA_API: api });
    assert.strictEqual(other.status, 404);
  });

  it('maps a failing or hanging Worker to 502 / 504 JSON', async () => {
    const broken = binding(() => { throw new Error('Worker threw exception'); });
    const r1 = await proxy.handleProxy(new Request('https://sigma-car.pages.dev/api/v1/health'), { SIGMA_API: broken });
    assert.strictEqual(r1.status, 502);
    assert.strictEqual((await r1.json()).error.code, 'BACKEND_UNREACHABLE');

    const hanging = {
      fetch: (request) => new Promise((_, reject) => {
        request.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })
    };
    const r2 = await proxy.handleProxy(new Request('https://sigma-car.pages.dev/api/v1/health'), { SIGMA_API: hanging, SIGMA_PROXY_TIMEOUT_MS: '1000' });
    assert.strictEqual(r2.status, 504);
    assert.strictEqual((await r2.json()).error.code, 'UPSTREAM_TIMEOUT');
  });

  it('falls back to the HTTP proxy (previous architecture, rollback path) when no binding is configured', async () => {
    let calledUrl = null;
    const res = await proxy.handleProxy(new Request('https://sigma-car.pages.dev/api/v1/health'),
      { SIGMA_BACKEND_ORIGIN: 'https://api.sigmacar.test' },
      { fetch: async (url) => { calledUrl = url; return json(200, { success: true }); } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(calledUrl, 'https://api.sigmacar.test/api/v1/health');
  });
});
