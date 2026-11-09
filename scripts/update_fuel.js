const fs = require('fs');
const path = require('path');

const evIds = new Set([
  'model-e', 'vision-s', 'city-g', 'x-series-gt', 'grand-7',
  'aero-cross', 'horizon-mpv', 'vinfast-vf8', 'vinfast-vf3',
  'vinfast-vf7', 'vinfast-vf9', 'cpo-1', 'cpo-2', 'cpo-3', 'cpo-4', 'cpo-5'
]);

// 1. Update data/sigmacar_store.json if exists
const storePath = path.join(__dirname, '..', 'data', 'sigmacar_store.json');
if (fs.existsSync(storePath)) {
  const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  if (store.vehicles) {
    store.vehicles.forEach(v => {
      v.fuel = evIds.has(v.id) ? 'ev' : 'gas';
    });
  }
  if (store.certifiedVehicles) {
    store.certifiedVehicles.forEach(v => {
      v.fuel = 'ev';
    });
  }
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
  console.log('✅ Updated data/sigmacar_store.json with fuel fields');
}

// 2. Update js/data.js
const dataPath = path.join(__dirname, '..', 'js', 'data.js');
let dataJs = fs.readFileSync(dataPath, 'utf8');

// Insert fuel: "ev" or fuel: "gas" right after "type": "new" or "id": ...
evIds.forEach(id => {
  const re = new RegExp(`("id":\\s*"${id}"[\\s\\S]*?"category":\\s*"[^"]*",)`, 'g');
  dataJs = dataJs.replace(re, (match) => {
    if (!match.includes('"fuel":')) {
      return `${match}\n        "fuel": "ev",`;
    }
    return match;
  });
});

const gasIds = ['toyota-camry', 'honda-crv', 'ford-ranger', 'hyundai-tucson', 'mazda-cx5', 'mercedes-glc300', 'bmw-330i', 'kia-seltos', 'mitsubishi-xpander'];
gasIds.forEach(id => {
  const re = new RegExp(`("id":\\s*"${id}"[\\s\\S]*?"category":\\s*"[^"]*",)`, 'g');
  dataJs = dataJs.replace(re, (match) => {
    if (!match.includes('"fuel":')) {
      return `${match}\n        "fuel": "gas",`;
    }
    return match;
  });
});

fs.writeFileSync(dataPath, dataJs, 'utf8');
console.log('✅ Updated js/data.js with fuel fields');
