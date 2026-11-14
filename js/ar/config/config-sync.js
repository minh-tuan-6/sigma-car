// js/ar/config/config-sync.js — Vehicle Configuration Sync between the website (js/app.js) and the AR page.
//
// Shared contract with js/app.js:
//   sessionStorage["sigmacar_vehicle_configs_v1"] = { [vehicleId]: { colorIdx, colorHex, colorName, wheelId, rotationAngle } }
// URL params on /ar/:vehicleId (?color=<idx>&wheel=<id>) take precedence so links are shareable.

export const CONFIG_STORAGE_KEY = 'sigmacar_vehicle_configs_v1';
const WHEEL_ID_RE = /^[a-z0-9-]{1,40}$/;

function safeStorage(storage) {
  if (storage) return storage;
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch (_) {
    return null; // blocked storage (privacy mode / sandbox)
  }
}

export function readAllConfigs(storage) {
  const s = safeStorage(storage);
  if (!s) return {};
  try {
    const parsed = JSON.parse(s.getItem(CONFIG_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

/**
 * Resolves the configuration for the AR session.
 * @returns {{ colorIdx: number, wheelId: string|null }}
 */
export function readConfig(vehicleId, { search = '', storage, colorCount = 0, wheelIds = [] } = {}) {
  const stored = readAllConfigs(storage)[vehicleId] || {};
  const params = new URLSearchParams(search);
  const clampColor = (v) => {
    const n = Number.parseInt(v, 10);
    return Number.isInteger(n) && n >= 0 && (colorCount === 0 || n < colorCount) ? n : null;
  };
  const validWheel = (w) => (typeof w === 'string' && WHEEL_ID_RE.test(w) && (wheelIds.length === 0 || wheelIds.includes(w)) ? w : null);

  return {
    colorIdx: clampColor(params.get('color')) ?? clampColor(stored.colorIdx) ?? 0,
    wheelId: validWheel(params.get('wheel')) ?? validWheel(stored.wheelId) ?? (wheelIds[0] || null)
  };
}

/** Merges updates into the shared store; returns the merged entry. */
export function writeConfig(vehicleId, updates, { storage } = {}) {
  const s = safeStorage(storage);
  const all = readAllConfigs(s);
  const merged = { ...(all[vehicleId] || {}), ...updates, updatedFrom: 'ar', updatedAt: Date.now() };
  all[vehicleId] = merged;
  if (s) {
    try { s.setItem(CONFIG_STORAGE_KEY, JSON.stringify(all)); } catch (_) {}
  }
  return merged;
}

/**
 * Where "Back to showroom" goes. Only same-origin, hash-routed SPA destinations are accepted
 * (prevents open redirects via ?return=). Defaults to the vehicle detail page with the colour applied.
 */
export function buildReturnUrl(vehicleId, { returnParam = null, colorIdx = null } = {}) {
  const fallback = `/#detail?carId=${encodeURIComponent(vehicleId)}${Number.isInteger(colorIdx) ? `&colorIdx=${colorIdx}` : ''}`;
  if (typeof returnParam !== 'string' || !returnParam) return fallback;
  if (!/^\/#[a-z0-9-]{1,40}(\?[A-Za-z0-9_\-=&%.,]*)?$/.test(returnParam)) return fallback;
  const [hashRoute, query = ''] = returnParam.slice(2).split('?');
  const q = new URLSearchParams(query);
  q.set('carId', vehicleId);
  if (Number.isInteger(colorIdx)) q.set('colorIdx', String(colorIdx));
  return `/#${hashRoute}?${q.toString()}`;
}

/** Checkout hand-off reuses the site's existing checkout route & params (no duplicated business logic). */
export function buildCheckoutUrl(vehicleId, { colorName } = {}) {
  const q = new URLSearchParams({ source: 'ar', vehicleId });
  if (colorName) q.set('colorName', colorName);
  return `/#checkout?${q.toString()}`;
}
