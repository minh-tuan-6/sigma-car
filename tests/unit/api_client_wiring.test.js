// tests/unit/api_client_wiring.test.js
// Phase 1 (PLAN.md T1.1–T1.8, T1.18): js/api-client.js methods and field mappings that the existing views call.

require('../helpers/isolated-store'); // never touch data/ from a unit test

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadClient(fetchImpl) {
  const storage = new Map();
  const ls = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k)
  };
  const sandbox = {
    console, Date, Math, JSON, URL, URLSearchParams, Error, Number, String, Boolean, Array, Object, Set, Map, Promise,
    setTimeout, clearTimeout, AbortController,
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    localStorage: ls,
    sessionStorage: ls,
    fetch: fetchImpl
  };
  sandbox.window = { location: { hostname: 'sigma-car.pages.dev', hash: '' }, dispatchEvent: () => true };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const root = path.resolve(__dirname, '..', '..');
  for (const rel of ['js/data.js', 'js/static-sandbox.js', 'js/api-client.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
  }
  return vm.runInContext('ApiClient', sandbox);
}

const plain = (o) => JSON.parse(JSON.stringify(o));
const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (n) => (String(n).toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : (String(n).toLowerCase() === 'x-sigma-proxy' ? '1' : null)) },
  text: async () => JSON.stringify(body),
  json: async () => body
});

// Records requests and answers each with the handler's {status, body}.
function recordingClient(handler) {
  const calls = [];
  const client = loadClient(async (url, opts = {}) => {
    const call = { url: String(url), method: (opts.method || 'GET').toUpperCase(), body: opts.body ? JSON.parse(opts.body) : undefined };
    calls.push(call);
    const { status = 200, body = { success: true, data: {} } } = handler(call) || {};
    return jsonRes(status, body);
  });
  return { client, calls };
}

describe('T1.1 reviews client', () => {
  it('getForVehicle returns the raw server shape with the expected query', async () => {
    const serverData = { stats: { averageRating: 4.5, totalReviews: 2 }, reviews: [{ id: 'r1', isOwner: true }], questions: [], currentUserEligibility: { isLoggedIn: true } };
    const { client, calls } = recordingClient(() => ({ body: { success: true, data: serverData } }));
    const data = await client.reviews.getForVehicle({ vehicleId: 'vf8', star: 5, verifiedOnly: true, sort: 'newest' });
    assert.deepStrictEqual(plain(data), serverData);
    const u = new URL(calls[0].url, 'https://x.test');
    assert.strictEqual(u.pathname, '/api/v1/reviews');
    assert.strictEqual(u.searchParams.get('vehicleId'), 'vf8');
    assert.strictEqual(u.searchParams.get('star'), '5');
    assert.strictEqual(u.searchParams.get('verifiedOnly'), 'true');
    assert.strictEqual(u.searchParams.get('sort'), 'newest');
  });

  it('delete / toggleHelpful aliases hit the existing endpoints and keep the message', async () => {
    const { client, calls } = recordingClient(() => ({ body: { success: true, message: 'ok-msg', data: { id: 'r1' } } }));
    const del = await client.reviews.delete('r1');
    const help = await client.reviews.toggleHelpful('r1');
    assert.strictEqual(calls[0].method, 'DELETE');
    assert.ok(calls[0].url.endsWith('/reviews/r1'));
    assert.strictEqual(calls[1].method, 'POST');
    assert.ok(calls[1].url.endsWith('/reviews/r1/helpful'));
    assert.strictEqual(del.message, 'ok-msg');
    assert.strictEqual(help.message, 'ok-msg');
  });

  it('answerQuestion accepts a plain string (as app.js passes it) and an object', async () => {
    const { client, calls } = recordingClient(() => ({ body: { success: true, message: 'answered', data: { id: 'q1' } } }));
    const res = await client.reviews.answerQuestion('q1', 'Câu trả lời thử nghiệm');
    await client.reviews.answerQuestion('q1', { content: 'Dạng object' });
    assert.deepStrictEqual(calls[0].body, { content: 'Câu trả lời thử nghiệm' });
    assert.deepStrictEqual(calls[1].body, { content: 'Dạng object' });
    assert.strictEqual(res.message, 'answered');
  });
});

describe('T1.2 / T1.8 aliases', () => {
  it('financing.listApplications and inventory.list delegate to the existing methods', async () => {
    const { client, calls } = recordingClient((c) => ({ body: { success: true, data: [{ url: c.url }] } }));
    const apps = await client.financing.listApplications();
    const inv = await client.inventory.list({ branchId: 'hn-caugiay' });
    assert.ok(calls[0].url.endsWith('/financing/applications'));
    assert.ok(calls[1].url.endsWith('/inventory?branchId=hn-caugiay'));
    assert.strictEqual(apps.length, 1);
    assert.strictEqual(inv.length, 1);
  });
});

describe('T1.3 setSavedCar', () => {
  it('toggles once when the server ends in the wanted state', async () => {
    const { client, calls } = recordingClient(() => ({ body: { success: true, data: { saved: true, savedCars: ['vf8'] } } }));
    const r = await client.auth.setSavedCar('vf8', true);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(r.saved, true);
  });

  it('toggles back when the server state had drifted (never re-adds a car the user removed)', async () => {
    let saved = false; // server did NOT have the car; the user asks to remove it
    const { client, calls } = recordingClient(() => { saved = !saved; return { body: { success: true, data: { saved, savedCars: saved ? ['vf8'] : [] } } }; });
    const r = await client.auth.setSavedCar('vf8', false);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(r.saved, false);
  });
});

describe('T1.4 order timeline mapping', () => {
  it('adds label/detail/at to history entries and keeps the originals', async () => {
    const { client } = recordingClient(() => ({ body: { success: true, data: { orderId: 'o1', events: [{ status: 'Confirmed', paymentStatus: 'Deposit_Paid', note: 'Đã cọc', timestamp: '2026-11-01T03:00:00.000Z' }] } } }));
    const tl = await client.orders.getTimeline('o1');
    assert.strictEqual(tl.events.length, 1);
    const ev = tl.events[0];
    assert.strictEqual(ev.label, 'Confirmed · Deposit_Paid');
    assert.strictEqual(ev.detail, 'Đã cọc');
    assert.ok(ev.at && ev.at.length > 0);
    assert.strictEqual(ev.status, 'Confirmed');
    assert.strictEqual(tl.orderId, 'o1');
  });
});

describe('T1.5 returns.create', () => {
  it('forwards mediaIds and does not resend signed media URLs as photos', async () => {
    const { client, calls } = recordingClient(() => ({ status: 201, body: { success: true, data: { returnCode: 'RT-1' } } }));
    await client.returns.create({
      orderId: 'o1',
      photos: ['/api/v1/media/med_1?exp=1&token=abc', 'https://cdn.example.test/evidence/front.jpg?v=2'],
      mediaIds: ['med_1']
    });
    const body = calls[0].body;
    assert.deepStrictEqual(body.mediaIds, ['med_1']);
    assert.strictEqual(body.photos.length, 1);
    assert.strictEqual(body.photos[0].name, 'front.jpg');
  });

  it('without mediaIds keeps the previous photo behaviour', async () => {
    const { client, calls } = recordingClient(() => ({ status: 201, body: { success: true, data: {} } }));
    await client.returns.create({ orderId: 'o1', photos: ['https://cdn.example.test/a.png'] });
    assert.strictEqual(calls[0].body.mediaIds, undefined);
    assert.strictEqual(calls[0].body.photos[0].name, 'a.png');
  });
});

describe('T1.6 guest ticket access token', () => {
  it('remembers the token returned at creation and sends it on lookup, reply and rate', async () => {
    const { client, calls } = recordingClient((c) => {
      if (c.url.endsWith('/support/tickets') && c.method === 'POST') {
        return { status: 201, body: { success: true, data: { id: 'tk1', ticketCode: 'TCK-1', accessToken: 'guest-token-1' } } };
      }
      return { body: { success: true, data: { id: 'tk1', messages: [] } } };
    });
    await client.support.createTicket({ subject: 's', attachments: [{ name: 'a.png?x=1', url: 'https://x/a.png?x=1' }] });
    assert.strictEqual(calls[0].body.attachments[0].name, 'a.png');
    await client.support.lookupTicket('TCK-1');
    await client.support.replyTicket('tk1', { content: 'hi' });
    await client.support.rate('tk1', { rating: 5 });
    assert.ok(calls[1].url.includes('accessToken=guest-token-1'));
    assert.strictEqual(calls[2].body.accessToken, 'guest-token-1');
    assert.strictEqual(calls[3].body.accessToken, 'guest-token-1');
  });

  it('logged-in lookups without a stored token are unchanged', async () => {
    const { client, calls } = recordingClient(() => ({ body: { success: true, data: { messages: [] } } }));
    await client.support.lookupTicket('TCK-9');
    assert.ok(!calls[0].url.includes('accessToken'));
  });
});

describe('T1.7 test-drive slots', () => {
  it('maps remainingCapacity/isAvailable and top-level homeServiceDistricts', async () => {
    const { client } = recordingClient(() => ({ body: { success: true, data: { homeServiceDistricts: ['Cầu Giấy'], slots: [
      { timeSlot: '09:00', remainingCapacity: 1, isAvailable: true },
      { timeSlot: '10:30', remainingCapacity: 0, isAvailable: false }
    ] } } }));
    const res = await client.appointments.getSlots({ branchId: 'hn-caugiay', date: '2026-12-01' });
    assert.strictEqual(res.slots[0].remaining, 1);
    assert.strictEqual(res.slots[1].remaining, 0);
    assert.deepStrictEqual(plain(res.branch.homeServiceDistricts), ['Cầu Giấy']);
  });
});

describe('T1.18 offline financing matches the server calculator', () => {
  const FinancingService = require('../../backend/application/financing-service');
  const offline = loadClient(async () => { throw new TypeError('Failed to fetch'); });
  const cases = [
    { vehiclePrice: 1200000000, downPaymentPercent: 30, annualInterestRatePercent: 7.9, termMonths: 60, repaymentMethod: 'annuity' },
    { vehiclePrice: 850000000, downPaymentPercent: 20, annualInterestRatePercent: 9.5, termMonths: 84, repaymentMethod: 'equal_principal', monthlyIncome: 60000000, monthlyObligation: 5000000 },
    { vehiclePrice: 500000000, downPaymentPercent: 0, annualInterestRatePercent: 0, termMonths: 36, repaymentMethod: 'annuity' },
    { vehiclePrice: 1000000000, downPaymentPercent: 20, annualInterestRatePercent: 8, termMonths: 60, repaymentMethod: 'flat', monthlyIncome: 45000000 }
  ];
  for (const c of cases) {
    it(`${c.repaymentMethod} ${c.annualInterestRatePercent}% ${c.termMonths}m`, async () => {
      const server = FinancingService.calculateLoan(c);
      const local = await offline.financing.calculate(c);
      for (const k of ['downPaymentAmount', 'financedPrincipal', 'monthlyPayment', 'firstMonthPayment', 'firstMonthPrincipal', 'lastMonthPayment', 'totalInterest', 'totalCostOfLoan']) {
        assert.strictEqual(local[k], server[k], `${k}: offline ${local[k]} vs server ${server[k]}`);
      }
      if (server.affordability) {
        assert.strictEqual(local.affordability.dtiPercent, server.affordability.dtiPercent);
        assert.strictEqual(local.affordability.riskBand, server.affordability.riskBand);
      }
    });
  }
});
