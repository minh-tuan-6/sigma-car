const { describe, it } = require('node:test');
const assert = require('node:assert');
const FinancingService = require('../../backend/application/financing-service');

describe('Unit Test: FinancingService (Amortizing Loan Calculations)', () => {
  it('should correctly calculate standard amortizing monthly payment for 60 months with 7.9% interest', () => {
    const result = FinancingService.calculateLoan({
      vehiclePrice: 1290000000, // 1.29 Billion VND (Model E)
      downPaymentPercent: 30,    // 30% down
      annualInterestRatePercent: 7.9,
      termMonths: 60
    });

    assert.strictEqual(result.vehiclePrice, 1290000000);
    assert.strictEqual(result.downPaymentPercent, 30);
    assert.strictEqual(result.downPaymentAmount, 387000000);
    assert.strictEqual(result.financedPrincipal, 903000000);
    assert.strictEqual(result.termMonths, 60);

    // Verify monthly payment calculation formula:
    // P = 903,000,000, r = 0.079 / 12 = 0.00658333...
    // M = P * r * (1+r)^60 / ((1+r)^60 - 1) ~ 18,272,398
    assert(result.monthlyPayment > 18000000 && result.monthlyPayment < 18500000,
      `Monthly payment ${result.monthlyPayment} should be within expected range around 18.27M VND`);
    
    // Total interest must equal (monthlyPayment * 60) - principal
    assert.strictEqual(result.totalInterest, (result.monthlyPayment * 60) - result.financedPrincipal);
    assert.strictEqual(result.totalCostOfLoan, result.vehiclePrice + result.totalInterest);
  });

  it('should handle 0% promotional interest rate without division by zero', () => {
    const result = FinancingService.calculateLoan({
      vehiclePrice: 600000000,
      downPaymentPercent: 20,
      annualInterestRatePercent: 0,
      termMonths: 24
    });

    const expectedPrincipal = 600000000 * 0.8; // 480,000,000
    assert.strictEqual(result.financedPrincipal, expectedPrincipal);
    assert.strictEqual(result.monthlyPayment, Math.round(expectedPrincipal / 24)); // 20,000,000
    assert.strictEqual(result.totalInterest, 0);
    assert.strictEqual(result.totalCostOfLoan, 600000000);
  });

  it('should reject invalid vehicle prices <= 0', () => {
    assert.throws(() => {
      FinancingService.calculateLoan({ vehiclePrice: 0 });
    }, /Giá xe phải lớn hơn 0/);

    assert.throws(() => {
      FinancingService.calculateLoan({ vehiclePrice: -50000000 });
    }, /Giá xe phải lớn hơn 0/);
  });

  it('should reject downPaymentPercent >= 100 or < 0', () => {
    assert.throws(() => {
      FinancingService.calculateLoan({ vehiclePrice: 1000000000, downPaymentPercent: 100 });
    }, /Tỷ lệ trả trước phải nằm trong khoảng/);

    assert.throws(() => {
      FinancingService.calculateLoan({ vehiclePrice: 1000000000, downPaymentPercent: -10 });
    }, /Tỷ lệ trả trước phải nằm trong khoảng/);
  });

  it('should reject termMonths <= 0', () => {
    assert.throws(() => {
      FinancingService.calculateLoan({ vehiclePrice: 1000000000, termMonths: 0 });
    }, /Kỳ hạn vay phải tối thiểu 1 tháng/);
  });
});
