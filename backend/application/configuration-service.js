// backend/application/configuration-service.js
// Owner-Scoped Versioned Vehicle 3D Configurations & Stale-Option Compatibility Check (SIG-P3-003)

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const ConfigurationRepository = require('../infrastructure/repositories/configuration-repository');
const AccessoryService = require('./accessory-service');
const Security = require('../infrastructure/security');
const { ROLES } = require('../domain/constants');

const CURRENT_ASSET_VERSION = '2.1.0';

const DEFAULT_WHEELS = [
  { id: 'wheel-21-sport', name: '21" Sport Wheels', price: 0 },
  { id: 'wheel-20-aero', name: '20" Aero Blade Range Wheels', price: 18000000 },
  { id: 'wheel-22-forged', name: '22" Forged Turbine Carbon', price: 45000000 }
];

function createError(message, statusCode = 400, code = 'CONFIG_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function evaluateCompatibility(state, cfg, vehicle) {
  const issues = [];
  if (!vehicle || vehicle.archived) {
    issues.push('Mẫu xe đã thay đổi hoặc ngừng phân phối mới.');
  }
  if (cfg.assetVersion && cfg.assetVersion !== CURRENT_ASSET_VERSION) {
    issues.push(`Cấu hình lưu từ phiên bản tài nguyên ${cfg.assetVersion} (phiên bản hiện tại: ${CURRENT_ASSET_VERSION}) — vui lòng kiểm tra lại trước khi đặt mua.`);
  }
  const validWheels = (vehicle && Array.isArray(vehicle.wheels) && vehicle.wheels.length > 0) ? vehicle.wheels : DEFAULT_WHEELS;
  if (cfg.wheelId && !validWheels.some(w => w.id === cfg.wheelId)) {
    issues.push(`Tùy chọn mâm xe "${cfg.wheelId}" hiện không còn trong danh sách hỗ trợ.`);
  }
  if (Array.isArray(cfg.accessoryIds)) {
    AccessoryService.ensureSkusInState(state);
    for (const accId of cfg.accessoryIds) {
      const acc = (state.accessories || []).find(a => a.id === accId || a.sku === accId);
      if (!acc) {
        issues.push(`Phụ kiện "${accId}" không còn tồn tại trong kho.`);
      } else if (vehicle) {
        const fit = AccessoryService.evaluateFitForVehicle(acc, vehicle);
        if (!fit.compatible) {
          issues.push(fit.reason || `Phụ kiện "${acc.name}" không còn tương thích với xe ${cfg.vehicleId}.`);
        }
      }
    }
  }
  return {
    compatibilityStatus: issues.length === 0 ? 'valid' : 'needs_review',
    compatibilityIssues: issues
  };
}

const ConfigurationService = {
  CURRENT_ASSET_VERSION,

  listForUser(user) {
    if (!user || !user.userId) throw createError('Vui lòng đăng nhập.', 401, 'UNAUTHORIZED');
    const items = ConfigurationRepository.findByUserId(user.userId);
    return items.map(cfg => {
      const vehicle = (dbState.vehicles || []).find(v => v.id === cfg.vehicleId) ||
        (dbState.certifiedVehicles || []).find(v => v.id === cfg.vehicleId) || null;
      return {
        ...cfg,
        ...evaluateCompatibility(dbState, cfg, vehicle)
      };
    });
  },

  getById(user, id) {
    if (!user || !user.userId) throw createError('Vui lòng đăng nhập.', 401, 'UNAUTHORIZED');
    const cfg = ConfigurationRepository.findById(id);
    if (!cfg) throw createError('Không tìm thấy cấu hình đã lưu.', 404, 'NOT_FOUND');
    if (cfg.userId !== user.userId && user.role !== ROLES.ADMIN) {
      throw createError('Bạn không có quyền truy cập cấu hình xe của người dùng khác.', 403, 'FORBIDDEN');
    }
    const vehicle = (dbState.vehicles || []).find(v => v.id === cfg.vehicleId) ||
      (dbState.certifiedVehicles || []).find(v => v.id === cfg.vehicleId) || null;
    return {
      ...cfg,
      ...evaluateCompatibility(dbState, cfg, vehicle)
    };
  },

  async saveConfiguration(user, payload = {}, existingId = null) {
    if (!user || !user.userId) {
      throw createError('Vui lòng đăng nhập để lưu cấu hình 3D cá nhân.', 401, 'UNAUTHORIZED');
    }

    const vehicleId = String(payload.vehicleId || '').trim();
    if (!vehicleId && !existingId) {
      throw createError('Vui lòng chọn mẫu xe hợp lệ.', 422, 'VEHICLE_REQUIRED');
    }

    return runInTransaction(async (state) => {
      const collection = ConfigurationRepository.ensureCollection(state);
      let existing = existingId
        ? collection.find(c => c.id === existingId)
        : (payload.replaceForVehicle ? collection.find(c => c.userId === user.userId && c.vehicleId === vehicleId) : null);

      if (existingId && !existing) {
        throw createError('Không tìm thấy cấu hình cần cập nhật.', 404, 'NOT_FOUND');
      }
      if (existing && existing.userId !== user.userId) {
        throw createError('Bạn không có quyền chỉnh sửa cấu hình của người khác.', 403, 'FORBIDDEN');
      }

      if (existing && payload.expectedVersion !== undefined && Number(payload.expectedVersion) !== existing.version) {
        throw createError('Cấu hình xe vừa thay đổi phiên bản. Vui lòng tải lại.', 409, 'VERSION_CONFLICT');
      }

      const targetVehicleId = vehicleId || existing.vehicleId;
      const vehicle = (state.vehicles || []).find(v => v.id === targetVehicleId) ||
        (state.certifiedVehicles || []).find(v => v.id === targetVehicleId);
      if (!vehicle) {
        throw createError(`Mẫu xe "${targetVehicleId}" không tồn tại trong danh mục.`, 404, 'VEHICLE_NOT_FOUND');
      }

      const trimId = payload.trimId !== undefined ? payload.trimId : (existing ? existing.trimId : null);
      let trimDelta = 0;
      let resolvedTrimName = payload.trimName || (existing ? existing.trimName : null);
      if (trimId || resolvedTrimName) {
        if (Array.isArray(vehicle.trims) && vehicle.trims.length > 0) {
          const matchedTrim = vehicle.trims.find(t =>
            (trimId && t.id === trimId) ||
            (resolvedTrimName && String(t.name).toLowerCase() === String(resolvedTrimName).toLowerCase())
          );
          if (!matchedTrim) {
            throw createError(`Phiên bản "${trimId || resolvedTrimName}" không hợp lệ cho ${vehicle.name}.`, 422, 'INVALID_TRIM');
          }
          resolvedTrimName = matchedTrim.name;
          if (Number.isFinite(matchedTrim.price) && matchedTrim.price > 0) {
            trimDelta = Math.round(matchedTrim.price) - Math.round(vehicle.price);
          } else if (Number.isFinite(matchedTrim.priceDelta)) {
            trimDelta = Math.round(matchedTrim.priceDelta);
          }
        }
      }

      const colorIdx = payload.colorIdx !== undefined ? Number(payload.colorIdx) : (existing ? existing.colorIdx : 0);
      if (!Number.isInteger(colorIdx) || colorIdx < 0) {
        throw createError('Chỉ số màu sơn không hợp lệ.', 422, 'INVALID_COLOR');
      }
      const colorsList = Array.isArray(vehicle.colors) ? vehicle.colors : [];
      const chosenColor = colorsList[colorIdx] || colorsList.find(c => c.hex === payload.colorHex) || null;
      const colorHex = Security.sanitizeString((chosenColor && chosenColor.hex) || payload.colorHex || '#0284C7');
      const colorName = Security.sanitizeString((chosenColor && chosenColor.name) || payload.colorName || 'Màu tiêu chuẩn');

      const wheelId = payload.wheelId !== undefined ? String(payload.wheelId) : (existing ? existing.wheelId : 'wheel-21-sport');
      const wheelsPool = (Array.isArray(vehicle.wheels) && vehicle.wheels.length > 0) ? vehicle.wheels : DEFAULT_WHEELS;
      const matchedWheel = wheelsPool.find(w => w.id === wheelId);
      if (!matchedWheel) {
        throw createError(`Tùy chọn mâm xe "${wheelId}" không tồn tại.`, 422, 'INVALID_WHEEL');
      }

      AccessoryService.ensureSkusInState(state);
      const requestedAccessories = Array.isArray(payload.accessoryIds)
        ? payload.accessoryIds
        : (existing && Array.isArray(existing.accessoryIds) ? existing.accessoryIds : []);
      const uniqueAccIds = Array.from(new Set(requestedAccessories.map(x => String(x).trim()).filter(Boolean)));
      let accessoriesTotal = 0;
      for (const accId of uniqueAccIds) {
        const acc = (state.accessories || []).find(a => a.id === accId || a.sku === accId);
        if (!acc) {
          throw createError(`Phụ kiện "${accId}" không tồn tại.`, 422, 'INVALID_ACCESSORY');
        }
        const fit = AccessoryService.evaluateFitForVehicle(acc, vehicle);
        if (!fit.compatible) {
          throw createError(fit.reason || `Phụ kiện "${acc.name}" không tương thích với ${vehicle.name}.`, 422, 'INCOMPATIBLE_ACCESSORY');
        }
        accessoriesTotal += Math.round(Number(acc.price || 0));
      }

      const basePriceVnd = Math.round(Number(vehicle.price || 0));
      const optionsDeltaVnd = trimDelta + Math.round(Number(matchedWheel.price || 0)) + accessoriesTotal;
      const totalPriceVnd = basePriceVnd + optionsDeltaVnd;
      const nowIso = new Date().toISOString();

      const nextRecord = {
        id: existing ? existing.id : `CFG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        userId: user.userId,
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        vehicleImage: vehicle.image || null,
        trimId: trimId || null,
        trimName: resolvedTrimName || null,
        colorIdx,
        colorName,
        colorHex,
        wheelId: matchedWheel.id,
        wheelName: matchedWheel.name,
        wheelDeltaVnd: Math.round(Number(matchedWheel.price || 0)),
        accessoryIds: uniqueAccIds,
        assetVersion: CURRENT_ASSET_VERSION,
        version: existing ? (existing.version || 1) + 1 : 1,
        basePriceVnd,
        optionsDeltaVnd,
        totalPriceVnd,
        compatibilityStatus: 'valid',
        compatibilityIssues: [],
        createdAt: existing ? existing.createdAt : nowIso,
        updatedAt: nowIso
      };

      if (existing) {
        Object.assign(existing, nextRecord);
        return existing;
      }
      collection.unshift(nextRecord);
      return nextRecord;
    });
  },

  async deleteConfiguration(user, id) {
    if (!user || !user.userId) throw createError('Vui lòng đăng nhập.', 401, 'UNAUTHORIZED');
    return runInTransaction(async (state) => {
      const col = ConfigurationRepository.ensureCollection(state);
      const idx = col.findIndex(c => c.id === id);
      if (idx === -1) throw createError('Không tìm thấy cấu hình cần xóa.', 404, 'NOT_FOUND');
      if (col[idx].userId !== user.userId && user.role !== ROLES.ADMIN) {
        throw createError('Bạn không có quyền xóa cấu hình của người dùng khác.', 403, 'FORBIDDEN');
      }
      const [removed] = col.splice(idx, 1);
      return removed;
    });
  }
};

module.exports = ConfigurationService;
