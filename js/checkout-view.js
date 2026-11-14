// js/checkout-view.js
// Atomic Checkout, 15-min Reservation Countdown, Payment Intents & Sandbox Webhook Panel (SIG-P1-007/008)

(function () {
  const BRANCHES = [
    { id: 'hn-caugiay', name: 'Showroom SIGMACAR Cầu Giấy (Hà Nội)' },
    { id: 'hn-mydinh', name: 'Showroom SIGMACAR Mỹ Đình (Hà Nội)' },
    { id: 'hcm-q7', name: 'Showroom SIGMACAR Quận 7 (TP.HCM)' },
    { id: 'hcm-thuduc', name: 'Showroom SIGMACAR Thủ Đức (TP.HCM)' },
    { id: 'dn-haichau', name: 'Showroom SIGMACAR Đà Nẵng' }
  ];

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtVnd(num) {
    return `${Math.round(Number(num) || 0).toLocaleString('vi-VN')} VNĐ`;
  }

  function newIdempotencyKey(prefix = 'idem') {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `${prefix}_${window.crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  async function renderOrderPaymentPanel(container, orderId, deps = {}) {
    const showToast = deps.showToast || window.showToast || (() => {});
    const isSandboxVisible = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || ApiClient.isDemoMode();

    container.innerHTML = `<div class="container" style="padding:60px 20px; text-align:center;">⏳ Đang tải thông tin thanh toán & sổ cái đơn hàng...</div>`;

    let history;
    let orderDetail;
    try {
      [history, orderDetail] = await Promise.all([
        ApiClient.payments.getHistory(orderId),
        ApiClient.orders.getById(orderId)
      ]);
    } catch (err) {
      container.innerHTML = `
        <div class="container" style="padding:64px 20px; max-width:640px;">
          <div style="background:#FEF2F2; border:1px solid #FCA5A5; border-radius:16px; padding:28px; text-align:center;">
            <h3>Không thể tải đơn hàng thanh toán</h3>
            <p style="color:#7F1D1D;">${esc(err.message)}</p>
            <button class="btn-primary" onclick="window.location.hash='profile'">Về Hồ sơ đơn hàng</button>
          </div>
        </div>
      `;
      return;
    }

    const totalDue = Math.max(0, history.totalAmount || 0);
    const depositDue = Math.max(0, history.depositAmount || 0);
    const paidAmount = Math.max(0, history.paidAmount || 0);
    const remainingDeposit = Math.max(0, depositDue - paidAmount);
    const remainingFull = Math.max(0, totalDue - paidAmount);
    const latestIntent = (history.intents || [])[0] || null;
    const isCancelled = orderDetail.orderStatus === 'Cancelled';
    const isSettled = remainingFull <= 0;

    let resCountdownText = 'Không có giữ chỗ đang hoạt động';
    if (orderDetail.reservationExpiresAt && orderDetail.paymentStatus === 'Unpaid' && !isCancelled) {
      const remMs = Date.parse(orderDetail.reservationExpiresAt) - Date.now();
      if (remMs > 0) {
        const mins = Math.floor(remMs / 60000);
        const secs = Math.floor((remMs % 60000) / 1000);
        resCountdownText = `Còn lại ${mins} phút ${secs} giây (${new Date(orderDetail.reservationExpiresAt).toLocaleTimeString('vi-VN')})`;
      } else {
        resCountdownText = 'Đã quá thời hạn giữ chỗ 15 phút';
      }
    } else if (paidAmount > 0) {
      resCountdownText = 'Đã chuyển đổi sang giữ xe chính thức sau thanh toán';
    }

    container.innerHTML = `
      <section class="section" style="padding-top:36px; padding-bottom:64px;">
        <div class="container" style="max-width:980px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:20px;">
            <div>
              <span style="display:inline-block; font-size:11.5px; font-weight:800; padding:4px 10px; border-radius:20px; background:${paidAmount > 0 ? '#DCFCE7' : '#FEF3C7'}; color:${paidAmount > 0 ? '#166534' : '#92400E'}; margin-bottom:6px;">
                TRẠNG THÁI ĐƠN: ${esc(orderDetail.orderStatus)} • THANH TOÁN: ${esc(orderDetail.paymentStatus)}
              </span>
              <h1 style="font-size:26px; font-weight:800; margin:0;">Đơn hàng ${esc(orderDetail.orderNumber || orderDetail.id)}</h1>
              <p style="font-size:13.5px; color:var(--text-muted); margin:4px 0 0;">${esc(orderDetail.vehicleName)} • ${esc(orderDetail.branchName || orderDetail.branchId)}</p>
            </div>
            <button type="button" class="btn-secondary" onclick="window.location.hash='profile'">← Đơn hàng của tôi</button>
          </div>

          ${history.exceptionStatus ? `
            <div style="background:#FEF2F2; border:1px solid #F87171; border-radius:12px; padding:14px 18px; margin-bottom:18px; color:#991B1B; font-size:13.5px;">
              <strong>⚠️ Cảnh báo ngoại lệ kho (${esc(history.exceptionStatus)}):</strong> Thanh toán đến sau khi phiên giữ chỗ hết hạn và xe đã bán hết. Bộ phận CSKH đang điều phối hoặc hoàn tiền theo sổ cái.
            </div>
          ` : ''}

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:22px; align-items:start;">
            <!-- Left: Initiate or Retry Payment -->
            <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-xl); padding:22px; box-shadow:var(--shadow-sm);">
              <h3 style="font-size:17px; font-weight:800; margin:0 0 12px;">💳 Cổng Thanh toán & Xác thực</h3>
              <div style="background:#F8FAFC; border-radius:10px; padding:12px 14px; font-size:13px; margin-bottom:14px;">
                <div><strong>Giữ chỗ tồn kho:</strong> ${esc(resCountdownText)}</div>
                <div style="margin-top:4px;"><strong>Tổng giá trị đơn:</strong> ${fmtVnd(totalDue)}</div>
                <div style="margin-top:4px;"><strong>Đã thanh toán (Sổ cái):</strong> <strong style="color:#059669;">${fmtVnd(paidAmount)}</strong></div>
                <div style="margin-top:4px;"><strong>Số dư còn lại:</strong> <strong style="color:var(--primary);">${fmtVnd(remainingFull)}</strong></div>
              </div>

              ${(!isCancelled && !isSettled) ? `
                <div style="margin-bottom:12px;">
                  <label class="filter-label" for="pay-provider-select">Chọn phương thức thanh toán</label>
                  <select class="filter-select" id="pay-provider-select">
                    <option value="napas_qr_sandbox">Chuyển khoản QR Napas 24/7 (Sandbox)</option>
                    <option value="vnpay_sandbox">Cổng thanh toán VNPAY QR (Sandbox)</option>
                    <option value="momo_sandbox">Ví điện tử MoMo (Sandbox)</option>
                  </select>
                </div>
                <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px;">
                  ${remainingDeposit > 0 ? `<button type="button" class="btn-primary btn-create-intent" data-mode="deposit" style="flex:1;">⚡ Đặt cọc (${fmtVnd(remainingDeposit)})</button>` : ''}
                  <button type="button" class="btn-dark btn-create-intent" data-mode="full" style="flex:1;">💎 Thanh toán Toàn bộ (${fmtVnd(remainingFull)})</button>
                </div>
              ` : `
                <div style="padding:12px; border-radius:10px; background:${isSettled ? '#ECFDF5' : '#F1F5F9'}; color:${isSettled ? '#065F46' : '#475569'}; font-weight:700; font-size:13.5px; margin-bottom:14px;">
                  ${isSettled ? '✅ Đơn hàng đã tất toán đầy đủ qua sổ cái thanh toán.' : '⛔ Đơn hàng đã hủy, không thể tạo giao dịch mới.'}
                </div>
              `}

              ${latestIntent ? `
                <div style="border:1px solid #BFDBFE; background:#EFF6FF; border-radius:12px; padding:14px; margin-top:10px;">
                  <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:800; color:#1E40AF;">
                    <span>PHIÊN THANH TOÁN MỚI NHẤT</span>
                    <span>${esc(latestIntent.status.toUpperCase())}</span>
                  </div>
                  <div style="font-size:13px; margin-top:6px;">Mã GD: <code>${esc(latestIntent.providerRef)}</code></div>
                  <div style="font-size:13px; margin-top:3px;">Số tiền: <strong>${fmtVnd(latestIntent.amount)}</strong></div>
                  <div style="font-size:11.5px; color:#475569; margin-top:6px;">
                    ℹ️ Trạng thái thanh toán chỉ cập nhật thành công khi nhận được xác thực Webhook HMAC từ ngân hàng/cổng thanh toán (khác với trạng thái Bàn giao xe).
                  </div>
                  ${(latestIntent.status === 'pending' && isSandboxVisible) ? `
                    <div style="margin-top:10px; padding-top:10px; border-top:1px dashed #93C5FD; display:flex; gap:8px; flex-wrap:wrap;">
                      <button type="button" class="btn-primary btn-sim-webhook" data-intent="${esc(latestIntent.id)}" data-status="succeeded" style="font-size:12px; padding:6px 12px;">🧪 Sandbox: Mô phỏng Webhook Thành công</button>
                      <button type="button" class="btn-secondary btn-sim-webhook" data-intent="${esc(latestIntent.id)}" data-status="failed" style="font-size:12px; padding:6px 12px;">🧪 Mô phỏng Lỗi GD</button>
                    </div>
                  ` : ''}
                </div>
              ` : ''}
            </div>

            <!-- Right: Payment Ledger & Audit History -->
            <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-xl); padding:22px; box-shadow:var(--shadow-sm);">
              <h3 style="font-size:17px; font-weight:800; margin:0 0 12px;">📒 Sổ cái Thanh toán (Payment Ledger)</h3>
              ${(history.ledger || []).length === 0 ? `
                <div style="padding:20px; text-align:center; color:var(--text-muted); font-size:13.5px; background:#F8FAFC; border-radius:10px;">
                  Chưa có giao dịch được xác thực qua webhook. Sau khi thanh toán, mỗi bút toán được ghi bất biến tại đây.
                </div>
              ` : `
                <div style="display:flex; flex-direction:column; gap:10px;">
                  ${history.ledger.map(l => `
                    <div style="padding:10px 12px; border:1px solid #E2E8F0; border-radius:10px; font-size:12.5px;">
                      <div style="display:flex; justify-content:space-between; font-weight:800;">
                        <span>${esc(l.entryType)}</span>
                        <span style="color:#059669;">+${fmtVnd(l.amount)}</span>
                      </div>
                      <div style="color:var(--text-muted); font-size:11.5px; margin-top:3px;">
                        Ref: <code>${esc(l.providerRef)}</code> • ${new Date(l.createdAt).toLocaleString('vi-VN')}
                      </div>
                    </div>
                  `).join('')}
                </div>
              `}

              <h4 style="font-size:14px; font-weight:800; margin:18px 0 10px;">Lịch sử Trạng thái Đơn hàng</h4>
              <div style="display:flex; flex-direction:column; gap:8px; font-size:12.5px;">
                ${(orderDetail.history || []).map(h => `
                  <div style="border-left:3px solid var(--primary); padding-left:10px;">
                    <div style="font-weight:700;">${esc(h.status)}${h.paymentStatus ? ` • ${esc(h.paymentStatus)}` : ''}</div>
                    <div style="color:var(--text-muted);">${esc(h.note || '')}</div>
                    <div style="font-size:11px; color:#94A3B8;">${new Date(h.timestamp).toLocaleString('vi-VN')}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      </section>
    `;

    document.querySelectorAll('.btn-create-intent').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mode = btn.getAttribute('data-mode');
        const provider = document.getElementById('pay-provider-select')?.value || 'napas_qr_sandbox';
        btn.disabled = true;
        try {
          const intent = await ApiClient.payments.createIntent({ orderId: orderDetail.id, mode, provider }, newIdempotencyKey('pi'));
          showToast(`Đã tạo phiên thanh toán ${intent.providerRef}.`, '💳');
          renderOrderPaymentPanel(container, orderDetail.id, deps);
        } catch (err) {
          showToast(err.message || 'Không thể tạo phiên thanh toán.', '⚠️');
          btn.disabled = false;
        }
      });
    });

    document.querySelectorAll('.btn-sim-webhook').forEach(btn => {
      btn.addEventListener('click', async () => {
        const intentId = btn.getAttribute('data-intent');
        const status = btn.getAttribute('data-status');
        btn.disabled = true;
        try {
          await ApiClient.payments.simulateSandbox({ intentId, status });
          showToast(status === 'succeeded' ? '✅ Webhook đã xác thực thanh toán thành công!' : '⚠️ Đã ghi nhận giao dịch thất bại, bạn có thể thử lại.', status === 'succeeded' ? '✓' : '⚠️');
          renderOrderPaymentPanel(container, orderDetail.id, deps);
        } catch (err) {
          showToast(err.message, '⚠️');
          btn.disabled = false;
        }
      });
    });
  }

  async function renderCheckoutView(container, params = {}, deps = {}) {
    const showToast = deps.showToast || window.showToast || (() => {});
    const requireAuth = deps.requireAuth || window.requireAuth;
    const curUser = ApiClient.getCurrentUser();

    if (!curUser || !ApiClient.getToken()) {
      container.innerHTML = `
        <section class="section" style="padding:72px 0; min-height:60vh;">
          <div class="container" style="max-width:540px; text-align:center;">
            <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-xl); padding:40px 28px;">
              <div style="font-size:44px; margin-bottom:12px;">🔒</div>
              <h2 style="font-size:22px; font-weight:800;">Đăng nhập để Checkout & Thanh toán</h2>
              <p style="font-size:14px; color:var(--text-muted); margin-bottom:20px;">Đơn hàng giữ chỗ và giao dịch thanh toán yêu cầu tài khoản đã xác thực.</p>
              <button class="btn-primary" id="btn-checkout-login">🔑 Đăng nhập ngay</button>
            </div>
          </div>
        </section>
      `;
      document.getElementById('btn-checkout-login')?.addEventListener('click', () => {
        if (requireAuth) requireAuth('tiếp tục Checkout', () => renderCheckoutView(container, params, deps));
      });
      return;
    }

    if (params.orderId) {
      return renderOrderPaymentPanel(container, params.orderId, deps);
    }

    const source = params.source === 'cart' ? 'cart' : (params.vehicleId ? 'direct' : 'cart');
    const selectedBranch = params.branchId || sessionStorage.getItem('sigmacar_cart_branch_draft') || 'hn-caugiay';
    const selectedDelivery = params.deliveryMethod || sessionStorage.getItem('sigmacar_cart_delivery_draft') || 'showroom';
    const promoCode = params.promoCode || sessionStorage.getItem('sigmacar_cart_promo_draft') || '';

    container.innerHTML = `<div class="container" style="padding:60px 20px; text-align:center;">⏳ Đang lập báo giá & kiểm tra tồn kho...</div>`;

    let quote = null;
    let itemsPayload = [];
    try {
      if (source === 'cart') {
        const cart = await ApiClient.cart.get();
        itemsPayload = cart.items || [];
        if (itemsPayload.length === 0) {
          container.innerHTML = `
            <div class="container" style="padding:72px 20px; max-width:560px; text-align:center;">
              <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:16px; padding:36px;">
                <div style="font-size:42px; margin-bottom:10px;">🛒</div>
                <h3>Giỏ hàng đang trống</h3>
                <p style="color:var(--text-muted); font-size:14px;">Vui lòng chọn xe hoặc phụ kiện trước khi thanh toán.</p>
                <button class="btn-primary" onclick="window.location.hash='new-cars'">Khám phá xe</button>
              </div>
            </div>
          `;
          return;
        }
        quote = await ApiClient.quotes.create({
          items: itemsPayload,
          promoCode: cart.promoCode || promoCode || undefined,
          branchId: cart.branchId || selectedBranch,
          deliveryMethod: cart.deliveryMethod || selectedDelivery
        });
      } else {
        itemsPayload = [{
          itemType: params.itemType || 'vehicle',
          itemId: params.vehicleId,
          quantity: 1,
          colorName: params.colorName || undefined,
          trimName: params.trimName || undefined
        }];
        quote = await ApiClient.quotes.create({
          items: itemsPayload,
          promoCode: promoCode || undefined,
          branchId: selectedBranch,
          deliveryMethod: selectedDelivery
        });
      }
    } catch (err) {
      const isStaticOffline = err && (err.code === 'BACKEND_UNAVAILABLE' || err.status === 503);
      if (isStaticOffline && !ApiClient.isDemoMode()) {
        container.innerHTML = `
          <div class="container" style="padding:56px 20px; max-width:640px; text-align:center;">
            <div style="background:#FFFBEB; border:1px solid #FCD34D; border-radius:16px; padding:28px; box-shadow:var(--shadow-sm);">
              <div style="font-size:38px; margin-bottom:10px;">🧪</div>
              <h3 style="margin:0 0 8px; color:#92400E;">Chưa kết nối Backend Server (Chế độ Xem Tĩnh)</h3>
              <p style="color:#78350F; font-size:14px; line-height:1.6; margin:0 0 18px;">
                ${esc(err.message)}<br>
                Bạn có thể bật <strong>Chế độ Demo Sandbox</strong> trên trình duyệt để trải nghiệm đầy đủ tính năng Giỏ hàng, Checkout, giữ chỗ 15 phút &amp; Thanh toán QR mô phỏng (không thu tiền thật).
              </p>
              <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
                <button type="button" class="btn-primary" id="btn-checkout-enable-demo" style="background:linear-gradient(135deg,#0EA5E9,#2563EB);">
                  🧪 Bật Demo Sandbox &amp; Tiếp tục Checkout
                </button>
                <button type="button" class="btn-secondary" onclick="window.location.hash='cart'">Quay lại Giỏ hàng</button>
              </div>
            </div>
          </div>
        `;
        document.getElementById('btn-checkout-enable-demo')?.addEventListener('click', () => {
          ApiClient.setDemoMode(true);
          showToast('Đã bật Chế độ Demo Sandbox (dữ liệu mô phỏng cục bộ trên trình duyệt).', '🧪');
          renderCheckoutView(container, params, deps);
        });
        return;
      }

      container.innerHTML = `
        <div class="container" style="padding:64px 20px; max-width:600px; text-align:center;">
          <div style="background:#FEF2F2; border:1px solid #FCA5A5; border-radius:16px; padding:28px;">
            <h3>Không thể khởi tạo Checkout</h3>
            <p style="color:#7F1D1D;">${esc(err.message)}</p>
            <button class="btn-primary" onclick="window.location.hash='cart'">Quay lại Giỏ hàng</button>
          </div>
        </div>
      `;
      return;
    }

    let idempotencyKey = newIdempotencyKey('chk');
    let submitting = false;

    const demoBannerHtml = ApiClient.isDemoMode()
      ? `<div style="background:#FEF3C7; border:1px solid #F59E0B; color:#92400E; padding:10px 14px; border-radius:10px; font-size:12.5px; font-weight:600; margin-bottom:16px;">🧪 CHẾ ĐỘ DEMO SANDBOX — Báo giá, giữ chỗ 15 phút &amp; thanh toán QR chỉ mô phỏng cục bộ trên trình duyệt, không phát sinh giao dịch tiền thật.</div>`
      : '';

    container.innerHTML = `
      <section class="section" style="padding-top:36px; padding-bottom:64px;">
        <div class="container" style="max-width:1040px;">
          ${demoBannerHtml}
          <h1 style="font-size:28px; font-weight:800; margin:0 0 6px;">⚡ Checkout & Đặt giữ chỗ Chính hãng</h1>
          <p style="font-size:14px; color:var(--text-muted); margin:0 0 24px;">Giá và tồn kho chi nhánh được xác thực theo báo giá <code>${esc(quote.id)}</code> (hiệu lực 15 phút).</p>

          <form id="form-p1-checkout" class="checkout-layout-grid" style="display:grid; grid-template-columns:minmax(0,1.4fr) minmax(0,1fr); gap:24px; align-items:start;">
            <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-xl); padding:24px; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:14px;">
              <h3 style="font-size:17px; font-weight:800; margin:0;">1. Thông tin Người nhận & Showroom</h3>
              <div class="p1-2col-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                <div>
                  <label class="filter-label" for="chk-name">Họ và tên *</label>
                  <input type="text" id="chk-name" class="filter-input" required value="${esc(curUser.fullName || '')}">
                </div>
                <div>
                  <label class="filter-label" for="chk-phone">Số điện thoại liên hệ *</label>
                  <input type="tel" id="chk-phone" class="filter-input" required value="${esc(curUser.phone || '')}" placeholder="09xx xxx xxx">
                </div>
              </div>

              <div class="p1-2col-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                <div>
                  <label class="filter-label" for="chk-branch">Showroom xử lý</label>
                  <select id="chk-branch" class="filter-select">
                    ${BRANCHES.map(b => `<option value="${b.id}" ${quote.branchId === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label class="filter-label" for="chk-delivery">Phương thức giao xe</label>
                  <select id="chk-delivery" class="filter-select">
                    <option value="showroom" ${quote.deliveryMethod === 'showroom' ? 'selected' : ''}>Nhận tại Showroom (0 đ)</option>
                    <option value="home_city" ${quote.deliveryMethod === 'home_city' ? 'selected' : ''}>Giao tận nhà nội thành (+2.500.000 đ)</option>
                    <option value="intercity" ${quote.deliveryMethod === 'intercity' ? 'selected' : ''}>Vận chuyển liên tỉnh (+8.000.000 đ)</option>
                  </select>
                </div>
              </div>

              <div>
                <label class="filter-label" for="chk-address">Địa chỉ nhận xe / xuất hóa đơn</label>
                <input type="text" id="chk-address" class="filter-input" placeholder="Số nhà, đường, quận/huyện, tỉnh/thành phố">
              </div>

              <h3 style="font-size:17px; font-weight:800; margin:10px 0 0;">2. Hình thức Thanh toán</h3>
              <div class="p1-2col-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                <div>
                  <label class="filter-label" for="chk-payment-mode">Mức thanh toán ngay</label>
                  <select id="chk-payment-mode" class="filter-select">
                    <option value="deposit" selected>Đặt cọc giữ xe (${fmtVnd(quote.depositAmount)})</option>
                    <option value="full">Thanh toán toàn bộ (${fmtVnd(quote.totalAmount)})</option>
                  </select>
                </div>
                <div>
                  <label class="filter-label" for="chk-provider">Cổng thanh toán</label>
                  <select id="chk-provider" class="filter-select">
                    <option value="napas_qr_sandbox">Chuyển khoản QR Napas 24/7</option>
                    <option value="vnpay_sandbox">Cổng VNPAY QR</option>
                    <option value="momo_sandbox">Ví điện tử MoMo</option>
                  </select>
                </div>
              </div>

              <label style="display:flex; align-items:flex-start; gap:10px; padding:12px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; font-size:13px; cursor:pointer;">
                <input type="checkbox" id="chk-accept-policy" required style="margin-top:3px;">
                <span>Tôi đồng ý với <strong>Điều khoản Đặt cọc & Chính sách Đổi trả 7 ngày (${esc(quote.policyVersion)})</strong>. Đơn hàng chỉ giữ chỗ tồn kho 15 phút cho tới khi webhook xác nhận giao dịch thành công.</span>
              </label>

              <button type="submit" id="btn-submit-p1-checkout" class="btn-primary" style="justify-content:center; padding:14px; font-size:15px; font-weight:800;">
                ✅ Xác nhận Đặt đơn & Tiếp tục Thanh toán
              </button>
            </div>

            <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-xl); padding:22px; box-shadow:var(--shadow-sm);">
              <h3 style="font-size:17px; font-weight:800; margin:0 0 12px;">Tóm tắt Báo giá (${quote.lines.length} dòng)</h3>
              <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:14px;">
                ${quote.lines.map(l => `
                  <div style="display:flex; justify-content:space-between; font-size:13px; border-bottom:1px solid #F1F5F9; padding-bottom:8px;">
                    <div>
                      <strong>${esc(l.name)}</strong> x${l.quantity}
                      ${l.colorName ? `<div style="font-size:11.5px; color:var(--text-muted);">${esc(l.colorName)}</div>` : ''}
                    </div>
                    <strong>${fmtVnd(l.lineTotal)}</strong>
                  </div>
                `).join('')}
              </div>
              <div style="display:flex; flex-direction:column; gap:8px; font-size:13px;">
                <div style="display:flex; justify-content:space-between;"><span>Tạm tính</span><strong>${fmtVnd(quote.itemsSubtotal)}</strong></div>
                <div style="display:flex; justify-content:space-between;"><span>Giảm giá (${esc(quote.promo?.code || 'Không')})</span><strong style="color:#059669;">-${fmtVnd(quote.discountAmount || 0)}</strong></div>
                <div style="display:flex; justify-content:space-between;"><span>Phí giao nhận</span><strong>${fmtVnd(quote.deliveryFee || 0)}</strong></div>
                <div style="display:flex; justify-content:space-between; padding-top:8px; border-top:1px solid var(--border-subtle); font-size:16px;">
                  <strong>Tổng hợp đồng</strong><strong style="color:var(--primary);">${fmtVnd(quote.totalAmount)}</strong>
                </div>
                <div style="display:flex; justify-content:space-between; background:#EFF6FF; padding:10px; border-radius:8px; font-size:13.5px;">
                  <span>Số tiền đặt cọc giữ chỗ</span><strong style="color:#1D4ED8;">${fmtVnd(quote.depositAmount)}</strong>
                </div>
              </div>
            </div>
          </form>
        </div>
      </section>
    `;

    document.getElementById('form-p1-checkout')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submitting) return;
      const acceptedPolicy = Boolean(document.getElementById('chk-accept-policy')?.checked);
      if (!acceptedPolicy) {
        showToast('Vui lòng đồng ý điều khoản đặt cọc trước khi xác nhận.', '⚠️');
        return;
      }

      const submitBtn = document.getElementById('btn-submit-p1-checkout');
      submitting = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Đang giữ tồn kho & tạo đơn hàng...';
      }

      try {
        const paymentMode = document.getElementById('chk-payment-mode')?.value || 'deposit';
        const provider = document.getElementById('chk-provider')?.value || 'napas_qr_sandbox';
        const result = await ApiClient.checkout.submit({
          source,
          items: source === 'cart' ? undefined : itemsPayload,
          quoteId: quote.id,
          branchId: document.getElementById('chk-branch')?.value || quote.branchId,
          deliveryMethod: document.getElementById('chk-delivery')?.value || quote.deliveryMethod,
          deliveryAddress: document.getElementById('chk-address')?.value.trim() || '',
          buyerName: document.getElementById('chk-name')?.value.trim(),
          buyerPhone: document.getElementById('chk-phone')?.value.trim(),
          promoCode: quote.promo ? quote.promo.code : undefined,
          paymentMode,
          acceptedPolicy: true
        }, idempotencyKey);

        const order = result.order;
        await ApiClient.payments.createIntent({ orderId: order.id, mode: paymentMode, provider }, newIdempotencyKey('pi')).catch(() => {});
        if (window.SigmaCartView) await window.SigmaCartView.updateCartHeaderBadge();

        showToast(`Đã tạo đơn ${order.orderNumber} (Đang giữ chỗ 15 phút, chờ xác nhận thanh toán).`, '🎉');
        window.location.hash = `checkout?orderId=${encodeURIComponent(order.id)}`;
        renderOrderPaymentPanel(container, order.id, deps);
      } catch (err) {
        showToast(err.message || 'Không thể hoàn tất checkout.', '⚠️');
        idempotencyKey = newIdempotencyKey('chk');
        submitting = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '✅ Xác nhận Đặt đơn & Tiếp tục Thanh toán';
        }
      }
    });
  }

  window.SigmaCheckoutView = {
    renderCheckoutView,
    renderOrderPaymentPanel
  };
})();
