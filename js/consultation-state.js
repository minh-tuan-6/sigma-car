// js/consultation-state.js
// Frontend Consultation Preferences, Persisted Threads & Consent-Gated Fit Context (SIG-P3-005, SIG-P3-006)

(function () {
  'use strict';

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderMdSafe(text) {
    if (!text) return '';
    let html = esc(text);
    html = html.replace(/```[\w+-]*\n([\s\S]*?)```/g, (_, code) =>
      `<pre style="background:#0F172A;color:#E2E8F0;padding:10px;border-radius:8px;overflow-x:auto;font-size:12px;"><code>${code}</code></pre>`
    );
    html = html.replace(/`([^`]+)`/g, '<code style="background:#E2E8F0;color:#0F172A;padding:1px 5px;border-radius:4px;">$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  function formatVnd(num) {
    const val = Number(num);
    if (!Number.isFinite(val)) return 'Chưa công bố';
    if (val >= 1e9) return `${(val / 1e9).toFixed(3).replace(/\.?0+$/, '')} tỷ VNĐ`;
    if (val >= 1e6) return `${Math.round(val / 1e6).toLocaleString('vi-VN')} triệu VNĐ`;
    return `${Math.round(val).toLocaleString('vi-VN')} VNĐ`;
  }

  const state = {
    conversations: [],
    activeConversationId: null,
    preferences: {
      budgetVnd: '',
      monthlyBudgetVnd: '',
      downPaymentVnd: '',
      passengers: '',
      dailyKm: '',
      usage: '',
      chargingAccess: 'unknown'
    },
    pendingImage: null,
    imageConsent: false
  };

  function getAuthToken() {
    return typeof ApiClient !== 'undefined' && typeof ApiClient.getToken === 'function'
      ? ApiClient.getToken()
      : null;
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve(null);
      if (file.size > 5 * 1024 * 1024) {
        return reject(new Error('Dung lượng ảnh vượt quá giới hạn tối đa 5 MB.'));
      }
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      if (file.type && !allowed.includes(file.type)) {
        return reject(new Error('Chỉ hỗ trợ định dạng ảnh JPG, PNG hoặc WEBP.'));
      }
      const reader = new FileReader();
      reader.onload = () => resolve({
        fileName: file.name || 'parking-space.jpg',
        mimeType: file.type || 'image/jpeg',
        dataBase64: String(reader.result || '')
      });
      reader.onerror = () => reject(new Error('Không thể đọc tệp ảnh từ thiết bị.'));
      reader.readAsDataURL(file);
    });
  }

  function renderRecommendationCardsHtml(top3 = [], flagged = []) {
    const cards = [];
    if (Array.isArray(top3) && top3.length > 0) {
      cards.push(`
        <div class="ai-top3-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:10px; margin-top:10px;">
          ${top3.map((car, idx) => `
            <div style="background:#FFFFFF; border:1px solid #BFDBFE; border-radius:12px; padding:12px; box-shadow:0 2px 6px rgba(15,23,42,0.04);">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:6px;">
                <span style="font-size:10.5px; font-weight:800; color:#1D4ED8; background:#EFF6FF; padding:2px 8px; border-radius:9999px;">TOP ${idx + 1} ĐỀ XUẤT</span>
                <span style="font-size:11px; color:#0F766E; font-weight:700;">Còn ${Number(car.stock || 0)} xe</span>
              </div>
              <div style="font-size:14px; font-weight:800; color:#0F172A; margin-bottom:2px;">${esc(car.name)}</div>
              <div style="font-size:13px; font-weight:700; color:#0284C7; margin-bottom:6px;">${esc(car.priceFormatted || formatVnd(car.price))}</div>
              <div style="font-size:11.5px; color:#475569; line-height:1.45; margin-bottom:8px;">
                ${car.estimatedMonthlyVnd ? `<div>💳 Trả góp dự kiến: ~<strong>${formatVnd(car.estimatedMonthlyVnd)}/tháng</strong></div>` : ''}
                ${(car.reasons || []).slice(0, 2).map(r => `<div>✓ ${esc(r)}</div>`).join('')}
                ${(car.missingData || []).slice(0, 2).map(m => `<div style="color:#B45309;">ℹ️ ${esc(m)}</div>`).join('')}
              </div>
              <div style="display:flex; gap:6px; flex-wrap:wrap;">
                <button type="button" class="btn-primary" style="padding:5px 9px; font-size:11.5px;" onclick="window.openCarDetail('${esc(car.carId)}')">Xem xe</button>
                <button type="button" class="btn-secondary" style="padding:5px 9px; font-size:11.5px;" onclick="window.bookCarTestDrive('${esc(car.carId)}')">Lái thử</button>
                <button type="button" class="btn-card-outline" style="padding:5px 9px; font-size:11.5px;" onclick="window.location.hash='tco?carId=${encodeURIComponent(car.carId)}'">TCO 5 năm</button>
              </div>
            </div>
          `).join('')}
        </div>
      `);
    }

    if (Array.isArray(flagged) && flagged.length > 0) {
      cards.push(`
        <div style="margin-top:10px; padding:10px 12px; background:#FFFBEB; border:1px solid #FDE68A; border-radius:10px; font-size:12px; color:#92400E;">
          <strong>⚠️ Không có mẫu xe đạt 100% ràng buộc — Phương án gần nhất (đã gắn cờ):</strong>
          ${flagged.map(f => `
            <div style="margin-top:6px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
              <span>• <strong>${esc(f.name)}</strong> (${esc(f.priceFormatted)}) — ${esc(f.warning)}</span>
              <button type="button" class="btn-secondary" style="padding:3px 8px; font-size:11px;" onclick="window.openCarDetail('${esc(f.carId)}')">Xem chi tiết</button>
            </div>
          `).join('')}
        </div>
      `);
    }
    return cards.join('');
  }

  function renderFitContextHtml(fitContext) {
    if (!fitContext) return '';
    const rows = Array.isArray(fitContext.comparisons) && fitContext.comparisons.length > 0
      ? fitContext.comparisons.map(c => `<div style="margin-top:4px;">• <strong>${esc(c.name)}</strong>: ${esc(c.reason)}</div>`).join('')
      : '';
    if (!rows && !fitContext.disclaimer) return '';
    return `
      <div style="margin-top:8px; padding:10px 12px; background:#F8FAFC; border:1px solid #CBD5E1; border-radius:10px; font-size:11.5px; color:#334155;">
        ${rows ? `<div style="font-weight:700; margin-bottom:4px;">📏 Đối chiếu kích thước bãi đỗ tự đo:</div>${rows}` : ''}
        <div style="color:#64748B; margin-top:4px;">ℹ️ ${esc(fitContext.disclaimer || '')}</div>
      </div>
    `;
  }

  function buildSidebarControlsHtml(isLoggedIn) {
    return `
      <div class="ai-side-panel" style="display:flex; flex-direction:column; gap:12px; margin-bottom:14px;">
        <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:14px; padding:14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; gap:8px; flex-wrap:wrap;">
            <strong style="font-size:13px; color:#0F172A;">🎯 Hồ sơ nhu cầu & Ràng buộc ngân sách</strong>
            ${isLoggedIn
              ? `<span style="font-size:11px; color:#059669; font-weight:700;">● Đồng bộ tài khoản</span>`
              : `<span style="font-size:11px; color:#B45309; font-weight:600;">Khách vãng lai (Đăng nhập để lưu lịch sử)</span>`}
          </div>
          <div class="ai-pref-grid">
            <div>
              <label style="font-size:11px; color:#475569; font-weight:700;">Ngân sách tối đa (VNĐ)</label>
              <input type="number" id="ai-pref-budget" class="filter-select" min="0" step="50000000" placeholder="VD: 1200000000" value="${esc(state.preferences.budgetVnd ?? '')}">
            </div>
            <div>
              <label style="font-size:11px; color:#475569; font-weight:700;">Trả góp tối đa/tháng (VNĐ)</label>
              <input type="number" id="ai-pref-monthly" class="filter-select" min="0" step="1000000" placeholder="VD: 20000000" value="${esc(state.preferences.monthlyBudgetVnd ?? '')}">
            </div>
            <div>
              <label style="font-size:11px; color:#475569; font-weight:700;">Số chỗ tối thiểu</label>
              <select id="ai-pref-passengers" class="filter-select">
                <option value="">Tất cả</option>
                <option value="2" ${Number(state.preferences.passengers) === 2 ? 'selected' : ''}>2 chỗ+</option>
                <option value="4" ${Number(state.preferences.passengers) === 4 ? 'selected' : ''}>4 chỗ+</option>
                <option value="5" ${Number(state.preferences.passengers) === 5 ? 'selected' : ''}>5 chỗ+</option>
                <option value="7" ${Number(state.preferences.passengers) === 7 ? 'selected' : ''}>7 chỗ+</option>
              </select>
            </div>
            <div>
              <label style="font-size:11px; color:#475569; font-weight:700;">Điều kiện sạc điện</label>
              <select id="ai-pref-charging" class="filter-select">
                <option value="unknown" ${state.preferences.chargingAccess === 'unknown' ? 'selected' : ''}>Chưa xác định</option>
                <option value="home" ${state.preferences.chargingAccess === 'home' ? 'selected' : ''}>Có sạc tại nhà</option>
                <option value="public_only" ${state.preferences.chargingAccess === 'public_only' ? 'selected' : ''}>Chỉ sạc công cộng</option>
                <option value="none" ${state.preferences.chargingAccess === 'none' ? 'selected' : ''}>Chưa có hạ tầng sạc</option>
              </select>
            </div>
            <div>
              <label style="font-size:11px; color:#475569; font-weight:700;">Mục đích chính</label>
              <select id="ai-pref-usage" class="filter-select">
                <option value="">Linh hoạt</option>
                <option value="urban" ${state.preferences.usage === 'urban' ? 'selected' : ''}>Đi phố hằng ngày</option>
                <option value="family" ${state.preferences.usage === 'family' ? 'selected' : ''}>Gia đình / Đa dụng</option>
                <option value="highway" ${state.preferences.usage === 'highway' ? 'selected' : ''}>Đường trường / Cao tốc</option>
                <option value="luxury" ${state.preferences.usage === 'luxury' ? 'selected' : ''}>Trải nghiệm cao cấp</option>
              </select>
            </div>
            <div style="display:flex; align-items:flex-end; gap:6px;">
              <button type="button" id="btn-ai-save-prefs" class="btn-primary" style="width:100%; justify-content:center; padding:9px 12px; font-size:12px;">
                💾 Lưu tiêu chí
              </button>
            </div>
          </div>

          <details style="margin-top:10px; border-top:1px dashed #CBD5E1; padding-top:8px;">
            <summary style="cursor:pointer; font-size:12px; font-weight:700; color:#0284C7;">
              📷 & 📏 Kiểm tra không gian đỗ xe (Tùy chọn • Có đồng ý bảo mật)
            </summary>
            <div style="margin-top:10px; display:flex; flex-direction:column; gap:8px;">
              <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px;">
                <input type="number" id="ai-space-len" class="filter-select" min="0" max="50" step="0.1" placeholder="Dài chỗ đỗ (m)">
                <input type="number" id="ai-space-wid" class="filter-select" min="0" max="50" step="0.1" placeholder="Rộng chỗ đỗ (m)">
                <input type="number" id="ai-space-hgt" class="filter-select" min="0" max="20" step="0.1" placeholder="Cao trần (m)">
              </div>
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <input type="file" id="ai-space-image-input" accept="image/jpeg,image/png,image/webp" style="font-size:12px;">
                <span id="ai-space-file-status" style="font-size:11.5px; color:#475569;"></span>
              </div>
              <label style="display:flex; align-items:flex-start; gap:8px; font-size:11.5px; color:#334155; cursor:pointer; background:#FFFBEB; padding:8px; border-radius:8px; border:1px solid #FDE68A;">
                <input type="checkbox" id="ai-space-consent-chk" style="margin-top:2px;" ${state.imageConsent ? 'checked' : ''}>
                <span>Tôi đồng ý tải ảnh riêng tư lên hệ thống (gỡ EXIF, tự hủy sau 24 giờ hoặc khi xóa hội thoại). Đánh giá từ ảnh chỉ là ước lượng trực quan, không thay thế đo thực tế.</span>
              </label>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button type="button" id="btn-ai-clear-image" class="btn-card-outline" style="padding:5px 10px; font-size:11.5px;">Bỏ chọn ảnh</button>
                ${isLoggedIn ? `<button type="button" id="btn-ai-revoke-consent" class="btn-card-outline" style="padding:5px 10px; font-size:11.5px; color:#B91C1C; border-color:#FCA5A5;">🔒 Thu hồi ảnh đã gửi</button>` : ''}
              </div>
            </div>
          </details>
        </div>

        ${isLoggedIn ? `
          <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:14px; padding:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; gap:8px; flex-wrap:wrap;">
              <strong style="font-size:12.5px; color:#0F172A;">💬 Phiên tư vấn đã lưu (${state.conversations.length})</strong>
              <button type="button" id="btn-ai-new-conv" class="btn-secondary" style="padding:4px 10px; font-size:11.5px;">+ Phiên mới</button>
            </div>
            <div id="ai-conv-threads-list" style="display:flex; gap:8px; overflow-x:auto; padding-bottom:4px;">
              ${state.conversations.length === 0
                ? `<span style="font-size:12px; color:#64748B;">Chưa có phiên nào được lưu — gửi câu hỏi đầu tiên bên dưới.</span>`
                : state.conversations.map(c => `
                    <div style="display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:9999px; border:1px solid ${c.id === state.activeConversationId ? '#0284C7' : '#CBD5E1'}; background:${c.id === state.activeConversationId ? '#EFF6FF' : '#F8FAFC'}; white-space:nowrap; font-size:11.5px;">
                      <button type="button" class="ai-conv-select-btn" data-id="${esc(c.id)}" style="background:none;border:none;cursor:pointer;font-weight:${c.id === state.activeConversationId ? '700' : '500'};color:#0F172A;padding:0;">
                        ${esc(c.title || 'Phiên tư vấn')} (${Number(c.messageCount || 0)})
                      </button>
                      <button type="button" class="ai-conv-delete-btn" data-id="${esc(c.id)}" title="Xóa hội thoại & hết hạn ảnh đính kèm" style="background:none;border:none;cursor:pointer;color:#DC2626;font-weight:800;padding:0 2px;">×</button>
                    </div>
                  `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  function readUiPreferences() {
    const budgetVal = document.getElementById('ai-pref-budget')?.value;
    const monthlyVal = document.getElementById('ai-pref-monthly')?.value;
    const passengersVal = document.getElementById('ai-pref-passengers')?.value;
    const chargingVal = document.getElementById('ai-pref-charging')?.value || 'unknown';
    const usageVal = document.getElementById('ai-pref-usage')?.value || null;
    state.preferences = {
      ...state.preferences,
      budgetVnd: budgetVal !== '' && budgetVal !== undefined ? Number(budgetVal) : null,
      monthlyBudgetVnd: monthlyVal !== '' && monthlyVal !== undefined ? Number(monthlyVal) : null,
      passengers: passengersVal !== '' && passengersVal !== undefined ? Number(passengersVal) : null,
      chargingAccess: chargingVal,
      usage: usageVal || null
    };
    return state.preferences;
  }

  function readMeasuredSpace() {
    const l = document.getElementById('ai-space-len')?.value;
    const w = document.getElementById('ai-space-wid')?.value;
    const h = document.getElementById('ai-space-hgt')?.value;
    if (!l && !w && !h) return null;
    return {
      lengthMeters: l ? Number(l) : null,
      widthMeters: w ? Number(w) : null,
      heightMeters: h ? Number(h) : null
    };
  }

  window.SigmaConsultationView = {
    state,
    renderRecommendationCardsHtml,
    renderFitContextHtml,
    renderMdSafe,

    async mount({ containerEl, renderThreadCallback, showToast }) {
      if (!containerEl) return;
      const isLoggedIn = Boolean(getAuthToken());

      if (isLoggedIn) {
        try {
          const [prefs, convList] = await Promise.all([
            ApiClient.ai.getPreferences(),
            ApiClient.ai.getConversations({ limit: 20 })
          ]);
          if (prefs) state.preferences = { ...state.preferences, ...prefs };
          state.conversations = Array.isArray(convList?.items) ? convList.items : [];
          if (!state.activeConversationId && state.conversations.length > 0) {
            state.activeConversationId = state.conversations[0].id;
          }
        } catch (err) {
          console.warn('[SigmaConsultationView] load error:', err.message);
        }
      } else {
        state.conversations = [];
        state.activeConversationId = null;
      }

      const repaintSidebar = () => {
        containerEl.innerHTML = buildSidebarControlsHtml(Boolean(getAuthToken()));
        bindEvents();
      };

      const loadSelectedConversation = async (convId) => {
        if (!convId || !getAuthToken()) return;
        try {
          const detail = await ApiClient.ai.getConversationMessages(convId, { limit: 60 });
          state.activeConversationId = convId;
          if (typeof renderThreadCallback === 'function') {
            renderThreadCallback(detail.messages || [], detail.conversation || null);
          }
          repaintSidebar();
        } catch (err) {
          if (showToast) showToast(err.message || 'Không tải được lịch sử hội thoại.', '⚠️');
        }
      };

      const bindEvents = () => {
        document.getElementById('btn-ai-save-prefs')?.addEventListener('click', async () => {
          const prefs = readUiPreferences();
          if (!getAuthToken()) {
            if (showToast) showToast('Đã áp dụng bộ lọc tạm; hãy đăng nhập để lưu lâu dài.', 'ℹ️');
            return;
          }
          try {
            const saved = await ApiClient.ai.updatePreferences(prefs);
            state.preferences = { ...state.preferences, ...saved };
            if (showToast) showToast('Đã lưu hồ sơ nhu cầu tư vấn lên tài khoản!', '✅');
          } catch (err) {
            if (showToast) showToast(err.message || 'Không thể lưu tiêu chí.', '❌');
          }
        });

        document.getElementById('ai-space-consent-chk')?.addEventListener('change', (e) => {
          state.imageConsent = !!e.target.checked;
        });

        document.getElementById('ai-space-image-input')?.addEventListener('change', async (e) => {
          const file = e.target.files && e.target.files[0];
          const statusEl = document.getElementById('ai-space-file-status');
          if (!file) {
            state.pendingImage = null;
            if (statusEl) statusEl.textContent = '';
            return;
          }
          try {
            state.pendingImage = await readFileAsBase64(file);
            if (statusEl) statusEl.textContent = `Đã chọn: ${file.name} (${Math.round(file.size / 1024)} KB)`;
          } catch (err) {
            state.pendingImage = null;
            e.target.value = '';
            if (statusEl) statusEl.textContent = '';
            if (showToast) showToast(err.message, '⚠️');
          }
        });

        document.getElementById('btn-ai-clear-image')?.addEventListener('click', () => {
          state.pendingImage = null;
          const inp = document.getElementById('ai-space-image-input');
          if (inp) inp.value = '';
          const statusEl = document.getElementById('ai-space-file-status');
          if (statusEl) statusEl.textContent = '';
        });

        document.getElementById('btn-ai-revoke-consent')?.addEventListener('click', async () => {
          if (!getAuthToken()) return;
          try {
            await ApiClient.ai.updatePreferences({ revokeImageConsent: true });
            state.imageConsent = false;
            state.pendingImage = null;
            repaintSidebar();
            if (showToast) showToast('Đã thu hồi đồng ý và hết hạn các ảnh tư vấn trước đó.', '🔒');
          } catch (err) {
            if (showToast) showToast(err.message, '❌');
          }
        });

        document.getElementById('btn-ai-new-conv')?.addEventListener('click', async () => {
          if (!getAuthToken()) return;
          try {
            const conv = await ApiClient.ai.createConversation({
              title: 'Phiên tư vấn mới',
              preferences: readUiPreferences()
            });
            state.activeConversationId = conv.id;
            state.conversations.unshift({ id: conv.id, title: conv.title, messageCount: 0 });
            if (typeof renderThreadCallback === 'function') renderThreadCallback([], conv);
            repaintSidebar();
          } catch (err) {
            if (showToast) showToast(err.message, '❌');
          }
        });

        document.querySelectorAll('.ai-conv-select-btn').forEach(btn => {
          btn.addEventListener('click', () => loadSelectedConversation(btn.getAttribute('data-id')));
        });

        document.querySelectorAll('.ai-conv-delete-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const convId = btn.getAttribute('data-id');
            try {
              await ApiClient.ai.deleteConversation(convId);
              state.conversations = state.conversations.filter(c => c.id !== convId);
              if (state.activeConversationId === convId) {
                state.activeConversationId = state.conversations[0]?.id || null;
                if (state.activeConversationId) {
                  await loadSelectedConversation(state.activeConversationId);
                  return;
                }
                if (typeof renderThreadCallback === 'function') renderThreadCallback([], null);
              }
              repaintSidebar();
              if (showToast) showToast('Đã xóa phiên tư vấn và vô hiệu hóa ảnh đính kèm.', '🗑️');
            } catch (err) {
              if (showToast) showToast(err.message, '❌');
            }
          });
        });
      };

      repaintSidebar();
      if (isLoggedIn && state.activeConversationId) {
        await loadSelectedConversation(state.activeConversationId);
      }
    },

    async sendConsultationMessage({ text, history, showToast }) {
      const prefs = readUiPreferences();
      const measuredSpaceDimensions = readMeasuredSpace();
      const chk = document.getElementById('ai-space-consent-chk');
      const consent = chk ? !!chk.checked : state.imageConsent;

      if (state.pendingImage && !consent) {
        const msg = 'Vui lòng tích vào ô đồng ý trước khi gửi ảnh bãi đỗ/không gian để phân tích.';
        if (showToast) showToast(msg, '⚠️');
        const err = new Error(msg);
        err.code = 'CONSENT_REQUIRED';
        throw err;
      }

      if (!getAuthToken()) {
        if (state.pendingImage) {
          const err = new Error('Vui lòng đăng nhập để tải ảnh riêng tư lên phiên tư vấn.');
          err.code = 'UNAUTHORIZED';
          throw err;
        }
        return await ApiClient.ai.chat(text, history);
      }

      const res = await ApiClient.ai.chat({
        conversationId: state.activeConversationId || null,
        persist: true,
        message: text,
        preferences: prefs,
        image: state.pendingImage || null,
        imageConsent: consent,
        measuredSpaceDimensions
      });

      if (res && res.conversationId) {
        state.activeConversationId = res.conversationId;
        state.pendingImage = null;
        const inp = document.getElementById('ai-space-image-input');
        if (inp) inp.value = '';
        const statusEl = document.getElementById('ai-space-file-status');
        if (statusEl) statusEl.textContent = '';
        try {
          const convList = await ApiClient.ai.getConversations({ limit: 20 });
          state.conversations = Array.isArray(convList?.items) ? convList.items : state.conversations;
          const listWrap = document.getElementById('ai-conv-threads-list');
          if (listWrap) {
            listWrap.innerHTML = state.conversations.map(c => `
              <div style="display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:9999px; border:1px solid ${c.id === state.activeConversationId ? '#0284C7' : '#CBD5E1'}; background:${c.id === state.activeConversationId ? '#EFF6FF' : '#F8FAFC'}; white-space:nowrap; font-size:11.5px;">
                <button type="button" class="ai-conv-select-btn" data-id="${esc(c.id)}" style="background:none;border:none;cursor:pointer;font-weight:${c.id === state.activeConversationId ? '700' : '500'};color:#0F172A;padding:0;">
                  ${esc(c.title || 'Phiên tư vấn')} (${Number(c.messageCount || 0)})
                </button>
              </div>
            `).join('');
          }
        } catch (e) {}
      }
      return res;
    }
  };
})();
