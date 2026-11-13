// backend/application/charging-service.js
// EV Charging Discovery Service with TTL Cache, Geographic Bounds & Honest Tariff/Outage Labels (SIG-P4-009)

const ChargingProvider = require('../infrastructure/charging-provider');
const Security = require('../infrastructure/security');

const CACHE_TTL_MS = 5 * 60 * 1000;

let cacheState = {
  stations: [],
  fetchedAtMs: 0,
  fetchedAtIso: null,
  sourceType: 'unloaded',
  liveAvailabilitySupported: false
};

function createError(message, statusCode = 400, code = 'CHARGING_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeStation(raw) {
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return null;
  }
  const hasKnownTariff = raw.tariffVndPerKwh !== null && raw.tariffVndPerKwh !== undefined && Number.isFinite(Number(raw.tariffVndPerKwh)) && Number(raw.tariffVndPerKwh) > 0;
  return {
    id: String(raw.id),
    name: Security.sanitizeString(raw.name || ''),
    providerId: String(raw.providerId || 'unknown'),
    providerName: Security.sanitizeString(raw.providerName || ''),
    province: Security.sanitizeString(raw.province || ''),
    district: Security.sanitizeString(raw.district || ''),
    address: Security.sanitizeString(raw.address || ''),
    lat,
    lng,
    connectors: Array.isArray(raw.connectors) ? raw.connectors : [],
    maxPowerKw: Array.isArray(raw.connectors) && raw.connectors.length > 0
      ? Math.max(...raw.connectors.map(c => Number(c.powerKw || 0)))
      : 0,
    tariffVndPerKwh: hasKnownTariff ? Math.round(Number(raw.tariffVndPerKwh)) : null,
    tariffDisplay: hasKnownTariff ? `${Math.round(Number(raw.tariffVndPerKwh)).toLocaleString('vi-VN')} VNĐ/kWh` : 'Chưa công bố đơn giá',
    tariffKnown: hasKnownTariff,
    tariffSource: raw.tariffSource || null,
    tariffUpdatedAt: raw.tariffUpdatedAt || null,
    dataUpdatedAt: raw.dataUpdatedAt || null,
    openHours: raw.openHours || 'Theo giờ mở cửa bãi xe'
  };
}

const ChargingService = {
  _resetCache() {
    cacheState = {
      stations: [],
      fetchedAtMs: 0,
      fetchedAtIso: null,
      sourceType: 'unloaded',
      liveAvailabilitySupported: false
    };
  },

  async findStations(query = {}) {
    let latNum = null;
    let lngNum = null;
    if (query.lat !== undefined && query.lat !== null && query.lat !== '') {
      latNum = Number(query.lat);
      if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
        throw createError('Vĩ độ (lat) phải nằm trong khoảng [-90, 90].', 422, 'INVALID_COORDINATES');
      }
    }
    if (query.lng !== undefined && query.lng !== null && query.lng !== '') {
      lngNum = Number(query.lng);
      if (!Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
        throw createError('Kinh độ (lng) phải nằm trong khoảng [-180, 180].', 422, 'INVALID_COORDINATES');
      }
    }

    const minPowerKw = query.minPowerKw !== undefined && query.minPowerKw !== '' ? Number(query.minPowerKw) : 0;
    if (!Number.isFinite(minPowerKw) || minPowerKw < 0) {
      throw createError('Công suất lọc tối thiểu không hợp lệ.', 422, 'INVALID_FILTER');
    }

    const nowMs = Number(query.nowMs || Date.now());
    const cacheExpired = cacheState.stations.length === 0 || (nowMs - cacheState.fetchedAtMs) > CACHE_TTL_MS;
    let isStale = false;
    let providerOutage = false;

    if (cacheExpired || query.forceRefresh === 'true') {
      try {
        const snap = await ChargingProvider.fetchStationsSnapshot();
        const normalized = (snap.stations || []).map(normalizeStation).filter(Boolean);
        cacheState = {
          stations: normalized,
          fetchedAtMs: nowMs,
          fetchedAtIso: snap.fetchedAt || new Date(nowMs).toISOString(),
          sourceType: snap.sourceType || 'documented_reference',
          liveAvailabilitySupported: Boolean(snap.liveAvailabilitySupported)
        };
      } catch (err) {
        if (cacheState.stations.length > 0) {
          isStale = true;
          providerOutage = true;
        } else {
          throw createError(err.message || 'Dịch vụ trạm sạc hiện tạm gián đoạn và chưa có bộ nhớ đệm.', 503, 'CHARGING_PROVIDER_UNAVAILABLE');
        }
      }
    }

    let items = cacheState.stations.map(s => {
      const distanceKm = (latNum !== null && lngNum !== null)
        ? Number(haversineKm(latNum, lngNum, s.lat, s.lng).toFixed(2))
        : null;
      return { ...s, distanceKm };
    });

    if (query.province && query.province !== 'all') {
      const pLow = String(query.province).toLowerCase().trim();
      items = items.filter(s => s.province.toLowerCase().includes(pLow) || s.address.toLowerCase().includes(pLow));
    }
    if (query.connectorType && query.connectorType !== 'all') {
      const cLow = String(query.connectorType).toLowerCase().trim();
      items = items.filter(s => s.connectors.some(c => String(c.type || '').toLowerCase().includes(cLow)));
    }
    if (minPowerKw > 0) {
      items = items.filter(s => s.maxPowerKw >= minPowerKw);
    }
    if (query.q && String(query.q).trim()) {
      const qLow = String(query.q).toLowerCase().trim();
      items = items.filter(s =>
        s.name.toLowerCase().includes(qLow) ||
        s.address.toLowerCase().includes(qLow) ||
        s.district.toLowerCase().includes(qLow) ||
        s.province.toLowerCase().includes(qLow)
      );
    }

    if (latNum !== null && lngNum !== null) {
      items.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    }

    return {
      stations: items,
      total: items.length,
      cacheMeta: {
        isStale,
        providerOutage,
        fetchedAt: cacheState.fetchedAtIso,
        ttlSeconds: Math.round(CACHE_TTL_MS / 1000),
        sourceType: cacheState.sourceType,
        liveAvailabilitySupported: cacheState.liveAvailabilitySupported,
        freshnessDisclaimer: isStale
          ? 'Nhà cung cấp dữ liệu trực tuyến đang gián đoạn — đang hiển thị bản lưu tạm gần nhất (có thể cũ).'
          : 'Dữ liệu danh mục & đơn giá tham chiếu cập nhật theo nguồn công bố; không cam kết cổng sạc trống thời gian thực nếu trạm chưa bật đồng bộ OCPP trực tiếp.'
      }
    };
  }
};

module.exports = ChargingService;
