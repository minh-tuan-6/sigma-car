// js/car-3d-viewer.js
// SIGMACAR Premium Real 3D Automotive Configurator & WebGL Viewer (Three.js)
// Production PBR Realtime Renderer with Studio Lighting, PBR Materials & 3D Anchored Hotspots

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Car3DViewer = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Pure-JS W3C Unit Quaternion Math Helpers (gimbal-lock free, Three.js r128 & mock-safe)
  const DEG2RAD = Math.PI / 180;

  function quatFromDeviceOrientation(alphaDeg, betaDeg, gammaDeg, screenAngleDeg) {
    const x = (betaDeg || 0) * DEG2RAD;
    const y = (alphaDeg || 0) * DEG2RAD;
    const z = -(gammaDeg || 0) * DEG2RAD;
    const orient = -(screenAngleDeg || 0) * DEG2RAD;

    const c1 = Math.cos(y * 0.5), s1 = Math.sin(y * 0.5);
    const c2 = Math.cos(x * 0.5), s2 = Math.sin(x * 0.5);
    const c3 = Math.cos(z * 0.5), s3 = Math.sin(z * 0.5);

    const qx = s2 * c1 * c3 + c2 * s1 * s3;
    const qy = c2 * s1 * c3 - s2 * c1 * s3;
    const qz = c2 * c1 * s3 - s2 * s1 * c3;
    const qw = c2 * c1 * c3 + s2 * s1 * s3;

    // Rotate device frame to camera frame (-90 deg around X)
    const s = Math.SQRT1_2;
    const ax = (qx - qw) * s;
    const ay = (qy - qz) * s;
    const az = (qz + qy) * s;
    const aw = (qw + qx) * s;

    // Compensate for browser screen orientation around Z
    const so = Math.sin(orient * 0.5);
    const co = Math.cos(orient * 0.5);
    return {
      x: ax * co + ay * so,
      y: ay * co - ax * so,
      z: az * co + aw * so,
      w: aw * co - az * so
    };
  }

  function quatMultiply(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
    };
  }

  function quatInvert(q) {
    const l2 = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w || 1;
    return { x: -q.x / l2, y: -q.y / l2, z: -q.z / l2, w: q.w / l2 };
  }

  function quatAngleTo(a, b) {
    const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
    return 2 * Math.acos(Math.max(-1, Math.min(1, dot)));
  }

  function quatSlerp(a, b, t) {
    let bx = b.x, by = b.y, bz = b.z, bw = b.w;
    let dot = a.x * bx + a.y * by + a.z * bz + a.w * bw;
    if (dot < 0) {
      dot = -dot;
      bx = -bx; by = -by; bz = -bz; bw = -bw;
    }
    if (dot > 0.9995) {
      const x = a.x + (bx - a.x) * t;
      const y = a.y + (by - a.y) * t;
      const z = a.z + (bz - a.z) * t;
      const w = a.w + (bw - a.w) * t;
      const inv = 1 / (Math.hypot(x, y, z, w) || 1);
      return { x: x * inv, y: y * inv, z: z * inv, w: w * inv };
    }
    const theta0 = Math.acos(Math.min(1, Math.max(-1, dot)));
    const sin0 = Math.sin(theta0);
    const theta = theta0 * t;
    const sinT = Math.sin(theta);
    const s0 = Math.cos(theta) - dot * sinT / sin0;
    const s1 = sinT / sin0;
    return {
      x: s0 * a.x + s1 * bx,
      y: s0 * a.y + s1 * by,
      z: s0 * a.z + s1 * bz,
      w: s0 * a.w + s1 * bw
    };
  }

  function rotateVecByQuat(q, v) {
    const tx = 2 * (q.y * v.z - q.z * v.y);
    const ty = 2 * (q.z * v.x - q.x * v.z);
    const tz = 2 * (q.x * v.y - q.y * v.x);
    return {
      x: v.x + q.w * tx + (q.y * tz - q.z * ty),
      y: v.y + q.w * ty + (q.z * tx - q.x * tz),
      z: v.z + q.w * tz + (q.x * ty - q.y * tx)
    };
  }

  // Check WebGL Support
  function isWebGLAvailable() {
    try {
      const canvas = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch (e) {
      return false;
    }
  }

  // Generate High-Quality Ground Contact Shadow Texture
  function createGroundShadowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, 512, 512);

    // Outer soft chassis shadow
    const radGrad = ctx.createRadialGradient(256, 256, 60, 256, 256, 240);
    radGrad.addColorStop(0, 'rgba(0, 0, 0, 0.75)');
    radGrad.addColorStop(0.4, 'rgba(0, 0, 0, 0.45)');
    radGrad.addColorStop(0.8, 'rgba(0, 0, 0, 0.12)');
    radGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = radGrad;
    ctx.fillRect(0, 0, 512, 512);

    // 4 Tire Contact Patches
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    function drawTireShadow(cx, cy, rx, ry) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Front tires
    drawTireShadow(170, 165, 30, 60);
    drawTireShadow(342, 165, 30, 60);
    // Rear tires
    drawTireShadow(165, 350, 32, 65);
    drawTireShadow(347, 350, 32, 65);

    return new THREE.CanvasTexture(canvas);
  }

  // Main 3D Viewer Class
  class ViewerInstance {
    constructor(container, options = {}) {
      this.container = container;
      this.options = {
        modelUrl: 'assets/models/sigma-car-3d.glb',
        initialColor: '#0284C7',
        initialAngle: 137,
        transparent: false,
        arMode: false,
        autoStartCamera: false,
        enableKeyboard: true,
        vrMode: false,
        hotspots: [],
        onRotate: null,
        onHotspotClick: null,
        onProgress: null,
        onReady: null,
        onError: null,
        onCameraStateChange: null,
        onDevicesUpdated: null,
        ...options
      };

      this.scene = null;
      this.camera = null;
      this.renderer = null;
      this.controls = null;
      this.pmremGenerator = null;
      this.carGroup = null;
      this.shadowMesh = null;
      this.floorMesh = null;
      this.ringMesh = null;
      this.vrStudioGroup = null;
      this.bodyMaterials = [];
      this.rimMaterials = [];
      this.hotspots = [];
      this.raycaster = new THREE.Raycaster();
      this.animId = null;
      this.isDisposed = false;
      this.isDragging = false;
      this.currentAngle = this.options.initialAngle || 137;
      this.baseScale = 1;
      this.keysPressed = {};

      // Camera AR Layer Properties
      this.videoElement = null;
      this.mediaStream = null;
      this.isCameraActive = false;
      this.currentMode = (this.options.transparent || this.options.arMode) ? 'ar_camera' : 'studio';
      this.activeDeviceId = null;
      this.activeFacingMode = 'environment';
      this._isMirrored = undefined;
      this.lastCameraError = null;
      this._deviceChangeHandler = null;

      // Real Gyroscope / Motion Tracking Controller State (Default OFF)
      this.gyro = {
        isSupported: null,        // true | false | null (pending check)
        isEnabled: false,         // user toggled ON/OFF
        isActive: false,          // true ONLY after real numeric sensor readings arrive
        permissionState: 'prompt', // 'prompt' | 'granted' | 'denied' | 'unsupported'

        // User-configurable tuning
        sensitivity: 1.2,
        invertH: false,
        invertV: false,
        defaultAngle: 137,
        defaultRadius: 5.5,
        defaultPhi: Math.PI / 2.8,

        // Quaternion SLERP & incremental continuous tracking state (no gimbal lock / no 360 jump)
        lastQRaw: null,
        qFiltered: null,
        qPrev: null,
        refTilt: null,
        prevRoll: null,
        accumYaw: 0,
        accumRoll: 0,
        needsCalibrateRef: true,
        needsSoftResync: false,

        // Spherical orbit anchor & smoothed state
        baseTheta: 0,
        basePhi: Math.PI / 2.8,
        baseRadius: 5.5,
        currentTheta: 0,
        currentPhi: Math.PI / 2.8,
        targetTheta: 0,
        targetPhi: Math.PI / 2.8,

        // DeviceOrientation / DeviceMotion fallback telemetry
        hasSensorReading: false,
        hasOrientationReading: false,
        lastMotionTs: null,
        motionPitchDeg: 0,
        motionRollDeg: 0,
        motionYawDeg: 0,
        sensorCheckTimer: null,
        _lastFrameTime: null,

        // Manual interaction lock (seamless handover with OrbitControls)
        isUserInteracting: false,

        // Filtering & damping constants
        sensorDeadZone: 0.002,   // ~0.11 deg sensor noise gate
        renderDeadZone: 0.0005,  // ~0.03 deg render threshold
        slerpAlpha: 0.38,        // Quaternion low-pass SLERP weight
        dampingSpeed: 10.5,      // Exponential dt damping rate (smooth at 60Hz & 120Hz)
        maxAngularSpeed: 6.0,    // Max orbit speed rad/s (~343 deg/s)
        minPhi: Math.PI / 8,     // ~22.5 deg max overhead look-down
        maxPhi: Math.PI / 2 - 0.04, // ~87.7 deg (strictly above floor)

        _onDeviceOrientation: null,
        _onDeviceMotion: null,
        _onOrientationChange: null
      };

      this.init();
    }

    init() {
      if (!isWebGLAvailable()) {
        console.warn('[Car3DViewer] WebGL is not supported on this device/browser.');
        if (this.options.onError) this.options.onError(new Error('WebGL not available'));
        return;
      }

      const parentEl = this.container.parentElement;
      const width = this.container.clientWidth || (parentEl && parentEl.clientWidth) || 800;
      const height = this.container.clientHeight || (parentEl && parentEl.clientHeight) || 520;

      const isTransparent = !!(this.options.transparent || this.options.arMode);

      // 0. LAYER 1: Dedicated Video Element for Camera Feed
      this.container.innerHTML = '';
      const inlinePos = this.container.style ? this.container.style.position : '';
      let computedPos = inlinePos;
      if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function' && typeof Element !== 'undefined' && this.container instanceof Element) {
        try { computedPos = window.getComputedStyle(this.container).position || inlinePos; } catch (e) {}
      }
      if (inlinePos !== 'absolute' && inlinePos !== 'fixed' && computedPos !== 'absolute' && computedPos !== 'fixed') {
        this.container.style.position = 'relative';
      }
      this.container.style.overflow = 'hidden';

      let video = this.container.querySelector('video.ar-live-video-layer');
      if (!video) {
        video = document.createElement('video');
        video.id = 'ar-camera-live-feed';
        video.className = 'ar-live-video-layer';
        video.setAttribute('autoplay', '');
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.setAttribute('muted', '');
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        if (!video.style) video.style = {};
        video.style.position = 'absolute';
        video.style.top = '0';
        video.style.left = '0';
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'cover';
        video.style.zIndex = '1';
        video.style.pointerEvents = 'none';
        video.style.display = isTransparent ? 'block' : 'none';
        this.container.appendChild(video);
      }
      this.videoElement = video;
      this.videoTexture = null;

      // 1. Scene: Null background when transparent/AR to allow camera video to show through!
      this.scene = new THREE.Scene();
      if (isTransparent) {
        this.scene.background = null;
        this.scene.fog = null;
      } else {
        this.scene.background = new THREE.Color(0x0B1120);
        this.scene.fog = new THREE.FogExp2(0x0B1120, 0.035);
      }

      // 2. Camera: 38deg FOV gives realistic automotive telephoto proportions
      this.camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
      this.camera.position.set(4.8, 1.8, 4.2);

      // 3. Renderer: LAYER 3 with Alpha enabled & Transparent ClearColor in AR mode
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true, // Always allow alpha so Three.js can dynamically render over camera
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance'
      });
      if (isTransparent) {
        this.renderer.setClearColor(0x000000, 0);
      } else {
        this.renderer.setClearColor(0x0B1120, 1);
      }
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.08;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      if (this.renderer.xr) {
        this.renderer.xr.enabled = true;
      }

      // Ensure canvas is transparent and positioned above camera video (LAYER 2: z-index 2)
      this.renderer.domElement.style.position = 'absolute';
      this.renderer.domElement.style.top = '0';
      this.renderer.domElement.style.left = '0';
      this.renderer.domElement.style.width = '100%';
      this.renderer.domElement.style.height = '100%';
      this.renderer.domElement.style.zIndex = '2';
      this.renderer.domElement.style.background = 'transparent';
      this.renderer.domElement.style.display = 'block';
      this.container.appendChild(this.renderer.domElement);

      // 4. OrbitControls
      if (typeof THREE.OrbitControls !== 'undefined') {
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.06;
        this.controls.enablePan = false;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.03; // Stay strictly above floor
        this.controls.minPolarAngle = Math.PI / 8;        // Realistic max high angle
        this.controls.minDistance = 3.2;
        this.controls.maxDistance = 8.5;
        this.controls.rotateSpeed = 0.8;
        this.controls.zoomSpeed = 0.9;
        this.controls.target.set(0, 0.6, 0);

        this.controls.addEventListener('start', () => {
          this.isDragging = true;
          if (this.gyro) {
            this.gyro.isUserInteracting = true;
            this.gyro._lastFrameTime = null;
          }
          this.container.style.cursor = 'grabbing';
        });

        this.controls.addEventListener('end', () => {
          this.isDragging = false;
          this.container.style.cursor = 'grab';
          // Seamless handover: re-anchor Gyro reference to post-drag camera angle without jump
          if (this.gyro && this.gyro.isEnabled) {
            this.calibrateGyro({ silent: true });
          }
          if (this.gyro) {
            this.gyro.isUserInteracting = false;
          }
        });

        this.controls.addEventListener('change', () => {
          this.syncRotationAngleFromCamera();
        });
      }

      this.container.style.cursor = 'grab';

      // 5. Environment & Studio Lighting
      this.setupLighting();

      // 6. Studio Floor & Contact Shadow
      this.setupStudioFloor();

      // 7. Load Vehicle Model (GLB or Procedural Fallback)
      this.loadModel();

      // 8. Build Hotspots DOM Layer
      this.setupHotspots();

      // 9. Keyboard Navigation for VR & 3D Studio Walkthrough
      if (this.options.enableKeyboard !== false) {
        this.setupKeyboardNavigation();
      }

      // 10. Resize Listener
      this.onWindowResize = this.handleResize.bind(this);
      window.addEventListener('resize', this.onWindowResize);

      // 11. Start Animation Loop
      this.animate = this.animate.bind(this);
      this.animate();

      // Apply initial angle & optional VR Studio mode
      this.setRotationAngle(this.currentAngle);
      if (this.options.vrMode) {
        this.setVRStudioMode(true);
      }

      // Auto start camera if requested
      if (this.options.autoStartCamera) {
        this.startCamera().catch(err => {
          console.warn('[ViewerInstance] Auto-start camera:', err.message);
        });
      }

      // Listen for camera hardware changes
      if (typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function') {
        this._deviceChangeHandler = async () => {
          const devices = await this.getAvailableCameras();
          if (typeof this.options.onDevicesUpdated === 'function') {
            this.options.onDevicesUpdated(devices);
          }
        };
        navigator.mediaDevices.addEventListener('devicechange', this._deviceChangeHandler);
      }
    }

    setupKeyboardNavigation() {
      this.onKeyDown = (e) => {
        if (this.isDisposed) return;
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return;
        const k = e.key.toLowerCase();
        if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
          this.keysPressed[k] = true;
        }
      };
      this.onKeyUp = (e) => {
        const k = e.key.toLowerCase();
        delete this.keysPressed[k];
      };
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
    }

    updateKeyboardControls() {
      if (!this.controls || !this.camera || !this.keysPressed) return;
      const keys = Object.keys(this.keysPressed);
      if (keys.length === 0) return;

      const rotStep = 2.0;
      if (this.keysPressed['a'] || this.keysPressed['arrowleft'] || this.keysPressed['q']) {
        this.setRotationAngle(this.currentAngle - rotStep);
      }
      if (this.keysPressed['d'] || this.keysPressed['arrowright'] || this.keysPressed['e']) {
        this.setRotationAngle(this.currentAngle + rotStep);
      }
      if (this.keysPressed['w'] || this.keysPressed['arrowup']) {
        const dir = this.controls.target.clone().sub(this.camera.position).normalize();
        const dist = this.camera.position.distanceTo(this.controls.target);
        if (dist > (this.controls.minDistance || 2.5) + 0.15) {
          this.camera.position.addScaledVector(dir, 0.08);
          this.controls.update();
        }
      }
      if (this.keysPressed['s'] || this.keysPressed['arrowdown']) {
        const dir = this.controls.target.clone().sub(this.camera.position).normalize();
        const dist = this.camera.position.distanceTo(this.controls.target);
        if (dist < (this.controls.maxDistance || 10) - 0.15) {
          this.camera.position.addScaledVector(dir, -0.08);
          this.controls.update();
        }
      }
    }

    setupLighting() {
      // RoomEnvironment PBR Reflections (Creates realistic studio softbox reflections on car paint)
      if (typeof THREE.RoomEnvironment !== 'undefined') {
        this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        this.pmremGenerator.compileEquirectangularShader();
        const roomEnv = new THREE.RoomEnvironment();
        this.scene.environment = this.pmremGenerator.fromScene(roomEnv).texture;
      }

      // Key Studio Overhead Soft Light
      const keyLight = new THREE.DirectionalLight(0xFFFFFF, 2.8);
      keyLight.position.set(4, 9, 5);
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.width = 1024;
      keyLight.shadow.mapSize.height = 1024;
      keyLight.shadow.camera.near = 1;
      keyLight.shadow.camera.far = 20;
      keyLight.shadow.camera.left = -4;
      keyLight.shadow.camera.right = 4;
      keyLight.shadow.camera.top = 4;
      keyLight.shadow.camera.bottom = -4;
      keyLight.shadow.bias = -0.0005;
      this.scene.add(keyLight);

      // Fill Light from opposite side (Softer cyan/white)
      const fillLight = new THREE.DirectionalLight(0xBAE6FD, 1.4);
      fillLight.position.set(-5, 6, -4);
      this.scene.add(fillLight);

      // Rear Rim / Horizon Light (Creates sharp automotive edge highlights)
      const rimLight = new THREE.DirectionalLight(0x60A5FA, 2.0);
      rimLight.position.set(0, 3, -6);
      this.scene.add(rimLight);

      // Ambient Base Light
      const ambLight = new THREE.AmbientLight(0x334155, 0.9);
      this.scene.add(ambLight);
    }

    setupStudioFloor() {
      // Contact shadow mesh under the vehicle
      const shadowGeo = new THREE.PlaneGeometry(5.2, 3.2);
      const shadowTex = createGroundShadowTexture();
      const shadowMat = new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        opacity: 0.88,
        depthWrite: false
      });
      this.shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
      this.shadowMesh.rotation.x = -Math.PI / 2;
      this.shadowMesh.position.y = 0.003;
      this.scene.add(this.shadowMesh);

      if (this.options.transparent || this.options.arMode) {
        return; // In AR transparent mode, only render the contact shadow underneath the 3D car
      }

      // Subtle studio reflective circular floor with grid ring
      const floorGeo = new THREE.CircleGeometry(12, 64);
      const floorMat = new THREE.MeshStandardMaterial({
        color: 0x0F172A,
        roughness: 0.55,
        metalness: 0.35
      });
      this.floorMesh = new THREE.Mesh(floorGeo, floorMat);
      this.floorMesh.rotation.x = -Math.PI / 2;
      this.floorMesh.position.y = 0;
      this.floorMesh.receiveShadow = true;
      this.scene.add(this.floorMesh);

      // Studio Accent Ring
      const ringGeo = new THREE.RingGeometry(4.2, 4.25, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x1E40AF,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide
      });
      this.ringMesh = new THREE.Mesh(ringGeo, ringMat);
      this.ringMesh.rotation.x = -Math.PI / 2;
      this.ringMesh.position.y = 0.002;
      this.scene.add(this.ringMesh);

      // VR Architectural Studio Environment Group (Light Rings & Pillars for VR Showroom)
      this.vrStudioGroup = new THREE.Group();
      this.vrStudioGroup.visible = false;

      const outerRingGeo = new THREE.RingGeometry(6.8, 6.86, 64);
      const outerRingMat = new THREE.MeshBasicMaterial({
        color: 0x38BDF8,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide
      });
      const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
      outerRing.rotation.x = -Math.PI / 2;
      outerRing.position.y = 0.004;
      this.vrStudioGroup.add(outerRing);

      // Overhead Studio Light Halo
      const haloGeo = new THREE.TorusGeometry(3.8, 0.04, 16, 64);
      const haloMat = new THREE.MeshBasicMaterial({ color: 0xE0F2FE });
      const haloMesh = new THREE.Mesh(haloGeo, haloMat);
      haloMesh.rotation.x = Math.PI / 2;
      haloMesh.position.y = 3.6;
      this.vrStudioGroup.add(haloMesh);

      this.scene.add(this.vrStudioGroup);
    }

    loadModel() {
      const loader = typeof THREE.GLTFLoader !== 'undefined' ? new THREE.GLTFLoader() : null;

      if (!loader || !this.options.modelUrl) {
        if (this.options.onError) this.options.onError(new Error('GLTFLoader or modelUrl not available'));
        return;
      }

      if (typeof THREE.DRACOLoader !== 'undefined') {
        const dracoLoader = new THREE.DRACOLoader();
        dracoLoader.setDecoderPath('js/libs/draco/');
        loader.setDRACOLoader(dracoLoader);
      }

      loader.load(
        this.options.modelUrl,
        (gltf) => {
          if (this.isDisposed) return;
          this.setupLoadedModel(gltf.scene);
        },
        (xhr) => {
          if (xhr.lengthComputable && this.options.onProgress) {
            const percent = Math.min(99, Math.round((xhr.loaded / xhr.total) * 100));
            this.options.onProgress(percent);
          }
        },
        (err) => {
          console.error('[Car3DViewer] Could not load real GLB file:', err);
          if (this.options.onError) this.options.onError(err);
        }
      );
    }

    setupLoadedModel(model) {
      try {
        // 1. Normalize Scale & Center inside a wrapper Group so all 24 GLB models (mm, cm, or m) render at 4.4m studio scale
        model.updateMatrixWorld(true);
        const rawBox = new THREE.Box3().setFromObject(model);
        const rawSize = rawBox.getSize(new THREE.Vector3());
        const rawMaxDim = Math.max(rawSize.x, rawSize.y, rawSize.z);
        const targetMaxDim = 4.4;
        const normScale = (rawMaxDim > 0.0001 && isFinite(rawMaxDim)) ? (targetMaxDim / rawMaxDim) : 1.0;
        model.scale.multiplyScalar(normScale);
        model.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        // Center model horizontally at origin and place bottom of tires flush on floor (y = 0)
        model.position.x += -center.x;
        model.position.z += -center.z;
        model.position.y += -box.min.y;
        model.updateMatrixWorld(true);

        const wrapper = new THREE.Group();
        wrapper.add(model);
        this.carGroup = wrapper;

        // 2. Adjust Camera to Frame the Normalized Vehicle at 70-75% of visual area
        const maxDim = Math.max(size.x, size.y, size.z) || targetMaxDim;
        const fovRad = this.camera.fov * (Math.PI / 180);
        const idealDist = (maxDim / 2) / Math.tan(fovRad / 2) * 1.35;

        this.camera.near = 0.05;
        this.camera.far = Math.max(500, idealDist * 20);
        this.camera.updateProjectionMatrix();

        this.camera.position.set(
          idealDist * 0.75,
          maxDim * 0.36,
          idealDist * 0.75
        );
        if (this.controls) {
          this.controls.minDistance = maxDim * 0.55;
          this.controls.maxDistance = maxDim * 3.0;
          this.controls.target.set(0, size.y * 0.36, 0);
          this.controls.update();
        }

        // 3. Preserve Original GLTF PBR Materials & Textures while registering paintable Body & Rim materials
        this.bodyMaterials = [];
        this.rimMaterials = [];
        const fallbackBodyCandidates = [];

        this.carGroup.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;

            const mats = Array.isArray(child.material) ? child.material : (child.material ? [child.material] : []);
            const meshName = (child.name || '').toLowerCase();

            mats.forEach((mat) => {
              if (!mat) return;
              const matName = (mat.name || '').toLowerCase();

              const isPaint = (
                matName.includes('paint') ||
                matName.includes('carpaint') ||
                matName.includes('body') ||
                matName.includes('exterior') ||
                matName.includes('shell') ||
                matName.includes('carroceria') ||
                matName.includes('coat') ||
                matName.includes('color') ||
                meshName.includes('paint') ||
                meshName.includes('carpaint') ||
                (meshName.includes('body') && !meshName.includes('under') && !meshName.includes('glass'))
              );

              if (isPaint && mat.color && !this.bodyMaterials.includes(mat)) {
                this.bodyMaterials.push(mat);
              } else if (
                mat.color &&
                !mat.transparent &&
                !matName.includes('glass') &&
                !matName.includes('window') &&
                !matName.includes('tire') &&
                !matName.includes('tyre') &&
                !matName.includes('rubber') &&
                !matName.includes('interior') &&
                !matName.includes('light') &&
                !matName.includes('chrome') &&
                !matName.includes('black') &&
                !fallbackBodyCandidates.includes(mat)
              ) {
                fallbackBodyCandidates.push(mat);
              }

              const isRim = (
                matName.includes('rim') ||
                matName.includes('wheel') ||
                matName.includes('alloy') ||
                meshName.includes('rim')
              );
              if (isRim && mat.color && !this.rimMaterials.includes(mat)) {
                this.rimMaterials.push(mat);
              }
            });
          }
        });

        if (this.bodyMaterials.length === 0 && fallbackBodyCandidates.length > 0) {
          this.bodyMaterials = fallbackBodyCandidates;
        }

        this.scene.add(this.carGroup);
        this.handleResize();
        this.setRotationAngle(this.currentAngle);
        this.syncRotationAngleFromCamera();
      } catch (err) {
        console.error('[Car3DViewer] Error in setupLoadedModel:', err);
      } finally {
        if (this.options.onReady) {
          this.options.onReady();
        }
      }
    }

    setupHotspots() {
      // Create overlay container for 2D DOM hotspots attached to 3D world points
      let overlay = this.container.querySelector('.vr-3d-hotspots-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'vr-3d-hotspots-overlay';
        overlay.style.cssText = 'position:absolute; inset:0; pointer-events:none; z-index:20; overflow:hidden;';
        this.container.appendChild(overlay);
      }
      this.hotspotsOverlay = overlay;
      this.hotspotsOverlay.innerHTML = '';

      const defs = this.options.hotspots || [];
      this.hotspots = defs.map((h) => {
        const el = document.createElement('div');
        el.className = 'vr-hotspot-3d';
        el.setAttribute('data-id', h.id);
        el.style.cssText = 'position:absolute; top:0; left:0; width:28px; height:28px; margin-left:-14px; margin-top:-14px; pointer-events:auto; cursor:pointer; transition:opacity 0.2s ease, transform 0.05s linear; will-change:transform,opacity;';

        el.innerHTML = `
          <div class="vr-hotspot-pulse" style="position:absolute; inset:0; border-radius:50%; border:2px solid #38BDF8; animation:hotspotPulse 2s infinite ease-out;"></div>
          <div class="vr-hotspot-core" style="position:absolute; top:6px; left:6px; width:16px; height:16px; border-radius:50%; background:#2563EB; border:2px solid #FFFFFF; box-shadow:0 0 12px rgba(37,99,235,0.9);"></div>
          <div class="vr-hotspot-tooltip" style="display:none; position:absolute; bottom:34px; left:50%; transform:translateX(-50%); background:rgba(15,23,42,0.95); border:1px solid rgba(255,255,255,0.15); backdrop-filter:blur(10px); color:#FFFFFF; padding:10px 14px; border-radius:10px; font-size:12px; width:220px; line-height:1.45; box-shadow:0 10px 25px -5px rgba(0,0,0,0.5); pointer-events:none; z-index:30;">
            <div style="font-size:10px; font-weight:800; color:#38BDF8; text-transform:uppercase; margin-bottom:2px;">${h.category || 'CHI TIẾT KỸ THUẬT'}</div>
            <strong style="font-size:13px; color:#FFFFFF; display:block; margin-bottom:4px;">${h.name}</strong>
            <p style="margin:0; font-size:11.5px; color:#CBD5E1;">${h.desc}</p>
          </div>
        `;

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const tip = el.querySelector('.vr-hotspot-tooltip');
          const isShown = tip.style.display === 'block';

          // Close all tooltips
          document.querySelectorAll('.vr-hotspot-3d .vr-hotspot-tooltip').forEach(t => t.style.display = 'none');

          if (!isShown) {
            tip.style.display = 'block';
            if (this.options.onHotspotClick) this.options.onHotspotClick(h);
          }
        });

        this.hotspotsOverlay.appendChild(el);

        return {
          id: h.id,
          name: h.name,
          desc: h.desc,
          pos: new THREE.Vector3(...(h.pos || [0, 0, 0])),
          element: el
        };
      });

      // Close tooltips on canvas click
      this.renderer.domElement.addEventListener('click', () => {
        document.querySelectorAll('.vr-hotspot-3d .vr-hotspot-tooltip').forEach(t => t.style.display = 'none');
      });
    }

    updateHotspots() {
      if (!this.hotspots || this.hotspots.length === 0 || !this.camera) return;

      const width = this.container.clientWidth;
      const height = this.container.clientHeight;

      for (let i = 0; i < this.hotspots.length; i++) {
        const h = this.hotspots[i];
        const worldPos = h.pos.clone();

        // Project 3D vector to Normalized Device Coordinates (-1 to 1)
        const screenPos = worldPos.clone().project(this.camera);

        // Check if point is behind camera
        if (screenPos.z > 1.0) {
          h.element.style.opacity = '0';
          h.element.style.pointerEvents = 'none';
          continue;
        }

        // Occlusion Check: Raycast from camera to hotspot coordinate
        const dir = worldPos.clone().sub(this.camera.position).normalize();
        this.raycaster.set(this.camera.position, dir);

        let isOccluded = false;
        if (this.carGroup) {
          const intersects = this.raycaster.intersectObjects(this.carGroup.children, true);
          const distToHotspot = this.camera.position.distanceTo(worldPos);
          if (intersects.length > 0 && intersects[0].distance < distToHotspot - 0.28) {
            isOccluded = true;
          }
        }

        if (isOccluded) {
          h.element.style.opacity = '0';
          h.element.style.pointerEvents = 'none';
        } else {
          h.element.style.opacity = '1';
          h.element.style.pointerEvents = 'auto';

          // Convert NDC (-1..1) to CSS pixels
          const px = (screenPos.x * 0.5 + 0.5) * width;
          const py = (-screenPos.y * 0.5 + 0.5) * height;
          h.element.style.transform = `translate3d(${Math.round(px)}px, ${Math.round(py)}px, 0)`;
        }
      }
    }

    syncRotationAngleFromCamera() {
      if (!this.controls || !this.camera) return;

      // Extract horizontal Azimuthal angle around Y axis
      const theta = this.controls.getAzimuthalAngle(); // in radians [-PI, PI]
      let deg = Math.round((theta * 180 / Math.PI) % 360);
      if (deg < 0) deg += 360;

      this.currentAngle = deg;

      if (this.options.onRotate) {
        this.options.onRotate(this.currentAngle);
      }
    }

    setRotationAngle(angleDeg) {
      if (!this.controls || !this.camera) return;

      this.currentAngle = ((Math.round(angleDeg) % 360) + 360) % 360;
      const rad = this.currentAngle * (Math.PI / 180);

      const target = this.controls.target || { x: 0, y: 0.6, z: 0 };
      const pos = this.camera.position || { x: 0, y: 2.2, z: 5.0 };
      const dx = (pos.x || 0) - (target.x || 0);
      const dy = (pos.y || 0) - (target.y || 0);
      const dz = (pos.z || 0) - (target.z || 0);
      // Bundled OrbitControls build has no getDistance(): compute safely from camera position
      const radius = (typeof this.controls.getDistance === 'function'
        ? this.controls.getDistance()
        : Math.hypot(dx, dy, dz)) || 5.5;
      const polar = (typeof this.controls.getPolarAngle === 'function'
        ? this.controls.getPolarAngle()
        : Math.acos(Math.max(-1, Math.min(1, dy / radius)))) || (Math.PI / 2.8);

      const x = (target.x || 0) + radius * Math.sin(polar) * Math.sin(rad);
      const z = (target.z || 0) + radius * Math.sin(polar) * Math.cos(rad);
      const y = (target.y || 0) + radius * Math.cos(polar);

      this.camera.position.set(x, y, z);
      this.camera.lookAt(target);
      this.controls.update();

      if (this.gyro && this.gyro.isEnabled) {
        this.calibrateGyro({ silent: true });
      }

      if (this.options.onRotate) {
        this.options.onRotate(this.currentAngle);
      }
    }

    setBodyColor(hexColor) {
      const col = new THREE.Color(hexColor);
      this.bodyMaterials.forEach((mat) => {
        mat.color.copy(col);
        mat.needsUpdate = true;
      });
    }

    setWheelType(wheelId) {
      let rimColor = 0xD0D5DD;
      let roughness = 0.22;
      let metalness = 0.92;

      if (wheelId === 'wheel-20-aero') {
        rimColor = 0x334155; // Dark Matte Aero
        roughness = 0.5;
        metalness = 0.75;
      } else if (wheelId === 'wheel-22-forged') {
        rimColor = 0xB45309; // Forged Bronze / Copper
        roughness = 0.3;
        metalness = 0.95;
      }

      this.rimMaterials.forEach((mat) => {
        mat.color.setHex(rimColor);
        mat.roughness = roughness;
        mat.metalness = metalness;
        mat.needsUpdate = true;
      });
    }

    // ==========================================
    // REAL GYROSCOPE (MOTION SENSOR) CONTROLLER
    // ==========================================

    _getScreenOrientationAngle() {
      if (typeof window === 'undefined') return 0;
      if (window.screen && window.screen.orientation && typeof window.screen.orientation.angle === 'number') {
        return window.screen.orientation.angle;
      }
      if (typeof window.orientation === 'number') {
        return window.orientation;
      }
      return 0;
    }

    _onOrientationChange() {
      if (this.gyro && this.gyro.isEnabled) {
        this.gyro.needsSoftResync = true;
      }
    }

    _markGyroSensorStreaming() {
      const wasActive = this.gyro.isActive;
      this.gyro.hasSensorReading = true;
      this.gyro.isSupported = true;
      this.gyro.isActive = true;
      this.gyro.permissionState = 'granted';
      if (this.gyro.sensorCheckTimer) {
        clearTimeout(this.gyro.sensorCheckTimer);
        this.gyro.sensorCheckTimer = null;
      }
      if (!wasActive && typeof this.options.onGyroStateChange === 'function') {
        this.options.onGyroStateChange('active', {
          message: 'Motion Tracking Enabled'
        });
      }
    }

    _applyGyroQuaternionSample(alphaDeg, betaDeg, gammaDeg) {
      if (!this.gyro || !this.gyro.isEnabled) return;

      const screenAngle = this._getScreenOrientationAngle();
      const qRaw = quatFromDeviceOrientation(alphaDeg, betaDeg, gammaDeg, screenAngle);
      this.gyro.lastQRaw = qRaw;

      // Soft resync after OS portrait/landscape screen flip without camera snap
      if (this.gyro.needsSoftResync || this.gyro.needsCalibrateRef || !this.gyro.qFiltered) {
        const fwd0 = rotateVecByQuat(qRaw, { x: 0, y: 0, z: -1 });
        const up0 = rotateVecByQuat(qRaw, { x: 0, y: 1, z: 0 });
        const right0 = rotateVecByQuat(qRaw, { x: 1, y: 0, z: 0 });
        const rawTilt0 = Math.atan2(-fwd0.y, up0.y);
        const rawRoll0 = Math.asin(Math.max(-1, Math.min(1, right0.y)));

        this.gyro.qFiltered = qRaw;
        this.gyro.qPrev = qRaw;
        this.gyro.prevRoll = rawRoll0;

        if (this.gyro.needsCalibrateRef) {
          this.gyro.refTilt = rawTilt0;
          this.gyro.accumYaw = 0;
          this.gyro.accumRoll = 0;
          this.gyro.needsCalibrateRef = false;
        } else {
          // Soft resync on screen orientation change: preserve current orbit angle smoothly
          this.gyro.baseTheta = this.gyro.currentTheta;
          this.gyro.basePhi = this.gyro.currentPhi;
          this.gyro.refTilt = rawTilt0;
          this.gyro.accumYaw = 0;
          this.gyro.accumRoll = 0;
        }
        this.gyro.needsSoftResync = false;
        return;
      }

      // 1. Sensor noise dead-zone gate (prevents tremor when device held stationary)
      const angleDiff = quatAngleTo(this.gyro.qFiltered, qRaw);
      if (angleDiff < (this.gyro.sensorDeadZone || 0.002)) {
        return;
      }

      // 2. Quaternion SLERP low-pass filtering (smooth shortest-arc interpolation, zero gimbal lock)
      const slerpWeight = this.gyro.slerpAlpha || 0.38;
      this.gyro.qFiltered = quatSlerp(this.gyro.qFiltered, qRaw, slerpWeight);

      // 3. Decoupled orthogonal yaw + horizon roll + tilt extraction (no Euler gimbal flips or axis cancellation)
      let qDelta = quatMultiply(this.gyro.qFiltered, quatInvert(this.gyro.qPrev));
      if (qDelta.w < 0) {
        qDelta = { x: -qDelta.x, y: -qDelta.y, z: -qDelta.z, w: -qDelta.w };
      }

      const fwd = rotateVecByQuat(this.gyro.qFiltered, { x: 0, y: 0, z: -1 });
      const up = rotateVecByQuat(this.gyro.qFiltered, { x: 0, y: 1, z: 0 });
      const right = rotateVecByQuat(this.gyro.qFiltered, { x: 1, y: 0, z: 0 });

      const vLen = Math.hypot(qDelta.x, qDelta.y, qDelta.z);
      let stepYaw = 0;
      if (vLen > 1e-8) {
        const rotAng = 2 * Math.atan2(vLen, qDelta.w);
        const scaleW = rotAng / vLen;
        const wx = qDelta.x * scaleW;
        const wy = qDelta.y * scaleW;
        const wz = qDelta.z * scaleW;

        const spineSpin = wx * up.x + wy * up.y + wz * up.z;
        const uy2 = up.y * up.y;
        const pureAlpha = (wy - up.y * spineSpin) / Math.max(0.06, 1 - uy2);
        const uprightBlend = Math.max(0, Math.min(1, (Math.abs(up.y) - 0.96) / 0.04));
        stepYaw = pureAlpha * (1 - uprightBlend) + wy * uprightBlend;
      }

      const rawTilt = Math.atan2(-fwd.y, up.y);
      const rawRoll = Math.asin(Math.max(-1, Math.min(1, right.y)));
      const stepRoll = rawRoll - (this.gyro.prevRoll !== null ? this.gyro.prevRoll : rawRoll);

      this.gyro.accumYaw += stepYaw;
      this.gyro.accumRoll += stepRoll;
      this.gyro.prevRoll = rawRoll;
      this.gyro.qPrev = this.gyro.qFiltered;

      const deltaTilt = rawTilt - (this.gyro.refTilt !== null ? this.gyro.refTilt : rawTilt);

      const sens = this.gyro.sensitivity || 1.2;
      const hSign = this.gyro.invertH ? -1 : 1;
      const vSign = this.gyro.invertV ? -1 : 1;

      // 4. Map decoupled motion to car orbit spherical coordinates (yaw & bank-roll align cleanly)
      const combinedH = this.gyro.accumYaw + 1.15 * this.gyro.accumRoll;
      this.gyro.targetTheta = this.gyro.baseTheta - combinedH * sens * hSign;

      const rawTargetPhi = this.gyro.basePhi - deltaTilt * sens * vSign;
      this.gyro.targetPhi = Math.max(this.gyro.minPhi, Math.min(this.gyro.maxPhi, rawTargetPhi));
    }

    _onDeviceOrientation(e) {
      if (!this.gyro || !this.gyro.isEnabled) return;

      const alpha = typeof e.alpha === 'number' && Number.isFinite(e.alpha) ? e.alpha : null;
      const beta = typeof e.beta === 'number' && Number.isFinite(e.beta) ? e.beta : null;
      const gamma = typeof e.gamma === 'number' && Number.isFinite(e.gamma) ? e.gamma : null;

      // PC desktops often emit a single null event; keep waiting until real data arrives or timer expires
      if (alpha === null && beta === null && gamma === null) {
        return;
      }

      this.gyro.hasOrientationReading = true;
      this._markGyroSensorStreaming();
      this._applyGyroQuaternionSample(alpha !== null ? alpha : 0, beta !== null ? beta : 0, gamma !== null ? gamma : 0);
    }

    _onDeviceMotion(e) {
      // DeviceMotion fallback when only gyroscope rotationRate is exposed without DeviceOrientation
      if (!this.gyro || !this.gyro.isEnabled || this.gyro.hasOrientationReading) return;
      const rr = e && e.rotationRate;
      if (!rr) return;

      const ra = typeof rr.alpha === 'number' && Number.isFinite(rr.alpha) ? rr.alpha : null;
      const rb = typeof rr.beta === 'number' && Number.isFinite(rr.beta) ? rr.beta : null;
      const rg = typeof rr.gamma === 'number' && Number.isFinite(rr.gamma) ? rr.gamma : null;
      if (ra === null && rb === null && rg === null) return;

      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      this._markGyroSensorStreaming();

      if (this.gyro.lastMotionTs === null) {
        this.gyro.lastMotionTs = now;
        this.gyro.motionPitchDeg = 45;
        this.gyro.motionRollDeg = 0;
        this.gyro.motionYawDeg = 0;
        this._applyGyroQuaternionSample(0, 45, 0);
        return;
      }

      const dt = Math.max(0.001, Math.min(0.05, (now - this.gyro.lastMotionTs) / 1000));
      this.gyro.lastMotionTs = now;
      this.gyro.motionPitchDeg += (ra || 0) * dt;
      this.gyro.motionRollDeg += (rb || 0) * dt;
      this.gyro.motionYawDeg += (rg || 0) * dt;

      this._applyGyroQuaternionSample(this.gyro.motionYawDeg, this.gyro.motionPitchDeg, this.gyro.motionRollDeg);
    }

    calibrateGyro(opts = {}) {
      if (!this.controls || !this.camera) return;

      const target = this.controls.target || { x: 0, y: 0.6, z: 0 };
      const pos = this.camera.position || { x: 0, y: 2.2, z: 5.0 };
      const ox = (pos.x || 0) - (target.x || 0);
      const oy = (pos.y || 0) - (target.y || 0);
      const oz = (pos.z || 0) - (target.z || 0);
      const radius = Math.hypot(ox, oy, oz) || this.gyro.baseRadius || 5.5;
      const currentPhi = Math.acos(Math.max(-1, Math.min(1, oy / radius)));
      const currentTheta = Math.atan2(ox, oz);

      this.gyro.baseRadius = radius;
      this.gyro.basePhi = currentPhi;
      this.gyro.baseTheta = currentTheta;
      this.gyro.currentPhi = currentPhi;
      this.gyro.currentTheta = currentTheta;
      this.gyro.targetPhi = currentPhi;
      this.gyro.targetTheta = currentTheta;

      // Reset relative motion accumulators cleanly to latest raw posture (zero post-calibration SLERP drift)
      const qAnchor = this.gyro.lastQRaw || this.gyro.qFiltered;
      if (this.gyro.hasSensorReading && qAnchor) {
        const fwd = rotateVecByQuat(qAnchor, { x: 0, y: 0, z: -1 });
        const up = rotateVecByQuat(qAnchor, { x: 0, y: 1, z: 0 });
        const right = rotateVecByQuat(qAnchor, { x: 1, y: 0, z: 0 });
        this.gyro.qFiltered = qAnchor;
        this.gyro.qPrev = qAnchor;
        this.gyro.refTilt = Math.atan2(-fwd.y, up.y);
        this.gyro.prevRoll = Math.asin(Math.max(-1, Math.min(1, right.y)));
        this.gyro.accumYaw = 0;
        this.gyro.accumRoll = 0;
        this.gyro.needsCalibrateRef = false;
      } else {
        this.gyro.refTilt = null;
        this.gyro.prevRoll = null;
        this.gyro.qFiltered = null;
        this.gyro.qPrev = null;
        this.gyro.accumYaw = 0;
        this.gyro.accumRoll = 0;
        this.gyro.needsCalibrateRef = true;
      }

      if (!opts.silent && typeof this.options.onGyroStateChange === 'function') {
        this.options.onGyroStateChange('calibrated', {
          message: 'Đã căn chỉnh (Recenter) lại vị trí tham chiếu = 0°'
        });
      }
    }

    resetGyroOrientation() {
      if (this.controls) {
        if (typeof this.controls.reset === 'function') {
          this.controls.reset();
        }
        const defaultAngle = this.gyro.defaultAngle || 137;
        const rad = defaultAngle * DEG2RAD;
        const polar = this.gyro.defaultPhi || (Math.PI / 2.8);
        const radius = this.gyro.defaultRadius || 5.5;
        const target = this.controls.target || { x: 0, y: 0.6, z: 0 };
        if (typeof target.set === 'function') target.set(0, 0.6, 0);

        const x = (target.x || 0) + radius * Math.sin(polar) * Math.sin(rad);
        const y = (target.y || 0) + radius * Math.cos(polar);
        const z = (target.z || 0) + radius * Math.sin(polar) * Math.cos(rad);
        if (this.camera && this.camera.position && typeof this.camera.position.set === 'function') {
          this.camera.position.set(x, y, z);
          if (typeof this.camera.lookAt === 'function') this.camera.lookAt(target);
        }
        this.currentAngle = defaultAngle;
        this.controls.update();
      }

      this.calibrateGyro({ silent: true });

      if (this.options.onRotate) {
        this.options.onRotate(this.currentAngle);
      }
      if (typeof this.options.onGyroStateChange === 'function') {
        this.options.onGyroStateChange('reset', {
          message: 'Đã khôi phục góc nhìn mặc định (137°) & cân bằng Gyro'
        });
      }
    }

    updateGyroCamera(now) {
      if (!this.gyro || !this.gyro.isEnabled || !this.gyro.isActive || this.gyro.isUserInteracting || this.isDragging) {
        return;
      }
      if (!this.controls || !this.camera) return;

      const ts = typeof now === 'number' ? now : ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
      const rawDt = this.gyro._lastFrameTime ? (ts - this.gyro._lastFrameTime) / 1000 : (1 / 60);
      const dt = Math.max(0.001, Math.min(0.05, rawDt));
      this.gyro._lastFrameTime = ts;

      const target = this.controls.target || { x: 0, y: 0.6, z: 0 };
      const pos = this.camera.position || { x: 0, y: 2.2, z: 5.0 };

      // Dynamically preserve live zoom radius (so scroll/pinch zoom stays intact while gyro orbits)
      const ox = (pos.x || 0) - (target.x || 0);
      const oy = (pos.y || 0) - (target.y || 0);
      const oz = (pos.z || 0) - (target.z || 0);
      const liveR = Math.hypot(ox, oy, oz);
      const r = liveR > 0.1 ? liveR : (this.gyro.baseRadius || 5.5);
      this.gyro.baseRadius = r;

      const deadZone = this.gyro.renderDeadZone || 0.0005;
      const diffTheta = this.gyro.targetTheta - this.gyro.currentTheta;
      const clampedTargetPhi = Math.max(this.gyro.minPhi, Math.min(this.gyro.maxPhi, this.gyro.targetPhi));
      const diffPhi = clampedTargetPhi - this.gyro.currentPhi;

      if (Math.abs(diffTheta) < deadZone && Math.abs(diffPhi) < deadZone) {
        return;
      }

      // Frame-rate independent exponential damping + angular velocity cap
      const alphaDamp = 1 - Math.exp(-(this.gyro.dampingSpeed || 10.5) * dt);
      const maxStep = (this.gyro.maxAngularSpeed || 6.0) * dt;

      if (Math.abs(diffTheta) >= deadZone) {
        let stepTheta = diffTheta * alphaDamp;
        if (stepTheta > maxStep) stepTheta = maxStep;
        if (stepTheta < -maxStep) stepTheta = -maxStep;
        this.gyro.currentTheta += stepTheta;
      }

      if (Math.abs(diffPhi) >= deadZone) {
        let stepPhi = diffPhi * alphaDamp;
        if (stepPhi > maxStep) stepPhi = maxStep;
        if (stepPhi < -maxStep) stepPhi = -maxStep;
        this.gyro.currentPhi += stepPhi;
      }
      this.gyro.currentPhi = Math.max(this.gyro.minPhi, Math.min(this.gyro.maxPhi, this.gyro.currentPhi));

      const sinPhi = Math.sin(this.gyro.currentPhi);
      const cosPhi = Math.cos(this.gyro.currentPhi);
      const sinTheta = Math.sin(this.gyro.currentTheta);
      const cosTheta = Math.cos(this.gyro.currentTheta);

      const x = (target.x || 0) + r * sinPhi * sinTheta;
      const y = (target.y || 0) + r * cosPhi;
      const z = (target.z || 0) + r * sinPhi * cosTheta;

      if (typeof this.camera.position.set === 'function') {
        this.camera.position.set(x, y, z);
      } else {
        this.camera.position.x = x;
        this.camera.position.y = y;
        this.camera.position.z = z;
      }
      if (typeof this.camera.lookAt === 'function') {
        this.camera.lookAt(target);
      }

      let deg = Math.round((this.gyro.currentTheta * 180 / Math.PI) % 360);
      if (deg < 0) deg += 360;
      this.currentAngle = deg;
      if (this.options.onRotate) {
        this.options.onRotate(this.currentAngle);
      }
    }

    async enableGyro(opts = {}) {
      if (opts.sensitivity !== undefined) this.gyro.sensitivity = Math.max(0.2, Math.min(3.5, opts.sensitivity));
      if (opts.invertH !== undefined) this.gyro.invertH = !!opts.invertH;
      if (opts.invertV !== undefined) this.gyro.invertV = !!opts.invertV;

      const hasOriAPI = typeof window !== 'undefined' && typeof window.DeviceOrientationEvent !== 'undefined';
      const hasMotAPI = typeof window !== 'undefined' && typeof window.DeviceMotionEvent !== 'undefined';

      // 1. Hardware/Browser API availability check (must not fake active if missing)
      if (!hasOriAPI && !hasMotAPI) {
        this.gyro.isEnabled = false;
        this.gyro.isActive = false;
        this.gyro.isSupported = false;
        this.gyro.permissionState = 'unsupported';
        if (typeof this.options.onGyroStateChange === 'function') {
          this.options.onGyroStateChange('unsupported', {
            message: 'Your device does not support motion tracking.'
          });
        }
        return false;
      }

      // 2. iOS 13+ Safari explicit permission request (must execute synchronously from user gesture)
      if (hasOriAPI && typeof window.DeviceOrientationEvent.requestPermission === 'function') {
        try {
          const perm = await window.DeviceOrientationEvent.requestPermission();
          if (perm !== 'granted') {
            this.gyro.isEnabled = false;
            this.gyro.isActive = false;
            this.gyro.permissionState = 'denied';
            if (typeof this.options.onGyroStateChange === 'function') {
              this.options.onGyroStateChange('permission_denied', {
                message: 'Please allow motion sensor access.'
              });
            }
            return false;
          }
          if (hasMotAPI && typeof window.DeviceMotionEvent.requestPermission === 'function') {
            try { await window.DeviceMotionEvent.requestPermission(); } catch (_) {}
          }
          this.gyro.permissionState = 'granted';
        } catch (permErr) {
          this.gyro.isEnabled = false;
          this.gyro.isActive = false;
          this.gyro.permissionState = 'denied';
          if (typeof this.options.onGyroStateChange === 'function') {
            this.options.onGyroStateChange('permission_error', {
              message: 'Please allow motion sensor access.'
            });
          }
          return false;
        }
      } else if (hasMotAPI && typeof window.DeviceMotionEvent.requestPermission === 'function') {
        try {
          const perm = await window.DeviceMotionEvent.requestPermission();
          if (perm !== 'granted') {
            this.gyro.isEnabled = false;
            this.gyro.isActive = false;
            this.gyro.permissionState = 'denied';
            if (typeof this.options.onGyroStateChange === 'function') {
              this.options.onGyroStateChange('permission_denied', {
                message: 'Please allow motion sensor access.'
              });
            }
            return false;
          }
          this.gyro.permissionState = 'granted';
        } catch (permErr) {
          this.gyro.isEnabled = false;
          this.gyro.isActive = false;
          this.gyro.permissionState = 'denied';
          if (typeof this.options.onGyroStateChange === 'function') {
            this.options.onGyroStateChange('permission_error', {
              message: 'Please allow motion sensor access.'
            });
          }
          return false;
        }
      }

      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return false;
      }

      // Clear any previous timer or duplicate listeners before attaching
      if (this.gyro.sensorCheckTimer) {
        clearTimeout(this.gyro.sensorCheckTimer);
        this.gyro.sensorCheckTimer = null;
      }

      this.gyro.isEnabled = true;
      this.gyro.isActive = false; // Stay inactive until genuine numeric readings stream in
      this.gyro.isSupported = null;
      this.gyro.hasSensorReading = false;
      this.gyro.hasOrientationReading = false;
      this.gyro.lastMotionTs = null;
      this.gyro._lastFrameTime = null;
      this.gyro.lastQRaw = null;
      this.gyro.qFiltered = null;
      this.gyro.qPrev = null;
      this.gyro.needsCalibrateRef = true;
      this.gyro.needsSoftResync = false;

      if (!this.gyro._onDeviceOrientation) {
        this.gyro._onDeviceOrientation = (e) => this._onDeviceOrientation(e);
      }
      if (!this.gyro._onDeviceMotion) {
        this.gyro._onDeviceMotion = (e) => this._onDeviceMotion(e);
      }
      if (!this.gyro._onOrientationChange) {
        this.gyro._onOrientationChange = () => this._onOrientationChange();
      }

      window.removeEventListener('deviceorientation', this.gyro._onDeviceOrientation);
      window.removeEventListener('devicemotion', this.gyro._onDeviceMotion);
      window.removeEventListener('orientationchange', this.gyro._onOrientationChange);

      if (hasOriAPI) {
        window.addEventListener('deviceorientation', this.gyro._onDeviceOrientation, { passive: true });
      }
      if (hasMotAPI) {
        window.addEventListener('devicemotion', this.gyro._onDeviceMotion, { passive: true });
      }
      window.addEventListener('orientationchange', this.gyro._onOrientationChange);

      this.calibrateGyro({ silent: true });

      if (typeof this.options.onGyroStateChange === 'function') {
        this.options.onGyroStateChange('requesting', {
          message: 'Đang kết nối cảm biến chuyển động...'
        });
      }

      // Probe timeout: if no numeric sensor reading arrives, device lacks Gyro hardware -> auto-disable cleanly
      const timeoutMs = typeof opts.sensorTimeoutMs === 'number' ? opts.sensorTimeoutMs : 1200;
      this.gyro.sensorCheckTimer = setTimeout(() => {
        if (this.gyro.isEnabled && !this.gyro.hasSensorReading) {
          this.disableGyro({ silent: true });
          this.gyro.isSupported = false;
          this.gyro.permissionState = 'unsupported';
          if (typeof this.options.onGyroStateChange === 'function') {
            this.options.onGyroStateChange('unsupported', {
              message: 'Your device does not support motion tracking.'
            });
          }
        }
      }, timeoutMs);

      return true;
    }

    disableGyro(opts = {}) {
      this.gyro.isEnabled = false;
      this.gyro.isActive = false;
      this.gyro._lastFrameTime = null;
      if (this.gyro.sensorCheckTimer) {
        clearTimeout(this.gyro.sensorCheckTimer);
        this.gyro.sensorCheckTimer = null;
      }
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        if (this.gyro._onDeviceOrientation) {
          window.removeEventListener('deviceorientation', this.gyro._onDeviceOrientation);
        }
        if (this.gyro._onDeviceMotion) {
          window.removeEventListener('devicemotion', this.gyro._onDeviceMotion);
        }
        if (this.gyro._onOrientationChange) {
          window.removeEventListener('orientationchange', this.gyro._onOrientationChange);
        }
      }
      if (!opts.silent && typeof this.options.onGyroStateChange === 'function') {
        this.options.onGyroStateChange('disabled', {
          message: 'Manual Mode (Mouse / Touch)'
        });
      }
    }

    async toggleGyro(opts = {}) {
      if (this.gyro.isEnabled) {
        this.disableGyro();
        return false;
      } else {
        return await this.enableGyro(opts);
      }
    }

    setGyroSettings(settings = {}) {
      if (typeof settings.sensitivity === 'number') {
        this.gyro.sensitivity = Math.max(0.2, Math.min(3.5, settings.sensitivity));
      }
      if (typeof settings.invertH === 'boolean') {
        this.gyro.invertH = settings.invertH;
      }
      if (typeof settings.invertV === 'boolean') {
        this.gyro.invertV = settings.invertV;
      }
      // Re-anchor smoothly to current posture so toggling Invert or sliding Sensitivity never snaps camera
      if (this.gyro.isEnabled && this.gyro.hasSensorReading) {
        this.calibrateGyro({ silent: true });
      }
    }

    getGyroState() {
      return {
        isEnabled: this.gyro.isEnabled,
        isActive: this.gyro.isActive,
        isSupported: this.gyro.isSupported,
        permissionState: this.gyro.permissionState,
        sensitivity: this.gyro.sensitivity,
        invertH: this.gyro.invertH,
        invertV: this.gyro.invertV,
        hasSensorReading: this.gyro.hasSensorReading
      };
    }

    focusHotspot(hotspotId) {
      const h = this.hotspots.find(x => x.id === hotspotId);
      if (!h || !this.controls) return;

      const worldPos = h.pos.clone();
      const targetPos = worldPos.clone().add(new THREE.Vector3(1.2, 0.4, 1.2));

      // Smooth step towards target view
      this.camera.position.lerp(targetPos, 0.85);
      this.controls.target.lerp(worldPos, 0.85);
      this.controls.update();

      if (this.gyro && this.gyro.isEnabled) {
        this.calibrateGyro({ silent: true });
      }
    }

    resetView() {
      if (this.controls) {
        this.controls.reset();
        this.setRotationAngle(137);
      }
      if (this.gyro && this.gyro.isEnabled) {
        this.calibrateGyro({ silent: true });
      }
    }

    setScale(scaleRatio) {
      if (!this.carGroup) return;
      const s = Math.max(0.4, Math.min(2.0, scaleRatio || 1.0));
      this.carGroup.scale.set(s, s, s);
      if (this.shadowMesh) {
        this.shadowMesh.scale.set(s, s, 1);
      }
    }

    setShadowVisible(visible) {
      if (this.shadowMesh) {
        this.shadowMesh.visible = !!visible;
      }
    }

    setEnvExposure(enabled) {
      if (this.renderer) {
        this.renderer.toneMappingExposure = enabled ? 1.15 : 0.78;
      }
    }

    setVRStudioMode(active) {
      if (this.vrStudioGroup) {
        this.vrStudioGroup.visible = !!active;
      }
      if (!this.options.transparent && this.scene) {
        this.scene.background = new THREE.Color(active ? 0x050914 : 0x0B1120);
      }
    }

    async enterWebXR() {
      this.setVRStudioMode(true);
      if (navigator.xr && typeof navigator.xr.isSessionSupported === 'function') {
        try {
          const supported = await navigator.xr.isSessionSupported('immersive-vr');
          if (supported && this.renderer && this.renderer.xr) {
            const session = await navigator.xr.requestSession('immersive-vr', {
              optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']
            });
            await this.renderer.xr.setSession(session);
            return { mode: 'webxr-headset', active: true };
          }
        } catch (err) {
          console.warn('[Car3DViewer] WebXR session fallback to desktop VR studio:', err.message);
        }
      }
      return { mode: 'virtual-studio', active: true };
    }

    handleResize() {
      if (this.isDisposed || !this.container || !this.renderer || !this.camera) return;

      const parentEl = this.container.parentElement;
      const width = this.container.clientWidth || (parentEl && parentEl.clientWidth) || 0;
      const height = this.container.clientHeight || (parentEl && parentEl.clientHeight) || 0;

      if (width === 0 || height === 0) return;

      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();

      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }

    toggleMirror() {
      const current = this.isMirrored();
      this._isMirrored = !current;
      if (this.videoElement) {
        this.videoElement.style.transform = this._isMirrored ? 'scaleX(-1)' : 'none';
      }
      return this._isMirrored;
    }

    isMirrored() {
      if (this._isMirrored !== undefined) return this._isMirrored;
      return this.activeFacingMode === 'user';
    }

    animate(now) {
      if (this.isDisposed) return;
      this.animId = requestAnimationFrame(this.animate);

      this.updateKeyboardControls();

      // Gyroscope Camera Update (runs in same animation loop for optimal 60fps performance)
      this.updateGyroCamera(now);

      // Only let OrbitControls update camera when Gyro is inactive or user is actively dragging
      const gyroOwnsCamera = this.gyro && this.gyro.isEnabled && this.gyro.isActive && !this.gyro.isUserInteracting && !this.isDragging;
      if (this.controls && !gyroOwnsCamera) {
        this.controls.update();
      }

      this.updateHotspots();

      // In Camera AR mode, ensure camera video element continues playing in background with transparent WebGL canvas
      if (this.isCameraActive && this.videoElement) {
        if (this.videoElement.paused) {
          this.videoElement.play().catch(() => {});
        }
        if (this.scene && this.scene.background !== null) {
          this.scene.background = null;
        }
        if (this.renderer) {
          this.renderer.setClearColor(0x000000, 0);
        }
      } else if (this.options.arMode || this.options.transparent) {
        if (this.scene && this.scene.background !== null) {
          this.scene.background = null;
        }
        if (this.renderer) {
          this.renderer.setClearColor(0x000000, 0);
        }
      }

      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
      this._drawCameraLayers();
    }

    // Draw webcam frame into a 2D canvas under the WebGL canvas (avoids black <video> compositing bug)
    // and keep a fresh composite (camera + 3D car) snapshot for photo capture.
    _drawCameraLayers() {
      if (!this.isCameraActive || !this.videoElement || typeof document === 'undefined') return;
      const v = this.videoElement;
      if (!(v.videoWidth > 0 && v.videoHeight > 0) || v.readyState < 2) return;
      const gl = this.renderer && this.renderer.domElement;
      if (!gl || !gl.width || !gl.height) return;
      try {
        if (!this.bgCanvas) {
          const c = document.createElement('canvas');
          if (!c || typeof c.getContext !== 'function') return;
          c.id = 'ar-camera-bg-canvas';
          c.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;pointer-events:none;background:transparent;';
          const glEl = this.renderer && this.renderer.domElement;
          if (glEl && glEl.parentNode === this.container && typeof this.container.insertBefore === 'function') {
            this.container.insertBefore(c, glEl); // must sit UNDER the WebGL canvas
          } else {
            this.container.appendChild(c);
          }
          this.bgCanvas = c;
          this.bgCtx = c.getContext('2d');
          this.snapCanvas = document.createElement('canvas');
          this.snapCtx = this.snapCanvas.getContext('2d');
        }
        const w = gl.width, h = gl.height;
        if (this.bgCanvas.width !== w) this.bgCanvas.width = w;
        if (this.bgCanvas.height !== h) this.bgCanvas.height = h;
        if (this.snapCanvas.width !== w) this.snapCanvas.width = w;
        if (this.snapCanvas.height !== h) this.snapCanvas.height = h;

        const vRatio = v.videoWidth / v.videoHeight, cRatio = w / h;
        let sw, sh, sx, sy;
        if (vRatio > cRatio) { sh = v.videoHeight; sw = sh * cRatio; sx = (v.videoWidth - sw) / 2; sy = 0; }
        else { sw = v.videoWidth; sh = sw / cRatio; sx = 0; sy = (v.videoHeight - sh) / 2; }

        const ctx = this.bgCtx;
        ctx.save();
        if (this.isMirrored()) { ctx.translate(w, 0); ctx.scale(-1, 1); }
        ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
        ctx.restore();

        // Snapshot: camera + 3D car, taken right after the WebGL render in the same frame
        const sctx = this.snapCtx;
        sctx.clearRect(0, 0, w, h);
        sctx.drawImage(this.bgCanvas, 0, 0, w, h);
        sctx.drawImage(gl, 0, 0, w, h);
        this.hasSnapshot = true;
      } catch (e) {
        console.warn('[Car3DViewer] camera layer draw error:', e);
      }
    }

    setColor(hexColor) {
      this.setBodyColor(hexColor);
    }

    setTransparentMode(active) {
      if (!this.scene || !this.renderer) return;
      if (active) {
        this.scene.background = null;
        this.scene.fog = null;
        this.renderer.setClearColor(0x000000, 0);
        if (this.floorMesh) this.floorMesh.visible = false;
        if (this.ringMesh) this.ringMesh.visible = false;
        if (this.shadowMesh) this.shadowMesh.visible = true;
        if (this.renderer.domElement) this.renderer.domElement.style.background = 'transparent';
        if (this.videoElement) {
          this.videoElement.style.display = 'block';
          this.videoElement.style.opacity = '1';
          this.videoElement.style.visibility = 'visible';
        }
      } else {
        this.scene.background = new THREE.Color(0x0B1120);
        this.scene.fog = new THREE.FogExp2(0x0B1120, 0.035);
        this.renderer.setClearColor(0x0B1120, 1);
        if (this.floorMesh) this.floorMesh.visible = true;
        if (this.ringMesh) this.ringMesh.visible = true;
        if (this.videoElement) {
          this.videoElement.style.display = 'none';
        }
      }
    }

    async _acquireCameraStream(options = {}) {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        const err = new Error('navigator.mediaDevices.getUserMedia not supported');
        err.name = 'TypeError';
        throw err;
      }

      const isSecure = Boolean(
        typeof window !== 'undefined' &&
        (window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'https:')
      );
      if (!isSecure) {
        const err = new Error('Camera access requires HTTPS or localhost');
        err.name = 'InsecureContextError';
        throw err;
      }

      const VIRTUAL_CAM_REGEX = /virtual|obs|droidcam|camo|manycam|splitcam|snap\s*cam|vcam|vmix|iriun|epoccam|ndi|hello\s*face|ir\s*camera|software\s*device/i;
      const PHYSICAL_CAM_REGEX = /integrated|webcam|camera|facetime|hd|chicony|sunplus|realtek|logitech|usb/i;

      const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      let requestedDeviceId = options.deviceId || (options.facingMode ? null : this.activeDeviceId);
      // On desktop/laptop, never force 'environment' facing mode as it skips front webcams and falls back to virtual devices
      const requestedFacing = options.facingMode || (!requestedDeviceId && isMobile ? (this.activeFacingMode || 'environment') : undefined);

      // Auto-prioritize physical camera over virtual cameras if labels are already unmasked
      if (!requestedDeviceId && !options.facingMode && typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        try {
          const devs = await navigator.mediaDevices.enumerateDevices();
          const cams = devs.filter(d => d.kind === 'videoinput');
          const physicalCams = cams.filter(c => c.label && !VIRTUAL_CAM_REGEX.test(c.label));
          if (physicalCams.length > 0) {
            const best = physicalCams.find(c => PHYSICAL_CAM_REGEX.test(c.label)) || physicalCams[0];
            if (best && best.deviceId) {
              requestedDeviceId = best.deviceId;
            }
          }
        } catch (e) {}
      }

      const profiles = [];
      if (requestedDeviceId) {
        profiles.push({
          label: 'Specific Device with Ideal 1080p',
          constraints: {
            video: {
              deviceId: { ideal: requestedDeviceId },
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            },
            audio: false
          }
        });
        profiles.push({
          label: 'Specific Device fallback',
          constraints: {
            video: { deviceId: { exact: requestedDeviceId } },
            audio: false
          }
        });
      }

      if (requestedFacing) {
        profiles.push({
          label: 'Facing Camera 1080p',
          constraints: {
            video: {
              facingMode: { ideal: requestedFacing },
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            },
            audio: false
          }
        });
        profiles.push({
          label: 'Facing Camera 720p',
          constraints: {
            video: {
              facingMode: { ideal: requestedFacing },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            audio: false
          }
        });
        profiles.push({
          label: 'Facing Camera Basic',
          constraints: {
            video: { facingMode: { ideal: requestedFacing } },
            audio: false
          }
        });
      }

      // Generic desktop / universal profiles (Crucial for desktop webcams!)
      if (!isMobile) {
        profiles.push({
          label: 'Desktop User-facing 720p',
          constraints: {
            video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
          }
        });
      }
      profiles.push({
        label: 'Generic Camera 1080p',
        constraints: {
          video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false
        }
      });
      profiles.push({
        label: 'Generic Camera 720p',
        constraints: {
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        }
      });
      profiles.push({
        label: 'Minimal Video Stream { video: true }',
        constraints: {
          video: true,
          audio: false
        }
      });

      let stream = null;
      let lastError = null;
      for (const p of profiles) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(p.constraints);
          if (stream && stream.active) {
            console.log(`[Car3DViewer/AR] Successfully initialized camera with profile: "${p.label}"`);
            break;
          }
        } catch (err) {
          lastError = err;
          if (['NotAllowedError', 'PermissionDeniedError', 'NotFoundError', 'DevicesNotFoundError', 'SecurityError'].includes(err.name)) {
            break;
          }
        }
      }

      if (!stream || !stream.active) {
        throw lastError || new Error('All camera profiles failed');
      }

      // Post-acquisition inspection:
      // Now that camera permission is granted, device labels are unmasked.
      // If the current stream is a virtual camera (e.g. OBS Virtual Camera, DroidCam) and a physical webcam exists,
      // auto-switch immediately to the physical webcam so the laptop hardware camera LED turns on and real video shows.
      let tracks = stream.getVideoTracks();
      const currentTrackLabel = (tracks[0] && tracks[0].label) ? tracks[0].label : '';
      const isCurrentVirtual = VIRTUAL_CAM_REGEX.test(currentTrackLabel);

      if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        try {
          const postDevs = await navigator.mediaDevices.enumerateDevices();
          const videoDevs = postDevs.filter(d => d.kind === 'videoinput');

          if (typeof this.options.onDevicesUpdated === 'function') {
            this.options.onDevicesUpdated(videoDevs);
          }

          const physicalCams = videoDevs.filter(d => d.label && !VIRTUAL_CAM_REGEX.test(d.label));
          if ((isCurrentVirtual || !options.deviceId) && physicalCams.length > 0) {
            const bestPhysical = physicalCams.find(c => PHYSICAL_CAM_REGEX.test(c.label)) || physicalCams[0];
            const isAlreadyOnPhysical = tracks[0] && tracks[0].label === bestPhysical.label;
            if (!isAlreadyOnPhysical && isCurrentVirtual) {
              console.warn(`[Car3DViewer/AR] Active stream "${currentTrackLabel}" is virtual. Auto-switching to physical webcam: "${bestPhysical.label}"`);
              stream.getTracks().forEach(t => {
                try { t.stop(); } catch (e) {}
              });

              try {
                stream = await navigator.mediaDevices.getUserMedia({
                  video: {
                    deviceId: { exact: bestPhysical.deviceId },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                  },
                  audio: false
                });
              } catch (fallbackErr) {
                stream = await navigator.mediaDevices.getUserMedia({
                  video: {
                    deviceId: { ideal: bestPhysical.deviceId }
                  },
                  audio: false
                });
              }
              requestedDeviceId = bestPhysical.deviceId;
            }
          }
        } catch (postErr) {
          console.warn('[Car3DViewer/AR] Post-acquisition physical camera check notice:', postErr);
        }
      }

      tracks = stream.getVideoTracks();
      if (tracks.length > 0 && typeof tracks[0].getSettings === 'function') {
        const settings = tracks[0].getSettings();
        this.activeDeviceId = settings.deviceId || requestedDeviceId || this.activeDeviceId;
        this.activeFacingMode = settings.facingMode || requestedFacing || this.activeFacingMode;
      } else if (requestedDeviceId) {
        this.activeDeviceId = requestedDeviceId;
      }

      return stream;
    }

    _handleCameraError(err) {
      this.lastCameraError = err;
      let state = 'camera_unavailable';
      let title = 'Không thể mở Camera';
      let message = err.message || 'Lỗi thiết bị camera.';

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        state = 'permission_denied';
        title = 'Quyền Camera bị từ chối';
        message = 'Trình duyệt đang chặn quyền Camera. Vui lòng cấp quyền trong cài đặt trình duyệt để tiếp tục.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        state = 'camera_unavailable';
        title = 'Không tìm thấy Camera';
        message = 'Không tìm thấy thiết bị máy ảnh nào kết nối với máy.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        state = 'camera_in_use';
        title = 'Camera đang bận';
        message = 'Camera đang bị ứng dụng khác chiếm dụng hoặc bị khóa bởi hệ điều hành.';
      } else if (err.name === 'OverconstrainedError') {
        state = 'overconstrained';
        title = 'Cấu hình không tương thích';
        message = 'Camera không đáp ứng độ phân giải hoặc chế độ yêu cầu.';
      } else if (err.name === 'InsecureContextError') {
        state = 'insecure_context';
        title = 'Yêu cầu kết nối HTTPS';
        message = 'WebRTC Camera yêu cầu kết nối bảo mật HTTPS hoặc localhost.';
      } else if (err.name === 'SecurityError') {
        state = 'security_error';
        title = 'Lỗi bảo mật (SecurityError)';
        message = 'Quyền truy cập Camera bị chặn bởi chính sách bảo mật trang web.';
      } else if (err.name === 'TypeError') {
        state = 'type_error';
        title = 'Lỗi khởi tạo Camera';
        message = 'API MediaDevices không khả dụng trên trình duyệt hiện tại.';
      }

      if (typeof this.options.onCameraStateChange === 'function') {
        this.options.onCameraStateChange(state, {
          title,
          message,
          code: err.name,
          error: err
        });
      }
    }

    async startCamera(options = {}) {
      if (this.isDisposed) return;

      if (typeof this.options.onCameraStateChange === 'function') {
        this.options.onCameraStateChange('requesting', { message: 'Đang xin quyền truy cập Camera...' });
      }

      try {
        // Reuse existing live stream if active (NO duplicate streams!)
        if (!this.mediaStream || !this.mediaStream.active || !this.mediaStream.getVideoTracks().some(t => t.readyState === 'live')) {
          this.mediaStream = await this._acquireCameraStream(options);
        }

        if (!this.videoElement) {
          throw new Error('Video element not available in ViewerInstance container');
        }

        // 1. Configure video element before attaching stream for reliable autoplay across Chrome, Safari, Android & Windows
        this.videoElement.defaultMuted = true;
        this.videoElement.muted = true;
        this.videoElement.playsInline = true;
        this.videoElement.autoplay = true;
        this.videoElement.setAttribute('muted', '');
        this.videoElement.setAttribute('autoplay', '');
        this.videoElement.setAttribute('playsinline', '');
        this.videoElement.setAttribute('webkit-playsinline', '');
        this.videoElement.style.display = 'block';
        this.videoElement.style.opacity = '1';
        this.videoElement.style.visibility = 'visible';
        this.videoElement.style.zIndex = '1';
        this.videoElement.style.position = 'absolute';
        this.videoElement.style.top = '0';
        this.videoElement.style.left = '0';
        this.videoElement.style.width = '100%';
        this.videoElement.style.height = '100%';
        this.videoElement.style.objectFit = 'cover';

        // Mirror front camera (selfie) for natural interaction, normal for rear/desktop
        const isUserFacing = this.activeFacingMode === 'user';
        if (this._isMirrored === undefined) {
          this._isMirrored = isUserFacing;
        }
        this.videoElement.style.transform = this._isMirrored ? 'scaleX(-1)' : 'none';

        // 2. Attach media stream & ensure video tracks are active
        this.videoElement.srcObject = this.mediaStream;
        const vTracks = this.mediaStream.getVideoTracks();
        if (vTracks.length > 0) {
          vTracks[0].enabled = true;
        }

        // 3. Play stream immediately and reliably with dual metadata / canplay handling
        const safePlay = () => {
          if (!this.videoElement) return;
          try {
            const p = this.videoElement.play();
            if (p && typeof p.then === 'function') {
              p.catch(() => {});
            }
          } catch (e) {}
        };

        this.videoElement.onloadedmetadata = safePlay;
        this.videoElement.oncanplay = safePlay;
        this.videoElement.onloadeddata = safePlay;

        try {
          const playRes = this.videoElement.play();
          if (playRes !== undefined) {
            await playRes;
          }
        } catch (playErr) {
          console.warn('[Car3DViewer] Video autoplay awaiting user gesture:', playErr);
        }

        // Global gesture listener ensures video plays on the very first tap/click anywhere
        const unlockGesture = () => {
          safePlay();
        };
        if (typeof window !== 'undefined') {
          ['click', 'touchstart', 'pointerdown', 'keydown'].forEach(evt => {
            window.addEventListener(evt, unlockGesture, { passive: true });
          });
        }
        if (this.renderer && this.renderer.domElement) {
          ['click', 'touchstart', 'pointerdown'].forEach(evt => {
            this.renderer.domElement.addEventListener(evt, unlockGesture, { passive: true });
          });
        }

        // Enable transparent Three.js WebGL canvas above video!
        this.setTransparentMode(true);
        this.isCameraActive = true;
        this.currentMode = 'ar_camera';
        this.lastCameraError = null;

        // Apply camera-active classes with solid black background behind video (NEVER transparent white!)
        if (this.container && this.container.classList) {
          this.container.classList.add('camera-active');
          if (this.container.parentElement && this.container.parentElement.classList) {
            this.container.parentElement.classList.add('camera-active');
          }
        }
        if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
          const liveStage = document.getElementById('ar-live-stage');
          if (liveStage) {
            liveStage.classList.add('camera-active');
            liveStage.style.background = '#000000';
          }
          const vrStage = document.getElementById('vr-car-viewport');
          if (vrStage) {
            vrStage.classList.add('camera-active');
            vrStage.style.background = '#000000';
          }
          const backdrop = document.getElementById('ar-camera-backdrop');
          if (backdrop && backdrop.style) backdrop.style.display = 'none';
        }

        if (typeof this.options.onCameraStateChange === 'function') {
          this.options.onCameraStateChange('active', {
            message: 'Camera thực tế đang hoạt động',
            stream: this.mediaStream,
            deviceId: this.activeDeviceId,
            facingMode: this.activeFacingMode
          });
        }

        return this.mediaStream;
      } catch (err) {
        this._handleCameraError(err);
        throw err;
      }
    }

    stopCamera() {
      if (this.bgCanvas && this.bgCanvas.parentNode && typeof this.bgCanvas.parentNode.removeChild === 'function') {
        try { this.bgCanvas.parentNode.removeChild(this.bgCanvas); } catch (e) {}
      }
      this.bgCanvas = null; this.bgCtx = null; this.snapCanvas = null; this.snapCtx = null; this.hasSnapshot = false;
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => {
          try { track.stop(); } catch (e) {}
        });
        this.mediaStream = null;
      }
      if (this.videoTexture) {
        try { this.videoTexture.dispose(); } catch (e) {}
        this.videoTexture = null;
      }
      if (this.videoElement) {
        this.videoElement.srcObject = null;
        this.videoElement.style.display = 'none';
      }
      this.isCameraActive = false;
      this.currentMode = 'studio';

      // Restore studio background
      if (this.scene) {
        this.scene.background = new THREE.Color(0x0B1120);
      }
      if (this.renderer) {
        this.renderer.setClearColor(0x0B1120, 1);
      }

      // Restore container backgrounds to studio dark
      if (this.container && this.container.classList) {
        this.container.classList.remove('camera-active');
        if (this.container.parentElement && this.container.parentElement.classList) {
          this.container.parentElement.classList.remove('camera-active');
        }
      }
      if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
        const liveStage = document.getElementById('ar-live-stage');
        if (liveStage) {
          liveStage.classList.remove('camera-active');
          liveStage.style.background = '#0B1120';
        }
        const vrStage = document.getElementById('vr-car-viewport');
        if (vrStage) {
          vrStage.classList.remove('camera-active');
          vrStage.style.background = '#0B1120';
        }
        const backdrop = document.getElementById('ar-camera-backdrop');
        if (backdrop && backdrop.style) backdrop.style.display = 'block';
      }

      // Restore studio if not fixed AR mode
      if (!this.options.arMode) {
        this.setTransparentMode(false);
      }

      if (typeof this.options.onCameraStateChange === 'function') {
        this.options.onCameraStateChange('stopped', { message: 'Camera đã tắt' });
      }
    }

    async setMode(mode) {
      if (mode === 'ar_camera' || mode === 'ar' || mode === 'mode_b') {
        this.currentMode = 'ar_camera';
        return await this.startCamera();
      } else {
        this.currentMode = 'studio';
        this.stopCamera();
        this.setTransparentMode(false);
        return Promise.resolve();
      }
    }

    async checkWebXRSupport() {
      if (typeof navigator !== 'undefined' && navigator.xr && typeof navigator.xr.isSessionSupported === 'function') {
        try {
          const arSupported = await navigator.xr.isSessionSupported('immersive-ar');
          return { supported: !!arSupported, type: 'immersive-ar' };
        } catch (e) {
          return { supported: false, error: e.message };
        }
      }
      return { supported: false, reason: 'WebXR not available' };
    }

    async toggleCamera() {
      if (this.isCameraActive) {
        this.stopCamera();
      } else {
        await this.startCamera();
      }
    }

    async switchCamera(targetDeviceIdOrFacing) {
      this.stopCamera();
      // Allow OS camera driver to cleanly release hardware resources
      await new Promise(r => setTimeout(r, 200));

      const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const availableCameras = await this.getAvailableCameras();

      if (targetDeviceIdOrFacing && targetDeviceIdOrFacing !== 'user' && targetDeviceIdOrFacing !== 'environment') {
        this.activeDeviceId = targetDeviceIdOrFacing;
      } else if (targetDeviceIdOrFacing === 'user' || targetDeviceIdOrFacing === 'environment') {
        if (isMobile) {
          this.activeFacingMode = targetDeviceIdOrFacing;
          this.activeDeviceId = null;
        } else {
          // On desktop, user asked to flip or cycle: move to next camera in list
          if (availableCameras.length > 1) {
            const currentIdx = availableCameras.findIndex(d => d.deviceId === this.activeDeviceId);
            const nextIdx = (currentIdx + 1) % availableCameras.length;
            this.activeDeviceId = availableCameras[nextIdx].deviceId;
          }
        }
      } else if (availableCameras.length > 1) {
        // Multi-camera cycling: find current index and pick next device
        const currentIdx = availableCameras.findIndex(d => d.deviceId === this.activeDeviceId);
        const nextIdx = (currentIdx + 1) % availableCameras.length;
        this.activeDeviceId = availableCameras[nextIdx].deviceId;
      } else if (isMobile) {
        // Toggle facing mode if single camera or unspecified
        this.activeFacingMode = this.activeFacingMode === 'user' ? 'environment' : 'user';
        this.activeDeviceId = null;
      }

      return await this.startCamera({
        deviceId: this.activeDeviceId,
        facingMode: isMobile ? this.activeFacingMode : undefined
      });
    }

    async getAvailableCameras() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return [];
      }
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter(d => d.kind === 'videoinput');
        const VIRTUAL_CAM_REGEX = /virtual|obs|droidcam|camo|manycam|splitcam|snap\s*cam|vcam|vmix|iriun|epoccam|ndi|hello\s*face|ir\s*camera|software\s*device/i;
        const PHYSICAL_CAM_REGEX = /integrated|webcam|camera|facetime|hd|chicony|sunplus|realtek|logitech|usb/i;

        return cams.sort((a, b) => {
          const aVirt = VIRTUAL_CAM_REGEX.test(a.label);
          const bVirt = VIRTUAL_CAM_REGEX.test(b.label);
          if (!aVirt && bVirt) return -1;
          if (aVirt && !bVirt) return 1;

          const aPhys = PHYSICAL_CAM_REGEX.test(a.label);
          const bPhys = PHYSICAL_CAM_REGEX.test(b.label);
          if (aPhys && !bPhys) return -1;
          if (!aPhys && bPhys) return 1;

          return 0;
        });
      } catch (e) {
        return [];
      }
    }

    async getDiagnostics() {
      const isSecure = Boolean(
        typeof window !== 'undefined' &&
        (window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'https:')
      );
      const hasMediaDevices = Boolean(typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
      let permState = 'unknown';
      if (typeof navigator !== 'undefined' && navigator.permissions && navigator.permissions.query) {
        try {
          const res = await navigator.permissions.query({ name: 'camera' });
          permState = res.state;
        } catch (e) {}
      }
      const cameras = await this.getAvailableCameras();

      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown';
      let browserName = 'Unknown Browser';
      if (/Edg\//i.test(ua)) browserName = 'Microsoft Edge';
      else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browserName = 'Google Chrome';
      else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browserName = 'Apple Safari';
      else if (/Firefox\//i.test(ua)) browserName = 'Mozilla Firefox';

      const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(ua);
      const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(ua);
      const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(ua);

      const v = this.videoElement;
      const tracks = this.mediaStream ? this.mediaStream.getVideoTracks() : [];
      const activeTrack = tracks.length > 0 ? tracks[0] : null;

      return {
        browser: browserName,
        platform: isMobile ? (isIOS ? 'iOS Mobile' : (isAndroid ? 'Android Mobile' : 'Mobile')) : 'Desktop',
        protocol: typeof location !== 'undefined' ? location.protocol : 'unknown',
        hostname: typeof location !== 'undefined' ? location.hostname : 'unknown',
        isSecureContext: isSecure,
        hasMediaDevices: hasMediaDevices,
        permissionState: permState,
        cameraCount: cameras.length,
        cameras: cameras.map((c, i) => ({ id: c.deviceId, label: c.label || `Camera ${i + 1}` })),
        activeCamera: this.activeDeviceId || 'Default',
        activeCameraLabel: (activeTrack && activeTrack.label) ? activeTrack.label : (this.activeDeviceId || 'Camera mặc định'),
        activeFacingMode: this.activeFacingMode,
        cameraState: this.isCameraActive ? 'active' : 'idle',
        isCameraActive: this.isCameraActive,
        videoWidth: (v && v.videoWidth) || 0,
        videoHeight: (v && v.videoHeight) || 0,
        videoReadyState: (v && v.readyState) || 0,
        videoPaused: v ? v.paused : true,
        textureActive: !!this.videoTexture,
        isMirrored: this.isMirrored(),
        lastError: this.lastCameraError ? { name: this.lastCameraError.name, message: this.lastCameraError.message } : null
      };
    }

    captureCompositePhoto(filename = 'sigmacar-ar.jpg') {
      const canvas = document.createElement('canvas');
      const w = (this.renderer && this.renderer.domElement) ? this.renderer.domElement.width : 1280;
      const h = (this.renderer && this.renderer.domElement) ? this.renderer.domElement.height : 720;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      // 1. Draw live camera frame first if active
      if (this.isCameraActive && this.videoElement && this.videoElement.videoWidth > 0) {
        const v = this.videoElement;
        const vRatio = v.videoWidth / v.videoHeight;
        const cRatio = w / h;
        let sWidth, sHeight, sx, sy;
        if (vRatio > cRatio) {
          sHeight = v.videoHeight;
          sWidth = sHeight * cRatio;
          sx = (v.videoWidth - sWidth) / 2;
          sy = 0;
        } else {
          sWidth = v.videoWidth;
          sHeight = sWidth / cRatio;
          sx = 0;
          sy = (v.videoHeight - sHeight) / 2;
        }

        ctx.save();
        if (this.isMirrored()) {
          ctx.translate(w, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(v, sx, sy, sWidth, sHeight, 0, 0, w, h);
        ctx.restore();
      } else {
        ctx.fillStyle = '#0B1120';
        ctx.fillRect(0, 0, w, h);
      }

      // 2. Make sure 3D scene is rendered freshly with alpha=0 and transparent background
      if (this.renderer && this.scene && this.camera) {
        if (this.scene.background !== null) {
          this.scene.background = null;
        }
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.render(this.scene, this.camera);
      }

      // 3. Draw Three.js WebGL model layer directly over the camera frame
      if (this.renderer && this.renderer.domElement) {
        ctx.drawImage(this.renderer.domElement, 0, 0, w, h);
      }

      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      if (typeof document !== 'undefined') {
        const a = document.createElement('a');
        a.download = filename;
        a.href = dataUrl;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      return dataUrl;
    }

    dispose() {
      this.isDisposed = true;
      if (this.animId) {
        cancelAnimationFrame(this.animId);
        this.animId = null;
      }

      // Clean up Gyroscope listeners & timers
      this.disableGyro();

      // Stop camera stream & release tracks
      this.stopCamera();
      if (this._deviceChangeHandler && typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.removeEventListener === 'function') {
        navigator.mediaDevices.removeEventListener('devicechange', this._deviceChangeHandler);
        this._deviceChangeHandler = null;
      }

      window.removeEventListener('resize', this.onWindowResize);
      if (this.onKeyDown) window.removeEventListener('keydown', this.onKeyDown);
      if (this.onKeyUp) window.removeEventListener('keyup', this.onKeyUp);

      if (this.controls) {
        this.controls.dispose();
      }

      if (this.pmremGenerator) {
        this.pmremGenerator.dispose();
      }

      // Traverse scene and dispose geometries, materials, textures
      if (this.scene) {
        this.scene.traverse((obj) => {
          if (obj.geometry && typeof obj.geometry.dispose === 'function') obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach(m => {
                if (m && typeof m.dispose === 'function') m.dispose();
              });
            } else if (typeof obj.material.dispose === 'function') {
              obj.material.dispose();
            }
          }
        });
      }

      if (this.renderer) {
        this.renderer.dispose();
        if (this.renderer.domElement && this.renderer.domElement.parentNode && typeof this.renderer.domElement.parentNode.removeChild === 'function') {
          this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
      }

      if (this.hotspotsOverlay && this.hotspotsOverlay.parentNode && typeof this.hotspotsOverlay.parentNode.removeChild === 'function') {
        this.hotspotsOverlay.parentNode.removeChild(this.hotspotsOverlay);
      }

      this.container.innerHTML = '';
    }
  }

  return {
    init: function (container, options) {
      return new ViewerInstance(container, options);
    },
    isSupported: isWebGLAvailable
  };
});
