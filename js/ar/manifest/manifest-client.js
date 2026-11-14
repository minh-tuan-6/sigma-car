// js/ar/manifest/manifest-client.js — loads the AR manifest for a vehicle.
//
// Order: live API (GET /api/v1/vehicles/:id/ar-manifest) → published static snapshot (/data/ar/:id.json,
// generated at build time by the same backend builder). The snapshot is used ONLY when the API is
// unreachable (static host / proxy outage / network), never when the API answers authoritatively (e.g. 404),
// and the returned `source` is surfaced in the UI.

import { validateManifest, ManifestError, isValidVehicleId } from './manifest-schema.js';

const PROXY_OUTAGE_CODES = ['BACKEND_NOT_CONFIGURED', 'BACKEND_ORIGIN_INVALID', 'BACKEND_UNREACHABLE', 'UPSTREAM_TIMEOUT', 'UPSTREAM_INVALID_RESPONSE'];

async function getJson(url, { fetchImpl, signal, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: controller.signal, credentials: 'same-origin' });
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    const proxyError = res.headers.get('x-sigma-proxy-error');
    let body = null;
    if (!ctype.includes('text/html')) {
      try { body = await res.json(); } catch (_) { body = null; }
    }
    return { status: res.status, ok: res.ok, html: ctype.includes('text/html'), proxyError, body };
  } catch (err) {
    if (signal && signal.aborted) throw new ManifestError('ABORTED', 'Đã huỷ.');
    return { status: 0, ok: false, network: true, error: err };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * @returns {Promise<{ manifest: object, source: 'api'|'static-snapshot', apiStatus: string }>}
 */
export async function fetchArManifest(vehicleId, {
  fetchImpl = fetch.bind(globalThis),
  apiBase = '/api/v1',
  staticBase = '/data/ar',
  signal,
  timeoutMs = 10000
} = {}) {
  if (!isValidVehicleId(vehicleId)) throw new ManifestError('INVALID_VEHICLE_ID', 'Mã xe không hợp lệ.');
  const id = encodeURIComponent(vehicleId);

  const api = await getJson(`${apiBase}/vehicles/${id}/ar-manifest`, { fetchImpl, signal, timeoutMs });

  if (api.ok && api.body && api.body.success && api.body.data) {
    return { manifest: validateManifest(api.body.data, vehicleId), source: 'api', apiStatus: 'online' };
  }

  const apiUnavailable = api.network || api.html || (api.proxyError && PROXY_OUTAGE_CODES.includes(api.proxyError))
    || (api.status === 404 && !api.body); // static host without SPA rewrite
  if (!apiUnavailable) {
    const code = (api.body && api.body.error && api.body.error.code) || `HTTP_${api.status}`;
    const message = (api.body && api.body.error && api.body.error.message) || `Máy chủ trả về lỗi HTTP ${api.status}.`;
    throw new ManifestError(code === 'NOT_FOUND' || code === 'AR_MODEL_UNAVAILABLE' ? code : 'API_ERROR', message);
  }

  const apiStatus = api.network ? 'offline' : (api.html ? 'static-host' : (api.proxyError || 'unavailable'));
  const snap = await getJson(`${staticBase}/${id}.json`, { fetchImpl, signal, timeoutMs });
  if (snap.ok && snap.body && !snap.html) {
    return { manifest: validateManifest(snap.body, vehicleId), source: 'static-snapshot', apiStatus };
  }
  throw new ManifestError(snap.status === 404 || snap.html ? 'NOT_FOUND' : 'MANIFEST_UNAVAILABLE',
    'Không tải được dữ liệu AR của xe (máy chủ API không khả dụng và không có bản manifest tĩnh).');
}
