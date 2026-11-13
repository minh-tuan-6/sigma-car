// backend/infrastructure/repositories/appointment-repository.js
// AppointmentRepository with slot capacity avoidance, fail-closed branch isolation, unique crypto IDs & transactional outbox

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../storage-engine');
const { APPOINTMENT_STATUS, ROLES } = require('../../domain/constants');
const { canUserTransitionAppointment } = require('../../domain/state-machines');
const Authorization = require('../../domain/authorization');
const NotificationService = require('../../application/notification-service');

const AppointmentRepository = {
  async findById(id) {
    return dbState.appointments.find(a => a.id === id) || null;
  },

  async findByQuery({ userId, branchId, branchIds, userRole } = {}) {
    let list = [...dbState.appointments];

    if (userRole === ROLES.ADMIN) {
      if (branchId && branchId !== 'all') {
        list = list.filter(a => a.branchId === branchId);
      }
    } else if (userRole === ROLES.BUYER) {
      if (!userId) return [];
      list = list.filter(a => a.userId === userId);
    } else if ([ROLES.SELLER, ROLES.SERVICE_STAFF].includes(userRole)) {
      const allowed = Array.isArray(branchIds) && branchIds.length > 0
        ? branchIds.filter(Boolean)
        : (branchId ? [branchId] : []);
      if (allowed.length === 0) return [];
      list = list.filter(a => a.branchId && allowed.includes(a.branchId));
    } else {
      return [];
    }

    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  // Check if a time slot on a specific date at a branch is available for given capacity
  async isSlotAvailable(branchId, date, timeSlot, capacity = 1) {
    const activeCount = dbState.appointments.filter(a =>
      a.branchId === branchId &&
      a.preferredDate === date &&
      a.timeSlot === timeSlot &&
      [APPOINTMENT_STATUS.PENDING, APPOINTMENT_STATUS.CONFIRMED].includes(a.status)
    ).length;
    return activeCount < Math.max(1, Number(capacity || 1));
  },

  async create(appointmentData) {
    return runInTransaction(async (state) => {
      const slotCapacity = Math.max(1, Number(appointmentData.slotCapacity || 1));
      const activeConflicts = state.appointments.filter(a =>
        a.branchId === appointmentData.branchId &&
        a.preferredDate === appointmentData.preferredDate &&
        a.timeSlot === appointmentData.timeSlot &&
        [APPOINTMENT_STATUS.PENDING, APPOINTMENT_STATUS.CONFIRMED].includes(a.status)
      );

      if (activeConflicts.length >= slotCapacity) {
        const err = new Error(`Khung giờ "${appointmentData.timeSlot}" ngày ${appointmentData.preferredDate} tại chi nhánh đã có người đặt trước (${activeConflicts.length}/${slotCapacity}). Vui lòng chọn khung giờ khác.`);
        err.statusCode = 409;
        err.code = 'SLOT_CONFLICT';
        throw err;
      }

      const id = `AP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const nowIso = new Date().toISOString();
      const newAppt = {
        id,
        userId: appointmentData.userId || null,
        customerName: appointmentData.customerName,
        phone: appointmentData.phone,
        email: appointmentData.email || null,
        carName: appointmentData.carName,
        vehicleId: appointmentData.vehicleId || null,
        branchId: appointmentData.branchId,
        branchName: appointmentData.branchName,
        preferredDate: appointmentData.preferredDate,
        timeSlot: appointmentData.timeSlot,
        timezone: appointmentData.timezone || 'Asia/Ho_Chi_Minh',
        isHomeService: Boolean(appointmentData.isHomeService),
        homeAddress: appointmentData.homeAddress || '',
        district: appointmentData.district || '',
        status: APPOINTMENT_STATUS.PENDING,
        version: 1,
        history: [
          {
            status: APPOINTMENT_STATUS.PENDING,
            preferredDate: appointmentData.preferredDate,
            timeSlot: appointmentData.timeSlot,
            actorId: appointmentData.userId || 'guest',
            timestamp: nowIso,
            note: 'Tạo lịch hẹn lái thử mới'
          }
        ],
        createdAt: nowIso,
        updatedAt: nowIso
      };

      state.appointments.push(newAppt);
      NotificationService.enqueueOutboxInState(state, {
        eventType: 'appointment_booked',
        aggregateType: 'appointment',
        aggregateId: newAppt.id,
        userId: newAppt.userId,
        recipientEmail: newAppt.email,
        recipientPhone: newAppt.phone,
        templateId: 'appointment_booked',
        payload: {
          appointmentId: newAppt.id,
          carName: newAppt.carName,
          preferredDate: newAppt.preferredDate,
          timeSlot: newAppt.timeSlot,
          branchName: newAppt.branchName
        },
        dedupeKey: `appt_booked:${newAppt.id}`
      });

      return newAppt;
    });
  },

  async transitionStatus(appointmentId, targetStatus, updatedByUserId, userRole, actorOverride = null) {
    return runInTransaction(async (state) => {
      const appt = state.appointments.find(a => a.id === appointmentId);
      if (!appt) {
        const err = new Error(`Không tìm thấy lịch hẹn "${appointmentId}".`);
        err.statusCode = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }

      const actor = actorOverride || state.users.find(u => u.id === updatedByUserId) || { userId: updatedByUserId, role: userRole };
      const normalizedActor = { ...actor, userId: actor.userId || actor.id || updatedByUserId };

      if (!Authorization.canMutateAppointment(normalizedActor, appt)) {
        const err = new Error('Bạn không có quyền thay đổi lịch hẹn này.');
        err.statusCode = 403;
        err.code = 'FORBIDDEN';
        throw err;
      }

      const normMap = {
        'pending': APPOINTMENT_STATUS.PENDING,
        'chờ xác nhận': APPOINTMENT_STATUS.PENDING,
        'confirmed': APPOINTMENT_STATUS.CONFIRMED,
        'đã xác nhận': APPOINTMENT_STATUS.CONFIRMED,
        'completed': APPOINTMENT_STATUS.COMPLETED,
        'hoàn thành': APPOINTMENT_STATUS.COMPLETED,
        'cancelled': APPOINTMENT_STATUS.CANCELLED,
        'canceled': APPOINTMENT_STATUS.CANCELLED,
        'đã hủy': APPOINTMENT_STATUS.CANCELLED
      };
      const cleanTarget = normMap[String(targetStatus || '').toLowerCase()] || targetStatus;

      const check = canUserTransitionAppointment(normalizedActor.role, appt.status, cleanTarget);
      if (!check.allowed) {
        const err = new Error(check.reason);
        err.statusCode = 403;
        err.code = 'FORBIDDEN';
        throw err;
      }

      const nowIso = new Date().toISOString();
      appt.status = cleanTarget;
      appt.version = (appt.version || 1) + 1;
      appt.updatedAt = nowIso;
      appt.updatedBy = normalizedActor.userId;
      if (!Array.isArray(appt.history)) appt.history = [];
      appt.history.push({
        status: cleanTarget,
        actorId: normalizedActor.userId,
        timestamp: nowIso,
        note: `Cập nhật trạng thái lịch hẹn -> ${cleanTarget}`
      });

      NotificationService.enqueueOutboxInState(state, {
        eventType: 'appointment_status_changed',
        aggregateType: 'appointment',
        aggregateId: appt.id,
        userId: appt.userId,
        recipientEmail: appt.email,
        recipientPhone: appt.phone,
        templateId: 'appointment_rescheduled',
        payload: {
          appointmentId: appt.id,
          carName: appt.carName,
          preferredDate: appt.preferredDate,
          timeSlot: appt.timeSlot,
          status: cleanTarget
        },
        dedupeKey: `appt_status:${appt.id}:v${appt.version}`
      });

      return appt;
    });
  }
};

module.exports = AppointmentRepository;
