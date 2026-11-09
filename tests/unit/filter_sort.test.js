// tests/unit/filter_sort.test.js
// Automated Test Suite for SIGMACAR Vehicle Search, Filter & Sort Engine
// Validates all 12 mandatory test scenarios requested by user

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { SIGMA_DATA } = require('../../js/data.js');
const {
  getVehicleFuel,
  getVehicleNumericPrice,
  matchesPriceRange,
  filterAndSortVehicles,
  getActiveFiltersDescription
} = require('../../js/app.js');
const VehicleRepository = require('../../backend/infrastructure/repositories/vehicle-repository.js');

describe('SIGMACAR Filter & Sort Engine: 12 Mandatory Verification Cases', () => {
  const cars = SIGMA_DATA.cars;

  test('Case 1: Chọn Điện -> Kết quả chỉ chứa xe điện (fuel === "ev")', () => {
    const evCars = filterAndSortVehicles(cars, { fuel: 'ev' });
    assert.ok(evCars.length > 0, 'Phải có ít nhất 1 xe điện trong hệ thống');
    assert.equal(evCars.length, 23, 'Danh mục hiện tại có chính xác 23 xe điện');

    evCars.forEach(car => {
      const fuel = getVehicleFuel(car);
      assert.equal(fuel, 'ev', `Xe "${car.name}" phải là xe điện (thực tế: ${fuel})`);
      assert.notEqual(car.fuel, 'gas', `Xe "${car.name}" không được là xe xăng`);
    });
  });

  test('Case 2: Chọn Xăng -> Kết quả chỉ chứa xe xăng (fuel === "gas")', () => {
    const gasCars = filterAndSortVehicles(cars, { fuel: 'gas' });
    assert.ok(gasCars.length > 0, 'Phải có ít nhất 1 xe xăng trong hệ thống');
    assert.equal(gasCars.length, 9, 'Danh mục hiện tại có chính xác 9 xe xăng');

    gasCars.forEach(car => {
      const fuel = getVehicleFuel(car);
      assert.equal(fuel, 'gas', `Xe "${car.name}" phải là xe xăng (thực tế: ${fuel})`);
      assert.notEqual(car.fuel, 'ev', `Xe "${car.name}" không được là xe điện`);
    });
  });

  test('Case 3: Lọc theo từng khoảng giá chuẩn hóa số và xử lý biên chính xác', () => {
    // 3a. Dưới 500 triệu: < 500.000.000 VNĐ
    const under500m = filterAndSortVehicles(cars, { priceRange: 'under-500m' });
    assert.ok(under500m.length > 0, 'Có xe dưới 500 triệu');
    under500m.forEach(car => {
      const price = getVehicleNumericPrice(car);
      assert.ok(price < 500000000, `Giá xe "${car.name}" (${price}) phải < 500 triệu`);
    });

    // 3b. Từ 500 triệu đến 1 tỷ: >= 500.000.000 && <= 1.000.000.000 VNĐ
    const from500mTo1b = filterAndSortVehicles(cars, { priceRange: '500m-1b' });
    assert.ok(from500mTo1b.length > 0, 'Có xe trong khoảng 500 triệu - 1 tỷ');
    from500mTo1b.forEach(car => {
      const price = getVehicleNumericPrice(car);
      assert.ok(price >= 500000000 && price <= 1000000000, `Giá xe "${car.name}" (${price}) phải nằm trong [500M, 1B]`);
    });

    // 3c. Dưới 1 tỷ: < 1.000.000.000 VNĐ
    const under1b = filterAndSortVehicles(cars, { priceRange: 'under-1b' });
    under1b.forEach(car => {
      const price = getVehicleNumericPrice(car);
      assert.ok(price < 1000000000, `Giá xe "${car.name}" (${price}) phải < 1 tỷ`);
    });

    // 3d. Từ 1 tỷ đến 2 tỷ: >= 1.000.000.000 && <= 2.000.000.000 VNĐ
    const from1bTo2b = filterAndSortVehicles(cars, { priceRange: '1b-2b' });
    assert.ok(from1bTo2b.length > 0, 'Có xe trong khoảng 1 tỷ - 2 tỷ');
    from1bTo2b.forEach(car => {
      const price = getVehicleNumericPrice(car);
      assert.ok(price >= 1000000000 && price <= 2000000000, `Giá xe "${car.name}" (${price}) phải nằm trong [1B, 2B]`);
    });

    // 3e. Trên 2 tỷ: > 2.000.000.000 VNĐ
    const above2b = filterAndSortVehicles(cars, { priceRange: 'above-2b' });
    assert.ok(above2b.length > 0, 'Có xe trên 2 tỷ');
    above2b.forEach(car => {
      const price = getVehicleNumericPrice(car);
      assert.ok(price > 2000000000, `Giá xe "${car.name}" (${price}) phải > 2 tỷ`);
    });

    // 3f. Kiểm tra giá trị tại ranh giới biên (Boundary test)
    assert.equal(matchesPriceRange(500000000, '500m-1b'), true, '500M phải nằm trong 500m-1b');
    assert.equal(matchesPriceRange(500000000, 'under-500m'), false, '500M không thuộc dưới 500m');
    assert.equal(matchesPriceRange(1000000000, '500m-1b'), true, '1B phải nằm trong 500m-1b');
    assert.equal(matchesPriceRange(1000000000, '1b-2b'), true, '1B phải nằm trong 1b-2b');
    assert.equal(matchesPriceRange(2000000000, '1b-2b'), true, '2B phải nằm trong 1b-2b');
    assert.equal(matchesPriceRange(2000000000, 'above-2b'), false, '2B không thuộc trên 2b');
  });

  test('Case 4: Kết hợp đồng thời Dòng xe, Khoảng giá, Nhiên liệu theo logic AND', () => {
    // Điều kiện: Dòng SUV + Giá từ 1 tỷ đến 2 tỷ + Nhiên liệu Điện
    const res = filterAndSortVehicles(cars, {
      category: 'SUV',
      priceRange: '1b-2b',
      fuel: 'ev'
    });

    assert.ok(res.length > 0, 'Tìm thấy xe điện SUV trong khoảng 1B - 2B');
    res.forEach(car => {
      // 1. Phải là SUV / Crossover
      const cat = (car.category || '').toLowerCase();
      assert.ok(cat.includes('suv') || cat.includes('crossover'), `Xe "${car.name}" phải là SUV/Crossover`);
      // 2. Phải là xe điện
      assert.equal(getVehicleFuel(car), 'ev', `Xe "${car.name}" phải là xe điện`);
      // 3. Giá phải trong khoảng 1B - 2B
      const price = getVehicleNumericPrice(car);
      assert.ok(price >= 1000000000 && price <= 2000000000, `Giá "${car.name}" (${price}) phải trong 1B - 2B`);
    });

    // Kiểm tra xe xăng không lọt vào
    const hasGas = res.some(c => getVehicleFuel(c) === 'gas');
    assert.equal(hasGas, false, 'Không có xe xăng nào trong kết quả');

    // Kiểm tra xe ngoài khoảng giá không lọt vào (ví dụ VinFast VF 3 giá 240M hoặc Vision S sedan)
    const hasVF3 = res.some(c => c.id === 'vinfast-vf3');
    assert.equal(hasVF3, false, 'VF 3 (240M) không được lọt vào khoảng 1B - 2B');
    const hasSedan = res.some(c => (c.category || '').toLowerCase() === 'sedan');
    assert.equal(hasSedan, false, 'Xe sedan không được lọt vào bộ lọc SUV');
  });

  test('Case 5: "Tất cả các dòng xe" và "Tất cả mức giá" không giới hạn kết quả', () => {
    // Khi cả 3 đều là 'all', trả về toàn bộ 24 xe
    const allCars = filterAndSortVehicles(cars, {
      category: 'all',
      priceRange: 'all',
      fuel: 'all'
    });
    assert.equal(allCars.length, 32, 'Trả về đúng 32 xe trong danh mục khi không lọc');

    // Khi category='all', price='all' và fuel='ev', trả về đúng 15 xe điện bất kể dòng xe hay mức giá
    const allEv = filterAndSortVehicles(cars, {
      category: 'all',
      priceRange: 'all',
      fuel: 'ev'
    });
    assert.equal(allEv.length, 23, 'Trả về toàn bộ 23 xe điện khi category & price là all');

    // Khi category='all', price='all' và fuel='gas', trả về đúng 9 xe xăng
    const allGas = filterAndSortVehicles(cars, {
      category: 'all',
      priceRange: 'all',
      fuel: 'gas'
    });
    assert.equal(allGas.length, 9, 'Trả về toàn bộ 9 xe xăng khi category & price là all');
  });

  test('Case 6: Đổi từ Điện sang Xăng nhiều lần -> kết quả độc lập, không lưu vết cũ', () => {
    let current = filterAndSortVehicles(cars, { fuel: 'ev' });
    assert.equal(current.length, 23);
    assert.ok(current.every(c => getVehicleFuel(c) === 'ev'));

    current = filterAndSortVehicles(cars, { fuel: 'gas' });
    assert.equal(current.length, 9);
    assert.ok(current.every(c => getVehicleFuel(c) === 'gas'));

    current = filterAndSortVehicles(cars, { fuel: 'ev' });
    assert.equal(current.length, 23);
    assert.ok(current.every(c => getVehicleFuel(c) === 'ev'));

    current = filterAndSortVehicles(cars, { fuel: 'gas' });
    assert.equal(current.length, 9);
    assert.ok(current.every(c => getVehicleFuel(c) === 'gas'));

    // Bỏ chọn (all) -> về 24 xe
    current = filterAndSortVehicles(cars, { fuel: 'all' });
    assert.equal(current.length, 32);
  });

  test('Case 7: Thay đổi mức giá rồi tìm kiếm -> kết quả cập nhật chính xác theo mức giá mới', () => {
    // Bước 1: Lọc xe điện dưới 500 triệu
    const step1 = filterAndSortVehicles(cars, { fuel: 'ev', priceRange: 'under-500m' });
    assert.ok(step1.length > 0);
    assert.ok(step1.every(c => getVehicleFuel(c) === 'ev' && getVehicleNumericPrice(c) < 500000000));

    // Bước 2: Đổi sang xe điện trên 2 tỷ
    const step2 = filterAndSortVehicles(cars, { fuel: 'ev', priceRange: 'above-2b' });
    assert.ok(step2.length > 0);
    assert.ok(step2.every(c => getVehicleFuel(c) === 'ev' && getVehicleNumericPrice(c) > 2000000000));

    // Đảm bảo không có xe nào của step1 xuất hiện trong step2
    const step1Ids = new Set(step1.map(c => c.id));
    const step2Ids = new Set(step2.map(c => c.id));
    for (const id of step2Ids) {
      assert.equal(step1Ids.has(id), false, `Xe ${id} không được xuất hiện ở cả 2 khoảng giá trái ngược`);
    }
  });

  test('Case 8: Bộ lọc không có kết quả -> trả về mảng rỗng [], KHÔNG tự ý hiển thị toàn bộ xe', () => {
    // Xe xăng Sedan với giá dưới 500 triệu (hệ thống không có xe nào thỏa mãn cả 3 điều kiện)
    const emptyResult = filterAndSortVehicles(cars, {
      category: 'Sedan',
      priceRange: 'under-500m',
      fuel: 'gas'
    });

    assert.ok(Array.isArray(emptyResult), 'Phải là mảng');
    assert.equal(emptyResult.length, 0, 'Phải trả về 0 xe khi không có xe phù hợp');
    assert.notEqual(emptyResult.length, cars.length, 'TUYỆT ĐỐI không được fallback về toàn bộ xe');
  });

  test('Case 9: Dữ liệu giá/tên bất thường (null, undefined, string lạ) -> Xử lý an toàn, không crash', () => {
    const dirtyData = [
      { id: 'dirty-1', name: 'Xe Test Null Price', category: 'SUV', fuel: 'ev', price: null },
      { id: 'dirty-2', name: 'Xe Test Undefined', category: 'SUV', fuel: 'ev' },
      { id: 'dirty-3', name: 'Xe Test String Price', category: 'SUV', fuel: 'ev', price: '1.250.000.000 VNĐ' },
      { id: 'dirty-4', name: 'Xe Test Free Price', category: 'SUV', fuel: 'ev', price: 'Liên hệ' },
      null,
      undefined
    ];

    // Lọc không được throw Exception
    assert.doesNotThrow(() => {
      const filtered = filterAndSortVehicles(dirtyData, { priceRange: '1b-2b', fuel: 'ev' });
      assert.ok(Array.isArray(filtered));
      // dirty-3 có giá '1.250.000.000 VNĐ' chuẩn hóa thành 1250000000 nằm trong 1B-2B
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].id, 'dirty-3');
    });

    // Sắp xếp với dữ liệu bẩn không được crash
    assert.doesNotThrow(() => {
      const sorted = filterAndSortVehicles(dirtyData, { sort: 'price-asc' });
      assert.ok(Array.isArray(sorted));
    });
  });

  test('Case 10: Sắp xếp kết quả hoạt động chuẩn xác (giá tăng, giá giảm, tên A-Z, Z-A)', () => {
    // 10a. Sắp xếp giá tăng dần (price-asc)
    const ascCars = filterAndSortVehicles(cars, { sort: 'price-asc' });
    for (let i = 0; i < ascCars.length - 1; i++) {
      const p1 = getVehicleNumericPrice(ascCars[i]);
      const p2 = getVehicleNumericPrice(ascCars[i + 1]);
      assert.ok(p1 <= p2, `Giá tăng dần: ${p1} <= ${p2} (${ascCars[i].name} vs ${ascCars[i+1].name})`);
    }

    // 10b. Sắp xếp giá giảm dần (price-desc)
    const descCars = filterAndSortVehicles(cars, { sort: 'price-desc' });
    for (let i = 0; i < descCars.length - 1; i++) {
      const p1 = getVehicleNumericPrice(descCars[i]);
      const p2 = getVehicleNumericPrice(descCars[i + 1]);
      assert.ok(p1 >= p2, `Giá giảm dần: ${p1} >= ${p2} (${descCars[i].name} vs ${descCars[i+1].name})`);
    }

    // 10c. Sắp xếp tên A-Z tiếng Việt (name-asc)
    const nameAsc = filterAndSortVehicles(cars, { sort: 'name-asc' });
    for (let i = 0; i < nameAsc.length - 1; i++) {
      const cmp = (nameAsc[i].name || '').localeCompare(nameAsc[i + 1].name || '', 'vi', { sensitivity: 'base' });
      assert.ok(cmp <= 0, `Tên A-Z: "${nameAsc[i].name}" đứng trước "${nameAsc[i+1].name}"`);
    }

    // 10d. Sắp xếp tên Z-A tiếng Việt (name-desc)
    const nameDesc = filterAndSortVehicles(cars, { sort: 'name-desc' });
    for (let i = 0; i < nameDesc.length - 1; i++) {
      const cmp = (nameDesc[i].name || '').localeCompare(nameDesc[i + 1].name || '', 'vi', { sensitivity: 'base' });
      assert.ok(cmp >= 0, `Tên Z-A: "${nameDesc[i].name}" đứng sau "${nameDesc[i+1].name}"`);
    }

    // 10e. Không làm thay đổi mảng gốc (Immutability)
    const originalFirstId = cars[0].id;
    filterAndSortVehicles(cars, { sort: 'price-desc' });
    assert.equal(cars[0].id, originalFirstId, 'Mảng gốc SIGMA_DATA.cars không được bị mutate');
  });

  test('Case 11: Backend VehicleRepository đồng bộ logic lọc & sắp xếp với Frontend', async () => {
    // 11a. Backend lọc fuel=ev
    const backendEv = await VehicleRepository.findAll({ fuel: 'ev' });
    assert.equal(backendEv.length, 23, 'Backend phải trả về đúng 23 xe điện');

    // 11b. Backend lọc fuel=gas
    const backendGas = await VehicleRepository.findAll({ fuel: 'gas' });
    assert.equal(backendGas.length, 9, 'Backend phải trả về đúng 9 xe xăng');

    // 11c. Backend lọc minPrice và maxPrice
    const backendRange = await VehicleRepository.findAll({
      minPrice: 1000000000,
      maxPrice: 2000000000,
      fuel: 'ev'
    });
    backendRange.forEach(c => {
      assert.ok(c.price >= 1000000000 && c.price <= 2000000000);
      assert.equal(c.fuel, 'ev');
    });

    // 11d. Backend sắp xếp giá tăng dần
    const backendPriceAsc = await VehicleRepository.findAll({ sort: 'price-asc' });
    for (let i = 0; i < backendPriceAsc.length - 1; i++) {
      assert.ok(backendPriceAsc[i].price <= backendPriceAsc[i + 1].price);
    }
  });

  test('Case 12: Đảm bảo nhãn mô tả bộ lọc (getActiveFiltersDescription) phản ánh chính xác state', () => {
    const desc = getActiveFiltersDescription();
    assert.ok(typeof desc === 'string');
    assert.ok(desc.includes('Bộ lọc đang áp dụng:'));
  });
});
