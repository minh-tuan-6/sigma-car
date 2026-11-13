// backend/application/financing-service.js
// Unified Amortizing Loan Calculator, DTI Affordability & Persisted Financing Applications

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const Security = require('../infrastructure/security');
const Authorization = require('../domain/authorization');
const NotificationService = require('./notification-service');
const { ROLES } = require('../domain/constants');

function createValidationError(message, code = 'VALIDATION_ERROR', statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

const VALID_APP_TRANSITIONS = {
  Pending_Review: ['Seller_Verified', 'Lender_Approved', 'Rejected', 'Withdrawn'],
  Seller_Verified: ['Lender_Approved', 'Rejected', 'Withdrawn'],
  Lender_Approved: ['Withdrawn'],
  Rejected: [],
  Withdrawn: []
};

function buildAmortizationSchedule({ financedPrincipal, annualInterestRatePercent, termMonths, repaymentMethod }) {
  const months = Number(termMonths);
  const principalP = Math.max(0, Number(financedPrincipal || 0));
  const ratePct = Number(annualInterestRatePercent || 0);
  const monthlyRate = (ratePct / 100) / 12;

  const schedule = [];
  let balance = principalP;
  let totalInterest = 0;

  if (ratePct === 0) {
    const basePrincipal = Math.floor(principalP / months);
    for (let m = 1; m <= months; m++) {
      const principalPaid = m === months ? balance : basePrincipal;
      const closing = Math.max(0, balance - principalPaid);
      schedule.push({
        month: m,
        openingBalance: balance,
        principalPaid,
        interestPaid: 0,
        payment: principalPaid,
        closingBalance: closing
      });
      balance = closing;
    }
    return { schedule, totalInterest: 0, totalPrincipal: principalP };
  }

  if (repaymentMethod === 'equal_principal') {
    const basePrincipal = Math.floor(principalP / months);
    for (let m = 1; m <= months; m++) {
      const interestPaid = Math.round(balance * monthlyRate);
      const principalPaid = m === months ? balance : basePrincipal;
      const payment = principalPaid + interestPaid;
      const closing = Math.max(0, balance - principalPaid);
      totalInterest += interestPaid;
      schedule.push({
        month: m,
        openingBalance: balance,
        principalPaid,
        interestPaid,
        payment,
        closingBalance: closing
      });
      balance = closing;
    }
    return { schedule, totalInterest, totalPrincipal: principalP };
  }

  // Standard annuity
  const factor = Math.pow(1 + monthlyRate, months);
  const fixedMonthly = Math.round((principalP * monthlyRate * factor) / (factor - 1));
  for (let m = 1; m <= months; m++) {
    const interestPaid = Math.round(balance * monthlyRate);
    let principalPaid = m === months ? balance : Math.max(0, fixedMonthly - interestPaid);
    if (principalPaid > balance) principalPaid = balance;
    const payment = principalPaid + interestPaid;
    const closing = Math.max(0, balance - principalPaid);
    totalInterest += interestPaid;
    schedule.push({
      month: m,
      openingBalance: balance,
      principalPaid,
      interestPaid,
      payment,
      closingBalance: closing
    });
    balance = closing;
  }
  return { schedule, totalInterest, totalPrincipal: principalP };
}

function evaluateAffordability({ monthlyPayment, monthlyIncome, monthlyObligation = 0 }) {
  if (monthlyIncome === undefined || monthlyIncome === null || monthlyIncome === '') {
    return null;
  }
  const income = Number(monthlyIncome);
  const obligation = Number(monthlyObligation || 0);
  if (!Number.isFinite(income) || income <= 0) {
    throw createValidationError('Thu nhập hàng tháng phải là số dương hợp lệ.', 'INVALID_INCOME', 422);
  }
  if (!Number.isFinite(obligation) || obligation < 0) {
    throw createValidationError('Nghĩa vụ nợ hàng tháng không thể là số âm.', 'INVALID_OBLIGATION', 422);
  }

  const totalDebt = Number(monthlyPayment) + obligation;
  const dtiPercent = Math.round((totalDebt / income) * 1000) / 10;
  let riskBand = 'comfortable';
  let advisory = 'Tỷ lệ trả nợ trên thu nhập (DTI) ở mức an toàn (<= 40%).';
  if (dtiPercent > 50) {
    riskBand = 'stretched';
    advisory = 'Tỷ lệ trả nợ vượt 50% thu nhập — ngân hàng có thể yêu cầu tăng tỷ lệ trả trước hoặc đồng vay.';
  } else if (dtiPercent > 40) {
    riskBand = 'moderate';
    advisory = 'Tỷ lệ trả nợ ở mức trung bình khá (40% - 50% thu nhập). Cần chứng minh nguồn thu ổn định.';
  }

  return {
    monthlyIncome: income,
    monthlyObligation: obligation,
    proposedVehicleInstallment: Number(monthlyPayment),
    totalMonthlyDebt: totalDebt,
    dtiPercent,
    riskBand,
    eligibleForStandardLender: dtiPercent <= 50,
    advisory
  };
}

const FinancingService = {
  buildAmortizationSchedule,
  evaluateAffordability,

  calculateLoan({
    vehiclePrice,
    downPaymentPercent = 30,
    annualInterestRatePercent = 7.9,
    termMonths = 60,
    repaymentMethod = 'annuity',
    includeSchedule = false,
    monthlyIncome,
    monthlyObligation
  }) {
    const price = Number(vehiclePrice);
    const downPct = Number(downPaymentPercent);
    const ratePct = Number(annualInterestRatePercent);
    const months = Number(termMonths);

    if (!Number.isFinite(price) || price <= 0 || price > 1000000000000) {
      throw createValidationError('Giá xe phải lớn hơn 0 để tính toán dự toán trả góp.');
    }
    if (!Number.isFinite(downPct) || downPct < 0 || downPct >= 100) {
      throw createValidationError('Tỷ lệ trả trước phải nằm trong khoảng từ 0% đến dưới 100%.');
    }
    if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 60) {
      throw createValidationError('Lãi suất năm phải nằm trong khoảng hợp lệ từ 0% đến 60%/năm.');
    }
    if (!Number.isInteger(months) || months < 1 || months > 120) {
      throw createValidationError('Kỳ hạn vay phải tối thiểu 1 tháng (tối đa 120 tháng).');
    }

    const method = repaymentMethod === 'equal_principal' ? 'equal_principal' : 'annuity';
    const downPaymentAmount = Math.round(price * (downPct / 100));
    const principalP = Math.max(0, price - downPaymentAmount);

    let monthlyPayment = 0;
    let firstMonthPayment = 0;
    let lastMonthPayment = 0;
    let totalInterest = 0;
    let schedule = [];

    if (ratePct === 0) {
      monthlyPayment = Math.round(principalP / months);
      firstMonthPayment = monthlyPayment;
      lastMonthPayment = monthlyPayment;
      totalInterest = 0;
      if (includeSchedule) {
        schedule = buildAmortizationSchedule({ financedPrincipal: principalP, annualInterestRatePercent: ratePct, termMonths: months, repaymentMethod: method }).schedule;
      }
    } else if (method === 'equal_principal') {
      const built = buildAmortizationSchedule({ financedPrincipal: principalP, annualInterestRatePercent: ratePct, termMonths: months, repaymentMethod: method });
      schedule = built.schedule;
      firstMonthPayment = schedule[0] ? schedule[0].payment : 0;
      lastMonthPayment = schedule[schedule.length - 1] ? schedule[schedule.length - 1].payment : 0;
      monthlyPayment = firstMonthPayment;
      const monthlyRateR = (ratePct / 100) / 12;
      totalInterest = includeSchedule ? built.totalInterest : Math.round(principalP * monthlyRateR * (months + 1) / 2);
    } else {
      const monthlyRateR = (ratePct / 100) / 12;
      const compoundFactor = Math.pow(1 + monthlyRateR, months);
      const exactMonthly = (principalP * monthlyRateR * compoundFactor) / (compoundFactor - 1);
      monthlyPayment = Math.round(exactMonthly);
      firstMonthPayment = monthlyPayment;
      lastMonthPayment = monthlyPayment;
      totalInterest = Math.max(0, (monthlyPayment * months) - principalP);
      if (includeSchedule) {
        const built = buildAmortizationSchedule({ financedPrincipal: principalP, annualInterestRatePercent: ratePct, termMonths: months, repaymentMethod: method });
        schedule = built.schedule;
      }
    }

    const totalCostOfLoan = price + totalInterest;
    const affordability = evaluateAffordability({
      monthlyPayment: firstMonthPayment,
      monthlyIncome,
      monthlyObligation
    });

    const firstMonthPrincipal = (Array.isArray(schedule) && schedule[0])
      ? schedule[0].principalPaid
      : Math.floor(principalP / months);

    return {
      vehiclePrice: price,
      downPaymentPercent: downPct,
      downPaymentAmount,
      financedPrincipal: principalP,
      annualInterestRate: ratePct,
      termMonths: months,
      repaymentMethod: method,
      monthlyPayment,
      firstMonthPayment,
      firstMonthPrincipal,
      lastMonthPayment,
      totalInterest,
      totalCostOfLoan,
      isEstimateOnly: true,
      estimateStage: 'pre_lender_estimate',
      ...(includeSchedule ? { schedule } : {}),
      ...(affordability ? { affordability } : {}),
      disclaimer: 'Kết quả tính toán là DỰ TOÁN THAM KHẢO (chưa phải cam kết phê duyệt tín dụng). Lãi suất và hạn mức vay chính thức phụ thuộc vào thẩm định của ngân hàng đối tác.'
    };
  },

  async submitApplication(user, payload = {}) {
    if (!user || !user.userId) {
      throw createValidationError('Vui lòng đăng nhập để nộp hồ sơ trả góp.', 'UNAUTHORIZED', 401);
    }
    if (payload.consentCreditCheck !== true) {
      throw createValidationError('Vui lòng xác nhận đồng ý cho phép SIGMACAR chuyển thông tin dự toán tới bộ phận thẩm định tín dụng.', 'CONSENT_REQUIRED', 422);
    }

    return runInTransaction(async (state) => {
      if (!Array.isArray(state.financingApplications)) state.financingApplications = [];

      const vehicle = state.vehicles.find(v => v.id === payload.vehicleId) ||
        state.certifiedVehicles.find(v => v.id === payload.vehicleId);
      if (!vehicle) {
        throw createValidationError(`Không tìm thấy mẫu xe "${payload.vehicleId}".`, 'VEHICLE_NOT_FOUND', 404);
      }

      let linkedOrder = null;
      if (payload.orderId) {
        linkedOrder = state.orders.find(o => o.id === payload.orderId || o.orderNumber === payload.orderId);
        if (!linkedOrder) {
          throw createValidationError('Không tìm thấy đơn hàng liên kết.', 'ORDER_NOT_FOUND', 404);
        }
        if (user.role === ROLES.BUYER && linkedOrder.userId !== user.userId) {
          throw createValidationError('Không có quyền nộp hồ sơ trả góp cho đơn hàng của người khác.', 'FORBIDDEN', 403);
        }
      }

      const estimate = this.calculateLoan({
        vehiclePrice: linkedOrder ? linkedOrder.unitPrice : vehicle.price,
        downPaymentPercent: payload.downPaymentPercent ?? 30,
        annualInterestRatePercent: payload.annualInterestRatePercent ?? 7.9,
        termMonths: payload.termMonths ?? 60,
        repaymentMethod: payload.repaymentMethod || 'annuity',
        includeSchedule: false,
        monthlyIncome: payload.monthlyIncome,
        monthlyObligation: payload.monthlyObligation || 0
      });

      const appId = `FIN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const nowIso = new Date().toISOString();
      const application = {
        id: appId,
        userId: user.userId,
        applicantName: Security.sanitizeString(payload.applicantName || user.fullName || user.email),
        applicantPhone: Security.sanitizeString(payload.applicantPhone || ''),
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        orderId: linkedOrder ? linkedOrder.id : null,
        branchId: linkedOrder ? linkedOrder.branchId : (payload.branchId || 'hn-caugiay'),
        lenderName: Security.sanitizeString(payload.lenderName || 'Ngân hàng Liên kết VPBank / Techcombank Auto'),
        lenderRef: null,
        vehiclePrice: estimate.vehiclePrice,
        downPaymentPercent: estimate.downPaymentPercent,
        annualInterestRate: estimate.annualInterestRate,
        termMonths: estimate.termMonths,
        repaymentMethod: estimate.repaymentMethod,
        estimateSnapshot: estimate,
        monthlyIncome: payload.monthlyIncome ? Number(payload.monthlyIncome) : null,
        monthlyObligation: payload.monthlyObligation ? Number(payload.monthlyObligation) : 0,
        consentCreditCheck: true,
        documentVerified: false, // Honest: no automatic document claim unless uploaded and verified
        approvalDoesNotEqualPayment: true,
        status: 'Pending_Review',
        version: 1,
        reviewerId: null,
        decisionNote: '',
        reservationDisposition: null,
        history: [
          {
            status: 'Pending_Review',
            actorId: user.userId,
            actorRole: user.role,
            note: 'Khách hàng nộp hồ sơ dự toán trả góp (chờ nhân viên / ngân hàng thẩm định).',
            timestamp: nowIso
          }
        ],
        createdAt: nowIso,
        updatedAt: nowIso
      };

      state.financingApplications.unshift(application);
      NotificationService.enqueueOutboxInState(state, {
        eventType: 'financing_submitted',
        aggregateType: 'financing_application',
        aggregateId: application.id,
        userId: user.userId,
        templateId: 'financing_submitted',
        payload: {
          applicationId: application.id,
          vehicleName: vehicle.name,
          termMonths: application.termMonths
        },
        dedupeKey: `financing_submitted:${application.id}`
      });

      return application;
    });
  },

  listApplications(user) {
    const all = dbState.financingApplications || [];
    if (!user) return [];
    if (user.role === ROLES.ADMIN) return [...all];
    if (user.role === ROLES.BUYER) {
      return all.filter(a => a.userId === user.userId);
    }
    if (Authorization.isStaffRole(user.role)) {
      return all.filter(a => a.branchId && Authorization.hasBranchAccess(user, a.branchId));
    }
    return [];
  },

  getApplicationById(user, appId) {
    const app = (dbState.financingApplications || []).find(a => a.id === appId);
    if (!app) {
      throw createValidationError('Không tìm thấy hồ sơ trả góp.', 'NOT_FOUND', 404);
    }
    if (user.role === ROLES.ADMIN) return app;
    if (user.role === ROLES.BUYER && app.userId === user.userId) return app;
    if (Authorization.isStaffRole(user.role) && app.branchId && Authorization.hasBranchAccess(user, app.branchId)) return app;
    throw createValidationError('Bạn không có quyền truy cập hồ sơ trả góp này.', 'FORBIDDEN', 403);
  },

  async reviewApplication(user, appId, { action, decisionNote = '', lenderRef = null, approvedRatePercent, approvedTermMonths, expectedVersion } = {}) {
    return runInTransaction(async (state) => {
      const app = (state.financingApplications || []).find(a => a.id === appId);
      if (!app) {
        throw createValidationError('Không tìm thấy hồ sơ trả góp.', 'NOT_FOUND', 404);
      }

      if (action === 'withdraw') {
        if (app.userId !== user.userId && user.role !== ROLES.ADMIN) {
          throw createValidationError('Chỉ chủ hồ sơ hoặc Admin mới có thể rút hồ sơ vay.', 'FORBIDDEN', 403);
        }
      } else {
        if (![ROLES.SELLER, ROLES.ADMIN].includes(user.role)) {
          throw createValidationError('Khách hàng không được tự phê duyệt hoặc từ chối hồ sơ tín dụng.', 'FORBIDDEN', 403);
        }
        if (user.role !== ROLES.ADMIN && !Authorization.hasBranchAccess(user, app.branchId)) {
          throw createValidationError('Hồ sơ thuộc chi nhánh khác phạm vi quản lý.', 'FORBIDDEN', 403);
        }
      }

      if (expectedVersion !== undefined && Number(expectedVersion) !== Number(app.version)) {
        throw createValidationError('Hồ sơ đã bị cập nhật trước đó. Vui lòng tải lại dữ liệu.', 'VERSION_CONFLICT', 409);
      }

      const actionToStatus = {
        verify: 'Seller_Verified',
        approve_lender: 'Lender_Approved',
        reject: 'Rejected',
        withdraw: 'Withdrawn'
      };
      const targetStatus = actionToStatus[action];
      if (!targetStatus) {
        throw createValidationError(`Hành động thẩm định "${action}" không hợp lệ.`, 'INVALID_ACTION', 400);
      }
      const allowed = VALID_APP_TRANSITIONS[app.status] || [];
      if (!allowed.includes(targetStatus)) {
        throw createValidationError(`Không thể chuyển hồ sơ từ "${app.status}" sang "${targetStatus}".`, 'INVALID_STATE_TRANSITION', 409);
      }

      if (targetStatus === 'Lender_Approved' && (!lenderRef || String(lenderRef).trim().length < 4)) {
        throw createValidationError('Phê duyệt ngân hàng bắt buộc phải đính kèm mã tham chiếu/chứng từ ngân hàng (lenderRef).', 'LENDER_PROOF_REQUIRED', 422);
      }
      if (targetStatus === 'Rejected' && String(decisionNote || '').trim().length < 5) {
        throw createValidationError('Vui lòng ghi rõ lý do từ chối hồ sơ.', 'DECISION_NOTE_REQUIRED', 422);
      }

      app.status = targetStatus;
      app.version = (app.version || 1) + 1;
      app.reviewerId = user.userId;
      app.decisionNote = Security.sanitizeString(decisionNote || '');
      if (lenderRef) app.lenderRef = Security.sanitizeString(lenderRef);
      if (approvedRatePercent !== undefined) app.approvedRatePercent = Number(approvedRatePercent);
      if (approvedTermMonths !== undefined) app.approvedTermMonths = Number(approvedTermMonths);

      if (['Rejected', 'Withdrawn'].includes(targetStatus) && app.orderId) {
        const linkedOrder = state.orders.find(o => o.id === app.orderId);
        if (linkedOrder) {
          app.reservationDisposition = linkedOrder.reservedInventory ? 'held_pending_customer_choice' : 'none';
          // Note: NEVER restore inventory twice or automatically mutate order.paymentStatus here
        }
      }

      const nowIso = new Date().toISOString();
      app.updatedAt = nowIso;
      app.history.push({
        status: targetStatus,
        actorId: user.userId,
        actorRole: user.role,
        note: app.decisionNote || `Cập nhật trạng thái sang ${targetStatus}`,
        timestamp: nowIso
      });

      NotificationService.enqueueOutboxInState(state, {
        eventType: 'financing_reviewed',
        aggregateType: 'financing_application',
        aggregateId: app.id,
        userId: app.userId,
        templateId: 'financing_reviewed',
        payload: {
          applicationId: app.id,
          status: app.status,
          decisionNote: app.decisionNote
        },
        dedupeKey: `financing_reviewed:${app.id}:v${app.version}`
      });

      return app;
    });
  }
};

module.exports = FinancingService;
