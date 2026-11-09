const fs = require('fs');
const path = require('path');

// 1. Load existing vehicles from data/sigmacar_store.json
const store = JSON.parse(fs.readFileSync('data/sigmacar_store.json', 'utf8'));
const existingNewCars = store.vehicles || [];
const existingCpoCars = store.certifiedVehicles || [];

console.log('=== EXISTING STORE CARS ===');
console.log('New Vehicles count:', existingNewCars.length);
existingNewCars.forEach((c, idx) => {
  console.log(`[${idx + 1}] ID:${c.id} | Name:${c.name} | Brand:${c.brand} | Year:${c.year || ''} | Price:${c.price} | Fuel:${c.fuel} | Category:${c.category}`);
});

console.log('\nCPO Vehicles count:', existingCpoCars.length);
existingCpoCars.forEach((c, idx) => {
  console.log(`[${idx + 1}] ID:${c.id} | Name:${c.name} | Brand:${c.brand} | Year:${c.year || ''} | Price:${c.price}`);
});

// Also check js/data.js
try {
  const dataJsContent = fs.readFileSync('js/data.js', 'utf8');
  // Evaluate in safe VM or extract
  const vm = require('vm');
  const sandbox = { window: {}, document: {} };
  vm.createContext(sandbox);
  vm.runInContext(dataJsContent, sandbox);
  const sigmaData = sandbox.window.SIGMA_DATA || sandbox.SIGMA_DATA;
  if (sigmaData) {
    console.log('\n=== JS/DATA.JS CARS ===');
    console.log('SIGMA_DATA.cars count:', (sigmaData.cars || []).length);
    console.log('SIGMA_DATA.certifiedCars count:', (sigmaData.certifiedCars || []).length);
  }
} catch (e) {
  console.log('Error reading js/data.js:', e.message);
}
