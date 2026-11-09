// scripts/reset_test_state.js
const { dbState, seedInitialData, saveToDisk } = require('../backend/infrastructure/storage-engine');

seedInitialData();
if (Array.isArray(dbState.vehicles)) {
  dbState.vehicles.forEach(v => {
    if (['model-e', 'city-g', 'vision-s', 'x-series-gt', 'grand-7'].includes(v.id)) {
      v.stock = Math.max(v.stock || 20, 25);
    } else if (v.excelStock) {
      v.stock = v.excelStock;
    }
    v.isAvailable = true;
  });
}
saveToDisk();
console.log('Successfully reset database to clean initial state and replenished vehicle stock.');
