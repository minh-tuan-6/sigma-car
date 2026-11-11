// tests/ai_service.test.js
// SIGMACAR Comprehensive AI Chatbot, Live RAG & Price Filter Test Suite

const test = require('node:test');
const assert = require('node:assert/strict');

const AIService = require('../backend/application/ai-service');
const AITools = require('../backend/application/ai-tools');
const VehicleRepository = require('../backend/infrastructure/repositories/vehicle-repository');
const { filterAndSortVehicles, matchesPriceRange, renderMarkdownSafe } = require('../js/app');

test.before(async () => {
  await AIService.syncKnowledgeBase();
});

test('PHẦN A: Hội thoại đa năng & Nhận diện ý định linh hoạt', async (t) => {
  await t.test('1. Chào hỏi tự nhiên, không ép tư vấn mua xe hay lặp khuôn sáo rỗng', async () => {
    const res = await AIService.chat({ message: 'Xin chào bạn!' });
    assert.ok(res && res.text, 'Phải có phản hồi từ AI');
    assert.match(res.text, /(xin chào|chào bạn|rất vui|giúp gì)/i, 'Phải chào hỏi tự nhiên');
    assert.doesNotMatch(res.text, /ngân sách của bạn là bao nhiêu.*bắt buộc/i, 'Không ép hỏi ngân sách');
  });

  await t.test('2. "Tôi là ai?" với Khách vãng lai (Guest): Không được tự ý bịa đặt danh tính', async () => {
    const res = await AIService.chat({ message: 'Tôi là ai?', currentUser: null });
    assert.ok(res && res.text);
    assert.match(res.text, /(khách|chưa đăng nhập|chưa có thông tin|phiên trò chuyện)/i, 'Phải nhận diện là khách và không bịa danh tính');
    assert.doesNotMatch(res.text, /bạn là giám đốc|bạn là nguyễn văn a/i, 'Không được bịa đặt tên tuổi');
  });

  await t.test('3. "Tôi là ai?" với Người dùng đã đăng nhập: Phản ánh đúng thông tin thực tế', async () => {
    const user = { fullName: 'Trần Tuấn', email: 'tuantran@sigmacar.vn', role: 'admin', tier: 'VIP Kim Cương' };
    const res = await AIService.chat({ message: 'Tôi là ai?', currentUser: user });
    assert.ok(res && res.text);
    assert.match(res.text, /Trần Tuấn/i, 'Phải nêu đúng họ tên người dùng');
    assert.match(res.text, /admin/i, 'Phải nêu đúng vai trò');
  });

  await t.test('4. Tra cứu thời gian thực tế: Múi giờ Asia/Ho_Chi_Minh', async () => {
    const timeInfo = AITools.getCurrentTime();
    assert.ok(timeInfo && timeInfo.timeString, 'Phải có chuỗi thời gian');
    assert.match(timeInfo.timezone, /Asia\/Ho_Chi_Minh/i, 'Phải dùng múi giờ Việt Nam');

    const res = await AIService.chat({ message: 'Bây giờ là mấy giờ ở TP.HCM?' });
    assert.ok(res && res.text);
    assert.match(res.text, /(\d{1,2}:\d{1,2}|giờ|phút)/i, 'AI phải trả về thông tin thời gian thực');
  });

  await t.test('5. Tra cứu thời tiết vệ tinh thực tế: Không bịa đặt dữ liệu', async () => {
    const weather = await AITools.getWeather('TP.HCM');
    assert.ok(weather, 'Phải có kết quả thời tiết');
    if (weather.source === 'open-meteo.com') {
      assert.ok(typeof weather.temperature === 'number', 'Nhiệt độ phải là số thực');
      assert.ok(weather.city.includes('Hồ Chí Minh') || weather.city.includes('TP.HCM'));
    }

    const res = await AIService.chat({ message: 'Thời tiết TP.HCM hôm nay thế nào?' });
    assert.ok(res && res.text);
    assert.match(res.text, /(thời tiết|nhiệt độ|độ ẩm|°C|tp\.hcm|hồ chí minh)/i);
  });

  await t.test('6. Giải thích công nghệ: Pin LFP vs NMC chuyên sâu', async () => {
    const res = await AIService.chat({ message: 'Giải thích cho tôi công nghệ pin LFP' });
    assert.ok(res && res.text);
    assert.match(res.text, /(LFP|Lithium Iron Phosphate|sắt|chu kỳ|an toàn|nhiệt)/i, 'Phải có kiến thức chính xác về LFP');
    assert.doesNotMatch(res.text, /hãy mua ngay chiếc xe với giá/i, 'Không được ép lái sang chốt sale');
  });

  await t.test('7. Viết email hỗ trợ người dùng theo yêu cầu tổng quát', async () => {
    const res = await AIService.chat({ message: 'Viết giúp tôi một email xin nghỉ phép 1 ngày' });
    assert.ok(res && res.text);
    assert.match(res.text, /(kính gửi|xin phép|nghỉ phép|trân trọng)/i, 'Phải viết được mẫu email chuẩn');
  });

  await t.test('8. Chuyển đổi chủ đề linh hoạt: Từ thời tiết sang xe hơi', async () => {
    const history = [
      { role: 'user', text: 'Thời tiết hôm nay nóng quá' },
      { role: 'assistant', text: 'Hôm nay nhiệt độ khoảng 32°C, bạn nhớ uống đủ nước nhé!' }
    ];
    const res = await AIService.chat({ message: 'Tôi muốn tìm xe điện nào có điều hòa mát nhanh và giá hợp lý', history });
    assert.ok(res && res.text);
    assert.match(res.text, /(xe điện|Model|Vision|SIGMA|điều hòa|giá)/i, 'Tiếp nhận đúng chủ đề mới');
  });
});

test('PHẦN B: Live Vehicle RAG & Grounding Dữ liệu Xe Thật', async (t) => {
  await t.test('1. Hỏi giá xe niêm yết trong Database: Trả về chính xác VNĐ', async () => {
    const cyber = await VehicleRepository.findById('tesla-cybertruck');
    assert.ok(cyber, 'Tesla Cybertruck phải tồn tại trong DB');

    const res = await AIService.chat({ message: 'Giá xe Tesla Cybertruck hiện tại bao nhiêu?' });
    assert.ok(res && res.text);
    assert.match(res.text, /(7\.500\.000\.000|7,5|7\.5|tỷ)/i, 'Phải đúng giá Tesla Cybertruck trong database');
  });

  await t.test('2. So sánh hai mẫu xe thật: Chỉ dùng dữ liệu đã xác minh', async () => {
    const comparison = await AITools.compareVehicles('tesla-cybertruck', 'toyota-camry');
    assert.ok(comparison && comparison.found, 'Phải tìm thấy cả 2 xe');
    assert.equal(comparison.car1.name, 'Tesla Cybertruck');
    assert.equal(comparison.car2.name, 'Toyota Camry 2.5Q');

    const res = await AIService.chat({ message: 'So sánh Tesla Cybertruck và Toyota Camry' });
    assert.ok(res && res.text);
    assert.match(res.text, /Cybertruck/i);
    assert.match(res.text, /Camry/i);
    assert.match(res.text, /(quãng đường|công suất|giá|chỗ)/i);
  });

  await t.test('3. Ngữ cảnh nhiều lượt: "So sánh hai chiếc trên"', async () => {
    const history = [
      { role: 'user', text: 'Tư vấn giúp tôi Tesla Cybertruck và Toyota Camry' },
      { role: 'assistant', text: 'Tesla Cybertruck là xe bán tải điện giá 7.5 tỷ, còn Toyota Camry là sedan giá 1.405 tỷ.' }
    ];
    const res = await AIService.chat({ message: 'So sánh hai chiếc trên giúp tôi', history });
    assert.ok(res && res.text);
    assert.match(res.text, /Cybertruck/i);
    assert.match(res.text, /Camry/i);
  });

  await t.test('4. Tự cập nhật kiến thức xe (Auto-Learn on Add, Update, Delete)', async () => {
    // 4.1 Thêm xe mới vào DB
    const testCar = await VehicleRepository.create({
      id: 'test-car-hyper-9',
      name: 'SIGMA Hyper 9 Extreme',
      brand: 'SIGMACAR',
      category: 'Sedan',
      fuel: 'ev',
      price: 2500000000,
      range: 750,
      hp: 650,
      seats: 5,
      battery: 'Pin Thể Rắn Siêu Cấp 120kWh'
    });
    assert.ok(testCar);

    // Kiểm tra RAG đã lập tức học xe mới
    const ragCar = AIService.knowledgeBase.vehicles.find(v => v.id === 'test-car-hyper-9');
    assert.ok(ragCar, 'RAG phải tự động học xe mới thêm');
    assert.equal(ragCar.price, 2500000000);

    // 4.2 Cập nhật giá xe
    await VehicleRepository.update('test-car-hyper-9', { price: 2300000000 });
    const updatedRagCar = AIService.knowledgeBase.vehicles.find(v => v.id === 'test-car-hyper-9');
    assert.equal(updatedRagCar.price, 2300000000, 'RAG phải tự cập nhật giá mới ngay lập tức');

    // 4.3 Xóa xe khỏi DB
    await VehicleRepository.delete('test-car-hyper-9');
    const deletedRagCar = AIService.knowledgeBase.vehicles.find(v => v.id === 'test-car-hyper-9');
    assert.equal(deletedRagCar, undefined, 'RAG phải gỡ bỏ xe đã bị xóa');
  });
});

test('PHẦN C: Smart Price Filter & Sorting Engine', async (t) => {
  const sampleVehicles = [
    { id: 'ev-cheap', name: 'EV Cheap', category: 'Compact', fuel: 'ev', price: 450000000 },
    { id: 'ev-mid', name: 'EV Mid SUV', category: 'SUV', fuel: 'ev', price: 850000000 },
    { id: 'ev-luxury', name: 'EV Luxury SUV', category: 'SUV', fuel: 'ev', price: 1600000000 },
    { id: 'ev-super', name: 'EV Super', category: 'Sedan', fuel: 'ev', price: 2800000000 },
    { id: 'gas-mid', name: 'Gas Mid SUV', category: 'SUV', fuel: 'gas', price: 900000000 },
    { id: 'gas-lux', name: 'Gas Luxury', category: 'Sedan', fuel: 'gas', price: 1750000000 }
  ];

  await t.test('1. Lọc Điện + giá tối đa 1.000 triệu (1 tỷ)', () => {
    const res = filterAndSortVehicles(sampleVehicles, {
      fuel: 'ev',
      maxPrice: '1000'
    });
    assert.equal(res.length, 2);
    assert.ok(res.every(c => c.fuel === 'ev' && c.price <= 1000000000));
  });

  await t.test('2. Lọc Xăng + giá từ 500 triệu đến 1.500 triệu', () => {
    const res = filterAndSortVehicles(sampleVehicles, {
      fuel: 'gas',
      minPrice: '500',
      maxPrice: '1500'
    });
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 'gas-mid');
  });

  await t.test('3. Chỉ có giá tối thiểu (minPrice: 1200 triệu), không có giá tối đa', () => {
    const res = filterAndSortVehicles(sampleVehicles, {
      minPrice: '1200'
    });
    assert.equal(res.length, 3);
    assert.ok(res.every(c => c.price >= 1200000000));
  });

  await t.test('4. Chỉ có giá tối đa (maxPrice: 800 triệu), không có giá tối thiểu', () => {
    const res = filterAndSortVehicles(sampleVehicles, {
      maxPrice: '800'
    });
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 'ev-cheap');
  });

  await t.test('5. Giá tối thiểu lớn hơn giá tối đa (minPrice: 1500 > maxPrice: 500)', () => {
    // Logic matchesPriceRange must reject invalid ranges
    assert.equal(matchesPriceRange(800000000, 'custom', '1500', '500'), false);
  });

  await t.test('6. Không có kết quả phù hợp: Trả về mảng rỗng []', () => {
    const res = filterAndSortVehicles(sampleVehicles, {
      fuel: 'gas',
      minPrice: '3000'
    });
    assert.deepEqual(res, []);
  });

  await t.test('7. Sắp xếp tăng dần & giảm dần chuẩn xác', () => {
    const asc = filterAndSortVehicles(sampleVehicles, { sort: 'price-asc' });
    assert.equal(asc[0].id, 'ev-cheap');
    assert.equal(asc[asc.length - 1].id, 'ev-super');

    const desc = filterAndSortVehicles(sampleVehicles, { sort: 'price-desc' });
    assert.equal(desc[0].id, 'ev-super');
    assert.equal(desc[desc.length - 1].id, 'ev-cheap');
  });

  await t.test('8. Kết hợp 3 điều kiện: Dòng SUV + Nhiên liệu Điện + Giá từ 500 đến 1.500 triệu', () => {
    const res = filterAndSortVehicles(sampleVehicles, {
      category: 'SUV',
      fuel: 'ev',
      minPrice: '500',
      maxPrice: '1500'
    });
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 'ev-mid');
  });
});

test('PHẦN D: Natural Language AI Vehicle Search Tool', async (t) => {
  await t.test('1. Tool search_vehicles nhận diện và truy vấn đúng điều kiện ngân sách', async () => {
    const results = await AITools.searchVehicles({
      fuel: 'ev',
      maxPrice: 1000000000
    });
    assert.ok(Array.isArray(results));
    assert.ok(results.every(c => c.price <= 1000000000));
  });

  await t.test('2. AI phản hồi câu hỏi tìm xe điện dưới 1 tỷ dựa trên dữ liệu thật', async () => {
    const res = await AIService.chat({ message: 'Tìm giúp tôi xe điện dưới 1 tỷ phù hợp gia đình' });
    assert.ok(res && res.text);
    assert.match(res.text, /(triệu|tỷ|City|Model|chỗ|điện)/i);
  });
});

test('PHẦN E: Bảo mật, Markdown Rendering & Quản trị RAG', async (t) => {
  await t.test('1. Markdown Rendering an toàn: Không còn dấu sao thô (**), hỗ trợ bảng và bold', () => {
    const raw = 'Xin chào! Tôi là **Sigma AI**.\n| Xe | Giá |\n| Model E | 1.29 tỷ |';
    const html = renderMarkdownSafe(raw);
    assert.doesNotMatch(html, /\*\*Sigma AI\*\*/, 'Không được hiển thị dấu sao thô');
    assert.match(html, /<strong>Sigma AI<\/strong>/, 'Phải chuyển thành thẻ strong');
    assert.match(html, /<table>/, 'Phải hỗ trợ bảng biểu');
  });

  await t.test('2. Ngăn chặn triệt để XSS qua Markdown parser', () => {
    const evil = '<script>alert("hacked")</script>**an toàn**';
    const html = renderMarkdownSafe(evil);
    assert.doesNotMatch(html, /<script>/, 'Phải escape thẻ script độc hại');
    assert.match(html, /&lt;script&gt;/, 'Phải mã hóa thành thực thể an toàn');
    assert.match(html, /<strong>an toàn<\/strong>/);
  });

  await t.test('3. API Key không bị lộ qua endpoint public config', () => {
    const pubConfig = AIService.getPublicConfig();
    assert.equal(pubConfig.apiKey, undefined, 'apiKey không được có trong public config');
    assert.ok(typeof pubConfig.hasApiKey === 'boolean', 'Chỉ được hiển thị cờ boolean hasApiKey');
  });
});
