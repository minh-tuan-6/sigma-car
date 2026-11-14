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

/**
 * @param {unknown} raw
 * @param {string} expectedVehicleId
 * @returns {object} sanitised manifest
 */
export function validateManifest(raw, expectedVehicleId) {
  const problems = [];
  if (!raw || typeof raw !== 'object') throw new ManifestError('INVALID_MANIFEST', 'Manifest AR rỗng.');
  if (raw.schemaVersion !== 1) problems.push(`schemaVersion ${raw.schemaVersion} không được hỗ trợ`);
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

  const wheels = (Array.isArray(raw.wheels) ? raw.wheels : [])
    .filter(w => w && /^[a-z0-9-]{1,40}$/.test(String(w.id || '')) && w.finish && HEX_RE.test(String(w.finish.color || '')))
    .slice(0, 8)
    .map(w => ({
      id: w.id,
      label: text(w.label, 40) || w.id,
      name: text(w.name, 80),
      finish: {
        color: String(w.finish.color).toUpperCase(),
        roughness: num(w.finish.roughness, 0, 1) ?? 0.3,
        metalness: num(w.finish.metalness, 0, 1) ?? 0.9
      }
    }));

  const materials = raw.materials && typeof raw.materials === 'object' ? raw.materials : {};
  const body = strList(materials.body);
  const rims = strList(materials.rims);
  const protectedPatterns = strList(materials.protectedPatterns, 64).map(s => s.toLowerCase());

  const anim = raw.animations && typeof raw.animations === 'object' ? raw.animations : {};
  const animations = { openDoors: text(anim.openDoors, 120) || null, closeDoors: text(anim.closeDoors, 120) || null };

  const hotspots = (Array.isArray(raw.hotspots) ? raw.hotspots : [])
    .filter(h => h && Array.isArray(h.position) && h.position.length === 3 && h.position.every(n => num(n, -20, 20) !== null))
    .slice(0, 12)
    .map((h, i) => ({
      id: text(h.id, 64) || `hotspot-${i + 1}`,
      name: text(h.name, 120) || `Điểm ${i + 1}`,
      category: text(h.category, 80),
      description: text(h.description, 600),
      position: h.position.map(Number)
    }));

  const usdzUrl = modelPath(model.usdzUrl, ['.usdz']);
  const declared = raw.features && typeof raw.features === 'object' ? raw.features : {};

  return {
    schemaVersion: 1,
    vehicleId: raw.vehicleId,
    name: text(raw.name, 160) || raw.vehicleId,
    brand: text(raw.brand, 80),
    category: text(raw.category, 80),
    priceFormatted: text(raw.priceFormatted, 60),
    readiness: raw.readiness === 'verified' ? 'verified' : 'unverified',
    model: {
      glbUrl,
      usdzUrl,
      unit: 'meters',
      scaleMode,
      dimensionsMeters: dims,
      fileSizeBytes: num(model.fileSizeBytes, 1, 2e9)
    },
    variants,
    colors,
    wheels,
    materials: { body, rims, protectedPatterns },
    animations,
    hotspots,
    // Re-derived: declared flags can only switch a feature OFF, never on without supporting data.
    features: {
      changeColor: declared.changeColor !== false && colors.length > 0 && (body.length > 0 || variants.length > 0),
      changeWheels: declared.changeWheels !== false && wheels.length > 0 && rims.length > 0,
      doorAnimations: declared.doorAnimations !== false && Boolean(animations.openDoors),
      hotspots: declared.hotspots !== false && hotspots.length > 0,
      quickLook: Boolean(usdzUrl)
    }
  };
}
