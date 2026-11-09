const fs = require('fs');
const path = require('path');

const files = fs.readdirSync('assets/images').filter(f => f.endsWith('.jpg'));

function getDim(buf) {
  let i = 2;
  while (i < buf.length - 8) {
    if (buf[i] === 0xFF && (buf[i+1] === 0xC0 || buf[i+1] === 0xC2)) {
      return { height: buf.readUInt16BE(i+5), width: buf.readUInt16BE(i+7) };
    }
    if (buf[i] === 0xFF && buf[i+1] > 0xB0 && buf[i+1] <= 0xFE) {
      i += 2 + buf.readUInt16BE(i+2);
    } else i++;
  }
  return null;
}

let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>SIGMACAR Image Catalog</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 24px; margin: 0; }
  h1 { font-size: 24px; margin-bottom: 20px; }
  .section { margin-bottom: 32px; background: #1e293b; padding: 16px; border-radius: 12px; }
  .section-title { font-size: 18px; font-weight: bold; margin-bottom: 12px; color: #38bdf8; border-bottom: 1px solid #334155; padding-bottom: 8px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; }
  .card { background: #0f172a; border-radius: 8px; padding: 8px; border: 1px solid #334155; text-align: center; }
  img { width: 100%; height: 130px; object-fit: contain; background: #020617; border-radius: 6px; }
  .meta { font-size: 11px; color: #94a3b8; margin-top: 6px; word-break: break-all; }
  .meta strong { color: #f1f5f9; display: block; margin-bottom: 2px; }
</style>
</head>
<body>
<h1>SIGMACAR Image Inventory (${files.length} Assets)</h1>
`;

// Group by source PDF prefix
const groups = {};
files.forEach(f => {
  const prefix = f.replace(/_\d+\.jpg$/, '');
  if (!groups[prefix]) groups[prefix] = [];
  groups[prefix].push(f);
});

for (const [groupName, groupFiles] of Object.entries(groups)) {
  html += `<div class="section"><div class="section-title">${groupName} (${groupFiles.length} files)</div><div class="grid">`;
  groupFiles.forEach(f => {
    const buf = fs.readFileSync(path.join('assets/images', f));
    const dim = getDim(buf) || { width: '?', height: '?' };
    const kb = Math.round(buf.length / 1024);
    html += `
      <div class="card">
        <img src="/assets/images/${f}" loading="lazy">
        <div class="meta">
          <strong>${f}</strong>
          ${dim.width}x${dim.height} • ${kb} KB
        </div>
      </div>
    `;
  });
  html += `</div></div>`;
}

html += `</body></html>`;
fs.writeFileSync('scratch_catalog.html', html);
console.log('Successfully generated scratch_catalog.html');
