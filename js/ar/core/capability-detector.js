// js/ar/core/capability-detector.js — AR Capability Detector.
// Detection never requests camera permission; it only inspects APIs that are side-effect free.

export function detectPlatform(nav = (typeof navigator !== 'undefined' ? navigator : {})) {
  const ua = String(nav.userAgent || '');
  const platform = String(nav.platform || '');
  const touch = Number(nav.maxTouchPoints || 0);
  // iPadOS 13+ reports a desktop Mac user agent; touch support gives it away.
  const ios = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && touch > 1);
  const android = /Android/i.test(ua);
  const mobile = ios || android || /Mobi/i.test(ua);
  return {
    os: ios ? 'ios' : (android ? 'android' : (mobile ? 'mobile-other' : 'desktop')),
    ios,
    android,
    mobile,
    // In-app browsers (Facebook/Instagram/Zalo/Line/WeChat) commonly block WebXR / camera / intents.
    inAppBrowser: /FBAN|FBAV|Instagram|Zalo|Line\/|MicroMessenger|; wv\)/i.test(ua),
    chromium: /Chrome\/|CriOS\//.test(ua) && !/Edg\//.test(ua),
    safari: /Safari\//.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua)
  };
}

/**
 * @param {{ navigator?, window?, document? }} [env]  injectable for tests
 * @returns {Promise<object>} capability report
 */
export async function detectCapabilities(env = {}) {
  const nav = env.navigator || (typeof navigator !== 'undefined' ? navigator : {});
  const win = env.window || (typeof window !== 'undefined' ? window : {});
  const doc = env.document || (typeof document !== 'undefined' ? document : null);
  const platform = detectPlatform(nav);

  const secureContext = win.isSecureContext !== false;
  const hasXR = Boolean(nav.xr && typeof nav.xr.isSessionSupported === 'function');
  let immersiveAr = false;
  let xrError = null;
  if (hasXR && secureContext) {
    try {
      // Some desktop runtimes (e.g. OpenXR probing on Windows) can stall this query for seconds; bound it.
      const timeoutMs = env.xrQueryTimeoutMs || 2500;
      let timer;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'XR_QUERY_TIMEOUT' })), timeoutMs); });
      try {
        immersiveAr = Boolean(await Promise.race([nav.xr.isSessionSupported('immersive-ar'), timeout]));
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      xrError = (err && err.name) || 'XR_QUERY_FAILED'; // e.g. SecurityError when blocked by Permissions-Policy
    }
  }

  let quickLook = false;
  if (platform.ios && doc && typeof doc.createElement === 'function') {
    try {
      const a = doc.createElement('a');
      quickLook = Boolean(a.relList && typeof a.relList.supports === 'function' && a.relList.supports('ar'));
    } catch (_) {
      quickLook = false;
    }
  }

  let webgl = false;
  if (doc && typeof doc.createElement === 'function') {
    try {
      const c = doc.createElement('canvas');
      webgl = Boolean(c.getContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (_) {
      webgl = false;
    }
  }

  return {
    platform,
    secureContext,
    webxr: hasXR,
    immersiveAr,
    xrError,
    quickLook,
    // Scene Viewer is an Android intent; availability (Google app / ARCore) cannot be detected from JS.
    sceneViewer: platform.android && !platform.inAppBrowser,
    webgl
  };
}

/**
 * Chooses the experience for this device + vehicle. Never presents a non-AR mode as AR.
 * @returns {{ mode: 'webxr'|'quick-look'|'scene-viewer'|'preview-3d', reason: string, alternatives: string[] }}
 */
export function chooseExperience(caps, manifest) {
  const alternatives = [];
  const hasUsdz = Boolean(manifest && manifest.model && manifest.model.usdzUrl);

  if (!caps.webgl) return { mode: 'unsupported', reason: 'NO_WEBGL', alternatives };
  if (!caps.secureContext) return { mode: 'preview-3d', reason: 'INSECURE_CONTEXT', alternatives };

  if (caps.immersiveAr) {
    if (caps.platform.android && caps.sceneViewer) alternatives.push('scene-viewer');
    return { mode: 'webxr', reason: 'IMMERSIVE_AR_SUPPORTED', alternatives };
  }
  if (caps.platform.ios) {
    if (caps.quickLook && hasUsdz) return { mode: 'quick-look', reason: 'IOS_QUICK_LOOK', alternatives };
    return { mode: 'preview-3d', reason: caps.quickLook ? 'IOS_NO_USDZ_ASSET' : 'IOS_NO_QUICK_LOOK', alternatives };
  }
  if (caps.platform.android) {
    if (caps.sceneViewer) return { mode: 'scene-viewer', reason: caps.xrError ? 'WEBXR_BLOCKED' : 'NO_IMMERSIVE_AR', alternatives };
    return { mode: 'preview-3d', reason: caps.platform.inAppBrowser ? 'IN_APP_BROWSER' : 'NO_IMMERSIVE_AR', alternatives };
  }
  return { mode: 'preview-3d', reason: caps.platform.mobile ? 'NO_IMMERSIVE_AR' : 'DESKTOP', alternatives };
}
