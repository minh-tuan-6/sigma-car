// js/ar/vehicle/material-configurator.js — vehicle paint configurator.
// Binds to body-paint materials by the exact names declared in the manifest and verified to exist in the
// loaded GLB. Nothing is guessed: if no declared name is present, colour change is disabled.
// Only the base colour of those materials changes; metalness, roughness, clearcoat, maps and every other
// material (glass, lights, tyres, rims, trim) are left exactly as authored.

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
   * @param {{ body: string[], protectedPatterns?: string[] }} names
   */
  constructor(root, { body = [], protectedPatterns = [] } = {}) {
    const byName = collectMaterials(root);
    this.allMaterialNames = Array.from(byName.keys()).filter(Boolean);
    // Body names must never resolve to protected materials (glass, lights, tyres…).
    this.body = resolveNames(byName, body, protectedPatterns.map(p => String(p).toLowerCase()));
    this._original = new Map(this.body.materials.map(m => [m, m.color ? m.color.clone() : null]));
    this.state = { paintHex: null };
  }

  get capabilities() {
    return {
      paint: this.body.materials.length > 0,
      matchedBody: this.body.matched.slice(),
      missingBody: this.body.missing.slice()
    };
  }

  setPaint(hex) {
    if (!this.capabilities.paint || !/^#[0-9a-f]{6}$/i.test(hex)) return false;
    const c = new Color(hex);
    for (const m of this.body.materials) {
      if (m.color) m.color.copy(c);
    }
    this.state.paintHex = hex.toUpperCase();
    return true;
  }

  reset() {
    for (const [m, color] of this._original) {
      if (color && m.color) m.color.copy(color);
    }
    this.state = { paintHex: null };
  }
}
