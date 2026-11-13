// tests/integration/p4_ops.test.js
// Comprehensive Integration & Security Test Suite for Plan Batch P4 (SIG-P4-001 .. SIG-P4-013)

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

const { startTestServer } = require('../helpers/test-app');
const { dbState, runInTransaction } = require('../../backend/infrastructure/storage-engine');
const ChargingProvider = require('../../backend/infrastructure/charging-provider');
const ChargingService = require('../../backend/application/charging-service');
const CampaignWorker = require('../../backend/workers/campaign-worker');
const EcommerceService = require('../../backend/application/ecommerce-service');
const { ORDER_STATUS, PAYMENT_STATUS, CAMPAIGN_STATUS } = require('../../backend/domain/constants');

function jsonRequest(baseUrl, path, { method = 'GET', token = null, body = null, rawText = false } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== null && !rawText) headers['Content-Type'] = 'application/json';
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === null ? undefined : (rawText ? body : JSON.stringify(body))
  });
}

async function api(baseUrl, path, opts = {}) {
  const res = await jsonRequest(baseUrl, path, opts);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  return { status: res.status, headers: res.headers, body: json, rawText: text };
}

async function loginAs(baseUrl, email, password) {
  const res = await api(baseUrl, '/api/v1/auth/login', {
    method: 'POST',
    body: { email, password }
  });
  assert.strictEqual(res.status, 200, `Login failed for ${email}: ${res.rawText}`);
  return res.body.data.token;
}

describe('P4 Operations, Growth, Community & Charging Platform (SIG-P4-001 .. SIG-P4-013)', () => {
  let srv;
  let adminToken;
  let sellerHnToken;
  let sellerHcmToken;
  let buyerToken;
  let buyer2Token;

  before(async () => {
    srv = await startTestServer({ mode: 'memory', reseed: true });
    adminToken = await loginAs(srv.rootUrl, 'admin@sigmacar.vn', 'Admin@123456');
    sellerHnToken = await loginAs(srv.rootUrl, 'minhphan.seller@sigmacar.vn', 'Seller@123456');
    sellerHcmToken = await loginAs(srv.rootUrl, 'linhnguyen.seller@sigmacar.vn', 'Seller@123456');
    buyerToken = await loginAs(srv.rootUrl, 'minhhoang.sigma@example.com', 'Buyer@123456');
    buyer2Token = await loginAs(srv.rootUrl, 'thanhthao.ev@example.com', 'Buyer@123456');
  });

  after(async () => {
    ChargingProvider.__testHooks.forceOutage = false;
    ChargingService._resetCache();
    if (srv) await srv.close();
  });

  // ------------------------------------------------------------------
  // SIG-P4-001 & SIG-P4-002: Workshop Scheduling, Bays/Techs & Parts Ledger
  // ------------------------------------------------------------------
  it('SIG-P4-001/002: prevents double-booked bay/tech, reserves/releases parts on cancel, commits ledger once on complete, blocks ODO regression & duplicate complete', async () => {
    const resList = await api(srv.rootUrl, '/api/v1/workshop/resources', { token: sellerHnToken });
    assert.strictEqual(resList.status, 200);
    const hnCenter = resList.body.data.centers.find(c => c.id === 'hn-caugiay');
    assert.ok(hnCenter, 'HN Cau Giay center exists');
    const hnBay = resList.body.data.bays.find(b => b.serviceCenterId === 'hn-caugiay');
    const hnTech = resList.body.data.technicians.find(t => t.serviceCenterId === 'hn-caugiay');
    const partHepa = resList.body.data.parts.find(p => p.sku === 'PRT-HVAC-HEPA');
    assert.ok(hnBay && hnTech && partHepa);
    const initialOnHand = partHepa.stockOnHand;

    const scheduledDate = '2027-02-15';
    const timeSlot = '09:00';

    // 1. Over-reserve parts -> 409 INSUFFICIENT_PART_STOCK
    const overPart = await api(srv.rootUrl, '/api/v1/workshop/jobs', {
      method: 'POST',
      token: sellerHnToken,
      body: {
        serviceCenterId: 'hn-caugiay',
        bayId: hnBay.id,
        technicianId: hnTech.id,
        vin: 'SGME2026VN001889',
        scheduledDate,
        timeSlot,
        serviceType: 'Thay lọc HEPA nhiều chiếc',
        partsRequested: [{ sku: 'PRT-HVAC-HEPA', quantity: 49 }]
      }
    });
    assert.strictEqual(overPart.status, 409);
    assert.strictEqual(overPart.body.error.code, 'INSUFFICIENT_PART_STOCK');

    // 2. Create first valid job reserving 2 units of PRT-HVAC-HEPA
    const job1Res = await api(srv.rootUrl, '/api/v1/workshop/jobs', {
      method: 'POST',
      token: sellerHnToken,
      body: {
        serviceCenterId: 'hn-caugiay',
        bayId: hnBay.id,
        technicianId: hnTech.id,
        vin: 'SGME2026VN001889',
        scheduledDate,
        timeSlot,
        serviceType: 'Bảo dưỡng định kỳ 15.000 km',
        laborItems: [{ title: 'Nhân công kiểm tra Pin', amount: 300000 }],
        partsRequested: [{ sku: 'PRT-HVAC-HEPA', quantity: 2 }]
      }
    });
    assert.strictEqual(job1Res.status, 201);
    const job1 = job1Res.body.data;
    assert.strictEqual(job1.partsCost, partHepa.unitPrice * 2);
    assert.strictEqual(job1.totalCost, 300000 + partHepa.unitPrice * 2);

    // Check parts reserved incremented
    const afterReserve = await api(srv.rootUrl, '/api/v1/workshop/resources', { token: sellerHnToken });
    const hepaAfterReserve = afterReserve.body.data.parts.find(p => p.sku === 'PRT-HVAC-HEPA');
    assert.strictEqual(hepaAfterReserve.stockReserved, partHepa.stockReserved + 2);

    // 3. Double booking same bay/slot -> 409 BAY_CONFLICT
    const dupBay = await api(srv.rootUrl, '/api/v1/workshop/jobs', {
      method: 'POST',
      token: sellerHnToken,
      body: {
        serviceCenterId: 'hn-caugiay',
        bayId: hnBay.id,
        scheduledDate,
        timeSlot,
        vin: 'SGVS2026VN005412',
        serviceType: 'Kiểm tra hệ thống phanh'
      }
    });
    assert.strictEqual(dupBay.status, 409);
    assert.strictEqual(dupBay.body.error.code, 'BAY_CONFLICT');

    // 4. Seller HCM cannot manage HN Cau Giay job -> 403
    const crossBranch = await api(srv.rootUrl, `/api/v1/workshop/jobs/${job1.id}/cancel`, {
      method: 'POST',
      token: sellerHcmToken,
      body: { reason: 'Cross branch cancel attempt' }
    });
    assert.strictEqual(crossBranch.status, 403);

    // 5. Cancel job1 -> releases 2 reserved parts
    const cancelRes = await api(srv.rootUrl, `/api/v1/workshop/jobs/${job1.id}/cancel`, {
      method: 'POST',
      token: buyerToken,
      body: { reason: 'Khách đổi ngày' }
    });
    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelRes.body.data.status, 'Cancelled');

    const afterCancel = await api(srv.rootUrl, '/api/v1/workshop/resources', { token: sellerHnToken });
    const hepaAfterCancel = afterCancel.body.data.parts.find(p => p.sku === 'PRT-HVAC-HEPA');
    assert.strictEqual(hepaAfterCancel.stockReserved, partHepa.stockReserved);
    assert.strictEqual(hepaAfterCancel.stockOnHand, initialOnHand);

    // 6. Create job2 in same freed slot & complete it
    const job2Res = await api(srv.rootUrl, '/api/v1/workshop/jobs', {
      method: 'POST',
      token: sellerHnToken,
      body: {
        serviceCenterId: 'hn-caugiay',
        bayId: hnBay.id,
        technicianId: hnTech.id,
        vin: 'SGME2026VN001889',
        scheduledDate,
        timeSlot,
        serviceType: 'Thay lọc gió & kiểm tra ODO',
        laborItems: [{ title: 'Nhân công thay lọc gió', amount: 200000 }],
        partsRequested: [{ sku: 'PRT-HVAC-HEPA', quantity: 1 }]
      }
    });
    assert.strictEqual(job2Res.status, 201);
    const job2 = job2Res.body.data;

    // 7. ODO regression (WAR-2026-889 has currentOdoKm = 12450) -> 422 INVALID_ODO_REGRESSION
    const odoReg = await api(srv.rootUrl, `/api/v1/workshop/jobs/${job2.id}/complete`, {
      method: 'POST',
      token: sellerHnToken,
      body: { odoKm: 9000 }
    });
    assert.strictEqual(odoReg.status, 422);
    assert.strictEqual(odoReg.body.error.code, 'INVALID_ODO_REGRESSION');

    // 8. Valid completion -> consumes 1 stockOnHand & creates immutable invoiceSnapshot
    const compRes = await api(srv.rootUrl, `/api/v1/workshop/jobs/${job2.id}/complete`, {
      method: 'POST',
      token: sellerHnToken,
      body: { odoKm: 13200, resultSummary: 'Pin SoH 98%, phanh tốt' }
    });
    assert.strictEqual(compRes.status, 200);
    assert.ok(compRes.body.data.invoiceSnapshot.invoiceCode.startsWith('HD-DV-'));
    assert.strictEqual(compRes.body.data.job.status, 'Completed');

    const afterComplete = await api(srv.rootUrl, '/api/v1/workshop/resources', { token: sellerHnToken });
    const hepaAfterComplete = afterComplete.body.data.parts.find(p => p.sku === 'PRT-HVAC-HEPA');
    assert.strictEqual(hepaAfterComplete.stockOnHand, initialOnHand - 1);

    // 9. Duplicate completion -> 409 JOB_ALREADY_COMPLETED
    const dupComp = await api(srv.rootUrl, `/api/v1/workshop/jobs/${job2.id}/complete`, {
      method: 'POST',
      token: sellerHnToken,
      body: { odoKm: 13250 }
    });
    assert.strictEqual(dupComp.status, 409);
    assert.strictEqual(dupComp.body.error.code, 'JOB_ALREADY_COMPLETED');
  });

  // ------------------------------------------------------------------
  // SIG-P4-003: Warranty Claim Workflow & Out-of-Coverage Admin Override
  // ------------------------------------------------------------------
  it('SIG-P4-003: evaluates warranty coverage, enforces Admin override for out-of-coverage approval, hides staff internal note from Buyer', async () => {
    // 1. Out-of-coverage tire wear claim by Buyer
    const tireClaimRes = await api(srv.rootUrl, '/api/v1/warranty-claims', {
      method: 'POST',
      token: buyerToken,
      body: {
        vin: 'SGME2026VN001889',
        warrantyId: 'WAR-2026-889',
        serviceCenterId: 'hn-caugiay',
        componentCategory: 'tires',
        issueSummary: 'Lốp trước bên phải bị mòn sau 13.000 km vận hành đường trường',
        estimatedCost: 4200000
      }
    });
    assert.strictEqual(tireClaimRes.status, 201);
    const tireClaim = tireClaimRes.body.data;
    assert.strictEqual(tireClaim.coverageResult, 'out_of_coverage');

    // 2. Seller cannot directly approve out-of-coverage claim -> 403 ADMIN_OVERRIDE_REQUIRED_OUT_OF_COVERAGE
    const sellerApprove = await api(srv.rootUrl, `/api/v1/warranty-claims/${tireClaim.id}/review`, {
      method: 'PATCH',
      token: sellerHnToken,
      body: {
        nextStatus: 'Approved',
        decisionReason: 'Xin duyệt thiện chí cho khách VIP'
      }
    });
    assert.strictEqual(sellerApprove.status, 403);
    assert.strictEqual(sellerApprove.body.error.code, 'ADMIN_OVERRIDE_REQUIRED_OUT_OF_COVERAGE');

    // 3. Admin approves with goodwill override + internal staff note + linked workshop job
    const adminApprove = await api(srv.rootUrl, `/api/v1/warranty-claims/${tireClaim.id}/review`, {
      method: 'PATCH',
      token: adminToken,
      body: {
        nextStatus: 'Approved',
        decisionReason: 'Duyệt thiện chí khách hàng Gold Member 50% chi phí',
        staffInternalNote: 'INTERNAL_SECRET_ADMIN_NOTE',
        approvedAmount: 2100000,
        scheduleJob: {
          serviceCenterId: 'hn-caugiay',
          scheduledDate: '2027-02-20',
          timeSlot: '10:30'
        }
      }
    });
    assert.strictEqual(adminApprove.status, 200);
    assert.strictEqual(adminApprove.body.data.status, 'Approved');
    assert.ok(adminApprove.body.data.linkedJobId, 'Linked workshop job should be scheduled on approval');

    // 4. Buyer listing strips staffInternalNote & reviewedBy
    const buyerClaims = await api(srv.rootUrl, '/api/v1/warranty-claims', { token: buyerToken });
    assert.strictEqual(buyerClaims.status, 200);
    const found = buyerClaims.body.data.find(c => c.id === tireClaim.id);
    assert.ok(found);
    assert.strictEqual(found.staffInternalNote, undefined);
    assert.strictEqual(found.reviewedBy, undefined);
  });

  // ------------------------------------------------------------------
  // SIG-P4-004 & SIG-P4-005: Verified Reviews & Community Q&A Integrity
  // ------------------------------------------------------------------
  it('SIG-P4-004/005: enforces server handover badge verification, strict rating, PII redaction, anti self-moderation & Q&A moderation', async () => {
    await runInTransaction(async (state) => {
      state.reviews = (state.reviews || []).filter(r => !(r.vehicleId === 'model-e' && r.userId === 'usr_buyer_01'));
    });

    // 1. Non-integer rating -> 422 INVALID_RATING
    const badRating = await api(srv.rootUrl, '/api/v1/reviews', {
      method: 'POST',
      token: buyerToken,
      body: {
        vehicleId: 'model-e',
        rating: 99,
        title: 'Điểm đánh giá không hợp lệ',
        content: 'Nội dung thử nghiệm kiểm tra validation số sao.'
      }
    });
    assert.strictEqual(badRating.status, 422);
    assert.strictEqual(badRating.body.error.code, 'INVALID_RATING');

    // 2. Deposit-only unhanded order (ORD-9021 on vision-s) with spoofed verifiedPurchase: true -> server forces false!
    const depositReview = await api(srv.rootUrl, '/api/v1/reviews', {
      method: 'POST',
      token: buyerToken,
      body: {
        vehicleId: 'vision-s',
        rating: 5,
        title: 'Đặt cọc Vision S trải nghiệm showroom rất tốt',
        content: 'Tôi mới đặt cọc và xem xe thực tế tại showroom, thiết kế nội thất rất ấn tượng.',
        verifiedPurchase: true
      }
    });
    assert.strictEqual(depositReview.status, 201);
    assert.strictEqual(depositReview.body.data.verifiedPurchase, false);

    // 3. Delivered order (ORD-9020 on model-e) -> verifiedPurchase: true + public GET strips userId
    const verifiedReview = await api(srv.rootUrl, '/api/v1/reviews', {
      method: 'POST',
      token: buyerToken,
      body: {
        vehicleId: 'model-e',
        rating: 5,
        title: 'Chủ xe Model E vận hành thực tế 12.000 km',
        content: 'Xe cách âm tốt, sạc nhanh ổn định và chi phí bảo dưỡng định kỳ hợp lý.'
      }
    });
    assert.strictEqual(verifiedReview.status, 201);
    assert.strictEqual(verifiedReview.body.data.verifiedPurchase, true);
    const createdRevId = verifiedReview.body.data.id;

    // Public anonymous fetch redacts userId & internal moderation fields
    const pubReviews = await api(srv.rootUrl, '/api/v1/reviews?vehicleId=model-e');
    assert.strictEqual(pubReviews.status, 200);
    const revPublic = pubReviews.body.data.reviews.find(r => r.id === createdRevId);
    assert.ok(revPublic);
    assert.strictEqual(revPublic.userId, undefined);
    assert.strictEqual(revPublic.reportedBy, undefined);

    // 4. Seller cannot moderate their own review -> 403 SELF_MODERATION_FORBIDDEN
    const sellerSelfRev = await api(srv.rootUrl, '/api/v1/reviews', {
      method: 'POST',
      token: sellerHnToken,
      body: {
        vehicleId: 'vision-s',
        rating: 4,
        title: 'Góc nhìn chuyên viên về cảm giác lái Vision S',
        content: 'Khả năng tăng tốc mượt mà và phanh tái sinh điều chỉnh rất tuyến tính.'
      }
    });
    assert.strictEqual(sellerSelfRev.status, 201);
    const sellerSelfMod = await api(srv.rootUrl, `/api/v1/reviews/${sellerSelfRev.body.data.id}/moderate`, {
      method: 'PATCH',
      token: sellerHnToken,
      body: { action: 'hide', reason: 'Tự ẩn bài viết của mình' }
    });
    assert.strictEqual(sellerSelfMod.status, 403);
    assert.strictEqual(sellerSelfMod.body.error.code, 'SELF_MODERATION_FORBIDDEN');

    // 5. Community Q&A CRUD + Hide Moderation hides from public listing
    const qRes = await api(srv.rootUrl, '/api/v1/questions', {
      method: 'POST',
      token: buyerToken,
      body: { vehicleId: 'model-e', question: 'Model E có hỗ trợ sạc DC chuẩn CCS2 công suất tối đa bao nhiêu kW?' }
    });
    assert.strictEqual(qRes.status, 201);
    const qId = qRes.body.data.id;

    const qEdit = await api(srv.rootUrl, `/api/v1/questions/${qId}`, {
      method: 'PUT',
      token: buyerToken,
      body: { question: 'Model E bản AWD có hỗ trợ sạc DC CCS2 250 kW tại trạm công cộng không?' }
    });
    assert.strictEqual(qEdit.status, 200);
    assert.ok(qEdit.body.data.question.includes('250 kW'));

    const qModHide = await api(srv.rootUrl, `/api/v1/questions/${qId}/moderate`, {
      method: 'PATCH',
      token: adminToken,
      body: { action: 'hide', reason: 'Chờ xác minh thông số sạc chính thức' }
    });
    assert.strictEqual(qModHide.status, 200);

    const pubAfterHide = await api(srv.rootUrl, '/api/v1/reviews?vehicleId=model-e');
    assert.strictEqual(pubAfterHide.body.data.questions.some(q => q.id === qId), false);
  });

  // ------------------------------------------------------------------
  // SIG-P4-006 & SIG-P4-007: Financial Analytics, CSV Export, Consent-Aware Funnel
  // ------------------------------------------------------------------
  it('SIG-P4-006/007: computes revenue excluding cancelled/unpaid, enforces branch scope, exports CSV, respects analytics consent & dedupe', async () => {
    // 1. Cross-branch query by HN seller requesting hcm-q7 -> 403 BRANCH_SCOPE_DENIED
    const denied = await api(srv.rootUrl, '/api/v1/analytics/overview?branchId=hcm-q7', { token: sellerHnToken });
    assert.strictEqual(denied.status, 403);
    assert.strictEqual(denied.body.error.code, 'BRANCH_SCOPE_DENIED');

    // 2. Valid HN seller overview excludes Cancelled & accounts for refund deductions
    const beforeAna = await api(srv.rootUrl, '/api/v1/analytics/overview?branchId=hn-caugiay', { token: sellerHnToken });
    assert.strictEqual(beforeAna.status, 200);
    const baseNetCash = beforeAna.body.data.netCashVnd;

    await runInTransaction(async (state) => {
      state.orders.push({
        id: 'ORD-P4-CANCEL',
        orderNumber: 'SG-P4-CANCEL',
        userId: 'usr_buyer_01',
        vehicleId: 'model-e',
        vehicleName: 'SIGMA Model E',
        unitPrice: 999999999,
        depositAmount: 50000000,
        branchId: 'hn-caugiay',
        orderStatus: ORDER_STATUS.CANCELLED,
        paymentStatus: PAYMENT_STATUS.UNPAID,
        createdAt: new Date().toISOString()
      });
      if (!Array.isArray(state.refunds)) state.refunds = [];
      state.refunds.push({
        id: 'RFD-P4-1',
        orderId: 'ORD-9020',
        refundAmount: 10000000,
        status: 'Settled',
        settledAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      });
    });

    const afterAna = await api(srv.rootUrl, '/api/v1/analytics/overview?branchId=hn-caugiay', { token: sellerHnToken });
    assert.strictEqual(afterAna.status, 200);
    assert.strictEqual(afterAna.body.data.committedValue, beforeAna.body.data.committedValue, 'Cancelled order excluded from committed GMV');
    assert.strictEqual(afterAna.body.data.netCashVnd, baseNetCash - 10000000, 'Refund subtracted from netCashVnd');

    const csvRes = await api(srv.rootUrl, '/api/v1/analytics/export?branchId=hn-caugiay', { token: sellerHnToken });
    assert.strictEqual(csvRes.status, 200);
    assert.ok(csvRes.headers.get('content-type').includes('text/csv'));
    assert.ok(csvRes.rawText.includes('SG-2026-9020'));
    assert.ok(!csvRes.rawText.includes('SG-P4-CANCEL'), 'Cancelled order excluded from reconciled revenue CSV');

    // 3. Consent-aware funnel tracking + deduplication
    const sid = 'sess-p4-funnel-01';
    const optedOutView = await api(srv.rootUrl, '/api/v1/analytics/events', {
      method: 'POST',
      body: { sessionId: sid, eventType: 'vehicle_view', targetId: 'model-e', branchId: 'hn-caugiay', consentGranted: false }
    });
    assert.strictEqual(optedOutView.status, 202);
    assert.strictEqual(optedOutView.body.data.recorded, false);
    assert.strictEqual(optedOutView.body.data.skippedReason, 'OPT_OUT_NON_ESSENTIAL');

    const essentialCheckout = await api(srv.rootUrl, '/api/v1/analytics/events', {
      method: 'POST',
      body: { sessionId: sid, eventType: 'checkout', targetId: 'model-e', branchId: 'hn-caugiay', consentGranted: false }
    });
    assert.strictEqual(essentialCheckout.status, 202);
    assert.strictEqual(essentialCheckout.body.data.recorded, true);

    const view1 = await api(srv.rootUrl, '/api/v1/analytics/events', {
      method: 'POST',
      body: { sessionId: sid, eventType: 'vehicle_view', targetId: 'model-e', branchId: 'hn-caugiay', consentGranted: true }
    });
    const viewDup = await api(srv.rootUrl, '/api/v1/analytics/events', {
      method: 'POST',
      body: { sessionId: sid, eventType: 'vehicle_view', targetId: 'model-e', branchId: 'hn-caugiay', consentGranted: true }
    });
    assert.strictEqual(view1.body.data.recorded, true);
    assert.strictEqual(viewDup.body.data.deduplicated, true);

    const funnel = await api(srv.rootUrl, '/api/v1/analytics/funnel?branchId=hn-caugiay', { token: sellerHnToken });
    assert.strictEqual(funnel.status, 200);
    assert.strictEqual(funnel.body.data.counts.vehicle_view, 1);
    assert.strictEqual(funnel.body.data.counts.checkout, 1);
  });

  // ------------------------------------------------------------------
  // SIG-P4-008: CMS Editorial Versioning, Scheduling, XSS Stripping & Rollback
  // ------------------------------------------------------------------
  it('SIG-P4-008: strips XSS from CMS drafts, requires Admin to publish, schedules & auto-publishes once, supports rollback', async () => {
    const draftRes = await api(srv.rootUrl, '/api/v1/cms', {
      method: 'POST',
      token: sellerHnToken,
      body: {
        slug: 'uu-dai-mua-dong-p4',
        title: 'Ưu đãi Lãi suất 0% Tháng 11',
        contentType: 'banner',
        bodyHtml: '<p>Tặng gói sạc miễn phí!</p><script>alert("xss")</script><img src=x onerror="evil()">'
      }
    });
    assert.strictEqual(draftRes.status, 201);
    const cmsItem = draftRes.body.data;
    const savedHtml = (cmsItem.versions && cmsItem.versions[cmsItem.versions.length - 1]?.bodyHtml) || cmsItem.bodyHtml || '';
    assert.ok(!savedHtml.includes('<script'), 'Script tag must be stripped');
    assert.ok(!savedHtml.includes('onerror'), 'Inline event handler must be stripped');

    // Draft absent from public feed
    const pubBefore = await api(srv.rootUrl, '/api/v1/cms/public');
    assert.strictEqual(pubBefore.body.data.some(x => x.id === cmsItem.id), false);

    // Seller cannot publish -> 403 PUBLISHER_REQUIRED
    const sellerPub = await api(srv.rootUrl, `/api/v1/cms/${cmsItem.id}/publish`, {
      method: 'POST',
      token: sellerHnToken,
      body: { version: 1 }
    });
    assert.strictEqual(sellerPub.status, 403);
    assert.strictEqual(sellerPub.body.error.code, 'PUBLISHER_REQUIRED');

    // Admin schedules future publication
    const futureIso = new Date(Date.now() + 3600 * 1000).toISOString();
    const schedRes = await api(srv.rootUrl, `/api/v1/cms/${cmsItem.id}/publish`, {
      method: 'POST',
      token: adminToken,
      body: { version: 1, scheduledAt: futureIso }
    });
    assert.strictEqual(schedRes.status, 200);
    assert.strictEqual(schedRes.body.data.status, 'scheduled');

    // Before scheduledAt: absent from public
    const pubStillHidden = await api(srv.rootUrl, '/api/v1/cms/public');
    assert.strictEqual(pubStillHidden.body.data.some(x => x.id === cmsItem.id), false);

    // At future timestamp: auto-published & visible
    const futureMs = Date.now() + 7200 * 1000;
    const pubAtFuture = await api(srv.rootUrl, `/api/v1/cms/public?nowMs=${futureMs}`);
    assert.strictEqual(pubAtFuture.status, 200);
    const pubItemV1 = pubAtFuture.body.data.find(x => x.id === cmsItem.id);
    assert.ok(pubItemV1);
    assert.strictEqual(pubItemV1.publishedVersion, 1);

    // Create v2 and publish, then rollback to v1
    const v2Res = await api(srv.rootUrl, '/api/v1/cms', {
      method: 'POST',
      token: adminToken,
      body: {
        id: cmsItem.id,
        slug: 'uu-dai-mua-dong-p4',
        title: 'Ưu đãi Lãi suất 0% (Bản V2)',
        contentType: 'banner',
        bodyHtml: '<p>Nội dung phiên bản 2</p>',
        expectedVersion: pubItemV1.activeVersion
      }
    });
    assert.strictEqual(v2Res.status, 201);
    assert.strictEqual(v2Res.body.data.activeVersion, 2);

    const pubV2 = await api(srv.rootUrl, `/api/v1/cms/${cmsItem.id}/publish`, {
      method: 'POST',
      token: adminToken,
      body: { version: 2 }
    });
    assert.strictEqual(pubV2.status, 200);

    const rollbackRes = await api(srv.rootUrl, `/api/v1/cms/${cmsItem.id}/rollback`, {
      method: 'POST',
      token: adminToken,
      body: { targetVersion: 1, reason: 'Khôi phục bản V1 ổn định' }
    });
    assert.strictEqual(rollbackRes.status, 200);
    assert.strictEqual(rollbackRes.body.data.publishedVersion, 1);
    const pubAfterRollback = await api(srv.rootUrl, '/api/v1/cms/public');
    const restoredPublic = pubAfterRollback.body.data.find(x => x.id === cmsItem.id);
    assert.ok(restoredPublic);
    assert.strictEqual(restoredPublic.title, 'Ưu đãi Lãi suất 0% Tháng 11');
  });

  // ------------------------------------------------------------------
  // SIG-P4-009: EV Charging Stations & Outage Resilience
  // ------------------------------------------------------------------
  it('SIG-P4-009: discloses unknown tariff honestly, validates coordinates, degrades gracefully on outage with cache, returns 503 cold', async () => {
    try {
      ChargingService._resetCache();
      ChargingProvider.__testHooks.forceOutage = true;

      // 1. Cold cache + outage -> 503
      const coldFail = await api(srv.rootUrl, '/api/v1/charging/stations');
      assert.strictEqual(coldFail.status, 503);
      assert.strictEqual(coldFail.body.error.code, 'CHARGING_PROVIDER_UNAVAILABLE');

      // 2. Invalid coordinates -> 422 INVALID_COORDINATES
      ChargingProvider.__testHooks.forceOutage = false;
      const badCoords = await api(srv.rootUrl, '/api/v1/charging/stations?lat=999&lng=106');
      assert.strictEqual(badCoords.status, 422);
      assert.strictEqual(badCoords.body.error.code, 'INVALID_COORDINATES');

      // 3. Normal query loads warm cache and shows explicit null tariff as "Chưa công bố đơn giá"
      const warmOk = await api(srv.rootUrl, '/api/v1/charging/stations');
      assert.strictEqual(warmOk.status, 200);
      const q7Station = warmOk.body.data.stations.find(s => s.id === 'CS-HCM-Q7-02');
      assert.ok(q7Station);
      assert.strictEqual(q7Station.tariffVndPerKwh, null);
      assert.strictEqual(q7Station.tariffKnown, false);
      assert.strictEqual(q7Station.tariffDisplay, 'Chưa công bố đơn giá');

      // 4. Subsequent outage serves warm cache marked isStale: true
      ChargingProvider.__testHooks.forceOutage = true;
      const staleOk = await api(srv.rootUrl, '/api/v1/charging/stations?forceRefresh=true');
      assert.strictEqual(staleOk.status, 200);
      assert.strictEqual(staleOk.body.data.cacheMeta.isStale, true);
      assert.strictEqual(staleOk.body.data.cacheMeta.providerOutage, true);
    } finally {
      ChargingProvider.__testHooks.forceOutage = false;
      ChargingService._resetCache();
    }
  });

  // ------------------------------------------------------------------
  // SIG-P4-012 & SIG-P4-013: Email Segmentation, Template Escaping, Queue, Receipt Webhooks & Signed Unsubscribe
  // ------------------------------------------------------------------
  it('SIG-P4-012/013: segments birthday strictly, escapes template vars, reconciles delivery webhook & enforces signed unsubscribe', async () => {
    const currentMonthPadded = String(new Date().getMonth() + 1).padStart(2, '0');
    const wrongMonthPadded = String(((new Date().getMonth() + 1) % 12) + 1).padStart(2, '0');

    // Seed strict birthDate values: buyer1 matches current month, buyer2 wrong month, missing birthDate on others
    await runInTransaction(async (state) => {
      const b1 = state.users.find(u => u.id === 'usr_buyer_01');
      const b2 = state.users.find(u => u.id === 'usr_buyer_02');
      b1.fullName = 'Minh Hoàng <script>alert(1)</script>';
      b1.birthDate = `1995-${currentMonthPadded}-15`;
      b1.securityPrefs = { ...(b1.securityPrefs || {}), marketingConsent: true };
      b2.birthDate = `1994-${wrongMonthPadded}-10`;
      b2.securityPrefs = { ...(b2.securityPrefs || {}), marketingConsent: true };
    });

    // 1. Create birthday campaign with XSS tag in bodyHtml
    const campRes = await api(srv.rootUrl, '/api/v1/campaigns', {
      method: 'POST',
      token: adminToken,
      body: {
        name: 'Birthday P4 Test Campaign',
        category: 'Chúc mừng Sinh nhật',
        subject: 'Chúc mừng sinh nhật {{customer_name}}',
        targetSegment: 'birthday_month',
        promoCode: 'P4BDAY',
        bodyHtml: '<p>Xin chào {{customer_name}}!</p><script>steal()</script>'
      }
    });
    assert.strictEqual(campRes.status, 201);
    const campId = campRes.body.data.id;
    assert.strictEqual(campRes.body.data.stats.eligibleRecipients, 1, 'Only matching birthMonth user without blank date matched');
    assert.ok(!campRes.body.data.bodyHtml.includes('<script'));

    // 2. Enqueue without immediate worker flush -> deliveredCount must stay 0
    const execRes = await api(srv.rootUrl, `/api/v1/campaigns/${campId}/execute`, {
      method: 'POST',
      token: adminToken,
      body: { confirmed: true, enqueueOnly: true }
    });
    assert.strictEqual(execRes.status, 200);
    assert.strictEqual(execRes.body.data.stats.deliveredCount, 0);

    // 3. Process queue -> status becomes 'sent', deliveredCount MUST STILL be 0 until provider webhook!
    const procRes = await api(srv.rootUrl, '/api/v1/campaigns/process-queue', {
      method: 'POST',
      token: adminToken,
      body: { campaignId: campId }
    });
    assert.strictEqual(procRes.status, 200);

    const delivAfterSend = await api(srv.rootUrl, `/api/v1/campaigns/${campId}/deliveries`, { token: adminToken });
    assert.strictEqual(delivAfterSend.status, 200);
    assert.strictEqual(delivAfterSend.body.data.deliveries.length, 1);
    const deliveryRow = delivAfterSend.body.data.deliveries[0];
    assert.strictEqual(deliveryRow.deliveryStatus, 'sent');
    assert.strictEqual(delivAfterSend.body.data.campaign.stats.deliveredCount, 0);

    // Inspect stored renderedHtml for escaped customer_name & grab signed unsubscribeToken
    const rawDelivery = dbState.campaignDeliveries.find(d => d.id === deliveryRow.id);
    assert.ok(rawDelivery.renderedHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    const unsubToken = rawDelivery.unsubscribeToken;
    assert.ok(unsubToken);

    // 4. Webhook without valid signature -> 401 INVALID_WEBHOOK_SIGNATURE
    const webhookPayloadStr = JSON.stringify({
      deliveryId: deliveryRow.id,
      providerMessageId: deliveryRow.providerMessageId,
      eventType: 'delivered'
    });
    const badSigRes = await api(srv.rootUrl, '/api/v1/campaigns/webhooks/delivery', {
      method: 'POST',
      rawText: true,
      body: webhookPayloadStr
    });
    assert.strictEqual(badSigRes.status, 401);
    assert.strictEqual(badSigRes.body.error.code, 'INVALID_WEBHOOK_SIGNATURE');

    // 5. Valid signed webhook reconciles deliveredCount -> 1, replay returns idempotentReplay: true
    const goodSig = CampaignWorker.signCampaignWebhook(webhookPayloadStr);
    const rec1 = await fetch(`${srv.rootUrl}/api/v1/campaigns/webhooks/delivery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': goodSig },
      body: webhookPayloadStr
    });
    assert.strictEqual(rec1.status, 200);
    const rec1Json = await rec1.json();
    assert.strictEqual(rec1Json.data.idempotentReplay, false);
    assert.strictEqual(rec1Json.data.stats.deliveredCount, 1);

    const rec2 = await fetch(`${srv.rootUrl}/api/v1/campaigns/webhooks/delivery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': goodSig },
      body: webhookPayloadStr
    });
    assert.strictEqual(rec2.status, 200);
    const rec2Json = await rec2.json();
    assert.strictEqual(rec2Json.data.idempotentReplay, true);

    // 6. Unsubscribe authorization & last-minute opt-out queue guard
    const unauthUnsub = await api(srv.rootUrl, '/api/v1/unsubscribe', {
      method: 'POST',
      body: { email: 'minhhoang.sigma@example.com' }
    });
    assert.strictEqual(unauthUnsub.status, 401);
    assert.strictEqual(unauthUnsub.body.error.code, 'UNSUBSCRIBE_AUTH_REQUIRED');

    const crossUserUnsub = await api(srv.rootUrl, '/api/v1/unsubscribe', {
      method: 'POST',
      token: buyer2Token,
      body: { email: 'minhhoang.sigma@example.com' }
    });
    assert.strictEqual(crossUserUnsub.status, 403);
    assert.strictEqual(crossUserUnsub.body.error.code, 'UNSUBSCRIBE_FORBIDDEN');

    // Prepare second campaign targeting owners BEFORE unsubscribing buyer1, enqueue only, then unsubscribe with signed token, then flush worker -> must mark 'skipped_unsubscribed'!
    const ownersCamp = await api(srv.rootUrl, '/api/v1/campaigns', {
      method: 'POST',
      token: adminToken,
      body: {
        name: 'Owners Opt-Out Guard Campaign',
        category: 'Chào mừng Chủ xe mới & Gói đặc quyền',
        subject: 'Đặc quyền chủ xe {{customer_name}}',
        targetSegment: 'owners',
        bodyHtml: '<p>Xin chào {{customer_name}}</p>'
      }
    });
    assert.strictEqual(ownersCamp.status, 201);
    const ownerCampId = ownersCamp.body.data.id;

    await api(srv.rootUrl, `/api/v1/campaigns/${ownerCampId}/execute`, {
      method: 'POST',
      token: adminToken,
      body: { confirmed: true, enqueueOnly: true }
    });

    // Buyer1 clicks signed unsubscribe link WITHOUT login cookie -> 200 & sets marketingConsent: false
    const signedUnsub = await api(srv.rootUrl, '/api/v1/unsubscribe', {
      method: 'POST',
      body: { token: unsubToken, reason: 'Không muốn nhận tiếp thị' }
    });
    assert.strictEqual(signedUnsub.status, 200);
    assert.strictEqual(signedUnsub.body.data.marketingConsent, false);

    // Flush worker for ownerCampId -> queued row for buyer1 must be skipped_unsubscribed
    await api(srv.rootUrl, '/api/v1/campaigns/process-queue', {
      method: 'POST',
      token: adminToken,
      body: { campaignId: ownerCampId }
    });
    const ownerDeliv = await api(srv.rootUrl, `/api/v1/campaigns/${ownerCampId}/deliveries`, { token: adminToken });
    const b1Row = ownerDeliv.body.data.deliveries.find(d => d.recipientUserId === 'usr_buyer_01');
    assert.ok(b1Row);
    assert.strictEqual(b1Row.deliveryStatus, 'skipped_unsubscribed');
  });
});
