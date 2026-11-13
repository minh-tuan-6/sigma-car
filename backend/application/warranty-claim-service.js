// backend/application/warranty-claim-service.js
// Warranty Claims Evaluation, Scoped Review, Approval & Workshop Escalation (SIG-P4-003)

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const ServiceRepository = require('../infrastructure/repositories/service-repository');
const WorkshopService = require('./workshop-service');
const Security = require('../infrastructure/security');
const { ROLES, WARRANTY_STATUS } = require('../domain/constants');

const WEAR_AND_TEAR_CATEGORIES = new Set(['tires', 'wiper_blades', 'brake_pads_wear', 'cosmetic_scratch']);

function createError(message, statusCode = 400, code = 'CLAIM_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

const VALID_CLAIM_TRANSITIONS = {
  Submitted: ['Under_Review', 'Escalated', 'Approved', 'Rejected'],
  Under_Review: ['Escalated', 'Approved', 'Rejected'],
  Escalated: ['Approved', 'Rejected'],
  Approved: ['Completed'],
  Rejected: [],
  Completed: []
};

function sanitizeClaimForActor(claim, actor) {
  const isStaff = actor && [ROLES.ADMIN, ROLES.SELLER, ROLES.SERVICE_STAFF].includes(actor.role);
  if (isStaff) return { ...claim };
  const clone = { ...claim };
  delete clone.staffInternalNote;
  delete clone.reviewedBy;
  return clone;
}

function evaluateWarrantyCoverage({ warranty, componentCategory = 'battery_hv', reportedOdoKm = null, nowIso = new Date().toISOString() }) {
  if (!warranty) {
    return {
      eligible: false,
      coverageResult: 'no_active_warranty',
      requiresManualReview: true,
      reasons: ['Xe chưa kích hoạt bảo hành điện tử chính hãng.']
    };
  }
  const reasons = [];
  if (warranty.status !== WARRANTY_STATUS.ACTIVE) {
    reasons.push(`Trạng thái bảo hành hiện tại là "${warranty.status}" (không hiệu lực tự động).`);
  }
  const nowMs = Date.parse(nowIso);
  const targetEndIso = componentCategory === 'battery_hv' ? (warranty.batteryEndDate || warranty.endDate) : warranty.endDate;
  if (targetEndIso && Date.parse(targetEndIso) < nowMs) {
    reasons.push(`Hết hạn thời gian bảo hành (${targetEndIso.slice(0, 10)}).`);
  }
  const maxKm = Number(warranty.maxOdoKm || (warranty.fuel === 'ev' ? 150000 : 100000));
  const checkOdo = reportedOdoKm !== null && reportedOdoKm !== undefined ? Number(reportedOdoKm) : Number(warranty.currentOdoKm || 0);
  if (Number.isFinite(checkOdo) && checkOdo > maxKm) {
    reasons.push(`Số ODO (${checkOdo.toLocaleString('vi-VN')} km) vượt giới hạn bảo hành (${maxKm.toLocaleString('vi-VN')} km).`);
  }
  if (WEAR_AND_TEAR_CATEGORIES.has(String(componentCategory || '').toLowerCase())) {
    reasons.push('Hạng mục thuộc nhóm vật tư hao mòn tự nhiên ngoài phạm vi bảo hành tiêu chuẩn.');
  }

  return {
    eligible: reasons.length === 0,
    coverageResult: reasons.length === 0 ? 'in_coverage' : 'out_of_coverage',
    requiresManualReview: true, // Every claim requires technician verification; out-of-coverage explicitly flagged
    reasons: reasons.length > 0 ? reasons : ['Đạt điều kiện kiểm tra phạm vi thời hạn và số km bảo hành tiêu chuẩn.']
  };
}

const WarrantyClaimService = {
  evaluateWarrantyCoverage,

  async submitClaim(user, payload = {}) {
    if (!user || !user.userId) throw createError('Vui lòng đăng nhập để gửi yêu cầu bảo hành.', 401, 'UNAUTHORIZED');
    const {
      vin,
      warrantyId,
      serviceCenterId = 'sc-hn-caugiay',
      componentCategory = 'battery_hv',
      issueSummary,
      reportedOdoKm,
      estimatedCost = 0,
      evidenceMediaIds = []
    } = payload;

    if (!issueSummary || String(issueSummary).trim().length < 10) {
      throw createError('Vui lòng mô tả triệu chứng kỹ thuật tối thiểu 10 ký tự.', 422, 'INVALID_SUMMARY');
    }

    const estCostNum = Number(estimatedCost || 0);
    if (!Number.isFinite(estCostNum) || estCostNum < 0) {
      throw createError('Chi phí dự kiến phải là số >= 0.', 422, 'INVALID_COST');
    }

    return runInTransaction(async (state) => {
      ServiceRepository.ensureInitialized(state);
      const center = state.serviceCenters.find(c => c.id === serviceCenterId && c.active !== false);
      if (!center) throw createError('Trung tâm dịch vụ tiếp nhận không hợp lệ.', 404, 'CENTER_NOT_FOUND');

      let warranty = warrantyId ? (state.warranties || []).find(w => w.id === warrantyId || w.warrantyCode === warrantyId) : null;
      const cleanVin = vin ? String(vin).trim().toUpperCase() : (warranty ? warranty.vin : '');
      if (!cleanVin) throw createError('Vui lòng cung cấp số khung VIN của xe.', 422, 'VIN_REQUIRED');

      if (!warranty) {
        warranty = (state.warranties || []).find(w => (w.vin || '').toUpperCase() === cleanVin) || null;
      }
      const ownedOrder = (state.orders || []).find(o => (o.vin || '').toUpperCase() === cleanVin) || null;
      const ownerId = (warranty && warranty.userId) || (ownedOrder && ownedOrder.userId) || null;

      if (!ownerId) {
        throw createError(`Không tìm thấy hồ sơ sở hữu xe khớp với VIN "${cleanVin}".`, 404, 'VIN_NOT_FOUND');
      }
      if (user.role === ROLES.BUYER && ownerId !== user.userId) {
        throw createError('Bạn không thể tạo yêu cầu bảo hành cho xe thuộc người dùng khác.', 403, 'FORBIDDEN');
      }

      // Verify ownership and clean state of attached evidence media
      const verifiedMediaIds = [];
      for (const mId of (Array.isArray(evidenceMediaIds) ? evidenceMediaIds : [])) {
        const asset = (state.mediaAssets || []).find(m => m.id === mId && !m.deletedAt);
        if (!asset) {
          throw createError(`Tệp chứng cứ "${mId}" không tồn tại hoặc đã hết hạn.`, 404, 'MEDIA_NOT_FOUND');
        }
        if (user.role === ROLES.BUYER && asset.ownerId !== user.userId) {
          throw createError('Không có quyền đính kèm tệp media của người dùng khác.', 403, 'FORBIDDEN');
        }
        if (asset.scanStatus === 'quarantined') {
          throw createError('Không thể đính kèm tệp bị cách ly bảo mật.', 422, 'MEDIA_QUARANTINED');
        }
        verifiedMediaIds.push(asset.id);
      }

      const nowIso = new Date().toISOString();
      const coverage = evaluateWarrantyCoverage({
        warranty,
        componentCategory,
        reportedOdoKm,
        nowIso
      });

      const claim = {
        id: `WCLM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        claimCode: `BH-${nowIso.slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
        warrantyId: warranty ? warranty.id : null,
        orderId: (warranty && warranty.orderId) || (ownedOrder && ownedOrder.id) || null,
        userId: ownerId,
        vin: cleanVin,
        vehicleName: (warranty && warranty.vehicleName) || (ownedOrder && ownedOrder.vehicleName) || 'Xe SIGMACAR',
        serviceCenterId: center.id,
        serviceCenterName: center.name,
        branchId: center.branchId,
        componentCategory: Security.sanitizeString(componentCategory),
        issueSummary: Security.sanitizeString(issueSummary),
        reportedOdoKm: reportedOdoKm !== undefined && reportedOdoKm !== null ? Number(reportedOdoKm) : (warranty ? warranty.currentOdoKm : 0),
        coverageResult: coverage.coverageResult,
        coverageReasons: coverage.reasons,
        requiresManualReview: coverage.requiresManualReview,
        status: 'Submitted',
        estimatedCost: Math.round(estCostNum),
        approvedAmount: 0,
        evidenceMediaIds: verifiedMediaIds,
        linkedJobId: null,
        decisionReason: '',
        staffInternalNote: '',
        reviewedBy: null,
        createdAt: nowIso,
        updatedAt: nowIso
      };

      state.warrantyClaims.unshift(claim);
      return sanitizeClaimForActor(claim, user);
    });
  },

  listClaims(user, query = {}) {
    if (!user) throw createError('Vui lòng đăng nhập.', 401, 'UNAUTHORIZED');
    ServiceRepository.ensureInitialized(dbState);
    let list = [...(dbState.warrantyClaims || [])];

    if (user.role === ROLES.BUYER) {
      list = list.filter(c => c.userId === user.userId);
    } else if (user.role !== ROLES.ADMIN) {
      const allowed = Array.isArray(user.branchIds) && user.branchIds.length > 0
        ? user.branchIds.filter(Boolean)
        : (user.branchId && user.branchId !== 'all' ? [user.branchId] : []);
      list = allowed.length > 0 ? list.filter(c => allowed.includes(c.branchId)) : [];
    }

    if (query.status && query.status !== 'all') {
      list = list.filter(c => c.status === query.status);
    }
    return list.map(c => sanitizeClaimForActor(c, user));
  },

  async reviewClaim(staffUser, claimId, payload = {}) {
    if (!staffUser || ![ROLES.ADMIN, ROLES.SELLER, ROLES.SERVICE_STAFF].includes(staffUser.role)) {
      throw createError('Chỉ nhân viên kỹ thuật, đại lý hoặc quản trị viên mới có quyền thẩm định hồ sơ bảo hành.', 403, 'FORBIDDEN');
    }

    const {
      nextStatus,
      decisionReason,
      staffInternalNote = '',
      estimatedCost,
      approvedAmount,
      scheduleJob = null
    } = payload;

    const targetStatus = String(nextStatus || '').trim();
    if (!targetStatus) throw createError('Thiếu trạng thái cập nhật (nextStatus).', 422, 'MISSING_STATUS');

    // Step 1: Perform claim update & validations inside transaction
    const updatedClaim = await runInTransaction(async (state) => {
      ServiceRepository.ensureInitialized(state);
      const claim = state.warrantyClaims.find(c => c.id === claimId);
      if (!claim) throw createError('Không tìm thấy hồ sơ yêu cầu bảo hành.', 404, 'CLAIM_NOT_FOUND');

      if (staffUser.role !== ROLES.ADMIN) {
        const allowed = Array.isArray(staffUser.branchIds) && staffUser.branchIds.length > 0
          ? staffUser.branchIds
          : (staffUser.branchId && staffUser.branchId !== 'all' ? [staffUser.branchId] : []);
        if (!allowed.includes(claim.branchId)) {
          throw createError('Bạn không có quyền xử lý hồ sơ bảo hành của chi nhánh khác.', 403, 'BRANCH_SCOPE_DENIED');
        }
      }

      const allowedNext = VALID_CLAIM_TRANSITIONS[claim.status] || [];
      if (!allowedNext.includes(targetStatus)) {
        throw createError(`Chuyển trạng thái hồ sơ bảo hành không hợp lệ: từ "${claim.status}" sang "${targetStatus}".`, 409, 'INVALID_CLAIM_TRANSITION');
      }

      if (['Approved', 'Rejected', 'Escalated'].includes(targetStatus) && (!decisionReason || String(decisionReason).trim().length < 5)) {
        throw createError('Vui lòng nhập lý do thẩm định rõ ràng (tối thiểu 5 ký tự).', 422, 'REASON_REQUIRED');
      }

      // Guard: out-of-coverage claims cannot be approved directly by branch seller/service_staff without Admin approval/override
      if (targetStatus === 'Approved' && claim.coverageResult !== 'in_coverage' && staffUser.role !== ROLES.ADMIN) {
        throw createError(
          'Hồ sơ nằm ngoài phạm vi bảo hành tiêu chuẩn — không được tự duyệt tại chi nhánh. Vui lòng chuyển cấp Quản trị viên (Escalated).',
          403,
          'ADMIN_OVERRIDE_REQUIRED_OUT_OF_COVERAGE'
        );
      }

      if (estimatedCost !== undefined) {
        const est = Number(estimatedCost);
        if (!Number.isFinite(est) || est < 0) throw createError('Chi phí ước tính không hợp lệ.', 422, 'INVALID_COST');
        claim.estimatedCost = Math.round(est);
      }
      if (approvedAmount !== undefined) {
        const appAmt = Number(approvedAmount);
        if (!Number.isFinite(appAmt) || appAmt < 0) throw createError('Số tiền duyệt chi bảo hành không hợp lệ.', 422, 'INVALID_COST');
        if (claim.estimatedCost > 0 && appAmt > claim.estimatedCost) {
          throw createError('Số tiền bảo hành chi trả không được vượt quá chi phí thẩm định ước tính.', 422, 'APPROVED_EXCEEDS_ESTIMATE');
        }
        claim.approvedAmount = Math.round(appAmt);
      }

      claim.status = targetStatus;
      if (decisionReason) claim.decisionReason = Security.sanitizeString(decisionReason);
      if (staffInternalNote) claim.staffInternalNote = Security.sanitizeString(staffInternalNote);
      claim.reviewedBy = staffUser.userId;
      claim.updatedAt = new Date().toISOString();

      if (!Array.isArray(state.auditLogs)) state.auditLogs = [];
      state.auditLogs.unshift({
        id: `AUD-${Date.now().toString(36).toUpperCase()}`,
        action: `WARRANTY_CLAIM_${targetStatus.toUpperCase()}`,
        actorId: staffUser.userId,
        actorName: staffUser.fullName,
        targetId: claim.id,
        detail: `Hồ sơ bảo hành ${claim.claimCode} (${claim.coverageResult}) -> ${targetStatus}. Lý do: ${claim.decisionReason}`,
        timestamp: claim.updatedAt
      });

      return claim;
    });

    // Step 2: Optionally create linked WorkshopJob when approved with schedule parameters
    if (updatedClaim.status === 'Approved' && scheduleJob && !updatedClaim.linkedJobId) {
      const createdJob = await WorkshopService.createJob(staffUser, {
        serviceCenterId: scheduleJob.serviceCenterId || updatedClaim.serviceCenterId,
        bayId: scheduleJob.bayId,
        technicianId: scheduleJob.technicianId,
        vin: updatedClaim.vin,
        scheduledDate: scheduleJob.scheduledDate,
        timeSlot: scheduleJob.timeSlot,
        serviceType: `Xử lý Bảo hành (${updatedClaim.claimCode}): ${updatedClaim.issueSummary}`,
        laborItems: [{ title: `Công bảo hành (${updatedClaim.claimCode})`, amount: 0 }],
        partsRequested: Array.isArray(scheduleJob.partsRequested) ? scheduleJob.partsRequested : []
      });
      await runInTransaction(async (state) => {
        const stored = state.warrantyClaims.find(c => c.id === updatedClaim.id);
        if (stored) {
          stored.linkedJobId = createdJob.id;
          updatedClaim.linkedJobId = createdJob.id;
        }
      });
    }

    return sanitizeClaimForActor(updatedClaim, staffUser);
  }
};

module.exports = WarrantyClaimService;
