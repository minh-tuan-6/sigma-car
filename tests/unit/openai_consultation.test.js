// tests/unit/openai_consultation.test.js
// Logged-in advisor with active preferences: the reply is written by the configured AI model (OpenAI) around the
// server-computed shortlist; without a key it keeps the deterministic shortlist text.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-app');

describe('Advisor replies use OpenAI when configured', () => {
  let app = null;
  let token = '';
  let AIService;
  const realFetch = global.fetch;
  const saved = {};

  const chat = (body) => realFetch(`${app.baseUrl}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  }).then(r => r.json().then(j => ({ status: r.status, body: j })));

  before(async () => {
    app = await startTestServer({ mode: 'memory', reseed: true });
    const login = await (await realFetch(`${app.baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'minhhoang.sigma@example.com', password: 'Buyer@123456' }) })).json();
    token = login.data.token;
    AIService = require('../../backend/application/ai-service');
    saved.provider = AIService.config.provider;
    saved.key = AIService.config.openaiApiKey;
  });
  after(async () => {
    global.fetch = realFetch;
    AIService.config.provider = saved.provider;
    AIService.config.openaiApiKey = saved.key;
    if (app) await app.close();
  });

  const body = { persist: true, message: 'Tư vấn xe điện cho gia đình', preferences: { budgetVnd: 2000000000, passengers: 5, chargingAccess: 'home' } };

  it('with an OpenAI key, the reply comes from OpenAI and the shortlist is passed as context', async () => {
    AIService.config.provider = 'openai';
    AIService.config.openaiApiKey = 'sk-test-not-a-real-key';
    let sentSystemPrompt = '';
    global.fetch = async (url, opts) => {
      if (String(url).includes('api.openai.com')) {
        const payload = JSON.parse(opts.body);
        sentSystemPrompt = payload.messages[0].content;
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'OPENAI-REPLY: gợi ý từ GPT.' } }] }), text: async () => '' };
      }
      return realFetch(url, opts);
    };
    const r = await chat(body);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const text = r.body.data.text || r.body.data.reply || JSON.stringify(r.body.data);
    assert.match(text, /OPENAI-REPLY/);
    assert.match(sentSystemPrompt, /DỮ LIỆU ĐÃ LỌC TỪ KHO SIGMACAR/);
    assert.ok(Array.isArray(r.body.data.top3), 'recommendation cards are still returned');
  });

  it('without a key, the deterministic shortlist reply is kept (no OpenAI call)', async () => {
    AIService.config.provider = 'openai';
    AIService.config.openaiApiKey = '';
    let openaiCalls = 0;
    global.fetch = async (url, opts) => { if (String(url).includes('api.openai.com')) openaiCalls++; return realFetch(url, opts); };
    const r = await chat(body);
    assert.equal(r.status, 200);
    const text = r.body.data.text || r.body.data.reply || '';
    assert.match(text, /Dựa trên tiêu chí thực tế|Hiện không có mẫu xe/);
    assert.equal(openaiCalls, 0);
  });

  it('if OpenAI fails, the shortlist reply is used instead of an error', async () => {
    AIService.config.provider = 'openai';
    AIService.config.openaiApiKey = 'sk-test-not-a-real-key';
    global.fetch = async (url, opts) => {
      if (String(url).includes('api.openai.com')) return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' };
      return realFetch(url, opts);
    };
    const r = await chat(body);
    assert.equal(r.status, 200);
    assert.match(r.body.data.text || '', /Dựa trên tiêu chí thực tế|Hiện không có mẫu xe/);
  });
});
