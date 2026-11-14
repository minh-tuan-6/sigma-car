// js/ar/apple/usdz-builder.js — converts the loaded (and colour-configured) vehicle into a USDZ for AR Quick Look.
//
// AR Quick Look cannot open GLB/glTF. When the manifest has no ready-made USDZ for the selected colour, the
// page converts the exact model it is showing — already normalised to real-world metres, grounded at y = 0,
// with the selected paint applied to the body materials only — using three.js USDZExporter
// (UsdPreviewSurface materials, horizontal plane anchoring). scripts/build_usdz.js runs this same module in
// headless Chrome to pre-build USDZ files at release time, so both paths produce identical assets.
//
// Known conversion limits (reported as warnings, never hidden):
//   * only MeshStandardMaterial / MeshPhysicalMaterial meshes are exported (unlit / multi-material meshes are skipped);
//   * USD preview surfaces are single-sided; glTF doubleSided is not carried over;
//   * compressed (KTX2) textures need decompression support and are rejected here;
//   * textures are re-encoded as PNG at source resolution (cap 8192 px, the largest texture Apple GPUs sample).
// There is NO size limit: large models are converted in full (no decimation, no texture downscaling). On a phone
// the browser may still run out of memory; that real error is reported (OUT_OF_MEMORY), and large models are
// meant to be served pre-built (scripts/build_usdz.js) so the phone never has to convert them.

const USD_LAYER_RE = /\.(usda|usdc|usd)$/i;

export class UsdzBuildError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'UsdzBuildError';
    this.code = code;
    Object.assign(this, details);
  }
}

let exporterModule = null;
async function loadExporter() {
  if (!exporterModule) exporterModule = import('three/addons/exporters/USDZExporter.js');
  const { USDZExporter } = await exporterModule;
  return new USDZExporter();
}

// three.js USDZExporter writes geometry as ASCII .usda (7 significant digits) inside an uncompressed zip, so a
// Draco-compressed GLB can grow ~40× (measured: vinfast_vf9.glb 1.9 MB → 89.7 MB USDZ). The estimate below is
// informational only (progress text, diagnostics); it never blocks a conversion.
export const DEFAULT_MAX_TEXTURE_SIZE = 8192;
const BYTES_PER_FLOAT = 12;   // "-0.1234567, " incl. separators and parentheses (calibrated in AR_TEST_REPORT.md)
const BYTES_PER_INDEX = 7;
const BYTES_PER_TEXEL = 1.2; // re-encoded PNG (lossless; varies with content)

/** Inventory of what the exporter will and will not carry over. Pure; safe to call in tests. */
export function auditExportable(root, { maxTextureSize = DEFAULT_MAX_TEXTURE_SIZE } = {}) {
  const report = { meshes: 0, exported: 0, skippedUnsupportedMaterial: 0, skippedMultiMaterial: 0, doubleSided: 0, compressedTextures: 0, textures: 0, estimatedBytes: 0 };
  const seenTex = new Set();
  const seenGeo = new Set();
  const seenImages = new Set();
  root.traverseVisible((o) => {
    if (!o.isMesh) return;
    report.meshes++;
    if (Array.isArray(o.material)) {
      report.skippedMultiMaterial++;
      return;
    }
    const m = o.material;
    if (!m || !m.isMeshStandardMaterial) {
      report.skippedUnsupportedMaterial++;
      return;
    }
    report.exported++;
    if (m.side === 2 /* THREE.DoubleSide */) report.doubleSided++;
    const g = o.geometry;
    if (g && !seenGeo.has(g)) {
      seenGeo.add(g);
      let floats = 0;
      for (const name of ['position', 'normal', 'uv', 'uv1', 'color']) {
        const a = g.attributes && g.attributes[name];
        if (a) floats += a.count * a.itemSize;
      }
      const position = g.attributes && g.attributes.position;
      const indices = g.index ? g.index.count : (position ? position.count : 0);
      // faceVertexIndices + faceVertexCounts (one per triangle)
      report.estimatedBytes += floats * BYTES_PER_FLOAT + indices * BYTES_PER_INDEX + (indices / 3) * 3;
    }
    for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'clearcoatMap', 'clearcoatRoughnessMap', 'clearcoatNormalMap']) {
      const t = m[key];
      if (t && !seenTex.has(t)) {
        seenTex.add(t);
        report.textures++;
        if (t.isCompressedTexture) report.compressedTextures++;
        // The exporter writes one PNG per image source (and flipY), not per texture object.
        const img = t.image;
        const imageKey = `${t.source ? t.source.id : t.uuid}_${t.flipY}`;
        if (img && img.width > 0 && img.height > 0 && !seenImages.has(imageKey)) {
          seenImages.add(imageKey);
          const k = Math.min(1, maxTextureSize / Math.max(img.width, img.height));
          report.estimatedBytes += img.width * k * img.height * k * BYTES_PER_TEXEL;
        }
      }
    }
  });
  return report;
}

/**
 * Structural validation of a USDZ archive per the USDZ spec: an uncompressed ("stored") zip whose first
 * entry is the root USD layer, with every file's data 64-byte aligned.
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {{ ok: boolean, problems: string[], entries: string[], firstFile: string|null, bytes: number }}
 */
export function inspectUsdz(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const problems = [];
  const entries = [];
  let offset = 0;
  if (bytes.byteLength < 30 || view.getUint32(0, true) !== 0x04034b50) {
    const head = new TextDecoder().decode(bytes.subarray(0, 64)).trim().toLowerCase();
    problems.push(head.startsWith('<!doctype') || head.startsWith('<html') ? 'HTML_INSTEAD_OF_USDZ' : 'NOT_A_ZIP');
    return { ok: false, problems, entries, firstFile: null, bytes: bytes.byteLength };
  }
  while (offset + 30 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;
    entries.push(name);
    if (method !== 0) problems.push(`COMPRESSED_ENTRY:${name}`);
    if (flags & 0x08) problems.push(`DATA_DESCRIPTOR:${name}`);
    if (dataStart % 64 !== 0) problems.push(`UNALIGNED_ENTRY:${name}`);
    offset = dataStart + compSize;
    if (offset > bytes.byteLength) {
      problems.push('TRUNCATED');
      break;
    }
  }
  const firstFile = entries[0] || null;
  if (!firstFile || !USD_LAYER_RE.test(firstFile)) problems.push('FIRST_ENTRY_NOT_USD_LAYER');
  return { ok: problems.length === 0, problems, entries, firstFile, bytes: bytes.byteLength };
}

/**
 * Validates only the first local-file header (enough to reject HTML / non-USDZ responses from a partial read).
 * @returns {{ ok: boolean, problem: string|null, firstFile: string|null }}
 */
export function inspectUsdzHeader(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const head = new TextDecoder().decode(bytes.subarray(0, 64)).trim().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html')) return { ok: false, problem: 'HTML_INSTEAD_OF_USDZ', firstFile: null };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 4 || view.getUint32(0, true) !== 0x04034b50) return { ok: false, problem: 'NOT_A_ZIP', firstFile: null };
  if (bytes.byteLength < 30) return { ok: false, problem: 'TOO_SHORT', firstFile: null };
  const nameLen = view.getUint16(26, true);
  if (bytes.byteLength < 30 + nameLen) return { ok: false, problem: 'TOO_SHORT', firstFile: null };
  const firstFile = new TextDecoder().decode(bytes.subarray(30, 30 + nameLen));
  if (view.getUint16(8, true) !== 0) return { ok: false, problem: 'COMPRESSED_ENTRY', firstFile };
  if (!USD_LAYER_RE.test(firstFile)) return { ok: false, problem: 'FIRST_ENTRY_NOT_USD_LAYER', firstFile };
  return { ok: true, problem: null, firstFile };
}

/**
 * Exports the vehicle pivot (normalised: metres, +Y up, grounded) to USDZ bytes.
 * The pivot must not be moved by a parent transform other than identity — the preview anchor is.
 * @param {THREE.Object3D} pivot
 * @param {{ maxTextureSize?: number, exporter?: { parseAsync: Function }, onProgress?: (p: { phase: string, estimatedBytes?: number }) => void }} [opts]
 * @returns {Promise<{ bytes: Uint8Array, report: object, warnings: string[] }>}
 */
export async function buildVehicleUsdz(pivot, { maxTextureSize = DEFAULT_MAX_TEXTURE_SIZE, exporter, onProgress } = {}) {
  if (!pivot || typeof pivot.traverseVisible !== 'function') throw new UsdzBuildError('NO_MODEL', 'Chưa có mô hình để chuyển đổi.');
  const progress = (phase) => { if (onProgress) { try { onProgress({ phase, estimatedBytes: report.estimatedBytes }); } catch (_) {} } };
  const report = auditExportable(pivot, { maxTextureSize });
  report.estimatedBytes = Math.round(report.estimatedBytes);
  progress('analysed');
  if (report.exported === 0) {
    throw new UsdzBuildError('NOTHING_EXPORTABLE', 'Mô hình không có vật liệu PBR nào chuyển được sang USDZ.', { report });
  }
  if (report.compressedTextures > 0) {
    throw new UsdzBuildError('COMPRESSED_TEXTURES', 'Mô hình dùng texture nén KTX2; cần tệp USDZ dựng sẵn cho AR Quick Look.', { report });
  }
  const warnings = [];
  if (report.skippedUnsupportedMaterial || report.skippedMultiMaterial) {
    warnings.push(`USDZ_SKIPPED_MESHES: ${report.skippedUnsupportedMaterial + report.skippedMultiMaterial}/${report.meshes} lưới không dùng vật liệu PBR đơn nên không có trong USDZ.`);
  }
  if (report.doubleSided) {
    warnings.push(`USDZ_SINGLE_SIDED: ${report.doubleSided} vật liệu hai mặt được xuất một mặt.`);
  }

  pivot.updateWorldMatrix(true, true);
  const exp = exporter || await loadExporter();
  progress('exporting');
  // Let the UI paint the progress state before the CPU-bound export starts.
  await new Promise(r => setTimeout(r, 0));
  let out;
  // The exporter logs the whole material object for every double-sided material; that is already summarised
  // in `warnings`, so those messages are filtered while it runs.
  const origWarn = console.warn;
  console.warn = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('USDZExporter') && args[0].includes('double sided')) return;
    origWarn.apply(console, args);
  };
  try {
    out = await exp.parseAsync(pivot, {
      ar: { anchoring: { type: 'plane' }, planeAnchoring: { alignment: 'horizontal' } },
      includeAnchoringProperties: true,
      quickLookCompatible: true,
      maxTextureSize
    });
  } catch (err) {
    throw classifyExportError(err, report);
  } finally {
    console.warn = origWarn;
  }
  const bytes = out instanceof Uint8Array ? out : new Uint8Array(out);
  progress('validating');
  const check = inspectUsdz(bytes);
  if (!check.ok) {
    throw new UsdzBuildError('INVALID_USDZ', `USDZ tạo ra không hợp lệ (${check.problems.join(', ')}).`, { report, check });
  }
  progress('done');
  return { bytes, report: { ...report, entries: check.entries.length, bytes: bytes.byteLength }, warnings };
}

/** Maps an exporter failure to its real cause (never to a size guess). */
export function classifyExportError(err, report = null) {
  const msg = String((err && err.message) || err);
  const name = (err && err.name) || '';
  // V8: "Invalid string length" / "Array buffer allocation failed"; JavaScriptCore: "Out of memory".
  const oom = name === 'RangeError' && /string length|allocation|array buffer|out of memory|invalid array length/i.test(msg)
    || /out of memory/i.test(msg);
  if (oom) {
    return new UsdzBuildError('OUT_OF_MEMORY',
      `Trình duyệt hết bộ nhớ khi tạo USDZ cho mô hình này (${msg.slice(0, 120)}); cần tệp USDZ dựng sẵn từ máy chủ.`, { cause: err, report });
  }
  if (/image|canvas|toBlob|drawImage/i.test(msg)) {
    return new UsdzBuildError('TEXTURE_EXPORT_FAILED', `Không chuyển được texture sang USDZ: ${msg.slice(0, 200)}`, { cause: err, report });
  }
  return new UsdzBuildError('EXPORT_FAILED', `Không chuyển được mô hình sang USDZ: ${msg.slice(0, 200)}`, { cause: err, report });
}
