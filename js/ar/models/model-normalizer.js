// js/ar/models/model-normalizer.js — orientation, real-world scale and ground alignment for vehicle models.
//
// Output frame (what the placement controller relies on):
//   +Y up, vehicle length along Z, centred on X/Z, lowest point (tyre contact) at y = 0, units = metres.

import { Box3, Group, Vector3 } from 'three';
import { validateRawBounds } from './model-validator.js';

const SIDEWAYS_RATIO = 1.2;   // length must exceed width by this factor to infer the long axis
const Z_UP_RATIO = 1.35;      // a car is never much taller than it is long
const CERTIFIED_TOLERANCE = 0.15;
const PLAUSIBLE_LENGTH_M = [1.5, 25];
const ASSUMED_LENGTH_M = 4.5;

function measure(object) {
  object.updateMatrixWorld(true);
  const box = new Box3().setFromObject(object, true);
  return { box, size: box.getSize(new Vector3()) };
}

/**
 * Wraps `model` in a pivot group and normalises it in place.
 * @param {THREE.Object3D} model
 * @param {{ dimensionsMeters?: {length,width,height}, scaleMode?: 'certified'|'fit-to-length'|'as-authored' }} opts
 * @returns {{ pivot: THREE.Group, scale: number, rotations: string[], sizeMeters: {length,width,height}, warnings: string[] }}
 */
export function normalizeVehicle(model, { dimensionsMeters = null, scaleMode = 'as-authored' } = {}) {
  const warnings = [];
  const rotations = [];
  const pivot = new Group();
  pivot.name = 'SigmaVehiclePivot';
  pivot.add(model);

  let { size } = measure(pivot);
  validateRawBounds(size);

  // 1. Orientation: Z-up exports and length-along-X exports.
  if (size.y > size.z * Z_UP_RATIO && size.y > size.x * Z_UP_RATIO) {
    model.rotation.x -= Math.PI / 2;
    rotations.push('z-up→y-up');
    ({ size } = measure(pivot));
  }
  if (size.x > size.z * SIDEWAYS_RATIO) {
    model.rotation.y -= Math.PI / 2;
    rotations.push('length-x→z');
    ({ size } = measure(pivot));
  }

  // 2. Scale to real-world metres.
  const measuredLength = Math.max(size.x, size.z);
  const declared = dimensionsMeters && Number(dimensionsMeters.length) > 0 ? Number(dimensionsMeters.length) : null;
  let scale = 1;
  let mode = scaleMode;

  if (mode === 'certified') {
    if (!declared) {
      mode = 'as-authored';
    } else if (Math.abs(measuredLength - declared) / declared > CERTIFIED_TOLERANCE) {
      warnings.push(`CERTIFIED_SCALE_MISMATCH: đo được ${measuredLength.toFixed(3)} m, khai báo ${declared} m — đã hiệu chỉnh theo chiều dài khai báo.`);
      mode = 'fit-to-length';
    }
  }
  if (mode === 'fit-to-length' && declared) {
    scale = declared / measuredLength;
  } else if (mode === 'fit-to-length' || mode === 'as-authored') {
    if (measuredLength < PLAUSIBLE_LENGTH_M[0] || measuredLength > PLAUSIBLE_LENGTH_M[1]) {
      // Authored in cm/mm or arbitrary units and no declared dimensions: never show a toy or a building.
      scale = ASSUMED_LENGTH_M / measuredLength;
      warnings.push(`ASSUMED_LENGTH: mô hình không có kích thước thực, tạm hiển thị dài ${ASSUMED_LENGTH_M} m.`);
    }
  }
  if (scale !== 1) model.scale.multiplyScalar(scale);

  // 3. Ground at y=0 and centre on X/Z.
  const { box } = measure(pivot);
  const center = box.getCenter(new Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;
  const final = measure(pivot).size;

  return {
    pivot,
    scale,
    scaleMode: mode,
    rotations,
    sizeMeters: {
      length: round3(Math.max(final.x, final.z)),
      width: round3(Math.min(final.x, final.z)),
      height: round3(final.y)
    },
    warnings
  };
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}
