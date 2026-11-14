// tests/unit/local_ai_brain.test.js
// Sigma Brain — the smarter built-in local AI (backend/application/local-ai).

require('../helpers/isolated-store');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../backend/application/local-ai/text');
const { createBrain } = require('../../backend/application/local-ai/sigma-brain');
const FinancingService = require('../../backend/application/financing-service');
const TcoService = require('../../backend/application/tco-service');
const { dbState } = require('../../backend/infrastructure/storage-engine');
const AIService = require('../../backend/application/ai-service');

const brain = createBrain({ getVehicles: () => dbState.vehicles, FinancingService, TcoService });
const ask = (message, history = []) => brain.answer({ message, history });
const turn = (u, a) => [{ role: 'user', text: u }, { role: 'assistant', text: a }];

describe('local-ai text parsing', () => {
  it('parses Vietnamese money and budgets', () => {
    assert.equal(T.extractBudget(T.norm('tôi có 1 tỷ 2')).maxPrice, 1.2e9);
    assert.equal(T.extractBudget(T.norm('dưới 800tr')).maxPrice, 8e8);
    assert.deepEqual(T.extractBudget(T.norm('từ 500 triệu đến 1 tỷ')), { minPrice: 5e8, maxPrice: 1e9 });
    assert.equal(T.extractBudget(T.norm('trên 2 tỷ')).minPrice, 2e9);
    assert.equal(T.extractBudget(T.norm('tầm 1,5 tỷ')).around, 1.5e9);
    assert.equal(T.extractBudget(T.norm('trả góp mỗi tháng khoảng 20 triệu')).monthlyMax, 2e7);
  });
  it('parses seats, fuel (with negation), usage, ranking, loan terms and daily km', () => {
    assert.equal(T.extractSeats(T.norm('xe bảy chỗ')), 7);
    assert.equal(T.extractFuel(T.norm('xe điện'), 'xe điện').want, 'ev');
    assert.deepEqual(T.extractFuel(T.norm('không thích xe xăng'), 'không thích xe xăng').exclude, ['gas']);
    assert.ok(T.extractUsages(T.norm('đi phố, chở gia đình')).includes('family'));
    assert.equal(T.extractSort(T.norm('xe nào rẻ nhất')), 'price-asc');
    assert.deepEqual(T.extractLoanTerms(T.norm('trả trước 30% trong 5 năm lãi 8%')), { downPaymentPercent: 30, termMonths: 60, annualRate: 8 });
    assert.equal(T.extractDailyKm(T.norm('mỗi ngày đi 60 km')), 60);
    assert.equal(T.extractOrdinal(T.norm('chiếc thứ 2 thì sao')), 1);
  });
});

describe('Sigma Brain answers', () => {
  it('recognises cars by nickname / without accents / compact form', () => {
    assert.match(ask('giá vf9').text, /VF 9[\s\S]*2\.169\.000\.000/);
    assert.match(ask('Porsche 911 tăng tốc bao nhiêu giây').text, /Porsche 911[\s\S]*3\.4s/);
    assert.match(ask('cybertruck co may cho').text, /Cybertruck[\s\S]*chỗ/);
  });

  it('does not treat seat counts as a car name ("7 chỗ" is not "VF 9 Plus 7 Chỗ")', () => {
    const r = ask('tìm xe gia đình 7 chỗ dưới 1 tỷ');
    assert.match(r.text, /chưa có mẫu nào/);
    assert.match(r.text, /linh hoạt ngân sách[\s\S]*VF 9/);
    assert.match(r.text, /giữ nguyên ngân sách[\s\S]*5 chỗ/);
  });

  it('asks which one when a model name is ambiguous, then resolves "chiếc thứ 2"', () => {
    const a = ask('civic');
    assert.match(a.text, /3 mẫu/);
    const b = ask('chiếc thứ 2', turn('civic', a.text));
    assert.match(b.text, /Civic Type R/);
  });

  it('remembers the car under discussion (pronouns)', () => {
    const h = turn('xe camry có tốt không', ask('xe camry có tốt không').text);
    const r = ask('nó tốn bao nhiêu tiền xăng mỗi tháng nếu đi 30km/ngày', h);
    assert.match(r.text, /Camry[\s\S]*900 km\/tháng[\s\S]*Tiền xăng/);
    const c = ask('xe này sạc bao lâu', h);
    assert.match(c.text, /không cần sạc/);
  });

  it('refines the previous search ("còn xe điện thì sao")', () => {
    const first = 'tìm xe gia đình 7 chỗ dưới 1 tỷ';
    const r = ask('còn xe điện thì sao', turn(first, ask(first).text));
    assert.match(r.text, /lọc lại[\s\S]*xe điện, 7 chỗ, dưới 1 tỷ/);
  });

  it('compares cars, including brand-only names and "A hay B"', () => {
    const r = ask('nên mua lucid hay tesla roadster');
    assert.match(r.text, /So sánh Lucid Air Sapphire vs Tesla Roadster 2\.0/);
    assert.match(r.text, /Nhận định nhanh/);
    const three = ask('so sánh camry, civic rs và lux a2.0');
    assert.match(three.text, /Camry[\s\S]*Civic RS[\s\S]*Lux A2\.0/);
    assert.match(three.text, /Rẻ nhất/);
  });

  it('computes loan payments from the real calculator, with affordability check', () => {
    const r = ask('lương 25 triệu trả góp vf 9 được không');
    const loan = FinancingService.calculateLoan({ vehiclePrice: 2169000000 });
    assert.ok(r.text.includes(Math.round(loan.monthlyPayment).toLocaleString('vi-VN')));
    assert.match(r.text, /vượt ngưỡng an toàn/);
  });

  it('turns a monthly budget into a price cap', () => {
    const r = ask('mỗi tháng trả góp tầm 15 triệu thì mua được xe nào');
    assert.match(r.text, /giá tới khoảng/);
    assert.ok(r.recommendation && r.recommendation.carId);
  });

  it('ranks with superlatives', () => {
    assert.match(ask('xe nao re nhat').text, /^🏆[\s\S]*1\. \*\*VinFast VF 3\*\*/);
    assert.match(ask('xe điện nào đi xa nhất').text, /1\. \*\*Tesla Roadster 2\.0\*\*/);
  });

  it('answers EV / site knowledge without pushing a sale', () => {
    const lfp = ask('Giải thích cho tôi công nghệ pin LFP');
    assert.match(lfp.text, /LFP[\s\S]*chu kỳ/);
    assert.equal(lfp.recommendation, undefined);
    assert.match(ask('đổi trả thế nào').text, /7 ngày/);
    assert.match(ask('xe sạc mất mấy giờ thì đầy').text, /Sạc AC/);
  });

  it('never invents specs (missing data is reported as such)', () => {
    const r = ask('VinFast Fadil sạc bao lâu');
    assert.match(r.text, /không cần sạc/);
  });

  it('is fast enough for the Workers Free CPU budget', () => {
    ask('warm up');
    const qs = ['tìm xe gia đình 7 chỗ dưới 1 tỷ', 'so sánh vf9 và defender', 'giá vf3', 'xe nao re nhat', 'trả góp camry'];
    const t0 = process.hrtime.bigint();
    for (const q of qs) ask(q);
    const avgMs = Number(process.hrtime.bigint() - t0) / 1e6 / qs.length;
    assert.ok(avgMs < 10, `average ${avgMs.toFixed(2)} ms per answer`);
  });
});

describe('AIService integration', () => {
  it('routes car questions to the brain before the clock / arithmetic branches', async () => {
    const r = await AIService.chat({ message: 'VinFast VF 9 sạc mất mấy giờ' });
    assert.match(r.text, /VF 9[\s\S]*26 phút/);
    assert.ok(r.recommendation && r.recommendation.carId === 'vinfast-vf9');
  });
  it('still answers maths and identity through the original branches', async () => {
    assert.match((await AIService.chat({ message: '2*2 bằng mấy?' })).text, /\b4\b/);
    assert.match((await AIService.chat({ message: 'Tôi là ai?' })).text, /(khách|chưa đăng nhập)/i);
  });
});
