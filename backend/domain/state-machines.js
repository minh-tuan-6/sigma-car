// backend/domain/state-machines.js
// Explicit business state machines and transition validators for SIGMACAR

const { ORDER_STATUS, PAYMENT_STATUS, APPOINTMENT_STATUS, TICKET_STATUS, RETURN_STATUS, ROLES } = require('./constants');

// Allowed Order State Transitions
const ORDER_TRANSITIONS = {
  [ORDER_STATUS.PENDING]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.CANCELLED, ORDER_STATUS.FAILED],
  [ORDER_STATUS.CONFIRMED]: [ORDER_STATUS.PREPARING, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PREPARING]: [ORDER_STATUS.SHIPPED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.SHIPPED]: [ORDER_STATUS.DELIVERED],
  [ORDER_STATUS.DELIVERED]: [ORDER_STATUS.COMPLETED],
  [ORDER_STATUS.COMPLETED]: [], // Terminal state
  [ORDER_STATUS.CANCELLED]: [], // Terminal state
  [ORDER_STATUS.FAILED]: []    // Terminal state
};

// Allowed Payment State Transitions
const PAYMENT_TRANSITIONS = {
  [PAYMENT_STATUS.UNPAID]: [PAYMENT_STATUS.DEPOSIT_PAID, PAYMENT_STATUS.FULLY_PAID, PAYMENT_STATUS.FAILED],
  [PAYMENT_STATUS.DEPOSIT_PAID]: [PAYMENT_STATUS.FULLY_PAID, PAYMENT_STATUS.REFUNDED],
  [PAYMENT_STATUS.FULLY_PAID]: [PAYMENT_STATUS.REFUNDED],
  [PAYMENT_STATUS.REFUNDED]: [], // Terminal state
  [PAYMENT_STATUS.FAILED]: [PAYMENT_STATUS.DEPOSIT_PAID, PAYMENT_STATUS.FULLY_PAID] // Can retry
};

// Allowed Appointment Transitions
const APPOINTMENT_TRANSITIONS = {
  [APPOINTMENT_STATUS.PENDING]: [APPOINTMENT_STATUS.CONFIRMED, APPOINTMENT_STATUS.IN_PROGRESS, APPOINTMENT_STATUS.CANCELLED],
  [APPOINTMENT_STATUS.CONFIRMED]: [APPOINTMENT_STATUS.IN_PROGRESS, APPOINTMENT_STATUS.COMPLETED, APPOINTMENT_STATUS.CANCELLED, APPOINTMENT_STATUS.NO_SHOW],
  [APPOINTMENT_STATUS.IN_PROGRESS]: [APPOINTMENT_STATUS.COMPLETED, APPOINTMENT_STATUS.CANCELLED],
  [APPOINTMENT_STATUS.COMPLETED]: [],
  [APPOINTMENT_STATUS.CANCELLED]: [],
  [APPOINTMENT_STATUS.NO_SHOW]: []
};

// Allowed Return Request Transitions (9-Stage Lifecycle + Rejection)
const RETURN_TRANSITIONS = {
  [RETURN_STATUS.PENDING_RECEIPT]: [RETURN_STATUS.CHECKING_CONDITIONS, RETURN_STATUS.APPROVED, RETURN_STATUS.REJECTED],
  [RETURN_STATUS.CHECKING_CONDITIONS]: [RETURN_STATUS.APPROVED, RETURN_STATUS.REJECTED],
  [RETURN_STATUS.APPROVED]: [RETURN_STATUS.AWAITING_SCHEDULE, RETURN_STATUS.TRUCK_CONFIRMED],
  [RETURN_STATUS.AWAITING_SCHEDULE]: [RETURN_STATUS.TRUCK_CONFIRMED],
  [RETURN_STATUS.TRUCK_CONFIRMED]: [RETURN_STATUS.IN_TRANSIT],
  [RETURN_STATUS.IN_TRANSIT]: [RETURN_STATUS.INSPECTING_VEHICLE],
  [RETURN_STATUS.INSPECTING_VEHICLE]: [RETURN_STATUS.REFUND_PROCESSING, RETURN_STATUS.REJECTED],
  [RETURN_STATUS.REFUND_PROCESSING]: [RETURN_STATUS.COMPLETED],
  [RETURN_STATUS.COMPLETED]: [],
  [RETURN_STATUS.REJECTED]: []
};

// Role Permission rules for status transitions
function canUserTransitionOrder(userRole, currentStatus, targetStatus) {
  // Check if transition is defined
  const allowed = ORDER_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(targetStatus)) {
    return {
      allowed: false,
      reason: `Chuyển đổi trạng thái đơn hàng không hợp lệ: từ "${currentStatus}" sang "${targetStatus}".`
    };
  }

  // Buyers may only cancel their order if it is still Pending
  if (userRole === ROLES.BUYER) {
    if (targetStatus === ORDER_STATUS.CANCELLED && currentStatus === ORDER_STATUS.PENDING) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: 'Khách hàng (Buyer) chỉ có thể hủy đơn khi đơn hàng đang ở trạng thái Chờ xử lý (Pending).'
    };
  }

  // Sellers may confirm, prepare, ship within authorized store
  if (userRole === ROLES.SELLER) {
    if ([ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING, ORDER_STATUS.SHIPPED].includes(targetStatus)) {
      return { allowed: true };
    }
    // Sellers cannot unilaterally approve refunds or cancel confirmed orders without admin
    if (targetStatus === ORDER_STATUS.CANCELLED) {
      return {
        allowed: false,
        reason: 'Đại lý (Seller) không thể tự ý hủy đơn đã xác nhận. Yêu cầu cần quản trị viên (Admin) phê duyệt.'
      };
    }
  }

  // Admin has full authorized access over valid lifecycle transitions
  if (userRole === ROLES.ADMIN) {
    return { allowed: true };
  }

  return { allowed: false, reason: 'Vai trò người dùng không có quyền thực hiện thao tác này.' };
}

function canUserTransitionAppointment(userRole, currentStatus, targetStatus) {
  const allowed = APPOINTMENT_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(targetStatus)) {
    return {
      allowed: false,
      reason: `Chuyển đổi lịch hẹn không hợp lệ: từ "${currentStatus}" sang "${targetStatus}".`
    };
  }

  // Buyers may cancel their appointment if pending or confirmed
  if (userRole === ROLES.BUYER) {
    if (targetStatus === APPOINTMENT_STATUS.CANCELLED) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'Khách hàng chỉ có quyền Hủy lịch hẹn của chính mình.' };
  }

  // Sellers, Service Staff & Admin can confirm or mark completed
  if (userRole === ROLES.SELLER || userRole === ROLES.SERVICE_STAFF || userRole === ROLES.ADMIN) {
    return { allowed: true };
  }

  return { allowed: false, reason: 'Không có quyền thay đổi trạng thái lịch hẹn.' };
}

function canUserTransitionReturn(userRole, currentStatus, targetStatus) {
  if (![ROLES.ADMIN, ROLES.SELLER, ROLES.SERVICE_STAFF].includes(userRole)) {
    return { allowed: false, reason: 'Chỉ Quản trị viên, Nhân viên Đại lý hoặc Hậu mãi mới có quyền cập nhật trạng thái đổi trả.' };
  }
  const allowed = RETURN_TRANSITIONS[currentStatus] || [];
  // Allow sequential or direct valid stage progression for authorized staff
  if (!allowed.includes(targetStatus) && userRole !== ROLES.ADMIN) {
    return {
      allowed: false,
      reason: `Chuyển đổi giai đoạn đổi trả không hợp lệ từ "${currentStatus}" sang "${targetStatus}".`
    };
  }
  return { allowed: true };
}

module.exports = {
  ORDER_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  APPOINTMENT_TRANSITIONS,
  RETURN_TRANSITIONS,
  canUserTransitionOrder,
  canUserTransitionAppointment,
  canUserTransitionReturn
};
