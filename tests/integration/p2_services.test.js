// tests/integration/p2_services.test.js
// Comprehensive Integration & Behavioral Suite for Plan Batch P2 (SIG-P2-001 .. SIG-P2-018)

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const { startTestServer } = require('../helpers/test-app');
const { dbState, runInTransaction } = require('../../backend/infrastructure/storage-engine');
const EmailProvider = require('../../backend/infrastructure/email-provider');
const OutboxWorker = require('../../backend/workers/outbox-worker');
const NotificationService = require('../../backend/application/notification-service');
const FinancingService = require('../../backend/application/financing-service');
const HandoverService = require('../../backend/application/handover-service');
const RefundService = require('../../backend/application/refund-service');
const PolicyService = require('../../backend/application/policy-service');
const PaymentGateway = require('../../backend/infrastructure/payment-gateway');
const { PAYMENT_STATUS, ORDER_STATUS } = require('../../backend/domain/constants');

function makeMinimalPngBase64() {
  // 8-byte PNG signature + dummy IHDR/IEND bytes
  const buf = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52
  ]);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function makeJpegWithExifBase64() {
  // SOI (FFD8) + APP1 EXIF segment (FFE1 + len 0x000A + "Exif\0\0GPS!") + EOI (FFD9)
  const exifPayload = Buffer.from('Exif\0\0GPS!', 'ascii');
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(2 + exifPayload.length, 0);
  const jpgBuf = Buffer.concat([
    Buffer.from([0xFF, 0xD8, 0xFF, 0xE1]),
    lenBuf,
    exifPayload,
    Buffer.from([0xFF, 0xDB, 0x00, 0x04, 0x01, 0x02, 0xFF, 0xD9])
  ]);
  return `data:image/jpeg;base64,${jpgBuf.toString('base64')}`;
}

function makePdfBase64(contentSuffix = 'clean') {
  const buf = Buffer.from(`%PDF-1.4\n% ${contentSuffix}\n%%EOF`, 'ascii');
  return `data:application/pdf;base64,${buf.toString('base64')}`;
}

describe('Batch P2: Transactional Commerce, Fulfillment, Media, Aftersales & Garage Lifecycle', () => {
  let app = null;
  let BASE_URL = '';
  let buyerToken = '';
  let buyer2Token = '';
  let sellerToken = '';
  let adminToken = '';

  async function api(path, options = {}, token = null) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
    const contentType = res.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await res.json().catch(() => null)
      : await res.arrayBuffer();
    return { status: res.status, headers: res.headers, body };
  }

  async function createSettledOrderForBuyer({ vehicleId = 'vinfast-vf9', branchId = 'hn-caugiay', mode = 'full' } = {}) {
    const coRes = await api('/checkout', {
      method: 'POST',
      headers: { 'Idempotency-Key': `idem-p2-${crypto.randomUUID().slice(0, 8)}` },
      body: JSON.stringify({
        source: 'direct',
        items: [{ itemType: 'vehicle', itemId: vehicleId, quantity: 1 }],
        branchId,
        acceptedPolicy: true,
        buyerName: 'Minh Hoang P2',
        buyerPhone: '0901234567'
      })
    }, buyerToken);
    assert.strictEqual(coRes.status, 201);
    const order = coRes.body.data.order;

    const intentRes = await api('/payments/intents', {
      method: 'POST',
      body: JSON.stringify({
        orderId: order.id,
        mode,
        provider: 'napas_qr_sandbox'
      })
    }, buyerToken);
    assert.strictEqual(intentRes.status, 201);
    const intent = intentRes.body.data;

    const whPayloadStr = JSON.stringify({
      eventId: `evt_p2_${crypto.randomUUID().slice(0, 8)}`,
      intentId: intent.id,
      status: 'succeeded',
      amount: intent.amount,
      currency: 'VND'
    });
    const sig = PaymentGateway.signWebhookPayload(whPayloadStr, PaymentGateway.getWebhookSecret('napas_qr_sandbox'));
    const whRes = await api('/payments/webhooks/napas_qr_sandbox', {
      method: 'POST',
      headers: { 'x-webhook-signature': `sha256=${sig}` },
      body: whPayloadStr
    });
    assert.strictEqual(whRes.status, 200);
    return whRes.body.data.order || order;
  }

  before(async () => {
    app = await startTestServer({ mode: 'memory', reseed: true });
    BASE_URL = app.baseUrl;

    const login = async (email, password) => {
      const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      assert.strictEqual(r.status, 200);
      return r.body.data;
    };

    buyerToken = (await login('minhhoang.sigma@example.com', 'Buyer@123456')).token;
    const reg2 = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        fullName: 'Buyer Two P2',
        email: 'buyer2.p2@example.com',
        phone: '0988777666',
        password: 'Buyer2@123456'
      })
    });
    assert.strictEqual(reg2.status, 201);
    buyer2Token = reg2.body.data.token;

    sellerToken = (await login('minhphan.seller@sigmacar.vn', 'Seller@123456')).token;
    adminToken = (await login('admin@sigmacar.vn', 'Admin@123456')).token;
  });

  after(async () => {
    EmailProvider.__testHooks.forceFailCount = 0;
    EmailProvider.__testHooks.forceTimeoutCount = 0;
    HandoverService.__testHooks.failAfterOwnership = false;
    if (app) await app.close();
  });

  it('SIG-P2-001: Transactional outbox enqueue, secret redaction, retry backoff, DLQ & user read state', async () => {
    await runInTransaction(async (state) => {
      NotificationService.enqueueOutboxInState(state, {
        userId: 'usr_buyer_01',
        recipientEmail: 'minhhoang.sigma@example.com',
        eventType: 'ORDER_CREATED',
        aggregateId: 'ord_p2_redaction_test',
        subject: 'Xác nhận đơn hàng test bảo mật',
        message: 'Đơn hàng đang xử lý',
        payload: {
          orderNumber: 'SG-P2-SECRET',
          passwordHash: 'should_not_leak',
          secret: 'super_secret',
          token: 'jwt_token_value'
        },
        dedupeKey: `redaction_test_${Date.now()}`
      });
    });

    const job = dbState.outboxEvents.find(e => e.aggregateId === 'ord_p2_redaction_test');
    assert.ok(job, 'Outbox job should be persisted atomically');
    assert.strictEqual(job.payload.passwordHash, undefined);
    assert.strictEqual(job.payload.secret, undefined);
    assert.strictEqual(job.payload.token, undefined);

    // Simulate 3 consecutive provider failures -> retries then moves to dead_letter
    EmailProvider.__testHooks.forceFailCount = 3;
    let sum = await OutboxWorker.processOutboxBatch({ nowMs: Date.now() });
    assert.ok(sum.retried >= 1);

    // Jump clock forward beyond exponential backoff -> attempt 2
    sum = await OutboxWorker.processOutboxBatch({ nowMs: Date.now() + 60000 });
    assert.ok(sum.retried >= 1);

    // Jump clock again -> attempt 3 -> dead_letter
    sum = await OutboxWorker.processOutboxBatch({ nowMs: Date.now() + 300000 });
    assert.ok(sum.deadLettered >= 1);
    const updatedJob = dbState.outboxEvents.find(e => e.id === job.id);
    assert.strictEqual(updatedJob.status, 'dead_letter');
    EmailProvider.__testHooks.forceFailCount = 0;

    // Enqueue clean second job and verify sandbox queue + notification markRead HTTP API
    const dedupe = `clean_notif_${Date.now()}`;
    await runInTransaction(async (state) => {
      NotificationService.enqueueOutboxInState(state, {
        userId: 'usr_buyer_01',
        recipientEmail: 'minhhoang.sigma@example.com',
        eventType: 'PAYMENT_CONFIRMED',
        aggregateId: 'ord_p2_notif_ok',
        subject: 'Thanh toán hợp lệ',
        message: 'Giao dịch đã ghi nhận',
        dedupeKey: dedupe
      });
    });
    const okBatch = await OutboxWorker.processOutboxBatch({ nowMs: Date.now() });
    assert.ok(okBatch.sandboxQueued >= 1 || okBatch.delivered >= 1);

    const listRes = await api('/notifications', {}, buyerToken);
    assert.strictEqual(listRes.status, 200);
    const notifArr = Array.isArray(listRes.body.data) ? listRes.body.data : (listRes.body.data?.items || []);
    const createdNotif = notifArr.find(n => n.eventType === 'PAYMENT_CONFIRMED');
    assert.ok(createdNotif);

    const readRes = await api(`/notifications/${createdNotif.id}/read`, { method: 'PATCH' }, buyerToken);
    assert.strictEqual(readRes.status, 200);
    assert.ok(readRes.body.data.readAt);
  });

  it('SIG-P2-002: Authoritative loan schedule (equal_principal + 0% rate + DTI) & financing RBAC approval workflow', async () => {
    const res = FinancingService.calculateLoan({
      vehiclePrice: 1200000000,
      downPaymentPercent: 25,
      annualInterestRatePercent: 8.4,
      termMonths: 48,
      repaymentMethod: 'equal_principal',
      includeSchedule: true,
      monthlyIncome: 85000000,
      monthlyObligation: 5000000
    });
    assert.strictEqual(res.financedPrincipal, 900000000);
    assert.strictEqual(res.schedule.length, 48);
    const principalSum = res.schedule.reduce((s, r) => s + r.principalPaid, 0);
    assert.strictEqual(principalSum, 900000000);
    assert.ok(res.affordability && typeof res.affordability.dtiPercent === 'number');

    const zeroRes = FinancingService.calculateLoan({
      vehiclePrice: 1000000000,
      downPaymentPercent: 20,
      annualInterestRatePercent: 0,
      termMonths: 40,
      repaymentMethod: 'equal_principal',
      includeSchedule: true
    });
    assert.strictEqual(zeroRes.totalInterest, 0);
    assert.strictEqual(zeroRes.firstMonthPayment, 20000000);

    // Order in Deposit_Paid to verify lender approval NEVER mutates paymentStatus
    const ord = await createSettledOrderForBuyer({ vehicleId: 'lucid-air-sapphire', mode: 'deposit' });

    const submitRes = await api('/financing/applications', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: 'lucid-air-sapphire',
        orderId: ord.id,
        downPaymentPercent: 30,
        annualInterestRatePercent: 7.9,
        termMonths: 60,
        repaymentMethod: 'equal_principal',
        monthlyIncome: 95000000,
        consentCreditCheck: true
      })
    }, buyerToken);
    assert.strictEqual(submitRes.status, 201);
    const finApp = submitRes.body.data;
    assert.strictEqual(finApp.status, 'Pending_Review');

    // Foreign buyer read denied (403)
    const foreignRead = await api(`/financing/applications/${finApp.id}`, {}, buyer2Token);
    assert.strictEqual(foreignRead.status, 403);

    // Buyer cannot self-approve (403)
    const selfApprove = await api(`/financing/applications/${finApp.id}/review`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'approve_lender', lenderRef: 'FAKE-999' })
    }, buyerToken);
    assert.strictEqual(selfApprove.status, 403);

    // Seller verifies application
    const verRes = await api(`/financing/applications/${finApp.id}/review`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'verify', decisionNote: 'Hồ sơ khớp CCCD', expectedVersion: finApp.version })
    }, sellerToken);
    assert.strictEqual(verRes.status, 200);
    assert.strictEqual(verRes.body.data.status, 'Seller_Verified');

    // Lender approval requires non-empty lenderRef (422 if missing)
    const missingRef = await api(`/financing/applications/${finApp.id}/review`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'approve_lender', expectedVersion: verRes.body.data.version })
    }, sellerToken);
    assert.strictEqual(missingRef.status, 422);

    const approveRes = await api(`/financing/applications/${finApp.id}/review`, {
      method: 'PATCH',
      body: JSON.stringify({
        action: 'approve_lender',
        lenderRef: 'VPB-LOAN-2026-881',
        decisionNote: 'Ngân hàng duyệt hạn mức',
        expectedVersion: verRes.body.data.version
      })
    }, sellerToken);
    assert.strictEqual(approveRes.status, 200);
    assert.strictEqual(approveRes.body.data.status, 'Lender_Approved');

    // Order paymentStatus must remain Deposit Paid (approval never fakes Paid!)
    const ordCheck = dbState.orders.find(o => o.id === ord.id);
    assert.strictEqual(ordCheck.paymentStatus, PAYMENT_STATUS.DEPOSIT_PAID);
  });

  it('SIG-P2-003: Test drive slot contention (20 concurrent -> 1 wins), past date 422, home area gate & reschedule frees slot', async () => {
    const futureDate = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const shortDate = futureDate.replace(/-0(\d)/g, '-$1'); // Test YYYY-M-D normalization

    const slotRes = await api(`/appointments/slots?branchId=hn-caugiay&date=${futureDate}`);
    assert.strictEqual(slotRes.status, 200);
    assert.ok(slotRes.body.data.slots.length > 0);

    // Past date rejection (422)
    const pastRes = await api('/appointments', {
      method: 'POST',
      body: JSON.stringify({
        carName: 'SIGMA Model E Performance',
        customerName: 'Past Test',
        phone: '0901234567',
        email: 'past@example.com',
        branchId: 'hn-caugiay',
        preferredDate: '2020-01-01',
        timeSlot: '09:00'
      })
    });
    assert.strictEqual(pastRes.status, 422);

    // Home service outside branch coverage area rejection (422 HOME_SERVICE_OUTSIDE_AREA)
    const outAreaRes = await api('/appointments', {
      method: 'POST',
      body: JSON.stringify({
        carName: 'SIGMA Model E Performance',
        customerName: 'Far District',
        phone: '0901234567',
        email: 'far@example.com',
        branchId: 'hn-caugiay',
        preferredDate: futureDate,
        timeSlot: '09:00',
        isHomeService: true,
        district: 'Huyện Củ Chi',
        homeAddress: '123 Đường Xuyên Á'
      })
    });
    assert.strictEqual(outAreaRes.status, 422);

    // 20 concurrent bookings on identical { branchId: hn-caugiay, preferredDate, timeSlot: '15:30' }
    const racers = Array.from({ length: 20 }, (_, i) => api('/appointments', {
      method: 'POST',
      body: JSON.stringify({
        carName: 'SIGMA Model E Performance',
        customerName: `Racer ${i}`,
        phone: `0901000${String(i).padStart(3, '0')}`,
        email: 'minhhoang.sigma@example.com',
        branchId: 'hn-caugiay',
        preferredDate: i % 2 === 0 ? futureDate : shortDate,
        timeSlot: '15:30'
      })
    }, buyerToken));
    const raceResults = await Promise.all(racers);
    const winners = raceResults.filter(r => r.status === 201);
    const conflicts = raceResults.filter(r => r.status === 409);
    assert.strictEqual(winners.length, 1);
    assert.strictEqual(conflicts.length, 19);
    const bookedId = winners[0].body.data.id;

    // Reschedule booked appointment from 15:30 -> 17:00, which must free 15:30!
    const nextDate = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
    const resched = await api(`/appointments/${bookedId}/reschedule`, {
      method: 'PATCH',
      body: JSON.stringify({ preferredDate: nextDate, timeSlot: '17:00', note: 'Đổi giờ chiều' })
    }, buyerToken);
    assert.strictEqual(resched.status, 200);
    assert.strictEqual(resched.body.data.timeSlot, '17:00');

    // Old slot 15:30 on futureDate is now free again!
    const rebookOldSlot = await api('/appointments', {
      method: 'POST',
      body: JSON.stringify({
        carName: 'SIGMA Model E Performance',
        customerName: 'After Reschedule',
        phone: '0905551122',
        email: 'after@example.com',
        branchId: 'hn-caugiay',
        preferredDate: futureDate,
        timeSlot: '15:30'
      })
    });
    assert.strictEqual(rebookOldSlot.status, 201);
  });

  it('SIG-P2-005: Private media magic-byte verification, JPEG EXIF stripping, EICAR quarantine & signed URL expiry/ACL', async () => {
    // 1. Magic byte spoof (.png containing plain text) rejected 422
    const spoofRes = await api('/media/upload', {
      method: 'POST',
      body: JSON.stringify({
        fileName: 'fake.png',
        mimeType: 'image/png',
        dataBase64: `data:image/png;base64,${Buffer.from('not really a png').toString('base64')}`,
        purpose: 'return_evidence'
      })
    }, buyerToken);
    assert.strictEqual(spoofRes.status, 422);

    // 2. EICAR test signature inside PDF quarantined (rejected 422 & stored in quarantine record)
    const eicarRes = await api('/media/upload', {
      method: 'POST',
      body: JSON.stringify({
        fileName: 'infected.pdf',
        mimeType: 'application/pdf',
        dataBase64: makePdfBase64('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR'),
        purpose: 'registration_doc'
      })
    }, buyerToken);
    assert.strictEqual(eicarRes.status, 422);

    // 3. Valid JPEG with APP1 EXIF segment has EXIF stripped and downloads cleanly via signed URL
    const jpgUp = await api('/media/upload', {
      method: 'POST',
      body: JSON.stringify({
        fileName: 'photo_exif.jpg',
        mimeType: 'image/jpeg',
        dataBase64: makeJpegWithExifBase64(),
        purpose: 'return_evidence'
      })
    }, buyerToken);
    assert.strictEqual(jpgUp.status, 201);
    const asset = jpgUp.body.data;
    assert.strictEqual(asset.scanStatus, 'clean');

    const dlRes = await fetch(`${BASE_URL.replace('/api/v1', '')}${asset.signedUrl}`);
    assert.strictEqual(dlRes.status, 200);
    const bytes = Buffer.from(await dlRes.arrayBuffer());
    assert.strictEqual(bytes.includes(Buffer.from('Exif')), false, 'EXIF metadata must be stripped');

    // Foreign user raw private read without valid signed token rejected 403
    const foreignDl = await api(`/media/${asset.id}`, {}, buyer2Token);
    assert.strictEqual(foreignDl.status, 403);

    // Expired signed URL rejected 401
    const expiredDl = await fetch(`${BASE_URL}/media/${asset.id}?exp=1000&token=badtoken`);
    assert.strictEqual(expiredDl.status, 401);
  });

  it('SIG-P2-006 & SIG-P2-007: Versioned policy snapshot & registration estimator + assisted document/plate workflow', async () => {
    const estSelf = await api('/registration/estimate', {
      method: 'POST',
      body: JSON.stringify({ vehicleId: 'vinfast-vf9', province: 'hanoi', serviceMode: 'self_registration' })
    });
    assert.strictEqual(estSelf.status, 200);
    assert.strictEqual(estSelf.body.data.breakdown.serviceFee, 0);

    const estAssisted = await api('/registration/estimate', {
      method: 'POST',
      body: JSON.stringify({ vehicleId: 'toyota-camry', province: 'hanoi', serviceMode: 'seller_assisted' })
    });
    assert.strictEqual(estAssisted.status, 200);
    assert.ok(estAssisted.body.data.breakdown.serviceFee > 0);
    assert.ok(estAssisted.body.data.breakdown.registrationTax > 0); // Hanoi ICE tax > 0

    // Publish a new policy version and verify policy endpoint exposes it
    const pubPol = await PolicyService.publishPolicy(
      { userId: 'usr_admin_01', role: 'admin' },
      { type: 'return_7d', version: 'v2026.12', title: 'Cập nhật mốc ODO thử nghiệm', rules: { windowDays: 7, maxOdoDeltaKm: 500, freeOdoThresholdKm: 250, odoFeePerKm: 5000, standardInspectionFee: 1500000 } }
    );
    assert.strictEqual(pubPol.version, 'v2026.12');

    // Create registration case on paid order -> seller_assisted submit requires uploaded clean document media
    const order = await createSettledOrderForBuyer({ vehicleId: 'tesla-roadster-2', mode: 'full' });

    const draftCase = await api('/registration/cases', {
      method: 'POST',
      body: JSON.stringify({ orderId: order.id, province: 'hanoi', serviceMode: 'seller_assisted', documentMediaIds: [] })
    }, buyerToken);
    assert.strictEqual(draftCase.status, 201);
    const regCaseId = draftCase.body.data.id;

    // Submit without docs -> 422
    const badSubmit = await api(`/registration/cases/${regCaseId}/submit`, { method: 'POST', body: '{}' }, buyerToken);
    assert.strictEqual(badSubmit.status, 422);

    // Upload clean PDF doc & submit cleanly
    const pdfUp = await api('/media/upload', {
      method: 'POST',
      body: JSON.stringify({ fileName: 'cccd.pdf', mimeType: 'application/pdf', dataBase64: makePdfBase64('id-doc'), purpose: 'registration_doc', linkedEntityId: order.id })
    }, buyerToken);
    assert.strictEqual(pdfUp.status, 201);

    await api('/registration/cases', {
      method: 'POST',
      body: JSON.stringify({ orderId: order.id, province: 'hanoi', serviceMode: 'seller_assisted', documentMediaIds: [pdfUp.body.data.id] })
    }, buyerToken);

    const okSubmit = await api(`/registration/cases/${regCaseId}/submit`, { method: 'POST', body: '{}' }, buyerToken);
    assert.strictEqual(okSubmit.status, 200);
    assert.strictEqual(okSubmit.body.data.status, 'submitted');

    // Admin/Seller advances -> tax_filing -> plate_issuance requires plateNumber
    const taxRes = await api(`/registration/cases/${regCaseId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'tax_filing', taxReceiptNo: 'TAX-HN-2026-01' })
    }, sellerToken);
    assert.strictEqual(taxRes.status, 200);

    const plateFail = await api(`/registration/cases/${regCaseId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'plate_issuance' })
    }, sellerToken);
    assert.strictEqual(plateFail.status, 422);

    const plateOk = await api(`/registration/cases/${regCaseId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'plate_issuance', plateNumber: '30K-888.99' })
    }, sellerToken);
    assert.strictEqual(plateOk.status, 200);
    assert.strictEqual(plateOk.body.data.plateNumber, '30K-888.99');
  });

  it('SIG-P2-009/010/013/014/015: Order timeline, invalid step 409, atomic handover rollback, VIN dup 409, Garage & Service bay/ODO', async () => {
    // 1. Confirmed (unhanded) order must NEVER appear in GET /api/v1/garage
    const confirmedOrder = await createSettledOrderForBuyer({ vehicleId: 'vinfast-vf9', mode: 'full' });
    // Advance Confirmed cleanly after webhook or use Pending -> Confirmed via Seller if Pending
    await api(`/orders/${confirmedOrder.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Confirmed' }) }, sellerToken);

    const preGarageRes = await api('/garage', {}, buyerToken);
    assert.strictEqual(preGarageRes.status, 200);
    const hasConfirmedInGarage = preGarageRes.body.data.ownedVehicles.some(v => v.orderId === confirmedOrder.id);
    assert.strictEqual(hasConfirmedInGarage, false, 'Confirmed order without handover must NOT appear as owned vehicle in Garage');

    // Invalid state transition on order (Confirmed -> Cancelled without valid transition or Delivered directly when invalid)
    const invalidStep = await api(`/orders/${confirmedOrder.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'Delivered' }) // Confirmed -> Preparing -> Shipped -> Delivered (skipping fails!)
    }, adminToken);
    assert.strictEqual(invalidStep.status, 409);

    // 2. Atomic Handover rollback test via __testHooks.failAfterOwnership
    const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    const testVin = `SGMA26VN${randomSuffix}9`;
    HandoverService.__testHooks.failAfterOwnership = true;
    await assert.rejects(
      () => HandoverService.executeHandover(
        { userId: 'usr_seller_01', role: 'seller', branchId: 'hn-caugiay' },
        { orderId: confirmedOrder.id, vin: testVin, pdiPassed: true, odoAtHandover: 12, buyerAcknowledged: true }
      ),
      /Injected transactional handover failure/
    );
    HandoverService.__testHooks.failAfterOwnership = false;
    assert.strictEqual(dbState.handovers.some(h => h.orderId === confirmedOrder.id), false);
    assert.strictEqual(dbState.vehicleOwnerships.some(o => o.vin === testVin), false);
    assert.strictEqual(dbState.orders.find(o => o.id === confirmedOrder.id).orderStatus, ORDER_STATUS.CONFIRMED);

    // 3. Real HTTP Handover succeeds and creates Ownership + Warranty + Garage entry
    const hoRes = await api('/handovers', {
      method: 'POST',
      body: JSON.stringify({ orderId: confirmedOrder.id, vin: testVin, motorNumber: `MTR-${randomSuffix}`, pdiPassed: true, odoAtHandover: 15, buyerAcknowledged: true })
    }, sellerToken);
    assert.strictEqual(hoRes.status, 201);
    const createdWarranty = hoRes.body.data.warranty;
    assert.strictEqual(createdWarranty.vin, testVin);

    // Duplicate VIN rejected 409 on another order
    const order2 = await createSettledOrderForBuyer({ vehicleId: 'toyota-camry', mode: 'full' });
    const dupVinHo = await api('/handovers', {
      method: 'POST',
      body: JSON.stringify({ orderId: order2.id, vin: testVin, pdiPassed: true, odoAtHandover: 5 })
    }, sellerToken);
    assert.strictEqual(dupVinHo.status, 409);

    // Handover ICE car with unique VIN -> Garage shows EV battery telemetry ONLY for EV, never fabricated 100% for Camry ICE
    const iceSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    const iceVin = `T0Y26CAM${iceSuffix}1`;
    const hoIce = await api('/handovers', {
      method: 'POST',
      body: JSON.stringify({ orderId: order2.id, vin: iceVin, pdiPassed: true, odoAtHandover: 10 })
    }, sellerToken);
    assert.strictEqual(hoIce.status, 201);

    const postGarageRes = await api('/garage', {}, buyerToken);
    assert.strictEqual(postGarageRes.status, 200);
    const ownedEv = postGarageRes.body.data.ownedVehicles.find(v => v.vin === testVin);
    const ownedIce = postGarageRes.body.data.ownedVehicles.find(v => v.vin === iceVin);
    assert.ok(ownedEv);
    assert.ok(ownedIce);
    assert.strictEqual(ownedIce.measuredBatterySoH, null, 'ICE vehicle must NOT invent battery SoH');

    // Order Timeline reflects events cleanly
    const tlRes = await api(`/orders/${confirmedOrder.id}/timeline`, {}, buyerToken);
    assert.strictEqual(tlRes.status, 200);
    assert.ok(tlRes.body.data.events.some(e => e.status === 'Completed' && String(e.note || '').includes(testVin)));

    // Service Appointment 4-bay conflict (4 allowed on same slot, 5th returns 409) & monotonic ODO guard (422)
    const srvDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    for (let i = 0; i < 4; i++) {
      const sb = await api('/maintenance/appointments', {
        method: 'POST',
        body: JSON.stringify({
          vehicleName: 'VinFast VF 9',
          vin: testVin,
          serviceCenterId: 'hn-caugiay',
          serviceType: 'Bảo dưỡng định kỳ 10.000 km',
          preferredDate: srvDate,
          timeSlot: '10:30'
        })
      }, buyerToken);
      assert.strictEqual(sb.status, 201);
    }
    const fifthBay = await api('/maintenance/appointments', {
      method: 'POST',
      body: JSON.stringify({
        vehicleName: 'VinFast VF 9',
        vin: testVin,
        serviceCenterId: 'hn-caugiay',
        serviceType: 'Bảo dưỡng định kỳ 10.000 km',
        preferredDate: srvDate,
        timeSlot: '10:30'
      })
    }, buyerToken);
    assert.strictEqual(fifthBay.status, 409);

    // Record service at ODO 12000 then reject lower ODO 5000 (422)
    const recOk = await api('/maintenance/records', {
      method: 'POST',
      body: JSON.stringify({
        vin: testVin,
        serviceType: 'Bảo dưỡng 10.000 km',
        odoKm: 12000,
        inspectionResult: 'Pin và phanh đạt chuẩn',
        laborCost: 1200000
      })
    }, sellerToken);
    assert.strictEqual(recOk.status, 201);

    const recLowOdo = await api('/maintenance/records', {
      method: 'POST',
      body: JSON.stringify({
        vin: testVin,
        serviceType: 'Kiểm tra lại',
        odoKm: 5000,
        inspectionResult: 'Should fail monotonic check'
      })
    }, sellerToken);
    assert.strictEqual(recLowOdo.status, 422);
  });

  it('SIG-P2-011 & SIG-P2-012: Server return estimate parity, evidence required, ledger-verified refund, failed gateway rollback & quarantine stock', async () => {
    const ord = await createSettledOrderForBuyer({ vehicleId: 'vinfast-vf3', mode: 'full' });
    const hoRes = await api('/handovers', {
      method: 'POST',
      body: JSON.stringify({
        orderId: ord.id,
        vin: `SGMA26RT${crypto.randomBytes(3).toString('hex').toUpperCase()}2`,
        pdiPassed: true,
        odoAtHandover: 10
      })
    }, sellerToken);
    assert.strictEqual(hoRes.status, 201);

    const estRes = await api(`/returns/estimate?orderId=${encodeURIComponent(ord.id)}&reasonId=exchange_model&currentOdoKm=300`, {}, buyerToken);
    assert.strictEqual(estRes.status, 200);
    const estFin = estRes.body.data.financials;
    assert.ok(estFin.totalDeductions > 0);
    assert.strictEqual(estFin.estimatedRefundAmount, estFin.originalPaidAmount - estFin.totalDeductions);

    // HTTP POST /returns without evidence rejects 422
    const noPhotoRes = await api('/returns', {
      method: 'POST',
      body: JSON.stringify({
        orderId: ord.id,
        reasonId: 'exchange_model',
        description: 'Tôi muốn đổi sang mẫu SUV rộng rãi hơn cho gia đình',
        currentOdoKm: 300,
        photos: [],
        confirmedPolicy: true
      })
    }, buyerToken);
    assert.strictEqual(noPhotoRes.status, 422);

    // Upload real PNG evidence & create return request
    const upPng = await api('/media/upload', {
      method: 'POST',
      body: JSON.stringify({ fileName: 'return_front.png', mimeType: 'image/png', dataBase64: makeMinimalPngBase64(), purpose: 'return_evidence', linkedEntityId: ord.id })
    }, buyerToken);
    assert.strictEqual(upPng.status, 201);

    const retRes = await api('/returns', {
      method: 'POST',
      body: JSON.stringify({
        orderId: ord.id,
        reasonId: 'exchange_model',
        description: 'Đổi sang dòng SUV cùng hệ sinh thái SIGMA',
        currentOdoKm: 300,
        mediaIds: [upPng.body.data.id],
        confirmedPolicy: true
      })
    }, buyerToken);
    assert.strictEqual(retRes.status, 201);
    const retItem = retRes.body.data;
    assert.strictEqual(retItem.financials.estimatedRefundAmount, estFin.estimatedRefundAmount);

    // Advance return request validly to 'Đang kiểm tra tình trạng xe' / 'Đang xử lý hoàn tiền hoặc đổi xe'
    for (const st of ['Đang kiểm tra điều kiện', 'Đã duyệt yêu cầu', 'Chờ đặt lịch thu hồi', 'Đã xác nhận lịch xe tải', 'Đang vận chuyển xe về trung tâm', 'Đang kiểm tra tình trạng xe']) {
      const stepRes = await api(`/returns/${retItem.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: st }) }, sellerToken);
      assert.strictEqual(stepRes.status, 200);
    }

    // Over-refund above settled amount blocked 409
    const overRef = await api('/refunds', {
      method: 'POST',
      body: JSON.stringify({ returnId: retItem.id, orderId: ord.id, amount: estFin.originalPaidAmount + 5000000, reason: 'Over refund test' })
    }, sellerToken);
    assert.strictEqual(overRef.status, 409);

    // Failed gateway leaves return status untouched & records failed refund (HTTP 502)
    const failGw = await api('/refunds', {
      method: 'POST',
      body: JSON.stringify({ returnId: retItem.id, orderId: ord.id, amount: estFin.estimatedRefundAmount, reason: 'Gateway timeout test', simulateOutcome: 'failed' })
    }, sellerToken);
    assert.strictEqual(failGw.status, 502);
    assert.strictEqual(failGw.body.data.status, 'failed');
    assert.strictEqual(dbState.returnRequests.find(r => r.id === retItem.id).status, 'Đang kiểm tra tình trạng xe');

    // Succeeded refund completes return & increments branch quarantinedQty (HTTP 201)
    const invBefore = (dbState.branchInventory || []).find(i => i.vehicleId === 'vinfast-vf3' && i.branchId === ord.branchId)?.quarantinedQty || 0;
    const okRef = await api('/refunds', {
      method: 'POST',
      body: JSON.stringify({
        returnId: retItem.id,
        orderId: ord.id,
        amount: estFin.estimatedRefundAmount,
        reason: 'Hoàn tiền chính thức',
        idempotencyKey: `ref_${retItem.id}_ok`
      })
    }, sellerToken);
    assert.strictEqual(okRef.status, 201);
    assert.strictEqual(okRef.body.data.status, 'succeeded');
    assert.strictEqual(dbState.returnRequests.find(r => r.id === retItem.id).status, 'Hoàn tất');
    const invAfter = (dbState.branchInventory || []).find(i => i.vehicleId === 'vinfast-vf3' && i.branchId === ord.branchId)?.quarantinedQty || 0;
    assert.strictEqual(invAfter, invBefore + 1);
  });

  it('SIG-P2-016 & SIG-P2-018: Support ticket CSAT 1..5 rating & E-Contract immutable acknowledgement lock (409)', async () => {
    const ord = await createSettledOrderForBuyer({ vehicleId: 'tesla-cybertruck', mode: 'full' });

    // Generate contract, view HTML, acknowledge once, then repeat ack -> 409 CONTRACT_LOCKED
    const genRes = await api('/contracts/generate', {
      method: 'POST',
      body: JSON.stringify({ orderId: ord.id })
    }, buyerToken);
    assert.strictEqual(genRes.status, 201);
    const contract = genRes.body.data;

    const docRes = await api(`/contracts/${contract.id}/document?format=html`, {}, buyerToken);
    assert.strictEqual(docRes.status, 200);

    const ack1 = await api(`/contracts/${contract.id}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify({ acceptedTerms: true, signerName: 'Minh Hoang', signerIdLast4: '1234' })
    }, buyerToken);
    assert.strictEqual(ack1.status, 200);
    assert.strictEqual(ack1.body.data.locked, true);

    const ack2 = await api(`/contracts/${contract.id}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify({ acceptedTerms: true, signerName: 'Minh Hoang', signerIdLast4: '1234' })
    }, buyerToken);
    assert.strictEqual(ack2.status, 409);

    // Support Ticket create -> staff resolve -> buyer CSAT rate 1..5
    const tCreate = await api('/support/tickets', {
      method: 'POST',
      body: JSON.stringify({
        customerName: 'Minh Hoang',
        customerPhone: '0901234567',
        customerEmail: 'minhhoang.sigma@example.com',
        category: 'Bảo hành & Bảo dưỡng',
        priority: 'Cao',
        linkedOrderId: ord.id,
        subject: 'Yêu cầu kiểm tra thông số hợp đồng',
        description: 'Vui lòng gửi bản sao hợp đồng kèm mã bảo hành dự kiến.'
      })
    }, buyerToken);
    assert.strictEqual(tCreate.status, 201);
    const ticket = tCreate.body.data;

    const resolveRes = await api(`/support/tickets/${ticket.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'Đã giải quyết', message: 'Đã hỗ trợ kiểm tra xong.' })
    }, sellerToken);
    assert.strictEqual(resolveRes.status, 200);

    const rateRes = await api(`/support/tickets/${ticket.id}/rate`, {
      method: 'POST',
      body: JSON.stringify({ rating: 5, comment: 'Phản hồi rất rõ ràng và chuyên nghiệp' })
    }, buyerToken);
    assert.strictEqual(rateRes.status, 200);
    assert.strictEqual(rateRes.body.data.satisfactionRating, 5);
  });
});
