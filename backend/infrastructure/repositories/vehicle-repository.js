// backend/infrastructure/repositories/vehicle-repository.js
// VehicleRepository interface & implementation

const { dbState, runInTransaction } = require('../storage-engine');

const VehicleRepository = {
  async findAll({ category, fuel, minPrice, maxPrice, search, sort, type } = {}) {
    if (type === 'certified') {
      return this.findCertified({ maxPrice, search });
    }

    let list = dbState.vehicles.map(v => {
      let vFuel = v.fuel ? v.fuel.toLowerCase() : '';
      if (!vFuel) {
        const pt = (v.powertrain || '').toLowerCase();
        vFuel = (pt.includes('điện') || pt.includes('electric') || v.id.startsWith('model-') || v.id.startsWith('vision-') || v.id.startsWith('city-') || v.id.startsWith('grand-') || v.id.startsWith('x-series') || v.id.startsWith('aero-') || v.id.startsWith('horizon-') || v.id.startsWith('vinfast-')) ? 'ev' : 'gas';
      }
      return {
        ...v,
        fuel: vFuel,
        condition: 'new',
        type: 'new',
        stockQuantity: v.stock ?? 10
      };
    });

    if (category && category !== 'all') {
      const targetCat = category.toLowerCase().trim();
      list = list.filter(v => {
        const cCat = (v.category || '').toLowerCase().trim();
        if (cCat === targetCat) return true;
        if (targetCat === 'compact' && (cCat.includes('compact') || cCat.includes('mpv') || cCat.includes('hatchback') || cCat.includes('đô thị'))) return true;
        if (targetCat === 'suv' && (cCat.includes('suv') || cCat.includes('crossover'))) return true;
        return false;
      });
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

    if (search && typeof search === 'string') {
      const q = search.toLowerCase().trim();
      list = list.filter(v => v.name.toLowerCase().includes(q) || (v.subtitle && v.subtitle.toLowerCase().includes(q)));
    }

    if (fuel && fuel !== 'all') {
      const fLower = fuel.toLowerCase();
      list = list.filter(v => {
        let vFuel = v.fuel ? v.fuel.toLowerCase() : '';
        if (!vFuel) {
          const pt = (v.powertrain || '').toLowerCase();
          vFuel = (pt.includes('điện') || pt.includes('electric') || v.id.startsWith('model-') || v.id.startsWith('vision-') || v.id.startsWith('city-') || v.id.startsWith('grand-') || v.id.startsWith('x-series') || v.id.startsWith('aero-') || v.id.startsWith('horizon-') || v.id.startsWith('vinfast-')) ? 'ev' : 'gas';
        }
        return vFuel === fLower;
      });
    }

    // Sorting
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
      list.sort((a, b) => b.range - a.range);
    }

    return list;
  },

  async findCertified({ maxOdo, maxPrice, search } = {}) {
    let list = dbState.certifiedVehicles.map(v => ({
      ...v,
      condition: 'certified',
      type: 'certified',
      stockQuantity: v.stock ?? 1
    }));

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
    const cleanId = id.toLowerCase().replace(/^sigma-/, '');
    const found = dbState.vehicles.find(v => v.id === id || v.id === cleanId) || 
                  dbState.certifiedVehicles.find(v => v.id === id || v.id === cleanId) || 
                  null;
    if (found) {
      return {
        ...found,
        condition: found.condition || (found.vin ? 'certified' : 'new'),
        stockQuantity: found.stock ?? 10
      };
    }
    return null;
  },

  // Atomic inventory check and reservation
  async reserveInventory(vehicleId, quantity = 1) {
    return runInTransaction(async (state) => {
      const cleanId = vehicleId.toLowerCase().replace(/^sigma-/, '');
      let target = state.vehicles.find(v => v.id === vehicleId || v.id === cleanId) ||
                   state.certifiedVehicles.find(v => v.id === vehicleId || v.id === cleanId);

      if (!target) {
        throw new Error(`Không tìm thấy mẫu xe có mã "${vehicleId}".`);
      }

      if (target.stock < quantity) {
        throw new Error(`Mẫu xe "${target.name}" hiện không đủ số lượng trong kho (Còn lại: ${target.stock} xe).`);
      }

      target.stock -= quantity;
      if (target.stock === 0) {
        target.isAvailable = false;
      }
      return target;
    });
  },

  // Restore inventory if order cancelled
  async restoreInventory(vehicleId, quantity = 1) {
    return runInTransaction(async (state) => {
      const cleanId = vehicleId.toLowerCase().replace(/^sigma-/, '');
      let target = state.vehicles.find(v => v.id === vehicleId || v.id === cleanId) ||
                   state.certifiedVehicles.find(v => v.id === vehicleId || v.id === cleanId);
      if (target) {
        target.stock += quantity;
        target.isAvailable = true;
      }
      return target;
    });
  },

  // Dynamic Add Vehicle (Auto-Learned by Live RAG)
  async create(vehicleData) {
    return runInTransaction(async (state) => {
      const id = vehicleData.id || ('car-' + Date.now());
      const newCar = {
        ...vehicleData,
        id,
        stock: vehicleData.stock ?? 10,
        stockQuantity: vehicleData.stockQuantity ?? 10,
        isAvailable: true
      };
      state.vehicles.push(newCar);
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

  // Dynamic Update Vehicle (Auto-Updated in Live RAG)
  async update(id, updates) {
    return runInTransaction(async (state) => {
      const cleanId = id.toLowerCase().replace(/^sigma-/, '');
      const idx = state.vehicles.findIndex(v => v.id === id || v.id === cleanId);
      if (idx === -1) {
        throw new Error(`Không tìm thấy mẫu xe có mã "${id}".`);
      }
      state.vehicles[idx] = { ...state.vehicles[idx], ...updates };
      const updated = state.vehicles[idx];
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

  // Dynamic Delete Vehicle (Auto-Removed from Live RAG)
  async delete(id) {
    return runInTransaction(async (state) => {
      const cleanId = id.toLowerCase().replace(/^sigma-/, '');
      const idx = state.vehicles.findIndex(v => v.id === id || v.id === cleanId);
      if (idx === -1) {
        throw new Error(`Không tìm thấy mẫu xe có mã "${id}".`);
      }
      const removed = state.vehicles.splice(idx, 1)[0];
      try {
        const AIService = require('../../application/ai-service');
        if (AIService && AIService.removeVehicle) {
          AIService.removeVehicle(id);
        }
      } catch (e) {
        // AI sync non-blocking
      }
      return removed;
    });
  }
};

module.exports = VehicleRepository;
