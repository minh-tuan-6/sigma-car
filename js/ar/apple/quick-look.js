// js/ar/apple/quick-look.js — Apple AR Quick Look launcher.
//
// Web AR Quick Look contract (WebKit / Apple "Viewing AR on the web"):
//   * the link is <a rel="ar" href="…usdz"> whose first child is an <img> (or <picture>);
//   * it must be activated from a user gesture (tap), so everything slow is prepared beforehand and the
//     click handler calls launchQuickLook() synchronously;
//   * optional behaviour is set through URL fragment parameters. Only documented ones are used:
//       allowsContentScaling=0   → the user cannot pinch-resize: the vehicle stays at real-world scale
//       canonicalWebPageURL=…    → what Quick Look's share sheet shares instead of the raw .usdz / blob URL
//   * a USDZ generated in the page is a blob: URL; the `download` attribute is required for WebKit to treat
//     it as a file it can hand to Quick Look (same approach as Google's <model-viewer>).
// Quick Look then runs ARKit natively (camera, plane detection, placement, lighting, people occlusion).
// A web page cannot draw any UI inside it.

/**
 * @param {string} usdzUrl      absolute https / blob URL of the USDZ
 * @param {{ allowsContentScaling?: boolean, canonicalWebPageURL?: string }} [opts]
 */
export function buildQuickLookHref(usdzUrl, { allowsContentScaling = false, canonicalWebPageURL = '' } = {}) {
  if (typeof usdzUrl !== 'string' || !usdzUrl) throw new TypeError('usdzUrl is required');
  const isBlob = usdzUrl.startsWith('blob:');
  if (!isBlob && !/^https:\/\//i.test(usdzUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(usdzUrl)) {
    throw new Error('AR Quick Look requires an https:// or blob: USDZ URL');
  }
  const base = usdzUrl.split('#')[0];
  const params = [];
  if (!allowsContentScaling) params.push('allowsContentScaling=0');
  if (canonicalWebPageURL && /^https?:\/\//i.test(canonicalWebPageURL)) {
    params.push(`canonicalWebPageURL=${encodeURIComponent(canonicalWebPageURL)}`);
  }
  return params.length ? `${base}#${params.join('&')}` : base;
}

/**
 * Opens AR Quick Look. MUST be called synchronously inside a user-gesture handler.
 * @param {string} href           from buildQuickLookHref
 * @param {{ document?: Document, fileName?: string }} [opts]
 * @returns {HTMLAnchorElement}   the activated anchor (kept in the DOM, hidden, for re-use)
 */
export function launchQuickLook(href, { document: doc = document, fileName = 'sigmacar.usdz' } = {}) {
  let a = doc.getElementById('sigma-quick-look-anchor');
  if (!a) {
    a = doc.createElement('a');
    a.id = 'sigma-quick-look-anchor';
    a.setAttribute('rel', 'ar');
    a.setAttribute('aria-hidden', 'true');
    a.tabIndex = -1;
    a.style.position = 'absolute';
    a.style.width = '1px';
    a.style.height = '1px';
    a.style.overflow = 'hidden';
    a.style.opacity = '0';
    a.style.pointerEvents = 'none';
    const img = doc.createElement('img');
    img.alt = '';
    img.width = 1;
    img.height = 1;
    // A 1×1 transparent GIF: the <img> child is what WebKit requires; its pixels are irrelevant.
    img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    a.appendChild(img);
    doc.body.appendChild(a);
  }
  a.setAttribute('href', href);
  if (href.startsWith('blob:')) a.setAttribute('download', fileName);
  else a.removeAttribute('download');
  a.click();
  return a;
}
