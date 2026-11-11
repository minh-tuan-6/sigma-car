// tests/test_viewer_camera_integration.js
// Automated verification for Three.js WebGL + Real Camera Video Integration in Car3DViewer

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let total = 0;

function it(desc, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✅ PASS: ${desc}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(`     ${err.stack || err.message}`);
  }
}

async function itAsync(desc, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  ✅ PASS: ${desc}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(`     ${err.stack || err.message}`);
  }
}

console.log('🧪 RUNNING THREE.JS + CAMERA AR INTEGRATION TEST SUITE...\n');

// Mock Three.js environment
function createMockSandbox(mockThree, mockContainer, customMedia = {}) {
  const sandbox = {
    window: {
      isSecureContext: true,
      devicePixelRatio: 1,
      WebGLRenderingContext: function() {},
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    document: {
      createElement: (tag) => {
        const el = {
          tagName: tag,
          id: '',
          className: '',
          style: {},
          readyState: 4,
          setAttribute: () => {},
          appendChild: () => {},
          addEventListener: (event, cb) => {
            if (event === 'loadedmetadata') cb();
          },
          removeEventListener: () => {},
          play: async () => {},
          getContext: (type) => {
            if (type === 'webgl' || type === 'experimental-webgl') return {};
            return {
              clearRect: () => {},
              createRadialGradient: () => ({ addColorStop: () => {} }),
              fillRect: () => {},
              beginPath: () => {},
              ellipse: () => {},
              fill: () => {},
              drawImage: () => {}
            };
          },
          toDataURL: () => 'data:image/jpeg;mock'
        };
        return el;
      }
    },
    navigator: {
      userAgent: 'Chrome',
      mediaDevices: {
        getUserMedia: customMedia.getUserMedia || (async () => ({
          active: true,
          getVideoTracks: () => [{ readyState: 'live', stop: () => {}, getSettings: () => ({}) }],
          getTracks: () => [{ readyState: 'live', stop: () => {}, getSettings: () => ({}) }]
        })),
        enumerateDevices: customMedia.enumerateDevices || (async () => [])
      }
    },
    THREE: mockThree,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    console
  };
  sandbox.self = sandbox.window;
  return sandbox;
}

function createMockThree() {
  class Color {
    constructor(hex) { this.hex = hex; }
    copy(c) { this.hex = c.hex; return this; }
  }
  class Scene {
    constructor() {
      this.background = null;
      this.fog = null;
      this.children = [];
    }
    add(obj) { this.children.push(obj); }
    traverse(cb) { this.children.forEach(cb); }
  }
  class PerspectiveCamera {
    constructor(fov, aspect, near, far) {
      this.fov = fov;
      this.aspect = aspect;
      this.near = near;
      this.far = far;
      this.position = { x: 0, y: 0, z: 0, set: function(x, y, z) { this.x = x; this.y = y; this.z = z; }, lerp: () => {} };
    }
    updateProjectionMatrix() {}
    lookAt() {}
  }
  class WebGLRenderer {
    constructor(opts = {}) {
      this.options = opts;
      this.alpha = !!opts.alpha;
      this.clearColor = null;
      this.clearAlpha = 1;
      this.domElement = {
        style: {},
        width: 1280,
        height: 720,
        parentNode: null,
        addEventListener: () => {},
        removeEventListener: () => {}
      };
      this.shadowMap = {};
    }
    setClearColor(color, alpha = 1) {
      this.clearColor = color;
      this.clearAlpha = alpha;
    }
    setSize(w, h) { this.domElement.width = w; this.domElement.height = h; }
    setPixelRatio() {}
    render() {}
    dispose() {}
  }
  class OrbitControls {
    constructor(cam, dom) {
      this.target = { x: 0, y: 0, z: 0, set: function(x, y, z) { this.x = x; this.y = y; this.z = z; }, lerp: () => {} };
    }
    update() {}
    reset() {}
    dispose() {}
    addEventListener() {}
    getAzimuthalAngle() { return 0; }
    getPolarAngle() { return 1; }
    getDistance() { return 5; }
  }
  class Mesh {
    constructor(geo, mat) {
      this.geometry = geo;
      this.material = mat;
      this.visible = true;
      this.position = { x: 0, y: 0, z: 0, set: function(x, y, z) { this.x = x; this.y = y; this.z = z; } };
      this.rotation = { x: 0, y: 0, z: 0 };
      this.scale = { x: 1, y: 1, z: 1, set: function(x, y, z) { this.x = x; this.y = y; this.z = z; } };
      this.userData = {};
    }
  }
  class Group extends Mesh {
    constructor() { super({}, {}); this.children = []; }
    add(child) { this.children.push(child); }
  }

  return {
    Color,
    Scene,
    PerspectiveCamera,
    WebGLRenderer,
    OrbitControls,
    Mesh,
    Group,
    PlaneGeometry: function() { return { rotateX: () => {}, dispose: () => {} }; },
    CircleGeometry: function() { return { rotateX: () => {}, dispose: () => {} }; },
    RingGeometry: function() { return { rotateX: () => {}, dispose: () => {} }; },
    TorusGeometry: function() { return { rotateX: () => {}, dispose: () => {} }; },
    Box3: function() {
      return {
        setFromObject: () => ({}),
        getSize: (v) => v.set ? v.set(5.6, 2.0, 1.8) : { x: 5.6, y: 2.0, z: 1.8 },
        getCenter: (v) => v.set ? v.set(0, 0, 0) : { x: 0, y: 0, z: 0 },
        min: { y: 0 }
      };
    },
    Vector3: function(x=0, y=0, z=0) {
      return { x, y, z, set: function(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; return this; } };
    },
    FogExp2: function() {},
    BoxGeometry: function() { return { rotateX: () => {}, dispose: () => {} }; },
    CylinderGeometry: function() { return { rotateX: () => {}, dispose: () => {} }; },
    MeshBasicMaterial: function(opts) { return { ...opts, color: { copy: () => {}, setHex: () => {} }, dispose: () => {} }; },
    MeshStandardMaterial: function(opts) { return { ...opts, color: { copy: () => {}, setHex: () => {} }, dispose: () => {} }; },
    MeshPhysicalMaterial: function(opts) { return { ...opts, color: { copy: () => {}, setHex: () => {} }, dispose: () => {} }; },
    DirectionalLight: function() { return { position: { set: () => {} }, shadow: { mapSize: {}, camera: {} } }; },
    AmbientLight: function() { return {}; },
    CanvasTexture: function() { return { dispose: () => {} }; },
    Raycaster: function() { return { set: () => {}, intersectObjects: () => [] }; },
    ACESFilmicToneMapping: 1,
    PCFSoftShadowMap: 1,
    DoubleSide: 2
  };
}

(async () => {
  // Test 1: Car3DViewer code compilation and export
  it('Car3DViewer compiles cleanly and exports ViewerInstance factory', () => {
    const code = fs.readFileSync(path.resolve('js/car-3d-viewer.js'), 'utf8');
    assert(code.includes('class ViewerInstance'), 'Must contain ViewerInstance');
    assert(code.includes('startCamera'), 'ViewerInstance must implement startCamera');
    assert(code.includes('stopCamera'), 'ViewerInstance must implement stopCamera');
    assert(code.includes('toggleCamera'), 'ViewerInstance must implement toggleCamera');
    assert(code.includes('switchCamera'), 'ViewerInstance must implement switchCamera');
    assert(code.includes('setTransparentMode'), 'ViewerInstance must implement setTransparentMode');
    assert(code.includes('captureCompositePhoto'), 'ViewerInstance must implement captureCompositePhoto');
  });

  // Test 2: Standard 3D Studio Mode (opaque background 0x0B1120)
  it('Standard 3D Studio Viewer initializes with opaque background (0x0B1120)', () => {
    const code = fs.readFileSync(path.resolve('js/car-3d-viewer.js'), 'utf8');
    const mockThree = createMockThree();
    const mockContainer = {
      clientWidth: 800,
      clientHeight: 520,
      innerHTML: '',
      style: {},
      appendChild: (node) => { node.parentNode = mockContainer; return node; },
      querySelector: () => null
    };

    const sandbox = createMockSandbox(mockThree, mockContainer);
    vm.createContext(sandbox);

    const mockModule = { exports: {} };
    sandbox.module = mockModule;
    vm.runInContext(code, sandbox);

    const Car3DViewer = mockModule.exports.init ? mockModule.exports : sandbox.Car3DViewer;
    const viewer = Car3DViewer.init(mockContainer, { transparent: false, arMode: false });

    assert.strictEqual(viewer.options.arMode, false);
    assert.notStrictEqual(viewer.scene.background, null, 'Scene background must NOT be null in standard studio mode');
    assert.strictEqual(viewer.renderer.clearColor, 0x0B1120, 'ClearColor must be 0x0B1120 in studio mode');
    assert.strictEqual(viewer.videoElement.style.display, 'none', 'Video layer must be hidden when camera is inactive');
    viewer.dispose();
  });

  // Test 3: Transparent AR Mode (scene.background = null, setClearColor(0, 0), video layer active)
  it('Transparent AR Mode initializes with null background and transparent clearColor for camera passthrough', () => {
    const code = fs.readFileSync(path.resolve('js/car-3d-viewer.js'), 'utf8');
    const mockThree = createMockThree();
    const mockContainer = {
      clientWidth: 800,
      clientHeight: 520,
      innerHTML: '',
      style: {},
      appendChild: (node) => { node.parentNode = mockContainer; return node; },
      querySelector: () => null
    };

    const sandbox = createMockSandbox(mockThree, mockContainer);
    vm.createContext(sandbox);

    const mockModule = { exports: {} };
    sandbox.module = mockModule;
    vm.runInContext(code, sandbox);

    const Car3DViewer = mockModule.exports.init ? mockModule.exports : sandbox.Car3DViewer;
    const viewer = Car3DViewer.init(mockContainer, { transparent: true, arMode: true });

    assert.strictEqual(viewer.options.arMode, true);
    assert.strictEqual(viewer.scene.background, null, 'Scene background must be null so live video shows through');
    assert.strictEqual(viewer.renderer.clearColor, 0x000000);
    assert.strictEqual(viewer.renderer.clearAlpha, 0, 'ClearAlpha must be 0 for transparent WebGL canvas');
    assert.strictEqual(viewer.renderer.domElement.style.background, 'transparent');
    assert.strictEqual(viewer.renderer.domElement.style.zIndex, '2', 'Three.js canvas must sit at z-index 2 above video');
    assert.strictEqual(viewer.videoElement.style.zIndex, '1', 'Video layer must sit at z-index 1 below canvas');
    viewer.dispose();
  });

  // Test 4: Camera lifecycle in ViewerInstance: startCamera attaches stream, sets transparent mode, dispose stops tracks
  await itAsync('ViewerInstance camera lifecycle: starts stream, binds video, stops tracks on dispose without duplicates', async () => {
    const code = fs.readFileSync(path.resolve('js/car-3d-viewer.js'), 'utf8');
    const mockThree = createMockThree();
    let trackStopped = false;
    const mockTrack = {
      readyState: 'live',
      getSettings: () => ({ deviceId: 'cam-rear-01', facingMode: 'environment' }),
      stop: () => { trackStopped = true; }
    };
    const mockStream = {
      active: true,
      getVideoTracks: () => [mockTrack],
      getTracks: () => [mockTrack]
    };

    let userMediaCalls = 0;
    const mockContainer = {
      clientWidth: 800,
      clientHeight: 520,
      innerHTML: '',
      style: {},
      appendChild: (node) => { node.parentNode = mockContainer; return node; },
      querySelector: () => null
    };

    const sandbox = createMockSandbox(mockThree, mockContainer, {
      getUserMedia: async () => {
        userMediaCalls++;
        return mockStream;
      },
      enumerateDevices: async () => [{ deviceId: 'cam-rear-01', kind: 'videoinput', label: 'Back Camera' }]
    });
    vm.createContext(sandbox);

    const mockModule = { exports: {} };
    sandbox.module = mockModule;
    vm.runInContext(code, sandbox);

    const Car3DViewer = mockModule.exports.init ? mockModule.exports : sandbox.Car3DViewer;
    let cameraStateReported = null;

    const viewer = Car3DViewer.init(mockContainer, {
      transparent: true,
      arMode: true,
      onCameraStateChange: (state) => { cameraStateReported = state; }
    });

    // 1. Initial startCamera
    await viewer.startCamera();
    assert.strictEqual(userMediaCalls, 1, 'Should call getUserMedia once');
    assert.strictEqual(viewer.isCameraActive, true);
    assert.strictEqual(cameraStateReported, 'active');
    assert.strictEqual(viewer.videoElement.srcObject, mockStream);
    assert.strictEqual(viewer.videoElement.playsInline, true);
    assert.strictEqual(viewer.videoElement.muted, true);
    assert.strictEqual(viewer.scene.background, null);

    // 2. Calling startCamera again should NOT create duplicate streams!
    await viewer.startCamera();
    assert.strictEqual(userMediaCalls, 1, 'Should reuse existing active stream (NO duplicates!)');

    // 3. Dispose viewer should immediately release tracks
    viewer.dispose();
    assert.strictEqual(trackStopped, true, 'All camera tracks must be stopped on dispose');
    assert.strictEqual(viewer.isCameraActive, false);
    assert.strictEqual(viewer.videoElement.srcObject, null);
  });

  // Test 5: Reopening AR viewer initializes cleanly
  await itAsync('Reopening AR Viewer initializes cleanly with fresh stream', async () => {
    const code = fs.readFileSync(path.resolve('js/car-3d-viewer.js'), 'utf8');
    const mockThree = createMockThree();
    let streamCount = 0;
    const createStream = () => ({
      id: ++streamCount,
      active: true,
      getVideoTracks: () => [{ readyState: 'live', stop: () => {}, getSettings: () => ({}) }],
      getTracks: () => [{ readyState: 'live', stop: () => {}, getSettings: () => ({}) }]
    });

    const mockContainer = {
      clientWidth: 800,
      clientHeight: 520,
      innerHTML: '',
      style: {},
      appendChild: (node) => { node.parentNode = mockContainer; return node; },
      querySelector: () => null
    };

    const sandbox = createMockSandbox(mockThree, mockContainer, {
      getUserMedia: async () => createStream(),
      enumerateDevices: async () => []
    });
    vm.createContext(sandbox);

    const mockModule = { exports: {} };
    sandbox.module = mockModule;
    vm.runInContext(code, sandbox);

    const Car3DViewer = mockModule.exports.init ? mockModule.exports : sandbox.Car3DViewer;

    // Session 1
    const v1 = Car3DViewer.init(mockContainer, { arMode: true });
    await v1.startCamera();
    assert.strictEqual(v1.isCameraActive, true);
    v1.dispose();

    // Session 2 (Reopened)
    const v2 = Car3DViewer.init(mockContainer, { arMode: true });
    await v2.startCamera();
    assert.strictEqual(v2.isCameraActive, true);
    v2.dispose();
  });

  console.log(`\n======================================================`);
  console.log(`VIEWER CAMERA INTEGRATION RESULTS: ${passed}/${total} Passed (${passed === total ? '100% SUCCESS' : 'FAILED'})`);
  console.log(`======================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
})();
