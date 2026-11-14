#!/usr/bin/env node
// scripts/demo/generate-demo-data.js — synthetic SIGMACAR demo dataset (PLAN.md T5.1, §I)
//
//   node scripts/demo/generate-demo-data.js [--seed 2026] [--batch demo-2026] [--now 2026-11-15T00:00:00Z] [--out <file>]
//
// Offline and deterministic (same seed + --now ⇒ same file). Reads the vehicle catalog from data/sigmacar_store.json
// read-only and writes ONE store-format JSON (default data/demo/sigmacar_demo_<batch>.json, git-ignored). It never
// touches any database: loading the file into a non-production D1 is a separate, approved step (T5.4,
// scripts/d1/json-to-d1.js --source <file> --merge), and removal is scripts/demo/remove-demo-data.js.
//
// Isolation (enforced by tests/unit/demo_data.test.js):
//   • every record: isDemo: true, demoBatchId, id prefixed "demo-"
//   • demo users cannot log in (disabledAt set + a random password hash no password produces), e-mails use the
//     reserved .invalid TLD, phones 0900 000 xxx, marketingConsent false
//   • no outboxEvents, emailCampaigns, paymentIntents, paymentLedger, webhookEvents or refunds are generated
//   • verifiedPurchase is true only when a Delivered/Completed demo order of the same user and vehicle exists

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ORDER_STATUS, PAYMENT_STATUS, APPOINTMENT_STATUS, TICKET_STATUS, TICKET_PRIORITY, SHOWROOM_BRANCHES } = require('../../backend/domain/constants');

const ROOT = path.resolve(__dirname, '..', '..');
const NAMES = require('./names-vi.json');
const TEXTS = require('./review-templates-vi.json');

const COUNTS = {
  users: 80, orders: 120, reviews: 200, questions: 40, appointments: 60, supportTickets: 40,
  warranties: 90, serviceRecords: 120, serviceAppointments: 30, analyticsEvents: 3000, notifications: 150
};
const ORDER_MIX = { delivered: 90, confirmed: 20, cancelled: 10 };
const TIME_SLOTS = ['08:30 - 09:30', '09:30 - 10:30', '11:00 - 12:00', '13:30 - 14:30', '15:00 - 16:00', '16:30 - 17:30'];

// mulberry32 — small deterministic PRNG
function prng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generate({ seed = 2026, batchId = `demo-${seed}`, now = '2026-11-15T00:00:00.000Z', vehicles } = {}) {
  const rand = prng(Number(seed) || 2026);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
  const hex = (n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');
  const pad = (n, w = 4) => String(n).padStart(w, '0');
  const nowMs = Date.parse(now);
  const daysAgo = (min, max) => new Date(nowMs - int(min, max) * 86400000 - int(0, 86399) * 1000).toISOString();
  const tag = { isDemo: true, demoBatchId: batchId };

  const catalog = (vehicles || []).filter(v => v && v.id && Number(v.price) > 0);
  if (catalog.length === 0) throw new Error('No vehicles in the catalog to build demo data from.');
  const branches = SHOWROOM_BRANCHES;

  // ---- users (unique humorous names) ----
  const usedNames = new Set();
  const users = [];
  for (let i = 1; i <= COUNTS.users; i++) {
    let fullName = i <= NAMES.examples.length ? NAMES.examples[i - 1] : null;
    for (let attempt = 0; !fullName || usedNames.has(fullName); attempt++) {
      fullName = `${pick(NAMES.families)} ${pick(NAMES.middles)} ${pick(NAMES.givens)}`;
      if (attempt > 500) { fullName = `${fullName} ${i}`; break; }
    }
    usedNames.add(fullName);
    const id = `demo-usr-${pad(i)}`;
    users.push({
      id,
      email: `${id}@demo.sigmacar.invalid`,
      fullName,
      role: 'buyer',
      phone: `0900 000 ${pad(i, 3)}`,
      passwordHash: `${hex(16)}:${hex(128)}`, // random — no password hashes to this value
      sessionVersion: 1,
      disabledAt: now, // demo accounts can never log in
      marketingConsent: false,
      createdAt: daysAgo(95, 180),
      ...tag
    });
  }

  // ---- orders ----
  const orders = [];
  const statusPlan = [
    ...Array(ORDER_MIX.delivered).fill('delivered'),
    ...Array(ORDER_MIX.confirmed).fill('confirmed'),
    ...Array(ORDER_MIX.cancelled).fill('cancelled')
  ];
  statusPlan.forEach((kind, idx) => {
    const n = idx + 1;
    const user = users[idx % users.length];
    const v = pick(catalog);
    const branch = pick(branches);
    const createdAt = daysAgo(10, 90);
    const price = Math.round(Number(v.price));
    const deposit = 50000000;
    const base = {
      id: `demo-ord-${pad(n)}`,
      orderNumber: `DEMO-2026-${pad(n)}`,
      userId: user.id,
      buyerName: user.fullName,
      buyerPhone: user.phone,
      vehicleId: v.id,
      vehicleName: v.name,
      unitPrice: price,
      totalAmount: price,
      depositAmount: deposit,
      branchId: branch.id,
      branchName: branch.name,
      paymentMethod: 'Demo — không phát sinh giao dịch thật',
      createdAt,
      updatedAt: createdAt,
      ...tag
    };
    if (kind === 'delivered') {
      const deliveredAt = new Date(Date.parse(createdAt) + int(5, 9) * 86400000).toISOString();
      const completed = rand() < 0.5;
      orders.push({
        ...base,
        orderStatus: completed ? ORDER_STATUS.COMPLETED : ORDER_STATUS.DELIVERED,
        paymentStatus: PAYMENT_STATUS.FULLY_PAID,
        paidAmount: price,
        vin: `DEMO${hex(13).toUpperCase()}`,
        deliveredAt,
        ...(completed ? { completedAt: deliveredAt } : {}),
        history: [
          { status: ORDER_STATUS.PENDING, timestamp: createdAt, updatedBy: user.id, note: 'Demo' },
          { status: ORDER_STATUS.CONFIRMED, timestamp: createdAt, updatedBy: 'demo-staff', note: 'Demo' },
          { status: completed ? ORDER_STATUS.COMPLETED : ORDER_STATUS.DELIVERED, timestamp: deliveredAt, updatedBy: 'demo-staff', note: 'Demo' }
        ]
      });
    } else if (kind === 'confirmed') {
      orders.push({ ...base, orderStatus: ORDER_STATUS.CONFIRMED, paymentStatus: PAYMENT_STATUS.DEPOSIT_PAID, paidAmount: deposit, history: [{ status: ORDER_STATUS.CONFIRMED, timestamp: createdAt, updatedBy: 'demo-staff', note: 'Demo' }] });
    } else {
      orders.push({ ...base, orderStatus: ORDER_STATUS.CANCELLED, paymentStatus: PAYMENT_STATUS.UNPAID, paidAmount: 0, history: [{ status: ORDER_STATUS.CANCELLED, timestamp: createdAt, updatedBy: user.id, note: 'Demo' }] });
    }
  });
  const delivered = orders.filter(o => [ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED].includes(o.orderStatus));
  const ownedPairs = new Set(delivered.map(o => `${o.userId}|${o.vehicleId}`));
  const userById = new Map(users.map(u => [u.id, u]));

  // ---- reviews: verified only through a delivered/completed demo order of the same user and vehicle ----
  const reviews = [];
  const reviewText = (v) => {
    const t = rand() < 0.6 ? pick(TEXTS.realistic) : pick(TEXTS.humorous);
    return { title: t.title, content: t.content.split('{car}').join(v.name) };
  };
  const rating = () => (rand() < 0.15 ? 3 : (rand() < 0.45 ? 4 : 5));
  const crit = () => ({ design: int(3, 5), performance: int(3, 5), features: int(3, 5), comfort: int(3, 5), value: int(3, 5) });
  for (const o of delivered) {
    const v = catalog.find(c => c.id === o.vehicleId);
    const t = reviewText(v);
    reviews.push({
      id: `demo-rev-${pad(reviews.length + 1)}`, vehicleId: v.id, vehicleName: v.name, userId: o.userId,
      authorName: userById.get(o.userId).fullName, authorTier: 'Khách hàng Demo', orderId: o.id, verifiedPurchase: true,
      rating: rating(), criteria: crit(), ...t, media: [], helpfulVoterIds: [], reportedBy: [], reportReason: '',
      moderationStatus: 'approved', moderationNote: '', createdAt: new Date(Date.parse(o.deliveredAt) + int(1, 5) * 86400000).toISOString(), ...tag
    });
  }
  let guard = 0;
  while (reviews.length < COUNTS.reviews && guard++ < 10000) {
    const u = pick(users);
    const v = pick(catalog);
    if (ownedPairs.has(`${u.id}|${v.id}`)) continue; // unverified reviews must not have a matching purchase
    const t = reviewText(v);
    reviews.push({
      id: `demo-rev-${pad(reviews.length + 1)}`, vehicleId: v.id, vehicleName: v.name, userId: u.id,
      authorName: u.fullName, authorTier: 'Khách hàng Demo', orderId: null, verifiedPurchase: false,
      rating: rating(), criteria: crit(), ...t, media: [], helpfulVoterIds: [], reportedBy: [], reportReason: '',
      moderationStatus: 'approved', moderationNote: '', createdAt: daysAgo(1, 80), ...tag
    });
  }

  // ---- questions ----
  const questions = Array.from({ length: COUNTS.questions }, (_, i) => {
    const u = pick(users);
    const v = pick(catalog);
    const createdAt = daysAgo(1, 60);
    return {
      id: `demo-qna-${pad(i + 1)}`, vehicleId: v.id, vehicleName: v.name, userId: u.id, authorName: u.fullName,
      question: pick(TEXTS.questions).split('{car}').join(v.name), status: 'approved', createdAt,
      answers: [{ id: `demo-ans-${pad(i + 1)}`, userId: 'demo-staff', authorName: 'Tư vấn viên SIGMACAR (Demo)', authorRole: 'seller', content: pick(TEXTS.answers), createdAt: new Date(Date.parse(createdAt) + 3600000).toISOString() }],
      ...tag
    };
  });

  // ---- test-drive appointments ----
  const apptStatuses = [APPOINTMENT_STATUS.COMPLETED, APPOINTMENT_STATUS.COMPLETED, APPOINTMENT_STATUS.CONFIRMED, APPOINTMENT_STATUS.PENDING, APPOINTMENT_STATUS.CANCELLED, APPOINTMENT_STATUS.NO_SHOW];
  const appointments = Array.from({ length: COUNTS.appointments }, (_, i) => {
    const u = pick(users);
    const v = pick(catalog);
    const b = pick(branches);
    const home = rand() < 0.3;
    const createdAt = daysAgo(1, 90);
    return {
      id: `demo-apt-${pad(i + 1)}`, userId: u.id, customerName: u.fullName, phone: u.phone, email: u.email,
      carName: v.name, vehicleId: v.id, branchId: b.id, branchName: b.name, category: 'test_drive',
      preferredDate: createdAt.slice(0, 10), timeSlot: pick(TIME_SLOTS), isHomeService: home,
      district: home ? pick(b.homeServiceDistricts || ['—']) : '', status: pick(apptStatuses), createdAt, ...tag
    };
  });

  // ---- support tickets ----
  const ticketStatuses = Object.values(TICKET_STATUS);
  const priorities = Object.values(TICKET_PRIORITY || {}).length ? Object.values(TICKET_PRIORITY) : ['Bình thường'];
  const supportTickets = Array.from({ length: COUNTS.supportTickets }, (_, i) => {
    const o = pick(orders);
    const u = userById.get(o.userId);
    const t = pick(TEXTS.tickets);
    const createdAt = daysAgo(1, 60);
    const code = `DEMO-TCK-${pad(i + 1)}`;
    return {
      id: code, ticketCode: code, userId: u.id, customerName: u.fullName, customerEmail: u.email, customerPhone: u.phone,
      subject: t.subject.split('{car}').join(o.vehicleName), category: t.category, linkedOrderId: o.id, linkedVehicleName: o.vehicleName,
      priority: pick(priorities), status: pick(ticketStatuses), branchId: o.branchId, attachments: [],
      messages: [{ id: `demo-msg-${pad(i + 1)}`, senderId: u.id, senderName: u.fullName, senderRole: 'buyer', content: 'Nội dung yêu cầu hỗ trợ (dữ liệu demo).', createdAt }],
      createdAt, updatedAt: createdAt, ...tag
    };
  });

  // ---- warranties (one per delivered order) ----
  const warranties = delivered.slice(0, COUNTS.warranties).map((o, i) => {
    const start = o.deliveredAt.slice(0, 10);
    const y = Number(start.slice(0, 4));
    return {
      id: `demo-war-${pad(i + 1)}`, warrantyCode: `EW-DEMO-${pad(i + 1)}`, orderId: o.id, orderNumber: o.orderNumber,
      userId: o.userId, ownerName: o.buyerName, vehicleId: o.vehicleId, vehicleName: o.vehicleName, vin: o.vin,
      branchId: o.branchId, purchaseDate: start, activatedAt: o.deliveredAt, startDate: start,
      endDate: `${y + 5}${start.slice(4)}`, batteryEndDate: `${y + 8}${start.slice(4)}`, maxKm: 150000, batteryMaxKm: 160000,
      currentOdoKm: int(300, 12000), status: 'Đang hiệu lực', ...tag
    };
  });

  // ---- service records + maintenance appointments ----
  const serviceRecords = Array.from({ length: COUNTS.serviceRecords }, (_, i) => {
    const w = warranties[i % warranties.length];
    const b = branches.find(x => x.id === w.branchId) || branches[0];
    return {
      id: `demo-srv-${pad(i + 1)}`, warrantyId: w.id, userId: w.userId, vehicleId: w.vehicleId, vehicleName: w.vehicleName, vin: w.vin,
      serviceDate: daysAgo(1, 80).slice(0, 10), odoKm: int(500, 15000), serviceType: pick(['Bảo dưỡng định kỳ', 'Kiểm tra pin cao áp', 'Cập nhật phần mềm OTA']),
      serviceCenterId: b.id, serviceCenterName: b.name, technicianName: 'Kỹ thuật viên Demo', itemsPerformed: ['Kiểm tra tổng quát (demo)'],
      partsReplaced: [], inspectionResult: 'Đạt (dữ liệu demo)', laborCost: 0, partsCost: 0, totalCost: 0, ...tag
    };
  });
  const serviceAppointments = Array.from({ length: COUNTS.serviceAppointments }, (_, i) => {
    const w = warranties[(i * 3) % warranties.length];
    const b = branches.find(x => x.id === w.branchId) || branches[0];
    const date = new Date(nowMs + int(-20, 20) * 86400000).toISOString().slice(0, 10);
    return {
      id: `demo-sap-${pad(i + 1)}`, appointmentCode: `#DEMO-APT-${pad(i + 1)}`, userId: w.userId, customerName: w.ownerName,
      vehicleId: w.vehicleId, vehicleName: w.vehicleName, vin: w.vin, serviceType: 'BẢO DƯỠNG ĐỊNH KỲ', serviceItems: ['Bảo dưỡng định kỳ (demo)'],
      serviceCenterId: b.id, serviceCenterName: b.name, preferredDate: date, timeSlot: pick(TIME_SLOTS),
      status: date < now.slice(0, 10) ? 'Hoàn thành' : 'Đã xác nhận', reminderChannels: { email: false, push: false, sms: false }, ...tag
    };
  });

  // ---- analytics events (funnel-shaped; demo source; excluded from real metrics, T5.2) ----
  const funnelPlan = [['vehicle_view', 2000], ['test_drive', 400], ['quote', 300], ['checkout', 150], ['order_paid', 100], ['handover', 50]];
  const analyticsEvents = [];
  for (const [type, count] of funnelPlan) {
    for (let i = 0; i < count; i++) {
      const createdAt = daysAgo(0, 90);
      const v = pick(catalog);
      analyticsEvents.push({
        id: `demo-evt-${pad(analyticsEvents.length + 1, 5)}`, sessionId: `demo-sess-${hex(8)}`, userId: pick(users).id, eventType: type,
        targetId: v.id, branchId: pick(branches).id, promoCode: null, dedupeKey: `demo:${batchId}:${analyticsEvents.length + 1}`,
        consentGranted: true, cohortDate: createdAt.slice(0, 10), source: 'demo', createdAt, ...tag
      });
    }
  }

  // ---- in-app notifications only (never e-mail: no outbox events are generated) ----
  const notifications = Array.from({ length: COUNTS.notifications }, (_, i) => {
    const o = pick(orders);
    return {
      id: `demo-ntf-${pad(i + 1)}`, userId: o.userId, category: 'transactional', eventType: 'order_status_updated', aggregateType: 'order',
      aggregateId: o.id, title: `[SIGMACAR · Demo] Đơn hàng ${o.orderNumber}`, message: 'Thông báo minh họa (dữ liệu demo, không gửi e-mail).',
      deliveryStatus: 'demo_not_sent', readAt: rand() < 0.5 ? daysAgo(0, 30) : null, createdAt: daysAgo(0, 60), ...tag
    };
  });

  return {
    meta: { version: 'demo-1', demoBatchId: batchId, seed: Number(seed), generatedFor: now, counts: null },
    users, orders, reviews, questions, appointments, supportTickets, warranties, serviceRecords, serviceAppointments, analyticsEvents, notifications
  };
}

function summarize(data) {
  const counts = {};
  for (const [k, v] of Object.entries(data)) if (Array.isArray(v)) counts[k] = v.length;
  return counts;
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--seed') args.seed = Number(next());
    else if (k === '--batch') args.batchId = next();
    else if (k === '--now') args.now = new Date(next()).toISOString();
    else if (k === '--out') args.out = path.resolve(next());
    else if (k === '-h' || k === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 18).join('\n')); return 0; }
    else { console.error(`Unknown option ${k}`); return 2; }
  }
  const seed = args.seed || 2026;
  const batchId = args.batchId || `demo-${seed}`;
  if (!/^[a-z0-9-]{3,40}$/.test(batchId)) { console.error('--batch must be 3–40 chars [a-z0-9-]'); return 2; }
  const store = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sigmacar_store.json'), 'utf8'));
  const data = generate({ seed, batchId, now: args.now || '2026-11-15T00:00:00.000Z', vehicles: store.vehicles });
  data.meta.counts = summarize(data);
  const out = args.out || path.join(ROOT, 'data', 'demo', `sigmacar_demo_${batchId}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex').slice(0, 16);
  console.log(`Demo batch "${batchId}" → ${path.relative(ROOT, out)} (sha256 ${sha})`);
  console.log(JSON.stringify(data.meta.counts));
  console.log('Nothing was imported. To load into a NON-production D1 (approval required, PLAN T5.4):');
  console.log(`  node scripts/d1/json-to-d1.js --dry-run --source ${path.relative(ROOT, out)} --merge`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { generate, summarize, COUNTS };
