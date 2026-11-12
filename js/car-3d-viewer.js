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
          this.container.style.cursor = 'grabbing';
        });

        this.controls.addEventListener('end', () => {
          this.isDragging = false;
          this.container.style.cursor = 'grab';
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

      const target = this.controls.target;
      const radius = this.controls.getDistance() || 5.5;
      const polar = this.controls.getPolarAngle() || (Math.PI / 2.8);

      const x = target.x + radius * Math.sin(polar) * Math.sin(rad);
      const z = target.z + radius * Math.sin(polar) * Math.cos(rad);
      const y = target.y + radius * Math.cos(polar);

      this.camera.position.set(x, y, z);
      this.camera.lookAt(target);
      this.controls.update();

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

    focusHotspot(hotspotId) {
      const h = this.hotspots.find(x => x.id === hotspotId);
      if (!h || !this.controls) return;

      const worldPos = h.pos.clone();
      const targetPos = worldPos.clone().add(new THREE.Vector3(1.2, 0.4, 1.2));

      // Smooth step towards target view
      this.camera.position.lerp(targetPos, 0.85);
      this.controls.target.lerp(worldPos, 0.85);
      this.controls.update();
    }

    resetView() {
      if (this.controls) {
        this.controls.reset();
        this.setRotationAngle(137);
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

    animate() {
      if (this.isDisposed) return;
      this.animId = requestAnimationFrame(this.animate);

      this.updateKeyboardControls();

      if (this.controls) {
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

      // Make sure 3D scene is rendered freshly to WebGL canvas buffer before snapshot with transparent background
      if (this.renderer && this.scene && this.camera) {
        if (this.scene.background !== null) {
          this.scene.background = null;
        }
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.render(this.scene, this.camera);
      }

      // 1. Draw live camera frame if active
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

      // 2. Draw Three.js WebGL model layer directly over the camera frame
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
