const fs = require('fs');
const path = require('path');

const imgDir = path.join(__dirname, 'assets', 'images');
const assetsDir = path.join(__dirname, 'assets');

function copyIf(name, dest) {
  const p = path.join(imgDir, name);
  if (fs.existsSync(p)) {
    fs.copyFileSync(p, path.join(assetsDir, dest));
    console.log(`Copied ${name} -> ${dest}`);
  }
}

// Certified cars
copyIf('SIGMACAR_-_Vehicle_Detail_Page_10.jpg', 'car-certified-1.jpg'); // Red E-Vision Premium
copyIf('SIGMACAR_-_Vehicle_Detail_Page_11.jpg', 'car-certified-2.jpg'); // Dark E-Vision Luxury
copyIf('SIGMACAR_Home_Page_19.jpg', 'car-used-1.jpg');
copyIf('SIGMACAR_Home_Page_21.jpg', 'car-used-2.jpg');
copyIf('SIGMACAR_Home_Page_24.jpg', 'car-used-3.jpg');

// Color variants for 3D preview
copyIf('SIGMACAR_-_D_ng_xe_m_i_15.jpg', 'car-color-blue.jpg');
copyIf('Seller_Dashboard_-_Overview_3.jpg', 'car-color-dark.jpg');
copyIf('SIGMACAR_-_Vehicle_Detail_Page_12.jpg', 'car-color-silver.jpg');

// Cockpit / Interior view
copyIf('SIGMACAR_-_So_s_nh_xe_Tone_Xa_4.jpg', 'interior-cockpit.jpg');
copyIf('SIGMACAR_-_So_s_nh_xe_0.jpg', 'interior-night.jpg');

console.log('Additional assets mapped.');
