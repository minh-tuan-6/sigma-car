// backend/application/warranty-lookup-service.js
// Warranty lookup by VIN (PLAN.md T2.4). Login required; buyers see only their own vehicles, staff only their branch
// (the branch of the order the warranty belongs to), admins everything. Anything else answers 404 so the endpoint
// cannot be used to probe which VINs exist. Only coverage data is returned — no owner name, phone or invoice.

const { dbState } = require('../infrastructure/storage-engine');
const Authorization = require('../domain/authorization');

const VIN_PATTERN = /^[A-Z0-9]{8,20}$/;

function createError(message, statusCode = 400, code = 'WARRANTY_LOOKUP_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function daysBetween(fromIso, toIso) {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / 86400000);
}

const WarrantyLookupService = {
  lookupByVin(rawVin, user, now = new Date()) {
    if (!user || !user.userId) throw createError('Vui lòng đăng nhập để tra cứu bảo hành.', 401, 'UNAUTHORIZED');
    const vin = String(rawVin || '').replace(/[\s-]/g, '').toUpperCase();
    if (!VIN_PATTERN.test(vin)) {
      throw createError('Số khung (VIN) không hợp lệ (8–20 ký tự chữ và số).', 422, 'INVALID_VIN');
    }

    const warranty = (dbState.warranties || []).find(w => String(w.vin || '').replace(/[\s-]/g, '').toUpperCase() === vin);
    const notFound = () => createError('Không tìm thấy bảo hành cho số khung này trong phạm vi bạn được xem.', 404, 'NOT_FOUND');
    if (!warranty) throw notFound();

    const order = (dbState.orders || []).find(o => o.id === warranty.orderId) || null;
    const record = {
      userId: warranty.userId || (order && order.userId) || null,
      branchId: (order && order.branchId) || warranty.branchId || null
    };
    if (!Authorization.canAccessBranchResource(user, record)) throw notFound();

    const todayIso = now.toISOString().slice(0, 10);
    const daysLeft = warranty.endDate ? daysBetween(todayIso, warranty.endDate) : null;
    const batteryDaysLeft = warranty.batteryEndDate ? daysBetween(todayIso, warranty.batteryEndDate) : null;
    return {
      vin,
      warrantyCode: warranty.warrantyCode || warranty.id,
      vehicleName: warranty.vehicleName || null,
      licensePlate: warranty.licensePlate || null,
      status: warranty.status || null,
      isActive: daysLeft !== null ? daysLeft >= 0 : null,
      startDate: warranty.startDate || null,
      endDate: warranty.endDate || null,
      daysRemaining: daysLeft !== null ? Math.max(0, daysLeft) : null,
      maxKm: warranty.maxKm ?? null,
      batteryEndDate: warranty.batteryEndDate || null,
      batteryDaysRemaining: batteryDaysLeft !== null ? Math.max(0, batteryDaysLeft) : null,
      batteryMaxKm: warranty.batteryMaxKm ?? null,
      currentOdoKm: warranty.currentOdoKm ?? null,
      nextMaintenanceKm: warranty.nextMaintenanceKm ?? null,
      nextMaintenanceDate: warranty.nextMaintenanceDate || null,
      scopeSummary: warranty.scopeSummary || null
    };
  }
};

module.exports = WarrantyLookupService;
