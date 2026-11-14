// js/ar/vehicle/vehicle-controller.js — owns the loaded vehicle: model lifecycle, configuration, selection.
// Swapping a colour variant GLB replaces only the model under the anchor; placement (anchor transform) is kept.

import { Raycaster, Vector2, Color } from 'three';
import { normalizeVehicle } from '../models/model-normalizer.js';
import { MaterialConfigurator } from './material-configurator.js';
import { AnimationController } from './animation-controller.js';
import { disposeObject3D } from '../core/resource-tracker.js';
import { Emitter } from '../core/emitter.js';

export class VehicleController extends Emitter {
  /**
   * @param {{ loader: ModelLoader, anchor: THREE.Group, manifest: object }} opts
   */
  constructor({ loader, anchor, manifest }) {
    super();
    this.loader = loader;
    this.anchor = anchor;
    this.manifest = manifest;
    this.pivot = null;
    this.materials = null;
    this.animations = null;
    this.normalization = null;
    this.loadedUrl = null;
    this.config = { colorIdx: 0, wheelId: null };
    this._loadToken = 0;
    this._abort = null;
    this._raycaster = new Raycaster();
    this._highlight = null;
  }

  get loaded() {
    return Boolean(this.pivot);
  }

  get capabilities() {
    const f = this.manifest.features;
    const mat = this.materials ? this.materials.capabilities : { paint: false, rims: false };
    const anim = this.animations ? this.animations.capabilities : { doors: false };
    const hasVariants = this.manifest.variants.length > 0;
    return {
      changeColor: f.changeColor && (mat.paint || hasVariants),
      changeWheels: f.changeWheels && mat.rims,
      doorAnimations: f.doorAnimations && anim.doors,
      hotspots: f.hotspots,
      details: { materials: mat, animations: anim }
    };
  }

  _urlForColor(colorIdx) {
    const v = this.manifest.variants.find(x => x.colorIndex === colorIdx);
    return v ? v.glbUrl : this.manifest.model.glbUrl;
  }

  cancel() {
    if (this._abort) this._abort.abort();
    this._abort = null;
  }

  /**
   * Loads (or reloads) the model for the given configuration.
   * Stale loads (superseded by a newer call) are discarded and disposed.
   */
  async load(config, { onProgress } = {}) {
    const token = ++this._loadToken;
    this.cancel();
    const controller = new AbortController();
    this._abort = controller;
    const url = this._urlForColor(config.colorIdx);

    const result = await this.loader.load(url, {
      signal: controller.signal,
      onProgress,
      expectedBytes: url === this.manifest.model.glbUrl ? this.manifest.model.fileSizeBytes : undefined
    });
    if (token !== this._loadToken) {
      disposeObject3D(result.scene);
      return null;
    }

    const norm = normalizeVehicle(result.scene, {
      dimensionsMeters: this.manifest.model.dimensionsMeters,
      scaleMode: this.manifest.model.scaleMode
    });
    norm.pivot.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
      }
    });

    // Replace the previous model only once the new one is ready (no empty frame during colour swaps).
    this._disposeModel();
    this.pivot = norm.pivot;
    this.normalization = norm;
    this.loadedUrl = result.url;
    this.anchor.add(this.pivot);
    this.materials = new MaterialConfigurator(this.pivot, this.manifest.materials);
    this.animations = new AnimationController(this.pivot, result.animations, this.manifest.animations);
    this._abort = null;

    this.config = { ...config };
    this._applyConfig({ variantLoaded: url !== this.manifest.model.glbUrl });
    this.emit('config', { ...this.config });
    this.emit('loaded', { url: result.url, bytes: result.bytes, warnings: [...result.warnings, ...norm.warnings], normalization: norm });
    return { result, normalization: norm };
  }

  _applyConfig({ variantLoaded }) {
    const color = this.manifest.colors.find(c => c.index === this.config.colorIdx);
    // A colour-specific GLB already carries its authored finish; tint only when no variant was loaded.
    if (color && !variantLoaded && this.materials.capabilities.paint) this.materials.setPaint(color.hex);
    const wheel = this.manifest.wheels.find(w => w.id === this.config.wheelId);
    if (wheel && this.materials.capabilities.rims) this.materials.setRimFinish(wheel.finish);
  }

  async setColor(colorIdx, opts = {}) {
    const color = this.manifest.colors.find(c => c.index === colorIdx);
    if (!color) return false;
    const targetUrl = this._urlForColor(colorIdx);
    const resolvedTarget = new URL(targetUrl, this.loader.baseUrl).toString();
    if (resolvedTarget !== this.loadedUrl) {
      try {
        await this.load({ ...this.config, colorIdx }, opts);
        return true;
      } catch (err) {
        // Variant failed: tint the current model instead if possible, and report.
        this.emit('warning', { code: err.code || 'VARIANT_LOAD_FAILED', message: err.message });
        if (!this.materials || !this.materials.capabilities.paint) throw err;
      }
    }
    this.config.colorIdx = colorIdx;
    if (this.materials && this.materials.capabilities.paint) this.materials.setPaint(color.hex);
    this.emit('config', { ...this.config });
    return true;
  }

  setWheel(wheelId) {
    const wheel = this.manifest.wheels.find(w => w.id === wheelId);
    if (!wheel || !this.materials || !this.materials.setRimFinish(wheel.finish)) return false;
    this.config.wheelId = wheelId;
    this.emit('config', { ...this.config });
    return true;
  }

  toggleDoors() {
    return Boolean(this.animations && this.animations.toggleDoors());
  }

  update(dt) {
    if (this.animations) this.animations.update(dt);
    if (this._highlight) {
      this._highlight.t += dt;
      const k = Math.max(0, 1 - this._highlight.t / 1.2);
      for (const { mat, emissive } of this._highlight.items) {
        if (mat.emissive) mat.emissive.copy(emissive).lerp(new Color(0x38bdf8), k * 0.6);
      }
      if (k <= 0) this._clearHighlight();
    }
  }

  _clearHighlight() {
    if (!this._highlight) return;
    for (const { mat, emissive } of this._highlight.items) if (mat.emissive) mat.emissive.copy(emissive);
    this._highlight = null;
  }

  /**
   * Component selection: raycast from normalised device coords with the active camera.
   * @returns {{ part: 'body'|'wheel'|'other', meshName: string, materialName: string } | null}
   */
  pick(ndc, camera) {
    if (!this.pivot || !this.anchor.visible) return null;
    this._raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), camera);
    const hit = this._raycaster.intersectObject(this.pivot, true)[0];
    if (!hit) return null;
    const mat = Array.isArray(hit.object.material) ? hit.object.material[hit.face ? hit.face.materialIndex : 0] : hit.object.material;
    const part = this.materials ? this.materials.classify(mat) : 'other';
    this._clearHighlight();
    const group = part === 'other' ? [mat] : (part === 'body' ? this.materials.body.materials : this.materials.rims.materials);
    this._highlight = { t: 0, items: group.filter(m => m && m.emissive).map(m => ({ mat: m, emissive: m.emissive.clone() })) };
    return { part, meshName: hit.object.name || '', materialName: (mat && mat.name) || '' };
  }

  _disposeModel() {
    this._clearHighlight();
    if (this.animations) this.animations.dispose();
    if (this.pivot) disposeObject3D(this.pivot);
    this.pivot = null;
    this.materials = null;
    this.animations = null;
  }

  dispose() {
    this.cancel();
    this._loadToken++;
    this._disposeModel();
    this.removeAllListeners();
  }
}
