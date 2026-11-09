// backend/infrastructure/repositories/appointment-repository.js
// AppointmentRepository with slot collision avoidance and role-based data isolation

const { dbState, runInTransaction } = require('../storage-engine');
const { APPOINTMENT_STATUS, ROLES } = require('../../domain/constants');
const { canUserTransitionAppointment } = require('../../domain/state-machines');

const AppointmentRepository = {
  async findById(id) {
    return dbState.appointments.find(a => a.id === id) || null;
  },

  async findByQuery({ userId, branchId, userRole } = {}) {
    let list = [...dbState.appointments];

    if (userRole === ROLES.BUYER && userId) {
      list = list.filter(a => a.userId === userId);
    } else if (userRole === ROLES.SELLER && branchId) {
      list = list.filter(a => a.branchId === branchId);
    }

    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  // Check if a time slot on a specific date at a branch is already occupied by a confirmed booking
  async isSlotAvailable(branchId, date, timeSlot) {
    const conflict = dbState.appointments.find(a => 
      a.branchId === branchId && 
      a.preferredDate === date && 
      a.timeSlot === timeSlot &&
      [APPOINTMENT_STATUS.PENDING, APPOINTMENT_STATUS.CONFIRMED].includes(a.status)
    );
    return !conflict;
  },

  async create(appointmentData) {
    return runInTransaction(async (state) => {
      // Collision / double booking check
      const conflict = state.appointments.find(a => 
        a.branchId === appointmentData.branchId && 
        a.preferredDate === appointmentData.preferredDate && 
        a.timeSlot === appointmentData.timeSlot &&
        [APPOINTMENT_STATUS.PENDING, APPOINTMENT_STATUS.CONFIRMED].includes(a.status)
      );

      if (conflict) {
        const err = new Error(`Khung giờ "${appointmentData.timeSlot}" ngày ${appointmentData.preferredDate} tại chi nhánh đã có người đặt trước. Vui lòng chọn khung giờ khác.`);
        err.statusCode = 409;
        err.code = 'SLOT_CONFLICT';
        throw err;
      }

      const id = `AP-${Date.now().toString().slice(-4)}`;
      const newAppt = {
        id,
        userId: appointmentData.userId,
        customerName: appointmentData.customerName,
        phone: appointmentData.phone,
        email: appointmentData.email,
        carName: appointmentData.carName,
        branchId: appointmentData.branchId,
        branchName: appointmentData.branchName,
        preferredDate: appointmentData.preferredDate,
        timeSlot: appointmentData.timeSlot,
        status: APPOINTMENT_STATUS.PENDING,
        createdAt: new Date().toISOString()
      };

      state.appointments.push(newAppt);
      return newAppt;
    });
  },

  async transitionStatus(appointmentId, targetStatus, updatedByUserId, userRole) {
    return runInTransaction(async (state) => {
      const appt = state.appointments.find(a => a.id === appointmentId);
      if (!appt) {
        throw new Error(`Không tìm thấy lịch hẹn "${appointmentId}".`);
      }

      // Normalize English or Vietnamese status
      const normMap = {
        'pending': APPOINTMENT_STATUS.PENDING,
        'chờ xác nhận': APPOINTMENT_STATUS.PENDING,
        'confirmed': APPOINTMENT_STATUS.CONFIRMED,
        'đã xác nhận': APPOINTMENT_STATUS.CONFIRMED,
        'completed': APPOINTMENT_STATUS.COMPLETED,
        'hoàn thành': APPOINTMENT_STATUS.COMPLETED,
        'cancelled': APPOINTMENT_STATUS.CANCELLED,
        'đã hủy': APPOINTMENT_STATUS.CANCELLED
      };
      const cleanTarget = normMap[targetStatus.toLowerCase()] || targetStatus;

      const check = canUserTransitionAppointment(userRole, appt.status, cleanTarget);
      if (!check.allowed) {
        throw new Error(check.reason);
      }

      appt.status = cleanTarget;
      appt.updatedAt = new Date().toISOString();
      appt.updatedBy = updatedByUserId;
      return appt;
    });
  }
};

module.exports = AppointmentRepository;
