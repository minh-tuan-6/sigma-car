// js/ar/vehicle/vehicle-controller.js — owns the loaded vehicle: model lifecycle and paint colour.
//
// Colour changes, cheapest first:
//   * a colour with its own authored GLB (manifest.variants) loads that file once (cached afterwards);
//   * otherwise the body-paint materials named in the manifest are re-tinted in place — no reload, and
//     metalness / roughness / clearcoat / textures are untouched, so reflections stay physically the same.
// Glass, lights, tyres, rims and every other material are never modified.

import { normalizeVehicle } from '../models/model-normalizer.js';
import { MaterialConfigurator } from './material-configurator.js';
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
    this.normalization = null;
    this.loadedUrl = null;
    this.colorIdx = 0;
    this._loadToken = 0;
    this._abort = null;
  }

  get loaded() {
    return Boolean(this.pivot);
  }

  get capabilities() {
    const mat = this.materials ? this.materials.capabilities : { paint: false };
    const hasVariants = this.manifest.variants.length > 0;
    return {
      changeColor: this.manifest.features.changeColor && (mat.paint || hasVariants),
      materials: mat
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

  /** Loads (or reloads) the model for a colour. Stale loads (superseded by a newer call) are discarded. */
  async load(colorIdx, { onProgress } = {}) {
    const token = ++this._loadToken;
    this.cancel();
    const controller = new AbortController();
    this._abort = controller;
    const url = this._urlForColor(colorIdx);

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
    this._abort = null;

    this.colorIdx = colorIdx;
    const color = this.manifest.colors.find(c => c.index === colorIdx);
    // A colour-specific GLB already carries its authored finish; tint only when no variant was loaded.
    if (color && url === this.manifest.model.glbUrl && this.materials.capabilities.paint) this.materials.setPaint(color.hex);
    this.emit('color', colorIdx);
    this.emit('loaded', { url: result.url, bytes: result.bytes, warnings: [...result.warnings, ...norm.warnings], normalization: norm });
    return { result, normalization: norm };
  }

  /** @returns {Promise<{ changed: boolean, reloaded: boolean }>} */
  async setColor(colorIdx, opts = {}) {
    const color = this.manifest.colors.find(c => c.index === colorIdx);
    if (!color) return { changed: false, reloaded: false };
    const target = new URL(this._urlForColor(colorIdx), this.loader.baseUrl).toString();
    if (target !== this.loadedUrl) {
      try {
        const res = await this.load(colorIdx, opts);
        return { changed: Boolean(res), reloaded: Boolean(res) };
      } catch (err) {
        // The variant file failed: tint the current model instead when possible, and report it.
        this.emit('warning', { code: err.code || 'VARIANT_LOAD_FAILED', message: err.message });
        if (!this.materials || !this.materials.capabilities.paint) throw err;
      }
    }
    if (!this.materials || !this.materials.capabilities.paint) return { changed: false, reloaded: false };
    this.materials.setPaint(color.hex);
    this.colorIdx = colorIdx;
    this.emit('color', colorIdx);
    return { changed: true, reloaded: false };
  }

  _disposeModel() {
    if (this.pivot) disposeObject3D(this.pivot);
    this.pivot = null;
    this.materials = null;
  }

  dispose() {
    this.cancel();
    this._loadToken++;
    this._disposeModel();
    this.removeAllListeners();
  }
}
