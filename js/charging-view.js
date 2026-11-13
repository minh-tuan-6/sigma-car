// js/charging-view.js
// EV Charging Discovery Page (SIG-P4-009): Manual filters, opt-in GPS geolocation,
// honest tariff disclosure (unknown = "Chưa công bố đơn giá"), stale-data / outage UI.

(function () {
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const ChargingViewState = {
    province: 'all',
    connectorType: 'all',
    minPowerKw: '',
    q: '',
    lat: null,
    lng: null,
    locationLabel: 'Chưa bật định vị GPS (lọc theo tỉnh/từ khóa)',
    loading: false
  };

  function getProvinceOptions() {
    return [
      { id: 'all', label: 'Tất cả tỉnh / thành phố' },
      { id: 'Hà Nội', label: 'Hà Nội' },
      { id: 'TP. Hồ Chí Minh', label: 'TP. Hồ Chí Minh' },
      { id: 'Đà Nẵng', label: 'Đà Nẵng' },
      { id: 'Hải Phòng', label: 'Hải Phòng' },
      { id: 'Khánh Hòa', label: 'Khánh Hòa' }
    ];
  }

  function renderStationCard(st) {
    const connectorChips = (st.connectors || []).map(c => {
      const ports = c.portsCount ?? c.portsTotal;
      return `<span style="display:inline-flex; align-items:center; gap:4px; background:#F1F5F9; color:#0F172A; border:1px solid #CBD5E1; border-radius:999px; padding:3px 9px; font-size:11.5px; font-weight:700;">⚡ ${esc(c.type)} • ${Number(c.powerKw || 0)} kW${ports ? ` (${ports} cổng)` : ''}</span>`;
    }).join(' ');

    const tariffBadge = st.tariffKnown
      ? `<span style="font-size:14px; font-weight:800; color:#047857;">${esc(st.tariffDisplay)}</span>`
      : `<span style="font-size:13px; font-weight:700; color:#B45309; background:#FEF3C7; padding:3px 8px; border-radius:6px;">${esc(st.tariffDisplay || 'Chưa công bố đơn giá')}</span>`;

    const updatedLabel = st.dataUpdatedAt
      ? `Cập nhật: ${new Date(st.dataUpdatedAt).toLocaleDateString('vi-VN')}`
      : 'Cập nhật theo danh mục';

    const distHtml = typeof st.distanceKm === 'number'
      ? `<span style="font-size:12px; font-weight:800; color:#1D4ED8; background:#DBEAFE; padding:3px 9px; border-radius:999px;">📍 ~${st.distanceKm.toFixed(1)} km</span>`
      : '';

    return `
      <article style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:16px; padding:18px; display:flex; flex-direction:column; gap:12px; box-shadow:0 4px 14px rgba(15,23,42,0.04);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap;">
          <div>
            <span style="font-size:11px; font-weight:800; color:#2563EB; text-transform:uppercase; letter-spacing:0.04em;">${esc(st.providerName || 'Mạng lưới Trạm sạc')}</span>
            <h3 style="margin:3px 0 0; font-size:16.5px; font-weight:800; color:#0F172A;">${esc(st.name)}</h3>
          </div>
          ${distHtml}
        </div>

        <div style="font-size:13px; color:#475569; line-height:1.5;">
          📍 ${esc(st.address)}${st.district ? `, ${esc(st.district)}` : ''}, <strong>${esc(st.province)}</strong>
        </div>

        <div style="display:flex; flex-wrap:wrap; gap:6px;">${connectorChips}</div>

        <div style="padding:10px 12px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <div style="font-size:11px; color:#64748B; font-weight:600;">Đơn giá điện công bố</div>
            ${tariffBadge}
          </div>
          <div style="text-align:right; font-size:11.5px; color:#64748B;">
            <div>🕒 ${esc(st.openHours || '24/7')}</div>
            <div>${esc(updatedLabel)}</div>
          </div>
        </div>

        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:auto; padding-top:4px;">
          <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${st.lat},${st.lng}`)}" target="_blank" rel="noopener noreferrer" class="btn-secondary" style="flex:1; min-width:130px; text-align:center; padding:8px 12px; font-size:12.5px; text-decoration:none;">
            🗺️ Chỉ đường Map
          </a>
          <button type="button" class="btn-primary btn-charging-to-tco" data-tariff="${st.tariffKnown ? st.tariffVndPerKwh : ''}" data-name="${esc(st.name)}" style="flex:1; min-width:130px; justify-content:center; padding:8px 12px; font-size:12.5px;">
            📊 Tính TCO với trạm này
          </button>
        </div>
      </article>
    `;
  }

  async function renderChargingPage(container) {
    if (!container) return;

    container.innerHTML = `
      <section class="container" style="padding:36px 16px 64px; max-width:1180px;">
        <div style="background:linear-gradient(120deg, #0F172A 0%, #1E3A8A 100%); color:#FFFFFF; border-radius:20px; padding:28px; margin-bottom:24px;">
          <span style="display:inline-block; background:rgba(56,189,248,0.18); color:#7DD3FC; padding:4px 12px; border-radius:999px; font-size:11.5px; font-weight:800; letter-spacing:0.06em;">MẠNG LƯỚI SẠC XE ĐIỆN VIỆT NAM</span>
          <h1 style="font-size:28px; font-weight:800; margin:10px 0 6px;">Tra cứu Trạm sạc Xe điện (Charging Discovery)</h1>
          <p style="margin:0; font-size:14.5px; color:#CBD5E1; max-width:740px;">
            Tìm điểm sạc CCS2 / Type 2 / GB/T theo tỉnh thành, công suất kW hoặc vị trí gần bạn (chỉ dùng GPS khi bạn đồng ý). Dữ liệu hiển thị trung thực đơn giá & mốc cập nhật — không tự tạo số cổng trống thời gian thực nếu chưa có OCPP live.
          </p>
        </div>

        <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:16px; padding:18px; margin-bottom:20px; display:grid; grid-template-columns:repeat(auto-fit, minmax(min(180px, 100%), 1fr)); gap:12px; align-items:end;">
          <div>
            <label class="filter-label">Tỉnh / Thành phố</label>
            <select id="chg-filter-province" class="filter-select">
              ${getProvinceOptions().map(p => `<option value="${esc(p.id)}" ${ChargingViewState.province === p.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="filter-label">Chuẩn đầu sạc</label>
            <select id="chg-filter-connector" class="filter-select">
              <option value="all" ${ChargingViewState.connectorType === 'all' ? 'selected' : ''}>Tất cả chuẩn sạc</option>
              <option value="CCS2" ${ChargingViewState.connectorType === 'CCS2' ? 'selected' : ''}>CCS2 (DC Nhanh)</option>
              <option value="Type 2" ${ChargingViewState.connectorType === 'Type 2' ? 'selected' : ''}>Type 2 (AC)</option>
              <option value="GB/T" ${ChargingViewState.connectorType === 'GB/T' ? 'selected' : ''}>GB/T</option>
            </select>
          </div>
          <div>
            <label class="filter-label">Công suất tối thiểu</label>
            <select id="chg-filter-power" class="filter-select">
              <option value="" ${!ChargingViewState.minPowerKw ? 'selected' : ''}>Mọi công suất</option>
              <option value="60" ${ChargingViewState.minPowerKw === '60' ? 'selected' : ''}>Từ 60 kW trở lên</option>
              <option value="120" ${ChargingViewState.minPowerKw === '120' ? 'selected' : ''}>Siêu nhanh từ 120 kW</option>
              <option value="250" ${ChargingViewState.minPowerKw === '250' ? 'selected' : ''}>Siêu trụ 250+ kW</option>
            </select>
          </div>
          <div>
            <label class="filter-label">Từ khóa tên trạm / quận</label>
            <input type="text" id="chg-filter-q" class="filter-input" value="${esc(ChargingViewState.q)}" placeholder="VD: Quận 7, Cầu Giấy, V-Green">
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" id="btn-chg-apply" class="btn-primary" style="flex:1; justify-content:center; padding:10px 14px;">🔍 Lọc trạm</button>
            <button type="button" id="btn-chg-geo" class="btn-secondary" style="padding:10px 12px;" title="Định vị vị trí hiện tại (cần sự cho phép của trình duyệt)">📍 Gần tôi</button>
          </div>
        </div>

        <div id="chg-status-banner" style="margin-bottom:16px;"></div>
        <div id="chg-results-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap:18px;">
          <div style="grid-column:1/-1; padding:36px; text-align:center; color:#64748B;">Đang tải dữ liệu trạm sạc từ hệ thống...</div>
        </div>
      </section>
    `;

    async function fetchAndRender() {
      const grid = document.getElementById('chg-results-grid');
      const banner = document.getElementById('chg-status-banner');
      if (!grid || !banner) return;

      try {
        const res = await window.ApiClient.charging.findStations({
          province: ChargingViewState.province,
          connectorType: ChargingViewState.connectorType,
          minPowerKw: ChargingViewState.minPowerKw,
          q: ChargingViewState.q,
          lat: ChargingViewState.lat,
          lng: ChargingViewState.lng
        });

        const stations = res.stations || [];
        const meta = res.cacheMeta || res.metadata || {};
        const isStale = Boolean(meta.isStale ?? meta.stale);
        const staleMsg = meta.staleWarning || meta.freshnessDisclaimer || 'nguồn ngoài tạm gián đoạn';
        const availabilityNote = meta.freshnessDisclaimer || meta.liveAvailabilityNote || 'Không hiển thị số cổng trống thời gian thực nếu chưa có OCPP telemetry';

        banner.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; background:${isStale ? '#FFFBEB' : '#F8FAFC'}; border:1px solid ${isStale ? '#FDE68A' : '#E2E8F0'}; border-radius:12px; padding:12px 16px; font-size:12.5px; color:#334155;">
            <div>
              <strong>Tìm thấy ${stations.length} trạm sạc phù hợp</strong> • ${esc(ChargingViewState.locationLabel)}
              ${isStale ? `<span style="margin-left:8px; color:#B45309; font-weight:700;">⚠️ Đang dùng dữ liệu bộ nhớ đệm (${esc(staleMsg)})</span>` : ''}
            </div>
            <div style="color:#64748B;">
              ${esc(availabilityNote)}
            </div>
          </div>
        `;

        if (stations.length === 0) {
          grid.innerHTML = `
            <div style="grid-column:1/-1; background:#F8FAFC; border:1px dashed #CBD5E1; border-radius:16px; padding:42px 20px; text-align:center;">
              <div style="font-size:38px; margin-bottom:10px;">🔌</div>
              <h3 style="margin:0 0 6px; font-size:18px; color:#0F172A;">Không tìm thấy trạm sạc khớp bộ lọc</h3>
              <p style="margin:0 0 14px; font-size:13.5px; color:#64748B;">Hãy thử giảm ngưỡng công suất tối thiểu hoặc chọn "Tất cả tỉnh / thành phố".</p>
              <button type="button" id="btn-chg-reset" class="btn-secondary">↺ Đặt lại bộ lọc trạm sạc</button>
            </div>
          `;
          document.getElementById('btn-chg-reset')?.addEventListener('click', () => {
            ChargingViewState.province = 'all';
            ChargingViewState.connectorType = 'all';
            ChargingViewState.minPowerKw = '';
            ChargingViewState.q = '';
            ChargingViewState.lat = null;
            ChargingViewState.lng = null;
            ChargingViewState.locationLabel = 'Chưa bật định vị GPS (lọc theo tỉnh/từ khóa)';
            renderChargingPage(container);
          });
          return;
        }

        grid.innerHTML = stations.map(renderStationCard).join('');

        grid.querySelectorAll('.btn-charging-to-tco').forEach(btn => {
          btn.addEventListener('click', () => {
            const tariff = btn.getAttribute('data-tariff');
            if (tariff) {
              try { localStorage.setItem('sigmacar_tco_preferred_tariff', tariff); } catch (_) {}
              if (typeof window.showToast === 'function') {
                window.showToast(`Đã lưu đơn giá sạc ${Number(tariff).toLocaleString('vi-VN')} đ/kWh để tính TCO!`, '⚡');
              }
            } else if (typeof window.showToast === 'function') {
              window.showToast('Trạm này chưa công bố đơn giá kWh — TCO sẽ dùng mức giá điện mặc định theo khu vực.', 'ℹ️');
            }
            window.location.hash = 'tco';
          });
        });
      } catch (err) {
        banner.innerHTML = `
          <div style="background:#FEF2F2; border:1px solid #FECACA; border-radius:12px; padding:12px 16px; color:#991B1B; font-size:13px;">
            ⚠️ Không thể tải danh sách trạm sạc: ${esc(err.message || 'Nguồn dữ liệu tạm thời gián đoạn.')}
          </div>
        `;
        grid.innerHTML = '';
      }
    }

    document.getElementById('btn-chg-apply')?.addEventListener('click', () => {
      ChargingViewState.province = document.getElementById('chg-filter-province')?.value || 'all';
      ChargingViewState.connectorType = document.getElementById('chg-filter-connector')?.value || 'all';
      ChargingViewState.minPowerKw = document.getElementById('chg-filter-power')?.value || '';
      ChargingViewState.q = (document.getElementById('chg-filter-q')?.value || '').trim();
      fetchAndRender();
    });

    document.getElementById('btn-chg-geo')?.addEventListener('click', () => {
      if (!navigator.geolocation) {
        ChargingViewState.locationLabel = 'Trình duyệt không hỗ trợ định vị GPS — vui lòng lọc theo tỉnh thành';
        fetchAndRender();
        return;
      }
      ChargingViewState.locationLabel = 'Đang xin quyền định vị trình duyệt...';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          ChargingViewState.lat = Number(pos.coords.latitude.toFixed(5));
          ChargingViewState.lng = Number(pos.coords.longitude.toFixed(5));
          ChargingViewState.province = 'all';
          const provSel = document.getElementById('chg-filter-province');
          if (provSel) provSel.value = 'all';
          ChargingViewState.locationLabel = `Sắp xếp gần tọa độ (${ChargingViewState.lat}, ${ChargingViewState.lng})`;
          fetchAndRender();
        },
        () => {
          ChargingViewState.lat = null;
          ChargingViewState.lng = null;
          ChargingViewState.locationLabel = 'Bạn đã từ chối quyền định vị — đang hiển thị theo bộ lọc thủ công';
          fetchAndRender();
        },
        { enableHighAccuracy: false, timeout: 6000, maximumAge: 60000 }
      );
    });

    await fetchAndRender();
  }

  window.SigmaChargingView = {
    renderChargingPage
  };
})();
