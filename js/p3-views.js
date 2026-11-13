// js/p3-views.js
// Modular P3 Views: Vehicle Compare Matrix, Live Accessories & Smart Bundles, 3D Inspection & Saved Configs

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

  function formatVnd(val) {
    if (val === null || val === undefined || !Number.isFinite(Number(val)) || Number(val) <= 0) {
      return 'Liên hệ';
    }
    return `${Math.round(Number(val)).toLocaleString('vi-VN')} VNĐ`;
  }

  window.SigmaP3Views = {
    renderComparePage(container, { AppState, openCarDetail, bookCarTestDrive, navigateTo, showToast }) {
      if (!container) return;
      const seen = new Set();
      const pool = [];
      [...(AppState.vehiclesList || []), ...(AppState.certifiedList || [])].forEach(c => {
        if (c && c.id && !seen.has(c.id)) {
          seen.add(c.id);
          pool.push(c);
        }
      });

      const rawRequested = Array.isArray(AppState.compareCars) && AppState.compareCars.length > 0
        ? AppState.compareCars
        : pool.slice(0, 3).map(c => c.id);

      const unknownIds = [];
      const uniqueResolved = [];
      const pickedIds = new Set();

      rawRequested.forEach(id => {
        const found = pool.find(c => c.id === id);
        if (!found) {
          unknownIds.push(id);
        } else if (!pickedIds.has(found.id)) {
          pickedIds.add(found.id);
          uniqueResolved.push(found);
        }
      });

      const cars = uniqueResolved.length > 0 ? uniqueResolved : pool.slice(0, 2);
      AppState.compareCars = cars.map(c => c.id);

      let onlyDiffs = false;

      const specs = [
        {
          label: 'Giá niêm yết',
          get: c => Number(c.price) > 0 ? { text: c.priceFormatted || formatVnd(c.price), norm: String(Math.round(Number(c.price))) } : { text: 'Liên hệ', norm: null }
        },
        {
          label: 'Phân loại & Nguồn',
          get: c => ({ text: `${c.isUsed ? 'Xe Cũ Certified' : 'Xe Mới'} • ${c.category || 'Chưa phân loại'}`, norm: `${c.isUsed ? 'used' : 'new'}:${c.category || ''}` })
        },
        {
          label: 'Loại động cơ',
          get: c => {
            if (!c.fuel) return { text: 'Chưa công bố', norm: null };
            const label = c.fuel === 'ev' ? 'Thuần điện (EV)' : c.fuel === 'hybrid' ? 'Hybrid' : 'Động cơ xăng';
            return { text: label, norm: c.fuel };
          }
        },
        {
          label: 'Tầm hoạt động (km)',
          get: c => Number(c.range) > 0 ? { text: `${c.range} km`, norm: String(Number(c.range)) } : { text: 'Chưa công bố', norm: null }
        },
        {
          label: 'Công suất',
          get: c => {
            if (c.power) return { text: String(c.power), norm: String(c.power).trim().toLowerCase() };
            if (Number(c.hp) > 0) return { text: `${c.hp} HP`, norm: `${Number(c.hp)}hp` };
            return { text: 'Chưa công bố', norm: null };
          }
        },
        {
          label: 'Dung lượng / Loại pin',
          get: c => c.battery ? { text: String(c.battery), norm: String(c.battery).trim().toLowerCase() } : { text: 'Chưa công bố', norm: null }
        },
        {
          label: 'Tình trạng pin đo kiểm (SoH)',
          get: c => {
            if (c.measuredBatterySoH != null) return { text: `${c.measuredBatterySoH}%`, norm: String(c.measuredBatterySoH) };
            return { text: c.isUsed ? 'Chưa đo kiểm thực tế' : 'Chưa đo kiểm (Xe mới)', norm: null };
          }
        },
        {
          label: 'Số chỗ ngồi',
          get: c => Number(c.seats) > 0 ? { text: `${c.seats} chỗ`, norm: String(Number(c.seats)) } : { text: 'Chưa công bố', norm: null }
        },
        {
          label: 'Kích thước (D × R × C)',
          get: c => c.dimensions ? { text: String(c.dimensions), norm: String(c.dimensions).trim().toLowerCase() } : { text: 'Chưa công bố', norm: null }
        },
        {
          label: 'Tồn kho thực tế',
          get: c => {
            const st = typeof c.stockQuantity === 'number' ? c.stockQuantity : (typeof c.stock === 'number' ? c.stock : null);
            return st !== null ? { text: st > 0 ? `Còn ${st} xe` : 'Hết hàng', norm: String(st) } : { text: 'Chưa công bố', norm: null };
          }
        }
      ];

      const renderContent = () => {
        const rowsHtml = specs.map(spec => {
          const cells = cars.map(c => spec.get(c));
          const nonNullNorms = cells.map(x => x.norm).filter(Boolean);
          const hasDiff = nonNullNorms.length >= 2 && new Set(nonNullNorms).size > 1;
          if (onlyDiffs && !hasDiff) return '';
          return `
            <tr style="border-bottom:1px solid #E2E8F0;">
              <td style="padding:12px 14px; font-weight:700; font-size:13px; color:#334155; background:#F8FAFC; min-width:170px;">
                ${esc(spec.label)}
                ${hasDiff ? '<span style="display:inline-block; margin-left:6px; font-size:10px; background:#DBEAFE; color:#1D4ED8; padding:1px 6px; border-radius:9999px;">Khác biệt</span>' : ''}
              </td>
              ${cells.map(cell => `
                <td class="${hasDiff && cell.norm ? 'compare-diff-cell' : ''}" style="padding:12px 14px; font-size:13px; color:${cell.norm ? '#0F172A' : '#64748B'}; min-width:180px;">
                  ${esc(cell.text)}
                </td>
              `).join('')}
            </tr>
          `;
        }).join('');

        container.innerHTML = `
          <section class="section" style="padding-top:28px; padding-bottom:64px;">
            <div class="container">
              <div class="catalog-page-hero-banner" style="background-image: linear-gradient(90deg, rgba(15,23,42,0.92) 0%, rgba(15,23,42,0.65) 60%, rgba(15,23,42,0.2) 100%), url('assets/banner-compare.jpg'); margin-bottom: 24px;">
                <span class="badge-pill" style="background:rgba(56,189,248,0.2); color:#7DD3FC; margin-bottom:8px;">SO SÁNH THÔNG SỐ THỰC TẾ</span>
                <h1 style="font-size:28px; font-weight:800; color:#FFFFFF; margin:0 0 8px;">So sánh trực tiếp Tối đa 4 Mẫu xe</h1>
                <p style="font-size:14px; color:#CBD5E1; max-width:680px; margin:0;">
                  Đối chiếu giá bán, công suất, tầm hoạt động, tồn kho và chi phí vận hành từ dữ liệu danh mục chính thức (chưa công bố ghi rõ, không tự suy diễn).
                </p>
              </div>

              ${unknownIds.length > 0 ? `
                <div style="background:#FFFBEB; border:1px solid #FDE68A; color:#92400E; padding:12px 16px; border-radius:12px; margin-bottom:16px; font-size:13px;">
                  ⚠️ Không tìm thấy mã xe <strong>${esc(unknownIds.join(', '))}</strong> trong danh mục hiện hành nên hệ thống đã bỏ qua khỏi bảng so sánh.
                </div>
              ` : ''}

              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px;">
                <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; font-weight:700; cursor:pointer; color:#0F172A;">
                  <input type="checkbox" id="chk-compare-only-diffs" ${onlyDiffs ? 'checked' : ''} style="width:16px; height:16px; accent-color:#0284C7;">
                  Chỉ hiển thị các thông số có điểm khác biệt (giữa dữ liệu đã công bố)
                </label>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                  ${cars.length < 4 && cars.length < pool.length ? `<button type="button" id="btn-p3-add-compare-slot" class="btn-secondary" style="padding:8px 14px; font-size:12.5px;">+ Thêm xe so sánh</button>` : ''}
                  ${cars[0] ? `<button type="button" class="btn-primary" style="padding:8px 14px; font-size:12.5px;" onclick="window.location.hash='tco?carId=${encodeURIComponent(cars[0].id)}'">⚡ So sánh chi phí vận hành 5 năm</button>` : ''}
                </div>
              </div>

              <div class="compare-table-scroll">
                <table>
                  <thead>
                    <tr style="border-bottom:2px solid #CBD5E1; background:#F8FAFC;">
                      <th style="padding:14px; text-align:left; font-size:12.5px; color:#475569; min-width:170px;">TIÊU CHÍ ĐỐI CHIẾU</th>
                      ${cars.map((c, idx) => `
                        <th style="padding:14px; text-align:left; vertical-align:top; min-width:190px;">
                          <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:8px;">
                            <span style="font-size:10.5px; color:#64748B; font-weight:700;">XE #${idx + 1}</span>
                            ${cars.length > 2 ? `<button type="button" class="p3-compare-remove" data-id="${esc(c.id)}" style="background:#FEE2E2; color:#B91C1C; border:none; border-radius:6px; padding:2px 8px; font-size:11px; cursor:pointer; font-weight:700;">Bỏ</button>` : ''}
                          </div>
                          <select class="filter-select p3-compare-slot-select" data-slot="${idx}" style="margin-bottom:8px; font-size:12.5px; font-weight:700;">
                            ${pool.map(opt => `<option value="${esc(opt.id)}" ${opt.id === c.id ? 'selected' : ''}>${esc(opt.name)}${opt.isUsed ? ' (CPO)' : ''}</option>`).join('')}
                          </select>
                          <img src="${esc(c.image)}" alt="${esc(c.name)}" style="width:100%; height:110px; object-fit:cover; border-radius:10px; background:#E2E8F0;" onerror="this.style.display='none'">
                        </th>
                      `).join('')}
                    </tr>
                  </thead>
                  <tbody>
                    ${rowsHtml}
                    <tr>
                      <td style="padding:14px; font-weight:700; font-size:13px; background:#F8FAFC;">Thao tác</td>
                      ${cars.map(c => `
                        <td style="padding:14px;">
                          <div style="display:flex; flex-direction:column; gap:6px;">
                            <button type="button" class="btn-primary" style="padding:7px 10px; font-size:12px; justify-content:center;" onclick="window.openCarDetail('${esc(c.id)}')">Xem chi tiết</button>
                            <button type="button" class="btn-secondary" style="padding:7px 10px; font-size:12px; justify-content:center;" onclick="window.bookCarTestDrive('${esc(c.id)}')">Đăng ký lái thử</button>
                            <button type="button" class="btn-card-outline" style="padding:6px 10px; font-size:11.5px; justify-content:center;" onclick="window.location.hash='tco?carId=${encodeURIComponent(c.id)}'">Dự toán TCO 5 năm</button>
                          </div>
                        </td>
                      `).join('')}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        `;

        document.getElementById('chk-compare-only-diffs')?.addEventListener('change', (e) => {
          onlyDiffs = !!e.target.checked;
          renderContent();
        });

        document.querySelectorAll('.p3-compare-remove').forEach(btn => {
          btn.addEventListener('click', () => {
            const remId = btn.getAttribute('data-id');
            AppState.compareCars = AppState.compareCars.filter(id => id !== remId);
            window.SigmaP3Views.renderComparePage(container, { AppState, openCarDetail, bookCarTestDrive, navigateTo, showToast });
          });
        });

        document.querySelectorAll('.p3-compare-slot-select').forEach(sel => {
          sel.addEventListener('change', (e) => {
            const slotIdx = Number(e.target.getAttribute('data-slot'));
            const nextId = e.target.value;
            if (AppState.compareCars.some((id, i) => i !== slotIdx && id === nextId)) {
              if (showToast) showToast('Xe này đã có trong bảng so sánh — không thể chọn trùng lặp.', 'ℹ️');
              e.target.value = AppState.compareCars[slotIdx];
              return;
            }
            AppState.compareCars[slotIdx] = nextId;
            window.SigmaP3Views.renderComparePage(container, { AppState, openCarDetail, bookCarTestDrive, navigateTo, showToast });
          });
        });

        document.getElementById('btn-p3-add-compare-slot')?.addEventListener('click', () => {
          const next = pool.find(v => !AppState.compareCars.includes(v.id));
          if (next && AppState.compareCars.length < 4) {
            AppState.compareCars.push(next.id);
            window.SigmaP3Views.renderComparePage(container, { AppState, openCarDetail, bookCarTestDrive, navigateTo, showToast });
          }
        });
      };

      renderContent();
    },

    async renderAccessoriesPage(container, { AppState, vehiclesList = [], showToast, navigateTo, requireAuth }) {
      if (!container) return;
      const defaultCarId = AppState.currentDetailCar || vehiclesList[0]?.id || 'tesla-cybertruck';
      const uiState = {
        vehicleId: defaultCarId,
        category: AppState.activeAccessoryCategory || 'all',
        onlyCompatible: false,
        onlyInStock: false,
        q: '',
        selectedBundleSkus: new Set(),
        bundleQtys: {},
        activeQuote: null
      };

      container.innerHTML = `
        <section class="section" style="padding-top:28px; padding-bottom:64px;">
          <div class="container">
            <div style="margin-bottom:22px;">
              <span style="display:inline-block; background:#EFF6FF; color:#1D4ED8; font-size:11.5px; font-weight:800; padding:5px 12px; border-radius:9999px; margin-bottom:8px;">
                🧩 PHỤ KIỆN CHÍNH HÃNG & GÓI COMBO TƯƠNG THÍCH
              </span>
              <h1 style="font-size:28px; font-weight:800; color:var(--text-dark); margin:0 0 8px;">Phụ kiện, Trạm sạc & Phụ tùng Chuẩn hãng</h1>
              <p style="font-size:14px; color:var(--text-muted); margin:0;">
                Kiểm tra tương thích theo từng dòng xe, tồn kho thời gian thực và báo giá gói combo ưu đãi trực tiếp từ máy chủ.
              </p>
            </div>

            <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:16px; padding:16px; margin-bottom:20px; display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:12px; align-items:end;">
              <div>
                <label class="filter-label" for="acc-vehicle-filter">Kiểm tra tương thích cho xe</label>
                <select id="acc-vehicle-filter" class="filter-select">
                  ${vehiclesList.map(v => `<option value="${esc(v.id)}" ${v.id === uiState.vehicleId ? 'selected' : ''}>${esc(v.name)} (${esc((v.fuel || '').toUpperCase())})</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="filter-label" for="acc-search-input">Tìm phụ kiện / SKU</label>
                <input type="text" id="acc-search-input" class="filter-select" placeholder="Ví dụ: Wallbox, Thảm, Camera...">
              </div>
              <div>
                <label style="display:flex; align-items:center; gap:6px; font-size:12.5px; font-weight:600; cursor:pointer;">
                  <input type="checkbox" id="acc-chk-compat"> Chỉ hiện phụ kiện tương thích xe đang chọn
                </label>
                <label style="display:flex; align-items:center; gap:6px; font-size:12.5px; font-weight:600; cursor:pointer; margin-top:6px;">
                  <input type="checkbox" id="acc-chk-stock"> Chỉ hiện còn hàng trong kho
                </label>
              </div>
              <div>
                <button type="button" id="btn-acc-refresh" class="btn-primary" style="width:100%; justify-content:center;">Lọc & Kiểm tra kho</button>
              </div>
            </div>

            <div id="acc-bundle-mount" style="margin-bottom:24px;"></div>
            <div id="acc-grid-mount" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:18px;">
              <div style="grid-column:1/-1; text-align:center; padding:32px; color:var(--text-muted);">⏳ Đang tải danh mục phụ kiện từ máy chủ...</div>
            </div>
          </div>
        </section>
      `;

      const loadAndPaint = async () => {
        const bundleMount = document.getElementById('acc-bundle-mount');
        const gridMount = document.getElementById('acc-grid-mount');
        if (!bundleMount || !gridMount) return;

        try {
          const [accData, recData] = await Promise.all([
            ApiClient.accessories.list({
              vehicleId: uiState.vehicleId,
              compatibleOnly: uiState.onlyCompatible,
              inStockOnly: uiState.onlyInStock,
              q: uiState.q
            }),
            ApiClient.bundles.recommend(uiState.vehicleId, 'family')
          ]);

          const recItems = Array.isArray(recData?.recommendedItems) ? recData.recommendedItems : [];
          if (uiState.selectedBundleSkus.size === 0) {
            recItems.slice(0, 3).forEach(r => {
              uiState.selectedBundleSkus.add(r.sku);
              uiState.bundleQtys[r.sku] = r.quantity || 1;
            });
          }

          const preview = recData?.quotePreview;
          bundleMount.innerHTML = `
            <div style="background:linear-gradient(135deg, #0F172A, #1E293B); color:#FFFFFF; border-radius:18px; padding:20px;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; margin-bottom:14px;">
                <div>
                  <span style="font-size:11px; font-weight:800; color:#38BDF8;">🎁 SMART BUNDLE BUILDER (${esc(preview?.policyVersion || 'BUNDLE-POL-2026.1')})</span>
                  <h2 style="font-size:19px; font-weight:800; margin:4px 0 4px;">Gói phụ kiện đề xuất cho ${esc(accData?.vehicle?.name || uiState.vehicleId)}</h2>
                  <p style="font-size:12.5px; color:#CBD5E1; margin:0;">Chọn tối thiểu 2 SKU tương thích để kích hoạt chiết khấu bậc thang (tối đa giảm 2.500.000đ).</p>
                </div>
                <div style="text-align:right;">
                  <div style="font-size:11px; color:#94A3B8;">Bậc ưu đãi gợi ý</div>
                  <strong style="font-size:13px; color:#4ADE80;">${esc(preview?.tierLabel || 'Theo gói đã chọn')}</strong>
                </div>
              </div>
              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:10px; margin-bottom:14px;">
                ${recItems.map(item => `
                  <label style="display:flex; align-items:flex-start; gap:10px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.16); padding:10px; border-radius:12px; cursor:pointer;">
                    <input type="checkbox" class="bnd-sku-chk" data-sku="${esc(item.sku)}" ${uiState.selectedBundleSkus.has(item.sku) ? 'checked' : ''} style="margin-top:3px; accent-color:#38BDF8;">
                    <div style="flex:1; font-size:12.5px;">
                      <div style="font-weight:700;">${esc(item.name)}</div>
                      <div style="color:#7DD3FC; font-weight:700;">${esc(item.priceFormatted || formatVnd(item.price))}</div>
                      <div style="font-size:11px; color:#94A3B8;">Tồn kho: ${Number(item.stockQuantity || 0)} • ${esc(item.fitReason || '')}</div>
                    </div>
                  </label>
                `).join('')}
              </div>
              <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
                <div id="bnd-quote-summary" style="font-size:13px; color:#E2E8F0;">
                  ${uiState.activeQuote
                    ? `Báo giá <strong>${esc(uiState.activeQuote.id)}</strong>: Tạm tính ${formatVnd(uiState.activeQuote.itemsSubtotal)} − Giảm <strong>${formatVnd(uiState.activeQuote.discountAmount)}</strong> = <strong style="color:#4ADE80; font-size:15px;">${formatVnd(uiState.activeQuote.totalAmount)}</strong>`
                    : (preview ? `Gợi ý trọn bộ (${preview.distinctSkuCount} món): ${formatVnd(preview.totalAmount)} (Tiết kiệm ${formatVnd(preview.discountAmount)})` : '')}
                </div>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                  <button type="button" id="btn-bnd-create-quote" class="btn-secondary" style="background:#1E293B; color:#FFFFFF; border-color:#38BDF8;">📋 Tính báo giá gói</button>
                  <button type="button" id="btn-bnd-add-cart" class="btn-primary" style="background:#0284C7;">🛒 Thêm cả gói vào giỏ</button>
                </div>
              </div>
            </div>
          `;

          const items = Array.isArray(accData?.items) ? accData.items : [];
          if (items.length === 0) {
            gridMount.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:32px; background:#FFFFFF; border:1px solid #E2E8F0; border-radius:16px;">Không có phụ kiện phù hợp bộ lọc hiện tại.</div>`;
          } else {
            gridMount.innerHTML = items.map(acc => {
              const inStock = Number(acc.stockQuantity || 0) > 0;
              const disabled = !inStock || !acc.compatible;
              return `
                <div style="background:#FFFFFF; border:1px solid ${acc.compatible ? '#E2E8F0' : '#FECACA'}; border-radius:16px; padding:16px; display:flex; flex-direction:column; justify-content:space-between; gap:12px;">
                  <div>
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:8px;">
                      <span style="font-size:10.5px; font-weight:800; color:#475569; background:#F1F5F9; padding:2px 8px; border-radius:9999px;">${esc(acc.sku)} • ${esc(acc.category || 'Phụ kiện')}</span>
                      <span style="font-size:11px; font-weight:700; color:${inStock ? '#059669' : '#DC2626'};">${inStock ? `Còn ${acc.stockQuantity}` : 'Hết hàng'}</span>
                    </div>
                    <h3 style="font-size:15px; font-weight:800; color:#0F172A; margin:0 0 6px;">${esc(acc.name)}</h3>
                    <div style="font-size:15px; font-weight:800; color:#0284C7; margin-bottom:8px;">${esc(acc.priceFormatted || formatVnd(acc.price))}</div>
                    <div style="font-size:11.5px; padding:6px 8px; border-radius:8px; background:${acc.compatible ? '#F0FDF4' : '#FEF2F2'}; color:${acc.compatible ? '#166534' : '#991B1B'};">
                      ${acc.compatible ? `✓ Tương thích: ${esc(acc.fitReason)}` : `✗ Không tương thích: ${esc(acc.fitReason)}`}
                    </div>
                  </div>
                  <button type="button" class="btn-primary acc-add-single-btn" data-sku="${esc(acc.sku)}" ${disabled ? 'disabled style="opacity:0.5; cursor:not-allowed; justify-content:center;"' : 'style="justify-content:center;"'}>
                    ${!acc.compatible ? 'Không tương thích với xe này' : (!inStock ? 'Tạm hết hàng' : '🛒 Thêm vào giỏ')}
                  </button>
                </div>
              `;
            }).join('');
          }

          document.querySelectorAll('.bnd-sku-chk').forEach(chk => {
            chk.addEventListener('change', (e) => {
              const sku = e.target.getAttribute('data-sku');
              if (e.target.checked) uiState.selectedBundleSkus.add(sku);
              else uiState.selectedBundleSkus.delete(sku);
              uiState.activeQuote = null;
            });
          });

          const buildBundlePayload = () => ({
            vehicleId: uiState.vehicleId,
            items: Array.from(uiState.selectedBundleSkus).map(sku => ({
              sku,
              quantity: uiState.bundleQtys[sku] || 1
            }))
          });

          document.getElementById('btn-bnd-create-quote')?.addEventListener('click', () => {
            requireAuth('tạo báo giá gói phụ kiện', async () => {
              try {
                const quote = await ApiClient.bundles.createQuote(buildBundlePayload());
                uiState.activeQuote = quote;
                const sumEl = document.getElementById('bnd-quote-summary');
                if (sumEl) {
                  sumEl.innerHTML = `Báo giá <strong>${esc(quote.id)}</strong>: Tạm tính ${formatVnd(quote.itemsSubtotal)} − Giảm <strong>${formatVnd(quote.discountAmount)}</strong> = <strong style="color:#4ADE80; font-size:15px;">${formatVnd(quote.totalAmount)}</strong>`;
                }
                if (showToast) showToast(`Đã lập báo giá gói ${quote.id} (Giảm ${formatVnd(quote.discountAmount)})!`, '📋');
              } catch (err) {
                if (showToast) showToast(err.message || 'Không thể lập báo giá gói.', '❌');
              }
            });
          });

          document.getElementById('btn-bnd-add-cart')?.addEventListener('click', () => {
            requireAuth('thêm gói phụ kiện vào giỏ hàng', async () => {
              try {
                const quote = uiState.activeQuote || await ApiClient.bundles.createQuote(buildBundlePayload());
                uiState.activeQuote = quote;
                await ApiClient.cart.addBundle(quote.id);
                if (showToast) showToast('Đã thêm trọn gói phụ kiện ưu đãi vào giỏ hàng!', '🛒');
                navigateTo('cart');
              } catch (err) {
                if (showToast) showToast(err.message || 'Lỗi thêm gói phụ kiện.', '❌');
              }
            });
          });

          document.querySelectorAll('.acc-add-single-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              const sku = btn.getAttribute('data-sku');
              const accObj = items.find(i => i.sku === sku);
              if (!accObj) return;
              if (!ApiClient.getToken()) {
                ApiClient.cart.addGuestDraftItem({
                  itemType: 'accessory',
                  itemId: accObj.id || accObj.sku,
                  sku: accObj.sku,
                  name: accObj.name,
                  unitPrice: accObj.price,
                  quantity: 1
                });
                if (showToast) showToast(`Đã lưu tạm "${accObj.name}" vào giỏ nháp.`, '🛒');
                return;
              }
              try {
                await ApiClient.cart.addItem({
                  itemType: 'accessory',
                  itemId: accObj.id || accObj.sku,
                  quantity: 1
                });
                if (showToast) showToast(`Đã thêm "${accObj.name}" vào giỏ hàng!`, '🛒');
              } catch (err) {
                if (showToast) showToast(err.message || 'Không thể thêm phụ kiện.', '❌');
              }
            });
          });
        } catch (err) {
          gridMount.innerHTML = `<div style="grid-column:1/-1; padding:20px; background:#FEF2F2; color:#991B1B; border-radius:12px;">❌ ${esc(err.message || 'Không tải được phụ kiện.')}</div>`;
        }
      };

      document.getElementById('btn-acc-refresh')?.addEventListener('click', () => {
        uiState.vehicleId = document.getElementById('acc-vehicle-filter')?.value || defaultCarId;
        uiState.q = document.getElementById('acc-search-input')?.value || '';
        uiState.onlyCompatible = !!document.getElementById('acc-chk-compat')?.checked;
        uiState.onlyInStock = !!document.getElementById('acc-chk-stock')?.checked;
        uiState.selectedBundleSkus.clear();
        uiState.activeQuote = null;
        loadAndPaint();
      });

      document.getElementById('acc-vehicle-filter')?.addEventListener('change', (e) => {
        uiState.vehicleId = e.target.value;
        uiState.selectedBundleSkus.clear();
        uiState.activeQuote = null;
        loadAndPaint();
      });

      await loadAndPaint();
    },

    mountVrP3Panel({ containerEl, viewer, car, getConfig, applySavedConfig, requireAuth, showToast }) {
      if (!containerEl || !car) return;
      const caps = (viewer && typeof viewer.getCapabilities === 'function') ? viewer.getCapabilities() : { supportsExplode: false };
      let savedConfigs = [];

      const render = () => {
        const supportsExplode = Boolean(viewer && typeof viewer.getCapabilities === 'function' && viewer.getCapabilities().supportsExplode);
        const isLoggedIn = Boolean(typeof ApiClient !== 'undefined' && ApiClient.getToken());
        containerEl.innerHTML = `
          <div style="margin-top:14px; border-top:1px solid #E2E8F0; padding-top:14px; display:flex; flex-direction:column; gap:12px;">
            <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:12px; padding:12px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <strong style="font-size:12.5px; color:#0F172A;">🔩 Bóc tách chi tiết 3D (Inspection)</strong>
                <span id="vr-explode-pct" style="font-size:11.5px; font-weight:700; color:#0284C7;">0%</span>
              </div>
              ${supportsExplode
                ? `<div style="display:flex; gap:8px; align-items:center;">
                     <input type="range" id="vr-explode-slider" min="0" max="100" value="0" style="flex:1; accent-color:#0284C7;">
                     <button type="button" id="btn-vr-explode-reset" class="btn-secondary" style="padding:4px 8px; font-size:11px;">Thu gọn</button>
                   </div>`
                : `<div id="vr-explode-unsupported-msg" style="font-size:11.5px; color:#B45309;">ℹ️ Mô hình GLB của xe này dạng 1 khối liền, không hỗ trợ bóc tách rời linh kiện.</div>`
              }
            </div>

            <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:12px; padding:12px;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:8px; flex-wrap:wrap;">
                <strong style="font-size:12.5px; color:#0F172A;">💾 Cấu hình 3D đã lưu (${savedConfigs.length})</strong>
                <button type="button" id="btn-vr-save-config" class="btn-secondary" style="padding:5px 10px; font-size:11.5px;">+ Lưu cấu hình này</button>
              </div>
              ${!isLoggedIn
                ? `<div style="font-size:11.5px; color:#64748B;">Đăng nhập để lưu và đồng bộ cấu hình cá nhân hóa lên máy chủ.</div>`
                : (savedConfigs.length === 0
                    ? `<div style="font-size:11.5px; color:#64748B;">Chưa có cấu hình nào được lưu cho tài khoản này.</div>`
                    : `<div style="display:flex; flex-direction:column; gap:6px; max-height:170px; overflow-y:auto;">
                        ${savedConfigs.slice(0, 6).map(cfg => `
                          <div style="padding:8px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; font-size:11.5px;">
                            <div style="display:flex; justify-content:space-between; gap:6px;">
                              <strong>${esc(cfg.vehicleName || cfg.vehicleId)}</strong>
                              <span style="color:${cfg.compatibilityStatus === 'valid' ? '#059669' : '#D97706'}; font-weight:700;">
                                ${cfg.compatibilityStatus === 'valid' ? '✓ Hợp lệ' : '⚠ Cần kiểm tra lại'}
                              </span>
                            </div>
                            <div style="color:#475569; margin:2px 0;">${esc(cfg.colorName)} • ${esc(cfg.wheelName)} • <strong>${formatVnd(cfg.totalPriceVnd)}</strong></div>
                            <div style="display:flex; gap:6px; margin-top:4px; flex-wrap:wrap;">
                              <button type="button" class="btn-secondary vr-load-cfg-btn" data-id="${esc(cfg.id)}" style="padding:3px 7px; font-size:11px;">Áp dụng</button>
                              <button type="button" class="btn-primary vr-cart-cfg-btn" data-id="${esc(cfg.id)}" style="padding:3px 7px; font-size:11px;">+ Giỏ hàng</button>
                              <button type="button" class="btn-card-outline vr-del-cfg-btn" data-id="${esc(cfg.id)}" style="padding:3px 7px; font-size:11px; color:#DC2626; border-color:#FCA5A5;">Xóa</button>
                            </div>
                          </div>
                        `).join('')}
                      </div>`)}
            </div>
          </div>
        `;

        const slider = document.getElementById('vr-explode-slider');
        const pctEl = document.getElementById('vr-explode-pct');
        slider?.addEventListener('input', (e) => {
          const pct = Number(e.target.value || 0);
          if (pctEl) pctEl.textContent = `${pct}%`;
          if (viewer && typeof viewer.setExploded === 'function') {
            viewer.setExploded(pct / 100);
          }
        });

        document.getElementById('btn-vr-explode-reset')?.addEventListener('click', () => {
          if (slider) slider.value = '0';
          if (pctEl) pctEl.textContent = '0%';
          if (viewer && typeof viewer.setExploded === 'function') viewer.setExploded(0);
        });

        document.getElementById('btn-vr-save-config')?.addEventListener('click', () => {
          requireAuth('lưu cấu hình xe 3D', async () => {
            try {
              const cur = getConfig();
              await ApiClient.configurations.save({
                vehicleId: car.id,
                colorIdx: cur.colorIdx || 0,
                colorName: cur.colorName,
                colorHex: cur.colorHex,
                wheelId: cur.wheelId,
                trimName: cur.trimName || undefined
              });
              savedConfigs = await ApiClient.configurations.list();
              render();
              if (showToast) showToast('Đã lưu cấu hình 3D cá nhân lên máy chủ!', '💾');
            } catch (err) {
              if (showToast) showToast(err.message || 'Không lưu được cấu hình.', '❌');
            }
          });
        });

        document.querySelectorAll('.vr-load-cfg-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const cfg = savedConfigs.find(c => c.id === btn.getAttribute('data-id'));
            if (cfg && typeof applySavedConfig === 'function') applySavedConfig(cfg);
          });
        });

        document.querySelectorAll('.vr-cart-cfg-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const cfg = savedConfigs.find(c => c.id === btn.getAttribute('data-id'));
            if (!cfg) return;
            try {
              await ApiClient.cart.addItem({
                itemType: 'vehicle',
                itemId: cfg.vehicleId,
                colorName: cfg.colorName,
                trimName: cfg.trimName || null,
                wheelId: cfg.wheelId || null,
                quantity: 1
              });
              if (showToast) showToast('Đã thêm cấu hình xe vào giỏ hàng!', '🛒');
            } catch (err) {
              if (showToast) showToast(err.message || 'Lỗi thêm vào giỏ.', '❌');
            }
          });
        });

        document.querySelectorAll('.vr-del-cfg-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            try {
              await ApiClient.configurations.remove(btn.getAttribute('data-id'));
              savedConfigs = await ApiClient.configurations.list();
              render();
              if (showToast) showToast('Đã xóa cấu hình đã lưu.', '🗑️');
            } catch (err) {
              if (showToast) showToast(err.message || 'Không xóa được cấu hình.', '❌');
            }
          });
        });
      };

      const refreshList = async () => {
        if (typeof ApiClient !== 'undefined' && ApiClient.getToken()) {
          try {
            savedConfigs = await ApiClient.configurations.list();
          } catch (e) {}
        }
        render();
      };

      refreshList();
      return { refreshCapabilities: render };
    }
  };
})();
