// js/ar/core/emitter.js — minimal synchronous event emitter used across the AR engine.

export class Emitter {
  constructor() {
    this._handlers = new Map();
  }

  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const set = this._handlers.get(type);
    if (set) set.delete(fn);
  }

  emit(type, payload) {
    const set = this._handlers.get(type);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch (err) {
        // A faulty listener must not break the render loop or other listeners.
        console.error(`[AR] listener for "${type}" failed:`, err);
      }
    }
  }

  removeAllListeners() {
    this._handlers.clear();
  }
}
