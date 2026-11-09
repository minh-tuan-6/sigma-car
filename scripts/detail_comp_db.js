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

const dir2 = 'C:/Users/Tran Tuan/.gemini/antigravity-ide/brain/b4f1cba7-5248-4399-8797-fd0446d289c9/scratch/about_car/SIGMACAR_Vehicle_Component_Database';
const ss2 = getSharedStrings(dir2);
const rows2 = parseSheet(path.join(dir2, 'xl', 'worksheets', 'sheet1.xml'), ss2);

console.log('=== DETAILED COMPONENT DB VEHICLES ===');
rows2.slice(1).forEach((c, idx) => {
  console.log(`\n--- Vehicle #${idx + 1}: ${c.A} ---`);
  console.log(JSON.stringify(c, null, 2));
});
