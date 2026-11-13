// backend/application/handover-service.js
// Atomic Vehicle Handover (VIN Allocation, PDI Proof, Ownership Projection & Policy-Backed Warranty Activation)

const crypto = require('crypto');
const { runInTransaction, dbState } = require('../infrastructure/storage-engine');
const Security = require('../infrastructure/security');
const Authorization = require('../domain/authorization');
const PolicyService = require('./policy-service');
const NotificationService = require('./notification-service');
const { ROLES, ORDER_STATUS, PAYMENT_STATUS, WARRANTY_STATUS } = require('../domain/constants');

const __testHooks = {
  failAfterOwnership: false
};

function createError(message, statusCode, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function validateVinFormat(vin) {
  const clean = String(vin || '').trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{10,17}$/.test(clean)) {
    throw createError(`Số khung VIN "${clean || '(trống)'}" không đúng định dạng chuẩn 10-17 ký tự hợp lệ (không chứa O/I/Q hoặc ký tự đặc biệt).`, 422, 'INVALID_VIN');
  }
  return clean;
}

function addYearsSafeIsoDate(startDateStr, yearsToAdd) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(startDateStr || '').slice(0, 10));
  if (!match) return new Date(Date.now() + yearsToAdd * 365 * 86400000).toISOString().slice(0, 10);
  const year = parseInt(match[1], 10) + yearsToAdd;
  const month = parseInt(match[2], 10);
  let day = parseInt(match[3], 10);
  // Clamp Feb 29 on non-leap target years to Feb 28 cleanly
  if (month === 2 && day === 29) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    if (!isLeap) day = 28;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const HandoverService = {
  __testHooks,
  validateVinFormat,
  addYearsSafeIsoDate,

  async executeHandover(user, { orderId, vin, motorNumber = null, pdiPassed = false, odoAtHandover = 0, checklist = [], handoverDate = null, buyerAcknowledged = false } = {}) {
    if (!user || ![ROLES.SELLER, ROLES.ADMIN, ROLES.SERVICE_STAFF].includes(user.role)) {
      throw createError('Chỉ Nhân viên Đại lý hoặc Quản trị viên mới được phép lập Biên bản Bàn giao xe.', 403, 'FORBIDDEN');
    }
    if (!orderId) {
      throw createError('Vui lòng chọn đơn hàng cần bàn giao.', 400, 'VALIDATION_ERROR');
    }

    const cleanVin = validateVinFormat(vin);
    const cleanOdo = Number(odoAtHandover);
    if (!Number.isFinite(cleanOdo) || cleanOdo < 0 || cleanOdo > 500) {
      throw createError('Số ODO tại thời điểm bàn giao xe mới không hợp lệ (từ 0 - 500 km).', 422, 'INVALID_HANDOVER_ODO');
    }
    if (pdiPassed !== true) {
      throw createError('Bắt buộc phải hoàn thành kiểm tra chất lượng trước bàn giao (PDI Passed = true) mới có thể xuất xe.', 422, 'PDI_REQUIRED');
    }

    return runInTransaction(async (state) => {
      if (!Array.isArray(state.handovers)) state.handovers = [];
      if (!Array.isArray(state.vehicleOwnerships)) state.vehicleOwnerships = [];

      const order = state.orders.find(o => o.id === orderId || o.orderNumber === orderId);
      if (!order) {
        throw createError('Không tìm thấy đơn hàng để bàn giao.', 404, 'ORDER_NOT_FOUND');
      }

      if (user.role !== ROLES.ADMIN && !Authorization.hasBranchAccess(user, order.branchId)) {
        throw createError('Đơn hàng thuộc chi nhánh khác phạm vi phụ trách của bạn.', 403, 'FORBIDDEN');
      }

      if ([ORDER_STATUS.CANCELLED, ORDER_STATUS.FAILED].includes(order.orderStatus)) {
        throw createError(`Không thể bàn giao đơn hàng ở trạng thái "${order.orderStatus}".`, 409, 'INVALID_ORDER_STATE');
      }

      const existingHandover = state.handovers.find(h => h.orderId === order.id);
      if (existingHandover) {
        throw createError(`Đơn hàng ${order.orderNumber || order.id} đã hoàn tất bàn giao trước đó (Biên bản ${existingHandover.id}).`, 409, 'HANDOVER_ALREADY_COMPLETED');
      }

      const duplicateVin = state.handovers.find(h => h.vin === cleanVin) ||
        state.vehicleOwnerships.find(own => own.vin === cleanVin);
      if (duplicateVin) {
        throw createError(`Số khung VIN "${cleanVin}" đã được gán cho một xe bàn giao/chủ sở hữu khác.`, 409, 'DUPLICATE_VIN');
      }

      // Check settlement or approved bank financing eligibility
      const approvedFinance = (state.financingApplications || []).find(f => f.orderId === order.id && f.status === 'Lender_Approved');
      const isPaidEnough = [PAYMENT_STATUS.FULLY_PAID, PAYMENT_STATUS.PAID].includes(order.paymentStatus) ||
        (order.paymentStatus === PAYMENT_STATUS.DEPOSIT_PAID && Boolean(approvedFinance));
      if (!isPaidEnough) {
        throw createError('Đơn hàng chưa hoàn tất thanh toán toàn phần hoặc chưa có phê duyệt giải ngân ngân hàng hợp lệ để bàn giao xe.', 409, 'PAYMENT_REQUIRED_FOR_HANDOVER');
      }

      const vehicle = state.vehicles.find(v => v.id === order.vehicleId) || state.certifiedVehicles.find(v => v.id === order.vehicleId);
      const isEv = vehicle ? String(vehicle.fuel || '').toLowerCase() === 'ev' : true;
      const warrantyPolicy = PolicyService.getActivePolicy(isEv ? 'warranty_ev' : 'warranty_ice');
      const wRules = warrantyPolicy.rules || { vehicleYears: isEv ? 5 : 3, vehicleMaxKm: isEv ? 150000 : 100000, batteryYears: isEv ? 8 : 0, batteryMaxKm: isEv ? 160000 : 0 };

      const actualHandoverIso = handoverDate && !Number.isNaN(new Date(handoverDate).getTime())
        ? new Date(handoverDate).toISOString()
        : new Date().toISOString();
      const startDate = actualHandoverIso.slice(0, 10);
      const endDate = addYearsSafeIsoDate(startDate, wRules.vehicleYears || 3);
      const batteryEndDate = (wRules.batteryYears || 0) > 0 ? addYearsSafeIsoDate(startDate, wRules.batteryYears) : null;

      const handoverRecord = {
        id: `HDV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        orderId: order.id,
        orderNumber: order.orderNumber || order.id,
        branchId: order.branchId,
        vin: cleanVin,
        motorNumber: motorNumber ? Security.sanitizeString(String(motorNumber).trim().toUpperCase()) : null,
        inspectorId: user.userId,
        inspectorName: user.fullName || user.email,
        pdiPassed: true,
        odoAtHandover: cleanOdo,
        checklist: Array.isArray(checklist) && checklist.length > 0 ? checklist : [
          { item: 'Kiểm tra ngoại thất & nước sơn', ok: true },
          { item: 'Kiểm tra pin cao áp / hệ thống động lực', ok: true },
          { item: 'Đủ 02 chìa khóa thông minh & phụ kiện tiêu chuẩn', ok: true }
        ],
        buyerAcknowledged: Boolean(buyerAcknowledged),
        handedOverAt: actualHandoverIso,
        createdAt: new Date().toISOString()
      };
      state.handovers.unshift(handoverRecord);

      order.vin = cleanVin;
      order.motorNumber = handoverRecord.motorNumber;
      order.handoverId = handoverRecord.id;
      order.handoverOdoKm = cleanOdo;
      order.deliveredAt = actualHandoverIso;
      if (buyerAcknowledged) {
        order.completedAt = actualHandoverIso;
        order.orderStatus = ORDER_STATUS.COMPLETED;
      } else {
        order.orderStatus = ORDER_STATUS.DELIVERED;
      }
      order.updatedAt = new Date().toISOString();
      order.history = order.history || [];
      order.history.push({
        status: order.orderStatus,
        timestamp: actualHandoverIso,
        updatedBy: user.userId,
        note: `Bàn giao xe thực tế thành công — VIN: ${cleanVin}, ODO: ${cleanOdo} km (${handoverRecord.id}).`
      });

      const ownership = {
        id: `OWN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        userId: order.userId,
        orderId: order.id,
        handoverId: handoverRecord.id,
        vehicleId: order.vehicleId,
        vehicleName: order.vehicleName,
        fuel: (vehicle && vehicle.fuel) || 'ev',
        vin: cleanVin,
        motorNumber: handoverRecord.motorNumber,
        licensePlate: order.licensePlate || null,
        branchId: order.branchId,
        acquiredAt: actualHandoverIso,
        createdAt: new Date().toISOString()
      };
      state.vehicleOwnerships.unshift(ownership);

      if (__testHooks.failAfterOwnership) {
        throw new Error('Injected transactional handover failure after ownership projection');
      }

      // Activate official policy-backed electronic warranty only if not already registered for this VIN
      let warranty = state.warranties.find(w => (w.vin || '').toUpperCase() === cleanVin);
      if (!warranty) {
        const warrantyCode = `EW-SIGMA-${startDate.slice(0, 4)}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
        warranty = {
          id: `WAR-${crypto.randomUUID().slice(0, 8)}`,
          warrantyCode,
          orderId: order.id,
          orderNumber: order.orderNumber || order.id,
          handoverId: handoverRecord.id,
          userId: order.userId,
          ownerName: order.buyerName,
          ownerPhone: order.buyerPhone,
          vehicleId: order.vehicleId,
          vehicleName: order.vehicleName,
          fuel: ownership.fuel,
          image: order.img || order.image || (vehicle && vehicle.image) || 'assets/garage-car-detail.jpg',
          vin: cleanVin,
          motorNumber: handoverRecord.motorNumber,
          licensePlate: order.licensePlate || 'Chưa gắn biển số',
          invoiceNumber: order.invoiceNumber || `INV-${order.id}`,
          purchaseDate: startDate,
          activatedAt: actualHandoverIso,
          startDate,
          endDate,
          batteryEndDate,
          policyVersion: warrantyPolicy.version,
          maxKm: wRules.vehicleMaxKm,
          batteryMaxKm: wRules.batteryMaxKm || 0,
          currentOdoKm: cleanOdo,
          batteryHealthPercent: isEv ? null : null, // Wait for real diagnostic measurement instead of fabricating 100%
          nextMaintenanceKm: cleanOdo + 1000,
          nextMaintenanceDate: addYearsSafeIsoDate(startDate, 0).slice(0, 10),
          maintenanceStatus: 'Đang hoạt động',
          status: WARRANTY_STATUS.ACTIVE,
          scopeSummary: wRules.summary || warrantyPolicy.title,
          verifiedBy: `Kích hoạt tự động khi bàn giao ${handoverRecord.id}`
        };
        state.warranties.unshift(warranty);
      }

      NotificationService.enqueueOutboxInState(state, {
        eventType: 'handover_completed',
        aggregateType: 'handover',
        aggregateId: handoverRecord.id,
        userId: order.userId,
        templateId: 'handover_completed',
        payload: {
          orderId: order.orderNumber || order.id,
          buyerName: order.buyerName,
          vehicleName: order.vehicleName,
          vin: cleanVin
        },
        dedupeKey: `handover_completed:${order.id}`
      });

      return { handover: handoverRecord, ownership, warranty, order };
    });
  },

  listHandovers(user) {
    const all = dbState.handovers || [];
    if (!user) return [];
    if (user.role === ROLES.ADMIN) return [...all];
    if (Authorization.isStaffRole(user.role)) return all.filter(h => Authorization.hasBranchAccess(user, h.branchId));
    const userOrderIds = new Set((dbState.orders || []).filter(o => o.userId === user.userId).map(o => o.id));
    return all.filter(h => userOrderIds.has(h.orderId));
  }
};

module.exports = HandoverService;
