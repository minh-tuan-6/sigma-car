// js/ar/fallback/platform-fallback.js — Platform Fallback Manager.
//   Android without WebXR → Google Scene Viewer intent (native AR, no custom overlay/interaction).
//   iOS/iPadOS           → AR Quick Look with a USDZ asset (native AR, no JS hotspots/live material edits).
//   Desktop              → interactive 3D preview + QR hand-off to this page on a phone.

/**
 * Builds a Scene Viewer intent URL. The model URL must be absolute and publicly reachable over HTTPS.
 * https://developers.google.com/ar/develop/scene-viewer
 */
export function buildSceneViewerIntent(absoluteGlbUrl, { title = '', fallbackUrl = '', resizable = false } = {}) {
  const u = new URL(absoluteGlbUrl);
  if (u.protocol !== 'https:') throw new Error('Scene Viewer requires an https model URL');
  const params = new URLSearchParams({ file: u.toString(), mode: 'ar_preferred' });
  if (title) params.set('title', title.slice(0, 60));
  // Vehicles must stay at real scale.
  params.set('resizable', resizable ? 'true' : 'false');
  let intent = `intent://arvr.google.com/scene-viewer/1.0?${params.toString()}#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;`;
  if (fallbackUrl) intent += `S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};`;
  return `${intent}end;`;
}

/** Opens AR Quick Look. Must be called from a user gesture. */
export function launchQuickLook(absoluteUsdzUrl, doc = document) {
  const a = doc.createElement('a');
  a.setAttribute('rel', 'ar');
  a.href = absoluteUsdzUrl;
  // Quick Look requires the anchor to contain an <img> child.
  a.appendChild(doc.createElement('img'));
  doc.body.appendChild(a);
  a.click();
  a.remove();
}

let qrLoad = null;
function loadQrLib(src) {
  if (typeof window !== 'undefined' && typeof window.qrcode === 'function') return Promise.resolve(window.qrcode);
  if (!qrLoad) {
    qrLoad = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => (typeof window.qrcode === 'function' ? resolve(window.qrcode) : reject(new Error('qrcode unavailable')));
      s.onerror = () => reject(new Error('qrcode script failed to load'));
      document.head.appendChild(s);
    });
  }
  return qrLoad;
}

/** Renders a QR code (SVG, built with DOM APIs — no innerHTML) pointing at `url`. */
export async function renderQrCode(container, url, { src = '/js/vendor/qrcode/qrcode.js', cellSize = 4 } = {}) {
  const qrcode = await loadQrLib(src);
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const count = qr.getModuleCount();
  const margin = 2;
  const size = (count + margin * 2) * cellSize;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Mã QR mở trang AR trên điện thoại');
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', String(size));
  bg.setAttribute('height', String(size));
  bg.setAttribute('fill', '#FFFFFF');
  svg.appendChild(bg);
  let d = '';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) d += `M${(c + margin) * cellSize},${(r + margin) * cellSize}h${cellSize}v${cellSize}h-${cellSize}z`;
    }
  }
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#0F172A');
  svg.appendChild(path);
  container.replaceChildren(svg);
  return svg;
}

/** Human-readable explanation for each non-WebXR decision (shown in the UI; never claims AR when it isn't). */
export const FALLBACK_MESSAGES = {
  DESKTOP: 'Máy tính không có cảm biến theo dõi không gian nên không thể chạy AR thật. Bạn đang xem bản 3D tương tác — quét mã QR để mở AR trên điện thoại.',
  IOS_QUICK_LOOK: 'iPhone/iPad dùng AR Quick Look của Apple. Trong Quick Look bạn đặt và xoay xe được, nhưng không có điểm thông tin, đổi màu trực tiếp hay giao diện SIGMACAR.',
  IOS_NO_USDZ_ASSET: 'Safari trên iPhone/iPad chưa hỗ trợ WebXR AR, và xe này chưa có tệp USDZ cho AR Quick Look. Bạn đang xem bản 3D tương tác (không phải AR).',
  IOS_NO_QUICK_LOOK: 'Trình duyệt này không hỗ trợ AR Quick Look. Hãy mở trang bằng Safari. Bạn đang xem bản 3D tương tác (không phải AR).',
  NO_IMMERSIVE_AR: 'Thiết bị/trình duyệt này chưa hỗ trợ WebXR AR. Bạn đang xem bản 3D tương tác (không phải AR).',
  WEBXR_BLOCKED: 'WebXR bị chặn trên trang này. Có thể dùng Google Scene Viewer để xem AR gốc của Android.',
  IN_APP_BROWSER: 'Trình duyệt trong ứng dụng (Facebook/Zalo…) chặn AR. Hãy mở trang bằng Chrome hoặc Safari.',
  INSECURE_CONTEXT: 'AR yêu cầu kết nối HTTPS. Bạn đang xem bản 3D tương tác (không phải AR).',
  NO_WEBGL: 'Thiết bị không hỗ trợ WebGL nên không thể hiển thị mô hình 3D.'
};
