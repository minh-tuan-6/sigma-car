// backend/application/appointment-service.js
// Dynamic Slot Availability Engine, Future-Date/Home-Service Validation & Atomic Reschedule

const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const AppointmentRepository = require('../infrastructure/repositories/appointment-repository');
const Authorization = require('../domain/authorization');
const Security = require('../infrastructure/security');
const NotificationService = require('./notification-service');
const { SHOWROOM_BRANCHES, SERVICE_CENTERS, APPOINTMENT_STATUS, ROLES } = require('../domain/constants');

const TEST_DRIVE_SLOTS = [
  '08:30 - 09:30',
  '09:30 - 10:30',
  '11:00 - 12:00',
  '13:30 - 14:30',
  '15:00 - 16:00',
  '16:30 - 17:30'
];

const SERVICE_SLOTS = [
  '08:00 - 09:30',
  '09:30 - 11:00',
  '13:30 - 15:00',
  '15:00 - 16:30'
];

function createError(message, statusCode, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function getTodayIsoVn() {
  // UTC+7 date string YYYY-MM-DD
  const vnMs = Date.now() + 7 * 3600000;
  return new Date(vnMs).toISOString().slice(0, 10);
}

function validateBookingDate(dateStr) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(dateStr || '').trim());
  if (!m) {
    throw createError('Định dạng ngày hẹn không hợp lệ (yêu cầu YYYY-MM-DD).', 422, 'INVALID_DATE');
  }
  const clean = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const parsed = new Date(`${clean}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== clean) {
    throw createError(`Ngày hẹn "${clean}" không tồn tại.`, 422, 'INVALID_DATE');
  }
  const todayVn = getTodayIsoVn();
  if (clean < todayVn) {
    throw createError(`Không thể đặt lịch cho ngày trong quá khứ (${clean}).`, 422, 'PAST_DATE_NOT_ALLOWED');
  }
  return clean;
}

function normalizeDistrict(str) {
  return String(str || '').trim().toLowerCase().normalize('NFC');
}

const AppointmentService = {
  TEST_DRIVE_SLOTS,
  SERVICE_SLOTS,

  getAvailableSlots({ branchId, date, category = 'test_drive', capacity } = {}) {
    const cleanDate = validateBookingDate(date || getTodayIsoVn());
    const branch = SHOWROOM_BRANCHES.find(b => b.id === branchId) || SHOWROOM_BRANCHES[0];

    if (category === 'service') {
      const center = SERVICE_CENTERS.find(c => c.id === branch.id) || SERVICE_CENTERS[0];
      const maxCap = Math.max(1, Number(capacity || center.baysCount || 4));
      return {
        branchId: center.id,
        branchName: center.name,
        date: cleanDate,
        timezone: 'Asia/Ho_Chi_Minh',
        category: 'service',
        slots: SERVICE_SLOTS.map(slot => {
          const bookedCount = (dbState.serviceAppointments || []).filter(a =>
            a.serviceCenterId === center.id &&
            a.preferredDate === cleanDate &&
            a.timeSlot === slot &&
            ![APPOINTMENT_STATUS.CANCELLED, APPOINTMENT_STATUS.NO_SHOW].includes(a.status)
          ).length;
          return {
            timeSlot: slot,
            capacity: maxCap,
            bookedCount,
            remainingCapacity: Math.max(0, maxCap - bookedCount),
            isAvailable: bookedCount < maxCap
          };
        })
      };
    }

    const slotCapacity = Math.max(1, Number(capacity || 1));
    return {
      branchId: branch.id,
      branchName: branch.name,
      date: cleanDate,
      timezone: 'Asia/Ho_Chi_Minh',
      category: 'test_drive',
      homeServiceDistricts: branch.homeServiceDistricts || [],
      slots: TEST_DRIVE_SLOTS.map(slot => {
        const bookedCount = (dbState.appointments || []).filter(a =>
          a.branchId === branch.id &&
          a.preferredDate === cleanDate &&
          a.timeSlot === slot &&
          [APPOINTMENT_STATUS.PENDING, APPOINTMENT_STATUS.CONFIRMED].includes(a.status)
        ).length;
        return {
          timeSlot: slot,
          capacity: slotCapacity,
          bookedCount,
          remainingCapacity: Math.max(0, slotCapacity - bookedCount),
          isAvailable: bookedCount < slotCapacity
        };
      })
    };
  },

  async createTestDriveAppointment(user, body = {}) {
    if (!body.customerName || !(body.phone || body.customerPhone)) {
      throw createError('Vui lòng nhập đầy đủ họ tên và số điện thoại liên hệ.', 400, 'VALIDATION_ERROR');
    }
    const cleanDate = validateBookingDate(body.preferredDate || body.date);
    const branch = SHOWROOM_BRANCHES.find(b => b.id === (body.branchId || 'hn-caugiay')) || SHOWROOM_BRANCHES[0];

    const slot = String(body.timeSlot || '14:30 - 15:30').trim();
    if (!slot) {
      throw createError('Vui lòng chọn khung giờ lái thử hợp lệ.', 422, 'INVALID_TIME_SLOT');
    }

    const isHomeService = Boolean(body.isHomeService);
    const district = Security.sanitizeString(body.district || '');
    const homeAddress = Security.sanitizeString(body.homeAddress || '');

    if (isHomeService) {
      if (homeAddress.length < 8) {
        throw createError('Vui lòng nhập địa chỉ giao xe lái thử tận nơi tối thiểu 8 ký tự.', 422, 'INVALID_HOME_ADDRESS');
      }
      const allowedDistricts = (branch.homeServiceDistricts || []).map(normalizeDistrict);
      if (!district || !allowedDistricts.includes(normalizeDistrict(district))) {
        throw createError(
          `Quận/Huyện "${district || 'chưa chọn'}" hiện nằm ngoài phạm vi lái thử tận nơi của ${branch.name} (${(branch.homeServiceDistricts || []).join(', ')}).`,
          422,
          'HOME_SERVICE_OUTSIDE_AREA'
        );
      }
    }

    let resolvedCarName = Security.sanitizeString(body.carName || body.vehicleModel || '');
    let resolvedVehicleId = body.vehicleId || null;
    if (resolvedVehicleId) {
      const v = (dbState.vehicles || []).find(x => x.id === resolvedVehicleId) ||
        (dbState.certifiedVehicles || []).find(x => x.id === resolvedVehicleId);
      if (!v) {
        throw createError(`Không tìm thấy mẫu xe "${resolvedVehicleId}" trong danh mục.`, 404, 'VEHICLE_NOT_FOUND');
      }
      resolvedCarName = v.name;
    }

    return AppointmentRepository.create({
      userId: user ? user.userId : null,
      customerName: Security.sanitizeString(body.customerName),
      phone: Security.sanitizeString(body.phone || body.customerPhone),
      email: Security.sanitizeString(body.email || body.customerEmail || ''),
      carName: resolvedCarName,
      vehicleId: resolvedVehicleId,
      branchId: branch.id,
      branchName: branch.name,
      preferredDate: cleanDate,
      timeSlot: slot,
      isHomeService,
      homeAddress,
      district,
      slotCapacity: Number(body.slotCapacity || 1)
    });
  },

  async rescheduleAppointment(user, apptId, { preferredDate, timeSlot, note = '' } = {}) {
    if (!user || !user.userId) {
      throw createError('Vui lòng đăng nhập để đổi lịch hẹn.', 401, 'UNAUTHORIZED');
    }
    const cleanDate = validateBookingDate(preferredDate);
    const cleanSlot = String(timeSlot || '').trim();
    if (!cleanSlot) {
      throw createError('Vui lòng chọn khung giờ mới.', 422, 'INVALID_TIME_SLOT');
    }

    return runInTransaction(async (state) => {
      const appt = state.appointments.find(a => a.id === apptId);
      if (!appt) {
        throw createError(`Không tìm thấy lịch hẹn "${apptId}".`, 404, 'NOT_FOUND');
      }
      if (!Authorization.canMutateAppointment(user, appt)) {
        throw createError('Bạn không có quyền đổi lịch hẹn này.', 403, 'FORBIDDEN');
      }
      if ([APPOINTMENT_STATUS.COMPLETED, APPOINTMENT_STATUS.CANCELLED, APPOINTMENT_STATUS.NO_SHOW].includes(appt.status)) {
        throw createError(`Lịch hẹn ở trạng thái "${appt.status}" không thể đổi giờ.`, 409, 'TERMINAL_APPOINTMENT_STATE');
      }

      const conflict = state.appointments.find(a =>
        a.id !== appt.id &&
        a.branchId === appt.branchId &&
        a.preferredDate === cleanDate &&
        a.timeSlot === cleanSlot &&
        [APPOINTMENT_STATUS.PENDING, APPOINTMENT_STATUS.CONFIRMED].includes(a.status)
      );
      if (conflict) {
        throw createError(`Khung giờ "${cleanSlot}" ngày ${cleanDate} đã có người đặt trước.`, 409, 'SLOT_CONFLICT');
      }

      const prev = `${appt.preferredDate} (${appt.timeSlot})`;
      const nowIso = new Date().toISOString();
      appt.preferredDate = cleanDate;
      appt.timeSlot = cleanSlot;
      appt.version = (appt.version || 1) + 1;
      appt.updatedAt = nowIso;
      if (!Array.isArray(appt.history)) appt.history = [];
      appt.history.push({
        status: appt.status,
        preferredDate: cleanDate,
        timeSlot: cleanSlot,
        actorId: user.userId,
        timestamp: nowIso,
        note: Security.sanitizeString(note || `Đổi lịch từ ${prev} sang ${cleanDate} (${cleanSlot})`)
      });

      NotificationService.enqueueOutboxInState(state, {
        eventType: 'appointment_rescheduled',
        aggregateType: 'appointment',
        aggregateId: appt.id,
        userId: appt.userId,
        recipientEmail: appt.email,
        recipientPhone: appt.phone,
        templateId: 'appointment_rescheduled',
        payload: {
          appointmentId: appt.id,
          carName: appt.carName,
          preferredDate: cleanDate,
          timeSlot: cleanSlot
        },
        dedupeKey: `appt_rescheduled:${appt.id}:v${appt.version}`
      });

      return appt;
    });
  }
};

module.exports = AppointmentService;
