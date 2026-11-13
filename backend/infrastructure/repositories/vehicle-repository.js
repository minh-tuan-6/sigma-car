// backend/infrastructure/repositories/vehicle-repository.js
// VehicleRepository interface & implementation

const { dbState, runInTransaction } = require('../storage-engine');
const { SHOWROOM_BRANCHES } = require('../../domain/constants');
const Security = require('../security');
const FinancingService = require('../../application/financing-service');
const InventoryRepository = require('./inventory-repository');

const WRITABLE_VEHICLE_FIELDS = [
  'productCode', 'name', 'brand', 'version', 'subtitle', 'type', 'category',
  'subCategory', 'fuel', 'powertrain', 'price', 'priceFormatted', 'priceShort',
  'salePrice', 'salePriceFormatted', 'priceNote', 'badge', 'range', 'rangeExtendedKm',
  'batteryKwh', 'hp', 'torque', 'accel0to100', 'topSpeed', 'seats', 'image',
  'gallery', 'colors', 'editions', 'model3d', 'modelPath', 'specs', 'highlights',
  'stock', 'isAvailable', 'archived', 'condition', 'description'
];

function pickWhitelistedVehicleFields(data = {}) {
  const out = {};
  for (const key of WRITABLE_VEHICLE_FIELDS) {
    if (data[key] !== undefined) {
      out[key] = typeof data[key] === 'string' && !key.toLowerCase().includes('image') && !key.toLowerCase().includes('model')
        ? Security.sanitizeString(data[key])
        : data[key];
    }
  }
  return out;
}

function extractBatteryKwh(v) {
  if (!v) return 0;
  if (typeof v.batteryKwh === 'number' && Number.isFinite(v.batteryKwh)) return v.batteryKwh;
  const raw = `${v.evSpecs?.batteryCapacity || ''} ${v.battery || ''}`;
  const m = raw.match(/(\d+(?:[.,]\d+)?)\s*kwh/i);
  if (!m) return 0;
  const val = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(val) ? val : 0;
}

const VehicleRepository = {
  async findAll({
    category, fuel, brand, minPrice, maxPrice, minRange, maxRange,
    minBatteryKwh, maxMonthlyPayment, usage, inStock, search, sort, type, includeArchived
  } = {}) {
    if (type === 'certified') {
      return this.findCertified({ maxPrice, search });
    }

    let list = dbState.vehicles
      .filter(v => includeArchived || !v.archived)
      .map(v => {
        let vFuel = v.fuel ? v.fuel.toLowerCase() : '';
        if (!vFuel) {
          const pt = (v.powertrain || '').toLowerCase();
          vFuel = (pt.includes('điện') || pt.includes('electric') || v.id.startsWith('model-') || v.id.startsWith('vision-') || v.id.startsWith('city-') || v.id.startsWith('grand-') || v.id.startsWith('x-series') || v.id.startsWith('aero-') || v.id.startsWith('horizon-') || v.id.startsWith('vinfast-')) ? 'ev' : 'gas';
        }
        const branchRows = (dbState.branchInventory || []).filter(r => r.vehicleId === v.id);
        const branchStock = branchRows.length > 0
          ? branchRows.reduce((s, r) => s + Math.max(0, (r.stockOnHand || 0) - (r.reservedQty || 0)), 0)
          : (v.stock ?? 5);
        return {
          ...v,
          fuel: vFuel,
          condition: 'new',
          type: 'new',
          stock: branchStock,
          stockQuantity: branchStock
        };
      });

    if (category && category !== 'all') {
      const targetCat = category.toLowerCase().trim();
      list = list.filter(v => {
        const cCat = (v.category || '').toLowerCase().trim();
        const sCat = (v.subCategory || '').toLowerCase().trim();
        if (cCat === targetCat) return true;
        if (targetCat === 'compact' && (cCat.includes('compact') || cCat.includes('mpv') || cCat.includes('hatchback') || cCat.includes('đô thị'))) return true;
        if (targetCat === 'suv' && (cCat.includes('suv') || cCat.includes('crossover'))) return true;
        if ((targetCat === 'pickup' || targetCat === 'bán tải') && (cCat.includes('pickup') || cCat.includes('bán tải') || sCat.includes('pickup') || sCat.includes('bán tải'))) return true;
        if (targetCat === 'mpv' && (cCat.includes('mpv') || sCat.includes('mpv'))) return true;
        return false;
      });
    }

    if (brand && brand !== 'all') {
      const targetBrand = brand.toLowerCase().trim();
      list = list.filter(v => (v.brand || '').toLowerCase() === targetBrand || (v.brand || '').toLowerCase().includes(targetBrand));
    }

    if (minPrice !== undefined && !isNaN(minPrice)) {
      list = list.filter(v => {
        const p = typeof v.price === 'number' ? v.price : parseFloat(String(v.price).replace(/[^\d.]/g, ''));
        return !isNaN(p) && p >= minPrice;
      });
    }

    if (maxPrice !== undefined && !isNaN(maxPrice)) {
      list = list.filter(v => {
        const p = typeof v.price === 'number' ? v.price : parseFloat(String(v.price).replace(/[^\d.]/g, ''));
        return !isNaN(p) && p <= maxPrice;
      });
    }

    if (maxMonthlyPayment !== undefined && Number.isFinite(maxMonthlyPayment) && maxMonthlyPayment > 0) {
      list = list.filter(v => {
        if (!Number.isFinite(v.price) || v.price <= 0) return false;
        const loan = FinancingService.calculateLoan({
          vehiclePrice: v.price,
          downPaymentPercent: 30,
          annualInterestRatePercent: 7.9,
          termMonths: 60
        });
        return loan.monthlyPayment <= maxMonthlyPayment;
      });
    }

    if (usage && usage !== 'all') {
      const uLow = String(usage).toLowerCase().trim();
      list = list.filter(v => {
        const cat = `${v.category || ''} ${v.subCategory || ''}`.toLowerCase();
        if (uLow === 'city' || uLow === 'urban') return (v.seats || 5) <= 5 && (v.price <= 1500000000 || cat.includes('compact') || cat.includes('hatchback') || cat.includes('sedan'));
        if (uLow === 'family') return (v.seats || 5) >= 5 && (cat.includes('suv') || cat.includes('mpv') || cat.includes('crossover') || cat.includes('sedan'));
        if (uLow === 'performance' || uLow === 'sport') return (v.hp || 0) >= 300 || cat.includes('sport') || cat.includes('hypercar') || cat.includes('supercar') || cat.includes('coupe');
        if (uLow === 'offroad' || uLow === 'pickup') return cat.includes('pickup') || cat.includes('suv') || (v.drive || '').toLowerCase().includes('awd') || (v.drive || '').toLowerCase().includes('4wd');
        if (uLow === 'luxury') return v.price >= 4000000000 || cat.includes('luxury') || cat.includes('siêu sang');
        return true;
      });
    }

    if (inStock === true || inStock === 'true' || inStock === '1') {
      list = list.filter(v => (v.stock ?? 0) > 0);
    }

    if (minRange !== undefined && !isNaN(minRange)) {
      list = list.filter(v => Number.isFinite(v.range) && v.range >= minRange);
    }

    if (maxRange !== undefined && !isNaN(maxRange)) {
      list = list.filter(v => Number.isFinite(v.range) && v.range <= maxRange);
    }

    if (minBatteryKwh !== undefined && !isNaN(minBatteryKwh)) {
      list = list.filter(v => extractBatteryKwh(v) >= minBatteryKwh);
    }

    if (search && typeof search === 'string') {
      const q = search.toLowerCase().trim();
      list = list.filter(v =>
        (v.name && v.name.toLowerCase().includes(q)) ||
        (v.brand && v.brand.toLowerCase().includes(q)) ||
        (v.subtitle && v.subtitle.toLowerCase().includes(q)) ||
        (v.productCode && v.productCode.toLowerCase().includes(q))
      );
    }

    if (fuel && fuel !== 'all') {
      const fLower = fuel.toLowerCase();
      list = list.filter(v => {
        const vFuel = (v.fuel || '').toLowerCase();
        if (fLower === 'gas') {
          return vFuel === 'gas' || vFuel === 'diesel' || vFuel === 'hybrid';
        }
        return vFuel === fLower;
      });
    }

    const getNumPrice = v => (typeof v.price === 'number' ? v.price : parseFloat(String(v.price).replace(/[^\d.]/g, '')) || 0);
    if (sort === 'price-asc') {
      list.sort((a, b) => getNumPrice(a) - getNumPrice(b));
    } else if (sort === 'price-desc') {
      list.sort((a, b) => getNumPrice(b) - getNumPrice(a));
    } else if (sort === 'name-asc') {
      list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi', { sensitivity: 'base' }));
    } else if (sort === 'name-desc') {
      list.sort((a, b) => (b.name || '').localeCompare(a.name || '', 'vi', { sensitivity: 'base' }));
    } else if (sort === 'range-desc') {
      list.sort((a, b) => (b.range || 0) - (a.range || 0));
    } else if (sort === 'hp-desc') {
      list.sort((a, b) => (b.hp || 0) - (a.hp || 0));
    }

    return list;
  },

  async findPaginated(filters = {}) {
    const allItems = await this.findAll(filters);
    const page = Math.max(1, parseInt(filters.page, 10) || 1);
    const pageSize = Math.min(48, Math.max(1, parseInt(filters.pageSize, 10) || 12));
    const total = allItems.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const startIdx = (safePage - 1) * pageSize;
    const items = allItems.slice(startIdx, startIdx + pageSize);
    return {
      items,
      pagination: {
        page: safePage,
        pageSize,
        total,
        totalPages,
        hasMore: safePage < totalPages
      }
    };
  },

  async findCertified({ maxOdo, maxPrice, search } = {}) {
    let list = dbState.certifiedVehicles.map(v => ({
      ...v,
      condition: 'certified',
      type: 'certified',
      stockQuantity: v.stock ?? 1
    }));

    if (maxOdo !== undefined && !isNaN(maxOdo)) {
      list = list.filter(v => (v.odoNum || 0) <= maxOdo);
    }

    if (maxPrice !== undefined && !isNaN(maxPrice)) {
      list = list.filter(v => v.price <= maxPrice);
    }

    if (search) {
      const q = search.toLowerCase().trim();
      list = list.filter(v => v.name.toLowerCase().includes(q) || (v.vin && v.vin.toLowerCase().includes(q)));
    }

    return list;
  },

  async findById(id) {
    if (!id) return null;
    const cleanId = String(id).toLowerCase().replace(/^sigma-/, '');
    const found = dbState.vehicles.find(v => v.id === id || v.id === cleanId) ||
                  dbState.certifiedVehicles.find(v => v.id === id || v.id === cleanId) ||
                  null;
    if (found) {
      const branchRows = (dbState.branchInventory || []).filter(r => r.vehicleId === found.id);
      const branchAvailability = branchRows.map(r => {
        const branch = SHOWROOM_BRANCHES.find(b => b.id === r.branchId);
        return {
          branchId: r.branchId,
          branchName: branch ? branch.name : r.branchId,
          city: branch ? branch.city : '',
          stockOnHand: r.stockOnHand || 0,
          reservedQty: r.reservedQty || 0,
          availableQty: Math.max(0, (r.stockOnHand || 0) - (r.reservedQty || 0)),
          version: r.version || 1
        };
      });
      const totalAvail = branchAvailability.length > 0
        ? branchAvailability.reduce((s, r) => s + r.availableQty, 0)
        : (found.stock ?? (found.vin ? 1 : 5));
      return {
        ...found,
        condition: found.condition || (found.vin ? 'certified' : 'new'),
        stock: totalAvail,
        stockQuantity: totalAvail,
        branchAvailability
      };
    }
    return null;
  },

  async findRelated(id, limit = 3) {
    const target = await this.findById(id);
    if (!target) return [];
    const pool = target.condition === 'certified' ? dbState.certifiedVehicles : dbState.vehicles;
    const candidates = pool.filter(v => v.id !== target.id && !v.archived);
    candidates.sort((a, b) => {
      const aScore = (a.category === target.category ? 2 : 0) + (a.fuel === target.fuel ? 1 : 0);
      const bScore = (b.category === target.category ? 2 : 0) + (b.fuel === target.fuel ? 1 : 0);
      if (bScore !== aScore) return bScore - aScore;
      return Math.abs((a.price || 0) - (target.price || 0)) - Math.abs((b.price || 0) - (target.price || 0));
    });
    return candidates.slice(0, limit);
  },

  // Atomic inventory check and reservation (delegated to branch ledger)
  async reserveInventory(vehicleId, quantity = 1, branchId = 'hn-caugiay') {
    if (!Number.isInteger(quantity) || quantity < 1) {
      const err = new Error('Số lượng giữ kho phải là số nguyên dương.');
      err.statusCode = 400;
      throw err;
    }
    return runInTransaction(async (state) => {
      const res = InventoryRepository.reserveStockInState(state, {
        vehicleId,
        branchId,
        quantity,
        userId: 'order_reserve'
      });
      return res.vehicle;
    });
  },

  // Restore inventory if order cancelled (syncs both aggregate and branch row)
  async restoreInventory(vehicleId, quantity = 1, branchId = 'hn-caugiay') {
    if (!Number.isInteger(quantity) || quantity < 1) {
      return null;
    }
    return runInTransaction(async (state) => {
      const found = InventoryRepository.findVehicleRecordInState(state, vehicleId);
      if (!found) return null;
      const rows = InventoryRepository.ensureBranchRowsInState(state, found.record.id);
      const row = rows.find(r => r.branchId === branchId) || rows[0];
      if (row) {
        if ((row.reservedQty || 0) >= quantity) {
          row.reservedQty -= quantity;
        } else {
          row.stockOnHand = (row.stockOnHand || 0) + quantity;
        }
        row.version = (row.version || 1) + 1;
        row.updatedAt = new Date().toISOString();
        InventoryRepository.appendMovementInState(state, {
          vehicleId: found.record.id,
          branchId: row.branchId,
          delta: quantity,
          reason: 'RESTORE_INVENTORY',
          actorId: 'system',
          versionAfter: row.version
        });
      }
      InventoryRepository.syncAggregateVehicleStockInState(state, found.record.id);
      return found.record;
    });
  },

  // Dynamic Add Vehicle with strict schema whitelist & finite bounds validation
  async create(vehicleData) {
    return runInTransaction(async (state) => {
      const safe = pickWhitelistedVehicleFields(vehicleData);
      if (!safe.name) {
        const err = new Error('Tên mẫu xe không được để trống.');
        err.statusCode = 400;
        throw err;
      }
      const numPrice = Number(safe.price);
      if (!Number.isFinite(numPrice) || numPrice <= 0) {
        const err = new Error('Giá bán xe phải là số dương hợp lệ.');
        err.statusCode = 400;
        throw err;
      }
      const stockNum = safe.stock !== undefined ? Number(safe.stock) : 10;
      if (!Number.isInteger(stockNum) || stockNum < 0 || stockNum > 10000) {
        const err = new Error('Số lượng tồn kho phải là số nguyên từ 0 đến 10.000.');
        err.statusCode = 400;
        throw err;
      }

      const rawId = vehicleData.id ? String(vehicleData.id).toLowerCase().replace(/[^a-z0-9-_]/g, '') : '';
      const id = rawId && !state.vehicles.some(v => v.id === rawId)
        ? rawId
        : `car-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;

      const newCar = {
        ...safe,
        id,
        price: numPrice,
        priceFormatted: safe.priceFormatted || `${numPrice.toLocaleString('vi-VN').replace(/,/g, '.')} VNĐ`,
        priceShort: safe.priceShort || (numPrice >= 1e9 ? `${(numPrice / 1e9).toFixed(2).replace(/\.?0+$/, '')} tỷ` : `${Math.round(numPrice / 1e6)} triệu`),
        stock: stockNum,
        stockQuantity: stockNum,
        isAvailable: stockNum > 0,
        archived: false,
        createdAt: new Date().toISOString()
      };
      state.vehicles.push(newCar);
      InventoryRepository.ensureBranchRowsInState(state, newCar.id);
      InventoryRepository.appendMovementInState(state, {
        vehicleId: newCar.id,
        branchId: 'hn-caugiay',
        delta: stockNum,
        reason: 'VEHICLE_CREATED',
        actorId: safe.createdBy || 'staff',
        versionAfter: 1
      });
      try {
        const AIService = require('../../application/ai-service');
        if (AIService && AIService.learnVehicle) {
          AIService.learnVehicle(newCar);
        }
      } catch (e) {
        // AI sync non-blocking
      }
      return newCar;
    });
  },

  // Dynamic Update Vehicle with immutable id and strict schema validation
  async update(id, updates) {
    return runInTransaction(async (state) => {
      const cleanId = String(id).toLowerCase().replace(/^sigma-/, '');
      const idx = state.vehicles.findIndex(v => v.id === id || v.id === cleanId);
      if (idx === -1) {
        const err = new Error(`Không tìm thấy mẫu xe có mã "${id}".`);
        err.statusCode = 404;
        throw err;
      }

      const safe = pickWhitelistedVehicleFields(updates);
      if (safe.price !== undefined) {
        const numPrice = Number(safe.price);
        if (!Number.isFinite(numPrice) || numPrice <= 0) {
          const err = new Error('Giá bán xe phải là số dương hợp lệ.');
          err.statusCode = 400;
          throw err;
        }
        safe.price = numPrice;
      }
      if (safe.stock !== undefined) {
        const stockNum = Number(safe.stock);
        if (!Number.isInteger(stockNum) || stockNum < 0 || stockNum > 10000) {
          const err = new Error('Số lượng tồn kho phải là số nguyên từ 0 đến 10.000.');
          err.statusCode = 400;
          throw err;
        }
        safe.stock = stockNum;
        safe.stockQuantity = stockNum;
        safe.isAvailable = stockNum > 0;
      }

      state.vehicles[idx] = {
        ...state.vehicles[idx],
        ...safe,
        id: state.vehicles[idx].id,
        updatedAt: new Date().toISOString()
      };
      const updated = state.vehicles[idx];
      if (safe.stock !== undefined) {
        const rows = InventoryRepository.ensureBranchRowsInState(state, updated.id);
        const curAvail = rows.reduce((s, r) => s + Math.max(0, (r.stockOnHand || 0) - (r.reservedQty || 0)), 0);
        const diff = safe.stock - curAvail;
        if (diff !== 0 && rows.length > 0) {
          const primaryRow = rows.find(r => r.branchId === 'hn-caugiay') || rows[0];
          primaryRow.stockOnHand = Math.max(primaryRow.reservedQty || 0, (primaryRow.stockOnHand || 0) + diff);
          primaryRow.version = (primaryRow.version || 1) + 1;
          primaryRow.updatedAt = new Date().toISOString();
          InventoryRepository.appendMovementInState(state, {
            vehicleId: updated.id,
            branchId: primaryRow.branchId,
            delta: diff,
            reason: 'VEHICLE_STOCK_SYNC',
            actorId: 'staff',
            versionAfter: primaryRow.version
          });
        }
        InventoryRepository.syncAggregateVehicleStockInState(state, updated.id);
      }
      try {
        const AIService = require('../../application/ai-service');
        if (AIService && AIService.learnVehicle) {
          AIService.learnVehicle(updated);
        }
      } catch (e) {
        // AI sync non-blocking
      }
      return updated;
    });
  },

  // Archive or remove vehicle while preserving historical order integrity
  async delete(id) {
    return runInTransaction(async (state) => {
      const cleanId = String(id).toLowerCase().replace(/^sigma-/, '');
      const idx = state.vehicles.findIndex(v => v.id === id || v.id === cleanId);
      if (idx === -1) {
        const err = new Error(`Không tìm thấy mẫu xe có mã "${id}".`);
        err.statusCode = 404;
        throw err;
      }

      const target = state.vehicles[idx];
      const hasOrders = (state.orders || []).some(o => o.vehicleId === target.id || o.vehicleId === id);
      let result;
      if (hasOrders) {
        // Preserve referential integrity for existing orders via soft-archive
        target.archived = true;
        target.isAvailable = false;
        target.stock = 0;
        target.stockQuantity = 0;
        target.archivedAt = new Date().toISOString();
        result = target;
      } else {
        result = state.vehicles.splice(idx, 1)[0];
      }

      try {
        const AIService = require('../../application/ai-service');
        if (AIService && AIService.removeVehicle) {
          AIService.removeVehicle(target.id);
        }
      } catch (e) {
        // AI sync non-blocking
      }
      return result;
    });
  }
};

module.exports = VehicleRepository;
