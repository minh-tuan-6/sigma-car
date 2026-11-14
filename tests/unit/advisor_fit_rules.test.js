// tests/unit/advisor_fit_rules.test.js
// PLAN.md T3.1 — daily distance, height and weight in the AI advisor (advisory only, never a hard filter).

require('../helpers/isolated-store');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateFit } = require('../../backend/application/advisor-fit-rules');
const ConsultationService = require('../../backend/application/consultation-service');

const ev = (over = {}) => ({ id: 'e1', name: 'EV', fuel: 'ev', range: 500, category: 'SUV', seats: 5, price: 900000000, dimensionsDetail: { heightMm: 1700 }, ...over });

describe('T3.1 advisor fit rules', () => {
  it('daily distance: plenty of range is a reason, too little range is a note with a penalty', () => {
    const ok = evaluateFit(ev({ range: 500 }), { dailyKm: 40 });
    assert.ok(ok.scoreDelta > 0);
    assert.match(ok.reasons[0], /~12 ngày/);
    const tight = evaluateFit(ev({ range: 215 }), { dailyKm: 200 });
    assert.ok(tight.scoreDelta < 0);
    assert.match(tight.notes[0], /sạc mỗi ngày/);
    const gas = evaluateFit(ev({ fuel: 'gas', range: null }), { dailyKm: 200 });
    assert.equal(gas.scoreDelta, 0, 'petrol cars are not judged on EV range');
  });

  it('height: tall drivers get a reason for tall bodies and a note for low-slung cars; always flagged as reference only', () => {
    const suv = evaluateFit(ev(), { heightCm: 192 });
    assert.ok(suv.scoreDelta > 0 && suv.reasons.length === 1);
    const supercar = evaluateFit(ev({ category: 'Siêu Xe', dimensionsDetail: { heightMm: 1050 } }), { heightCm: 192 });
    assert.ok(supercar.scoreDelta < 0);
    assert.match(supercar.notes.join(' '), /khoảng trống đầu/);
    assert.ok(suv.notes.some(n => /tham khảo/.test(n)));
  });

  it('no driver data → no effect', () => {
    assert.deepEqual(evaluateFit(ev(), {}), { scoreDelta: 0, reasons: [], notes: [] });
  });

  it('never removes a vehicle from scoring (soft rules only)', () => {
    const cars = [
      ev({ id: 'low', name: 'Low', category: 'Siêu Xe', dimensionsDetail: { heightMm: 1050 }, range: 300 }),
      ev({ id: 'tall', name: 'Tall' })
    ];
    const withProfile = ConsultationService.scoreAndConstrainVehicles(cars, { heightCm: 195, weightKg: 110, dailyKm: 280 });
    const without = ConsultationService.scoreAndConstrainVehicles(cars, {});
    const ids = (r) => [...(r.top3 || []), ...(r.flaggedAlternatives || [])].map(c => c.carId).sort();
    assert.deepEqual(ids(withProfile), ids(without));
  });
});
