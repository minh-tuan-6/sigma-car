// js/ar/ui/ar-ui.js — AR UI Overlay. Pure DOM state rendering; no AR logic lives here.
// All manifest-provided strings are written with textContent.

const STATUS_ICONS = { loading: '⏳', error: '⚠️', info: 'ℹ️', ok: '✅' };

export class ArUi {
  constructor(doc = document) {
    this.doc = doc;
    const $ = (id) => doc.getElementById(id);
    this.el = {
      root: $('ar-root'), stage: $('ar-stage'), overlay: $('ar-overlay'), hotspotLayer: $('ar-hotspot-layer'),
      topbar: $('ar-topbar'), back: $('ar-back'), name: $('ar-vehicle-name'), summary: $('ar-config-summary'),
      badge: $('ar-mode-badge'), exitXr: $('ar-exit-xr'),
      status: $('ar-status'), statusIcon: $('ar-status-icon'), statusTitle: $('ar-status-title'), statusDetail: $('ar-status-detail'),
      progress: $('ar-progress'), progressBar: $('ar-progress-bar'), retry: $('ar-retry'),
      hint: $('ar-hint'),
      fallback: $('ar-fallback'), fallbackText: $('ar-fallback-text'), sceneViewer: $('ar-open-scene-viewer'), quickLook: $('ar-open-quick-look'),
      qrWrap: $('ar-qr-wrap'), qr: $('ar-qr'),
      info: $('ar-info'), infoClose: $('ar-info-close'), infoCategory: $('ar-info-category'), infoTitle: $('ar-info-title'), infoBody: $('ar-info-body'),
      sheet: $('ar-sheet'), colors: $('ar-colors'), colorsGroup: $('ar-colors-group'), colorsNote: $('ar-colors-note'),
      wheels: $('ar-wheels'), wheelsGroup: $('ar-wheels-group'), wheelsNote: $('ar-wheels-note'), price: $('ar-price'), checkout: $('ar-checkout'),
      dock: $('ar-dock'), primary: $('ar-primary'), btnConfig: $('ar-btn-config'), btnDoors: $('ar-btn-doors'), btnMove: $('ar-btn-move'),
      btnReset: $('ar-btn-reset'), btnCapture: $('ar-btn-capture'), btnHotspots: $('ar-btn-hotspots'),
      diagnostics: $('ar-diagnostics'), diagnosticsBody: $('ar-diagnostics-body')
    };
    this._primaryHandler = null;
    this.el.primary.addEventListener('click', () => { if (this._primaryHandler) this._primaryHandler(); });
    this.el.infoClose.addEventListener('click', () => this.hideInfo());
    this.el.btnConfig.addEventListener('click', () => this.toggleSheet());
  }

  /** UI-only regions (taps there never become scene taps / XR selects). */
  get uiRoots() {
    const e = this.el;
    return [e.topbar, e.status, e.fallback, e.info, e.sheet, e.dock, e.diagnostics, e.hotspotLayer];
  }

  setState(state) {
    this.el.root.dataset.state = state;
  }

  setXr(on) {
    this.el.root.dataset.xr = on ? 'on' : 'off';
    this.el.exitXr.hidden = !on;
  }

  setMode(mode, label) {
    this.el.root.dataset.mode = mode;
    this.el.badge.hidden = !label;
    this.el.badge.textContent = label || '';
  }

  status({ kind = 'loading', title = '', detail = '', progress = null, retry = false } = {}) {
    this.el.status.hidden = false;
    this.el.status.dataset.kind = kind;
    this.el.statusIcon.textContent = STATUS_ICONS[kind] || STATUS_ICONS.info;
    this.el.statusTitle.textContent = title;
    this.el.statusDetail.textContent = detail;
    this.setProgress(progress);
    this.el.retry.hidden = !retry;
  }

  setProgress(ratio) {
    const show = typeof ratio === 'number';
    this.el.progress.hidden = !show;
    if (show) this.el.progressBar.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
  }

  hideStatus() {
    this.el.status.hidden = true;
  }

  hint(text) {
    this.el.hint.hidden = !text;
    this.el.hint.textContent = text || '';
  }

  primary(label, handler, { disabled = false } = {}) {
    this.el.primary.textContent = label;
    this.el.primary.disabled = disabled || !handler;
    this._primaryHandler = handler || null;
    this.el.primary.hidden = !label;
  }

  show(name, visible) {
    if (this.el[name]) this.el[name].hidden = !visible;
  }

  setVehicle(manifest, { backUrl, checkoutUrl }) {
    this.el.name.textContent = manifest.name;
    this.doc.title = `Xem AR — ${manifest.name} | SIGMACAR`;
    this.el.price.textContent = manifest.priceFormatted || '';
    this.setLinks({ backUrl, checkoutUrl });
  }

  setLinks({ backUrl, checkoutUrl }) {
    if (backUrl) this.el.back.href = backUrl;
    if (checkoutUrl) this.el.checkout.href = checkoutUrl;
  }

  setSummary(text) {
    this.el.summary.textContent = text;
  }

  renderColors(colors, selectedIdx, onPick, { enabled, note }) {
    this.el.colors.replaceChildren();
    this.el.colorsGroup.hidden = colors.length === 0;
    for (const c of colors) {
      const b = this.doc.createElement('button');
      b.type = 'button';
      b.className = 'ar-swatch';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(c.index === selectedIdx));
      b.setAttribute('aria-label', c.name);
      b.title = c.name;
      b.style.setProperty('--swatch', c.hex);
      b.disabled = !enabled;
      b.addEventListener('click', () => onPick(c.index));
      this.el.colors.appendChild(b);
    }
    this.el.colorsNote.hidden = !note;
    this.el.colorsNote.textContent = note || '';
  }

  renderWheels(wheels, selectedId, onPick, { enabled, note }) {
    this.el.wheels.replaceChildren();
    this.el.wheelsGroup.hidden = wheels.length === 0;
    for (const w of wheels) {
      const b = this.doc.createElement('button');
      b.type = 'button';
      b.className = 'ar-chip';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(w.id === selectedId));
      b.disabled = !enabled;
      const sw = this.doc.createElement('span');
      sw.className = 'ar-chip__swatch';
      sw.style.setProperty('--swatch', w.finish.color);
      b.append(sw, this.doc.createTextNode(w.label));
      b.addEventListener('click', () => onPick(w.id));
      this.el.wheels.appendChild(b);
    }
    this.el.wheelsNote.hidden = !note;
    this.el.wheelsNote.textContent = note || '';
  }

  markSelected(container, predicate) {
    Array.from(this.el[container].children).forEach((b, i) => b.setAttribute('aria-checked', String(predicate(i))));
  }

  toggleSheet(force) {
    const open = typeof force === 'boolean' ? force : this.el.sheet.hidden;
    this.el.sheet.hidden = !open;
    this.el.btnConfig.setAttribute('aria-expanded', String(open));
    if (open) this.hideInfo();
  }

  showInfo({ category = '', title = '', body = '' }) {
    this.el.infoCategory.textContent = category;
    this.el.infoTitle.textContent = title;
    this.el.infoBody.textContent = body;
    this.el.info.hidden = false;
    this.toggleSheet(false);
  }

  hideInfo() {
    this.el.info.hidden = true;
  }

  fallback({ text, sceneViewer = false, quickLook = false, qr = false }) {
    this.el.fallback.hidden = !text;
    this.el.fallbackText.textContent = text || '';
    this.el.sceneViewer.hidden = !sceneViewer;
    this.el.quickLook.hidden = !quickLook;
    this.el.qrWrap.hidden = !qr;
  }

  toast(text, ms = 2600) {
    this.hint(text);
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      if (this.el.hint.textContent === text) this.hint('');
    }, ms);
  }

  diagnostics(obj) {
    this.el.diagnosticsBody.textContent = JSON.stringify(obj, null, 2);
  }
}
