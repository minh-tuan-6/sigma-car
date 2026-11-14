// tests/unit/openai_default.test.js
// OpenAI is the default AI provider; without OPENAI_API_KEY the chat still answers with the built-in local engine.

require('../helpers/isolated-store');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('OpenAI default provider', () => {
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
  after(() => {
    global.fetch = realFetch;
    AIService.config.provider = saved.provider;
    AIService.config.openaiApiKey = saved.key;
  });

  it('defaults to openai (config and service) and advertises it as the default', () => {
    assert.equal(config.ai.provider, 'openai');
    assert.equal(AIService.config.provider, 'openai');
    const cfg = AIService.getPublicConfig();
    assert.equal(cfg.provider, 'openai');
    assert.match(cfg.supportedProviders.find(p => p.id === 'openai').name, /Mặc định/);
  });

  it('without an API key it answers with the local engine and makes no network call', async () => {
    AIService.config.provider = 'openai';
    AIService.config.openaiApiKey = '';
    let calls = 0;
    global.fetch = async () => { calls++; throw new Error('no network in this test'); };
    const res = await AIService.chat({ message: 'Xin chào bạn!' });
    assert.ok(res && res.text && res.text.length > 0);
    assert.equal(calls, 0);
  });

  it('with an API key it calls the OpenAI chat completions endpoint', async () => {
    AIService.config.provider = 'openai';
    AIService.config.openaiApiKey = 'sk-test-not-a-real-key';
    const seen = [];
    global.fetch = async (url, opts) => {
      seen.push({ url: String(url), auth: opts && opts.headers && (opts.headers.Authorization || opts.headers.authorization) });
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Xin chào từ OpenAI.' } }] }), text: async () => '' };
    };
    const res = await AIService.chat({ message: 'Xin chào bạn!' });
    const openaiCall = seen.find(c => c.url.includes('api.openai.com/v1/chat/completions'));
    assert.ok(openaiCall, `OpenAI endpoint called (saw: ${seen.map(s => s.url).join(', ')})`);
    assert.equal(openaiCall.auth, 'Bearer sk-test-not-a-real-key');
    assert.ok(res && typeof res.text === 'string' && res.text.length > 0);
  });
});
