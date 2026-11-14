// tests/unit/vehicle_media_view.test.js
// PLAN.md T3.4 — product videos: self-hosted only, escaped, nothing rendered without videos.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { renderVideosHtml, playableVideos } = require('../../js/vehicle-media-view.js');

describe('T3.4 vehicle media view', () => {
  it('renders nothing for vehicles without videos (existing pages unchanged)', () => {
    assert.equal(renderVideosHtml({}), '');
    assert.equal(renderVideosHtml({ videos: [] }), '');
  });

  it('accepts only self-hosted mp4/webm under assets/', () => {
    const list = playableVideos({ videos: [
      'assets/videos/vf9-tour.mp4',
      { url: '/assets/videos/x.webm', title: 'Tour' },
      'https://cdn.example.com/v.mp4',
      'assets/../server.js',
      'javascript:alert(1)',
      'assets/videos/clip.mov'
    ] });
    assert.deepEqual(list.map(v => v.url), ['assets/videos/vf9-tour.mp4', '/assets/videos/x.webm']);
  });

  it('escapes titles and ignores external posters', () => {
    const html = renderVideosHtml({ videos: [{ url: 'assets/v.mp4', title: '<img onerror=x>', poster: 'https://evil.test/p.jpg' }] });
    assert.ok(html.includes('&lt;img onerror=x&gt;'));
    assert.ok(!html.includes('evil.test'));
    assert.ok(html.includes('<video controls'));
  });
});
