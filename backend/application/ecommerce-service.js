// backend/application/ecommerce-service.js
// Unified E-Commerce Lifecycle Service for SIGMACAR:
// 1. Automated 7-Day Returns Center
// 2. Digital Warranty & Maintenance Management
// 3. Verified Reviews & Community Q&A
// 4. Customer Support Center & Ticketing (with strict internal note isolation)
// 5. Email Campaigns & Privacy / Unsubscribe Management

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const Security = require('../infrastructure/security');
const Authorization = require('../domain/authorization');
const NotificationService = require('./notification-service');
const PolicyService = require('./policy-service');
const HandoverService = require('./handover-service');
const WorkshopService = require('./workshop-service');
const NotificationRepository = require('../infrastructure/repositories/notification-repository');
const CampaignWorker = require('../workers/campaign-worker');
const EmailProvider = require('../infrastructure/email-provider');
const {
  ROLES,
  ORDER_STATUS,
  PAYMENT_STATUS,
  APPOINTMENT_STATUS,
  TICKET_STATUS,
  TICKET_PRIORITY,
  RETURN_STATUS,
  RETURN_STAGES_ORDER,
  RETURN_REASONS,
  WARRANTY_STATUS,
  WARRANTY_COVERED_COMPONENTS,
  MAINTENANCE_MILESTONES,
  SERVICE_CENTERS,
  CAMPAIGN_CATEGORIES,
  CAMPAIGN_STATUS,
  SUPPORT_CONFIG
} = require('../domain/constants');
const { canUserTransitionReturn, canUserTransitionAppointment } = require('../domain/state-machines');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_ATTACHMENT_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.mp4'];
const MAX_ATTACHMENT_SIZE_KB = 5120; // 5MB

// Public Return Policy Rules (Section 2)
const RETURN_POLICY_RULES = {
  windowDays: 7,
  maxOdoDeltaKm: 500,
  freeOdoThresholdKm: 200,
  odoFeePerKm: 5000,
  standardInspectionFee: 1500000,
  standardTransportFee: 2500000,
  conditions: [
    'Yêu cầu được gửi trong vòng 07 ngày kể từ thời điểm bàn giao xe thực tế (hoặc ngày hoàn tất đơn hàng).',
    'Quãng đường vận hành phát sinh (ODO) không vượt quá 500 km so với biên bản bàn giao.',
    'Xe giữ nguyên hiện trạng xuất xưởng 100%: không đâm đụng, ngập nước, trầy xước sơn hoặc tự ý độ chế phụ kiện điện.',
    'Đầy đủ hóa đơn GTGT, biên bản bàn giao gốc, 02 chìa khóa thông minh NFC/Keyfob và bộ sạc đi kèm.'
  ],
  requiredDocuments: [
    'Căn cước công dân / Hộ chiếu chính chủ đứng tên hợp đồng mua bán',
    'Biên bản bàn giao xe kiêm phiếu xuất kho SIGMACAR',
    'Hóa đơn điện tử (hoặc xác nhận đặt cọc/thanh toán đầy đủ)',
    'Bộ phụ kiện tiêu chuẩn (Sạc treo tường Wallbox / Sạc di động, 02 chìa khóa, sách hướng dẫn)'
  ],
  nonRefundableCases: [
    'Quá thời hạn 07 ngày kể từ mốc bàn giao xe hoặc ODO vượt quá 500 km.',
    'Xe đã xảy ra va chạm, trầy xước thân vỏ, rách nội thất da hoặc ngập nước do lỗi người sử dụng.',
    'Tự ý can thiệp hệ thống điện cao áp, phần mềm ECU hoặc tháo mở niêm phong khối Pin.',
    'Các khoản lệ phí trước bạ, phí cấp biển số đã nộp cho cơ quan Nhà nước (nếu khách hàng đã tự đi bấm biển định danh).'
  ]
};

function appendAuditLog(state, { action, actorId, actorName, targetId, detail }) {
  if (!Array.isArray(state.auditLogs)) state.auditLogs = [];
  state.auditLogs.unshift({
    id: `AUD-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    action,
    actorId: actorId || 'system',
    actorName: actorName || 'Hệ thống SIGMACAR',
    targetId: targetId || '',
    detail: detail || '',
    timestamp: new Date().toISOString()
  });
}

function validateAttachments(files = []) {
  if (!Array.isArray(files)) return [];
  const validated = [];
  for (const f of files.slice(0, 8)) {
    const name = Security.sanitizeString(f.name || 'image.jpg');
    const lower = name.toLowerCase();
    const hasValidExt = ALLOWED_ATTACHMENT_EXTS.some(ext => lower.endsWith(ext));
    if (!hasValidExt) {
      throw new Error(`Tệp "${name}" không đúng định dạng cho phép (${ALLOWED_ATTACHMENT_EXTS.join(', ')}).`);
    }
    const sizeKb = Number(f.sizeKb || 250);
    if (sizeKb > MAX_ATTACHMENT_SIZE_KB) {
      throw new Error(`Tệp "${name}" vượt quá dung lượng tối đa 5MB (${MAX_ATTACHMENT_SIZE_KB} KB).`);
    }
    validated.push({
      name,
      url: f.url || 'assets/garage-car-detail.jpg',
      type: f.type || (lower.endsWith('.mp4') ? 'video' : 'image'),
      sizeKb: Math.round(sizeKb),
      caption: Security.sanitizeString(f.caption || '')
    });
  }
  return validated;
}

function computeOrderReturnEligibility(order, existingReturns = []) {
  const activeReturn = existingReturns.find(
    r => r.orderId === order.id && r.status !== RETURN_STATUS.REJECTED
  );
  const milestoneIso = order.deliveredAt || order.completedAt || order.createdAt;
  const milestoneMs = milestoneIso ? new Date(milestoneIso).getTime() : Date.now();
  const elapsedMs = Math.max(0, Date.now() - milestoneMs);
  const remainingMs = SEVEN_DAYS_MS - elapsedMs;
  const remainingDays = Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
  const remainingHours = Math.max(0, Math.ceil(remainingMs / (60 * 60 * 1000)));

  const isStatusEligible = [ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED].includes(order.orderStatus);
  const withinWindow = remainingMs > 0;

  let eligibleReason = 'Đủ điều kiện đổi trả trong 7 ngày';
  let isEligible = isStatusEligible && withinWindow && !activeReturn;

  if (activeReturn) {
    isEligible = false;
    eligibleReason = `Đang có yêu cầu đổi trả (${activeReturn.returnCode}) ở trạng thái "${activeReturn.status}"`;
  } else if (!isStatusEligible) {
    isEligible = false;
    eligibleReason = `Đơn hàng đang ở trạng thái "${order.orderStatus}" (chưa bàn giao xe)`;
  } else if (!withinWindow) {
    isEligible = false;
    eligibleReason = 'Đã hết thời hạn đổi trả 7 ngày kể từ ngày bàn giao';
  }

  return {
    orderId: order.id,
    orderNumber: order.orderNumber || order.id,
    vehicleId: order.vehicleId,
    vehicleName: order.vehicleName,
    color: order.color || 'Tiêu chuẩn',
    edition: order.edition || 'Tiêu chuẩn',
    vin: order.vin || `SG-${order.id}`,
    licensePlate: order.licensePlate || 'Chưa bấm biển',
    image: order.image || 'assets/model-e.jpg',
    unitPrice: order.unitPrice,
    paidAmount: order.paymentStatus === PAYMENT_STATUS.FULLY_PAID ? order.unitPrice : (order.depositAmount || 50000000),
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    deliveredAt: milestoneIso,
    remainingDays,
    remainingHours,
    isEligible,
    eligibleReason,
    activeReturnCode: activeReturn ? activeReturn.returnCode : null,
    activeReturnStatus: activeReturn ? activeReturn.status : null
  };
}

function calculateReturnFinancials({ paidAmount, reasonId, currentOdoKm }) {
  const odo = Math.max(0, Number(currentOdoKm || 0));
  const isTechFault = reasonId === 'tech_issue' || reasonId === 'mismatch_spec';
  const inspectionFee = isTechFault ? 0 : RETURN_POLICY_RULES.standardInspectionFee;
  const transportFee = isTechFault ? 0 : 0; // Miễn phí thu hồi nội thành tiêu chuẩn
  const extraKm = Math.max(0, odo - RETURN_POLICY_RULES.freeOdoThresholdKm);
  const odoDeduction = isTechFault ? 0 : extraKm * RETURN_POLICY_RULES.odoFeePerKm;
  const totalDeductions = inspectionFee + transportFee + odoDeduction;
  const estimatedRefundAmount = Math.max(0, Number(paidAmount || 0) - totalDeductions);

  return {
    originalPaidAmount: Number(paidAmount || 0),
    transportFee,
    odoDeduction,
    inspectionFee,
    totalDeductions,
    estimatedRefundAmount,
    refundStatus: 'Dự kiến hoàn trả (Chờ kiểm định thực tế tại xưởng)'
  };
}

const EcommerceService = {
  // ===========================================================================
  // SECTION 2: AUTOMATED 7-DAY RETURNS CENTER
  // ===========================================================================
  getReturnsData(user, query = {}) {
    const allReturns = Array.isArray(dbState.returnRequests) ? dbState.returnRequests : [];
    const resolveReturnRecord = (r) => {
      if (r.branchId) return r;
      const linkedOrder = dbState.orders.find(o => o.id === r.orderId);
      return linkedOrder ? { ...r, branchId: linkedOrder.branchId } : r;
    };

    const userOrders = (dbState.orders || []).filter(o => Authorization.canReadOrder(user, o));
    const eligibleOrders = userOrders.map(o => computeOrderReturnEligibility(o, allReturns));

    const scopedReturns = allReturns.filter(r =>
      Authorization.canAccessBranchResource(user, resolveReturnRecord(r), 'userId', 'branchId')
    );
    let list = [...scopedReturns];

    if (query.status && query.status !== 'all') {
      list = list.filter(r => r.status === query.status);
    }
    if (query.reasonId && query.reasonId !== 'all') {
      list = list.filter(r => r.reasonId === query.reasonId);
    }
    if (query.search) {
      const q = query.search.toLowerCase().trim();
      list = list.filter(r =>
        (r.returnCode || '').toLowerCase().includes(q) ||
        (r.orderId || '').toLowerCase().includes(q) ||
        (r.customerName || '').toLowerCase().includes(q) ||
        (r.vehicleName || '').toLowerCase().includes(q) ||
        (r.vin || '').toLowerCase().includes(q)
      );
    }

    // Sort
    if (query.sort === 'oldest') {
      list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    } else if (query.sort === 'refund_desc') {
      list.sort((a, b) => (b.financials?.estimatedRefundAmount || 0) - (a.financials?.estimatedRefundAmount || 0));
    } else {
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    // Scoped KPIs from real persisted records (no inflated constants)
    const totalRequests = scopedReturns.length;
    const completedCount = scopedReturns.filter(r => r.status === RETURN_STATUS.COMPLETED).length;
    const pendingCount = scopedReturns.filter(r => [RETURN_STATUS.PENDING_RECEIPT, RETURN_STATUS.CHECKING_CONDITIONS].includes(r.status)).length;
    const overdueCount = scopedReturns.filter(r => {
      if (r.status === RETURN_STATUS.COMPLETED || r.status === RETURN_STATUS.REJECTED) return false;
      const ageHours = (Date.now() - new Date(r.createdAt).getTime()) / (1000 * 60 * 60);
      return ageHours > 72;
    }).length;

    const completedWithDuration = scopedReturns.filter(r => r.status === RETURN_STATUS.COMPLETED && r.updatedAt && r.createdAt);
    const avgProcessingHours = completedWithDuration.length > 0
      ? Math.round(completedWithDuration.reduce((sum, r) => sum + ((new Date(r.updatedAt) - new Date(r.createdAt)) / 3600000), 0) / completedWithDuration.length)
      : null;

    return {
      returns: list,
      eligibleOrders,
      policy: RETURN_POLICY_RULES,
      reasons: RETURN_REASONS,
      stagesOrder: RETURN_STAGES_ORDER,
      kpis: {
        totalRequests,
        completedCount,
        completionRatePercent: totalRequests > 0 ? Math.round((completedCount / totalRequests) * 100) : null,
        avgProcessingHours,
        pendingCount,
        overdueCount
      }
    };
  },

  getReturnEstimate(user, { orderId, reasonId = 'other', currentOdoKm = 0 } = {}) {
    if (!orderId) {
      const err = new Error('Vui lòng chọn đơn hàng cần dự toán đổi trả.');
      err.statusCode = 400;
      throw err;
    }
    const order = (dbState.orders || []).find(o => o.id === orderId || o.orderNumber === orderId);
    if (!order) {
      const err = new Error(`Không tìm thấy đơn hàng mã "${orderId}".`);
      err.statusCode = 404;
      throw err;
    }
    if (user && user.role === ROLES.BUYER && order.userId !== user.userId) {
      const err = new Error('Bạn không có quyền dự toán cho đơn hàng của người khác.');
      err.statusCode = 403;
      throw err;
    }
    const odo = Number(currentOdoKm || 0);
    if (!Number.isFinite(odo) || odo < 0) {
      const err = new Error('Số ODO không hợp lệ.');
      err.statusCode = 422;
      throw err;
    }
    const eligibility = computeOrderReturnEligibility(order, dbState.returnRequests || []);
    const paidAmount = order.paymentStatus === PAYMENT_STATUS.FULLY_PAID
      ? (order.paidAmount || order.unitPrice)
      : (order.paidAmount || order.depositAmount || 50000000);
    const financials = calculateReturnFinancials({
      paidAmount,
      reasonId,
      currentOdoKm: odo
    });
    return {
      orderId: order.id,
      eligibility,
      financials,
      policy: RETURN_POLICY_RULES
    };
  },

  async createReturnRequest(user, payload) {
    const {
      orderId,
      requestType,
      reasonId,
      description,
      actualCondition,
      currentOdoKm,
      photos,
      mediaIds,
      pickupDate,
      pickupTimeSlot,
      pickupAddress,
      confirmedPolicy,
      requireEvidence
    } = payload;

    if (!orderId || !reasonId || !description) {
      throw new Error('Vui lòng chọn đơn hàng, lý do đổi trả và mô tả chi tiết tình trạng thực tế.');
    }
    if (!confirmedPolicy) {
      throw new Error('Vui lòng tích xác nhận đồng ý với điều kiện và chi phí dự kiến của Chính sách Đổi trả 7 ngày.');
    }
    if (String(description).trim().length < 15) {
      throw new Error('Mô tả vấn đề cần tối thiểu 15 ký tự để bộ phận kỹ thuật thẩm định chính xác.');
    }

    const odo = Number(currentOdoKm ?? 0);
    if (!Number.isFinite(odo) || odo < 0) {
      const err = new Error('Số ODO thực tế không hợp lệ.');
      err.statusCode = 422;
      throw err;
    }
    if (odo > RETURN_POLICY_RULES.maxOdoDeltaKm) {
      const err = new Error(`Quãng đường ODO phát sinh (${odo} km) vượt quá giới hạn tối đa ${RETURN_POLICY_RULES.maxOdoDeltaKm} km của chính sách đổi trả 7 ngày.`);
      err.statusCode = 422;
      throw err;
    }

    const hasExplicitEmptyPhotos = Array.isArray(photos) && photos.length === 0;
    const hasMediaIds = Array.isArray(mediaIds) && mediaIds.length > 0;
    if ((requireEvidence || hasExplicitEmptyPhotos) && !hasMediaIds && (!Array.isArray(photos) || photos.length === 0)) {
      const err = new Error('Vui lòng tải lên ít nhất 01 ảnh/video kiểm định hiện trạng xe thực tế (không chấp nhận gửi thiếu bằng chứng).');
      err.statusCode = 422;
      err.code = 'EVIDENCE_REQUIRED';
      throw err;
    }

    const validatedPhotos = validateAttachments(photos);

    return runInTransaction(async (state) => {
      const order = state.orders.find(o => o.id === orderId || o.orderNumber === orderId);
      if (!order) {
        const err = new Error(`Không tìm thấy đơn hàng mã "${orderId}".`);
        err.statusCode = 404;
        throw err;
      }
      if (user.role === ROLES.BUYER && order.userId !== user.userId) {
        const err = new Error('Bạn chỉ có thể tạo yêu cầu đổi trả cho đơn hàng của chính mình.');
        err.statusCode = 403;
        throw err;
      }
      if (Number.isFinite(order.handoverOdoKm) && odo < order.handoverOdoKm) {
        const err = new Error(`Số ODO khi đổi trả (${odo} km) không thể nhỏ hơn ODO lúc bàn giao (${order.handoverOdoKm} km).`);
        err.statusCode = 422;
        throw err;
      }

      const activeDup = (state.returnRequests || []).find(
        r => r.orderId === order.id && r.status !== RETURN_STATUS.REJECTED
      );
      if (activeDup) {
        const err = new Error(`Đơn hàng đang có hồ sơ đổi trả hoạt động (${activeDup.returnCode}).`);
        err.statusCode = 409;
        err.code = 'DUPLICATE_RETURN_CASE';
        throw err;
      }

      const eligibility = computeOrderReturnEligibility(order, state.returnRequests);
      if (!eligibility.isEligible) {
        const err = new Error(`Đơn hàng không đủ điều kiện đổi trả: ${eligibility.eligibleReason}`);
        err.statusCode = 422;
        err.code = 'RETURN_NOT_ELIGIBLE';
        throw err;
      }

      const verifiedMediaPhotos = hasMediaIds
        ? mediaIds.map(mid => {
            const m = (state.mediaAssets || []).find(a => a.id === mid && !a.deletedAt && a.scanStatus === 'clean' && a.ownerId === user.userId);
            if (!m) {
              const err = new Error(`Tệp bằng chứng "${mid}" không hợp lệ hoặc không thuộc quyền sở hữu của bạn.`);
              err.statusCode = 403;
              throw err;
            }
            return { name: m.fileName, mediaId: m.id, url: `/api/v1/media/${m.id}`, sizeKb: Math.round(m.sizeBytes / 1024) };
          })
        : [];

      const reasonObj = RETURN_REASONS.find(r => r.id === reasonId) || RETURN_REASONS[RETURN_REASONS.length - 1];
      const paidAmount = order.paymentStatus === PAYMENT_STATUS.FULLY_PAID
        ? (order.paidAmount || order.unitPrice)
        : (order.paidAmount || order.depositAmount || 50000000);
      const financials = calculateReturnFinancials({
        paidAmount,
        reasonId: reasonObj.id,
        currentOdoKm: odo
      });

      const returnCode = `RET-2026-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      const nowIso = new Date().toISOString();
      const evidenceList = verifiedMediaPhotos.length > 0 ? verifiedMediaPhotos : validatedPhotos;

      const newReturn = {
        id: returnCode,
        returnCode,
        orderId: order.id,
        orderNumber: order.orderNumber || order.id,
        branchId: order.branchId,
        branchName: order.branchName,
        userId: order.userId,
        customerName: order.buyerName || user.fullName,
        customerPhone: order.buyerPhone || '+84 901 234 567',
        vehicleId: order.vehicleId,
        vehicleName: order.vehicleName,
        vin: order.vin || null,
        licensePlate: order.licensePlate || 'Chưa bấm biển',
        image: order.img || order.image || 'assets/model-e.jpg',
        requestType: Security.sanitizeString(requestType || 'Đổi xe hoặc Hoàn tiền theo chính sách 7 ngày'),
        reasonId: reasonObj.id,
        reasonLabel: reasonObj.label,
        description: Security.sanitizeString(description),
        actualCondition: Security.sanitizeString(actualCondition || 'Nguyên bản, đầy đủ phụ kiện và giấy tờ theo xe.'),
        currentOdoKm: odo,
        photos: evidenceList,
        pickupSchedule: {
          date: Security.sanitizeString(pickupDate || new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)),
          timeSlot: Security.sanitizeString(pickupTimeSlot || '09:00 - 11:30'),
          address: Security.sanitizeString(pickupAddress || 'Nhận thu hồi tận nơi theo địa chỉ khách hàng'),
          carrierName: 'Chờ điều phối xe cứu hộ sàn trượt SIGMA Express',
          assignedStaff: 'Chờ phân công'
        },
        financials,
        status: RETURN_STATUS.PENDING_RECEIPT,
        supplementRequested: false,
        supplementNote: '',
        customerSupplements: [],
        history: [
          {
            status: RETURN_STATUS.PENDING_RECEIPT,
            note: 'Khách hàng đã gửi yêu cầu đổi trả trực tuyến và xác nhận điều khoản hoàn/khấu trừ.',
            updatedBy: user.fullName || 'Khách hàng',
            timestamp: nowIso
          }
        ],
        createdAt: nowIso,
        updatedAt: nowIso
      };

      state.returnRequests.unshift(newReturn);
      appendAuditLog(state, {
        action: 'RETURN_REQUEST_CREATED',
        actorId: user.userId,
        actorName: user.fullName,
        targetId: returnCode,
        detail: `Tạo yêu cầu đổi trả ${returnCode} cho đơn ${order.id} (${order.vehicleName}).`
      });

      return newReturn;
    });
  },

  async updateReturnStatus(user, returnId, payload) {
    const {
      status,
      note,
      carrierName,
      assignedStaff,
      pickupDate,
      pickupTimeSlot,
      supplementRequested,
      supplementNote,
      customDeductionAmount
    } = payload;

    return runInTransaction(async (state) => {
      const reqItem = state.returnRequests.find(r => r.id === returnId || r.returnCode === returnId);
      if (!reqItem) {
        const err = new Error(`Không tìm thấy hồ sơ đổi trả "${returnId}".`);
        err.statusCode = 404;
        throw err;
      }

      const linkedOrder = state.orders.find(o => o.id === reqItem.orderId);
      const branchScopeRecord = reqItem.branchId ? reqItem : { ...reqItem, branchId: linkedOrder && linkedOrder.branchId };
      Authorization.assertAuthorized(
        user.role === ROLES.ADMIN || Authorization.hasBranchAccess(user, branchScopeRecord.branchId),
        'Bạn không có quyền xử lý hồ sơ đổi trả thuộc chi nhánh khác.',
        403,
        'FORBIDDEN'
      );

      if (status && status !== reqItem.status) {
        const perm = canUserTransitionReturn(user.role, reqItem.status, status);
        if (!perm.allowed) {
          const err = new Error(perm.reason);
          err.statusCode = 403;
          throw err;
        }
        if (status === RETURN_STATUS.REJECTED && (!note || String(note).trim().length < 5)) {
          throw new Error('Vui lòng nhập lý do từ chối cụ thể để thông báo minh bạch cho khách hàng.');
        }
        reqItem.status = status;
      }

      if (carrierName !== undefined) reqItem.pickupSchedule.carrierName = Security.sanitizeString(carrierName);
      if (assignedStaff !== undefined) reqItem.pickupSchedule.assignedStaff = Security.sanitizeString(assignedStaff);
      if (pickupDate !== undefined) reqItem.pickupSchedule.date = Security.sanitizeString(pickupDate);
      if (pickupTimeSlot !== undefined) reqItem.pickupSchedule.timeSlot = Security.sanitizeString(pickupTimeSlot);

      if (supplementRequested !== undefined) {
        reqItem.supplementRequested = Boolean(supplementRequested);
        reqItem.supplementNote = Security.sanitizeString(supplementNote || '');
      }

      if (customDeductionAmount !== undefined && !Number.isNaN(Number(customDeductionAmount))) {
        const ded = Math.max(0, Number(customDeductionAmount));
        reqItem.financials.totalDeductions = ded;
        reqItem.financials.estimatedRefundAmount = Math.max(0, reqItem.financials.originalPaidAmount - ded);
      }

      if (reqItem.status === RETURN_STATUS.REFUND_PROCESSING) {
        reqItem.financials.refundStatus = 'Đang lệnh chuyển khoản hoàn tiền qua Ngân hàng';
      } else if (reqItem.status === RETURN_STATUS.COMPLETED) {
        reqItem.financials.refundStatus = 'Đã hoàn tiền / Đổi xe thành công 100%';
        const linkedOrder = state.orders.find(o => o.id === reqItem.orderId);
        if (linkedOrder) {
          linkedOrder.paymentStatus = PAYMENT_STATUS.REFUNDED;
        }
      } else if (reqItem.status === RETURN_STATUS.REJECTED) {
        reqItem.financials.refundStatus = 'Hồ sơ từ chối — Không phát sinh hoàn tiền';
      }

      const nowIso = new Date().toISOString();
      reqItem.updatedAt = nowIso;
      reqItem.history.push({
        status: reqItem.status,
        note: Security.sanitizeString(note || `Cập nhật trạng thái sang "${reqItem.status}"`),
        updatedBy: `${user.fullName} (${user.role})`,
        timestamp: nowIso
      });

      appendAuditLog(state, {
        action: 'RETURN_STATUS_UPDATED',
        actorId: user.userId,
        actorName: user.fullName,
        targetId: reqItem.returnCode,
        detail: `Cập nhật ${reqItem.returnCode} -> ${reqItem.status}. Ghi chú: ${note || 'Không có'}`
      });

      NotificationService.enqueueOutboxInState(state, {
        eventType: 'return_updated',
        aggregateType: 'return_request',
        aggregateId: reqItem.returnCode,
        userId: reqItem.userId,
        templateId: 'return_updated',
        payload: { returnCode: reqItem.returnCode, status: reqItem.status },
        dedupeKey: `return_updated:${reqItem.returnCode}:${reqItem.status}`
      });

      return reqItem;
    });
  },

  async submitReturnSupplement(user, returnId, payload) {
    const { message, photos, pickupDate, pickupTimeSlot, pickupAddress } = payload;
    return runInTransaction(async (state) => {
      const reqItem = state.returnRequests.find(r => r.id === returnId || r.returnCode === returnId);
      if (!reqItem) {
        const err = new Error(`Không tìm thấy hồ sơ đổi trả "${returnId}".`);
        err.statusCode = 404;
        throw err;
      }

      const linkedOrder = state.orders.find(o => o.id === reqItem.orderId);
      const branchScopeRecord = reqItem.branchId ? reqItem : { ...reqItem, branchId: linkedOrder && linkedOrder.branchId };
      Authorization.assertAuthorized(
        Authorization.canAccessBranchResource(user, branchScopeRecord, 'userId', 'branchId'),
        'Bạn không có quyền chỉnh sửa hồ sơ đổi trả này.',
        403,
        'FORBIDDEN'
      );

      const extraPhotos = validateAttachments(photos);
      if (extraPhotos.length > 0) {
        reqItem.photos.push(...extraPhotos);
      }
      if (pickupDate) reqItem.pickupSchedule.date = Security.sanitizeString(pickupDate);
      if (pickupTimeSlot) reqItem.pickupSchedule.timeSlot = Security.sanitizeString(pickupTimeSlot);
      if (pickupAddress) reqItem.pickupSchedule.address = Security.sanitizeString(pickupAddress);

      const nowIso = new Date().toISOString();
      if (!Array.isArray(reqItem.customerSupplements)) reqItem.customerSupplements = [];
      reqItem.customerSupplements.push({
        message: Security.sanitizeString(message || 'Đã cập nhật thông tin bổ sung và lịch thu hồi.'),
        photosCount: extraPhotos.length,
        timestamp: nowIso
      });
      reqItem.supplementRequested = false;
      reqItem.updatedAt = nowIso;
      reqItem.history.push({
        status: reqItem.status,
        note: `Khách hàng bổ sung thông tin: ${Security.sanitizeString(message || 'Cập nhật lịch & ảnh hiện trạng')}`,
        updatedBy: user.fullName,
        timestamp: nowIso
      });

      return reqItem;
    });
  },

  // ===========================================================================
  // SECTION 3: DIGITAL WARRANTY & MAINTENANCE LIFECYCLE
  // ===========================================================================
  getWarrantyAndMaintenanceData(user) {
    const resolveOrderBranch = (orderId) => {
      const o = (dbState.orders || []).find(ord => ord.id === orderId);
      return o ? o.branchId : null;
    };
    const resolveCenterBranch = (centerId) => {
      const c = SERVICE_CENTERS.find(sc => sc.id === centerId);
      if (!c) return centerId;
      if (centerId.startsWith('sc-hn')) return 'hn-caugiay';
      if (centerId.startsWith('sc-hcm')) return 'hcm-q7';
      if (centerId.startsWith('sc-dn')) return 'dn-haichau';
      return centerId;
    };

    const warranties = (dbState.warranties || []).filter(w => {
      const rec = w.branchId ? w : { ...w, branchId: resolveOrderBranch(w.orderId) };
      return Authorization.canAccessBranchResource(user, rec, 'userId', 'branchId');
    });

    const serviceRecords = (dbState.serviceRecords || []).filter(sr => {
      const rec = sr.branchId ? sr : { ...sr, branchId: resolveCenterBranch(sr.serviceCenterId) };
      return Authorization.canAccessBranchResource(user, rec, 'userId', 'branchId');
    });

    const serviceAppointments = (dbState.serviceAppointments || []).filter(sa => {
      const rec = sa.branchId ? sa : { ...sa, branchId: resolveCenterBranch(sa.serviceCenterId) };
      return Authorization.canAccessBranchResource(user, rec, 'userId', 'branchId');
    });

    const userOrders = (dbState.orders || []).filter(o => Authorization.canReadOrder(user, o));

    const unactivatedOrders = userOrders.filter(o => {
      const hasWarranty = dbState.warranties.some(
        w => w.orderId === o.id || (o.vin && w.vin === o.vin)
      );
      return !hasWarranty && [ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED].includes(o.orderStatus);
    }).map(o => ({
      orderId: o.id,
      orderNumber: o.orderNumber || o.id,
      vehicleId: o.vehicleId,
      vehicleName: o.vehicleName,
      edition: o.edition || 'Tiêu chuẩn',
      color: o.color || 'Trắng Ngọc Trai',
      image: o.img || o.image || 'assets/model-e.jpg',
      vin: o.vin || null,
      motorNumber: o.motorNumber || null,
      licensePlate: o.licensePlate || 'Chưa cập nhật',
      invoiceNumber: o.invoiceNumber || `INV-${o.id}`,
      purchaseDate: (o.deliveredAt || o.createdAt || new Date().toISOString()).slice(0, 10)
    }));

    // Compute smart maintenance reminders for active warranties
    const reminders = warranties.map(w => {
      const nextMilestone = MAINTENANCE_MILESTONES.find(m => m.km > (w.currentOdoKm || 0)) || MAINTENANCE_MILESTONES[MAINTENANCE_MILESTONES.length - 1];
      const kmRemaining = Math.max(0, nextMilestone.km - (w.currentOdoKm || 0));
      return {
        warrantyId: w.id,
        vehicleName: w.vehicleName,
        licensePlate: w.licensePlate,
        vin: w.vin,
        currentOdoKm: w.currentOdoKm || 0,
        nextMilestoneTitle: nextMilestone.title,
        nextMilestoneKm: nextMilestone.km,
        kmRemaining,
        estimatedCost: nextMilestone.costEstimated,
        recommendedItems: nextMilestone.items,
        urgency: kmRemaining <= 3000 ? 'Sắp đến hạn bảo dưỡng' : 'Đang hoạt động tốt'
      };
    });

    // Dynamic Workshop Bay & Parts status for Admin/Seller After-Sales Dashboard (SIG-P4-001)
    const liveSummary = WorkshopService.getWorkshopStatusSummary();
    const today = new Date().toISOString().slice(0, 10);
    const activeJobsByBay = new Map();
    (dbState.workshopJobs || []).forEach(j => {
      if (['Scheduled', 'In_Progress'].includes(j.status) && j.scheduledDate >= today && !activeJobsByBay.has(j.bayId)) {
        activeJobsByBay.set(j.bayId, j);
      }
    });
    const dynamicBays = (dbState.serviceBays || []).slice(0, 8).map(bay => {
      const job = activeJobsByBay.get(bay.id);
      return {
        id: bay.name || bay.id,
        bayId: bay.id,
        serviceCenterId: bay.serviceCenterId,
        vehicle: job ? `${job.vehicleName}${job.vin ? ` (${job.vin})` : ''}` : 'Trống — Sẵn sàng tiếp nhận',
        task: job ? `${job.serviceType} (${job.timeSlot})` : (bay.bayType || 'Khoang dịch vụ tiêu chuẩn'),
        progress: job ? (job.status === 'In_Progress' ? 50 : 15) : 0,
        status: job ? (job.status === 'In_Progress' ? 'Đang thực hiện' : `Đã xếp lịch (${job.scheduledDate})`) : 'Sẵn sàng',
        technician: job ? job.technicianName : 'Chờ điều phối'
      };
    });
    const dynamicParts = (dbState.partsLedger || []).map(part => {
      const available = Math.max(0, Number(part.stockOnHand || 0) - Number(part.stockReserved || 0));
      return {
        code: part.sku,
        name: part.name,
        available,
        reserved: Number(part.stockReserved || 0),
        status: available <= 0 ? 'Hết hàng (0)' : (available <= 5 ? `Sắp hết (Còn ${available})` : `Đủ hàng (${available})`),
        level: available <= 5 ? 'warning' : 'good'
      };
    });
    const workshopStatus = {
      bays: dynamicBays,
      partsInventory: dynamicParts,
      centers: liveSummary.centers,
      lowStockParts: liveSummary.lowStockParts,
      totalActiveJobs: liveSummary.totalActiveJobs
    };

    return {
      warranties,
      unactivatedOrders,
      coveredComponents: WARRANTY_COVERED_COMPONENTS,
      maintenanceMilestones: MAINTENANCE_MILESTONES,
      serviceCenters: SERVICE_CENTERS,
      serviceRecords,
      serviceAppointments,
      reminders,
      workshopStatus,
      notificationConfig: {
        emailConfigured: Boolean(process.env.SMTP_HOST || process.env.EMAIL_WEBHOOK_URL),
        smsProviderConfigured: Boolean(process.env.SMS_API_KEY),
        smsNote: process.env.SMS_API_KEY
          ? 'Đã kết nối cổng SMS Brandname SIGMACAR'
          : 'Chế độ giả lập an toàn (Chưa cấu hình SMS_API_KEY trong .env — Chỉ gửi khi khách hàng bật đồng ý SMS)'
      }
    };
  },

  async activateElectronicWarranty(user, payload) {
    const { vin, motorNumber, invoiceNumber, licensePlate } = payload;
    if (!vin || !motorNumber || !invoiceNumber) {
      throw new Error('Vui lòng nhập đầy đủ Mã số khung (VIN), Mã động cơ (Motor Code) và Số hóa đơn / Mã đơn hàng.');
    }

    const cleanVin = String(vin).trim().toUpperCase();
    const cleanMotor = String(motorNumber).trim().toUpperCase();
    const cleanInvoice = String(invoiceNumber).trim().toUpperCase();

    return runInTransaction(async (state) => {
      // Prevent duplicate warranty for the same VIN
      const duplicate = state.warranties.find(w => w.vin.toUpperCase() === cleanVin);
      if (duplicate) {
        const err = new Error(`Số khung VIN "${cleanVin}" đã được kích hoạt bảo hành điện tử (Mã: ${duplicate.warrantyCode}). Không thể tạo hồ sơ trùng lặp.`);
        err.statusCode = 409;
        err.code = 'DUPLICATE_VIN';
        throw err;
      }

      // Verify against real orders in database
      const matchedOrder = state.orders.find(o => {
        const orderVin = (o.vin || `SGME2026VN00${o.id.replace(/\D/g, '')}`).toUpperCase();
        const orderInv = (o.invoiceNumber || `INV-${o.id}`).toUpperCase();
        const orderIdUpper = o.id.toUpperCase();
        return orderVin === cleanVin && (orderInv === cleanInvoice || orderIdUpper === cleanInvoice);
      });

      if (!matchedOrder) {
        const err = new Error(`Xác thực thất bại: Không tìm thấy đơn hàng chính hãng khớp với số khung VIN "${cleanVin}" và mã hóa đơn/đơn hàng "${cleanInvoice}". Vui lòng kiểm tra lại biên bản bàn giao xe.`);
        err.statusCode = 404;
        err.code = 'ORDER_OR_VIN_NOT_FOUND';
        throw err;
      }

      if ([ORDER_STATUS.PENDING, ORDER_STATUS.CANCELLED, ORDER_STATUS.FAILED].includes(matchedOrder.orderStatus)) {
        const err = new Error(`Đơn hàng ${matchedOrder.orderNumber || matchedOrder.id} đang ở trạng thái "${matchedOrder.orderStatus}" nên chưa đủ điều kiện kích hoạt bảo hành.`);
        err.statusCode = 409;
        err.code = 'ORDER_NOT_ELIGIBLE';
        throw err;
      }

      const expectedMotor = (matchedOrder.motorNumber || '').toUpperCase();
      if (expectedMotor && expectedMotor !== cleanMotor) {
        const err = new Error(`Mã động cơ "${cleanMotor}" không khớp với dữ liệu xuất xưởng của số khung "${cleanVin}".`);
        err.statusCode = 422;
        err.code = 'MOTOR_MISMATCH';
        throw err;
      }

      if (user.role === ROLES.BUYER && matchedOrder.userId !== user.userId) {
        const err = new Error('Số khung VIN này thuộc về một tài khoản khách hàng khác.');
        err.statusCode = 403;
        throw err;
      }

      const handover = (state.handovers || []).find(h => h.orderId === matchedOrder.id);
      const vehicle = state.vehicles.find(v => v.id === matchedOrder.vehicleId) ||
        state.certifiedVehicles.find(v => v.id === matchedOrder.vehicleId);
      const isEv = vehicle ? String(vehicle.fuel || '').toLowerCase() === 'ev' : true;
      const warrantyPolicy = PolicyService.getActivePolicy(isEv ? 'warranty_ev' : 'warranty_ice');
      const wRules = warrantyPolicy.rules || { vehicleYears: isEv ? 5 : 3, vehicleMaxKm: isEv ? 150000 : 100000, batteryYears: isEv ? 8 : 0, batteryMaxKm: isEv ? 160000 : 0 };

      // Ignore tampered client purchaseDate: always derive from authoritative handover/delivery timestamp
      const start = ((handover && handover.handedOverAt) || matchedOrder.deliveredAt || matchedOrder.createdAt || new Date().toISOString()).slice(0, 10);
      const endDate = HandoverService.addYearsSafeIsoDate(start, wRules.vehicleYears || 3);
      const batteryEndDate = (wRules.batteryYears || 0) > 0 ? HandoverService.addYearsSafeIsoDate(start, wRules.batteryYears) : null;

      const warrantyCode = `EW-SIGMA-${start.slice(0, 4)}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
      const newWarranty = {
        id: `WAR-${crypto.randomUUID().slice(0, 8)}`,
        warrantyCode,
        orderId: matchedOrder.id,
        orderNumber: matchedOrder.orderNumber || matchedOrder.id,
        userId: matchedOrder.userId,
        ownerName: matchedOrder.buyerName || user.fullName,
        ownerPhone: matchedOrder.buyerPhone || '+84 901 234 567',
        vehicleId: matchedOrder.vehicleId,
        vehicleName: matchedOrder.vehicleName,
        fuel: (vehicle && vehicle.fuel) || 'ev',
        edition: matchedOrder.edition || 'Bản Tiêu Chuẩn',
        color: matchedOrder.color || 'Trắng Ngọc Trai',
        image: matchedOrder.img || matchedOrder.image || 'assets/garage-car-detail.jpg',
        vin: cleanVin,
        motorNumber: cleanMotor,
        licensePlate: Security.sanitizeString(licensePlate || matchedOrder.licensePlate || 'Đang chờ cấp biển'),
        invoiceNumber: cleanInvoice,
        purchaseDate: start,
        activatedAt: new Date().toISOString(),
        startDate: start,
        endDate,
        batteryEndDate,
        policyVersion: warrantyPolicy.version,
        maxKm: wRules.vehicleMaxKm,
        batteryMaxKm: wRules.batteryMaxKm || 0,
        currentOdoKm: matchedOrder.handoverOdoKm || 0,
        batteryHealthPercent: isEv ? null : null,
        nextMaintenanceKm: (matchedOrder.handoverOdoKm || 0) + 1000,
        nextMaintenanceDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        maintenanceStatus: 'Đang hoạt động',
        status: WARRANTY_STATUS.ACTIVE,
        scopeSummary: wRules.summary || warrantyPolicy.title,
        verifiedBy: `Xác thực tự động theo đơn hàng ${matchedOrder.id}`
      };

      state.warranties.unshift(newWarranty);
      appendAuditLog(state, {
        action: 'WARRANTY_ACTIVATED',
        actorId: user.userId,
        actorName: user.fullName,
        targetId: warrantyCode,
        detail: `Kích hoạt bảo hành điện tử ${warrantyCode} cho VIN ${cleanVin} (Đơn ${matchedOrder.id}).`
      });

      NotificationService.enqueueOutboxInState(state, {
        eventType: 'warranty_activated',
        aggregateType: 'warranty',
        aggregateId: warrantyCode,
        userId: matchedOrder.userId,
        templateId: 'warranty_activated',
        payload: {
          warrantyCode,
          vin: cleanVin,
          startDate: start,
          endDate
        },
        dedupeKey: `warranty_activated:${cleanVin}`
      });

      return newWarranty;
    });
  },

  async createServiceAppointment(user, payload) {
    const {
      vehicleId,
      vehicleName,
      vin,
      licensePlate,
      serviceType,
      serviceItems,
      serviceCenterId,
      preferredDate,
      timeSlot,
      conditionNotes
    } = payload;

    if (!vehicleName || !serviceCenterId || !preferredDate || !timeSlot) {
      throw new Error('Vui lòng chọn xe, trung tâm dịch vụ, ngày và khung giờ đặt lịch.');
    }
    if (!vin || String(vin).trim().length < 6) {
      const err = new Error('Vui lòng cung cấp số khung VIN hợp lệ của xe cần bảo dưỡng.');
      err.statusCode = 422;
      err.code = 'VIN_REQUIRED';
      throw err;
    }

    const center = SERVICE_CENTERS.find(c => c.id === serviceCenterId) || SERVICE_CENTERS[0];
    const cleanVin = String(vin).trim().toUpperCase();
    const cleanDate = Security.sanitizeString(preferredDate);
    const cleanSlot = Security.sanitizeString(timeSlot);

    return runInTransaction(async (state) => {
      // Verify VIN ownership (must match user's warranty, ownership or order unless privileged staff)
      const knownWarranty = state.warranties.find(w => (w.vin || '').toUpperCase() === cleanVin);
      const knownOrder = state.orders.find(o => (o.vin || '').toUpperCase() === cleanVin);
      const knownOwner = knownWarranty || knownOrder;
      if (!knownOwner && user.role === ROLES.BUYER) {
        const err = new Error(`Số khung VIN "${cleanVin}" chưa được ghi nhận trong hệ thống xe sở hữu của bạn.`);
        err.statusCode = 422;
        err.code = 'UNKNOWN_VIN';
        throw err;
      }
      if (knownOwner && user.role === ROLES.BUYER && knownOwner.userId !== user.userId) {
        const err = new Error('Bạn không có quyền đặt lịch bảo dưỡng cho số khung VIN của chủ xe khác.');
        err.statusCode = 403;
        err.code = 'FORBIDDEN';
        throw err;
      }

      // Enforce bay capacity for same center, date & slot
      const activeBookingsInSlot = state.serviceAppointments.filter(a =>
        a.serviceCenterId === center.id &&
        a.preferredDate === cleanDate &&
        a.timeSlot === cleanSlot &&
        ![APPOINTMENT_STATUS.CANCELLED, APPOINTMENT_STATUS.NO_SHOW].includes(a.status)
      );
      const maxBays = center.baysCount || 4;
      if (activeBookingsInSlot.length >= maxBays) {
        const err = new Error(`Trung tâm ${center.name} đã kín toàn bộ ${maxBays} khoang dịch vụ cho khung giờ "${cleanSlot}" ngày ${cleanDate}.`);
        err.statusCode = 409;
        err.code = 'SLOT_CONFLICT';
        throw err;
      }

      const randCode = crypto.randomUUID().slice(0, 6).toUpperCase();
      const code = `#APT-2026-${randCode}`;
      const appt = {
        id: `SAP-${randCode}`,
        appointmentCode: code,
        userId: user.userId,
        customerName: user.fullName,
        phone: payload.phone || '+84 901 234 567',
        vehicleId: (knownOwner && knownOwner.vehicleId) || vehicleId || null,
        vehicleName: Security.sanitizeString((knownOwner && knownOwner.vehicleName) || vehicleName),
        vin: cleanVin,
        licensePlate: Security.sanitizeString(licensePlate || (knownOwner && knownOwner.licensePlate) || 'Chưa cập nhật'),
        image: (knownOwner && knownOwner.image) || 'assets/car-thumb-s5.jpg',
        serviceType: Security.sanitizeString(serviceType || 'BẢO DƯỠNG ĐỊNH KỲ'),
        serviceItems: Array.isArray(serviceItems) && serviceItems.length > 0
          ? serviceItems.map(i => Security.sanitizeString(i))
          : ['Bảo dưỡng định kỳ tiêu chuẩn'],
        serviceCenterId: center.id,
        serviceCenterName: center.name,
        serviceCenterAddress: center.address,
        preferredDate: cleanDate,
        timeSlot: cleanSlot,
        conditionNotes: Security.sanitizeString(conditionNotes || 'Kiểm tra bảo dưỡng định kỳ theo lịch khuyến nghị.'),
        assignedTechnician: 'Chờ phân công kỹ sư',
        bayNumber: `Khoang 0${(activeBookingsInSlot.length % maxBays) + 1}`,
        status: APPOINTMENT_STATUS.PENDING,
        reminderChannels: { email: true, push: true, sms: false },
        createdAt: new Date().toISOString()
      };

      state.serviceAppointments.unshift(appt);
      appendAuditLog(state, {
        action: 'SERVICE_APPOINTMENT_BOOKED',
        actorId: user.userId,
        actorName: user.fullName,
        targetId: code,
        detail: `Đặt lịch dịch vụ ${code} cho xe ${appt.vehicleName} (VIN: ${cleanVin}) tại ${center.name} ngày ${cleanDate}.`
      });

      NotificationService.enqueueOutboxInState(state, {
        eventType: 'service_reminder',
        aggregateType: 'service_appointment',
        aggregateId: appt.id,
        userId: user.userId,
        templateId: 'service_reminder',
        payload: {
          appointmentCode: appt.appointmentCode,
          vehicleName: appt.vehicleName,
          serviceCenterName: appt.serviceCenterName,
          preferredDate: appt.preferredDate,
          timeSlot: appt.timeSlot
        },
        dedupeKey: `service_reminder:${appt.id}`
      });

      return appt;
    });
  },

  async updateServiceAppointmentStatus(user, id, payload) {
    const { status, assignedTechnician, bayNumber, preferredDate, timeSlot } = payload;
    return runInTransaction(async (state) => {
      const appt = state.serviceAppointments.find(a => a.id === id || a.appointmentCode === id);
      if (!appt) throw new Error('Không tìm thấy lịch hẹn dịch vụ.');

      if (user.role === ROLES.BUYER && appt.userId !== user.userId) {
        const err = new Error('Bạn chỉ có quyền thao tác trên lịch hẹn của chính mình.');
        err.statusCode = 403;
        throw err;
      }

      if (status && status !== appt.status) {
        const perm = canUserTransitionAppointment(user.role, appt.status, status);
        if (!perm.allowed) {
          const err = new Error(perm.reason);
          err.statusCode = 403;
          throw err;
        }
        appt.status = status;
      }

      if (preferredDate) appt.preferredDate = Security.sanitizeString(preferredDate);
      if (timeSlot) appt.timeSlot = Security.sanitizeString(timeSlot);
      if (assignedTechnician && user.role !== ROLES.BUYER) {
        appt.assignedTechnician = Security.sanitizeString(assignedTechnician);
      }
      if (bayNumber && user.role !== ROLES.BUYER) {
        appt.bayNumber = Security.sanitizeString(bayNumber);
      }
      appt.updatedAt = new Date().toISOString();
      return appt;
    });
  },

  async createServiceRecord(user, payload) {
    if (![ROLES.ADMIN, ROLES.SELLER, ROLES.SERVICE_STAFF].includes(user.role)) {
      const err = new Error('Chỉ kỹ thuật viên hoặc quản trị viên mới có quyền ghi nhận hồ sơ bảo dưỡng/sửa chữa.');
      err.statusCode = 403;
      throw err;
    }

    const {
      vin,
      odoKm,
      serviceType,
      serviceCenterId,
      technicianName,
      itemsPerformed,
      partsReplaced,
      inspectionResult,
      laborCost,
      partsCost,
      batteryHealthPercent
    } = payload;

    if (!vin || !serviceType || !inspectionResult) {
      throw new Error('Vui lòng nhập số khung VIN, hạng mục bảo dưỡng và kết quả kiểm tra kỹ thuật.');
    }

    return runInTransaction(async (state) => {
      const cleanVin = String(vin).trim().toUpperCase();
      const warranty = state.warranties.find(w => w.vin.toUpperCase() === cleanVin);
      const linkedOrder = !warranty
        ? state.orders.find(o => (o.vin || '').toUpperCase() === cleanVin)
        : null;
      if (!warranty && !linkedOrder) {
        const err = new Error(`Không tìm thấy hồ sơ xe hoặc bảo hành khớp với số khung VIN "${cleanVin}".`);
        err.statusCode = 404;
        err.code = 'VIN_NOT_FOUND';
        throw err;
      }

      const ownerRef = warranty || linkedOrder;
      const center = SERVICE_CENTERS.find(c => c.id === serviceCenterId) || SERVICE_CENTERS[0];

      const lCost = Number(laborCost || 0);
      const pCost = Number(partsCost || 0);
      if (!Number.isFinite(lCost) || lCost < 0 || !Number.isFinite(pCost) || pCost < 0) {
        const err = new Error('Chi phí nhân công và phụ tùng phải là số không âm hợp lệ.');
        err.statusCode = 422;
        err.code = 'INVALID_SERVICE_COST';
        throw err;
      }

      const prevOdo = warranty ? Number(warranty.currentOdoKm || 0) : Number(linkedOrder.handoverOdoKm || 0);
      const newOdo = odoKm !== undefined && odoKm !== null && odoKm !== '' ? Number(odoKm) : prevOdo;
      if (!Number.isFinite(newOdo) || newOdo < 0 || newOdo < prevOdo) {
        const err = new Error(`Số ODO mới (${newOdo} km) không được nhỏ hơn ODO ghi nhận trước đó (${prevOdo} km).`);
        err.statusCode = 422;
        err.code = 'INVALID_ODO_REGRESSION';
        throw err;
      }

      const record = {
        id: `SRV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        warrantyId: warranty ? warranty.id : null,
        userId: ownerRef.userId,
        vehicleId: ownerRef.vehicleId,
        vehicleName: ownerRef.vehicleName,
        vin: cleanVin,
        licensePlate: ownerRef.licensePlate || 'Chưa cập nhật',
        serviceDate: new Date().toISOString().slice(0, 10),
        odoKm: newOdo,
        serviceType: Security.sanitizeString(serviceType),
        serviceCenterId: center.id,
        serviceCenterName: center.name,
        technicianName: Security.sanitizeString(technicianName || user.fullName),
        itemsPerformed: Array.isArray(itemsPerformed)
          ? itemsPerformed.map(i => Security.sanitizeString(i))
          : [Security.sanitizeString(String(itemsPerformed || serviceType))],
        partsReplaced: Array.isArray(partsReplaced) ? partsReplaced : [],
        inspectionResult: Security.sanitizeString(inspectionResult),
        laborCost: lCost,
        partsCost: pCost,
        totalCost: lCost + pCost,
        invoiceCode: `HD-DV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
        status: 'Hoàn thành'
      };

      state.serviceRecords.unshift(record);

      // Sync ODO and Battery SoH onto the linked warranty record
      if (warranty) {
        if (newOdo > (warranty.currentOdoKm || 0)) {
          warranty.currentOdoKm = newOdo;
        }
        if (batteryHealthPercent !== undefined && batteryHealthPercent !== null && !Number.isNaN(Number(batteryHealthPercent))) {
          warranty.batteryHealthPercent = Math.min(100, Math.max(50, Number(batteryHealthPercent)));
        }
      }

      appendAuditLog(state, {
        action: 'SERVICE_RECORD_LOGGED',
        actorId: user.userId,
        actorName: user.fullName,
        targetId: record.id,
        detail: `Ghi nhận lịch sử bảo dưỡng ${record.invoiceCode} cho VIN ${cleanVin} (${record.serviceType}).`
      });

      return record;
    });
  },

  // ===========================================================================
  // SECTION 4: VERIFIED REVIEWS & COMMUNITY Q&A (SIG-P4-004, SIG-P4-005)
  // ===========================================================================
  _findVerifiedHandoverOrder(stateOrDb, userId, vehicleId) {
    if (!userId || !vehicleId) return null;
    const handover = (stateOrDb.handovers || []).find(
      h => h.buyerUserId === userId && h.vehicleId === vehicleId && h.status === 'Completed'
    );
    if (handover) {
      return { id: handover.orderId || handover.id, handoverId: handover.id };
    }
    return (stateOrDb.orders || []).find(
      o => o.userId === userId &&
        o.vehicleId === vehicleId &&
        [ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED].includes(o.orderStatus)
    ) || null;
  },

  _validateCommunityAttachments(state, user, media = [], mediaIds = []) {
    const validated = validateAttachments(media).map(item => {
      const safeUrl = Security.sanitizeUrl(item.url || 'assets/garage-car-detail.jpg', { allowRelative: true }) || 'assets/garage-car-detail.jpg';
      return { ...item, url: safeUrl };
    });
    if (Array.isArray(mediaIds) && mediaIds.length > 0) {
      const assets = Array.isArray(state.mediaAssets) ? state.mediaAssets : [];
      for (const mid of mediaIds.slice(0, 8)) {
        const asset = assets.find(a => a.id === mid);
        if (!asset) {
          const err = new Error(`Không tìm thấy tệp phương tiện "${mid}".`);
          err.statusCode = 404;
          err.code = 'MEDIA_NOT_FOUND';
          throw err;
        }
        if (asset.deletedAt || asset.scanStatus === 'quarantined' || asset.moderationStatus === 'quarantined') {
          const err = new Error('Tệp đính kèm đã bị xóa hoặc đang bị cách ly kiểm duyệt.');
          err.statusCode = 422;
          err.code = 'MEDIA_UNAVAILABLE';
          throw err;
        }
        const assetOwner = asset.ownerId || asset.ownerUserId;
        if (assetOwner && assetOwner !== user.userId && user.role !== ROLES.ADMIN) {
          const err = new Error('Bạn không có quyền sử dụng tệp đính kèm của người dùng khác.');
          err.statusCode = 403;
          err.code = 'MEDIA_OWNERSHIP_FORBIDDEN';
          throw err;
        }
        validated.push({
          mediaId: asset.id,
          name: Security.sanitizeString(asset.fileName || asset.originalFilename || asset.id),
          url: Security.sanitizeUrl(asset.url || 'assets/garage-car-detail.jpg', { allowRelative: true }) || 'assets/garage-car-detail.jpg',
          type: String(asset.mimeType || '').startsWith('video/') ? 'video' : 'image',
          sizeKb: Math.max(1, Math.round(Number(asset.sizeBytes || 0) / 1024)),
          caption: ''
        });
      }
    }
    return validated;
  },

  _sanitizeReviewForViewer(review, currentUser) {
    const isModerator = Boolean(currentUser && [ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF].includes(currentUser.role));
    const isOwner = Boolean(currentUser && review.userId === currentUser.userId);
    const out = {
      id: review.id,
      vehicleId: review.vehicleId,
      vehicleName: review.vehicleName,
      authorName: review.authorName,
      authorTier: review.authorTier || 'Thành viên SIGMACAR',
      verifiedPurchase: Boolean(review.verifiedPurchase),
      rating: Number(review.rating),
      criteria: review.criteria || {},
      title: review.title,
      content: review.content,
      media: Array.isArray(review.media) ? review.media : [],
      helpfulCount: Array.isArray(review.helpfulVoterIds) ? review.helpfulVoterIds.length : 0,
      viewerVotedHelpful: Boolean(currentUser && Array.isArray(review.helpfulVoterIds) && review.helpfulVoterIds.includes(currentUser.userId)),
      isOwner,
      moderationStatus: review.moderationStatus || 'approved',
      createdAt: review.createdAt,
      updatedAt: review.updatedAt
    };
    if (isModerator) {
      out.reportCount = Array.isArray(review.reportedBy) ? review.reportedBy.length : 0;
      out.reportReason = review.reportReason || '';
      out.moderationNote = review.moderationNote || '';
      out.moderatedBy = review.moderatedBy || null;
      out.orderId = review.orderId || null;
    } else if (isOwner) {
      out.moderationNote = review.moderationNote || '';
    }
    return out;
  },

  _sanitizeQuestionForViewer(qObj, currentUser) {
    const isModerator = Boolean(currentUser && [ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF].includes(currentUser.role));
    const isOwner = Boolean(currentUser && qObj.userId === currentUser.userId);
    const rawAnswers = Array.isArray(qObj.answers) ? qObj.answers : [];
    const visibleAnswers = rawAnswers
      .filter(ans => isModerator || !['hidden', 'removed'].includes(ans.status || 'approved'))
      .map(ans => ({
        id: ans.id,
        authorName: ans.authorName,
        authorRole: ans.authorRole,
        content: ans.content,
        status: ans.status || 'approved',
        isOwner: Boolean(currentUser && ans.userId === currentUser.userId),
        createdAt: ans.createdAt
      }));
    const out = {
      id: qObj.id,
      vehicleId: qObj.vehicleId,
      vehicleName: qObj.vehicleName,
      authorName: qObj.authorName,
      question: qObj.question,
      status: qObj.status || 'approved',
      isOwner,
      answers: visibleAnswers,
      createdAt: qObj.createdAt,
      updatedAt: qObj.updatedAt || qObj.createdAt
    };
    if (isModerator) {
      out.reportCount = Array.isArray(qObj.reportedBy) ? qObj.reportedBy.length : 0;
      out.moderationNote = qObj.moderationNote || '';
    }
    return out;
  },

  _assertCommunityRateLimit(user, action = 'post') {
    if (!user || user.role === ROLES.ADMIN) return;
    const rl = Security.checkRateLimit(`community:${user.userId}:${action}`, 8, 5 * 60 * 1000);
    if (!rl.allowed) {
      const err = new Error('Bạn đang gửi nội dung cộng đồng quá nhanh. Vui lòng thử lại sau ít phút.');
      err.statusCode = 429;
      err.code = 'COMMUNITY_RATE_LIMITED';
      throw err;
    }
  },

  getReviewsAndQuestions(query = {}, currentUser = null) {
    const isModerator = currentUser && [ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF].includes(currentUser.role);
    const vehicleId = query.vehicleId;

    let allReviews = Array.isArray(dbState.reviews) ? [...dbState.reviews] : [];
    if (vehicleId && vehicleId !== 'all') {
      allReviews = allReviews.filter(r => r.vehicleId === vehicleId);
    }

    // Only approved reviews are public; moderators can inspect all if includeModerated=true
    const visibleReviews = (isModerator && query.includeModerated === 'true')
      ? allReviews
      : allReviews.filter(r => r.moderationStatus === 'approved' || (currentUser && r.userId === currentUser.userId));

    // Calculate authentic rating stats from approved reviews for this vehicle/scope
    const approvedForStats = allReviews.filter(r => r.moderationStatus === 'approved');
    const totalReviews = approvedForStats.length;
    const starDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    const criteriaSums = { design: 0, performance: 0, features: 0, comfort: 0, value: 0 };

    let ratingSum = 0;
    let verifiedCount = 0;
    approvedForStats.forEach(r => {
      const s = Math.min(5, Math.max(1, Math.round(Number(r.rating) || 5)));
      starDistribution[s] = (starDistribution[s] || 0) + 1;
      ratingSum += s;
      if (r.verifiedPurchase) verifiedCount += 1;
      const c = r.criteria || {};
      criteriaSums.design += Number(c.design || s);
      criteriaSums.performance += Number(c.performance || s);
      criteriaSums.features += Number(c.features || s);
      criteriaSums.comfort += Number(c.comfort || s);
      criteriaSums.value += Number(c.value || s);
    });

    const averageRating = totalReviews > 0 ? Number((ratingSum / totalReviews).toFixed(1)) : 0;
    const criteriaAverages = totalReviews > 0 ? {
      design: Number((criteriaSums.design / totalReviews).toFixed(1)),
      performance: Number((criteriaSums.performance / totalReviews).toFixed(1)),
      features: Number((criteriaSums.features / totalReviews).toFixed(1)),
      comfort: Number((criteriaSums.comfort / totalReviews).toFixed(1)),
      value: Number((criteriaSums.value / totalReviews).toFixed(1))
    } : { design: 0, performance: 0, features: 0, comfort: 0, value: 0 };

    // Apply user filters
    let filtered = [...visibleReviews];
    if (query.star && query.star !== 'all') {
      const targetStar = parseInt(query.star, 10);
      filtered = filtered.filter(r => Math.round(r.rating) === targetStar);
    }
    if (query.verifiedOnly === 'true') {
      filtered = filtered.filter(r => r.verifiedPurchase === true);
    }
    if (query.moderationFilter && isModerator) {
      if (query.moderationFilter === 'reported') {
        filtered = filtered.filter(r => Array.isArray(r.reportedBy) && r.reportedBy.length > 0);
      } else if (query.moderationFilter !== 'all') {
        filtered = filtered.filter(r => r.moderationStatus === query.moderationFilter);
      }
    }

    // Sort
    if (query.sort === 'helpful') {
      filtered.sort((a, b) => (b.helpfulVoterIds?.length || 0) - (a.helpfulVoterIds?.length || 0));
    } else if (query.sort === 'rating_high') {
      filtered.sort((a, b) => b.rating - a.rating);
    } else if (query.sort === 'rating_low') {
      filtered.sort((a, b) => a.rating - b.rating);
    } else {
      filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    // Questions: strictly exclude hidden/removed items for public/buyers
    let questions = Array.isArray(dbState.questions) ? [...dbState.questions] : [];
    if (vehicleId && vehicleId !== 'all') {
      questions = questions.filter(q => q.vehicleId === vehicleId);
    }
    if (!(isModerator && query.includeModerated === 'true')) {
      questions = questions.filter(q => !['hidden', 'removed'].includes(q.status || 'approved'));
    }

    // Check unified handover-verified ownership
    const currentUserVerifiedOrder = currentUser && vehicleId
      ? this._findVerifiedHandoverOrder(dbState, currentUser.userId, vehicleId)
      : null;

    return {
      reviews: filtered.map(r => this._sanitizeReviewForViewer(r, currentUser)),
      questions: questions.map(q => this._sanitizeQuestionForViewer(q, currentUser)),
      stats: {
        averageRating,
        totalReviews,
        verifiedCount,
        starDistribution,
        criteriaAverages
      },
      currentUserEligibility: {
        isLoggedIn: Boolean(currentUser),
        isVerifiedOwner: Boolean(currentUserVerifiedOrder),
        verifiedOrderId: currentUserVerifiedOrder ? currentUserVerifiedOrder.id : null
      }
    };
  },

  async createReview(user, payload) {
    const { vehicleId, rating, criteria, title, content, media, mediaIds } = payload || {};
    if (!vehicleId || rating === undefined || rating === null || !title || !content) {
      const err = new Error('Vui lòng chọn số sao (1-5), nhập tiêu đề và nội dung đánh giá chi tiết.');
      err.statusCode = 400;
      throw err;
    }

    const numericRating = Number(rating);
    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      const err = new Error('Số sao đánh giá phải là số nguyên từ 1 đến 5.');
      err.statusCode = 422;
      err.code = 'INVALID_RATING';
      throw err;
    }

    if (String(title).trim().length < 5 || String(content).trim().length < 15) {
      const err = new Error('Tiêu đề cần ít nhất 5 ký tự và nội dung đánh giá tối thiểu 15 ký tự.');
      err.statusCode = 422;
      throw err;
    }

    this._assertCommunityRateLimit(user, 'community_post');

    return runInTransaction(async (state) => {
      const vehicle = state.vehicles.find(v => v.id === vehicleId) ||
        (Array.isArray(state.certifiedVehicles) && state.certifiedVehicles.find(v => v.id === vehicleId)) ||
        (Array.isArray(state.orders) && state.orders.find(o => o.vehicleId === vehicleId));
      if (!vehicle) {
        const err = new Error('Không tìm thấy mẫu xe cần đánh giá.');
        err.statusCode = 404;
        throw err;
      }

      // Anti-duplicate spam check
      const existing = state.reviews.find(
        r => r.vehicleId === vehicleId && r.userId === user.userId && r.moderationStatus !== 'removed'
      );
      if (existing) {
        const err = new Error('Bạn đã gửi đánh giá cho mẫu xe này trước đó. Bạn có thể chỉnh sửa đánh giá hiện có của mình.');
        err.statusCode = 409;
        throw err;
      }

      const validatedMedia = this._validateCommunityAttachments(state, user, media, mediaIds);

      // Server-side handover/delivery verification for "Đã mua & nhận xe" badge (never trust client flag or deposit/unhanded payment alone)
      const verifiedOrder = this._findVerifiedHandoverOrder(state, user.userId, vehicleId);

      const parseCriteria = (val) => {
        if (val === undefined || val === null || val === '') return numericRating;
        const n = Number(val);
        if (!Number.isInteger(n) || n < 1 || n > 5) {
          const err = new Error('Điểm tiêu chí đánh giá phải là số nguyên từ 1 đến 5.');
          err.statusCode = 422;
          err.code = 'INVALID_RATING';
          throw err;
        }
        return n;
      };

      const safeCriteria = {
        design: parseCriteria(criteria?.design),
        performance: parseCriteria(criteria?.performance),
        features: parseCriteria(criteria?.features),
        comfort: parseCriteria(criteria?.comfort),
        value: parseCriteria(criteria?.value)
      };

      const nowIso = new Date().toISOString();
      const review = {
        id: `REV-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        vehicleId,
        vehicleName: vehicle.name || vehicle.vehicleName,
        userId: user.userId,
        authorName: user.fullName,
        authorTier: 'Thành viên SIGMACAR',
        orderId: verifiedOrder ? verifiedOrder.id : null,
        verifiedPurchase: Boolean(verifiedOrder),
        rating: numericRating,
        criteria: safeCriteria,
        title: Security.sanitizeString(title),
        content: Security.sanitizeString(content),
        media: validatedMedia,
        helpfulVoterIds: [],
        reportedBy: [],
        reportReason: '',
        moderationStatus: 'approved',
        moderationNote: '',
        createdAt: nowIso,
        updatedAt: nowIso
      };

      state.reviews.unshift(review);
      return this._sanitizeReviewForViewer(review, user);
    });
  },

  async updateReview(user, reviewId, payload) {
    const { rating, criteria, title, content, media, mediaIds } = payload || {};
    return runInTransaction(async (state) => {
      const review = state.reviews.find(r => r.id === reviewId);
      if (!review) {
        const err = new Error('Không tìm thấy đánh giá.');
        err.statusCode = 404;
        throw err;
      }
      if (review.userId !== user.userId && user.role !== ROLES.ADMIN) {
        const err = new Error('Bạn chỉ có thể chỉnh sửa đánh giá của chính mình.');
        err.statusCode = 403;
        throw err;
      }

      if (rating !== undefined) {
        const n = Number(rating);
        if (!Number.isInteger(n) || n < 1 || n > 5) {
          const err = new Error('Số sao đánh giá phải là số nguyên từ 1 đến 5.');
          err.statusCode = 422;
          err.code = 'INVALID_RATING';
          throw err;
        }
        review.rating = n;
      }
      if (title !== undefined) review.title = Security.sanitizeString(title);
      if (content !== undefined) review.content = Security.sanitizeString(content);
      if (criteria && typeof criteria === 'object') {
        const nextCriteria = {};
        for (const key of ['design', 'performance', 'features', 'comfort', 'value']) {
          const raw = criteria[key];
          if (raw === undefined) {
            nextCriteria[key] = review.criteria?.[key] || review.rating;
          } else {
            const cn = Number(raw);
            if (!Number.isInteger(cn) || cn < 1 || cn > 5) {
              const err = new Error('Điểm tiêu chí đánh giá phải là số nguyên từ 1 đến 5.');
              err.statusCode = 422;
              err.code = 'INVALID_RATING';
              throw err;
            }
            nextCriteria[key] = cn;
          }
        }
        review.criteria = nextCriteria;
      }
      if (Array.isArray(media) || Array.isArray(mediaIds)) {
        review.media = this._validateCommunityAttachments(state, user, media || [], mediaIds || []);
      }
      review.updatedAt = new Date().toISOString();
      return this._sanitizeReviewForViewer(review, user);
    });
  },

  async deleteReview(user, reviewId) {
    return runInTransaction(async (state) => {
      const idx = state.reviews.findIndex(r => r.id === reviewId);
      if (idx === -1) {
        const err = new Error('Không tìm thấy đánh giá.');
        err.statusCode = 404;
        throw err;
      }
      const review = state.reviews[idx];
      if (review.userId !== user.userId && user.role !== ROLES.ADMIN) {
        const err = new Error('Bạn chỉ có thể xóa đánh giá của chính mình.');
        err.statusCode = 403;
        throw err;
      }
      state.reviews.splice(idx, 1);
      return { deleted: true, id: reviewId };
    });
  },

  async toggleHelpfulVote(user, reviewId) {
    return runInTransaction(async (state) => {
      const review = state.reviews.find(r => r.id === reviewId);
      if (!review) {
        const err = new Error('Không tìm thấy đánh giá.');
        err.statusCode = 404;
        throw err;
      }
      if (review.userId === user.userId) {
        const err = new Error('Bạn không thể tự bình chọn Hữu ích cho đánh giá của chính mình.');
        err.statusCode = 403;
        throw err;
      }

      if (!Array.isArray(review.helpfulVoterIds)) review.helpfulVoterIds = [];
      const idx = review.helpfulVoterIds.indexOf(user.userId);
      let voted = false;
      if (idx >= 0) {
        review.helpfulVoterIds.splice(idx, 1);
        voted = false;
      } else {
        review.helpfulVoterIds.push(user.userId);
        voted = true;
      }
      return {
        voted,
        helpfulCount: review.helpfulVoterIds.length,
        review: this._sanitizeReviewForViewer(review, user)
      };
    });
  },

  async reportReview(user, reviewId, { reason }) {
    return runInTransaction(async (state) => {
      const review = state.reviews.find(r => r.id === reviewId);
      if (!review) {
        const err = new Error('Không tìm thấy đánh giá.');
        err.statusCode = 404;
        throw err;
      }
      if (!Array.isArray(review.reportedBy)) review.reportedBy = [];
      if (!review.reportedBy.includes(user.userId)) {
        review.reportedBy.push(user.userId);
      }
      review.reportReason = Security.sanitizeString(reason || 'Nội dung không phù hợp / nghi ngờ spam');
      return { reported: true, reviewId };
    });
  },

  async moderateReview(user, reviewId, { action, reason }) {
    if (![ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF].includes(user.role)) {
      const err = new Error('Không có quyền kiểm duyệt nội dung.');
      err.statusCode = 403;
      throw err;
    }
    if (!reason || String(reason).trim().length < 3) {
      const err = new Error('Vui lòng nhập lý do kiểm duyệt (ẩn/gỡ/khôi phục) để lưu nhật ký hệ thống.');
      err.statusCode = 422;
      throw err;
    }

    return runInTransaction(async (state) => {
      const review = state.reviews.find(r => r.id === reviewId);
      if (!review) {
        const err = new Error('Không tìm thấy đánh giá.');
        err.statusCode = 404;
        throw err;
      }
      if (review.userId === user.userId && user.role !== ROLES.ADMIN) {
        const err = new Error('Nhân viên không được tự kiểm duyệt đánh giá của chính mình.');
        err.statusCode = 403;
        err.code = 'SELF_MODERATION_FORBIDDEN';
        throw err;
      }

      if (action === 'hide') review.moderationStatus = 'hidden';
      else if (action === 'remove') review.moderationStatus = 'removed';
      else if (action === 'restore' || action === 'approve') {
        review.moderationStatus = 'approved';
        review.reportedBy = [];
      } else {
        const err = new Error('Hành động kiểm duyệt không hợp lệ.');
        err.statusCode = 422;
        throw err;
      }

      review.moderationNote = Security.sanitizeString(reason);
      review.moderatedBy = user.userId;
      review.updatedAt = new Date().toISOString();

      appendAuditLog(state, {
        action: `REVIEW_MODERATED_${action.toUpperCase()}`,
        actorId: user.userId,
        actorName: user.fullName,
        targetId: reviewId,
        detail: `Kiểm duyệt đánh giá ${reviewId} -> ${review.moderationStatus}. Lý do: ${reason}`
      });

      return this._sanitizeReviewForViewer(review, user);
    });
  },

  async createQuestion(user, payload) {
    const { vehicleId, question } = payload || {};
    if (!vehicleId || !question || String(question).trim().length < 10) {
      const err = new Error('Câu hỏi cần có độ dài tối thiểu 10 ký tự.');
      err.statusCode = 422;
      throw err;
    }
    this._assertCommunityRateLimit(user, 'community_post');

    return runInTransaction(async (state) => {
      const vehicle = state.vehicles.find(v => v.id === vehicleId) ||
        (Array.isArray(state.certifiedVehicles) && state.certifiedVehicles.find(v => v.id === vehicleId)) ||
        (Array.isArray(state.orders) && state.orders.find(o => o.vehicleId === vehicleId));
      const nowIso = new Date().toISOString();
      const qObj = {
        id: `QNA-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        vehicleId,
        vehicleName: vehicle ? (vehicle.name || vehicle.vehicleName) : vehicleId,
        userId: user.userId,
        authorName: user.fullName,
        question: Security.sanitizeString(question),
        status: 'approved',
        reportedBy: [],
        moderationNote: '',
        createdAt: nowIso,
        updatedAt: nowIso,
        answers: []
      };
      state.questions.unshift(qObj);
      return this._sanitizeQuestionForViewer(qObj, user);
    });
  },

  async updateQuestion(user, questionId, { question }) {
    if (!question || String(question).trim().length < 10) {
      const err = new Error('Nội dung câu hỏi cần tối thiểu 10 ký tự.');
      err.statusCode = 422;
      throw err;
    }
    return runInTransaction(async (state) => {
      const qObj = state.questions.find(q => q.id === questionId);
      if (!qObj) {
        const err = new Error('Không tìm thấy câu hỏi.');
        err.statusCode = 404;
        throw err;
      }
      if (qObj.userId !== user.userId && user.role !== ROLES.ADMIN) {
        const err = new Error('Bạn chỉ có thể chỉnh sửa câu hỏi của chính mình.');
        err.statusCode = 403;
        throw err;
      }
      qObj.question = Security.sanitizeString(question);
      qObj.updatedAt = new Date().toISOString();
      return this._sanitizeQuestionForViewer(qObj, user);
    });
  },

  async deleteQuestion(user, questionId) {
    return runInTransaction(async (state) => {
      const idx = state.questions.findIndex(q => q.id === questionId);
      if (idx === -1) {
        const err = new Error('Không tìm thấy câu hỏi.');
        err.statusCode = 404;
        throw err;
      }
      const qObj = state.questions[idx];
      if (qObj.userId !== user.userId && user.role !== ROLES.ADMIN) {
        const err = new Error('Bạn chỉ có thể xóa câu hỏi của chính mình.');
        err.statusCode = 403;
        throw err;
      }
      state.questions.splice(idx, 1);
      return { deleted: true, id: questionId };
    });
  },

  async reportQuestion(user, questionId, { reason }) {
    return runInTransaction(async (state) => {
      const qObj = state.questions.find(q => q.id === questionId);
      if (!qObj) {
        const err = new Error('Không tìm thấy câu hỏi.');
        err.statusCode = 404;
        throw err;
      }
      if (!Array.isArray(qObj.reportedBy)) qObj.reportedBy = [];
      if (!qObj.reportedBy.includes(user.userId)) qObj.reportedBy.push(user.userId);
      qObj.reportReason = Security.sanitizeString(reason || 'Nội dung hỏi đáp cần kiểm tra');
      return { reported: true, questionId };
    });
  },

  async moderateQuestion(user, questionId, { action, reason }) {
    if (![ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF].includes(user.role)) {
      const err = new Error('Không có quyền kiểm duyệt Hỏi & Đáp.');
      err.statusCode = 403;
      throw err;
    }
    if (!reason || String(reason).trim().length < 3) {
      const err = new Error('Vui lòng nhập lý do kiểm duyệt để lưu nhật ký hệ thống.');
      err.statusCode = 422;
      throw err;
    }
    return runInTransaction(async (state) => {
      const qObj = state.questions.find(q => q.id === questionId);
      if (!qObj) {
        const err = new Error('Không tìm thấy câu hỏi.');
        err.statusCode = 404;
        throw err;
      }
      if (qObj.userId === user.userId && user.role !== ROLES.ADMIN) {
        const err = new Error('Không được tự kiểm duyệt câu hỏi của chính mình.');
        err.statusCode = 403;
        err.code = 'SELF_MODERATION_FORBIDDEN';
        throw err;
      }
      if (action === 'hide') qObj.status = 'hidden';
      else if (action === 'remove') qObj.status = 'removed';
      else if (action === 'approve' || action === 'restore') {
        qObj.status = 'approved';
        qObj.reportedBy = [];
      } else {
        const err = new Error('Hành động kiểm duyệt không hợp lệ.');
        err.statusCode = 422;
        throw err;
      }
      qObj.moderationNote = Security.sanitizeString(reason);
      qObj.updatedAt = new Date().toISOString();
      appendAuditLog(state, {
        action: `QUESTION_MODERATED_${action.toUpperCase()}`,
        actorId: user.userId,
        actorName: user.fullName,
        targetId: questionId,
        detail: `Kiểm duyệt câu hỏi ${questionId} -> ${qObj.status}. Lý do: ${reason}`
      });
      return this._sanitizeQuestionForViewer(qObj, user);
    });
  },

  async answerQuestion(user, questionId, { content }) {
    if (!content || String(content).trim().length < 3) {
      const err = new Error('Vui lòng nhập nội dung câu trả lời.');
      err.statusCode = 422;
      throw err;
    }
    this._assertCommunityRateLimit(user, 'community_post');
    return runInTransaction(async (state) => {
      const qObj = state.questions.find(q => q.id === questionId);
      if (!qObj) {
        const err = new Error('Không tìm thấy câu hỏi.');
        err.statusCode = 404;
        throw err;
      }
      const ans = {
        id: `ANS-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        userId: user.userId,
        authorName: user.role !== ROLES.BUYER ? `${user.fullName} (Chuyên gia SIGMACAR)` : user.fullName,
        authorRole: user.role,
        content: Security.sanitizeString(content),
        status: 'approved',
        createdAt: new Date().toISOString()
      };
      qObj.answers.push(ans);
      return this._sanitizeQuestionForViewer(qObj, user);
    });
  },

  // ===========================================================================
  // SECTION 5: CUSTOMER SUPPORT CENTER & TICKETING
  // (Strict isolation: internalNotes NEVER exposed to buyers)
  // ===========================================================================
  sanitizeTicketForUser(ticket, user) {
    if (!ticket) return null;
    const isAdmin = user && user.role === ROLES.ADMIN;
    const isScopedStaff = user && Authorization.isStaffRole(user.role) && (isAdmin || Authorization.canReadTicket(user, ticket));
    const { guestAccessTokenHash, internalNotes, ...safeTicket } = ticket;
    if (isScopedStaff) {
      return { ...safeTicket, internalNotes: internalNotes || [] };
    }
    return safeTicket;
  },

  getSupportCenterData(user, query = {}) {
    // Filter FAQs
    let faqs = Array.isArray(dbState.faqs) ? [...dbState.faqs] : [];
    if (query.faqCategory && query.faqCategory !== 'all') {
      faqs = faqs.filter(f => f.category === query.faqCategory);
    }
    if (query.faqSearch) {
      const s = query.faqSearch.toLowerCase().trim();
      faqs = faqs.filter(
        f => f.question.toLowerCase().includes(s) || f.answer.toLowerCase().includes(s) || f.category.toLowerCase().includes(s)
      );
    }

    // Scoped Tickets (only authenticated owner or scoped staff)
    const allTickets = Array.isArray(dbState.supportTickets) ? dbState.supportTickets : [];
    const visibleRawTickets = user ? allTickets.filter(t => Authorization.canReadTicket(user, t)) : [];
    let tickets = visibleRawTickets.map(t => this.sanitizeTicketForUser(t, user));

    if (query.status && query.status !== 'all') {
      tickets = tickets.filter(t => t.status === query.status);
    }
    if (query.category && query.category !== 'all') {
      tickets = tickets.filter(t => t.category === query.category);
    }
    if (query.priority && query.priority !== 'all') {
      tickets = tickets.filter(t => t.priority === query.priority);
    }
    if (query.search) {
      const q = query.search.toLowerCase().trim();
      tickets = tickets.filter(t =>
        (t.ticketCode || '').toLowerCase().includes(q) ||
        (t.subject || '').toLowerCase().includes(q) ||
        (t.customerName || '').toLowerCase().includes(q) ||
        (t.linkedOrderId || '').toLowerCase().includes(q)
      );
    }

    tickets.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

    const responded = visibleRawTickets.filter(t => t.firstRespondedAt && t.createdAt);
    const avgFirstResponseMinutes = responded.length > 0
      ? Math.round(responded.reduce((sum, t) => sum + ((new Date(t.firstRespondedAt) - new Date(t.createdAt)) / 60000), 0) / responded.length)
      : null;

    const kpis = {
      totalTickets: visibleRawTickets.length,
      newCount: visibleRawTickets.filter(t => t.status === TICKET_STATUS.OPEN).length,
      inProgressCount: visibleRawTickets.filter(t => [TICKET_STATUS.IN_PROGRESS, TICKET_STATUS.WAITING_STAFF].includes(t.status)).length,
      waitingCustomerCount: visibleRawTickets.filter(t => t.status === TICKET_STATUS.WAITING_CUSTOMER).length,
      resolvedCount: visibleRawTickets.filter(t => [TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED].includes(t.status)).length,
      overdueCount: visibleRawTickets.filter(t => {
        if ([TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED].includes(t.status)) return false;
        return t.slaDueAt && new Date(t.slaDueAt).getTime() < Date.now();
      }).length,
      avgFirstResponseMinutes
    };

    return {
      faqs,
      tickets,
      kpis,
      supportConfig: SUPPORT_CONFIG
    };
  },

  lookupTicketByCode(ticketCode, user, guestAccessToken = null) {
    if (!ticketCode) {
      const err = new Error('Vui lòng nhập mã yêu cầu hỗ trợ (VD: TCK-2026-3001).');
      err.statusCode = 400;
      throw err;
    }
    const clean = String(ticketCode).trim().toUpperCase();
    const ticket = dbState.supportTickets.find(
      t => (t.ticketCode || '').toUpperCase() === clean || (t.id || '').toUpperCase() === clean
    );
    if (!ticket) {
      const err = new Error(`Không tìm thấy yêu cầu hỗ trợ với mã "${clean}".`);
      err.statusCode = 404;
      throw err;
    }

    if (!Authorization.canReadTicket(user, ticket, guestAccessToken)) {
      const err = new Error(user
        ? 'Bạn không có quyền truy cập hồ sơ hỗ trợ này.'
        : 'Vui lòng đăng nhập hoặc cung cấp mã truy cập (accessToken) hợp lệ để tra cứu ticket.'
      );
      err.statusCode = user ? 403 : 401;
      err.code = user ? 'FORBIDDEN' : 'ACCESS_TOKEN_REQUIRED';
      throw err;
    }

    return this.sanitizeTicketForUser(ticket, user);
  },

  async createSupportTicket(user, payload) {
    const {
      subject,
      category,
      linkedOrderId,
      linkedVehicleName,
      priority,
      description,
      attachments,
      customerName,
      customerEmail,
      customerPhone,
      branchId
    } = payload;

    if (!subject || !category || !description) {
      const err = new Error('Vui lòng nhập chủ đề, phân loại yêu cầu và nội dung mô tả chi tiết.');
      err.statusCode = 400;
      throw err;
    }

    const validatedFiles = validateAttachments(attachments);
    const prio = Object.values(TICKET_PRIORITY).includes(priority) ? priority : TICKET_PRIORITY.NORMAL;
    const slaHours = prio === TICKET_PRIORITY.URGENT ? 2 : prio === TICKET_PRIORITY.HIGH ? 6 : prio === TICKET_PRIORITY.NORMAL ? 24 : 48;

    return runInTransaction(async (state) => {
      const code = `TCK-2026-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      const createdMs = Date.now();
      const nowIso = new Date(createdMs).toISOString();
      const senderId = user ? user.userId : null;
      const senderName = user ? user.fullName : Security.sanitizeString(customerName || 'Khách hàng');
      const guestAccessToken = user ? null : crypto.randomBytes(18).toString('hex');

      const linkedOrder = linkedOrderId
        ? state.orders.find(o => o.id === linkedOrderId || o.orderNumber === linkedOrderId)
        : null;
      if (linkedOrderId && linkedOrder && user && user.role === ROLES.BUYER && linkedOrder.userId !== user.userId) {
        const err = new Error('Không thể liên kết yêu cầu hỗ trợ vào đơn hàng thuộc tài khoản khác.');
        err.statusCode = 403;
        err.code = 'FORBIDDEN';
        throw err;
      }

      // Compute SLA due across business working hours 08:00 - 20:00 (GMT+7)
      const vnHour = new Date(createdMs + 7 * 3600000).getUTCHours();
      let businessWaitOffsetMs = 0;
      if (vnHour >= 20) {
        businessWaitOffsetMs = ((24 - vnHour) + 8) * 3600000;
      } else if (vnHour < 8) {
        businessWaitOffsetMs = (8 - vnHour) * 3600000;
      }
      const slaDueAt = new Date(createdMs + businessWaitOffsetMs + slaHours * 3600000).toISOString();

      const resolvedBranchId = branchId || (linkedOrder && linkedOrder.branchId) || 'hn-caugiay';

      const newTicket = {
        id: code,
        ticketCode: code,
        userId: senderId,
        isGuest: !user,
        guestAccessTokenHash: guestAccessToken ? Security.hashSecret(guestAccessToken) : null,
        branchId: resolvedBranchId,
        customerName: senderName,
        customerEmail: user ? user.email : Security.sanitizeString(customerEmail || ''),
        customerPhone: Security.sanitizeString(customerPhone || '+84 901 234 567'),
        subject: Security.sanitizeString(subject),
        category: Security.sanitizeString(category),
        linkedOrderId: Security.sanitizeString(linkedOrderId || ''),
        linkedVehicleName: Security.sanitizeString(linkedVehicleName || ''),
        priority: prio,
        status: TICKET_STATUS.OPEN,
        assignedStaffId: 'usr_seller_01',
        assignedStaffName: 'Đội ngũ CSKH SIGMACAR',
        department: category.includes('Bảo hành') || category.includes('Bảo dưỡng')
          ? 'Kỹ thuật & Bảo hành Hậu mãi'
          : category.includes('Đổi trả')
            ? 'Trung tâm Đổi trả 7 ngày'
            : 'Chăm sóc Khách hàng & Tư vấn',
        attachments: validatedFiles,
        messages: [
          {
            id: `MSG-${crypto.randomUUID().slice(0, 8)}`,
            senderId: senderId || 'guest',
            senderName,
            senderRole: user ? user.role : 'guest',
            content: Security.sanitizeString(description),
            attachments: validatedFiles,
            createdAt: nowIso
          }
        ],
        internalNotes: [],
        slaDueAt,
        slaHours,
        firstRespondedAt: null,
        csatRating: null,
        createdAt: nowIso,
        updatedAt: nowIso
      };

      state.supportTickets.unshift(newTicket);
      NotificationService.enqueueOutboxInState(state, {
        eventType: 'ticket_created',
        aggregateType: 'support_ticket',
        aggregateId: newTicket.ticketCode,
        userId: newTicket.userId,
        recipientEmail: newTicket.customerEmail,
        templateId: 'ticket_replied',
        payload: { ticketCode: newTicket.ticketCode, subject: newTicket.subject },
        dedupeKey: `ticket_created:${newTicket.ticketCode}`
      });

      const sanitized = this.sanitizeTicketForUser(newTicket, user);
      if (guestAccessToken) {
        sanitized.accessToken = guestAccessToken;
      }
      return sanitized;
    });
  },

  async replyToSupportTicket(user, ticketId, { content, attachments, accessToken }) {
    if (!content || String(content).trim().length < 2) {
      const err = new Error('Vui lòng nhập nội dung phản hồi.');
      err.statusCode = 400;
      throw err;
    }
    const validatedFiles = validateAttachments(attachments);

    return runInTransaction(async (state) => {
      const ticket = state.supportTickets.find(t => t.id === ticketId || t.ticketCode === ticketId);
      if (!ticket) {
        const err = new Error('Không tìm thấy yêu cầu hỗ trợ.');
        err.statusCode = 404;
        throw err;
      }

      if (!Authorization.canReplyTicket(user, ticket, accessToken)) {
        const err = new Error('Bạn không có quyền truy cập yêu cầu hỗ trợ này.');
        err.statusCode = 403;
        err.code = 'FORBIDDEN';
        throw err;
      }

      const isStaff = user && Authorization.isStaffRole(user.role);
      const nowIso = new Date().toISOString();
      const msgObj = {
        id: `MSG-${crypto.randomUUID().slice(0, 8)}`,
        senderId: user ? user.userId : 'guest',
        senderName: isStaff ? `${user.fullName} (CSKH SIGMACAR)` : ((user && user.fullName) || ticket.customerName || 'Khách hàng'),
        senderRole: user ? user.role : 'guest',
        content: Security.sanitizeString(content),
        attachments: validatedFiles,
        createdAt: nowIso
      };
      ticket.messages.push(msgObj);

      if (isStaff) {
        ticket.status = TICKET_STATUS.WAITING_CUSTOMER;
        if (!ticket.firstRespondedAt) ticket.firstRespondedAt = nowIso;
        NotificationService.enqueueOutboxInState(state, {
          eventType: 'ticket_replied',
          aggregateType: 'support_ticket',
          aggregateId: ticket.ticketCode,
          userId: ticket.userId,
          recipientEmail: ticket.customerEmail,
          templateId: 'ticket_replied',
          payload: { ticketCode: ticket.ticketCode, subject: ticket.subject },
          dedupeKey: `ticket_replied:${ticket.ticketCode}:${msgObj.id}`
        });
      } else {
        ticket.status = TICKET_STATUS.WAITING_STAFF;
      }
      ticket.updatedAt = nowIso;

      return this.sanitizeTicketForUser(ticket, user);
    });
  },

  async updateSupportTicketAdmin(user, ticketId, payload) {
    const isStaff = user && Authorization.isStaffRole(user.role);
    if (!isStaff) {
      const err = new Error('Chỉ nhân viên hỗ trợ hoặc quản trị viên mới có quyền thực hiện thao tác này.');
      err.statusCode = 403;
      throw err;
    }

    const { status, priority, assignedStaffName, assignedStaffId, department, internalNote } = payload;

    return runInTransaction(async (state) => {
      const ticket = state.supportTickets.find(t => t.id === ticketId || t.ticketCode === ticketId);
      if (!ticket) {
        const err = new Error('Không tìm thấy yêu cầu hỗ trợ.');
        err.statusCode = 404;
        throw err;
      }

      if (!Authorization.canReadTicket(user, ticket)) {
        const err = new Error('Ticket thuộc chi nhánh khác phạm vi phụ trách của bạn.');
        err.statusCode = 403;
        err.code = 'FORBIDDEN';
        throw err;
      }

      if (status) {
        const validStatuses = Object.values(TICKET_STATUS);
        if (!validStatuses.includes(status)) {
          const err = new Error(`Trạng thái ticket "${status}" không hợp lệ.`);
          err.statusCode = 422;
          throw err;
        }
        ticket.status = status;
        if ([TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED].includes(status)) {
          ticket.resolvedAt = new Date().toISOString();
        }
      }
      if (priority) ticket.priority = priority;
      if (assignedStaffId !== undefined && assignedStaffId !== null && assignedStaffId !== '') {
        const targetStaff = (state.users || []).find(u => u.id === assignedStaffId);
        if (!targetStaff || !Authorization.isStaffRole(targetStaff.role)) {
          const err = new Error(`Nhân viên được phân công "${assignedStaffId}" không tồn tại hoặc không có quyền xử lý CSKH.`);
          err.statusCode = 422;
          throw err;
        }
        ticket.assignedStaffId = targetStaff.id;
        ticket.assignedStaffName = Security.sanitizeString(assignedStaffName || targetStaff.fullName);
      } else if (assignedStaffName !== undefined) {
        ticket.assignedStaffName = Security.sanitizeString(assignedStaffName);
      }
      if (department !== undefined) ticket.department = Security.sanitizeString(department);

      const nowIso = new Date().toISOString();
      if (internalNote && String(internalNote).trim().length > 0) {
        if (!Array.isArray(ticket.internalNotes)) ticket.internalNotes = [];
        ticket.internalNotes.push({
          id: `INOTE-${crypto.randomUUID().slice(0, 8)}`,
          authorId: user.userId,
          authorName: user.fullName,
          note: Security.sanitizeString(internalNote),
          createdAt: nowIso
        });
      }

      ticket.updatedAt = nowIso;
      appendAuditLog(state, {
        action: assignedStaffId ? 'TICKET_REASSIGNED' : 'TICKET_UPDATED_BY_STAFF',
        actorId: user.userId,
        actorName: user.fullName,
        targetId: ticket.ticketCode,
        detail: `Cập nhật ticket ${ticket.ticketCode} (Trạng thái: ${ticket.status}, Phụ trách: ${ticket.assignedStaffName}, Phòng ban: ${ticket.department}).`
      });

      return this.sanitizeTicketForUser(ticket, user);
    });
  },

  async rateSupportTicket(user, ticketId, { rating, comment = '', accessToken = null } = {}) {
    const score = Number(rating);
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      const err = new Error('Điểm đánh giá hài lòng CSKH (CSAT) phải từ 1 đến 5 sao.');
      err.statusCode = 422;
      throw err;
    }

    return runInTransaction(async (state) => {
      const ticket = state.supportTickets.find(t => t.id === ticketId || t.ticketCode === ticketId);
      if (!ticket) {
        const err = new Error('Không tìm thấy yêu cầu hỗ trợ.');
        err.statusCode = 404;
        throw err;
      }
      if (!Authorization.canReadTicket(user, ticket, accessToken) || (user && Authorization.isStaffRole(user.role))) {
        const err = new Error('Chỉ khách hàng sở hữu yêu cầu hỗ trợ mới có quyền đánh giá CSAT.');
        err.statusCode = 403;
        throw err;
      }
      if (![TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED].includes(ticket.status)) {
        const err = new Error('Chỉ có thể đánh giá CSAT sau khi yêu cầu hỗ trợ đã được giải quyết hoặc đóng.');
        err.statusCode = 409;
        throw err;
      }

      ticket.satisfactionRating = score;
      ticket.csatRating = {
        score,
        comment: Security.sanitizeString(comment || ''),
        ratedAt: new Date().toISOString(),
        ratedBy: (user && user.userId) || 'guest'
      };
      ticket.updatedAt = new Date().toISOString();
      return this.sanitizeTicketForUser(ticket, user);
    });
  },

  // ===========================================================================
  // SECTION 6: EMAIL CAMPAIGNS & PRIVACY / UNSUBSCRIBE COMPLIANCE (SIG-P4-012, SIG-P4-013)
  // ===========================================================================
  _parseBirthMonth(birthDate) {
    if (!birthDate || typeof birthDate !== 'string') return null;
    const clean = birthDate.trim();
    // Support YYYY-MM-DD and DD/MM/YYYY
    const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(clean);
    if (isoMatch) {
      const m = parseInt(isoMatch[2], 10);
      return m >= 1 && m <= 12 ? m : null;
    }
    const vnMatch = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(clean);
    if (vnMatch) {
      const m = parseInt(vnMatch[2], 10);
      return m >= 1 && m <= 12 ? m : null;
    }
    return null;
  },

  getRecipientListForSegment(segment, state = dbState, referenceDate = new Date()) {
    const buyers = (state.users || []).filter(u =>
      u.role === ROLES.BUYER &&
      !u.disabled &&
      !u.deletedAt &&
      u.email &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)
    );
    // Filter strictly to users who have marketing consent & promo email enabled
    const optedIn = buyers.filter(u =>
      u.securityPrefs?.marketingConsent !== false &&
      u.notificationPrefs?.emailPromo !== false
    );

    let segmented = optedIn;
    if (segment === 'birthday_month') {
      const currentMonth = referenceDate.getMonth() + 1;
      // Strict match only: missing birthDate MUST NOT match and NEVER falls back to optedIn
      segmented = optedIn.filter(u => this._parseBirthMonth(u.birthDate) === currentMonth);
    } else if (segment === 'owners') {
      const ownerIds = new Set();
      (state.orders || []).forEach(o => {
        if ([ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED].includes(o.orderStatus)) {
          ownerIds.add(o.userId);
        }
      });
      (state.handovers || []).forEach(h => {
        if (h.status === 'Completed' && h.buyerUserId) ownerIds.add(h.buyerUserId);
      });
      (state.vehicleOwnership || []).forEach(v => {
        if (v.userId) ownerIds.add(v.userId);
      });
      segmented = optedIn.filter(u => ownerIds.has(u.id));
    }

    // Deduplicate by userId and lowercased email
    const seenIds = new Set();
    const seenEmails = new Set();
    const unique = [];
    for (const u of segmented) {
      const emailKey = String(u.email).toLowerCase().trim();
      if (seenIds.has(u.id) || seenEmails.has(emailKey)) continue;
      seenIds.add(u.id);
      seenEmails.add(emailKey);
      unique.push(u);
    }
    return unique;
  },

  renderPersonalizedTemplate(bodyHtml, subject, recipient = {}) {
    const safeVars = {
      customer_name: Security.escapeHtml(recipient.fullName || 'Quý khách'),
      birth_date: Security.escapeHtml(recipient.birthDate || 'Chưa cập nhật'),
      promo_code: Security.escapeHtml(recipient.promoCode || 'SIGMAVIP2026'),
      vehicle_name: Security.escapeHtml(recipient.vehicleName || 'SIGMA Model E')
    };
    const unsubscribeToken = Security.signPurposeToken({
      purpose: 'marketing_unsubscribe',
      userId: recipient.id || recipient.userId || null,
      email: recipient.email || null
    });
    const unsubscribeUrl = `/#profile?unsubscribeToken=${encodeURIComponent(unsubscribeToken)}`;
    const sanitizedTemplate = Security.sanitizeHtml(String(bodyHtml || ''));

    const replaceHtmlTokens = (str = '') =>
      String(str)
        .replace(/\{\{\s*customer_name\s*\}\}/g, safeVars.customer_name)
        .replace(/\{\{\s*birth_date\s*\}\}/g, safeVars.birth_date)
        .replace(/\{\{\s*promo_code\s*\}\}/g, safeVars.promo_code)
        .replace(/\{\{\s*vehicle_name\s*\}\}/g, safeVars.vehicle_name)
        .replace(/\{\{\s*unsubscribe_url\s*\}\}/g, Security.escapeHtml(unsubscribeUrl));

    const replaceSubjectTokens = (str = '') =>
      Security.sanitizeString(String(str || ''))
        .replace(/\{\{\s*customer_name\s*\}\}/g, Security.sanitizeString(recipient.fullName || 'Quý khách'))
        .replace(/\{\{\s*birth_date\s*\}\}/g, Security.sanitizeString(recipient.birthDate || ''))
        .replace(/\{\{\s*promo_code\s*\}\}/g, Security.sanitizeString(recipient.promoCode || 'SIGMAVIP2026'))
        .replace(/\{\{\s*vehicle_name\s*\}\}/g, Security.sanitizeString(recipient.vehicleName || 'SIGMA Model E'));

    let renderedHtml = replaceHtmlTokens(sanitizedTemplate);
    if (!renderedHtml.includes('unsubscribeToken')) {
      renderedHtml += `<div style="margin-top:20px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">Không muốn nhận tin tiếp thị? <a href="${Security.escapeHtml(unsubscribeUrl)}">Hủy đăng ký nhận tin</a>.</div>`;
    }

    return {
      renderedSubject: replaceSubjectTokens(subject),
      renderedHtml,
      unsubscribeToken,
      unsubscribeUrl
    };
  },

  getCampaignsOverview(user) {
    if (![ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF].includes(user.role)) {
      const err = new Error('Không có quyền truy cập trình quản lý chiến dịch Email.');
      err.statusCode = 403;
      throw err;
    }

    const buyers = dbState.users.filter(u => u.role === ROLES.BUYER && !u.disabled && !u.deletedAt);
    const optedInCount = buyers.filter(u => u.securityPrefs?.marketingConsent !== false && u.notificationPrefs?.emailPromo !== false).length;
    const unsubscribedCount = buyers.length - optedInCount;
    const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);

    return {
      campaigns: dbState.emailCampaigns || [],
      categories: CAMPAIGN_CATEGORIES,
      statuses: CAMPAIGN_STATUS,
      segments: [
        { id: 'all_opted_in', label: 'Tất cả khách hàng đồng ý nhận tin (Marketing Opt-in)', count: this.getRecipientListForSegment('all_opted_in').length },
        { id: 'birthday_month', label: 'Khách hàng có Sinh nhật trong tháng', count: this.getRecipientListForSegment('birthday_month').length },
        { id: 'owners', label: 'Chủ sở hữu xe SIGMACAR đã bàn giao', count: this.getRecipientListForSegment('owners').length }
      ],
      privacySummary: {
        totalBuyers: buyers.length,
        optedInCount,
        unsubscribedCount,
        smtpConfigured,
        deliveryModeLabel: smtpConfigured
          ? 'SMTP Production Gateway'
          : 'Chế độ Hàng đợi Sandbox (Chưa cấu hình SMTP trong .env — Thư chỉ ghi nhật ký queue cục bộ, trạng thái delivered chỉ cập nhật khi có receipt webhook)'
      }
    };
  },

  getCampaignDeliveries(user, campaignId) {
    if (![ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF].includes(user.role)) {
      const err = new Error('Không có quyền xem nhật ký gửi thư chiến dịch.');
      err.statusCode = 403;
      throw err;
    }
    NotificationRepository.ensureCampaignDeliveries(dbState);
    const camp = (dbState.emailCampaigns || []).find(c => c.id === campaignId);
    if (!camp) {
      const err = new Error('Không tìm thấy chiến dịch Email.');
      err.statusCode = 404;
      throw err;
    }
    const deliveries = (dbState.campaignDeliveries || []).filter(d => d.campaignId === campaignId);
    return {
      campaign: camp,
      deliveries: deliveries.map(d => ({
        id: d.id,
        recipientUserId: d.recipientUserId,
        recipientEmail: d.recipientEmail,
        deliveryStatus: d.deliveryStatus,
        providerMessageId: d.providerMessageId || null,
        attempts: d.attempts || 0,
        failureReason: d.failureReason || null,
        sentAt: d.sentAt || null,
        deliveredAt: d.deliveredAt || null,
        updatedAt: d.updatedAt
      }))
    };
  },

  async saveCampaign(user, payload) {
    if (![ROLES.ADMIN, ROLES.SELLER].includes(user.role)) {
      const err = new Error('Chỉ Quản trị viên hoặc Quản lý Đại lý mới có quyền tạo/chỉnh sửa chiến dịch Email.');
      err.statusCode = 403;
      throw err;
    }

    const {
      id,
      name,
      category,
      subject,
      preheader,
      promoCode,
      discountValue,
      targetSegment,
      bodyHtml,
      scheduledAt
    } = payload || {};

    if (!name || !subject || !bodyHtml) {
      const err = new Error('Vui lòng nhập tên chiến dịch, tiêu đề Email và nội dung bản mẫu.');
      err.statusCode = 400;
      throw err;
    }

    let cleanScheduledAt = scheduledAt || null;
    if (cleanScheduledAt) {
      const ts = Date.parse(cleanScheduledAt);
      if (!Number.isFinite(ts)) {
        const err = new Error('Thời gian hẹn lịch gửi chiến dịch không hợp lệ.');
        err.statusCode = 422;
        throw err;
      }
      cleanScheduledAt = new Date(ts).toISOString();
    }

    const cleanBodyHtml = Security.sanitizeHtml(String(bodyHtml));
    const cleanSubject = Security.sanitizeString(String(subject));

    return runInTransaction(async (state) => {
      const nowIso = new Date().toISOString();
      const recipients = this.getRecipientListForSegment(targetSegment || 'all_opted_in', state);

      if (id) {
        const existing = state.emailCampaigns.find(c => c.id === id);
        if (!existing) {
          const err = new Error('Không tìm thấy chiến dịch Email.');
          err.statusCode = 404;
          throw err;
        }
        if ([CAMPAIGN_STATUS.SENT, 'Queued'].includes(existing.status)) {
          const err = new Error('Không thể chỉnh sửa chiến dịch đang gửi hoặc đã gửi hoàn tất.');
          err.statusCode = 409;
          throw err;
        }
        existing.name = Security.sanitizeString(name);
        existing.category = category || existing.category;
        existing.subject = cleanSubject;
        existing.preheader = Security.sanitizeString(preheader || '');
        existing.promoCode = Security.sanitizeString(promoCode || 'SIGMAVIP');
        existing.discountValue = Security.sanitizeString(discountValue || '');
        existing.targetSegment = targetSegment || 'all_opted_in';
        existing.bodyHtml = cleanBodyHtml;
        if (scheduledAt !== undefined) {
          existing.scheduledAt = cleanScheduledAt;
          if (cleanScheduledAt) existing.status = CAMPAIGN_STATUS.SCHEDULED;
        }
        existing.stats.eligibleRecipients = recipients.length;
        existing.updatedAt = nowIso;
        return existing;
      }

      const newCamp = {
        id: `CMP-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        name: Security.sanitizeString(name),
        category: category || CAMPAIGN_CATEGORIES.HOLIDAY,
        subject: cleanSubject,
        preheader: Security.sanitizeString(preheader || ''),
        promoCode: Security.sanitizeString(promoCode || 'SIGMA2026'),
        discountValue: Security.sanitizeString(discountValue || 'Ưu đãi dịch vụ & phụ kiện chính hãng'),
        targetSegment: targetSegment || 'all_opted_in',
        targetSegmentLabel: targetSegment === 'birthday_month'
          ? 'Khách hàng có sinh nhật trong tháng'
          : targetSegment === 'owners'
            ? 'Chủ sở hữu xe SIGMACAR'
            : 'Tất cả khách hàng đồng ý nhận tin',
        bannerImage: 'assets/profile-main-hero.jpg',
        bodyHtml: cleanBodyHtml,
        status: cleanScheduledAt ? CAMPAIGN_STATUS.SCHEDULED : CAMPAIGN_STATUS.DRAFT,
        scheduledAt: cleanScheduledAt,
        sentAt: null,
        stats: {
          eligibleRecipients: recipients.length,
          queuedCount: 0,
          sentCount: 0,
          deliveredCount: 0,
          bouncedCount: 0,
          failedCount: 0,
          skippedUnsubscribedCount: 0
        },
        deliveryMode: (process.env.SMTP_HOST && process.env.SMTP_USER) ? 'smtp_live' : 'simulated_dev_queue',
        createdBy: user.userId,
        createdAt: nowIso,
        updatedAt: nowIso
      };

      state.emailCampaigns.unshift(newCamp);
      return newCamp;
    });
  },

  async updateCampaignStatus(user, campaignId, { status, scheduledAt }) {
    if (![ROLES.ADMIN, ROLES.SELLER].includes(user.role)) {
      const err = new Error('Không có quyền thay đổi trạng thái chiến dịch.');
      err.statusCode = 403;
      throw err;
    }
    return runInTransaction(async (state) => {
      const camp = state.emailCampaigns.find(c => c.id === campaignId);
      if (!camp) {
        const err = new Error('Không tìm thấy chiến dịch Email.');
        err.statusCode = 404;
        throw err;
      }
      if (camp.status === CAMPAIGN_STATUS.SENT) {
        const err = new Error('Chiến dịch đã gửi hoàn tất, không thể tạm dừng hoặc hủy.');
        err.statusCode = 409;
        throw err;
      }
      camp.status = status;
      if (scheduledAt !== undefined) camp.scheduledAt = scheduledAt;
      camp.updatedAt = new Date().toISOString();
      return camp;
    });
  },

  async sendTestCampaignEmail(user, campaignId, { testEmail }) {
    if (![ROLES.ADMIN, ROLES.SELLER].includes(user.role)) {
      const err = new Error('Không có quyền gửi email thử nghiệm.');
      err.statusCode = 403;
      throw err;
    }
    if (!testEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
      const err = new Error('Vui lòng nhập địa chỉ Email nhận bản thử nghiệm hợp lệ.');
      err.statusCode = 422;
      throw err;
    }

    const camp = dbState.emailCampaigns.find(c => c.id === campaignId);
    if (!camp) {
      const err = new Error('Không tìm thấy chiến dịch Email.');
      err.statusCode = 404;
      throw err;
    }

    const rendered = this.renderPersonalizedTemplate(camp.bodyHtml, camp.subject, {
      id: user.userId,
      email: testEmail,
      fullName: user.fullName || 'Khách hàng thử nghiệm',
      birthDate: '29/10/1992',
      promoCode: camp.promoCode || 'SIGMATEST2026',
      vehicleName: 'SIGMA Model E'
    });

    const smtpResult = await EmailProvider.sendEmail({
      to: testEmail,
      subject: rendered.renderedSubject,
      html: rendered.renderedHtml,
      text: Security.sanitizeString(rendered.renderedSubject),
      idempotencyKey: `test_${camp.id}_${testEmail}`
    });

    return {
      sent: true,
      testEmail,
      messageId: smtpResult.messageId,
      deliveryMode: smtpResult.mode || ((process.env.SMTP_HOST && process.env.SMTP_USER) ? 'smtp_live' : 'simulated_dev_queue'),
      note: (process.env.SMTP_HOST && process.env.SMTP_USER)
        ? `Đã gửi email thử nghiệm tới ${testEmail}`
        : `[Chế độ Hàng đợi Sandbox] Đã kết xuất HTML an toàn cho ${testEmail} (không gửi SMTP thật ra ngoài khi chưa cấu hình SMTP trong .env).`,
      preview: rendered
    };
  },

  async executeCampaignSend(user, campaignId, { confirmed, enqueueOnly = false } = {}) {
    if (![ROLES.ADMIN, ROLES.SELLER].includes(user.role)) {
      const err = new Error('Chỉ Quản trị viên hoặc Quản lý Đại lý mới có quyền phát lệnh gửi chiến dịch Email.');
      err.statusCode = 403;
      throw err;
    }
    if (!confirmed) {
      const err = new Error('Vui lòng xác nhận trước khi phát hành chiến dịch Email hàng loạt.');
      err.statusCode = 400;
      throw err;
    }

    const queuedCampaign = await runInTransaction(async (state) => {
      NotificationRepository.ensureCampaignDeliveries(state);
      const camp = state.emailCampaigns.find(c => c.id === campaignId);
      if (!camp) {
        const err = new Error('Không tìm thấy chiến dịch Email.');
        err.statusCode = 404;
        throw err;
      }
      if ([CAMPAIGN_STATUS.SENT, 'Queued'].includes(camp.status)) {
        const err = new Error('Chiến dịch này đã được gửi trước đó hoặc đang trong hàng đợi. Hệ thống chặn gửi trùng lặp để chống spam.');
        err.statusCode = 409;
        throw err;
      }

      const recipients = this.getRecipientListForSegment(camp.targetSegment, state);
      const nowIso = new Date().toISOString();
      const existingDeliveryKeys = new Set(
        (state.campaignDeliveries || [])
          .filter(d => d.campaignId === camp.id)
          .map(d => `${d.recipientUserId}:${String(d.recipientEmail).toLowerCase()}`)
      );

      let queuedNow = 0;
      for (const r of recipients) {
        const dedupeKey = `${r.id}:${String(r.email).toLowerCase()}`;
        if (existingDeliveryKeys.has(dedupeKey)) continue;
        existingDeliveryKeys.add(dedupeKey);
        const rendered = this.renderPersonalizedTemplate(camp.bodyHtml, camp.subject, {
          ...r,
          promoCode: camp.promoCode
        });
        state.campaignDeliveries.push({
          id: `DLV-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
          campaignId: camp.id,
          recipientUserId: r.id,
          recipientEmail: r.email,
          renderedSubject: rendered.renderedSubject,
          renderedHtml: rendered.renderedHtml,
          unsubscribeToken: rendered.unsubscribeToken,
          deliveryStatus: 'queued',
          attempts: 0,
          providerMessageId: null,
          deliveryMode: camp.deliveryMode || 'simulated_dev_queue',
          createdAt: nowIso,
          updatedAt: nowIso
        });
        queuedNow++;
      }

      const isFutureScheduled = camp.scheduledAt && Date.parse(camp.scheduledAt) > Date.now();
      camp.status = isFutureScheduled ? CAMPAIGN_STATUS.SCHEDULED : 'Queued';
      camp.updatedAt = nowIso;
      CampaignWorker.recalculateCampaignStatsInState(state, camp.id);

      appendAuditLog(state, {
        action: 'EMAIL_CAMPAIGN_QUEUED',
        actorId: user.userId,
        actorName: user.fullName,
        targetId: camp.id,
        detail: `Đưa chiến dịch "${camp.name}" vào hàng đợi (${queuedNow} người nhận hợp lệ, trạng thái ${camp.status}).`
      });

      return { id: camp.id, isFutureScheduled };
    });

    if (!enqueueOnly && !queuedCampaign.isFutureScheduled) {
      await CampaignWorker.processCampaignQueue({ campaignId: queuedCampaign.id });
    }

    return dbState.emailCampaigns.find(c => c.id === campaignId);
  },

  async unsubscribeMarketing({ token, userId, email, reason, currentUser = null }) {
    let resolvedUserId = null;
    let resolvedEmail = null;

    if (token) {
      const verified = Security.verifyPurposeToken(token, 'marketing_unsubscribe');
      if (!verified) {
        const err = new Error('Liên kết hủy đăng ký không hợp lệ hoặc đã hết hạn.');
        err.statusCode = 403;
        err.code = 'INVALID_UNSUBSCRIBE_TOKEN';
        throw err;
      }
      resolvedUserId = verified.sub || null;
      resolvedEmail = verified.email || null;
    } else if (currentUser) {
      // Authenticated user can only unsubscribe themselves (or Admin can unsubscribe target)
      const requestedId = userId || currentUser.userId;
      const requestedEmail = email ? Security.normalizeEmail(email) : Security.normalizeEmail(currentUser.email);
      if (currentUser.role !== ROLES.ADMIN) {
        if ((userId && userId !== currentUser.userId) || (requestedEmail && requestedEmail !== Security.normalizeEmail(currentUser.email))) {
          const err = new Error('Bạn không có quyền thay đổi tùy chọn tiếp thị của tài khoản khác.');
          err.statusCode = 403;
          err.code = 'UNSUBSCRIBE_FORBIDDEN';
          throw err;
        }
      }
      resolvedUserId = requestedId;
      resolvedEmail = requestedEmail;
    } else {
      const err = new Error('Yêu cầu hủy đăng ký cần kèm mã xác thực hợp lệ từ email hoặc đăng nhập chính chủ.');
      err.statusCode = 401;
      err.code = 'UNSUBSCRIBE_AUTH_REQUIRED';
      throw err;
    }

    return runInTransaction(async (state) => {
      let targetUser = null;
      if (resolvedUserId) {
        targetUser = state.users.find(u => u.id === resolvedUserId);
      }
      if (!targetUser && resolvedEmail) {
        const clean = Security.normalizeEmail(resolvedEmail);
        targetUser = state.users.find(u => Security.normalizeEmail(u.email) === clean);
      }
      if (!targetUser) {
        const err = new Error('Không tìm thấy tài khoản email đăng ký nhận bản tin.');
        err.statusCode = 404;
        throw err;
      }

      if (!targetUser.securityPrefs) targetUser.securityPrefs = {};
      if (!targetUser.notificationPrefs) targetUser.notificationPrefs = {};
      targetUser.securityPrefs.marketingConsent = false;
      targetUser.notificationPrefs.emailPromo = false;
      targetUser.updatedAt = new Date().toISOString();

      appendAuditLog(state, {
        action: 'MARKETING_UNSUBSCRIBED',
        actorId: currentUser ? currentUser.userId : targetUser.id,
        actorName: currentUser ? currentUser.fullName : targetUser.fullName,
        targetId: targetUser.id,
        detail: `Khách hàng hủy đăng ký nhận email tiếp thị (Lý do: ${Security.sanitizeString(reason || 'Tùy chọn cá nhân')}).`
      });

      return {
        unsubscribed: true,
        email: targetUser.email,
        marketingConsent: false
      };
    });
  }
};

module.exports = EcommerceService;

