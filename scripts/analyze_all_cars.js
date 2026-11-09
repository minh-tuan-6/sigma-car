const fs = require('fs');
const path = require('path');

function decodeEntities(str) {
  if (!str) return '';
  return str.replace(/&#(\d+);/g, (m, dec) => String.fromCharCode(dec))
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
}

function getSharedStrings(dir) {
  const filePath = path.join(dir, 'xl', 'sharedStrings.xml');
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const items = content.split('<si>');
  const result = [];
  for (let i = 1; i < items.length; i++) {
    const chunk = items[i].split('</si>')[0];
    const texts = [];
    const tParts = chunk.split(/<t\b[^>]*>/);
    for (let j = 1; j < tParts.length; j++) {
      texts.push(tParts[j].split('</t>')[0]);
    }
    result.push(decodeEntities(texts.join('')));
  }
  return result;
}

function parseSheet(filePath, sharedStrings) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const rows = [];
  const rowChunks = content.split('<row ');
  for (let i = 1; i < rowChunks.length; i++) {
    const rChunk = rowChunks[i].split('</row>')[0];
    const rowNumMatch = rChunk.match(/^r="(\d+)"/);
    const rowNum = rowNumMatch ? rowNumMatch[1] : i;
    const cells = {};
    const cChunks = rChunk.split('<c ');
    for (let j = 1; j < cChunks.length; j++) {
      const c = cChunks[j].split('</c>')[0];
      const colMatch = c.match(/^r="([A-Z]+)\d+"/);
      const col = colMatch ? colMatch[1] : '';
      const isString = c.includes('t="s"');
      const isInline = c.includes('t="inlineStr"');
      let val = '';
      if (isInline) {
        const tM = c.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
        val = tM ? decodeEntities(tM[1]) : '';
      } else {
        const vM = c.match(/<v>([\s\S]*?)<\/v>/);
        val = vM ? vM[1] : '';
        if (isString) {
          const idx = parseInt(val, 10);
          val = sharedStrings[idx] !== undefined ? sharedStrings[idx] : val;
        }
      }
      if (col) cells[col] = val;
    }
    rows.push({ rowNum, cells });
  }
  return rows;
}

// 1. Existing DB cars
const store = JSON.parse(fs.readFileSync('data/sigmacar_store.json', 'utf8'));
const existingCars = store.vehicles;

console.log('Total existing vehicles in store:', existingCars.length);

// 2. Parse Data-xe.xlsx Sheet 1
const dir1 = 'C:/Users/Tran Tuan/.gemini/antigravity-ide/brain/b4f1cba7-5248-4399-8797-fd0446d289c9/scratch/about_car/Data-xe';
const ss1 = getSharedStrings(dir1);
const rows1 = parseSheet(path.join(dir1, 'xl', 'worksheets', 'sheet1.xml'), ss1);

// Row 1: Header title, Row 2: Subtitle, Row 3: Header columns (row index 2 in 0-indexed)
// Data starts at row index 3 to 12
const dataXeCars = [];
for (let i = 3; i < rows1.length; i++) {
  const c = rows1[i].cells;
  if (!c.A || !c.B) continue;
  dataXeCars.push({
    source: 'Data-xe.xlsx',
    code: c.A,
    name: c.B,
    brand: c.C,
    category: c.D,
    colors: c.E,
    price: parseInt(c.F, 10),
    specs: c.G,
    year: parseInt(c.H, 10),
    stock: parseInt(c.I, 10),
    imageUrl: c.J
  });
}

// 3. Parse SIGMACAR_Vehicle_Component_Database.xlsx Sheet 1
const dir2 = 'C:/Users/Tran Tuan/.gemini/antigravity-ide/brain/b4f1cba7-5248-4399-8797-fd0446d289c9/scratch/about_car/SIGMACAR_Vehicle_Component_Database';
const ss2 = getSharedStrings(dir2);
const rows2 = parseSheet(path.join(dir2, 'xl', 'worksheets', 'sheet1.xml'), ss2);
// Row 1: Header columns
const compDbCars = [];
for (let i = 1; i < rows2.length; i++) {
  const c = rows2[i].cells;
  if (!c.A || !c.B) continue;
  compDbCars.push({
    source: 'SIGMACAR_Vehicle_Component_Database.xlsx',
    vehicle_id: c.A,
    brand: c.B,
    model: c.C,
    version: c.D,
    vehicle_type: c.E,
    seats: parseInt(c.F, 10) || null,
    powertrain: c.G,
    max_power_kW: c.H,
    max_torque_Nm: c.I,
    range_km: c.J,
    range_test_cycle: c.K,
    battery_capacity_kWh: c.L,
    fast_charge_time: c.M,
    dimensions: c.N,
    drive: c.O,
    price: c.P ? parseInt(c.P, 10) : null,
    offer_price: c.Q ? parseInt(c.Q, 10) : null,
    price_note: c.R,
    warranty: c.S,
    official_source_url: c.T,
    source_type: c.U,
    data_note: c.W
  });
}

console.log('\n--- DATA-XE.XLSX CARS (' + dataXeCars.length + ') ---');
dataXeCars.forEach(c => console.log(`[${c.code}] ${c.brand} ${c.name} | Năm: ${c.year} | Giá: ${c.price}`));

console.log('\n--- COMPONENT_DATABASE.XLSX CARS (' + compDbCars.length + ') ---');
compDbCars.forEach(c => console.log(`[${c.vehicle_id}] ${c.brand} ${c.model} (${c.version}) | Range: ${c.range_km} | Pin: ${c.battery_capacity_kWh} | Giá: ${c.price}`));

console.log('\n--- EXISTING STORE CARS (' + existingCars.length + ') ---');
existingCars.forEach(c => console.log(`[${c.id}] ${c.brand} ${c.name} | Giá: ${c.price}`));
