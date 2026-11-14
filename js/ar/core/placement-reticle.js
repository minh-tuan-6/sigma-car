// js/ar/core/placement-reticle.js — Placement Reticle.
// A ring at the hit point plus the vehicle's real-size footprint (length × width) so the user can judge
// whether the car fits the space before placing it.

import {
  Group, Mesh, RingGeometry, CircleGeometry, MeshBasicMaterial, BufferGeometry, Float32BufferAttribute,
  LineLoop, LineBasicMaterial, DoubleSide
} from 'three';

export class PlacementReticle {
  constructor({ color = 0x38bdf8 } = {}) {
    this.group = new Group();
    this.group.name = 'SigmaPlacementReticle';
    this.group.visible = false;
    this.group.matrixAutoUpdate = true;

    const ringMat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: DoubleSide, depthWrite: false });
    this.ring = new Mesh(new RingGeometry(0.16, 0.2, 48).rotateX(-Math.PI / 2), ringMat);
    this.dot = new Mesh(new CircleGeometry(0.035, 24).rotateX(-Math.PI / 2), ringMat);

    this.footprintMat = new LineBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false });
    this.footprint = new LineLoop(new BufferGeometry(), this.footprintMat);
    this.footprint.visible = false;

    this.group.add(this.ring, this.dot, this.footprint);
    this._t = 0;
  }

  /** Real dimensions in metres; the outline is drawn in the vehicle's local frame (length along Z). */
  setFootprint(lengthM, widthM) {
    if (!(lengthM > 0 && widthM > 0)) {
      this.footprint.visible = false;
      return;
    }
    const hl = lengthM / 2;
    const hw = widthM / 2;
    const y = 0.002;
    this.footprint.geometry.dispose();
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([-hw, y, -hl, hw, y, -hl, hw, y, hl, -hw, y, hl], 3));
    this.footprint.geometry = g;
    this.footprint.visible = true;
  }

  /** @param {{position: Vector3}} surface  @param {number} yaw vehicle yaw the footprint should preview */
  update(surface, yaw, visible, dt = 0.016) {
    this.group.visible = Boolean(visible && surface);
    if (!this.group.visible) return;
    this.group.position.copy(surface.position);
    this.group.rotation.set(0, yaw, 0);
    this._t += dt;
    const pulse = 1 + Math.sin(this._t * 4) * 0.06;
    this.ring.scale.setScalar(pulse);
  }

  dispose() {
    this.ring.geometry.dispose();
    this.dot.geometry.dispose();
    this.ring.material.dispose();
    this.footprint.geometry.dispose();
    this.footprintMat.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
