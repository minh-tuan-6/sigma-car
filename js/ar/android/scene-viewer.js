// js/ar/android/scene-viewer.js — Google Scene Viewer (ARCore) launcher for Android.
//
// Scene Viewer contract (developers.google.com/ar/develop/scene-viewer):
//   intent://arvr.google.com/scene-viewer/1.0?file=<public https glTF/GLB>&mode=ar_preferred …
//     #Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;
//     S.browser_fallback_url=<url>;end;
//   * `file` must be a publicly reachable https URL (Google's app downloads it; blob: / localhost cannot work);
//   * mode=ar_preferred opens AR when ARCore is available, otherwise Scene Viewer's 3D view;
//   * resizable=false keeps the vehicle at real-world scale; `title` and `link` label the viewer;
//   * the fallback URL is opened by Chrome when the Google app / ARCore is missing.
// It must be opened from a user gesture.

export const SCENE_VIEWER_PACKAGE = 'com.google.android.googlequicksearchbox';

/**
 * @param {string} glbUrl  absolute https URL of the GLB
 * @param {{ title?: string, link?: string, fallbackUrl?: string, resizable?: boolean }} [opts]
 */
export function buildSceneViewerIntent(glbUrl, { title = '', link = '', fallbackUrl = '', resizable = false } = {}) {
  if (typeof glbUrl !== 'string' || !/^https:\/\//i.test(glbUrl)) {
    throw new Error('Scene Viewer requires a public https:// GLB URL');
  }
  const p = new URLSearchParams();
  p.set('file', glbUrl);
  p.set('mode', 'ar_preferred');
  if (!resizable) p.set('resizable', 'false');
  if (title) p.set('title', String(title).slice(0, 80));
  if (link && /^https:\/\//i.test(link)) p.set('link', link);
  const fb = fallbackUrl && /^https?:\/\//i.test(fallbackUrl) ? `S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};` : '';
  return `intent://arvr.google.com/scene-viewer/1.0?${p.toString()}#Intent;scheme=https;package=${SCENE_VIEWER_PACKAGE};action=android.intent.action.VIEW;${fb}end;`;
}

/** Opens Scene Viewer. MUST be called synchronously from a tap. */
export function launchSceneViewer(intentUrl, { window: win = window } = {}) {
  win.location.href = intentUrl;
}
