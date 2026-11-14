// js/ar/models/model-validator.js — structural validation of GLB/glTF payloads before parsing.

import { ModelLoadError } from './fetch-with-progress.js';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'

// Extensions the AR loader can decode (GLTFLoader built-ins + Draco/Meshopt/KTX2 decoders we configure).
export const SUPPORTED_EXTENSIONS = new Set([
  'KHR_draco_mesh_compression',
  'EXT_meshopt_compression',
  'KHR_meshopt_compression',
  'KHR_texture_basisu',
  'KHR_texture_transform',
  'KHR_mesh_quantization',
  'KHR_materials_clearcoat',
  'KHR_materials_transmission',
  'KHR_materials_specular',
  'KHR_materials_ior',
  'KHR_materials_emissive_strength',
  'KHR_materials_unlit',
  'KHR_materials_volume',
  'KHR_materials_sheen',
  'KHR_materials_iridescence',
  'KHR_materials_anisotropy',
  'KHR_materials_dispersion',
  'KHR_materials_variants',
  'KHR_lights_punctual',
  'EXT_texture_webp',
  'EXT_texture_avif',
  'EXT_mesh_gpu_instancing'
]);

const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

/** Validates the GLB container header and returns its parsed JSON chunk. */
export function readGlbJson(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20) {
    throw new ModelLoadError('INVALID_MODEL', 'Tệp GLB rỗng hoặc bị cắt cụt.');
  }
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new ModelLoadError('INVALID_MODEL', 'Tệp không phải định dạng GLB (sai chữ ký glTF).');
  }
  const version = view.getUint32(4, true);
  if (version !== 2) {
    throw new ModelLoadError('UNSUPPORTED_VERSION', `Chỉ hỗ trợ glTF 2.0 (tệp là phiên bản ${version}).`);
  }
  const declaredLength = view.getUint32(8, true);
  if (declaredLength > buffer.byteLength) {
    throw new ModelLoadError('TRUNCATED_MODEL', 'Tệp GLB bị tải thiếu dữ liệu.');
  }
  const jsonLength = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  if (chunkType !== CHUNK_JSON || 20 + jsonLength > buffer.byteLength) {
    throw new ModelLoadError('INVALID_MODEL', 'Cấu trúc GLB không hợp lệ (thiếu JSON chunk).');
  }
  try {
    return JSON.parse(decoder.decode(new Uint8Array(buffer, 20, jsonLength)));
  } catch (err) {
    throw new ModelLoadError('INVALID_MODEL', 'JSON trong tệp GLB bị lỗi.', { cause: err });
  }
}

/** Parses a .gltf JSON payload. */
export function readGltfJson(buffer) {
  let json;
  try {
    json = JSON.parse(decoder.decode(new Uint8Array(buffer)));
  } catch (err) {
    throw new ModelLoadError('INVALID_MODEL', 'Tệp .gltf không phải JSON hợp lệ.', { cause: err });
  }
  return json;
}

/**
 * Checks glTF JSON semantics that matter before handing it to GLTFLoader.
 * @returns {{ meshCount, materialNames: string[], animationNames: string[], extensionsUsed: string[], externalUris: string[] }}
 */
export function inspectGltfJson(json) {
  if (!json || typeof json !== 'object' || !json.asset) {
    throw new ModelLoadError('INVALID_MODEL', 'Thiếu khối "asset" trong glTF.');
  }
  const major = String(json.asset.version || '').split('.')[0];
  if (major !== '2') {
    throw new ModelLoadError('UNSUPPORTED_VERSION', `Chỉ hỗ trợ glTF 2.x (tệp khai báo ${json.asset.version}).`);
  }
  const required = Array.isArray(json.extensionsRequired) ? json.extensionsRequired : [];
  const unsupported = required.filter(e => !SUPPORTED_EXTENSIONS.has(e));
  if (unsupported.length) {
    throw new ModelLoadError('UNSUPPORTED_EXTENSION', `Mô hình yêu cầu phần mở rộng chưa hỗ trợ: ${unsupported.join(', ')}.`);
  }
  const meshCount = Array.isArray(json.meshes) ? json.meshes.length : 0;
  if (meshCount === 0) {
    throw new ModelLoadError('EMPTY_MODEL', 'Mô hình không chứa lưới 3D (mesh) nào.');
  }
  const externalUris = []
    .concat((json.buffers || []).map(b => b && b.uri), (json.images || []).map(i => i && i.uri))
    .filter(u => typeof u === 'string' && !u.startsWith('data:'));
  return {
    meshCount,
    materialNames: (json.materials || []).map(m => (m && typeof m.name === 'string') ? m.name : ''),
    animationNames: (json.animations || []).map(a => (a && typeof a.name === 'string') ? a.name : ''),
    extensionsUsed: Array.isArray(json.extensionsUsed) ? json.extensionsUsed.slice() : [],
    externalUris
  };
}

/** Sanity check on the loaded scene's raw bounds (before normalisation). */
export function validateRawBounds(size) {
  const dims = [size.x, size.y, size.z];
  if (!dims.every(Number.isFinite)) {
    throw new ModelLoadError('INVALID_BOUNDS', 'Không tính được kích thước mô hình (toạ độ không hợp lệ).');
  }
  const max = Math.max(...dims);
  if (max <= 1e-6) {
    throw new ModelLoadError('INVALID_BOUNDS', 'Mô hình có kích thước bằng 0.');
  }
  return { max };
}
