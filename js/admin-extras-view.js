// js/admin-extras-view.js — Seller/Admin dashboard extensions (PLAN.md Phase 4)
// Mounted once per dashboard render below the active tab (app.js: #admin-extras-mount). Each panel is additive and
// reuses the dashboard's existing classes; all permissions are enforced server-side, the UI only hides what a role
// cannot use.
//   dash-overview   T4.10 best sellers + T4.9 server-verified funnel + T4.6 payment reconciliation (admin)
//   dash-inventory  T4.2 promotions (edit / activate) + T4.4 stock movements + T4.3 accessories (admin)
//   dash-reviews    T4.12 Q&A moderation
//   dash-campaigns  T4.13 delivery history per campaign
//   dash-aftersales T4.7 parts (create / restock) + T4.8 service centers, bays, technicians
//   dash-crm        T4.5 seller customers + T4.11 audit log (admin)

(function () {
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  const vnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')} đ`;
  const when = (iso) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString('vi-VN') : '—');
  const req = (path, opts = {}) => ApiClient.request(path, opts);
  const post = (path, body, method = 'POST') => req(path, { method, body: JSON.stringify(body || {}) });

  const card = (title, inner, extra = '') => `
    <div class="dash-table-card" style="margin-top:24px; padding:18px;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
        <h4 style="margin:0; font-size:16px; font-weight:800; color:var(--text-dark);">${title}</h4>${extra}
      </div>
      ${inner}
    </div>`;
  const table = (heads, rows, empty) => rows.length
    ? `<div style="overflow-x:auto;"><table class="dash-data-table"><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
    : `<p style="font-size:13px; color:var(--text-muted); margin:0;">${empty}</p>`;
  const errBox = (e) => `<p style="font-size:13px; color:#B91C1C; margin:0;">⚠️ ${esc(e && e.message ? e.message : e)}</p>`;

  // ---------- dash-overview ----------
  async function overview(el, ctx) {
    const isAdmin = ctx.curUser.role === 'admin';
    const f = ctx.analyticsFilter || {};
    const qs = new URLSearchParams();
    ['branchId', 'dateFrom', 'dateTo'].forEach(k => { if (f[k]) qs.set(k, f[k]); });
    let top = null;
    let funnel = null;
    try { top = (await req(`/analytics/top-products?${qs}`)).data; } catch (e) { top = { error: e }; }
    try { funnel = (await req(`/analytics/funnel?${qs}`)).data; } catch (e) { funnel = null; }
    const rank = (list) => table(['#', 'Sản phẩm', 'Số lượng', 'Đơn', 'Doanh thu'],
      (list || []).map((r, i) => `<tr><td>${i + 1}</td><td><strong>${esc(r.name)}</strong></td><td>${r.units}</td><td>${r.orders}</td><td>${vnd(r.revenue)}</td></tr>`),
      'Chưa có đơn hàng trong phạm vi lọc.');
    const verified = funnel && funnel.serverVerifiedCounts
      ? `<div style="display:flex; gap:10px; flex-wrap:wrap; font-size:12.5px;">${[['test_drive', 'Lái thử'], ['checkout', 'Đặt đơn'], ['order_paid', 'Đã thanh toán'], ['handover', 'Bàn giao']]
        .map(([k, l]) => `<span class="status-badge confirmed">● ${l}: ${funnel.serverVerifiedCounts[k] || 0}</span>`).join('')}</div>
        <p style="font-size:11.5px; color:var(--text-muted); margin:8px 0 0;">Ghi nhận trực tiếp từ máy chủ khi nghiệp vụ hoàn tất (không thể giả lập từ trình duyệt).</p>`
      : '<p style="font-size:13px; color:var(--text-muted); margin:0;">Chưa có dữ liệu phễu.</p>';
    el.innerHTML =
      (top && top.error ? card('🏆 Sản phẩm bán chạy', errBox(top.error)) : `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(360px, 100%), 1fr)); gap:16px;">
          ${card('🏆 Xe bán chạy', rank(top && top.topVehicles))}
          ${card('🧩 Phụ kiện bán chạy', rank(top && top.topAccessories))}
        </div>`) +
      card('✅ Phễu chuyển đổi xác thực (máy chủ)', verified) +
      (isAdmin ? card('🔁 Đối soát thanh toán', '<p style="font-size:13px; color:var(--text-secondary); margin:0 0 10px;">Chạy một vòng đối soát giao dịch cổng thanh toán (sandbox) với sổ cái đơn hàng.</p><button type="button" class="btn-secondary" id="ax-reconcile">▶ Chạy đối soát</button><div id="ax-reconcile-result" style="margin-top:10px; font-size:12.5px;"></div>') : '');
    el.querySelector('#ax-reconcile')?.addEventListener('click', async () => {
      const out = el.querySelector('#ax-reconcile-result');
      try {
        const r = (await post('/payments/reconcile', {})).data;
        out.innerHTML = `<pre style="white-space:pre-wrap; margin:0; font-size:12px;">${esc(JSON.stringify(r, null, 2))}</pre>`;
        ctx.showToast('Đã chạy đối soát thanh toán.', '🔁');
      } catch (e) { out.innerHTML = errBox(e); }
    });
  }

  // ---------- dash-inventory ----------
  async function inventory(el, ctx) {
    const isAdmin = ctx.curUser.role === 'admin';
    let promos = [];
    let moves = [];
    let accessories = [];
    try { promos = (await req('/promotions?activeOnly=false')).data || []; } catch (e) { /* empty */ }
    try { moves = (await req('/inventory/movements?limit=30')).data || []; } catch (e) { /* empty */ }
    if (isAdmin) { try { const a = (await req('/accessories')).data; accessories = (a && a.items) || []; } catch (e) { /* empty */ } }

    const promoRows = promos.map(p => `
      <tr>
        <td><strong>${esc(p.code)}</strong></td><td>${esc(p.name || '')}</td>
        <td>${p.discountType === 'percent' ? `${p.discountValue}%` : vnd(p.discountValue)}</td>
        <td>${p.usedCount || 0} / ${p.maxUses || '∞'}</td>
        <td>${p.expiresAt ? new Date(p.expiresAt).toLocaleDateString('vi-VN') : '—'}</td>
        <td><span class="status-badge ${p.isActive ? 'confirmed' : 'pending'}">● ${p.isActive ? 'Đang hoạt động' : 'Tạm tắt'}</span></td>
        <td style="text-align:right;"><button type="button" class="btn-card-outline ax-promo-toggle" data-id="${esc(p.id)}" data-active="${p.isActive ? '1' : '0'}" style="padding:4px 8px; font-size:11.5px;">${p.isActive ? '⏸ Tắt' : '▶ Bật'}</button></td>
      </tr>`);
    const moveRows = moves.map(m => `<tr><td>${esc(when(m.createdAt))}</td><td>${esc(m.vehicleName)}</td><td>${esc(m.branchName)}</td><td style="font-weight:700; color:${m.delta >= 0 ? '#047857' : '#B91C1C'};">${m.delta >= 0 ? '+' : ''}${m.delta}</td><td>${esc(m.reason || '')}</td></tr>`);
    const accRows = accessories.slice(0, 50).map(a => `
      <tr>
        <td><strong>${esc(a.id)}</strong></td><td>${esc(a.name)}</td><td>${vnd(a.price)}</td><td>${a.stockQuantity ?? a.quantity ?? 0}</td>
        <td style="text-align:right; white-space:nowrap;">
          <button type="button" class="btn-card-outline ax-acc-price" data-id="${esc(a.id)}" style="padding:4px 8px; font-size:11.5px;">✏️ Giá</button>
          <button type="button" class="btn-card-outline ax-acc-archive" data-id="${esc(a.id)}" style="padding:4px 8px; font-size:11.5px; color:#DC2626;">🗄️ Ẩn</button>
        </td>
      </tr>`);

    el.innerHTML =
      card('🏷️ Quản lý mã khuyến mãi (gồm mã đã tắt)', table(['Mã', 'Tên', 'Giảm', 'Đã dùng', 'Hết hạn', 'Trạng thái', ''], promoRows, 'Chưa có mã khuyến mãi.')) +
      card('📒 Lịch sử biến động kho (30 gần nhất)', table(['Thời điểm', 'Xe', 'Chi nhánh', 'Thay đổi', 'Lý do'], moveRows, 'Chưa có biến động kho.')) +
      (isAdmin ? card('🧩 Danh mục phụ kiện', `
        <form id="ax-acc-form" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(150px, 100%), 1fr)); gap:8px; margin-bottom:12px;">
          <input class="filter-input" name="sku" placeholder="Mã SKU (VD: ACC-020)">
          <input class="filter-input" name="name" placeholder="Tên phụ kiện" required>
          <input class="filter-input" name="price" type="number" min="1" placeholder="Giá (VNĐ)" required>
          <input class="filter-input" name="quantity" type="number" min="0" placeholder="Tồn kho">
          <button type="submit" class="btn-primary" style="justify-content:center;">➕ Thêm</button>
        </form>
        ${table(['SKU', 'Tên', 'Giá', 'Tồn', ''], accRows, 'Chưa có phụ kiện.')}`) : '');

    el.querySelectorAll('.ax-promo-toggle').forEach(b => b.addEventListener('click', async () => {
      try {
        await post(`/promotions/${encodeURIComponent(b.dataset.id)}`, { isActive: b.dataset.active !== '1' }, 'PATCH');
        ctx.showToast('Đã cập nhật trạng thái mã khuyến mãi.', '🏷️');
        inventory(el, ctx);
      } catch (e) { ctx.showToast(e.message, '⚠️'); }
    }));
    el.querySelector('#ax-acc-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget);
      try {
        await post('/accessories', { sku: fd.get('sku') || undefined, name: fd.get('name'), price: Number(fd.get('price')), quantity: fd.get('quantity') === '' ? 0 : Number(fd.get('quantity')) });
        ctx.showToast('Đã thêm phụ kiện.', '🧩');
        inventory(el, ctx);
      } catch (e) { ctx.showToast(e.message, '⚠️'); }
    });
    el.querySelectorAll('.ax-acc-price').forEach(b => b.addEventListener('click', async () => {
      const v = window.prompt(`Giá mới cho ${b.dataset.id} (VNĐ):`);
      if (!v) return;
      try { await post(`/accessories/${encodeURIComponent(b.dataset.id)}`, { price: Number(v) }, 'PATCH'); ctx.showToast('Đã cập nhật giá.', '✏️'); inventory(el, ctx); } catch (e) { ctx.showToast(e.message, '⚠️'); }
    }));
    el.querySelectorAll('.ax-acc-archive').forEach(b => b.addEventListener('click', async () => {
      try { await post(`/accessories/${encodeURIComponent(b.dataset.id)}`, { archived: true }, 'PATCH'); ctx.showToast('Đã ẩn phụ kiện khỏi danh mục.', '🗄️'); inventory(el, ctx); } catch (e) { ctx.showToast(e.message, '⚠️'); }
    }));
  }

  // ---------- dash-reviews ----------
  async function reviews(el, ctx) {
    let questions = [];
    try { questions = ((await req('/reviews?includeModerated=true')).data || {}).questions || []; } catch (e) { el.innerHTML = card('❓ Kiểm duyệt Hỏi & Đáp', errBox(e)); return; }
    const sorted = [...questions].sort((a, b) => ((b.reportCount || (b.reportedBy || []).length || 0) - (a.reportCount || (a.reportedBy || []).length || 0)));
    const rows = sorted.slice(0, 40).map(q => `
      <tr>
        <td>${esc(q.vehicleName || q.vehicleId || '')}</td>
        <td style="max-width:320px;">${esc(q.question || q.content || '')}</td>
        <td>${(q.answers || []).length}</td>
        <td>${q.reportCount || (q.reportedBy || []).length || 0}</td>
        <td><span class="status-badge ${q.moderationStatus === 'approved' || !q.moderationStatus ? 'confirmed' : 'pending'}">● ${esc(q.moderationStatus || 'approved')}</span></td>
        <td style="white-space:nowrap;">
          <input class="filter-input ax-q-reason" data-id="${esc(q.id)}" placeholder="Lý do (≥3 ký tự)" style="width:140px; padding:4px 8px; font-size:12px;">
          <button type="button" class="btn-card-outline ax-q-mod" data-id="${esc(q.id)}" data-action="approve" style="padding:4px 8px; font-size:11.5px;">✓</button>
          <button type="button" class="btn-card-outline ax-q-mod" data-id="${esc(q.id)}" data-action="hide" style="padding:4px 8px; font-size:11.5px;">🙈</button>
          <button type="button" class="btn-card-outline ax-q-mod" data-id="${esc(q.id)}" data-action="remove" style="padding:4px 8px; font-size:11.5px; color:#DC2626;">🗑️</button>
        </td>
      </tr>`);
    el.innerHTML = card('❓ Kiểm duyệt Hỏi & Đáp (ưu tiên câu hỏi bị báo cáo)', table(['Xe', 'Câu hỏi', 'Trả lời', 'Báo cáo', 'Trạng thái', 'Thao tác'], rows, 'Chưa có câu hỏi.'));
    el.querySelectorAll('.ax-q-mod').forEach(b => b.addEventListener('click', async () => {
      const reason = el.querySelector(`.ax-q-reason[data-id="${CSS.escape(b.dataset.id)}"]`)?.value.trim();
      try {
        await post(`/questions/${encodeURIComponent(b.dataset.id)}/moderate`, { action: b.dataset.action, reason }, 'PATCH');
        ctx.showToast('Đã kiểm duyệt câu hỏi.', '❓');
        reviews(el, ctx);
      } catch (e) { ctx.showToast(e.message, '⚠️'); }
    }));
  }

  // ---------- dash-campaigns ----------
  async function campaigns(el, ctx) {
    let list = [];
    try { const d = (await req('/campaigns')).data; list = Array.isArray(d) ? d : (d && d.campaigns) || []; } catch (e) { el.innerHTML = card('📬 Lịch sử gửi chiến dịch', errBox(e)); return; }
    el.innerHTML = card('📬 Lịch sử gửi chiến dịch', `
      <select class="filter-select" id="ax-camp-select" style="max-width:420px; margin-bottom:12px;">
        <option value="">— Chọn chiến dịch —</option>
        ${list.map(c => `<option value="${esc(c.id)}">${esc(c.name || c.subject || c.id)} (${esc(c.status || '')})</option>`).join('')}
      </select>
      <div id="ax-camp-deliveries"><p style="font-size:13px; color:var(--text-muted); margin:0;">Chọn một chiến dịch để xem trạng thái gửi từng người nhận.</p></div>`);
    el.querySelector('#ax-camp-select')?.addEventListener('change', async (ev) => {
      const box = el.querySelector('#ax-camp-deliveries');
      if (!ev.target.value) return;
      try {
        const d = (await req(`/campaigns/${encodeURIComponent(ev.target.value)}/deliveries`)).data || {};
        const rows = (d.deliveries || []).map(x => `<tr><td>${esc(x.recipientEmail || x.recipientUserId)}</td><td><span class="status-badge ${x.deliveryStatus === 'delivered' ? 'confirmed' : 'pending'}">● ${esc(x.deliveryStatus)}</span></td><td>${esc(when(x.sentAt || x.updatedAt || x.createdAt))}</td></tr>`);
        box.innerHTML = table(['Người nhận', 'Trạng thái', 'Cập nhật'], rows, 'Chiến dịch chưa có lượt gửi.');
      } catch (e) { box.innerHTML = errBox(e); }
    });
  }

  // ---------- dash-aftersales ----------
  async function aftersales(el, ctx) {
    const role = ctx.curUser.role;
    const canParts = ['admin', 'service_staff'].includes(role);
    let parts = [];
    let resources = { centers: [] };
    try { parts = (await req('/workshop/parts')).data || []; } catch (e) { /* role may not read parts */ }
    try { resources = (await req('/workshop/resources')).data || resources; } catch (e) { /* empty */ }
    const partRows = parts.map(p => `
      <tr>
        <td><strong>${esc(p.sku)}</strong></td><td>${esc(p.name)}</td><td>${vnd(p.unitPrice)}</td>
        <td>${p.stockOnHand}</td><td>${p.stockReserved || 0}</td>
        <td style="font-weight:700; color:${p.availableStock <= 5 ? '#B91C1C' : '#047857'};">${p.availableStock}</td>
        <td style="white-space:nowrap;">${canParts ? `<input type="number" min="1" class="filter-input ax-part-qty" data-sku="${esc(p.sku)}" placeholder="SL" style="width:70px; padding:4px 8px; font-size:12px;"> <button type="button" class="btn-card-outline ax-part-restock" data-sku="${esc(p.sku)}" style="padding:4px 8px; font-size:11.5px;">📥 Nhập</button>` : ''}</td>
      </tr>`);
    const centers = resources.centers || [];
    el.innerHTML =
      card('🔩 Kho phụ tùng xưởng', (canParts ? `
        <form id="ax-part-form" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(140px, 100%), 1fr)); gap:8px; margin-bottom:12px;">
          <input class="filter-input" name="sku" placeholder="Mã SKU (VD: PRT-XYZ)" required>
          <input class="filter-input" name="name" placeholder="Tên phụ tùng" required>
          <input class="filter-input" name="unitPrice" type="number" min="0" placeholder="Đơn giá" required>
          <input class="filter-input" name="stockOnHand" type="number" min="0" placeholder="Tồn ban đầu">
          <button type="submit" class="btn-primary" style="justify-content:center;">➕ Thêm phụ tùng</button>
        </form>` : '') + table(['SKU', 'Tên', 'Đơn giá', 'Tồn', 'Đã giữ', 'Khả dụng', ''], partRows, 'Không có quyền xem hoặc chưa có phụ tùng.')) +
      card('🏢 Trung tâm dịch vụ, khoang & kỹ thuật viên', `
        ${table(['Trung tâm', 'Chi nhánh', 'Địa chỉ', 'Khoang'], centers.map(c => `<tr><td><strong>${esc(c.name)}</strong><div style="font-size:11px; color:var(--text-muted);">${esc(c.id)}</div></td><td>${esc(c.branchId)}</td><td>${esc(c.address)}</td><td>${(resources.bays || []).filter(b => b.serviceCenterId === c.id).length}</td></tr>`), 'Chưa có trung tâm dịch vụ.')}
        <form id="ax-res-form" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(150px, 100%), 1fr)); gap:8px; margin-top:12px;">
          <select class="filter-select" name="kind">
            <option value="bay">Thêm khoang dịch vụ</option>
            <option value="technician">Thêm kỹ thuật viên</option>
            ${role === 'admin' ? '<option value="center">Thêm trung tâm (Admin)</option>' : ''}
          </select>
          <select class="filter-select" name="serviceCenterId">${centers.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>
          <input class="filter-input" name="name" placeholder="Tên khoang / họ tên KTV / tên trung tâm" required>
          <input class="filter-input" name="extra" placeholder="(Trung tâm) mã chi nhánh | địa chỉ">
          <button type="submit" class="btn-secondary" style="justify-content:center;">💾 Lưu</button>
        </form>`);

    el.querySelector('#ax-part-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget);
      try {
        await post('/workshop/parts', { sku: fd.get('sku'), name: fd.get('name'), unitPrice: Number(fd.get('unitPrice')), stockOnHand: fd.get('stockOnHand') === '' ? 0 : Number(fd.get('stockOnHand')) });
        ctx.showToast('Đã thêm phụ tùng.', '🔩');
        aftersales(el, ctx);
      } catch (e) { ctx.showToast(e.message, '⚠️'); }
    });
    el.querySelectorAll('.ax-part-restock').forEach(b => b.addEventListener('click', async () => {
      const qty = Number(el.querySelector(`.ax-part-qty[data-sku="${CSS.escape(b.dataset.sku)}"]`)?.value || 0);
      try {
        await post(`/workshop/parts/${encodeURIComponent(b.dataset.sku)}/restock`, { quantity: qty });
        ctx.showToast('Đã nhập kho phụ tùng.', '📥');
        aftersales(el, ctx);
      } catch (e) { ctx.showToast(e.message, '⚠️'); }
    }));
    el.querySelector('#ax-res-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget);
      const kind = fd.get('kind');
      const name = String(fd.get('name') || '').trim();
      let payload;
      if (kind === 'center') {
        const [branchId, address] = String(fd.get('extra') || '').split('|').map(s => s.trim());
        payload = { name, branchId, address };
      } else if (kind === 'technician') {
        payload = { serviceCenterId: fd.get('serviceCenterId'), fullName: name };
      } else {
        payload = { serviceCenterId: fd.get('serviceCenterId'), name };
      }
      try {
        await post('/workshop/resources', { kind, payload });
        ctx.showToast('Đã cập nhật tài nguyên xưởng.', '🏢');
        aftersales(el, ctx);
      } catch (e) { ctx.showToast(e.message, '⚠️'); }
    });
  }

  // ---------- dash-crm ----------
  async function crm(el, ctx, state = { offset: 0, q: '' }) {
    const isAdmin = ctx.curUser.role === 'admin';
    let html = '';
    if (!isAdmin) {
      try {
        const list = (await req('/seller/customers')).data || [];
        html += card('👥 Khách hàng của chi nhánh', table(['Khách hàng', 'Điện thoại', 'Chi nhánh', 'Nguồn'],
          list.map(c => `<tr><td><strong>${esc(c.fullName || c.id)}</strong></td><td>${esc(c.phone || '')}</td><td>${esc(c.branchId || '')}</td><td>${c.source === 'order' ? 'Đơn hàng' : 'Lịch hẹn'}</td></tr>`),
          'Chưa có khách hàng trong chi nhánh.'));
      } catch (e) { html += card('👥 Khách hàng của chi nhánh', errBox(e)); }
      el.innerHTML = html;
      return;
    }
    try {
      const qs = new URLSearchParams({ limit: '25', offset: String(state.offset) });
      if (state.q) qs.set('q', state.q);
      const d = (await req(`/admin/audit-logs?${qs}`)).data;
      const rows = (d.items || []).map(r => `<tr><td style="white-space:nowrap;">${esc(when(r.timestamp))}</td><td><span class="status-badge confirmed">${esc(r.action)}</span></td><td>${esc(r.actorName || r.actorId)}</td><td>${esc(r.targetId || '')}</td><td style="max-width:380px;">${esc(r.detail)}</td></tr>`);
      const pager = `
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <input class="filter-input" id="ax-audit-q" placeholder="Tìm hành động / nội dung" value="${esc(state.q)}" style="max-width:240px;">
          <button type="button" class="btn-secondary" id="ax-audit-search" style="padding:6px 12px;">🔍</button>
          <button type="button" class="btn-card-outline" id="ax-audit-prev" ${state.offset <= 0 ? 'disabled' : ''} style="padding:6px 10px;">‹</button>
          <span style="font-size:12px; color:var(--text-muted);">${d.total ? `${state.offset + 1}–${Math.min(d.total, state.offset + d.limit)} / ${d.total}` : '0'}</span>
          <button type="button" class="btn-card-outline" id="ax-audit-next" ${state.offset + d.limit >= d.total ? 'disabled' : ''} style="padding:6px 10px;">›</button>
        </div>`;
      el.innerHTML = card('🛡️ Nhật ký kiểm toán hệ thống', table(['Thời điểm', 'Hành động', 'Người thực hiện', 'Đối tượng', 'Chi tiết'], rows, 'Chưa có bản ghi.'), pager);
      el.querySelector('#ax-audit-search')?.addEventListener('click', () => crm(el, ctx, { offset: 0, q: el.querySelector('#ax-audit-q').value.trim() }));
      el.querySelector('#ax-audit-prev')?.addEventListener('click', () => crm(el, ctx, { offset: Math.max(0, state.offset - d.limit), q: state.q }));
      el.querySelector('#ax-audit-next')?.addEventListener('click', () => crm(el, ctx, { offset: state.offset + d.limit, q: state.q }));
    } catch (e) {
      el.innerHTML = card('🛡️ Nhật ký kiểm toán hệ thống', errBox(e));
    }
  }

  const PANELS = {
    'dash-overview': overview,
    'dash-inventory': inventory,
    'dash-reviews': reviews,
    'dash-campaigns': campaigns,
    'dash-aftersales': aftersales,
    'dash-crm': crm
  };

  async function mountForTab(tab, el, ctx = {}) {
    if (!el || typeof ApiClient === 'undefined') return;
    const fn = PANELS[tab];
    if (!fn) { el.innerHTML = ''; return; }
    const safeCtx = {
      curUser: ctx.curUser || (ApiClient.getCurrentUser && ApiClient.getCurrentUser()) || {},
      showToast: typeof ctx.showToast === 'function' ? ctx.showToast : () => {},
      analyticsFilter: ctx.analyticsFilter || {}
    };
    try { await fn(el, safeCtx); } catch (e) { el.innerHTML = errBox(e); }
  }

  window.SigmaAdminExtras = { mountForTab };
})();
