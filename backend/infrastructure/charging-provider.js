// backend/infrastructure/charging-provider.js
// Documented Vietnamese EV Charging Station Network Provider & Outage-Resilient Sandbox Adapter (SIG-P4-009)

const STATIC_DOCUMENTED_STATIONS = [
  {
    id: 'CS-HN-CAUGIAY-01',
    name: 'Trạm Sạc Siêu Nhanh SIGMA Cầu Giấy',
    providerId: 'sigma_grid_vn',
    providerName: 'Mạng lưới Sạc SIGMACAR Việt Nam (Tham chiếu)',
    province: 'Hà Nội',
    district: 'Cầu Giấy',
    address: 'Số 102 Trần Duy Hưng, Cầu Giấy, Hà Nội',
    lat: 21.0085,
    lng: 105.8015,
    connectors: [
      { type: 'CCS2', powerKw: 250, portsTotal: 6, statusNote: 'Không cam kết chỗ trống trực tiếp' },
      { type: 'Type 2 AC', powerKw: 11, portsTotal: 4, statusNote: 'Không cam kết chỗ trống trực tiếp' }
    ],
    tariffVndPerKwh: 3858,
    tariffSource: 'Biểu giá tham chiếu mạng sạc DC công cộng VN 2026',
    tariffUpdatedAt: '2026-10-01T00:00:00.000Z',
    dataUpdatedAt: '2026-11-01T08:00:00.000Z',
    openHours: '24/7'
  },
  {
    id: 'CS-HN-LONG-02',
    name: 'Trạm Sạc Vincom Riverside Long Biên',
    providerId: 'partner_ev_net',
    providerName: 'Đối tác Liên thông EV VN',
    province: 'Hà Nội',
    district: 'Long Biên',
    address: 'Khu đô thị Vinhomes Riverside, Long Biên, Hà Nội',
    lat: 21.0452,
    lng: 105.9158,
    connectors: [
      { type: 'CCS2', powerKw: 180, portsTotal: 8, statusNote: 'Không cam kết chỗ trống trực tiếp' }
    ],
    tariffVndPerKwh: 3900,
    tariffSource: 'Công bố đơn giá đối tác EV 2026',
    tariffUpdatedAt: '2026-10-15T00:00:00.000Z',
    dataUpdatedAt: '2026-11-01T08:00:00.000Z',
    openHours: '06:00 - 23:00'
  },
  {
    id: 'CS-HCM-THUDUC-01',
    name: 'Trung tâm Siêu Sạc SIGMA Thủ Đức Hub',
    providerId: 'sigma_grid_vn',
    providerName: 'Mạng lưới Sạc SIGMACAR Việt Nam (Tham chiếu)',
    province: 'TP. Hồ Chí Minh',
    district: 'TP. Thủ Đức',
    address: '159 Xa Lộ Hà Nội, Thảo Điền, TP. Thủ Đức, TP.HCM',
    lat: 10.8021,
    lng: 106.7438,
    connectors: [
      { type: 'CCS2', powerKw: 350, portsTotal: 10, statusNote: 'Không cam kết chỗ trống trực tiếp' },
      { type: 'Type 2 AC', powerKw: 22, portsTotal: 6, statusNote: 'Không cam kết chỗ trống trực tiếp' }
    ],
    tariffVndPerKwh: 3858,
    tariffSource: 'Biểu giá tham chiếu mạng sạc DC công cộng VN 2026',
    tariffUpdatedAt: '2026-10-01T00:00:00.000Z',
    dataUpdatedAt: '2026-11-01T08:00:00.000Z',
    openHours: '24/7'
  },
  {
    id: 'CS-HCM-Q7-02',
    name: 'Trạm Sạc Phú Mỹ Hưng Crescent Hub',
    providerId: 'partner_ev_net',
    providerName: 'Đối tác Liên thông EV VN',
    province: 'TP. Hồ Chí Minh',
    district: 'Quận 7',
    address: '101 Tôn Dật Tiên, Tân Phú, Quận 7, TP.HCM',
    lat: 10.7292,
    lng: 106.7219,
    connectors: [
      { type: 'CCS2', powerKw: 150, portsTotal: 4, statusNote: 'Không cam kết chỗ trống trực tiếp' }
    ],
    tariffVndPerKwh: null, // Explicitly unknown tariff — never falsified as 0 VND
    tariffSource: 'Đơn giá phụ thuộc khung giờ bãi xe thương mại',
    tariffUpdatedAt: null,
    dataUpdatedAt: '2026-11-01T08:00:00.000Z',
    openHours: '07:00 - 22:30'
  },
  {
    id: 'CS-DN-HAICHAU-01',
    name: 'Trạm Sạc SIGMA Sông Hàn Đà Nẵng',
    providerId: 'sigma_grid_vn',
    providerName: 'Mạng lưới Sạc SIGMACAR Việt Nam (Tham chiếu)',
    province: 'Đà Nẵng',
    district: 'Hải Châu',
    address: '58 Bạch Đằng, Hải Châu, Đà Nẵng',
    lat: 16.0689,
    lng: 108.2248,
    connectors: [
      { type: 'CCS2', powerKw: 250, portsTotal: 6, statusNote: 'Không cam kết chỗ trống trực tiếp' }
    ],
    tariffVndPerKwh: 3790,
    tariffSource: 'Biểu giá tham chiếu Miền Trung 2026',
    tariffUpdatedAt: '2026-10-01T00:00:00.000Z',
    dataUpdatedAt: '2026-11-01T08:00:00.000Z',
    openHours: '24/7'
  }
];

const __testHooks = {
  forceOutage: false,
  customStations: null
};

const ChargingProvider = {
  __testHooks,

  async fetchStationsSnapshot() {
    if (__testHooks.forceOutage) {
      const err = new Error('Nhà cung cấp dữ liệu trạm sạc đang tạm gián đoạn kết nối.');
      err.code = 'CHARGING_PROVIDER_OUTAGE';
      err.statusCode = 503;
      throw err;
    }
    const sourceList = Array.isArray(__testHooks.customStations)
      ? __testHooks.customStations
      : STATIC_DOCUMENTED_STATIONS;

    return {
      sourceType: 'documented_static_reference',
      liveAvailabilitySupported: false,
      fetchedAt: new Date().toISOString(),
      stations: sourceList.map(s => ({ ...s }))
    };
  }
};

module.exports = ChargingProvider;
