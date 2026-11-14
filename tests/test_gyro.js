// tests/test_gyro.js
// Comprehensive verification suite for SIGMACAR Real Gyroscope (3D Motion) Controller

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const THREE = require('../js/libs/three.min.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${name}\n   -> ${err.stack || err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${name}\n   -> ${err.stack || err.message}`);
    failed++;
  }
}

function createViewerSandbox({ withOriAPI = true, withMotAPI = true, iosPermissionMode = null } = {}) {
  const listeners = new Map();
  let oriHandlerCount = 0;
  let motHandlerCount = 0;
  let orientChangeCount = 0;
  let permissionRequestCalls = 0;

  function addEv(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    const set = listeners.get(type);
    const prevSize = set.size;
    set.add(fn);
    if (set.size > prevSize) {
      if (type === 'deviceorientation') oriHandlerCount++;
      if (type === 'devicemotion') motHandlerCount++;
      if (type === 'orientationchange') orientChangeCount++;
    }
  }
  function remEv(type, fn) {
    if (!listeners.has(type)) return;
    const set = listeners.get(type);
    if (set.delete(fn)) {
      if (type === 'deviceorientation') oriHandlerCount--;
      if (type === 'devicemotion') motHandlerCount--;
      if (type === 'orientationchange') orientChangeCount--;
    }
  }
  function emit(type, ev) {
    const set = listeners.get(type);
    if (!set) return;
    for (const fn of Array.from(set)) fn(ev);
  }

  // Real-math OrbitControls shim backed by THREE.Vector3 & THREE.Spherical
  class OrbitControlsShim {
    constructor(camera, domElement) {
      this.object = camera;
      this.domElement = domElement;
      this.target = new THREE.Vector3(0, 0.6, 0);
      this.enableDamping = true;
      this.dampingFactor = 0.06;
      this.enablePan = false;
      this.minDistance = 3.2;
      this.maxDistance = 8.5;
      this.minPolarAngle = Math.PI / 8;
      this.maxPolarAngle = Math.PI / 2 - 0.03;
      this._ev = new Map();
      this.spherical = new THREE.Spherical();
      this.updateCount = 0;
    }
    addEventListener(type, fn) {
      if (!this._ev.has(type)) this._ev.set(type, new Set());
      this._ev.get(type).add(fn);
    }
    trigger(type) {
      const set = this._ev.get(type);
      if (set) for (const fn of set) fn();
    }
    getAzimuthalAngle() {
      const offset = this.object.position.clone().sub(this.target);
      this.spherical.setFromVector3(offset);
      return this.spherical.theta;
    }
    getPolarAngle() {
      const offset = this.object.position.clone().sub(this.target);
      this.spherical.setFromVector3(offset);
      return this.spherical.phi;
    }
    update() {
      this.updateCount++;
      const offset = this.object.position.clone().sub(this.target);
      this.spherical.setFromVector3(offset);
      this.spherical.theta = this.spherical.theta; // simulate damping/clamp pass
      this.spherical.phi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this.spherical.phi));
      this.spherical.radius = Math.max(this.minDistance, Math.min(this.maxDistance, this.spherical.radius));
      offset.setFromSpherical(this.spherical);
      this.object.position.copy(this.target).add(offset);
      this.object.lookAt(this.target);
    }
    reset() {
      this.target.set(0, 0.6, 0);
      this.object.position.set(4.4, 2.2, -3.5);
    }
    dispose() {}
  }

  const CustomTHREE = Object.assign({}, THREE, {
    OrbitControls: OrbitControlsShim,
    WebGLRenderer: class {
      constructor() {
        this.domElement = { style: {}, addEventListener() {}, width: 800, height: 600 };
        this.shadowMap = {};
        this.xr = { enabled: false };
      }
      setSize() {}
      setPixelRatio() {}
      setClearColor() {}
      render() {}
      dispose() {}
    },
    GLTFLoader: undefined,
    DRACOLoader: undefined,
    RoomEnvironment: undefined
  });

  const makeEl = () => ({
    style: {},
    clientWidth: 800,
    clientHeight: 520,
    innerHTML: '',
    children: [],
    appendChild() {},
    removeChild() {},
    querySelector() { return null; },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    remove() {},
    getContext() { return { clearRect() {}, createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, beginPath() {}, ellipse() {}, fill() {}, canvas: { width: 800, height: 520 } }; }
  });

  const screenState = { orientation: { angle: 0 } };
  const windowObj = {
    WebGLRenderingContext: function () {},
    addEventListener: addEv,
    removeEventListener: remEv,
    screen: screenState,
    orientation: 0,
    devicePixelRatio: 1
  };

  if (withOriAPI) {
    windowObj.DeviceOrientationEvent = function DeviceOrientationEvent() {};
    if (iosPermissionMode) {
      windowObj.DeviceOrientationEvent.requestPermission = async () => {
        permissionRequestCalls++;
        if (iosPermissionMode === 'throw') throw new Error('Gesture expired');
        return iosPermissionMode;
      };
    }
  }
  if (withMotAPI) {
    windowObj.DeviceMotionEvent = function DeviceMotionEvent() {};
    if (iosPermissionMode) {
      windowObj.DeviceMotionEvent.requestPermission = async () => {
        if (iosPermissionMode === 'throw') throw new Error('Gesture expired');
        return iosPermissionMode;
      };
    }
  }

  let simTime = 1000;
  const ctx = {
    window: windowObj,
    self: null,
    document: {
      createElement: makeEl,
      querySelectorAll: () => [],
      body: { appendChild() {}, removeChild() {} }
    },
    navigator: {},
    THREE: CustomTHREE,
    screen: screenState,
    performance: { now: () => simTime },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setTimeout,
    clearTimeout,
    console,
    Math,
    Number,
    Date,
    Object,
    Array,
    Promise,
    Error
  };
  ctx.self = ctx;
  ctx.window.THREE = CustomTHREE;

  const code = fs.readFileSync(path.resolve('js/car-3d-viewer.js'), 'utf8');
  vm.runInNewContext(code, ctx, { filename: 'car-3d-viewer.js' });

  return {
    Car3DViewer: ctx.Car3DViewer || ctx.window.Car3DViewer,
    container: makeEl(),
    emitOrientation(alpha, beta, gamma) {
      emit('deviceorientation', { alpha, beta, gamma });
    },
    emitMotion(ra, rb, rg) {
      emit('devicemotion', { rotationRate: { alpha: ra, beta: rb, gamma: rg } });
    },
    setScreenAngle(angle) {
      screenState.orientation.angle = angle;
      windowObj.orientation = angle;
      emit('orientationchange', {});
    },
    stepFrames(viewer, count = 40, dtMs = 16.67) {
      for (let i = 0; i < count; i++) {
        simTime += dtMs;
        viewer.updateGyroCamera(simTime);
      }
    },
    getListenerCounts() {
      return { oriHandlerCount, motHandlerCount, orientChangeCount };
    },
    getPermissionRequestCalls() {
      return permissionRequestCalls;
    }
  };
}

function getSpherical(viewer) {
  const offset = viewer.camera.position.clone().sub(viewer.controls.target);
  const sph = new THREE.Spherical().setFromVector3(offset);
  return { r: sph.radius, theta: sph.theta, phi: sph.phi, deg: sph.theta * 180 / Math.PI };
}

(async () => {
  console.log('\n🧪 RUNNING REAL GYROSCOPE (3D MOTION) TEST SUITE...\n');

  test('1. Default state is GYRO OFF with zero auto-permission calls or listeners', () => {
    const env = createViewerSandbox({ iosPermissionMode: 'granted' });
    const viewer = env.Car3DViewer.init(env.container, { enableKeyboard: false });
    const state = viewer.getGyroState();
    assert.strictEqual(state.isEnabled, false);
    assert.strictEqual(state.isActive, false);
    assert.strictEqual(state.permissionState, 'prompt');
    assert.strictEqual(env.getPermissionRequestCalls(), 0, 'Must NOT request sensor permission on init');
    assert.deepStrictEqual(env.getListenerCounts(), { oriHandlerCount: 0, motHandlerCount: 0, orientChangeCount: 0 });
    viewer.dispose();
  });

  await testAsync('2. Missing sensor APIs immediately report GYRO NOT AVAILABLE (unsupported) without faking active', async () => {
    const env = createViewerSandbox({ withOriAPI: false, withMotAPI: false });
    const events = [];
    const viewer = env.Car3DViewer.init(env.container, {
      enableKeyboard: false,
      onGyroStateChange: (s, info) => events.push({ s, msg: info.message })
    });
    const ok = await viewer.enableGyro();
    assert.strictEqual(ok, false);
    assert.strictEqual(viewer.getGyroState().isEnabled, false);
    assert.strictEqual(viewer.getGyroState().isActive, false);
    assert.strictEqual(events[0].s, 'unsupported');
    assert(events[0].msg.includes('Your device does not support motion tracking.'));
    viewer.dispose();
  });

  await testAsync('3. Null-only desktop sensor events stay inactive and time out cleanly to unsupported', async () => {
    const env = createViewerSandbox({ withOriAPI: true, withMotAPI: true });
    const events = [];
    const viewer = env.Car3DViewer.init(env.container, {
      enableKeyboard: false,
      onGyroStateChange: (s, info) => events.push({ s, msg: info.message })
    });
    const ok = await viewer.enableGyro({ sensorTimeoutMs: 60 });
    assert.strictEqual(ok, true);
    assert.strictEqual(viewer.getGyroState().isActive, false, 'Must NOT report isActive before real numeric data arrives');
    env.emitOrientation(null, null, null);
    assert.strictEqual(viewer.getGyroState().isActive, false, 'Null event must not mark active');

    await new Promise(r => setTimeout(r, 110));
    const st = viewer.getGyroState();
    assert.strictEqual(st.isEnabled, false);
    assert.strictEqual(st.isActive, false);
    assert.strictEqual(st.isSupported, false);
    assert.strictEqual(events.some(e => e.s === 'active'), false, 'Must never falsely emit active on PC');
    assert.strictEqual(events.some(e => e.s === 'unsupported'), true);
    assert.deepStrictEqual(env.getListenerCounts(), { oriHandlerCount: 0, motHandlerCount: 0, orientChangeCount: 0 });
    viewer.dispose();
  });

  await testAsync('4. iOS DeviceOrientationEvent.requestPermission() handles denied, throw, and granted cleanly', async () => {
    // Denied
    const envDenied = createViewerSandbox({ iosPermissionMode: 'denied' });
    const deniedEvents = [];
    const vDenied = envDenied.Car3DViewer.init(envDenied.container, {
      enableKeyboard: false,
      onGyroStateChange: (s, info) => deniedEvents.push({ s, msg: info.message })
    });
    assert.strictEqual(await vDenied.enableGyro(), false);
    assert.strictEqual(vDenied.getGyroState().permissionState, 'denied');
    assert.strictEqual(vDenied.getGyroState().isActive, false);
    assert.strictEqual(deniedEvents[0].s, 'permission_denied');
    assert(deniedEvents[0].msg.includes('Please allow motion sensor access.'));
    vDenied.dispose();

    // Error thrown
    const envErr = createViewerSandbox({ iosPermissionMode: 'throw' });
    const errEvents = [];
    const vErr = envErr.Car3DViewer.init(envErr.container, {
      enableKeyboard: false,
      onGyroStateChange: (s, info) => errEvents.push({ s, msg: info.message })
    });
    assert.strictEqual(await vErr.enableGyro(), false);
    assert.strictEqual(errEvents[0].s, 'permission_error');
    vErr.dispose();

    // Granted
    const envOk = createViewerSandbox({ iosPermissionMode: 'granted' });
    const okEvents = [];
    const vOk = envOk.Car3DViewer.init(envOk.container, {
      enableKeyboard: false,
      onGyroStateChange: (s, info) => okEvents.push({ s, msg: info.message })
    });
    assert.strictEqual(await vOk.enableGyro(), true);
    assert.strictEqual(envOk.getPermissionRequestCalls(), 1);
    envOk.emitOrientation(0, 45, 0);
    assert.strictEqual(vOk.getGyroState().isActive, true);
    assert.strictEqual(okEvents.some(e => e.s === 'active' && e.msg.includes('Motion Tracking Enabled')), true);
    vOk.dispose();
  });

  await testAsync('5. Pitch tilt forward/back and horizontal roll/yaw orbit car intuitively', async () => {
    const env = createViewerSandbox();
    const viewer = env.Car3DViewer.init(env.container, { enableKeyboard: false });
    await viewer.enableGyro({ sensitivity: 1.0, sensorTimeoutMs: 5000 });

    env.emitOrientation(0, 45, 0); // comfortable ref posture
    const base = getSpherical(viewer);

    // Tilt forward/flatter (beta 45 -> 15): camera moves HIGHER over roof (phi decreases)
    for (let b = 45; b >= 15; b -= 3) env.emitOrientation(0, b, 0);
    env.stepFrames(viewer, 60);
    const overRoof = getSpherical(viewer);
    assert(overRoof.phi < base.phi - 0.25, `Expected overhead phi < ${base.phi.toFixed(2)}, got ${overRoof.phi.toFixed(2)}`);
    assert(overRoof.phi >= viewer.gyro.minPhi - 1e-5, 'Phi must stay >= minPhi');

    // Lift upright toward horizontal (beta 15 -> 85): phi increases above base toward horizon (clamped <= maxPhi)
    for (let b = 15; b <= 85; b += 5) env.emitOrientation(0, b, 0);
    env.stepFrames(viewer, 60);
    const eyeLevel = getSpherical(viewer);
    assert(eyeLevel.phi > base.phi + 0.12, `Expected upright eye-level phi > ${base.phi.toFixed(2)}, got ${eyeLevel.phi.toFixed(2)}`);
    assert(eyeLevel.phi <= viewer.gyro.maxPhi + 1e-5, 'Phi must stay strictly above ground plane');

    // Return pitch to 45 and tilt right (gamma 0 -> +25): camera theta increases
    for (let b = 85; b >= 45; b -= 5) env.emitOrientation(0, b, 0);
    env.stepFrames(viewer, 40);
    const beforeRoll = getSpherical(viewer).theta;
    for (let g = 0; g <= 25; g += 2.5) env.emitOrientation(0, 45, g);
    env.stepFrames(viewer, 60);
    const afterRollRight = getSpherical(viewer).theta;
    assert(afterRollRight > beforeRoll + 0.15, `Rolling right must increase theta (${beforeRoll.toFixed(2)} -> ${afterRollRight.toFixed(2)})`);
    viewer.dispose();
  });

  await testAsync('6. Landscape orientation (90 deg) & screen rotation resync remain jump-free', async () => {
    const env = createViewerSandbox();
    const viewer = env.Car3DViewer.init(env.container, { enableKeyboard: false });
    await viewer.enableGyro({ sensitivity: 1.0, sensorTimeoutMs: 5000 });

    env.setScreenAngle(90); // Landscape primary
    env.emitOrientation(0, 0, -45); // Comfortable 45deg tilt in landscape
    const s0 = getSpherical(viewer);
    // Tilt flatter to look down over hood (gamma -45 -> -15)
    for (let g = -45; g <= -15; g += 3) env.emitOrientation(0, 0, g);
    env.stepFrames(viewer, 60);
    const s1 = getSpherical(viewer);
    assert(s1.phi < s0.phi - 0.25, `Landscape forward tilt must decrease phi (${s0.phi.toFixed(2)} -> ${s1.phi.toFixed(2)})`);

    // Trigger screen orientation flip while preserving camera position without jump
    const beforeSwitch = viewer.camera.position.clone();
    env.setScreenAngle(0);
    env.emitOrientation(20, 60, -10);
    env.stepFrames(viewer, 1);
    const jumpDist = viewer.camera.position.distanceTo(beforeSwitch);
    assert(jumpDist < 1e-4, `Orientation flip soft resync caused jump of ${jumpDist}`);
    viewer.dispose();
  });

  await testAsync('7. Gimbal flip across beta=90deg & 360deg horizontal wrap with sensitivity=1.5 have zero sudden jumps', async () => {
    const env = createViewerSandbox();
    const viewer = env.Car3DViewer.init(env.container, { enableKeyboard: false });
    await viewer.enableGyro({ sensitivity: 1.5, sensorTimeoutMs: 5000 });

    // Gimbal flip test: (0, 82, 0) -> (0, 88, 0) -> (180, 88, 180) -> (180, 80, 180)
    env.emitOrientation(0, 82, 0);
    env.emitOrientation(0, 88, 0);
    const preFlipTheta = viewer.gyro.targetTheta;
    env.emitOrientation(180, 88, 180);
    env.emitOrientation(180, 80, 180);
    const postFlipTheta = viewer.gyro.targetTheta;
    assert(Math.abs(postFlipTheta - preFlipTheta) < 0.05, `Gimbal flip spiked theta by ${postFlipTheta - preFlipTheta}`);

    // Full 380 degree horizontal spin at alpha crossing 360 -> 0 with sensitivity = 1.5
    viewer.calibrateGyro({ silent: true });
    let prevTheta = viewer.gyro.currentTheta;
    let maxStepDeg = 0;
    for (let deg = 0; deg <= 380; deg += 5) {
      const alpha = ((deg % 360) + 360) % 360;
      env.emitOrientation(alpha, 45, 0);
      env.stepFrames(viewer, 10, 16.67);
      const stepDeg = Math.abs(viewer.gyro.currentTheta - prevTheta) * 180 / Math.PI;
      if (deg > 0) maxStepDeg = Math.max(maxStepDeg, stepDeg);
      prevTheta = viewer.gyro.currentTheta;
    }
    const totalSpinDeg = Math.abs(prevTheta - viewer.gyro.baseTheta) * 180 / Math.PI;
    assert(totalSpinDeg > 480, `380 deg * 1.5 sens should yield >480 deg total orbit, got ${totalSpinDeg.toFixed(1)}`);
    assert(maxStepDeg < 15, `Wrap jump detected: max step was ${maxStepDeg.toFixed(2)} deg`);
    viewer.dispose();
  });

  await testAsync('8. Stationary dead-zone eliminates micro-jitter & calibrateGyro zeroes delta without snap', async () => {
    const env = createViewerSandbox();
    const events = [];
    const viewer = env.Car3DViewer.init(env.container, {
      enableKeyboard: false,
      onGyroStateChange: (s) => events.push(s)
    });
    await viewer.enableGyro({ sensitivity: 1.2, sensorTimeoutMs: 5000 });
    env.emitOrientation(45, 45, 0);
    const startPos = viewer.camera.position.clone();

    // Emit sub-threshold noise (< 0.05 deg)
    for (let i = 0; i < 30; i++) {
      env.emitOrientation(45 + Math.sin(i) * 0.04, 45 + Math.cos(i) * 0.04, Math.sin(i * 2) * 0.03);
      env.stepFrames(viewer, 2);
    }
    assert(viewer.camera.position.distanceTo(startPos) < 1e-5, 'Camera shook under tiny sensor noise');

    // Orbit away intentionally
    for (let a = 45; a <= 90; a += 5) env.emitOrientation(a, 35, 0);
    env.stepFrames(viewer, 50);
    const beforeCalPos = viewer.camera.position.clone();

    // Calibrate / Recenter at tilted posture
    viewer.calibrateGyro();
    assert.strictEqual(events.includes('calibrated'), true);
    assert(viewer.camera.position.distanceTo(beforeCalPos) < 1e-6, 'calibrateGyro must not jump camera');
    assert.strictEqual(viewer.gyro.accumYaw, 0);
    assert.strictEqual(viewer.gyro.targetTheta, viewer.gyro.currentTheta);

    // Emit same held sample repeatedly: camera remains parked cleanly at calibrated angle
    for (let i = 0; i < 10; i++) env.emitOrientation(90, 35, 0);
    env.stepFrames(viewer, 20);
    assert(viewer.camera.position.distanceTo(beforeCalPos) < 0.02, 'Camera drifted after calibration');

    // Reset orientation returns car to defaultAngle 137 smoothly & calibrates
    viewer.resetGyroOrientation();
    assert.strictEqual(events.includes('reset'), true);
    assert.strictEqual(viewer.currentAngle, 137);
    viewer.dispose();
  });

  await testAsync('9. Invert H/V (jump-free toggle), manual OrbitControls handover, zoom preservation & DeviceMotion fallback', async () => {
    const env = createViewerSandbox();
    const viewer = env.Car3DViewer.init(env.container, { enableKeyboard: false });
    await viewer.enableGyro({ sensitivity: 1.0, sensorTimeoutMs: 5000 });
    env.emitOrientation(0, 45, 0);

    // Pan slightly then enable Invert H: must NOT snap!
    for (let a = 0; a >= -20; a -= 4) env.emitOrientation((a + 360) % 360, 45, 0);
    env.stepFrames(viewer, 40);
    const preInvPos = viewer.camera.position.clone();
    viewer.setGyroSettings({ invertH: true, invertV: true });
    env.stepFrames(viewer, 5);
    assert(viewer.camera.position.distanceTo(preInvPos) < 1e-5, 'Toggling invert must not snap camera');

    // With invertH: true, rolling right now DECREASES theta instead of increasing
    const beforeInvRoll = getSpherical(viewer).theta;
    for (let g = 0; g <= 25; g += 5) env.emitOrientation(340, 45, g);
    env.stepFrames(viewer, 50);
    assert(getSpherical(viewer).theta < beforeInvRoll - 0.1, 'invertH must reverse horizontal orbit');

    // Manual OrbitControls drag handover
    viewer.controls.trigger('start');
    assert.strictEqual(viewer.gyro.isUserInteracting, true);
    viewer.camera.position.set(0, 2.5, 4.2); // User dragged camera to front
    viewer.controls.trigger('end');
    assert.strictEqual(viewer.gyro.isUserInteracting, false);
    const postDragPos = viewer.camera.position.clone();
    env.stepFrames(viewer, 20);
    assert(viewer.camera.position.distanceTo(postDragPos) < 1e-4, 'Gyro must not snap back after manual drag');

    // Zoom radius preservation while gyro orbits
    const zoomTarget = viewer.controls.target;
    const zoomDir = viewer.camera.position.clone().sub(zoomTarget).normalize();
    viewer.camera.position.copy(zoomTarget).addScaledVector(zoomDir, 3.8); // Simulate wheel zoom in to 3.8m
    for (let g = 25; g >= 0; g -= 5) env.emitOrientation(340, 45, g);
    env.stepFrames(viewer, 30);
    assert(Math.abs(getSpherical(viewer).r - 3.8) < 0.05, `Zoom radius must remain ~3.8m, got ${getSpherical(viewer).r.toFixed(2)}`);

    // Disable & cleanup listeners
    viewer.disableGyro();
    assert.strictEqual(viewer.getGyroState().isEnabled, false);
    assert.deepStrictEqual(env.getListenerCounts(), { oriHandlerCount: 0, motHandlerCount: 0, orientChangeCount: 0 });
    viewer.dispose();

    // DeviceMotion rotationRate fallback when deviceorientation doesn't fire
    const envMot = createViewerSandbox({ withOriAPI: false, withMotAPI: true });
    const vMot = envMot.Car3DViewer.init(envMot.container, { enableKeyboard: false });
    assert.strictEqual(await vMot.enableGyro({ sensorTimeoutMs: 5000 }), true);
    envMot.emitMotion(30, 0, -45); // first sample activates fallback
    assert.strictEqual(vMot.getGyroState().isActive, true);
    vMot.dispose();
  });

  // The gyro-driven "AR Live" camera overlay (js/ar-adapter.js) was retired in favour of real WebXR AR on
  // /ar/:vehicleId; gyro control remains a 3D showroom feature (car-3d-viewer.js), checked here.
  test('10. Showroom gyro controls remain wired after the AR engine replacement', () => {
    const appCode = fs.readFileSync(path.resolve('js/app.js'), 'utf8');
    const htmlCode = fs.readFileSync(path.resolve('index.html'), 'utf8');
    assert(appCode.includes('btn-vr-gyro'), 'app.js must include VR Showroom Gyro button');
    assert(!htmlCode.includes('js/ar-adapter.js'), 'index.html must not load the retired AR adapter');
    assert(htmlCode.includes('js/car-3d-viewer.js?v=20.0'), 'index.html cache buster must be updated to v=20.0');
  });

  await testAsync('11. AR World-Lock Motion Tracking keeps car stationary in world space when looking around', async () => {
    const env = createViewerSandbox();
    const events = [];
    const viewer = env.Car3DViewer.init(env.container, {
      arMode: true,
      transparent: true,
      enableKeyboard: false,
      onGyroStateChange: (s, info) => events.push({ s, info })
    });

    // AR mode defaults: world_lock, 1.0x sensitivity, 52deg FOV, floor pan enabled
    assert.strictEqual(viewer.getGyroState().trackingMode, 'world_lock');
    assert.strictEqual(viewer.getGyroState().sensitivity, 1.0);
    assert.strictEqual(viewer.camera.fov, 52);
    assert.strictEqual(viewer.controls.enablePan, true);

    await viewer.enableGyro({ sensorTimeoutMs: 5000 });
    env.emitOrientation(0, 70, 0); // Hold phone at ~70deg pitch looking at car
    viewer.camera.updateMatrixWorld();

    const carAnchor = new THREE.Vector3(0, 0.6, 0);
    const camPos0 = viewer.camera.position.clone();
    const shadowPos0 = viewer.shadowMesh.position.clone();
    const ndc0 = carAnchor.clone().project(viewer.camera);
    assert(Math.abs(ndc0.x) < 0.05 && Math.abs(ndc0.y) < 0.05, `Initial anchored car should be centered, got (${ndc0.x.toFixed(2)}, ${ndc0.y.toFixed(2)})`);

    // 1. Stationary noise (<0.05 deg): car NDC must stay completely steady (zero jitter)
    for (let i = 0; i < 20; i++) {
      env.emitOrientation(Math.sin(i) * 0.03, 70 + Math.cos(i) * 0.03, 0);
      env.stepFrames(viewer, 2);
    }
    const ndcStill = carAnchor.clone().project(viewer.camera);
    assert(Math.hypot(ndcStill.x - ndc0.x, ndcStill.y - ndc0.y) < 1e-4, 'World-lock car shook under stationary sensor tremor');

    // 2. Turn phone RIGHT 30 deg (alpha 0 -> 330): camera looks right, car stays parked -> shifts LEFT on screen
    for (let a = 0; a >= -30; a -= 3) {
      env.emitOrientation((a + 360) % 360, 70, 0);
    }
    env.stepFrames(viewer, 60);
    assert(viewer.camera.position.distanceTo(camPos0) < 1e-5, 'Camera world position should remain anchored');
    assert(viewer.shadowMesh.position.distanceTo(shadowPos0) < 1e-5, 'Ground anchor shadow must remain stationary in world space');
    const ndcRight30 = carAnchor.clone().project(viewer.camera);
    assert(ndcRight30.x < -0.65, `Turning right 30 deg must leave stationary car on left side of screen (ndc.x=${ndcRight30.x.toFixed(2)})`);

    // 3. Turn phone RIGHT 60 deg (alpha 330 -> 300): car moves completely off-screen left!
    for (let a = -30; a >= -60; a -= 3) {
      env.emitOrientation((a + 360) % 360, 70, 0);
    }
    env.stepFrames(viewer, 60);
    const ndcRight60 = carAnchor.clone().project(viewer.camera);
    assert(ndcRight60.x < -1.1, `Turning right 60 deg must pan car completely out of frame (ndc.x=${ndcRight60.x.toFixed(2)})`);

    // 4. Turn back to 0 deg (with settled sensor events) -> car returns directly to original centered spot
    for (let a = -60; a <= 0; a += 4) {
      env.emitOrientation((a + 360) % 360, 70, 0);
    }
    for (let s = 0; s < 6; s++) env.emitOrientation(0, 70, 0);
    env.stepFrames(viewer, 60);
    const ndcBack = carAnchor.clone().project(viewer.camera);
    assert(Math.hypot(ndcBack.x, ndcBack.y) < 0.03, `Returning phone to 0 deg must re-center car cleanly (${ndcBack.x.toFixed(3)}, ${ndcBack.y.toFixed(3)})`);

    // 5. Tilt phone UP +30 deg toward ceiling (beta 70 -> 100): car stays parked on floor -> drops off bottom edge
    for (let b = 70; b <= 100; b += 3) {
      env.emitOrientation(0, b, 0);
    }
    for (let s = 0; s < 6; s++) env.emitOrientation(0, 100, 0);
    env.stepFrames(viewer, 60);
    const ndcUp30 = carAnchor.clone().project(viewer.camera);
    assert(ndcUp30.y < -0.9, `Tilting up toward ceiling must drop floor-anchored car down (ndc.y=${ndcUp30.y.toFixed(2)})`);

    // Tilt back to 70 deg: car returns to center
    for (let b = 100; b >= 70; b -= 3) {
      env.emitOrientation(0, b, 0);
    }
    for (let s = 0; s < 6; s++) env.emitOrientation(0, 70, 0);
    env.stepFrames(viewer, 60);
    const ndcRestored = carAnchor.clone().project(viewer.camera);
    assert(Math.hypot(ndcRestored.x, ndcRestored.y) < 0.03, `Restoring pitch must re-center car (${ndcRestored.x.toFixed(3)}, ${ndcRestored.y.toFixed(3)})`);
    viewer.dispose();
  });

  await testAsync('12. World-Lock Recenter brings parked car back, Invert/Sensitivity never snap, & Mode switching is jump-free', async () => {
    const env = createViewerSandbox();
    const viewer = env.Car3DViewer.init(env.container, { arMode: true, enableKeyboard: false });
    await viewer.enableGyro({ sensorTimeoutMs: 5000 });
    env.emitOrientation(40, 65, 0);

    const carAnchor = new THREE.Vector3(0, 0.6, 0);

    // Look 45 deg LEFT away from car (alpha 40 -> 85)
    for (let a = 40; a <= 85; a += 5) env.emitOrientation(a, 65, 0);
    env.stepFrames(viewer, 60);
    const ndcAway = carAnchor.clone().project(viewer.camera);
    assert(ndcAway.x > 0.9, `Looking left 45 deg should place stationary car past right edge (ndc.x=${ndcAway.x.toFixed(2)})`);

    // Tweak sensitivity + invertH while looking away -> MUST NOT snap camera!
    const preSettingQuat = viewer.camera.quaternion.clone();
    viewer.setGyroSettings({ sensitivity: 1.5, invertH: true });
    env.stepFrames(viewer, 5);
    assert(viewer.camera.quaternion.angleTo(preSettingQuat) < 1e-4, 'Changing settings in world_lock must not snap camera');

    // Explicit Recenter ("Neo lại trước mặt") brings parked car cleanly back to center & anchors new heading (alpha=85)
    viewer.calibrateGyro();
    const ndcRecentered = carAnchor.clone().project(viewer.camera);
    assert(Math.hypot(ndcRecentered.x, ndcRecentered.y) < 0.03, `Explicit calibrateGyro must recenter car to view (${ndcRecentered.x.toFixed(3)}, ${ndcRecentered.y.toFixed(3)})`);

    // Test inverted horizontal response after calibrate: turning RIGHT now rotates view LEFT -> car shifts LEFT or RIGHT oppositely
    // Wait: normally turning right shifts car LEFT (ndc.x < 0); with invertH:true, turning right (alpha 85 -> 55) rotates cam LEFT -> car shifts RIGHT (ndc.x > 0)
    viewer.setGyroSettings({ sensitivity: 1.0, invertH: true });
    for (let a = 85; a >= 55; a -= 3) env.emitOrientation(a, 65, 0);
    env.stepFrames(viewer, 60);
    const ndcInverted = carAnchor.clone().project(viewer.camera);
    assert(ndcInverted.x > 0.5, `invertH in world_lock must flip horizontal pan (ndc.x=${ndcInverted.x.toFixed(2)})`);

    // Switch world_lock -> orbit seamlessly with zero camera jump
    const preSwitchQuat = viewer.camera.quaternion.clone();
    const preSwitchPos = viewer.camera.position.clone();
    viewer.setGyroTrackingMode('orbit');
    assert.strictEqual(viewer.getGyroState().trackingMode, 'orbit');
    env.stepFrames(viewer, 5);
    assert(viewer.camera.position.distanceTo(preSwitchPos) < 1e-4, 'Switching world_lock -> orbit must not jump camera position');
    assert(viewer.camera.quaternion.angleTo(preSwitchQuat) < 1e-4, 'Switching world_lock -> orbit must not jump camera quaternion');

    // Roll/tilt in orbit mode still orbits car around spherical axes
    viewer.setGyroSettings({ invertH: false });
    const theta0 = getSpherical(viewer).theta;
    for (let g = 0; g <= 25; g += 5) env.emitOrientation(55, 65, g);
    env.stepFrames(viewer, 50);
    assert(getSpherical(viewer).theta > theta0 + 0.12, 'Switched orbit mode must orbit around car smoothly');

    viewer.dispose();
  });

  console.log(`\n======================================================`);
  console.log(`GYROSCOPE TEST SUITE RESULTS: ${passed}/${passed + failed} Passed`);
  console.log(`======================================================\n`);
  if (failed > 0) process.exit(1);
})();
