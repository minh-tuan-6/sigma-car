// js/battery-view.js — Battery swap stations & battery rental (PLAN.md T2.5)
// Rendered below the charging-station grid of the #charging page (mounted by charging-view.js). Reuses the charging
// page's card styles; read-only data from /api/v1/charging/swap-stations and /api/v1/charging/battery-rental.

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

  function stationCard(s) {
    return `
      <article style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:16px; padding:18px; display:flex; flex-direction:column; gap:10px; box-shadow:0 4px 14px rgba(15,23,42,0.04);">
        <div>
          <span style="font-size:11px; font-weight:800; color:#7C3AED; text-transform:uppercase; letter-spacing:0.04em;">Trạm đổi pin (tham chiếu)</span>
          <h3 style="margin:3px 0 0; font-size:16px; font-weight:800; color:#0F172A;">${esc(s.name)}</h3>
        </div>
        <div style="font-size:13px; color:#475569; line-height:1.5;">📍 ${esc(s.address)}, <strong>${esc(s.province)}</strong></div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">
          <span style="background:#F1F5F9; color:#0F172A; border:1px solid #CBD5E1; border-radius:999px; padding:3px 9px; font-size:11.5px; font-weight:700;">🔋 Pin ${esc((s.compatiblePackKwh || []).join(' / '))} kWh</span>
          <span style="background:#F1F5F9; color:#0F172A; border:1px solid #CBD5E1; border-radius:999px; padding:3px 9px; font-size:11.5px; font-weight:700;">⏱️ ~${Number(s.swapMinutes || 0)} phút/lần đổi</span>
          <span style="background:#F1F5F9; color:#0F172A; border:1px solid #CBD5E1; border-radius:999px; padding:3px 9px; font-size:11.5px; font-weight:700;">🕒 ${esc(s.openHours)}</span>
        </div>
        <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.lat},${s.lng}`)}" target="_blank" rel="noopener noreferrer" class="btn-secondary" style="text-align:center; padding:8px 12px; font-size:12.5px; text-decoration:none; margin-top:auto;">🗺️ Chỉ đường Map</a>
      </article>`;
  }

  function planCard(p) {
    return `
      <article style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:16px; padding:18px; display:flex; flex-direction:column; gap:8px; box-shadow:0 4px 14px rgba(15,23,42,0.04);">
        <span style="font-size:11px; font-weight:800; color:#2563EB; text-transform:uppercase; letter-spacing:0.04em;">Thuê pin (BaaS)</span>
        <h3 style="margin:0; font-size:16px; font-weight:800; color:#0F172A;">${esc(p.name)}</h3>
        <div style="font-size:20px; font-weight:800; color:#047857;">${vnd(p.monthlyFeeVnd)}<span style="font-size:12px; color:#64748B; font-weight:600;"> / tháng</span></div>
        <ul style="margin:0; padding-left:18px; font-size:12.5px; color:#475569; line-height:1.6;">
          <li>${p.includedKmPerMonth ? `Bao gồm ${Number(p.includedKmPerMonth).toLocaleString('vi-VN')} km/tháng, vượt mức ${vnd(p.extraFeeVndPerKm)}/km` : 'Không giới hạn km'}</li>
          <li>Đổi pin: ${p.swapFeeVnd ? vnd(p.swapFeeVnd) + '/lần' : 'miễn phí'}</li>
          <li>Kỳ hạn tối thiểu ${Number(p.minTermMonths || 0)} tháng • Cọc ${vnd(p.depositVnd)}</li>
        </ul>
        ${p.notes ? `<p style="margin:0; font-size:12px; color:#64748B;">${esc(p.notes)}</p>` : ''}
      </article>`;
  }

  async function mount(el) {
    if (!el || typeof ApiClient === 'undefined' || !ApiClient.charging) return;
    el.innerHTML = '<div style="padding:24px; text-align:center; color:#64748B;">Đang tải thông tin đổi pin & thuê pin...</div>';
    try {
      const [swap, rental] = await Promise.all([
        ApiClient.charging.getSwapStations(),
        ApiClient.charging.getBatteryRental()
      ]);
      const stations = (swap && swap.stations) || [];
      const plans = (rental && rental.plans) || [];
      const policies = (rental && rental.policies) || [];
      el.innerHTML = `
        <h2 style="font-size:22px; font-weight:800; color:#0F172A; margin:32px 0 6px;">🔋 Đổi pin & Thuê pin</h2>
        <p style="margin:0 0 16px; font-size:13px; color:#B45309; background:#FFFBEB; border:1px solid #FDE68A; border-radius:10px; padding:8px 12px;">ℹ️ ${esc((swap && swap.disclaimer) || (rental && rental.disclaimer) || '')}</p>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap:18px; margin-bottom:22px;">
          ${stations.length ? stations.map(stationCard).join('') : '<div style="grid-column:1/-1; padding:24px; text-align:center; color:#64748B;">Chưa có trạm đổi pin trong danh mục.</div>'}
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap:18px;">
          ${plans.map(planCard).join('')}
          ${policies.length ? `
          <article style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:16px; padding:18px;">
            <h3 style="margin:0 0 8px; font-size:15px; font-weight:800; color:#0F172A;">Chính sách thuê pin</h3>
            <ul style="margin:0; padding-left:18px; font-size:12.5px; color:#475569; line-height:1.6;">${policies.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
          </article>` : ''}
        </div>`;
    } catch (err) {
      el.innerHTML = `<div style="padding:16px; color:#B91C1C; font-size:13px;">Không tải được thông tin đổi pin & thuê pin: ${esc(err && err.message)}</div>`;
    }
  }

  window.SigmaBatteryView = { mount };
})();
