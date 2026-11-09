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
    rows.push(cells);
  }
  return rows;
}

// 1. Existing vehicles
const store = JSON.parse(fs.readFileSync('data/sigmacar_store.json', 'utf8'));
const existingVehicles = store.vehicles;

// Helper to normalize names
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

console.log('--- EXISTING DATABASE VEHICLES (' + existingVehicles.length + ') ---');
existingVehicles.forEach((v, idx) => {
  console.log(`${idx + 1}. [${v.id}] ${v.name} | Hãng: ${v.brand} | Giá: ${v.price}`);
});

// 2. Data-xe.xlsx
const dir1 = 'C:/Users/Tran Tuan/.gemini/antigravity-ide/brain/b4f1cba7-5248-4399-8797-fd0446d289c9/scratch/about_car/Data-xe';
const ss1 = getSharedStrings(dir1);
const rows1 = parseSheet(path.join(dir1, 'xl', 'worksheets', 'sheet1.xml'), ss1);

console.log('\n--- MATCHING DATA-XE.XLSX (10 CARS) ---');
for (let i = 3; i < 13; i++) {
  const c = rows1[i];
  const name = c.B;
  const brand = c.C;
  const price = parseInt(c.F, 10);
  
  // match against existing
  const match = existingVehicles.find(ev => {
    const normEv = normalize(ev.name);
    const normName = normalize(name);
    return normEv.includes(normName) || normName.includes(normEv) || (ev.brand.toLowerCase() === brand.toLowerCase() && Math.abs(ev.price - price) < 1000);
  });

  const status = match ? 'EXISTS' : 'MISSING';
  console.log(`[${c.A}] ${name} (${brand}, ${price}) -> ${status} ${match ? `(matched: ${match.id} - ${match.name})` : ''}`);
}

// 3. SIGMACAR_Vehicle_Component_Database.xlsx
const dir2 = 'C:/Users/Tran Tuan/.gemini/antigravity-ide/brain/b4f1cba7-5248-4399-8797-fd0446d289c9/scratch/about_car/SIGMACAR_Vehicle_Component_Database';
const ss2 = getSharedStrings(dir2);
const rows2 = parseSheet(path.join(dir2, 'xl', 'worksheets', 'sheet1.xml'), ss2);

console.log('\n--- MATCHING COMPONENT_DATABASE.XLSX (10 CARS) ---');
for (let i = 1; i < rows2.length; i++) {
  const c = rows2[i];
  const vId = c.A;
  const brand = c.B;
  const model = c.C;
  const version = c.D;
  const price = c.P ? parseInt(c.P, 10) : null;

  // match against existing
  const match = existingVehicles.find(ev => {
    const normEv = normalize(ev.name);
    const normModel = normalize(model);
    // e.g. vf 3, vf 7, vf 8, vf 9
    if (normEv.includes(normModel)) return true;
    return false;
  });

  let status = 'MISSING';
  let reason = '';
  if (match) {
    status = 'EXISTS';
    reason = `(matched: ${match.id} - ${match.name})`;
  } else if (!price && (vId === 'VF8-ALL-NEW' || vId === 'VFWILD')) {
    status = 'UNCERTAIN';
    reason = `(Unverified specs/pricing: ${c.W})`;
  }

  console.log(`[${vId}] ${brand} ${model} | Version: ${version} | Giá: ${price} -> ${status} ${reason}`);
}
