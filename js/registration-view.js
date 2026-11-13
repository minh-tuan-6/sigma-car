// js/registration-view.js
// SIGMACAR Vehicle Registration Fee Estimator, Buyer Registration Case & Signed Document Uploader

(function () {
  function fmtVnd(n) {
    return `${Math.round(Number(n || 0)).toLocaleString('vi-VN')} VNĐ`;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Không thể đọc tệp từ máy.'));
      reader.readAsDataURL(file);
    });
  }

  async function renderEstimatorWidget(container, vehicle) {
    if (!container || !vehicle) return;
    container.innerHTML = `
      <div style="background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:14px;">
          <h4 style="margin:0; font-size:16px; font-weight:800; color:var(--text-dark);">🪪 Dự toán Thuế Trước bạ & Chi phí Lăn bánh</h4>
          <span style="font-size:11.5px; color:#059669; background:#ECFDF5; padding:3px 10px; border-radius:20px; font-weight:700;">Biểu phí tham khảo</span>
        </div>
        <div class="p1-2col-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px;">
          <div>
            <label class="filter-label">KHU VỰC ĐĂNG KÝ BIỂN SỐ</label>
            <select class="filter-select" id="reg-est-province">
              <option value="hanoi">Hà Nội (LPTB Xăng 12% / Biển 20tr)</option>
              <option value="hcm">TP. Hồ Chí Minh (LPTB Xăng 10% / Biển 20tr)</option>
              <option value="danang">Đà Nẵng / Hải Phòng / Cần Thơ</option>
              <option value="province">Tỉnh / Thành phố khác (Biển 1tr)</option>
            </select>
          </div>
          <div>
            <label class="filter-label">HÌNH THỨC ĐĂNG KÝ</label>
            <select class="filter-select" id="reg-est-mode">
              <option value="self_registration">Khách hàng tự đi đăng ký (0đ phí dịch vụ)</option>
              <option value="seller_assisted">Nhờ đại lý hỗ trợ trọn gói (+3.500.000đ)</option>
            </select>
          </div>
        </div>
        <div id="reg-est-result-box" style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:14px; font-size:13px;">Đang tính toán dự toán chi phí lăn bánh...</div>
      </div>
    `;

    const provinceSel = container.querySelector('#reg-est-province');
    const modeSel = container.querySelector('#reg-est-mode');
    const resBox = container.querySelector('#reg-est-result-box');

    const updateEstimate = async () => {
      try {
        const est = await ApiClient.registration.estimate({
          vehicleId: vehicle.id,
          vehiclePrice: vehicle.price,
          fuel: vehicle.fuel || 'ev',
          province: provinceSel.value,
          serviceMode: modeSel.value
        });
        const b = est.breakdown;
        resBox.innerHTML = `
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:8px; margin-bottom:10px;">
            <div>Lệ phí trước bạ (${Math.round(b.registrationTaxRate * 100)}%): <strong>${fmtVnd(b.registrationTax)}</strong></div>
            <div>Lệ phí cấp biển số: <strong>${fmtVnd(b.plateFee)}</strong></div>
            <div>Đăng kiểm & Đường bộ (1 năm): <strong>${fmtVnd(b.inspectionFee + b.roadMaintenanceFee)}</strong></div>
            <div>Bảo hiểm TNDS bắt buộc: <strong>${fmtVnd(b.civilInsuranceFee)}</strong></div>
            <div>Phí dịch vụ đại lý: <strong>${fmtVnd(b.serviceFee)}</strong></div>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; border-top:1px solid #E2E8F0; padding-top:10px;">
            <span style="font-weight:700; color:var(--text-dark);">Tổng chi phí lăn bánh dự kiến:</span>
            <strong style="font-size:18px; color:var(--primary);">${fmtVnd(est.estimatedOnRoadTotal)}</strong>
          </div>
          <div style="font-size:11.5px; color:var(--text-muted); margin-top:6px;">ℹ️ ${escapeHtml(est.disclaimer)}</div>
        `;
      } catch (err) {
        resBox.innerHTML = `<span style="color:#DC2626;">⚠️ ${escapeHtml(err.message)}</span>`;
      }
    };

    provinceSel.onchange = updateEstimate;
    modeSel.onchange = updateEstimate;
    await updateEstimate();
  }

  async function openOrderRegistrationModal(order, { showToast, onUpdated } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.style.zIndex = '99999';
    overlay.innerHTML = `
      <div style="background:#FFFFFF; border-radius:16px; max-width:680px; width:94vw; padding:24px; max-height:88vh; overflow:auto;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <h3 style="margin:0; font-size:18px; font-weight:800;">🪪 Hồ sơ Đăng ký & Bấm biển — ${escapeHtml(order.orderNumber || order.id)}</h3>
          <button type="button" id="btn-close-reg-modal" class="btn-secondary" style="padding:6px 12px;">✕ Đóng</button>
        </div>
        <div id="reg-modal-body" style="font-size:13.5px;">Đang tải trạng thái hồ sơ đăng ký...</div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#btn-close-reg-modal').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    const body = overlay.querySelector('#reg-modal-body');

    const loadAndRender = async () => {
      try {
        const cases = await ApiClient.registration.listCases();
        const currentCase = cases.find(c => c.orderId === order.id) || null;
        const est = currentCase?.feeBreakdown || await ApiClient.registration.estimate({
          vehicleId: order.vehicleId,
          vehiclePrice: order.unitPrice,
          province: currentCase?.province || 'hanoi',
          serviceMode: currentCase?.serviceMode || 'self_registration'
        });

        const uploadedMediaIds = currentCase?.documentMediaIds ? [...currentCase.documentMediaIds] : [];
        const REG_STATUS_LABELS = {
          draft: 'Bản nháp (Chưa nộp)',
          documents_pending: 'Chờ bổ sung hồ sơ',
          submitted: 'Đã nộp hồ sơ',
          tax_filing: 'Đang/Đã nộp thuế trước bạ',
          plate_issuance: 'Đã cấp biển số',
          completed: 'Hoàn tất đăng ký',
          cancelled: 'Đã hủy'
        };
        const canEdit = !currentCase || currentCase.status === 'draft' || currentCase.status === 'documents_pending' || currentCase.status === 'Nháp (Chưa nộp)';
        const statusDisplay = currentCase ? (REG_STATUS_LABELS[currentCase.status] || currentCase.status) : 'Chưa khởi tạo hồ sơ';

        body.innerHTML = `
          <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:14px; margin-bottom:16px;">
            <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;">
              <div>Xe: <strong>${escapeHtml(order.vehicleName)}</strong></div>
              <div>Trạng thái: <strong style="color:var(--primary);">${escapeHtml(statusDisplay)}</strong></div>
            </div>
            ${currentCase?.plateNumber ? `<div style="margin-top:6px; font-weight:800; color:#059669;">Biển số đã cấp: ${escapeHtml(currentCase.plateNumber)}</div>` : ''}
            <div style="margin-top:8px; font-size:12.5px; color:var(--text-secondary);">
              Dự toán tổng lăn bánh: <strong>${fmtVnd(est.estimatedOnRoadTotal)}</strong>
              (${escapeHtml(est.disclaimer)})
            </div>
          </div>

          <div class="p1-2col-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px;">
            <div>
              <label class="filter-label">TỈNH / THÀNH PHỐ ĐĂNG KÝ</label>
              <select class="filter-select" id="reg-case-province" ${canEdit ? '' : 'disabled'}>
                <option value="hanoi" ${est.province === 'hanoi' ? 'selected' : ''}>Hà Nội</option>
                <option value="hcm" ${est.province === 'hcm' ? 'selected' : ''}>TP. Hồ Chí Minh</option>
                <option value="danang" ${est.province === 'danang' ? 'selected' : ''}>Đà Nẵng / Hải Phòng / Cần Thơ</option>
                <option value="province" ${est.province === 'province' ? 'selected' : ''}>Tỉnh thành khác</option>
              </select>
            </div>
            <div>
              <label class="filter-label">PHƯƠNG THỨC THỰC HIỆN</label>
              <select class="filter-select" id="reg-case-mode" ${canEdit ? '' : 'disabled'}>
                <option value="self_registration" ${est.serviceMode === 'self_registration' ? 'selected' : ''}>Tự đi đăng ký (0đ phí DV)</option>
                <option value="seller_assisted" ${est.serviceMode === 'seller_assisted' ? 'selected' : ''}>Nhờ Showroom hỗ trợ bấm biển</option>
              </select>
            </div>
          </div>

          <div style="border:1px solid #E2E8F0; border-radius:10px; padding:14px; margin-bottom:16px;">
            <label class="filter-label">TÀI LIỆU ĐỊNH DANH / CCCD / HÓA ĐƠN RIÊNG TƯ (PDF/JPG/PNG)</label>
            <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
              <input type="file" id="reg-doc-file" accept=".jpg,.jpeg,.png,.webp,.pdf" ${canEdit ? '' : 'disabled'}>
              <span id="reg-upload-status" style="font-size:12px; color:var(--text-muted);">Đã đính kèm ${uploadedMediaIds.length} tệp bảo mật</span>
            </div>
          </div>

          ${canEdit ? `
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <button type="button" id="btn-save-reg-draft" class="btn-secondary" style="padding:10px 16px;">💾 Lưu nháp hồ sơ</button>
              <button type="button" id="btn-submit-reg-case" class="btn-primary" style="padding:10px 18px;">📤 Nộp hồ sơ đăng ký</button>
            </div>
          ` : ''}

          ${(currentCase?.history || []).length > 0 ? `
            <div style="margin-top:16px; border-top:1px solid #E2E8F0; padding-top:12px;">
              <strong style="font-size:13px;">Lịch sử xử lý hồ sơ:</strong>
              ${currentCase.history.map(h => `
                <div style="font-size:12px; color:var(--text-secondary); margin-top:6px;">
                  • <strong>${escapeHtml(h.status)}</strong> (${new Date(h.timestamp).toLocaleString('vi-VN')}): ${escapeHtml(h.note)}
                </div>
              `).join('')}
            </div>
          ` : ''}
        `;

        const fileInp = body.querySelector('#reg-doc-file');
        const statusTxt = body.querySelector('#reg-upload-status');
        fileInp?.addEventListener('change', async () => {
          const file = fileInp.files && fileInp.files[0];
          if (!file) return;
          statusTxt.textContent = 'Đang kiểm tra chữ ký tệp & mã hóa lưu riêng tư...';
          try {
            const b64 = await fileToBase64(file);
            const uploaded = await ApiClient.media.upload({
              fileName: file.name,
              mimeType: file.type,
              dataBase64: b64,
              purpose: 'registration_doc',
              linkedEntityId: order.id,
              branchId: order.branchId
            });
            uploadedMediaIds.push(uploaded.id);
            statusTxt.textContent = `✓ Đã tải "${uploaded.fileName}" (${uploadedMediaIds.length} tệp)`;
          } catch (err) {
            statusTxt.textContent = `⚠️ ${err.message}`;
          }
        });

        body.querySelector('#btn-save-reg-draft')?.addEventListener('click', async () => {
          try {
            await ApiClient.registration.saveCase({
              orderId: order.id,
              province: body.querySelector('#reg-case-province').value,
              serviceMode: body.querySelector('#reg-case-mode').value,
              documentMediaIds: uploadedMediaIds
            });
            if (showToast) showToast('Đã lưu hồ sơ đăng ký xe thành công!', '✓');
            await loadAndRender();
            if (onUpdated) onUpdated();
          } catch (err) {
            if (showToast) showToast(err.message, '⚠️');
          }
        });

        body.querySelector('#btn-submit-reg-case')?.addEventListener('click', async () => {
          try {
            const saved = await ApiClient.registration.saveCase({
              orderId: order.id,
              province: body.querySelector('#reg-case-province').value,
              serviceMode: body.querySelector('#reg-case-mode').value,
              documentMediaIds: uploadedMediaIds
            });
            await ApiClient.registration.submitCase(saved.id);
            if (showToast) showToast('Đã nộp hồ sơ đăng ký biển số thành công!', '🎉');
            await loadAndRender();
            if (onUpdated) onUpdated();
          } catch (err) {
            if (showToast) showToast(err.message, '⚠️');
          }
        });
      } catch (err) {
        body.innerHTML = `<div style="color:#DC2626;">⚠️ ${escapeHtml(err.message)}</div>`;
      }
    };

    await loadAndRender();
  }

  window.SigmaRegistrationView = {
    renderEstimatorWidget,
    openOrderRegistrationModal
  };
})();
