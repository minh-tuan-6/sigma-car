// backend/application/workshop-service.js
// Service Centers, Bays, Technician Schedules, Workshop Jobs & Genuine Parts Ledger (SIG-P4-001, SIG-P4-002)

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const ServiceRepository = require('../infrastructure/repositories/service-repository');
const Security = require('../infrastructure/security');
const { ROLES } = require('../domain/constants');

function createError(message, statusCode = 400, code = 'WORKSHOP_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function getAllowedBranchIds(user) {
  if (!user) return [];
  if (user.role === ROLES.ADMIN) return null; // unrestricted
  const list = Array.isArray(user.branchIds) && user.branchIds.length > 0
    ? user.branchIds.filter(Boolean)
    : (user.branchId && user.branchId !== 'all' ? [user.branchId] : []);
  return list;
}

function assertStaffCenterScope(user, center) {
  if (!user || ![ROLES.ADMIN, ROLES.SELLER, ROLES.SERVICE_STAFF].includes(user.role)) {
    throw createError('Chỉ Quản trị viên, Quản lý Xưởng hoặc Kỹ thuật viên mới có quyền thao tác này.', 403, 'FORBIDDEN');
  }
  const allowed = getAllowedBranchIds(user);
  if (allowed !== null) {
    if (allowed.length === 0 || !center || !allowed.includes(center.branchId)) {
      throw createError('Bạn không có quyền thao tác trên xưởng dịch vụ thuộc chi nhánh khác.', 403, 'BRANCH_SCOPE_DENIED');
    }
  }
}

function normalizeFiniteNonNeg(val, label) {
  if (val === undefined || val === null || val === '') return 0;
  const num = Number(val);
  if (typeof val === 'boolean' || !Number.isFinite(num) || num < 0) {
    throw createError(`Giá trị "${label}" phải là số hợp lệ >= 0.`, 422, 'INVALID_COST');
  }
  return Math.round(num);
}

const WorkshopService = {
  listResources(user = null, query = {}) {
    ServiceRepository.ensureInitialized(dbState);
    let centers = (dbState.serviceCenters || []).filter(c => c.active !== false);
    if (query.branchId && query.branchId !== 'all') {
      centers = centers.filter(c => c.branchId === query.branchId);
    }
    const centerIds = new Set(centers.map(c => c.id));
    const bays = (dbState.serviceBays || []).filter(b => centerIds.has(b.serviceCenterId) && b.active !== false);
    const technicians = (dbState.technicians || []).filter(t => centerIds.has(t.serviceCenterId) && t.active !== false);
    const parts = (dbState.partsLedger || []).map(p => ({
      ...p,
      availableStock: Math.max(0, (p.stockOnHand || 0) - (p.stockReserved || 0))
    }));
    return { centers, bays, technicians, parts };
  },

  getScheduleAvailability({ serviceCenterId, date } = {}) {
    ServiceRepository.ensureInitialized(dbState);
    const center = (dbState.serviceCenters || []).find(c => c.id === serviceCenterId);
    if (!center) throw createError('Không tìm thấy trung tâm dịch vụ.', 404, 'CENTER_NOT_FOUND');
    const cleanDate = String(date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const bays = (dbState.serviceBays || []).filter(b => b.serviceCenterId === center.id && b.active !== false);
    const technicians = (dbState.technicians || []).filter(t => t.serviceCenterId === center.id && t.active !== false);
    const activeJobs = (dbState.workshopJobs || []).filter(j =>
      j.serviceCenterId === center.id &&
      j.scheduledDate === cleanDate &&
      ['Scheduled', 'In_Progress'].includes(j.status)
    );

    const slots = ['08:30', '10:30', '13:30', '15:30'];
    const schedule = slots.map(slot => {
      const slotJobs = activeJobs.filter(j => j.timeSlot === slot);
      const busyBayIds = new Set(slotJobs.map(j => j.bayId));
      const busyTechIds = new Set(slotJobs.map(j => j.technicianId));
      const freeBays = bays.filter(b => !busyBayIds.has(b.id));
      const freeTechs = technicians.filter(t => !busyTechIds.has(t.id));
      return {
        timeSlot: slot,
        freeBayCount: freeBays.length,
        freeTechCount: freeTechs.length,
        availableCapacity: Math.min(freeBays.length, freeTechs.length),
        freeBays: freeBays.map(b => ({ id: b.id, name: b.name, bayType: b.bayType })),
        freeTechnicians: freeTechs.map(t => ({ id: t.id, fullName: t.fullName, specialty: t.specialty }))
      };
    });

    return { serviceCenter: center, date: cleanDate, schedule };
  },

  async upsertCenterOrBayOrTech(user, kind, payload = {}) {
    if (!user || ![ROLES.ADMIN, ROLES.SELLER, ROLES.SERVICE_STAFF].includes(user.role)) {
      throw createError('Không có quyền quản lý tài nguyên xưởng dịch vụ.', 403, 'FORBIDDEN');
    }
    return runInTransaction(async (state) => {
      ServiceRepository.ensureInitialized(state);
      if (kind === 'center') {
        if (user.role !== ROLES.ADMIN) {
          throw createError('Chỉ Quản trị viên mới có quyền tạo/cập nhật trung tâm dịch vụ.', 403, 'FORBIDDEN');
        }
        const id = String(payload.id || `sc-${crypto.randomUUID().slice(0, 6)}`).trim();
        const existing = state.serviceCenters.find(c => c.id === id);
        if (existing) {
          if (payload.name) existing.name = Security.sanitizeString(payload.name);
          if (payload.address) existing.address = Security.sanitizeString(payload.address);
          if (payload.phone) existing.phone = Security.sanitizeString(payload.phone);
          return existing;
        }
        if (!payload.branchId || !payload.name || !payload.address) {
          throw createError('Thiếu branchId, name hoặc address của trung tâm dịch vụ.', 422, 'MISSING_FIELD');
        }
        const created = {
          id,
          branchId: Security.sanitizeString(payload.branchId),
          name: Security.sanitizeString(payload.name),
          address: Security.sanitizeString(payload.address),
          city: Security.sanitizeString(payload.city || 'Việt Nam'),
          phone: Security.sanitizeString(payload.phone || ''),
          bayCount: Math.max(1, Number(payload.bayCount || 2)),
          active: true
        };
        state.serviceCenters.push(created);
        return created;
      }

      const center = state.serviceCenters.find(c => c.id === payload.serviceCenterId);
      assertStaffCenterScope(user, center);

      if (kind === 'bay') {
        if (!payload.name) throw createError('Vui lòng nhập tên khoang dịch vụ.', 422, 'MISSING_FIELD');
        const created = {
          id: payload.id || `${center.id}-bay-${crypto.randomUUID().slice(0, 4)}`,
          serviceCenterId: center.id,
          name: Security.sanitizeString(payload.name),
          bayType: Security.sanitizeString(payload.bayType || 'general'),
          active: payload.active !== false
        };
        state.serviceBays.push(created);
        return created;
      }

      if (kind === 'technician') {
        if (!payload.fullName) throw createError('Vui lòng nhập họ tên kỹ thuật viên.', 422, 'MISSING_FIELD');
        const created = {
          id: payload.id || `tech-${crypto.randomUUID().slice(0, 6)}`,
          serviceCenterId: center.id,
          fullName: Security.sanitizeString(payload.fullName),
          specialty: Security.sanitizeString(payload.specialty || 'ev_high_voltage'),
          active: payload.active !== false
        };
        state.technicians.push(created);
        return created;
      }

      throw createError('Loại tài nguyên không hợp lệ.', 400, 'INVALID_RESOURCE_KIND');
    });
  },

  listJobs(user, query = {}) {
    if (!user) throw createError('Vui lòng đăng nhập.', 401, 'UNAUTHORIZED');
    ServiceRepository.ensureInitialized(dbState);
    let jobs = [...(dbState.workshopJobs || [])];

    if (user.role === ROLES.BUYER) {
      jobs = jobs.filter(j => j.userId === user.userId);
    } else if (user.role !== ROLES.ADMIN) {
      const allowed = getAllowedBranchIds(user) || [];
      const allowedCenterIds = new Set(
        (dbState.serviceCenters || []).filter(c => allowed.includes(c.branchId)).map(c => c.id)
      );
      jobs = jobs.filter(j => allowedCenterIds.has(j.serviceCenterId));
    }

    if (query.serviceCenterId && query.serviceCenterId !== 'all') {
      jobs = jobs.filter(j => j.serviceCenterId === query.serviceCenterId);
    }
    if (query.date) {
      jobs = jobs.filter(j => j.scheduledDate === String(query.date).slice(0, 10));
    }
    if (query.status && query.status !== 'all') {
      jobs = jobs.filter(j => j.status === query.status);
    }

    return jobs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  },

  async createJob(user, payload = {}) {
    if (!user || !user.userId) throw createError('Vui lòng đăng nhập.', 401, 'UNAUTHORIZED');
    const {
      serviceCenterId,
      bayId,
      technicianId,
      vin,
      scheduledDate,
      timeSlot,
      serviceType,
      laborItems = [],
      partsRequested = [],
      notes = ''
    } = payload;

    if (!serviceCenterId || !vin || !scheduledDate || !timeSlot || !serviceType) {
      throw createError('Vui lòng cung cấp trung tâm, số khung VIN, ngày hẹn, khung giờ và hạng mục dịch vụ.', 422, 'MISSING_FIELD');
    }

    const cleanVin = String(vin).trim().toUpperCase();
    const cleanDate = String(scheduledDate).trim().slice(0, 10);
    const cleanSlot = String(timeSlot).trim();

    return runInTransaction(async (state) => {
      ServiceRepository.ensureInitialized(state);
      const center = state.serviceCenters.find(c => c.id === serviceCenterId && c.active !== false);
      if (!center) throw createError('Trung tâm dịch vụ không tồn tại hoặc đang ngừng hoạt động.', 404, 'CENTER_NOT_FOUND');

      if ([ROLES.SELLER, ROLES.SERVICE_STAFF].includes(user.role)) {
        assertStaffCenterScope(user, center);
      }

      // Resolve vehicle owner by VIN
      const warranty = (state.warranties || []).find(w => (w.vin || '').toUpperCase() === cleanVin) || null;
      const ownership = (state.vehicleOwnerships || []).find(o => (o.vin || '').toUpperCase() === cleanVin) || null;
      const order = (state.orders || []).find(o => (o.vin || '').toUpperCase() === cleanVin) || null;
      const ownerId = (warranty && warranty.userId) || (ownership && ownership.userId) || (order && order.userId) || null;

      if (!ownerId) {
        throw createError(`Không tìm thấy xe hợp lệ với số khung VIN "${cleanVin}".`, 404, 'VIN_NOT_FOUND');
      }
      if (user.role === ROLES.BUYER && ownerId !== user.userId) {
        throw createError('Bạn không thể tạo lệnh sửa chữa cho số VIN thuộc tài khoản khác.', 403, 'FORBIDDEN');
      }

      const vehicleId = (warranty && warranty.vehicleId) || (ownership && ownership.vehicleId) || (order && order.vehicleId) || null;
      const vehicleObj = (state.vehicles || []).find(v => v.id === vehicleId) ||
        (state.certifiedVehicles || []).find(v => v.id === vehicleId) || null;
      const vehicleFuel = String((vehicleObj && vehicleObj.fuel) || 'ev').toLowerCase();

      // Resolve bay & technician belonging to center and free at (cleanDate, cleanSlot)
      const activeSlotJobs = state.workshopJobs.filter(j =>
        j.serviceCenterId === center.id &&
        j.scheduledDate === cleanDate &&
        j.timeSlot === cleanSlot &&
        ['Scheduled', 'In_Progress'].includes(j.status)
      );

      let chosenBay = null;
      if (bayId) {
        chosenBay = state.serviceBays.find(b => b.id === bayId && b.serviceCenterId === center.id && b.active !== false);
        if (!chosenBay) throw createError('Khoang dịch vụ không thuộc trung tâm đã chọn.', 404, 'BAY_NOT_FOUND');
        if (activeSlotJobs.some(j => j.bayId === chosenBay.id)) {
          throw createError(`Khoang "${chosenBay.name}" đã có lịch vào lúc ${cleanSlot} ngày ${cleanDate}.`, 409, 'BAY_CONFLICT');
        }
      } else {
        chosenBay = state.serviceBays.find(b =>
          b.serviceCenterId === center.id && b.active !== false && !activeSlotJobs.some(j => j.bayId === b.id)
        );
        if (!chosenBay) {
          throw createError(`Trung tâm ${center.name} đã hết khoang trống vào lúc ${cleanSlot} ngày ${cleanDate}.`, 409, 'BAY_CONFLICT');
        }
      }

      let chosenTech = null;
      if (technicianId) {
        chosenTech = state.technicians.find(t => t.id === technicianId && t.serviceCenterId === center.id && t.active !== false);
        if (!chosenTech) throw createError('Kỹ thuật viên không thuộc trung tâm đã chọn.', 404, 'TECH_NOT_FOUND');
        if (activeSlotJobs.some(j => j.technicianId === chosenTech.id)) {
          throw createError(`Kỹ thuật viên "${chosenTech.fullName}" đã bận vào lúc ${cleanSlot} ngày ${cleanDate}.`, 409, 'TECH_CONFLICT');
        }
      } else {
        chosenTech = state.technicians.find(t =>
          t.serviceCenterId === center.id && t.active !== false && !activeSlotJobs.some(j => j.technicianId === t.id)
        );
        if (!chosenTech) {
          throw createError(`Không còn kỹ thuật viên trống vào lúc ${cleanSlot} ngày ${cleanDate}.`, 409, 'TECH_CONFLICT');
        }
      }

      // Compute labor line items
      const normalizedLabor = (Array.isArray(laborItems) ? laborItems : []).map((li, idx) => {
        const fee = normalizeFiniteNonNeg(li.amount ?? li.unitPrice ?? 0, `Phí nhân công dòng #${idx + 1}`);
        return {
          title: Security.sanitizeString(li.title || li.description || serviceType),
          amount: fee
        };
      });
      if (normalizedLabor.length === 0 && payload.laborCost !== undefined) {
        normalizedLabor.push({
          title: Security.sanitizeString(serviceType),
          amount: normalizeFiniteNonNeg(payload.laborCost, 'Chi phí nhân công')
        });
      }
      const laborCost = normalizedLabor.reduce((s, li) => s + li.amount, 0);

      // Reserve compatible parts atomically inside transaction
      const reservedParts = [];
      for (const reqPart of (Array.isArray(partsRequested) ? partsRequested : [])) {
        const sku = String(reqPart.sku || '').trim();
        const qty = Number(reqPart.quantity ?? 1);
        if (!sku || !Number.isInteger(qty) || qty < 1 || qty > 50) {
          throw createError(`Số lượng phụ tùng "${sku}" phải là số nguyên từ 1 đến 50.`, 422, 'INVALID_PART_QUANTITY');
        }
        const ledgerPart = state.partsLedger.find(p => p.sku === sku);
        if (!ledgerPart) {
          throw createError(`Không tìm thấy mã phụ tùng "${sku}" trong kho xưởng.`, 404, 'PART_NOT_FOUND');
        }
        if (Array.isArray(ledgerPart.compatibleFuels) && ledgerPart.compatibleFuels.length > 0 && !ledgerPart.compatibleFuels.includes(vehicleFuel)) {
          throw createError(`Phụ tùng "${ledgerPart.name}" không tương thích với xe hệ truyền động ${vehicleFuel.toUpperCase()}.`, 422, 'INCOMPATIBLE_PART');
        }
        if (Array.isArray(ledgerPart.compatibleVehicleIds) && ledgerPart.compatibleVehicleIds.length > 0 && vehicleId && !ledgerPart.compatibleVehicleIds.includes(vehicleId)) {
          throw createError(`Phụ tùng "${ledgerPart.name}" không dành cho dòng xe này.`, 422, 'INCOMPATIBLE_PART');
        }
        const available = Math.max(0, (ledgerPart.stockOnHand || 0) - (ledgerPart.stockReserved || 0));
        if (qty > available) {
          throw createError(`Phụ tùng "${ledgerPart.name}" chỉ còn ${available} chiếc khả dụng trong kho (yêu cầu ${qty}).`, 409, 'INSUFFICIENT_PART_STOCK');
        }
        ledgerPart.stockReserved = (ledgerPart.stockReserved || 0) + qty;
        ledgerPart.updatedAt = new Date().toISOString();
        reservedParts.push({
          sku: ledgerPart.sku,
          name: ledgerPart.name,
          quantity: qty,
          unitPrice: ledgerPart.unitPrice,
          lineTotal: ledgerPart.unitPrice * qty,
          reservationStatus: 'reserved'
        });
      }

      const partsCost = reservedParts.reduce((s, p) => s + p.lineTotal, 0);
      const totalCost = laborCost + partsCost;
      const nowIso = new Date().toISOString();
      const jobId = `JOB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

      const job = {
        id: jobId,
        jobCode: `WL-${cleanDate.replace(/-/g, '')}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
        serviceCenterId: center.id,
        serviceCenterName: center.name,
        branchId: center.branchId,
        bayId: chosenBay.id,
        bayName: chosenBay.name,
        technicianId: chosenTech.id,
        technicianName: chosenTech.fullName,
        userId: ownerId,
        vehicleId,
        vehicleName: (vehicleObj && vehicleObj.name) || (warranty && warranty.vehicleName) || 'Xe SIGMACAR',
        vin: cleanVin,
        scheduledDate: cleanDate,
        timeSlot: cleanSlot,
        serviceType: Security.sanitizeString(serviceType),
        status: 'Scheduled',
        laborItems: normalizedLabor,
        partsLines: reservedParts,
        laborCost,
        partsCost,
        totalCost,
        notes: Security.sanitizeString(notes),
        invoiceSnapshot: null,
        serviceRecordId: null,
        createdBy: user.userId,
        createdAt: nowIso,
        updatedAt: nowIso
      };

      state.workshopJobs.unshift(job);
      state.jobEvents.unshift({
        id: `JEVT-${crypto.randomUUID().slice(0, 8)}`,
        jobId: job.id,
        type: 'JOB_CREATED',
        actorId: user.userId,
        detail: `Tạo lệnh xưởng ${job.jobCode} tại ${chosenBay.name}, KTV ${chosenTech.fullName} (${cleanDate} ${cleanSlot}).`,
        createdAt: nowIso
      });
      return job;
    });
  },

  async reassignJob(staffUser, jobId, payload = {}) {
    return runInTransaction(async (state) => {
      ServiceRepository.ensureInitialized(state);
      const job = state.workshopJobs.find(j => j.id === jobId);
      if (!job) throw createError('Không tìm thấy lệnh dịch vụ xưởng.', 404, 'JOB_NOT_FOUND');
      const center = state.serviceCenters.find(c => c.id === job.serviceCenterId);
      assertStaffCenterScope(staffUser, center);
      if (!['Scheduled', 'In_Progress'].includes(job.status)) {
        throw createError(`Không thể điều phối lại lệnh đã ở trạng thái "${job.status}".`, 409, 'INVALID_JOB_STATE');
      }

      const nextDate = payload.scheduledDate ? String(payload.scheduledDate).slice(0, 10) : job.scheduledDate;
      const nextSlot = payload.timeSlot ? String(payload.timeSlot).trim() : job.timeSlot;
      const nextBayId = payload.bayId || job.bayId;
      const nextTechId = payload.technicianId || job.technicianId;

      const bay = state.serviceBays.find(b => b.id === nextBayId && b.serviceCenterId === job.serviceCenterId && b.active !== false);
      if (!bay) throw createError('Khoang dịch vụ đích không hợp lệ.', 404, 'BAY_NOT_FOUND');
      const tech = state.technicians.find(t => t.id === nextTechId && t.serviceCenterId === job.serviceCenterId && t.active !== false);
      if (!tech) throw createError('Kỹ thuật viên đích không hợp lệ.', 404, 'TECH_NOT_FOUND');

      const collisions = state.workshopJobs.filter(j =>
        j.id !== job.id &&
        j.serviceCenterId === job.serviceCenterId &&
        j.scheduledDate === nextDate &&
        j.timeSlot === nextSlot &&
        ['Scheduled', 'In_Progress'].includes(j.status)
      );
      if (collisions.some(j => j.bayId === bay.id)) {
        throw createError(`Khoang "${bay.name}" đã bị chiếm vào ${nextSlot} ngày ${nextDate}.`, 409, 'BAY_CONFLICT');
      }
      if (collisions.some(j => j.technicianId === tech.id)) {
        throw createError(`Kỹ thuật viên "${tech.fullName}" đã có lịch vào ${nextSlot} ngày ${nextDate}.`, 409, 'TECH_CONFLICT');
      }

      job.scheduledDate = nextDate;
      job.timeSlot = nextSlot;
      job.bayId = bay.id;
      job.bayName = bay.name;
      job.technicianId = tech.id;
      job.technicianName = tech.fullName;
      job.updatedAt = new Date().toISOString();

      state.jobEvents.unshift({
        id: `JEVT-${crypto.randomUUID().slice(0, 8)}`,
        jobId: job.id,
        type: 'JOB_REASSIGNED',
        actorId: staffUser.userId,
        detail: `Điều phối sang ${bay.name} / ${tech.fullName} lúc ${nextSlot} ngày ${nextDate}.`,
        createdAt: job.updatedAt
      });
      return job;
    });
  },

  async cancelJob(user, jobId, reason = '') {
    if (!user) throw createError('Vui lòng đăng nhập.', 401, 'UNAUTHORIZED');
    return runInTransaction(async (state) => {
      ServiceRepository.ensureInitialized(state);
      const job = state.workshopJobs.find(j => j.id === jobId);
      if (!job) throw createError('Không tìm thấy lệnh dịch vụ.', 404, 'JOB_NOT_FOUND');

      if (user.role === ROLES.BUYER) {
        if (job.userId !== user.userId) throw createError('Không có quyền hủy lịch của người dùng khác.', 403, 'FORBIDDEN');
      } else {
        const center = state.serviceCenters.find(c => c.id === job.serviceCenterId);
        assertStaffCenterScope(user, center);
      }

      if (job.status === 'Cancelled' || job.status === 'Completed') {
        throw createError(`Không thể hủy lệnh đang ở trạng thái "${job.status}".`, 409, 'INVALID_JOB_STATE');
      }

      // Release reserved parts atomically
      for (const pLine of (job.partsLines || [])) {
        if (pLine.reservationStatus === 'reserved') {
          const ledger = state.partsLedger.find(p => p.sku === pLine.sku);
          if (ledger) {
            ledger.stockReserved = Math.max(0, (ledger.stockReserved || 0) - pLine.quantity);
            ledger.updatedAt = new Date().toISOString();
          }
          pLine.reservationStatus = 'released';
        }
      }

      job.status = 'Cancelled';
      job.updatedAt = new Date().toISOString();
      state.jobEvents.unshift({
        id: `JEVT-${crypto.randomUUID().slice(0, 8)}`,
        jobId: job.id,
        type: 'JOB_CANCELLED',
        actorId: user.userId,
        detail: `Hủy lệnh xưởng ${job.jobCode} & hoàn trả tồn kho phụ tùng giữ chỗ. Lý do: ${Security.sanitizeString(reason || 'Yêu cầu hủy lịch')}`,
        createdAt: job.updatedAt
      });
      return job;
    });
  },

  async completeJob(staffUser, jobId, payload = {}) {
    return runInTransaction(async (state) => {
      ServiceRepository.ensureInitialized(state);
      const job = state.workshopJobs.find(j => j.id === jobId);
      if (!job) throw createError('Không tìm thấy lệnh dịch vụ xưởng.', 404, 'JOB_NOT_FOUND');
      const center = state.serviceCenters.find(c => c.id === job.serviceCenterId);
      assertStaffCenterScope(staffUser, center);

      if (job.status === 'Completed') {
        throw createError('Lệnh dịch vụ này đã được hoàn tất và xuất hóa đơn trước đó (chặn trừ kho 2 lần).', 409, 'JOB_ALREADY_COMPLETED');
      }
      if (job.status === 'Cancelled') {
        throw createError('Không thể hoàn tất lệnh dịch vụ đã hủy.', 409, 'INVALID_JOB_STATE');
      }

      const warranty = (state.warranties || []).find(w => (w.vin || '').toUpperCase() === job.vin) || null;
      const linkedOrder = !warranty ? (state.orders || []).find(o => (o.vin || '').toUpperCase() === job.vin) : null;
      const prevOdo = warranty ? Number(warranty.currentOdoKm || 0) : Number((linkedOrder && linkedOrder.handoverOdoKm) || 0);
      const nextOdo = payload.odoKm !== undefined && payload.odoKm !== null && payload.odoKm !== ''
        ? Number(payload.odoKm)
        : prevOdo;
      if (!Number.isFinite(nextOdo) || nextOdo < 0 || nextOdo < prevOdo) {
        throw createError(`Số ODO mới (${nextOdo} km) không được nhỏ hơn ODO trước đó (${prevOdo} km).`, 422, 'INVALID_ODO_REGRESSION');
      }

      // Consume reserved parts atomically
      for (const pLine of (job.partsLines || [])) {
        if (pLine.reservationStatus === 'reserved') {
          const ledger = state.partsLedger.find(p => p.sku === pLine.sku);
          if (!ledger || ledger.stockOnHand < pLine.quantity) {
            throw createError(`Kho phụ tùng "${pLine.name}" không đủ số lượng thực tế để xuất kho.`, 409, 'INSUFFICIENT_PART_STOCK');
          }
          ledger.stockOnHand = Math.max(0, ledger.stockOnHand - pLine.quantity);
          ledger.stockReserved = Math.max(0, (ledger.stockReserved || 0) - pLine.quantity);
          ledger.updatedAt = new Date().toISOString();
          pLine.reservationStatus = 'consumed';
        }
      }

      const nowIso = new Date().toISOString();
      const computedPartsCost = (job.partsLines || []).reduce((s, p) => s + p.lineTotal, 0);
      const computedLaborCost = (job.laborItems || []).reduce((s, li) => s + li.amount, 0);
      const computedTotal = computedLaborCost + computedPartsCost;

      const invoiceCode = `HD-DV-${nowIso.slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
      const invoiceSnapshot = {
        invoiceCode,
        issuedAt: nowIso,
        jobCode: job.jobCode,
        vin: job.vin,
        serviceCenterId: job.serviceCenterId,
        serviceCenterName: job.serviceCenterName,
        technicianName: job.technicianName,
        laborItems: job.laborItems,
        partsLines: job.partsLines,
        laborCost: computedLaborCost,
        partsCost: computedPartsCost,
        totalCost: computedTotal
      };

      const srvRecord = {
        id: `SRV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        jobId: job.id,
        warrantyId: warranty ? warranty.id : null,
        userId: job.userId,
        vehicleId: job.vehicleId,
        vehicleName: job.vehicleName,
        vin: job.vin,
        licensePlate: (warranty && warranty.licensePlate) || 'Chưa cập nhật',
        serviceDate: nowIso.slice(0, 10),
        odoKm: nextOdo,
        serviceType: job.serviceType,
        serviceCenterId: job.serviceCenterId,
        serviceCenterName: job.serviceCenterName,
        technicianName: job.technicianName,
        itemsPerformed: (job.laborItems || []).map(l => l.title),
        partsReplaced: (job.partsLines || []).map(p => `${p.name} (x${p.quantity})`),
        inspectionResult: Security.sanitizeString(payload.inspectionResult || 'Hoạt động ổn định, đạt chuẩn xuất xưởng SIGMACAR'),
        laborCost: computedLaborCost,
        partsCost: computedPartsCost,
        totalCost: computedTotal,
        invoiceCode,
        status: 'Hoàn thành'
      };

      if (!Array.isArray(state.serviceRecords)) state.serviceRecords = [];
      state.serviceRecords.unshift(srvRecord);

      if (warranty) {
        if (nextOdo > (warranty.currentOdoKm || 0)) warranty.currentOdoKm = nextOdo;
        if (payload.batteryHealthPercent !== undefined && payload.batteryHealthPercent !== null) {
          const soh = Number(payload.batteryHealthPercent);
          if (Number.isFinite(soh) && soh >= 30 && soh <= 100) {
            warranty.batteryHealthPercent = soh;
          }
        }
      }

      job.status = 'Completed';
      job.laborCost = computedLaborCost;
      job.partsCost = computedPartsCost;
      job.totalCost = computedTotal;
      job.invoiceSnapshot = invoiceSnapshot;
      job.serviceRecordId = srvRecord.id;
      job.updatedAt = nowIso;

      state.jobEvents.unshift({
        id: `JEVT-${crypto.randomUUID().slice(0, 8)}`,
        jobId: job.id,
        type: 'JOB_COMPLETED',
        actorId: staffUser.userId,
        detail: `Hoàn tất lệnh ${job.jobCode} — Hóa đơn ${invoiceCode} (${computedTotal.toLocaleString('vi-VN')} VNĐ).`,
        createdAt: nowIso
      });

      return { job, serviceRecord: srvRecord, invoiceSnapshot };
    });
  },

  getWorkshopStatusSummary() {
    ServiceRepository.ensureInitialized(dbState);
    const today = new Date().toISOString().slice(0, 10);
    const centers = (dbState.serviceCenters || []).map(c => {
      const totalBays = (dbState.serviceBays || []).filter(b => b.serviceCenterId === c.id && b.active !== false).length;
      const busyNow = (dbState.workshopJobs || []).filter(j =>
        j.serviceCenterId === c.id && j.scheduledDate === today && ['Scheduled', 'In_Progress'].includes(j.status)
      ).length;
      return {
        centerId: c.id,
        centerName: c.name,
        totalBays,
        busyTodayJobs: busyNow,
        availableBaysEstimate: Math.max(0, totalBays - Math.min(totalBays, busyNow))
      };
    });
    const lowStockParts = (dbState.partsLedger || [])
      .filter(p => (p.stockOnHand - p.stockReserved) <= 5)
      .map(p => ({ sku: p.sku, name: p.name, available: Math.max(0, p.stockOnHand - p.stockReserved) }));
    return {
      centers,
      lowStockParts,
      totalActiveJobs: (dbState.workshopJobs || []).filter(j => ['Scheduled', 'In_Progress'].includes(j.status)).length
    };
  }
};

module.exports = WorkshopService;
