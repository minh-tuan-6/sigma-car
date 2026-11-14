// js/cart-view.js
// Persistent Shopping Cart & Guest-Merge View for SIGMACAR (SIG-P1-006)

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

  async function updateCartHeaderBadge() {
    const badgeEl = document.getElementById('header-cart-badge');
    if (!badgeEl) return;
    let count = 0;
    try {
      const curUser = ApiClient.getCurrentUser();
      if (curUser && ApiClient.getToken()) {
        const cart = await ApiClient.cart.get();
        count = cart?.summary?.itemsCount || (cart?.items || []).reduce((s, i) => s + (i.quantity || 1), 0);
      } else {
        const draft = ApiClient.cart.getGuestDraft();
        count = draft.reduce((s, i) => s + (i.quantity || 1), 0);
      }
    } catch (_) {
      const draft = ApiClient.cart.getGuestDraft();
      count = draft.reduce((s, i) => s + (i.quantity || 1), 0);
    }
    badgeEl.textContent = String(count);
    badgeEl.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  async function addItemToCart({ itemType = 'vehicle', itemId, quantity = 1, colorName = null, colorHex = null, trimName = null, branchId = 'hn-caugiay', name = '', image = '' }, deps = {}) {
    const showToast = deps.showToast || window.showToast || (() => {});
    const curUser = ApiClient.getCurrentUser();
    if (!curUser || !ApiClient.getToken()) {
      ApiClient.cart.addGuestDraftItem({ itemType, itemId, quantity, colorName, colorHex, trimName, branchId, name, image });
      await updateCartHeaderBadge();
      showToast(`🛒 Đã thêm "${name || itemId}" vào giỏ hàng tạm. Đăng nhập để đồng bộ tài khoản!`, '🛒');
      return { guest: true };
    }
    const cart = await ApiClient.cart.addItem({ itemType, itemId, quantity, colorName, colorHex, trimName, branchId });
    await updateCartHeaderBadge();
    showToast(`🛒 Đã thêm "${name || itemId}" vào giỏ hàng của bạn!`, '✓');
    return cart;
  }

  async function renderCartView(container, deps = {}) {
    const navigateTo = deps.navigateTo || window.navigateTo;
    const requireAuth = deps.requireAuth || window.requireAuth;
    const showToast = deps.showToast || window.showToast || (() => {});
    const curUser = ApiClient.getCurrentUser();
    const isAuthenticated = Boolean(curUser && ApiClient.getToken());

    container.innerHTML = `
      <section class="section" style="padding-top:36px; min-height:60vh;">
        <div class="container">
          <div style="text-align:center; padding:64px 20px; color:var(--text-muted);">
            <div style="font-size:32px; margin-bottom:10px;">⏳</div>
            <div>Đang tải giỏ hàng & tính toán báo giá máy chủ...</div>
          </div>
        </div>
      </section>
    `;

    let cartData = null;
    let loadError = null;
    let promoCodeDraft = sessionStorage.getItem('sigmacar_cart_promo_draft') || '';

    try {
      if (isAuthenticated) {
        if (ApiClient.cart.getGuestDraft().length > 0) {
          await ApiClient.cart.mergeGuestDraftOnLogin().catch(() => {});
        }
        cartData = await ApiClient.cart.get();
      } else {
        const draftItems = ApiClient.cart.getGuestDraft();
        const branchId = sessionStorage.getItem('sigmacar_cart_branch_draft') || 'hn-caugiay';
        const deliveryMethod = sessionStorage.getItem('sigmacar_cart_delivery_draft') || 'showroom';
        if (draftItems.length === 0) {
          cartData = { id: 'guest_draft', branchId, deliveryMethod, items: [], version: 1, summary: { itemsCount: 0, itemsSubtotal: 0, discountAmount: 0, deliveryFee: 0, totalAmount: 0, depositAmount: 0 } };
        } else {
          const quote = await ApiClient.quotes.create({
            items: draftItems,
            promoCode: promoCodeDraft || undefined,
            branchId,
            deliveryMethod
          });
          cartData = {
            id: 'guest_draft',
            branchId,
            deliveryMethod,
            promoCode: quote.promo ? quote.promo.code : null,
            version: 1,
            items: quote.lines.map((l, idx) => ({ ...draftItems[idx], ...l })),
            summary: {
              itemsCount: quote.lines.reduce((s, l) => s + (l.quantity || 1), 0),
              itemsSubtotal: quote.itemsSubtotal,
              discountAmount: quote.discountAmount,
              deliveryFee: quote.deliveryFee,
              totalAmount: quote.totalAmount,
              depositAmount: quote.depositAmount,
              promo: quote.promo
            }
          };
        }
      }
    } catch (err) {
      loadError = err.message || 'Không thể tải dữ liệu giỏ hàng.';
    }

    await updateCartHeaderBadge();

    if (loadError) {
      const canOfferDemo = !ApiClient.isDemoMode() && /Static Read-Only|máy chủ|kết nối|BACKEND/i.test(loadError);
      container.innerHTML = `
        <section class="section" style="padding-top:40px; min-height:60vh;">
          <div class="container" style="max-width:680px;">
            <div style="background:#FEF2F2; border:1px solid #FCA5A5; border-radius:16px; padding:32px; text-align:center;">
              <div style="font-size:40px; margin-bottom:10px;">⚠️</div>
              <h2 style="font-size:20px; font-weight:800; color:#991B1B; margin-bottom:8px;">Không thể tải giỏ hàng</h2>
              <p style="font-size:14px; color:#7F1D1D; margin-bottom:20px;">${esc(loadError)}</p>
              <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
                ${canOfferDemo ? '<button class="btn-primary" id="btn-cart-enable-demo" style="background:linear-gradient(135deg,#0EA5E9,#2563EB);">🧪 Bật Demo Sandbox</button>' : ''}
                <button class="btn-primary" id="btn-cart-retry">↻ Thử lại</button>
                <button class="btn-secondary" onclick="window.location.hash='new-cars'">Xem dòng xe</button>
              </div>
            </div>
          </div>
        </section>
      `;
      document.getElementById('btn-cart-enable-demo')?.addEventListener('click', () => {
        ApiClient.setDemoMode(true);
        showToast('Đã bật Chế độ Demo Sandbox trên trình duyệt.', '🧪');
        renderCartView(container, deps);
      });
      document.getElementById('btn-cart-retry')?.addEventListener('click', () => renderCartView(container, deps));
      return;
    }

    const items = cartData?.items || [];
    if (items.length === 0) {
      container.innerHTML = `
        <section class="section" style="padding-top:48px; min-height:65vh;">
          <div class="container" style="max-width:640px;">
            <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-xl); padding:48px 28px; text-align:center; box-shadow:var(--shadow-sm);">
              <div style="font-size:52px; margin-bottom:12px;">🛒</div>
              <h2 style="font-size:24px; font-weight:800; color:var(--text-dark); margin-bottom:8px;">Giỏ hàng của bạn đang trống</h2>
              <p style="font-size:14.5px; color:var(--text-muted); margin-bottom:24px;">Hãy chọn mẫu xe SIGMACAR hoặc phụ kiện chính hãng để lập báo giá chi tiết và giữ suất ưu đãi.</p>
              <div style="display:flex; gap:12px; justify-content:center; flex-wrap:wrap;">
                <button class="btn-primary" onclick="window.location.hash='new-cars'">🚗 Khám phá Dòng xe mới</button>
                <button class="btn-secondary" onclick="window.location.hash='accessories'">🧰 Xem Phụ kiện chính hãng</button>
              </div>
            </div>
          </div>
        </section>
      `;
      return;
    }

    const s = cartData.summary || {};
    const branchId = cartData.branchId || 'hn-caugiay';
    const deliveryMethod = cartData.deliveryMethod || 'showroom';

    container.innerHTML = `
      <section class="section" style="padding-top:36px; padding-bottom:64px;">
        <div class="container">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:24px;">
            <div>
              <h1 style="font-size:28px; font-weight:800; color:var(--text-dark); margin:0;">🛒 Giỏ hàng & Báo giá Tạm tính</h1>
              <p style="font-size:14px; color:var(--text-muted); margin:4px 0 0;">
                ${isAuthenticated ? `Đồng bộ tài khoản <strong>${esc(curUser.fullName)}</strong> (v${cartData.version || 1})` : 'Chế độ giỏ hàng tạm • Đăng nhập để lưu đồng bộ nhiều thiết bị'}
              </p>
            </div>
            <button type="button" class="btn-secondary" onclick="window.location.hash='new-cars'">← Tiếp tục xem xe</button>
          </div>

          <div class="cart-layout-grid" style="display:grid; grid-template-columns:minmax(0,1.55fr) minmax(0,1fr); gap:24px; align-items:start;">
            <!-- Cart Lines -->
            <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-xl); padding:22px; box-shadow:var(--shadow-sm);">
              <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom:14px; margin-bottom:16px; border-bottom:1px solid var(--border-subtle);">
                <strong style="font-size:15px;">Sản phẩm đã chọn (${s.itemsCount || items.length})</strong>
                <button type="button" id="btn-cart-clear-all" style="background:none; border:none; color:#DC2626; font-size:12.5px; font-weight:700; cursor:pointer;">🗑️ Xóa tất cả</button>
              </div>

              <div style="display:flex; flex-direction:column; gap:14px;">
                ${items.map(line => `
                  <div style="display:flex; gap:14px; padding:14px; border:1px solid #E2E8F0; border-radius:12px; align-items:center; flex-wrap:wrap;">
                    <img src="${esc(line.image || 'assets/model-e.jpg')}" alt="${esc(line.name)}" onerror="this.onerror=null;this.src='assets/model-e.jpg';" style="width:96px; height:64px; object-fit:cover; border-radius:8px; background:#F8FAFC;">
                    <div style="flex:1; min-width:170px;">
                      <div style="font-size:11px; font-weight:800; color:var(--primary); text-transform:uppercase;">
                        ${line.itemType === 'accessory' ? 'Phụ kiện chính hãng' : (line.itemType === 'certified' ? 'Xe Certified (1 chiếc/VIN)' : 'Xe mới')}
                      </div>
                      <div style="font-weight:800; font-size:15px; color:var(--text-dark); margin:2px 0;">${esc(line.name)}</div>
                      <div style="font-size:12px; color:var(--text-muted);">
                        ${line.trimName ? `Phiên bản: <strong>${esc(line.trimName)}</strong> • ` : ''}
                        ${line.colorName ? `Màu: <strong>${esc(line.colorName)}</strong> • ` : ''}
                        Đơn giá: <strong>${fmtVnd(line.unitPrice)}</strong>
                      </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                      <button type="button" class="btn-cart-qty" data-line="${esc(line.lineId)}" data-next="${Math.max(0, (line.quantity || 1) - 1)}" style="width:30px; height:30px; border-radius:8px; border:1px solid #CBD5E1; background:#F8FAFC; font-weight:800; cursor:pointer;">-</button>
                      <span style="min-width:22px; text-align:center; font-weight:800;">${line.quantity || 1}</span>
                      <button type="button" class="btn-cart-qty" data-line="${esc(line.lineId)}" data-next="${(line.quantity || 1) + 1}" ${line.isCertified ? 'disabled title="Xe Certified chỉ có 1 chiếc"' : ''} style="width:30px; height:30px; border-radius:8px; border:1px solid #CBD5E1; background:#F8FAFC; font-weight:800; cursor:pointer; ${line.isCertified ? 'opacity:0.4; cursor:not-allowed;' : ''}">+</button>
                    </div>
                    <div style="text-align:right; min-width:125px;">
                      <div style="font-weight:800; color:var(--primary); font-size:14.5px;">${fmtVnd(line.lineTotal)}</div>
                      <button type="button" class="btn-cart-remove" data-line="${esc(line.lineId)}" style="background:none; border:none; color:#94A3B8; font-size:11.5px; cursor:pointer; margin-top:4px;">Bỏ chọn</button>
                    </div>
                  </div>
                `).join('')}
              </div>

              <!-- Branch & Delivery Config -->
              <div class="p1-2col-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:20px; padding-top:16px; border-top:1px solid var(--border-subtle);">
                <div>
                  <label class="filter-label" for="cart-branch-select">Showroom giữ kho & bàn giao</label>
                  <select class="filter-select" id="cart-branch-select">
                    ${BRANCHES.map(b => `<option value="${b.id}" ${branchId === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label class="filter-label" for="cart-delivery-select">Hình thức giao nhận xe</label>
                  <select class="filter-select" id="cart-delivery-select">
                    <option value="showroom" ${deliveryMethod === 'showroom' ? 'selected' : ''}>Nhận tại Showroom (Miễn phí - 0 đ)</option>
                    <option value="home_city" ${deliveryMethod === 'home_city' ? 'selected' : ''}>Giao tận nhà nội thành (+2.500.000 đ)</option>
                    <option value="intercity" ${deliveryMethod === 'intercity' ? 'selected' : ''}>Vận chuyển xe chuyên dụng liên tỉnh (+8.000.000 đ)</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Quote Summary Sidebar -->
            <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-xl); padding:22px; box-shadow:var(--shadow-sm);">
              <h3 style="font-size:17px; font-weight:800; color:var(--text-dark); margin:0 0 14px;">Chi tiết Báo giá Chuẩn (Server)</h3>

              <div style="margin-bottom:14px;">
                <label class="filter-label" for="cart-promo-input">Mã ưu đãi / Voucher</label>
                <div style="display:flex; gap:8px;">
                  <input type="text" class="filter-input" id="cart-promo-input" placeholder="Nhập mã (vd: SIGMA50, EVGREEN5)" value="${esc(cartData.promoCode || promoCodeDraft)}" style="text-transform:uppercase;">
                  <button type="button" class="btn-dark" id="btn-cart-apply-promo" style="white-space:nowrap; padding:0 14px;">Áp dụng</button>
                </div>
                <div style="font-size:11.5px; color:var(--text-muted); margin-top:5px;">Gợi ý: <code>SIGMA50</code> (giảm 50tr đơn ≥ 1 tỷ), <code>EVGREEN5</code> (xe điện -5%), <code>TET2026</code> (-10tr)</div>
                ${s.promoError ? `<div style="font-size:12px; color:#DC2626; margin-top:6px; font-weight:600;">⚠️ ${esc(s.promoError)}</div>` : ''}
                ${s.promo ? `<div style="font-size:12px; color:#059669; margin-top:6px; font-weight:700;">✓ Đã áp dụng ${esc(s.promo.code)}: -${fmtVnd(s.promo.discountAmount)}</div>` : ''}
              </div>

              <div style="display:flex; flex-direction:column; gap:10px; padding:14px 0; border-top:1px solid var(--border-subtle); border-bottom:1px solid var(--border-subtle); font-size:13.5px;">
                <div style="display:flex; justify-content:space-between;">
                  <span style="color:var(--text-muted);">Tạm tính sản phẩm</span>
                  <strong>${fmtVnd(s.itemsSubtotal)}</strong>
                </div>
                <div style="display:flex; justify-content:space-between;">
                  <span style="color:var(--text-muted);">Ưu đãi / Khuyến mãi</span>
                  <strong style="color:#059669;">-${fmtVnd(s.discountAmount || 0)}</strong>
                </div>
                <div style="display:flex; justify-content:space-between;">
                  <span style="color:var(--text-muted);">Phí vận chuyển & giao nhận</span>
                  <strong>${fmtVnd(s.deliveryFee || 0)}</strong>
                </div>
              </div>

              <div style="display:flex; justify-content:space-between; align-items:baseline; margin:14px 0 6px;">
                <span style="font-weight:700; font-size:14px;">Tổng giá trị dự kiến</span>
                <strong style="font-size:21px; color:var(--primary);">${fmtVnd(s.totalAmount)}</strong>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:16px; background:#EFF6FF; padding:10px 12px; border-radius:10px;">
                <span style="font-size:12.5px; font-weight:700; color:#1E40AF;">Đặt cọc giữ chỗ ngay</span>
                <strong style="font-size:16px; color:#1D4ED8;">${fmtVnd(s.depositAmount)}</strong>
              </div>

              <button type="button" class="btn-primary" id="btn-cart-proceed-checkout" style="width:100%; justify-content:center; padding:13px; font-size:15px; font-weight:800;">
                ⚡ Tiến hành Checkout & Giữ xe 15 phút →
              </button>
              <div style="font-size:11.5px; color:var(--text-muted); margin-top:10px; line-height:1.5;">
                ⓘ Phí trước bạ & đăng ký biển số theo tỉnh thành sẽ được tính chính xác sau khi xác nhận đơn hàng.
              </div>
            </div>
          </div>
        </div>
      </section>
    `;

    // Bind events
    document.querySelectorAll('.btn-cart-qty').forEach(btn => {
      btn.addEventListener('click', async () => {
        const lineId = btn.getAttribute('data-line');
        const nextQty = parseInt(btn.getAttribute('data-next'), 10);
        try {
          if (isAuthenticated) {
            await ApiClient.cart.updateItem(lineId, { quantity: nextQty, expectedVersion: cartData.version });
          } else {
            const draft = ApiClient.cart.getGuestDraft();
            const updated = nextQty <= 0
              ? draft.filter(d => d.lineId !== lineId)
              : draft.map(d => d.lineId === lineId ? { ...d, quantity: nextQty } : d);
            ApiClient.cart.saveGuestDraft(updated);
          }
          renderCartView(container, deps);
        } catch (err) {
          showToast(err.message || 'Không thể cập nhật số lượng.', '⚠️');
          if (err.code === 'CART_VERSION_CONFLICT') renderCartView(container, deps);
        }
      });
    });

    document.querySelectorAll('.btn-cart-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const lineId = btn.getAttribute('data-line');
        try {
          if (isAuthenticated) {
            await ApiClient.cart.removeItem(lineId, cartData.version);
          } else {
            ApiClient.cart.saveGuestDraft(ApiClient.cart.getGuestDraft().filter(d => d.lineId !== lineId));
          }
          renderCartView(container, deps);
        } catch (err) {
          showToast(err.message, '⚠️');
        }
      });
    });

    document.getElementById('btn-cart-clear-all')?.addEventListener('click', async () => {
      try {
        if (isAuthenticated) await ApiClient.cart.clear();
        else ApiClient.cart.clearGuestDraft();
        renderCartView(container, deps);
      } catch (err) {
        showToast(err.message, '⚠️');
      }
    });

    document.getElementById('cart-branch-select')?.addEventListener('change', async (e) => {
      const nextBranch = e.target.value;
      if (isAuthenticated) {
        await ApiClient.cart.updateMeta({ branchId: nextBranch, expectedVersion: cartData.version }).catch(err => showToast(err.message, '⚠️'));
      } else {
        sessionStorage.setItem('sigmacar_cart_branch_draft', nextBranch);
      }
      renderCartView(container, deps);
    });

    document.getElementById('cart-delivery-select')?.addEventListener('change', async (e) => {
      const nextDelivery = e.target.value;
      if (isAuthenticated) {
        await ApiClient.cart.updateMeta({ deliveryMethod: nextDelivery, expectedVersion: cartData.version }).catch(err => showToast(err.message, '⚠️'));
      } else {
        sessionStorage.setItem('sigmacar_cart_delivery_draft', nextDelivery);
      }
      renderCartView(container, deps);
    });

    document.getElementById('btn-cart-apply-promo')?.addEventListener('click', async () => {
      const code = document.getElementById('cart-promo-input')?.value.trim().toUpperCase() || '';
      try {
        if (isAuthenticated) {
          await ApiClient.cart.applyPromo(code, cartData.version);
        } else {
          if (code) {
            await ApiClient.promotions.validate({ code, subtotal: s.itemsSubtotal, items: cartData.items, branchId });
          }
          sessionStorage.setItem('sigmacar_cart_promo_draft', code);
        }
        showToast(code ? `Đã áp dụng mã ưu đãi ${code}!` : 'Đã gỡ mã ưu đãi.', '🏷️');
        renderCartView(container, deps);
      } catch (err) {
        showToast(err.message || 'Mã khuyến mãi không hợp lệ.', '⚠️');
      }
    });

    document.getElementById('btn-cart-proceed-checkout')?.addEventListener('click', () => {
      const goCheckout = () => {
        if (navigateTo) navigateTo('checkout', { source: 'cart' });
        else window.location.hash = 'checkout?source=cart';
      };
      if (!isAuthenticated && requireAuth) {
        requireAuth('tiến hành đặt hàng & giữ chỗ xe', async () => {
          await ApiClient.cart.mergeGuestDraftOnLogin().catch(() => {});
          await updateCartHeaderBadge();
          goCheckout();
        });
      } else {
        goCheckout();
      }
    });
  }

  window.SigmaCartView = {
    renderCartView,
    addItemToCart,
    updateCartHeaderBadge
  };
})();
