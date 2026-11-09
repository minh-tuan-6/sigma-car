// scripts/deploy_assets.js
// Deploy and map all extracted design assets from "Dự án thương mại điện tử" to assets/
const fs = require('fs');
const path = require('path');

const imgDir = path.join(__dirname, '..', 'assets', 'images');
const assetsDir = path.join(__dirname, '..', 'assets');
const catalogDir = path.join(assetsDir, 'catalog');

if (!fs.existsSync(catalogDir)) fs.mkdirSync(catalogDir, { recursive: true });

function copyAsset(srcFileName, targetFileName) {
  const src = path.join(imgDir, srcFileName);
  const dest = path.join(assetsDir, targetFileName);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`[DEPLOY] ${srcFileName} -> assets/${targetFileName}`);
    return true;
  } else {
    console.warn(`[WARN] Source not found: ${srcFileName}`);
    return false;
  }
}

const mappings = [
  // Marketing & Hero Banners
  // { src: 'SIGMACAR_-_D_ng_xe_m_i_44.jpg', dest: 'banner-new-cars.jpg' }, // Avoid noise mask
  { src: 'SIGMACAR_-_D_ng_xe_m_i_8.jpg', dest: 'banner-new-cars-sub.jpg' },
  { src: 'SIGMACAR_-_Xe_qua_s__d_ng_ch_n_10.jpg', dest: 'banner-certified.jpg' },
  { src: 'SIGMACAR_-_Xe_qua_s__d_ng_ch_n_1.jpg', dest: 'banner-certified-warranty.jpg' },
  { src: 'SIGMACAR_-_Xe_qua_s__d_ng_ch_n_2.jpg', dest: 'cert-inspection-badge.jpg' },
  { src: '__ng_k__l_i_th__-_Section_4.jpg', dest: 'banner-testdrive.jpg' },
  { src: '__ng_k__l_i_th__-_Section_11.jpg', dest: 'car-testdrive-feature.jpg' },
  { src: 'SIGMACAR_-_So_s_nh_xe_0.jpg', dest: 'banner-compare.jpg' },
  { src: 'SIGMACAR_-_So_s_nh_xe__Tone_Xa_4.jpg', dest: 'interior-compare-blue.jpg' },
  { src: 'SIGMACAR_-_AI_T__V_n_2.jpg', dest: 'banner-ai-advisor.jpg' },
  { src: 'SIGMACAR_-_AI_T__V_n_12.jpg', dest: 'ai-garage-scan.jpg' },
  { src: 'SIGMACAR_-_Trang_c__nh_n_5.jpg', dest: 'banner-profile-garage.jpg' },
  { src: 'SIGMACAR_-_Trang_c__nh_n_6.jpg', dest: 'banner-profile-stats.jpg' },

  // Dashboard Banners & Visuals
  { src: 'Seller_Dashboard_-_Overview_10.jpg', dest: 'banner-seller-overview.jpg' },
  { src: 'Seller_Dashboard_-_Overview_12.jpg', dest: 'seller-overview-chart.jpg' },
  { src: 'Seller_Dashboard_-_Branch_Inve_9.jpg', dest: 'banner-seller-inventory.jpg' },
  { src: 'Seller_Dashboard_-_Order_Manag_2.jpg', dest: 'banner-seller-orders.jpg' },
  { src: 'Seller_Dashboard_-_Service___A_9.jpg', dest: 'banner-seller-service.jpg' },
  { src: 'Seller_Dashboard_-_Service___A_13.jpg', dest: 'seller-service-graphic.jpg' },
  { src: 'Seller_Dashboard_-_Test_Drive__16.jpg', dest: 'banner-seller-testdrive.jpg' },
  { src: 'Seller_Dashboard_-_CRM___AI_Le_3.jpg', dest: 'banner-seller-crm.jpg' },

  // Vehicle Detail Gallery & Engineering Visuals
  { src: 'SIGMACAR_-_Vehicle_Detail_Page_10.jpg', dest: 'detail-gallery-1.jpg' }, // side profile
  { src: 'SIGMACAR_-_Vehicle_Detail_Page_11.jpg', dest: 'detail-gallery-2.jpg' }, // rear 3/4
  { src: 'SIGMACAR_-_Vehicle_Detail_Page_12.jpg', dest: 'detail-gallery-3.jpg' }, // front detail
  { src: 'SIGMACAR_-_Vehicle_Detail_Page_4.jpg', dest: 'detail-gallery-4.jpg' },  // interior cockpit
  { src: 'SIGMACAR_-_Vehicle_Detail_Page_14.jpg', dest: 'detail-gallery-5.jpg' }, // wheel & brake
  { src: 'SIGMACAR_-_Vehicle_Detail_Page_19.jpg', dest: 'detail-hero-render.jpg' },
  { src: 'SIGMACAR_-_Vehicle_Detail_Page_3.jpg', dest: 'detail-cockpit.jpg' },
  { src: 'SIGMACAR_-_Vehicle_Detail_Page_5.jpg', dest: 'detail-battery.jpg' },
  { src: 'SIGMACAR_-_Vehicle_Detail_Page_7.jpg', dest: 'detail-adas.jpg' },

  // Auth Modals Visuals
  { src: 'SIGMACAR_Desktop_Login_-_Blue__1.jpg', dest: 'login-side-art.jpg' },
  { src: 'SIGMACAR_Desktop_Register_-_Bl_0.jpg', dest: 'register-side-art.jpg' }
];

let deployed = 0;
mappings.forEach(m => {
  if (copyAsset(m.src, m.dest)) deployed++;
});

console.log(`\nSuccessfully deployed ${deployed}/${mappings.length} semantic design assets!`);
