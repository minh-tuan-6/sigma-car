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

  // Fallback Procedural 3D Sports EV Model in case GLB is unavailable
  function createProceduralCar(initialColor) {
    const carGroup = new THREE.Group();
    carGroup.name = 'ProceduralCarGroup';

    const pbrPaint = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(initialColor || '#0284C7'),
      metalness: 0.85,
      roughness: 0.35,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04
    });

    const darkTrim = new THREE.MeshStandardMaterial({
      color: 0x18181B,
      roughness: 0.65,
      metalness: 0.2
    });

    const chromeTrim = new THREE.MeshStandardMaterial({
      color: 0xE2E8F0,
      roughness: 0.15,
      metalness: 0.95
    });

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x111827,
      metalness: 0.1,
      roughness: 0.05,
      transmission: 0.85,
      transparent: true,
      opacity: 0.75
    });

    const ledGlow = new THREE.MeshStandardMaterial({
      color: 0xE0F2FE,
      emissive: 0x38BDF8,
      emissiveIntensity: 1.5,
      roughness: 0.2
    });

    const redLedGlow = new THREE.MeshStandardMaterial({
      color: 0xEF4444,
      emissive: 0xDC2626,
      emissiveIntensity: 1.8,
      roughness: 0.2
    });

    // 1. Lower Chassis
    const chassisGeo = new THREE.BoxGeometry(4.3, 0.45, 1.85);
    const chassis = new THREE.Mesh(chassisGeo, pbrPaint);
    chassis.position.y = 0.5;
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    carGroup.add(chassis);

    // 2. Cabin / Greenhouse
    const cabinGeo = new THREE.BoxGeometry(2.3, 0.55, 1.55);
    const cabin = new THREE.Mesh(cabinGeo, glassMat);
    cabin.position.set(-0.2, 0.95, 0);
    cabin.castShadow = true;
    carGroup.add(cabin);

    // 3. Roof Panel
    const roofGeo = new THREE.BoxGeometry(2.1, 0.08, 1.48);
    const roof = new THREE.Mesh(roofGeo, pbrPaint);
    roof.position.set(-0.2, 1.25, 0);
    roof.castShadow = true;
    carGroup.add(roof);

    // 4. Front Hood Slope
    const hoodGeo = new THREE.BoxGeometry(1.2, 0.25, 1.8);
    const hood = new THREE.Mesh(hoodGeo, pbrPaint);
    hood.position.set(1.4, 0.65, 0);
    hood.rotation.z = -0.12;
    hood.castShadow = true;
    carGroup.add(hood);

    // 5. Headlights
    const hlGeo = new THREE.BoxGeometry(0.12, 0.1, 0.45);
    const hlLeft = new THREE.Mesh(hlGeo, ledGlow);
    hlLeft.position.set(2.15, 0.56, 0.65);
    const hlRight = new THREE.Mesh(hlGeo, ledGlow);
    hlRight.position.set(2.15, 0.56, -0.65);
    carGroup.add(hlLeft, hlRight);

    // 6. Rear Light Bar
    const tlGeo = new THREE.BoxGeometry(0.08, 0.08, 1.7);
    const tlBar = new THREE.Mesh(tlGeo, redLedGlow);
    tlBar.position.set(-2.15, 0.65, 0);
    carGroup.add(tlBar);

    // 7. Wheels & Brake Calipers
    const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.28, 28);
    wheelGeo.rotateX(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x18181B, roughness: 0.9, metalness: 0.05 });

    const wheelPositions = [
      [1.35, 0.38, 0.94],
      [1.35, 0.38, -0.94],
      [-1.35, 0.38, 0.94],
      [-1.35, 0.38, -0.94]
    ];

    wheelPositions.forEach((pos, idx) => {
      const wheelHub = new THREE.Group();
      wheelHub.position.set(...pos);

      const tire = new THREE.Mesh(wheelGeo, tireMat);
      tire.castShadow = true;
      wheelHub.add(tire);

      const rimGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.29, 16);
      rimGeo.rotateX(Math.PI / 2);
      const rim = new THREE.Mesh(rimGeo, chromeTrim);
      rim.name = `rim_${idx}`;
      wheelHub.add(rim);

      const brakeGeo = new THREE.BoxGeometry(0.15, 0.12, 0.08);
      const brakeMat = new THREE.MeshStandardMaterial({ color: 0xEF4444, roughness: 0.3, metalness: 0.5 });
      const brake = new THREE.Mesh(brakeGeo, brakeMat);
      brake.position.set(0.08, 0.12, 0);
      wheelHub.add(brake);

      carGroup.add(wheelHub);
    });

    // Tag body parts for dynamic updates
    carGroup.userData.bodyMaterial = pbrPaint;
    carGroup.userData.rimMaterial = chromeTrim;

    return carGroup;
  }

  // Main 3D Viewer Class
  class ViewerInstance {
    constructor(container, options = {}) {
      this.container = container;
      this.options = {
        modelUrl: 'assets/models/sigma-car-3d.glb',
        initialColor: '#0284C7',
        initialAngle: 137,
        hotspots: [],
        onRotate: null,
        onHotspotClick: null,
        onProgress: null,
        onReady: null,
        onError: null,
        ...options
      };

      this.scene = null;
      this.camera = null;
      this.renderer = null;
      this.controls = null;
      this.pmremGenerator = null;
      this.carGroup = null;
      this.bodyMaterials = [];
      this.rimMaterials = [];
      this.hotspots = [];
      this.raycaster = new THREE.Raycaster();
      this.animId = null;
      this.isDisposed = false;
      this.isDragging = false;
      this.currentAngle = this.options.initialAngle || 137;

      this.init();
    }

    init() {
      if (!isWebGLAvailable()) {
        console.warn('[Car3DViewer] WebGL is not supported on this device/browser.');
        if (this.options.onError) this.options.onError(new Error('WebGL not available'));
        return;
      }

      const width = this.container.clientWidth || 800;
      const height = this.container.clientHeight || 520;

      // 1. Scene
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x0B1120);
      this.scene.fog = new THREE.FogExp2(0x0B1120, 0.035);

      // 2. Camera: 40deg FOV gives realistic automotive telephoto proportions (no fisheye distortion)
      this.camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
      this.camera.position.set(4.8, 1.8, 4.2);

      // 3. Renderer with Premium PBR Settings
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
      });
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      // Append canvas
      this.container.innerHTML = '';
      this.container.style.position = 'relative';
      this.container.style.overflow = 'hidden';
      this.renderer.domElement.style.width = '100%';
      this.renderer.domElement.style.height = '100%';
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

      // 9. Resize Listener
      this.onWindowResize = this.handleResize.bind(this);
      window.addEventListener('resize', this.onWindowResize);

      // 10. Start Animation Loop
      this.animate = this.animate.bind(this);
      this.animate();

      // Apply initial angle
      this.setRotationAngle(this.currentAngle);
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
      const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
      shadowMesh.rotation.x = -Math.PI / 2;
      shadowMesh.position.y = 0.003;
      this.scene.add(shadowMesh);

      // Subtle studio reflective circular floor with grid ring
      const floorGeo = new THREE.CircleGeometry(10, 64);
      const floorMat = new THREE.MeshStandardMaterial({
        color: 0x0F172A,
        roughness: 0.55,
        metalness: 0.35
      });
      const floorMesh = new THREE.Mesh(floorGeo, floorMat);
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.position.y = 0;
      floorMesh.receiveShadow = true;
      this.scene.add(floorMesh);

      // Studio Accent Ring
      const ringGeo = new THREE.RingGeometry(4.2, 4.25, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x1E40AF,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.position.y = 0.002;
      this.scene.add(ringMesh);
    }

    loadModel() {
      const loader = typeof THREE.GLTFLoader !== 'undefined' ? new THREE.GLTFLoader() : null;

      if (!loader || !this.options.modelUrl) {
        this.useProceduralFallback();
        return;
      }

      loader.load(
        this.options.modelUrl,
        (gltf) => {
          if (this.isDisposed) return;
          this.setupLoadedModel(gltf.scene);
        },
        (xhr) => {
          if (xhr.lengthComputable && this.options.onProgress) {
            const percent = Math.round((xhr.loaded / xhr.total) * 100);
            this.options.onProgress(percent);
          }
        },
        (err) => {
          console.warn('[Car3DViewer] Could not load GLB file, transitioning to high-detail procedural 3D model:', err);
          this.useProceduralFallback();
        }
      );
    }

    setupLoadedModel(model) {
      this.carGroup = model;

      // 1. Calculate Exact Bounding Box & Normalize Center
      const box = new THREE.Box3().setFromObject(this.carGroup);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      // Center model at origin
      this.carGroup.position.x = -center.x;
      this.carGroup.position.z = -center.z;
      // Set bottom of tires flush on studio floor (y = 0)
      this.carGroup.position.y = -box.min.y;

      // 2. Adjust Camera to Frame the Vehicle at 70-75% of visual area
      const maxDim = Math.max(size.x, size.y, size.z);
      const fovRad = this.camera.fov * (Math.PI / 180);
      const idealDist = (maxDim / 2) / Math.tan(fovRad / 2) * 1.35;

      this.camera.position.set(
        idealDist * 0.75,
        maxDim * 0.38,
        idealDist * 0.75
      );
      if (this.controls) {
        this.controls.minDistance = maxDim * 0.65;
        this.controls.maxDistance = maxDim * 2.8;
        this.controls.target.set(0, size.y * 0.38, 0);
        this.controls.update();
      }

      // 3. Apply Premium PBR Materials to Meshes
      this.bodyMaterials = [];
      this.rimMaterials = [];

      const initialColor = new THREE.Color(this.options.initialColor || '#0284C7');

      // PBR Car Paint Material
      const bodyMat = new THREE.MeshPhysicalMaterial({
        color: initialColor,
        metalness: 0.88,
        roughness: 0.38,
        clearcoat: 1.0,
        clearcoatRoughness: 0.03
      });
      this.bodyMaterials.push(bodyMat);

      // PBR Tinted Glass Material
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xFFFFFF,
        metalness: 0.1,
        roughness: 0.02,
        transmission: 0.9,
        transparent: true,
        opacity: 0.85,
        depthWrite: false
      });

      // Default Sport Rim Material
      const rimMat = new THREE.MeshStandardMaterial({
        color: 0xD0D5DD,
        metalness: 0.92,
        roughness: 0.25
      });
      this.rimMaterials.push(rimMat);

      // Brake Caliper Brembo Material
      const brakeMat = new THREE.MeshStandardMaterial({
        color: 0xEF4444,
        roughness: 0.28,
        metalness: 0.55
      });

      // Rubber Tire Material
      const tireMat = new THREE.MeshStandardMaterial({
        color: 0x18181B,
        roughness: 0.88,
        metalness: 0.08
      });

      this.carGroup.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;

          const name = (child.name || '').toLowerCase();
          if (name.includes('body')) {
            child.material = bodyMat;
          } else if (name.includes('rim_')) {
            child.material = rimMat;
          } else if (name.includes('brake')) {
            child.material = brakeMat;
          } else if (name.includes('glass')) {
            child.material = glassMat;
          } else if (name.includes('tire')) {
            child.material = tireMat;
          } else if (name.includes('lights_red') || name.includes('taillight')) {
            child.material = new THREE.MeshStandardMaterial({
              color: 0xFF0022,
              emissive: 0xCC0011,
              emissiveIntensity: 1.2,
              roughness: 0.2
            });
          } else if (name.includes('lights') || name.includes('led')) {
            child.material = new THREE.MeshStandardMaterial({
              color: 0xE0F2FE,
              emissive: 0x38BDF8,
              emissiveIntensity: 1.0,
              roughness: 0.15
            });
          } else if (name.includes('chrome') || name.includes('metal')) {
            child.material = new THREE.MeshStandardMaterial({
              color: 0xCBD5E1,
              metalness: 0.95,
              roughness: 0.18
            });
          }
        }
      });

      this.scene.add(this.carGroup);

      if (this.options.onReady) this.options.onReady();
      this.syncRotationAngleFromCamera();
    }

    useProceduralFallback() {
      this.carGroup = createProceduralCar(this.options.initialColor);
      this.scene.add(this.carGroup);

      if (this.carGroup.userData.bodyMaterial) {
        this.bodyMaterials = [this.carGroup.userData.bodyMaterial];
      }
      if (this.carGroup.userData.rimMaterial) {
        this.rimMaterials = [this.carGroup.userData.rimMaterial];
      }

      this.camera.position.set(4.6, 1.8, 4.4);
      if (this.controls) {
        this.controls.target.set(0, 0.6, 0);
        this.controls.update();
      }

      if (this.options.onReady) this.options.onReady();
      this.syncRotationAngleFromCamera();
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

    handleResize() {
      if (this.isDisposed || !this.container || !this.renderer || !this.camera) return;

      const width = this.container.clientWidth;
      const height = this.container.clientHeight;

      if (width === 0 || height === 0) return;

      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();

      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }

    animate() {
      if (this.isDisposed) return;
      this.animId = requestAnimationFrame(this.animate);

      if (this.controls) {
        this.controls.update();
      }

      this.updateHotspots();

      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
    }

    dispose() {
      this.isDisposed = true;
      if (this.animId) {
        cancelAnimationFrame(this.animId);
        this.animId = null;
      }

      window.removeEventListener('resize', this.onWindowResize);

      if (this.controls) {
        this.controls.dispose();
      }

      if (this.pmremGenerator) {
        this.pmremGenerator.dispose();
      }

      // Traverse scene and dispose geometries, materials, textures
      if (this.scene) {
        this.scene.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach(m => m.dispose());
            } else {
              obj.material.dispose();
            }
          }
        });
      }

      if (this.renderer) {
        this.renderer.dispose();
        if (this.renderer.domElement && this.renderer.domElement.parentNode) {
          this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
      }

      if (this.hotspotsOverlay && this.hotspotsOverlay.parentNode) {
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
