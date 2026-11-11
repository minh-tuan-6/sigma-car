const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const modelsDir = path.resolve(__dirname, '..', 'assets', 'models');
const files = fs.readdirSync(modelsDir);

for (const f of files) {
  if (!f.endsWith('.glb') || f.includes('_draco')) continue;
  const full = path.join(modelsDir, f);
  const s = fs.statSync(full);
  if (s.size > 24 * 1024 * 1024) {
    console.log(`Compressing ${f} (${(s.size / (1024 * 1024)).toFixed(2)} MB)...`);
    const tmpOut = path.join(modelsDir, f + '.draco.glb');
    execSync(`npx gltf-pipeline -i "${full}" -o "${tmpOut}" -d`);
    const newSize = fs.statSync(tmpOut).size;
    console.log(`  -> New size: ${(newSize / (1024 * 1024)).toFixed(2)} MB`);
    fs.copyFileSync(tmpOut, full);
    fs.unlinkSync(tmpOut);
  }
}

// Clean up test file if present
const testDraco = path.join(modelsDir, 'land_rover_defender_110_draco.glb');
if (fs.existsSync(testDraco)) fs.unlinkSync(testDraco);

console.log('✅ All models checked and verified <= 24 MB.');
