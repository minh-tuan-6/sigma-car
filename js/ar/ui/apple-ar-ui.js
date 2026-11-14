// js/ar/ui/apple-ar-ui.js — the dedicated AR page UI: full-screen vehicle, close button, colour bar, AR button.
// Pure DOM rendering; all manifest-provided strings are written with textContent.

export class AppleArUi {
  constructor(doc = document) {
    this.doc = doc;
    const $ = (id) => doc.getElementById(id);
    this.el = {
      root: $('ar-root'), stage: $('ar-stage'), close: $('ar-close'),
      status: $('ar-status'), statusTitle: $('ar-status-title'), statusDetail: $('ar-status-detail'),
      progress: $('ar-progress'), progressBar: $('ar-progress-bar'), retry: $('ar-retry'),
      notice: $('ar-notice'), noticeText: $('ar-notice-text'), qrWrap: $('ar-qr-wrap'), qr: $('ar-qr'),
      dock: $('ar-dock'), colorName: $('ar-color-name'), colors: $('ar-colors'),
      launch: $('ar-launch'), launchLabel: $('ar-launch-label'), launchNote: $('ar-launch-note')
    };
    this._launchHandler = null;
    this.el.launch.addEventListener('click', (ev) => {
      // Runs synchronously inside the tap: AR Quick Look only opens from a user gesture.
      if (this._launchHandler && !this.el.launch.disabled) this._launchHandler(ev);
    });
  }

  setState(state) {
    this.el.root.dataset.state = state;
  }

  setVehicleName(name) {
    this.doc.title = `${name} — Xem AR — SIGMACAR`;
    this.el.root.setAttribute('aria-label', `Xem AR: ${name}`);
  }

  setCloseUrl(url) {
    this.el.close.setAttribute('href', url);
  }

  status({ kind = 'loading', title = '', detail = '', progress = null, retry = false } = {}) {
    const e = this.el;
    e.status.hidden = false;
    e.status.dataset.kind = kind;
    e.statusTitle.textContent = title;
    e.statusDetail.textContent = detail;
    e.progress.hidden = progress === null;
    if (progress !== null) this.setProgress(progress);
    e.retry.hidden = !retry;
  }

  setProgress(ratio) {
    const pct = Math.max(0, Math.min(100, Math.round((Number(ratio) || 0) * 100)));
    this.el.progressBar.style.width = `${pct}%`;
    this.el.progress.setAttribute('aria-valuenow', String(pct));
  }

  hideStatus() {
    this.el.status.hidden = true;
  }

  /** Compatibility message for devices that cannot launch AR Camera (Android, desktop, Mac, …). */
  notice(text, { qr = false } = {}) {
    this.el.notice.hidden = !text;
    this.el.noticeText.textContent = text || '';
    this.el.qrWrap.hidden = !qr;
  }

  /** Horizontal swatch bar. Disabled swatches are not rendered; a single colour shows no bar. */
  renderColors(colors, selectedIndex, onSelect, { enabled = true } = {}) {
    const c = this.el.colors;
    c.replaceChildren();
    const show = enabled && colors.length > 1;
    c.hidden = !show;
    for (const color of colors) {
      const b = this.doc.createElement('button');
      b.type = 'button';
      b.className = 'ar-swatch';
      b.setAttribute('role', 'radio');
      b.dataset.index = String(color.index);
      b.style.setProperty('--swatch', color.hex);
      b.setAttribute('aria-label', color.name);
      b.title = color.name;
      b.addEventListener('click', () => onSelect(color.index));
      c.appendChild(b);
    }
    this.markColor(selectedIndex, colors);
  }

  markColor(selectedIndex, colors = []) {
    let name = '';
    for (const b of this.el.colors.querySelectorAll('.ar-swatch')) {
      const on = Number(b.dataset.index) === selectedIndex;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) {
        name = b.getAttribute('aria-label') || '';
        if (typeof b.scrollIntoView === 'function') b.scrollIntoView({ block: 'nearest', inline: 'center' });
      }
    }
    if (!name) {
      const c = colors.find(x => x.index === selectedIndex);
      name = c ? c.name : '';
    }
    this.el.colorName.textContent = name;
    this.el.colorName.hidden = !name;
  }

  setColorsBusy(busy) {
    this.el.colors.setAttribute('aria-busy', String(Boolean(busy)));
  }

  /**
   * AR button states: 'hidden' | 'preparing' | 'ready' | 'unavailable'.
   * @param {{ state: string, label?: string, note?: string, onLaunch?: Function }} s
   */
  launch({ state, label = '', note = '', onLaunch = null }) {
    const e = this.el;
    e.launch.hidden = state === 'hidden';
    e.launch.dataset.state = state;
    e.launch.disabled = state !== 'ready';
    e.launch.setAttribute('aria-busy', String(state === 'preparing'));
    e.launchLabel.textContent = label;
    e.launchNote.textContent = note;
    e.launchNote.hidden = !note;
    this._launchHandler = state === 'ready' ? onLaunch : null;
  }
}
