// tests/unit/financing_flat_rate.test.js
// PLAN.md T3.10 — flat-rate repayment method, plus exact-value pins proving annuity / equal-principal are unchanged
// (values recorded from the unmodified FinancingService at HEAD d01fc77).

require('../helpers/isolated-store');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const FinancingService = require('../../backend/application/financing-service');

const pick = (r) => ({ m: r.monthlyPayment, f: r.firstMonthPayment, l: r.lastMonthPayment, t: r.totalInterest, c: r.totalCostOfLoan });

describe('T3.10 financing: existing methods unchanged (exact VND)', () => {
  it('annuity 1.2 tỷ, 30%, 7.9%, 60 tháng', () => {
    const r = FinancingService.calculateLoan({ vehiclePrice: 1200000000, downPaymentPercent: 30, annualInterestRatePercent: 7.9, termMonths: 60, repaymentMethod: 'annuity' });
    assert.deepEqual(pick(r), { m: 16991999, f: 16991999, l: 16991999, t: 179519940, c: 1379519940 });
  });

  it('equal principal 850 tr, 20%, 9.5%, 84 tháng (with and without schedule)', () => {
    const withSchedule = FinancingService.calculateLoan({ vehiclePrice: 850000000, downPaymentPercent: 20, annualInterestRatePercent: 9.5, termMonths: 84, repaymentMethod: 'equal_principal', includeSchedule: true });
    assert.deepEqual(pick(withSchedule), { m: 13478571, f: 13478571, l: 8159333, t: 228791669, c: 1078791669 });
    const noSchedule = FinancingService.calculateLoan({ vehiclePrice: 850000000, downPaymentPercent: 20, annualInterestRatePercent: 9.5, termMonths: 84, repaymentMethod: 'equal_principal' });
    assert.deepEqual(pick(noSchedule), { m: 13478571, f: 13478571, l: 8159333, t: 228791667, c: 1078791667 });
  });

  it('0% interest', () => {
    const r = FinancingService.calculateLoan({ vehiclePrice: 500000000, downPaymentPercent: 0, annualInterestRatePercent: 0, termMonths: 36 });
    assert.deepEqual(pick(r), { m: 13888889, f: 13888889, l: 13888889, t: 0, c: 500000000 });
  });

  it('unknown method names still fall back to annuity', () => {
    const a = FinancingService.calculateLoan({ vehiclePrice: 1200000000, downPaymentPercent: 30, annualInterestRatePercent: 7.9, termMonths: 60, repaymentMethod: 'something-else' });
    assert.equal(a.repaymentMethod, 'annuity');
    assert.equal(a.monthlyPayment, 16991999);
  });
});

describe('T3.10 flat rate (lãi phẳng)', () => {
  it('interest is charged on the original principal every month', () => {
    const r = FinancingService.calculateLoan({ vehiclePrice: 1000000000, downPaymentPercent: 20, annualInterestRatePercent: 8, termMonths: 60, repaymentMethod: 'flat', includeSchedule: true });
    assert.equal(r.repaymentMethod, 'flat');
    assert.equal(r.financedPrincipal, 800000000);
    assert.deepEqual(pick(r), { m: 18666666, f: 18666666, l: 18666686, t: 319999980, c: 1319999980 });
    assert.equal(r.schedule.length, 60);
    assert.ok(r.schedule.every(row => row.interestPaid === 5333333));
    assert.equal(r.schedule[59].closingBalance, 0);
    assert.equal(r.schedule.reduce((s, row) => s + row.principalPaid, 0), 800000000);
  });

  it('costs more interest than reducing balance for the same loan', () => {
    const base = { vehiclePrice: 1000000000, downPaymentPercent: 20, annualInterestRatePercent: 8, termMonths: 60 };
    const flat = FinancingService.calculateLoan({ ...base, repaymentMethod: 'flat' });
    const reducing = FinancingService.calculateLoan({ ...base, repaymentMethod: 'equal_principal' });
    assert.ok(flat.totalInterest > reducing.totalInterest);
  });
});
