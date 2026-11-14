// js/ar/apple/apple-ar-support.js — Apple AR (AR Quick Look / ARKit) support detection.
//
// AR camera is offered ONLY on iPhone / iPad through Apple AR Quick Look. Detection order:
//   1. Feature detection: WebKit exposes `HTMLAnchorElement.relList.supports('ar')` exactly when the
//      browser can hand a USDZ file to AR Quick Look. This is the authoritative signal.
//   2. Device class: AR Quick Look with the camera exists on iOS / iPadOS only. A Mac (or anything else)
//      that reports rel="ar" support would open a non-camera 3D viewer, so it is not treated as AR.
//      iPadOS 13+ masquerades as macOS; touch points identify it. User-agent data is used only to
//      classify the device for messaging, never as the sole reason to launch AR.
// Nothing here requests camera permission. Quick Look owns the camera after the user taps.

export const SUPPORT_REASON = Object.freeze({
  QUICK_LOOK: 'QUICK_LOOK',                 // iPhone / iPad with AR Quick Look → AR can launch
  APPLE_NO_QUICK_LOOK: 'APPLE_NO_QUICK_LOOK', // iPhone / iPad browser without rel="ar" (in-app browser, old iOS)
  ANDROID: 'ANDROID',
  DESKTOP: 'DESKTOP',
  MAC: 'MAC',
  OTHER_MOBILE: 'OTHER_MOBILE',
  INSECURE_CONTEXT: 'INSECURE_CONTEXT'
});

/** Classifies the device for messaging. Feature detection decides whether AR may launch. */
export function classifyDevice(nav = (typeof navigator !== 'undefined' ? navigator : {})) {
  const ua = String(nav.userAgent || '');
  const platform = String((nav.userAgentData && nav.userAgentData.platform) || nav.platform || '');
  const touchPoints = Number(nav.maxTouchPoints || 0);
  const iPhone = /iPhone|iPod/.test(ua);
  const iPadUa = /iPad/.test(ua);
  // iPadOS 13+ default ("desktop website") UA is a Mac UA; real Macs report 0 touch points.
  const iPadDesktopUa = !iPadUa && /Macintosh|MacIntel/.test(ua + platform) && touchPoints > 1;
  const appleMobile = iPhone || iPadUa || iPadDesktopUa;
  const android = /Android/i.test(ua) || /^Android$/i.test(platform);
  const mac = !appleMobile && /Macintosh|MacIntel|macOS/i.test(ua + platform);
  const mobile = appleMobile || android || /Mobi|Tablet/i.test(ua) || Boolean(nav.userAgentData && nav.userAgentData.mobile);
  return {
    kind: appleMobile ? (iPhone ? 'iphone' : 'ipad') : (android ? 'android' : (mac ? 'mac' : (mobile ? 'mobile-other' : 'desktop'))),
    appleMobile,
    android,
    mac,
    mobile,
    // In-app browsers (Facebook / Instagram / Zalo / Line / WeChat) often expose WebKit but block Quick Look.
    inAppBrowser: /FBAN|FBAV|Instagram|Zalo|Line\/|MicroMessenger|GSA\//i.test(ua)
  };
}

/** True when this browser can hand a file to AR Quick Look (WebKit `rel="ar"`). */
export function supportsQuickLookRel(doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc || typeof doc.createElement !== 'function') return false;
  try {
    const a = doc.createElement('a');
    return Boolean(a.relList && typeof a.relList.supports === 'function' && a.relList.supports('ar'));
  } catch (_) {
    return false;
  }
}

/**
 * @param {{ navigator?, document?, window? }} [env]  injectable for tests
 * @returns {{ canLaunchAr: boolean, reason: string, device: object, quickLookRel: boolean, secureContext: boolean, webgl: boolean }}
 */
export function detectAppleArSupport(env = {}) {
  const nav = env.navigator || (typeof navigator !== 'undefined' ? navigator : {});
  const doc = env.document || (typeof document !== 'undefined' ? document : null);
  const win = env.window || (typeof window !== 'undefined' ? window : {});
  const device = classifyDevice(nav);
  const quickLookRel = supportsQuickLookRel(doc);
  const secureContext = win.isSecureContext !== false;

  let webgl = false;
  if (doc && typeof doc.createElement === 'function') {
    try {
      const c = doc.createElement('canvas');
      webgl = Boolean(c.getContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (_) {
      webgl = false;
    }
  }

  let reason;
  if (device.appleMobile) {
    if (!secureContext) reason = SUPPORT_REASON.INSECURE_CONTEXT;
    else reason = quickLookRel ? SUPPORT_REASON.QUICK_LOOK : SUPPORT_REASON.APPLE_NO_QUICK_LOOK;
  } else if (device.android) {
    reason = SUPPORT_REASON.ANDROID;
  } else if (device.mac) {
    reason = SUPPORT_REASON.MAC;
  } else {
    reason = device.mobile ? SUPPORT_REASON.OTHER_MOBILE : SUPPORT_REASON.DESKTOP;
  }

  return {
    canLaunchAr: reason === SUPPORT_REASON.QUICK_LOOK,
    reason,
    device,
    quickLookRel,
    secureContext,
    webgl
  };
}

/** User-facing explanation for every outcome. Never describes the 3D preview as AR. */
export const SUPPORT_MESSAGES = Object.freeze({
  QUICK_LOOK: '',
  APPLE_NO_QUICK_LOOK: 'Trình duyệt này không mở được AR Quick Look. Hãy mở trang bằng Safari trên iPhone/iPad.',
  ANDROID: 'AR Camera chỉ khả dụng trên iPhone/iPad tương thích.',
  DESKTOP: 'AR Camera chỉ khả dụng trên iPhone/iPad tương thích. Quét mã QR bằng iPhone/iPad để mở.',
  MAC: 'AR Camera chỉ khả dụng trên iPhone/iPad tương thích. Quét mã QR bằng iPhone/iPad để mở.',
  OTHER_MOBILE: 'AR Camera chỉ khả dụng trên iPhone/iPad tương thích.',
  INSECURE_CONTEXT: 'AR Camera cần kết nối HTTPS.'
});
