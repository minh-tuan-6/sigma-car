// backend/application/policy-service.js
// Versioned Business Policies (Deposit, Return 7-Day, Warranty EV/ICE & Regional Registration Fees)

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const Security = require('../infrastructure/security');
const { ROLES } = require('../domain/constants');

const DEFAULT_POLICY_CATALOG = [
  {
    id: 'pol_order_2026_1',
    type: 'order_terms',
    version: '2026.1',
    title: 'Điều khoản Đặt cọc & Mua bán xe SIGMACAR v2026.1',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    isActive: true,
    rules: {
      depositAmountVnd: 50000000,
      refundableWithinDays: 7,
      refundConditions: 'Hoàn tiền 100% tiền cọc giữ suất trong vòng 07 ngày nếu chưa ký hợp đồng xuất xưởng hoặc showroom không giao đúng cấu hình đã đặt.',
      reservationHoldMinutes: 15
    }
  },
  {
    id: 'pol_return_2026_1',
    type: 'return_7d',
    version: '2026.1',
    title: 'Chính sách Đổi trả 7 ngày & Hoàn tiền SIGMACAR v2026.1',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    isActive: true,
    rules: {
      windowDays: 7,
      maxOdoDeltaKm: 500,
      freeOdoThresholdKm: 200,
      odoFeePerKm: 5000,
      standardInspectionFee: 1500000,
      nonRefundableNote: 'Không hoàn lại các khoản thuế trước bạ và lệ phí biển số đã nộp cho cơ quan Nhà nước.'
    }
  },
  {
    id: 'pol_warranty_ev_2026_1',
    type: 'warranty_ev',
    version: '2026.1',
    title: 'Chính sách Bảo hành Xe Điện & Pin Cao Áp v2026.1',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    isActive: true,
    rules: {
      vehicleYears: 5,
      vehicleMaxKm: 150000,
      batteryYears: 8,
      batteryMaxKm: 160000,
      summary: 'Bảo hành chính hãng 5 năm / 150.000 km toàn xe và 8 năm / 160.000 km Pin cao áp.'
    }
  },
  {
    id: 'pol_warranty_ice_2026_1',
    type: 'warranty_ice',
    version: '2026.1',
    title: 'Chính sách Bảo hành Xe Xăng & Hybrid v2026.1',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    isActive: true,
    rules: {
      vehicleYears: 3,
      vehicleMaxKm: 100000,
      batteryYears: 0,
      batteryMaxKm: 0,
      summary: 'Bảo hành tiêu chuẩn 3 năm hoặc 100.000 km cho động cơ, hộp số và hệ thống truyền động.'
    }
  },
  {
    id: 'pol_registration_2026_1',
    type: 'registration_fee',
    version: '2026.1',
    title: 'Biểu phí Dự toán Lăn bánh & Đăng ký Biển số v2026.1',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    isActive: true,
    rules: {
      sourceNote: 'Tham chiếu biểu lệ phí trước bạ và cấp biển số 9 chỗ trở xuống tại Việt Nam (mang tính dự toán).',
      evRegistrationTaxRate: 0,
      regions: {
        hanoi: { label: 'Hà Nội', iceRate: 0.12, plateFee: 20000000 },
        hcm: { label: 'TP. Hồ Chí Minh', iceRate: 0.10, plateFee: 20000000 },
        danang: { label: 'Đà Nẵng & Hải Phòng / Cần Thơ', iceRate: 0.10, plateFee: 1000000 },
        province: { label: 'Tỉnh / Thành phố khác', iceRate: 0.10, plateFee: 1000000 }
      },
      inspectionFee: 340000,
      roadMaintenanceFee1Year: 1560000,
      civilLiabilityInsurance1Year: 480700,
      sellerAssistedServiceFee: 3500000
    }
  }
];

function findPolicyForType(policies, type, asOfMs = Date.now()) {
  const matching = (policies || [])
    .filter(p => p.type === type && p.isActive !== false && (!p.effectiveFrom || new Date(p.effectiveFrom).getTime() <= asOfMs))
    .sort((a, b) => new Date(b.effectiveFrom || 0) - new Date(a.effectiveFrom || 0));
  if (matching.length > 0) return matching[0];
  return DEFAULT_POLICY_CATALOG.find(p => p.type === type) || null;
}

const PolicyService = {
  DEFAULT_POLICY_CATALOG,

  getActivePolicies(asOfDate = null) {
    const asOfMs = asOfDate ? new Date(asOfDate).getTime() : Date.now();
    const types = ['order_terms', 'return_7d', 'warranty_ev', 'warranty_ice', 'registration_fee'];
    const result = {};
    for (const type of types) {
      result[type] = findPolicyForType(dbState.policyVersions, type, asOfMs);
    }
    return result;
  },

  getActivePolicy(type, asOfDate = null) {
    const asOfMs = asOfDate ? new Date(asOfDate).getTime() : Date.now();
    return findPolicyForType(dbState.policyVersions, type, asOfMs);
  },

  getPolicyByVersion(type, version) {
    return (dbState.policyVersions || []).find(p => p.type === type && p.version === version) ||
      DEFAULT_POLICY_CATALOG.find(p => p.type === type && p.version === version) || null;
  },

  async publishPolicy(user, { type, version, title, rules, effectiveFrom }) {
    if (!user || user.role !== ROLES.ADMIN) {
      const err = new Error('Chỉ Quản trị viên (Admin) mới có quyền phê duyệt & phát hành phiên bản chính sách.');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }
    if (!type || !version || !title) {
      const err = new Error('Vui lòng nhập đầy đủ loại chính sách, mã phiên bản và tiêu đề.');
      err.statusCode = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const effDate = effectiveFrom ? new Date(effectiveFrom) : new Date();
    if (Number.isNaN(effDate.getTime())) {
      const err = new Error('Ngày hiệu lực không hợp lệ.');
      err.statusCode = 422;
      err.code = 'INVALID_DATE';
      throw err;
    }

    return runInTransaction(async (state) => {
      if (!Array.isArray(state.policyVersions)) state.policyVersions = [];
      const dup = state.policyVersions.find(p => p.type === type && p.version === version);
      if (dup) {
        const err = new Error(`Phiên bản chính sách "${version}" cho "${type}" đã tồn tại và không thể ghi đè.`);
        err.statusCode = 409;
        err.code = 'POLICY_VERSION_EXISTS';
        throw err;
      }

      const policyRecord = {
        id: `pol_${type}_${String(version).replace(/[^a-zA-Z0-9]/g, '_')}`,
        type: Security.sanitizeString(type),
        version: Security.sanitizeString(version),
        title: Security.sanitizeString(title),
        rules: rules && typeof rules === 'object' ? rules : {},
        effectiveFrom: effDate.toISOString(),
        isActive: true,
        approvedBy: user.userId,
        createdAt: new Date().toISOString()
      };
      state.policyVersions.push(policyRecord);

      if (!Array.isArray(state.auditLogs)) state.auditLogs = [];
      state.auditLogs.unshift({
        id: `AUD-${crypto.randomUUID().slice(0, 8)}`,
        action: 'POLICY_PUBLISHED',
        actorId: user.userId,
        actorName: user.fullName || user.email,
        targetId: policyRecord.id,
        detail: `Phát hành chính sách ${policyRecord.type} v${policyRecord.version} (hiệu lực ${policyRecord.effectiveFrom}).`,
        timestamp: policyRecord.createdAt
      });
      return policyRecord;
    });
  },

  recordConsentInState(state, { userId, policyId, policyType, policyVersion, targetId, action = 'accepted' }) {
    if (!Array.isArray(state.consentEvents)) state.consentEvents = [];
    const ev = {
      id: `CNS-${crypto.randomUUID().slice(0, 8)}`,
      userId: userId || null,
      policyId: policyId || null,
      policyType,
      policyVersion,
      targetId: targetId || null,
      action,
      recordedAt: new Date().toISOString()
    };
    state.consentEvents.push(ev);
    return ev;
  }
};

module.exports = PolicyService;
