// js/ar/models/url-policy.js — validation for model URLs coming from manifests (never trusted blindly).

export const MODEL_EXTENSIONS = ['.glb', '.gltf'];

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

/**
 * Validates and resolves a model URL.
 * Accepted: https:// URLs (any host unless allowedHosts is given), same-origin URLs, and http://localhost for dev.
 * @returns {{ ok: true, url: string, kind: 'glb'|'gltf', crossOrigin: boolean } | { ok: false, reason: string }}
 */
export function validateModelUrl(raw, { baseUrl, allowedHosts = [] } = {}) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'EMPTY_URL' };
  if (raw.length > 2048) return { ok: false, reason: 'URL_TOO_LONG' };
  const trimmed = raw.trim();
  if (trimmed.startsWith('//')) return { ok: false, reason: 'PROTOCOL_RELATIVE_URL' };

  let url;
  let base;
  try {
    base = baseUrl ? new URL(baseUrl) : null;
    url = base ? new URL(trimmed, base) : new URL(trimmed);
  } catch (_) {
    return { ok: false, reason: 'MALFORMED_URL' };
  }

  if (url.username || url.password) return { ok: false, reason: 'CREDENTIALS_IN_URL' };

  const sameOrigin = Boolean(base && url.origin === base.origin);
  if (url.protocol === 'https:') {
    // ok
  } else if (url.protocol === 'http:' && (sameOrigin || isLoopbackHost(url.hostname))) {
    // dev server / same-origin plain http
  } else {
    return { ok: false, reason: 'INSECURE_OR_UNSUPPORTED_PROTOCOL' };
  }

  if (!sameOrigin && Array.isArray(allowedHosts) && allowedHosts.length > 0 && !allowedHosts.includes(url.hostname)) {
    return { ok: false, reason: 'HOST_NOT_ALLOWED' };
  }

  const path = url.pathname.toLowerCase();
  const ext = MODEL_EXTENSIONS.find(e => path.endsWith(e));
  if (!ext) return { ok: false, reason: 'UNSUPPORTED_EXTENSION' };

  return { ok: true, url: url.toString(), kind: ext === '.glb' ? 'glb' : 'gltf', crossOrigin: !sameOrigin };
}

/**
 * Validates a USDZ URL for AR Quick Look (same rules as models: https, same-origin, or loopback http for dev).
 * AR Quick Look downloads the file itself, so CORS is not required for launching — only for in-page probing.
 * @returns {{ ok: true, url: string, crossOrigin: boolean } | { ok: false, reason: string }}
 */
export function validateUsdzUrl(raw, { baseUrl, allowedHosts = [] } = {}) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'EMPTY_URL' };
  if (raw.length > 2048) return { ok: false, reason: 'URL_TOO_LONG' };
  const trimmed = raw.trim();
  if (trimmed.startsWith('//')) return { ok: false, reason: 'PROTOCOL_RELATIVE_URL' };
  let url;
  let base;
  try {
    base = baseUrl ? new URL(baseUrl) : null;
    url = base ? new URL(trimmed, base) : new URL(trimmed);
  } catch (_) {
    return { ok: false, reason: 'MALFORMED_URL' };
  }
  if (url.username || url.password) return { ok: false, reason: 'CREDENTIALS_IN_URL' };
  const sameOrigin = Boolean(base && url.origin === base.origin);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && (sameOrigin || isLoopbackHost(url.hostname))))) {
    return { ok: false, reason: 'INSECURE_OR_UNSUPPORTED_PROTOCOL' };
  }
  if (!sameOrigin && Array.isArray(allowedHosts) && allowedHosts.length > 0 && !allowedHosts.includes(url.hostname)) {
    return { ok: false, reason: 'HOST_NOT_ALLOWED' };
  }
  if (!url.pathname.toLowerCase().endsWith('.usdz')) return { ok: false, reason: 'UNSUPPORTED_EXTENSION' };
  return { ok: true, url: url.toString(), crossOrigin: !sameOrigin };
}

/**
 * Policy for resources referenced *inside* a glTF (buffers, images). glTF JSON is untrusted, so only
 * https / same-origin http / data: / blob: (GLTFLoader uses blob: for GLB-embedded images) are allowed.
 */
export function isAllowedResourceUrl(raw, { baseUrl } = {}) {
  if (typeof raw !== 'string' || !raw) return false;
  if (raw.startsWith('blob:')) return true;
  if (raw.startsWith('data:')) return /^data:(application\/(octet-stream|gltf-buffer)|image\/(png|jpeg|webp|ktx2));base64,/i.test(raw);
  try {
    const base = baseUrl ? new URL(baseUrl) : null;
    const u = base ? new URL(raw, base) : new URL(raw);
    if (u.username || u.password) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ((base && u.origin === base.origin) || isLoopbackHost(u.hostname));
  } catch (_) {
    return false;
  }
}

// Directory of a model URL, used as GLTFLoader resourcePath so external .gltf siblings resolve correctly.
export function resourceBaseOf(modelUrl) {
  const u = new URL(modelUrl);
  u.search = '';
  u.hash = '';
  u.pathname = u.pathname.replace(/[^/]*$/, '');
  return u.toString();
}
