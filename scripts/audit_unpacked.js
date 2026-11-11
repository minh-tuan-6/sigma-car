const fs = require('fs');
const path = require('path');

const root = path.resolve('Xe_unpacked');
const dirs = fs.readdirSync(root).filter(d => fs.statSync(path.join(root, d)).isDirectory());

function walk(dir) {
  let results = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const full = path.join(dir, file);
      if (file === '__MACOSX') continue;
      const stat = fs.statSync(full);
      if (stat && stat.isDirectory()) {
        results = results.concat(walk(full));
      } else {
        results.push(full);
      }
    }
  } catch (e) {}
  return results;
}

const summary = [];

dirs.forEach(d => {
  const allFiles = walk(path.join(root, d));
  const glbFiles = allFiles.filter(f => /\.glb$/i.test(f) && !f.includes('__MACOSX'));
  const gltfFiles = allFiles.filter(f => /\.gltf$/i.test(f) && !f.includes('__MACOSX'));
  const fbxFiles = allFiles.filter(f => /\.fbx$/i.test(f) && !f.includes('__MACOSX'));
  const objFiles = allFiles.filter(f => /\.obj$/i.test(f) && !f.includes('__MACOSX'));
  const imgFiles = allFiles.filter(f => /\.(jpe?g|png|webp|avif)$/i.test(f) && !f.includes('__MACOSX') && !f.includes('textures'));
  const dataTxt = allFiles.filter(f => /data\.txt$/i.test(path.basename(f)) && !f.includes('__MACOSX'));

  summary.push({
    folder: d,
    glbCount: glbFiles.length,
    glbs: glbFiles.map(f => path.basename(f) + ` (${(fs.statSync(f).size / 1024 / 1024).toFixed(2)}MB)`),
    gltfCount: gltfFiles.length,
    gltfs: gltfFiles.map(f => path.basename(f)),
    fbxCount: fbxFiles.length,
    fbxs: fbxFiles.map(f => path.basename(f) + ` (${(fs.statSync(f).size / 1024 / 1024).toFixed(2)}MB)`),
    objCount: objFiles.length,
    objs: objFiles.map(f => path.basename(f)),
    images: imgFiles.length,
    hasDataTxt: dataTxt.length > 0 ? (fs.statSync(dataTxt[0]).size + ' bytes') : 'NO'
  });
});

console.log(JSON.stringify(summary, null, 2));
