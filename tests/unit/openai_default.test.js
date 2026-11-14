// tests/unit/openai_default.test.js
// AI provider defaults: the built-in local engine is the default (no API key). OpenAI still works when an admin selects
// it and a key is configured.

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
    AIService.config.provider = saved.provider;
    AIService.config.openaiApiKey = saved.key;
  });
  after(() => { global.fetch = realFetch; });

  it('defaults to the built-in local engine', () => {
    assert.equal(config.ai.provider, 'local-automotive');
    assert.equal(AIService.config.provider, 'local-automotive');
    const cfg = AIService.getPublicConfig();
    assert.equal(cfg.provider, 'local-automotive');
    assert.ok(!cfg.supportedProviders.some(p => p.id === 'workers-ai'), 'Workers AI removed');
    assert.match(cfg.supportedProviders.find(p => p.id === 'local-automotive').name, /Mặc định/);
  });

  it('answers locally without any network call', async () => {
    let calls = 0;
    global.fetch = async () => { calls++; throw new Error('no network in this test'); };
    const res = await AIService.chat({ message: 'Xin chào bạn!' });
    assert.ok(res && res.text && res.text.length > 0);
    assert.equal(calls, 0);
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
