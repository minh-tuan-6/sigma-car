// js/ar/core/resource-tracker.js — Resource Cleanup Manager.
// Tracks GPU objects, DOM listeners, timers and arbitrary cleanup callbacks so a single disposeAll()
// releases everything when the AR page is left, a model is replaced, or the XR session ends.

const TEXTURE_KEYS = [
  'map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'emissiveMap', 'envMap', 'lightMap',
  'metalnessMap', 'normalMap', 'roughnessMap', 'specularMap', 'clearcoatMap', 'clearcoatNormalMap',
  'clearcoatRoughnessMap', 'sheenColorMap', 'sheenRoughnessMap', 'transmissionMap', 'thicknessMap',
  'iridescenceMap', 'iridescenceThicknessMap', 'anisotropyMap', 'specularIntensityMap', 'specularColorMap'
];

export function disposeMaterial(material, disposedTextures = new Set()) {
  if (!material) return 0;
  let count = 0;
  for (const key of TEXTURE_KEYS) {
    const tex = material[key];
    if (tex && typeof tex.dispose === 'function' && !disposedTextures.has(tex)) {
      disposedTextures.add(tex);
      tex.dispose();
      count++;
    }
  }
  if (typeof material.dispose === 'function') material.dispose();
  return count;
}

// Disposes every geometry, material and texture below root. Returns counters (useful for tests/diagnostics).
export function disposeObject3D(root) {
  const stats = { geometries: 0, materials: 0, textures: 0 };
  if (!root || typeof root.traverse !== 'function') return stats;
  const seenGeo = new Set();
  const seenMat = new Set();
  const seenTex = new Set();
  root.traverse((obj) => {
    if (obj.geometry && !seenGeo.has(obj.geometry)) {
      seenGeo.add(obj.geometry);
      obj.geometry.dispose();
      stats.geometries++;
    }
    const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
    for (const m of mats) {
      if (seenMat.has(m)) continue;
      seenMat.add(m);
      stats.textures += disposeMaterial(m, seenTex);
      stats.materials++;
    }
  });
  if (root.parent) root.parent.remove(root);
  return stats;
}

export class ResourceTracker {
  constructor() {
    this._cleanups = [];
    this._disposed = false;
  }

  get disposed() {
    return this._disposed;
  }

  // Register any object with dispose(), or a THREE.Object3D (fully disposed recursively).
  track(resource) {
    if (!resource) return resource;
    if (typeof resource.traverse === 'function' && resource.isObject3D) {
      this._cleanups.push(() => disposeObject3D(resource));
    } else if (typeof resource.dispose === 'function') {
      this._cleanups.push(() => resource.dispose());
    }
    return resource;
  }

  listen(target, type, handler, options) {
    if (!target || typeof target.addEventListener !== 'function') return () => {};
    target.addEventListener(type, handler, options);
    const off = () => target.removeEventListener(type, handler, options);
    this._cleanups.push(off);
    return off;
  }

  timeout(fn, ms) {
    const id = setTimeout(fn, ms);
    this._cleanups.push(() => clearTimeout(id));
    return id;
  }

  add(fn) {
    if (typeof fn === 'function') this._cleanups.push(fn);
    return fn;
  }

  // Runs cleanups in reverse registration order. Idempotent; errors are isolated per cleanup.
  disposeAll() {
    const list = this._cleanups.splice(0).reverse();
    for (const fn of list) {
      try {
        fn();
      } catch (err) {
        console.warn('[AR] cleanup step failed:', err);
      }
    }
    this._disposed = true;
  }
}
