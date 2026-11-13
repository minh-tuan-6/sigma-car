// backend/infrastructure/repositories/content-repository.js
// Repository for CMS Banners & Articles with Version History & Initial Defaults (SIG-P4-008)

const { dbState } = require('../storage-engine');

const DEFAULT_CMS_SEED = [
  {
    id: 'CMS-HERO-MAIN',
    slug: 'hero-main-showcase',
    contentType: 'banner',
    slot: 'home_hero_promo',
    title: 'SIGMACAR: ELECTRIC & CERTIFIED',
    status: 'published',
    activeVersion: 1,
    publishedVersion: 1,
    scheduledPublishAt: null,
    authorId: 'usr_admin_01',
    publisherId: 'usr_admin_01',
    versions: [
      {
        version: 1,
        title: 'SIGMACAR: ELECTRIC & CERTIFIED',
        subtitle: 'Kỷ nguyên di chuyển mới',
        bodyHtml: '<p>Trải nghiệm công nghệ dẫn đầu và sự an tâm tuyệt đối với tiêu chuẩn kiểm định 176 điểm khắt khe nhất dành cho xe điện và xe đã qua sử dụng.</p>',
        ctaLabel: 'Khám phá ngay',
        ctaTarget: '#new-cars',
        imageUrl: 'assets/profile-main-hero.jpg',
        createdBy: 'usr_admin_01',
        createdAt: '2026-10-01T00:00:00.000Z',
        note: 'Bản phát hành mặc định hệ thống'
      }
    ],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z'
  },
  {
    id: 'CMS-NEWS-CERTIFIED',
    slug: 'chuan-kiem-dinh-176-diem',
    contentType: 'article',
    slot: 'home_editorial',
    title: 'Quy chuẩn Kiểm định 176+ Điểm & Đo Sức Khỏe Pin SoH Cao Áp',
    status: 'published',
    activeVersion: 1,
    publishedVersion: 1,
    scheduledPublishAt: null,
    authorId: 'usr_admin_01',
    publisherId: 'usr_admin_01',
    versions: [
      {
        version: 1,
        title: 'Quy chuẩn Kiểm định 176+ Điểm & Đo Sức Khỏe Pin SoH Cao Áp',
        subtitle: 'Minh bạch dữ liệu thực tế cho từng xe bàn giao',
        bodyHtml: '<p>Mọi xe điện Certified tại SIGMACAR đều được kỹ thuật viên đo kiểm dung lượng pin khả dụng thực tế (SoH) và lưu vết hồ sơ kỹ thuật theo số VIN.</p>',
        ctaLabel: 'Xem xe Certified',
        ctaTarget: '#certified',
        imageUrl: 'assets/garage-car-detail.jpg',
        createdBy: 'usr_admin_01',
        createdAt: '2026-10-15T00:00:00.000Z',
        note: 'Bài viết chuyên môn đã duyệt xuất bản'
      }
    ],
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z'
  }
];

const ContentRepository = {
  ensureInitialized(state = dbState) {
    if (!state) return;
    if (!Array.isArray(state.cmsContents) || state.cmsContents.length === 0) {
      state.cmsContents = DEFAULT_CMS_SEED.map(item => JSON.parse(JSON.stringify(item)));
    }
    if (!Array.isArray(state.cmsAuditLogs)) {
      state.cmsAuditLogs = [];
    }
  }
};

module.exports = ContentRepository;
