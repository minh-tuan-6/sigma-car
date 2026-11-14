// backend/application/ar-manifest-service.js
// Builds the per-vehicle AR manifest served at GET /api/v1/vehicles/:vehicleId/ar-manifest.
//
// Schema v2 — Apple AR Quick Look only (the WebXR / Scene Viewer / wheel / hotspot / door fields of v1 were removed).
//
// Sources (all real repository data, nothing invented):
//   - vehicle record (VehicleRepository)            → name, colours, model3d.glbPath, model3d.usdzPath
//   - data/ar-manifest.json (generate_ar_manifest)  → AR GLB, per-colour variants, dimensions, readiness, usdzUrl
//   - assets/models/manifests/bindings.json         → paint material names detected in each GLB
//   - data/usdz-assets.json (scripts/build_usdz.js) → USDZ files pre-built from those GLBs, per colour
//
// The same builder is used by scripts/build_dist.js to emit static snapshots (dist/data/ar/<id>.json)
// so the AR page still works on static hosting when the API is unreachable.

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const REGISTRY_FILE = path.join(ROOT_DIR, 'data', 'ar-manifest.json');
const BINDINGS_FILE = path.join(ROOT_DIR, 'assets', 'models', 'manifests', 'bindings.json');
const USDZ_INDEX_FILE = path.join(ROOT_DIR, 'data', 'usdz-assets.json');

const SCHEMA_VERSION = 2;

// Material names verified by parsing the GLB JSON chunk of the listed files (2026-11-14 audit).
// bindings.json does not detect Material_Body as the paint material in these files.
const VERIFIED_MATERIAL_OVERRIDES = {
  'assets/models/ar/tesla_cybertruck_ar_v1.glb': { body: ['Material_Body'] },
  'assets/models/ar/tesla_cybertruck_ar_stealth_black.glb': { body: ['Material_Body'] },
  'assets/models/ar/tesla_cybertruck_ar_ceramic_white.glb': { body: ['Material_Body'] },
  'assets/models/ar/tesla_cybertruck_ar_tactical_green.glb': { body: ['Material_Body'] }
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
      bindings: readJsonSafe(BINDINGS_FILE) || { vehicles: {}, protectedMaterialPatterns: [] },
      usdzIndex: readJsonSafe(USDZ_INDEX_FILE) || { vehicles: {} }
    };
  }
  return cache;
}

function resetCache() {
  cache = null;
}

// Accepts site-relative asset paths ("assets/models/x.glb") or absolute https URLs to external CDNs.
// Anything else (javascript:, data:, protocol-relative, path traversal, other extensions) is dropped.
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

function resolveBodyMaterials(glbUrl, carId, bindings) {
  if (VERIFIED_MATERIAL_OVERRIDES[glbUrl]) {
    return { body: [...VERIFIED_MATERIAL_OVERRIDES[glbUrl].body], source: 'verified-override' };
  }
  const entry = Object.values(bindings.vehicles || {}).find(b => b && b.carId === carId && (b.studioGlbUrl === glbUrl || b.glbUrl === glbUrl))
    || (bindings.vehicles || {})[carId];
  if (!entry) return { body: [], source: 'none' };
  return { body: entry.fallbackPaintUsed ? [] : uniqueStrings(entry.paintMaterials), source: 'bindings' };
}

// Cloudflare Pages refuses any single static file above 25 MiB (platform limit). Pre-built USDZ files above it
// are served from SIGMACAR_USDZ_PUBLIC_BASE_URL instead (e.g. an R2 public bucket or another HTTPS host).
const PAGES_MAX_FILE_BYTES = 25 * 1024 * 1024;

function usdzPublicBaseUrl(override) {
  const raw = override !== undefined ? override : process.env.SIGMACAR_USDZ_PUBLIC_BASE_URL;
  if (!raw) return null;
  try {
    const u = new URL(String(raw).trim());
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u.toString().replace(/\/+$/, '');
  } catch (_) {
    return null;
  }
}

// Where a pre-built file is served from.
//   * staticHostable (≤ 25 MiB): the site itself (relative path; Pages, server.js);
//   * larger: the external base URL when configured; otherwise the site path — server.js and other hosts serve it,
//     but a Pages snapshot build (opts.staticHostOnly) omits it so the page converts on the device instead of
//     fetching a file that is not deployed.
function prebuiltUsdzUrl(entry, rel, { publicBase, staticHostOnly }) {
  const hostable = entry.staticHostable !== false && !(Number(entry.bytes) > PAGES_MAX_FILE_BYTES);
  const version = entry.sha256 ? `?v=${String(entry.sha256).slice(0, 12)}` : '';
  if (hostable) return `${rel}${version}`;
  if (publicBase) return `${publicBase}/${rel.replace(/^assets\/models\/usdz\//, '')}${version}`;
  return staticHostOnly ? null : `${rel}${version}`;
}

// USDZ files for AR Quick Look, in priority order per colour:
//   1. pre-built by scripts/build_usdz.js (data/usdz-assets.json);
//   2. declared in data: registry configurations[].usdzUrl (per colour), registry usdzUrl / model3d.usdzPath (any colour).
function collectUsdz(vehicle, reg, usdzIndex, colors, { publicBase = null, staticHostOnly = false } = {}) {
  const out = [];
  const seen = new Set();
  const colorIdx = new Set(colors.map(c => c.index));
  const push = (colorIndex, url, source, bytes) => {
    const key = String(colorIndex);
    if (!url || seen.has(key)) return;
    if (colorIndex !== null && !colorIdx.has(colorIndex)) return;
    seen.add(key);
    out.push({ colorIndex, url, source, bytes: Number.isFinite(Number(bytes)) && Number(bytes) > 0 ? Number(bytes) : null });
  };

  const built = (usdzIndex && usdzIndex.vehicles && usdzIndex.vehicles[vehicle.id]) || [];
  for (const e of Array.isArray(built) ? built : []) {
    const rel = sanitizeModelUrl(e && e.path, ['.usdz']);
    if (!rel || /^https:/i.test(rel)) continue;
    const external = Boolean(publicBase) && (e.staticHostable === false || Number(e.bytes) > PAGES_MAX_FILE_BYTES);
    // A local file must exist unless it is served from the external base URL (fresh clones do not contain the
    // large files: they are git-ignored build output).
    if (!external && !fs.existsSync(path.join(ROOT_DIR, rel))) continue;
    // Content hash in the query string: the files are served with a 1-year immutable cache.
    const url = prebuiltUsdzUrl(e, rel, { publicBase, staticHostOnly });
    if (url) push(Number.isInteger(e.colorIndex) ? e.colorIndex : null, url, 'prebuilt', e.bytes);
  }
  for (const c of (reg && Array.isArray(reg.configurations)) ? reg.configurations : []) {
    if (Number.isInteger(c.colorIndex)) push(c.colorIndex, sanitizeModelUrl(c.usdzUrl, ['.usdz']), 'external', null);
  }
  const model3d = vehicle.model3d || {};
  push(null, sanitizeModelUrl(reg && reg.usdzUrl, ['.usdz']) || sanitizeModelUrl(model3d.usdzPath, ['.usdz']), 'external', null);
  return out;
}

/**
 * @param {object} vehicle  vehicle record from VehicleRepository
 * @param {object} [opts]   { registry, bindings, usdzIndex, usdzPublicBaseUrl } overrides for tests;
 *                          staticHostOnly: true for Pages snapshots (omit files Pages cannot host when no base URL)
 * @returns {object|null}   manifest, or null when the vehicle has no usable 3D model
 */
function buildArManifest(vehicle, opts = {}) {
  if (!vehicle || typeof vehicle !== 'object' || !vehicle.id) return null;
  const sources = loadSources();
  const registry = opts.registry || sources.registry;
  const bindings = opts.bindings || sources.bindings;
  const usdzIndex = opts.usdzIndex || sources.usdzIndex;
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
      glbUrl: sanitizeModelUrl(c.glbUrl)
    }))
    .filter(v => v.colorIndex >= 0 && v.glbUrl);

  const materials = resolveBodyMaterials(glbUrl, vehicle.id, bindings);
  const usdz = collectUsdz(vehicle, reg, usdzIndex, colors, {
    publicBase: usdzPublicBaseUrl(opts.usdzPublicBaseUrl),
    staticHostOnly: Boolean(opts.staticHostOnly)
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    vehicleId: vehicle.id,
    name: cleanText(vehicle.name, 160),
    brand: cleanText(vehicle.brand, 80),
    priceFormatted: cleanText(vehicle.priceFormatted || vehicle.salePriceFormatted, 60),
    readiness: certified ? 'verified' : 'unverified',
    model: {
      glbUrl,
      unit: 'meters',
      // certified: the file is authored 1:1, ground at y=0 — use as is.
      // fit-to-length: rescale so the longest horizontal extent equals dimensionsMeters.length.
      scaleMode: certified ? 'certified' : (dims ? 'fit-to-length' : 'as-authored'),
      dimensionsMeters: dims,
      fileSizeBytes: reg && Number(reg.fileSizeBytes) > 0 ? Number(reg.fileSizeBytes) : null
    },
    variants,
    colors,
    materials: {
      body: materials.body,
      source: materials.source,
      protectedPatterns: uniqueStrings(bindings.protectedMaterialPatterns)
    },
    appleAr: {
      usdz,
      // The AR page can convert the GLB it shows into USDZ on the iPhone/iPad (three.js USDZExporter) when no
      // file exists for the selected colour. The client re-checks the loaded model (e.g. KTX2 textures block it).
      onDeviceConversion: true,
      allowsContentScaling: false
    },
    features: {
      changeColor: colors.length > 0 && (materials.body.length > 0 || variants.length > 0),
      quickLook: true
    }
  };
}

module.exports = {
  SCHEMA_VERSION,
  PAGES_MAX_FILE_BYTES,
  usdzPublicBaseUrl,
  buildArManifest,
  sanitizeModelUrl,
  resetCache
};
