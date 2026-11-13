// backend/application/tco-service.js
// Transparent Versioned Total Cost of Ownership (TCO) & Operating Cost Estimator (SIG-P3-002)

const { dbState } = require('../infrastructure/storage-engine');
const Security = require('../infrastructure/security');

const TCO_ASSUMPTIONS_SEED = {
  id: 'TCO-VN-2026.1',
  formulaVersion: 'TCO-VN-2026.1',
  effectiveFrom: '2026-11-01',
  region: 'vietnam',
  regions: {
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
  },
  sourceNote: 'Đơn giá điện/xăng là mức THAM CHIẾU mặc định theo vùng (chưa phải giá bán lẻ thời gian thực tại mọi trạm/bậc thang). Khách hàng có thể tự chỉnh sửa trực tiếp mọi tham số.'
};

function createError(message, statusCode = 422, code = 'VALIDATION_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function assertNonNegativeFinite(value, fieldLabel, { max = Infinity, allowNull = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (allowNull) return null;
    throw createError(`Thiếu tham số bắt buộc: ${fieldLabel}.`, 422, 'MISSING_FIELD');
  }
  const num = Number(value);
  if (typeof value === 'boolean' || !Number.isFinite(num) || num < 0 || num > max) {
    throw createError(`Giá trị "${fieldLabel}" phải là số hợp lệ (>= 0${Number.isFinite(max) ? ` và <= ${max}` : ''}).`, 422, 'INVALID_NUMERIC_INPUT');
  }
  return num;
}

const TcoService = {
  getAssumptions(region = 'vietnam') {
    const stored = Array.isArray(dbState.tcoAssumptions) && dbState.tcoAssumptions.length > 0
      ? dbState.tcoAssumptions[0]
      : TCO_ASSUMPTIONS_SEED;
    const regionKey = String(region || 'vietnam').toLowerCase();
    const regionPreset = (stored.regions && stored.regions[regionKey]) || stored.regions.vietnam;
    return {
      formulaVersion: stored.formulaVersion,
      effectiveFrom: stored.effectiveFrom,
      region: regionKey,
      regionPreset,
      regions: stored.regions,
      sourceNote: stored.sourceNote,
      isLiveRateFeed: false
    };
  },

  estimate(payload = {}) {
    const assumptions = this.getAssumptions(payload.region);
    const preset = assumptions.regionPreset;

    let vehicle = null;
    if (payload.vehicleId) {
      vehicle = (dbState.vehicles || []).find(v => v.id === payload.vehicleId) ||
        (dbState.certifiedVehicles || []).find(v => v.id === payload.vehicleId) || null;
      if (!vehicle) {
        throw createError(`Không tìm thấy xe "${payload.vehicleId}" để tính chi phí vận hành.`, 404, 'VEHICLE_NOT_FOUND');
      }
    }

    const rawFuel = String(payload.fuelType || payload.fuel || (vehicle && vehicle.fuel) || 'ev').toLowerCase().trim();
    const fuelType = rawFuel === 'gas' || rawFuel === 'ice' ? 'ice' : (rawFuel === 'hybrid' ? 'hybrid' : (rawFuel === 'ev' ? 'ev' : null));
    if (!fuelType) {
      throw createError('Loại động cơ tính TCO không hợp lệ (chỉ hỗ trợ ev, ice, hybrid).', 422, 'INVALID_FUEL_TYPE');
    }

    const monthlyKm = assertNonNegativeFinite(payload.monthlyKm ?? 1000, 'Quãng đường/tháng (km)', { max: 50000 });
    const chargingLossPercent = assertNonNegativeFinite(payload.chargingLossPercent ?? 0, 'Tổn hao sạc (%)', { max: 100 });
    const annualMaintenanceVnd = Math.round(assertNonNegativeFinite(
      payload.annualMaintenanceVnd ?? (fuelType === 'ev' ? preset.evAnnualMaintenanceVnd : preset.iceAnnualMaintenanceVnd),
      'Bảo dưỡng dự kiến/năm (VNĐ)'
    ));

    // Only use catalog consumption if explicitly present as a positive finite number (never invent specs)
    const catalogKwh = vehicle && Number.isFinite(Number(vehicle.consumptionKwhPer100Km)) && Number(vehicle.consumptionKwhPer100Km) > 0
      ? Number(vehicle.consumptionKwhPer100Km)
      : null;
    const catalogLiters = vehicle && Number.isFinite(Number(vehicle.consumptionLitersPer100Km)) && Number(vehicle.consumptionLitersPer100Km) > 0
      ? Number(vehicle.consumptionLitersPer100Km)
      : null;

    let monthlyEnergy = null;
    let monthlyFuel = null;
    let usedKwhPer100Km = null;
    let usedElectricityRate = null;
    let usedLitersPer100Km = null;
    let usedFuelRate = null;
    const missingCatalogSpecs = [];

    if (fuelType === 'ev' || fuelType === 'hybrid') {
      const kwhInput = payload.kWhPer100Km ?? payload.kwhPer100Km ?? catalogKwh;
      if (kwhInput === null || kwhInput === undefined) {
        if (vehicle) missingCatalogSpecs.push('kWhPer100Km');
      }
      usedKwhPer100Km = assertNonNegativeFinite(kwhInput ?? (fuelType === 'ev' ? 15 : 0), 'Mức tiêu thụ điện (kWh/100km)', { max: 200 });
      usedElectricityRate = assertNonNegativeFinite(payload.electricityVndPerKwh ?? preset.electricityVndPerKwh, 'Đơn giá điện (VNĐ/kWh)', { max: 100000 });
      const effectiveKwh = (monthlyKm / 100) * usedKwhPer100Km * (1 + chargingLossPercent / 100);
      monthlyEnergy = Math.round(effectiveKwh * usedElectricityRate);
    }

    if (fuelType === 'ice' || fuelType === 'hybrid') {
      const litersInput = payload.litersPer100Km ?? catalogLiters;
      if (litersInput === null || litersInput === undefined) {
        if (vehicle) missingCatalogSpecs.push('litersPer100Km');
      }
      usedLitersPer100Km = assertNonNegativeFinite(litersInput ?? (fuelType === 'ice' ? 7 : 0), 'Mức tiêu hao nhiên liệu (lít/100km)', { max: 100 });
      usedFuelRate = assertNonNegativeFinite(payload.fuelVndPerLiter ?? preset.fuelVndPerLiter, 'Đơn giá nhiên liệu (VNĐ/lít)', { max: 200000 });
      const effectiveLiters = (monthlyKm / 100) * usedLitersPer100Km;
      monthlyFuel = Math.round(effectiveLiters * usedFuelRate);
    }

    const monthlyOperatingEnergyOrFuel = (monthlyEnergy || 0) + (monthlyFuel || 0);
    const annualEnergyOrFuel = 12 * monthlyOperatingEnergyOrFuel;
    const annualOperating = annualEnergyOrFuel + annualMaintenanceVnd;

    // Optional fixed / ownership extras separated cleanly from operating subtotal
    const annualInsuranceVnd = Math.round(assertNonNegativeFinite(payload.annualInsuranceVnd ?? 0, 'Bảo hiểm tự nguyện/năm (VNĐ)'));
    const annualParkingVnd = Math.round(assertNonNegativeFinite(payload.annualParkingVnd ?? 0, 'Chi phí gửi xe/năm (VNĐ)'));
    const annualRoadFeeVnd = Math.round(assertNonNegativeFinite(payload.annualRoadFeeVnd ?? 0, 'Phí đường bộ & đăng kiểm/năm (VNĐ)'));
    const annualDepreciationVnd = Math.round(assertNonNegativeFinite(payload.annualDepreciationVnd ?? 0, 'Khấu hao ước tính/năm (VNĐ)'));

    const annualFixedExtrasTotal = annualInsuranceVnd + annualParkingVnd + annualRoadFeeVnd + annualDepreciationVnd;
    const annualTotalWithExtras = annualOperating + annualFixedExtrasTotal;

    const formulas = [];
    if (monthlyEnergy !== null) {
      formulas.push(`Tiền điện/tháng = (${monthlyKm} / 100) × ${usedKwhPer100Km} kWh × (1 + ${chargingLossPercent}%) × ${usedElectricityRate.toLocaleString('vi-VN')} đ/kWh = ${monthlyEnergy.toLocaleString('vi-VN')} VNĐ`);
    }
    if (monthlyFuel !== null) {
      formulas.push(`Tiền xăng/tháng = (${monthlyKm} / 100) × ${usedLitersPer100Km} lít × ${usedFuelRate.toLocaleString('vi-VN')} đ/lít = ${monthlyFuel.toLocaleString('vi-VN')} VNĐ`);
    }
    formulas.push(`Chi phí vận hành/năm = 12 × ${monthlyOperatingEnergyOrFuel.toLocaleString('vi-VN')} + ${annualMaintenanceVnd.toLocaleString('vi-VN')} (bảo dưỡng) = ${annualOperating.toLocaleString('vi-VN')} VNĐ`);

    return {
      isEstimateOnly: true,
      isOperatingSubtotalOnly: annualFixedExtrasTotal === 0,
      vehicleId: vehicle ? vehicle.id : null,
      vehicleName: vehicle ? vehicle.name : (payload.vehicleName ? Security.sanitizeString(payload.vehicleName) : null),
      fuelType,
      region: assumptions.region,
      formulaVersion: assumptions.formulaVersion,
      formulaEffectiveDate: assumptions.effectiveFrom,
      assumptionSource: assumptions.sourceNote,
      missingCatalogSpecs,
      inputsUsed: {
        monthlyKm,
        kWhPer100Km: usedKwhPer100Km,
        litersPer100Km: usedLitersPer100Km,
        electricityVndPerKwh: usedElectricityRate,
        fuelVndPerLiter: usedFuelRate,
        chargingLossPercent,
        annualMaintenanceVnd
      },
      monthlyEnergy,
      monthlyFuel,
      monthlyOperatingEnergyOrFuel,
      annualEnergyOrFuel,
      annualMaintenance: annualMaintenanceVnd,
      annualOperating,
      fiveYearOperating: annualOperating * 5,
      optionalFixedExtras: {
        annualInsuranceVnd,
        annualParkingVnd,
        annualRoadFeeVnd,
        annualDepreciationVnd,
        annualFixedExtrasTotal
      },
      annualTotalWithExtras,
      formulas,
      disclaimer: `Kết quả trên là DỰ TOÁN CHI PHÍ VẬN HÀNH tham chiếu theo công thức ${assumptions.formulaVersion} (không bao gồm giá mua xe, lãi vay hoặc khấu hao trừ khi bạn nhập vào mục chi phí cố định tùy chọn).`
    };
  }
};

module.exports = TcoService;
