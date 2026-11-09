const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Load AutomotiveLLM & mock data
const AutomotiveLLM = require('../js/automotive-llm.js');

// Mock vehicle catalog similar to SIGMA_DATA
const mockCars = [
  {
    id: 'model-e',
    name: 'SIGMA Model E',
    category: 'SUV Điện Hạng Sang',
    price: 1290000000,
    priceFormatted: '1.290.000.000 VNĐ',
    priceShort: '1.29 tỷ',
    range: 520,
    power: '320 HP',
    hp: 320,
    seats: 5,
    battery: 'Pin Lithium-Ion 82 kWh',
    dimensions: '4.750 x 1.920 x 1.625 mm'
  },
  {
    id: 'vision-s',
    name: 'SIGMA Vision S',
    category: 'Sedan Thể Thao Điện',
    price: 1890000000,
    priceFormatted: '1.890.000.000 VNĐ',
    priceShort: '1.89 tỷ',
    range: 680,
    power: '450 HP',
    hp: 450,
    seats: 5,
    battery: 'Pin Thể Rắn 95 kWh',
    dimensions: '4.980 x 1.960 x 1.440 mm'
  },
  {
    id: 'grand-7',
    name: 'SIGMA Grand 7',
    category: 'SUV 7 Chỗ Gia Đình',
    price: 1750000000,
    priceFormatted: '1.750.000.000 VNĐ',
    priceShort: '1.75 tỷ',
    range: 560,
    power: '380 HP',
    hp: 380,
    seats: 7,
    battery: 'Pin LFP 90 kWh',
    dimensions: '5.120 x 2.000 x 1.760 mm'
  },
  {
    id: 'tucson-20',
    name: 'Hyundai Tucson 2.0L Đặc Biệt',
    category: 'Crossover 5 Chỗ',
    price: 845000000,
    priceFormatted: '845.000.000 VNĐ',
    priceShort: '845 triệu',
    range: 0,
    power: '156 HP',
    hp: 156,
    seats: 5,
    battery: 'Động cơ xăng SmartStream',
    dimensions: '4.630 x 1.865 x 1.695 mm'
  }
];

const mockAccessories = [
  { id: 'cam-vietmap', name: 'Camera hành trình Vietmap KC01', brand: 'Vietmap', priceFormatted: '4.190.000 VNĐ', specs: 'Ghi hình 2K' }
];

test.describe('AutomotiveLLM: Mini-GPT Intelligence & Live Auto-Learning', () => {

  test.beforeEach(() => {
    AutomotiveLLM.syncKnowledgeBase(mockCars, [], mockAccessories);
  });

  test('1. Conversational Greeting & Mini-GPT chit-chat', async () => {
    const res = await AutomotiveLLM.queryLLM('Chào bạn! Bạn là ai vậy?', { provider: 'local-automotive' });
    assert.ok(res.text.includes('Sigma AI'), 'Should introduce itself as Sigma AI');
    assert.ok(res.text.includes('Tư vấn xe theo ngân sách') || res.text.includes('Tìm xe gia đình'), 'Should guide the customer warmly');
  });

  test('2. Deep specs knowledge of existing cars (Model E & Tucson)', async () => {
    // Model E
    const resModelE = await AutomotiveLLM.queryLLM('Cho tôi biết thông số chi tiết xe Model E', { provider: 'local-automotive' });
    assert.ok(resModelE.text.includes('SIGMA Model E'), 'Should recognize Model E');
    assert.ok(resModelE.text.includes('1.290.000.000') || resModelE.text.includes('1.29'), 'Should know price');
    assert.ok(resModelE.text.includes('320 HP') || resModelE.text.includes('82 kWh'), 'Should know power/battery');

    // Tucson (sub-word match)
    const resTucson = await AutomotiveLLM.queryLLM('Tôi muốn hỏi về xe Tucson', { provider: 'local-automotive' });
    assert.ok(resTucson.text.includes('Hyundai Tucson'), 'Should match Tucson');
    assert.ok(resTucson.text.includes('845.000.000') || resTucson.text.includes('845 triệu'), 'Should know Tucson price');
  });

  test('3. Side-by-side comparison between two cars', async () => {
    const resComp = await AutomotiveLLM.queryLLM('So sánh xe Model E và Vision S', { provider: 'local-automotive' });
    assert.ok(resComp.text.includes('SIGMA Model E') && resComp.text.includes('SIGMA Vision S'), 'Should compare both models');
    assert.ok(resComp.recommendation && resComp.recommendation.badge.includes('SO SÁNH'), 'Should provide comparison badge');
  });

  test('4. Family and 7-seater recommendations', async () => {
    const resFamily = await AutomotiveLLM.queryLLM('Gia đình đông người muốn tìm xe 7 chỗ đi xa rộng rãi', { provider: 'local-automotive' });
    assert.ok(resFamily.text.includes('7 Chỗ') || resFamily.text.includes('Grand 7'), 'Should suggest 7-seater');
    assert.equal(resFamily.recommendation.carId, 'grand-7', 'Should recommend Grand 7');
  });

  test('5. LIVE AUTO-LEARNING: Learns newly added vehicle in real-time without retraining', async () => {
    // Add brand new vehicle to website
    const brandNewCar = {
      id: 'sigma-cybertruck-extreme',
      name: 'SIGMA CyberTruck Extreme',
      category: 'Bán tải điện Siêu Sang',
      price: 2450000000,
      priceFormatted: '2.450.000.000 VNĐ',
      priceShort: '2.45 tỷ',
      range: 750,
      power: '650 HP Tri-Motor',
      hp: 650,
      seats: 5,
      battery: 'Pin Thể Rắn Siêu Bền 120 kWh',
      dimensions: '5.885 x 2.210 x 1.790 mm',
      acceleration: '2.9s'
    };

    // Before learning: count is 4
    assert.equal(AutomotiveLLM.getLearnedVehicleCount(), 4);

    // Act: Dynamic RAG Live Ingestion
    AutomotiveLLM.learnNewVehicle(brandNewCar);

    // After learning: count increases to 5
    assert.equal(AutomotiveLLM.getLearnedVehicleCount(), 5);

    // Query AI about newly added car
    const resNew = await AutomotiveLLM.queryLLM('Kể cho tôi nghe về dòng xe CyberTruck mới thêm', { provider: 'local-automotive' });
    
    assert.ok(resNew.text.includes('SIGMA CyberTruck Extreme'), 'AI must know the newly learned vehicle!');
    assert.ok(resNew.text.includes('2.450.000.000') || resNew.text.includes('2.45 tỷ'), 'AI must know new car price');
    assert.ok(resNew.text.includes('750 km') || resNew.text.includes('750'), 'AI must know new car range');
    assert.ok(resNew.text.includes('650 HP') || resNew.text.includes('120 kWh'), 'AI must know new car motor/battery');
    assert.equal(resNew.recommendation.carId, 'sigma-cybertruck-extreme', 'Recommendation must link to newly learned car');
  });

});
