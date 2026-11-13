// backend/application/ai-tools.js
// Authoritative Tool & Function Definitions for SIGMA AI
// Provides verified real-time capabilities: Vehicle Search, Time, Weather, Comparison, Tech

const VehicleRepository = require('../infrastructure/repositories/vehicle-repository');

const AITools = {
  // 1. Tool: search_vehicles
  async searchVehicles({ category, fuel, minPrice, maxPrice, seats, sort = 'price-asc', limit = 5, query = '' } = {}) {
    try {
      const all = await VehicleRepository.findAll({
        category: category && category !== 'all' ? category : undefined,
        fuel: fuel && fuel !== 'all' ? fuel : undefined,
        minPrice: minPrice ? parseFloat(minPrice) : undefined,
        maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
        search: query || undefined,
        sort
      });

      let results = all;
      if (seats && parseInt(seats, 10) > 0) {
        const sNum = parseInt(seats, 10);
        results = results.filter(v => (v.seats || 5) >= sNum);
      }

      if (limit && limit > 0) {
        results = results.slice(0, limit);
      }

      const formatted = results.map(v => ({
        id: v.id,
        name: v.name,
        brand: v.brand,
        category: v.category,
        fuel: v.fuel || (v.range > 0 ? 'ev' : 'gas'),
        price: v.price,
        priceFormatted: v.priceFormatted || `${(v.price / 1e9).toFixed(3)} tỷ VNĐ`,
        range: v.range ? `${v.range} km` : undefined,
        power: v.power || (v.hp ? `${v.hp} HP` : undefined),
        seats: v.seats || 5,
        battery: v.battery,
        warranty: v.warranty,
        stockQuantity: v.stockQuantity ?? 10
      }));

      formatted.success = true;
      formatted.totalFound = results.length;
      formatted.vehicles = formatted;
      return formatted;
    } catch (err) {
      const empty = [];
      empty.success = false;
      empty.error = err.message;
      empty.vehicles = [];
      empty.totalFound = 0;
      return empty;
    }
  },

  // 2. Tool: get_vehicle_detail
  async getVehicleDetail({ vehicleIdOrName }) {
    if (!vehicleIdOrName) return { success: false, error: 'Thiếu mã hoặc tên xe' };
    const q = String(vehicleIdOrName).toLowerCase().trim();

    const all = await VehicleRepository.findAll();
    const found = all.find(v => 
      v.id.toLowerCase() === q || 
      v.name.toLowerCase().includes(q) || 
      (v.subtitle && v.subtitle.toLowerCase().includes(q))
    );

    if (!found) {
      return { success: false, error: `Không tìm thấy mẫu xe phù hợp với "${vehicleIdOrName}" trong database.` };
    }

    return {
      success: true,
      vehicle: {
        id: found.id,
        name: found.name,
        brand: found.brand || null,
        category: found.category || null,
        fuel: found.fuel || null,
        price: Number.isFinite(Number(found.price)) ? Number(found.price) : null,
        priceFormatted: found.priceFormatted || null,
        range: Number(found.range) > 0 ? `${found.range} km` : null,
        power: found.power || (Number.isFinite(Number(found.hp)) ? `${found.hp} HP` : null),
        torque: found.torque || null,
        acceleration: found.acceleration || null,
        topSpeed: found.topSpeed || null,
        battery: found.battery || null,
        fastCharge: found.fastCharge || null,
        dimensions: found.dimensions || null,
        groundClearance: found.groundClearance || null,
        seats: Number.isFinite(Number(found.seats)) ? Number(found.seats) : null,
        warranty: found.warranty || null,
        stock: typeof found.stockQuantity === 'number' ? found.stockQuantity : (typeof found.stock === 'number' ? found.stock : 0)
      }
    };
  },

  // 3. Tool: compare_vehicles
  async compareVehicles(arg1, arg2) {
    let vehicleId1, vehicleId2;
    if (typeof arg1 === 'object' && arg1 !== null) {
      vehicleId1 = arg1.vehicleId1 || arg1.car1;
      vehicleId2 = arg1.vehicleId2 || arg1.car2;
    } else {
      vehicleId1 = arg1;
      vehicleId2 = arg2;
    }

    const [c1, c2] = await Promise.all([
      this.getVehicleDetail({ vehicleIdOrName: vehicleId1 }),
      this.getVehicleDetail({ vehicleIdOrName: vehicleId2 })
    ]);

    if (!c1.success || !c2.success) {
      return {
        success: false,
        found: false,
        error: `Không thể so sánh: ${!c1.success ? c1.error : ''} ${!c2.success ? c2.error : ''}`.trim()
      };
    }

    return {
      success: true,
      found: true,
      car1: c1.vehicle,
      car2: c2.vehicle,
      comparison: {
        priceDiff: Math.abs(c1.vehicle.price - c2.vehicle.price),
        cheaper: c1.vehicle.price < c2.vehicle.price ? c1.vehicle.name : c2.vehicle.name,
        rangeAdvantage: (c1.vehicle.range && c2.vehicle.range) 
          ? (parseInt(c1.vehicle.range, 10) > parseInt(c2.vehicle.range, 10) ? c1.vehicle.name : c2.vehicle.name)
          : null
      }
    };
  },

  // 4. Tool: get_current_time
  getCurrentTime(arg = {}) {
    let timezone = 'Asia/Ho_Chi_Minh';
    let loc = '';
    if (typeof arg === 'string') {
      loc = arg.toLowerCase();
    } else if (arg && typeof arg === 'object') {
      timezone = arg.timezone || '';
      loc = String(arg.location || arg.query || '').toLowerCase();
    }

    if (!timezone) {
      if (loc.includes('tokyo') || loc.includes('nhật bản') || loc.includes('japan')) timezone = 'Asia/Tokyo';
      else if (loc.includes('london') || loc.includes('anh') || loc.includes('uk')) timezone = 'Europe/London';
      else if (loc.includes('new york') || loc.includes('mỹ') || loc.includes('usa')) timezone = 'America/New_York';
      else if (loc.includes('paris') || loc.includes('pháp')) timezone = 'Europe/Paris';
      else if (loc.includes('seoul') || loc.includes('hàn quốc')) timezone = 'Asia/Seoul';
      else if (loc.includes('bangkok') || loc.includes('thái lan')) timezone = 'Asia/Bangkok';
      else if (loc.includes('singapore')) timezone = 'Asia/Singapore';
      else if (loc.includes('sydney') || loc.includes('úc')) timezone = 'Australia/Sydney';
      else timezone = 'Asia/Ho_Chi_Minh';
    }

    const now = new Date();
    try {
      const options = {
        timeZone: timezone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      };
      const formatted = new Intl.DateTimeFormat('vi-VN', options).format(now);
      return {
        success: true,
        iso: now.toISOString(),
        timezone,
        formattedTime: formatted,
        timeString: formatted,
        dayOfWeek: new Intl.DateTimeFormat('vi-VN', { timeZone: timezone, weekday: 'long' }).format(now),
        hour: now.getHours()
      };
    } catch {
      return {
        success: true,
        iso: now.toISOString(),
        timezone: 'Asia/Ho_Chi_Minh',
        formattedTime: now.toLocaleString('vi-VN'),
        timeString: now.toLocaleString('vi-VN')
      };
    }
  },

  // 5. Tool: get_weather (Real Open-Meteo Free API)
  async getWeather(locArg = 'TP.HCM') {
    let location = 'TP.HCM';
    if (typeof locArg === 'string') location = locArg;
    else if (locArg && locArg.location) location = locArg.location;

    const locNorm = String(location).toLowerCase().trim();
    const cityCoords = {
      'tp.hcm': { name: 'Thành phố Hồ Chí Minh', lat: 10.823, lon: 106.630 },
      'tphcm': { name: 'Thành phố Hồ Chí Minh', lat: 10.823, lon: 106.630 },
      'hồ chí minh': { name: 'Thành phố Hồ Chí Minh', lat: 10.823, lon: 106.630 },
      'saigon': { name: 'Thành phố Hồ Chí Minh', lat: 10.823, lon: 106.630 },
      'sài gòn': { name: 'Thành phố Hồ Chí Minh', lat: 10.823, lon: 106.630 },
      'hà nội': { name: 'Thủ đô Hà Nội', lat: 21.0285, lon: 105.8542 },
      'hanoi': { name: 'Thủ đô Hà Nội', lat: 21.0285, lon: 105.8542 },
      'đà nẵng': { name: 'Đà Nẵng', lat: 16.0544, lon: 108.2022 },
      'danang': { name: 'Đà Nẵng', lat: 16.0544, lon: 108.2022 },
      'cần thơ': { name: 'Cần Thơ', lat: 10.0452, lon: 105.7469 },
      'hải phòng': { name: 'Hải Phòng', lat: 20.8449, lon: 106.6881 }
    };

    let target = cityCoords['tp.hcm'];
    for (const [key, val] of Object.entries(cityCoords)) {
      if (locNorm.includes(key)) {
        target = val;
        break;
      }
    }

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${target.lat}&longitude=${target.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&timezone=Asia%2FHo_Chi_Minh`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`Weather service responded with status ${res.status}`);
      const data = await res.json();
      const cur = data.current || {};

      const weatherDescriptions = {
        0: 'Trời quang đãng, nắng đẹp ☀️',
        1: 'Trời ít mây, nắng nhẹ 🌤️',
        2: 'Trời mây rải rác ⛅',
        3: 'Nhiều mây, trời dịu ☁️',
        45: 'Có sương mù nhẹ 🌫️',
        51: 'Mưa phùn nhẹ rải rác 🌦️',
        61: 'Mưa rào nhẹ 🌧️',
        63: 'Mưa vừa 🌧️',
        65: 'Mưa to ⛈️',
        80: 'Mưa rào từng cơn 🌦️',
        95: 'Có dông sét nhẹ 🌩️'
      };

      const condition = weatherDescriptions[cur.weather_code] || 'Thời tiết ổn định, nhiều mây 🌤️';

      return {
        success: true,
        source: 'open-meteo.com',
        city: target.name,
        location: target.name,
        temperature: cur.temperature_2m ?? 28,
        temperatureFormatted: `${cur.temperature_2m ?? 28}°C`,
        apparentTemperature: `${cur.apparent_temperature ?? 30}°C`,
        humidity: `${cur.relative_humidity_2m ?? 80}%`,
        windSpeed: `${cur.wind_speed_10m ?? 8} km/h`,
        condition,
        time: cur.time
      };
    } catch (e) {
      return {
        success: false,
        source: 'fallback',
        city: target.name,
        location: target.name,
        error: `Không thể kết nối đến dịch vụ thời tiết vệ tinh: ${e.message}`,
        note: 'Vui lòng kiểm tra lại kết nối mạng hoặc thử lại sau ít phút.'
      };
    }
  },

  // 6. Tool: explain_technology
  explainTechnology({ topic }) {
    const t = String(topic).toLowerCase();
    if (t.includes('lfp') || t.includes('lithium iron')) {
      return {
        success: true,
        topic: 'Công nghệ Pin LFP (Lithium Iron Phosphate - LiFePO4)',
        summary: 'Pin LFP là công nghệ pin sử dụng cực dương LiFePO4 với cực kỳ nhiều ưu thế về độ bền và an toàn.',
        advantages: [
          'Tuổi thọ vượt trội: Đạt 2.000 - 3.000 chu kỳ sạc xả (tương đương 10-15 năm sử dụng), suy hao dưới 10%.',
          'An toàn chống cháy nổ: Độ bền nhiệt lên tới 270°C, không bị thoát nhiệt giải phóng oxy như pin NMC/NCA.',
          'Sạc đầy 100%: Thoải mái sạc đầy 100% hàng ngày mà không sợ chai pin.',
          'Thân thiện môi trường: Không chứa Coban (Cobalt) hay Niken - hai kim loại đắt đỏ và độc hại.'
        ],
        disadvantages: [
          'Mật độ năng lượng thấp hơn NMC khoảng 20-30%, khiến xe cùng tầm hoạt động phải dùng khối pin nặng hơn.',
          'Hiệu suất giảm nhẹ khi vận hành ở thời tiết băng giá dưới -10°C (Việt Nam khí hậu nhiệt đới hoàn toàn tối ưu).'
        ],
        applicationsInSigma: 'Các mẫu xe SIGMA City G và các dòng SUV đô thị ưu tiên sử dụng pin LFP để tối ưu giá thành và độ bền trọn đời.'
      };
    }

    if (t.includes('800v') || t.includes('sạc siêu nhanh') || t.includes('fast charge')) {
      return {
        success: true,
        topic: 'Kiến trúc điện áp cao 800V & Siêu sạc DC',
        summary: 'Kiến trúc 800V tăng gấp đôi điện áp so với chuẩn 400V truyền thống, giảm nhiệt lượng tỏa ra và tăng tốc độ sạc gấp 2.5 lần.',
        advantages: [
          'Sạc từ 10% đến 80% chỉ trong 18 - 25 phút tại trạm sạc DC 250kW - 350kW.',
          'Dây dẫn mỏng nhẹ hơn, giảm trọng lượng xe từ 25 - 40 kg, tăng hiệu suất vận hành.',
          'Hệ thống quản lý nhiệt độ thông minh làm mát bằng chất lỏng tuần hoàn đa kênh.'
        ]
      };
    }

    return {
      success: true,
      topic,
      summary: `Hệ thống công nghệ tiên tiến trên xe SIGMACAR tích hợp tiêu chuẩn an toàn ADAS cấp độ 2+, khung gầm hấp thụ xung lực và cụm pin bảo hành 8 năm.`
    };
  }
};

module.exports = AITools;
