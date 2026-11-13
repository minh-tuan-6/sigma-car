// js/content-admin.js
// P4 Operations & Growth UI Modules:
// 1. Public Home CMS Promo/Editorial Loader
// 2. Seller Dashboard: Date/Branch Analytics Filter + CSV Export + Dynamic Chart + Funnel Metrics
// 3. Seller Dashboard: Live Workshop Scheduling/Bays/Parts & Warranty Claims Review
// 4. Seller Dashboard: CMS Editorial Draft/Preview/Publish/Rollback Panel
// 5. Buyer Garage: Submit & Track Digital Warranty Claims

(function () {
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(msg, icon = 'ℹ️') {
    if (typeof window.showToast === 'function') window.showToast(msg, icon);
  }

  // Safe sanitizer for displaying rich CMS preview/published markup on client as well
  function sanitizeClientHtml(raw = '') {
    let s = String(raw || '');
    s = s.replace(/<\s*(script|iframe|object|embed|form|style|meta|link)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '');
    s = s.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    s = s.replace(/(href|src)\s*=\s*(['"]?)\s*(?:javascript|vbscript|data:text\/html):[^'">\s]*\2/gi, '$1=$2#$2');
    return s;
  }

  function safeUrl(u, fallback = '#new-cars') {
    const raw = String(u || '').trim();
    if (!raw) return fallback;
    if (raw.startsWith('#') || raw.startsWith('assets/') || raw.startsWith('/') || /^https?:\/\//i.test(raw)) {
      return raw;
    }
    return fallback;
  }

  async function renderHomeCmsStrip(mountEl) {
    if (!mountEl || !window.ApiClient?.cms?.getPublic) return;
    try {
      const items = await window.ApiClient.cms.getPublic();
      if (!Array.isArray(items) || items.length === 0) {
        mountEl.innerHTML = '';
        return;
      }
      mountEl.innerHTML = `
        <section class="section" style="padding-top:24px; padding-bottom:12px;">
          <div class="container">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
              <div>
                <span class="section-tag">BẢN TIN & ƯU ĐÃI CHÍNH HÃNG</span>
                <h3 style="margin:2px 0 0; font-size:20px; font-weight:800; color:var(--text-dark);">Thông tin & Sự kiện SIGMACAR</h3>
              </div>
              <a href="#charging" class="link-view-all">⚡ Tra cứu Trạm sạc xe điện →</a>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap:16px;">
              ${items.slice(0, 4).map(it => `
                <article style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:16px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 4px 12px rgba(15,23,42,0.04);">
                  <div style="padding:18px; display:flex; flex-direction:column; gap:8px; flex:1;">
                    <span style="font-size:11px; font-weight:800; color:#2563EB; text-transform:uppercase;">${it.contentType === 'article' ? '📰 Bài viết Chuyên đề' : '✨ Ưu đãi Nổi bật'} • v${Number(it.publishedVersion || 1)}</span>
                    <h4 style="margin:0; font-size:16.5px; font-weight:800; color:#0F172A;">${esc(it.title)}</h4>
                    ${it.subtitle ? `<p style="margin:0; font-size:13px; color:#475569;">${esc(it.subtitle)}</p>` : ''}
                    <div style="font-size:13px; color:#334155; line-height:1.5;">${sanitizeClientHtml(it.bodyHtml)}</div>
                    ${it.ctaLabel ? `<div style="margin-top:auto; padding-top:8px;"><a href="${esc(safeUrl(it.ctaTarget))}" class="btn-secondary" style="display:inline-block; padding:7px 14px; font-size:12.5px; text-decoration:none;">${esc(it.ctaLabel)} →</a></div>` : ''}
                  </div>
                </article>
              `).join('')}
            </div>
          </div>
        </section>
      `;
    } catch (_) {
      mountEl.innerHTML = '';
    }
  }

  function renderDynamicMonthlyChartHtml(monthlySeries = []) {
    if (!Array.isArray(monthlySeries) || monthlySeries.length === 0) {
      return `
        <div style="padding:28px 16px; text-align:center; background:#F8FAFC; border:1px dashed #CBD5E1; border-radius:12px; color:#64748B; font-size:13px;">
          Chưa có đơn hàng hợp lệ trong khoảng thời gian/chi nhánh đã chọn để vẽ biểu đồ doanh số theo tháng.
        </div>
      `;
    }
    const maxVal = Math.max(1, ...monthlySeries.map(m => Number(m.committedGmv || 0)));
    return `
      <div style="overflow-x:auto; max-width:100%;">
      <div style="display:grid; grid-template-columns:repeat(${Math.min(6, monthlySeries.length)}, minmax(42px, 1fr)); gap:10px; align-items:end; height:170px; padding:14px 12px 6px; background:#F8FAFC; border-radius:12px; border:1px solid #E2E8F0; min-width:260px;">
        ${monthlySeries.map(pt => {
          const val = Number(pt.committedGmv || 0);
          const pct = Math.max(8, Math.round((val / maxVal) * 100));
          const shortBillions = val >= 1e9 ? `${(val / 1e9).toFixed(2)} tỷ` : `${Math.round(val / 1e6)} tr`;
          return `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%;">
              <span style="font-size:11px; font-weight:700; color:#1E40AF; margin-bottom:4px; white-space:nowrap;">${esc(shortBillions)}</span>
              <div style="width:100%; max-width:52px; height:${pct}%; background:linear-gradient(180deg, #2563EB 0%, #0EA5E9 100%); border-radius:8px 8px 4px 4px;"></div>
              <span style="font-size:11px; color:#475569; font-weight:600; margin-top:6px;">${esc(pt.month)}</span>
            </div>
          `;
        }).join('')}
      </div>
      </div>
    `;
  }

  async function mountOverviewInsights(mountEl, dashData, filterState, onFilterChange) {
    if (!mountEl) return;
    let funnel = null;
    try {
      funnel = await window.ApiClient.analytics.getFunnel({
        branchId: filterState.branchId,
        dateFrom: filterState.dateFrom,
        dateTo: filterState.dateTo
      });
    } catch (_) {}

    const counts = funnel?.counts || { vehicle_view: 0, test_drive: 0, quote: 0, checkout: 0, order_paid: 0, handover: 0 };
    const rates = funnel?.rates || { viewToTestDriveRate: 0, quoteToCheckoutRate: 0, checkoutToHandoverRate: 0 };
    const isLoadErr = Boolean(dashData._loadError);

    mountEl.innerHTML = `
      ${isLoadErr ? `
        <div style="background:#FEF2F2; border:1px solid #FECACA; color:#991B1B; padding:12px 16px; border-radius:10px; margin-bottom:16px; font-size:13px;">
          ⚠️ Không thể kết nối API báo cáo doanh số hoặc phạm vi chi nhánh bị từ chối. Đang hiển thị trạng thái 0 (không tự bịa số liệu).
        </div>
      ` : ''}

      <div class="dash-table-card" style="margin-bottom:20px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-end; gap:12px; flex-wrap:wrap; margin-bottom:14px;">
          <div>
            <h4 style="margin:0; font-size:15.5px; font-weight:800;">📈 Bộ lọc Doanh thu & Đối soát Tài chính (Server-Calculated)</h4>
            <div style="font-size:12px; color:#64748B; margin-top:2px;">
              Tiền thu thực tế: <strong>${Number(dashData.cashCollectedRevenue || 0).toLocaleString('vi-VN')} đ</strong> •
              Đã hoàn trả: <strong style="color:#DC2626;">${Number(dashData.refundedVnd || 0).toLocaleString('vi-VN')} đ</strong> •
              Tiền ròng (Net Cash): <strong style="color:#047857;">${Number(dashData.netCashVnd || 0).toLocaleString('vi-VN')} đ</strong>
            </div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
            <input type="date" id="ana-date-from" class="filter-input" style="width:140px; max-width:100%; padding:6px 8px; font-size:12px;" value="${esc(filterState.dateFrom || '')}">
            <input type="date" id="ana-date-to" class="filter-input" style="width:140px; max-width:100%; padding:6px 8px; font-size:12px;" value="${esc(filterState.dateTo || '')}">
            <select id="ana-branch-filter" class="filter-select" style="width:155px; max-width:100%; padding:6px 8px; font-size:12px;">
              <option value="all" ${(!filterState.branchId || filterState.branchId === 'all') ? 'selected' : ''}>Tất cả chi nhánh được phép</option>
              <option value="hn-caugiay" ${filterState.branchId === 'hn-caugiay' ? 'selected' : ''}>Hà Nội — Cầu Giấy</option>
              <option value="hcm-q7" ${filterState.branchId === 'hcm-q7' ? 'selected' : ''}>TP.HCM — Quận 7</option>
              <option value="dn-haichau" ${filterState.branchId === 'dn-haichau' ? 'selected' : ''}>Đà Nẵng — Hải Châu</option>
            </select>
            <button type="button" id="btn-ana-apply" class="btn-primary" style="padding:7px 12px; font-size:12px;">Lọc số liệu</button>
            <button type="button" id="btn-ana-csv" class="btn-secondary" style="padding:7px 12px; font-size:12px;">⬇️ Xuất CSV</button>
          </div>
        </div>
        ${renderDynamicMonthlyChartHtml(dashData.monthlySeries || [])}
      </div>

      <div class="dash-table-card" style="margin-bottom:20px;">
        <h4 style="margin:0 0 10px; font-size:15.5px; font-weight:800;">🧲 Phễu Chuyển đổi Khách hàng (Consent-Aware Funnel)</h4>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(125px, 1fr)); gap:10px; margin-bottom:10px;">
          <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:10px;">
            <div style="font-size:11px; color:#64748B;">Xem chi tiết xe</div>
            <div style="font-size:20px; font-weight:800; color:#0F172A;">${counts.vehicle_view}</div>
          </div>
          <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:10px;">
            <div style="font-size:11px; color:#64748B;">Đặt lịch lái thử</div>
            <div style="font-size:20px; font-weight:800; color:#1D4ED8;">${counts.test_drive}</div>
          </div>
          <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:10px;">
            <div style="font-size:11px; color:#64748B;">Tạo báo giá / TCO</div>
            <div style="font-size:20px; font-weight:800; color:#0369A1;">${counts.quote}</div>
          </div>
          <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:10px;">
            <div style="font-size:11px; color:#64748B;">Checkout / Cọc</div>
            <div style="font-size:20px; font-weight:800; color:#B45309;">${counts.checkout}</div>
          </div>
          <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:10px;">
            <div style="font-size:11px; color:#64748B;">Thanh toán đơn</div>
            <div style="font-size:20px; font-weight:800; color:#047857;">${counts.order_paid}</div>
          </div>
          <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:10px;">
            <div style="font-size:11px; color:#64748B;">Bàn giao xe</div>
            <div style="font-size:20px; font-weight:800; color:#065F46;">${counts.handover}</div>
          </div>
        </div>
        <div style="font-size:12px; color:#475569;">
          Tỷ lệ Xem → Lái thử: <strong>${rates.viewToTestDriveRate}%</strong> •
          Báo giá → Checkout: <strong>${rates.quoteToCheckoutRate}%</strong> •
          Checkout → Bàn giao: <strong>${rates.checkoutToHandoverRate}%</strong>
        </div>
      </div>
    `;

    document.getElementById('btn-ana-apply')?.addEventListener('click', () => {
      const nextFilter = {
        dateFrom: document.getElementById('ana-date-from')?.value || '',
        dateTo: document.getElementById('ana-date-to')?.value || '',
        branchId: document.getElementById('ana-branch-filter')?.value || 'all'
      };
      if (typeof onFilterChange === 'function') onFilterChange(nextFilter);
    });

    document.getElementById('btn-ana-csv')?.addEventListener('click', async () => {
      try {
        const csvText = await window.ApiClient.analytics.exportCsv({
          branchId: document.getElementById('ana-branch-filter')?.value || 'all',
          dateFrom: document.getElementById('ana-date-from')?.value || '',
          dateTo: document.getElementById('ana-date-to')?.value || ''
        });
        const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sigmacar-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast('Đã tải xuống báo cáo đối soát CSV!', '⬇️');
      } catch (err) {
        toast(err.message || 'Không thể xuất CSV.', '⚠️');
      }
    });
  }

  async function mountWorkshopAndClaimsPanel(mountEl, currentUser) {
    if (!mountEl || !window.ApiClient?.workshop) return;
    try {
      const [resources, jobs, claims] = await Promise.all([
        window.ApiClient.workshop.listResources().catch(() => ({ centers: [], bays: [], technicians: [], parts: [] })),
        window.ApiClient.workshop.listJobs().catch(() => []),
        window.ApiClient.warrantyClaims.list().catch(() => [])
      ]);

      const centers = resources.centers || [];
      const parts = resources.parts || [];
      const bays = resources.bays || [];
      const techs = resources.technicians || [];

      mountEl.innerHTML = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(290px, 100%), 1fr)); gap:20px; margin-bottom:24px;">
          <div class="dash-table-card" style="margin-bottom:0;">
            <h4 style="font-size:15.5px; font-weight:800; margin-bottom:12px;">🛠️ Khoang dịch vụ & Lệnh Xưởng (${jobs.length} lệnh)</h4>
            ${jobs.length === 0 ? `<p style="font-size:13px; color:#64748B;">Chưa có lệnh xưởng nào được tạo. Tạo lệnh mới bên dưới hoặc duyệt yêu cầu bảo hành.</p>` : `
              <div style="display:flex; flex-direction:column; gap:10px;">
                ${jobs.slice(0, 8).map(j => `
                  <div style="border:1px solid #E2E8F0; border-radius:10px; padding:12px; background:${j.status === 'Completed' ? '#ECFDF5' : (j.status === 'Cancelled' ? '#FEF2F2' : '#F8FAFC')};">
                    <div style="display:flex; justify-content:space-between; gap:8px; font-size:12px; font-weight:800;">
                      <span>${esc(j.jobCode)} • ${esc(j.bayName)}</span>
                      <span style="color:${j.status === 'Completed' ? '#047857' : (j.status === 'Cancelled' ? '#DC2626' : '#1D4ED8')};">${esc(j.status)}</span>
                    </div>
                    <div style="font-size:13.5px; font-weight:700; margin-top:3px;">${esc(j.vehicleName)} (${esc(j.vin)})</div>
                    <div style="font-size:12px; color:#475569;">${esc(j.serviceType)} • ${esc(j.scheduledDate)} ${esc(j.timeSlot)} • KTV: ${esc(j.technicianName)}</div>
                    <div style="font-size:12px; color:#0F172A; margin-top:4px;">Tổng chi phí: <strong>${Number(j.totalCost || 0).toLocaleString('vi-VN')} đ</strong></div>
                    ${['Scheduled', 'In_Progress'].includes(j.status) ? `
                      <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
                        <button type="button" class="btn-primary btn-ws-complete" data-id="${esc(j.id)}" style="padding:5px 10px; font-size:11.5px;">✓ Nghiệm thu & Xuất hóa đơn</button>
                        <button type="button" class="btn-secondary btn-ws-cancel" data-id="${esc(j.id)}" style="padding:5px 10px; font-size:11.5px; color:#DC2626;">✕ Hủy lệnh</button>
                      </div>
                    ` : ''}
                  </div>
                `).join('')}
              </div>
            `}

            <form id="form-ws-create-job" style="margin-top:14px; padding-top:14px; border-top:1px solid #E2E8F0; display:grid; grid-template-columns:repeat(auto-fit, minmax(min(170px, 100%), 1fr)); gap:8px;">
              <select id="ws-center" class="filter-select" style="min-width:0; max-width:100%;" required>
                ${centers.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}
              </select>
              <input type="text" id="ws-vin" class="filter-input" required placeholder="Số VIN xe (VD: VFSG2026...)">
              <input type="date" id="ws-date" class="filter-input" required value="${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}">
              <select id="ws-slot" class="filter-select">
                <option value="08:30">08:30</option>
                <option value="10:30">10:30</option>
                <option value="13:30">13:30</option>
                <option value="15:30">15:30</option>
              </select>
              <input type="text" id="ws-type" class="filter-input" style="grid-column:1/-1;" required placeholder="Hạng mục bảo dưỡng/sửa chữa tại xưởng">
              <select id="ws-part-sku" class="filter-select">
                <option value="">-- Không giữ phụ tùng --</option>
                ${parts.map(p => `<option value="${esc(p.sku)}">${esc(p.name)} (Khả dụng: ${p.availableStock})</option>`).join('')}
              </select>
              <button type="submit" class="btn-primary" style="justify-content:center;">+ Tạo Lệnh Xưởng</button>
            </form>
          </div>

          <div class="dash-table-card" style="margin-bottom:0;">
            <h4 style="font-size:15.5px; font-weight:800; margin-bottom:12px;">📦 Sổ cái Phụ tùng Chính hãng & Hồ sơ Bảo hành (${claims.length} claim)</h4>
            <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:14px;">
              ${parts.map(p => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border-radius:8px; border:1px solid ${p.availableStock <= 5 ? '#FECACA' : '#BBF7D0'}; background:${p.availableStock <= 5 ? '#FEF2F2' : '#ECFDF5'}; font-size:12.5px;">
                  <span><strong>${esc(p.sku)}</strong> — ${esc(p.name)}</span>
                  <span style="font-weight:800; color:${p.availableStock <= 5 ? '#DC2626' : '#047857'};">Khả dụng: ${p.availableStock} (Giữ: ${p.stockReserved})</span>
                </div>
              `).join('')}
            </div>

            <div style="font-size:13px; font-weight:800; margin-bottom:8px;">🛡️ Hồ sơ Yêu cầu Bảo hành (${claims.length})</div>
            ${claims.length === 0 ? `<p style="font-size:12.5px; color:#64748B;">Chưa có yêu cầu bảo hành nào cần thẩm định.</p>` : `
              <div style="display:flex; flex-direction:column; gap:8px;">
                ${claims.slice(0, 8).map(c => `
                  <div style="border:1px solid #E2E8F0; border-radius:10px; padding:10px; background:#FFFFFF;">
                    <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:800;">
                      <span>${esc(c.claimCode)} • VIN: ${esc(c.vin)}</span>
                      <span>${esc(c.status)} (${esc(c.coverageResult)})</span>
                    </div>
                    <div style="font-size:12.5px; color:#334155; margin-top:4px;">${esc(c.issueSummary)}</div>
                    ${['Submitted', 'Under_Review', 'Escalated'].includes(c.status) ? `
                      <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
                        <button type="button" class="btn-primary btn-claim-review" data-id="${esc(c.id)}" data-status="Approved" style="padding:4px 9px; font-size:11.5px;">✓ Duyệt BH</button>
                        <button type="button" class="btn-secondary btn-claim-review" data-id="${esc(c.id)}" data-status="Escalated" style="padding:4px 9px; font-size:11.5px;">⬆️ Chuyển cấp Admin</button>
                        <button type="button" class="btn-secondary btn-claim-review" data-id="${esc(c.id)}" data-status="Rejected" style="padding:4px 9px; font-size:11.5px; color:#DC2626;">✕ Từ chối</button>
                      </div>
                    ` : ''}
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>
      `;

      document.getElementById('form-ws-create-job')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const centerId = document.getElementById('ws-center')?.value;
        const partSku = document.getElementById('ws-part-sku')?.value;
        const firstBay = bays.find(b => b.serviceCenterId === centerId);
        const firstTech = techs.find(t => t.serviceCenterId === centerId);
        try {
          await window.ApiClient.workshop.createJob({
            serviceCenterId: centerId,
            bayId: firstBay ? firstBay.id : undefined,
            technicianId: firstTech ? firstTech.id : undefined,
            vin: document.getElementById('ws-vin')?.value.trim(),
            scheduledDate: document.getElementById('ws-date')?.value,
            timeSlot: document.getElementById('ws-slot')?.value,
            serviceType: document.getElementById('ws-type')?.value.trim(),
            laborItems: [{ title: document.getElementById('ws-type')?.value.trim(), amount: 500000 }],
            partsRequested: partSku ? [{ sku: partSku, quantity: 1 }] : []
          });
          toast('Đã tạo lệnh xưởng thành công!', '🛠️');
          mountWorkshopAndClaimsPanel(mountEl, currentUser);
        } catch (err) {
          toast(err.message || 'Không thể tạo lệnh xưởng.', '⚠️');
        }
      });

      mountEl.querySelectorAll('.btn-ws-complete').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-id');
          try {
            const res = await window.ApiClient.workshop.completeJob(id, {
              resultSummary: 'Hoàn tất kiểm tra & nghiệm thu đạt chuẩn SIGMACAR'
            });
            toast(`Đã xuất hóa đơn ${res.invoiceSnapshot?.invoiceCode || ''}!`, '✓');
            mountWorkshopAndClaimsPanel(mountEl, currentUser);
          } catch (err) {
            toast(err.message || 'Không thể nghiệm thu lệnh.', '⚠️');
          }
        });
      });

      mountEl.querySelectorAll('.btn-ws-cancel').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-id');
          try {
            await window.ApiClient.workshop.cancelJob(id, 'Hủy bởi quản lý xưởng');
            toast('Đã hủy lệnh xưởng & hoàn tồn kho phụ tùng.', 'ℹ️');
            mountWorkshopAndClaimsPanel(mountEl, currentUser);
          } catch (err) {
            toast(err.message, '⚠️');
          }
        });
      });

      mountEl.querySelectorAll('.btn-claim-review').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-id');
          const status = btn.getAttribute('data-status');
          const reason = prompt(`Nhập lý do thẩm định trạng thái "${status}":`, status === 'Approved' ? 'Đủ điều kiện bảo hành chính hãng' : 'Cần thẩm định bổ sung');
          if (!reason) return;
          try {
            await window.ApiClient.warrantyClaims.review(id, {
              nextStatus: status,
              decisionReason: reason,
              approvedAmount: 0
            });
            toast(`Đã cập nhật hồ sơ bảo hành sang ${status}!`, '🛡️');
            mountWorkshopAndClaimsPanel(mountEl, currentUser);
          } catch (err) {
            toast(err.message || 'Không thể xử lý hồ sơ bảo hành.', '⚠️');
          }
        });
      });
    } catch (_) {}
  }

  async function renderCmsTabHtml(currentUser) {
    let data = { items: [], auditLogs: [] };
    try {
      data = await window.ApiClient.cms.listStaff();
    } catch (_) {}

    const items = data.items || [];
    const canPublish = currentUser?.role === 'admin';

    return `
      <div class="dashboard-banner-header" style="background:linear-gradient(120deg, #0F172A 0%, #312E81 100%);">
        <h3>Quản trị Nội dung & Xuất bản CMS (${items.length} mục)</h3>
        <p>Biên tập Banner ưu đãi, bài viết tin tức có kiểm soát phiên bản (Draft → Admin Publish/Schedule → Rollback) và lọc XSS an toàn.</p>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(290px, 100%), 1fr)); gap:20px;">
        <div class="dash-table-card" style="margin-bottom:0;">
          <h4 style="margin:0 0 12px; font-size:15.5px; font-weight:800;">✍️ Tạo / Cập nhật Bản nháp CMS</h4>
          <form id="form-cms-draft" style="display:flex; flex-direction:column; gap:10px;">
            <input type="text" id="cms-slug" class="filter-input" placeholder="Slug (VD: uu-dai-thang-11)" required>
            <input type="text" id="cms-title" class="filter-input" placeholder="Tiêu đề hiển thị *" required>
            <input type="text" id="cms-subtitle" class="filter-input" placeholder="Mô tả ngắn (subtitle)">
            <select id="cms-type" class="filter-select">
              <option value="banner">Banner Trang chủ</option>
              <option value="article">Bài viết / Tin tức</option>
            </select>
            <textarea id="cms-body" class="filter-input" rows="4" placeholder="Nội dung HTML an toàn (tự động loại bỏ script/onclick)..."></textarea>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(150px, 100%), 1fr)); gap:8px;">
              <input type="text" id="cms-cta-label" class="filter-input" placeholder="Nhãn nút CTA" value="Xem dòng xe">
              <input type="text" id="cms-cta-target" class="filter-input" placeholder="Đích CTA" value="#new-cars">
            </div>
            <button type="submit" class="btn-primary" style="justify-content:center;">💾 Lưu Bản nháp (Draft)</button>
          </form>
        </div>

        <div class="dash-table-card" style="margin-bottom:0;">
          <h4 style="margin:0 0 12px; font-size:15.5px; font-weight:800;">
            📚 Danh sách Nội dung & Duyệt Xuất bản
            ${!canPublish ? `<span style="font-size:11px; color:#B45309; font-weight:600;">(Vai trò hiện tại chỉ tạo bản nháp; Admin mới được Publish)</span>` : ''}
          </h4>
          ${items.length === 0 ? `<p style="font-size:13px; color:#64748B;">Chưa có bài viết hoặc banner CMS nào.</p>` : `
            <div style="display:flex; flex-direction:column; gap:10px;">
              ${items.map(it => `
                <div style="border:1px solid #E2E8F0; border-radius:10px; padding:12px; background:${it.status === 'published' ? '#ECFDF5' : '#F8FAFC'};">
                  <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:800;">
                    <span>${esc(it.slug)} • v${Number(it.activeVersion || 1)} (Live: ${it.publishedVersion ? `v${it.publishedVersion}` : 'Chưa XB'})</span>
                    <span>${esc(it.status)}</span>
                  </div>
                  <div style="font-weight:800; font-size:14px; margin-top:4px;">${esc(it.title)}</div>
                  <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
                    <button type="button" class="btn-primary btn-cms-publish" data-id="${esc(it.id)}" data-ver="${Number(it.activeVersion || 1)}" style="padding:5px 10px; font-size:11.5px;">🚀 Xuất bản ngay</button>
                    ${Number(it.activeVersion || 1) > 1 ? `<button type="button" class="btn-secondary btn-cms-rollback" data-id="${esc(it.id)}" data-ver="${Number(it.activeVersion) - 1}" style="padding:5px 10px; font-size:11.5px;">↩️ Rollback v${Number(it.activeVersion) - 1}</button>` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;
  }

  function bindCmsTabActions(onReload) {
    document.getElementById('form-cms-draft')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await window.ApiClient.cms.saveDraft({
          slug: document.getElementById('cms-slug')?.value.trim(),
          title: document.getElementById('cms-title')?.value.trim(),
          subtitle: document.getElementById('cms-subtitle')?.value.trim(),
          contentType: document.getElementById('cms-type')?.value || 'banner',
          bodyHtml: document.getElementById('cms-body')?.value || '',
          ctaLabel: document.getElementById('cms-cta-label')?.value.trim(),
          ctaTarget: document.getElementById('cms-cta-target')?.value.trim()
        });
        toast('Đã lưu bản nháp CMS an toàn!', '💾');
        if (typeof onReload === 'function') onReload();
      } catch (err) {
        toast(err.message || 'Không thể lưu bản nháp CMS.', '⚠️');
      }
    });

    document.querySelectorAll('.btn-cms-publish').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await window.ApiClient.cms.publish(btn.getAttribute('data-id'), {
            version: Number(btn.getAttribute('data-ver'))
          });
          toast('Đã xuất bản nội dung lên Trang chủ!', '🚀');
          if (typeof onReload === 'function') onReload();
        } catch (err) {
          toast(err.message || 'Không có quyền xuất bản CMS.', '⚠️');
        }
      });
    });

    document.querySelectorAll('.btn-cms-rollback').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await window.ApiClient.cms.rollback(btn.getAttribute('data-id'), {
            targetVersion: Number(btn.getAttribute('data-ver')),
            reason: 'Hoàn tác nhanh từ Quản trị CMS'
          });
          toast('Đã khôi phục phiên bản trước!', '↩️');
          if (typeof onReload === 'function') onReload();
        } catch (err) {
          toast(err.message || 'Không thể khôi phục phiên bản.', '⚠️');
        }
      });
    });
  }

  async function mountBuyerClaimsPanel(mountEl, warranties = [], centers = []) {
    if (!mountEl || !window.ApiClient?.warrantyClaims) return;
    let claims = [];
    try {
      claims = await window.ApiClient.warrantyClaims.list();
    } catch (_) {}

    const vinOptions = warranties.map(w =>
      `<option value="${esc(w.vin)}" data-war="${esc(w.id)}">${esc(w.vehicleName)} — VIN: ${esc(w.vin)}</option>`
    ).join('');

    mountEl.innerHTML = `
      <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:18px; padding:20px; margin-top:20px;">
        <h4 style="font-size:16px; font-weight:800; margin:0 0 10px;">🛡️ Yêu cầu Bảo hành Kỹ thuật (Warranty Claims)</h4>
        ${warranties.length > 0 ? `
          <form id="form-buyer-warranty-claim" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:10px; margin-bottom:14px;">
            <select id="wc-vin" class="filter-select" required>${vinOptions}</select>
            <select id="wc-center" class="filter-select" required>
              ${(centers || []).map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}
            </select>
            <select id="wc-component" class="filter-select">
              <option value="battery_hv">Hệ thống Pin Cao áp HV</option>
              <option value="powertrain">Động cơ & Hộp số</option>
              <option value="adas_electronics">Cảm biến ADAS & Điện tử</option>
              <option value="tires">Lốp xe (Hao mòn - Cần thẩm định riêng)</option>
            </select>
            <input type="text" id="wc-summary" class="filter-input" style="grid-column:1/-1;" required placeholder="Mô tả triệu chứng kỹ thuật chi tiết (tối thiểu 10 ký tự)...">
            <button type="submit" class="btn-primary" style="justify-content:center;">📨 Gửi Hồ sơ Bảo hành</button>
          </form>
        ` : `<p style="font-size:13px; color:#64748B;">Kích hoạt Bảo hành Điện tử ở trên để gửi yêu cầu bảo hành kỹ thuật.</p>`}

        ${claims.length > 0 ? `
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${claims.map(c => `
              <div style="border:1px solid #E2E8F0; border-radius:10px; padding:10px 12px; font-size:12.5px; background:#F8FAFC;">
                <div style="display:flex; justify-content:space-between; font-weight:800;">
                  <span>${esc(c.claimCode)} • ${esc(c.vehicleName)}</span>
                  <span style="color:#1D4ED8;">${esc(c.status)}</span>
                </div>
                <div style="color:#334155; margin-top:3px;">${esc(c.issueSummary)}</div>
                <div style="color:#64748B; font-size:11.5px; margin-top:2px;">Kết quả đối chiếu phạm vi: ${esc(c.coverageResult)}${c.decisionReason ? ` • Phản hồi: ${esc(c.decisionReason)}` : ''}</div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;

    document.getElementById('form-buyer-warranty-claim')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const vinSel = document.getElementById('wc-vin');
      const warId = vinSel?.options[vinSel.selectedIndex]?.getAttribute('data-war') || null;
      try {
        await window.ApiClient.warrantyClaims.submit({
          vin: vinSel?.value,
          warrantyId: warId,
          serviceCenterId: document.getElementById('wc-center')?.value,
          componentCategory: document.getElementById('wc-component')?.value,
          issueSummary: document.getElementById('wc-summary')?.value.trim()
        });
        toast('Đã gửi hồ sơ yêu cầu bảo hành thành công!', '🛡️');
        mountBuyerClaimsPanel(mountEl, warranties, centers);
      } catch (err) {
        toast(err.message || 'Không thể gửi yêu cầu bảo hành.', '⚠️');
      }
    });
  }

  window.SigmaContentAdmin = {
    renderHomeCmsStrip,
    mountOverviewInsights,
    mountWorkshopAndClaimsPanel,
    renderCmsTabHtml,
    bindCmsTabActions,
    mountBuyerClaimsPanel
  };
})();
