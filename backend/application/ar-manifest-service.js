// backend/application/ar-manifest-service.js
// Builds the per-vehicle AR manifest served at GET /api/v1/vehicles/:vehicleId/ar-manifest.
//
// Sources (all real repository data, nothing invented):
//   - vehicle record (VehicleRepository)            → name, colours, model3d.glbPath, hotspots
//   - data/ar-manifest.json (generate_ar_manifest)  → AR GLB, per-colour variants, dimensions, readiness
//   - assets/models/manifests/bindings.json         → paint / rim material names detected in each GLB
//
// Capability flags are derived from what the assets actually contain. Features whose data is missing
// (e.g. door animations — no current GLB has any) are reported as false so the client disables them.
//
// The same builder is used by scripts/build_dist.js to emit static snapshots (dist/data/ar/<id>.json)
// so the AR page can still load models on static hosting when the API is unreachable.

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const REGISTRY_FILE = path.join(ROOT_DIR, 'data', 'ar-manifest.json');
const BINDINGS_FILE = path.join(ROOT_DIR, 'assets', 'models', 'manifests', 'bindings.json');

const SCHEMA_VERSION = 1;

// Legacy hotspot coordinates in vehicle.model3d.hotspots are authored in the 3D showroom frame, which
// normalises every model to a 4.4 m maximum dimension (js/car-3d-viewer.js setupLoadedModel).
const SHOWROOM_NORMALIZED_MAX_DIM_M = 4.4;

// Wheel options mirror js/data.js SIGMA_DATA.wheels (ids/labels) and the rim finishes applied by the
// showroom (js/car-3d-viewer.js setWheelType). They change the rim *finish*; no GLB ships alternative
// wheel geometry, so size/design swaps are not modelled.
const WHEEL_FINISH_OPTIONS = [
  { id: 'wheel-21-sport', label: '21" Sport', name: '21" Sport Wheels', finish: { color: '#D0D5DD', roughness: 0.22, metalness: 0.92 } },
  { id: 'wheel-20-aero', label: '20" Aero', name: '20" Aero Wheels', finish: { color: '#334155', roughness: 0.5, metalness: 0.75 } },
  { id: 'wheel-22-forged', label: '22" Forged', name: '22" Forged Performance', finish: { color: '#B45309', roughness: 0.3, metalness: 0.95 } }
];

// Material names verified by parsing the GLB JSON chunk of the listed files (2026-11-14 audit).
// bindings.json mis-classifies these files (Material_Body not detected as paint, Material_Trim matched /rim/).
const VERIFIED_MATERIAL_OVERRIDES = {
  'assets/models/ar/tesla_cybertruck_ar_v1.glb': { body: ['Material_Body'], rims: ['Material_Rims'] },
  'assets/models/ar/tesla_cybertruck_ar_stealth_black.glb': { body: ['Material_Body'], rims: ['Material_Rims'] },
  'assets/models/ar/tesla_cybertruck_ar_ceramic_white.glb': { body: ['Material_Body'], rims: ['Material_Rims'] },
  'assets/models/ar/tesla_cybertruck_ar_tactical_green.glb': { body: ['Material_Body'], rims: ['Material_Rims'] }
};

let cache = null;

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function loadSources() {
  if (!cache) {
    cache = {
      registry: readJsonSafe(REGISTRY_FILE) || { vehicles: {} },
      bindings: readJsonSafe(BINDINGS_FILE) || { vehicles: {}, protectedMaterialPatterns: [] }
    };
  }
  return cache;
}

function resetCache() {
  cache = null;
}

// Accepts site-relative asset paths ("assets/models/x.glb") or absolute https URLs to external CDNs.
// Anything else (javascript:, data:, protocol-relative, path traversal, non-model extensions) is dropped.
function sanitizeModelUrl(raw, allowedExtensions = ['.glb', '.gltf']) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 2048) return null;
  const lowerPath = s.split(/[?#]/)[0].toLowerCase();
  if (!allowedExtensions.some(ext => lowerPath.endsWith(ext))) return null;
  if (/^https:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (u.username || u.password) return null;
      return u.toString();
    } catch (_) {
      return null;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//') || s.includes('..') || s.includes('\\')) return null;
  return s.replace(/^\.?\//, '');
}

function sanitizeHex(hex) {
  return typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex.trim()) ? hex.trim().toUpperCase() : null;
}

function cleanText(value, max = 400) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

function uniqueStrings(list) {
  return Array.from(new Set((Array.isArray(list) ? list : []).filter(s => typeof s === 'string' && s.trim()).map(s => s.trim())));
}

function finiteDims(d) {
  if (!d || typeof d !== 'object') return null;
  const out = {};
  for (const k of ['length', 'width', 'height']) {
    const n = Number(d[k]);
    if (!Number.isFinite(n) || n <= 0.2 || n > 30) return null;
    out[k] = Math.round(n * 1000) / 1000;
  }
  return out;
}

function resolveMaterials(glbUrl, carId, bindings) {
  if (VERIFIED_MATERIAL_OVERRIDES[glbUrl]) {
    const o = VERIFIED_MATERIAL_OVERRIDES[glbUrl];
    return { body: [...o.body], rims: [...o.rims], source: 'verified-override' };
  }
  const entry = Object.values(bindings.vehicles || {}).find(b => b && b.carId === carId && (b.studioGlbUrl === glbUrl || b.glbUrl === glbUrl))
    || (bindings.vehicles || {})[carId];
  if (!entry) return { body: [], rims: [], source: 'none' };
  return {
    body: entry.fallbackPaintUsed ? [] : uniqueStrings(entry.paintMaterials),
    // Drop names that matched /rim/ only as a substring of "trim".
    rims: uniqueStrings(entry.rimMaterials).filter(n => !/trim/i.test(n)),
    source: 'bindings'
  };
}

function buildHotspots(vehicle, dims) {
  const list = (vehicle && vehicle.model3d && Array.isArray(vehicle.model3d.hotspots)) ? vehicle.model3d.hotspots : [];
  const scale = dims ? Math.max(dims.length, dims.width, dims.height) / SHOWROOM_NORMALIZED_MAX_DIM_M : 1;
  return list
    .filter(h => h && Array.isArray(h.pos) && h.pos.length === 3 && h.pos.every(n => Number.isFinite(Number(n))))
    .slice(0, 12)
    .map((h, i) => ({
      id: cleanText(h.id || `hotspot-${i + 1}`, 64),
      name: cleanText(h.name, 120),
      category: cleanText(h.category, 80),
      description: cleanText(h.desc || h.description, 600),
      // Converted to real-world metres in the model's ground-centred frame.
      position: h.pos.map(n => Math.round(Number(n) * scale * 1000) / 1000)
    }));
}

/**
 * @param {object} vehicle  vehicle record from VehicleRepository
 * @param {object} [opts]   { registry, bindings } overrides for tests
 * @returns {object|null}   manifest, or null when the vehicle has no usable 3D model
 */
function buildArManifest(vehicle, opts = {}) {
  if (!vehicle || typeof vehicle !== 'object' || !vehicle.id) return null;
  const sources = loadSources();
  const registry = opts.registry || sources.registry;
  const bindings = opts.bindings || sources.bindings;
  const reg = (registry.vehicles || {})[vehicle.id] || null;

  const model3d = vehicle.model3d || {};
  if (model3d.enabled === false || model3d.arSupported === false) return null;

  const glbUrl = sanitizeModelUrl(reg && reg.glbUrl) || sanitizeModelUrl(model3d.glbPath);
  if (!glbUrl) return null;

  const dims = finiteDims(reg && reg.dimensionsMeters);
  const certified = Boolean(reg && reg.arScaleCertified && reg.readiness === 'verified');

  const colors = (Array.isArray(vehicle.colors) ? vehicle.colors : [])
    .map((c, index) => ({ index, name: cleanText(c && c.name, 120), hex: sanitizeHex(c && c.hex) }))
    .filter(c => c.hex)
    .slice(0, 16);

  const variants = (reg && Array.isArray(reg.configurations) ? reg.configurations : [])
    .map(c => ({
      colorIndex: Number.isInteger(c.colorIndex) ? c.colorIndex : -1,
      name: cleanText(c.name, 120),
      hex: sanitizeHex(c.hex),
      glbUrl: sanitizeModelUrl(c.glbUrl)
    }))
    .filter(v => v.colorIndex >= 0 && v.glbUrl);

  const materials = resolveMaterials(glbUrl, vehicle.id, bindings);
  const usdzUrl = sanitizeModelUrl(reg && reg.usdzUrl, ['.usdz']) || sanitizeModelUrl(model3d.usdzPath, ['.usdz']);
  const hotspots = buildHotspots(vehicle, dims);

  // Door animation clip names are only reported when the data explicitly declares them.
  // No current GLB contains door clips; the client additionally verifies the clip exists after loading.
  const animations = {
    openDoors: cleanText(model3d.animations && model3d.animations.openDoors, 120) || null,
    closeDoors: cleanText(model3d.animations && model3d.animations.closeDoors, 120) || null
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    vehicleId: vehicle.id,
    name: cleanText(vehicle.name, 160),
    brand: cleanText(vehicle.brand, 80),
    category: cleanText(vehicle.category, 80),
    priceFormatted: cleanText(vehicle.priceFormatted || vehicle.salePriceFormatted, 60),
    readiness: certified ? 'verified' : 'unverified',
    model: {
      glbUrl,
      usdzUrl,
      unit: 'meters',
      scale: 1,
      // certified: the file is authored 1:1, ground at y=0 — use as is.
      // fit-to-length: rescale so the longest horizontal extent equals dimensionsMeters.length.
      scaleMode: certified ? 'certified' : (dims ? 'fit-to-length' : 'as-authored'),
      dimensionsMeters: dims,
      fileSizeBytes: Number.isFinite(Number(reg && reg.fileSizeBytes)) ? Number(reg.fileSizeBytes) : null
    },
    variants,
    colors,
    wheels: WHEEL_FINISH_OPTIONS.map(w => ({ ...w, finish: { ...w.finish } })),
    materials: {
      body: materials.body,
      rims: materials.rims,
      source: materials.source,
      protectedPatterns: uniqueStrings(bindings.protectedMaterialPatterns)
    },
    animations,
    hotspots,
    features: {
      changeColor: colors.length > 0 && (materials.body.length > 0 || variants.length > 0),
      changeWheels: materials.rims.length > 0,
      doorAnimations: Boolean(animations.openDoors),
      hotspots: hotspots.length > 0,
      quickLook: Boolean(usdzUrl),
      sceneViewer: true,
      webxr: true
    }
  };
}

module.exports = {
  SCHEMA_VERSION,
  SHOWROOM_NORMALIZED_MAX_DIM_M,
  WHEEL_FINISH_OPTIONS,
  buildArManifest,
  sanitizeModelUrl,
  resetCache
};
