// js/static-sandbox.js
// Static Preview Public Catalog / Pure Calculators & Isolated Opt-In Demo Sandbox Store (sigmacar_demo_*)

(function (globalScope) {
  'use strict';

  const STORE_KEY = 'sigmacar_demo_store_v1';
  const DELIVERY_FEES_VND = {
    showroom: 0,
    home_city: 2500000,
    intercity: 8000000
  };

  const DEFAULT_BRANCHES = [
    { id: 'hn-caugiay', name: 'Showroom SIGMACAR Cầu Giấy (Hà Nội)', city: 'Hà Nội', region: 'north', address: 'Số 68 Xuân Thủy, Cầu Giấy, Hà Nội', phone: '024 3888 6688' },
    { id: 'hn-mydinh', name: 'Showroom SIGMACAR Mỹ Đình (Hà Nội)', city: 'Hà Nội', region: 'north', address: 'Số 8 Lê Quang Đạo, Mỹ Đình, Nam Từ Liêm, Hà Nội', phone: '024 3999 5599' },
    { id: 'hcm-q7', name: 'Showroom SIGMACAR Quận 7 (TP.HCM)', city: 'TP.HCM', region: 'south', address: 'Số 101 Nguyễn Thị Thập, Tân Phú, Quận 7, TP.HCM', phone: '028 3777 8899' }
  ];

  const TCO_REGIONS = {
    vietnam: {
      label: 'Việt Nam (Bình quân tham chiếu)',
      electricityVndPerKwh: 3200,
      fuelVndPerLiter: 22500,
      evAnnualMaintenanceVnd: 3200000,
      iceAnnualMaintenanceVnd: 6800000,
      chargingLossPercent: 8
    },
    hanoi: {
      label: 'Hà Nội & Miền Bắc',
      electricityVndPerKwh: 3250,
      fuelVndPerLiter: 22500,
      evAnnualMaintenanceVnd: 3200000,
      iceAnnualMaintenanceVnd: 7000000,
      chargingLossPercent: 8
    },
    hcm: {
      label: 'TP. Hồ Chí Minh & Miền Nam',
      electricityVndPerKwh: 3200,
      fuelVndPerLiter: 22900,
      evAnnualMaintenanceVnd: 3200000,
      iceAnnualMaintenanceVnd: 6900000,
      chargingLossPercent: 8
    },
    danang: {
      label: 'Đà Nẵng & Miền Trung',
      electricityVndPerKwh: 3150,
      fuelVndPerLiter: 22700,
      evAnnualMaintenanceVnd: 3000000,
      iceAnnualMaintenanceVnd: 6600000,
      chargingLossPercent: 8
    }
  };

  const REGISTRATION_REGIONS = {
    hanoi: { label: 'Hà Nội', iceRate: 0.12, plateFee: 20000000 },
    hcm: { label: 'TP. Hồ Chí Minh', iceRate: 0.10, plateFee: 20000000 },
    danang: { label: 'Đà Nẵng / Hải Phòng / Cần Thơ', iceRate: 0.10, plateFee: 1000000 },
    province: { label: 'Tỉnh / Thành phố khác', iceRate: 0.10, plateFee: 1000000 }
  };

  const CHARGING_STATIONS_SEED = [
    {
      id: 'chg_hn_caugiay_01',
      name: 'Trạm Siêu Sạc SIGMACAR Cầu Giấy Hub',
      network: 'SIGMACAR SuperCharge',
      city: 'Hà Nội',
      address: '68 Xuân Thủy, Cầu Giấy, Hà Nội',
      lat: 21.0369,
      lng: 105.7826,
      portsTotal: 12,
      portsAvailable: 8,
      maxPowerKw: 250,
      connectors: ['CCS2', 'Type 2'],
      pricePerKwhVnd: 3858,
      open24h: true,
      amenities: ['Lounge VIP', 'Cafe', 'Wi-Fi', 'Kiểm tra áp suất lốp']
    },
    {
      id: 'chg_hn_mydinh_02',
      name: 'Trạm Sạc SIGMACAR Mỹ Đình Plaza',
      network: 'SIGMACAR FastCharge',
      city: 'Hà Nội',
      address: '8 Lê Quang Đạo, Nam Từ Liêm, Hà Nội',
      lat: 21.0195,
      lng: 105.7662,
      portsTotal: 8,
      portsAvailable: 6,
      maxPowerKw: 180,
      connectors: ['CCS2'],
      pricePerKwhVnd: 3858,
      open24h: true,
      amenities: ['Bãi đỗ có mái che', 'Khu chờ điều hòa']
    },
    {
      id: 'chg_hcm_q7_03',
      name: 'Trạm Siêu Sạc SIGMACAR Phú Mỹ Hưng Q7',
      network: 'SIGMACAR SuperCharge',
      city: 'TP.HCM',
      address: '101 Nguyễn Thị Thập, Quận 7, TP.HCM',
      lat: 10.7375,
      lng: 106.7124,
      portsTotal: 14,
      portsAvailable: 10,
      maxPowerKw: 250,
      connectors: ['CCS2', 'Type 2'],
      pricePerKwhVnd: 3858,
      open24h: true,
      amenities: ['Lounge VIP', 'Rửa xe nhanh', 'Wi-Fi']
    },
    {
      id: 'chg_dn_haichau_04',
      name: 'Trạm Sạc SIGMACAR Sông Hàn Đà Nẵng',
      network: 'SIGMACAR FastCharge',
      city: 'Đà Nẵng',
      address: '255 Bạch Đằng, Hải Châu, Đà Nẵng',
      lat: 16.0681,
      lng: 108.2248,
      portsTotal: 6,
      portsAvailable: 5,
      maxPowerKw: 120,
      connectors: ['CCS2', 'Type 2'],
      pricePerKwhVnd: 3858,
      open24h: true,
      amenities: ['Cafe view sông', 'Bãi đỗ miễn phí 2h']
    }
  ];

  const SEEDED_CMS_PUBLIC = [
    {
      id: 'cms_banner_autumn_ev',
      slug: 'uu-dai-xe-dien-2026',
      slot: 'home_hero_strip',
      title: 'Ưu đãi 0% Lệ phí Trước bạ & Tặng gói Sạc 12 tháng cho xe thuần điện SIGMA',
      summary: 'Áp dụng cho khách hàng đặt giữ chỗ trực tuyến với mã SIGMA50 hoặc EVGREEN5 tại Showroom Hà Nội & TP.HCM.',
      ctaLabel: 'Khám phá Dòng xe mới',
      ctaRoute: 'new-cars',
      status: 'published',
      publishedAt: '2026-11-01T00:00:00.000Z'
    }
  ];

  const SEEDED_FAQS = [
    { id: 'faq_01', category: 'payment', question: 'Tôi có thể đặt cọc xe trực tuyến qua những hình thức nào?', answer: 'Quý khách có thể đặt cọc qua Chuyển khoản QR Napas 24/7, Cổng VNPAY QR hoặc Ví điện tử MoMo với giữ chỗ tồn kho 15 phút.' },
    { id: 'faq_02', category: 'delivery', question: 'SIGMACAR có hỗ trợ giao xe tận nhà không?', answer: 'Có. Quý khách có thể nhận tại Showroom (0 VNĐ), giao tận nhà nội thành (+2.500.000 VNĐ) hoặc vận chuyển liên tỉnh (+8.000.000 VNĐ).' },
    { id: 'faq_03', category: 'warranty', question: 'Chính sách hoàn tiền và đổi trả 7 ngày áp dụng như thế nào?', answer: 'Hoàn tiền 100% tiền cọc giữ suất trong vòng 07 ngày nếu chưa ký hợp đồng xuất xưởng hoặc showroom không giao đúng cấu hình.' },
    { id: 'faq_04', category: 'charging', question: 'Xe điện SIGMACAR sử dụng chuẩn cổng sạc nào?', answer: 'Các mẫu xe thuần điện SIGMACAR hỗ trợ chuẩn sạc nhanh DC CCS2 (tới 250kW) và sạc AC Type 2 tại nhà.' }
  ];

  let memoryStore = null;

  function makeHttpError(message, status = 400, code = 'SANDBOX_ERROR') {
    const err = new Error(message);
    err.status = status;
    err.code = code;
    return err;
  }

  function safeRandomId(prefix) {
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${Date.now().toString(36)}_${rand}`;
  }

  function getSigmaData() {
    if (typeof globalScope.SIGMA_DATA !== 'undefined' && globalScope.SIGMA_DATA) {
      return globalScope.SIGMA_DATA;
    }
    return { cars: [], certifiedCars: [], branches: DEFAULT_BRANCHES, accessories: [], components: [] };
  }

  function createSeedUsers() {
    return [
      {
        id: 'usr_admin_01',
        email: 'admin@sigmacar.vn',
        password: 'Admin@123456',
        fullName: 'Hệ Thống Quản Trị SIGMACAR',
        phone: '1900 8888',
        role: 'admin',
        branchId: 'all',
        branchIds: ['hn-caugiay', 'hn-mydinh', 'hcm-q7'],
        savedCars: []
      },
      {
        id: 'usr_seller_01',
        email: 'minhphan.seller@sigmacar.vn',
        password: 'Seller@123456',
        fullName: 'Minh Phan - Tư vấn SIGMACAR',
        phone: '0904 555 888',
        role: 'seller',
        branchId: 'hn-caugiay',
        branchIds: ['hn-caugiay'],
        savedCars: []
      },
      {
        id: 'usr_buyer_01',
        email: 'minhhoang.sigma@example.com',
        password: 'Buyer@123456',
        fullName: 'Minh Hoàng',
        phone: '0912 345 678',
        role: 'buyer',
        savedCars: ['sigma-model-e']
      }
    ];
  }

  function createSeedPromotions() {
    const nowIso = '2026-01-01T00:00:00.000Z';
    return [
      {
        id: 'promo_sigma50',
        code: 'SIGMA50',
        name: 'Ưu đãi đặt cọc Tiên phong 50 triệu VNĐ',
        discountType: 'fixed',
        discountValue: 50000000,
        maxDiscountAmount: 50000000,
        minOrderValue: 1000000000,
        usageLimit: 100,
        usedCount: 0,
        startsAt: '2025-01-01T00:00:00.000Z',
        expiresAt: '2028-12-31T23:59:59.000Z',
        isActive: true,
        createdAt: nowIso
      },
      {
        id: 'promo_evgreen5',
        code: 'EVGREEN5',
        name: 'Ưu đãi Xe Thuần Điện 5% (tối đa 30 triệu VNĐ)',
        discountType: 'percent',
        discountValue: 5,
        maxDiscountAmount: 30000000,
        fuelRestriction: 'ev',
        minOrderValue: 300000000,
        usageLimit: 200,
        usedCount: 0,
        startsAt: '2025-01-01T00:00:00.000Z',
        expiresAt: '2028-12-31T23:59:59.000Z',
        isActive: true,
        createdAt: nowIso
      },
      {
        id: 'promo_tet2026',
        code: 'TET2026',
        name: 'Voucher Tri Ân Chủ xe 10 triệu VNĐ',
        discountType: 'fixed',
        discountValue: 10000000,
        maxDiscountAmount: 10000000,
        minOrderValue: 200000000,
        usageLimit: 500,
        usedCount: 0,
        startsAt: '2025-01-01T00:00:00.000Z',
        expiresAt: '2028-12-31T23:59:59.000Z',
        isActive: true,
        createdAt: nowIso
      }
    ];
  }

  function createInitialStore() {
    const nowIso = new Date().toISOString();
    return {
      version: 1,
      users: createSeedUsers(),
      tokens: {},
      carts: {},
      quotes: [],
      orders: [],
      paymentIntents: [],
      appointments: [],
      financingApplications: [],
      configurations: [],
      reviews: [],
      questions: [],
      supportTickets: [],
      returns: [],
      warranties: [],
      warrantyClaims: [],
      registrationCases: [],
      contracts: [],
      handovers: [],
      refunds: [],
      notifications: [],
      workshopJobs: [],
      campaigns: [],
      analyticsEvents: [],
      promotions: createSeedPromotions(),
      cmsContents: SEEDED_CMS_PUBLIC.map(c => ({ ...c, createdAt: nowIso, updatedAt: nowIso }))
    };
  }

  function sanitizeUserForClient(u) {
    if (!u) return null;
    const { password, passwordHash, ...safe } = u;
    return { ...safe, isDemoSandbox: true };
  }

  function getStore() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') return parsed;
        }
        const initial = createInitialStore();
        localStorage.setItem(STORE_KEY, JSON.stringify(initial));
        return initial;
      }
    } catch (_) {}
    if (!memoryStore) memoryStore = createInitialStore();
    return memoryStore;
  }

  function saveStore(store) {
    memoryStore = store;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORE_KEY, JSON.stringify(store));
      }
    } catch (_) {}
    return store;
  }

  function resetStore() {
    const fresh = createInitialStore();
    saveStore(fresh);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('sigmacar_demo_auth_token');
        localStorage.removeItem('sigmacar_demo_user');
      }
    } catch (_) {}
    return fresh;
  }

  function parseEndpoint(endpoint) {
    const raw = String(endpoint || '');
    const qIdx = raw.indexOf('?');
    const path = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
    const search = qIdx >= 0 ? raw.slice(qIdx + 1) : '';
    const query = new URLSearchParams(search);
    return { path: path || '/', query };
  }

  function parseBody(options) {
    if (!options || !options.body) return {};
    if (typeof options.body === 'object') return options.body;
    try {
      return JSON.parse(options.body);
    } catch (_) {
      return {};
    }
  }

  function getBranches() {
    const sd = getSigmaData();
    return Array.isArray(sd.branches) && sd.branches.length > 0 ? sd.branches : DEFAULT_BRANCHES;
  }

  function findVehicle(id) {
    const sd = getSigmaData();
    const cleanId = String(id || '');
    return (sd.cars || []).find(c => c.id === cleanId) ||
      (sd.certifiedCars || []).find(c => c.id === cleanId) ||
      null;
  }

  function listAllAccessories() {
    const sd = getSigmaData();
    const out = [];
    if (Array.isArray(sd.accessories)) {
      sd.accessories.forEach(a => out.push({ ...a, kind: a.kind || 'accessory', compatibility: a.compatibility || ['all'] }));
    }
    if (Array.isArray(sd.components)) {
      sd.components.forEach(c => out.push({ ...c, kind: 'component', compatibility: c.compatibility || ['all'] }));
    }
    return out;
  }

  function resolveCatalogItem(rawLine) {
    const itemType = rawLine.itemType === 'accessory' ? 'accessory' : (rawLine.itemType === 'certified' ? 'certified' : 'vehicle');
    const itemId = String(rawLine.itemId || rawLine.vehicleId || rawLine.sku || '');
    if (itemType === 'accessory') {
      const acc = listAllAccessories().find(a => a.sku === itemId || a.id === itemId);
      if (!acc) throw makeHttpError(`Không tìm thấy phụ kiện "${itemId}".`, 404, 'ACCESSORY_NOT_FOUND');
      return {
        itemType: 'accessory',
        itemId: acc.sku || acc.id,
        name: acc.name,
        fuel: null,
        image: acc.image || 'assets/accessory-charger.jpg',
        trimName: null,
        colorName: null,
        unitPrice: Number(acc.price || 0),
        isCertified: false
      };
    }

    const v = findVehicle(itemId);
    if (!v) throw makeHttpError(`Không tìm thấy mẫu xe "${itemId}" trong danh mục.`, 404, 'VEHICLE_NOT_FOUND');

    let unitPrice = Number(v.salePrice && v.salePrice < v.price ? v.salePrice : v.price) || 0;
    let trimName = rawLine.trimName || null;
    if (trimName && Array.isArray(v.trims)) {
      const matchedTrim = v.trims.find(t => t.name === trimName || t.id === trimName);
      if (matchedTrim && Number(matchedTrim.price) > 0) {
        unitPrice = Number(matchedTrim.price);
        trimName = matchedTrim.name;
      }
    }

    return {
      itemType: v.type === 'certified' || itemType === 'certified' ? 'certified' : 'vehicle',
      itemId: v.id,
      name: trimName ? `${v.name} (${trimName})` : v.name,
      fuel: v.fuel || 'ev',
      image: v.image || v.thumbnail || 'assets/car-model-e.jpg',
      trimName,
      colorName: rawLine.colorName || null,
      unitPrice,
      isCertified: v.type === 'certified' || itemType === 'certified'
    };
  }

  function evaluatePromo(promotions, { code, subtotal = 0, items = [] }) {
    const cleanCode = String(code || '').trim().toUpperCase();
    if (!cleanCode) throw makeHttpError('Vui lòng nhập mã ưu đãi.', 400, 'EMPTY_PROMO_CODE');
    const promo = (promotions || []).find(p => String(p.code || '').toUpperCase() === cleanCode);
    if (!promo || !promo.isActive) {
      throw makeHttpError(`Mã ưu đãi "${cleanCode}" không tồn tại hoặc đã ngừng áp dụng.`, 404, 'PROMO_NOT_FOUND');
    }
    if (promo.minOrderValue && subtotal < promo.minOrderValue) {
      throw makeHttpError(`Mã ${cleanCode} yêu cầu giá trị đơn hàng tối thiểu ${Number(promo.minOrderValue).toLocaleString('vi-VN')} VNĐ.`, 422, 'PROMO_MIN_ORDER');
    }
    if (promo.fuelRestriction) {
      const hasMatch = (items || []).some(l => l.fuel === promo.fuelRestriction);
      if (!hasMatch) {
        throw makeHttpError(`Mã ${cleanCode} chỉ áp dụng cho đơn hàng có xe ${promo.fuelRestriction.toUpperCase()}.`, 422, 'PROMO_FUEL_MISMATCH');
      }
    }
    let discountAmount = 0;
    if (promo.discountType === 'percent') {
      discountAmount = Math.round(subtotal * (Number(promo.discountValue || 0) / 100));
      if (promo.maxDiscountAmount) {
        discountAmount = Math.min(discountAmount, Number(promo.maxDiscountAmount));
      }
    } else {
      discountAmount = Number(promo.discountValue || 0);
    }
    discountAmount = Math.min(subtotal, Math.max(0, discountAmount));
    return {
      valid: true,
      id: promo.id,
      code: promo.code,
      name: promo.name,
      discountAmount
    };
  }

  function buildQuoteBreakdown({ items = [], promoCode = null, branchId = 'hn-caugiay', deliveryMethod = 'showroom', promotions = createSeedPromotions() }) {
    if (!Array.isArray(items) || items.length === 0) {
      return {
        branchId: branchId || 'hn-caugiay',
        deliveryMethod: deliveryMethod || 'showroom',
        policyVersion: '2026.1-DEMO',
        lines: [],
        itemsSubtotal: 0,
        discountAmount: 0,
        deliveryFee: 0,
        totalAmount: 0,
        depositAmount: 0,
        promo: null
      };
    }

    const delMethod = Object.prototype.hasOwnProperty.call(DELIVERY_FEES_VND, deliveryMethod) ? deliveryMethod : 'showroom';
    const deliveryFee = DELIVERY_FEES_VND[delMethod];
    const lines = [];
    let itemsSubtotal = 0;
    let vehicleDepositRequired = 0;

    for (const raw of items) {
      const qty = Math.min(20, Math.max(1, Math.round(Number(raw.quantity || 1))));
      const resolved = resolveCatalogItem(raw);
      const lineTotal = Math.round(resolved.unitPrice * qty);
      itemsSubtotal += lineTotal;
      if (resolved.itemType !== 'accessory') {
        vehicleDepositRequired += Math.min(lineTotal, 50000000 * qty);
      }
      lines.push({
        lineId: raw.lineId || safeRandomId('ql'),
        itemType: resolved.itemType,
        itemId: resolved.itemId,
        name: resolved.name,
        fuel: resolved.fuel,
        image: resolved.image,
        trimName: resolved.trimName,
        colorName: resolved.colorName,
        quantity: qty,
        unitPrice: resolved.unitPrice,
        lineTotal,
        isCertified: resolved.isCertified
      });
    }

    let appliedPromo = null;
    let promoError = null;
    let discountAmount = 0;
    if (promoCode && String(promoCode).trim()) {
      try {
        appliedPromo = evaluatePromo(promotions, { code: promoCode, subtotal: itemsSubtotal, items: lines });
        discountAmount = appliedPromo.discountAmount;
      } catch (e) {
        promoError = e.message;
      }
    }

    const totalAmount = Math.max(0, itemsSubtotal - discountAmount + deliveryFee);
    const depositAmount = vehicleDepositRequired > 0
      ? Math.min(totalAmount, vehicleDepositRequired)
      : totalAmount;

    return {
      branchId: branchId || 'hn-caugiay',
      deliveryMethod: delMethod,
      policyVersion: '2026.1-DEMO',
      lines,
      itemsSubtotal,
      discountAmount,
      deliveryFee,
      totalAmount,
      depositAmount,
      promo: appliedPromo,
      promoError
    };
  }

  function calculateLoan(payload) {
    const vehiclePrice = Number(payload.vehiclePrice || 1500000000);
    const dp = Number(payload.downPaymentPercent ?? 20);
    const rate = Number(payload.annualInterestRatePercent ?? 7.9);
    const months = Number(payload.termMonths ?? 60);
    const downPaymentAmount = Math.round(vehiclePrice * (dp / 100));
    const loanPrincipal = Math.max(0, vehiclePrice - downPaymentAmount);
    const monthlyRate = (rate / 100) / 12;
    const mPay = monthlyRate > 0
      ? Math.round(loanPrincipal * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1))
      : Math.round(loanPrincipal / Math.max(1, months));
    return {
      vehiclePrice,
      downPaymentAmount,
      loanPrincipal,
      termMonths: months,
      annualInterestRatePercent: rate,
      repaymentMethod: payload.repaymentMethod || 'equal_installment',
      monthlyPaymentFirstMonth: mPay,
      monthlyPaymentAverage: mPay,
      totalInterest: Math.max(0, (mPay * months) - loanPrincipal),
      totalPayable: (mPay * months) + downPaymentAmount,
      disclaimer: 'Kết quả dự toán trả góp mang tính tham khảo trên chế độ xem tĩnh.'
    };
  }

  function calculateTcoEstimate(payload) {
    const regionKey = String(payload.region || 'vietnam').toLowerCase();
    const preset = TCO_REGIONS[regionKey] || TCO_REGIONS.vietnam;
    const vehicle = payload.vehicleId ? findVehicle(payload.vehicleId) : null;
    const rawFuel = String(payload.fuelType || (vehicle && vehicle.fuel) || 'ev').toLowerCase();
    const fuelType = (rawFuel === 'gas' || rawFuel === 'ice') ? 'ice' : (rawFuel === 'hybrid' ? 'hybrid' : 'ev');
    const monthlyKm = Math.max(0, Number(payload.monthlyKm ?? 1000));
    const lossPct = Math.max(0, Number(payload.chargingLossPercent ?? preset.chargingLossPercent));
    const annualMaint = Math.round(Number(payload.annualMaintenanceVnd ?? (fuelType === 'ev' ? preset.evAnnualMaintenanceVnd : preset.iceAnnualMaintenanceVnd)));

    let monthlyEnergy = null;
    let monthlyFuel = null;
    let usedKwh = null;
    let usedElec = null;
    let usedLiters = null;
    let usedFuelRate = null;

    if (fuelType === 'ev' || fuelType === 'hybrid') {
      usedKwh = Number(payload.kWhPer100Km ?? payload.kwhPer100Km ?? (vehicle && vehicle.consumptionKwhPer100Km) ?? (fuelType === 'ev' ? 15 : 0));
      usedElec = Number(payload.electricityVndPerKwh ?? preset.electricityVndPerKwh);
      monthlyEnergy = Math.round((monthlyKm / 100) * usedKwh * (1 + lossPct / 100) * usedElec);
    }
    if (fuelType === 'ice' || fuelType === 'hybrid') {
      usedLiters = Number(payload.litersPer100Km ?? (vehicle && vehicle.consumptionLitersPer100Km) ?? (fuelType === 'ice' ? 7 : 0));
      usedFuelRate = Number(payload.fuelVndPerLiter ?? preset.fuelVndPerLiter);
      monthlyFuel = Math.round((monthlyKm / 100) * usedLiters * usedFuelRate);
    }

    const monthlyOperatingEnergyOrFuel = (monthlyEnergy || 0) + (monthlyFuel || 0);
    const annualEnergyOrFuel = monthlyOperatingEnergyOrFuel * 12;
    const annualOperating = annualEnergyOrFuel + annualMaint;
    const annualInsuranceVnd = Math.round(Number(payload.annualInsuranceVnd || 0));
    const annualParkingVnd = Math.round(Number(payload.annualParkingVnd || 0));
    const annualRoadFeeVnd = Math.round(Number(payload.annualRoadFeeVnd || 0));
    const annualDepreciationVnd = Math.round(Number(payload.annualDepreciationVnd || 0));
    const annualFixedExtrasTotal = annualInsuranceVnd + annualParkingVnd + annualRoadFeeVnd + annualDepreciationVnd;
    const annualTotalWithExtras = annualOperating + annualFixedExtrasTotal;

    const formulas = [];
    if (monthlyEnergy !== null) {
      formulas.push(`Tiền điện/tháng = (${monthlyKm} / 100) × ${usedKwh} kWh × (1 + ${lossPct}%) × ${usedElec.toLocaleString('vi-VN')} đ/kWh = ${monthlyEnergy.toLocaleString('vi-VN')} VNĐ`);
    }
    if (monthlyFuel !== null) {
      formulas.push(`Tiền xăng/tháng = (${monthlyKm} / 100) × ${usedLiters} lít × ${usedFuelRate.toLocaleString('vi-VN')} đ/lít = ${monthlyFuel.toLocaleString('vi-VN')} VNĐ`);
    }
    formulas.push(`Chi phí vận hành/năm = 12 × ${monthlyOperatingEnergyOrFuel.toLocaleString('vi-VN')} + ${annualMaint.toLocaleString('vi-VN')} (bảo dưỡng) = ${annualOperating.toLocaleString('vi-VN')} VNĐ`);

    return {
      isEstimateOnly: true,
      isOperatingSubtotalOnly: annualFixedExtrasTotal === 0,
      vehicleId: vehicle ? vehicle.id : null,
      vehicleName: vehicle ? vehicle.name : (payload.vehicleName || null),
      fuelType,
      region: regionKey,
      formulaVersion: 'TCO-VN-2026.1',
      formulaEffectiveDate: '2026-11-01',
      assumptionSource: 'Ước tính tham chiếu tĩnh trên trình duyệt theo biểu mẫu TCO-VN-2026.1.',
      missingCatalogSpecs: [],
      inputsUsed: {
        monthlyKm,
        kWhPer100Km: usedKwh,
        litersPer100Km: usedLiters,
        electricityVndPerKwh: usedElec,
        fuelVndPerLiter: usedFuelRate,
        chargingLossPercent: lossPct,
        annualMaintenanceVnd: annualMaint
      },
      monthlyEnergy,
      monthlyFuel,
      monthlyOperatingEnergyOrFuel,
      annualEnergyOrFuel,
      annualOperatingCost: annualOperating,
      fiveYearOperatingCost: annualOperating * 5,
      annualFixedExtrasTotal,
      annualTotalWithExtras,
      fiveYearTotalWithExtras: annualTotalWithExtras * 5,
      formulas,
      disclaimer: 'Kết quả trên là DỰ TOÁN CHI PHÍ VẬN HÀNH tham chiếu theo công thức TCO-VN-2026.1.'
    };
  }

  function calculateRegistrationEstimate(payload) {
    const vehicle = payload.vehicleId ? findVehicle(payload.vehicleId) : null;
    const price = Number(payload.vehiclePrice || (vehicle && vehicle.price) || 0);
    if (!Number.isFinite(price) || price <= 0) {
      throw makeHttpError('Giá xe không hợp lệ để dự toán chi phí lăn bánh.', 422, 'INVALID_VEHICLE_PRICE');
    }
    const fuel = String(payload.fuel || (vehicle && vehicle.fuel) || 'ev').toLowerCase();
    const isEv = fuel === 'ev';
    const prov = String(payload.province || 'hanoi').toLowerCase();
    const region = REGISTRATION_REGIONS[prov] || REGISTRATION_REGIONS.province;
    const taxRate = isEv ? 0 : region.iceRate;
    const registrationTax = Math.round(price * taxRate);
    const plateFee = region.plateFee;
    const inspectionFee = 340000;
    const roadMaintenanceFee = 1560000;
    const civilInsuranceFee = 480700;
    const serviceFee = payload.serviceMode === 'seller_assisted' ? 3500000 : 0;
    const totalEstimatedFees = registrationTax + plateFee + inspectionFee + roadMaintenanceFee + civilInsuranceFee + serviceFee;

    return {
      vehicleId: payload.vehicleId || null,
      vehicleName: vehicle ? vehicle.name : '',
      vehiclePrice: price,
      fuel: isEv ? 'ev' : fuel,
      province: prov,
      provinceLabel: region.label,
      serviceMode: payload.serviceMode === 'seller_assisted' ? 'seller_assisted' : 'self_registration',
      policyVersion: '2026.1',
      isEstimateOnly: true,
      breakdown: {
        registrationTaxRate: taxRate,
        registrationTax,
        plateFee,
        inspectionFee,
        roadMaintenanceFee,
        civilInsuranceFee,
        serviceFee,
        totalEstimatedFees
      },
      estimatedOnRoadTotal: price + totalEstimatedFees,
      disclaimer: 'Biểu phí tham khảo tính trên trình duyệt (chưa thay thế biên lai thuế/lệ phí thực tế tại cơ quan đăng ký).'
    };
  }

  function normalizeRegionToken(val) {
    const s = String(val || '').trim().toLowerCase();
    if (!s || s === 'all') return '';
    if (s === 'hanoi' || s.includes('hà nội') || s.includes('ha noi')) return 'hanoi';
    if (s === 'hcm' || s.includes('hồ chí minh') || s.includes('tp.hcm') || s.includes('sai gon')) return 'hcm';
    if (s === 'danang' || s.includes('đà nẵng') || s.includes('da nang')) return 'danang';
    return s;
  }

  function buildStationsResponse(query) {
    const cityOrProv = normalizeRegionToken(query.get('province') || query.get('city'));
    const q = String(query.get('q') || '').trim().toLowerCase();
    const minPowerKw = Number(query.get('minPowerKw') || 0);
    const connector = String(query.get('connectorType') || query.get('connector') || '').trim().toUpperCase();
    const maxDistanceKm = Number(query.get('maxDistanceKm') || 0);
    const lat = query.has('lat') ? Number(query.get('lat')) : null;
    const lng = query.has('lng') ? Number(query.get('lng')) : null;

    let list = CHARGING_STATIONS_SEED.map(st => {
      let distanceKm = null;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const dLat = (st.lat - lat) * 111;
        const dLng = (st.lng - lng) * 111 * Math.cos((lat * Math.PI) / 180);
        distanceKm = Math.round(Math.sqrt(dLat * dLat + dLng * dLng) * 10) / 10;
      }
      return { ...st, distanceKm };
    });

    if (cityOrProv) {
      list = list.filter(s => normalizeRegionToken(s.city) === cityOrProv || s.city.toLowerCase().includes(cityOrProv));
    }
    if (q) {
      list = list.filter(s => `${s.name} ${s.address} ${s.city} ${s.network}`.toLowerCase().includes(q));
    }
    if (minPowerKw > 0) {
      list = list.filter(s => s.maxPowerKw >= minPowerKw);
    }
    if (connector && connector !== 'ALL') {
      list = list.filter(s => (s.connectors || []).some(c => c.toUpperCase() === connector));
    }
    if (maxDistanceKm > 0 && Number.isFinite(lat) && Number.isFinite(lng)) {
      list = list.filter(s => s.distanceKm !== null && s.distanceKm <= maxDistanceKm);
    }
    list.sort((a, b) => {
      if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
      return b.portsAvailable - a.portsAvailable;
    });

    return {
      stations: list,
      cacheMeta: {
        stale: false,
        source: 'static_documented_directory',
        note: 'Danh bạ trạm sạc tham khảo trên Static Preview.'
      }
    };
  }

  function requireDemoAuth(store, apiClient) {
    const token = apiClient && typeof apiClient.getToken === 'function' ? apiClient.getToken() : null;
    const curUser = apiClient && typeof apiClient.getCurrentUser === 'function' ? apiClient.getCurrentUser() : null;
    let user = null;
    if (token && store.tokens && store.tokens[token]) {
      user = store.users.find(u => u.id === store.tokens[token]);
    } else if (token && token.startsWith('demo_token_') && curUser && curUser.email) {
      user = store.users.find(u => u.email === curUser.email.toLowerCase());
    }
    if (!user) {
      throw makeHttpError('Vui lòng đăng nhập tài khoản Demo Sandbox để thực hiện thao tác này.', 401, 'UNAUTHORIZED');
    }
    return user;
  }

  function assertStaffRole(user, allowedRoles = ['seller', 'admin', 'support_staff', 'service_staff']) {
    if (!user || !allowedRoles.includes(user.role)) {
      throw makeHttpError('Tài khoản hiện tại không có quyền thực hiện thao tác quản trị này.', 403, 'FORBIDDEN');
    }
  }

  function handlePublic(endpoint, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const { path, query } = parseEndpoint(endpoint);
    const body = parseBody(options);
    const sd = getSigmaData();

    if (path === '/vehicles' && method === 'GET') {
      return { success: true, staticReadOnly: true, data: sd.cars || [] };
    }
    if (path === '/vehicles/certified' && method === 'GET') {
      return { success: true, staticReadOnly: true, data: sd.certifiedCars || [] };
    }
    if (path.startsWith('/vehicles/') && path.endsWith('/related') && method === 'GET') {
      const id = decodeURIComponent(path.split('/')[2] || '');
      const car = findVehicle(id);
      const rel = car
        ? (sd.cars || []).filter(c => c.id !== car.id && (c.category === car.category || c.fuel === car.fuel)).slice(0, 4)
        : (sd.cars || []).slice(0, 4);
      return { success: true, staticReadOnly: true, data: rel };
    }
    if (path.startsWith('/vehicles/') && method === 'GET') {
      const id = decodeURIComponent(path.split('/')[2] || '');
      const found = findVehicle(id);
      if (!found) throw makeHttpError('Không tìm thấy xe yêu cầu.', 404, 'VEHICLE_NOT_FOUND');
      return { success: true, staticReadOnly: true, data: found };
    }

    if (path === '/financing/calculate' && method === 'POST') {
      return { success: true, staticReadOnly: true, data: calculateLoan(body) };
    }
    if (path === '/cost-estimates/assumptions' && method === 'GET') {
      const regionKey = String(query.get('region') || 'vietnam').toLowerCase();
      return {
        success: true,
        staticReadOnly: true,
        data: {
          formulaVersion: 'TCO-VN-2026.1',
          effectiveFrom: '2026-11-01',
          region: regionKey,
          regionPreset: TCO_REGIONS[regionKey] || TCO_REGIONS.vietnam,
          regions: TCO_REGIONS,
          sourceNote: 'Tham số TCO tham chiếu theo khu vực (khách hàng có thể điều chỉnh trực tiếp).'
        }
      };
    }
    if (path === '/cost-estimates/tco' && method === 'POST') {
      return { success: true, staticReadOnly: true, data: calculateTcoEstimate(body) };
    }
    if (path === '/registration/estimate' && method === 'POST') {
      return { success: true, staticReadOnly: true, data: calculateRegistrationEstimate(body) };
    }
    if (path === '/policies' && method === 'GET') {
      return {
        success: true,
        staticReadOnly: true,
        data: {
          order_terms: { id: 'pol_order_2026_1', type: 'order_terms', version: '2026.1', title: 'Điều khoản Đặt cọc & Mua bán xe SIGMACAR v2026.1', depositAmountVnd: 50000000, reservationHoldMinutes: 15 },
          return_7d: { id: 'pol_return_2026_1', type: 'return_7d', version: '2026.1', title: 'Chính sách Đổi trả 7 ngày & Hoàn tiền SIGMACAR v2026.1', refundableWithinDays: 7 }
        }
      };
    }
    if (path === '/promotions' && method === 'GET') {
      const store = getStore();
      return { success: true, staticReadOnly: true, data: (store.promotions || createSeedPromotions()).filter(p => p.isActive) };
    }
    if (path === '/promotions/validate' && method === 'POST') {
      const store = getStore();
      const promoResult = evaluatePromo(store.promotions || createSeedPromotions(), body);
      return { success: true, staticReadOnly: true, data: promoResult };
    }
    if (path === '/accessories' && method === 'GET') {
      let items = listAllAccessories();
      const q = String(query.get('q') || '').trim().toLowerCase();
      const cat = String(query.get('category') || '').trim().toLowerCase();
      const kind = String(query.get('kind') || '').trim().toLowerCase();
      if (cat && cat !== 'all') items = items.filter(a => String(a.category || '').toLowerCase() === cat);
      if (kind && kind !== 'all') items = items.filter(a => String(a.kind || '').toLowerCase() === kind);
      if (q) items = items.filter(a => String(a.name || '').toLowerCase().includes(q) || String(a.sku || '').toLowerCase().includes(q));
      return { success: true, staticReadOnly: true, data: { items, total: items.length } };
    }
    if (path.startsWith('/accessories/') && method === 'GET') {
      const sku = decodeURIComponent(path.split('/')[2] || '');
      const item = listAllAccessories().find(a => a.sku === sku || a.id === sku);
      if (!item) throw makeHttpError('Không tìm thấy phụ kiện.', 404, 'ACCESSORY_NOT_FOUND');
      return { success: true, staticReadOnly: true, data: item };
    }
    if (path === '/bundles/recommend' && method === 'GET') {
      const accs = listAllAccessories().slice(0, 3);
      return {
        success: true,
        staticReadOnly: true,
        data: {
          vehicleId: query.get('vehicleId') || null,
          usage: query.get('usage') || 'family',
          items: accs,
          discountPercent: 8,
          note: 'Gợi ý combo phụ kiện tham khảo (giảm 8% khi chọn từ 2 phụ kiện trở lên).'
        }
      };
    }
    if (path === '/bundles/quote' && method === 'POST') {
      const items = Array.isArray(body.items) ? body.items : [];
      const accs = listAllAccessories();
      let subtotal = 0;
      const lines = items.map(i => {
        const found = accs.find(a => a.sku === i.sku || a.id === i.sku);
        const qty = Math.max(1, Number(i.quantity || 1));
        const unitPrice = found ? Number(found.price || 0) : 0;
        const lineTotal = unitPrice * qty;
        subtotal += lineTotal;
        return { sku: i.sku, name: found ? found.name : i.sku, quantity: qty, unitPrice, lineTotal };
      });
      const discountAmount = lines.length >= 2 ? Math.round(subtotal * 0.08) : 0;
      return {
        success: true,
        staticReadOnly: true,
        data: {
          id: safeRandomId('bnd'),
          lines,
          subtotal,
          discountAmount,
          totalAmount: Math.max(0, subtotal - discountAmount)
        }
      };
    }
    if (path === '/charging/stations' && method === 'GET') {
      return { success: true, staticReadOnly: true, data: buildStationsResponse(query) };
    }
    if (path === '/cms/public' && method === 'GET') {
      const store = getStore();
      const pub = (store.cmsContents || SEEDED_CMS_PUBLIC).filter(c => c.status === 'published');
      return { success: true, staticReadOnly: true, data: pub };
    }
    if (path === '/appointments/slots' && method === 'GET') {
      const branchId = query.get('branchId') || 'hn-caugiay';
      const date = query.get('date') || new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const times = ['08:30', '10:00', '13:30', '15:00', '16:30'];
      return {
        success: true,
        staticReadOnly: true,
        data: {
          branchId,
          date,
          slots: times.map(t => ({ time: t, available: true, remaining: 3 }))
        }
      };
    }
    if (path === '/inventory' && method === 'GET') {
      const items = (sd.cars || []).map(c => ({ vehicleId: c.id, name: c.name, totalStock: c.stock ?? 5, availableStock: c.stock ?? 5 }));
      return { success: true, staticReadOnly: true, data: items };
    }
    if (path === '/reviews' && method === 'GET' && query.get('includeModerated') !== 'true') {
      const store = getStore();
      const vehicleId = query.get('vehicleId');
      const reviews = (store.reviews || []).filter(r => (!vehicleId || r.vehicleId === vehicleId) && r.moderationStatus !== 'removed');
      const questions = (store.questions || []).filter(q => !vehicleId || q.vehicleId === vehicleId);
      return {
        success: true,
        staticReadOnly: true,
        data: {
          stats: { averageRating: 0, totalReviews: reviews.length, verifiedCount: reviews.filter(r => r.verifiedPurchase).length, starDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }, criteriaAverages: { design: 0, performance: 0, features: 0, comfort: 0, value: 0 } },
          reviews,
          questions
        }
      };
    }
    if (path === '/support/center' && method === 'GET' && !(options.headers && options.headers.Authorization)) {
      return {
        success: true,
        staticReadOnly: true,
        data: {
          faqs: SEEDED_FAQS,
          tickets: [],
          kpis: { total: 0, open: 0, resolved: 0 }
        }
      };
    }
    if (path === '/analytics/events' && method === 'POST') {
      return { success: true, staticReadOnly: true, data: { skipped: true } };
    }
    return null;
  }

  function handleDemo(endpoint, options = {}, apiClient) {
    const method = String(options.method || 'GET').toUpperCase();
    const { path, query } = parseEndpoint(endpoint);
    const body = parseBody(options);
    const store = getStore();
    const nowIso = new Date().toISOString();

    // 1. Auth Endpoints (Strict credentials, role forced to buyer on register)
    if (path === '/auth/login' && method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const matched = (store.users || []).find(u => u.email.toLowerCase() === email);
      if (!matched || matched.password !== password) {
        throw makeHttpError('Email hoặc mật khẩu không chính xác (Demo Sandbox).', 401, 'INVALID_CREDENTIALS');
      }
      const token = safeRandomId('demo_token');
      store.tokens[token] = matched.id;
      saveStore(store);
      const safeUser = sanitizeUserForClient(matched);
      if (apiClient) {
        apiClient.setToken(token);
        apiClient.setCurrentUser(safeUser);
      }
      return { success: true, demoMode: true, data: { token, user: safeUser } };
    }

    if (path === '/auth/register' && method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const fullName = String(body.fullName || '').trim();
      const phone = String(body.phone || '').trim();
      if (!email || !email.includes('@')) throw makeHttpError('Email không hợp lệ.', 422, 'INVALID_EMAIL');
      if (password.length < 6) throw makeHttpError('Mật khẩu cần tối thiểu 6 ký tự.', 422, 'WEAK_PASSWORD');
      if (!fullName) throw makeHttpError('Vui lòng nhập họ và tên.', 422, 'MISSING_NAME');
      if ((store.users || []).some(u => u.email.toLowerCase() === email)) {
        throw makeHttpError('Email này đã được đăng ký trong Demo Sandbox.', 409, 'EMAIL_EXISTS');
      }
      // Security: always force buyer role on self-registration
      const newUser = {
        id: safeRandomId('usr_demo'),
        email,
        password,
        fullName,
        phone,
        role: 'buyer',
        savedCars: [],
        createdAt: nowIso
      };
      store.users.push(newUser);
      const token = safeRandomId('demo_token');
      store.tokens[token] = newUser.id;
      saveStore(store);
      const safeUser = sanitizeUserForClient(newUser);
      if (apiClient) {
        apiClient.setToken(token);
        apiClient.setCurrentUser(safeUser);
      }
      return { success: true, demoMode: true, data: { token, user: safeUser } };
    }

    if (path === '/auth/me' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      return { success: true, demoMode: true, data: sanitizeUserForClient(user) };
    }

    if (path === '/auth/profile' && method === 'PUT') {
      const user = requireDemoAuth(store, apiClient);
      if (body.fullName) user.fullName = String(body.fullName).trim();
      if (body.phone !== undefined) user.phone = String(body.phone).trim();
      if (body.address !== undefined) user.address = String(body.address).trim();
      if (body.birthDate !== undefined) user.birthDate = body.birthDate;
      saveStore(store);
      return { success: true, demoMode: true, data: sanitizeUserForClient(user) };
    }

    if (path === '/auth/password' && method === 'PUT') {
      const user = requireDemoAuth(store, apiClient);
      if (String(body.currentPassword || '') !== user.password) {
        throw makeHttpError('Mật khẩu hiện tại không đúng.', 401, 'INVALID_PASSWORD');
      }
      if (String(body.newPassword || '').length < 6) {
        throw makeHttpError('Mật khẩu mới cần tối thiểu 6 ký tự.', 422, 'WEAK_PASSWORD');
      }
      user.password = String(body.newPassword);
      saveStore(store);
      return { success: true, demoMode: true, data: { updated: true } };
    }

    if (path === '/auth/preferences' && method === 'PUT') {
      const user = requireDemoAuth(store, apiClient);
      user.preferences = { ...(user.preferences || {}), ...body };
      saveStore(store);
      return { success: true, demoMode: true, data: sanitizeUserForClient(user) };
    }

    if (path === '/auth/saved-cars' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const vid = String(body.vehicleId || '');
      user.savedCars = Array.isArray(user.savedCars) ? user.savedCars : [];
      const idx = user.savedCars.indexOf(vid);
      if (idx >= 0) user.savedCars.splice(idx, 1);
      else if (vid) user.savedCars.push(vid);
      saveStore(store);
      return { success: true, demoMode: true, data: { savedCars: user.savedCars, user: sanitizeUserForClient(user) } };
    }

    if (path === '/unsubscribe' && method === 'POST') {
      return { success: true, demoMode: true, data: { unsubscribed: true } };
    }

    // 2. Cart & Quote Endpoints
    const getOrCreateCart = (userId) => {
      if (!store.carts[userId]) {
        store.carts[userId] = {
          userId,
          items: [],
          promoCode: null,
          branchId: 'hn-caugiay',
          deliveryMethod: 'showroom',
          version: 1,
          updatedAt: nowIso
        };
      }
      return store.carts[userId];
    };

    const hydrateCart = (cart) => {
      const summary = buildQuoteBreakdown({
        items: cart.items,
        promoCode: cart.promoCode,
        branchId: cart.branchId,
        deliveryMethod: cart.deliveryMethod,
        promotions: store.promotions
      });
      return { ...cart, ...summary };
    };

    if (path === '/cart' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      const cart = getOrCreateCart(user.id);
      saveStore(store);
      return { success: true, demoMode: true, data: hydrateCart(cart) };
    }

    if (path === '/cart/items' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const cart = getOrCreateCart(user.id);
      const resolved = resolveCatalogItem(body);
      const qty = Math.min(20, Math.max(1, Math.round(Number(body.quantity || 1))));
      const existing = cart.items.find(i =>
        i.itemType === resolved.itemType &&
        i.itemId === resolved.itemId &&
        (i.colorName || null) === (resolved.colorName || null) &&
        (i.trimName || null) === (resolved.trimName || null)
      );
      if (existing) {
        existing.quantity = resolved.isCertified ? 1 : Math.min(20, (existing.quantity || 1) + qty);
      } else {
        cart.items.push({
          lineId: safeRandomId('ci'),
          itemType: resolved.itemType,
          itemId: resolved.itemId,
          colorName: resolved.colorName,
          colorHex: body.colorHex || null,
          trimName: resolved.trimName,
          quantity: resolved.isCertified ? 1 : qty
        });
      }
      if (body.branchId) cart.branchId = body.branchId;
      cart.version += 1;
      cart.updatedAt = nowIso;
      saveStore(store);
      return { success: true, demoMode: true, data: hydrateCart(cart) };
    }

    if (path === '/cart/merge' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const cart = getOrCreateCart(user.id);
      const items = Array.isArray(body.items) ? body.items : [];
      for (const raw of items) {
        try {
          const resolved = resolveCatalogItem(raw);
          const qty = Math.min(20, Math.max(1, Math.round(Number(raw.quantity || 1))));
          const existing = cart.items.find(i => i.itemType === resolved.itemType && i.itemId === resolved.itemId && (i.colorName || null) === (resolved.colorName || null) && (i.trimName || null) === (resolved.trimName || null));
          if (existing) {
            existing.quantity = resolved.isCertified ? 1 : Math.min(20, (existing.quantity || 1) + qty);
          } else {
            cart.items.push({
              lineId: safeRandomId('ci'),
              itemType: resolved.itemType,
              itemId: resolved.itemId,
              colorName: resolved.colorName,
              trimName: resolved.trimName,
              quantity: resolved.isCertified ? 1 : qty
            });
          }
        } catch (_) {}
      }
      cart.version += 1;
      cart.updatedAt = nowIso;
      saveStore(store);
      return { success: true, demoMode: true, data: hydrateCart(cart) };
    }

    if (path.startsWith('/cart/items/') && method === 'PATCH') {
      const user = requireDemoAuth(store, apiClient);
      const lineId = decodeURIComponent(path.split('/')[3] || '');
      const cart = getOrCreateCart(user.id);
      const line = cart.items.find(i => i.lineId === lineId);
      if (!line) throw makeHttpError('Không tìm thấy sản phẩm trong giỏ hàng.', 404, 'LINE_NOT_FOUND');
      const nextQty = Math.round(Number(body.quantity || 1));
      if (nextQty <= 0) {
        cart.items = cart.items.filter(i => i.lineId !== lineId);
      } else {
        line.quantity = line.itemType === 'certified' ? 1 : Math.min(20, nextQty);
      }
      cart.version += 1;
      cart.updatedAt = nowIso;
      saveStore(store);
      return { success: true, demoMode: true, data: hydrateCart(cart) };
    }

    if (path.startsWith('/cart/items/') && method === 'DELETE') {
      const user = requireDemoAuth(store, apiClient);
      const lineId = decodeURIComponent(path.split('/')[3] || '');
      const cart = getOrCreateCart(user.id);
      cart.items = cart.items.filter(i => i.lineId !== lineId);
      cart.version += 1;
      cart.updatedAt = nowIso;
      saveStore(store);
      return { success: true, demoMode: true, data: hydrateCart(cart) };
    }

    if (path === '/cart' && method === 'PATCH') {
      const user = requireDemoAuth(store, apiClient);
      const cart = getOrCreateCart(user.id);
      if (body.branchId) cart.branchId = body.branchId;
      if (body.deliveryMethod && Object.prototype.hasOwnProperty.call(DELIVERY_FEES_VND, body.deliveryMethod)) {
        cart.deliveryMethod = body.deliveryMethod;
      }
      cart.version += 1;
      cart.updatedAt = nowIso;
      saveStore(store);
      return { success: true, demoMode: true, data: hydrateCart(cart) };
    }

    if (path === '/cart/promo' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const cart = getOrCreateCart(user.id);
      const code = body.code ? String(body.code).trim().toUpperCase() : null;
      if (code) {
        const temp = buildQuoteBreakdown({ items: cart.items, branchId: cart.branchId, deliveryMethod: cart.deliveryMethod, promotions: store.promotions });
        evaluatePromo(store.promotions, { code, subtotal: temp.itemsSubtotal, items: temp.lines });
      }
      cart.promoCode = code;
      cart.version += 1;
      cart.updatedAt = nowIso;
      saveStore(store);
      return { success: true, demoMode: true, data: hydrateCart(cart) };
    }

    if (path === '/cart/bundle' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const cart = getOrCreateCart(user.id);
      const accs = listAllAccessories().slice(0, 2);
      accs.forEach(a => {
        cart.items.push({ lineId: safeRandomId('ci'), itemType: 'accessory', itemId: a.sku || a.id, quantity: 1 });
      });
      cart.version += 1;
      cart.updatedAt = nowIso;
      saveStore(store);
      return { success: true, demoMode: true, data: hydrateCart(cart) };
    }

    if (path === '/cart' && method === 'DELETE') {
      const user = requireDemoAuth(store, apiClient);
      const cart = getOrCreateCart(user.id);
      cart.items = [];
      cart.promoCode = null;
      cart.version += 1;
      cart.updatedAt = nowIso;
      saveStore(store);
      return { success: true, demoMode: true, data: hydrateCart(cart) };
    }

    if (path === '/quotes' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) throw makeHttpError('Cần ít nhất 1 sản phẩm để lập báo giá.', 422, 'EMPTY_QUOTE_ITEMS');
      const breakdown = buildQuoteBreakdown({
        items,
        promoCode: body.promoCode || null,
        branchId: body.branchId || 'hn-caugiay',
        deliveryMethod: body.deliveryMethod || 'showroom',
        promotions: store.promotions
      });
      const quote = {
        id: safeRandomId('qt_demo'),
        userId: user.id,
        ...breakdown,
        isDemoSandbox: true,
        expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
        createdAt: nowIso
      };
      store.quotes.push(quote);
      saveStore(store);
      return { success: true, demoMode: true, data: quote };
    }

    // 3. Checkout & Payment Sandbox
    if (path === '/checkout' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      if (!body.acceptedPolicy) {
        throw makeHttpError('Vui lòng đồng ý Điều khoản Đặt cọc & Chính sách Đổi trả.', 422, 'POLICY_REQUIRED');
      }
      const idemKey = (options.headers && options.headers['Idempotency-Key']) || body.idempotencyKey || null;
      if (idemKey) {
        const existingOrd = store.orders.find(o => o.userId === user.id && o.idempotencyKey === idemKey);
        if (existingOrd) return { success: true, demoMode: true, data: { order: existingOrd } };
      }

      const cart = getOrCreateCart(user.id);
      const sourceItems = body.source === 'cart' ? cart.items : (Array.isArray(body.items) ? body.items : []);
      if (!sourceItems || sourceItems.length === 0) {
        throw makeHttpError('Không có sản phẩm để khởi tạo đơn hàng.', 422, 'EMPTY_CHECKOUT');
      }
      const breakdown = buildQuoteBreakdown({
        items: sourceItems,
        promoCode: body.promoCode || (body.source === 'cart' ? cart.promoCode : null),
        branchId: body.branchId || cart.branchId || 'hn-caugiay',
        deliveryMethod: body.deliveryMethod || cart.deliveryMethod || 'showroom',
        promotions: store.promotions
      });
      const branches = getBranches();
      const branch = branches.find(b => b.id === breakdown.branchId) || branches[0];
      const primaryLine = breakdown.lines[0];
      const order = {
        id: safeRandomId('ord_demo'),
        orderNumber: `SG-DEMO-${Date.now().toString().slice(-6)}`,
        userId: user.id,
        buyerName: String(body.buyerName || user.fullName || '').trim(),
        buyerPhone: String(body.buyerPhone || user.phone || '').trim(),
        buyerEmail: user.email,
        vehicleId: primaryLine ? primaryLine.itemId : '',
        vehicleName: primaryLine ? primaryLine.name : 'Đơn hàng SIGMACAR',
        img: primaryLine ? primaryLine.image : 'assets/car-model-e.jpg',
        items: breakdown.lines,
        itemsSubtotal: breakdown.itemsSubtotal,
        discountAmount: breakdown.discountAmount,
        deliveryFee: breakdown.deliveryFee,
        unitPrice: breakdown.totalAmount,
        totalAmount: breakdown.totalAmount,
        depositAmount: breakdown.depositAmount,
        paidAmount: 0,
        paymentMode: body.paymentMode === 'full' ? 'full' : 'deposit',
        deliveryMethod: breakdown.deliveryMethod,
        deliveryAddress: String(body.deliveryAddress || '').trim(),
        branchId: branch.id,
        branchName: branch.name,
        orderStatus: 'pending_payment',
        paymentStatus: 'unpaid',
        status: 'Chờ thanh toán (Demo Sandbox)',
        policyVersion: breakdown.policyVersion,
        idempotencyKey: idemKey,
        isDemoSandbox: true,
        timeline: [
          {
            event: 'order_created',
            title: 'Khởi tạo đơn hàng Demo Sandbox',
            note: `Giữ chỗ 15 phút tại ${branch.name} (mô phỏng trình duyệt).`,
            at: nowIso
          }
        ],
        createdAt: nowIso,
        updatedAt: nowIso
      };
      store.orders.unshift(order);
      if (body.source === 'cart') {
        cart.items = [];
        cart.promoCode = null;
        cart.version += 1;
      }
      store.notifications.unshift({
        id: safeRandomId('ntf'),
        userId: user.id,
        title: `[Demo Sandbox] Đã tạo đơn ${order.orderNumber}`,
        body: `Số tiền cần thanh toán mô phỏng: ${Number(order.paymentMode === 'full' ? order.totalAmount : order.depositAmount).toLocaleString('vi-VN')} VNĐ.`,
        read: false,
        createdAt: nowIso
      });
      saveStore(store);
      return { success: true, demoMode: true, data: { order } };
    }

    if (path === '/payments/intents' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const order = store.orders.find(o => o.id === body.orderId);
      if (!order) throw makeHttpError('Không tìm thấy đơn hàng.', 404, 'ORDER_NOT_FOUND');
      const isStaff = ['seller', 'admin'].includes(user.role);
      if (!isStaff && order.userId !== user.id) throw makeHttpError('Không có quyền truy cập đơn hàng này.', 403, 'FORBIDDEN');

      const mode = body.mode === 'full' ? 'full' : 'deposit';
      const remaining = Math.max(0, (order.totalAmount || 0) - (order.paidAmount || 0));
      const amount = mode === 'full' ? remaining : Math.min(remaining, order.depositAmount || 50000000);
      const intent = {
        id: safeRandomId('pi_demo'),
        orderId: order.id,
        userId: user.id,
        mode,
        provider: body.provider || 'napas_qr_sandbox',
        amount,
        status: 'pending',
        qrCodePayload: `SIGMA_DEMO_QR|${order.orderNumber}|${amount}`,
        expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
        isDemoSandbox: true,
        disclaimer: 'Thanh toán mô phỏng Demo Sandbox — Không phát sinh giao dịch tiền thật.',
        createdAt: nowIso,
        updatedAt: nowIso
      };
      store.paymentIntents.push(intent);
      saveStore(store);
      return { success: true, demoMode: true, data: intent };
    }

    if (path.startsWith('/payments/intents/') && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      const orderId = decodeURIComponent(path.split('/')[3] || '');
      const order = store.orders.find(o => o.id === orderId);
      if (!order) throw makeHttpError('Không tìm thấy đơn hàng.', 404, 'ORDER_NOT_FOUND');
      if (!['seller', 'admin'].includes(user.role) && order.userId !== user.id) {
        throw makeHttpError('Không có quyền xem lịch sử thanh toán đơn này.', 403, 'FORBIDDEN');
      }
      const intents = store.paymentIntents.filter(p => p.orderId === orderId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return { success: true, demoMode: true, data: { orderId, intents } };
    }

    if (path === '/payments/sandbox/simulate' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const intent = store.paymentIntents.find(p => p.id === body.intentId);
      if (!intent) throw makeHttpError('Không tìm thấy phiên thanh toán.', 404, 'INTENT_NOT_FOUND');
      const order = store.orders.find(o => o.id === intent.orderId);
      if (!order) throw makeHttpError('Không tìm thấy đơn hàng.', 404, 'ORDER_NOT_FOUND');
      if (!['seller', 'admin'].includes(user.role) && order.userId !== user.id) {
        throw makeHttpError('Không có quyền thao tác phiên thanh toán này.', 403, 'FORBIDDEN');
      }

      const nextStatus = body.status === 'failed' ? 'failed' : 'succeeded';
      intent.status = nextStatus;
      intent.updatedAt = nowIso;

      if (nextStatus === 'succeeded') {
        order.paidAmount = Math.min(order.totalAmount, (order.paidAmount || 0) + (intent.amount || 0));
        if (order.paidAmount >= order.totalAmount) {
          order.paymentStatus = 'fully_paid';
          order.orderStatus = 'paid';
          order.status = 'Đã thanh toán toàn bộ (Demo Sandbox)';
        } else {
          order.paymentStatus = 'deposit_paid';
          order.orderStatus = 'confirmed';
          order.status = 'Đã đặt cọc (Demo Sandbox)';
        }
        order.timeline = order.timeline || [];
        order.timeline.push({
          event: 'payment_succeeded',
          title: 'Mô phỏng Webhook Thanh toán Thành công',
          note: `Đã ghi nhận ${Number(intent.amount).toLocaleString('vi-VN')} VNĐ trên Demo Sandbox (không thu tiền thật).`,
          at: nowIso
        });
      } else {
        order.timeline = order.timeline || [];
        order.timeline.push({
          event: 'payment_failed',
          title: 'Mô phỏng Thanh toán Thất bại',
          note: 'Giao dịch sandbox được đánh dấu lỗi.',
          at: nowIso
        });
      }
      order.updatedAt = nowIso;
      saveStore(store);
      return { success: true, demoMode: true, data: { intent, order } };
    }

    // 4. Orders
    if (path === '/orders/deposit' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const v = findVehicle(body.vehicleId);
      if (!v) throw makeHttpError('Không tìm thấy xe yêu cầu.', 404, 'VEHICLE_NOT_FOUND');
      const branches = getBranches();
      const branch = branches.find(b => b.id === body.branchId) || branches[0];
      const total = Number(v.salePrice && v.salePrice < v.price ? v.salePrice : v.price) || 0;
      const dep = Math.min(total, 50000000);
      const order = {
        id: safeRandomId('ord_demo'),
        orderNumber: `SG-DEMO-${Date.now().toString().slice(-6)}`,
        userId: user.id,
        buyerName: String(body.buyerName || user.fullName || '').trim(),
        buyerPhone: String(body.buyerPhone || user.phone || '').trim(),
        buyerEmail: user.email,
        vehicleId: v.id,
        vehicleName: v.name,
        img: v.image,
        unitPrice: total,
        totalAmount: total,
        depositAmount: dep,
        paidAmount: 0,
        paymentMode: 'deposit',
        branchId: branch.id,
        branchName: branch.name,
        orderStatus: 'pending_payment',
        paymentStatus: 'unpaid',
        status: 'Chờ đặt cọc (Demo Sandbox)',
        isDemoSandbox: true,
        timeline: [{ event: 'order_created', title: 'Đặt cọc nhanh (Demo Sandbox)', note: branch.name, at: nowIso }],
        createdAt: nowIso,
        updatedAt: nowIso
      };
      store.orders.unshift(order);
      saveStore(store);
      return { success: true, demoMode: true, data: order };
    }

    if (path === '/orders' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      const isStaff = ['seller', 'admin'].includes(user.role);
      const orders = isStaff ? store.orders : store.orders.filter(o => o.userId === user.id);
      return { success: true, demoMode: true, data: orders };
    }

    if (path.startsWith('/orders/') && path.endsWith('/timeline') && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      const orderId = decodeURIComponent(path.split('/')[2] || '');
      const order = store.orders.find(o => o.id === orderId);
      if (!order) throw makeHttpError('Không tìm thấy đơn hàng.', 404, 'ORDER_NOT_FOUND');
      if (!['seller', 'admin'].includes(user.role) && order.userId !== user.id) throw makeHttpError('Không có quyền.', 403, 'FORBIDDEN');
      return { success: true, demoMode: true, data: { orderId, timeline: order.timeline || [] } };
    }

    if (path.startsWith('/orders/') && path.endsWith('/status') && method === 'PATCH') {
      const user = requireDemoAuth(store, apiClient);
      assertStaffRole(user, ['seller', 'admin']);
      const orderId = decodeURIComponent(path.split('/')[2] || '');
      const order = store.orders.find(o => o.id === orderId);
      if (!order) throw makeHttpError('Không tìm thấy đơn hàng.', 404, 'ORDER_NOT_FOUND');
      order.status = body.status || order.status;
      order.orderStatus = body.status || order.orderStatus;
      order.timeline = order.timeline || [];
      order.timeline.push({ event: 'status_updated', title: `Cập nhật trạng thái: ${order.status}`, note: body.note || '', at: nowIso });
      order.updatedAt = nowIso;
      saveStore(store);
      return { success: true, demoMode: true, data: order };
    }

    if (path.startsWith('/orders/') && path.endsWith('/complete-payment') && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const orderId = decodeURIComponent(path.split('/')[2] || '');
      const order = store.orders.find(o => o.id === orderId);
      if (!order) throw makeHttpError('Không tìm thấy đơn hàng.', 404, 'ORDER_NOT_FOUND');
      if (!['seller', 'admin'].includes(user.role) && order.userId !== user.id) throw makeHttpError('Không có quyền.', 403, 'FORBIDDEN');
      order.paidAmount = order.totalAmount;
      order.paymentStatus = 'fully_paid';
      order.orderStatus = 'paid';
      order.status = 'Đã tất toán (Demo Sandbox)';
      order.timeline = order.timeline || [];
      order.timeline.push({ event: 'complete_payment', title: 'Tất toán mô phỏng (Demo Sandbox)', note: 'Không thu tiền thật.', at: nowIso });
      saveStore(store);
      return { success: true, demoMode: true, data: order };
    }

    if (path.startsWith('/orders/') && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      const orderId = decodeURIComponent(path.split('/')[2] || '');
      const order = store.orders.find(o => o.id === orderId);
      if (!order) throw makeHttpError('Không tìm thấy đơn hàng.', 404, 'ORDER_NOT_FOUND');
      if (!['seller', 'admin'].includes(user.role) && order.userId !== user.id) throw makeHttpError('Không có quyền.', 403, 'FORBIDDEN');
      return { success: true, demoMode: true, data: order };
    }

    // 5. Appointments, Configurations, Financing Applications, Garage, Notifications
    if (path === '/appointments' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      const isStaff = ['seller', 'admin', 'service_staff'].includes(user.role);
      return { success: true, demoMode: true, data: isStaff ? store.appointments : store.appointments.filter(a => a.userId === user.id) };
    }
    if (path === '/appointments' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const appt = { id: safeRandomId('apt_demo'), userId: user.id, ...body, status: 'confirmed', isDemoSandbox: true, createdAt: nowIso };
      store.appointments.unshift(appt);
      saveStore(store);
      return { success: true, demoMode: true, data: appt };
    }
    if (path.startsWith('/appointments/') && (path.endsWith('/status') || path.endsWith('/reschedule')) && method === 'PATCH') {
      const user = requireDemoAuth(store, apiClient);
      const id = decodeURIComponent(path.split('/')[2] || '');
      const appt = store.appointments.find(a => a.id === id);
      if (!appt) throw makeHttpError('Không tìm thấy lịch hẹn.', 404, 'APPT_NOT_FOUND');
      Object.assign(appt, body, { updatedAt: nowIso });
      saveStore(store);
      return { success: true, demoMode: true, data: appt };
    }

    if (path === '/configurations' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      return { success: true, demoMode: true, data: store.configurations.filter(c => c.userId === user.id) };
    }
    if (path === '/configurations' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const cfg = { id: safeRandomId('cfg_demo'), userId: user.id, ...body, createdAt: nowIso, updatedAt: nowIso };
      store.configurations.unshift(cfg);
      saveStore(store);
      return { success: true, demoMode: true, data: cfg };
    }
    if (path.startsWith('/configurations/') && method === 'PATCH') {
      const user = requireDemoAuth(store, apiClient);
      const id = decodeURIComponent(path.split('/')[2] || '');
      const cfg = store.configurations.find(c => c.id === id && c.userId === user.id);
      if (!cfg) throw makeHttpError('Không tìm thấy cấu hình xe.', 404, 'CONFIG_NOT_FOUND');
      Object.assign(cfg, body, { updatedAt: nowIso });
      saveStore(store);
      return { success: true, demoMode: true, data: cfg };
    }
    if (path.startsWith('/configurations/') && method === 'DELETE') {
      const user = requireDemoAuth(store, apiClient);
      const id = decodeURIComponent(path.split('/')[2] || '');
      store.configurations = store.configurations.filter(c => !(c.id === id && c.userId === user.id));
      saveStore(store);
      return { success: true, demoMode: true, data: { deleted: true } };
    }

    if (path === '/financing/applications' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      const isStaff = ['seller', 'admin'].includes(user.role);
      return { success: true, demoMode: true, data: isStaff ? store.financingApplications : store.financingApplications.filter(f => f.userId === user.id) };
    }
    if (path === '/financing/applications' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const app = { id: safeRandomId('fin_demo'), userId: user.id, ...body, status: 'submitted', createdAt: nowIso };
      store.financingApplications.unshift(app);
      saveStore(store);
      return { success: true, demoMode: true, data: app };
    }
    if (path.startsWith('/financing/applications/') && path.endsWith('/review') && method === 'PATCH') {
      const user = requireDemoAuth(store, apiClient);
      assertStaffRole(user, ['seller', 'admin']);
      const id = decodeURIComponent(path.split('/')[3] || '');
      const app = store.financingApplications.find(f => f.id === id);
      if (!app) throw makeHttpError('Không tìm thấy hồ sơ trả góp.', 404, 'APP_NOT_FOUND');
      Object.assign(app, body, { updatedAt: nowIso });
      saveStore(store);
      return { success: true, demoMode: true, data: app };
    }

    if (path === '/garage' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      const userOrders = store.orders.filter(o => o.userId === user.id);
      return {
        success: true,
        demoMode: true,
        data: {
          vehicles: userOrders,
          warranties: store.warranties.filter(w => w.userId === user.id),
          configurations: store.configurations.filter(c => c.userId === user.id)
        }
      };
    }

    if (path === '/notifications' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      return { success: true, demoMode: true, data: store.notifications.filter(n => n.userId === user.id) };
    }
    if (path.startsWith('/notifications/') && path.endsWith('/read') && method === 'PATCH') {
      const user = requireDemoAuth(store, apiClient);
      const id = decodeURIComponent(path.split('/')[2] || '');
      const notif = store.notifications.find(n => n.id === id && n.userId === user.id);
      if (notif) notif.read = true;
      saveStore(store);
      return { success: true, demoMode: true, data: notif || { id, read: true } };
    }

    // 6. Support, Reviews, Registration, Contracts, Warranty Claims, Returns, CMS, Workshop, Analytics
    if (path === '/support/center' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      const isStaff = ['seller', 'admin', 'support_staff'].includes(user.role);
      const tickets = isStaff ? store.supportTickets : store.supportTickets.filter(t => t.userId === user.id);
      return { success: true, demoMode: true, data: { faqs: SEEDED_FAQS, tickets, kpis: { total: tickets.length, open: tickets.filter(t => t.status !== 'resolved').length, resolved: tickets.filter(t => t.status === 'resolved').length } } };
    }
    if (path === '/support/tickets' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const ticket = { id: safeRandomId('tkt_demo'), code: `TK-${Date.now().toString().slice(-5)}`, userId: user.id, ...body, status: 'open', messages: [{ id: safeRandomId('msg'), senderName: user.fullName, senderRole: 'buyer', content: body.description || body.message || '', createdAt: nowIso }], createdAt: nowIso };
      store.supportTickets.unshift(ticket);
      saveStore(store);
      return { success: true, demoMode: true, data: ticket };
    }
    if (path === '/support/tickets/lookup' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      const code = String(query.get('code') || '').trim().toUpperCase();
      const ticket = store.supportTickets.find(t => String(t.code || '').toUpperCase() === code && (t.userId === user.id || ['seller', 'admin', 'support_staff'].includes(user.role)));
      if (!ticket) throw makeHttpError('Không tìm thấy phiếu hỗ trợ phù hợp.', 404, 'TICKET_NOT_FOUND');
      return { success: true, demoMode: true, data: ticket };
    }
    if (path.startsWith('/support/tickets/') && path.endsWith('/reply') && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const id = decodeURIComponent(path.split('/')[3] || '');
      const ticket = store.supportTickets.find(t => t.id === id);
      if (!ticket) throw makeHttpError('Không tìm thấy phiếu hỗ trợ.', 404, 'TICKET_NOT_FOUND');
      ticket.messages = ticket.messages || [];
      ticket.messages.push({ id: safeRandomId('msg'), senderName: user.fullName, senderRole: user.role, content: body.content || body.message || '', createdAt: nowIso });
      saveStore(store);
      return { success: true, demoMode: true, data: ticket };
    }
    if (path.startsWith('/support/tickets/') && path.endsWith('/rate') && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const id = decodeURIComponent(path.split('/')[3] || '');
      const ticket = store.supportTickets.find(t => t.id === id && t.userId === user.id);
      if (!ticket) throw makeHttpError('Không tìm thấy phiếu hỗ trợ.', 404, 'TICKET_NOT_FOUND');
      ticket.csatRating = body.rating;
      ticket.csatComment = body.comment || '';
      saveStore(store);
      return { success: true, demoMode: true, data: ticket };
    }
    if (path.startsWith('/support/tickets/') && method === 'PATCH') {
      const user = requireDemoAuth(store, apiClient);
      assertStaffRole(user, ['seller', 'admin', 'support_staff']);
      const id = decodeURIComponent(path.split('/')[3] || '');
      const ticket = store.supportTickets.find(t => t.id === id);
      if (!ticket) throw makeHttpError('Không tìm thấy phiếu hỗ trợ.', 404, 'TICKET_NOT_FOUND');
      Object.assign(ticket, body, { updatedAt: nowIso });
      saveStore(store);
      return { success: true, demoMode: true, data: ticket };
    }

    if (path === '/reviews' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const rev = { id: safeRandomId('rev_demo'), userId: user.id, authorName: user.fullName, ...body, moderationStatus: 'approved', helpfulVoterIds: [], createdAt: nowIso };
      store.reviews.unshift(rev);
      saveStore(store);
      return { success: true, demoMode: true, data: rev };
    }
    if (path.startsWith('/reviews/') && path.endsWith('/helpful') && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const id = decodeURIComponent(path.split('/')[2] || '');
      const rev = store.reviews.find(r => r.id === id);
      if (!rev) throw makeHttpError('Không tìm thấy đánh giá.', 404, 'REVIEW_NOT_FOUND');
      rev.helpfulVoterIds = rev.helpfulVoterIds || [];
      const idx = rev.helpfulVoterIds.indexOf(user.id);
      if (idx >= 0) rev.helpfulVoterIds.splice(idx, 1);
      else rev.helpfulVoterIds.push(user.id);
      saveStore(store);
      return { success: true, demoMode: true, data: rev };
    }
    if (path.startsWith('/reviews/') && path.endsWith('/moderate') && method === 'PATCH') {
      const user = requireDemoAuth(store, apiClient);
      assertStaffRole(user, ['seller', 'admin', 'support_staff']);
      const id = decodeURIComponent(path.split('/')[2] || '');
      const rev = store.reviews.find(r => r.id === id);
      if (!rev) throw makeHttpError('Không tìm thấy đánh giá.', 404, 'REVIEW_NOT_FOUND');
      rev.moderationStatus = body.action === 'hide' ? 'hidden' : (body.action === 'remove' ? 'removed' : 'approved');
      saveStore(store);
      return { success: true, demoMode: true, data: rev };
    }
    if (path === '/reviews' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      assertStaffRole(user, ['seller', 'admin', 'support_staff']);
      return { success: true, demoMode: true, data: { reviews: store.reviews, questions: store.questions } };
    }
    if (path === '/questions' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const q = { id: safeRandomId('q_demo'), userId: user.id, authorName: user.fullName, ...body, answers: [], createdAt: nowIso };
      store.questions.unshift(q);
      saveStore(store);
      return { success: true, demoMode: true, data: q };
    }
    if (path.startsWith('/questions/') && path.endsWith('/answer') && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const id = decodeURIComponent(path.split('/')[2] || '');
      const q = store.questions.find(item => item.id === id);
      if (!q) throw makeHttpError('Không tìm thấy câu hỏi.', 404, 'QUESTION_NOT_FOUND');
      q.answers = q.answers || [];
      q.answers.push({ id: safeRandomId('ans'), authorName: user.fullName, authorRole: user.role, content: body.content || '', createdAt: nowIso });
      saveStore(store);
      return { success: true, demoMode: true, data: q };
    }

    if (path === '/registration/cases' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      const isStaff = ['seller', 'admin'].includes(user.role);
      return { success: true, demoMode: true, data: isStaff ? store.registrationCases : store.registrationCases.filter(c => c.userId === user.id) };
    }
    if (path === '/registration/cases' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const regCase = { id: safeRandomId('reg_demo'), userId: user.id, ...body, status: 'draft', createdAt: nowIso, updatedAt: nowIso };
      store.registrationCases.unshift(regCase);
      saveStore(store);
      return { success: true, demoMode: true, data: regCase };
    }
    if (path.startsWith('/registration/cases/') && path.endsWith('/submit') && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const id = decodeURIComponent(path.split('/')[3] || '');
      const regCase = store.registrationCases.find(c => c.id === id && (c.userId === user.id || ['seller', 'admin'].includes(user.role)));
      if (!regCase) throw makeHttpError('Không tìm thấy hồ sơ đăng ký.', 404, 'CASE_NOT_FOUND');
      regCase.status = 'submitted';
      regCase.updatedAt = nowIso;
      saveStore(store);
      return { success: true, demoMode: true, data: regCase };
    }

    if (path === '/media/upload' && method === 'POST') {
      requireDemoAuth(store, apiClient);
      return { success: true, demoMode: true, data: { id: safeRandomId('med_demo'), fileName: body.fileName || 'document.png', signedUrl: body.dataUrl || '', createdAt: nowIso } };
    }

    if (path === '/contracts' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      const isStaff = ['seller', 'admin'].includes(user.role);
      return { success: true, demoMode: true, data: isStaff ? store.contracts : store.contracts.filter(c => c.userId === user.id) };
    }
    if (path === '/contracts/generate' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const ord = store.orders.find(o => o.id === body.orderId);
      if (!ord) throw makeHttpError('Không tìm thấy đơn hàng.', 404, 'ORDER_NOT_FOUND');
      const ctr = { id: safeRandomId('ctr_demo'), orderId: ord.id, userId: ord.userId, orderNumber: ord.orderNumber, vehicleName: ord.vehicleName, totalAmount: ord.totalAmount, depositAmount: ord.depositAmount, policyVersion: '2026.1-DEMO', status: 'generated', revisionNote: body.revisionNote || '', acknowledgedAt: null, createdAt: nowIso };
      store.contracts.unshift(ctr);
      saveStore(store);
      return { success: true, demoMode: true, data: ctr };
    }
    if (path.startsWith('/contracts/') && path.endsWith('/acknowledge') && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const id = decodeURIComponent(path.split('/')[2] || '');
      const ctr = store.contracts.find(c => c.id === id && (c.userId === user.id || ['seller', 'admin'].includes(user.role)));
      if (!ctr) throw makeHttpError('Không tìm thấy hợp đồng.', 404, 'CONTRACT_NOT_FOUND');
      ctr.status = 'acknowledged';
      ctr.acknowledgedAt = nowIso;
      saveStore(store);
      return { success: true, demoMode: true, data: ctr };
    }
    if (path.startsWith('/contracts/') && path.endsWith('/document') && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      const id = decodeURIComponent(path.split('/')[2] || '');
      const ctr = store.contracts.find(c => c.id === id && (c.userId === user.id || ['seller', 'admin'].includes(user.role)));
      if (!ctr) throw makeHttpError('Không tìm thấy hợp đồng.', 404, 'CONTRACT_NOT_FOUND');
      return { success: true, demoMode: true, data: { html: `<div style="padding:20px;font-family:sans-serif;"><h2>PHIẾU THỎA THUẬN ĐẶT CỌC MÔ PHỎNG (${ctr.id})</h2><p>Đơn hàng: ${ctr.orderNumber}</p><p>Mẫu xe: ${ctr.vehicleName}</p><p>Giá trị: ${Number(ctr.totalAmount).toLocaleString('vi-VN')} VNĐ</p><p><em>Chế độ Demo Sandbox - Tài liệu tham khảo trình duyệt.</em></p></div>` } };
    }

    if (path === '/warranty-claims' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      const isStaff = ['seller', 'admin', 'service_staff'].includes(user.role);
      return { success: true, demoMode: true, data: isStaff ? store.warrantyClaims : store.warrantyClaims.filter(c => c.userId === user.id) };
    }
    if (path === '/warranty-claims' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      const claim = { id: safeRandomId('wc_demo'), userId: user.id, ...body, status: 'submitted', createdAt: nowIso };
      store.warrantyClaims.unshift(claim);
      saveStore(store);
      return { success: true, demoMode: true, data: claim };
    }
    if (path.startsWith('/warranty-claims/') && path.endsWith('/review') && method === 'PATCH') {
      const user = requireDemoAuth(store, apiClient);
      assertStaffRole(user, ['seller', 'admin', 'service_staff']);
      const id = decodeURIComponent(path.split('/')[2] || '');
      const claim = store.warrantyClaims.find(c => c.id === id);
      if (!claim) throw makeHttpError('Không tìm thấy yêu cầu bảo hành.', 404, 'CLAIM_NOT_FOUND');
      Object.assign(claim, body, { updatedAt: nowIso });
      saveStore(store);
      return { success: true, demoMode: true, data: claim };
    }

    if (path === '/returns/my' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      return { success: true, demoMode: true, data: { eligibleOrders: [], returns: store.returns.filter(r => r.userId === user.id) } };
    }
    if (path === '/returns' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      assertStaffRole(user);
      return { success: true, demoMode: true, data: store.returns };
    }

    if (path === '/warranties/my-garage' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      return { success: true, demoMode: true, data: store.warranties.filter(w => w.userId === user.id) };
    }
    if (path === '/warranties/admin-overview' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      assertStaffRole(user, ['seller', 'admin', 'service_staff']);
      return { success: true, demoMode: true, data: store.warranties };
    }

    if (path === '/cms' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      assertStaffRole(user, ['seller', 'admin']);
      return { success: true, demoMode: true, data: store.cmsContents };
    }
    if (path === '/cms' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      assertStaffRole(user, ['seller', 'admin']);
      const block = { id: body.id || safeRandomId('cms_demo'), ...body, status: body.status || 'draft', updatedAt: nowIso };
      const idx = store.cmsContents.findIndex(c => c.id === block.id);
      if (idx >= 0) store.cmsContents[idx] = block;
      else store.cmsContents.unshift(block);
      saveStore(store);
      return { success: true, demoMode: true, data: block };
    }
    if (path.startsWith('/cms/') && (path.endsWith('/publish') || path.endsWith('/rollback')) && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      assertStaffRole(user, ['seller', 'admin']);
      const id = decodeURIComponent(path.split('/')[2] || '');
      const block = store.cmsContents.find(c => c.id === id);
      if (!block) throw makeHttpError('Không tìm thấy block CMS.', 404, 'CMS_NOT_FOUND');
      block.status = path.endsWith('/publish') ? (body.scheduledAt ? 'scheduled' : 'published') : 'draft';
      block.updatedAt = nowIso;
      saveStore(store);
      return { success: true, demoMode: true, data: block };
    }

    if (path === '/workshop/resources' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      assertStaffRole(user, ['seller', 'admin', 'service_staff']);
      return {
        success: true,
        demoMode: true,
        data: {
          centers: getBranches(),
          bays: [{ id: 'bay_hn_1', serviceCenterId: 'hn-caugiay', name: 'Khoang Sửa chữa #1', type: 'ev_diag' }],
          technicians: [{ id: 'tech_1', serviceCenterId: 'hn-caugiay', name: 'KTV Nguyễn Văn Hùng' }],
          parts: [{ sku: 'PART-PAD-01', name: 'Má phanh gốm EV', stock: 12 }]
        }
      };
    }
    if (path === '/workshop/jobs' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      assertStaffRole(user, ['seller', 'admin', 'service_staff']);
      return { success: true, demoMode: true, data: store.workshopJobs };
    }
    if (path === '/workshop/jobs' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      assertStaffRole(user, ['seller', 'admin', 'service_staff']);
      const job = { id: safeRandomId('wj_demo'), ...body, status: 'scheduled', createdAt: nowIso };
      store.workshopJobs.unshift(job);
      saveStore(store);
      return { success: true, demoMode: true, data: job };
    }
    if (path === '/workshop/availability' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      assertStaffRole(user, ['seller', 'admin', 'service_staff']);
      return { success: true, demoMode: true, data: { slots: ['08:00', '10:00', '13:30', '15:30'].map(t => ({ time: t, available: true })) } };
    }
    if (path.startsWith('/workshop/jobs/') && (path.endsWith('/reassign') || path.endsWith('/cancel') || path.endsWith('/complete')) && method === 'PATCH') {
      const user = requireDemoAuth(store, apiClient);
      assertStaffRole(user, ['seller', 'admin', 'service_staff']);
      const id = decodeURIComponent(path.split('/')[3] || '');
      const job = store.workshopJobs.find(j => j.id === id);
      if (!job) throw makeHttpError('Không tìm thấy lệnh xưởng.', 404, 'JOB_NOT_FOUND');
      if (path.endsWith('/cancel')) job.status = 'cancelled';
      else if (path.endsWith('/complete')) job.status = 'completed';
      else Object.assign(job, body);
      job.updatedAt = nowIso;
      saveStore(store);
      return { success: true, demoMode: true, data: job };
    }

    if (path === '/promotions' && method === 'POST') {
      const user = requireDemoAuth(store, apiClient);
      assertStaffRole(user, ['seller', 'admin']);
      const promo = { id: safeRandomId('promo_demo'), isActive: true, usedCount: 0, ...body, code: String(body.code || '').toUpperCase(), createdAt: nowIso };
      store.promotions.unshift(promo);
      saveStore(store);
      return { success: true, demoMode: true, data: promo };
    }

    if (path === '/analytics/overview' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      assertStaffRole(user, ['seller', 'admin']);
      const orders = store.orders.filter(o => o.orderStatus !== 'cancelled');
      const gmv = orders.reduce((s, o) => s + Number(o.totalAmount || 0), 0);
      const collected = orders.reduce((s, o) => s + Number(o.paidAmount || 0), 0);
      return {
        success: true,
        demoMode: true,
        data: {
          totalOrders: orders.length,
          gmvVnd: gmv,
          cashCollectedVnd: collected,
          pendingOrders: orders.filter(o => o.orderStatus === 'pending_payment').length,
          appointmentsCount: store.appointments.length,
          financingAppsCount: store.financingApplications.length,
          isDemoSandbox: true
        }
      };
    }
    if (path === '/analytics/funnel' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      assertStaffRole(user, ['seller', 'admin']);
      return {
        success: true,
        demoMode: true,
        data: {
          steps: [
            { step: 'view_vehicle', count: store.analyticsEvents.length },
            { step: 'quote_created', count: store.quotes.length },
            { step: 'checkout_submitted', count: store.orders.length },
            { step: 'payment_succeeded', count: store.orders.filter(o => (o.paidAmount || 0) > 0).length }
          ],
          isDemoSandbox: true
        }
      };
    }

    if (path === '/admin/users' && method === 'GET') {
      const user = requireDemoAuth(store, apiClient);
      assertStaffRole(user, ['admin']);
      return { success: true, demoMode: true, data: store.users.map(sanitizeUserForClient) };
    }

    throw makeHttpError(`Thao tác "${method} ${path}" chưa hỗ trợ trong Demo Sandbox cục bộ.`, 503, 'BACKEND_UNAVAILABLE');
  }

  globalScope.SigmaStaticSandbox = {
    STORE_KEY,
    handlePublic,
    handleDemo,
    resetStore,
    getStore,
    buildQuoteBreakdown,
    evaluatePromo,
    calculateTcoEstimate,
    calculateRegistrationEstimate
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = globalScope.SigmaStaticSandbox;
  }
})(typeof window !== 'undefined' ? window : globalThis);
