// tests/unit/power_filter.test.js
// PLAN.md T3.3 — minimum power filter in the catalog (filterAndSortVehicles).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SIGMA_DATA } = require('../../js/data.js');
const { filterAndSortVehicles, getActiveFiltersDescription } = require('../../js/app.js');

describe('T3.3 minimum power filter', () => {
  const cars = SIGMA_DATA.cars;

  it('keeps only cars at or above the minimum horsepower', () => {
    const fast = filterAndSortVehicles(cars, { minPowerHp: '500' });
    assert.ok(fast.length > 0 && fast.length < cars.length);
    fast.forEach(c => assert.ok(Number(c.hp) >= 500 || /\d/.test(String(c.power)), c.name));
    assert.ok(fast.every(c => !(typeof c.hp === 'number' && c.hp < 500)));
  });

  it('reads power strings when hp is missing (HP, then kW × 1.341)', () => {
    const list = [
      { id: 'a', name: 'A', power: '1.500 HP (1.103 kW)', price: 1 },
      { id: 'b', name: 'B', power: '150 kW', price: 1 },
      { id: 'c', name: 'C', power: 'Chưa công bố', price: 1 }
    ];
    assert.deepEqual(filterAndSortVehicles(list, { minPowerHp: 1000 }).map(c => c.id), ['a']);
    assert.deepEqual(filterAndSortVehicles(list, { minPowerHp: 200 }).map(c => c.id).sort(), ['a', 'b']);
  });

  it('empty value means no filter, and the summary mentions the filter', () => {
    assert.equal(filterAndSortVehicles(cars, { minPowerHp: '' }).length, filterAndSortVehicles(cars, {}).length);
    const desc = getActiveFiltersDescription({ activeMinPowerHp: '300', activeBodyCategory: 'all', activeBrandFilter: 'all', activeFuelFilter: 'all', activePriceRange: 'all' });
    assert.match(String(desc), /Công suất >= 300 HP/);
  });
});
