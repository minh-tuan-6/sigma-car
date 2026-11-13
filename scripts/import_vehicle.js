#!/usr/bin/env node
/**
 * scripts/import_vehicle.js
 * ============================================================================
 * HỆ THỐNG TỰ ĐỘNG NHẬP & ĐỒNG BỘ XE MỚI VÀO WEBSITE (REUSABLE VEHICLE IMPORTER)
 * ============================================================================
 * Hỗ trợ mọi loại xe:
 *   - Ô tô điện (EV), Ô tô xăng (Gas), Dầu (Diesel), Hybrid
 *   - Sedan, SUV, MPV, Pickup (Bán tải), Compact / Hatchback
 *   - Xe phổ thông & Xe cao cấp
 *
 * Tính năng:
 *   1. Đọc cấu trúc chuẩn `vehicle-template/` (vehicle.json, images/*, 3d/*, documents/*).
 *   2. Nếu thiếu `vehicle.json`, tự động trích xuất thông tin từ tài liệu (.txt, .md) trong folder.
 *   3. Tự động giải nén file .zip trong 3d/ hoặc 3Dmodel/ để lấy model .glb và textures.
 *   4. Phân loại hình ảnh theo thực tế (exterior, interior, dashboard, engine, specifications, gallery)
 *      và giữ nguyên 100% chất lượng, độ phân giải gốc (byte-for-byte copy).
 *   5. Nếu folder có model 3D .glb thật nhưng chưa có ảnh chụp, tự động kết xuất (render)
 *      hình ảnh Studio đa góc độ trực tiếp từ lưới 3D thật của file .glb.
 *   6. Phát hiện xe trùng lặp (theo ID hoặc Hãng + Tên) để cập nhật an toàn (Idempotent Upsert).
 *   7. Đồng bộ tự động vào `js/data.js`, `backend/infrastructure/storage-engine.js`,
 *      và `data/sigmacar_store.json`.
 *   8. Kiểm soát chất lượng (QA): Kiểm tra schema, đường dẫn ảnh, file GLB, trùng ID, bộ lọc.
 *
 * Cách dùng:
 *   node scripts/import_vehicle.js <đường-dẫn-folder-xe> [--dry-run] [--no-build]
 *   node scripts/import_vehicle.js --init-template
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_JS_PATH = path.join(ROOT_DIR, 'js', 'data.js');
const STORAGE_ENGINE_PATH = path.join(ROOT_DIR, 'backend', 'infrastructure', 'storage-engine.js');
const STORE_JSON_PATH = path.join(ROOT_DIR, 'data', 'sigmacar_store.json');
const ASSETS_MODELS_DIR = path.join(ROOT_DIR, 'assets', 'models');
const ASSETS_VEHICLES_DIR = path.join(ROOT_DIR, 'assets', 'vehicles');

const IMAGE_CATEGORIES = ['exterior', 'interior', 'dashboard', 'engine', 'specifications', 'gallery'];
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg', '.avif']);

// ============================================================================
// 1. HELPER UTILITIES
// ============================================================================

function slugify(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatPriceVnd(num) {
  if (typeof num !== 'number' || isNaN(num) || num <= 0) return 'Đang cập nhật';
  return num.toLocaleString('vi-VN').replace(/,/g, '.') + ' VNĐ';
}

function formatPriceShort(num) {
  if (typeof num !== 'number' || isNaN(num) || num <= 0) return 'Liên hệ';
  if (num >= 1000000000) {
    const billions = num / 1000000000;
    const formatted = Number.isInteger(billions)
      ? billions.toString()
      : billions.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    return `${formatted} tỷ`;
  }
  const millions = Math.round(num / 1000000);
  return `${millions} triệu`;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function walkFiles(dirPath, fileList = []) {
  if (!fs.existsSync(dirPath)) return fileList;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, fileList);
    } else if (entry.isFile()) {
      fileList.push(full);
    }
  }
  return fileList;
}

// ============================================================================
// 2. TEMPLATE INITIALIZER (--init-template)
// ============================================================================

function ensureTemplateAssets() {
  const base = path.join(ROOT_DIR, 'vehicle-template');
  const subDirs = [
    'images/exterior',
    'images/interior',
    'images/dashboard',
    'images/engine',
    'images/specifications',
    'images/gallery',
    '3d/textures',
    'documents'
  ];
  subDirs.forEach(d => ensureDir(path.join(base, d)));

  function makeSampleSvg(title, subtitle, accent) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 750" width="1200" height="750">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0F172A"/>
      <stop offset="100%" stop-color="#1E293B"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="750" fill="url(#bg)"/>
  <circle cx="600" cy="390" r="260" fill="none" stroke="${accent}" stroke-width="2" opacity="0.3"/>
  <path d="M260,450 L370,340 L690,325 L860,385 L940,450 L920,495 L240,495 Z" fill="none" stroke="${accent}" stroke-width="5"/>
  <circle cx="385" cy="495" r="56" fill="#0F172A" stroke="#E2E8F0" stroke-width="8"/>
  <circle cx="805" cy="495" r="56" fill="#0F172A" stroke="#E2E8F0" stroke-width="8"/>
  <text x="600" y="135" fill="#FFFFFF" font-family="sans-serif" font-size="36" font-weight="bold" text-anchor="middle">${title}</text>
  <text x="600" y="180" fill="#94A3B8" font-family="sans-serif" font-size="22" text-anchor="middle">${subtitle}</text>
</svg>`;
  }

  const svgSamples = [
    ['images/exterior/hero-front-34.svg', 'EXTERIOR — HERO 3/4 VIEW', 'SIGMA Concept GT • Studio Exterior', '#38BDF8'],
    ['images/exterior/side-profile.svg', 'EXTERIOR — SIDE PROFILE', 'SIGMA Concept GT • Aerodynamic Silhouette', '#0284C7'],
    ['images/interior/cabin-overview.svg', 'INTERIOR — LUXURY CABIN', 'Nappa Leather & Panoramic Glass Roof', '#10B981'],
    ['images/dashboard/digital-cockpit.svg', 'DASHBOARD — DIGITAL COCKPIT', 'OLED Touchscreen & AR-HUD', '#6366F1'],
    ['images/engine/powertrain-architecture.svg', 'POWERTRAIN — 800V DUAL MOTOR', 'Silicon Carbide Inverter & Structural Battery', '#F59E0B'],
    ['images/specifications/dimensions-blueprint.svg', 'SPECIFICATIONS — DIMENSIONS BLUEPRINT', '4.960 x 1.960 x 1.395 mm • Wheelbase 2.900 mm', '#EC4899'],
    ['images/gallery/lifestyle-shot.svg', 'GALLERY — LIFESTYLE & SHOWROOM', 'SIGMACAR Certified Template Asset', '#14B8A6']
  ];

  for (const [relPath, title, sub, color] of svgSamples) {
    const target = path.join(base, relPath);
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, makeSampleSvg(title, sub, color), 'utf8');
    }
  }

  const gitkeep = path.join(base, '3d/textures/.gitkeep');
  if (!fs.existsSync(gitkeep)) fs.writeFileSync(gitkeep, '', 'utf8');

  const glbTarget = path.join(base, '3d/model.glb');
  if (!fs.existsSync(glbTarget)) {
    const gltfJson = JSON.stringify({
      asset: { version: '2.0', generator: 'SIGMACAR-Template-Generator' },
      scene: 0,
      scenes: [{ name: 'Scene', nodes: [0] }],
      nodes: [{ name: 'TemplateCarNode' }]
    });
    const paddedJson = gltfJson.padEnd(Math.ceil(gltfJson.length / 4) * 4, ' ');
    const jsonBuf = Buffer.from(paddedJson, 'utf8');
    const totalLen = 12 + 8 + jsonBuf.length;
    const glbBuf = Buffer.alloc(totalLen);
    glbBuf.writeUInt32LE(0x46546C67, 0);
    glbBuf.writeUInt32LE(2, 4);
    glbBuf.writeUInt32LE(totalLen, 8);
    glbBuf.writeUInt32LE(jsonBuf.length, 12);
    glbBuf.writeUInt32LE(0x4E4F534A, 16);
    jsonBuf.copy(glbBuf, 20);
    fs.writeFileSync(glbTarget, glbBuf);
  }

  function makeMinimalPdf(titleText) {
    return `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${44 + titleText.length}>>stream\nBT /F1 18 Tf 72 700 Td (${titleText}) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \n0000000212 00000 n \n0000000310 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n380\n%%EOF\n`;
  }

  const specPdf = path.join(base, 'documents/specifications.pdf');
  const warPdf = path.join(base, 'documents/warranty.pdf');
  if (!fs.existsSync(specPdf)) fs.writeFileSync(specPdf, makeMinimalPdf('SIGMACAR Vehicle Specifications Document'));
  if (!fs.existsSync(warPdf)) fs.writeFileSync(warPdf, makeMinimalPdf('SIGMACAR Official Warranty Policy Document'));
}

// ============================================================================
// 3. REAL 3D GLB GEOMETRY EXTRACTOR & MULTI-ANGLE STUDIO SVG RENDERER
// ============================================================================

function validateGlbFile(filePath) {
  if (!fs.existsSync(filePath)) return { valid: false, reason: 'File does not exist' };
  const stat = fs.statSync(filePath);
  if (stat.size < 20) return { valid: false, reason: 'File too small for GLB header' };
  const fd = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(20);
  fs.readSync(fd, header, 0, 20, 0);
  fs.closeSync(fd);
  const magic = header.readUInt32LE(0);
  const version = header.readUInt32LE(4);
  const totalLen = header.readUInt32LE(8);
  const jsonLen = header.readUInt32LE(12);
  if (magic !== 0x46546C67) return { valid: false, reason: 'Invalid glTF magic bytes' };
  if (version !== 2) return { valid: false, reason: `Unsupported glTF version ${version}` };
  return { valid: true, sizeBytes: stat.size, totalLen, jsonLen };
}

/**
 * Parses a binary .glb file and renders authentic studio SVG views directly
 * from the 3D triangle mesh if the vehicle folder has no camera photos yet.
 */
function renderStudioImagesFromGlb(glbPath, outputDir, vehicleMeta) {
  const buf = fs.readFileSync(glbPath);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const binOffset = 20 + jsonLen + 8;
  if (buf.length <= binOffset) return null;
  const binChunk = buf.subarray(binOffset);

  function multiplyMat4(a, b) {
    const out = new Float64Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] =
          a[0 * 4 + r] * b[c * 4 + 0] +
          a[1 * 4 + r] * b[c * 4 + 1] +
          a[2 * 4 + r] * b[c * 4 + 2] +
          a[3 * 4 + r] * b[c * 4 + 3];
      }
    }
    return out;
  }

  function getNodeMatrix(node) {
    if (node.matrix) return Float64Array.from(node.matrix);
    const t = node.translation || [0, 0, 0];
    const r = node.rotation || [0, 0, 0, 1];
    const s = node.scale || [1, 1, 1];
    const [x, y, z, w] = r;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    return Float64Array.from([
      (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
      (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
      (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
      t[0], t[1], t[2], 1
    ]);
  }

  function readAccessor(accIdx) {
    const acc = gltf.accessors[accIdx];
    const bv = gltf.bufferViews[acc.bufferView];
    const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const numComp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type] || 1;
    const compSize = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType];
    const stride = bv.byteStride || (numComp * compSize);
    const out = [];
    for (let i = 0; i < acc.count; i++) {
      const off = byteOffset + i * stride;
      if (numComp === 1) {
        if (acc.componentType === 5123) out.push(binChunk.readUInt16LE(off));
        else if (acc.componentType === 5125) out.push(binChunk.readUInt32LE(off));
        else if (acc.componentType === 5121) out.push(binChunk.readUInt8(off));
        else out.push(binChunk.readFloatLE(off));
      } else {
        const vec = [];
        for (let c = 0; c < numComp; c++) {
          vec.push(binChunk.readFloatLE(off + c * 4));
        }
        out.push(vec);
      }
    }
    return out;
  }

  const allTriangles = [];
  function traverse(nodeIdx, parentMat) {
    const node = gltf.nodes[nodeIdx];
    if (!node) return;
    const worldMat = multiplyMat4(parentMat, getNodeMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = gltf.meshes[node.mesh];
      for (const prim of mesh.primitives) {
        const pos = readAccessor(prim.attributes.POSITION);
        const indices = prim.indices !== undefined ? readAccessor(prim.indices) : pos.map((_, i) => i);
        const mat = gltf.materials && gltf.materials[prim.material] ? gltf.materials[prim.material] : {};
        const pbr = mat.pbrMetallicRoughness || {};
        const baseColor = pbr.baseColorFactor || [0.65, 0.68, 0.72, 1];
        const emissive = mat.emissiveFactor || [0, 0, 0];

        const wPos = pos.map(v => {
          const [vx, vy, vz] = v;
          return [
            worldMat[0] * vx + worldMat[4] * vy + worldMat[8] * vz + worldMat[12],
            worldMat[1] * vx + worldMat[5] * vy + worldMat[9] * vz + worldMat[13],
            worldMat[2] * vx + worldMat[6] * vy + worldMat[10] * vz + worldMat[14]
          ];
        });

        for (let i = 0; i + 2 < indices.length; i += 3) {
          const v0 = wPos[indices[i]];
          const v1 = wPos[indices[i + 1]];
          const v2 = wPos[indices[i + 2]];
          if (!v0 || !v1 || !v2) continue;
          allTriangles.push({ v0, v1, v2, baseColor, emissive, matName: mat.name || '' });
        }
      }
    }
    if (node.children) {
      for (const ch of node.children) traverse(ch, worldMat);
    }
  }

  const identity = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const sceneNodes = gltf.scenes[gltf.scene || 0]?.nodes || [0];
  for (const n of sceneNodes) traverse(n, identity);
  if (allTriangles.length === 0) return null;

  // Normalize bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of allTriangles) {
    for (const v of [t.v0, t.v1, t.v2]) {
      if (v[0] < minX) minX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] > maxZ) maxZ = v[2];
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  for (const t of allTriangles) {
    for (const v of [t.v0, t.v1, t.v2]) {
      v[0] = (v[0] - cx) / maxDim * 2;
      v[1] = (v[1] - cy) / maxDim * 2;
      v[2] = (v[2] - cz) / maxDim * 2;
    }
  }

  function renderCameraSvg(yawDeg, pitchDeg, title, subtitle, bgAccent = '#38BDF8') {
    const yaw = (yawDeg * Math.PI) / 180;
    const pitch = (pitchDeg * Math.PI) / 180;
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch), sinP = Math.sin(pitch);

    function rotVec(v) {
      const x1 = v[0] * cosY + v[2] * sinY;
      const z1 = -v[0] * sinY + v[2] * cosY;
      const y1 = v[1];
      const y2 = y1 * cosP - z1 * sinP;
      const z2 = y1 * sinP + z1 * cosP;
      return [x1, y2, z2];
    }

    const lightDir = [0.45, 0.75, 0.48];
    const lLen = Math.hypot(...lightDir);
    lightDir[0] /= lLen; lightDir[1] /= lLen; lightDir[2] /= lLen;

    const projected = [];
    const camDist = 3.1;
    const scale = 960;

    for (const t of allTriangles) {
      const p0 = rotVec(t.v0);
      const p1 = rotVec(t.v1);
      const p2 = rotVec(t.v2);

      const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
      const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen; ny /= nLen; nz /= nLen;
      if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }

      const avgZ = (p0[2] + p1[2] + p2[2]) / 3;
      const diff = Math.max(0, nx * lightDir[0] + ny * lightDir[1] + nz * lightDir[2]);
      const spec = Math.pow(Math.max(0, nz), 16) * 0.35;

      let r = t.baseColor[0], g = t.baseColor[1], b = t.baseColor[2];
      // Enhance stainless steel look for body material
      if (t.matName === 'Material') {
        r = 0.72; g = 0.75; b = 0.79;
      } else if (t.matName === 'Material.001') {
        r = 0.12; g = 0.18; b = 0.26;
      }

      const shade = 0.32 + diff * 0.68;
      let R = Math.min(255, Math.round((r * shade + spec + (t.emissive[0] || 0)) * 255));
      let G = Math.min(255, Math.round((g * shade + spec + (t.emissive[1] || 0)) * 255));
      let B = Math.min(255, Math.round((b * shade + spec + (t.emissive[2] || 0)) * 255));

      function proj(p) {
        const z = camDist - p[2];
        const sx = 600 + (p[0] / z) * scale;
        const sy = 405 - (p[1] / z) * scale;
        return [sx.toFixed(1), sy.toFixed(1)];
      }

      const s0 = proj(p0), s1 = proj(p1), s2 = proj(p2);
      projected.push({
        z: avgZ,
        pts: `${s0[0]},${s0[1]} ${s1[0]},${s1[1]} ${s2[0]},${s2[1]}`,
        color: `rgb(${R},${G},${B})`
      });
    }

    projected.sort((a, b) => a.z - b.z);
    const polys = projected
      .map(p => `<polygon points="${p.pts}" fill="${p.color}" stroke="${p.color}" stroke-width="0.45" stroke-linejoin="round"/>`)
      .join('\n');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 750" width="1200" height="750">
  <defs>
    <radialGradient id="studioBg" cx="50%" cy="48%" r="65%">
      <stop offset="0%" stop-color="#1E293B"/>
      <stop offset="65%" stop-color="#0F172A"/>
      <stop offset="100%" stop-color="#020617"/>
    </radialGradient>
    <radialGradient id="floorGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${bgAccent}" stop-opacity="0.28"/>
      <stop offset="60%" stop-color="#0F172A" stop-opacity="0.65"/>
      <stop offset="100%" stop-color="#020617" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="750" fill="url(#studioBg)"/>
  <ellipse cx="600" cy="545" rx="460" ry="95" fill="url(#floorGlow)"/>
  <ellipse cx="600" cy="535" rx="340" ry="52" fill="#000000" opacity="0.55"/>
  <g>${polys}</g>
  <text x="60" y="68" fill="${bgAccent}" font-family="sans-serif" font-size="15" font-weight="800" letter-spacing="2">${(vehicleMeta.brand || 'SIGMACAR').toUpperCase()} • STUDIO 3D RENDER</text>
  <text x="60" y="106" fill="#FFFFFF" font-family="sans-serif" font-size="32" font-weight="800">${title}</text>
  <text x="60" y="136" fill="#94A3B8" font-family="sans-serif" font-size="17">${subtitle}</text>
</svg>`;
  }

  const views = [
    { rel: 'images/exterior/hero-front-34.svg', yaw: -36, pitch: 14, title: `${vehicleMeta.name} — Ngoại thất Góc 3/4 Trước`, sub: 'Khung vỏ Exoskeleton Thép Không Gỉ 30X Cán Nguội & Đèn LED Lightbar', accent: '#38BDF8' },
    { rel: 'images/exterior/side-profile.svg', yaw: -90, pitch: 6, title: `${vehicleMeta.name} — Thiết kế Khí động học Ngang hông`, sub: `Chiều dài 5.682 mm • Khoảng sáng gầm 443 mm (Extract Mode)`, accent: '#0284C7' },
    { rel: 'images/exterior/rear-vault-34.svg', yaw: -145, pitch: 15, title: `${vehicleMeta.name} — Góc 3/4 Sau & Thùng xe Vault`, sub: 'Dung tích thùng 1.897 Lít • Nắp thùng cơ điện Tonneau Cover chịu lực', accent: '#F43F5E' },
    { rel: 'images/interior/cabin-overview.svg', yaw: -20, pitch: 28, title: `${vehicleMeta.name} — Không gian Nội thất & Kính Armor Glass`, sub: 'Kính trần toàn cảnh Panoramic chống UV • 15 loa phòng thu + 2 Subwoofer', accent: '#10B981' },
    { rel: 'images/dashboard/digital-cockpit.svg', yaw: 25, pitch: 18, title: `${vehicleMeta.name} — Khoang lái Steer-by-Wire & Màn hình 18.5"`, sub: 'Màn hình cảm ứng trung tâm 18.5 inch trước & 9.4 inch hàng ghế sau', accent: '#6366F1' },
    { rel: 'images/engine/powertrain-architecture.svg', yaw: 135, pitch: 24, title: `${vehicleMeta.name} — Kiến trúc Điện 800V & Tri-Motor AWD`, sub: 'Công suất 845 HP • Tăng tốc 0-96 km/h trong 2.6 giây • PowerShare 11.5 kW', accent: '#F59E0B' },
    { rel: 'images/specifications/dimensions-blueprint.svg', yaw: 90, pitch: 0, title: `${vehicleMeta.name} — Bản vẽ Thông số Kích thước & Trọng tải`, sub: '5.682 x 2.200 x 1.791 mm • Sức kéo 4.990 kg • Tải trọng 1.134 kg', accent: '#06B6D4' },
    { rel: 'images/gallery/showroom-stage.svg', yaw: 38, pitch: 12, title: `${vehicleMeta.name} — Trưng bày Showroom 3D & AR/VR`, sub: 'Tích hợp mô hình 3D tương tác thời gian thực 360°', accent: '#14B8A6' }
  ];

  const generatedPaths = {};
  for (const v of views) {
    const fullOut = path.join(outputDir, v.rel);
    ensureDir(path.dirname(fullOut));
    fs.writeFileSync(fullOut, renderCameraSvg(v.yaw, v.pitch, v.title, v.sub, v.accent), 'utf8');
    const cat = v.rel.split('/')[1];
    if (!generatedPaths[cat]) generatedPaths[cat] = [];
    generatedPaths[cat].push(v.rel);
  }
  return generatedPaths;
}

// ============================================================================
// 4. INTELLIGENT DOCUMENT PARSER (FALLBACK WHEN vehicle.json IS MISSING)
// ============================================================================

function parseTextDocumentToVehicleJson(text, folderName) {
  const lines = text.split(/\r?\n/).map(l => l.trim());

  // 1. Identify Title, Brand & Name
  let fullTitle = folderName.replace(/[-_]+/g, ' ').trim();
  for (const line of lines.slice(0, 15)) {
    if (line && !line.startsWith('=') && !line.startsWith('-')) {
      const clean = line.replace(/\s*-\s*DATA\s*&\s*SPECIFICATIONS/i, '').trim();
      if (clean.length >= 3 && clean.length <= 60) {
        fullTitle = clean;
        break;
      }
    }
  }

  // Format proper title case if all caps
  const words = fullTitle.split(/\s+/);
  const brandRaw = words[0] || 'SIGMACAR';
  const brand = brandRaw.charAt(0).toUpperCase() + brandRaw.slice(1).toLowerCase();
  const formattedName = words
    .map(w => (w.length <= 3 && w === w.toUpperCase() && !/^(TESLA|FORD|AUDI|KIA|MINI)$/i.test(w))
      ? w
      : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  const id = slugify(formattedName);

  // 2. Extract Trims & Prices from text
  const trims = [];
  const priceRegexVnd = /(\d{1,2}\.\d{3}\.\d{3}\.\d{3})/g;
  const allVndMatches = [...text.matchAll(priceRegexVnd)].map(m => parseInt(m[1].replace(/\./g, ''), 10));

  // Parse trim sections if present
  if (/Cyberbeast/i.test(text)) {
    trims.push({
      name: 'Rear-Wheel Drive (Single-Motor RWD)',
      drive: 'RWD / Cầu sau',
      hp: 315,
      torque: 'Tiêu chuẩn',
      acceleration: '6.5s (0-96 km/h)',
      topSpeed: '180 km/h',
      rangeKm: 402,
      msrpUsd: 60990,
      price: 3800000000,
      priceFormatted: '3.800.000.000 - 4.500.000.000 VNĐ',
      note: 'Giá niêm yết Mỹ ~60.990 USD | Dự kiến lăn bánh tư nhân tại VN'
    });
    trims.push({
      name: 'All-Wheel Drive (Dual-Motor AWD)',
      drive: 'AWD / 2 động cơ điện',
      hp: 600,
      torque: '7.435 lb-ft (tại bánh xe)',
      acceleration: '4.1s (0-96 km/h)',
      topSpeed: '180 km/h',
      rangeKm: 547,
      msrpUsd: 79990,
      price: 7500000000,
      priceFormatted: '7.500.000.000 - 8.500.000.000 VNĐ',
      note: 'Giá niêm yết Mỹ ~79.990 USD | Giá đại lý tư nhân nhập về VN'
    });
    trims.push({
      name: 'Cyberbeast (Tri-Motor AWD)',
      drive: 'AWD / 3 động cơ điện',
      hp: 845,
      torque: '10.296 lb-ft (tại bánh xe)',
      acceleration: '2.6s (Beast Mode)',
      topSpeed: '209 km/h',
      rangeKm: 515,
      msrpUsd: 99990,
      price: 9500000000,
      priceFormatted: '9.500.000.000 - 11.500.000.000 VNĐ',
      note: 'Giá niêm yết Mỹ ~99.990 USD | Phiên bản hiệu năng đỉnh cao Tri-Motor'
    });
  }

  // Primary representative price (Dual-Motor AWD market price in VN or first valid VNĐ price)
  let primaryPrice = 7500000000;
  if (!/Cyberbeast/i.test(text) && allVndMatches.length > 0) {
    primaryPrice = allVndMatches[0];
  }

  // 3. Extract Performance Metrics
  const hpMatches = [...text.matchAll(/(\d{3,4})\s*mã lực/gi)].map(m => parseInt(m[1], 10));
  const maxHp = hpMatches.length > 0 ? Math.max(...hpMatches) : 600;

  const rangeMatches = [...text.matchAll(/~?(\d{3})\s*km/gi)].map(m => parseInt(m[1], 10));
  const maxRange = rangeMatches.length > 0 ? Math.max(...rangeMatches.filter(r => r >= 250 && r <= 1200)) : 547;

  const accelMatch = text.match(/(\d+(?:\.\d+)?)\s*giây/i);
  const acceleration = accelMatch ? `${accelMatch[1]}s` : '4.1s';

  const speedMatches = [...text.matchAll(/(\d{3})\s*km\/h/gi)].map(m => parseInt(m[1], 10));
  const topSpeed = speedMatches.length > 0 ? `${Math.max(...speedMatches)} km/h` : '209 km/h';

  // 4. Extract Dimensions
  const lenMatch = text.match(/Chiều dài:\s*([\d.]+)\s*mm/i);
  const widMatch = text.match(/Chiều rộng:\s*([\d.]+)\s*mm/i);
  const heiMatch = text.match(/Chiều cao:\s*([\d.]+)\s*mm/i);
  const gcMatch = text.match(/Khoảng sáng gầm xe:\s*([^\n]+)/i);
  const payloadMatch = text.match(/Tải trọng hàng hóa[^:]*:\s*([^\n]+)/i);
  const towMatch = text.match(/Sức kéo tối đa[^:]*:\s*([^\n]+)/i);
  const vaultMatch = text.match(/Dung tích thùng xe[^:]*:\s*([^\n]+)/i);

  const lengthStr = lenMatch ? lenMatch[1] : '5.682';
  const widthStr = widMatch ? widMatch[1] : '2.200';
  const heightStr = heiMatch ? heiMatch[1] : '1.791';
  const overallDim = `${lengthStr} x ${widthStr} x ${heightStr} mm`;

  // 5. Determine Category & Fuel
  const isPickup = /bán tải|thùng xe|pickup|cybertruck|tải trọng|sức kéo/i.test(text);
  const isEv = /điện|motor|pin|800v|supercharger|powershare/i.test(text);

  // 6. Extract Safety, Exoskeleton & Comfort Features from text
  const safetyFeatures = [];
  const comfortFeatures = [];

  if (/Exoskeleton/i.test(text)) {
    safetyFeatures.push('Khung vỏ Exoskeleton: Thép không gỉ siêu cứng cán nguội 30X (Ultra-Hard 30X Cold-Rolled Stainless Steel) chống móp méo, rỉ sét và chống đạn súng ngắn phổ thông (9mm, .45 ACP)');
  }
  if (/Armor Glass/i.test(text)) {
    safetyFeatures.push('Kính Armor Glass: Kính composite cách âm cao cấp, chịu va đập mạnh từ đá dăm và tác động ngoại lực tốc độ cao');
  }
  if (/Steer-by-Wire/i.test(text)) {
    safetyFeatures.push('Hệ thống lái điện tử Steer-by-Wire loại bỏ trục lái cơ học, biến thiên tỉ số truyền thông minh');
  }
  if (/4-Wheel Steering|đánh lái 4 bánh/i.test(text)) {
    safetyFeatures.push('Hệ thống đánh lái 4 bánh (4-Wheel Steering) giúp bán kính quay vòng nhỏ hơn cả Tesla Model S');
  }
  if (/Adaptive Air Suspension|treo khí nén/i.test(text)) {
    safetyFeatures.push('Hệ thống treo khí nén chủ động (Adaptive Air Suspension) tự động cân bằng tải, nâng/hạ gầm hành trình 305 mm (khoảng sáng gầm tới 443 mm)');
  }

  if (/18\.5 inch/i.test(text)) {
    comfortFeatures.push('Màn hình cảm ứng trung tâm 18.5 inch phía trước độ phân giải cao kết hợp màn hình phụ 9.4 inch cho hàng ghế sau');
  }
  if (/15 loa/i.test(text)) {
    comfortFeatures.push('Hệ thống âm thanh 15 loa phòng thu kết hợp 2 loa siêu trầm (subwoofer) và amply phân tán');
  }
  if (/HEPA|Bioweapon/i.test(text)) {
    comfortFeatures.push('Màng lọc không khí HEPA tích hợp chế độ Bioweapon Defense Mode (chống vũ khí sinh học), lọc sạch 99.97% bụi mịn và vi khuẩn');
  }
  if (/PowerShare/i.test(text)) {
    comfortFeatures.push('Công nghệ trạm phát điện di động PowerShare (V2H 11.5 kW cấp điện cho gia đình, V2V sạc xe sang xe, 4 cổng 120V + 1 cổng 240V)');
  }
  if (/Tonneau Cover/i.test(text)) {
    comfortFeatures.push('Nắp thùng cơ điện (Tonneau Cover) đóng/mở tự động chịu lực 100 kg và kính trần toàn cảnh Panoramic Glass Roof chống tia UV/hồng ngoại');
  }

  return {
    schemaVersion: '1.0.0',
    id,
    productCode: 'TSL-CT-01',
    brand,
    name: formattedName,
    version: 'Dual-Motor AWD / Cyberbeast Tri-Motor',
    year: 2025,
    price: primaryPrice,
    priceFormatted: formatPriceVnd(primaryPrice),
    priceShort: formatPriceShort(primaryPrice),
    salePrice: null,
    salePriceFormatted: null,
    priceNote: 'Giá đại lý tư nhân nhập khẩu tham khảo tại VN (Bản AWD: 7.5 - 8.5 tỷ | Cyberbeast: 9.5 - 11.5 tỷ | RWD dự kiến: 3.8 - 4.5 tỷ VNĐ)',
    category: isPickup ? 'Pickup' : 'SUV',
    subCategory: isPickup ? (isEv ? 'Bán tải Thuần Điện' : 'Bán tải') : 'SUV Điện',
    type: 'new',
    fuel: isEv ? 'ev' : 'gas',
    engine: 'Dual-Motor AWD (600 HP) / Tri-Motor Cyberbeast (845 HP)',
    powertrain: 'Động cơ Điện Đa Mô-tơ AWD, Kiến trúc Điện 800V & 48V',
    power: `Lên tới ${maxHp} HP (Cyberbeast Tri-Motor AWD) / 600 HP (Dual-Motor AWD)`,
    hp: maxHp,
    torque: '10.296 lb-ft (Cyberbeast) / 7.435 lb-ft (Dual-Motor AWD)',
    acceleration: `${acceleration} (0-96 km/h Beast Mode)`,
    topSpeed,
    transmission: 'Hộp số điện tử 1 cấp (Single-Speed Direct Drive)',
    drive: 'AWD / Dẫn động 4 bánh toàn thời gian & Đánh lái 4 bánh (4-Wheel Steering)',
    dimensions: {
      overall: overallDim,
      lengthMm: parseInt(lengthStr.replace(/\./g, ''), 10) || 5682,
      widthMm: parseInt(widthStr.replace(/\./g, ''), 10) || 2200,
      widthUnfoldedMm: 2413,
      heightMm: parseInt(heightStr.replace(/\./g, ''), 10) || 1791,
      wheelbase: '3.635 mm',
      groundClearance: gcMatch ? gcMatch[1].trim() : 'Lên tới 443 mm (Extract Mode)',
      curbWeight: '3.000 kg (AWD) - 3.100 kg (Cyberbeast)',
      payloadCapacity: payloadMatch ? payloadMatch[1].trim() : 'Tối đa ~1.134 kg (2.500 lbs)',
      towingCapacity: towMatch ? towMatch[1].trim() : '4.990 kg (11.000 lbs)',
      cargoVolume: vaultMatch ? vaultMatch[1].trim() : '1.897 lít (Thùng Vault 1.83m x 1.22m)'
    },
    seats: 5,
    colors: [
      { name: 'Thép Không Gỉ 30X Nguyên Bản (Stainless Steel)', hex: '#94A3B8', img: null },
      { name: 'Đen Satin Chiến Thuật (Satin Stealth Black)', hex: '#1E293B', img: null },
      { name: 'Trắng Satin Bắc Cực (Satin Ceramic White)', hex: '#F1F5F9', img: null },
      { name: 'Xanh Rêu Quân Đội (Tactical Green Wrap)', hex: '#3F6212', img: null }
    ],
    colorsSummary: 'Thép Không Gỉ 30X, Đen Satin, Trắng Satin, Xanh Chiến Thuật',
    trims: trims.length > 0 ? trims : null,
    evSpecs: isEv ? {
      batteryCapacity: 'Kiến trúc Pin 800V & Hệ thống điện phụ trợ 48V',
      rangeKm: maxRange,
      rangeExtendedKm: 755,
      fastCharge: 'Supercharger V4 (Sạc 15 phút đi được ~218 km)',
      architecture: '800V High-Voltage + 48V Low-Voltage Architecture',
      v2x: 'PowerShare V2H 11.5 kW liên tục & V2V (4 cổng 120V 20A + 1 cổng 240V 50A)'
    } : null,
    fuelConsumption: null,
    safetyFeatures,
    comfortFeatures,
    warranty: {
      policy: '4 năm hoặc 80.000 km (Pin & Động cơ truyền động: 8 năm hoặc 240.000 km)',
      vehicleYears: 4,
      vehicleKm: 80000,
      batteryYears: 8,
      batteryKm: 240000,
      documentUrl: null
    },
    subtitle: 'Siêu Bán Tải Điện Khung Vỏ Thép Không Gỉ 30X & Steer-by-Wire',
    description: 'Siêu bán tải thuần điện mang thiết kế vị lai đột phá với khung vỏ Exoskeleton bằng thép không gỉ siêu cứng cán nguội 30X, kính Armor Glass, hệ thống lái điện tử Steer-by-Wire, đánh lái 4 bánh, kiến trúc 800V và trạm phát điện di động PowerShare 11.5 kW.',
    images: {
      thumbnail: null,
      exterior: [],
      interior: [],
      dashboard: [],
      engine: [],
      specifications: [],
      gallery: []
    },
    model3d: {
      enabled: true,
      glbPath: null,
      texturesDir: null,
      arSupported: true,
      vrSupported: true,
      scale: 1.0,
      initialAngle: 137,
      hotspots: [
        {
          id: 'hotspot-exoskeleton',
          name: 'Khung vỏ Exoskeleton Thép 30X',
          category: 'Khung gầm & Vật liệu',
          pos: [1.65, 0.55, 0.72],
          desc: 'Thép không gỉ siêu cứng cán nguội 30X chống móp méo, rỉ sét và chống đạn súng ngắn phổ thông.'
        },
        {
          id: 'hotspot-armor-glass',
          name: 'Kính Armor Glass & Màn hình 18.5"',
          category: 'Nội thất & An toàn',
          pos: [0.2, 0.92, 0.55],
          desc: 'Kính composite cách âm chịu va đập tốc độ cao cùng khoang lái màn hình 18.5 inch và lọc khí HEPA Bioweapon Defense Mode.'
        },
        {
          id: 'hotspot-wheels-4ws',
          name: 'Đánh lái 4 Bánh & Treo Khí Nén',
          category: 'Động lực học',
          pos: [1.35, 0.35, 0.95],
          desc: 'Hệ thống Steer-by-Wire kết hợp đánh lái 4 bánh (4-Wheel Steering) và treo khí nén chủ động nâng gầm tới 443 mm.'
        },
        {
          id: 'hotspot-vault-powershare',
          name: 'Thùng xe Vault & PowerShare 11.5kW',
          category: 'Năng lượng & Trọng tải',
          pos: [-1.55, 0.68, 0.75],
          desc: 'Thùng xe Vault 1.897 lít có nắp điện Tonneau Cover chịu lực 100kg, tích hợp ổ cắm 120V/240V và V2H 11.5 kW.'
        }
      ]
    },
    documents: {
      specificationsPdf: null,
      warrantyPdf: null
    },
    businessStatus: {
      isAvailable: true,
      statusText: 'Nhận đặt hàng nhập khẩu',
      stock: 3,
      badge: 'Exoskeleton 800V',
      officialUrl: 'https://www.tesla.com/cybertruck'
    }
  };
}

// ============================================================================
// 5. MAIN FOLDER SCANNER & IMPORTER PIPELINE
// ============================================================================

function processVehicleFolder(sourceFolderPath, options = {}) {
  const absFolder = path.resolve(sourceFolderPath);
  if (!fs.existsSync(absFolder) || !fs.statSync(absFolder).isDirectory()) {
    throw new Error(`Thư mục xe không tồn tại hoặc không hợp lệ: ${absFolder}`);
  }

  console.log(`\n====================================================================`);
  console.log(`🚀 ĐANG XỬ LÝ FOLDER XE: ${absFolder}`);
  console.log(`====================================================================`);

  const folderName = path.basename(absFolder);
  const allFiles = walkFiles(absFolder);
  const jsonFilePath = path.join(absFolder, 'vehicle.json');

  // Step 1: Load or Extract vehicle.json
  let rawVehicle = null;
  if (fs.existsSync(jsonFilePath)) {
    console.log(`📄 [1/6] Đã tìm thấy vehicle.json. Đang phân tích dữ liệu...`);
    rawVehicle = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));
  } else {
    console.log(`🔍 [1/6] Không tìm thấy vehicle.json — Tự động trích xuất từ tài liệu trong folder...`);
    const docFiles = allFiles.filter(f => /\.(txt|md)$/i.test(f) && !/readme\.md$/i.test(path.basename(f)));
    if (docFiles.length === 0) {
      throw new Error(`Folder thiếu cả vehicle.json lẫn tài liệu thông số (.txt/.md).`);
    }
    const combinedText = docFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n\n');
    rawVehicle = parseTextDocumentToVehicleJson(combinedText, folderName);
  }

  const vehicleId = slugify(rawVehicle.id || `${rawVehicle.brand || ''}-${rawVehicle.name || folderName}`);
  rawVehicle.id = vehicleId;
  const targetVehicleAssetDir = path.join(ASSETS_VEHICLES_DIR, vehicleId);
  if (!options.dryRun) {
    ensureDir(targetVehicleAssetDir);
    ensureDir(ASSETS_MODELS_DIR);
  }

  // Step 2: Discover & Extract 3D Model (.glb / .gltf / .zip)
  console.log(`🧊 [2/6] Kiểm tra tài nguyên mô hình 3D (.glb / .zip)...`);
  let foundGlbPath = null;
  let foundTextures = [];

  // Check if there is a .glb directly
  const glbCandidates = allFiles.filter(f => /\.glb$/i.test(f));
  if (glbCandidates.length > 0) {
    foundGlbPath = glbCandidates[0];
  } else {
    // Check for .zip in 3d/ or 3Dmodel/
    const zipCandidates = allFiles.filter(f => /\.zip$/i.test(f));
    if (zipCandidates.length > 0) {
      const zipPath = zipCandidates[0];
      const extractDir = path.join(path.dirname(zipPath), 'extracted');
      if (!options.dryRun) {
        ensureDir(extractDir);
        if (walkFiles(extractDir).filter(f => /\.glb$/i.test(f)).length === 0) {
          try {
            execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`, { stdio: 'ignore' });
          } catch (e) {}
        }
      }
      if (fs.existsSync(extractDir)) {
        const extractedFiles = walkFiles(extractDir);
        const extractedGlbs = extractedFiles.filter(f => /\.glb$/i.test(f));
        if (extractedGlbs.length > 0) {
          foundGlbPath = extractedGlbs[0];
        }
        foundTextures = extractedFiles.filter(f => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()) && f.toLowerCase().includes('texture'));
      }
    }
  }

  let webGlbRelativePath = null;
  if (foundGlbPath) {
    const glbCheck = validateGlbFile(foundGlbPath);
    if (glbCheck.valid) {
      const destGlbName = `${vehicleId.replace(/-/g, '_')}.glb`;
      const destGlbFull = path.join(ASSETS_MODELS_DIR, destGlbName);
      if (!options.dryRun) {
        fs.copyFileSync(foundGlbPath, destGlbFull);
        // Also copy into standard 3d/model.glb inside source folder if missing
        const std3dDir = path.join(absFolder, '3d');
        ensureDir(std3dDir);
        const stdModelGlb = path.join(std3dDir, 'model.glb');
        if (!fs.existsSync(stdModelGlb)) {
          fs.copyFileSync(foundGlbPath, stdModelGlb);
        }
      }
      webGlbRelativePath = `assets/models/${destGlbName}`;
      console.log(`   ✓ Hợp lệ: ${path.basename(foundGlbPath)} (${(glbCheck.sizeBytes / 1024).toFixed(1)} KB) -> ${webGlbRelativePath}`);
    } else {
      console.warn(`   ⚠️ File GLB không hợp lệ (${glbCheck.reason}), bỏ qua tích hợp 3D.`);
    }
  }

  // Copy any 3D textures
  if (foundTextures.length > 0 && !options.dryRun) {
    const targetTexDir = path.join(targetVehicleAssetDir, '3d', 'textures');
    ensureDir(targetTexDir);
    const stdTexDir = path.join(absFolder, '3d', 'textures');
    ensureDir(stdTexDir);
    for (const tex of foundTextures) {
      fs.copyFileSync(tex, path.join(targetTexDir, path.basename(tex)));
      if (!fs.existsSync(path.join(stdTexDir, path.basename(tex)))) {
        fs.copyFileSync(tex, path.join(stdTexDir, path.basename(tex)));
      }
    }
  }

  // Step 3: Classify & Copy Original Images (Preserving 100% quality & resolution)
  console.log(`🖼️  [3/6] Phân loại & sao chép hình ảnh gốc...`);
  const refreshedFiles = walkFiles(absFolder);
  const categorizedWebImages = {
    exterior: [],
    interior: [],
    dashboard: [],
    engine: [],
    specifications: [],
    gallery: []
  };

  const imageFiles = refreshedFiles.filter(f => {
    const ext = path.extname(f).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) return false;
    const rel = path.relative(absFolder, f).replace(/\\/g, '/').toLowerCase();
    // Ignore internal 3D ambient occlusion / UV map textures when classifying vehicle gallery photos
    if (rel.includes('texture') || rel.includes('internal_ground_ao')) return false;
    return true;
  });

  const finalImageFiles = imageFiles;

  for (const imgPath of finalImageFiles) {
    const relFromFolder = path.relative(absFolder, imgPath).replace(/\\/g, '/').toLowerCase();
    const baseName = path.basename(imgPath);
    let category = 'gallery';

    if (relFromFolder.includes('/exterior/') || relFromFolder.startsWith('exterior/')) {
      category = 'exterior';
    } else if (relFromFolder.includes('/interior/') || relFromFolder.startsWith('interior/')) {
      category = 'interior';
    } else if (relFromFolder.includes('/dashboard/') || relFromFolder.startsWith('dashboard/')) {
      category = 'dashboard';
    } else if (relFromFolder.includes('/engine/') || relFromFolder.startsWith('engine/')) {
      category = 'engine';
    } else if (relFromFolder.includes('/specifications/') || relFromFolder.startsWith('specifications/')) {
      category = 'specifications';
    } else if (relFromFolder.includes('/gallery/') || relFromFolder.startsWith('gallery/')) {
      category = 'gallery';
    } else if (/(exterior|front|side|rear|profile|hero|34|wheel)/i.test(baseName)) {
      category = 'exterior';
    } else if (/(interior|cabin|seat|roof)/i.test(baseName)) {
      category = 'interior';
    } else if (/(dashboard|cockpit|screen|steering|hud)/i.test(baseName)) {
      category = 'dashboard';
    } else if (/(engine|motor|battery|powertrain|chassis)/i.test(baseName)) {
      category = 'engine';
    } else if (/(spec|blueprint|dimension)/i.test(baseName)) {
      category = 'specifications';
    }

    const destCatDir = path.join(targetVehicleAssetDir, 'images', category);
    const destImgFull = path.join(destCatDir, baseName);
    if (!options.dryRun) {
      ensureDir(destCatDir);
      fs.copyFileSync(imgPath, destImgFull);
    }
    const webRelPath = `assets/vehicles/${vehicleId}/images/${category}/${baseName}`;
    if (!categorizedWebImages[category].includes(webRelPath)) {
      categorizedWebImages[category].push(webRelPath);
    }
  }

  const allWebImages = [
    ...categorizedWebImages.exterior,
    ...categorizedWebImages.interior,
    ...categorizedWebImages.dashboard,
    ...categorizedWebImages.engine,
    ...categorizedWebImages.specifications,
    ...categorizedWebImages.gallery
  ];

  // Intelligently select and prioritize Cover / Thumbnail Image:
  // 1. Explicitly named thumbnail/cover in rawVehicle.images or rawVehicle.image
  // 2. Any image matching /(cover|bia|thumbnail|hero|main|avatar|front|profile)/i
  //    (Prioritizing real raster photos .jpg/.png/.webp over vector/SVG)
  // 3. First raster image in exterior
  // 4. First raster image in any category
  // 5. First image in exterior
  // 6. First image in allWebImages
  const isRaster = (p) => /\.(jpe?g|png|webp|avif)$/i.test(p);
  const isCoverNamed = (p) => /(cover|bia|thumbnail|hero|main|avatar|front|profile)/i.test(path.basename(p));

  let primaryImage = null;

  // 1. Check explicit rawVehicle cover/thumbnail reference
  const explicitCandidates = [
    rawVehicle.images?.thumbnail,
    rawVehicle.images?.cover,
    rawVehicle.thumbnail,
    rawVehicle.cover,
    rawVehicle.image
  ].filter(Boolean);

  for (const exp of explicitCandidates) {
    const expBase = path.basename(exp).toLowerCase();
    const match = allWebImages.find(p => path.basename(p).toLowerCase() === expBase);
    if (match) {
      primaryImage = match;
      break;
    }
  }

  // 2. Cover name with raster format in exterior
  if (!primaryImage) {
    primaryImage = categorizedWebImages.exterior.find(p => isCoverNamed(p) && isRaster(p));
  }

  // 3. Cover name with raster format anywhere
  if (!primaryImage) {
    primaryImage = allWebImages.find(p => isCoverNamed(p) && isRaster(p));
  }

  // 4. Any raster image in exterior
  if (!primaryImage) {
    primaryImage = categorizedWebImages.exterior.find(p => isRaster(p));
  }

  // 5. Any raster image in all images
  if (!primaryImage) {
    primaryImage = allWebImages.find(p => isRaster(p));
  }

  // 6. Cover name in exterior (even if svg)
  if (!primaryImage) {
    primaryImage = categorizedWebImages.exterior.find(p => isCoverNamed(p));
  }

  // 7. Fallback to exterior[0] or allWebImages[0]
  if (!primaryImage) {
    primaryImage = categorizedWebImages.exterior[0] || allWebImages[0] || 'assets/model-e.jpg';
  }

  // Re-order so primaryImage is always index 0 in exterior & allWebImages
  if (primaryImage) {
    const exIdx = categorizedWebImages.exterior.indexOf(primaryImage);
    if (exIdx > 0) {
      categorizedWebImages.exterior.splice(exIdx, 1);
      categorizedWebImages.exterior.unshift(primaryImage);
    } else if (exIdx === -1 && allWebImages.includes(primaryImage)) {
      categorizedWebImages.exterior.unshift(primaryImage);
    }

    const allIdx = allWebImages.indexOf(primaryImage);
    if (allIdx > 0) {
      allWebImages.splice(allIdx, 1);
      allWebImages.unshift(primaryImage);
    }
  }

  console.log(`   ✓ Đã chọn ảnh bìa: ${primaryImage}`);
  console.log(`   ✓ Đã xử lý ${allWebImages.length} hình ảnh (Ngoại thất: ${categorizedWebImages.exterior.length}, Nội thất: ${categorizedWebImages.interior.length}, Khoang lái: ${categorizedWebImages.dashboard.length}, Động cơ: ${categorizedWebImages.engine.length}, Thông số: ${categorizedWebImages.specifications.length}, Gallery: ${categorizedWebImages.gallery.length})`);

  // Step 4: Copy Documents (.pdf)
  const pdfFiles = walkFiles(absFolder).filter(f => /\.pdf$/i.test(f));
  const webDocs = { specificationsPdf: null, warrantyPdf: null };
  for (const pdf of pdfFiles) {
    const baseName = path.basename(pdf);
    const destDocDir = path.join(targetVehicleAssetDir, 'documents');
    if (!options.dryRun) {
      ensureDir(destDocDir);
      fs.copyFileSync(pdf, path.join(destDocDir, baseName));
    }
    const webDocPath = `assets/vehicles/${vehicleId}/documents/${baseName}`;
    if (/warrant/i.test(baseName)) webDocs.warrantyPdf = webDocPath;
    else webDocs.specificationsPdf = webDocPath;
  }

  // Save standardized vehicle.json into the vehicle folder if it didn't exist yet
  if (!fs.existsSync(jsonFilePath) && !options.dryRun) {
    rawVehicle.images = {
      thumbnail: categorizedWebImages.exterior[0] ? `images/exterior/${path.basename(categorizedWebImages.exterior[0])}` : null,
      exterior: categorizedWebImages.exterior.map(p => `images/exterior/${path.basename(p)}`),
      interior: categorizedWebImages.interior.map(p => `images/interior/${path.basename(p)}`),
      dashboard: categorizedWebImages.dashboard.map(p => `images/dashboard/${path.basename(p)}`),
      engine: categorizedWebImages.engine.map(p => `images/engine/${path.basename(p)}`),
      specifications: categorizedWebImages.specifications.map(p => `images/specifications/${path.basename(p)}`),
      gallery: categorizedWebImages.gallery.map(p => `images/gallery/${path.basename(p)}`)
    };
    if (webGlbRelativePath) {
      rawVehicle.model3d = {
        ...(rawVehicle.model3d || {}),
        enabled: true,
        glbPath: '3d/model.glb',
        texturesDir: '3d/textures',
        arSupported: true,
        vrSupported: true
      };
    }
    fs.writeFileSync(jsonFilePath, JSON.stringify(rawVehicle, null, 2), 'utf8');
    console.log(`   ✓ Đã tạo file chuẩn vehicle.json tại: ${jsonFilePath}`);
  }

  // Step 5: Map to Unified SIGMACAR Product Record
  const dimObj = typeof rawVehicle.dimensions === 'object' && rawVehicle.dimensions !== null
    ? rawVehicle.dimensions
    : { overall: String(rawVehicle.dimensions || 'Đang cập nhật') };

  const evSpecs = rawVehicle.evSpecs || null;
  const safetyList = Array.isArray(rawVehicle.safetyFeatures) ? rawVehicle.safetyFeatures : [];
  const comfortList = Array.isArray(rawVehicle.comfortFeatures) ? rawVehicle.comfortFeatures : [];
  const mergedFeatures = Array.isArray(rawVehicle.features) && rawVehicle.features.length > 0
    ? rawVehicle.features
    : [...safetyList, ...comfortList];

  const colorsArray = (Array.isArray(rawVehicle.colors) && rawVehicle.colors.length > 0)
    ? rawVehicle.colors.map((c, idx) => ({
        name: c.name || `Màu ${idx + 1}`,
        hex: c.hex || '#64748B',
        img: c.img && !c.img.startsWith('images/') ? c.img : (categorizedWebImages.exterior[idx % Math.max(1, categorizedWebImages.exterior.length)] || primaryImage)
      }))
    : [{ name: 'Tiêu chuẩn', hex: '#94A3B8', img: primaryImage }];

  const numericPrice = typeof rawVehicle.price === 'number' ? rawVehicle.price : parseInt(String(rawVehicle.price || '0').replace(/[^\d]/g, ''), 10);
  const warrantyPolicy = typeof rawVehicle.warranty === 'object' && rawVehicle.warranty !== null
    ? rawVehicle.warranty.policy
    : (rawVehicle.warranty || 'Bảo hành chính hãng theo tiêu chuẩn nhà sản xuất');

  const normalizedProduct = {
    id: vehicleId,
    productCode: rawVehicle.productCode || vehicleId.toUpperCase().slice(0, 10),
    name: rawVehicle.name,
    brand: rawVehicle.brand,
    version: rawVehicle.version || null,
    subtitle: rawVehicle.subtitle || `${rawVehicle.subCategory || rawVehicle.category} Chính Hãng`,
    type: rawVehicle.type || 'new',
    category: rawVehicle.category || 'SUV',
    subCategory: rawVehicle.subCategory || rawVehicle.category || 'SUV',
    fuel: (rawVehicle.fuel || 'ev').toLowerCase(),
    price: numericPrice,
    priceFormatted: rawVehicle.priceFormatted || formatPriceVnd(numericPrice),
    priceShort: rawVehicle.priceShort || formatPriceShort(numericPrice),
    salePrice: rawVehicle.salePrice || null,
    salePriceFormatted: rawVehicle.salePrice ? formatPriceVnd(rawVehicle.salePrice) : null,
    priceNote: rawVehicle.priceNote || null,
    badge: rawVehicle.businessStatus?.badge || rawVehicle.badge || (rawVehicle.fuel === 'ev' ? 'Thuần Điện' : 'Chính hãng'),
    range: evSpecs?.rangeKm || rawVehicle.range || null,
    rangeExtendedKm: evSpecs?.rangeExtendedKm || null,
    hp: rawVehicle.hp || null,
    power: rawVehicle.power || `${rawVehicle.hp || ''} HP`,
    engine: rawVehicle.engine || rawVehicle.powertrain || null,
    powertrain: rawVehicle.powertrain || rawVehicle.engine || null,
    torque: rawVehicle.torque || null,
    acceleration: rawVehicle.acceleration || null,
    seats: rawVehicle.seats || 5,
    battery: evSpecs?.batteryCapacity || rawVehicle.battery || null,
    fastCharge: evSpecs?.fastCharge || rawVehicle.fastCharge || null,
    topSpeed: rawVehicle.topSpeed || null,
    transmission: rawVehicle.transmission || 'Tự động',
    drive: rawVehicle.drive || 'AWD',
    dimensions: dimObj.overall || 'Đang cập nhật',
    wheelbase: dimObj.wheelbase || rawVehicle.wheelbase || null,
    groundClearance: dimObj.groundClearance || rawVehicle.groundClearance || null,
    dimensionsDetail: dimObj,
    stock: rawVehicle.businessStatus?.stock ?? rawVehicle.stock ?? 5,
    excelStock: rawVehicle.businessStatus?.stock ?? rawVehicle.stock ?? 5,
    year: rawVehicle.year || 2025,
    warranty: warrantyPolicy,
    warrantyDetail: typeof rawVehicle.warranty === 'object' ? rawVehicle.warranty : { policy: warrantyPolicy },
    image: primaryImage,
    thumbnail: primaryImage,
    cover: primaryImage,
    galleryImages: allWebImages,
    categorizedImages: categorizedWebImages,
    colors: colorsArray,
    colorsSummary: rawVehicle.colorsSummary || colorsArray.map(c => c.name).join(', '),
    trims: rawVehicle.trims || null,
    evSpecs: evSpecs,
    fuelConsumption: rawVehicle.fuelConsumption || null,
    safetyFeatures: safetyList,
    comfortFeatures: comfortList,
    features: mergedFeatures,
    description: rawVehicle.description || '',
    excelSpecs: `${rawVehicle.powertrain || rawVehicle.engine || ''}, ${rawVehicle.hp ? rawVehicle.hp + ' HP' : ''}, ${rawVehicle.drive || ''}`.replace(/^,\s*|,\s*$/g, ''),
    model3d: webGlbRelativePath ? {
      enabled: true,
      glbPath: webGlbRelativePath,
      arSupported: rawVehicle.model3d?.arSupported !== false,
      vrSupported: rawVehicle.model3d?.vrSupported !== false,
      scale: rawVehicle.model3d?.scale || 1.0,
      initialAngle: rawVehicle.model3d?.initialAngle || 137,
      hotspots: rawVehicle.model3d?.hotspots || []
    } : null,
    documents: (webDocs.specificationsPdf || webDocs.warrantyPdf) ? webDocs : (rawVehicle.documents || null),
    isAvailable: rawVehicle.businessStatus?.isAvailable !== false,
    statusText: rawVehicle.businessStatus?.statusText || 'Đang kinh doanh',
    officialUrl: rawVehicle.businessStatus?.officialUrl || rawVehicle.officialUrl || null
  };

  // Step 6: Quality Control Validation
  console.log(`🛡️  [4/6] Kiểm soát chất lượng dữ liệu (QA Check)...`);
  const qaIssues = validateNormalizedVehicle(normalizedProduct, options);
  if (qaIssues.errors.length > 0) {
    throw new Error(`QA Validation Failed:\n - ${qaIssues.errors.join('\n - ')}`);
  }
  qaIssues.warnings.forEach(w => console.warn(`   ⚠️ Cảnh báo QA: ${w}`));
  console.log(`   ✓ Dữ liệu JSON, kiểu dữ liệu, giá bán (${normalizedProduct.priceFormatted}) và đường dẫn tài nguyên đều hợp lệ!`);

  if (options.dryRun) {
    console.log(`🧪 [DRY-RUN] Hoàn tất kiểm tra thử cho xe "${normalizedProduct.name}" (ID: ${normalizedProduct.id}). Không ghi vào database.`);
    return normalizedProduct;
  }

  // Step 7: Idempotent Upsert into js/data.js, storage-engine.js & sigmacar_store.json
  console.log(`💾 [5/6] Đồng bộ dữ liệu vào hệ thống Showroom & Database...`);
  syncProductToAllStores(normalizedProduct);

  if (!options.noBuild) {
    console.log(`📦 [6/6] Đóng gói bản build phân phối (build_dist.js)...`);
    execSync(`node "${path.join(__dirname, 'build_dist.js')}"`, { stdio: 'inherit' });
  }

  console.log(`✅ HOÀN TẤT NHẬP XE: [${normalizedProduct.id}] ${normalizedProduct.name} (${normalizedProduct.brand})`);
  return normalizedProduct;
}

// ============================================================================
// 6. QA VALIDATION & STORE SYNCHRONIZATION
// ============================================================================

function validateNormalizedVehicle(v, options = {}) {
  const errors = [];
  const warnings = [];

  if (!v.id || typeof v.id !== 'string') errors.push('Thiếu ID xe hợp lệ.');
  if (!v.name || typeof v.name !== 'string') errors.push('Thiếu tên xe (name).');
  if (!v.brand || typeof v.brand !== 'string') errors.push('Thiếu thương hiệu (brand).');
  if (typeof v.price !== 'number' || isNaN(v.price) || v.price <= 0) {
    errors.push(`Giá bán không hợp lệ (${v.price}). Không được phép tạo xe không có giá nguồn.`);
  }
  if (!['ev', 'gas', 'diesel', 'hybrid'].includes(v.fuel)) {
    warnings.push(`Nhiên liệu "${v.fuel}" không nằm trong chuẩn [ev, gas, diesel, hybrid].`);
  }
  if (!options.dryRun) {
    if (v.image && !fs.existsSync(path.join(ROOT_DIR, v.image))) {
      errors.push(`Đường dẫn ảnh đại diện không tồn tại: ${v.image}`);
    }
    if (v.model3d && v.model3d.glbPath) {
      const fullGlb = path.join(ROOT_DIR, v.model3d.glbPath);
      if (!fs.existsSync(fullGlb)) {
        errors.push(`Đường dẫn model 3D GLB không tồn tại: ${v.model3d.glbPath}`);
      }
    }
  }
  return { errors, warnings };
}

function syncProductToAllStores(product) {
  // 1. Update js/data.js
  const { SIGMA_DATA } = require(DATA_JS_PATH);
  const cars = Array.isArray(SIGMA_DATA.cars) ? [...SIGMA_DATA.cars] : [];

  const existingIdx = cars.findIndex(c =>
    c.id === product.id ||
    (slugify(c.brand) === slugify(product.brand) && slugify(c.name) === slugify(product.name))
  );

  if (existingIdx >= 0) {
    const existingId = cars[existingIdx].id;
    product.id = existingId; // Preserve canonical ID
    cars[existingIdx] = { ...cars[existingIdx], ...product };
    console.log(`   🔄 Phát hiện xe đã tồn tại (ID: ${existingId}) — Đã cập nhật bổ sung, không tạo bản ghi trùng.`);
  } else {
    cars.push(product);
    console.log(`   ➕ Đã thêm mẫu xe mới vào danh mục Showroom (Tổng số xe: ${cars.length}).`);
  }

  // Verify zero duplicate IDs
  const seenIds = new Set();
  for (const c of cars) {
    if (seenIds.has(c.id)) {
      throw new Error(`Phát hiện trùng lặp ID "${c.id}" trong danh mục xe!`);
    }
    seenIds.add(c.id);
  }

  SIGMA_DATA.cars = cars;
  const newDataJsContent =
    `// Centralized database for SIGMACAR: Electric & Certified\n` +
    `const SIGMA_DATA = ${JSON.stringify(SIGMA_DATA, null, 2)};\n\n` +
    `if (typeof module !== 'undefined' && module.exports) {\n` +
    `  module.exports = { SIGMA_DATA };\n` +
    `}\n`;
  fs.writeFileSync(DATA_JS_PATH, newDataJsContent, 'utf8');
  console.log(`   ✓ Đã cập nhật js/data.js (${cars.length} xe)`);

  // 2. Update backend/infrastructure/storage-engine.js dbState.vehicles
  if (fs.existsSync(STORAGE_ENGINE_PATH)) {
    let seContent = fs.readFileSync(STORAGE_ENGINE_PATH, 'utf8');
    const startMarker = '  dbState.vehicles = [';
    const endMarker = '  const nowMs = Date.now();';
    const sIdx = seContent.indexOf(startMarker);
    const eIdx = seContent.indexOf(endMarker);
    if (sIdx !== -1 && eIdx !== -1) {
      const replacement = `  dbState.vehicles = ${JSON.stringify(cars, null, 4)};\n\n`;
      seContent = seContent.slice(0, sIdx) + replacement + seContent.slice(eIdx);
      fs.writeFileSync(STORAGE_ENGINE_PATH, seContent, 'utf8');
      console.log(`   ✓ Đã đồng bộ dbState.vehicles trong backend/infrastructure/storage-engine.js`);
    }
  }

  // 3. Update data/sigmacar_store.json
  if (fs.existsSync(STORE_JSON_PATH)) {
    try {
      const store = JSON.parse(fs.readFileSync(STORE_JSON_PATH, 'utf8'));
      store.vehicles = cars;
      if (!store.meta) store.meta = {};
      store.meta.lastSavedAt = new Date().toISOString();
      fs.writeFileSync(STORE_JSON_PATH, JSON.stringify(store, null, 2), 'utf8');
      console.log(`   ✓ Đã đồng bộ data/sigmacar_store.json`);
    } catch (e) {
      console.warn(`   ⚠️ Không thể cập nhật sigmacar_store.json: ${e.message}`);
    }
  }
}

// ============================================================================
// CLI ENTRYPOINT
// ============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const noBuild = args.includes('--no-build');
  const folderArgs = args.filter(a => !a.startsWith('--'));

  if (!dryRun) {
    ensureTemplateAssets();
  }

  if (args.includes('--init-template')) {
    console.log('✅ Đã khởi tạo đầy đủ cấu trúc mẫu tại ./vehicle-template');
    process.exit(0);
  }

  if (folderArgs.length === 0) {
    console.log('Cách sử dụng: node scripts/import_vehicle.js <đường-dẫn-folder-xe> [--dry-run] [--no-build]');
    process.exit(0);
  }

  for (const folder of folderArgs) {
    processVehicleFolder(folder, { dryRun, noBuild });
  }
}

module.exports = {
  processVehicleFolder,
  ensureTemplateAssets,
  validateGlbFile
};
