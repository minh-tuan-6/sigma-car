// js/ar/ui/qr-code.js — QR hand-off from a desktop/Mac to an iPhone/iPad (vendored qrcode-generator, MIT).

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

/** Renders a QR code (SVG built with DOM APIs — no innerHTML) pointing at `url`. */
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
  svg.setAttribute('aria-label', 'Mã QR mở trang AR trên iPhone/iPad');
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
