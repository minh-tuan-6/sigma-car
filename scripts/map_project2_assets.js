const fs = require('fs');
const path = require('path');

const p2Dir = path.join(__dirname, '..', 'assets', 'project2');
const assetsDir = path.join(__dirname, '..', 'assets');

// Helper to copy if source exists
function copyAsset(srcName, destName) {
  const src = path.join(p2Dir, srcName);
  const dest = path.join(assetsDir, destName);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied ${srcName} -> ${destName}`);
  }
}

// Map high-value assets
copyAsset('Gara_cua_toi_-_SIGMACAR_1.jpg', 'garage-hero-card.jpg');
copyAsset('Gara_cua_toi_-_SIGMACAR_2.jpg', 'garage-car-detail.jpg');
copyAsset('Gara_cua_toi_-_SIGMACAR_3.jpg', 'car-thumb-s5.jpg');
copyAsset('Gara_cua_toi_-_SIGMACAR_4.jpg', 'car-thumb-gt.jpg');
copyAsset('Lich_hen___Lai_thu_-_SIGMACAR_0.jpg', 'appointments-card-banner.jpg');
copyAsset('Bao_mat___Quyen_rieng_tu_2.jpg', 'security-banner.jpg');
copyAsset('Cai__at_Thong_bao_0.jpg', 'notification-banner.jpg');
copyAsset('_on_hang_cua_toi_-_SIGMACAR_7.jpg', 'orders-banner-card.jpg');
copyAsset('Main_Content_Redesign_2.jpg', 'profile-main-hero.jpg');

console.log('Project 2 assets mapping complete.');
