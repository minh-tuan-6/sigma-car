// backend/application/media-service.js
// Private Media Upload, Signed Expiring URLs, ACL Enforcement & Retention Purge

const crypto = require('crypto');
const config = require('../config');
const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const MediaStorage = require('../infrastructure/media-storage');
const Security = require('../infrastructure/security');
const Authorization = require('../domain/authorization');
const { ROLES } = require('../domain/constants');

function signMediaUrlToken(mediaId, expMs) {
  return crypto
    .createHmac('sha256', config.jwtSecret)
    .update(`${mediaId}:${expMs}`)
    .digest('hex');
}

function buildSignedPath(mediaId, ttlMs = 15 * 60 * 1000) {
  const exp = Date.now() + ttlMs;
  const sig = signMediaUrlToken(mediaId, exp);
  return {
    signedUrl: `/api/v1/media/${encodeURIComponent(mediaId)}?exp=${exp}&token=${sig}`,
    exp,
    token: sig
  };
}

const MediaService = {
  signMediaUrlToken,
  buildSignedPath,

  async uploadPrivateMedia(user, { fileName, mimeType, dataBase64, purpose = 'evidence', linkedEntityId = null, branchId = null, retentionDays = 365 } = {}) {
    if (!user || !user.userId) {
      const err = new Error('Vui lòng đăng nhập để tải tài liệu riêng tư.');
      err.statusCode = 401;
      err.code = 'UNAUTHORIZED';
      throw err;
    }

    const prepared = MediaStorage.inspectAndPrepare({ fileName, dataBase64, declaredMimeType: mimeType });
    const mediaId = `MED-${crypto.randomUUID().slice(0, 10)}`;
    const storageKey = `${mediaId}${prepared.ext}`;
    await MediaStorage.writeBlob(storageKey, prepared.buffer);

    const nowMs = Date.now();
    const safeRetention = Math.min(3650, Math.max(1, Number(retentionDays || 365)));
    const expiresAt = new Date(nowMs + safeRetention * 86400000).toISOString();

    const assetRecord = await runInTransaction(async (state) => {
      if (!Array.isArray(state.mediaAssets)) state.mediaAssets = [];
      const record = {
        id: mediaId,
        ownerId: user.userId,
        branchId: branchId || user.branchId || null,
        purpose: Security.sanitizeString(purpose),
        linkedEntityId: linkedEntityId ? Security.sanitizeString(linkedEntityId) : null,
        fileName: prepared.fileName,
        mimeType: prepared.mimeType,
        sizeBytes: prepared.sizeBytes,
        checksum: prepared.checksum,
        storageKey,
        scanStatus: prepared.scanStatus,
        quarantineReason: prepared.quarantineReason,
        isPrivate: true,
        expiresAt,
        deletedAt: null,
        createdAt: new Date(nowMs).toISOString()
      };
      state.mediaAssets.push(record);
      return record;
    });

    if (assetRecord.scanStatus === 'quarantined') {
      return {
        ...assetRecord,
        signedUrl: null,
        rejected: true,
        message: assetRecord.quarantineReason
      };
    }

    const signed = buildSignedPath(assetRecord.id);
    return {
      ...assetRecord,
      ...signed
    };
  },

  async getAuthorizedMedia(mediaId, { user = null, token = null, exp = null } = {}) {
    const asset = (dbState.mediaAssets || []).find(m => m.id === mediaId && !m.deletedAt);
    if (!asset) {
      const err = new Error('Không tìm thấy tài liệu hoặc tài liệu đã bị xóa.');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (asset.scanStatus === 'quarantined') {
      const err = new Error('Tệp đang bị cách ly bảo mật và không thể truy cập.');
      err.statusCode = 403;
      err.code = 'MEDIA_QUARANTINED';
      throw err;
    }

    if (asset.expiresAt && new Date(asset.expiresAt).getTime() < Date.now()) {
      const err = new Error('Tài liệu đã hết thời hạn lưu trữ.');
      err.statusCode = 410;
      err.code = 'MEDIA_EXPIRED';
      throw err;
    }

    let authorized = false;
    if (token && exp) {
      const expMs = Number(exp);
      if (!Number.isFinite(expMs) || expMs < Date.now()) {
        const err = new Error('Liên kết truy cập tài liệu đã hết hạn. Vui lòng lấy liên kết mới.');
        err.statusCode = 401;
        err.code = 'SIGNED_URL_EXPIRED';
        throw err;
      }
      const expectedSig = signMediaUrlToken(asset.id, expMs);
      const tokenBuf = Buffer.from(String(token), 'utf8');
      const expectedBuf = Buffer.from(expectedSig, 'utf8');
      if (tokenBuf.length === expectedBuf.length && crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
        authorized = true;
      }
    }

    if (!authorized && user) {
      if (asset.ownerId === user.userId || user.role === ROLES.ADMIN) {
        authorized = true;
      } else if (Authorization.isStaffRole(user.role) && asset.branchId && Authorization.hasBranchAccess(user, asset.branchId)) {
        authorized = true;
      }
    }

    if (!authorized) {
      const err = new Error('Bạn không có quyền truy cập tài liệu riêng tư này.');
      err.statusCode = user ? 403 : 401;
      err.code = user ? 'FORBIDDEN' : 'UNAUTHORIZED';
      throw err;
    }

    const buffer = await MediaStorage.readBlob(asset.storageKey);
    if (!buffer) {
      const err = new Error('Dữ liệu nhị phân của tệp không tồn tại trên hệ thống lưu trữ.');
      err.statusCode = 404;
      err.code = 'BLOB_NOT_FOUND';
      throw err;
    }

    return {
      asset,
      buffer
    };
  },

  getSignedUrlForAsset(user, mediaId) {
    const asset = (dbState.mediaAssets || []).find(m => m.id === mediaId && !m.deletedAt);
    if (!asset) {
      const err = new Error('Không tìm thấy tài liệu.');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }
    const canRead = asset.ownerId === user.userId ||
      user.role === ROLES.ADMIN ||
      (Authorization.isStaffRole(user.role) && asset.branchId && Authorization.hasBranchAccess(user, asset.branchId));
    if (!canRead) {
      const err = new Error('Bạn không có quyền tạo liên kết cho tài liệu này.');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }
    if (asset.scanStatus === 'quarantined') {
      const err = new Error('Tệp đang bị cách ly bảo mật.');
      err.statusCode = 403;
      err.code = 'MEDIA_QUARANTINED';
      throw err;
    }
    return { mediaId: asset.id, ...buildSignedPath(asset.id) };
  },

  async deleteMedia(user, mediaId) {
    const deletedAsset = await runInTransaction(async (state) => {
      const asset = (state.mediaAssets || []).find(m => m.id === mediaId && !m.deletedAt);
      if (!asset) {
        const err = new Error('Không tìm thấy tài liệu để xóa.');
        err.statusCode = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }
      if (asset.ownerId !== user.userId && user.role !== ROLES.ADMIN) {
        const err = new Error('Chỉ chủ sở hữu hoặc quản trị viên mới có thể xóa tài liệu này.');
        err.statusCode = 403;
        err.code = 'FORBIDDEN';
        throw err;
      }
      asset.deletedAt = new Date().toISOString();
      asset.deletedBy = user.userId;
      if (!Array.isArray(state.auditLogs)) state.auditLogs = [];
      state.auditLogs.unshift({
        id: `AUD-${crypto.randomUUID().slice(0, 8)}`,
        action: 'MEDIA_DELETED',
        actorId: user.userId,
        actorName: user.fullName || user.email,
        targetId: asset.id,
        detail: `Xóa tài liệu riêng tư ${asset.fileName} (${asset.purpose})`,
        timestamp: asset.deletedAt
      });
      return asset;
    });
    await MediaStorage.deleteBlob(deletedAsset.storageKey);
    return { deleted: true, id: deletedAsset.id, deletedAt: deletedAsset.deletedAt };
  },

  async purgeExpiredMedia({ nowMs = Date.now() } = {}) {
    const expired = (dbState.mediaAssets || []).filter(m => !m.deletedAt && m.expiresAt && new Date(m.expiresAt).getTime() <= nowMs);
    const purgedIds = [];
    for (const item of expired) {
      await runInTransaction(async (state) => {
        const stored = state.mediaAssets.find(m => m.id === item.id);
        if (!stored || stored.deletedAt) return;
        stored.deletedAt = new Date(nowMs).toISOString();
        stored.deletedBy = 'system_retention_job';
        purgedIds.push(stored.id);
      });
      await MediaStorage.deleteBlob(item.storageKey);
    }
    return { purgedCount: purgedIds.length, purgedIds };
  }
};

module.exports = MediaService;
