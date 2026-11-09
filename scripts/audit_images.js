const fs = require('fs');
const path = require('path');
const http = require('http');

console.log('=== RUNNING SIGMACAR IMAGE ASSET AUDIT ===');

const scanFiles = ['index.html', 'css/style.css', 'js/data.js', 'js/app.js', 'data/sigmacar_store.json'];
const imageRefs = new Set();

const regexes = [
  /src=[\"']([^\"']+\.(?:jpg|jpeg|png|webp|svg|avif|gif))[\"']/gi,
  /url\([\"']?([^\"')]+\.(?:jpg|jpeg|png|webp|svg|avif|gif))[\"']?\)/gi,
  /\"image\":\s*\"([^\"]+)\"/gi,
  /\"img\":\s*\"([^\"]+)\"/gi,
  /'(assets\/[^']+?\.(?:jpg|jpeg|png|webp|svg|avif|gif))'/gi
];

scanFiles.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  regexes.forEach(rx => {
    let match;
    while ((match = rx.exec(content)) !== null) {
      let ref = match[1].trim();
      if (!ref.startsWith('http') && !ref.startsWith('data:')) {
        if (ref.startsWith('/')) ref = ref.substring(1);
        imageRefs.add(ref);
      }
    }
  });
});

console.log('Found total unique local image references:', imageRefs.size);
const missing = [];
const existing = [];

imageRefs.forEach(ref => {
  const diskPath = path.join(__dirname, '..', ref);
  if (fs.existsSync(diskPath)) {
    existing.push(ref);
  } else {
    missing.push(ref);
  }
});

console.log('Existing on disk:', existing.length);
if (missing.length > 0) {
  console.log('MISSING ON DISK (' + missing.length + '):', missing);
} else {
  console.log('PERFECT: All ' + existing.length + ' referenced images exist on disk!');
}

// Check HTTP status code for every asset
const refList = Array.from(imageRefs);
let errors = [];
let checked = 0;

function checkUrl(i) {
  if (i >= refList.length) {
    console.log('=== HTTP SERVER STATUS VERIFICATION ===');
    console.log('Tested total assets via HTTP: ' + checked);
    if (errors.length > 0) {
      console.log('Errors:', errors);
    } else {
      console.log('ALL ' + checked + ' ASSETS RETURNED HTTP 200 OK FROM SERVER!');
    }
    process.exit(0);
    return;
  }

  const asset = refList[i];
  const req = http.get('http://localhost:3000/' + asset, (res) => {
    checked++;
    if (res.statusCode !== 200) {
      errors.push({ asset, status: res.statusCode });
    }
    checkUrl(i + 1);
  });
  req.on('error', (err) => {
    errors.push({ asset, error: err.message });
    checkUrl(i + 1);
  });
}

checkUrl(0);
