// js/ar/core/session-manager.js — AR Session Manager + Camera/XR lifecycle.
// Owns exactly one immersive-ar session at a time. The camera feed is provided by the XR runtime
// (system compositor) — the page never draws a fake camera background.

import { Emitter } from './emitter.js';

export const XR_STATES = Object.freeze({ IDLE: 'idle', REQUESTING: 'requesting', RUNNING: 'running', ENDING: 'ending' });

export function mapXrError(err) {
  const name = err && err.name;
  if (name === 'NotSupportedError') return { code: 'UNSUPPORTED', message: 'Thiết bị không hỗ trợ một tính năng AR bắt buộc (hit-test).' };
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return { code: 'PERMISSION_DENIED', message: 'Quyền camera/AR bị từ chối. Hãy cho phép camera cho trang này trong cài đặt trình duyệt rồi thử lại.' };
  }
  if (name === 'InvalidStateError') return { code: 'SESSION_ACTIVE', message: 'Đã có một phiên AR khác đang chạy.' };
  return { code: 'START_FAILED', message: `Không khởi động được AR${err && err.message ? `: ${err.message}` : '.'}` };
}

export class XRSessionManager extends Emitter {
  /**
   * @param {{ xr: XRSystem, renderer: THREE.WebGLRenderer, overlayRoot?: HTMLElement }} opts
   */
  constructor({ xr, renderer, overlayRoot = null }) {
    super();
    this.xr = xr;
    this.renderer = renderer;
    this.overlayRoot = overlayRoot;
    this.state = XR_STATES.IDLE;
    this.session = null;
    this.viewerSpace = null;
    this.refSpace = null;
    this.enabledFeatures = [];
    this.visibility = 'visible';
    this._startPromise = null;
    this._endedByUser = false;
    this._onEnd = null;
    this._onVisibility = null;
  }

  get isRunning() {
    return this.state === XR_STATES.RUNNING;
  }

  get domOverlayActive() {
    return Boolean(this.session && this.session.domOverlayState && this.session.domOverlayState.type);
  }

  hasFeature(name) {
    return this.enabledFeatures.includes(name);
  }

  /** Must be called from a user gesture (button click). Concurrent calls share one request. */
  start() {
    if (this.state === XR_STATES.RUNNING) return Promise.resolve(this.session);
    if (this._startPromise) return this._startPromise;
    this._startPromise = this._start().finally(() => { this._startPromise = null; });
    return this._startPromise;
  }

  async _start() {
    if (!this.xr) throw Object.assign(new Error('WebXR unavailable'), mapXrError({ name: 'NotSupportedError' }));
    this.state = XR_STATES.REQUESTING;
    this.emit('state', this.state);

    const init = {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor', 'light-estimation', 'anchors', 'camera-access']
    };
    if (this.overlayRoot) init.domOverlay = { root: this.overlayRoot };

    let session;
    try {
      session = await this.xr.requestSession('immersive-ar', init);
    } catch (err) {
      this.state = XR_STATES.IDLE;
      this.emit('state', this.state);
      const mapped = mapXrError(err);
      throw Object.assign(new Error(mapped.message), mapped, { cause: err });
    }

    try {
      this.session = session;
      this.enabledFeatures = Array.isArray(session.enabledFeatures) ? Array.from(session.enabledFeatures) : [];
      this._endedByUser = false;

      this._onEnd = () => this._handleEnd();
      this._onVisibility = () => {
        this.visibility = session.visibilityState || 'visible';
        this.emit('visibility', this.visibility);
      };
      session.addEventListener('end', this._onEnd);
      session.addEventListener('visibilitychange', this._onVisibility);

      this.renderer.xr.setReferenceSpaceType('local');
      await this.renderer.xr.setSession(session);
      this.refSpace = this.renderer.xr.getReferenceSpace();
      this.viewerSpace = await session.requestReferenceSpace('viewer');

      this.state = XR_STATES.RUNNING;
      this.emit('state', this.state);
      this.emit('start', { session, enabledFeatures: this.enabledFeatures, domOverlay: this.domOverlayActive });
      return session;
    } catch (err) {
      // Partial start: make sure the system session does not linger.
      try { await session.end(); } catch (_) {}
      this._detach();
      this.state = XR_STATES.IDLE;
      this.emit('state', this.state);
      const mapped = mapXrError(err);
      throw Object.assign(new Error(mapped.message), mapped, { cause: err });
    }
  }

  _detach() {
    if (this.session) {
      if (this._onEnd) this.session.removeEventListener('end', this._onEnd);
      if (this._onVisibility) this.session.removeEventListener('visibilitychange', this._onVisibility);
    }
    this.session = null;
    this.viewerSpace = null;
    this.refSpace = null;
    this.enabledFeatures = [];
    this._onEnd = null;
    this._onVisibility = null;
  }

  _handleEnd() {
    const byUser = this._endedByUser;
    this._detach();
    this.state = XR_STATES.IDLE;
    this.visibility = 'visible';
    this.emit('state', this.state);
    // byUser=false → the system ended it (app switch, tracking failure, permission revoked): UI offers restart.
    this.emit('end', { byUser });
  }

  /** Idempotent. Resolves after the session has fully ended. */
  async end() {
    if (!this.session || this.state === XR_STATES.ENDING) return;
    this._endedByUser = true;
    this.state = XR_STATES.ENDING;
    const s = this.session;
    await new Promise((resolve) => {
      const done = () => resolve();
      s.addEventListener('end', done, { once: true });
      s.end().catch(done);
    });
  }

  async dispose() {
    await this.end();
    this.removeAllListeners();
  }
}
