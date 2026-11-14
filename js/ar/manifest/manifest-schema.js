// js/ar/manifest/manifest-schema.js — client-side validation of the AR manifest.
// The manifest is metadata from the network; it is sanitised here and features are re-derived
// conservatively (a feature is only enabled when the data needed to implement it is present).
// The loaded GLB is checked again later (material / clip names must really exist).

export class ManifestError extends Error {
  constructor(code, message, problems = []) {
    super(message);
    this.name = 'ManifestError';
    this.code = code;
    this.problems = problems;
  }
}

const VEHICLE_ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

export function isValidVehicleId(id) {
  return typeof id === 'string' && VEHICLE_ID_RE.test(id);
}

function text(v, max = 400) {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';
}

function strList(v, max = 32) {
  return Array.isArray(v) ? Array.from(new Set(v.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim().slice(0, 160)))).slice(0, max) : [];
}

function num(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function modelPath(v, exts) {
  if (typeof v !== 'string' || !v.trim() || v.length > 2048) return null;
  const s = v.trim();
  const path = s.split(/[?#]/)[0].toLowerCase();
  if (!exts.some(e => path.endsWith(e))) return null;
  if (/^https:\/\//i.test(s)) return s;
  // Loopback http is accepted for local development only (same rule as models/url-policy.js).
  if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//') || s.includes('..') || s.includes('\\')) return null;
  return s;
}

export const MANIFEST_SCHEMA_VERSION = 2;

/**
 * @param {unknown} raw
 * @param {string} expectedVehicleId
 * @returns {object} sanitised manifest
 */
export function validateManifest(raw, expectedVehicleId) {
  const problems = [];
  if (!raw || typeof raw !== 'object') throw new ManifestError('INVALID_MANIFEST', 'Manifest AR rỗng.');
  if (raw.schemaVersion !== MANIFEST_SCHEMA_VERSION) problems.push(`schemaVersion ${raw.schemaVersion} không được hỗ trợ`);
  if (!isValidVehicleId(raw.vehicleId)) problems.push('vehicleId không hợp lệ');
  if (expectedVehicleId && raw.vehicleId !== expectedVehicleId) problems.push('vehicleId không khớp với xe được yêu cầu');

  const model = raw.model && typeof raw.model === 'object' ? raw.model : {};
  const glbUrl = modelPath(model.glbUrl, ['.glb', '.gltf']);
  if (!glbUrl) problems.push('model.glbUrl thiếu hoặc không hợp lệ');
  if (problems.length) throw new ManifestError('INVALID_MANIFEST', `Manifest AR không hợp lệ: ${problems.join('; ')}.`, problems);

  const dimsIn = model.dimensionsMeters || null;
  const dims = dimsIn && ['length', 'width', 'height'].every(k => num(dimsIn[k], 0.2, 30) !== null)
    ? { length: Number(dimsIn.length), width: Number(dimsIn.width), height: Number(dimsIn.height) }
    : null;
  const scaleMode = ['certified', 'fit-to-length', 'as-authored'].includes(model.scaleMode) ? model.scaleMode : (dims ? 'fit-to-length' : 'as-authored');

  const colors = (Array.isArray(raw.colors) ? raw.colors : [])
    .filter(c => c && HEX_RE.test(String(c.hex || '')))
    .slice(0, 16)
    .map((c, i) => ({ index: Number.isInteger(c.index) ? c.index : i, name: text(c.name, 120) || String(c.hex).toUpperCase(), hex: String(c.hex).toUpperCase() }));

  const variants = (Array.isArray(raw.variants) ? raw.variants : [])
    .map(v => ({ colorIndex: Number.isInteger(v && v.colorIndex) ? v.colorIndex : -1, name: text(v && v.name, 120), glbUrl: modelPath(v && v.glbUrl, ['.glb', '.gltf']) }))
    .filter(v => v.colorIndex >= 0 && v.glbUrl)
    .slice(0, 16);

  const materials = raw.materials && typeof raw.materials === 'object' ? raw.materials : {};
  const body = strList(materials.body);
  const protectedPatterns = strList(materials.protectedPatterns, 64).map(s => s.toLowerCase());

  const apple = raw.appleAr && typeof raw.appleAr === 'object' ? raw.appleAr : {};
  const colorIndexes = new Set(colors.map(c => c.index));
  const seen = new Set();
  const usdz = (Array.isArray(apple.usdz) ? apple.usdz : [])
    .map(u => ({
      colorIndex: Number.isInteger(u && u.colorIndex) ? u.colorIndex : null,
      url: modelPath(u && u.url, ['.usdz']),
      source: u && u.source === 'prebuilt' ? 'prebuilt' : 'external',
      bytes: num(u && u.bytes, 1, 2e9)
    }))
    // A colour-specific file must refer to a colour that exists; one file per colour.
    .filter(u => u.url && (u.colorIndex === null || colorIndexes.has(u.colorIndex)))
    .filter(u => { const k = String(u.colorIndex); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 17);
  const onDeviceConversion = apple.onDeviceConversion === true;
  const declared = raw.features && typeof raw.features === 'object' ? raw.features : {};

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    vehicleId: raw.vehicleId,
    name: text(raw.name, 160) || raw.vehicleId,
    brand: text(raw.brand, 80),
    priceFormatted: text(raw.priceFormatted, 60),
    readiness: raw.readiness === 'verified' ? 'verified' : 'unverified',
    model: {
      glbUrl,
      unit: 'meters',
      scaleMode,
      dimensionsMeters: dims,
      fileSizeBytes: num(model.fileSizeBytes, 1, 2e9)
    },
    variants,
    colors,
    materials: { body, protectedPatterns },
    appleAr: { usdz, onDeviceConversion, allowsContentScaling: false },
    // Re-derived: declared flags can only switch a feature OFF, never on without supporting data.
    features: {
      changeColor: declared.changeColor !== false && colors.length > 0 && (body.length > 0 || variants.length > 0),
      quickLook: declared.quickLook !== false && (usdz.length > 0 || onDeviceConversion)
    }
  };
}
