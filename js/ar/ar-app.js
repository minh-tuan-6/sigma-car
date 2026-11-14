// js/ar/ar-app.js — SIGMACAR dedicated AR page controller (/ar/:vehicleId).
//
// Flow: capability detection (no permission prompt) → manifest → model load with progress → interactive 3D
// preview → [user taps "Bắt đầu AR"] → WebXR immersive-ar (real camera via the XR runtime) → surface scan →
// reticle → tap to place → interact (rotate, move, colour, wheels, hotspots, capture) → exit back to showroom.
// Devices without WebXR AR get an explicit, honest fallback (Scene Viewer / Quick Look / 3D preview + QR).

import { Vector3 } from 'three';
import { ResourceTracker } from './core/resource-tracker.js';
import { detectCapabilities, chooseExperience } from './core/capability-detector.js';
import { SceneManager } from './core/scene-manager.js';
import { XRSessionManager } from './core/session-manager.js';
import { HitTestManager } from './core/hit-test-manager.js';
import { PlacementReticle } from './core/placement-reticle.js';
import { PlacementController, PLACEMENT, yawFacing } from './core/placement-controller.js';
import { InteractionManager } from './core/interaction-manager.js';
import { AssetCache } from './models/asset-cache.js';
import { ModelLoader } from './models/model-loader.js';
import { VehicleController } from './vehicle/vehicle-controller.js';
import { HotspotManager } from './vehicle/hotspot-manager.js';
import { fetchArManifest } from './manifest/manifest-client.js';
import { isValidVehicleId } from './manifest/manifest-schema.js';
import { readConfig, writeConfig, buildReturnUrl, buildCheckoutUrl } from './config/config-sync.js';
import { buildSceneViewerIntent, launchQuickLook, renderQrCode, FALLBACK_MESSAGES } from './fallback/platform-fallback.js';
import { capturePreview, captureXrFrame, deliverImage } from './capture/capture-manager.js';
import { ArUi } from './ui/ar-ui.js';

const MODE_LABELS = {
  webxr: 'AR thật (WebXR)',
  'scene-viewer': 'AR gốc Android',
  'quick-look': 'AR Quick Look',
  'preview-3d': 'Xem 3D (không phải AR)'
};

const PART_INFO = {
  body: { category: 'Bộ phận', title: 'Thân xe & lớp sơn', body: 'Mở "Cấu hình" để đổi màu sơn trực tiếp trên xe.' },
  wheel: { category: 'Bộ phận', title: 'Mâm xe', body: 'Mở "Cấu hình" để xem các lớp hoàn thiện mâm.' }
};

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (_) {
    return false;
  }
}

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

class ArApp {
  constructor() {
    this.ui = new ArUi(document);
    this.tracker = new ResourceTracker();
    this.cache = new AssetCache();
    this.placement = new PlacementController();
    this.metrics = { startedAt: performance.now(), manifestMs: null, modelMs: null, modelBytes: null, fps: null, source: null };
    this._fpsFrames = 0;
    this._fpsSince = performance.now();
    this._pendingCapture = null;
    this._disposed = false;
  }

  // ------------------------------------------------------------------ boot
  async boot() {
    this.vehicleId = parseVehicleIdFromLocation(window.location);
    if (!this.vehicleId) {
      this.ui.setVehicle({ name: 'SIGMACAR AR', priceFormatted: '' }, { backUrl: '/' });
      return this.fail({ code: 'INVALID_VEHICLE_ID', message: 'Đường dẫn AR không hợp lệ. Hãy mở AR từ trang chi tiết xe.' }, { retry: false });
    }
    this.ui.setLinks({ backUrl: buildReturnUrl(this.vehicleId, { returnParam: this._returnParam() }) });
    this.ui.status({ kind: 'loading', title: 'Đang kiểm tra thiết bị & dữ liệu xe…' });
    this.ui.setState('loading');

    const t0 = performance.now();
    const timed = (p, key) => p.then((v) => { this.metrics[key] = Math.round(performance.now() - t0); return v; });
    // Capability detection can take seconds on some desktops (XR runtime probing); it runs in parallel with
    // the manifest + model download and is only awaited before choosing the AR mode.
    const capsPromise = timed(detectCapabilities(), 'capabilityMs');
    const manifestResult = await timed(fetchArManifest(this.vehicleId), 'manifestMs');
    this.metrics.source = manifestResult.source;
    this.manifest = manifestResult.manifest;
    this.manifestSource = manifestResult.source;
    if (!hasWebGL()) {
      return this.fail({ code: 'NO_WEBGL', message: FALLBACK_MESSAGES.NO_WEBGL }, { retry: false });
    }

    this.config = readConfig(this.vehicleId, {
      search: window.location.search,
      colorCount: this.manifest.colors.length,
      wheelIds: this.manifest.wheels.map(w => w.id)
    });
    this._refreshLinks();
    this.ui.setVehicle(this.manifest, { backUrl: this._backUrl(), checkoutUrl: this._checkoutUrl() });

    // Rendering infrastructure (shared by preview and XR).
    this.sceneMgr = new SceneManager({ container: this.ui.el.stage });
    this.tracker.add(() => this.sceneMgr.dispose());
    this.reticle = new PlacementReticle();
    this.sceneMgr.scene.add(this.reticle.group);
    this.tracker.add(() => this.reticle.dispose());

    // Manifest asset paths are site-root relative (assets/models/...), NOT relative to /ar/:vehicleId.
    this.loader = new ModelLoader({ cache: this.cache, baseUrl: siteBase(), renderer: this.sceneMgr.renderer });
    this.tracker.add(() => this.loader.dispose());
    this.vehicle = new VehicleController({ loader: this.loader, anchor: this.sceneMgr.anchor, manifest: this.manifest });
    this.tracker.add(() => this.vehicle.dispose());
    this.vehicle.on('config', (cfg) => this._onConfigChanged(cfg));
    this.vehicle.on('warning', (w) => this.ui.toast(w.message, 4000));

    await this._loadModel();
    this.caps = await capsPromise;
    this.experience = chooseExperience(this.caps, this.manifest);
    await this._setupPreviewControls();
    this._setupHotspots();
    this._setupInteractions();
    this._setupConfigurator();
    this._setupLifecycle();
    this._enterPreview();
    this.sceneMgr.start((dt, t, frame) => this._tick(dt, frame));
    this.sceneMgr.on('after-render', ({ frame }) => this._afterRender(frame));
    this._updateDiagnostics();
  }

  _returnParam() {
    return new URLSearchParams(window.location.search).get('return');
  }

  _backUrl() {
    return buildReturnUrl(this.vehicleId, { returnParam: this._returnParam(), colorIdx: this.config ? this.config.colorIdx : null });
  }

  _checkoutUrl() {
    const color = this.manifest && this.manifest.colors.find(c => c.index === this.config.colorIdx);
    return buildCheckoutUrl(this.vehicleId, { colorName: color ? color.name : undefined });
  }

  _refreshLinks() {
    if (!this.manifest) return;
    this.ui.setLinks({ backUrl: this._backUrl(), checkoutUrl: this._checkoutUrl() });
    const color = this.manifest.colors.find(c => c.index === this.config.colorIdx);
    const wheel = this.manifest.wheels.find(w => w.id === this.config.wheelId);
    const parts = [];
    if (color) parts.push(`Màu: ${color.name}`);
    if (wheel && this.vehicle && this.vehicle.capabilities.changeWheels) parts.push(`Mâm: ${wheel.label}`);
    this.ui.setSummary(parts.join(' · '));
  }

  async _loadModel() {
    this.ui.status({ kind: 'loading', title: 'Đang tải mô hình 3D…', detail: this.manifest.name, progress: 0 });
    const t0 = performance.now();
    const res = await this.vehicle.load(this.config, {
      onProgress: (p) => {
        if (p.phase === 'download' && p.total) {
          this.ui.setProgress(p.ratio * 0.9);
          this.ui.el.statusDetail.textContent = `${(p.loaded / 1048576).toFixed(1)} / ${(p.total / 1048576).toFixed(1)} MB`;
        } else if (p.phase === 'parse') {
          this.ui.setProgress(0.95);
          this.ui.el.statusDetail.textContent = 'Đang giải nén & dựng mô hình…';
        }
      }
    });
    if (!res) return; // superseded
    this.metrics.modelMs = Math.round(performance.now() - t0);
    this.metrics.modelBytes = res.result.bytes;
    this.metrics.warnings = [...res.result.warnings, ...res.normalization.warnings];
    this.sizeMeters = res.normalization.sizeMeters;
    this.sceneMgr.fitToVehicle(this.sizeMeters);
    this.reticle.setFootprint(this.sizeMeters.length, this.sizeMeters.width);
  }

  // ------------------------------------------------------------------ preview (3D, not AR)
  async _setupPreviewControls() {
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    const cam = this.sceneMgr.camera;
    this.controls = new OrbitControls(cam, this.sceneMgr.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.tracker.add(() => this.controls.dispose());
    this._frameCamera();
  }

  _frameCamera() {
    if (!this.controls || !this.sizeMeters) return;
    const { length, height } = this.sizeMeters;
    const cam = this.sceneMgr.camera;
    const dist = Math.max(length, 3) * 1.25;
    cam.position.set(dist * 0.75, Math.max(1.4, height * 1.1), dist * 0.85);
    this.controls.target.set(0, height * 0.4, 0);
    this.controls.minDistance = length * 0.6;
    this.controls.maxDistance = length * 3;
    this.controls.update();
  }

  _enterPreview() {
    const mode = this.experience.mode;
    this.ui.setMode(mode, MODE_LABELS[mode]);
    this.ui.setState('ready');
    this.ui.setXr(false);
    this.ui.hideStatus();
    this.ui.hint('');
    this.ui.el.btnConfig.disabled = false;
    this.ui.show('btnMove', false);
    this.ui.show('btnReset', false);
    this.ui.show('btnCapture', true);
    this.ui.show('btnDoors', this.vehicle.capabilities.doorAnimations);
    this.ui.show('btnHotspots', this.hotspots && this.hotspots.count > 0);

    const reason = this.experience.reason;
    if (mode === 'webxr') {
      this.ui.fallback({ text: '' });
      this.ui.primary('📷 Bắt đầu AR', () => this.startXr());
    } else if (mode === 'scene-viewer') {
      this.ui.fallback({ text: FALLBACK_MESSAGES[reason] || FALLBACK_MESSAGES.NO_IMMERSIVE_AR, sceneViewer: true });
      this.ui.primary('📷 Mở AR (Scene Viewer)', () => this.openSceneViewer());
    } else if (mode === 'quick-look') {
      this.ui.fallback({ text: FALLBACK_MESSAGES.IOS_QUICK_LOOK, quickLook: true });
      this.ui.primary('📷 Mở AR Quick Look', () => this.openQuickLook());
    } else {
      const isDesktop = !this.caps.platform.mobile;
      this.ui.fallback({ text: FALLBACK_MESSAGES[reason] || FALLBACK_MESSAGES.NO_IMMERSIVE_AR, qr: isDesktop });
      this.ui.primary('', null);
      if (isDesktop) this._renderQr();
    }
    if (this.manifestSource === 'static-snapshot') {
      this.ui.toast('Máy chủ API chưa kết nối — đang dùng dữ liệu AR tĩnh đã xuất bản.', 5000);
    }
  }

  async _renderQr() {
    try {
      await renderQrCode(this.ui.el.qr, this._shareUrl());
    } catch (err) {
      this.ui.show('qrWrap', false);
    }
  }

  _shareUrl() {
    const u = new URL(`/ar/${encodeURIComponent(this.vehicleId)}`, window.location.origin);
    u.searchParams.set('color', String(this.config.colorIdx));
    if (this.config.wheelId) u.searchParams.set('wheel', this.config.wheelId);
    return u.toString();
  }

  openSceneViewer() {
    try {
      const modelUrl = new URL(this.vehicle.loadedUrl || this.manifest.model.glbUrl, siteBase()).toString();
      window.location.href = buildSceneViewerIntent(modelUrl, { title: this.manifest.name, fallbackUrl: window.location.href });
    } catch (err) {
      this.ui.toast('Không mở được Scene Viewer (mô hình cần URL HTTPS công khai).', 4000);
    }
  }

  openQuickLook() {
    const usdz = this.manifest.model.usdzUrl;
    if (!usdz) return;
    launchQuickLook(new URL(usdz, siteBase()).toString());
  }

  // ------------------------------------------------------------------ hotspots, interactions, configurator
  _setupHotspots() {
    if (!this.manifest.features.hotspots) return;
    this.hotspots = new HotspotManager({
      layer: this.ui.el.hotspotLayer,
      hotspots: this.manifest.hotspots,
      onSelect: (h) => this.ui.showInfo({ category: h.category, title: h.name, body: h.description })
    });
    this.tracker.add(() => this.hotspots.dispose());
    this.tracker.listen(this.ui.el.btnHotspots, 'click', () => {
      const next = !this.hotspots.visible;
      this.hotspots.setVisible(next);
      this.ui.el.btnHotspots.setAttribute('aria-pressed', String(next));
    });
  }

  _setupInteractions() {
    this.interactions = new InteractionManager({ surface: this.ui.el.root, uiRoots: this.ui.uiRoots, tracker: this.tracker });
    this.tracker.add(() => this.interactions.dispose());
    this.interactions.on('tap', (e) => this._onTap(e));
    this.interactions.on('rotate', ({ delta }) => {
      if (this.xr && this.xr.isRunning) this.placement.rotate(delta);
    });

    const t = this.tracker;
    t.listen(this.ui.el.exitXr, 'click', () => this.xr && this.xr.end());
    t.listen(this.ui.el.btnMove, 'click', () => this._toggleMove());
    t.listen(this.ui.el.btnReset, 'click', () => this._resetPlacement());
    t.listen(this.ui.el.btnDoors, 'click', () => {
      if (this.vehicle.toggleDoors()) this.ui.el.btnDoors.textContent = this.vehicle.animations.doorsOpen ? '🚪 Đóng cửa' : '🚪 Mở cửa';
    });
    t.listen(this.ui.el.btnCapture, 'click', () => this.capture());
    t.listen(this.ui.el.retry, 'click', () => window.location.reload());
    t.listen(this.ui.el.sceneViewer, 'click', () => this.openSceneViewer());
    t.listen(this.ui.el.quickLook, 'click', () => this.openQuickLook());
    t.listen(this.ui.el.back, 'click', (ev) => {
      ev.preventDefault();
      this.exit();
    });
  }

  _setupConfigurator() {
    const caps = this.vehicle.capabilities;
    const colorNote = caps.changeColor ? '' : 'Mô hình 3D này chưa tách lớp sơn thân xe nên chưa thể đổi màu trực tiếp.';
    this.ui.renderColors(this.manifest.colors, this.config.colorIdx, (idx) => this.setColor(idx), { enabled: caps.changeColor, note: colorNote });
    const wheelNote = caps.changeWheels
      ? 'Xem trước lớp hoàn thiện mâm; kích thước/kiểu mâm không thay đổi trên mô hình.'
      : 'Mô hình 3D này chưa tách vật liệu mâm nên chưa thể đổi mâm.';
    this.ui.renderWheels(this.manifest.wheels, this.config.wheelId, (id) => this.setWheel(id), { enabled: caps.changeWheels, note: wheelNote });
    this._refreshLinks();
  }

  async setColor(idx) {
    if (this._colorBusy) return;
    this._colorBusy = true;
    this.ui.markSelected('colors', (i) => this.manifest.colors[i].index === idx);
    try {
      await this.vehicle.setColor(idx, {
        onProgress: (p) => { if (p.phase === 'download' && p.ratio !== null) this.ui.hint(`Đang tải phiên bản màu… ${Math.round(p.ratio * 100)}%`); }
      });
      this.ui.hint('');
    } catch (err) {
      this.ui.toast(`Không đổi được màu: ${err.message}`, 4000);
      this.ui.markSelected('colors', (i) => this.manifest.colors[i].index === this.config.colorIdx);
    } finally {
      this._colorBusy = false;
    }
  }

  setWheel(id) {
    if (this.vehicle.setWheel(id)) this.ui.markSelected('wheels', (i) => this.manifest.wheels[i].id === id);
  }

  _onConfigChanged(cfg) {
    this.config = { colorIdx: cfg.colorIdx, wheelId: cfg.wheelId };
    const color = this.manifest.colors.find(c => c.index === cfg.colorIdx);
    writeConfig(this.vehicleId, {
      colorIdx: cfg.colorIdx,
      colorHex: color ? color.hex : undefined,
      colorName: color ? color.name : undefined,
      wheelId: cfg.wheelId || undefined
    });
    this._refreshLinks();
    if (this.experience && this.experience.mode === 'preview-3d' && !this.caps.platform.mobile) this._renderQr();
    this._updateDiagnostics();
  }

  _onTap(e) {
    const xrOn = this.xr && this.xr.isRunning;
    if (xrOn && this.placement.canPlace) {
      this._placeAtReticle();
      return;
    }
    if (e.source !== 'pointer') return; // XR select without coordinates: placement only
    const vp = this.sceneMgr.viewport;
    const ndc = { x: (e.x / vp.width) * 2 - 1, y: -((e.y / vp.height) * 2 - 1) };
    const picked = this.vehicle.pick(ndc, this.sceneMgr.activeCamera);
    if (!picked) {
      this.ui.hideInfo();
      return;
    }
    const info = PART_INFO[picked.part] || { category: 'Bộ phận', title: picked.meshName || picked.materialName || 'Chi tiết xe', body: '' };
    this.ui.showInfo(info);
  }

  // ------------------------------------------------------------------ WebXR
  async startXr() {
    if (this.xr && this.xr.isRunning) return;
    if (!this.xr) {
      this.xr = new XRSessionManager({ xr: navigator.xr, renderer: this.sceneMgr.renderer, overlayRoot: this.ui.el.overlay });
      this.tracker.add(() => this.xr.dispose());
      this.xr.on('start', (info) => this._onXrStart(info));
      this.xr.on('end', (info) => this._onXrEnd(info));
      this.xr.on('visibility', (v) => {
        this.interactions.enabled = v === 'visible';
        if (v !== 'visible') this.ui.hint('AR tạm dừng…');
      });
    }
    this.ui.primary('Đang mở camera AR…', null, { disabled: true });
    this.ui.setState('xr-starting');
    try {
      await this.xr.start();
    } catch (err) {
      this.ui.setState('ready');
      this.ui.primary('📷 Bắt đầu AR', () => this.startXr());
      this.ui.status({ kind: 'error', title: 'Không mở được AR', detail: err.message });
      this.tracker.timeout(() => this.ui.hideStatus(), 6000);
    }
  }

  async _onXrStart({ session, enabledFeatures, domOverlay }) {
    this.ui.setXr(true);
    this.ui.hideStatus();
    this.ui.fallback({ text: '' });
    this.ui.toggleSheet(false);
    this.ui.hideInfo();
    if (this.controls) this.controls.enabled = false;
    this.sceneMgr.setPreviewMode(false);
    this.sceneMgr.anchor.visible = false;
    this.sceneMgr.anchor.position.set(0, 0, 0);
    this.sceneMgr.anchor.rotation.set(0, 0, 0);
    this.hitTest = new HitTestManager({ session, viewerSpace: this.xr.viewerSpace });
    try {
      await this.hitTest.init();
    } catch (err) {
      this.ui.status({ kind: 'error', title: 'Không khởi tạo được nhận diện mặt sàn', detail: String(err && err.message || err) });
      await this.xr.end();
      return;
    }
    this.interactions.attachSession(session, { domOverlay });
    this.placement.sessionStarted();
    this.xrFeatures = enabledFeatures;
    this.sceneMgr.enableLightEstimation(enabledFeatures).catch(() => {});
    this.ui.show('btnCapture', enabledFeatures.includes('camera-access'));
    this._onPlacementState();
    this._placementOff = this.placement.on('change', () => this._onPlacementState());
    this._updateDiagnostics();
  }

  _onXrEnd({ byUser }) {
    if (this._placementOff) this._placementOff();
    this._placementOff = null;
    if (this.hitTest) this.hitTest.dispose();
    this.hitTest = null;
    this.interactions.detachSession();
    this.interactions.enabled = true;
    this.placement.sessionEnded();
    this.sceneMgr.disableLightEstimation();
    this.sceneMgr.setPreviewMode(true);
    this.sceneMgr.anchor.position.set(0, 0, 0);
    this.sceneMgr.anchor.rotation.set(0, 0, 0);
    this.sceneMgr.anchor.visible = true;
    this.sceneMgr.followAnchor();
    this.reticle.group.visible = false;
    if (this.controls) this.controls.enabled = true;
    this.sceneMgr.resize();
    this._frameCamera();
    this._enterPreview();
    if (!byUser) {
      this.ui.status({ kind: 'info', title: 'Phiên AR đã bị gián đoạn', detail: 'Hệ thống đã dừng camera AR (chuyển ứng dụng, mất theo dõi hoặc quyền camera thay đổi). Bấm "Bắt đầu AR" để tiếp tục.' });
      this.tracker.timeout(() => this.ui.hideStatus(), 7000);
    }
    if (this._exitAfterXr) this._navigateBack();
  }

  _onPlacementState() {
    const s = this.placement.state;
    this.ui.setState(`xr-${s}`);
    const placed = s === PLACEMENT.PLACED;
    const moving = s === PLACEMENT.MOVING;
    this.ui.show('btnMove', placed || moving);
    this.ui.show('btnReset', placed || moving);
    this.ui.el.btnMove.textContent = moving ? '✓ Giữ vị trí' : '✥ Di chuyển';
    this.ui.el.btnConfig.disabled = !(placed || moving);
    this.ui.show('btnDoors', placed && this.vehicle.capabilities.doorAnimations);
    if (s === PLACEMENT.SCANNING) {
      this.ui.hint('Hướng camera xuống sàn và di chuyển điện thoại chậm để quét mặt phẳng…');
      this.ui.primary('Đang tìm mặt sàn…', null, { disabled: true });
    } else if (s === PLACEMENT.SURFACE_FOUND) {
      this.ui.hint(`Đã thấy mặt sàn. Khung xanh là kích thước thật của xe (${this.sizeMeters.length.toFixed(2)} × ${this.sizeMeters.width.toFixed(2)} m).`);
      this.ui.primary('📍 Đặt xe tại đây', () => this._placeAtReticle());
    } else if (moving) {
      this.ui.hint('Di chuyển điện thoại để dời xe, rồi chạm "Xác nhận vị trí".');
      this.ui.primary('✓ Xác nhận vị trí', () => this._placeAtReticle(), { disabled: !this.placement.surfaceStable });
    } else if (placed) {
      this.ui.hint('Vuốt ngang để xoay xe · chạm vào xe hoặc điểm ⓘ để xem chi tiết.');
      this.ui.primary('', null);
    }
  }

  _placeAtReticle() {
    const surf = this.hitTest && this.hitTest.latest;
    if (!surf || !surf.stable) {
      this.ui.toast('Chưa nhận diện ổn định mặt sàn — hãy quét thêm.');
      return;
    }
    const cam = this.sceneMgr.renderer.xr.getCamera();
    const viewer = new Vector3().setFromMatrixPosition(cam.matrixWorld);
    const res = this.placement.place(surf.position, yawFacing(surf.position, viewer));
    if (res.ok) {
      this.sceneMgr.anchor.position.copy(surf.position);
      this.sceneMgr.anchor.visible = true;
      if (navigator.vibrate) navigator.vibrate(15);
    }
  }

  _toggleMove() {
    if (this.placement.state === PLACEMENT.MOVING) this._placeAtReticle();
    else this.placement.startMove();
  }

  _resetPlacement() {
    this.placement.reset();
    this.sceneMgr.anchor.visible = false;
    if (this.hitTest) this.hitTest.reset();
  }

  // ------------------------------------------------------------------ frame loop
  _tick(dt, frame) {
    const xrOn = this.xr && this.xr.isRunning && frame;
    if (xrOn) {
      const surf = this.hitTest ? this.hitTest.update(frame, this.xr.refSpace) : null;
      if (surf) this.placement.surfaceUpdate(surf.stable);
      const st = this.placement.state;
      if (st === PLACEMENT.MOVING && surf && surf.valid) this.sceneMgr.anchor.position.copy(surf.position);
      this.sceneMgr.anchor.visible = st === PLACEMENT.PLACED || st === PLACEMENT.MOVING;
      this.sceneMgr.anchor.rotation.set(0, this.placement.yaw, 0);
      const previewYaw = st === PLACEMENT.MOVING ? this.placement.yaw : (surf ? this._previewYaw(surf.position) : 0);
      this.reticle.update(surf, previewYaw, (st === PLACEMENT.SURFACE_FOUND || st === PLACEMENT.MOVING) && surf && surf.valid, dt);
      if (st === PLACEMENT.MOVING) this.ui.el.primary.disabled = !this.placement.surfaceStable;
    } else if (this.controls) {
      this.controls.update();
    }
    this.sceneMgr.followAnchor();
    this.vehicle.update(dt);
    this._sampleFps();
  }

  _previewYaw(pos) {
    const cam = this.sceneMgr.renderer.xr.getCamera();
    return yawFacing(pos, new Vector3().setFromMatrixPosition(cam.matrixWorld));
  }

  _afterRender(frame) {
    if (this.hotspots) this.hotspots.update(this.sceneMgr.activeCamera, this.sceneMgr.anchor, this.sceneMgr.viewport);
    if (this._pendingCapture && frame && this.xr && this.xr.isRunning) {
      const { resolve, reject } = this._pendingCapture;
      this._pendingCapture = null;
      captureXrFrame({ renderer: this.sceneMgr.renderer, session: this.xr.session, frame, refSpace: this.xr.refSpace }).then(resolve, reject);
    }
  }

  _sampleFps() {
    this._fpsFrames++;
    const now = performance.now();
    if (now - this._fpsSince >= 2000) {
      this.metrics.fps = Math.round((this._fpsFrames * 1000) / (now - this._fpsSince));
      this._fpsFrames = 0;
      this._fpsSince = now;
      this._updateDiagnostics();
    }
  }

  // ------------------------------------------------------------------ capture
  async capture() {
    try {
      let blob;
      if (this.xr && this.xr.isRunning) {
        blob = await new Promise((resolve, reject) => { this._pendingCapture = { resolve, reject }; });
      } else {
        blob = await capturePreview(this.sceneMgr.renderer, this.sceneMgr.scene, this.sceneMgr.camera);
      }
      const how = await deliverImage(blob, `sigmacar-${this.vehicleId}-${Date.now()}.jpg`, { preferShare: this.caps.platform.mobile });
      if (how !== 'cancelled') this.ui.toast(how === 'shared' ? 'Đã chia sẻ ảnh.' : 'Đã lưu ảnh.');
    } catch (err) {
      this.ui.toast(err.message || 'Không chụp được ảnh.', 5000);
    }
  }

  // ------------------------------------------------------------------ lifecycle & cleanup
  _setupLifecycle() {
    const t = this.tracker;
    t.listen(document, 'visibilitychange', () => {
      if (this.xr && this.xr.isRunning) return; // the XR runtime manages its own frame pump
      if (document.hidden) this.sceneMgr.stop();
      else this.sceneMgr.start((dt, tm, frame) => this._tick(dt, frame));
    });
    t.listen(window, 'pagehide', () => this.dispose());
    this.sceneMgr.on('context-lost', () => this.ui.status({ kind: 'error', title: 'Mất ngữ cảnh đồ hoạ', detail: 'Đang khôi phục…' }));
    this.sceneMgr.on('context-restored', async () => {
      try {
        await this.vehicle.load(this.config);
        this.ui.hideStatus();
      } catch (err) {
        this.fail(err);
      }
    });
  }

  async exit() {
    if (this.xr && this.xr.isRunning) {
      this._exitAfterXr = true;
      await this.xr.end();
      return;
    }
    this._navigateBack();
  }

  _navigateBack() {
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
    const known = {
      NOT_FOUND: 'Không tìm thấy xe hoặc tệp mô hình 3D.',
      AR_MODEL_UNAVAILABLE: 'Xe này chưa có mô hình 3D hỗ trợ AR.',
      NETWORK_OR_CORS: 'Không tải được mô hình (lỗi mạng hoặc CORS của máy chủ mô hình).',
      TIMEOUT: 'Tải mô hình quá thời gian chờ.'
    };
    this.ui.setState('error');
    this.ui.status({ kind: 'error', title: known[code] || 'Không thể mở trải nghiệm AR', detail: `${err && err.message ? err.message : ''} [${code}]`, retry });
    this.ui.primary('', null);
    this.metrics.error = code;
    this._updateDiagnostics();
  }

  _updateDiagnostics() {
    const diag = {
      vehicleId: this.vehicleId,
      experience: this.experience,
      manifestSource: this.manifestSource,
      capabilities: this.caps,
      xr: this.xr ? { state: this.xr.state, features: this.xr.enabledFeatures, domOverlay: this.xr.domOverlayActive } : null,
      placement: this.placement.state,
      vehicle: this.vehicle ? { loadedUrl: this.vehicle.loadedUrl, sizeMeters: this.sizeMeters, capabilities: this.vehicle.capabilities } : null,
      config: this.config,
      cache: { bytes: this.cache.sizeBytes, ...this.cache.stats },
      metrics: this.metrics
    };
    this.ui.diagnostics(diag);
    window.__sigmaAr = diag; // read by the E2E suite for real measurements
  }
}

// Error boundary: anything unexpected during boot ends in a visible, recoverable error state.
const app = new ArApp();
window.addEventListener('unhandledrejection', (ev) => {
  console.error('[AR] unhandled rejection:', ev.reason);
});
app.boot().catch((err) => {
  console.error('[AR] boot failed:', err);
  app.fail(err);
});
