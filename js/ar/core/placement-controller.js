// js/ar/core/placement-controller.js — Vehicle Placement Controller (pure state machine, no rendering).
//
//   idle ──sessionStarted──▶ scanning ◀──surface lost── surface-found
//                               │      ──surface stable──▶   │
//                               │                            │ place()
//                               ▼                            ▼
//                            (reset) ◀──────────────────── placed ──startMove()──▶ moving ──place()──▶ placed
//   any ──sessionEnded──▶ idle
//
// Guarantees: no placement without a stable horizontal hit; taps while placed never re-place (they are
// interactions); a cooldown blocks accidental double placement; real scale is never changed.

import { Emitter } from './emitter.js';

export const PLACEMENT = Object.freeze({
  IDLE: 'idle',
  SCANNING: 'scanning',
  SURFACE_FOUND: 'surface-found',
  PLACED: 'placed',
  MOVING: 'moving'
});

export class PlacementController extends Emitter {
  constructor({ cooldownMs = 600, now = () => Date.now() } = {}) {
    super();
    this.state = PLACEMENT.IDLE;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.position = null; // {x,y,z} in XR reference space
    this.yaw = 0;         // radians around world +Y
    this.surfaceStable = false;
    this._lastPlacedAt = -Infinity;
    this.placeCount = 0;
  }

  _set(next) {
    if (next === this.state) return;
    const prev = this.state;
    this.state = next;
    this.emit('change', { state: next, prev });
  }

  get isPlaced() {
    return this.state === PLACEMENT.PLACED;
  }

  get canPlace() {
    return (this.state === PLACEMENT.SURFACE_FOUND || this.state === PLACEMENT.MOVING) && this.surfaceStable;
  }

  sessionStarted() {
    this.position = null;
    this.yaw = 0;
    this.surfaceStable = false;
    this._set(PLACEMENT.SCANNING);
  }

  sessionEnded() {
    this.surfaceStable = false;
    this.position = null;
    this._set(PLACEMENT.IDLE);
  }

  /** Feed the hit-test stability flag every frame. */
  surfaceUpdate(stable) {
    this.surfaceStable = Boolean(stable);
    if (this.state === PLACEMENT.SCANNING && this.surfaceStable) this._set(PLACEMENT.SURFACE_FOUND);
    else if (this.state === PLACEMENT.SURFACE_FOUND && !this.surfaceStable) this._set(PLACEMENT.SCANNING);
  }

  /**
   * Attempts placement at the current reticle position.
   * @param {{x,y,z}} hitPosition
   * @param {number} [facingYaw] initial yaw so the car faces the viewer on first placement
   * @returns {{ ok: boolean, reason?: string }}
   */
  place(hitPosition, facingYaw) {
    if (!this.canPlace) return { ok: false, reason: this.isPlaced ? 'ALREADY_PLACED' : 'NO_STABLE_SURFACE' };
    if (!hitPosition || ![hitPosition.x, hitPosition.y, hitPosition.z].every(Number.isFinite)) return { ok: false, reason: 'INVALID_HIT' };
    const t = this.now();
    if (t - this._lastPlacedAt < this.cooldownMs) return { ok: false, reason: 'COOLDOWN' };
    const firstPlacement = this.state !== PLACEMENT.MOVING;
    this.position = { x: hitPosition.x, y: hitPosition.y, z: hitPosition.z };
    if (firstPlacement && Number.isFinite(facingYaw)) this.yaw = facingYaw;
    this._lastPlacedAt = t;
    this.placeCount++;
    this._set(PLACEMENT.PLACED);
    return { ok: true };
  }

  /** Placed → moving: the vehicle follows the reticle until place() confirms. */
  startMove() {
    if (this.state !== PLACEMENT.PLACED) return false;
    this._set(PLACEMENT.MOVING);
    return true;
  }

  rotate(deltaRad) {
    if (this.state !== PLACEMENT.PLACED && this.state !== PLACEMENT.MOVING) return false;
    if (!Number.isFinite(deltaRad)) return false;
    this.yaw = (this.yaw + deltaRad) % (Math.PI * 2);
    this.emit('transform', { yaw: this.yaw });
    return true;
  }

  /** Removes the vehicle and goes back to scanning (or surface-found if the floor is still tracked). */
  reset() {
    if (this.state === PLACEMENT.IDLE) return false;
    this.position = null;
    this.yaw = 0;
    this._lastPlacedAt = -Infinity;
    this._set(this.surfaceStable ? PLACEMENT.SURFACE_FOUND : PLACEMENT.SCANNING);
    return true;
  }
}

/** Yaw that turns the vehicle's front (+Z) towards the viewer standing at viewerPos. */
export function yawFacing(vehiclePos, viewerPos) {
  const dx = viewerPos.x - vehiclePos.x;
  const dz = viewerPos.z - vehiclePos.z;
  if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return 0;
  // Present the car at a 3/4 angle (35°) rather than head-on; showroom-style.
  return Math.atan2(dx, dz) + (35 * Math.PI) / 180;
}
