// js/ar/models/fetch-with-progress.js — model download with progress, timeout, cancellation and bounded retry.

export class ModelLoadError extends Error {
  constructor(code, message, { status = null, retriable = false, cause } = {}) {
    super(message);
    this.name = 'ModelLoadError';
    this.code = code;
    this.status = status;
    this.retriable = retriable;
    if (cause) this.cause = cause;
  }
}

export const DEFAULT_MAX_BYTES = 150 * 1024 * 1024;

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const id = setTimeout(resolve, ms);
  if (signal) {
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new ModelLoadError('ABORTED', 'Đã huỷ tải mô hình.'));
    }, { once: true });
  }
});

// Cloudflare Pages answers a missing /assets/models/x.glb with index.html, and _headers still labels it
// model/gltf-binary, so the content-type check alone is not enough: sniff the first bytes too.
function assertNotHtml(bytes) {
  const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
    throw new ModelLoadError('NOT_A_MODEL', 'Đường dẫn mô hình trả về trang HTML thay vì tệp 3D (tệp không tồn tại?).');
  }
}

async function attempt(url, { signal, timeoutMs, onProgress, fetchImpl, maxBytes, expectedBytes }) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onOuterAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  try {
    let res;
    try {
      // credentials omitted: model CDNs must not receive site cookies; CORS required for cross-origin hosts.
      res = await fetchImpl(url, { signal: controller.signal, credentials: 'omit', mode: 'cors' });
    } catch (err) {
      if (signal && signal.aborted) throw new ModelLoadError('ABORTED', 'Đã huỷ tải mô hình.');
      if (timedOut) throw new ModelLoadError('TIMEOUT', 'Tải mô hình quá thời gian chờ.', { retriable: true });
      // TypeError from fetch = DNS/TLS/offline or a CORS rejection (indistinguishable from JS by design).
      throw new ModelLoadError('NETWORK_OR_CORS', 'Không thể tải mô hình (lỗi mạng hoặc máy chủ mô hình chưa bật CORS).', { retriable: true, cause: err });
    }

    if (!res.ok) {
      const retriable = res.status === 408 || res.status === 429 || res.status >= 500;
      throw new ModelLoadError(res.status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR', `Máy chủ mô hình trả về HTTP ${res.status}.`, { status: res.status, retriable });
    }

    // Static hosts with SPA fallback (e.g. Cloudflare Pages `/* /index.html 200`) answer a missing .glb with HTML.
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (ctype.includes('text/html')) {
      throw new ModelLoadError('NOT_A_MODEL', 'Đường dẫn mô hình trả về trang HTML thay vì tệp 3D (tệp không tồn tại?).', { status: res.status });
    }

    const headerLen = Number(res.headers.get('content-length'));
    const total = Number.isFinite(headerLen) && headerLen > 0 ? headerLen : (Number(expectedBytes) || 0);
    if (total > maxBytes) {
      throw new ModelLoadError('TOO_LARGE', `Tệp mô hình quá lớn (${Math.round(total / 1048576)} MB).`);
    }

    if (!res.body || typeof res.body.getReader !== 'function') {
      const buf = await res.arrayBuffer();
      assertNotHtml(new Uint8Array(buf));
      if (onProgress) onProgress({ loaded: buf.byteLength, total: total || buf.byteLength });
      return buf;
    }

    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (loaded > maxBytes) {
        try { await reader.cancel(); } catch (_) {}
        throw new ModelLoadError('TOO_LARGE', 'Tệp mô hình vượt quá dung lượng cho phép.');
      }
      chunks.push(value);
      if (onProgress) onProgress({ loaded, total });
    }
    const out = new Uint8Array(loaded);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    assertNotHtml(out);
    return out.buffer;
  } catch (err) {
    if (err instanceof ModelLoadError) throw err;
    if (signal && signal.aborted) throw new ModelLoadError('ABORTED', 'Đã huỷ tải mô hình.');
    if (timedOut) throw new ModelLoadError('TIMEOUT', 'Tải mô hình quá thời gian chờ.', { retriable: true });
    throw new ModelLoadError('NETWORK_OR_CORS', 'Kết nối bị gián đoạn khi tải mô hình.', { retriable: true, cause: err });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * Downloads a binary resource. Retries only transient failures (timeouts, network, 408/429/5xx).
 * @returns {Promise<ArrayBuffer>}
 */
export async function fetchArrayBuffer(url, {
  signal,
  timeoutMs = 60000,
  retries = 2,
  retryDelayMs = 800,
  onProgress,
  fetchImpl = (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
  maxBytes = DEFAULT_MAX_BYTES,
  expectedBytes
} = {}) {
  if (!fetchImpl) throw new ModelLoadError('NO_FETCH', 'Môi trường không hỗ trợ fetch().');
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    if (signal && signal.aborted) throw new ModelLoadError('ABORTED', 'Đã huỷ tải mô hình.');
    try {
      return await attempt(url, { signal, timeoutMs, onProgress, fetchImpl, maxBytes, expectedBytes });
    } catch (err) {
      lastErr = err;
      if (!err.retriable || i === retries) break;
      await sleep(retryDelayMs * Math.pow(2, i), signal);
    }
  }
  throw lastErr;
}
