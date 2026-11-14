// js/vehicle-media-view.js — Product videos on the vehicle detail page (PLAN.md T3.4)
// Renders an optional `videos: [{ url, title, poster }]` field of a vehicle record under the image gallery.
// Only self-hosted files under assets/ are played (no external hosts: PLAN R-9). Nothing is rendered when a vehicle has
// no videos, so existing pages are unchanged.

(function (root) {
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  const SELF_HOSTED = /^(?:\/)?assets\/[A-Za-z0-9_\-./]+\.(mp4|webm)$/i;
  const SELF_HOSTED_IMAGE = /^(?:\/)?assets\/[A-Za-z0-9_\-./]+\.(jpg|jpeg|png|webp)$/i;

  function playableVideos(car) {
    const list = car && Array.isArray(car.videos) ? car.videos : [];
    return list
      .map(v => (typeof v === 'string' ? { url: v } : v))
      .filter(v => v && typeof v.url === 'string' && SELF_HOSTED.test(v.url) && !v.url.includes('..'))
      .slice(0, 4);
  }

  function renderVideosHtml(car) {
    const videos = playableVideos(car);
    if (videos.length === 0) return '';
    return `
      <div class="vehicle-video-strip" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap:10px; margin:12px 0;">
        ${videos.map(v => `
          <figure style="margin:0; background:#0F172A; border-radius:12px; overflow:hidden; border:1px solid #E2E8F0;">
            <video controls preload="metadata" playsinline style="width:100%; display:block; aspect-ratio:16/9; background:#0F172A;"${v.poster && SELF_HOSTED_IMAGE.test(v.poster) ? ` poster="${esc(v.poster)}"` : ''}>
              <source src="${esc(v.url)}" type="video/${/\.webm$/i.test(v.url) ? 'webm' : 'mp4'}">
            </video>
            ${v.title ? `<figcaption style="padding:6px 10px; font-size:12px; color:#E2E8F0;">${esc(v.title)}</figcaption>` : ''}
          </figure>`).join('')}
      </div>`;
  }

  const api = { renderVideosHtml, playableVideos };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SigmaVehicleMediaView = api;
})(typeof window !== 'undefined' ? window : null);
