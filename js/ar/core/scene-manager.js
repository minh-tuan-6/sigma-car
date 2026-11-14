// js/ar/core/scene-manager.js — renderer, camera, studio lighting and render loop for the full-screen vehicle view.
// This is a 3D view of the model, never a camera view: the AR camera is AR Quick Look's (native ARKit).

import {
  WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight, Mesh, PlaneGeometry,
  ShadowMaterial, PMREMGenerator, Color, ACESFilmicToneMapping, SRGBColorSpace, PCFSoftShadowMap, Group, Clock
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Emitter } from './emitter.js';

export class SceneManager extends Emitter {
  constructor({ container, background = 0x0b1220 }) {
    super();
    this.container = container;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.domElement.className = 'ar-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene = new Scene();
    this.scene.background = new Color(background);
    this.camera = new PerspectiveCamera(35, 1, 0.05, 200);
    this.camera.position.set(6, 2.4, 6);

    // Image-based lighting so paint and chrome reflect like they will under Quick Look's environment lighting.
    const pmrem = new PMREMGenerator(this.renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTexture;

    this.hemi = new HemisphereLight(0xffffff, 0x8899aa, 0.5);
    this.sun = new DirectionalLight(0xffffff, 1.5);
    this.sun.position.set(4, 8, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 30;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    // The anchor stays at the identity transform: the USDZ exporter reads world matrices from the model.
    this.anchor = new Group();
    this.anchor.name = 'SigmaVehicleAnchor';
    this.scene.add(this.anchor);
    this.shadowCatcher = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new ShadowMaterial({ opacity: 0.35 }));
    this.shadowCatcher.receiveShadow = true;
    this.shadowCatcher.renderOrder = -1;
    this.scene.add(this.shadowCatcher);

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
    this.resize();
  }

  /** Size the shadow catcher and shadow frustum to the vehicle footprint. */
  fitToVehicle(sizeMeters) {
    const L = Math.max(1, sizeMeters.length || 4.5);
    const W = Math.max(1, sizeMeters.width || 1.9);
    this.shadowCatcher.scale.set(W * 1.8, 1, L * 1.4);
    const half = Math.max(L, W) * 0.75;
    Object.assign(this.sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.emit('resize', { width: w, height: h });
  }

  get viewport() {
    const el = this.renderer.domElement;
    return { width: el.clientWidth || window.innerWidth, height: el.clientHeight || window.innerHeight };
  }

  /** Starts (or replaces) the single render loop. fn(dt) is called before each render. */
  start(fn) {
    this._loop = fn;
    if (this._running) return;
    this._running = true;
    this.clock.start();
    this.renderer.setAnimationLoop(() => {
      if (this.contextLost) return;
      const dt = this.clock.getDelta();
      if (this._loop) this._loop(dt);
      this.renderer.render(this.scene, this.camera);
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
