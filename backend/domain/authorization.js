// backend/domain/authorization.js
// Centralized Deny-by-Default Authorization & Resource Scope Policy Engine (SIG-P0-003)

const { ROLES, ROLE_CAPABILITIES, ORDER_STATUS } = require('./constants');
const { dbState } = require('../infrastructure/storage-engine');
const Security = require('../infrastructure/security');

function getUserBranchIds(user) {
  if (!user) return [];
  if (Array.isArray(user.branchIds) && user.branchIds.length > 0) {
    return user.branchIds.filter(Boolean);
  }
  if (user.branchId) return [user.branchId];
  return [];
}

function getCapabilitiesForRole(role) {
  return ROLE_CAPABILITIES[role] || [];
}

function createAuthError(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

/**
 * Resolve the authoritative current actor from live user storage.
 * Ensures disabled accounts, missing users, or revoked sessionVersions are denied immediately.
 */
function resolveActor(tokenPayload) {
  if (!tokenPayload || !tokenPayload.userId) return null;

  const liveUser = Array.isArray(dbState.users)
    ? dbState.users.find(u => u.id === tokenPayload.userId)
    : null;

  if (!liveUser) return null;
  if (liveUser.disabledAt || liveUser.isDisabled) return null;

  const tokenVersion = tokenPayload.sessionVersion ?? 1;
  const liveVersion = liveUser.sessionVersion ?? 1;
  if (tokenVersion !== liveVersion) return null;

  const branchIds = getUserBranchIds(liveUser);

  return {
    userId: liveUser.id,
    email: liveUser.email,
    fullName: liveUser.fullName,
    role: liveUser.role,
    branchId: liveUser.branchId || branchIds[0] || null,
    branchIds,
    sessionVersion: liveVersion,
    capabilities: Array.isArray(liveUser.capabilities) && liveUser.capabilities.length > 0
      ? liveUser.capabilities
      : getCapabilitiesForRole(liveUser.role)
  };
}

function hasBranchAccess(actor, resourceBranchId) {
  if (!actor) return false;
  if (actor.role === ROLES.ADMIN) return true;
  if (![ROLES.SELLER, ROLES.SUPPORT_STAFF, ROLES.SERVICE_STAFF].includes(actor.role)) {
    return false;
  }
  const branches = getUserBranchIds(actor);
  // Fail-closed: staff/seller with no branch assignment cannot access global or any branch record
  if (branches.length === 0) return false;
  if (!resourceBranchId) return false;
  return branches.includes(resourceBranchId);
}

function isStaffRole(role) {
  return [ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF, ROLES.SERVICE_STAFF].includes(role);
}

function canReadOrder(actor, order) {
  if (!actor || !order) return false;
  if (actor.role === ROLES.ADMIN) return true;
  if (actor.role === ROLES.BUYER) {
    return order.userId === actor.userId || order.buyerId === actor.userId;
  }
  if (actor.role === ROLES.SELLER) {
    return hasBranchAccess(actor, order.branchId);
  }
  return false;
}

function canMutateOrderStatus(actor, order, targetStatus) {
  if (!actor || !order) return { allowed: false, code: 'FORBIDDEN', statusCode: 403, reason: 'Không có quyền thao tác đơn hàng.' };
  if (actor.role === ROLES.ADMIN) return { allowed: true };

  if (actor.role === ROLES.BUYER) {
    const isOwner = order.userId === actor.userId || order.buyerId === actor.userId;
    if (!isOwner) {
      return { allowed: false, code: 'FORBIDDEN', statusCode: 403, reason: 'Bạn không phải chủ sở hữu đơn hàng này.' };
    }
    if (targetStatus === ORDER_STATUS.CANCELLED && order.orderStatus === ORDER_STATUS.PENDING) {
      return { allowed: true };
    }
    return { allowed: false, code: 'FORBIDDEN', statusCode: 403, reason: 'Khách hàng chỉ có thể yêu cầu hủy đơn khi đang ở trạng thái Pending.' };
  }

  if (actor.role === ROLES.SELLER) {
    if (!hasBranchAccess(actor, order.branchId)) {
      return { allowed: false, code: 'FORBIDDEN', statusCode: 403, reason: 'Đơn hàng thuộc chi nhánh khác phạm vi phân công của bạn.' };
    }
    return { allowed: true };
  }

  return { allowed: false, code: 'FORBIDDEN', statusCode: 403, reason: 'Vai trò không được phép cập nhật đơn hàng.' };
}

function canReadAppointment(actor, appt) {
  if (!actor || !appt) return false;
  if (actor.role === ROLES.ADMIN) return true;
  if (actor.role === ROLES.BUYER) return appt.userId === actor.userId;
  if ([ROLES.SELLER, ROLES.SERVICE_STAFF].includes(actor.role)) {
    return hasBranchAccess(actor, appt.branchId);
  }
  return false;
}

function canMutateAppointment(actor, appt) {
  if (!actor || !appt) return false;
  if (actor.role === ROLES.ADMIN) return true;
  if (actor.role === ROLES.BUYER) return appt.userId === actor.userId;
  if ([ROLES.SELLER, ROLES.SERVICE_STAFF].includes(actor.role)) {
    return hasBranchAccess(actor, appt.branchId);
  }
  return false;
}

function canAccessBranchResource(actor, record, ownerField = 'userId', branchField = 'branchId') {
  if (!actor || !record) return false;
  if (actor.role === ROLES.ADMIN) return true;
  if (actor.role === ROLES.BUYER) {
    return record[ownerField] === actor.userId || record.buyerId === actor.userId;
  }
  if (isStaffRole(actor.role)) {
    // Allow access if user is also the owner of their own personal record
    if (record[ownerField] === actor.userId) return true;
    return hasBranchAccess(actor, record[branchField] || record.serviceCenterId);
  }
  return false;
}

function canReadTicket(actor, ticket, guestAccessToken = null) {
  if (!ticket) return false;
  if (actor) {
    if (actor.role === ROLES.ADMIN) return true;
    if (ticket.userId && ticket.userId === actor.userId) return true;
    if (isStaffRole(actor.role)) {
      if (ticket.assignedStaffId && ticket.assignedStaffId === actor.userId) return true;
      return hasBranchAccess(actor, ticket.branchId || ticket.preferredBranchId);
    }
    return false;
  }

  // Anonymous guest access strictly requires matching secret accessToken hash
  if (guestAccessToken && ticket.guestAccessTokenHash) {
    return Security.verifySecretHash(guestAccessToken, ticket.guestAccessTokenHash);
  }
  return false;
}

function canReplyTicket(actor, ticket, guestAccessToken = null) {
  return canReadTicket(actor, ticket, guestAccessToken);
}

function assertAuthorized(condition, message = 'Bạn không có quyền truy cập tài nguyên này.', statusCode = 403, code = 'FORBIDDEN') {
  if (!condition) {
    throw createAuthError(statusCode, code, message);
  }
}

module.exports = {
  getUserBranchIds,
  getCapabilitiesForRole,
  createAuthError,
  resolveActor,
  hasBranchAccess,
  isStaffRole,
  canReadOrder,
  canMutateOrderStatus,
  canReadAppointment,
  canMutateAppointment,
  canAccessBranchResource,
  canReadTicket,
  canReplyTicket,
  assertAuthorized
};
