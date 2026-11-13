// scripts/migrate-json-to-sql.js
// Deterministic ETL migrating SIGMACAR JSON store records into M1-M7 SQL tables
// Usage: node scripts/migrate-json-to-sql.js [--dry-run] [--out <sqlite-path>]

const fs = require('fs');
const path = require('path');
const DatabaseAdapter = require('../backend/infrastructure/database');
const { SHOWROOM_BRANCHES } = require('../backend/domain/constants');

function runMigration({ dryRun = false, inputFile, sqliteFile } = {}) {
  const rootDir = path.resolve(__dirname, '..');
  const sourcePath = path.resolve(inputFile || path.join(rootDir, 'data', 'sigmacar_store.json'));

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Input JSON store not found: ${sourcePath}`);
  }

  const store = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const targetDb = dryRun ? ':memory:' : (sqliteFile || path.join(rootDir, 'data', 'sigmacar_migrated.sqlite'));
  const db = DatabaseAdapter.openSqliteDatabase(targetDb);

  try {
    const migResult = DatabaseAdapter.applyMigrationsToSqlite(db);
    const now = new Date().toISOString();

    db.exec('BEGIN IMMEDIATE;');
    try {
      // M1: Branches & Users & Audit Logs
      const branchStmt = db.prepare(`
        INSERT OR REPLACE INTO branches (id, name, address, city, hotline, home_service_districts_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const b of SHOWROOM_BRANCHES) {
        branchStmt.run(b.id, b.name, b.address || '', b.city || '', b.hotline || '', JSON.stringify(b.homeServiceDistricts || []), now);
      }

      const userStmt = db.prepare(`
        INSERT OR REPLACE INTO users (
          id, email, full_name, role, phone, branch_id, branch_ids_json, branch_name,
          session_version, disabled_at, password_hash, member_code, tier, points, birth_date,
          address, saved_cars_json, notification_prefs_json, security_prefs_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const u of (store.users || [])) {
        const branchIds = Array.isArray(u.branchIds) ? u.branchIds : (u.branchId ? [u.branchId] : []);
        userStmt.run(
          u.id, u.email, u.fullName || '', u.role || 'buyer', u.phone || '',
          u.branchId || branchIds[0] || null, JSON.stringify(branchIds), u.branchName || null,
          u.sessionVersion || 1, u.disabledAt || null, u.passwordHash || '',
          u.memberCode || null, u.tier || null, Number(u.points || 0), u.birthDate || null,
          u.address || null, JSON.stringify(u.savedCars || []),
          JSON.stringify(u.notificationPrefs || {}), JSON.stringify(u.securityPrefs || {}),
          u.createdAt || now, u.updatedAt || null
        );
      }

      // M2: Vehicles & Certified Vehicles
      const vehStmt = db.prepare(`
        INSERT OR REPLACE INTO vehicles (
          id, product_code, name, brand, version, category, fuel, price, sale_price,
          range_km, battery_kwh, hp, seats, image, stock, is_available, archived, specs_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const v of (store.vehicles || [])) {
        vehStmt.run(
          v.id, v.productCode || null, v.name, v.brand || null, v.version || null,
          v.category || 'SUV', v.fuel || 'ev', Number(v.price || 0), v.salePrice ?? null,
          v.range ?? null, v.batteryKwh ?? null, v.hp ?? null, v.seats ?? 5,
          v.image || null, Number(v.stock ?? 0), v.isAvailable === false ? 0 : 1,
          v.archived ? 1 : 0, JSON.stringify(v.specs || {}), v.createdAt || now, v.updatedAt || null
        );
      }

      const cpoStmt = db.prepare(`
        INSERT OR REPLACE INTO certified_vehicles (id, name, year, vin, odo_num, price, battery_health, category, image, status, stock)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const c of (store.certifiedVehicles || [])) {
        cpoStmt.run(c.id, c.name, c.year || null, c.vin || null, c.odoNum || 0, Number(c.price || 0), c.batteryHealth || null, c.category || 'SUV', c.image || null, c.status || '', Number(c.stock ?? 1));
      }

      // M3: Orders
      const ordStmt = db.prepare(`
        INSERT OR REPLACE INTO orders (
          id, order_number, user_id, buyer_name, buyer_phone, vehicle_id, vehicle_name,
          branch_id, branch_name, unit_price, deposit_amount, paid_amount, order_status,
          payment_status, registration_status, payment_method, vin, delivered_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const o of (store.orders || [])) {
        ordStmt.run(
          o.id, o.orderNumber || o.id, o.userId || 'unknown', o.buyerName || '', o.buyerPhone || '',
          o.vehicleId || '', o.vehicleName || '', o.branchId || 'hn-caugiay', o.branchName || '',
          Number(o.unitPrice || 0), Number(o.depositAmount || 0), Number(o.paidAmount || 0),
          o.orderStatus || 'Pending', o.paymentStatus || 'Unpaid', o.registrationStatus || null,
          o.paymentMethod || null, o.vin || null, o.deliveredAt || null, o.createdAt || now, o.updatedAt || null
        );
      }

      // M4: Appointments
      const apptStmt = db.prepare(`
        INSERT OR REPLACE INTO appointments (
          id, user_id, customer_name, phone, email, car_name, vehicle_id, branch_id, branch_name,
          preferred_date, time_slot, is_home_service, district, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const a of (store.appointments || [])) {
        apptStmt.run(
          a.id, a.userId || null, a.customerName || '', a.phone || '', a.email || '',
          a.carName || '', a.vehicleId || null, a.branchId || 'hn-caugiay', a.branchName || '',
          a.preferredDate || '', a.timeSlot || '', a.isHomeService ? 1 : 0, a.district || null,
          a.status || 'Chờ xác nhận', a.createdAt || now, a.updatedAt || null
        );
      }

      // M5: Returns, Warranties, Tickets
      const retStmt = db.prepare(`
        INSERT OR REPLACE INTO return_requests (
          id, return_code, order_id, branch_id, user_id, reason_id, current_odo_km, status, estimated_refund_amount, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of (store.returnRequests || [])) {
        retStmt.run(
          r.id, r.returnCode || r.id, r.orderId, r.branchId || null, r.userId,
          r.reasonId || '', Number(r.currentOdoKm || 0), r.status || '',
          Number(r.financials?.estimatedRefundAmount || 0), r.createdAt || now, r.updatedAt || null
        );
      }

      const warStmt = db.prepare(`
        INSERT OR REPLACE INTO warranties (
          id, warranty_code, order_id, user_id, vehicle_id, vehicle_name, vin, license_plate, start_date, end_date, battery_end_date, current_odo_km, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const w of (store.warranties || [])) {
        warStmt.run(
          w.id, w.warrantyCode || w.id, w.orderId || null, w.userId, w.vehicleId || null,
          w.vehicleName || '', w.vin || '', w.licensePlate || null, w.startDate || now.slice(0, 10),
          w.endDate || now.slice(0, 10), w.batteryEndDate || null, Number(w.currentOdoKm || 0), w.status || ''
        );
      }

      const tckStmt = db.prepare(`
        INSERT OR REPLACE INTO support_tickets (
          id, ticket_code, user_id, branch_id, subject, category, priority, status, assigned_staff_id, sla_due_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const t of (store.supportTickets || [])) {
        tckStmt.run(
          t.id, t.ticketCode || t.id, t.userId || null, t.branchId || null, t.subject || '',
          t.category || '', t.priority || 'Bình thường', t.status || '', t.assignedStaffId || null,
          t.slaDueAt || null, t.createdAt || now, t.updatedAt || null
        );
      }

      // M7: Reviews & Campaigns
      const revStmt = db.prepare(`
        INSERT OR REPLACE INTO reviews (
          id, vehicle_id, user_id, order_id, rating, title, content, moderation_status, verified_owner, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const rv of (store.reviews || [])) {
        revStmt.run(
          rv.id, rv.vehicleId || '', rv.userId || '', rv.orderId || null, Number(rv.rating || 5),
          rv.title || null, rv.content || rv.comment || '', rv.moderationStatus || 'published',
          rv.verifiedOwner ? 1 : 0, rv.createdAt || now
        );
      }

      const cmpStmt = db.prepare(`
        INSERT OR REPLACE INTO email_campaigns (id, name, category, segment, status, sent_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const cm of (store.emailCampaigns || [])) {
        cmpStmt.run(cm.id, cm.name || '', cm.category || '', cm.segment || '', cm.status || 'Nháp', Number(cm.stats?.sentCount || 0), cm.createdAt || now);
      }

      db.exec('COMMIT;');
    } catch (txErr) {
      db.exec('ROLLBACK;');
      throw txErr;
    }

    const counts = {};
    for (const tbl of ['branches', 'users', 'vehicles', 'certified_vehicles', 'orders', 'appointments', 'return_requests', 'warranties', 'support_tickets', 'reviews', 'email_campaigns']) {
      counts[tbl] = db.prepare(`SELECT COUNT(*) AS c FROM ${tbl}`).get().c;
    }

    return {
      ok: true,
      dryRun,
      migrationsApplied: migResult.totalFiles,
      counts
    };
  } finally {
    db.close();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const outIdx = args.indexOf('--out');
  const outPath = outIdx !== -1 ? args[outIdx + 1] : undefined;
  const result = runMigration({ dryRun, sqliteFile: outPath });
  console.log('=== SIGMACAR JSON -> SQL Migration ===');
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { runMigration };
