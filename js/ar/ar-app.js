// js/ar/ar-app.js — SIGMACAR dedicated AR page controller (/ar/:vehicleId). Device-aware AR.
//
// Flow:
//   detect the device + AR engine (js/ar/device/ar-device.js, no permission prompt) → AR manifest → load the GLB
//   → full-screen 3D vehicle view + colour bar → "Xem AR":
//     iPhone / iPad → Apple ARKit via AR Quick Look (USDZ for the selected colour, declared or converted on device).
//                     Opened in another iOS browser (e.g. after scanning the QR code) → handed over to Safari.
//     Android       → Google ARCore: WebXR immersive-ar in this page (keeps the colour, real scale, DOM overlay UI),
//                     or Google Scene Viewer through an intent when WebXR AR is not available.
//     Desktop / Mac → no AR camera: compatibility notice + QR code for a phone.
// Quick Look / Scene Viewer are native viewers: the page cannot draw UI inside them, so colour is chosen here first.

import { ResourceTracker } from './core/resource-tracker.js';
import { SceneManager } from './core/scene-manager.js';
import { AssetCache } from './models/asset-cache.js';
import { ModelLoader } from './models/model-loader.js';
import { VehicleController } from './vehicle/vehicle-controller.js';
import { fetchArManifest } from './manifest/manifest-client.js';
import { isValidVehicleId } from './manifest/manifest-schema.js';
import { readConfig, writeConfig, buildReturnUrl } from './config/config-sync.js';
import { SUPPORT_MESSAGES } from './apple/apple-ar-support.js';
import { detectArSupport, AR_ENGINE, DEVICE_MESSAGES, buildOpenInSafariUrl } from './device/ar-device.js';
import { buildSceneViewerIntent, launchSceneViewer } from './android/scene-viewer.js';
import { WebXrArSession } from './android/webxr-ar.js';
import { buildQuickLookHref, launchQuickLook } from './apple/quick-look.js';
import { UsdzResolver } from './apple/usdz-resolver.js';
import { renderQrCode } from './ui/qr-code.js';
import { AppleArUi } from './ui/apple-ar-ui.js';

// Base for resolving manifest asset paths (site root, independent of the /ar/:id page path).
function siteBase() {
  return `${window.location.origin}/`;
}

export function parseVehicleIdFromLocation(loc) {
  const m = String(loc.pathname || '').match(/^\/ar\/([^/]+)\/?$/);
  let raw = null;
  try {
    raw = m ? decodeURIComponent(m[1]) : new URLSearchParams(loc.search || '').get('vehicle');
  } catch (_) {
    raw = null;
  }
  return isValidVehicleId(raw) ? raw : null;
}

const ERROR_TITLES = {
  INVALID_VEHICLE_ID: 'Đường dẫn AR không hợp lệ.',
  NOT_FOUND: 'Không tìm thấy xe hoặc tệp mô hình 3D.',
  AR_MODEL_UNAVAILABLE: 'Xe này chưa có mô hình 3D.',
  NETWORK_OR_CORS: 'Không tải được mô hình (lỗi mạng hoặc CORS của máy chủ mô hình).',
  TIMEOUT: 'Tải mô hình quá thời gian chờ.',
  NO_WEBGL: 'Thiết bị không hiển thị được mô hình 3D (WebGL).'
};

class ArApp {
  constructor() {
    this.ui = new AppleArUi(document);
    this.tracker = new ResourceTracker();
    this.cache = new AssetCache();
    this.metrics = { manifestMs: null, modelMs: null, modelBytes: null, usdz: null, launches: 0, warnings: [] };
    this.ar = { state: 'hidden', url: null, kind: null, colorMatch: null, colorIdx: null, error: null };
    this._prepareToken = 0;
    this._colorToken = 0;
    this._disposed = false;
  }

  // ------------------------------------------------------------------ boot
  async boot() {
    this.support = await detectArSupport();
    this.vehicleId = parseVehicleIdFromLocation(window.location);
    if (this.vehicleId) this._maybeHandOffToSafari();
    this.tracker.listen(this.ui.el.retry, 'click', () => window.location.reload());
    this.tracker.listen(this.ui.el.close, 'click', (ev) => {
      ev.preventDefault();
      this.exit();
    });
    if (!this.vehicleId) {
      return this.fail({ code: 'INVALID_VEHICLE_ID', message: 'Hãy mở AR từ trang chi tiết xe.' }, { retry: false });
    }
    this.ui.setCloseUrl(this._backUrl());
    this.ui.setState('loading');
    this.ui.status({ kind: 'loading', title: 'Đang tải dữ liệu xe…' });

    const t0 = performance.now();
    const manifestResult = await fetchArManifest(this.vehicleId);
    this.metrics.manifestMs = Math.round(performance.now() - t0);
    this.manifest = manifestResult.manifest;
    this.manifestSource = manifestResult.source;
    this.ui.setVehicleName(this.manifest.name);
    if (!this.support.webgl) {
      return this.fail({ code: 'NO_WEBGL', message: '' }, { retry: false });
    }

    this.colorIdx = readConfig(this.vehicleId, { search: window.location.search, colorCount: this.manifest.colors.length }).colorIdx;
    this.ui.setCloseUrl(this._backUrl());

    this.sceneMgr = new SceneManager({ container: this.ui.el.stage });
    this.tracker.add(() => this.sceneMgr.dispose());
    this.loader = new ModelLoader({ cache: this.cache, baseUrl: siteBase(), renderer: this.sceneMgr.renderer });
    this.tracker.add(() => this.loader.dispose());
    this.vehicle = new VehicleController({ loader: this.loader, anchor: this.sceneMgr.anchor, manifest: this.manifest });
    this.tracker.add(() => this.vehicle.dispose());
    this.vehicle.on('warning', (w) => this.metrics.warnings.push(`${w.code}: ${w.message}`));

    await this._loadModel();
    await this._setupView();
    this._setupColors();
    this._setupLifecycle();
    this._setupArAvailability();
    this.ui.hideStatus();
    this.ui.setState('ready');
    this.sceneMgr.start((dt, frame) => this._tick(dt, frame));
    this._publishDiagnostics();
  }

  _returnParam() {
    return new URLSearchParams(window.location.search).get('return');
  }

  _backUrl() {
    return buildReturnUrl(this.vehicleId, { returnParam: this._returnParam(), colorIdx: Number.isInteger(this.colorIdx) ? this.colorIdx : null });
  }

  _pageUrl(extra = {}) {
    const u = new URL(`/ar/${encodeURIComponent(this.vehicleId)}`, window.location.origin);
    if (Number.isInteger(this.colorIdx)) u.searchParams.set('color', String(this.colorIdx));
    else {
      const c = new URLSearchParams(window.location.search).get('color');
      if (c && /^\d{1,2}$/.test(c)) u.searchParams.set('color', c);
    }
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
    return u.toString();
  }

  async _loadModel() {
    this.ui.status({ kind: 'loading', title: 'Đang tải mô hình 3D…', detail: this.manifest.name, progress: 0 });
    const t0 = performance.now();
    const res = await this.vehicle.load(this.colorIdx, {
      onProgress: (p) => {
        if (p.phase === 'download' && p.total) {
          this.ui.setProgress(p.ratio * 0.9);
          this.ui.el.statusDetail.textContent = `${(p.loaded / 1048576).toFixed(1)} / ${(p.total / 1048576).toFixed(1)} MB`;
        } else if (p.phase === 'parse') {
          this.ui.setProgress(0.95);
          this.ui.el.statusDetail.textContent = 'Đang dựng mô hình…';
        }
      }
    });
    if (!res) return;
    this.metrics.modelMs = Math.round(performance.now() - t0);
    this.metrics.modelBytes = res.result.bytes;
    this.metrics.warnings.push(...res.result.warnings, ...res.normalization.warnings);
    this.sizeMeters = res.normalization.sizeMeters;
    this.sceneMgr.fitToVehicle(this.sizeMeters);
  }

  // ------------------------------------------------------------------ full-screen vehicle view (3D, not a camera)
  async _setupView() {
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    this.controls = new OrbitControls(this.sceneMgr.camera, this.sceneMgr.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = Math.PI * 0.18;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.tracker.add(() => this.controls.dispose());
    this._frameCamera();
    this.sceneMgr.on('resize', () => this._frameCamera());
  }

  /** Frames the vehicle so it fills most of the screen at its real proportions (camera distance, not scale). */
  _frameCamera() {
    if (!this.controls || !this.sizeMeters) return;
    const { length, width, height } = this.sizeMeters;
    const cam = this.sceneMgr.camera;
    const vFov = (cam.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * cam.aspect);
    // Seen from a three-quarter angle the silhouette spans roughly the diagonal of the footprint.
    const span = Math.hypot(length, width) * 0.92;
    const portrait = cam.aspect < 1;
    // Perspective makes the near corner project larger than the footprint suggests, so keep a margin.
    const fill = portrait ? 0.84 : 0.8;
    const dist = Math.max((span / 2) / Math.tan(hFov / 2) / fill, (height * 1.3) / Math.tan(vFov / 2));
    const az = Math.PI * 0.27;
    const elev = 0.2;
    cam.position.set(Math.sin(az) * dist * Math.cos(elev), height * 0.55 + Math.sin(elev) * dist, Math.cos(az) * dist * Math.cos(elev));
    // The colour bar and AR button occupy the bottom of the screen: aim low so the car sits above the centre.
    this.controls.target.set(0, height * (portrait ? 0.15 : 0.35), 0);
    this.controls.minDistance = dist * 0.55;
    this.controls.maxDistance = dist * 1.6;
    this.controls.update();
  }

  _tick(dt, frame) {
    if (this.xr && this.xr.active) {
      this.xr.onFrame(frame);
      return;
    }
    if (this.controls) this.controls.update();
  }

  // ------------------------------------------------------------------ colour bar
  _setupColors() {
    const enabled = this.vehicle.capabilities.changeColor;
    this.ui.renderColors(this.manifest.colors, this.colorIdx, (idx) => this.setColor(idx), { enabled });
    if (!enabled && this.manifest.colors.length > 1) {
      // The 3D file has no separable paint layer: say so instead of showing swatches that would do nothing.
      this.ui.el.colorName.textContent = 'Mô hình 3D này hiển thị màu gốc của nhà sản xuất mô hình.';
      this.ui.el.colorName.hidden = false;
    }
  }

  async setColor(idx) {
    if (idx === this.colorIdx && !this._colorBusy) return;
    const token = ++this._colorToken;
    const previous = this.colorIdx;
    this.ui.markColor(idx, this.manifest.colors);
    this.ui.setColorsBusy(true);
    this._colorBusy = true;
    try {
      const res = await this.vehicle.setColor(idx);
      if (token !== this._colorToken) return;
      if (!res.changed) throw new Error('Không đổi được màu cho mô hình này.');
      this.colorIdx = idx;
      const color = this.manifest.colors.find(c => c.index === idx);
      writeConfig(this.vehicleId, { colorIdx: idx, colorHex: color ? color.hex : undefined, colorName: color ? color.name : undefined });
      this.ui.setCloseUrl(this._backUrl());
      if (this._qrShown) this._renderQr();
      if (this.support.engine === AR_ENGINE.QUICK_LOOK) this._prepareAr();
      else if (this.support.platform === 'android') this._refreshAndroidLaunch();
    } catch (err) {
      if (token !== this._colorToken) return;
      this.metrics.warnings.push(`COLOR_CHANGE_FAILED: ${err.message}`);
      this.ui.markColor(previous, this.manifest.colors);
    } finally {
      if (token === this._colorToken) {
        this._colorBusy = false;
        this.ui.setColorsBusy(false);
      }
      this._publishDiagnostics();
    }
  }

  // ------------------------------------------------------------------ engine selection per device
  _setupArAvailability() {
    const s = this.support;
    if (s.platform === 'ios') return this._setupApple();
    if (s.platform === 'android') return this._setupAndroid();
    // Desktop / Mac / other: no AR camera; a QR code hands the page to an iPhone/iPad or Android phone.
    this.ar.state = 'unsupported';
    this.ui.launch({ state: 'hidden' });
    const qr = !s.device.mobile;
    this.ui.notice(DEVICE_MESSAGES[s.reason] || DEVICE_MESSAGES.OTHER_MOBILE, { qr });
    if (qr) this._renderQr();
  }

  // ------------------------------------------------------------------ iPhone / iPad: Apple ARKit (AR Quick Look)
  /** iOS outside Safari (Chrome/Firefox/Edge/in-app, e.g. after scanning the QR code): open this page in Safari once. */
  _maybeHandOffToSafari() {
    const s = this.support;
    if (!s.needsSafari) return;
    const target = buildOpenInSafariUrl(this._pageUrl({ via: 'safari' }));
    if (!target) return;
    const key = `sigma-ar-safari:${this.vehicleId}`;
    let tried = false;
    try { tried = sessionStorage.getItem(key) === '1'; sessionStorage.setItem(key, '1'); } catch (_) { /* storage blocked */ }
    if (tried) return;
    this.metrics.safariHandoff = 'auto';
    try { window.location.href = target; } catch (_) { /* scheme refused: the panel offers a button */ }
  }

  _showSafariPanel({ blocking }) {
    const href = buildOpenInSafariUrl(this._pageUrl({ via: 'safari' }));
    this.ui.el.safari.dataset.blocking = String(Boolean(blocking));
    this.ui.safari({
      visible: true,
      text: `${DEVICE_MESSAGES.SAFARI_NEEDED} (đang dùng ${(this.support.iosBrowser && this.support.iosBrowser.name) || 'trình duyệt khác'})`,
      href,
      help: DEVICE_MESSAGES.SAFARI_MANUAL,
      onCopy: async () => {
        try {
          await navigator.clipboard.writeText(this._pageUrl());
          this.ui.el.safariHelp.textContent = 'Đã sao chép liên kết — mở Safari và dán vào thanh địa chỉ.';
        } catch (_) {
          this.ui.el.safariHelp.textContent = this._pageUrl();
        }
        this.ui.el.safariHelp.hidden = false;
      }
    });
  }

  _setupApple() {
    const s = this.support;
    const quickLook = s.engines.includes(AR_ENGINE.QUICK_LOOK);
    if (s.needsSafari) this._showSafariPanel({ blocking: !quickLook });
    if (!quickLook) {
      // In-app browser / old iOS / insecure context: no AR camera here.
      this.ar.state = 'unsupported';
      this.ui.launch({ state: 'hidden' });
      this.ui.notice(SUPPORT_MESSAGES[s.reason] || SUPPORT_MESSAGES.APPLE_NO_QUICK_LOOK, { qr: false });
      return;
    }
    this.ui.notice('');
    if (!this.manifest.features.quickLook) {
      this.ar.state = 'unavailable';
      this.ui.launch({ state: 'unavailable', label: 'Xem AR', note: 'Xe này chưa có tệp USDZ cho AR Quick Look.' });
      return;
    }
    this.resolver = new UsdzResolver({ manifest: this.manifest, baseUrl: siteBase() });
    this.tracker.add(() => this.resolver.dispose());
    this._prepareAr();
  }

  /** Prepares the USDZ for the current colour so the tap can open Quick Look synchronously. */
  async _prepareAr() {
    if (!this.resolver) return;
    const token = ++this._prepareToken;
    const colorIdx = this.colorIdx;
    this.ar = { ...this.ar, state: 'preparing', url: null, colorIdx, error: null };
    this.ui.launch({ state: 'preparing', label: 'Đang chuẩn bị AR…' });
    // Let the colour change paint before a (synchronous, CPU-bound) conversion starts.
    await new Promise(r => setTimeout(r, 30));
    if (token !== this._prepareToken) return;
    try {
      const out = await this.resolver.prepare(colorIdx, {
        getPivot: () => this.vehicle.pivot,
        isCurrent: () => token === this._prepareToken,
        onProgress: (p) => {
          if (token !== this._prepareToken) return;
          const mb = p.estimatedBytes ? Math.max(1, Math.round(p.estimatedBytes / 1048576)) : null;
          const label = { analysed: 'Đang chuẩn bị AR…', exporting: 'Đang tạo tệp AR…', validating: 'Đang kiểm tra tệp AR…', done: 'Đang chuẩn bị AR…' }[p.phase] || 'Đang chuẩn bị AR…';
          // Large models take noticeably longer on a phone; say so instead of looking frozen.
          const note = mb && mb >= 20 ? `Mô hình chi tiết (~${mb} MB) — có thể mất vài chục giây.` : '';
          this.ar.progress = p.phase;
          this.ui.launch({ state: 'preparing', label, note });
        }
      });
      if (!out || token !== this._prepareToken) return;
      this.ar = { state: 'ready', url: out.url, kind: out.kind, colorMatch: out.colorMatch, colorIdx, error: null };
      this.metrics.usdz = { kind: out.kind, bytes: out.bytes, report: out.report || null, probe: out.probe || null };
      if (out.warnings && out.warnings.length) this.metrics.warnings.push(...out.warnings);
      this.ui.launch({
        state: 'ready',
        label: 'Xem AR',
        note: out.colorMatch ? '' : 'AR hiển thị màu mặc định của mô hình.',
        onLaunch: () => this.openQuickLook()
      });
    } catch (err) {
      if (token !== this._prepareToken) return;
      this.ar = { ...this.ar, state: 'unavailable', error: err.code || 'USDZ_FAILED' };
      this.metrics.warnings.push(`${err.code || 'USDZ_FAILED'}: ${err.message}`);
      this.ui.launch({ state: 'unavailable', label: 'Xem AR', note: err.message || 'Không chuẩn bị được AR.' });
    } finally {
      this._publishDiagnostics();
    }
  }

  // ------------------------------------------------------------------ Android: Google ARCore (WebXR / Scene Viewer)
  _setupAndroid() {
    const s = this.support;
    if (!s.canLaunchAr) {
      this.ar.state = 'unsupported';
      this.ui.launch({ state: 'hidden' });
      this.ui.notice(DEVICE_MESSAGES.ANDROID_INSECURE, { qr: false });
      return;
    }
    const failed = new URLSearchParams(window.location.search).get('arfail');
    this.ui.notice(failed === 'scene-viewer'
      ? 'Không mở được Google Scene Viewer. Hãy cài / cập nhật "Dịch vụ Google Play cho AR" (ARCore) và ứng dụng Google.'
      : '', { qr: false });
    if (s.engine === AR_ENGINE.WEBXR) {
      this.xr = new WebXrArSession({ sceneMgr: this.sceneMgr, overlayRoot: this.ui.el.root, sizeMeters: this.sizeMeters });
      this.tracker.add(() => this.xr.dispose());
      this._wireXr();
    }
    this._refreshAndroidLaunch();
  }

  /** Public https URL of the GLB for the selected colour (Scene Viewer downloads it itself). */
  _sceneViewerModel() {
    const variant = this.manifest.variants.find(v => v.colorIndex === this.colorIdx);
    let url = null;
    try { url = new URL(variant ? variant.glbUrl : this.manifest.model.glbUrl, siteBase()).toString(); } catch (_) { url = null; }
    const tinted = !variant && this.manifest.colors.length > 1 && this.vehicle.capabilities.changeColor;
    return { url: url && /^https:\/\//i.test(url) ? url : null, colorMatch: !tinted };
  }

  _refreshAndroidLaunch() {
    const s = this.support;
    const sv = this._sceneViewerModel();
    const svOk = s.engines.includes(AR_ENGINE.SCENE_VIEWER) && Boolean(sv.url);
    if (s.engine === AR_ENGINE.WEBXR) {
      this.ar = { ...this.ar, state: 'ready', kind: 'webxr', url: null, colorMatch: true, colorIdx: this.colorIdx, error: null };
      this.ui.launch({ state: 'ready', label: 'Xem AR', note: 'Android • Google ARCore (WebXR)', onLaunch: () => this.openWebXr() });
      this.ui.launchAlt(svOk ? { label: 'Mở bằng Google Scene Viewer', onLaunch: () => this.openSceneViewer() } : {});
    } else if (svOk) {
      this.ar = { ...this.ar, state: 'ready', kind: 'scene-viewer', url: sv.url, colorMatch: sv.colorMatch, colorIdx: this.colorIdx, error: null };
      this.ui.launch({
        state: 'ready',
        label: 'Xem AR',
        note: sv.colorMatch ? 'Android • Google ARCore (Scene Viewer)' : 'Android • Google ARCore (Scene Viewer) — hiển thị màu gốc của mô hình.',
        onLaunch: () => this.openSceneViewer()
      });
      this.ui.launchAlt({});
    } else {
      this.ar = { ...this.ar, state: 'unavailable', kind: null, error: 'SCENE_VIEWER_NEEDS_HTTPS' };
      this.ui.launch({ state: 'unavailable', label: 'Xem AR', note: 'Google Scene Viewer cần mô hình 3D trên HTTPS công khai.' });
      this.ui.launchAlt({});
    }
    this._publishDiagnostics();
  }

  /** Called synchronously from the tap: Scene Viewer intent (ARCore). */
  openSceneViewer() {
    const sv = this._sceneViewerModel();
    if (!sv.url) return;
    const intent = buildSceneViewerIntent(sv.url, {
      title: this.manifest.name,
      link: this._pageUrl(),
      fallbackUrl: this._pageUrl({ arfail: 'scene-viewer' })
    });
    this.metrics.launches++;
    this.metrics.lastLaunch = { engine: AR_ENGINE.SCENE_VIEWER, url: sv.url };
    this._publishDiagnostics();
    launchSceneViewer(intent);
  }

  _wireXr() {
    const xr = this.xr;
    const ui = this.ui;
    const L = this.sizeMeters && this.sizeMeters.length ? this.sizeMeters.length.toFixed(1).replace('.', ',') : null;
    const hints = {
      scanning: 'Di chuyển điện thoại chậm, hướng camera xuống sàn để dò mặt phẳng…',
      ready: `Chạm để đặt xe${L ? ` (kích thước thật, dài ${L} m)` : ''}`,
      placed: 'Kéo ngang để xoay • chạm chỗ khác trên sàn để di chuyển xe',
      estimated: 'Chưa dò rõ mặt sàn — chạm để đặt xe ở vị trí ước lượng, hoặc tiếp tục quét sàn'
    };
    xr.on('start', () => {
      ui.setState('xr');
      if (this.controls) this.controls.enabled = false;
      ui.xr({ visible: true, hint: hints.scanning });
      this.ar.state = 'presenting';
      this._publishDiagnostics();
    });
    xr.on('state', (st) => {
      if (st in hints) ui.xr({ visible: true, hint: hints[st], placed: st === 'placed' });
    });
    xr.on('end', () => {
      ui.xr({ visible: false });
      ui.setState('ready');
      if (this.controls) this.controls.enabled = true;
      this.sceneMgr.resize();
      this._frameCamera();
      this.ar.state = 'ready';
      this._publishDiagnostics();
    });
    this.tracker.listen(ui.el.xrReset, 'click', () => xr.reset());
    this.tracker.listen(ui.el.xrExit, 'click', () => xr.end());
    // Taps on overlay controls must not also place the car (WebXR DOM overlay contract).
    for (const el of [ui.el.xrBar, ui.el.dock]) this.tracker.listen(el, 'beforexrselect', (ev) => ev.preventDefault());
    // One-finger horizontal drag rotates the placed car.
    let lastX = null;
    let moved = 0;
    this.tracker.listen(ui.el.root, 'touchstart', (ev) => {
      if (!xr.active || ev.touches.length !== 1 || ui.el.dock.contains(ev.target) || ui.el.xrBar.contains(ev.target)) { lastX = null; return; }
      lastX = ev.touches[0].clientX;
      moved = 0;
    }, { passive: true });
    this.tracker.listen(ui.el.root, 'touchmove', (ev) => {
      if (lastX === null || !xr.active || ev.touches.length !== 1) return;
      const x = ev.touches[0].clientX;
      const dx = x - lastX;
      lastX = x;
      moved += Math.abs(dx);
      if (moved > 10 && xr.state === 'placed') {
        if (moved - Math.abs(dx) <= 10) xr.suppressNextSelect();
        xr.rotateBy(dx * 0.012);
      }
    }, { passive: true });
    this.tracker.listen(ui.el.root, 'touchend', () => { lastX = null; }, { passive: true });
  }

  /** Called from the tap on #ar-launch (Android with WebXR AR). */
  openWebXr() {
    if (!this.xr || this.xr.active) return;
    this.metrics.launches++;
    this.metrics.lastLaunch = { engine: AR_ENGINE.WEBXR };
    this.xr.start().catch((err) => {
      this.metrics.warnings.push(`${err.code || 'WEBXR_FAILED'}: ${err.message}`);
      this.ui.notice('Không mở được AR (WebXR). Hãy thử "Mở bằng Google Scene Viewer".', { qr: false });
      this._publishDiagnostics();
    });
  }

  /** Called synchronously from the tap on #ar-launch. */
  openQuickLook() {
    if (this.ar.state !== 'ready' || !this.ar.url) return;
    const href = buildQuickLookHref(this.ar.url, { allowsContentScaling: false, canonicalWebPageURL: this._pageUrl() });
    launchQuickLook(href, { fileName: `${this.vehicleId}.usdz` });
    this.metrics.launches++;
    this._publishDiagnostics();
  }

  async _renderQr() {
    this._qrShown = true;
    try {
      await renderQrCode(this.ui.el.qr, this._pageUrl({ src: 'qr' }));
    } catch (_) {
      this.ui.el.qrWrap.hidden = true;
    }
  }

  // ------------------------------------------------------------------ lifecycle & cleanup
  _setupLifecycle() {
    this.tracker.listen(document, 'visibilitychange', () => {
      // Quick Look / Scene Viewer cover the page; pause rendering while hidden to save battery
      // (never while a WebXR session renders through the same loop).
      if (this.xr && this.xr.active) return;
      if (document.hidden) this.sceneMgr.stop();
      else this.sceneMgr.start((dt, frame) => this._tick(dt, frame));
    });
    this.tracker.listen(window, 'pagehide', (ev) => {
      if (!ev.persisted) this.dispose();
    });
    this.sceneMgr.on('context-lost', () => this.ui.status({ kind: 'error', title: 'Mất ngữ cảnh đồ hoạ', detail: 'Đang khôi phục…' }));
    this.sceneMgr.on('context-restored', async () => {
      try {
        await this.vehicle.load(this.colorIdx);
        if (this.resolver) this.resolver.clearGenerated();
        this.ui.hideStatus();
        if (this.support.engine === AR_ENGINE.QUICK_LOOK) this._prepareAr();
      } catch (err) {
        this.fail(err);
      }
    });
  }

  exit() {
    const url = this._backUrl();
    this.dispose();
    window.location.assign(url);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this.vehicle) this.vehicle.cancel();
    this.tracker.disposeAll();
    this.cache.clearMemory();
  }

  // ------------------------------------------------------------------ errors & diagnostics
  fail(err, { retry = true } = {}) {
    const code = (err && err.code) || 'UNEXPECTED';
    this.ui.setState('error');
    this.ui.status({ kind: 'error', title: ERROR_TITLES[code] || 'Không thể mở trang AR', detail: `${err && err.message ? err.message : ''} [${code}]`.trim(), retry });
    this.ui.launch({ state: 'hidden' });
    this.metrics.error = code;
    this._publishDiagnostics();
  }

  /** Machine-readable state for automated tests (window.__sigmaAr). Nothing is rendered on screen. */
  _publishDiagnostics() {
    window.__sigmaAr = {
      vehicleId: this.vehicleId,
      support: this.support,
      manifestSource: this.manifestSource,
      colorIdx: this.colorIdx,
      ar: { ...this.ar },
      vehicle: this.vehicle ? { loadedUrl: this.vehicle.loadedUrl, sizeMeters: this.sizeMeters, capabilities: this.vehicle.capabilities } : null,
      cache: { bytes: this.cache.sizeBytes, ...this.cache.stats },
      metrics: this.metrics
    };
  }
}

// Error boundary: anything unexpected during boot ends in a visible, recoverable error state.
const app = new ArApp();
app.boot().catch((err) => {
  console.error('[AR] boot failed:', err);
  app.fail(err);
});
