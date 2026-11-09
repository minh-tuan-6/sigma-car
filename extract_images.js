const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, 'assets', 'images');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const pdfDir = path.join(__dirname, 'Dự án thương mại điện tử');
const files = fs.readdirSync(pdfDir).filter(f => f.endsWith('.pdf'));

let totalExtracted = 0;

for (const file of files) {
  const filePath = path.join(pdfDir, file);
  const buf = fs.readFileSync(filePath);
  const baseName = file
    .replace(/\.pdf$/i, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 30);

  let i = 0;
  let imgIdx = 0;
  while (i < buf.length - 3) {
    // Check for JPEG SOI marker: FF D8 FF
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      let end = i + 3;
      while (end < buf.length - 1) {
        if (buf[end] === 0xff && buf[end + 1] === 0xd9) {
          end += 2;
          break;
        }
        end++;
      }
      const len = end - i;
      if (len > 3000) {
        // Only keep meaningful images (> 3KB)
        const imgData = buf.subarray(i, end);
        const outName = `${baseName}_${imgIdx}.jpg`;
        fs.writeFileSync(path.join(outDir, outName), imgData);
        imgIdx++;
        totalExtracted++;
      }
      i = end;
    } else {
      i++;
    }
  }
}

console.log(`Successfully extracted ${totalExtracted} images to ${outDir}`);
