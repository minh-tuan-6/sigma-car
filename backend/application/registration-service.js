// backend/application/registration-service.js
// Regional Vehicle Tax/Plate Estimator & Auditable Registration Case Workflow

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const Security = require('../infrastructure/security');
const Authorization = require('../domain/authorization');
const PolicyService = require('./policy-service');
const NotificationService = require('./notification-service');
const { ROLES, REGISTRATION_STATUS } = require('../domain/constants');

const VALID_CASE_TRANSITIONS = {
  [REGISTRATION_STATUS.DRAFT]: [REGISTRATION_STATUS.SUBMITTED],
  [REGISTRATION_STATUS.SUBMITTED]: [REGISTRATION_STATUS.TAX_FILING],
  [REGISTRATION_STATUS.TAX_FILING]: [REGISTRATION_STATUS.PLATE_ISSUANCE],
  [REGISTRATION_STATUS.PLATE_ISSUANCE]: [REGISTRATION_STATUS.COMPLETED],
  [REGISTRATION_STATUS.COMPLETED]: []
};

function createError(message, statusCode, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

const RegistrationService = {
  calculateEstimate({ vehicleId = null, vehiclePrice, fuel = 'ev', province = 'hanoi', serviceMode = 'self_registration' } = {}) {
    let resolvedPrice = Number(vehiclePrice || 0);
    let resolvedFuel = fuel;
    let vehicleName = '';

    if (vehicleId) {
      const v = (dbState.vehicles || []).find(x => x.id === vehicleId) ||
        (dbState.certifiedVehicles || []).find(x => x.id === vehicleId);
      if (v) {
        if (!resolvedPrice) resolvedPrice = Number(v.price || 0);
        resolvedFuel = v.fuel || resolvedFuel;
        vehicleName = v.name;
      }
    }

    if (!Number.isFinite(resolvedPrice) || resolvedPrice <= 0) {
      throw createError('Giá xe không hợp lệ để dự toán chi phí lăn bánh.', 422, 'INVALID_VEHICLE_PRICE');
    }

    const policy = PolicyService.getActivePolicy('registration_fee');
    const rules = policy.rules;
    const regionKey = String(province || 'hanoi').toLowerCase();
    const region = (rules.regions && rules.regions[regionKey]) || (rules.regions && rules.regions.province) || { label: 'Tỉnh / Thành phố khác', iceRate: 0.10, plateFee: 1000000 };

    const isEv = String(resolvedFuel || '').toLowerCase() === 'ev';
    const taxRate = isEv ? Number(rules.evRegistrationTaxRate ?? 0) : Number(region.iceRate ?? 0.10);
    const registrationTax = Math.round(resolvedPrice * taxRate);
    const plateFee = Number(region.plateFee || 1000000);
    const inspectionFee = Number(rules.inspectionFee || 340000);
    const roadMaintenanceFee = Number(rules.roadMaintenanceFee1Year || 1560000);
    const civilInsuranceFee = Number(rules.civilLiabilityInsurance1Year || 480700);
    const isAssisted = serviceMode === 'seller_assisted';
    const serviceFee = isAssisted ? Number(rules.sellerAssistedServiceFee || 3500000) : 0;

    const totalEstimatedFees = registrationTax + plateFee + inspectionFee + roadMaintenanceFee + civilInsuranceFee + serviceFee;

    return {
      vehicleId,
      vehicleName,
      vehiclePrice: resolvedPrice,
      fuel: isEv ? 'ev' : resolvedFuel,
      province: regionKey,
      provinceLabel: region.label,
      serviceMode: isAssisted ? 'seller_assisted' : 'self_registration',
      policyVersion: policy.version,
      policyEffectiveFrom: policy.effectiveFrom,
      sourceNote: rules.sourceNote,
      isEstimateOnly: true,
      breakdown: {
        registrationTaxRate: taxRate,
        registrationTax,
        plateFee,
        inspectionFee,
        roadMaintenanceFee,
        civilInsuranceFee,
        serviceFee
      },
      totalEstimatedFees,
      estimatedOnRoadTotal: resolvedPrice + totalEstimatedFees,
      disclaimer: `Biểu phí mang tính DỰ TOÁN theo quy định tham chiếu phiên bản ${policy.version}. Lệ phí chính thức do Chi cục Thuế và Phòng CSGT địa phương quyết toán.`
    };
  },

  async createOrUpdateCase(user, { orderId, province = 'hanoi', serviceMode = 'self_registration', buyerType = 'individual', documentMediaIds = [], note = '' } = {}) {
    if (!user || !user.userId) {
      throw createError('Vui lòng đăng nhập để quản lý hồ sơ đăng ký xe.', 401, 'UNAUTHORIZED');
    }
    if (!orderId) {
      throw createError('Vui lòng chọn đơn hàng hợp lệ.', 400, 'VALIDATION_ERROR');
    }

    return runInTransaction(async (state) => {
      if (!Array.isArray(state.registrationCases)) state.registrationCases = [];
      const order = state.orders.find(o => o.id === orderId || o.orderNumber === orderId);
      if (!order) {
        throw createError('Không tìm thấy đơn hàng liên kết.', 404, 'ORDER_NOT_FOUND');
      }
      if (!Authorization.canReadOrder(user, order)) {
        throw createError('Bạn không có quyền truy cập hồ sơ đăng ký cho đơn hàng này.', 403, 'FORBIDDEN');
      }

      const vehicle = state.vehicles.find(v => v.id === order.vehicleId) || state.certifiedVehicles.find(v => v.id === order.vehicleId);
      const estimate = this.calculateEstimate({
        vehicleId: order.vehicleId,
        vehiclePrice: order.unitPrice,
        fuel: (vehicle && vehicle.fuel) || 'ev',
        province,
        serviceMode
      });

      const verifiedMediaIds = (Array.isArray(documentMediaIds) ? documentMediaIds : []).filter(mid =>
        (state.mediaAssets || []).some(m => m.id === mid && !m.deletedAt && m.scanStatus === 'clean' && (m.ownerId === user.userId || user.role === ROLES.ADMIN || Authorization.isStaffRole(user.role)))
      );

      let existing = state.registrationCases.find(c => c.orderId === order.id);
      const nowIso = new Date().toISOString();
      if (existing) {
        if (existing.status !== REGISTRATION_STATUS.DRAFT) {
          throw createError(`Hồ sơ ở trạng thái "${existing.status}" không thể chỉnh sửa gói tự/nhờ đăng ký trực tiếp.`, 409, 'CASE_LOCKED');
        }
        existing.province = estimate.province;
        existing.provinceLabel = estimate.provinceLabel;
        existing.serviceMode = estimate.serviceMode;
        existing.buyerType = Security.sanitizeString(buyerType);
        existing.feeBreakdown = estimate;
        if (verifiedMediaIds.length > 0) {
          existing.documentMediaIds = Array.from(new Set([...(existing.documentMediaIds || []), ...verifiedMediaIds]));
        }
        existing.updatedAt = nowIso;
        return existing;
      }

      const regCase = {
        id: `REG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        orderId: order.id,
        orderNumber: order.orderNumber || order.id,
        userId: order.userId,
        branchId: order.branchId,
        vehicleId: order.vehicleId,
        vehicleName: order.vehicleName,
        province: estimate.province,
        provinceLabel: estimate.provinceLabel,
        serviceMode: estimate.serviceMode,
        buyerType: Security.sanitizeString(buyerType),
        feeBreakdown: estimate,
        documentChecklist: [
          { key: 'cccd', label: 'CCCD / Hộ chiếu chính chủ hoặc GPKD doanh nghiệp', required: true },
          { key: 'vat_invoice', label: 'Hóa đơn GTGT điện tử xuất xe SIGMACAR', required: true },
          { key: 'inspection_cert', label: 'Phiếu kiểm tra chất lượng xuất xưởng / Hải quan', required: true }
        ],
        documentMediaIds: verifiedMediaIds,
        plateNumber: null,
        status: REGISTRATION_STATUS.DRAFT,
        note: Security.sanitizeString(note),
        history: [
          {
            status: REGISTRATION_STATUS.DRAFT,
            actorId: user.userId,
            note: `Khởi tạo hồ sơ (${estimate.serviceMode === 'seller_assisted' ? 'Đại lý hỗ trợ bấm biển' : 'Khách hàng tự đi đăng ký'}).`,
            timestamp: nowIso
          }
        ],
        createdAt: nowIso,
        updatedAt: nowIso
      };

      state.registrationCases.unshift(regCase);
      return regCase;
    });
  },

  async submitCase(user, caseId) {
    return runInTransaction(async (state) => {
      const regCase = (state.registrationCases || []).find(c => c.id === caseId);
      if (!regCase) throw createError('Không tìm thấy hồ sơ đăng ký xe.', 404, 'NOT_FOUND');

      if (user.role === ROLES.BUYER && regCase.userId !== user.userId) {
        throw createError('Bạn không có quyền gửi hồ sơ của người khác.', 403, 'FORBIDDEN');
      }
      if (regCase.status !== REGISTRATION_STATUS.DRAFT) {
        throw createError(`Hồ sơ hiện ở trạng thái "${regCase.status}".`, 409, 'INVALID_STATE_TRANSITION');
      }

      if (regCase.serviceMode === 'seller_assisted' && (!Array.isArray(regCase.documentMediaIds) || regCase.documentMediaIds.length === 0)) {
        throw createError('Hồ sơ nhờ đại lý đăng ký bắt buộc phải đính kèm ít nhất 01 tài liệu CCCD/giấy tờ định danh hợp lệ.', 422, 'MISSING_REQUIRED_DOCUMENTS');
      }

      const nowIso = new Date().toISOString();
      regCase.status = REGISTRATION_STATUS.SUBMITTED;
      regCase.updatedAt = nowIso;
      regCase.history.push({
        status: REGISTRATION_STATUS.SUBMITTED,
        actorId: user.userId,
        note: 'Khách hàng xác nhận nộp hồ sơ đăng ký xe.',
        timestamp: nowIso
      });

      NotificationService.enqueueOutboxInState(state, {
        eventType: 'registration_updated',
        aggregateType: 'registration_case',
        aggregateId: regCase.id,
        userId: regCase.userId,
        templateId: 'registration_updated',
        payload: { orderId: regCase.orderNumber || regCase.orderId, status: regCase.status },
        dedupeKey: `reg_status:${regCase.id}:submitted`
      });

      return regCase;
    });
  },

  async transitionCaseStatus(user, caseId, { status, plateNumber = null, note = '' } = {}) {
    if (!user || ![ROLES.SELLER, ROLES.ADMIN].includes(user.role)) {
      throw createError('Chỉ Nhân viên Đại lý hoặc Quản trị viên mới có quyền cập nhật tiến độ đăng ký biển số.', 403, 'FORBIDDEN');
    }

    return runInTransaction(async (state) => {
      const regCase = (state.registrationCases || []).find(c => c.id === caseId);
      if (!regCase) throw createError('Không tìm thấy hồ sơ đăng ký xe.', 404, 'NOT_FOUND');

      if (user.role !== ROLES.ADMIN && !Authorization.hasBranchAccess(user, regCase.branchId)) {
        throw createError('Hồ sơ thuộc chi nhánh khác phạm vi quản lý của bạn.', 403, 'FORBIDDEN');
      }

      const allowed = VALID_CASE_TRANSITIONS[regCase.status] || [];
      if (!allowed.includes(status)) {
        throw createError(`Chuyển trạng thái không hợp lệ từ "${regCase.status}" sang "${status}".`, 409, 'INVALID_STATE_TRANSITION');
      }

      if (status === REGISTRATION_STATUS.PLATE_ISSUANCE) {
        const cleanPlate = String(plateNumber || regCase.plateNumber || '').trim().toUpperCase();
        if (cleanPlate.length < 6) {
          throw createError('Vui lòng nhập biển số xe đã cấp hợp lệ trước khi chuyển trạng thái "Đã cấp biển số".', 422, 'PLATE_NUMBER_REQUIRED');
        }
        regCase.plateNumber = Security.sanitizeString(cleanPlate);
        const linkedOrder = state.orders.find(o => o.id === regCase.orderId);
        if (linkedOrder) linkedOrder.licensePlate = regCase.plateNumber;
      }

      const nowIso = new Date().toISOString();
      regCase.status = status;
      regCase.updatedAt = nowIso;
      regCase.history.push({
        status,
        actorId: user.userId,
        note: Security.sanitizeString(note || `Cập nhật tiến độ đăng ký -> ${status}`),
        timestamp: nowIso
      });

      NotificationService.enqueueOutboxInState(state, {
        eventType: 'registration_updated',
        aggregateType: 'registration_case',
        aggregateId: regCase.id,
        userId: regCase.userId,
        templateId: 'registration_updated',
        payload: {
          orderId: regCase.orderNumber || regCase.orderId,
          status: regCase.status,
          plateNumber: regCase.plateNumber
        },
        dedupeKey: `reg_status:${regCase.id}:${status}`
      });

      return regCase;
    });
  },

  getCasesForUser(user) {
    const all = dbState.registrationCases || [];
    if (!user) return [];
    if (user.role === ROLES.ADMIN) return [...all];
    if (user.role === ROLES.BUYER) return all.filter(c => c.userId === user.userId);
    if (Authorization.isStaffRole(user.role)) return all.filter(c => c.branchId && Authorization.hasBranchAccess(user, c.branchId));
    return [];
  },

  getCaseById(user, caseId) {
    const regCase = (dbState.registrationCases || []).find(c => c.id === caseId || c.orderId === caseId);
    if (!regCase) throw createError('Không tìm thấy hồ sơ đăng ký xe.', 404, 'NOT_FOUND');
    if (user.role === ROLES.ADMIN) return regCase;
    if (user.role === ROLES.BUYER && regCase.userId === user.userId) return regCase;
    if (Authorization.isStaffRole(user.role) && Authorization.hasBranchAccess(user, regCase.branchId)) return regCase;
    throw createError('Bạn không có quyền truy cập hồ sơ này.', 403, 'FORBIDDEN');
  }
};

module.exports = RegistrationService;
