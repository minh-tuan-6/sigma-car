// js/ar/vehicle/material-configurator.js — Vehicle Material Configurator.
// Binds to materials by the exact names declared in the manifest and verified to exist in the loaded GLB.
// Nothing is guessed: if a declared name is absent, the corresponding control is disabled.

import { Color } from 'three';

function collectMaterials(root) {
  const byName = new Map();
  root.traverse((obj) => {
    const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
    for (const m of mats) {
      const name = typeof m.name === 'string' ? m.name : '';
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name).add(m);
    }
  });
  return byName;
}

function resolveNames(byName, names, protectedPatterns) {
  const matched = [];
  const missing = [];
  const materials = new Set();
  const lowerIndex = new Map(Array.from(byName.keys()).map(n => [n.toLowerCase(), n]));
  for (const wanted of names) {
    const actual = byName.has(wanted) ? wanted : lowerIndex.get(wanted.toLowerCase());
    if (!actual || protectedPatterns.some(p => actual.toLowerCase().includes(p))) {
      missing.push(wanted);
      continue;
    }
    matched.push(actual);
    for (const m of byName.get(actual)) materials.add(m);
  }
  return { matched, missing, materials: Array.from(materials) };
}

export class MaterialConfigurator {
  /**
   * @param {THREE.Object3D} root
   * @param {{ body: string[], rims: string[], protectedPatterns?: string[] }} names
   */
  constructor(root, { body = [], rims = [], protectedPatterns = [] } = {}) {
    const byName = collectMaterials(root);
    this.allMaterialNames = Array.from(byName.keys()).filter(Boolean);
    const protectedLower = protectedPatterns.map(p => String(p).toLowerCase());
    // Body names must never be protected materials (glass, lights, tyres…).
    this.body = resolveNames(byName, body, protectedLower);
    // Rims are allowed to match 'chrome'-like patterns, so only glass/light/tyre-style protections apply.
    this.rims = resolveNames(byName, rims, protectedLower.filter(p => !['chrome', 'brake', 'disk', 'disc', 'caliper'].includes(p)));
    this._original = new Map();
    for (const m of [...this.body.materials, ...this.rims.materials]) {
      this._original.set(m, {
        color: m.color ? m.color.clone() : null,
        roughness: m.roughness,
        metalness: m.metalness
      });
    }
    this.state = { paintHex: null, rimFinish: null };
  }

  get capabilities() {
    return {
      paint: this.body.materials.length > 0,
      rims: this.rims.materials.length > 0,
      matchedBody: this.body.matched.slice(),
      missingBody: this.body.missing.slice(),
      matchedRims: this.rims.matched.slice(),
      missingRims: this.rims.missing.slice()
    };
  }

  /** Classifies a material for component selection. */
  classify(material) {
    if (!material) return 'other';
    if (this.body.materials.includes(material)) return 'body';
    if (this.rims.materials.includes(material)) return 'wheel';
    return 'other';
  }

  setPaint(hex) {
    if (!this.capabilities.paint || !/^#[0-9a-f]{6}$/i.test(hex)) return false;
    const c = new Color(hex);
    for (const m of this.body.materials) {
      if (m.color) m.color.copy(c);
      m.needsUpdate = true;
    }
    this.state.paintHex = hex.toUpperCase();
    return true;
  }

  setRimFinish(finish) {
    if (!this.capabilities.rims || !finish || !/^#[0-9a-f]{6}$/i.test(finish.color)) return false;
    const c = new Color(finish.color);
    for (const m of this.rims.materials) {
      if (m.color) m.color.copy(c);
      if (typeof m.roughness === 'number' && Number.isFinite(finish.roughness)) m.roughness = finish.roughness;
      if (typeof m.metalness === 'number' && Number.isFinite(finish.metalness)) m.metalness = finish.metalness;
      m.needsUpdate = true;
    }
    this.state.rimFinish = { ...finish };
    return true;
  }

  reset() {
    for (const [m, o] of this._original) {
      if (o.color && m.color) m.color.copy(o.color);
      if (o.roughness !== undefined) m.roughness = o.roughness;
      if (o.metalness !== undefined) m.metalness = o.metalness;
      m.needsUpdate = true;
    }
    this.state = { paintHex: null, rimFinish: null };
  }
}
