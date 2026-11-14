// js/garage-extras-view.js — My Garage extras (PLAN.md T2.7, T1.17)
// Shown at the end of the profile "Xe đã lưu" tab: saved 3D configurations (from /api/v1/garage, already loaded by the
// profile), saved TCO results and saved AI recommendations (/api/v1/garage/tco-results, /api/v1/garage/recommendations).
// Reuses existing card styles; owner-only data.

(function () {
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  const vnd = (n) => (Number.isFinite(Number(n)) && n !== null ? `${Number(n).toLocaleString('vi-VN')} đ` : '—');
  const date = (iso) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleDateString('vi-VN') : '');

  const card = (inner) => `<div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:14px; padding:16px; display:flex; flex-direction:column; gap:8px; box-shadow:0 2px 8px rgba(0,0,0,0.03);">${inner}</div>`;
  const section = (title, count, body, empty) => `
    <div style="margin-top:28px;">
      <h3 style="font-size:18px; font-weight:800; color:var(--text-dark); margin:0 0 12px;">${esc(title)} (${count})</h3>
      ${count > 0 ? `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap:14px;">${body}</div>`
        : `<p style="font-size:13px; color:var(--text-muted); margin:0;">${esc(empty)}</p>`}
    </div>`;

  function configCard(c) {
    return card(`
      <strong style="font-size:14.5px; color:var(--text-dark);">${esc(c.label || c.name || c.vehicleName || c.vehicleId)}</strong>
      <span style="font-size:12.5px; color:var(--text-secondary);">🎨 ${esc(c.colorName || 'Màu tiêu chuẩn')}${c.wheelName || c.wheelId ? ` • 🛞 ${esc(c.wheelName || c.wheelId)}` : ''}${c.trimName ? ` • ${esc(c.trimName)}` : ''}</span>
      <span style="font-size:11.5px; color:var(--text-muted);">${esc(date(c.updatedAt || c.createdAt))}</span>
      <button type="button" class="btn-card-outline gx-open-config" data-vehicle="${esc(c.vehicleId)}" style="padding:6px 10px; font-size:12px;">🧊 Mở trong Showroom 3D</button>`);
  }

  function tcoCard(t) {
    return card(`
      <strong style="font-size:14.5px; color:var(--text-dark);">${esc(t.title)}</strong>
      <span style="font-size:12.5px; color:var(--text-secondary);">${esc(t.carA?.vehicleName || '')}: ${vnd(t.carA?.fiveYearTotal)} / 5 năm${t.carB ? `<br>${esc(t.carB.vehicleName)}: ${vnd(t.carB.fiveYearTotal)} / 5 năm` : ''}</span>
      ${t.fiveYearSavings != null ? `<span style="font-size:12.5px; font-weight:700; color:#047857;">Chênh lệch 5 năm: ${vnd(Math.abs(t.fiveYearSavings))}</span>` : ''}
      <span style="font-size:11.5px; color:var(--text-muted);">${t.monthlyKm != null ? `${Number(t.monthlyKm).toLocaleString('vi-VN')} km/tháng • ` : ''}${esc(date(t.createdAt))}</span>
      <button type="button" class="btn-card-outline gx-delete" data-kind="tco-results" data-id="${esc(t.id)}" style="padding:6px 10px; font-size:12px; color:#DC2626;">🗑️ Xóa</button>`);
  }

  function recCard(r) {
    return card(`
      <strong style="font-size:14.5px; color:var(--text-dark);">${esc(r.vehicleName)}</strong>
      ${r.query ? `<span style="font-size:12px; color:var(--text-muted);">Nhu cầu: “${esc(r.query)}”</span>` : ''}
      ${(r.reasons || []).length ? `<ul style="margin:0; padding-left:18px; font-size:12.5px; color:var(--text-secondary); line-height:1.5;">${r.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <span style="font-size:11.5px; color:var(--text-muted);">${esc(date(r.createdAt))}</span>
      <div style="display:flex; gap:8px;">
        <button type="button" class="btn-card-outline gx-open-detail" data-vehicle="${esc(r.vehicleId)}" style="flex:1; padding:6px 10px; font-size:12px;">Xem xe</button>
        <button type="button" class="btn-card-outline gx-delete" data-kind="recommendations" data-id="${esc(r.id)}" style="padding:6px 10px; font-size:12px; color:#DC2626;">🗑️</button>
      </div>`);
  }

  async function mount(el, { savedConfigs = [], showToast } = {}) {
    if (!el || typeof ApiClient === 'undefined' || !ApiClient.garageExtras) return;
    const toast = typeof showToast === 'function' ? showToast : () => {};
    let tco = [];
    let recs = [];
    try {
      [tco, recs] = await Promise.all([
        ApiClient.garageExtras.list('tco-results').catch(() => []),
        ApiClient.garageExtras.list('recommendations').catch(() => [])
      ]);
    } catch (e) { /* sections render empty */ }

    el.innerHTML = [
      section('🧊 Cấu hình 3D đã lưu', savedConfigs.length, savedConfigs.map(configCard).join(''), 'Chưa có cấu hình nào. Lưu cấu hình trong Showroom 360° / VR•AR.'),
      section('📊 Kết quả TCO đã lưu', tco.length, tco.map(tcoCard).join(''), 'Chưa có kết quả nào. Bấm "Lưu vào Gara" trên trang Dự toán Chi phí Vận hành.'),
      section('🤖 Gợi ý AI đã lưu', recs.length, recs.map(recCard).join(''), 'Chưa có gợi ý nào. Lưu gợi ý từ Trợ lý tư vấn AI.')
    ].join('');

    el.querySelectorAll('.gx-open-config').forEach(b => b.addEventListener('click', () => {
      const id = b.getAttribute('data-vehicle');
      if (id && typeof window.openVrArShowroom === 'function') window.openVrArShowroom(id);
    }));
    el.querySelectorAll('.gx-open-detail').forEach(b => b.addEventListener('click', () => {
      const id = b.getAttribute('data-vehicle');
      if (id && typeof window.openCarDetail === 'function') window.openCarDetail(id);
    }));
    el.querySelectorAll('.gx-delete').forEach(b => b.addEventListener('click', async () => {
      try {
        await ApiClient.garageExtras.remove(b.getAttribute('data-kind'), b.getAttribute('data-id'));
        toast('Đã xóa khỏi Gara của tôi.', '🗑️');
        mount(el, { savedConfigs, showToast });
      } catch (err) {
        toast(err.message || 'Không xóa được mục đã lưu.', '⚠️');
      }
    }));
  }

  window.SigmaGarageExtrasView = { mount };
})();
