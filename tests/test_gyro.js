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

  test('10. AR Adapter exports & App UI controls match exact requirements', () => {
    const adapterCode = fs.readFileSync(path.resolve('js/ar-adapter.js'), 'utf8');
    const appCode = fs.readFileSync(path.resolve('js/app.js'), 'utf8');
    const htmlCode = fs.readFileSync(path.resolve('index.html'), 'utf8');

    assert(adapterCode.includes('resetGyroOrientation'), 'ar-adapter.js must expose resetGyroOrientation');
    assert(adapterCode.includes('calibrateGyro'), 'ar-adapter.js must expose calibrateGyro');
    assert(appCode.includes('btn-ar-dock-gyro'), 'app.js must include AR dock Gyro button');
    assert(appCode.includes('btn-vr-gyro'), 'app.js must include VR Showroom Gyro button');
    assert(appCode.includes('ar-gyro-status-indicator'), 'app.js must include AR Gyro status indicator');
    assert(appCode.includes('GYRO ACTIVE'), 'app.js must display GYRO ACTIVE status');
    assert(appCode.includes('Motion Tracking Enabled'), 'app.js must display Motion Tracking Enabled status');
    assert(appCode.includes('GYRO NOT AVAILABLE'), 'app.js must display GYRO NOT AVAILABLE status');
    assert(appCode.includes('MOTION PERMISSION REQUIRED'), 'app.js must display MOTION PERMISSION REQUIRED status');
    assert(appCode.includes('Invert Horizontal') && appCode.includes('Invert Vertical'), 'app.js must include Invert controls');
    assert(htmlCode.includes('js/car-3d-viewer.js?v=18.0'), 'index.html cache buster must be updated to v=18.0');
  });

  console.log(`\n======================================================`);
  console.log(`GYROSCOPE TEST SUITE RESULTS: ${passed}/${passed + failed} Passed`);
  console.log(`======================================================\n`);
  if (failed > 0) process.exit(1);
})();
