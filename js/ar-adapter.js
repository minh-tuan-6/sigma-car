// js/ar-adapter.js
// SIGMACAR Production Real Camera-Based WebAR & Spatial Controller
// Integrates Live Device Camera (WebRTC getUserMedia), Google model-viewer (Three.js WebGL),
// WebXR (immersive-ar hit-test), Google Scene Viewer and Apple AR Quick Look across all devices.

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SigmaARAdapter = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let libraryLoadPromise = null;

  // 1. Lazy loader for @google/model-viewer library
  function loadModelViewerLibrary() {
    if (libraryLoadPromise) return libraryLoadPromise;

    if (typeof customElements !== 'undefined' && customElements.get('model-viewer')) {
      libraryLoadPromise = Promise.resolve();
      return libraryLoadPromise;
    }

    libraryLoadPromise = new Promise((resolve) => {
      if (typeof document === 'undefined') {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'js/libs/model-viewer.min.js';
      script.type = 'module';
      script.async = true;
      script.onload = () => {
        if (typeof customElements !== 'undefined' && customElements.get('model-viewer')) {
          resolve();
        } else {
          setTimeout(() => {
            resolve();
          }, 50);
        }
      };
      script.onerror = () => {
        console.warn('[SigmaARAdapter] Local model-viewer notice, attempting CDN fallback...');
        const cdnScript = document.createElement('script');
        cdnScript.src = 'https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js';
        cdnScript.type = 'module';
        cdnScript.onload = () => resolve();
        cdnScript.onerror = () => resolve();
        document.head.appendChild(cdnScript);
      };
      document.head.appendChild(script);
    });

    return libraryLoadPromise;
  }

  // =================================================================
  // 2. HARDWARE & PERMISSIONS CAMERA MANAGER (WebRTC / getUserMedia)
  // =================================================================
  class ARCameraManager {
    constructor(callbacks = {}) {
      this.callbacks = callbacks;
      this.stream = null;
      this.videoElement = null;
      this.activeDeviceId = null;
      this.activeFacingMode = 'environment';
      this.cameraState = 'idle'; // idle | requesting | active | permission_denied | camera_unavailable | camera_in_use | overconstrained | security_error | type_error | insecure_context | unsupported | stopped
      this.lastError = null;
      this._deviceChangeHandler = null;
    }

    checkSupport() {
      if (typeof window === 'undefined' || typeof navigator === 'undefined') {
        return { isSupported: true, isSecure: true, hasMediaDevices: true };
      }
      const hasMediaDevices = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
      const isSecure = Boolean(
        window.isSecureContext ||
        location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1' ||
        location.protocol === 'https:'
      );
      return {
        isSupported: hasMediaDevices,
        isSecure: isSecure,
        hasMediaDevices: hasMediaDevices
      };
    }

    async getPermissionState() {
      if (typeof navigator !== 'undefined' && navigator.permissions && navigator.permissions.query) {
        try {
          const status = await navigator.permissions.query({ name: 'camera' });
          return status.state; // 'granted' | 'prompt' | 'denied'
        } catch (e) {
          return 'unknown';
        }
      }
      return 'unknown';
    }

    async getAvailableCameras() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return [];
      }
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices
          .filter(d => d.kind === 'videoinput')
          .map((d, index) => {
            const label = d.label || `Camera ${index + 1}`;
            const isBack = /back|rear|environment|sau|0,/i.test(label);
            const isFront = /front|user|trước|facetime/i.test(label);
            return {
              deviceId: d.deviceId,
              label: label,
              facingMode: isBack ? 'environment' : (isFront ? 'user' : 'unknown')
            };
          });
      } catch (err) {
        console.warn('[ARCameraManager] enumerateDevices error:', err);
        return [];
      }
    }

    setState(newState, detail = {}) {
      this.cameraState = newState;
      if (detail.error) {
        this.lastError = detail.error;
      }
      if (typeof this.callbacks.onStateChange === 'function') {
        this.callbacks.onStateChange(newState, detail);
      }
    }

    async startCamera(videoElement, preferredOptions = {}) {
      this.videoElement = videoElement;
      const support = this.checkSupport();

      if (!support.isSecure) {
        const errDetail = {
          code: 'SecurityError',
          title: 'Yêu cầu kết nối bảo mật HTTPS (SecurityError)',
          message: 'Theo tiêu chuẩn W3C WebRTC, trình duyệt chỉ cho phép truy cập Camera khi chạy trên HTTPS hoặc localhost.',
          needsHttps: true
        };
        this.setState('insecure_context', errDetail);
        return { success: false, error: 'insecure_context', detail: errDetail };
      }

      if (!support.isSupported) {
        const errDetail = {
          code: 'TypeError',
          title: 'Trình duyệt không hỗ trợ Camera API (TypeError)',
          message: 'Trình duyệt hiện tại không hỗ trợ WebRTC Camera (navigator.mediaDevices.getUserMedia).',
          needsHttps: false
        };
        this.setState('unsupported', errDetail);
        return { success: false, error: 'unsupported', detail: errDetail };
      }

      this.setState('requesting', {
        title: 'Đang mở Camera...',
        message: 'Đang yêu cầu quyền truy cập Camera thiết bị để hiển thị không gian thực...'
      });

      // Stop any existing stream cleanly before opening a new one
      this.stopCamera();

      const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const requestedDeviceId = preferredOptions.deviceId || this.activeDeviceId;
      const requestedFacing = preferredOptions.facingMode || (isMobile ? 'environment' : undefined);

      // Build progressive constraint cascade from ideal to minimal baseline
      const constraintCascade = [];

      // Profile A: Specific device ID if requested
      if (requestedDeviceId) {
        constraintCascade.push({
          label: 'Specific Device with Ideal 1080p',
          constraints: {
            video: {
              deviceId: { exact: requestedDeviceId },
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            }
          }
        });
        constraintCascade.push({
          label: 'Specific Device Basic',
          constraints: {
            video: { deviceId: { exact: requestedDeviceId } }
          }
        });
      }

      // Profile B: Mobile environment facing camera
      if (requestedFacing) {
        constraintCascade.push({
          label: 'Environment Camera 1080p',
          constraints: {
            video: {
              facingMode: { ideal: requestedFacing },
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            }
          }
        });
        constraintCascade.push({
          label: 'Environment Camera 720p',
          constraints: {
            video: {
              facingMode: { ideal: requestedFacing },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            }
          }
        });
        constraintCascade.push({
          label: 'Environment Camera Basic',
          constraints: {
            video: { facingMode: { ideal: requestedFacing } }
          }
        });
      }

      // Profile C: Generic Desktop / Any camera with ideal resolution
      constraintCascade.push({
        label: 'Generic Camera 1080p',
        constraints: {
          video: { width: { ideal: 1920 }, height: { ideal: 1080 } }
        }
      });
      constraintCascade.push({
        label: 'Generic Camera 720p',
        constraints: {
          video: { width: { ideal: 1280 }, height: { ideal: 720 } }
        }
      });

      // Profile D: Minimal unconstrained video baseline
      constraintCascade.push({
        label: 'Unconstrained Video (Baseline)',
        constraints: { video: true }
      });

      let stream = null;
      let lastError = null;

      for (const profile of constraintCascade) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(profile.constraints);
          if (stream) {
            console.log(`[ARCameraManager] Successfully initialized camera with profile: "${profile.label}"`);
            break;
          }
        } catch (err) {
          lastError = err;
          console.warn(`[ARCameraManager] Constraint profile "${profile.label}" failed:`, err.name, err.message);

          // If user explicitly denied permission, do not spam or loop further
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            break;
          }
        }
      }

      if (!stream) {
        console.error('[ARCameraManager] All camera constraint profiles failed:', lastError);
        const errName = lastError ? lastError.name : 'UnknownError';
        const errMessage = lastError ? lastError.message : '';

        // Precise error classification as mandated by specifications:
        if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
          const detail = {
            code: 'NotAllowedError',
            title: 'Quyền truy cập Camera bị từ chối (NotAllowedError)',
            message: 'Quyền truy cập Camera bị từ chối. Hãy bấm vào biểu tượng 🔒 hoặc ⚙️ trên thanh địa chỉ của trình duyệt, chọn "Cho phép" (Allow) quyền Camera rồi bấm "Thử lại".',
            error: lastError
          };
          this.setState('permission_denied', detail);
          return { success: false, error: 'permission_denied', detail };
        } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
          const detail = {
            code: 'NotFoundError',
            title: 'Không tìm thấy thiết bị Camera (NotFoundError)',
            message: 'Thiết bị không có Camera khả dụng hoặc Camera đã bị tắt trong Cài đặt hệ thống (Privacy Settings).',
            error: lastError
          };
          this.setState('camera_unavailable', detail);
          return { success: false, error: 'camera_unavailable', detail };
        } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
          const detail = {
            code: 'NotReadableError',
            title: 'Camera đang bận hoặc bị khóa phần cứng (NotReadableError)',
            message: 'Camera đang được ứng dụng khác (Zoom, Teams, Skype, OBS...) chiếm dụng độc quyền hoặc gặp lỗi phần cứng. Hãy đóng ứng dụng đó và thử lại.',
            error: lastError
          };
          this.setState('camera_in_use', detail);
          return { success: false, error: 'camera_in_use', detail };
        } else if (errName === 'OverconstrainedError') {
          const detail = {
            code: 'OverconstrainedError',
            title: 'Yêu cầu thông số Camera không được hỗ trợ (OverconstrainedError)',
            message: `Phần cứng Camera không đáp ứng được yêu cầu (${lastError.constraint || 'constraints'}).`,
            error: lastError
          };
          this.setState('overconstrained', detail);
          return { success: false, error: 'overconstrained', detail };
        } else if (errName === 'SecurityError') {
          const detail = {
            code: 'SecurityError',
            title: 'Lỗi chính sách bảo mật trình duyệt (SecurityError)',
            message: 'Quyền truy cập Camera bị chặn bởi chính sách Permissions-Policy của trình duyệt.',
            error: lastError
          };
          this.setState('security_error', detail);
          return { success: false, error: 'security_error', detail };
        } else if (errName === 'TypeError') {
          const detail = {
            code: 'TypeError',
            title: 'Cấu hình Camera không hợp lệ (TypeError)',
            message: `Tham số constraints không hợp lệ: ${errMessage}.`,
            error: lastError
          };
          this.setState('type_error', detail);
          return { success: false, error: 'type_error', detail };
        } else {
          const detail = {
            code: errName,
            title: `Lỗi khởi động Camera (${errName})`,
            message: `Không thể kết nối Camera thiết bị: ${errMessage || 'Lỗi không xác định'}.`,
            error: lastError
          };
          this.setState('camera_unavailable', detail);
          return { success: false, error: errName, detail };
        }
      }

      this.stream = stream;
      this.lastError = null;
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = typeof videoTrack.getSettings === 'function' ? videoTrack.getSettings() : {};
        this.activeDeviceId = settings.deviceId || requestedDeviceId;
        if (settings.facingMode) this.activeFacingMode = settings.facingMode;

        // Listen for hardware disconnection mid-session
        videoTrack.addEventListener('ended', () => {
          console.warn('[ARCameraManager] Camera track ended unexpectedly');
          this.stopCamera();
          this.setState('stopped', {
            title: 'Camera đã ngắt kết nối',
            message: 'Thiết bị Camera đã bị rút hoặc bị ngắt kết nối giữa phiên.'
          });
        });
      }

      // Attach stream to video element with full mobile/desktop properties
      if (this.videoElement) {
        this.videoElement.srcObject = stream;
        this.videoElement.defaultMuted = true;
        this.videoElement.muted = true;
        this.videoElement.playsInline = true;
        this.videoElement.setAttribute('playsinline', '');
        this.videoElement.setAttribute('webkit-playsinline', '');
        this.videoElement.setAttribute('muted', '');
        this.videoElement.setAttribute('autoplay', '');

        // Safe play handling ensuring promise resolution
        try {
          if (this.videoElement.readyState >= 1) {
            await this.videoElement.play();
          } else {
            await new Promise((resolve) => {
              this.videoElement.onloadedmetadata = () => {
                this.videoElement.play().then(resolve).catch((pErr) => {
                  console.warn('[ARCameraManager] Video play after metadata notice:', pErr);
                  resolve();
                });
              };
              setTimeout(resolve, 800);
            });
          }
        } catch (playErr) {
          console.warn('[ARCameraManager] Video autoplay paused by browser policy, awaiting user gesture:', playErr);
          const handleFirstGesture = () => {
            if (this.videoElement) this.videoElement.play().catch(() => {});
            document.removeEventListener('click', handleFirstGesture);
            document.removeEventListener('touchstart', handleFirstGesture);
          };
          document.addEventListener('click', handleFirstGesture, { once: true });
          document.addEventListener('touchstart', handleFirstGesture, { once: true });
        }
      }

      // Setup dynamic device change listener
      if (!this._deviceChangeHandler && typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function') {
        this._deviceChangeHandler = () => {
          this.getAvailableCameras().then(devices => {
            if (typeof this.callbacks.onDevicesUpdated === 'function') {
              this.callbacks.onDevicesUpdated(devices);
            }
          });
        };
        navigator.mediaDevices.addEventListener('devicechange', this._deviceChangeHandler);
      }

      this.setState('active', {
        stream: this.stream,
        track: videoTrack,
        facingMode: this.activeFacingMode,
        deviceId: this.activeDeviceId,
        title: 'Camera AR đang hoạt động',
        message: '🟢 Camera thực tế đang hoạt động • Mô hình xe 3D được hiển thị trực tiếp trong không gian'
      });

      return { success: true, stream };
    }

    stopCamera() {
      if (this.stream) {
        this.stream.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (e) {}
        });
        this.stream = null;
      }
      if (this.videoElement) {
        try {
          this.videoElement.pause();
          this.videoElement.srcObject = null;
        } catch (e) {}
      }
      if (this._deviceChangeHandler && typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.removeEventListener === 'function') {
        try {
          navigator.mediaDevices.removeEventListener('devicechange', this._deviceChangeHandler);
        } catch (e) {}
        this._deviceChangeHandler = null;
      }
      this.setState('stopped', {
        title: 'Camera đã tắt',
        message: 'Đã dừng Camera thực tế • Đang ở chế độ xem 3D không gian.'
      });
    }

    async switchCamera(targetDeviceIdOrFacing) {
      this.stopCamera();
      await new Promise(r => setTimeout(r, 200));

      let availableCameras = [];
      try {
        if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
          const devs = await navigator.mediaDevices.enumerateDevices();
          availableCameras = devs.filter(d => d.kind === 'videoinput');
        }
      } catch (e) {}

      if (targetDeviceIdOrFacing === 'user' || targetDeviceIdOrFacing === 'environment') {
        this.activeFacingMode = targetDeviceIdOrFacing;
        this.activeDeviceId = null;
        return await this.startCamera(this.videoElement, { facingMode: targetDeviceIdOrFacing });
      } else if (typeof targetDeviceIdOrFacing === 'string' && targetDeviceIdOrFacing) {
        this.activeDeviceId = targetDeviceIdOrFacing;
        return await this.startCamera(this.videoElement, { deviceId: targetDeviceIdOrFacing });
      } else if (availableCameras.length > 1) {
        const currentIdx = availableCameras.findIndex(d => d.deviceId === this.activeDeviceId);
        const nextIdx = (currentIdx + 1) % availableCameras.length;
        this.activeDeviceId = availableCameras[nextIdx].deviceId;
        return await this.startCamera(this.videoElement, { deviceId: this.activeDeviceId });
      } else {
        const nextFacing = this.activeFacingMode === 'user' ? 'environment' : 'user';
        this.activeFacingMode = nextFacing;
        this.activeDeviceId = null;
        return await this.startCamera(this.videoElement, { facingMode: nextFacing });
      }
    }

    isActive() {
      return !!(this.stream && this.stream.active && this.stream.getVideoTracks().some(t => t.readyState === 'live'));
    }
  }

  // =================================================================
  // 3. ACTIVE AR SESSION CONTROLLER
  // =================================================================
  class ARSessionInstance {
    constructor(container, options = {}) {
      this.container = container;
      this.options = options;
      this.carId = options.carId || 'tesla-cybertruck';
      this.currentColorIdx = options.colorIdx || 0;
      this.modelViewer = null;
      this.threeViewer = null;
      this.videoElement = null;
      this.isDisposed = false;
      this.status = 'idle';

      // Initialize Camera Manager
      this.cameraManager = new ARCameraManager({
        onStateChange: (state, detail) => {
          this.handleCameraStateChange(state, detail);
        },
        onDevicesUpdated: (devices) => {
          if (typeof this.options.onDevicesUpdated === 'function') {
            this.options.onDevicesUpdated(devices);
          }
        }
      });

      // Mount base video & reticle layers synchronously
      this.mountInitialDOM();
      this.init();
    }

    mountInitialDOM() {
      if (!this.container) return;
      this.container.innerHTML = '';

      // Create Live Video Layer for Camera AR
      const video = document.createElement('video');
      video.id = 'ar-camera-live-feed';
      video.className = 'ar-live-video-layer';
      video.setAttribute('autoplay', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      if (!video.style) video.style = {};
      video.style.position = 'absolute';
      video.style.inset = '0';
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'cover';
      video.style.zIndex = '1';
      video.style.pointerEvents = 'none';
      this.container.appendChild(video);
      this.videoElement = video;

      // Create Ground Reticle / Placement Target (Z-Index 3)
      const reticle = document.createElement('div');
      reticle.id = 'ar-ground-reticle-guide';
      reticle.className = 'ar-ground-mesh';
      if (!reticle.style) reticle.style = {};
      reticle.style.zIndex = '3';
      reticle.style.pointerEvents = 'none';
      this.container.appendChild(reticle);
    }

    handleCameraStateChange(state, detail) {
      if (this.isDisposed) return;
      if (typeof this.options.onCameraStateChange === 'function') {
        this.options.onCameraStateChange(state, detail);
      }
      if (typeof this.options.onStatusChange === 'function' && detail.message) {
        this.options.onStatusChange(state, detail.message);
      }
    }

    async init() {
      try {
        if (this.options.onStatusChange) {
          this.options.onStatusChange('loading', 'Đang nạp mô hình 3D tỉ lệ 1:1 và chuẩn bị Camera...');
        }

        // If Three.js Car3DViewer is ready in browser, mount immediately and synchronously!
        if (typeof window !== 'undefined' && window.Car3DViewer && typeof window.Car3DViewer.init === 'function') {
          this.mountViewer();
        } else {
          await loadModelViewerLibrary();
          if (this.isDisposed) return;
          this.mountViewer();
        }

        // Auto-request camera if autoStartCamera is enabled (default true for real WebAR)
        if (this.options.autoStartCamera !== false) {
          this.startCamera().catch(err => {
            console.warn('[SigmaARAdapter] Auto camera start notice:', err);
          });
        }
      } catch (err) {
        console.error('[SigmaARAdapter] Init Error:', err);
        if (this.options.onError) this.options.onError(err);
      }
    }

    mountViewer() {
      if (!this.container) return;
      if (!this.videoElement) {
        this.mountInitialDOM();
      }

      // Get AR Configuration from Manifest
      let arConfig = null;
      if (typeof SIGMA_AR_MANIFEST !== 'undefined') {
        arConfig = SIGMA_AR_MANIFEST.getVehicleArConfig(this.carId, this.currentColorIdx);
      } else {
        arConfig = {
          glbUrl: 'assets/models/tesla_cybertruck.glb',
          readiness: 'verified',
          dimensionsMeters: { length: 5.682, width: 2.200, height: 1.791 }
        };
      }

      this.currentGlbUrl = arConfig.glbUrl;

      // Prefer Three.js Car3DViewer when available in browser
      if (typeof window !== 'undefined' && window.Car3DViewer && typeof window.Car3DViewer.init === 'function') {
        // Container gets managed directly by Car3DViewer (Layer 1: Video, Layer 2: WebGL Canvas)
        this.container.innerHTML = '';
        this.threeViewer = window.Car3DViewer.init(this.container, {
          modelUrl: this.currentGlbUrl,
          initialColor: arConfig?.paintMaterial?.hex || '#94A3B8',
          transparent: true,
          arMode: true,
          autoStartCamera: false,
          onCameraStateChange: (state, detail) => {
            this.handleCameraStateChange(state, detail);
          },
          onDevicesUpdated: (devices) => {
            if (typeof this.options.onDevicesUpdated === 'function') {
              this.options.onDevicesUpdated(devices);
            }
          },
          onProgress: (p) => {
            if (this.options.onStatusChange) {
              this.options.onStatusChange('loading', `Đang tải mô hình 3D (${p}%)...`);
            }
          },
          onReady: () => {
            this.status = 'ready';
            if (this.options.onReady) this.options.onReady();
            if (this.options.onStatusChange) {
              if (this.isCameraActive()) {
                this.options.onStatusChange('active', '🟢 LIVE CAMERA AR • Phủ mô hình xe 1:1 trên nền video camera thực tế');
              } else {
                this.options.onStatusChange('ready', '📷 Chế độ 3D Studio • Bấm "Bật Camera Thiết Bị" để chuyển sang AR thực tế');
              }
            }
          }
        });
        this.videoElement = this.threeViewer.videoElement;

        // Re-append Ground Reticle Guide behind the 3D car (Z-Index 1, under canvas Z-Index 2)
        let reticle = this.container.querySelector('#ar-ground-reticle-guide');
        if (!reticle) {
          reticle = document.createElement('div');
          reticle.id = 'ar-ground-reticle-guide';
          reticle.className = 'ar-ground-mesh';
          if (!reticle.style) reticle.style = {};
          reticle.style.zIndex = '1';
          reticle.style.pointerEvents = 'none';
          this.container.appendChild(reticle);
        }
      } else {
        // Fallback or Node.js test environment: Create <model-viewer> DOM Element
        const mv = document.createElement('model-viewer');
        mv.setAttribute('id', 'sigma-ar-model-viewer');
        mv.className = 'ar-model-viewer-element';
        mv.setAttribute('src', this.currentGlbUrl);
        mv.setAttribute('alt', `Mô hình 3D ô tô ${arConfig.carName || this.carId} tỉ lệ 1:1`);

        // Real AR Configuration Attributes (Fixed 1:1 Scale, Floor Placement, WebXR / Scene Viewer / Quick Look)
        mv.setAttribute('ar', '');
        mv.setAttribute('ar-modes', 'webxr scene-viewer quick-look');
        mv.setAttribute('ar-scale', 'fixed');
        mv.setAttribute('ar-placement', 'floor');
        mv.setAttribute('camera-controls', '');
        mv.setAttribute('touch-action', 'pan-y');
        mv.setAttribute('shadow-intensity', '1.3');
        mv.setAttribute('shadow-softness', '0.7');
        mv.setAttribute('environment-image', 'neutral');
        mv.setAttribute('exposure', '1.05');
        mv.setAttribute('interaction-prompt', 'none');
        if (!mv.style) mv.style = {};
        mv.style.position = 'absolute';
        mv.style.inset = '0';
        mv.style.width = '100%';
        mv.style.height = '100%';
        mv.style.zIndex = '5';
        mv.style.background = 'transparent';

        // Native Launcher slot button (hidden, can be triggered programmatically)
        const arBtn = document.createElement('button');
        arBtn.setAttribute('slot', 'ar-button');
        arBtn.id = 'sigma-native-ar-trigger-btn';
        arBtn.style.display = 'none';
        mv.appendChild(arBtn);

        // Loading Poster slot
        const poster = document.createElement('div');
        poster.setAttribute('slot', 'poster');
        poster.className = 'ar-model-loading-poster';
        poster.innerHTML = `
          <div class="vr-loading-spinner" style="margin-bottom:12px;"></div>
          <div style="color:#FFFFFF; font-size:14px; font-weight:700;">Đang nạp mô hình 3D chuẩn 1:1...</div>
          <div style="color:#94A3B8; font-size:12px; margin-top:4px;">Kích thước: 5.68m × 2.00m (Khớp tỉ lệ thực tế)</div>
        `;
        mv.appendChild(poster);

        // Event Listeners
        this.onLoadHandler = () => {
          if (this.isDisposed) return;
          this.status = 'ready';
          if (this.options.onReady) this.options.onReady();
          if (this.options.onStatusChange) {
            if (this.cameraManager.isActive()) {
              this.options.onStatusChange('active', '🟢 Camera thực tế đang hoạt động • Vuốt để xoay 360°, kéo để di chuyển xe');
            } else {
              this.options.onStatusChange('ready', '📷 Bấm "Bật Camera" để đặt xe trực tiếp trong không gian thực xung quanh bạn');
            }
          }
        };

        this.onArStatusHandler = (event) => {
          const arStatus = event.detail.status;
          console.log('[SigmaARAdapter] ar-status:', arStatus);

          if (arStatus === 'not-presenting') {
            this.status = 'ready';
            if (this.options.onStatusChange) {
              this.options.onStatusChange('ready', '✓ Trở lại chế độ WebAR Camera trong trình duyệt');
            }
          } else if (arStatus === 'session-started') {
            this.status = 'presenting';
            if (this.options.onStatusChange) {
              this.options.onStatusChange('presenting', '🟢 Đang mở WebXR AR... Hướng camera về phía mặt sàn rộng');
            }
          } else if (arStatus === 'object-placed') {
            this.status = 'placed';
            if (this.options.onStatusChange) {
              this.options.onStatusChange('placed', '✓ Xe đã được định vị trên mặt phẳng thực tế (WebXR Plane Detection)');
            }
          } else if (arStatus === 'failed') {
            this.status = 'failed';
            if (this.options.onStatusChange) {
              this.options.onStatusChange('failed', '⚠️ Không thể khởi động WebXR Native • Đang dùng chế độ WebAR Camera tiêu chuẩn');
            }
          }
        };

        this.onErrorHandler = (err) => {
          console.warn('[SigmaARAdapter] Model Error:', err);
          if (this.options.onError) this.options.onError(err);
        };

        mv.addEventListener('load', this.onLoadHandler);
        mv.addEventListener('ar-status', this.onArStatusHandler);
        mv.addEventListener('error', this.onErrorHandler);

        this.container.appendChild(mv);
        this.modelViewer = mv;
      }
    }

    // Toggle Camera on/off
    async toggleCamera() {
      if (this.threeViewer && typeof this.threeViewer.toggleCamera === 'function') {
        await this.threeViewer.toggleCamera();
        return this.threeViewer.isCameraActive;
      }
      if (this.cameraManager.isActive()) {
        this.cameraManager.stopCamera();
        return false;
      } else if (this.videoElement) {
        const res = await this.cameraManager.startCamera(this.videoElement);
        return res.success;
      }
      return false;
    }

    async startCamera(preferredOptions) {
      if (this.threeViewer && typeof this.threeViewer.startCamera === 'function') {
        try {
          const stream = await this.threeViewer.startCamera(preferredOptions);
          this.videoElement = this.threeViewer.videoElement;
          return { success: true, stream };
        } catch (err) {
          return { success: false, error: err.name, detail: { message: err.message } };
        }
      }
      if (!this.videoElement) {
        this.mountInitialDOM();
      }
      if (this.videoElement) {
        return await this.cameraManager.startCamera(this.videoElement, preferredOptions);
      }
      return { success: false, error: 'no_video_element' };
    }

    stopCamera() {
      if (this.threeViewer && typeof this.threeViewer.stopCamera === 'function') {
        this.threeViewer.stopCamera();
      }
      if (this.cameraManager) {
        this.cameraManager.stopCamera();
      }
    }

    async switchCamera(target) {
      if (this.threeViewer && typeof this.threeViewer.switchCamera === 'function') {
        return await this.threeViewer.switchCamera(target);
      }
      return await this.cameraManager.switchCamera(target);
    }

    isCameraActive() {
      if (this.threeViewer) {
        return !!this.threeViewer.isCameraActive;
      }
      return this.cameraManager.isActive();
    }

    async getAvailableCameras() {
      if (this.threeViewer && typeof this.threeViewer.getAvailableCameras === 'function') {
        return await this.threeViewer.getAvailableCameras();
      }
      return await this.cameraManager.getAvailableCameras();
    }

    async setMode(mode) {
      if (this.threeViewer && typeof this.threeViewer.setMode === 'function') {
        return await this.threeViewer.setMode(mode);
      }
    }

    // Diagnostic information getter for developer & debug inspection
    async getDiagnostics() {
      if (this.threeViewer && typeof this.threeViewer.getDiagnostics === 'function') {
        return await this.threeViewer.getDiagnostics();
      }
      const support = this.cameraManager.checkSupport();
      const permState = await this.cameraManager.getPermissionState();
      const cameras = await this.cameraManager.getAvailableCameras();
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown';

      let browserName = 'Unknown Browser';
      if (/Edg\//i.test(ua)) browserName = 'Microsoft Edge';
      else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browserName = 'Google Chrome';
      else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browserName = 'Apple Safari';
      else if (/Firefox\//i.test(ua)) browserName = 'Mozilla Firefox';

      const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
      const isIOS = /iPhone|iPad|iPod/i.test(ua);
      const isAndroid = /Android/i.test(ua);

      return {
        browser: browserName,
        platform: isMobile ? (isIOS ? 'iOS Mobile' : (isAndroid ? 'Android Mobile' : 'Mobile')) : 'Desktop',
        isSecureContext: Boolean(typeof window !== 'undefined' && window.isSecureContext),
        protocol: typeof location !== 'undefined' ? location.protocol : 'unknown',
        hostname: typeof location !== 'undefined' ? location.hostname : 'unknown',
        hasMediaDevices: support.hasMediaDevices,
        hasGetUserMedia: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
        permissionState: permState,
        cameraCount: cameras.length,
        cameras: cameras.map(c => ({ label: c.label, facingMode: c.facingMode })),
        activeCameraId: this.cameraManager.activeDeviceId || 'Default',
        activeFacingMode: this.cameraManager.activeFacingMode,
        cameraState: this.cameraManager.cameraState,
        lastError: this.cameraManager.lastError ? {
          name: this.cameraManager.lastError.name,
          message: this.cameraManager.lastError.message
        } : null
      };
    }

    // Launch Native AR (WebXR / Scene Viewer / Quick Look)
    async activateAR() {
      if (!this.modelViewer) {
        throw new Error('model-viewer is not mounted.');
      }

      const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

      if (this.modelViewer.canActivateAR) {
        try {
          return await this.modelViewer.activateAR();
        } catch (err) {
          console.warn('[SigmaARAdapter] activateAR error:', err);
          const btn = document.getElementById('sigma-native-ar-trigger-btn');
          if (btn) btn.click();
        }
      } else {
        if (!isMobile) {
          if (typeof showToast === 'function') {
            showToast('💡 Đang xem Camera WebAR trên máy tính! Trên điện thoại bạn có thể quét mã QR để mở thêm Google Scene Viewer / Apple Quick Look.', '📱');
          }
        } else {
          // Fallback to ensuring browser camera is active
          if (!this.cameraManager.isActive() && this.videoElement) {
            await this.cameraManager.startCamera(this.videoElement);
          }
        }
      }
    }

    // Update vehicle color in real-time
    setColor(colorHex, colorName, colorIdx = 0) {
      this.currentColorIdx = colorIdx;

      if (this.threeViewer && typeof this.threeViewer.setColor === 'function') {
        this.threeViewer.setColor(colorHex);
      }

      // 1. Switch calibrated GLB if available
      if (typeof SIGMA_AR_MANIFEST !== 'undefined') {
        const config = SIGMA_AR_MANIFEST.getVehicleArConfig(this.carId, colorIdx);
        if (config && config.glbUrl && config.glbUrl !== this.currentGlbUrl) {
          this.currentGlbUrl = config.glbUrl;
          if (this.modelViewer) {
            this.modelViewer.setAttribute('src', this.currentGlbUrl);
          }
        }
      }

      // 2. Immediate live PBR material update
      if (this.modelViewer && this.modelViewer.model && this.modelViewer.model.materials) {
        try {
          const mats = this.modelViewer.model.materials;
          const bodyMat = mats.find(m => m.name.toLowerCase().includes('body') || m.name === 'Material');
          if (bodyMat && bodyMat.pbrMetallicRoughness) {
            const hex = colorHex.replace('#', '');
            const r = parseInt(hex.substring(0, 2), 16) / 255;
            const g = parseInt(hex.substring(2, 4), 16) / 255;
            const b = parseInt(hex.substring(4, 6), 16) / 255;
            bodyMat.pbrMetallicRoughness.setBaseColorFactor([r, g, b, 1.0]);
          }
        } catch (e) {
          console.warn('[SigmaARAdapter] Live material update skipped:', e);
        }
      }
    }

    // Scale helper for Three.js / model-viewer
    setScale(scaleRatio) {
      if (this.threeViewer && typeof this.threeViewer.setScale === 'function') {
        this.threeViewer.setScale(scaleRatio);
      }
      if (this.modelViewer) {
        this.modelViewer.style.transform = `scale(${scaleRatio})`;
      }
    }

    // Composite Photo Capture: Merges REAL CAMERA BACKGROUND + 3D MODEL
    async capturePhoto() {
      if (this.threeViewer && typeof this.threeViewer.captureCompositePhoto === 'function') {
        return this.threeViewer.captureCompositePhoto();
      }

      const video = this.videoElement;

      // Real Camera Composite Capture
      if (this.cameraManager.isActive() && video && video.videoWidth > 0 && typeof document !== 'undefined') {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');

          // 1. Draw live camera frame
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // 2. Capture transparent 3D model canvas from model-viewer
          if (this.modelViewer) {
            const modelBlob = await this.modelViewer.toBlob({ idealAspect: true });
            if (modelBlob && typeof Image !== 'undefined') {
              const modelImg = new Image();
              const imgLoadPromise = new Promise((resolve) => {
                modelImg.onload = () => resolve();
                modelImg.onerror = () => resolve();
                if (modelImg.complete) resolve();
              });
              modelImg.src = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(modelBlob) : '';
              await imgLoadPromise;

              // Composite model on top of camera
              try {
                ctx.drawImage(modelImg, 0, 0, canvas.width, canvas.height);
              } catch (drawErr) {}
              if (modelImg.src && typeof URL !== 'undefined' && URL.revokeObjectURL) {
                try { URL.revokeObjectURL(modelImg.src); } catch (e) {}
              }
            }
          }

          return new Promise(resolve => {
            canvas.toBlob(blob => {
              if (blob) resolve(URL.createObjectURL(blob));
              else resolve(null);
            }, 'image/jpeg', 0.95);
          });
        } catch (e) {
          console.warn('[SigmaARAdapter] Composite capture error:', e);
        }
      }

      // Standalone model-viewer capture fallback
      if (this.modelViewer) {
        try {
          const blob = await this.modelViewer.toBlob({ idealAspect: true });
          return URL.createObjectURL(blob);
        } catch (e) {
          return null;
        }
      }
      return null;
    }

    resetView() {
      if (this.threeViewer && typeof this.threeViewer.resetView === 'function') {
        this.threeViewer.resetView();
      }
      if (this.modelViewer) {
        this.modelViewer.cameraOrbit = '35deg 75deg 105%';
        this.modelViewer.cameraTarget = 'auto auto auto';
        this.modelViewer.fieldOfView = 'auto';
      }
    }

    setShadowVisible(visible) {
      if (this.threeViewer && typeof this.threeViewer.setShadowVisible === 'function') {
        this.threeViewer.setShadowVisible(visible);
      }
      if (this.modelViewer) {
        this.modelViewer.setAttribute('shadow-intensity', visible ? '1.3' : '0');
      }
    }

    setEnvExposure(exposureVal) {
      if (this.threeViewer && typeof this.threeViewer.setEnvExposure === 'function') {
        this.threeViewer.setEnvExposure(exposureVal > 1.0);
      }
      if (this.modelViewer) {
        this.modelViewer.setAttribute('exposure', String(exposureVal));
      }
    }

    dispose() {
      this.isDisposed = true;

      // 1. Dispose Three.js viewer if instantiated
      if (this.threeViewer && typeof this.threeViewer.dispose === 'function') {
        try { this.threeViewer.dispose(); } catch (e) {}
        this.threeViewer = null;
      }

      // 2. Immediately stop camera stream & release hardware
      if (this.cameraManager) {
        this.cameraManager.stopCamera();
      }

      // 3. Remove model-viewer listeners & DOM
      if (this.modelViewer) {
        if (this.onLoadHandler) this.modelViewer.removeEventListener('load', this.onLoadHandler);
        if (this.onArStatusHandler) this.modelViewer.removeEventListener('ar-status', this.onArStatusHandler);
        if (this.onErrorHandler) this.modelViewer.removeEventListener('error', this.onErrorHandler);

        if (this.modelViewer.parentNode) {
          this.modelViewer.parentNode.removeChild(this.modelViewer);
        }
        this.modelViewer = null;
      }

      if (this.container) {
        this.container.innerHTML = '';
      }
      this.status = 'disposed';
    }
  }

  // Adapter Singleton API
  let currentInstance = null;

  return {
    init: function (container, options) {
      if (currentInstance) {
        currentInstance.dispose();
        currentInstance = null;
      }
      currentInstance = new ARSessionInstance(container, options);
      return currentInstance;
    },

    getInstance: function () {
      return currentInstance;
    },

    activateAR: async function () {
      if (currentInstance) {
        return await currentInstance.activateAR();
      }
    },

    startCamera: async function (options) {
      if (currentInstance) {
        return await currentInstance.startCamera(options);
      }
    },

    stopCamera: function () {
      if (currentInstance) {
        currentInstance.stopCamera();
      }
    },

    toggleCamera: async function () {
      if (currentInstance) {
        return await currentInstance.toggleCamera();
      }
    },

    switchCamera: async function (target) {
      if (currentInstance) {
        return await currentInstance.switchCamera(target);
      }
    },

    isCameraActive: function () {
      return currentInstance ? currentInstance.isCameraActive() : false;
    },

    getAvailableCameras: async function () {
      if (currentInstance) {
        return await currentInstance.getAvailableCameras();
      }
      return [];
    },

    getDiagnostics: async function () {
      if (currentInstance) {
        return await currentInstance.getDiagnostics();
      }
      return null;
    },

    setMode: async function (mode) {
      if (currentInstance) {
        return await currentInstance.setMode(mode);
      }
    },

    setVehicleColor: function (colorHex, colorName, colorIdx) {
      if (currentInstance) {
        currentInstance.setColor(colorHex, colorName, colorIdx);
      }
    },

    dispose: function () {
      if (currentInstance) {
        currentInstance.dispose();
        currentInstance = null;
      }
    },

    isSupported: function () {
      return true;
    }
  };
}));
