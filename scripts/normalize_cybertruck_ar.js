// scripts/normalize_cybertruck_ar.js
// Normalizes Cybertruck GLB for AR (1:1 physical scale, centered origin, ground contact, baked PBR materials)

const fs = require('fs');
const path = require('path');

const srcGlbPath = path.resolve(__dirname, '../assets/models/tesla_cybertruck.glb');
const outDir = path.resolve(__dirname, '../assets/models/ar');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const glbBuffer = fs.readFileSync(srcGlbPath);
const jsonChunkLength = glbBuffer.readUInt32LE(12);
const jsonDataRaw = JSON.parse(glbBuffer.slice(20, 20 + jsonChunkLength).toString('utf8'));
const binBuffer = glbBuffer.slice(20 + jsonChunkLength);

// Scale & Translation parameters (verified with Three.js Box3 calculations)
// Unscaled size: [1.151004, 1.087244, 3.276032]
// Target length: 5.682 m (Tesla official length)
const S = 5.682 / 3.2760320878430775; // ~1.73441525
const Tx = -S * 1.8467011301912755;
const Ty = -S * 0.17936941734034106;
const Tz = -S * 0.7456649327097011;

function buildNormalizedGlb(bodyColorRgba, metalness = 0.90, roughness = 0.35) {
  const jsonData = JSON.parse(JSON.stringify(jsonDataRaw));

  // 1. Add Cybertruck_AR_Root node
  const rootNodeIdx = jsonData.nodes.length;
  jsonData.nodes.push({
    name: 'Cybertruck_AR_Root',
    children: [0],
    translation: [Tx, Ty, Tz],
    scale: [S, S, S]
  });
  jsonData.scenes[0].nodes = [rootNodeIdx];

  // 2. Enhance PBR Materials
  // Material 0: Body Paint / Wrap
  jsonData.materials[0] = {
    name: 'Material_Body',
    doubleSided: true,
    pbrMetallicRoughness: {
      baseColorFactor: bodyColorRgba,
      metallicFactor: metalness,
      roughnessFactor: roughness
    }
  };

  // Material 1: Tinted Glass (Armor Glass)
  jsonData.materials[1] = {
    name: 'Material_Glass',
    doubleSided: true,
    alphaMode: 'BLEND',
    pbrMetallicRoughness: {
      baseColorFactor: [0.15, 0.20, 0.25, 0.75],
      metallicFactor: 0.1,
      roughnessFactor: 0.05
    }
  };

  // Material 2: Chrome / Trim Accent
  jsonData.materials[2] = {
    name: 'Material_Trim',
    doubleSided: true,
    pbrMetallicRoughness: {
      baseColorFactor: [0.40, 0.45, 0.50, 1.0],
      metallicFactor: 0.88,
      roughnessFactor: 0.25
    }
  };

  // Material 3: Underbody Chassis
  jsonData.materials[3] = {
    name: 'Material_Chassis',
    doubleSided: true,
    pbrMetallicRoughness: {
      baseColorFactor: [0.08, 0.08, 0.09, 1.0],
      metallicFactor: 0.20,
      roughnessFactor: 0.80
    }
  };

  // Material 4: LED Headlights
  jsonData.materials[4] = {
    name: 'Material_LED_Front',
    doubleSided: true,
    emissiveFactor: [0.85, 0.95, 1.0],
    pbrMetallicRoughness: {
      baseColorFactor: [0.95, 0.98, 1.0, 1.0],
      metallicFactor: 0.1,
      roughnessFactor: 0.1
    }
  };

  // Material 5: LED Taillights
  jsonData.materials[5] = {
    name: 'Material_LED_Rear',
    doubleSided: true,
    emissiveFactor: [1.0, 0.02, 0.02],
    pbrMetallicRoughness: {
      baseColorFactor: [0.90, 0.05, 0.05, 1.0],
      metallicFactor: 0.1,
      roughnessFactor: 0.2
    }
  };

  // Material 6: Sport Rims
  jsonData.materials[6] = {
    name: 'Material_Rims',
    doubleSided: true,
    pbrMetallicRoughness: {
      baseColorFactor: [0.80, 0.82, 0.85, 1.0],
      metallicFactor: 0.92,
      roughnessFactor: 0.22
    }
  };

  // Material 7: Rubber Tires
  jsonData.materials[7] = {
    name: 'Material_Tires',
    doubleSided: true,
    pbrMetallicRoughness: {
      baseColorFactor: [0.10, 0.10, 0.11, 1.0],
      metallicFactor: 0.05,
      roughnessFactor: 0.88
    }
  };

  // 3. Serialize to GLB Binary
  const jsonStr = JSON.stringify(jsonData);
  const paddedJsonLength = Math.ceil(Buffer.byteLength(jsonStr) / 4) * 4;
  const jsonBuf = Buffer.alloc(paddedJsonLength, 0x20);
  jsonBuf.write(jsonStr, 0, 'utf8');

  const totalLen = 12 + 8 + paddedJsonLength + binBuffer.length;
  const out = Buffer.alloc(totalLen);
  out.writeUInt32LE(0x46546C67, 0); // 'glTF'
  out.writeUInt32LE(2, 4); // v2
  out.writeUInt32LE(totalLen, 8);
  out.writeUInt32LE(paddedJsonLength, 12);
  out.writeUInt32LE(0x4E4F534A, 16); // 'JSON'
  jsonBuf.copy(out, 20);
  binBuffer.copy(out, 20 + paddedJsonLength);

  return out;
}

// 4 Color Variants according to SIGMA_DATA colors
const variants = [
  {
    file: 'tesla_cybertruck_ar_v1.glb',
    name: 'Stainless Steel 30X (Default)',
    color: [0.58, 0.62, 0.67, 1.0], // #94A3B8
    metalness: 0.90,
    roughness: 0.35
  },
  {
    file: 'tesla_cybertruck_ar_stealth_black.glb',
    name: 'Satin Stealth Black',
    color: [0.12, 0.16, 0.23, 1.0], // #1E293B
    metalness: 0.85,
    roughness: 0.42
  },
  {
    file: 'tesla_cybertruck_ar_ceramic_white.glb',
    name: 'Satin Ceramic White',
    color: [0.94, 0.96, 0.98, 1.0], // #F1F5F9
    metalness: 0.80,
    roughness: 0.38
  },
  {
    file: 'tesla_cybertruck_ar_tactical_green.glb',
    name: 'Tactical Green Wrap',
    color: [0.25, 0.38, 0.07, 1.0], // #3F6212
    metalness: 0.80,
    roughness: 0.40
  }
];

console.log('🚗 Generating calibrated AR GLB models for Cybertruck...');
variants.forEach(v => {
  const buf = buildNormalizedGlb(v.color, v.metalness, v.roughness);
  const targetPath = path.join(outDir, v.file);
  fs.writeFileSync(targetPath, buf);
  console.log(`  ✓ Created: ${v.file} (${(buf.length / 1024).toFixed(1)} KB) - ${v.name}`);
});

console.log('✅ All AR GLB models generated successfully in assets/models/ar/');
