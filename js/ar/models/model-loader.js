// js/ar/models/model-loader.js — External Model Loader (GLB / glTF from any validated HTTPS URL).
//
// Pipeline: URL policy → cached/streamed download (progress, timeout, retry, abort) → container validation
// → GLTFLoader.parseAsync with Draco / Meshopt / KTX2 decoders and a resource URL guard → result.
// Decoders are created lazily, only when the model's extensions need them.

import { LoadingManager } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { validateModelUrl, isAllowedResourceUrl, resourceBaseOf } from './url-policy.js';
import { fetchArrayBuffer, ModelLoadError } from './fetch-with-progress.js';
import { readGlbJson, readGltfJson, inspectGltfJson } from './model-validator.js';

const BLOCKED_RESOURCE = 'data:application/octet-stream;base64,';

export class ModelLoader {
  /**
   * @param {object} opts
   * @param {AssetCache} opts.cache
   * @param {string} opts.baseUrl          page URL used to resolve relative model paths
   * @param {string} [opts.decoderBase]    URL prefix of the vendored three addons ("/js/vendor/three/addons/")
   * @param {THREE.WebGLRenderer} [opts.renderer]  needed for KTX2 transcoder support detection
   * @param {string[]} [opts.allowedHosts] optional allowlist of external model hosts
   * @param {Function} [opts.fetchImpl]
   */
  constructor({ cache, baseUrl, decoderBase = '/js/vendor/three/addons/', renderer = null, allowedHosts = [], fetchImpl } = {}) {
    this.cache = cache;
    this.baseUrl = baseUrl;
    this.decoderBase = decoderBase;
    this.renderer = renderer;
    this.allowedHosts = allowedHosts;
    this.fetchImpl = fetchImpl;
    this._draco = null;
    this._ktx2 = null;
    this._meshopt = null;
  }

  async _configureDecoders(loader, extensionsUsed) {
    const uses = (name) => extensionsUsed.includes(name);
    if (uses('KHR_draco_mesh_compression')) {
      if (!this._draco) {
        const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
        this._draco = new DRACOLoader();
        this._draco.setDecoderPath(new URL('libs/draco/gltf/', new URL(this.decoderBase, this.baseUrl)).toString());
      }
      loader.setDRACOLoader(this._draco);
    }
    if (uses('EXT_meshopt_compression') || uses('KHR_meshopt_compression')) {
      if (!this._meshopt) {
        const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
        await MeshoptDecoder.ready;
        this._meshopt = MeshoptDecoder;
      }
      loader.setMeshoptDecoder(this._meshopt);
    }
    if (uses('KHR_texture_basisu')) {
      if (!this.renderer) {
        throw new ModelLoadError('KTX2_UNAVAILABLE', 'Mô hình dùng texture KTX2 nhưng chưa có WebGL renderer để giải mã.');
      }
      if (!this._ktx2) {
        const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
        this._ktx2 = new KTX2Loader();
        this._ktx2.setTranscoderPath(new URL('libs/basis/', new URL(this.decoderBase, this.baseUrl)).toString());
        this._ktx2.detectSupport(this.renderer);
      }
      loader.setKTX2Loader(this._ktx2);
    }
  }

  /**
   * @param {string} rawUrl
   * @param {{ signal?: AbortSignal, onProgress?: Function, timeoutMs?: number, expectedBytes?: number }} [opts]
   * @returns {Promise<{ scene, animations, url, kind, bytes, info, warnings: string[] }>}
   */
  async load(rawUrl, { signal, onProgress, timeoutMs = 60000, expectedBytes } = {}) {
    const check = validateModelUrl(rawUrl, { baseUrl: this.baseUrl, allowedHosts: this.allowedHosts });
    if (!check.ok) {
      throw new ModelLoadError('INVALID_MODEL_URL', `URL mô hình không hợp lệ (${check.reason}).`);
    }
    const { url, kind } = check;
    const report = (phase, loaded, total) => {
      if (onProgress) onProgress({ phase, loaded, total, ratio: total ? Math.min(1, loaded / total) : null });
    };

    const buffer = await this.cache.getOrFetch(url, () => fetchArrayBuffer(url, {
      signal,
      timeoutMs,
      expectedBytes,
      fetchImpl: this.fetchImpl,
      onProgress: ({ loaded, total }) => report('download', loaded, total)
    }));
    if (signal && signal.aborted) throw new ModelLoadError('ABORTED', 'Đã huỷ tải mô hình.');

    const json = kind === 'glb' ? readGlbJson(buffer) : readGltfJson(buffer);
    const info = inspectGltfJson(json);
    report('parse', 0, 1);

    const warnings = [];
    const resourceBase = resourceBaseOf(url);
    const manager = new LoadingManager();
    // Every dependent resource (external .bin / textures of a .gltf) passes the same URL policy.
    manager.setURLModifier((resUrl) => {
      if (isAllowedResourceUrl(resUrl, { baseUrl: resourceBase })) return resUrl;
      warnings.push(`BLOCKED_RESOURCE: ${String(resUrl).slice(0, 120)}`);
      return BLOCKED_RESOURCE;
    });
    manager.onProgress = (_u, loaded, total) => report('resources', loaded, total);
    manager.onError = (resUrl) => warnings.push(`MISSING_RESOURCE: ${String(resUrl).slice(0, 160)}`);

    const loader = new GLTFLoader(manager);
    loader.setCrossOrigin('anonymous');
    await this._configureDecoders(loader, info.extensionsUsed);

    let gltf;
    try {
      gltf = await loader.parseAsync(kind === 'glb' ? buffer : JSON.stringify(json), resourceBase);
    } catch (err) {
      const msg = String((err && err.message) || err);
      const missing = /fetch|load|404|buffer/i.test(msg) && info.externalUris.length > 0;
      throw new ModelLoadError(missing ? 'MISSING_RESOURCE' : 'PARSE_FAILED',
        missing ? 'Thiếu tệp phụ thuộc (.bin/texture) của mô hình glTF.' : `Không thể đọc mô hình 3D: ${msg.slice(0, 200)}`,
        { cause: err });
    }

    if (signal && signal.aborted) {
      const { disposeObject3D } = await import('../core/resource-tracker.js');
      disposeObject3D(gltf.scene);
      throw new ModelLoadError('ABORTED', 'Đã huỷ tải mô hình.');
    }

    report('done', 1, 1);
    return {
      scene: gltf.scene,
      animations: gltf.animations || [],
      url,
      kind,
      bytes: buffer.byteLength,
      info,
      warnings
    };
  }

  dispose() {
    if (this._draco) this._draco.dispose();
    if (this._ktx2) this._ktx2.dispose();
    this._draco = null;
    this._ktx2 = null;
  }
}
