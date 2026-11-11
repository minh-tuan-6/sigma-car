const fs = require('fs');
const path = require('path');
const gltfPipeline = require('gltf-pipeline');
const gltfToGlb = gltfPipeline.gltfToGlb;

const gltfTargets = [
  {
    name: 'Ferrari_F50_1995',
    src: 'Xe_unpacked/Ferrari_F50 1995/Ferrari_F50_1995/3Dmodel/extracted_ferrari_f50_1995/scene.gltf',
    dest: 'Xe_unpacked/Ferrari_F50 1995/Ferrari_F50_1995/3Dmodel/model.glb'
  },
  {
    name: 'Honda_Accord_Euro_R',
    src: 'Xe_unpacked/Honda_Accord-Euro-R/Honda_AccordEuroR/3Dmodel/extracted_honda_accord_euro-r_02/scene.gltf',
    dest: 'Xe_unpacked/Honda_Accord-Euro-R/Honda_AccordEuroR/3Dmodel/model.glb'
  },
  {
    name: 'Honda_Prelude_BP1',
    src: 'Xe_unpacked/Honda_Prelude BP1/Honda_Prelude BP1/3Dmodel/extracted_honda_prelude_bp1/scene.gltf',
    dest: 'Xe_unpacked/Honda_Prelude BP1/Honda_Prelude BP1/3Dmodel/model.glb'
  },
  {
    name: 'Lamborghini_Terzo_Millennio',
    src: 'Xe_unpacked/Lamborghini_Terzo-Millennio/Lamborghini_Terzo-Millennio/3Dmodel/extracted_asphalt_9_-_lamborghini_terzo_millennio_v2/scene.gltf',
    dest: 'Xe_unpacked/Lamborghini_Terzo-Millennio/Lamborghini_Terzo-Millennio/3Dmodel/model.glb'
  },
  {
    name: 'Toyota_Camry',
    src: 'Xe_unpacked/Toyota_Camry/Toyota_Camry/3Dmodel/extracted_toyota_camry_2020/scene.gltf',
    dest: 'Xe_unpacked/Toyota_Camry/Toyota_Camry/3Dmodel/model.glb'
  },
  {
    name: 'Vinfast_VF3',
    src: 'Xe_unpacked/Vinfast-VF3/Vinfast-VF3/3Dmodel/extracted_vinfast-vf3-plus-2026/source/extracted_UPLOAD/VF3 SKET.gltf',
    dest: 'Xe_unpacked/Vinfast-VF3/Vinfast-VF3/3Dmodel/model.glb'
  }
];

async function convertAll() {
  for (const item of gltfTargets) {
    const srcPath = path.resolve(item.src);
    const destPath = path.resolve(item.dest);
    if (!fs.existsSync(srcPath)) {
      console.warn('File not found:', srcPath);
      continue;
    }
    console.log(`Converting ${item.name} (${srcPath}) ...`);
    const gltf = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
    const options = {
      resourceDirectory: path.dirname(srcPath)
    };
    try {
      const results = await gltfToGlb(gltf, options);
      fs.writeFileSync(destPath, results.glb);
      console.log(`  -> SUCCESS! ${destPath} (${(results.glb.length / 1024 / 1024).toFixed(2)} MB)`);
    } catch (err) {
      console.error(`  -> ERROR on ${item.name}:`, err.message);
    }
  }
}

convertAll().catch(console.error);
