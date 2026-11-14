// js/ar/core/hit-test-manager.js — Surface Hit-Test Manager (WebXR Hit Test API).
// Only horizontal, upward-facing surfaces (floors/ground) are accepted for parking a vehicle, and a surface
// must be confirmed over several consecutive frames before placement is offered.

import { Matrix4, Quaternion, Vector3 } from 'three';

const UP = new Vector3(0, 1, 0);

/**
 * Evaluates a hit pose matrix (column-major Float32Array(16), as XRRigidTransform.matrix).
 * The surface normal is the pose's +Y axis.
 */
export function evaluateHitPose(matrixArray, { maxTiltDeg = 20 } = {}) {
  if (!matrixArray || matrixArray.length !== 16 || !Array.from(matrixArray).every(Number.isFinite)) {
    return { valid: false, reason: 'NO_POSE' };
  }
  const m = new Matrix4().fromArray(matrixArray);
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  m.decompose(position, quaternion, scale);
  const normal = new Vector3(0, 1, 0).applyQuaternion(quaternion).normalize();
  const upDot = normal.dot(UP);
  const valid = upDot >= Math.cos((maxTiltDeg * Math.PI) / 180);
  return { valid, reason: valid ? 'OK' : 'NOT_HORIZONTAL', position, quaternion, normal, upDot };
}

/** Debounces surface detection: N consecutive good frames to "found", M consecutive misses to "lost". */
export class SurfaceStabilityFilter {
  constructor({ framesToConfirm = 3, framesToLose = 8 } = {}) {
    this.framesToConfirm = framesToConfirm;
    this.framesToLose = framesToLose;
    this.goodStreak = 0;
    this.badStreak = 0;
    this.stable = false;
  }

  push(valid) {
    if (valid) {
      this.goodStreak++;
      this.badStreak = 0;
      if (!this.stable && this.goodStreak >= this.framesToConfirm) this.stable = true;
    } else {
      this.badStreak++;
      this.goodStreak = 0;
      if (this.stable && this.badStreak >= this.framesToLose) this.stable = false;
    }
    return this.stable;
  }

  reset() {
    this.goodStreak = 0;
    this.badStreak = 0;
    this.stable = false;
  }
}

export class HitTestManager {
  constructor({ session, viewerSpace, maxTiltDeg = 20, smoothing = 0.35 } = {}) {
    this.session = session;
    this.viewerSpace = viewerSpace;
    this.maxTiltDeg = maxTiltDeg;
    this.smoothing = smoothing;
    this.source = null;
    this.filter = new SurfaceStabilityFilter();
    this.latest = { stable: false, valid: false, position: new Vector3(), quaternion: new Quaternion(), reason: 'INIT' };
    this._smoothed = null;
    this._disposed = false;
  }

  async init() {
    this.source = await this.session.requestHitTestSource({ space: this.viewerSpace });
    if (this._disposed) {
      this.source.cancel();
      this.source = null;
    }
    return this;
  }

  /** Call once per XR frame. Returns the latest (smoothed) surface state. */
  update(frame, refSpace) {
    if (!this.source || !frame || !refSpace) return this.latest;
    const results = frame.getHitTestResults(this.source);
    let evaluation = { valid: false, reason: results.length ? 'NO_POSE' : 'NO_SURFACE' };
    if (results.length) {
      const pose = results[0].getPose(refSpace);
      if (pose) evaluation = evaluateHitPose(pose.transform.matrix, { maxTiltDeg: this.maxTiltDeg });
    }
    const stable = this.filter.push(evaluation.valid);
    if (evaluation.valid) {
      if (!this._smoothed) {
        this._smoothed = { position: evaluation.position.clone(), quaternion: evaluation.quaternion.clone() };
      } else {
        // Exponential smoothing removes reticle jitter without visible lag.
        this._smoothed.position.lerp(evaluation.position, 1 - this.smoothing);
        this._smoothed.quaternion.slerp(evaluation.quaternion, 1 - this.smoothing);
      }
    }
    this.latest = {
      stable,
      valid: evaluation.valid,
      reason: evaluation.reason,
      position: this._smoothed ? this._smoothed.position : this.latest.position,
      quaternion: this._smoothed ? this._smoothed.quaternion : this.latest.quaternion
    };
    return this.latest;
  }

  reset() {
    this.filter.reset();
    this._smoothed = null;
    this.latest = { stable: false, valid: false, position: new Vector3(), quaternion: new Quaternion(), reason: 'INIT' };
  }

  dispose() {
    this._disposed = true;
    if (this.source) {
      try { this.source.cancel(); } catch (_) {}
    }
    this.source = null;
  }
}
