const fs = require('fs');
const path = require('path');

const imgDir = path.join(__dirname, 'assets', 'images');
const files = fs.readdirSync(imgDir);

function getJpegDimensions(buffer) {
  let i = 2;
  while (i < buffer.length - 8) {
    if (buffer[i] === 0xFF && (buffer[i+1] === 0xC0 || buffer[i+1] === 0xC2)) {
      return {
        height: buffer.readUInt16BE(i + 5),
        width: buffer.readUInt16BE(i + 7)
      };
    }
    if (buffer[i] === 0xFF && buffer[i+1] > 0xB0 && buffer[i+1] <= 0xFE) {
      const len = buffer.readUInt16BE(i + 2);
      i += 2 + len;
    } else {
      i++;
    }
  }
  return null;
}

const classified = [];
for (const f of files) {
  try {
    const buf = fs.readFileSync(path.join(imgDir, f));
    const dim = getJpegDimensions(buf);
    if (dim) {
      classified.push({ file: f, width: dim.width, height: dim.height, size: buf.length });
    }
  } catch (e) {}
}

classified.sort((a, b) => b.size - a.size);

console.log('Classified images count:', classified.length);

// Identify key images:
// 1. Largest landscape banner / hero:
const heroCandidates = classified.filter(x => x.width >= 1200);
console.log('Hero candidates (>=1200w):');
heroCandidates.forEach(c => console.log(' ', c.file, `${c.width}x${c.height}`, (c.size/1024).toFixed(0) + 'KB'));

// 2. Car images (width between 400 and 1200, aspect > 1.2)
const carCandidates = classified.filter(x => x.width >= 400 && x.width < 1200 && x.width > x.height * 1.3);
console.log('Car candidates (top 15):');
carCandidates.slice(0, 15).forEach(c => console.log(' ', c.file, `${c.width}x${c.height}`, (c.size/1024).toFixed(0) + 'KB'));

// Let's create symlinks or direct copies with friendly names:
const assetsDir = path.join(__dirname, 'assets');
function copyFriendly(srcFile, targetName) {
  const src = path.join(imgDir, srcFile);
  const dest = path.join(assetsDir, targetName);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied ${srcFile} -> assets/${targetName}`);
  }
}

// Map key items:
// Find Hero banner:
const hero = heroCandidates.find(c => c.file.includes('Home') || c.file.includes('Vehicle') || c.file.includes('D_ng')) || heroCandidates[0];
if (hero) copyFriendly(hero.file, 'hero-bg.jpg');

// Find Model E:
const modelE = carCandidates.find(c => c.file.includes('Home_Page') && c.size > 50000) || carCandidates[0];
if (modelE) copyFriendly(modelE.file, 'model-e.jpg');

// Find Vision S / Sedan:
const visionS = carCandidates.find(c => c.file.includes('D_ng_xe') || c.file.includes('So_s_nh')) || carCandidates[1];
if (visionS) copyFriendly(visionS.file, 'vision-s.jpg');

// Find City G / Compact:
const cityG = carCandidates.find(c => c.file.includes('Xe_qua_s') || c.file.includes('Order')) || carCandidates[2];
if (cityG) copyFriendly(cityG.file, 'city-g.jpg');

// Find X-Series GT / Hypercar:
const xSeries = carCandidates.find(c => c.file.includes('Vehicle_Detail') || c.file.includes('So_s_nh')) || carCandidates[3];
if (xSeries) copyFriendly(xSeries.file, 'x-series.jpg');

// Find detail car / front view:
const detailCar = classified.find(c => c.file.includes('Vehicle_Detail_Page_19') || c.file.includes('Vehicle_Detail')) || carCandidates[4];
if (detailCar) copyFriendly(detailCar.file, 'detail-car.jpg');

// Find Avatars:
const avatars = classified.filter(c => c.width >= 50 && c.width <= 250 && Math.abs(c.width - c.height) < 20);
if (avatars[0]) copyFriendly(avatars[0].file, 'avatar-user.jpg');
if (avatars[1]) copyFriendly(avatars[1].file, 'avatar-sales.jpg');
if (avatars[2]) copyFriendly(avatars[2].file, 'avatar-ai.jpg');
