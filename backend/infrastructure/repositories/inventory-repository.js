// backend/infrastructure/repositories/inventory-repository.js
// Per-branch atomic inventory, TTL reservations, optimistic locking, and movement ledger

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../storage-engine');
const { SHOWROOM_BRANCHES } = require('../../domain/constants');
const Authorization = require('../../domain/authorization');

function createError(message, statusCode = 400, code = 'INVENTORY_ERROR', extra = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function findVehicleRecordInState(state, vehicleId) {
  if (!vehicleId) return null;
  const cleanId = String(vehicleId).toLowerCase().replace(/^sigma-/, '');
  const newCar = (state.vehicles || []).find(v => v.id === vehicleId || v.id === cleanId);
  if (newCar) return { record: newCar, isCertified: false };
  const cpo = (state.certifiedVehicles || []).find(v => v.id === vehicleId || v.id === cleanId);
  if (cpo) return { record: cpo, isCertified: true };
  return null;
}

function ensureBranchRowsInState(state, vehicleId) {
  if (!Array.isArray(state.branchInventory)) state.branchInventory = [];
  const rows = state.branchInventory.filter(r => r.vehicleId === vehicleId);
  if (rows.length > 0) return rows;

  const found = findVehicleRecordInState(state, vehicleId);
  if (!found) return [];

  const { record, isCertified } = found;
  const total = Math.max(0, Number.isInteger(record.stock) ? record.stock : (isCertified ? 1 : 5));
  const nowIso = new Date().toISOString();
  const created = [];

  if (isCertified) {
    const branchId = record.branchId || SHOWROOM_BRANCHES[0].id;
    for (const b of SHOWROOM_BRANCHES) {
      const row = {
        id: `inv_${vehicleId}_${b.id}`,
        vehicleId,
        branchId: b.id,
        stockOnHand: b.id === branchId ? Math.min(1, total) : 0,
        reservedQty: 0,
        version: 1,
        updatedAt: nowIso
      };
      state.branchInventory.push(row);
      created.push(row);
    }
    return created;
  }

  const primary = total <= 1 ? total : Math.ceil(total * 0.6);
  const rem = Math.max(0, total - primary);
  const hcm = rem <= 1 ? rem : Math.ceil(rem * 0.5);
  const dn = Math.max(0, rem - hcm);
  for (const b of SHOWROOM_BRANCHES) {
    let qty = 0;
    if (b.id === 'hn-caugiay') qty = primary;
    else if (b.id === 'hcm-q7') qty = hcm;
    else if (b.id === 'dn-haichau') qty = dn;
    const row = {
      id: `inv_${vehicleId}_${b.id}`,
      vehicleId,
      branchId: b.id,
      stockOnHand: qty,
      reservedQty: 0,
      version: 1,
      updatedAt: nowIso
    };
    state.branchInventory.push(row);
    created.push(row);
  }
  return created;
}

function syncAggregateVehicleStockInState(state, vehicleId) {
  const found = findVehicleRecordInState(state, vehicleId);
  if (!found) return 0;
  const rows = state.branchInventory.filter(r => r.vehicleId === vehicleId);
  const totalAvailable = rows.reduce((sum, r) => {
    const avail = Math.max(0, (r.stockOnHand || 0) - (r.reservedQty || 0));
    return sum + avail;
  }, 0);
  found.record.stock = totalAvailable;
  found.record.stockQuantity = totalAvailable;
  found.record.isAvailable = totalAvailable > 0;
  return totalAvailable;
}

function appendMovementInState(state, { vehicleId, branchId, delta, reason, referenceId = null, actorId = 'system', versionAfter = null }) {
  if (!Array.isArray(state.inventoryMovements)) state.inventoryMovements = [];
  const entry = {
    id: `mov_${crypto.randomUUID()}`,
    vehicleId,
    branchId,
    delta,
    reason,
    referenceId,
    actorId,
    versionAfter,
    createdAt: new Date().toISOString()
  };
  state.inventoryMovements.push(entry);
  return entry;
}

function expireStaleReservationsInState(state, nowMs = Date.now()) {
  if (!Array.isArray(state.reservations)) state.reservations = [];
  let expiredCount = 0;
  const affectedVehicles = new Set();

  for (const res of state.reservations) {
    if (res.status !== 'active') continue;
    const expMs = Date.parse(res.expiresAt);
    if (!Number.isFinite(expMs) || expMs > nowMs) continue;

    // Double check: if linked order already paid, do not expire reservation silently
    const linkedOrder = res.orderId ? (state.orders || []).find(o => o.id === res.orderId) : null;
    if (linkedOrder && ['Deposit_Paid', 'Partially_Paid', 'Fully_Paid'].includes(linkedOrder.paymentStatus)) {
      continue;
    }

    const row = (state.branchInventory || []).find(r => r.vehicleId === res.vehicleId && r.branchId === res.branchId);
    if (row) {
      row.reservedQty = Math.max(0, (row.reservedQty || 0) - res.quantity);
      row.version = (row.version || 1) + 1;
      row.updatedAt = new Date(nowMs).toISOString();
    }
    res.status = 'expired';
    res.releasedAt = new Date(nowMs).toISOString();
    res.updatedAt = res.releasedAt;
    appendMovementInState(state, {
      vehicleId: res.vehicleId,
      branchId: res.branchId,
      delta: res.quantity,
      reason: 'RESERVATION_EXPIRED',
      referenceId: res.id,
      actorId: 'worker_expiry',
      versionAfter: row ? row.version : null
    });
    affectedVehicles.add(res.vehicleId);
    expiredCount += 1;
  }

  for (const vid of affectedVehicles) {
    syncAggregateVehicleStockInState(state, vid);
  }
  return { expiredCount };
}

function reserveStockInState(state, { vehicleId, branchId = 'hn-caugiay', quantity = 1, userId = 'anonymous', orderId = null, cartId = null, ttlMs = 15 * 60 * 1000, nowMs = Date.now() }) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
    throw createError('Số lượng giữ kho phải là số nguyên dương (1 - 50).', 400, 'VALIDATION_ERROR');
  }
  if (!SHOWROOM_BRANCHES.some(b => b.id === branchId)) {
    throw createError(`Chi nhánh "${branchId}" không hợp lệ.`, 400, 'INVALID_BRANCH');
  }

  expireStaleReservationsInState(state, nowMs);

  const found = findVehicleRecordInState(state, vehicleId);
  if (!found || found.record.archived) {
    throw createError(`Mẫu xe "${vehicleId}" không tồn tại hoặc đã ngừng kinh doanh.`, 404, 'VEHICLE_NOT_FOUND');
  }
  if (found.isCertified && quantity !== 1) {
    throw createError('Xe qua sử dụng (Certified) chỉ tồn tại 1 xe duy nhất theo số VIN.', 409, 'CPO_UNIQUE_UNIT');
  }

  const canonicalId = found.record.id;
  const rows = ensureBranchRowsInState(state, canonicalId);
  const row = rows.find(r => r.branchId === branchId);
  if (!row) {
    throw createError(`Không có dữ liệu kho tại chi nhánh "${branchId}".`, 404, 'BRANCH_INVENTORY_NOT_FOUND');
  }

  const availableAtBranch = Math.max(0, (row.stockOnHand || 0) - (row.reservedQty || 0));
  if (availableAtBranch < quantity) {
    throw createError(
      `Mẫu xe "${found.record.name}" không đủ tồn kho khả dụng tại chi nhánh ${branchId} (Còn: ${availableAtBranch}).`,
      409,
      'OUT_OF_STOCK',
      { branchId, available: availableAtBranch }
    );
  }

  if (found.isCertified) {
    const totalGlobalAvail = rows.reduce((s, r) => s + Math.max(0, (r.stockOnHand || 0) - (r.reservedQty || 0)), 0);
    if (totalGlobalAvail < 1) {
      throw createError(`Xe Certified "${found.record.name}" đã có khách giữ chỗ.`, 409, 'OUT_OF_STOCK');
    }
  }

  row.reservedQty = (row.reservedQty || 0) + quantity;
  row.version = (row.version || 1) + 1;
  row.updatedAt = new Date(nowMs).toISOString();

  const reservation = {
    id: `res_${crypto.randomUUID()}`,
    orderId,
    cartId,
    userId,
    vehicleId: canonicalId,
    branchId,
    quantity,
    status: 'active',
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    createdAt: new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString()
  };
  if (!Array.isArray(state.reservations)) state.reservations = [];
  state.reservations.push(reservation);

  appendMovementInState(state, {
    vehicleId: canonicalId,
    branchId,
    delta: -quantity,
    reason: 'RESERVE_STOCK',
    referenceId: reservation.id,
    actorId: userId,
    versionAfter: row.version
  });

  syncAggregateVehicleStockInState(state, canonicalId);
  return { reservation, branchRow: { ...row }, vehicle: found.record };
}

function convertReservationInState(state, reservationId, orderId, actorId = 'payment_webhook') {
  const res = (state.reservations || []).find(r => r.id === reservationId);
  if (!res) return null;
  if (res.status === 'converted') return res; // idempotent
  if (res.status !== 'active') {
    throw createError(`Giữ chỗ "${reservationId}" đang ở trạng thái "${res.status}", không thể chuyển đổi sang đã bán.`, 409, 'RESERVATION_NOT_ACTIVE');
  }

  const row = (state.branchInventory || []).find(r => r.vehicleId === res.vehicleId && r.branchId === res.branchId);
  if (row) {
    row.reservedQty = Math.max(0, (row.reservedQty || 0) - res.quantity);
    row.stockOnHand = Math.max(0, (row.stockOnHand || 0) - res.quantity);
    row.version = (row.version || 1) + 1;
    row.updatedAt = new Date().toISOString();
  }
  res.status = 'converted';
  res.orderId = orderId || res.orderId;
  res.convertedAt = new Date().toISOString();
  res.updatedAt = res.convertedAt;

  appendMovementInState(state, {
    vehicleId: res.vehicleId,
    branchId: res.branchId,
    delta: 0,
    reason: 'CONVERT_TO_SALE',
    referenceId: res.orderId || res.id,
    actorId,
    versionAfter: row ? row.version : null
  });
  syncAggregateVehicleStockInState(state, res.vehicleId);
  return res;
}

function releaseReservationInState(state, reservationId, { reason = 'ORDER_CANCELLED', actorId = 'system' } = {}) {
  const res = (state.reservations || []).find(r => r.id === reservationId);
  if (!res) return { released: false, reason: 'NOT_FOUND' };
  // Exactly-once guard
  if (res.status === 'released' || res.status === 'expired') {
    return { released: false, alreadyReleased: true, reservation: res };
  }

  const row = (state.branchInventory || []).find(r => r.vehicleId === res.vehicleId && r.branchId === res.branchId);
  if (row) {
    if (res.status === 'active') {
      row.reservedQty = Math.max(0, (row.reservedQty || 0) - res.quantity);
    } else if (res.status === 'converted') {
      row.stockOnHand = (row.stockOnHand || 0) + res.quantity;
    }
    row.version = (row.version || 1) + 1;
    row.updatedAt = new Date().toISOString();
  }

  res.status = 'released';
  res.releasedAt = new Date().toISOString();
  res.updatedAt = res.releasedAt;

  appendMovementInState(state, {
    vehicleId: res.vehicleId,
    branchId: res.branchId,
    delta: res.quantity,
    reason,
    referenceId: res.orderId || res.id,
    actorId,
    versionAfter: row ? row.version : null
  });
  syncAggregateVehicleStockInState(state, res.vehicleId);
  return { released: true, reservation: res };
}

const InventoryRepository = {
  findVehicleRecordInState,
  ensureBranchRowsInState,
  syncAggregateVehicleStockInState,
  expireStaleReservationsInState,
  reserveStockInState,
  convertReservationInState,
  releaseReservationInState,
  appendMovementInState,

  async getByVehicle(vehicleId) {
    const found = findVehicleRecordInState(dbState, vehicleId);
    if (!found) {
      throw createError(`Mẫu xe "${vehicleId}" không tồn tại.`, 404, 'VEHICLE_NOT_FOUND');
    }
    const rows = (dbState.branchInventory || [])
      .filter(r => r.vehicleId === found.record.id)
      .map(r => {
        const branch = SHOWROOM_BRANCHES.find(b => b.id === r.branchId);
        const avail = Math.max(0, (r.stockOnHand || 0) - (r.reservedQty || 0));
        return {
          ...r,
          branchName: branch ? branch.name : r.branchId,
          city: branch ? branch.city : '',
          available: avail,
          availableQty: avail
        };
      });
    const movements = (dbState.inventoryMovements || [])
      .filter(m => m.vehicleId === found.record.id)
      .slice(-20)
      .reverse();
    return {
      vehicleId: found.record.id,
      vehicleName: found.record.name,
      totalAvailable: rows.reduce((s, r) => s + r.availableQty, 0),
      branches: rows,
      recentMovements: movements
    };
  },

  async listInventory(user, filters = {}) {
    let rows = (dbState.branchInventory || []).map(r => {
      const found = findVehicleRecordInState(dbState, r.vehicleId);
      const branch = SHOWROOM_BRANCHES.find(b => b.id === r.branchId);
      const avail = Math.max(0, (r.stockOnHand || 0) - (r.reservedQty || 0));
      return {
        ...r,
        vehicleName: found?.record?.name || r.vehicleId,
        isCertified: found?.isCertified || false,
        branchName: branch ? branch.name : r.branchId,
        available: avail,
        availableQty: avail
      };
    });

    if (user && user.role !== 'admin') {
      rows = rows.filter(r => Authorization.hasBranchAccess(user, r.branchId));
    }
    if (filters.branchId && filters.branchId !== 'all') {
      rows = rows.filter(r => r.branchId === filters.branchId);
    }
    if (filters.vehicleId) {
      rows = rows.filter(r => r.vehicleId === filters.vehicleId);
    }
    return rows;
  },

  async adjustStock({ vehicleId, branchId = 'hn-caugiay', delta, stockOnHand, reason = 'Điều chỉnh tồn kho đại lý', expectedVersion, user }) {
    if (!user || !['admin', 'seller'].includes(user.role)) {
      throw createError('Bạn không có quyền điều chỉnh tồn kho.', 403, 'FORBIDDEN');
    }
    Authorization.assertAuthorized(
      Authorization.canAccessBranchResource(user, branchId),
      'Bạn không có quyền điều chỉnh kho của chi nhánh khác.',
      403,
      'BRANCH_FORBIDDEN'
    );
    if (!SHOWROOM_BRANCHES.some(b => b.id === branchId)) {
      throw createError(`Chi nhánh "${branchId}" không hợp lệ.`, 400, 'INVALID_BRANCH');
    }

    return runInTransaction(async (state) => {
      const found = findVehicleRecordInState(state, vehicleId);
      if (!found) {
        throw createError(`Không tìm thấy mẫu xe "${vehicleId}".`, 404, 'VEHICLE_NOT_FOUND');
      }
      const rows = ensureBranchRowsInState(state, found.record.id);
      const row = rows.find(r => r.branchId === branchId);
      if (!row) {
        throw createError('Không tìm thấy bản ghi kho chi nhánh.', 404, 'NOT_FOUND');
      }

      if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== row.version) {
        throw createError(
          `Dữ liệu kho đã được cập nhật bởi phiên khác (Phiên bản hiện tại: v${row.version}, bạn đang xem: v${expectedVersion}).`,
          409,
          'VERSION_CONFLICT',
          { currentVersion: row.version, currentRecord: { ...row } }
        );
      }

      let nextStockOnHand;
      if (stockOnHand !== undefined && stockOnHand !== null) {
        nextStockOnHand = Number(stockOnHand);
      } else if (delta !== undefined && delta !== null) {
        nextStockOnHand = (row.stockOnHand || 0) + Number(delta);
      } else {
        throw createError('Vui lòng cung cấp delta hoặc stockOnHand hợp lệ.', 400, 'VALIDATION_ERROR');
      }

      if (!Number.isInteger(nextStockOnHand) || nextStockOnHand < 0 || nextStockOnHand > 10000) {
        throw createError('Số lượng tồn kho phải là số nguyên từ 0 đến 10.000.', 400, 'VALIDATION_ERROR');
      }
      if (found.isCertified && nextStockOnHand > 1) {
        throw createError('Xe Certified chỉ cho phép tối đa 1 xe theo số VIN.', 409, 'CPO_UNIQUE_UNIT');
      }
      if (nextStockOnHand < (row.reservedQty || 0)) {
        throw createError(`Không thể giảm tồn kho xuống dưới số lượng đang giữ chỗ (${row.reservedQty} xe).`, 409, 'RESERVED_EXCEEDS_STOCK');
      }

      const appliedDelta = nextStockOnHand - (row.stockOnHand || 0);
      row.stockOnHand = nextStockOnHand;
      row.version = (row.version || 1) + 1;
      row.updatedAt = new Date().toISOString();

      appendMovementInState(state, {
        vehicleId: found.record.id,
        branchId,
        delta: appliedDelta,
        reason: String(reason || 'STAFF_ADJUST').trim(),
        referenceId: `adj_${Date.now()}`,
        actorId: user.userId,
        versionAfter: row.version
      });

      const aggregate = syncAggregateVehicleStockInState(state, found.record.id);
      return {
        ...row,
        availableQty: Math.max(0, row.stockOnHand - (row.reservedQty || 0)),
        totalVehicleAvailable: aggregate
      };
    });
  },

  async reserveStock(params) {
    return runInTransaction(async (state) => reserveStockInState(state, params));
  },

  async releaseReservation(reservationId, options = {}) {
    return runInTransaction(async (state) => releaseReservationInState(state, reservationId, options));
  },

  async expireStaleReservations(nowMs = Date.now()) {
    return runInTransaction(async (state) => expireStaleReservationsInState(state, nowMs));
  }
};

module.exports = InventoryRepository;
