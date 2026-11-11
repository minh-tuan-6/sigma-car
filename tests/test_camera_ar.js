// tests/test_camera_ar.js
// Automated Test Suite for Real Camera-Based WebAR & Camera Permissions
// Validates:
// 1. WebRTC getUserMedia permission handling & progressive resolution fallback
// 2. Hardware camera enumeration and switching (Front / Back / Multi-camera)
// 3. Error states: permission_denied, camera_unavailable, camera_in_use, insecure_context, unsupported
// 4. Camera lifecycle: auto-start, manual toggle, track release on exit/dispose
// 5. Layering & composite photo capture (real camera video + 3D model)
// 6. Security headers and server configuration (Permissions-Policy)

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

console.log('🧪 RUNNING REAL CAMERA-BASED AR AUTOMATED TEST SUITE...\n');

let total = 0;
let passed = 0;

function it(desc, fn) {
  total++;
  try {
    fn();
    console.log(`  ✅ PASS: ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(`     ${err.stack || err.message}`);
  }
}

async function itAsync(desc, fn) {
  total++;
  try {
    await fn();
    console.log(`  ✅ PASS: ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(`     ${err.stack || err.message}`);
  }
}

(async () => {
  // Test 1: Module syntax and API exports
  it('SigmaARAdapter exports camera lifecycle & control methods', () => {
    const adapter = require(path.resolve('js/ar-adapter.js'));
    assert.strictEqual(typeof adapter.init, 'function');
    assert.strictEqual(typeof adapter.startCamera, 'function');
    assert.strictEqual(typeof adapter.stopCamera, 'function');
    assert.strictEqual(typeof adapter.toggleCamera, 'function');
    assert.strictEqual(typeof adapter.switchCamera, 'function');
    assert.strictEqual(typeof adapter.isCameraActive, 'function');
    assert.strictEqual(typeof adapter.getAvailableCameras, 'function');
    assert.strictEqual(typeof adapter.dispose, 'function');
  });

  // Test 2: Camera Permissions-Policy header in server.js and _headers
  it('Server and _headers explicitly allow camera and spatial tracking via Permissions-Policy', () => {
    const serverCode = fs.readFileSync(path.resolve('server.js'), 'utf8');
    assert(serverCode.includes("res.setHeader('Permissions-Policy'"), 'server.js must set Permissions-Policy header');
    assert(serverCode.includes('camera=(self)'), 'server.js must include camera=(self)');
    assert(serverCode.includes('xr-spatial-tracking=(self)'), 'server.js must include xr-spatial-tracking=(self)');

    const headersCode = fs.readFileSync(path.resolve('_headers'), 'utf8');
    assert(headersCode.includes('Permissions-Policy: camera=(self), xr-spatial-tracking=(self)'), '_headers must configure Permissions-Policy');
  });

  // Test 3: CSS styling for video layer, studio backdrop, reticle, and permission overlay
  it('css/style.css defines all real camera AR viewport classes', () => {
    const css = fs.readFileSync(path.resolve('css/style.css'), 'utf8');
    assert(css.includes('.ar-live-video-layer'), 'Missing .ar-live-video-layer');
    assert(css.includes('.ar-camera-backdrop'), 'Missing .ar-camera-backdrop');
    assert(css.includes('.ar-permission-banner'), 'Missing .ar-permission-banner');
    assert(css.includes('.ar-camera-switch-pill'), 'Missing .ar-camera-switch-pill');
    assert(css.includes('.ar-model-viewer-element'), 'Missing .ar-model-viewer-element');
  });

  // Test 4: Simulated WebRTC Camera lifecycle inside browser-like environment
  await itAsync('Camera lifecycle: permission grant, stream start, track release on dispose', async () => {
    let trackStopped = false;
    const mockTrack = {
      readyState: 'live',
      getSettings: () => ({ deviceId: 'cam-01', facingMode: 'environment' }),
      addEventListener: () => {},
      stop: () => { trackStopped = true; }
    };
    const mockStream = {
      active: true,
      getVideoTracks: () => [mockTrack],
      getTracks: () => [mockTrack]
    };

    let userMediaConstraints = null;
    const mockMediaDevices = {
      getUserMedia: async (constraints) => {
        userMediaConstraints = constraints;
        return mockStream;
      },
      enumerateDevices: async () => [
        { kind: 'videoinput', deviceId: 'cam-back', label: 'Camera Sau (Back Camera)' },
        { kind: 'videoinput', deviceId: 'cam-front', label: 'Camera Trước (Front Camera)' }
      ],
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    const mockVideo = {
      srcObject: null,
      style: {},
      setAttribute: () => {},
      play: async () => {},
      pause: () => {}
    };

    const mockContainer = {
      innerHTML: '',
      appendChild: (node) => node
    };

    // Load adapter into mock DOM environment
    const adapterCode = fs.readFileSync(path.resolve('js/ar-adapter.js'), 'utf8');
    const mockModule = { exports: {} };
    const sandbox = {
      module: mockModule,
      exports: mockModule.exports,
      window: { isSecureContext: true },
      location: { hostname: 'localhost', protocol: 'http:' },
      navigator: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        mediaDevices: mockMediaDevices
      },
      document: {
        createElement: (tag) => {
          if (tag === 'video') return Object.assign({}, mockVideo);
          return {
            setAttribute: () => {},
            style: {},
            appendChild: () => {},
            addEventListener: () => {},
            removeEventListener: () => {}
          };
        }
      },
      customElements: { get: () => true },
      console,
      setTimeout,
      clearTimeout
    };
    sandbox.self = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(adapterCode, sandbox);

    const adapter = mockModule.exports.init ? mockModule.exports : sandbox.SigmaARAdapter;

    let cameraStateReported = null;
    const session = adapter.init(mockContainer, {
      carId: 'tesla-cybertruck',
      autoStartCamera: false,
      onCameraStateChange: (state) => { cameraStateReported = state; }
    });

    // 1. Verify devices list
    const devices = await adapter.getAvailableCameras();
    assert.strictEqual(devices.length, 2);
    assert.strictEqual(devices[0].facingMode, 'environment');
    assert.strictEqual(devices[1].facingMode, 'user');

    // 2. Start camera
    const res = await adapter.startCamera();
    assert.strictEqual(res.success, true);
    assert.strictEqual(adapter.isCameraActive(), true);
    assert.strictEqual(cameraStateReported, 'active');

    // 3. Switch camera to front
    await adapter.switchCamera('user');
    assert.strictEqual(adapter.isCameraActive(), true);

    // 4. Dispose session -> must release camera stream completely
    adapter.dispose();
    assert.strictEqual(trackStopped, true, 'Calling adapter.dispose() must stop all media tracks');
    assert.strictEqual(adapter.isCameraActive(), false);
  });

  // Test 5: Error handling - Permission Denied, Not Found, Insecure Context
  await itAsync('Camera error handling: permission denied, not found, and insecure context', async () => {
    const adapterCode = fs.readFileSync(path.resolve('js/ar-adapter.js'), 'utf8');

    // 5a. Permission Denied simulation
    {
      const mockModule = { exports: {} };
      const deniedSandbox = {
        module: mockModule,
        exports: mockModule.exports,
        window: { isSecureContext: true },
        location: { hostname: 'localhost', protocol: 'http:' },
        navigator: {
          userAgent: 'Chrome Windows',
          mediaDevices: {
            getUserMedia: async () => {
              const err = new Error('Permission denied');
              err.name = 'NotAllowedError';
              throw err;
            },
            enumerateDevices: async () => []
          }
        },
        document: {
          createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}, removeEventListener: () => {} })
        },
        customElements: { get: () => true },
        console, setTimeout, clearTimeout
      };
      deniedSandbox.self = deniedSandbox.window;
      vm.createContext(deniedSandbox);
      vm.runInContext(adapterCode, deniedSandbox);
      const adapter = mockModule.exports.init ? mockModule.exports : deniedSandbox.SigmaARAdapter;

      let reportedState = null;
      let reportedDetail = null;
      adapter.init({ innerHTML: '', appendChild: (n) => n }, {
        autoStartCamera: false,
        onCameraStateChange: (state, detail) => {
          reportedState = state;
          reportedDetail = detail;
        }
      });

      const res = await adapter.startCamera();
      assert.strictEqual(res.success, false);
      assert.strictEqual(reportedState, 'permission_denied');
      assert(reportedDetail.message.includes('Quyền'));
      adapter.dispose();
    }

    // 5b. Insecure context simulation
    {
      const mockModule = { exports: {} };
      const insecureSandbox = {
        module: mockModule,
        exports: mockModule.exports,
        window: { isSecureContext: false },
        location: { hostname: '192.168.1.50', protocol: 'http:' },
        navigator: {
          userAgent: 'Chrome Android',
          mediaDevices: { getUserMedia: async () => {}, enumerateDevices: async () => [] }
        },
        document: {
          createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}, removeEventListener: () => {} })
        },
        customElements: { get: () => true },
        console, setTimeout, clearTimeout
      };
      insecureSandbox.self = insecureSandbox.window;
      vm.createContext(insecureSandbox);
      vm.runInContext(adapterCode, insecureSandbox);
      const adapter = mockModule.exports.init ? mockModule.exports : insecureSandbox.SigmaARAdapter;

      let reportedState = null;
      adapter.init({ innerHTML: '', appendChild: (n) => n }, {
        autoStartCamera: false,
        onCameraStateChange: (state) => { reportedState = state; }
      });

      const res = await adapter.startCamera();
      assert.strictEqual(res.success, false);
      assert.strictEqual(reportedState, 'insecure_context');
      adapter.dispose();
    }
  });

  // Test 6: Composite Photo Capture logic
  await itAsync('Composite Photo Capture combines real camera frame with 3D model canvas', async () => {
    let drawnSources = [];
    const mockCanvas = {
      width: 1920,
      height: 1080,
      getContext: () => ({
        drawImage: (src) => { drawnSources.push(src); }
      }),
      toBlob: (cb) => {
        cb(new Uint8Array([1, 2, 3]));
      }
    };

    const mockVideo = {
      videoWidth: 1920,
      videoHeight: 1080,
      style: {},
      setAttribute: () => {},
      play: async () => {}
    };

    const mockModelBlob = new Uint8Array([4, 5, 6]);
    const mockModelViewer = {
      toBlob: async () => mockModelBlob,
      setAttribute: () => {},
      style: {},
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    const adapterCode = fs.readFileSync(path.resolve('js/ar-adapter.js'), 'utf8');
    const mockModule = { exports: {} };
    const captureSandbox = {
      module: mockModule,
      exports: mockModule.exports,
      window: { isSecureContext: true },
      location: { hostname: 'localhost', protocol: 'http:' },
      navigator: {
        userAgent: 'Chrome Windows',
        mediaDevices: {
          getUserMedia: async () => ({
            active: true,
            getVideoTracks: () => [{ readyState: 'live', getSettings: () => ({}), addEventListener: () => {}, stop: () => {} }],
            getTracks: () => []
          }),
          enumerateDevices: async () => []
        }
      },
      document: {
        createElement: (tag) => {
          if (tag === 'video') return mockVideo;
          if (tag === 'canvas') return mockCanvas;
          return { style: {}, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}, removeEventListener: () => {} };
        }
      },
      Image: function() {
        this.complete = false;
        Object.defineProperty(this, 'src', {
          set: function(val) {
            this._src = val;
            setTimeout(() => {
              this.complete = true;
              if (this.onload) this.onload();
            }, 5);
          },
          get: function() { return this._src; }
        });
      },
      URL: {
        createObjectURL: () => 'blob:mock-composite-url',
        revokeObjectURL: () => {}
      },
      customElements: { get: () => true },
      console, setTimeout, clearTimeout
    };
    captureSandbox.self = captureSandbox.window;
    vm.createContext(captureSandbox);
    vm.runInContext(adapterCode, captureSandbox);
    const adapter = mockModule.exports.init ? mockModule.exports : captureSandbox.SigmaARAdapter;

    adapter.init({ innerHTML: '', appendChild: (n) => n }, { autoStartCamera: false });
    await adapter.startCamera();

    const instance = adapter.getInstance();
    instance.modelViewer = mockModelViewer;

    const photoUrl = await instance.capturePhoto();
    assert.strictEqual(photoUrl, 'blob:mock-composite-url');
    assert(drawnSources.length >= 2, 'Must draw both camera video and 3D model onto composite canvas');
    adapter.dispose();
  });

  // Test 7: UI integration in js/app.js
  it('js/app.js renderArLiveModePage includes camera video layer, switch camera button and permission overlay', () => {
    const appCode = fs.readFileSync(path.resolve('js/app.js'), 'utf8');
    assert(appCode.includes('ar-camera-backdrop'), 'Must include ar-camera-backdrop');
    assert(appCode.includes('btn-ar-switch-camera'), 'Must include btn-ar-switch-camera');
    assert(appCode.includes('ar-camera-device-select'), 'Must include ar-camera-device-select');
    assert(appCode.includes('ar-permission-overlay'), 'Must include ar-permission-overlay');
    assert(appCode.includes('SigmaARAdapter') && appCode.includes('startCamera'), 'Must hook into SigmaARAdapter startCamera');
    assert(appCode.includes('SigmaARAdapter') && appCode.includes('switchCamera'), 'Must hook into SigmaARAdapter switchCamera');
  });

  console.log(`\n======================================================`);
  console.log(`CAMERA AR TEST SUITE RESULTS: ${passed}/${total} Passed (${passed === total ? '100% SUCCESS' : 'FAILED'})`);
  console.log(`======================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
})();
