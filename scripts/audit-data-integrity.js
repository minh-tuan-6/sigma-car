// scripts/audit-data-integrity.js
// Verifies repository data invariants across vehicles, users, orders, 3D assets & manifests

const fs = require('fs');
const path = require('path');
const { LEGACY_VEHICLE_ARCHIVES, SHOWROOM_BRANCHES } = require('../backend/domain/constants');

const rootDir = path.resolve(__dirname, '..');
const storePath = path.join(rootDir, 'data', 'sigmacar_store.json');
const manifestPath = path.join(rootDir, 'data', 'ar-manifest.json');

function auditDataIntegrity() {
  const issues = [];
  const warnings = [];

  if (!fs.existsSync(storePath)) {
    issues.push(`Missing primary data store: ${storePath}`);
    return { ok: false, issues, warnings, summary: {} };
  }

  const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  const vehicles = Array.isArray(store.vehicles) ? store.vehicles : [];
  const certifiedVehicles = Array.isArray(store.certifiedVehicles) ? store.certifiedVehicles : [];
  const users = Array.isArray(store.users) ? store.users : [];
  const orders = Array.isArray(store.orders) ? store.orders : [];

  // 1. Vehicle uniqueness and numeric validity
  const vehicleIds = new Set();
  for (const v of vehicles) {
    if (!v.id || !v.name) issues.push(`Vehicle missing id/name: ${JSON.stringify(v).slice(0, 80)}`);
    if (vehicleIds.has(v.id)) issues.push(`Duplicate vehicle id: ${v.id}`);
    vehicleIds.add(v.id);
    if (!Number.isFinite(v.price) || v.price <= 0) issues.push(`Invalid vehicle price on ${v.id}: ${v.price}`);
    if (v.stock !== undefined && (!Number.isInteger(v.stock) || v.stock < 0)) {
      issues.push(`Invalid vehicle stock on ${v.id}: ${v.stock}`);
    }
  }

  // 2. Orders referential integrity (with explicit legacy archive handling)
  const validBranchIds = new Set(SHOWROOM_BRANCHES.map(b => b.id));
  const legacyOrderLinks = [];
  for (const ord of orders) {
    const existsInVehicles = vehicleIds.has(ord.vehicleId) || certifiedVehicles.some(c => c.id === ord.vehicleId);
    if (!existsInVehicles) {
      if (LEGACY_VEHICLE_ARCHIVES[ord.vehicleId]) {
        legacyOrderLinks.push({ orderId: ord.id, vehicleId: ord.vehicleId });
      } else {
        issues.push(`Orphan order ${ord.id} references unknown vehicleId "${ord.vehicleId}"`);
      }
    }
    if (ord.branchId && !validBranchIds.has(ord.branchId)) {
      warnings.push(`Order ${ord.id} uses unrecognized branchId "${ord.branchId}"`);
    }
  }
  if (legacyOrderLinks.length > 0) {
    warnings.push(`${legacyOrderLinks.length} historical seeded orders reference LEGACY_VEHICLE_ARCHIVES (${legacyOrderLinks.map(x => `${x.orderId}->${x.vehicleId}`).join(', ')})`);
  }

  // 3. Users integrity (branch scoping for staff & sessionVersion presence)
  for (const u of users) {
    if (!u.id || !u.email) issues.push(`User missing id/email: ${u.id}`);
    if ((u.role === 'seller' || u.role === 'service_staff') && !u.branchId && (!Array.isArray(u.branchIds) || u.branchIds.length === 0)) {
      warnings.push(`Staff user ${u.id} (${u.email}) in raw disk store lacks branchId/branchIds (runtime normalizer backfills default branch)`);
    }
    if (!u.passwordHash || !String(u.passwordHash).includes(':')) {
      issues.push(`User ${u.id} has invalid passwordHash format`);
    }
  }

  // 4. Verify AR manifest GLB assets exist cleanly on disk
  let manifestCount = 0;
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entries = Array.isArray(manifest.vehicles)
      ? manifest.vehicles
      : Object.values(manifest.vehicles || {});
    manifestCount = entries.length;
    for (const entry of entries) {
      const candidatePaths = [entry.glbUrl, entry.studioGlbUrl, entry.modelPath].filter(Boolean);
      if (Array.isArray(entry.configurations)) {
        for (const cfg of entry.configurations) {
          if (cfg && cfg.glbUrl) candidatePaths.push(cfg.glbUrl);
        }
      }
      for (const rel of candidatePaths) {
        const cleanRel = String(rel).replace(/^\//, '').split('?')[0];
        const abs = path.join(rootDir, cleanRel);
        if (!fs.existsSync(abs)) {
          issues.push(`AR manifest entry "${entry.carId || entry.id}" references missing asset "${rel}"`);
        }
      }
    }
  } else {
    issues.push(`Missing AR manifest: ${manifestPath}`);
  }

  return {
    ok: issues.length === 0,
    issues,
    warnings,
    summary: {
      vehiclesCount: vehicles.length,
      certifiedCount: certifiedVehicles.length,
      usersCount: users.length,
      ordersCount: orders.length,
      manifestEntriesCount: manifestCount,
      legacyOrderLinksCount: legacyOrderLinks.length
    }
  };
}

if (require.main === module) {
  const report = auditDataIntegrity();
  console.log('=== SIGMACAR Data Integrity Audit ===');
  console.log(JSON.stringify(report.summary, null, 2));
  if (report.warnings.length > 0) {
    console.log('\nWarnings:');
    report.warnings.forEach(w => console.log(`  - ${w}`));
  }
  if (report.issues.length > 0) {
    console.error('\nCRITICAL ISSUES:');
    report.issues.forEach(i => console.error(`  - ${i}`));
    process.exit(1);
  }
  console.log('\nPASS: Data integrity checks succeeded with 0 critical issues.');
}

module.exports = { auditDataIntegrity };
