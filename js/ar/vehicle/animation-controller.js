// js/ar/vehicle/animation-controller.js — Vehicle Animation Controller.
// Plays clips that actually exist in the GLB. Door controls are enabled only when the manifest names a
// clip AND that clip is present in the loaded file.

import { AnimationMixer, LoopOnce } from 'three';

export class AnimationController {
  /**
   * @param {THREE.Object3D} root
   * @param {THREE.AnimationClip[]} clips
   * @param {{ openDoors?: string|null, closeDoors?: string|null }} mapping
   */
  constructor(root, clips = [], mapping = {}) {
    this.root = root;
    this.clips = Array.isArray(clips) ? clips : [];
    this.clipNames = this.clips.map(c => c.name);
    this.mixer = this.clips.length ? new AnimationMixer(root) : null;
    this.openClip = mapping.openDoors ? this.clips.find(c => c.name === mapping.openDoors) || null : null;
    this.closeClip = mapping.closeDoors ? this.clips.find(c => c.name === mapping.closeDoors) || null : null;
    this.missing = [mapping.openDoors && !this.openClip ? mapping.openDoors : null, mapping.closeDoors && !this.closeClip ? mapping.closeDoors : null].filter(Boolean);
    this.doorsOpen = false;
    this._active = null;
  }

  get capabilities() {
    return { doors: Boolean(this.openClip), clipNames: this.clipNames.slice(), missingClips: this.missing.slice() };
  }

  /** Opens/closes doors. Without a dedicated close clip the open clip is played in reverse. */
  toggleDoors() {
    if (!this.openClip || !this.mixer) return false;
    const opening = !this.doorsOpen;
    if (this._active) this._active.stop();
    let action;
    if (opening || this.closeClip) {
      action = this.mixer.clipAction(opening ? this.openClip : this.closeClip);
      action.reset();
      action.timeScale = 1;
    } else {
      action = this.mixer.clipAction(this.openClip);
      action.paused = false;
      action.timeScale = -1;
      action.time = this.openClip.duration;
    }
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    this._active = action;
    this.doorsOpen = opening;
    return true;
  }

  update(dt) {
    if (this.mixer && dt > 0) this.mixer.update(Math.min(dt, 0.1));
  }

  dispose() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.root);
    }
    this.mixer = null;
  }
}
