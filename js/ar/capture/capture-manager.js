// js/ar/capture/capture-manager.js — Screenshot / Capture Manager.
//
// 3D preview: renders one frame and reads the canvas (exact, always available).
// WebXR AR:   the camera image is composited by the OS, NOT present in the WebGL canvas. A photo that includes
//             the real environment is only possible when the session granted 'camera-access' (WebXR Raw Camera
//             Access, Chromium/Android). That path is EXPERIMENTAL and has not been validated on a device in this
//             repository; on any failure we report it instead of saving a frame without the camera image.

export class CaptureError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new CaptureError('ENCODE_FAILED', 'Không mã hoá được ảnh.'))), type, quality);
  });
}

/** Preview capture: render + read synchronously in the same task (no preserveDrawingBuffer needed). */
export async function capturePreview(renderer, scene, camera) {
  renderer.render(scene, camera);
  return canvasToBlob(renderer.domElement);
}

function readTextureRGBA(gl, texture, width, height) {
  const fb = gl.createFramebuffer();
  const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  const px = new Uint8ClampedArray(width * height * 4);
  if (ok) gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
  gl.deleteFramebuffer(fb);
  if (!ok) throw new CaptureError('CAMERA_FRAMEBUFFER', 'Không đọc được ảnh camera.');
  return px;
}

function flipY(px, width, height) {
  const row = width * 4;
  const out = new Uint8ClampedArray(px.length);
  for (let y = 0; y < height; y++) out.set(px.subarray(y * row, (y + 1) * row), (height - 1 - y) * row);
  return out;
}

/**
 * Called from inside the XR animation frame, after renderer.render().
 * @returns {Promise<Blob>}
 */
export async function captureXrFrame({ renderer, session, frame, refSpace }) {
  if (!session || !frame) throw new CaptureError('NO_FRAME', 'Không có khung hình AR.');
  const enabled = Array.isArray(session.enabledFeatures) ? session.enabledFeatures : [];
  if (!enabled.includes('camera-access') || typeof XRWebGLBinding === 'undefined') {
    throw new CaptureError('CAMERA_ACCESS_UNAVAILABLE', 'Trình duyệt không cấp ảnh camera cho trang trong phiên AR. Hãy dùng chức năng chụp màn hình của điện thoại.');
  }
  const gl = renderer.getContext();
  const pose = frame.getViewerPose(refSpace);
  const view = pose && pose.views && pose.views.find(v => v.camera);
  if (!view) throw new CaptureError('NO_CAMERA_VIEW', 'Phiên AR không cung cấp ảnh camera ở khung hình này.');

  const binding = new XRWebGLBinding(session, gl);
  const camTex = binding.getCameraImage(view.camera);
  const w = view.camera.width;
  const h = view.camera.height;
  const camPx = flipY(readTextureRGBA(gl, camTex, w, h), w, h);

  // 3D layer: read the XR framebuffer for this view.
  const layer = session.renderState.baseLayer;
  const vp = layer.getViewport(view);
  const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
  const scenePx = new Uint8ClampedArray(vp.width * vp.height * 4);
  gl.readPixels(vp.x, vp.y, vp.width, vp.height, gl.RGBA, gl.UNSIGNED_BYTE, scenePx);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
  renderer.resetState(); // we touched GL state behind three.js' back

  const out = document.createElement('canvas');
  out.width = vp.width;
  out.height = vp.height;
  const ctx = out.getContext('2d');
  const camCanvas = document.createElement('canvas');
  camCanvas.width = w;
  camCanvas.height = h;
  camCanvas.getContext('2d').putImageData(new ImageData(camPx, w, h), 0, 0);
  ctx.drawImage(camCanvas, 0, 0, vp.width, vp.height);
  const sceneCanvas = document.createElement('canvas');
  sceneCanvas.width = vp.width;
  sceneCanvas.height = vp.height;
  sceneCanvas.getContext('2d').putImageData(new ImageData(flipY(scenePx, vp.width, vp.height), vp.width, vp.height), 0, 0);
  ctx.drawImage(sceneCanvas, 0, 0);
  return canvasToBlob(out);
}

/** Share sheet on mobile; plain download on desktop (desktop share sheets are unexpected for a screenshot). */
export async function deliverImage(blob, filename, { preferShare = false } = {}) {
  const file = typeof File !== 'undefined' ? new File([blob], filename, { type: blob.type }) : null;
  if (preferShare && file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'SIGMACAR AR' });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
