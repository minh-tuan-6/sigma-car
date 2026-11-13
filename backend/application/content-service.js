// backend/application/content-service.js
// CMS Draft/Approval/Scheduled Publish/Rollback Engine with HTML Sanitization & Immutable Audit (SIG-P4-008)

const crypto = require('crypto');
const { dbState, runInTransaction } = require('../infrastructure/storage-engine');
const ContentRepository = require('../infrastructure/repositories/content-repository');
const Security = require('../infrastructure/security');
const { ROLES } = require('../domain/constants');

function createError(message, statusCode = 400, code = 'CMS_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function sanitizeRichHtml(rawHtml = '') {
  let str = String(rawHtml || '');
  // Remove dangerous tags (script, iframe, object, embed, style, svg onload etc.)
  str = str.replace(/<\s*(script|iframe|object|embed|form|meta|link|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '');
  str = str.replace(/<\s*(script|iframe|object|embed|form|meta|link|style)[^>]*\/?>/gi, '');
  // Remove inline event handlers (on*)
  str = str.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Neutralize javascript: / vbscript: / data:text/html URIs
  str = str.replace(/(href|src)\s*=\s*(['"]?)\s*(?:javascript|vbscript|data:text\/html):[^'">\s]*\2/gi, '$1=$2#$2');
  return str.trim();
}

function isSafeMediaOrLink(val) {
  if (!val) return true;
  const s = String(val).trim();
  if (s.startsWith('#') || s.startsWith('assets/') || s.startsWith('/')) return true;
  try {
    const parsed = new URL(s);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch (e) {
    return false;
  }
}

function formatPublicContent(item) {
  const targetVerNum = item.publishedVersion;
  if (!targetVerNum) return null;
  const ver = (item.versions || []).find(v => v.version === targetVerNum);
  if (!ver) return null;
  return {
    id: item.id,
    slug: item.slug,
    contentType: item.contentType,
    slot: item.slot || null,
    publishedVersion: item.publishedVersion,
    title: ver.title,
    subtitle: ver.subtitle || '',
    bodyHtml: ver.bodyHtml || '',
    ctaLabel: ver.ctaLabel || '',
    ctaTarget: ver.ctaTarget || '',
    imageUrl: ver.imageUrl || 'assets/profile-main-hero.jpg',
    publishedAt: item.publishedAt || item.updatedAt
  };
}

function appendCmsAudit(state, { action, actor, contentId, version, detail }) {
  ContentRepository.ensureInitialized(state);
  const entry = Object.freeze({
    id: `CMSAUD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    action,
    actorId: actor ? actor.userId : 'system',
    actorRole: actor ? actor.role : 'system',
    contentId,
    version: version ?? null,
    detail: Security.sanitizeString(detail || ''),
    timestamp: new Date().toISOString()
  });
  state.cmsAuditLogs.unshift(entry);
  if (state.cmsAuditLogs.length > 500) state.cmsAuditLogs.length = 500;
}

const ContentService = {
  sanitizeRichHtml,

  async processScheduledPublications({ nowMs = Date.now() } = {}) {
    const dueIds = (dbState.cmsContents || [])
      .filter(c => c.status === 'scheduled' && c.scheduledPublishAt && Date.parse(c.scheduledPublishAt) <= nowMs)
      .map(c => c.id);

    if (dueIds.length === 0) return [];

    return runInTransaction(async (state) => {
      ContentRepository.ensureInitialized(state);
      const publishedNow = [];
      for (const id of dueIds) {
        const item = state.cmsContents.find(c => c.id === id);
        if (!item || item.status !== 'scheduled' || !item.scheduledPublishAt || Date.parse(item.scheduledPublishAt) > nowMs) {
          continue; // already published once or canceled
        }
        item.status = 'published';
        item.publishedVersion = item.activeVersion;
        item.publishedAt = new Date(nowMs).toISOString();
        item.scheduledPublishAt = null;
        item.updatedAt = item.publishedAt;
        appendCmsAudit(state, {
          action: 'CMS_SCHEDULED_PUBLISHED',
          actor: { userId: item.publisherId || 'scheduler', role: 'system' },
          contentId: item.id,
          version: item.publishedVersion,
          detail: `Tự động xuất bản phiên bản v${item.publishedVersion} theo lịch hẹn.`
        });
        publishedNow.push(item.id);
      }
      return publishedNow;
    });
  },

  async getPublicPublished(query = {}) {
    ContentRepository.ensureInitialized(dbState);
    const nowMs = Number(query.nowMs || Date.now());
    await this.processScheduledPublications({ nowMs });

    let items = (dbState.cmsContents || []).filter(c => c.status === 'published' && c.publishedVersion);
    if (query.contentType) {
      items = items.filter(c => c.contentType === query.contentType);
    }
    if (query.slot) {
      items = items.filter(c => c.slot === query.slot);
    }
    return items.map(formatPublicContent).filter(Boolean);
  },

  listAllForStaff(user) {
    if (!user || ![ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF].includes(user.role)) {
      throw createError('Chỉ nhân viên quản trị nội dung mới có quyền xem bản nháp CMS.', 403, 'FORBIDDEN');
    }
    ContentRepository.ensureInitialized(dbState);
    return {
      items: (dbState.cmsContents || []).map(c => ({ ...c })),
      auditLogs: (dbState.cmsAuditLogs || []).slice(0, 50)
    };
  },

  async saveDraft(user, payload = {}) {
    if (!user || ![ROLES.ADMIN, ROLES.SELLER, ROLES.SUPPORT_STAFF].includes(user.role)) {
      throw createError('Không có quyền tạo/sửa bản nháp CMS.', 403, 'FORBIDDEN');
    }
    const {
      id = null,
      slug,
      contentType = 'banner',
      slot = 'home_promo',
      title,
      subtitle = '',
      bodyHtml = '',
      ctaLabel = '',
      ctaTarget = '#new-cars',
      imageUrl = 'assets/profile-main-hero.jpg',
      note = '',
      expectedVersion
    } = payload;

    if (!title || String(title).trim().length < 3) {
      throw createError('Tiêu đề nội dung phải có tối thiểu 3 ký tự.', 422, 'INVALID_TITLE');
    }
    if (!isSafeMediaOrLink(imageUrl) || !isSafeMediaOrLink(ctaTarget)) {
      throw createError('URL hình ảnh hoặc liên kết CTA không hợp lệ (chỉ chấp nhận https/http/assets/#).', 422, 'UNSAFE_URL');
    }

    const cleanHtml = sanitizeRichHtml(bodyHtml);
    const nowIso = new Date().toISOString();

    return runInTransaction(async (state) => {
      ContentRepository.ensureInitialized(state);
      let item = id ? state.cmsContents.find(c => c.id === id) : (slug ? state.cmsContents.find(c => c.slug === slug) : null);

      if (item) {
        if (expectedVersion !== undefined && Number(expectedVersion) !== Number(item.activeVersion)) {
          throw createError(
            `Xung đột phiên bản CMS: bản hiện tại đang là v${item.activeVersion} (bạn gửi v${expectedVersion}).`,
            409,
            'VERSION_CONFLICT'
          );
        }
        const nextVer = (item.activeVersion || 0) + 1;
        item.activeVersion = nextVer;
        item.title = Security.sanitizeString(title);
        if (slot) item.slot = Security.sanitizeString(slot);
        // Editing creates draft status while keeping existing publishedVersion live if previously published
        if (item.status === 'archived') item.status = 'draft';
        item.versions.push({
          version: nextVer,
          title: item.title,
          subtitle: Security.sanitizeString(subtitle),
          bodyHtml: cleanHtml,
          ctaLabel: Security.sanitizeString(ctaLabel),
          ctaTarget: String(ctaTarget || '').trim(),
          imageUrl: String(imageUrl || '').trim(),
          createdBy: user.userId,
          createdAt: nowIso,
          note: Security.sanitizeString(note || `Cập nhật bản nháp v${nextVer}`)
        });
        item.updatedAt = nowIso;

        appendCmsAudit(state, {
          action: 'CMS_DRAFT_SAVED',
          actor: user,
          contentId: item.id,
          version: nextVer,
          detail: `Lưu bản nháp v${nextVer} cho "${item.title}".`
        });
        return item;
      }

      const cleanSlug = Security.sanitizeString(slug || title).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || `cms-${Date.now()}`;
      if (state.cmsContents.some(c => c.slug === cleanSlug)) {
        throw createError(`Slug "${cleanSlug}" đã tồn tại.`, 409, 'SLUG_EXISTS');
      }

      const created = {
        id: `CMS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        slug: cleanSlug,
        contentType: contentType === 'article' ? 'article' : 'banner',
        slot: Security.sanitizeString(slot),
        title: Security.sanitizeString(title),
        status: 'draft',
        activeVersion: 1,
        publishedVersion: null,
        scheduledPublishAt: null,
        authorId: user.userId,
        publisherId: null,
        versions: [
          {
            version: 1,
            title: Security.sanitizeString(title),
            subtitle: Security.sanitizeString(subtitle),
            bodyHtml: cleanHtml,
            ctaLabel: Security.sanitizeString(ctaLabel),
            ctaTarget: String(ctaTarget || '').trim(),
            imageUrl: String(imageUrl || '').trim(),
            createdBy: user.userId,
            createdAt: nowIso,
            note: Security.sanitizeString(note || 'Khởi tạo bản nháp v1')
          }
        ],
        createdAt: nowIso,
        updatedAt: nowIso
      };
      state.cmsContents.unshift(created);
      appendCmsAudit(state, {
        action: 'CMS_CREATED',
        actor: user,
        contentId: created.id,
        version: 1,
        detail: `Tạo nội dung "${created.title}" (chưa xuất bản).`
      });
      return created;
    });
  },

  async publishOrSchedule(user, contentId, { version = null, scheduledPublishAt = null, scheduledAt = null } = {}) {
    const targetSchedule = scheduledPublishAt || scheduledAt || null;
    // Only Publisher/Admin (never non-admin draft authors) can publish directly!
    if (!user || user.role !== ROLES.ADMIN) {
      throw createError('Chỉ Quản trị viên / Publisher có quyền duyệt xuất bản hoặc đặt lịch phát hành CMS.', 403, 'PUBLISHER_REQUIRED');
    }

    return runInTransaction(async (state) => {
      ContentRepository.ensureInitialized(state);
      const item = state.cmsContents.find(c => c.id === contentId);
      if (!item) throw createError('Không tìm thấy nội dung CMS.', 404, 'CONTENT_NOT_FOUND');

      const targetVerNum = version ? Number(version) : item.activeVersion;
      const targetVer = (item.versions || []).find(v => v.version === targetVerNum);
      if (!targetVer) throw createError(`Không tìm thấy phiên bản v${targetVerNum}.`, 404, 'VERSION_NOT_FOUND');

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      item.publisherId = user.userId;

      if (targetSchedule) {
        const schedMs = Date.parse(targetSchedule);
        if (!Number.isFinite(schedMs)) {
          throw createError('Thời gian hẹn giờ xuất bản không hợp lệ (ISO datetime).', 422, 'INVALID_SCHEDULE');
        }
        if (schedMs > nowMs) {
          item.status = 'scheduled';
          item.activeVersion = targetVerNum;
          item.scheduledPublishAt = new Date(schedMs).toISOString();
          item.updatedAt = nowIso;
          appendCmsAudit(state, {
            action: 'CMS_SCHEDULED',
            actor: user,
            contentId: item.id,
            version: targetVerNum,
            detail: `Đặt lịch xuất bản v${targetVerNum} vào lúc ${item.scheduledPublishAt}.`
          });
          return item;
        }
      }

      item.status = 'published';
      item.publishedVersion = targetVerNum;
      item.scheduledPublishAt = null;
      item.publishedAt = nowIso;
      item.updatedAt = nowIso;

      appendCmsAudit(state, {
        action: 'CMS_PUBLISHED',
        actor: user,
        contentId: item.id,
        version: targetVerNum,
        detail: `Xuất bản công khai phiên bản v${targetVerNum} của "${item.title}".`
      });
      return item;
    });
  },

  async rollbackVersion(user, contentId, { targetVersion, reason = '' } = {}) {
    if (!user || user.role !== ROLES.ADMIN) {
      throw createError('Chỉ Quản trị viên / Publisher có quyền khôi phục (rollback) phiên bản CMS.', 403, 'PUBLISHER_REQUIRED');
    }
    const verNum = Number(targetVersion);
    return runInTransaction(async (state) => {
      ContentRepository.ensureInitialized(state);
      const item = state.cmsContents.find(c => c.id === contentId);
      if (!item) throw createError('Không tìm thấy nội dung CMS.', 404, 'CONTENT_NOT_FOUND');

      const found = (item.versions || []).find(v => v.version === verNum);
      if (!found) throw createError(`Phiên bản v${verNum} không tồn tại.`, 404, 'VERSION_NOT_FOUND');

      const nowIso = new Date().toISOString();
      item.status = 'published';
      item.publishedVersion = verNum;
      item.scheduledPublishAt = null;
      item.publishedAt = nowIso;
      item.updatedAt = nowIso;

      appendCmsAudit(state, {
        action: 'CMS_ROLLED_BACK',
        actor: user,
        contentId: item.id,
        version: verNum,
        detail: `Khôi phục xuất bản về phiên bản v${verNum}. Lý do: ${Security.sanitizeString(reason || 'Hoàn tác theo yêu cầu quản trị')}`
      });
      return item;
    });
  }
};

module.exports = ContentService;
