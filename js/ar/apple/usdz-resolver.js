// js/ar/apple/usdz-resolver.js — picks (or produces) the USDZ that AR Quick Look opens for the selected colour.
//
// Order for a colour:
//   1. a USDZ declared for that exact colour (pre-built by scripts/build_usdz.js, or an external HTTPS URL);
//      it is probed first when the server allows it, and skipped if it turns out not to be a USDZ;
//   2. on-device conversion of the model currently shown (selected paint already applied) — no size limit;
//   3. a colour-independent USDZ, launched with an explicit "default colour" notice;
//   4. nothing → the AR button stays disabled with the reason.
// Generated files are cached per colour as blob: URLs (no re-export when switching back) and revoked on dispose.

import { validateUsdzUrl } from '../models/url-policy.js';
import { buildVehicleUsdz, inspectUsdzHeader, UsdzBuildError } from './usdz-builder.js';

const PROBE_BYTES = 1024;

async function readHead(res, max) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    return new Uint8Array(await res.arrayBuffer()).subarray(0, max);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    try { await reader.cancel(); } catch (_) {}
  }
  const out = new Uint8Array(Math.min(total, max));
  let o = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, out.byteLength - o);
    out.set(c.subarray(0, take), o);
    o += take;
    if (o >= out.byteLength) break;
  }
  return out;
}

export class UsdzResolver {
  /**
   * @param {object} opts
   * @param {object} opts.manifest   validated AR manifest (schema v2)
   * @param {string} opts.baseUrl    site root used to resolve relative asset paths
   * @param {Function} [opts.fetchImpl]
   * @param {Function} [opts.build]  (pivot) => Promise<{ bytes, report, warnings }>
   */
  constructor({ manifest, baseUrl, fetchImpl, build = buildVehicleUsdz, createObjectURL, revokeObjectURL } = {}) {
    this.manifest = manifest;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl || ((...a) => fetch(...a));
    this.build = build;
    this.createObjectURL = createObjectURL || ((blob) => URL.createObjectURL(blob));
    this.revokeObjectURL = revokeObjectURL || ((u) => URL.revokeObjectURL(u));
    this._generated = new Map();   // colorIdx → { url, bytes, warnings, report }
    this._probes = new Map();      // url → Promise<probe>
  }

  get entries() {
    return (this.manifest.appleAr && this.manifest.appleAr.usdz) || [];
  }

  get canConvertOnDevice() {
    return Boolean(this.manifest.appleAr && this.manifest.appleAr.onDeviceConversion);
  }

  _resolve(entry) {
    const check = validateUsdzUrl(entry.url, { baseUrl: this.baseUrl });
    return check.ok ? check.url : null;
  }

  /** Static decision for a colour, before any network/conversion. */
  plan(colorIdx) {
    const exact = this.entries.find(e => e.colorIndex === colorIdx && this._resolve(e));
    const generic = this.entries.find(e => e.colorIndex === null && this._resolve(e));
    // When the vehicle has no colour choice at all, a generic file is an exact match.
    const colorsMatter = this.manifest.features.changeColor && this.manifest.colors.length > 1;
    return {
      exact: exact ? { ...exact, url: this._resolve(exact) } : null,
      convert: this.canConvertOnDevice,
      generic: generic ? { ...generic, url: this._resolve(generic), colorMatch: !colorsMatter } : null
    };
  }

  /**
   * Checks that a URL really serves a USDZ. Cross-origin servers without CORS cannot be inspected; those are
   * 'unverified' (still launchable: Quick Look fetches the file itself).
   */
  probe(url) {
    if (!this._probes.has(url)) {
      this._probes.set(url, (async () => {
        let res;
        try {
          res = await this.fetchImpl(url, { headers: { Range: `bytes=0-${PROBE_BYTES - 1}` }, credentials: 'omit' });
        } catch (_) {
          return { status: 'unverified', problem: 'NOT_INSPECTABLE' };
        }
        if (res.status === 404 || res.status === 410) return { status: 'invalid', problem: `HTTP_${res.status}` };
        if (!res.ok) return { status: 'unverified', problem: `HTTP_${res.status}` };
        const head = await readHead(res, PROBE_BYTES);
        const check = inspectUsdzHeader(head);
        return check.ok ? { status: 'valid', problem: null } : { status: 'invalid', problem: check.problem };
      })());
    }
    return this._probes.get(url);
  }

  /**
   * Resolves the USDZ for a colour.
   * @param {number} colorIdx
   * @param {{ getPivot: () => THREE.Object3D|null, isCurrent?: () => boolean, onProgress?: Function }} ctx
   * @returns {Promise<{ url: string, kind: 'prebuilt'|'external'|'generated'|'generic', colorMatch: boolean, bytes: number|null, warnings: string[], probe?: object }>}
   */
  async prepare(colorIdx, { getPivot, isCurrent = () => true, onProgress } = {}) {
    const p = this.plan(colorIdx);
    const notes = [];

    if (p.exact) {
      const probe = await this.probe(p.exact.url);
      if (probe.status !== 'invalid') {
        return { url: p.exact.url, kind: p.exact.source === 'prebuilt' ? 'prebuilt' : 'external', colorMatch: true, bytes: p.exact.bytes || null, warnings: [], probe };
      }
      notes.push(`USDZ_INVALID: ${p.exact.url} (${probe.problem})`);
    }

    if (p.convert) {
      const cached = this._generated.get(colorIdx);
      if (cached) return { url: cached.url, kind: 'generated', colorMatch: true, bytes: cached.bytes, warnings: [...notes, ...cached.warnings], report: cached.report };
      const pivot = getPivot ? getPivot() : null;
      if (!pivot) throw new UsdzBuildError('NO_MODEL', 'Mô hình chưa sẵn sàng để chuẩn bị AR.');
      const t0 = Date.now();
      const out = await this.build(pivot, { onProgress });
      if (!isCurrent()) return null; // the colour changed while converting; the newer request wins
      const url = this.createObjectURL(new Blob([out.bytes], { type: 'model/vnd.usdz+zip' }));
      const entry = { url, bytes: out.bytes.byteLength, warnings: out.warnings || [], report: { ...(out.report || {}), ms: Date.now() - t0 } };
      this._generated.set(colorIdx, entry);
      return { url, kind: 'generated', colorMatch: true, bytes: entry.bytes, warnings: [...notes, ...entry.warnings], report: entry.report };
    }

    if (p.generic) {
      const probe = await this.probe(p.generic.url);
      if (probe.status !== 'invalid') {
        return { url: p.generic.url, kind: 'generic', colorMatch: p.generic.colorMatch, bytes: p.generic.bytes || null, warnings: notes, probe };
      }
      notes.push(`USDZ_INVALID: ${p.generic.url} (${probe.problem})`);
    }

    throw new UsdzBuildError('NO_USDZ', 'Xe này chưa có tệp USDZ cho AR Quick Look.', { notes });
  }

  /** Drops generated files (e.g. after the model was reloaded). */
  clearGenerated() {
    for (const { url } of this._generated.values()) {
      try { this.revokeObjectURL(url); } catch (_) {}
    }
    this._generated.clear();
  }

  dispose() {
    this.clearGenerated();
    this._probes.clear();
  }
}
