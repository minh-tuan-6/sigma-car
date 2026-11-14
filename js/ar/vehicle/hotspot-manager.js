// js/ar/vehicle/hotspot-manager.js — Hotspot Manager.
// Hotspots are DOM buttons projected from 3D anchor points every frame, so they work both in the 3D preview
// and inside the WebXR dom-overlay. Text from the manifest is inserted with textContent only (no HTML).

import { Vector3 } from 'three';

export class HotspotManager {
  /**
   * @param {{ layer: HTMLElement, hotspots: Array<{id,name,category,description,position:number[]}>, onSelect?: Function }} opts
   */
  constructor({ layer, hotspots = [], onSelect }) {
    this.layer = layer;
    this.onSelect = onSelect;
    this.visible = true;
    this.items = hotspots.map((h) => {
      const btn = layer.ownerDocument.createElement('button');
      btn.type = 'button';
      btn.className = 'ar-hotspot';
      btn.setAttribute('aria-label', h.name);
      const dot = layer.ownerDocument.createElement('span');
      dot.className = 'ar-hotspot__dot';
      btn.appendChild(dot);
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (this.onSelect) this.onSelect(h);
      });
      layer.appendChild(btn);
      return { def: h, el: btn, local: new Vector3().fromArray(h.position) };
    });
    this._world = new Vector3();
  }

  get count() {
    return this.items.length;
  }

  setVisible(v) {
    this.visible = Boolean(v);
    if (!this.visible) for (const it of this.items) it.el.style.opacity = '0';
  }

  /**
   * @param {THREE.Camera} camera  the camera whose projection matches the viewport (XR: the view camera)
   * @param {THREE.Object3D} anchor vehicle object the points are relative to
   * @param {{width:number,height:number}} viewport CSS pixels
   */
  update(camera, anchor, viewport) {
    if (!this.items.length) return;
    const show = this.visible && anchor && anchor.visible;
    for (const it of this.items) {
      if (!show) {
        it.el.style.opacity = '0';
        it.el.style.pointerEvents = 'none';
        continue;
      }
      this._world.copy(it.local);
      anchor.localToWorld(this._world);
      this._world.project(camera);
      const onScreen = this._world.z > -1 && this._world.z < 1 && Math.abs(this._world.x) <= 1.05 && Math.abs(this._world.y) <= 1.05;
      if (!onScreen) {
        it.el.style.opacity = '0';
        it.el.style.pointerEvents = 'none';
        continue;
      }
      const x = (this._world.x * 0.5 + 0.5) * viewport.width;
      const y = (-this._world.y * 0.5 + 0.5) * viewport.height;
      it.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      it.el.style.opacity = '1';
      it.el.style.pointerEvents = 'auto';
    }
  }

  dispose() {
    for (const it of this.items) it.el.remove();
    this.items = [];
  }
}
