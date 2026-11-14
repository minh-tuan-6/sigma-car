// js/ar/core/scene-manager.js — Vehicle Scene Manager (renderer, camera, lighting, render loop).
// One WebGLRenderer serves both the 3D preview and the WebXR session; exactly one animation loop runs.

import {
  WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight, Mesh, PlaneGeometry,
  ShadowMaterial, PMREMGenerator, Color, ACESFilmicToneMapping, SRGBColorSpace, PCFSoftShadowMap, Group, Clock
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Emitter } from './emitter.js';

const PREVIEW_BG = new Color(0xe9eef5);

export class SceneManager extends Emitter {
  constructor({ container }) {
    super();
    this.container = container;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.xr.enabled = true;
    this.renderer.domElement.className = 'ar-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(40, 1, 0.05, 200);
    this.camera.position.set(6, 2.4, 6);

    // Environment lighting for PBR materials (paint/chrome reflections) in preview and as AR fallback.
    const pmrem = new PMREMGenerator(this.renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTexture;

    this.hemi = new HemisphereLight(0xffffff, 0x8899aa, 0.6);
    this.sun = new DirectionalLight(0xffffff, 1.6);
    this.sun.position.set(4, 8, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 30;
    const s = 5;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    // Vehicle anchor: placement transforms this group; the shadow catcher travels with the vehicle.
    this.anchor = new Group();
    this.anchor.name = 'SigmaVehicleAnchor';
    this.shadowCatcher = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new ShadowMaterial({ opacity: 0.32 }));
    this.shadowCatcher.receiveShadow = true;
    this.shadowCatcher.renderOrder = -1;
    this.anchor.add(this.shadowCatcher);
    this.scene.add(this.anchor);

    this.estimatedLight = null;
    this.clock = new Clock();
    this._loop = null;
    this._running = false;
    this.contextLost = false;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    const canvas = this.renderer.domElement;
    this._onLost = (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.emit('context-lost');
    };
    this._onRestored = () => {
      this.contextLost = false;
      this.emit('context-restored');
    };
    canvas.addEventListener('webglcontextlost', this._onLost);
    canvas.addEventListener('webglcontextrestored', this._onRestored);
    this.setPreviewMode(true);
    this.resize();
  }

  /** Preview = studio background + env lighting. AR = transparent (camera passthrough by the XR compositor). */
  setPreviewMode(preview) {
    this.scene.background = preview ? PREVIEW_BG : null;
    if (!this.estimatedLight) this.scene.environment = this.envTexture;
  }

  /** Size the shadow catcher and shadow frustum to the vehicle footprint. */
  fitToVehicle(sizeMeters) {
    const L = Math.max(1, sizeMeters.length || 4.5);
    const W = Math.max(1, sizeMeters.width || 1.9);
    this.shadowCatcher.scale.set(W * 1.6, 1, L * 1.3);
    const half = Math.max(L, W) * 0.75;
    Object.assign(this.sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  /** Keep the sun & its shadow frustum centred on the vehicle wherever it is placed. */
  followAnchor() {
    const p = this.anchor.position;
    this.sun.position.set(p.x + 4, p.y + 8, p.z + 3);
    this.sun.target.position.copy(p);
  }

  /** WebXR light estimation (Chromium/ARCore). Falls back to static env lighting when unavailable. */
  async enableLightEstimation(enabledFeatures) {
    if (!enabledFeatures.includes('light-estimation') || this.estimatedLight) return false;
    const { XREstimatedLight } = await import('three/addons/webxr/XREstimatedLight.js');
    const light = new XREstimatedLight(this.renderer);
    light.addEventListener('estimationstart', () => {
      this.scene.add(light);
      this.hemi.visible = false;
      if (light.environment) this.scene.environment = light.environment;
      this.emit('light-estimation', { active: true });
    });
    light.addEventListener('estimationend', () => {
      this.scene.remove(light);
      this.hemi.visible = true;
      this.scene.environment = this.envTexture;
      this.emit('light-estimation', { active: false });
    });
    this.estimatedLight = light;
    return true;
  }

  disableLightEstimation() {
    if (!this.estimatedLight) return;
    this.scene.remove(this.estimatedLight);
    if (typeof this.estimatedLight.dispose === 'function') this.estimatedLight.dispose();
    this.estimatedLight = null;
    this.hemi.visible = true;
    this.scene.environment = this.envTexture;
  }

  resize() {
    if (this.renderer.xr.isPresenting) return; // XR owns the framebuffer size
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  get viewport() {
    const el = this.renderer.domElement;
    return { width: el.clientWidth || window.innerWidth, height: el.clientHeight || window.innerHeight };
  }

  /** Camera to use for projections: the XR view camera while presenting. */
  get activeCamera() {
    if (this.renderer.xr.isPresenting) {
      const xrCam = this.renderer.xr.getCamera();
      return (xrCam.cameras && xrCam.cameras[0]) || xrCam;
    }
    return this.camera;
  }

  /** Starts (or replaces) the single render loop. fn(dt, time, frame) is called before each render. */
  start(fn) {
    this._loop = fn;
    if (this._running) return;
    this._running = true;
    this.clock.start();
    this.renderer.setAnimationLoop((time, frame) => {
      if (this.contextLost) return;
      const dt = this.clock.getDelta();
      if (this._loop) this._loop(dt, time, frame);
      this.renderer.render(this.scene, this.camera);
      this.emit('after-render', { frame });
    });
  }

  stop() {
    this._running = false;
    this.renderer.setAnimationLoop(null);
  }

  get running() {
    return this._running;
  }

  dispose() {
    this.stop();
    this.disableLightEstimation();
    window.removeEventListener('resize', this._onResize);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this._onLost);
    canvas.removeEventListener('webglcontextrestored', this._onRestored);
    this.shadowCatcher.geometry.dispose();
    this.shadowCatcher.material.dispose();
    this.envTexture.dispose();
    this.renderer.dispose();
    canvas.remove();
    this.removeAllListeners();
  }
}
