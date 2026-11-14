// tests/unit/workers_ai_binding.test.js
// The Worker runtime hands the Cloudflare Workers AI binding (env.AI) to the AI service: POST /api/v1/ai/chat is
// answered by Workers AI through the real runtime + D1 driver (binding stubbed; nothing leaves the machine).

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { D1SqliteShim } = require('../helpers/d1-sqlite-shim');
const tool = require('../../scripts/d1/json-to-d1');

const ROOT = path.resolve(__dirname, '..', '..');

describe('Workers AI binding through the Worker runtime', () => {
  let runtime;
  let env;
  const calls = [];

  before(() => {
    const shim = new D1SqliteShim();
    const src = tool.loadNormalisedSource(path.join(ROOT, 'data', 'sigmacar_store.json'));
    shim.db.exec(tool.buildSql(tool.rowsOf(src.state), { id: 'wai-test', sourceSha: src.sha256, mode: 'full', summary: {}, nowIso: new Date().toISOString() }));
    runtime = require('../../backend/cloudflare/runtime');
    env = {
      DB: shim,
      SIGMACAR_ALLOW_DEV_SEED: 'false',
      AI: { run: async (model, input) => { calls.push({ model, input }); return { choices: [{ message: { content: 'Xin chào, tôi là trợ lý SIGMACAR chạy trên Workers AI.' } }] }; } }
    };
  });

  it('a guest chat message is answered by Workers AI', async () => {
    const res = await runtime.handle(new Request('https://sigma-car.pages.dev/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.30' },
      body: JSON.stringify({ message: 'Xin chào bạn!', history: [] })
    }), env);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.match(json.data.text, /Workers AI/);
    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].model, /^@cf\//);
  });
});
