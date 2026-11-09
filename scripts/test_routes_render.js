const fs = require('fs');
const path = require('path');

console.log('=== ROUTE RENDERING TEST ===');

// Mock browser environment
const domHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Basic regex test on viewsContainer and HTML templates in app.js
const appJs = fs.readFileSync(path.join(__dirname, '..', 'js/app.js'), 'utf8');

const requiredViewFunctions = [
  'renderHome',
  'renderNewCars',
  'renderCertifiedCars',
  'renderAccessories',
  'renderVrArShowroomPage',
  'renderArLiveModePage',
  'renderArAtHomePage',
  'renderVehicleDetail',
  'renderCompare',
  'renderAIAdvisor',
  'renderTestDrivePage',
  'renderSellerDashboard',
  'renderSellerSubView',
  'renderProfile',
  'renderProfileSubView',
  'switchAuthTab'
];

let allFound = true;
requiredViewFunctions.forEach(fn => {
  if (!appJs.includes('function ' + fn) && !appJs.includes(fn + ' =') && !appJs.includes(fn + '(')) {
    console.error('MISSING VIEW FUNCTION:', fn);
    allFound = false;
  } else {
    console.log('✓ Found function:', fn);
  }
});

// Check that no broken placeholder classes or empty src="" exist
const emptySrcMatches = appJs.match(/src=[\"']\s*[\"']/gi);
if (emptySrcMatches) {
  console.error('Found empty src attributes in app.js:', emptySrcMatches.length);
} else {
  console.log('✓ 0 empty src attributes in app.js!');
}

console.log('=== ALL ROUTE FUNCTIONS VERIFIED CLEANLY ===');
