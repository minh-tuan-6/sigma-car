// js/tco-view.js
// Transparent Versioned EV vs ICE/Hybrid Total Cost of Ownership (TCO) Estimator View (SIG-P3-002)

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
    if (val === null || val === undefined || !Number.isFinite(Number(val))) return 'Chưa áp dụng';
    return `${Math.round(Number(val)).toLocaleString('vi-VN')} VNĐ`;
  }

  window.SigmaTcoView = {
    async renderTcoPage(container, { vehiclesList = [], certifiedList = [], initialCarId = null, showToast } = {}) {
      if (!container) return;
      const seen = new Set();
      const allVehicles = [];
      [...vehiclesList, ...certifiedList].forEach(v => {
        if (v && v.id && !seen.has(v.id)) {
          seen.add(v.id);
          allVehicles.push(v);
        }
      });

      const primaryCar = allVehicles.find(v => v.id === initialCarId) ||
        allVehicles.find(v => v.fuel === 'ev') ||
        allVehicles[0];
      const compareCar = allVehicles.find(v => v.id !== primaryCar?.id && (primaryCar?.fuel === 'ev' ? v.fuel !== 'ev' : v.fuel === 'ev')) ||
        allVehicles.find(v => v.id !== primaryCar?.id) ||
        primaryCar;

      let state = {
        region: 'vietnam',
        carAId: primaryCar ? primaryCar.id : '',
        carBId: compareCar ? compareCar.id : '',
        monthlyKm: 1200,
        chargingLossPercent: 8,
        electricityVndPerKwh: '',
        fuelVndPerLiter: '',
        annualInsuranceVnd: 0,
        annualParkingVnd: 0,
        annualRoadFeeVnd: 1560000,
        annualDepreciationVnd: 0,
        assumptions: null
      };

      try {
        state.assumptions = await ApiClient.tco.getAssumptions(state.region);
        if (state.assumptions?.regionPreset) {
          state.electricityVndPerKwh = state.assumptions.regionPreset.electricityVndPerKwh;
          state.fuelVndPerLiter = state.assumptions.regionPreset.fuelVndPerLiter;
          state.chargingLossPercent = state.assumptions.regionPreset.chargingLossPercent;
        }
      } catch (e) {
        console.warn('[TCO] Could not load region presets:', e.message);
      }

      container.innerHTML = `
        <section class="section" style="padding-top:28px; padding-bottom:64px;">
          <div class="container">
            <div style="margin-bottom:24px;">
              <span style="display:inline-block; background:#EFF6FF; color:#1D4ED8; font-size:11.5px; font-weight:800; padding:5px 12px; border-radius:9999px; margin-bottom:8px;">
                ⚡ CHI PHÍ VẬN HÀNH & SỞ HỮU (TCO)
              </span>
              <h1 style="font-size:28px; font-weight:800; color:var(--text-dark); margin:0 0 8px;">Dự toán Chi phí Vận hành 5 năm (Xe Điện vs Xe Xăng/Hybrid)</h1>
              <p style="font-size:14px; color:var(--text-muted); max-width:780px; margin:0;">
                So sánh minh bạch tiền điện/xăng hằng tháng, chi phí bảo dưỡng định kỳ và các khoản chi cố định tùy chọn dựa trên công thức công khai từ máy chủ.
              </p>
            </div>

            <div class="tco-layout-grid">
              <!-- Controls Form -->
              <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:16px; padding:20px; box-shadow:0 4px 14px rgba(15,23,42,0.04);">
                <h3 style="font-size:16px; font-weight:800; margin:0 0 14px;">Tham số tính toán</h3>
                <div style="display:flex; flex-direction:column; gap:12px;">
                  <div>
                    <label class="filter-label" for="tco-car-a">Xe A (Chính)</label>
                    <select id="tco-car-a" class="filter-select">
                      ${allVehicles.map(v => `<option value="${esc(v.id)}" ${v.id === state.carAId ? 'selected' : ''}>${esc(v.name)} (${esc((v.fuel || '').toUpperCase() || 'N/A')} • ${esc(v.priceFormatted || '')})</option>`).join('')}
                    </select>
                  </div>
                  <div>
                    <label class="filter-label" for="tco-car-b">Xe B (Đối chiếu)</label>
                    <select id="tco-car-b" class="filter-select">
                      ${allVehicles.map(v => `<option value="${esc(v.id)}" ${v.id === state.carBId ? 'selected' : ''}>${esc(v.name)} (${esc((v.fuel || '').toUpperCase() || 'N/A')} • ${esc(v.priceFormatted || '')})</option>`).join('')}
                    </select>
                  </div>
                  <div>
                    <label class="filter-label" for="tco-region">Khu vực tham chiếu</label>
                    <select id="tco-region" class="filter-select">
                      <option value="vietnam" selected>Việt Nam (Bình quân tham chiếu)</option>
                      <option value="hanoi">Hà Nội & Miền Bắc</option>
                      <option value="hcm">TP. Hồ Chí Minh & Miền Nam</option>
                      <option value="danang">Đà Nẵng & Miền Trung</option>
                    </select>
                  </div>
                  <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <div>
                      <label class="filter-label" for="tco-km">Km/tháng</label>
                      <input type="number" id="tco-km" class="filter-select" min="0" max="50000" step="100" value="${state.monthlyKm}">
                    </div>
                    <div>
                      <label class="filter-label" for="tco-loss">Tổn hao sạc EV (%)</label>
                      <input type="number" id="tco-loss" class="filter-select" min="0" max="100" step="1" value="${state.chargingLossPercent}">
                    </div>
                  </div>
                  <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <div>
                      <label class="filter-label" for="tco-elec">Giá điện (đ/kWh)</label>
                      <input type="number" id="tco-elec" class="filter-select" min="0" max="100000" step="100" value="${state.electricityVndPerKwh}">
                    </div>
                    <div>
                      <label class="filter-label" for="tco-fuel">Giá xăng (đ/lít)</label>
                      <input type="number" id="tco-fuel" class="filter-select" min="0" max="200000" step="500" value="${state.fuelVndPerLiter}">
                    </div>
                  </div>
                  <details style="border-top:1px dashed #E2E8F0; padding-top:10px;">
                    <summary style="cursor:pointer; font-size:12.5px; font-weight:700; color:#0284C7;">+ Chi phí cố định tùy chọn (Bảo hiểm, gửi xe, đăng kiểm...)</summary>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px;">
                      <div>
                        <label class="filter-label" for="tco-ins">Bảo hiểm/năm</label>
                        <input type="number" id="tco-ins" class="filter-select" min="0" step="500000" value="${state.annualInsuranceVnd}">
                      </div>
                      <div>
                        <label class="filter-label" for="tco-park">Gửi xe/năm</label>
                        <input type="number" id="tco-park" class="filter-select" min="0" step="500000" value="${state.annualParkingVnd}">
                      </div>
                      <div>
                        <label class="filter-label" for="tco-road">Đường bộ/năm</label>
                        <input type="number" id="tco-road" class="filter-select" min="0" step="100000" value="${state.annualRoadFeeVnd}">
                      </div>
                      <div>
                        <label class="filter-label" for="tco-dep">Khấu hao/năm</label>
                        <input type="number" id="tco-dep" class="filter-select" min="0" step="1000000" value="${state.annualDepreciationVnd}">
                      </div>
                    </div>
                  </details>
                  <button type="button" id="btn-tco-calculate" class="btn-primary" style="width:100%; justify-content:center; padding:12px;">
                    🧮 Tính & Đối chiếu Chi phí
                  </button>
                </div>
              </div>

              <!-- Results Panel -->
              <div id="tco-results-mount" style="display:flex; flex-direction:column; gap:16px;">
                <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:16px; padding:24px; text-align:center; color:var(--text-muted);">
                  ⏳ Đang tính toán bảng dự toán từ máy chủ SIGMACAR...
                </div>
              </div>
            </div>
          </div>
        </section>
      `;

      const runCalculation = async () => {
        const mount = document.getElementById('tco-results-mount');
        if (!mount) return;
        const carAId = document.getElementById('tco-car-a')?.value || state.carAId;
        const carBId = document.getElementById('tco-car-b')?.value || state.carBId;
        const region = document.getElementById('tco-region')?.value || 'vietnam';
        const monthlyKm = Number(document.getElementById('tco-km')?.value || 0);
        const chargingLossPercent = Number(document.getElementById('tco-loss')?.value || 0);
        const electricityVndPerKwh = Number(document.getElementById('tco-elec')?.value || 0);
        const fuelVndPerLiter = Number(document.getElementById('tco-fuel')?.value || 0);
        const annualInsuranceVnd = Number(document.getElementById('tco-ins')?.value || 0);
        const annualParkingVnd = Number(document.getElementById('tco-park')?.value || 0);
        const annualRoadFeeVnd = Number(document.getElementById('tco-road')?.value || 0);
        const annualDepreciationVnd = Number(document.getElementById('tco-dep')?.value || 0);

        const basePayload = {
          region,
          monthlyKm,
          chargingLossPercent,
          electricityVndPerKwh,
          fuelVndPerLiter,
          annualInsuranceVnd,
          annualParkingVnd,
          annualRoadFeeVnd,
          annualDepreciationVnd
        };

        try {
          const [resA, resB] = await Promise.all([
            ApiClient.tco.estimate({ ...basePayload, vehicleId: carAId }),
            ApiClient.tco.estimate({ ...basePayload, vehicleId: carBId })
          ]);

          const delta5Y = (resB.annualTotalWithExtras - resA.annualTotalWithExtras) * 5;
          const renderCard = (label, r, badgeColor) => `
            <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:16px; padding:18px;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap;">
                <div>
                  <span style="font-size:11px; font-weight:800; color:#FFFFFF; background:${badgeColor}; padding:3px 9px; border-radius:9999px;">${label} • ${esc((r.fuelType || '').toUpperCase())}</span>
                  <h3 style="font-size:17px; font-weight:800; color:#0F172A; margin:6px 0 0;">${esc(r.vehicleName || r.vehicleId)}</h3>
                </div>
                <span style="font-size:11px; color:#64748B;">${esc(r.formulaVersion)}</span>
              </div>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:13px;">
                <div style="background:#F8FAFC; padding:10px; border-radius:10px;">
                  <div style="font-size:11px; color:#64748B;">Tiền điện / tháng</div>
                  <strong>${r.monthlyEnergy !== null ? formatVnd(r.monthlyEnergy) : 'Không áp dụng'}</strong>
                </div>
                <div style="background:#F8FAFC; padding:10px; border-radius:10px;">
                  <div style="font-size:11px; color:#64748B;">Tiền xăng / tháng</div>
                  <strong>${r.monthlyFuel !== null ? formatVnd(r.monthlyFuel) : 'Không áp dụng'}</strong>
                </div>
                <div style="background:#F8FAFC; padding:10px; border-radius:10px;">
                  <div style="font-size:11px; color:#64748B;">Bảo dưỡng / năm</div>
                  <strong>${formatVnd(r.annualMaintenance)}</strong>
                </div>
                <div style="background:#EFF6FF; padding:10px; border-radius:10px;">
                  <div style="font-size:11px; color:#1D4ED8;">Tổng vận hành / năm</div>
                  <strong style="color:#1D4ED8;">${formatVnd(r.annualOperating)}</strong>
                </div>
              </div>
              <div style="margin-top:10px; padding-top:10px; border-top:1px solid #E2E8F0; font-size:13px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:6px;">
                <span>Tổng chi phí 1 năm (gồm cố định):</span>
                <strong style="color:#0F172A;">${formatVnd(r.annualTotalWithExtras)}</strong>
              </div>
              <div style="margin-top:4px; font-size:12.5px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:6px;">
                <span>Ước tính 5 năm vận hành:</span>
                <strong style="color:#059669;">${formatVnd(r.annualTotalWithExtras * 5)}</strong>
              </div>
              ${(r.missingCatalogSpecs || []).length > 0
                ? `<div style="margin-top:8px; font-size:11.5px; color:#B45309; background:#FFFBEB; padding:6px 10px; border-radius:8px;">ℹ️ Mức tiêu thụ catalog đang thiếu (${esc(r.missingCatalogSpecs.join(', '))}); sử dụng giả định chuẩn đầu vào ${esc(r.fuelType === 'ev' ? `${r.inputsUsed.kWhPer100Km} kWh/100km` : `${r.inputsUsed.litersPer100Km} lít/100km`)}.</div>`
                : ''}
              <div style="margin-top:8px; font-size:11px; color:#475569; line-height:1.5;">
                ${(r.formulas || []).map(f => `<div>• ${esc(f)}</div>`).join('')}
              </div>
            </div>
          `;

          mount.innerHTML = `
            <div style="background:#0F172A; color:#FFFFFF; border-radius:16px; padding:16px 20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
              <div>
                <div style="font-size:11.5px; color:#38BDF8; font-weight:800;">KẾT QUẢ ĐỐI CHIẾU 5 NĂM (${Math.round(monthlyKm * 60).toLocaleString('vi-VN')} km)</div>
                <div style="font-size:16px; font-weight:800; margin-top:4px;">
                  ${delta5Y >= 0
                    ? `${esc(resA.vehicleName)} tiết kiệm hơn ~${formatVnd(delta5Y)} trong 5 năm`
                    : `${esc(resB.vehicleName)} tiết kiệm hơn ~${formatVnd(Math.abs(delta5Y))} trong 5 năm`}
                </div>
              </div>
              <span style="font-size:11.5px; background:rgba(56,189,248,0.18); color:#7DD3FC; padding:4px 10px; border-radius:9999px;">
                Dự toán tham chiếu • Giá đầu vào tự chỉnh
              </span>
            </div>
            ${renderCard('XE A', resA, '#0284C7')}
            ${renderCard('XE B', resB, '#7C3AED')}
            <div style="background:#FFFBEB; border:1px solid #FDE68A; color:#92400E; padding:12px 14px; border-radius:12px; font-size:12px; line-height:1.5;">
              <strong>⚠️ Lưu ý minh bạch nguồn số liệu:</strong> ${esc(resA.disclaimer)}<br>
              ${esc(resA.assumptionSource || '')}
            </div>
          `;
        } catch (err) {
          mount.innerHTML = `<div style="background:#FEF2F2; border:1px solid #FCA5A5; color:#991B1B; padding:16px; border-radius:12px; font-size:13px;">❌ ${esc(err.message || 'Tham số đầu vào không hợp lệ.')}</div>`;
          if (showToast) showToast(err.message || 'Lỗi tính TCO.', '❌');
        }
      };

      document.getElementById('tco-region')?.addEventListener('change', async (e) => {
        try {
          const assump = await ApiClient.tco.getAssumptions(e.target.value);
          if (assump?.regionPreset) {
            const elecEl = document.getElementById('tco-elec');
            const fuelEl = document.getElementById('tco-fuel');
            const lossEl = document.getElementById('tco-loss');
            if (elecEl) elecEl.value = assump.regionPreset.electricityVndPerKwh;
            if (fuelEl) fuelEl.value = assump.regionPreset.fuelVndPerLiter;
            if (lossEl) lossEl.value = assump.regionPreset.chargingLossPercent;
          }
        } catch (err) {}
        runCalculation();
      });

      ['tco-car-a', 'tco-car-b'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', runCalculation);
      });
      document.getElementById('btn-tco-calculate')?.addEventListener('click', runCalculation);
      await runCalculation();
    }
  };
})();
