// backend/application/accessory-service.js
// Normalized Accessory & EV Component Catalog with Typed Compatibility Matrix (SIG-P3-010)

const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const Security = require('../infrastructure/security');

// PLAN T4.3: admin catalog management (create / update / archive). Shared field normaliser.
function accessoryError(message, statusCode = 400, code = 'ACCESSORY_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function normalizeAccessoryInput(data = {}, { partial = false } = {}) {
  const out = {};
  const str = (v, max) => Security.sanitizeString(String(v)).slice(0, max);
  if (!partial || data.name !== undefined) {
    if (!data.name || String(data.name).trim().length < 3) throw accessoryError('Tên phụ kiện tối thiểu 3 ký tự.', 400, 'VALIDATION_ERROR');
    out.name = str(data.name, 160);
  }
  if (!partial || data.price !== undefined) {
    const price = Number(data.price);
    if (!Number.isFinite(price) || price <= 0 || price > 10000000000) throw accessoryError('Giá phụ kiện phải là số dương hợp lệ.', 400, 'VALIDATION_ERROR');
    out.price = Math.round(price);
    out.priceFormatted = `${out.price.toLocaleString('vi-VN')} VNĐ`;
  }
  if (data.quantity !== undefined || !partial) {
    const qty = data.quantity === undefined ? 0 : Number(data.quantity);
    if (!Number.isInteger(qty) || qty < 0 || qty > 100000) throw accessoryError('Số lượng tồn phải là số nguyên >= 0.', 400, 'VALIDATION_ERROR');
    out.quantity = qty;
  }
  for (const [k, max] of [['brand', 80], ['category', 80], ['specs', 400], ['color', 60], ['badge', 40]]) {
    if (data[k] !== undefined) out[k] = str(data[k], max);
  }
  if (data.image !== undefined) {
    if (data.image && !/^(?:\/)?assets\/[A-Za-z0-9_\-./]+\.(jpg|jpeg|png|webp)$/i.test(String(data.image))) {
      throw accessoryError('Ảnh phụ kiện phải là tệp trong thư mục assets/.', 400, 'VALIDATION_ERROR');
    }
    out.image = data.image || 'assets/garage-car-detail.jpg';
  }
  if (data.compatibility !== undefined) {
    const list = Array.isArray(data.compatibility) ? data.compatibility : [data.compatibility];
    out.compatibility = list.map(x => str(x, 80)).filter(Boolean).slice(0, 50);
    if (out.compatibility.length === 0) out.compatibility = ['all'];
  }
  if (data.warrantyMonths !== undefined) {
    const w = Number(data.warrantyMonths);
    if (!Number.isInteger(w) || w < 0 || w > 120) throw accessoryError('Bảo hành (tháng) không hợp lệ.', 400, 'VALIDATION_ERROR');
    out.warrantyMonths = w;
  }
  return out;
}

const TYPED_COMPATIBILITY_RULES = {
  'ACC-001': { anyVehicle: true, note: 'Tương thích phổ thông mọi xe sử dụng nguồn tẩu / USB-C 12V' },
  'ACC-002': { categories: ['SUV', 'Sedan', 'Hatchback', 'Compact', 'Sports', 'Coupe', 'Pickup'], excludedIds: [], note: 'Cắt CNC riêng theo mã khung sàn 5 chỗ/7 chỗ (cần xác nhận phiên bản khi lắp đặt)' },
  'ACC-003': { anyVehicle: true, note: 'Phim dán toàn bộ kính xe, tương thích mọi dòng xe' },
  'ACC-004': { anyVehicle: true, note: 'Nguồn 12V tiêu chuẩn tương thích mọi dòng xe' },
  'ACC-005': { anyVehicle: true, note: 'Tương thích van lốp tiêu chuẩn không săm (Tubeless)' },
  'ACC-006': { anyVehicle: true, note: 'Chuẩn tẩu 12V-24V tương thích mọi dòng xe' },
  'ACC-007': { anyVehicle: true, note: 'Đặt taplo/hộc gió phù hợp mọi nội thất' },
  'ACC-008': { fuelTypes: ['gas', 'ice', 'hybrid'], note: 'Bộ kích bình ắc quy động cơ đốt trong & Hybrid (xe thuần điện sử dụng pin HV không khuyến nghị kích dòng khởi động trực tiếp)' },
  // 11 VinFast / EV components migrated from static list into structured queryable catalog
  'CMP-BAT-VF5': { vehicleIds: ['vinfast-vf5'], fuelTypes: ['ev'], kind: 'component', price: 89000000, stock: 2, warrantyMonths: 96, note: 'Chính hãng dành riêng cho VinFast VF 5 (37.23 kWh)' },
  'CMP-BAT-VF6': { vehicleIds: ['vinfast-vf6'], fuelTypes: ['ev'], kind: 'component', price: 118000000, stock: 2, warrantyMonths: 96, note: 'Chính hãng dành riêng cho VinFast VF 6 Eco/Plus (59.6 kWh)' },
  'CMP-BAT-VF7': { vehicleIds: ['vinfast-vf7'], fuelTypes: ['ev'], kind: 'component', price: 122000000, stock: 2, warrantyMonths: 96, note: 'Chính hãng dành riêng cho VinFast VF 7 Eco (59.6 kWh)' },
  'CMP-BAT-VF8': { vehicleIds: ['vinfast-vf8'], fuelTypes: ['ev'], kind: 'component', price: 165000000, stock: 1, warrantyMonths: 96, note: 'Chính hãng dành riêng cho VinFast VF 8 Eco/Plus (87.7 kWh)' },
  'CMP-BAT-VF8AN': { vehicleIds: ['vinfast-vf8'], fuelTypes: ['ev'], kind: 'component', price: 145000000, stock: 2, warrantyMonths: 96, note: 'Dành cho VinFast VF 8 Thế hệ mới (60.13 kWh)' },
  'CMP-BAT-VF9': { vehicleIds: ['vinfast-vf9'], fuelTypes: ['ev'], kind: 'component', price: 215000000, stock: 2, warrantyMonths: 96, note: 'Chính hãng dành riêng cho VinFast VF 9 Eco/Plus (123 kWh)' },
  'CMP-BAT-MPV7': { vehicleIds: ['vinfast-mpv7'], fuelTypes: ['ev'], kind: 'component', price: 132000000, stock: 1, warrantyMonths: 96, note: 'Dành cho VinFast VF MPV 7 (60.13 kWh)' },
  'CMP-BRAKE-MPV7': { vehicleIds: ['vinfast-mpv7'], kind: 'component', price: 18500000, stock: 4, warrantyMonths: 24, note: 'Cụm phanh trước/sau chính hãng cho VF MPV 7' },
  'CMP-CHARGER-VF5': { vehicleIds: ['vinfast-vf5'], fuelTypes: ['ev'], kind: 'component', price: 7900000, stock: 12, warrantyMonths: 24, note: 'Tương thích chuẩn AC 6.6kW / DC 50kW cho VF 5' },
  'CMP-CHARGER-VF6': { vehicleIds: ['vinfast-vf6'], fuelTypes: ['ev'], kind: 'component', price: 11500000, stock: 10, warrantyMonths: 24, note: 'Tương thích chuẩn AC 7.2kW / DC 100kW cho VF 6' },
  'CMP-CHARGER-MPV7': { vehicleIds: ['vinfast-mpv7'], fuelTypes: ['ev'], kind: 'component', price: 12500000, stock: 8, warrantyMonths: 24, note: 'Bộ sạc nhanh DC 80kW dành cho VF MPV 7' }
};

function evaluateFitForVehicle(item, vehicle) {
  if (!vehicle) {
    return { fitStatus: 'unknown', compatible: null, fitReason: 'Chưa chọn mẫu xe cụ thể để đối chiếu tương thích.' };
  }
  const rule = item.compatibilityRule || TYPED_COMPATIBILITY_RULES[item.id] || null;
  if (!rule) {
    if (Array.isArray(item.compatibility) && item.compatibility.length > 0 && !item.compatibility.includes('all')) {
      const ok = item.compatibility.includes(vehicle.id);
      return {
        fitStatus: ok ? 'compatible' : 'incompatible',
        compatible: ok,
        fitReason: ok ? `Khớp danh sách xe hỗ trợ (${vehicle.name}).` : `Không nằm trong danh sách mẫu xe tương thích cho "${item.name}".`
      };
    }
    return { fitStatus: 'unknown', compatible: null, fitReason: 'Chưa có thông số tương thích xác thực cho mã SKU này.' };
  }

  if (Array.isArray(rule.excludedIds) && rule.excludedIds.includes(vehicle.id)) {
    return { fitStatus: 'incompatible', compatible: false, fitReason: rule.note || `Không tương thích với ${vehicle.name}.` };
  }
  if (Array.isArray(rule.vehicleIds) && rule.vehicleIds.length > 0) {
    const ok = rule.vehicleIds.includes(vehicle.id);
    return {
      fitStatus: ok ? 'compatible' : 'incompatible',
      compatible: ok,
      fitReason: ok ? (rule.note || `Tương thích chính hãng cho ${vehicle.name}.`) : `Chỉ tương thích với ${rule.vehicleIds.join(', ')} (không khớp ${vehicle.name}).`
    };
  }
  if (Array.isArray(rule.fuelTypes) && rule.fuelTypes.length > 0) {
    const vFuel = String(vehicle.fuel || '').toLowerCase();
    const normalizedFuel = vFuel === 'gas' || vFuel === 'ice' ? 'gas' : vFuel;
    const ok = rule.fuelTypes.includes(vFuel) || rule.fuelTypes.includes(normalizedFuel);
    return {
      fitStatus: ok ? 'compatible' : 'incompatible',
      compatible: ok,
      fitReason: ok ? (rule.note || `Phù hợp hệ truyền động ${vFuel.toUpperCase()}.`) : (rule.note || `Không hỗ trợ cho xe hệ truyền động ${vFuel.toUpperCase()}.`)
    };
  }
  if (rule.anyVehicle) {
    return { fitStatus: 'compatible', compatible: true, fitReason: rule.note || 'Tương thích phổ thông mọi dòng xe SIGMACAR.' };
  }
  if (Array.isArray(rule.categories) && rule.categories.length > 0) {
    const vCat = String(vehicle.category || '').toLowerCase();
    const ok = rule.categories.some(c => c.toLowerCase() === vCat || vCat.includes(c.toLowerCase()));
    return {
      fitStatus: ok ? 'compatible' : 'unknown',
      compatible: ok ? true : null,
      fitReason: ok ? (rule.note || `Phù hợp phân khúc ${vehicle.category}.`) : `Cần kiểm tra thực tế kích thước phân khúc ${vehicle.category || 'khác'}.`
    };
  }
  return { fitStatus: 'unknown', compatible: null, fitReason: 'Chưa xác định được mức độ tương thích.' };
}

const AccessoryService = {
  ensureSkusInState(state = dbState) {
    if (!state) return;
    if (!Array.isArray(state.accessories)) state.accessories = [];
    try {
      const { SIGMA_DATA } = require('../../js/data');
      if (SIGMA_DATA && Array.isArray(SIGMA_DATA.accessories)) {
        for (const a of SIGMA_DATA.accessories) {
          if (!state.accessories.some(x => x.id === a.id)) {
            state.accessories.push({
              ...a,
              itemKind: 'accessory',
              compatibilityRule: TYPED_COMPATIBILITY_RULES[a.id] || null
            });
          }
        }
      }
      if (SIGMA_DATA && Array.isArray(SIGMA_DATA.components)) {
        for (const c of SIGMA_DATA.components) {
          if (!state.accessories.some(x => x.id === c.id)) {
            const meta = TYPED_COMPATIBILITY_RULES[c.id] || {};
            const price = Number(meta.price || 15000000);
            state.accessories.push({
              id: c.id,
              name: c.name,
              brand: c.brand || 'VinFast',
              category: c.type || 'Linh kiện EV',
              color: 'Tiêu chuẩn NSX',
              price,
              priceFormatted: `${price.toLocaleString('vi-VN')} VNĐ`,
              specs: `${c.capacity || c.spec || 'Thông số tiêu chuẩn'} • Tương thích: ${c.vehicle || ''}`,
              year: 2025,
              quantity: Number(meta.stock ?? 3),
              image: 'assets/garage-car-detail.jpg',
              badge: c.type || 'Chính hãng',
              itemKind: 'component',
              warrantyMonths: meta.warrantyMonths || 24,
              provenance: 'SIGMACAR Authentic EV Components',
              compatibilityRule: meta
            });
          }
        }
      }
    } catch (e) {}
  },

  getTypedCompatibilityRule(skuId) {
    return TYPED_COMPATIBILITY_RULES[skuId] || null;
  },

  evaluateFitForVehicle,

  listAll({ vehicleId = null, category = '', kind = '', inStockOnly = false, compatibleOnly = false, q = '' } = {}) {
    this.ensureSkusInState(dbState);
    const vehicle = vehicleId
      ? ((dbState.vehicles || []).find(v => v.id === vehicleId) || (dbState.certifiedVehicles || []).find(v => v.id === vehicleId) || null)
      : null;

    const rawItems = (dbState.accessories || []).filter(a => !a.archived).map(a => { // PLAN T4.3: archived SKUs hidden
      const rule = a.compatibilityRule || TYPED_COMPATIBILITY_RULES[a.id] || null;
      const fit = evaluateFitForVehicle(a, vehicle);
      const stockQty = Number.isFinite(Number(a.quantity)) ? Number(a.quantity) : Number(a.stock || 0);
      return {
        ...a,
        sku: a.id,
        itemKind: a.itemKind || (rule && rule.kind) || 'accessory',
        stockQuantity: Math.max(0, Math.round(stockQty)),
        warrantyMonths: a.warrantyMonths || (rule && rule.warrantyMonths) || 12,
        provenance: a.provenance || 'SIGMACAR Authentic Catalog',
        compatibilityRule: rule,
        ...fit
      };
    });

    let filtered = rawItems;
    if (category && category !== 'all') {
      const catLow = String(category).toLowerCase();
      filtered = filtered.filter(i => String(i.category || '').toLowerCase().includes(catLow));
    }
    if (kind && kind !== 'all') {
      filtered = filtered.filter(i => i.itemKind === kind);
    }
    if (inStockOnly) {
      filtered = filtered.filter(i => i.stockQuantity > 0);
    }
    if (compatibleOnly && vehicle) {
      filtered = filtered.filter(i => i.compatible === true);
    }
    if (q && String(q).trim()) {
      const term = Security.sanitizeString(String(q).trim()).toLowerCase();
      filtered = filtered.filter(i =>
        String(i.name || '').toLowerCase().includes(term) ||
        String(i.brand || '').toLowerCase().includes(term) ||
        String(i.sku || '').toLowerCase().includes(term) ||
        String(i.specs || '').toLowerCase().includes(term)
      );
    }

    return {
      vehicle: vehicle ? { id: vehicle.id, name: vehicle.name, fuel: vehicle.fuel, category: vehicle.category } : null,
      count: filtered.length,
      items: filtered
    };
  },

  getBySku(sku, vehicleId = null) {
    const cleanSku = String(sku || '').trim();
    const item = (dbState.accessories || []).find(a => a.id === cleanSku);
    if (!item) {
      const err = new Error(`Không tìm thấy mã phụ kiện/linh kiện "${cleanSku}".`);
      err.statusCode = 404;
      err.code = 'ACCESSORY_NOT_FOUND';
      throw err;
    }
    const vehicle = vehicleId
      ? ((dbState.vehicles || []).find(v => v.id === vehicleId) || (dbState.certifiedVehicles || []).find(v => v.id === vehicleId) || null)
      : null;
    const fit = evaluateFitForVehicle(item, vehicle);
    return {
      ...item,
      sku: item.id,
      stockQuantity: Math.max(0, Math.round(Number(item.quantity ?? item.stock ?? 0))),
      compatibilityRule: item.compatibilityRule || TYPED_COMPATIBILITY_RULES[item.id] || null,
      ...fit
    };
  },

  // PLAN T4.3: admin-only catalog management. Typed compatibility rules of seeded SKUs are never touched.
  async createAccessory(data = {}, user) {
    if (!user || user.role !== 'admin') throw accessoryError('Chỉ Quản trị viên được thêm phụ kiện.', 403, 'FORBIDDEN');
    const fields = normalizeAccessoryInput(data);
    const rawSku = data.sku || data.id;
    return runInTransaction(async (state) => {
      this.ensureSkusInState(state);
      const sku = rawSku
        ? String(rawSku).trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40)
        : `ACC-${Date.now().toString(36).toUpperCase()}`;
      if (sku.length < 3) throw accessoryError('Mã SKU tối thiểu 3 ký tự chữ/số.', 400, 'VALIDATION_ERROR');
      if ((state.accessories || []).some(a => a.id === sku)) throw accessoryError(`Mã SKU "${sku}" đã tồn tại.`, 409, 'DUPLICATE_SKU');
      const created = {
        id: sku,
        brand: 'SIGMACAR',
        category: 'Phụ kiện',
        image: 'assets/garage-car-detail.jpg',
        compatibility: ['all'],
        ...fields,
        itemKind: 'accessory',
        createdBy: user.userId,
        createdAt: new Date().toISOString()
      };
      state.accessories.push(created);
      return created;
    });
  },

  async updateAccessory(sku, data = {}, user) {
    if (!user || user.role !== 'admin') throw accessoryError('Chỉ Quản trị viên được sửa phụ kiện.', 403, 'FORBIDDEN');
    const fields = normalizeAccessoryInput(data, { partial: true });
    return runInTransaction(async (state) => {
      this.ensureSkusInState(state);
      const item = (state.accessories || []).find(a => a.id === String(sku || '').trim());
      if (!item) throw accessoryError(`Không tìm thấy mã phụ kiện "${sku}".`, 404, 'ACCESSORY_NOT_FOUND');
      Object.assign(item, fields);
      if (data.archived !== undefined) item.archived = Boolean(data.archived);
      item.updatedBy = user.userId;
      item.updatedAt = new Date().toISOString();
      return { ...item, sku: item.id };
    });
  }
};

module.exports = AccessoryService;
