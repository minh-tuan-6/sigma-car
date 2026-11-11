const fs = require('fs');
const path = require('path');

const root = path.resolve('Xe_unpacked');
const dirs = fs.readdirSync(root).filter(d => fs.statSync(path.join(root, d)).isDirectory());

function walk(dir) {
  let results = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      if (file === '__MACOSX') continue;
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      if (stat && stat.isDirectory()) results = results.concat(walk(full));
      else results.push(full);
    }
  } catch (e) {}
  return results;
}

const list = [];

dirs.forEach(d => {
  const allFiles = walk(path.join(root, d));
  const dataTxt = allFiles.find(f => /data\.txt$/i.test(path.basename(f)));
  const content = dataTxt ? fs.readFileSync(dataTxt, 'utf8') : '';
  const glb = allFiles.find(f => /\.glb$/i.test(f) && !f.includes('__MACOSX'));
  const imgs = allFiles.filter(f => /\.(jpe?g|png|webp|avif)$/i.test(f) && !f.includes('__MACOSX') && !f.includes('textures') && !f.includes('internal_ground_ao'));

  list.push({
    folder: d,
    hasGlb: !!glb,
    glbPath: glb ? path.relative(root, glb) : null,
    imgCount: imgs.length,
    sampleImgs: imgs.map(i => path.basename(i)),
    textLength: content.length,
    textPreview: content.slice(0, 300).replace(/\r?\n/g, ' ')
  });
});

console.log(JSON.stringify(list, null, 2));
