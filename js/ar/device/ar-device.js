// js/ar/device/ar-device.js — picks the AR engine for the device that opened the AR page.
//
//   iPhone / iPad  → Apple ARKit through AR Quick Look (rel="ar" + USDZ). Quick Look is reliable in Safari, so a
//                    page opened in Chrome / Firefox / Edge / an in-app browser on iOS (typical after scanning the
//                    QR code when Safari is not the default browser) is handed over to Safari (x-safari-https://).
//   Android        → Google ARCore: WebXR `immersive-ar` + hit-test inside the page when Chrome exposes it (keeps the
//                    selected colour, real-world scale), otherwise Google Scene Viewer (ARCore) through an intent.
//   Desktop / Mac  → no AR camera; a QR code hands the page to a phone.
//
// Feature detection decides what may launch; the user-agent only classifies the device and the browser.

import { detectAppleArSupport, SUPPORT_REASON } from '../apple/apple-ar-support.js';

export const AR_ENGINE = Object.freeze({
  QUICK_LOOK: 'quick-look',     // ARKit (Apple)
  WEBXR: 'webxr',               // ARCore through WebXR immersive-ar (Android Chrome)
  SCENE_VIEWER: 'scene-viewer', // ARCore through Google Scene Viewer (Android)
  NONE: 'none'
});

/** iOS browser classification (all iOS browsers are WebKit; only Safari reliably opens AR Quick Look). */
export function classifyIosBrowser(ua = '') {
  const s = String(ua);
  const markers = [
    ['Chrome', /CriOS\//], ['Firefox', /FxiOS\//], ['Edge', /EdgiOS\//], ['Opera', /OPiOS\/|OPT\//],
    ['Google', /GSA\//], ['DuckDuckGo', /DuckDuckGo\//], ['Yandex', /YaBrowser\//],
    ['Facebook', /FBAN|FBAV/], ['Instagram', /Instagram/], ['Zalo', /Zalo/i], ['Line', /Line\//], ['WeChat', /MicroMessenger/],
    ['TikTok', /musical_ly|BytedanceWebview|TikTok/i], ['Messenger', /Messenger/]
  ];
  for (const [name, re] of markers) if (re.test(s)) return { safari: false, name };
  // Safari (and Brave, which uses an identical UA) carry "Version/x … Safari/"; WKWebViews without it are in-app.
  const safari = /Version\/[\d.]+.*Safari\//.test(s);
  return { safari, name: safari ? 'Safari' : 'In-app' };
}

/** `x-safari-https://…` opens the URL in Safari from another iOS browser (iOS 17+; older iOS ignores it). */
export function buildOpenInSafariUrl(url) {
  const u = String(url || '');
  if (!/^https:\/\//i.test(u)) return null;
  return `x-safari-${u}`;
}

async function webxrArSupported(nav, win) {
  try {
    if (win && win.isSecureContext === false) return false;
    if (!nav || !nav.xr || typeof nav.xr.isSessionSupported !== 'function') return false;
    return Boolean(await nav.xr.isSessionSupported('immersive-ar'));
  } catch (_) {
    return false;
  }
}

/**
 * @param {{ navigator?, document?, window? }} [env]  injectable for tests
 * @returns {Promise<object>} support descriptor (superset of detectAppleArSupport's)
 */
export async function detectArSupport(env = {}) {
  const nav = env.navigator || (typeof navigator !== 'undefined' ? navigator : {});
  const win = env.window || (typeof window !== 'undefined' ? window : {});
  const apple = detectAppleArSupport(env);
  const device = apple.device;
  const out = {
    ...apple,
    platform: device.appleMobile ? 'ios' : device.android ? 'android' : device.mac ? 'mac' : device.mobile ? 'mobile-other' : 'desktop',
    engine: AR_ENGINE.NONE,
    engines: [],
    engineLabel: '',
    iosBrowser: null,
    needsSafari: false,
    webxrAr: false
  };

  if (device.appleMobile) {
    out.iosBrowser = classifyIosBrowser(nav.userAgent);
    // Quick Look outside Safari is unreliable (in-app browsers block it, others vary): prefer Safari.
    out.needsSafari = !out.iosBrowser.safari && apple.secureContext;
    if (apple.reason === SUPPORT_REASON.QUICK_LOOK) out.engines.push(AR_ENGINE.QUICK_LOOK);
    out.engineLabel = 'Apple ARKit (AR Quick Look)';
  } else if (device.android) {
    out.reason = SUPPORT_REASON.ANDROID;
    if (!apple.secureContext) {
      out.reason = SUPPORT_REASON.INSECURE_CONTEXT;
    } else {
      out.webxrAr = await webxrArSupported(nav, win);
      if (out.webxrAr) out.engines.push(AR_ENGINE.WEBXR);
      // Scene Viewer ships with Google Play Services for AR / the Google app; an intent cannot be feature-detected,
      // and the intent's browser_fallback_url brings the user back here if it is missing. In-app browsers usually
      // refuse intent:// links, so they only get it as a secondary option.
      out.engines.push(AR_ENGINE.SCENE_VIEWER);
    }
    out.engineLabel = out.webxrAr ? 'Google ARCore (WebXR)' : 'Google ARCore (Scene Viewer)';
  }

  out.engine = out.engines[0] || AR_ENGINE.NONE;
  out.canLaunchAr = out.engine !== AR_ENGINE.NONE;
  return out;
}

/** User-facing messages for the new device-aware flow. */
export const DEVICE_MESSAGES = Object.freeze({
  DESKTOP: 'AR Camera cần điện thoại: quét mã QR bằng iPhone/iPad (ARKit) hoặc điện thoại Android (ARCore).',
  MAC: 'AR Camera cần điện thoại: quét mã QR bằng iPhone/iPad (ARKit) hoặc điện thoại Android (ARCore).',
  OTHER_MOBILE: 'Thiết bị này chưa hỗ trợ AR. Hãy dùng iPhone/iPad (ARKit) hoặc điện thoại Android có ARCore.',
  ANDROID_INSECURE: 'AR Camera cần kết nối HTTPS.',
  SAFARI_REDIRECT: 'Đang chuyển sang Safari để mở AR (ARKit)…',
  SAFARI_NEEDED: 'AR trên iPhone/iPad hoạt động ổn định nhất trong Safari.',
  SAFARI_MANUAL: 'Nếu Safari không tự mở: nhấn ••• / biểu tượng chia sẻ → "Mở trong Safari", hoặc sao chép liên kết và dán vào Safari.'
});
