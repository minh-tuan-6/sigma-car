// backend/infrastructure/repositories/service-repository.js
// Repository for Service Centers, Bays, Technicians, Parts Ledger, Workshop Jobs & Warranty Claims

const { dbState } = require('../storage-engine');
const { SERVICE_CENTERS } = require('../../domain/constants');

const DEFAULT_PARTS_SEED = [
  {
    sku: 'PRT-HVAC-HEPA',
    name: 'Lọc gió điều hòa HEPA Than hoạt tính',
    category: 'Lọc & Điều hòa',
    unitPrice: 1250000,
    stockOnHand: 30,
    stockReserved: 0,
    compatibleFuels: ['ev', 'gas', 'hybrid'],
    compatibleVehicleIds: []
  },
  {
    sku: 'PRT-BRK-PAD-EV',
    name: 'Bộ má phanh gốm Ceramic EV (Trước/Sau)',
    category: 'Hệ thống Phanh',
    unitPrice: 4850000,
    stockOnHand: 18,
    stockReserved: 0,
    compatibleFuels: ['ev', 'hybrid'],
    compatibleVehicleIds: []
  },
  {
    sku: 'PRT-COOLANT-HV',
    name: 'Dung dịch làm mát Pin Cao Áp Dielectric EV (5L)',
    category: 'Pin & Làm mát HV',
    unitPrice: 1950000,
    stockOnHand: 25,
    stockReserved: 0,
    compatibleFuels: ['ev'],
    compatibleVehicleIds: []
  },
  {
    sku: 'PRT-OIL-SYN-5W30',
    name: 'Dầu động cơ Tổng hợp toàn phần 5W-30 (5L)',
    category: 'Động cơ Đốt trong',
    unitPrice: 1650000,
    stockOnHand: 22,
    stockReserved: 0,
    compatibleFuels: ['gas', 'hybrid'],
    compatibleVehicleIds: []
  },
  {
    sku: 'PRT-TIRE-MICHELIN-21',
    name: 'Lốp Michelin Pilot Sport EV 265/45R21',
    category: 'Lốp & Mâm',
    unitPrice: 9200000,
    stockOnHand: 12,
    stockReserved: 0,
    compatibleFuels: ['ev', 'gas', 'hybrid'],
    compatibleVehicleIds: []
  }
];

function buildDefaultBaysForCenter(center) {
  const count = Math.max(1, Number(center.bays || 4));
  const bays = [];
  for (let i = 1; i <= count; i++) {
    bays.push({
      id: `${center.id}-bay-${i}`,
      serviceCenterId: center.id,
      name: `Khoang #${i} (${i <= 2 ? 'Pin HV & Điện tử' : 'Bảo dưỡng Tổng hợp'})`,
      bayType: i <= 2 ? 'ev_hv' : 'general',
      active: true
    });
  }
  return bays;
}

function buildDefaultTechsForCenter(center, idx) {
  return [
    {
      id: `tech-${center.id}-1`,
      serviceCenterId: center.id,
      fullName: idx === 0 ? 'KTV Nguyễn Văn Hùng' : idx === 1 ? 'KTV Trần Quốc Bảo' : 'KTV Lê Minh Tuấn',
      specialty: 'ev_high_voltage',
      active: true
    },
    {
      id: `tech-${center.id}-2`,
      serviceCenterId: center.id,
      fullName: idx === 0 ? 'KTV Phạm Đức Thắng' : idx === 1 ? 'KTV Võ Hoàng Nam' : 'KTV Đặng Thanh Sơn',
      specialty: 'chassis_diagnostics',
      active: true
    }
  ];
}

const ServiceRepository = {
  ensureInitialized(state = dbState) {
    if (!state) return;
    if (!Array.isArray(state.serviceCenters) || state.serviceCenters.length === 0) {
      state.serviceCenters = SERVICE_CENTERS.map(c => ({
        id: c.id,
        branchId: c.branchId || c.id.replace(/^sc-/, ''),
        name: c.name,
        address: c.address,
        city: c.city,
        phone: c.phone,
        bayCount: c.bays || 4,
        active: true
      }));
    }
    if (!Array.isArray(state.serviceBays) || state.serviceBays.length === 0) {
      state.serviceBays = state.serviceCenters.flatMap(buildDefaultBaysForCenter);
    }
    if (!Array.isArray(state.technicians) || state.technicians.length === 0) {
      state.technicians = state.serviceCenters.flatMap((c, idx) => buildDefaultTechsForCenter(c, idx));
    }
    if (!Array.isArray(state.partsLedger) || state.partsLedger.length === 0) {
      state.partsLedger = DEFAULT_PARTS_SEED.map(p => ({ ...p }));
    }
    if (!Array.isArray(state.workshopJobs)) {
      state.workshopJobs = [];
    }
    if (!Array.isArray(state.warrantyClaims)) {
      state.warrantyClaims = [];
    }
    if (!Array.isArray(state.jobEvents)) {
      state.jobEvents = [];
    }
  }
};

module.exports = ServiceRepository;
