// tests/integration/ecommerce_subsystems.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { dbState, seedInitialData, saveToDisk } = require('../../backend/infrastructure/storage-engine');
const ecommerceService = require('../../backend/application/ecommerce-service');
const { ROLES, RETURN_STATUS, APPOINTMENT_STATUS } = require('../../backend/domain/constants');

function resetDb() {
  Object.keys(dbState).forEach(k => delete dbState[k]);
  seedInitialData();
  saveToDisk();
}

const buyerUser = { userId: 'usr_buyer_01', role: ROLES.BUYER, fullName: 'Minh Hoàng', email: 'minhhoang.sigma@example.com' };
const buyer2User = { userId: 'usr_buyer_02', role: ROLES.BUYER, fullName: 'Phạm Thanh Thảo', email: 'thanhthao.ev@example.com' };
const adminUser = { userId: 'usr_admin_01', role: ROLES.ADMIN, fullName: 'Nguyễn Quản Trị', email: 'admin@sigmacar.vn' };
const supportStaffUser = { userId: 'usr_support_01', role: ROLES.SUPPORT_STAFF, fullName: 'Nguyễn Ngọc Lan', email: 'support@sigmacar.vn' };

test('Section 2: Automated 7-Day Returns Center lifecycle & state transitions', async () => {
  resetDb();

  // 1. Check eligible orders & 7-day policy
  const overview = ecommerceService.getReturnsData(buyerUser);
  assert.equal(overview.policy.windowDays, 7);
  assert.ok(overview.eligibleOrders.length >= 2);
  // ORD-9020 is delivered 3 days ago and has no active return yet -> eligible
  const ord9020 = overview.eligibleOrders.find(o => o.orderId === 'ORD-9020');
  assert.ok(ord9020, 'ORD-9020 should be present in eligibleOrders');
  assert.equal(ord9020.isEligible, true);

  // 2. Create a new return request for ORD-9020
  const created = await ecommerceService.createReturnRequest(buyerUser, {
    orderId: 'ORD-9020',
    requestType: 'Đổi xe tương đương (0 phí kiểm định nếu lỗi kỹ thuật)',
    reasonId: 'tech_issue',
    description: 'Cần kiểm tra cảm biến áp suất lốp TPMS bánh sau bên phải báo sai thông số.',
    actualCondition: 'Nguyên bản 100%, không trầy xước, đầy đủ 02 khóa NFC và sạc.',
    currentOdoKm: 120,
    pickupDate: '2026-11-10',
    pickupTimeSlot: '09:00 - 11:30',
    pickupAddress: 'Khu đô thị Thủ Thiêm, TP. Thủ Đức',
    confirmedPolicy: true
  });

  assert.ok(created.returnCode.startsWith('RET-2026-'));
  assert.equal(created.status, RETURN_STATUS.PENDING_RECEIPT);
  assert.equal(created.financials.totalDeductions, 0); // tech_issue has 0 deduction

  // 3. Supplement info by customer
  const supplemented = await ecommerceService.submitReturnSupplement(buyerUser, created.id, {
    message: 'Đính kèm thêm video màn hình ODO và lịch thu hồi buổi sáng.',
    pickupTimeSlot: '08:30 - 11:00'
  });
  assert.equal(supplemented.pickupSchedule.timeSlot, '08:30 - 11:00');
  assert.equal(supplemented.customerSupplements.length, 1);

  // 4. Admin transitions status and assigns recovery truck
  const updated = await ecommerceService.updateReturnStatus(adminUser, created.id, {
    status: RETURN_STATUS.CHECKING_CONDITIONS,
    carrierName: 'SIGMA Express Flatbed #02',
    assignedStaff: 'Kỹ sư Trần Quốc Hưng',
    note: 'Đã tiếp nhận hồ sơ, đang thẩm định hình ảnh thực tế.'
  });
  assert.equal(updated.status, RETURN_STATUS.CHECKING_CONDITIONS);
  assert.equal(updated.pickupSchedule.carrierName, 'SIGMA Express Flatbed #02');

  // 5. Rejecting without a reason must fail
  await assert.rejects(
    async () => {
      await ecommerceService.updateReturnStatus(adminUser, created.id, {
        status: RETURN_STATUS.REJECTED,
        note: ''
      });
    },
    /lý do từ chối/i
  );
});

test('Section 3: Digital Warranty activation (VIN verification & anti-duplicate) and Service Booking', async () => {
  resetDb();

  // 1. Invalid VIN should be rejected
  await assert.rejects(
    async () => {
      await ecommerceService.activateElectronicWarranty(buyerUser, {
        vin: 'INVALIDVIN9999999',
        motorNumber: 'MTR-000',
        purchaseDate: '2026-10-25',
        invoiceNumber: 'INV-FAKE'
      });
    },
    /Không tìm thấy đơn hàng chính hãng khớp với số khung VIN/i
  );

  // 2. Valid unactivated order ORD-9023 (VIN: SGCG2026VN003310) should activate Electronic Warranty
  const activated = await ecommerceService.activateElectronicWarranty(buyerUser, {
    vin: 'SGCG2026VN003310',
    motorNumber: 'MTR-150KW-310',
    purchaseDate: '2026-10-25',
    invoiceNumber: 'INV-SG2026-9023'
  });
  assert.equal(activated.vin, 'SGCG2026VN003310');
  assert.ok(activated.warrantyCode.startsWith('EW-SIGMA-'));

  // 3. Duplicate activation of the same VIN must be rejected
  await assert.rejects(
    async () => {
      await ecommerceService.activateElectronicWarranty(buyerUser, {
        vin: 'SGCG2026VN003310',
        motorNumber: 'MTR-150KW-310',
        purchaseDate: '2026-10-25',
        invoiceNumber: 'INV-SG2026-9023'
      });
    },
    /đã được kích hoạt bảo hành điện tử/i
  );

  // 4. Online Service Appointment booking & Admin Service Record logging
  const appt = await ecommerceService.createServiceAppointment(buyerUser, {
    vehicleId: 'city-g',
    vehicleName: 'SIGMA City G',
    vin: 'SGCG2026VN003310',
    licensePlate: '30K - 612.88',
    serviceCenterId: 'hn-caugiay',
    serviceType: 'BẢO DƯỠNG ĐỊNH KỲ',
    preferredDate: '2026-11-20',
    timeSlot: '09:00',
    conditionNotes: 'Bảo dưỡng mốc 1.000 km đầu tiên'
  });
  assert.ok(appt.appointmentCode.startsWith('#APT-2026-'));
  assert.equal(appt.status, APPOINTMENT_STATUS.PENDING);

  const confirmedAppt = await ecommerceService.updateServiceAppointmentStatus(adminUser, appt.id, {
    status: APPOINTMENT_STATUS.CONFIRMED,
    assignedTechnician: 'Kỹ sư Trần Quốc Hưng',
    bayNumber: 'Khoang 01'
  });
  assert.equal(confirmedAppt.status, APPOINTMENT_STATUS.CONFIRMED);

  const record = await ecommerceService.createServiceRecord(adminUser, {
    vin: 'SGCG2026VN003310',
    odoKm: 1050,
    serviceType: 'Bảo dưỡng mốc 1.000 km',
    serviceCenterId: 'hn-caugiay',
    technicianName: 'Trần Quốc Hưng',
    itemsPerformed: ['Kiểm tra SOH Pin', 'Siết lực gầm'],
    inspectionResult: 'Đạt chuẩn 100% — Pin SOH 100%',
    laborCost: 0,
    partsCost: 0
  });
  assert.equal(record.vin, 'SGCG2026VN003310');
  assert.equal(record.odoKm, 1050);
});

test('Section 4: Verified Reviews, Anti-Spam, Helpful Votes & Admin Moderation', async () => {
  resetDb();

  // 1. Buyer 1 owns city-g (ORD-9023) and hasn't reviewed city-g yet -> verifiedPurchase = true
  const rev = await ecommerceService.createReview(buyerUser, {
    vehicleId: 'city-g',
    rating: 5,
    criteria: { design: 5, performance: 5, features: 5, comfort: 4, value: 5 },
    title: 'Chiếc xe đô thị hoàn hảo cho gia đình trẻ',
    content: 'Xe vận hành rất êm ái trong phố, bán kính quay vòng nhỏ và sạc nhanh tại nhà cực kỳ tiện lợi.'
  });
  assert.equal(rev.verifiedPurchase, true);
  assert.equal(rev.rating, 5);

  // 2. Duplicate review by same user on same vehicle must be blocked
  await assert.rejects(
    async () => {
      await ecommerceService.createReview(buyerUser, {
        vehicleId: 'city-g',
        rating: 4,
        title: 'Đánh giá trùng lặp',
        content: 'Nội dung thử nghiệm chống spam đánh giá trùng lặp trên cùng 1 xe.'
      });
    },
    /đã gửi đánh giá cho mẫu xe này/i
  );

  // 3. Self-vote helpful must be blocked, another user voting helpful succeeds & toggles
  await assert.rejects(
    async () => {
      await ecommerceService.toggleHelpfulVote(buyerUser, rev.id);
    },
    /chính mình/i
  );

  const vote1 = await ecommerceService.toggleHelpfulVote(buyer2User, rev.id);
  assert.equal(vote1.helpfulCount, 1);
  assert.equal(vote1.voted, true);

  const vote2 = await ecommerceService.toggleHelpfulVote(buyer2User, rev.id);
  assert.equal(vote2.helpfulCount, 0);
  assert.equal(vote2.voted, false);

  // 4. Admin moderation requires reason
  await assert.rejects(
    async () => {
      await ecommerceService.moderateReview(adminUser, rev.id, { action: 'hide', reason: '' });
    },
    /lý do kiểm duyệt/i
  );

  const moderated = await ecommerceService.moderateReview(adminUser, rev.id, {
    action: 'hide',
    reason: 'Tạm ẩn để xác minh hình ảnh đính kèm.'
  });
  assert.equal(moderated.moderationStatus, 'hidden');
});

test('Section 5: Customer Support Center, Ticket Lookup & Strict Internal Notes Isolation', async () => {
  resetDb();

  // 1. Customer creates a support ticket
  const ticket = await ecommerceService.createSupportTicket(buyerUser, {
    subject: 'Hỗ trợ cài đặt lịch sạc thông minh giờ thấp điểm trên App',
    category: 'Kỹ thuật & Vận hành xe',
    linkedOrderId: 'ORD-9020',
    linkedVehicleName: 'SIGMA Model E',
    priority: 'Cao',
    description: 'Tôi muốn hẹn giờ sạc tự động từ 22:00 đến 05:00 sáng hôm sau cho bộ sạc Wallbox 11kW.'
  });
  assert.ok(ticket.ticketCode.startsWith('TCK-2026-'));
  // Customer response must never include internalNotes
  assert.equal(ticket.internalNotes, undefined);

  // 2. Support staff adds an internal note and updates status
  const staffView = await ecommerceService.updateSupportTicketAdmin(supportStaffUser, ticket.id, {
    status: 'Đang xử lý',
    internalNote: 'GHI CHÚ NỘI BỘ MẬT: Khách hàng VIP hạng Platinum, ưu tiên gọi hỗ trợ trực tiếp trong 15 phút.'
  });
  assert.ok(Array.isArray(staffView.internalNotes));
  assert.equal(staffView.internalNotes.length, 1);

  // 3. Customer looks up ticket or fetches support center -> internalNotes MUST be stripped!
  const customerLookup = ecommerceService.lookupTicketByCode(ticket.ticketCode, buyerUser);
  assert.equal(customerLookup.ticketCode, ticket.ticketCode);
  assert.equal(customerLookup.internalNotes, undefined, 'internalNotes must NEVER be exposed to customer');

  const customerOverview = ecommerceService.getSupportCenterData(buyerUser, {});
  const customerTicketInList = customerOverview.tickets.find(t => t.ticketCode === ticket.ticketCode);
  assert.ok(customerTicketInList);
  assert.equal(customerTicketInList.internalNotes, undefined, 'internalNotes must be stripped from customer ticket list');
});

test('Section 6: Email Campaigns personalization, safe dev queue & Unsubscribe privacy compliance', async () => {
  resetDb();

  // 1. Template personalization token replacement
  const rendered = ecommerceService.renderPersonalizedTemplate(
    '<p>Xin chào {{customer_name}}, chúc mừng sinh nhật {{birth_date}}! Mã ưu đãi: {{promo_code}} cho xe {{vehicle_name}}.</p>',
    'Chúc mừng {{customer_name}} - Ưu đãi {{promo_code}}',
    {
      fullName: 'Minh Hoàng',
      birthDate: '15/10/1992',
      promoCode: 'SIGMABDAY15',
      vehicleName: 'SIGMA Model E'
    }
  );
  assert.ok(rendered.renderedHtml.includes('Minh Hoàng'));
  assert.ok(rendered.renderedHtml.includes('15/10/1992'));
  assert.ok(rendered.renderedHtml.includes('SIGMABDAY15'));
  assert.ok(rendered.renderedSubject.includes('Minh Hoàng'));

  // 2. Execute scheduled campaign CMP-2026-01 in safe simulated dev mode & prevent duplicate send
  const sentCampaign = await ecommerceService.executeCampaignSend(adminUser, 'CMP-2026-01', { confirmed: true });
  assert.equal(sentCampaign.status, 'Hoàn tất');
  assert.equal(sentCampaign.deliveryMode, 'simulated_dev_queue');

  await assert.rejects(
    async () => {
      await ecommerceService.executeCampaignSend(adminUser, 'CMP-2026-01', { confirmed: true });
    },
    /đã được gửi trước đó/i
  );

  // 3. Unsubscribe flow updates user privacy consent and excludes them from marketing segments
  const unsubRes = await ecommerceService.unsubscribeMarketing({
    email: 'minhhoang.sigma@example.com',
    reason: 'Không muốn nhận email khuyến mãi định kỳ'
  });
  assert.equal(unsubRes.unsubscribed, true);
  assert.equal(unsubRes.marketingConsent, false);

  const userRecord = dbState.users.find(u => u.id === 'usr_buyer_01');
  assert.equal(userRecord.securityPrefs.marketingConsent, false);
});
