// js/ar/android/webxr-ar.js — in-page AR for Android (ARCore) through WebXR `immersive-ar` + hit-test.
//
// The vehicle already shown on the page (with the selected colour) is placed on a real floor at real-world scale:
//   start() (from a tap) → immersive-ar session (hit-test required, dom-overlay optional so the page UI — colour
//   bar, exit, reset — stays usable) → a reticle with the car's footprint follows the detected floor →
//   tap places the car → drag left/right rotates it, tap elsewhere moves it, "Đặt lại" re-scans.
// On exit, every transform / background / light change is restored, so the 3D view and the Apple USDZ exporter
// see exactly the scene they had before.

import { Mesh, RingGeometry, MeshBasicMaterial, Group, Vector3, Matrix4, Quaternion, BufferGeometry, Float32BufferAttribute, LineLoop, LineBasicMaterial } from 'three';
import { Emitter } from '../core/emitter.js';

export class WebXrArSession extends Emitter {
  /**
   * @param {{ sceneMgr: SceneManager, overlayRoot?: HTMLElement, sizeMeters?: {length:number,width:number}, navigator?: Navigator }} opts
   */
  constructor({ sceneMgr, overlayRoot = null, sizeMeters = null, navigator: nav = navigator }) {
    super();
    this.sceneMgr = sceneMgr;
    this.overlayRoot = overlayRoot;
    this.sizeMeters = sizeMeters || { length: 4.5, width: 1.9 };
    this.nav = nav;
    this.session = null;
    this.hitSource = null;
    this.state = 'idle'; // idle | starting | scanning | ready | placed
    this._lastHit = null;
    this._yaw = 0;
    this._suppressSelect = false;
    this._tmp = { m: new Matrix4(), p: new Vector3(), q: new Quaternion(), s: new Vector3(), cam: new Vector3() };
  }

  get active() {
    return Boolean(this.session);
  }

  get domOverlay() {
    return Boolean(this.session && this.session.domOverlayState && this.session.domOverlayState.type);
  }

  /** MUST be called from a user gesture (tap). Resolves once the AR session is running. */
  async start() {
    if (this.session || this.state === 'starting') return;
    this.state = 'starting';
    const init = { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'local-floor'] };
    if (this.overlayRoot) init.domOverlay = { root: this.overlayRoot };
    let session;
    try {
      session = await this.nav.xr.requestSession('immersive-ar', init);
    } catch (err) {
      this.state = 'idle';
      throw Object.assign(new Error(err && err.message ? err.message : 'Không mở được phiên AR.'), { code: 'WEBXR_START_FAILED' });
    }
    const { renderer, scene, anchor, shadowCatcher, sun } = this.sceneMgr;
    this._saved = {
      background: scene.background,
      anchorPos: anchor.position.clone(),
      anchorRot: anchor.rotation.clone(),
      catcherPos: shadowCatcher.position.clone(),
      catcherRot: shadowCatcher.rotation.clone(),
      sunPos: sun.position.clone(),
      sunTarget: sun.target.position.clone()
    };
    this.session = session;
    this._onEnd = () => this._cleanup();
    this._onSelect = () => this._select();
    session.addEventListener('end', this._onEnd);
    session.addEventListener('select', this._onSelect);

    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    try {
      await renderer.xr.setSession(session);
      const viewer = await session.requestReferenceSpace('viewer');
      this.hitSource = await session.requestHitTestSource({ space: viewer });
    } catch (err) {
      try { await session.end(); } catch (_) { /* already ended */ }
      throw Object.assign(new Error(err && err.message ? err.message : 'Thiết bị không hỗ trợ dò mặt phẳng.'), { code: 'WEBXR_HIT_TEST_FAILED' });
    }

    scene.background = null; // camera passthrough shows through
    anchor.visible = false;
    shadowCatcher.visible = false;
    this._buildReticle();
    this._setState('scanning');
    this.emit('start', { domOverlay: this.domOverlay });
  }

  /** Called every animation frame with the XRFrame (from SceneManager's loop). */
  onFrame(frame) {
    if (!this.session || !frame || !this.hitSource) return;
    const refSpace = this.sceneMgr.renderer.xr.getReferenceSpace();
    const hits = frame.getHitTestResults(this.hitSource);
    const pose = hits.length ? hits[0].getPose(refSpace) : null;
    const t = this._tmp;
    if (pose) {
      t.m.fromArray(pose.transform.matrix);
      t.m.decompose(t.p, t.q, t.s);
      // Face the reticle (and the car's long side) towards the viewer; keep it upright on the floor.
      const cam = this.sceneMgr.renderer.xr.getCamera();
      t.cam.setFromMatrixPosition(cam.matrixWorld);
      const yaw = Math.atan2(t.cam.x - t.p.x, t.cam.z - t.p.z);
      this._lastHit = { position: t.p.clone(), yaw };
      if (this.state !== 'placed') {
        this.reticle.visible = true;
        this.reticle.position.copy(t.p);
        this.reticle.rotation.set(0, yaw, 0);
        if (this.state !== 'ready') this._setState('ready');
      }
    } else {
      this._lastHit = null;
      if (this.reticle) this.reticle.visible = false;
      if (this.state === 'ready') this._setState('scanning');
    }
  }

  _select() {
    if (this._suppressSelect) {
      this._suppressSelect = false;
      return;
    }
    if (!this._lastHit) return;
    this._place(this._lastHit.position, this._lastHit.yaw);
  }

  _place(position, yaw) {
    const { anchor, shadowCatcher, sun } = this.sceneMgr;
    this._yaw = yaw;
    anchor.position.copy(position);
    anchor.rotation.set(0, yaw, 0);
    anchor.visible = true;
    shadowCatcher.position.copy(position);
    shadowCatcher.position.y += 0.002;
    shadowCatcher.rotation.set(0, yaw, 0);
    shadowCatcher.visible = true;
    // Keep the shadow frustum around the car wherever it was placed.
    sun.target.position.copy(position);
    sun.position.copy(position).add(new Vector3(4, 8, 3));
    sun.target.updateMatrixWorld();
    if (this.reticle) this.reticle.visible = false;
    this._setState('placed');
  }

  /** Rotates the placed car around its vertical axis (radians). */
  rotateBy(rad) {
    if (this.state !== 'placed') return;
    this._yaw += rad;
    this.sceneMgr.anchor.rotation.set(0, this._yaw, 0);
    this.sceneMgr.shadowCatcher.rotation.set(0, this._yaw, 0);
  }

  /** A drag on the overlay ends with a WebXR "select" — ignore that one so a rotation does not move the car. */
  suppressNextSelect() {
    this._suppressSelect = true;
  }

  /** Back to scanning: the car is hidden until the user taps the floor again. */
  reset() {
    if (!this.session) return;
    this.sceneMgr.anchor.visible = false;
    this.sceneMgr.shadowCatcher.visible = false;
    this._setState('scanning');
  }

  async end() {
    if (this.session) {
      try { await this.session.end(); } catch (_) { this._cleanup(); }
    }
  }

  _setState(s) {
    this.state = s;
    this.emit('state', s);
  }

  _buildReticle() {
    const g = new Group();
    g.name = 'SigmaArReticle';
    const ring = new Mesh(new RingGeometry(0.16, 0.2, 48).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.95, depthTest: false }));
    // Real footprint of the vehicle, so the user sees whether it fits before placing it.
    const L = Math.max(1, this.sizeMeters.length || 4.5) / 2;
    const W = Math.max(0.8, this.sizeMeters.width || 1.9) / 2;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute([-W, 0, -L, W, 0, -L, W, 0, L, -W, 0, L], 3));
    const outline = new LineLoop(geo, new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
    ring.renderOrder = 999;
    outline.renderOrder = 999;
    g.add(ring, outline);
    g.visible = false;
    this.reticle = g;
    this.sceneMgr.scene.add(g);
  }

  _cleanup() {
    const session = this.session;
    if (!session) return;
    this.session = null;
    session.removeEventListener('end', this._onEnd);
    session.removeEventListener('select', this._onSelect);
    if (this.hitSource) {
      try { this.hitSource.cancel(); } catch (_) { /* session gone */ }
    }
    this.hitSource = null;
    const { renderer, scene, anchor, shadowCatcher, sun } = this.sceneMgr;
    renderer.xr.enabled = false;
    if (this.reticle) {
      scene.remove(this.reticle);
      this.reticle.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this.reticle = null;
    }
    const s = this._saved || {};
    if (s.background !== undefined) scene.background = s.background;
    if (s.anchorPos) anchor.position.copy(s.anchorPos);
    if (s.anchorRot) anchor.rotation.copy(s.anchorRot);
    if (s.catcherPos) shadowCatcher.position.copy(s.catcherPos);
    if (s.catcherRot) shadowCatcher.rotation.copy(s.catcherRot);
    if (s.sunPos) sun.position.copy(s.sunPos);
    if (s.sunTarget) sun.target.position.copy(s.sunTarget);
    anchor.visible = true;
    shadowCatcher.visible = true;
    this._lastHit = null;
    this._setState('idle');
    this.emit('end');
  }

  dispose() {
    this.end();
    this.removeAllListeners();
  }
}
