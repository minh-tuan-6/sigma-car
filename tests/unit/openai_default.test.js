// tests/unit/openai_default.test.js
// AI provider defaults: Cloudflare Workers AI (binding env.AI, no API key) is the default; without the binding (Node,
// tests) or when it fails, the chat answers with the built-in local engine. OpenAI still works when selected.

require('../helpers/isolated-store');

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('AI provider defaults', () => {
  let AIService;
  let config;
  const realFetch = global.fetch;
  const saved = {};

  before(() => {
    delete process.env.AI_PROVIDER;
    config = require('../../backend/config');
    AIService = require('../../backend/application/ai-service');
    saved.provider = AIService.config.provider;
    saved.key = AIService.config.openaiApiKey;
  });
  afterEach(() => {
    global.fetch = realFetch;
    AIService.setWorkersAiBinding(null);
    AIService.config.provider = saved.provider;
    AIService.config.openaiApiKey = saved.key;
  });
  after(() => { global.fetch = realFetch; });

  it('defaults to Cloudflare Workers AI and advertises it as the default', () => {
    assert.equal(config.ai.provider, 'workers-ai');
    assert.equal(AIService.config.provider, 'workers-ai');
    const cfg = AIService.getPublicConfig();
    assert.equal(cfg.provider, 'workers-ai');
    assert.match(cfg.supportedProviders.find(p => p.id === 'workers-ai').name, /Mặc định/);
    assert.doesNotMatch(cfg.supportedProviders.find(p => p.id === 'openai').name, /Mặc định/);
  });

  it('without the AI binding (Node / tests) it answers with the local engine and makes no network call', async () => {
    let calls = 0;
    global.fetch = async () => { calls++; throw new Error('no network in this test'); };
    const res = await AIService.chat({ message: 'Xin chào bạn!' });
    assert.ok(res && res.text && res.text.length > 0);
    assert.equal(calls, 0);
    assert.equal(AIService.getPublicConfig().isWorkersAiConfigured, false);
  });

  it('with the binding it answers through Workers AI (chat-completions and { response } formats)', async () => {
    const seen = [];
    AIService.setWorkersAiBinding({ run: async (model, input) => { seen.push({ model, input }); return { choices: [{ message: { content: 'WORKERS-AI-REPLY' } }] }; } });
    const r1 = await AIService.chat({ message: 'Xin chào bạn!' });
    assert.match(r1.text, /WORKERS-AI-REPLY/);
    assert.equal(seen[0].model, AIService.config.workersAiModel);
    assert.equal(seen[0].input.messages[0].role, 'system');
    assert.equal(seen[0].input.messages.at(-1).content, 'Xin chào bạn!');
    assert.ok(seen[0].input.max_tokens >= 512);

    AIService.setWorkersAiBinding({ run: async () => ({ response: 'LEGACY-FORMAT-REPLY' }) });
    const r2 = await AIService.chat({ message: 'Xin chào bạn!' });
    assert.match(r2.text, /LEGACY-FORMAT-REPLY/);
    assert.equal(AIService.getPublicConfig().isWorkersAiConfigured, true);
  });

  it('if Workers AI fails (e.g. daily allowance used up) it falls back to the local engine', async () => {
    AIService.setWorkersAiBinding({ run: async () => { throw new Error('4006: you have used up your daily free allocation'); } });
    const res = await AIService.chat({ message: 'Xin chào bạn!' });
    assert.ok(res && res.text && res.text.length > 0);
    assert.doesNotMatch(res.text, /4006|allocation/);
  });

  it('grounded replies (advisor shortlist) also use Workers AI', async () => {
    let sentSystem = '';
    AIService.setWorkersAiBinding({ run: async (m, input) => { sentSystem = input.messages[0].content; return { response: 'GROUNDED' }; } });
    const text = await AIService.generateGroundedReply({ message: 'Tư vấn xe', facts: '1. **Tesla Cybertruck** — 7.500.000.000 VNĐ' });
    assert.equal(text, 'GROUNDED');
    assert.match(sentSystem, /DỮ LIỆU ĐÃ LỌC TỪ KHO SIGMACAR/);
    AIService.setWorkersAiBinding(null);
    assert.equal(await AIService.generateGroundedReply({ message: 'x', facts: 'y' }), null, 'no binding → caller keeps its template');
  });

  it('OpenAI still works when an admin selects it and a key is set', async () => {
    AIService.config.provider = 'openai';
    AIService.config.openaiApiKey = 'sk-test-not-a-real-key';
    const seen = [];
    global.fetch = async (url, opts) => {
      seen.push({ url: String(url), auth: opts && opts.headers && (opts.headers.Authorization || opts.headers.authorization) });
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Xin chào từ OpenAI.' } }] }), text: async () => '' };
    };
    const res = await AIService.chat({ message: 'Xin chào bạn!' });
    const call = seen.find(c => c.url.includes('api.openai.com/v1/chat/completions'));
    assert.ok(call);
    assert.equal(call.auth, 'Bearer sk-test-not-a-real-key');
    assert.ok(res.text.length > 0);
  });
});
