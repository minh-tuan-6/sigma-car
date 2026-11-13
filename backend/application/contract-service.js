// backend/application/contract-service.js
// Immutable Versioned E-Contracts & Verifiable Buyer Acknowledgment

const crypto = require('crypto');
const { runInTransaction, dbState } = require('../infrastructure/storage-engine');
const Security = require('../infrastructure/security');
const Authorization = require('../domain/authorization');
const PolicyService = require('./policy-service');
const NotificationService = require('./notification-service');
const { ROLES } = require('../domain/constants');

function createError(message, statusCode, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function buildPrintableHtml(contract) {
  return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"><title>${Security.escapeHtml(contract.contractCode)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:780px;margin:24px auto;padding:24px;border:1px solid #cbd5e1;border-radius:12px;">
  <h2 style="margin:0 0 8px;">HỢP ĐỒNG ĐẶT CỌC & MUA BÁN XE SIGMACAR (${Security.escapeHtml(contract.contractCode)} — v${contract.version})</h2>
  <p style="color:#475569;font-size:13px;">Chính sách áp dụng: ${Security.escapeHtml(contract.policyTitle)} (${Security.escapeHtml(contract.policyVersion)})</p>
  <hr>
  <p><strong>Đơn hàng:</strong> ${Security.escapeHtml(contract.orderNumber)} | <strong>Mẫu xe:</strong> ${Security.escapeHtml(contract.vehicleName)}</p>
  <p><strong>Bên mua:</strong> ${Security.escapeHtml(contract.buyerName)} (${Security.escapeHtml(contract.buyerPhone || '')})</p>
  <p><strong>Showroom thụ lý:</strong> ${Security.escapeHtml(contract.branchName || '')}</p>
  <p><strong>Giá trị xe:</strong> ${Number(contract.unitPrice || 0).toLocaleString('vi-VN')} VNĐ</p>
  <p><strong>Điều khoản chính:</strong> ${Security.escapeHtml(contract.termsSummary)}</p>
  <p style="font-family:monospace;font-size:12px;color:#334155;">SHA-256 Terms Digest: ${Security.escapeHtml(contract.termsHash)}</p>
  <p><strong>Trạng thái xác nhận:</strong> ${contract.acknowledgedAt ? `Đã xác nhận bởi ${Security.escapeHtml(contract.signerName)} lúc ${contract.acknowledgedAt}` : 'Chờ bên mua xác nhận'}</p>
</body></html>`;
}

const ContractService = {
  async generateForOrder(user, orderId, { revisionNote = '' } = {}) {
    if (!user || !user.userId) {
      throw createError('Vui lòng đăng nhập.', 401, 'UNAUTHORIZED');
    }

    return runInTransaction(async (state) => {
      if (!Array.isArray(state.contracts)) state.contracts = [];
      const order = state.orders.find(o => o.id === orderId || o.orderNumber === orderId);
      if (!order) throw createError('Không tìm thấy đơn hàng.', 404, 'ORDER_NOT_FOUND');

      if (!Authorization.canReadOrder(user, order)) {
        throw createError('Bạn không có quyền truy cập hợp đồng cho đơn hàng này.', 403, 'FORBIDDEN');
      }
      if (user.role === ROLES.BUYER && state.contracts.some(c => c.orderId === order.id)) {
        // Buyer reads latest instead of minting arbitrary revision
        return state.contracts.find(c => c.orderId === order.id);
      }

      const policy = PolicyService.getActivePolicy('order_terms');
      const existingForOrder = state.contracts.filter(c => c.orderId === order.id);
      const nextVersion = existingForOrder.length > 0
        ? Math.max(...existingForOrder.map(c => c.version || 1)) + 1
        : 1;

      const termsSummary = policy.rules?.refundConditions || policy.title;
      const snapshotPayload = {
        orderId: order.id,
        version: nextVersion,
        vehicleId: order.vehicleId,
        vehicleName: order.vehicleName,
        unitPrice: order.unitPrice,
        depositAmount: order.depositAmount,
        policyVersion: policy.version,
        termsSummary,
        revisionNote: Security.sanitizeString(revisionNote || '')
      };
      const termsHash = crypto.createHash('sha256').update(JSON.stringify(snapshotPayload)).digest('hex');

      const nowIso = new Date().toISOString();
      const contract = {
        id: `CNT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        contractCode: `HDMB-${order.orderNumber || order.id}-V${nextVersion}`,
        version: nextVersion,
        orderId: order.id,
        orderNumber: order.orderNumber || order.id,
        userId: order.userId,
        branchId: order.branchId,
        branchName: order.branchName,
        buyerName: order.buyerName,
        buyerPhone: order.buyerPhone,
        vehicleId: order.vehicleId,
        vehicleName: order.vehicleName,
        unitPrice: order.unitPrice,
        policyVersion: policy.version,
        policyTitle: policy.title,
        termsSummary,
        termsHash,
        status: 'Pending_Acknowledgment',
        locked: false,
        acknowledgedAt: null,
        signerName: null,
        signerIdLast4: null,
        createdBy: user.userId,
        createdAt: nowIso
      };

      state.contracts.unshift(contract);
      return contract;
    });
  },

  async acknowledgeContract(user, contractId, { acceptedTerms, signerName, signerIdLast4 = '' } = {}) {
    if (!user || !user.userId) {
      throw createError('Vui lòng đăng nhập để xác nhận hợp đồng.', 401, 'UNAUTHORIZED');
    }
    if (acceptedTerms !== true) {
      throw createError('Vui lòng tích đồng ý toàn bộ điều khoản hợp đồng điện tử.', 422, 'ACCEPTANCE_REQUIRED');
    }
    if (!signerName || String(signerName).trim().length < 2) {
      throw createError('Vui lòng nhập đầy đủ họ tên người ký xác nhận.', 422, 'SIGNER_NAME_REQUIRED');
    }

    return runInTransaction(async (state) => {
      const contract = (state.contracts || []).find(c => c.id === contractId || c.contractCode === contractId);
      if (!contract) throw createError('Không tìm thấy hợp đồng.', 404, 'NOT_FOUND');

      if (contract.userId !== user.userId) {
        throw createError('Chỉ chủ đơn hàng mới có quyền xác nhận hợp đồng điện tử này.', 403, 'FORBIDDEN');
      }
      if (contract.locked || contract.acknowledgedAt) {
        throw createError(`Hợp đồng ${contract.contractCode} đã được xác nhận và khóa không thể sửa đổi.`, 409, 'CONTRACT_LOCKED');
      }

      const nowIso = new Date().toISOString();
      contract.status = 'Acknowledged';
      contract.locked = true;
      contract.acknowledgedAt = nowIso;
      contract.acknowledgedBy = user.userId;
      contract.signerName = Security.sanitizeString(signerName);
      contract.signerIdLast4 = signerIdLast4 ? Security.sanitizeString(String(signerIdLast4).slice(-4)) : null;

      PolicyService.recordConsentInState(state, {
        userId: user.userId,
        policyId: null,
        policyType: 'contract_acknowledgment',
        policyVersion: contract.policyVersion,
        targetId: contract.id,
        action: `acknowledged:${contract.termsHash}`
      });

      NotificationService.enqueueOutboxInState(state, {
        eventType: 'contract_acknowledged',
        aggregateType: 'contract',
        aggregateId: contract.id,
        userId: user.userId,
        templateId: 'contract_acknowledged',
        payload: {
          contractCode: contract.contractCode,
          version: contract.version,
          orderId: contract.orderNumber
        },
        dedupeKey: `contract_ack:${contract.id}`
      });

      return contract;
    });
  },

  listForUser(user, orderId = null) {
    let list = dbState.contracts || [];
    if (!user) return [];
    if (orderId) list = list.filter(c => c.orderId === orderId || c.orderNumber === orderId);
    if (user.role === ROLES.ADMIN) return [...list];
    if (Authorization.isStaffRole(user.role)) return list.filter(c => Authorization.hasBranchAccess(user, c.branchId));
    return list.filter(c => c.userId === user.userId);
  },

  getContractDocument(user, contractId) {
    const contract = (dbState.contracts || []).find(c => c.id === contractId || c.contractCode === contractId);
    if (!contract) throw createError('Không tìm thấy hợp đồng.', 404, 'NOT_FOUND');

    const allowed = user && (
      contract.userId === user.userId ||
      user.role === ROLES.ADMIN ||
      (Authorization.isStaffRole(user.role) && Authorization.hasBranchAccess(user, contract.branchId))
    );
    if (!allowed) throw createError('Bạn không có quyền xem hoặc tải hợp đồng này.', 403, 'FORBIDDEN');

    return {
      contract,
      html: buildPrintableHtml(contract)
    };
  }
};

module.exports = ContractService;
