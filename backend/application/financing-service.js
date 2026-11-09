// backend/application/financing-service.js
// Standard Amortizing Loan Financing Calculator for SIGMACAR

const FinancingService = {
  /**
   * Calculate amortizing loan payments
   * Formula: M = P * r * (1 + r)^n / ((1 + r)^n - 1)
   * @param {number} vehiclePrice - Total vehicle purchase price (VND)
   * @param {number} downPaymentPercent - Down payment percentage (e.g. 20, 30%)
   * @param {number} annualInterestRatePercent - Annual interest rate (e.g. 8%)
   * @param {number} termMonths - Loan duration in months (6, 12, 24, 36, 60)
   */
  calculateLoan({ vehiclePrice, downPaymentPercent = 30, annualInterestRatePercent = 7.9, termMonths = 60 }) {
    if (!vehiclePrice || vehiclePrice <= 0) {
      throw new Error('Giá xe phải lớn hơn 0 để tính toán dự toán trả góp.');
    }
    if (downPaymentPercent < 0 || downPaymentPercent >= 100) {
      throw new Error('Tỷ lệ trả trước phải nằm trong khoảng từ 0% đến 99%.');
    }
    if (!termMonths || termMonths <= 0) {
      throw new Error('Kỳ hạn vay phải tối thiểu 1 tháng.');
    }

    const downPaymentAmount = Math.round(vehiclePrice * (downPaymentPercent / 100));
    const principalP = vehiclePrice - downPaymentAmount;

    let monthlyPayment = 0;
    let totalInterest = 0;

    // Handle 0% interest promo rate separately to avoid division by zero
    if (annualInterestRatePercent === 0) {
      monthlyPayment = Math.round(principalP / termMonths);
      totalInterest = 0;
    } else {
      const annualRate = annualInterestRatePercent / 100;
      const monthlyRateR = annualRate / 12;
      const compoundFactor = Math.pow(1 + monthlyRateR, termMonths);

      monthlyPayment = Math.round(
        (principalP * monthlyRateR * compoundFactor) / (compoundFactor - 1)
      );
      totalInterest = Math.round((monthlyPayment * termMonths) - principalP);
    }

    const totalCostOfLoan = vehiclePrice + totalInterest;

    return {
      vehiclePrice,
      downPaymentPercent,
      downPaymentAmount,
      financedPrincipal: principalP,
      annualInterestRate: annualInterestRatePercent,
      termMonths,
      monthlyPayment,
      totalInterest,
      totalCostOfLoan,
      disclaimer: 'Kết quả tính toán mang tính chất tham khảo dự toán chi phí. Lãi suất và hạn mức tín dụng thực tế sẽ do ngân hàng liên kết phê duyệt dựa trên hồ sơ khách hàng.'
    };
  }
};

module.exports = FinancingService;
