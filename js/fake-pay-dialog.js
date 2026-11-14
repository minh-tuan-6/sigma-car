// js/fake-pay-dialog.js — Simulated ("fake") payment confirmation for SIGMACAR.
// The site has no real payment provider: a payment is a sandbox intent settled through the existing signed sandbox
// webhook (POST /payments/sandbox/simulate), so the order, ledger, analytics and notifications update exactly as for a
// real payment, but no money moves.
//
//   SigmaFakePay.confirm({ amount, title })            → Promise<boolean>   (hold the green button 5 s to confirm)
//   SigmaFakePay.payOrder({ orderId, mode, amount })   → Promise<{ paid, intent?, result? }>
//       mode: 'deposit' (đặt cọc) | 'full' (thanh toán toàn bộ / phần còn lại)

(function () {
  const HOLD_MS = 5000;

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  const vnd = (n) => `${Math.round(Number(n) || 0).toLocaleString('vi-VN')} đ`;
  const toast = (msg, icon) => { if (typeof window.showToast === 'function') window.showToast(msg, icon); };

  function confirm({ amount, title = 'Xác nhận thanh toán', subtitle = '' } = {}) {
    return new Promise((resolve) => {
      const money = vnd(amount);
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay active';
      overlay.style.zIndex = '100000';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'fakepay-title');
      overlay.innerHTML = `
        <div style="background:#FFFFFF; border-radius:18px; width:min(440px, 92vw); padding:26px 24px; box-shadow:0 20px 50px rgba(15,23,42,0.25); text-align:center;">
          <div style="font-size:12px; font-weight:800; color:#64748B; letter-spacing:0.04em; text-transform:uppercase;">${esc(title)}</div>
          <h3 id="fakepay-title" style="margin:8px 0 4px; font-size:22px; font-weight:800; color:#0F172A;">Xác nhận trả ${esc(money)}?</h3>
          ${subtitle ? `<p style="margin:0 0 6px; font-size:13.5px; color:#475569;">${esc(subtitle)}</p>` : ''}
          <p style="margin:0 0 18px; font-size:12px; color:#B45309; background:#FFFBEB; border:1px solid #FDE68A; border-radius:8px; padding:6px 10px;">
            Thanh toán mô phỏng (sandbox) — không trừ tiền thật.
          </p>
          <button type="button" class="fakepay-hold" aria-describedby="fakepay-hint"
            style="position:relative; overflow:hidden; width:100%; border:none; border-radius:12px; padding:15px 16px; font-size:15.5px; font-weight:800; color:#FFFFFF; background:#15803D; cursor:pointer; touch-action:none; user-select:none; -webkit-user-select:none;">
            <span class="fakepay-fill" style="position:absolute; inset:0; width:0%; background:#22C55E; transition:none;"></span>
            <span style="position:relative;">Trả ${esc(money)} (nhấn giữ 5s)</span>
          </button>
          <div id="fakepay-hint" class="fakepay-hint" style="margin-top:8px; min-height:18px; font-size:12px; color:#64748B;">Nhấn và giữ nút xanh trong 5 giây để xác nhận.</div>
          <button type="button" class="btn-secondary fakepay-cancel" style="margin-top:12px; width:100%; justify-content:center; padding:10px;">Hủy</button>
        </div>`;
      document.body.appendChild(overlay);

      const btn = overlay.querySelector('.fakepay-hold');
      const fill = overlay.querySelector('.fakepay-fill');
      const hint = overlay.querySelector('.fakepay-hint');
      let startedAt = 0;
      let raf = 0;
      let done = false;

      const finish = (ok) => {
        if (done) return;
        done = true;
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', onEsc);
        overlay.remove();
        resolve(ok);
      };
      const tick = () => {
        const p = Math.min(1, (Date.now() - startedAt) / HOLD_MS);
        fill.style.width = `${(p * 100).toFixed(1)}%`;
        const left = Math.ceil((HOLD_MS - (Date.now() - startedAt)) / 1000);
        hint.textContent = p < 1 ? `Giữ thêm ${Math.max(0, left)} giây…` : 'Đang xử lý thanh toán…';
        if (p >= 1) { finish(true); return; }
        raf = requestAnimationFrame(tick);
      };
      const start = (e) => {
        if (done || startedAt) return;
        if (e && e.cancelable) e.preventDefault();
        startedAt = Date.now();
        raf = requestAnimationFrame(tick);
      };
      const stop = () => {
        if (done || !startedAt) return;
        cancelAnimationFrame(raf);
        startedAt = 0;
        fill.style.width = '0%';
        hint.textContent = 'Chưa đủ 5 giây — nhấn và giữ lại để xác nhận.';
      };
      const onEsc = (e) => { if (e.key === 'Escape') finish(false); };

      btn.addEventListener('pointerdown', (e) => { if (btn.setPointerCapture) { try { btn.setPointerCapture(e.pointerId); } catch (_) {} } start(e); });
      btn.addEventListener('pointerup', stop);
      btn.addEventListener('pointercancel', stop);
      btn.addEventListener('lostpointercapture', stop);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
      btn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) start(e); else if (e.key === ' ' || e.key === 'Enter') e.preventDefault(); });
      btn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') stop(); });
      btn.addEventListener('blur', stop);
      overlay.querySelector('.fakepay-cancel').addEventListener('click', () => finish(false));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
      document.addEventListener('keydown', onEsc);
      btn.focus();
    });
  }

  async function payOrder({ orderId, mode = 'full', amount, provider = 'napas_qr_sandbox', title } = {}) {
    const label = mode === 'deposit' ? 'Đặt cọc giữ xe' : 'Thanh toán đơn hàng';
    const ok = await confirm({ amount, title: title || label });
    if (!ok) return { paid: false, cancelled: true };
    const key = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const intent = await ApiClient.payments.createIntent({ orderId, mode, provider }, `fakepay-${key}`);
    const result = await ApiClient.payments.simulateSandbox({ intentId: intent.id, status: 'succeeded' });
    toast(`✅ Đã ${mode === 'deposit' ? 'đặt cọc' : 'thanh toán'} ${vnd(intent.amount)} (mô phỏng)`, '💳');
    return { paid: true, intent, result };
  }

  window.SigmaFakePay = { confirm, payOrder, HOLD_MS };
})();
