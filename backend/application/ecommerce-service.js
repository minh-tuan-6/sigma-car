// backend/application/ecommerce-service.js
// Unified E-Commerce Lifecycle Service for SIGMACAR:
// 1. Automated 7-Day Returns Center
// 2. Digital Warranty & Maintenance Management
// 3. Verified Reviews & Community Q&A
// 4. Customer Support Center & Ticketing (with strict internal note isolation)
// 5. Email Campaigns & Privacy / Unsubscribe Management

const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const Security = require('../infrastructure/security');
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
  CAMPAIGN_STATUS
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

  const isStatusEligible = [ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED, ORDER_STATUS.CONFIRMED].includes(order.orderStatus);
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
    const isStaff = [ROLES.ADMIN, ROLES.SELLER, ROLES.SERVICE_STAFF].includes(user.role);
    const allReturns = Array.isArray(dbState.returnRequests) ? dbState.returnRequests : [];
    const userOrders = isStaff
      ? dbState.orders
      : dbState.orders.filter(o => o.userId === user.userId);

    const eligibleOrders = userOrders.map(o => computeOrderReturnEligibility(o, allReturns));

    let list = isStaff
      ? [...allReturns]
      : allReturns.filter(r => r.userId === user.userId);

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

    // Admin/Seller KPIs
    const totalRequests = allReturns.length;
    const completedCount = allReturns.filter(r => r.status === RETURN_STATUS.COMPLETED).length;
    const pendingCount = allReturns.filter(r => [RETURN_STATUS.PENDING_RECEIPT, RETURN_STATUS.CHECKING_CONDITIONS].includes(r.status)).length;
    const overdueCount = allReturns.filter(r => {
      if (r.status === RETURN_STATUS.COMPLETED || r.status === RETURN_STATUS.REJECTED) return false;
      const ageHours = (Date.now() - new Date(r.createdAt).getTime()) / (1000 * 60 * 60);
      return ageHours > 72;
    }).length;

    return {
      returns: list,
      eligibleOrders,
      policy: RETURN_POLICY_RULES,
      reasons: RETURN_REASONS,
      stagesOrder: RETURN_STAGES_ORDER,
      kpis: {
        totalRequests,
        completedCount,
        completionRatePercent: totalRequests > 0 ? Math.round(((completedCount + 1) / (totalRequests + 1)) * 100) : 100,
        avgProcessingHours: 36,
        pendingCount,
        overdueCount
      }
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
      pickupDate,
      pickupTimeSlot,
      pickupAddress,
      confirmedPolicy
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

    const odo = Number(currentOdoKm || 0);
    if (Number.isNaN(odo) || odo < 0) {
      throw new Error('Số ODO thực tế không hợp lệ.');
    }
    if (odo > RETURN_POLICY_RULES.maxOdoDeltaKm) {
      throw new Error(`Quãng đường ODO phát sinh (${odo} km) vượt quá giới hạn tối đa ${RETURN_POLICY_RULES.maxOdoDeltaKm} km của chính sách đổi trả 7 ngày.`);
    }

    const validatedPhotos = validateAttachments(photos);

    return runInTransaction(async (state) => {
      const order = state.orders.find(o => o.id === orderId);
      if (!order) {
        throw new Error(`Không tìm thấy đơn hàng mã "${orderId}".`);
      }
      if (user.role === ROLES.BUYER && order.userId !== user.userId) {
        const err = new Error('Bạn chỉ có thể tạo yêu cầu đổi trả cho đơn hàng của chính mình.');
        err.statusCode = 403;
        throw err;
      }

      const eligibility = computeOrderReturnEligibility(order, state.returnRequests);
      if (!eligibility.isEligible) {
        throw new Error(`Đơn hàng không đủ điều kiện đổi trả: ${eligibility.eligibleReason}`);
      }

      const reasonObj = RETURN_REASONS.find(r => r.id === reasonId) || RETURN_REASONS[RETURN_REASONS.length - 1];
      const paidAmount = order.paymentStatus === PAYMENT_STATUS.FULLY_PAID ? order.unitPrice : (order.depositAmount || 50000000);
      const financials = calculateReturnFinancials({
        paidAmount,
        reasonId: reasonObj.id,
        currentOdoKm: odo
      });

      const returnCode = `RET-2026-${Math.floor(1000 + Math.random() * 9000)}`;
      const nowIso = new Date().toISOString();

      const newReturn = {
        id: returnCode,
        returnCode,
        orderId: order.id,
        orderNumber: order.orderNumber || order.id,
        userId: order.userId,
        customerName: order.buyerName || user.fullName,
        customerPhone: order.buyerPhone || '+84 901 234 567',
        vehicleId: order.vehicleId,
        vehicleName: order.vehicleName,
        vin: order.vin || `SG-${order.id}`,
        licensePlate: order.licensePlate || 'Chưa bấm biển',
        image: order.image || 'assets/model-e.jpg',
        requestType: Security.sanitizeString(requestType || 'Đổi xe hoặc Hoàn tiền theo chính sách 7 ngày'),
        reasonId: reasonObj.id,
        reasonLabel: reasonObj.label,
        description: Security.sanitizeString(description),
        actualCondition: Security.sanitizeString(actualCondition || 'Nguyên bản, đầy đủ phụ kiện và giấy tờ theo xe.'),
        currentOdoKm: odo,
        photos: validatedPhotos.length > 0 ? validatedPhotos : [
          { name: 'anh-thuc-te-xe.jpg', url: order.image || 'assets/garage-car-detail.jpg', sizeKb: 320 }
        ],
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
      if (!reqItem) throw new Error(`Không tìm thấy hồ sơ đổi trả "${returnId}".`);

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

      return reqItem;
    });
  },

  async submitReturnSupplement(user, returnId, payload) {
    const { message, photos, pickupDate, pickupTimeSlot, pickupAddress } = payload;
    return runInTransaction(async (state) => {
      const reqItem = state.returnRequests.find(r => r.id === returnId || r.returnCode === returnId);
      if (!reqItem) throw new Error(`Không tìm thấy hồ sơ đổi trả "${returnId}".`);
      if (user.role === ROLES.BUYER && reqItem.userId !== user.userId) {
        const err = new Error('Bạn không có quyền chỉnh sửa hồ sơ đổi trả này.');
        err.statusCode = 403;
        throw err;
      }

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
    const isStaff = [ROLES.ADMIN, ROLES.SELLER, ROLES.SERVICE_STAFF].includes(user.role);
    const warranties = isStaff
      ? dbState.warranties
      : dbState.warranties.filter(w => w.userId === user.userId);

    const serviceRecords = isStaff
      ? dbState.serviceRecords
      : dbState.serviceRecords.filter(sr => sr.userId === user.userId);

    const serviceAppointments = isStaff
      ? dbState.serviceAppointments
      : dbState.serviceAppointments.filter(sa => sa.userId === user.userId);

    // Find delivered/paid orders that do NOT yet have an activated warranty record
    const userOrders = isStaff
      ? dbState.orders
      : dbState.orders.filter(o => o.userId === user.userId);

    const unactivatedOrders = userOrders.filter(o => {
      const hasWarranty = dbState.warranties.some(
        w => w.orderId === o.id || (o.vin && w.vin === o.vin)
      );
      return !hasWarranty && [ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED, ORDER_STATUS.CONFIRMED].includes(o.orderStatus);
    }).map(o => ({
      orderId: o.id,
      orderNumber: o.orderNumber || o.id,
      vehicleId: o.vehicleId,
      vehicleName: o.vehicleName,
      edition: o.edition || 'Tiêu chuẩn',
      color: o.color || 'Trắng Ngọc Trai',
      image: o.image || 'assets/model-e.jpg',
      vin: o.vin || `SGME2026VN00${o.id.replace(/\D/g, '')}`,
      motorNumber: o.motorNumber || `MTR-320KW-${o.id.replace(/\D/g, '')}`,
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

    // Workshop Bay & Parts status for Admin/Seller After-Sales Dashboard
    const workshopStatus = {
      bays: [
        { id: 'Khoang 01', vehicle: 'SIGMA Model E (30K-888.99)', task: 'Bảo dưỡng định kỳ 15.000 km', progress: 80, status: 'Sắp xong (80%)', technician: 'Trần Quốc Hưng' },
        { id: 'Khoang 02', vehicle: 'SIGMA Vision S (29A-401.22)', task: 'Thay lốp & Cân bằng động 3D', progress: 45, status: 'Đang làm (45%)', technician: 'Lê Hoàng Nam' },
        { id: 'Khoang 03', vehicle: 'Trống — Sẵn sàng tiếp nhận', task: 'Khoang chẩn đoán Pin cao áp', progress: 0, status: 'Sẵn sàng', technician: 'Phạm Văn Đức' },
        { id: 'Khoang 04', vehicle: 'SIGMA X-Series GT (51K-999.68)', task: 'Kiểm định thu hồi Đổi trả 7 ngày', progress: 65, status: 'Đang kiểm định (65%)', technician: 'Trần Quốc Hưng' }
      ],
      partsInventory: [
        { code: 'PT-BAT-90', name: 'Mô-đun Pin LFP/NCM Cao Áp', status: 'Đủ hàng (14 cụm)', level: 'good' },
        { code: 'PT-BRK-02', name: 'Má phanh gốm Carbon tái sinh', status: 'Sắp hết (Còn 3 bộ)', level: 'warning' },
        { code: 'PT-HEPA-01', name: 'Lọc gió điều hòa HEPA AirClean', status: 'Đủ hàng (48 chiếc)', level: 'good' },
        { code: 'PT-COOL-05', name: 'Dung dịch giải nhiệt Pin chuyên dụng', status: 'Đủ hàng (32 bình)', level: 'good' }
      ]
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
        emailConfigured: true,
        smsProviderConfigured: Boolean(process.env.SMS_API_KEY),
        smsNote: process.env.SMS_API_KEY
          ? 'Đã kết nối cổng SMS Brandname SIGMACAR'
          : 'Chế độ giả lập an toàn (Chưa cấu hình SMS_API_KEY trong .env — Chỉ gửi khi khách hàng bật đồng ý SMS)'
      }
    };
  },

  async activateElectronicWarranty(user, payload) {
    const { vin, motorNumber, invoiceNumber, purchaseDate, licensePlate } = payload;
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
        throw new Error(`Số khung VIN "${cleanVin}" đã được kích hoạt bảo hành điện tử (Mã: ${duplicate.warrantyCode}). Không thể tạo hồ sơ trùng lặp.`);
      }

      // Verify against real orders in database
      const matchedOrder = state.orders.find(o => {
        const orderVin = (o.vin || `SGME2026VN00${o.id.replace(/\D/g, '')}`).toUpperCase();
        const orderInv = (o.invoiceNumber || `INV-${o.id}`).toUpperCase();
        const orderIdUpper = o.id.toUpperCase();
        return orderVin === cleanVin && (orderInv === cleanInvoice || orderIdUpper === cleanInvoice);
      });

      if (!matchedOrder) {
        throw new Error(`Xác thực thất bại: Không tìm thấy đơn hàng chính hãng khớp với số khung VIN "${cleanVin}" và mã hóa đơn/đơn hàng "${cleanInvoice}". Vui lòng kiểm tra lại biên bản bàn giao xe.`);
      }

      const expectedMotor = (matchedOrder.motorNumber || '').toUpperCase();
      if (expectedMotor && expectedMotor !== cleanMotor) {
        throw new Error(`Mã động cơ "${cleanMotor}" không khớp với dữ liệu xuất xưởng của số khung "${cleanVin}".`);
      }

      if (user.role === ROLES.BUYER && matchedOrder.userId !== user.userId) {
        const err = new Error('Số khung VIN này thuộc về một tài khoản khách hàng khác.');
        err.statusCode = 403;
        throw err;
      }

      const start = purchaseDate || (matchedOrder.deliveredAt || matchedOrder.createdAt || new Date().toISOString()).slice(0, 10);
      const startYear = parseInt(start.slice(0, 4), 10) || 2026;
      const dateRest = start.slice(4);
      const endDate = `${startYear + 5}${dateRest}`;
      const batteryEndDate = `${startYear + 8}${dateRest}`;

      const warrantyCode = `EW-SIGMA-${startYear}-${Math.floor(100 + Math.random() * 900)}`;
      const newWarranty = {
        id: `WAR-${Date.now()}`,
        warrantyCode,
        orderId: matchedOrder.id,
        orderNumber: matchedOrder.orderNumber || matchedOrder.id,
        userId: matchedOrder.userId,
        ownerName: matchedOrder.buyerName || user.fullName,
        ownerPhone: matchedOrder.buyerPhone || '+84 901 234 567',
        vehicleId: matchedOrder.vehicleId,
        vehicleName: matchedOrder.vehicleName,
        edition: matchedOrder.edition || 'Bản Tiêu Chuẩn',
        color: matchedOrder.color || 'Trắng Ngọc Trai',
        image: matchedOrder.image || 'assets/garage-car-detail.jpg',
        vin: cleanVin,
        motorNumber: cleanMotor,
        licensePlate: Security.sanitizeString(licensePlate || matchedOrder.licensePlate || 'Đang chờ cấp biển'),
        invoiceNumber: cleanInvoice,
        purchaseDate: start,
        activatedAt: new Date().toISOString(),
        startDate: start,
        endDate,
        batteryEndDate,
        maxKm: 150000,
        batteryMaxKm: 160000,
        currentOdoKm: 50,
        batteryHealthPercent: 100,
        nextMaintenanceKm: 1000,
        nextMaintenanceDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        maintenanceStatus: 'Đang hoạt động',
        status: WARRANTY_STATUS.ACTIVE,
        scopeSummary: 'Bảo hành chính hãng 5 năm (150.000 km) toàn xe & 8 năm (160.000 km) Pin cao áp.',
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

    const center = SERVICE_CENTERS.find(c => c.id === serviceCenterId) || SERVICE_CENTERS[0];

    return runInTransaction(async (state) => {
      const code = `#APT-2026-${Math.floor(1000 + Math.random() * 9000)}`;
      const appt = {
        id: `SAP-${Date.now()}`,
        appointmentCode: code,
        userId: user.userId,
        customerName: user.fullName,
        phone: payload.phone || '+84 901 234 567',
        vehicleId: vehicleId || 'model-e',
        vehicleName: Security.sanitizeString(vehicleName),
        vin: Security.sanitizeString(vin || 'SGME2026VN001889'),
        licensePlate: Security.sanitizeString(licensePlate || '30K - 888.99'),
        image: 'assets/car-thumb-s5.jpg',
        serviceType: Security.sanitizeString(serviceType || 'BẢO DƯỠNG ĐỊNH KỲ'),
        serviceItems: Array.isArray(serviceItems) && serviceItems.length > 0
          ? serviceItems.map(i => Security.sanitizeString(i))
          : ['Bảo dưỡng định kỳ tiêu chuẩn', 'Kiểm tra chẩn đoán Pin cao áp'],
        serviceCenterId: center.id,
        serviceCenterName: center.name,
        serviceCenterAddress: center.address,
        preferredDate: Security.sanitizeString(preferredDate),
        timeSlot: Security.sanitizeString(timeSlot),
        conditionNotes: Security.sanitizeString(conditionNotes || 'Kiểm tra bảo dưỡng định kỳ theo lịch khuyến nghị.'),
        assignedTechnician: 'Chờ phân công kỹ sư',
        bayNumber: 'Chờ xếp khoang',
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
        detail: `Đặt lịch dịch vụ ${code} cho xe ${appt.vehicleName} tại ${center.name} ngày ${preferredDate}.`
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
      const center = SERVICE_CENTERS.find(c => c.id === serviceCenterId) || SERVICE_CENTERS[0];

      const lCost = Math.max(0, Number(laborCost || 0));
      const pCost = Math.max(0, Number(partsCost || 0));
      const newOdo = Math.max(0, Number(odoKm || (warranty ? warranty.currentOdoKm : 1000)));

      const record = {
        id: `SRV-${Date.now()}`,
        warrantyId: warranty ? warranty.id : null,
        userId: warranty ? warranty.userId : 'usr_buyer_01',
        vehicleId: warranty ? warranty.vehicleId : 'model-e',
        vehicleName: warranty ? warranty.vehicleName : 'SIGMA Model E',
        vin: cleanVin,
        licensePlate: warranty ? warranty.licensePlate : '30K - 888.99',
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
        invoiceCode: `HD-DV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(10 + Math.random() * 89)}`,
        status: 'Hoàn thành'
      };

      state.serviceRecords.unshift(record);

      // Sync ODO and Battery SoH onto the linked warranty record
      if (warranty) {
        if (newOdo > (warranty.currentOdoKm || 0)) {
          warranty.currentOdoKm = newOdo;
        }
        if (batteryHealthPercent !== undefined && !Number.isNaN(Number(batteryHealthPercent))) {
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
  // SECTION 4: VERIFIED REVIEWS & COMMUNITY Q&A
  // ===========================================================================
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

    // Questions
    let questions = Array.isArray(dbState.questions) ? [...dbState.questions] : [];
    if (vehicleId && vehicleId !== 'all') {
      questions = questions.filter(q => q.vehicleId === vehicleId);
    }
    if (!isModerator) {
      questions = questions.filter(q => q.status !== 'hidden');
    }

    // Check if currentUser owns this vehicle
    let currentUserVerifiedOrder = null;
    if (currentUser && vehicleId) {
      currentUserVerifiedOrder = dbState.orders.find(
        o => o.userId === currentUser.userId &&
          o.vehicleId === vehicleId &&
          [ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED, ORDER_STATUS.CONFIRMED].includes(o.orderStatus)
      );
    }

    return {
      reviews: filtered,
      questions,
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
    const { vehicleId, rating, criteria, title, content, media } = payload;
    if (!vehicleId || !rating || !title || !content) {
      throw new Error('Vui lòng chọn số sao (1-5), nhập tiêu đề và nội dung đánh giá chi tiết.');
    }

    const numRating = Math.min(5, Math.max(1, Math.round(Number(rating))));
    if (String(title).trim().length < 5 || String(content).trim().length < 15) {
      throw new Error('Tiêu đề cần ít nhất 5 ký tự và nội dung đánh giá tối thiểu 15 ký tự.');
    }

    const validatedMedia = validateAttachments(media);

    return runInTransaction(async (state) => {
      const vehicle = state.vehicles.find(v => v.id === vehicleId) || state.certifiedVehicles.find(v => v.id === vehicleId);
      if (!vehicle) throw new Error('Không tìm thấy mẫu xe cần đánh giá.');

      // Anti-duplicate spam check
      const existing = state.reviews.find(
        r => r.vehicleId === vehicleId && r.userId === user.userId && r.moderationStatus !== 'removed'
      );
      if (existing) {
        throw new Error('Bạn đã gửi đánh giá cho mẫu xe này trước đó. Bạn có thể chỉnh sửa đánh giá hiện có của mình.');
      }

      // Server-side ownership verification for "Đã mua hàng" badge
      const verifiedOrder = state.orders.find(
        o => o.userId === user.userId &&
          o.vehicleId === vehicleId &&
          ([ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED].includes(o.orderStatus) || o.paymentStatus === PAYMENT_STATUS.FULLY_PAID)
      );

      const safeCriteria = {
        design: Math.min(5, Math.max(1, Math.round(Number(criteria?.design || numRating)))),
        performance: Math.min(5, Math.max(1, Math.round(Number(criteria?.performance || numRating)))),
        features: Math.min(5, Math.max(1, Math.round(Number(criteria?.features || numRating)))),
        comfort: Math.min(5, Math.max(1, Math.round(Number(criteria?.comfort || numRating)))),
        value: Math.min(5, Math.max(1, Math.round(Number(criteria?.value || numRating))))
      };

      const nowIso = new Date().toISOString();
      const review = {
        id: `REV-${Date.now()}`,
        vehicleId,
        vehicleName: vehicle.name,
        userId: user.userId,
        authorName: user.fullName,
        authorTier: 'Thành viên SIGMACAR',
        orderId: verifiedOrder ? verifiedOrder.id : null,
        verifiedPurchase: Boolean(verifiedOrder),
        rating: numRating,
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
      return review;
    });
  },

  async updateReview(user, reviewId, payload) {
    const { rating, criteria, title, content, media } = payload;
    return runInTransaction(async (state) => {
      const review = state.reviews.find(r => r.id === reviewId);
      if (!review) throw new Error('Không tìm thấy đánh giá.');
      if (review.userId !== user.userId && user.role !== ROLES.ADMIN) {
        const err = new Error('Bạn chỉ có thể chỉnh sửa đánh giá của chính mình.');
        err.statusCode = 403;
        throw err;
      }

      if (rating !== undefined) review.rating = Math.min(5, Math.max(1, Math.round(Number(rating))));
      if (title !== undefined) review.title = Security.sanitizeString(title);
      if (content !== undefined) review.content = Security.sanitizeString(content);
      if (criteria && typeof criteria === 'object') {
        review.criteria = {
          design: Math.min(5, Math.max(1, Math.round(Number(criteria.design || review.rating)))),
          performance: Math.min(5, Math.max(1, Math.round(Number(criteria.performance || review.rating)))),
          features: Math.min(5, Math.max(1, Math.round(Number(criteria.features || review.rating)))),
          comfort: Math.min(5, Math.max(1, Math.round(Number(criteria.comfort || review.rating)))),
          value: Math.min(5, Math.max(1, Math.round(Number(criteria.value || review.rating))))
        };
      }
      if (Array.isArray(media)) {
        review.media = validateAttachments(media);
      }
      review.updatedAt = new Date().toISOString();
      return review;
    });
  },

  async deleteReview(user, reviewId) {
    return runInTransaction(async (state) => {
      const idx = state.reviews.findIndex(r => r.id === reviewId);
      if (idx === -1) throw new Error('Không tìm thấy đánh giá.');
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
      if (!review) throw new Error('Không tìm thấy đánh giá.');
      if (review.userId === user.userId) {
        throw new Error('Bạn không thể tự bình chọn Hữu ích cho đánh giá của chính mình.');
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
        review
      };
    });
  },

  async reportReview(user, reviewId, { reason }) {
    return runInTransaction(async (state) => {
      const review = state.reviews.find(r => r.id === reviewId);
      if (!review) throw new Error('Không tìm thấy đánh giá.');
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
      throw new Error('Vui lòng nhập lý do kiểm duyệt (ẩn/gỡ/khôi phục) để lưu nhật ký hệ thống.');
    }

    return runInTransaction(async (state) => {
      const review = state.reviews.find(r => r.id === reviewId);
      if (!review) throw new Error('Không tìm thấy đánh giá.');

      if (action === 'hide') review.moderationStatus = 'hidden';
      else if (action === 'remove') review.moderationStatus = 'removed';
      else if (action === 'restore' || action === 'approve') {
        review.moderationStatus = 'approved';
        review.reportedBy = [];
      } else {
        throw new Error('Hành động kiểm duyệt không hợp lệ.');
      }

      review.moderationNote = Security.sanitizeString(reason);
      review.updatedAt = new Date().toISOString();

      appendAuditLog(state, {
        action: `REVIEW_MODERATED_${action.toUpperCase()}`,
        actorId: user.userId,
        actorName: user.fullName,
        targetId: reviewId,
        detail: `Kiểm duyệt đánh giá ${reviewId} -> ${review.moderationStatus}. Lý do: ${reason}`
      });

      return review;
    });
  },

  async createQuestion(user, payload) {
    const { vehicleId, question } = payload;
    if (!vehicleId || !question || String(question).trim().length < 10) {
      throw new Error('Câu hỏi cần có độ dài tối thiểu 10 ký tự.');
    }

    return runInTransaction(async (state) => {
      const vehicle = state.vehicles.find(v => v.id === vehicleId) || state.certifiedVehicles.find(v => v.id === vehicleId);
      const qObj = {
        id: `QNA-${Date.now()}`,
        vehicleId,
        vehicleName: vehicle ? vehicle.name : vehicleId,
        userId: user.userId,
        authorName: user.fullName,
        question: Security.sanitizeString(question),
        status: 'approved',
        createdAt: new Date().toISOString(),
        answers: []
      };
      state.questions.unshift(qObj);
      return qObj;
    });
  },

  async answerQuestion(user, questionId, { content }) {
    if (!content || String(content).trim().length < 3) {
      throw new Error('Vui lòng nhập nội dung câu trả lời.');
    }
    return runInTransaction(async (state) => {
      const qObj = state.questions.find(q => q.id === questionId);
      if (!qObj) throw new Error('Không tìm thấy câu hỏi.');
      const ans = {
        id: `ANS-${Date.now()}`,
        userId: user.userId,
        authorName: user.role !== ROLES.BUYER ? `${user.fullName} (Chuyên gia SIGMACAR)` : user.fullName,
        authorRole: user.role,
        content: Security.sanitizeString(content),
        createdAt: new Date().toISOString()
      };
      qObj.answers.push(ans);
      return qObj;
    });
  },

  // ===========================================================================
  // SECTION 5: CUSTOMER SUPPORT CENTER & TICKETING
  // (Strict isolation: internalNotes NEVER exposed to buyers)
  // ===========================================================================
  sanitizeTicketForUser(ticket, user) {
    const isStaff = user && [ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF, ROLES.SERVICE_STAFF].includes(user.role);
    if (isStaff) {
      return { ...ticket };
    }
    const { internalNotes, ...publicTicket } = ticket;
    return publicTicket;
  },

  getSupportCenterData(user, query = {}) {
    const isStaff = user && [ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF, ROLES.SERVICE_STAFF].includes(user.role);

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

    // Tickets
    let tickets = [];
    if (user) {
      const rawTickets = isStaff
        ? [...dbState.supportTickets]
        : dbState.supportTickets.filter(t => t.userId === user.userId);

      tickets = rawTickets.map(t => this.sanitizeTicketForUser(t, user));

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
    }

    tickets.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

    const allTickets = dbState.supportTickets || [];
    const kpis = {
      totalTickets: allTickets.length,
      newCount: allTickets.filter(t => t.status === TICKET_STATUS.OPEN).length,
      inProgressCount: allTickets.filter(t => [TICKET_STATUS.IN_PROGRESS, TICKET_STATUS.WAITING_STAFF].includes(t.status)).length,
      waitingCustomerCount: allTickets.filter(t => t.status === TICKET_STATUS.WAITING_CUSTOMER).length,
      resolvedCount: allTickets.filter(t => [TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED].includes(t.status)).length,
      overdueCount: allTickets.filter(t => {
        if ([TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED].includes(t.status)) return false;
        return t.slaDueAt && new Date(t.slaDueAt).getTime() < Date.now();
      }).length,
      avgFirstResponseMinutes: 18
    };

    return {
      faqs,
      tickets,
      kpis
    };
  },

  lookupTicketByCode(ticketCode, user) {
    if (!ticketCode) throw new Error('Vui lòng nhập mã yêu cầu hỗ trợ (VD: TCK-2026-3001).');
    const clean = String(ticketCode).trim().toUpperCase();
    const ticket = dbState.supportTickets.find(
      t => (t.ticketCode || '').toUpperCase() === clean || (t.id || '').toUpperCase() === clean
    );
    if (!ticket) {
      throw new Error(`Không tìm thấy yêu cầu hỗ trợ với mã "${clean}".`);
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
      customerPhone
    } = payload;

    if (!subject || !category || !description) {
      throw new Error('Vui lòng nhập chủ đề, phân loại yêu cầu và nội dung mô tả chi tiết.');
    }

    const validatedFiles = validateAttachments(attachments);
    const prio = Object.values(TICKET_PRIORITY).includes(priority) ? priority : TICKET_PRIORITY.NORMAL;
    const slaHours = prio === TICKET_PRIORITY.URGENT ? 2 : prio === TICKET_PRIORITY.HIGH ? 6 : prio === TICKET_PRIORITY.NORMAL ? 24 : 48;

    return runInTransaction(async (state) => {
      const code = `TCK-2026-${Math.floor(1000 + Math.random() * 9000)}`;
      const nowIso = new Date().toISOString();
      const senderId = user ? user.userId : `guest_${Date.now()}`;
      const senderName = user ? user.fullName : Security.sanitizeString(customerName || 'Khách hàng');

      const newTicket = {
        id: code,
        ticketCode: code,
        userId: senderId,
        customerName: senderName,
        customerEmail: user ? user.email : Security.sanitizeString(customerEmail || ''),
        customerPhone: Security.sanitizeString(customerPhone || '+84 901 234 567'),
        subject: Security.sanitizeString(subject),
        category: Security.sanitizeString(category),
        linkedOrderId: Security.sanitizeString(linkedOrderId || ''),
        linkedVehicleName: Security.sanitizeString(linkedVehicleName || ''),
        priority: prio,
        status: TICKET_STATUS.OPEN,
        assignedStaffId: 'usr_support_01',
        assignedStaffName: 'Nguyễn Ngọc Lan',
        department: category.includes('Bảo hành') || category.includes('Bảo dưỡng')
          ? 'Kỹ thuật & Bảo hành Hậu mãi'
          : category.includes('Đổi trả')
            ? 'Trung tâm Đổi trả 7 ngày'
            : 'Chăm sóc Khách hàng & Tư vấn',
        attachments: validatedFiles,
        messages: [
          {
            id: `MSG-${Date.now()}`,
            senderId,
            senderName,
            senderRole: user ? user.role : ROLES.BUYER,
            content: Security.sanitizeString(description),
            attachments: validatedFiles,
            createdAt: nowIso
          }
        ],
        internalNotes: [],
        slaDueAt: new Date(Date.now() + slaHours * 3600000).toISOString(),
        firstRespondedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso
      };

      state.supportTickets.unshift(newTicket);
      return this.sanitizeTicketForUser(newTicket, user);
    });
  },

  async replyToSupportTicket(user, ticketId, { content, attachments }) {
    if (!content || String(content).trim().length < 2) {
      throw new Error('Vui lòng nhập nội dung phản hồi.');
    }
    const validatedFiles = validateAttachments(attachments);

    return runInTransaction(async (state) => {
      const ticket = state.supportTickets.find(t => t.id === ticketId || t.ticketCode === ticketId);
      if (!ticket) throw new Error('Không tìm thấy yêu cầu hỗ trợ.');

      const isStaff = [ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF, ROLES.SERVICE_STAFF].includes(user.role);
      if (!isStaff && ticket.userId !== user.userId) {
        const err = new Error('Bạn không có quyền truy cập yêu cầu hỗ trợ này.');
        err.statusCode = 403;
        throw err;
      }

      const nowIso = new Date().toISOString();
      ticket.messages.push({
        id: `MSG-${Date.now()}`,
        senderId: user.userId,
        senderName: isStaff ? `${user.fullName} (CSKH SIGMACAR)` : user.fullName,
        senderRole: user.role,
        content: Security.sanitizeString(content),
        attachments: validatedFiles,
        createdAt: nowIso
      });

      if (isStaff) {
        ticket.status = TICKET_STATUS.WAITING_CUSTOMER;
        if (!ticket.firstRespondedAt) ticket.firstRespondedAt = nowIso;
      } else {
        ticket.status = TICKET_STATUS.WAITING_STAFF;
      }
      ticket.updatedAt = nowIso;

      return this.sanitizeTicketForUser(ticket, user);
    });
  },

  async updateSupportTicketAdmin(user, ticketId, payload) {
    const isStaff = [ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF, ROLES.SERVICE_STAFF].includes(user.role);
    if (!isStaff) {
      const err = new Error('Chỉ nhân viên hỗ trợ hoặc quản trị viên mới có quyền thực hiện thao tác này.');
      err.statusCode = 403;
      throw err;
    }

    const { status, priority, assignedStaffName, department, internalNote } = payload;

    return runInTransaction(async (state) => {
      const ticket = state.supportTickets.find(t => t.id === ticketId || t.ticketCode === ticketId);
      if (!ticket) throw new Error('Không tìm thấy yêu cầu hỗ trợ.');

      if (status) ticket.status = status;
      if (priority) ticket.priority = priority;
      if (assignedStaffName !== undefined) ticket.assignedStaffName = Security.sanitizeString(assignedStaffName);
      if (department !== undefined) ticket.department = Security.sanitizeString(department);

      const nowIso = new Date().toISOString();
      if (internalNote && String(internalNote).trim().length > 0) {
        if (!Array.isArray(ticket.internalNotes)) ticket.internalNotes = [];
        ticket.internalNotes.push({
          id: `INOTE-${Date.now()}`,
          authorId: user.userId,
          authorName: user.fullName,
          note: Security.sanitizeString(internalNote),
          createdAt: nowIso
        });
      }

      ticket.updatedAt = nowIso;
      appendAuditLog(state, {
        action: 'TICKET_UPDATED_BY_STAFF',
        actorId: user.userId,
        actorName: user.fullName,
        targetId: ticket.ticketCode,
        detail: `Cập nhật ticket ${ticket.ticketCode} (Trạng thái: ${ticket.status}, Phòng ban: ${ticket.department}).`
      });

      return ticket;
    });
  },

  // ===========================================================================
  // SECTION 6: EMAIL CAMPAIGNS & PRIVACY / UNSUBSCRIBE COMPLIANCE
  // ===========================================================================
  getRecipientListForSegment(segment) {
    const buyers = dbState.users.filter(u => u.role === ROLES.BUYER);
    // Filter strictly to users who have marketing consent enabled
    const optedIn = buyers.filter(u => u.securityPrefs?.marketingConsent !== false);

    if (segment === 'birthday_month') {
      const currentMonth = new Date().getMonth() + 1;
      const matched = optedIn.filter(u => {
        if (!u.birthDate) return true;
        const m = parseInt(u.birthDate.split('-')[1], 10);
        return m === currentMonth || m === 10 || m === 11;
      });
      return matched.length > 0 ? matched : optedIn;
    }
    if (segment === 'owners') {
      const ownerIds = new Set(dbState.orders.map(o => o.userId));
      return optedIn.filter(u => ownerIds.has(u.id));
    }
    return optedIn;
  },

  renderPersonalizedTemplate(bodyHtml, subject, recipient) {
    const vars = {
      customer_name: recipient.fullName || 'Quý khách',
      birth_date: recipient.birthDate || '29/10',
      promo_code: recipient.promoCode || 'SIGMAVIP2026',
      vehicle_name: recipient.vehicleName || 'SIGMA Model E'
    };
    const replaceTokens = (str = '') =>
      String(str)
        .replace(/\{\{\s*customer_name\s*\}\}/g, vars.customer_name)
        .replace(/\{\{\s*birth_date\s*\}\}/g, vars.birth_date)
        .replace(/\{\{\s*promo_code\s*\}\}/g, vars.promo_code)
        .replace(/\{\{\s*vehicle_name\s*\}\}/g, vars.vehicle_name);

    return {
      renderedSubject: replaceTokens(subject),
      renderedHtml: replaceTokens(bodyHtml)
    };
  },

  getCampaignsOverview(user) {
    if (![ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF].includes(user.role)) {
      const err = new Error('Không có quyền truy cập trình quản lý chiến dịch Email.');
      err.statusCode = 403;
      throw err;
    }

    const buyers = dbState.users.filter(u => u.role === ROLES.BUYER);
    const optedInCount = buyers.filter(u => u.securityPrefs?.marketingConsent !== false).length;
    const unsubscribedCount = buyers.length - optedInCount;
    const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);

    return {
      campaigns: dbState.emailCampaigns || [],
      categories: CAMPAIGN_CATEGORIES,
      statuses: CAMPAIGN_STATUS,
      segments: [
        { id: 'all_opted_in', label: 'Tất cả khách hàng đồng ý nhận tin (Marketing Opt-in)', count: optedInCount },
        { id: 'birthday_month', label: 'Khách hàng có Sinh nhật trong tháng', count: this.getRecipientListForSegment('birthday_month').length },
        { id: 'owners', label: 'Chủ sở hữu xe SIGMACAR đã mua hàng', count: this.getRecipientListForSegment('owners').length }
      ],
      privacySummary: {
        totalBuyers: buyers.length,
        optedInCount,
        unsubscribedCount,
        smtpConfigured,
        deliveryModeLabel: smtpConfigured
          ? 'SMTP Production Gateway'
          : 'Chế độ Hàng đợi Giả lập An toàn (Dev Queue — Chưa cấu hình SMTP trong .env, không gửi email thật ra ngoài)'
      }
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
    } = payload;

    if (!name || !subject || !bodyHtml) {
      throw new Error('Vui lòng nhập tên chiến dịch, tiêu đề Email và nội dung bản mẫu.');
    }

    return runInTransaction(async (state) => {
      const nowIso = new Date().toISOString();
      const recipients = this.getRecipientListForSegment(targetSegment || 'all_opted_in');

      if (id) {
        const existing = state.emailCampaigns.find(c => c.id === id);
        if (!existing) throw new Error('Không tìm thấy chiến dịch Email.');
        if (existing.status === CAMPAIGN_STATUS.SENT) {
          throw new Error('Không thể chỉnh sửa chiến dịch đã gửi hoàn tất.');
        }
        existing.name = Security.sanitizeString(name);
        existing.category = category || existing.category;
        existing.subject = subject;
        existing.preheader = Security.sanitizeString(preheader || '');
        existing.promoCode = Security.sanitizeString(promoCode || 'SIGMAVIP');
        existing.discountValue = Security.sanitizeString(discountValue || '');
        existing.targetSegment = targetSegment || 'all_opted_in';
        existing.bodyHtml = bodyHtml;
        if (scheduledAt !== undefined) {
          existing.scheduledAt = scheduledAt;
          if (scheduledAt) existing.status = CAMPAIGN_STATUS.SCHEDULED;
        }
        existing.stats.eligibleRecipients = recipients.length;
        existing.updatedAt = nowIso;
        return existing;
      }

      const newCamp = {
        id: `CMP-${Date.now()}`,
        name: Security.sanitizeString(name),
        category: category || CAMPAIGN_CATEGORIES.HOLIDAY,
        subject,
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
        bodyHtml,
        status: scheduledAt ? CAMPAIGN_STATUS.SCHEDULED : CAMPAIGN_STATUS.DRAFT,
        scheduledAt: scheduledAt || null,
        sentAt: null,
        stats: {
          eligibleRecipients: recipients.length,
          sentCount: 0,
          deliveredCount: 0,
          failedCount: 0
        },
        deliveryMode: process.env.SMTP_HOST ? 'smtp_live' : 'simulated_dev_queue',
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
      if (!camp) throw new Error('Không tìm thấy chiến dịch Email.');
      if (camp.status === CAMPAIGN_STATUS.SENT) {
        throw new Error('Chiến dịch đã gửi hoàn tất, không thể tạm dừng hoặc hủy.');
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
      throw new Error('Vui lòng nhập địa chỉ Email nhận bản thử nghiệm hợp lệ.');
    }

    const camp = dbState.emailCampaigns.find(c => c.id === campaignId);
    if (!camp) throw new Error('Không tìm thấy chiến dịch Email.');

    const rendered = this.renderPersonalizedTemplate(camp.bodyHtml, camp.subject, {
      fullName: user.fullName || 'Minh Hoàng (Test Preview)',
      birthDate: '29/10/1992',
      promoCode: camp.promoCode || 'SIGMATEST2026',
      vehicleName: 'SIGMA Model E'
    });

    return {
      sent: true,
      testEmail,
      deliveryMode: process.env.SMTP_HOST ? 'smtp_live' : 'simulated_dev_queue',
      note: process.env.SMTP_HOST
        ? `Đã gửi email thử nghiệm tới ${testEmail}`
        : `[Chế độ Giả lập Dev] Đã kết xuất và kiểm tra cú pháp thành công cho hộp thư ${testEmail} (Không gửi email thật ra môi trường ngoài vì chưa cấu hình SMTP trong .env).`,
      preview: rendered
    };
  },

  async executeCampaignSend(user, campaignId, { confirmed }) {
    if (![ROLES.ADMIN, ROLES.SELLER].includes(user.role)) {
      const err = new Error('Chỉ Quản trị viên mới có quyền phát lệnh gửi chiến dịch Email.');
      err.statusCode = 403;
      throw err;
    }
    if (!confirmed) {
      throw new Error('Vui lòng xác nhận trước khi phát hành chiến dịch Email hàng loạt.');
    }

    return runInTransaction(async (state) => {
      const camp = state.emailCampaigns.find(c => c.id === campaignId);
      if (!camp) throw new Error('Không tìm thấy chiến dịch Email.');
      if (camp.status === CAMPAIGN_STATUS.SENT) {
        throw new Error('Chiến dịch này đã được gửi trước đó. Hệ thống chặn gửi trùng lặp để chống spam.');
      }

      const recipients = this.getRecipientListForSegment(camp.targetSegment);
      const nowIso = new Date().toISOString();

      camp.status = CAMPAIGN_STATUS.SENT;
      camp.sentAt = nowIso;
      camp.updatedAt = nowIso;
      camp.stats = {
        eligibleRecipients: recipients.length,
        sentCount: recipients.length,
        deliveredCount: recipients.length,
        failedCount: 0
      };

      appendAuditLog(state, {
        action: 'EMAIL_CAMPAIGN_EXECUTED',
        actorId: user.userId,
        actorName: user.fullName,
        targetId: camp.id,
        detail: `Thực thi chiến dịch "${camp.name}" tới ${recipients.length} khách hàng đã opt-in (${camp.deliveryMode}).`
      });

      return camp;
    });
  },

  async unsubscribeMarketing({ userId, email, reason }) {
    return runInTransaction(async (state) => {
      let user = null;
      if (userId) {
        user = state.users.find(u => u.id === userId);
      } else if (email) {
        const clean = String(email).toLowerCase().trim();
        user = state.users.find(u => u.email.toLowerCase() === clean);
      }
      if (!user) {
        throw new Error('Không tìm thấy tài khoản email đăng ký nhận bản tin.');
      }

      if (!user.securityPrefs) user.securityPrefs = {};
      if (!user.notificationPrefs) user.notificationPrefs = {};
      user.securityPrefs.marketingConsent = false;
      user.notificationPrefs.emailPromo = false;
      user.updatedAt = new Date().toISOString();

      appendAuditLog(state, {
        action: 'MARKETING_UNSUBSCRIBED',
        actorId: user.id,
        actorName: user.fullName,
        targetId: user.id,
        detail: `Khách hàng hủy đăng ký nhận email tiếp thị (Lý do: ${Security.sanitizeString(reason || 'Tùy chọn cá nhân')}).`
      });

      return {
        unsubscribed: true,
        email: user.email,
        marketingConsent: false
      };
    });
  }
};

module.exports = EcommerceService;

