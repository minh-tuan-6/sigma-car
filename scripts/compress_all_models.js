const fs = require('fs');
const path = require('path');
const { processGlb } = require('gltf-pipeline');

const modelsDir = path.resolve(__dirname, '..', 'assets', 'models');
const files = fs.readdirSync(modelsDir);

async function main() {
  let totalSaved = 0;
  let totalOriginal = 0;

  for (const f of files) {
    if (!f.endsWith('.glb')) continue;
    const full = path.join(modelsDir, f);
    const buf = fs.readFileSync(full);
    const s = buf.length;
    totalOriginal += s;

    // Check if already Draco compressed
    if (buf.includes('KHR_draco_mesh_compression')) {
      console.log(`⏩ ${f} already has Draco compression (${(s / (1024 * 1024)).toFixed(2)} MB). Skipping.`);
      continue;
    }

    if (s > 4 * 1024 * 1024) {
      console.log(`🔨 Compressing ${f} (${(s / (1024 * 1024)).toFixed(2)} MB)...`);
      try {
        const start = Date.now();
        const results = await processGlb(buf, {
          dracoOptions: {
            compressionLevel: 7
          }
        });
        const newSize = results.glb.length;
        const saved = s - newSize;
        totalSaved += saved;
        fs.writeFileSync(full, results.glb);
        const elapsed = ((Date.now() - start) / 1000).toFixed(2);
        console.log(`   ✅ New size: ${(newSize / (1024 * 1024)).toFixed(2)} MB (-${((saved / s) * 100).toFixed(1)}%) in ${elapsed}s`);
      } catch (err) {
        console.error(`   ❌ Failed to compress ${f}:`, err);
      }
    }
  }

  console.log(`\n🎉 Optimization finished! Total saved: ${(totalSaved / (1024 * 1024)).toFixed(2)} MB`);
}

main().catch(console.error);
