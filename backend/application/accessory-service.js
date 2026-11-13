// backend/application/accessory-service.js
// Normalized Accessory & EV Component Catalog with Typed Compatibility Matrix (SIG-P3-010)

const { dbState } = require('../infrastructure/storage-engine');
const Security = require('../infrastructure/security');

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

    const rawItems = (dbState.accessories || []).map(a => {
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
  }
};

module.exports = AccessoryService;
