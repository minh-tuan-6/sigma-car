// js/ar/core/interaction-manager.js — Vehicle Interaction Manager (gesture arbitration).
//
// Conflict rules between placing, selecting and rotating:
//   * UI controls (buttons, hotspots) suppress XR 'select' via 'beforexrselect', so pressing a button never
//     also places/selects in the scene.
//   * On handheld AR with dom-overlay, scene taps are taken from DOM pointer events (they carry screen
//     coordinates for raycasting); the duplicate XR 'select' is ignored.
//   * Without dom-overlay (e.g. headsets), XR 'select' is the tap.
//   * A one-finger horizontal drag or two-finger twist rotates; a drag never ends as a tap.
//   * Pinch is deliberately NOT mapped to scale: the vehicle stays at real 1:1 size.

import { Emitter } from './emitter.js';

const TAP_MAX_MOVE_PX = 10;
const TAP_MAX_MS = 350;
const DRAG_RAD_PER_PX = 0.012;

/** Pure gesture classifier fed with pointer events (unit-testable without a DOM). */
export class GestureArbiter extends Emitter {
  constructor({ now = () => Date.now() } = {}) {
    super();
    this.now = now;
    this.pointers = new Map();
    this.mode = 'none'; // none | pending | rotate | twist
    this._startAt = 0;
    this._lastTwistAngle = null;
    this._lastDragAt = -Infinity;
  }

  pointerDown(id, x, y) {
    this.pointers.set(id, { x, y, startX: x, startY: y });
    if (this.pointers.size === 1) {
      this.mode = 'pending';
      this._startAt = this.now();
    } else if (this.pointers.size === 2) {
      this.mode = 'twist';
      this._lastTwistAngle = this._twistAngle();
    }
  }

  pointerMove(id, x, y) {
    const p = this.pointers.get(id);
    if (!p) return;
    const dx = x - p.x;
    p.x = x;
    p.y = y;
    if (this.mode === 'pending') {
      if (Math.hypot(x - p.startX, y - p.startY) > TAP_MAX_MOVE_PX) this.mode = 'rotate';
    }
    if (this.mode === 'rotate' && this.pointers.size === 1) {
      this._lastDragAt = this.now();
      this.emit('rotate', { delta: dx * DRAG_RAD_PER_PX });
    } else if (this.mode === 'twist' && this.pointers.size === 2) {
      const a = this._twistAngle();
      if (this._lastTwistAngle !== null && a !== null) {
        let d = a - this._lastTwistAngle;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        this._lastDragAt = this.now();
        this.emit('rotate', { delta: -d });
      }
      this._lastTwistAngle = a;
    }
  }

  pointerUp(id, x, y) {
    const p = this.pointers.get(id);
    this.pointers.delete(id);
    if (!p) return;
    // The XR 'select' that must be suppressed fires on release, so a drag/twist is stamped at release time
    // (a slow drag that pauses before lifting would otherwise slip through as a placement/selection).
    if (this.mode === 'rotate' || this.mode === 'twist') this._lastDragAt = this.now();
    if (this.mode === 'pending' && this.pointers.size === 0) {
      const quick = this.now() - this._startAt <= TAP_MAX_MS;
      const still = Math.hypot(x - p.startX, y - p.startY) <= TAP_MAX_MOVE_PX;
      if (quick && still) this.emit('tap', { x, y });
    }
    if (this.pointers.size === 0) {
      this.mode = 'none';
      this._lastTwistAngle = null;
    } else if (this.pointers.size === 1) {
      // Lifting one finger of a twist must not turn into a tap.
      this.mode = 'rotate';
    }
  }

  pointerCancel(id) {
    this.pointers.delete(id);
    if (this.pointers.size === 0) this.mode = 'none';
  }

  /** True if a rotate gesture ended within `ms` — used to drop the XR 'select' that follows a drag. */
  recentlyDragged(ms = 350) {
    return this.now() - this._lastDragAt <= ms;
  }

  _twistAngle() {
    const pts = Array.from(this.pointers.values());
    if (pts.length < 2) return null;
    return Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
  }
}

/** Binds a GestureArbiter to a DOM surface and an XR session. */
export class InteractionManager extends Emitter {
  constructor({ surface, uiRoots = [], tracker }) {
    super();
    this.surface = surface;
    this.uiRoots = uiRoots;
    this.tracker = tracker;
    this.arbiter = new GestureArbiter();
    this.session = null;
    this.domOverlay = false;
    this._sessionCleanup = null;
    this.enabled = true;

    this.arbiter.on('tap', (e) => this.enabled && this.emit('tap', { ...e, source: 'pointer' }));
    this.arbiter.on('rotate', (e) => this.enabled && this.emit('rotate', e));

    const opts = { passive: true };
    tracker.listen(surface, 'pointerdown', (e) => { if (this._isUi(e.target)) return; this.arbiter.pointerDown(e.pointerId, e.clientX, e.clientY); }, opts);
    tracker.listen(surface, 'pointermove', (e) => this.arbiter.pointerMove(e.pointerId, e.clientX, e.clientY), opts);
    tracker.listen(surface, 'pointerup', (e) => this.arbiter.pointerUp(e.pointerId, e.clientX, e.clientY), opts);
    tracker.listen(surface, 'pointercancel', (e) => this.arbiter.pointerCancel(e.pointerId), opts);

    // UI controls inside the dom-overlay must not generate XR select events.
    for (const root of uiRoots) {
      tracker.listen(root, 'beforexrselect', (ev) => ev.preventDefault());
    }
  }

  _isUi(target) {
    return this.uiRoots.some(root => root && target && root.contains(target));
  }

  attachSession(session, { domOverlay }) {
    this.detachSession();
    this.session = session;
    this.domOverlay = Boolean(domOverlay);
    const onSelect = (ev) => {
      if (!this.enabled) return;
      if (this.domOverlay) return; // handled through pointer events
      if (this.arbiter.recentlyDragged()) return;
      this.emit('tap', { source: 'xr-select', inputSource: ev.inputSource, frame: ev.frame });
    };
    session.addEventListener('select', onSelect);
    this._sessionCleanup = () => session.removeEventListener('select', onSelect);
  }

  detachSession() {
    if (this._sessionCleanup) this._sessionCleanup();
    this._sessionCleanup = null;
    this.session = null;
    this.domOverlay = false;
  }

  dispose() {
    this.detachSession();
    this.removeAllListeners();
  }
}
