// backend/infrastructure/repositories/user-repository.js
// UserRepository interface & implementation

const { dbState, runInTransaction } = require('../storage-engine');
const { ROLES } = require('../../domain/constants');
const Security = require('../security');
const crypto = require('crypto');

// PLAN T4.15: same entry shape as the other auditLogs writers (ecommerce-service appendAuditLog).
function appendUserAudit(state, actor, action, targetId, detail) {
  if (!Array.isArray(state.auditLogs)) state.auditLogs = [];
  state.auditLogs.unshift({
    id: `AUD-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`,
    action,
    actorId: (actor && (actor.userId || actor.id)) || 'system',
    actorName: (actor && (actor.fullName || actor.email)) || 'Hệ thống SIGMACAR',
    targetId,
    detail,
    timestamp: new Date().toISOString()
  });
}

const UserRepository = {
  async findById(id) {
    return dbState.users.find(u => u.id === id) || null;
  },

  async findByEmail(email) {
    if (!email) return null;
    const lower = Security.normalizeEmail(email);
    return dbState.users.find(u => Security.normalizeEmail(u.email) === lower) || null;
  },

  async create(userData) {
    return runInTransaction(async (state) => {
      const normalizedEmail = Security.normalizeEmail(userData.email);
      const existing = state.users.find(u => Security.normalizeEmail(u.email) === normalizedEmail);
      if (existing) {
        const err = new Error('Email này đã được sử dụng. Vui lòng chọn email khác.');
        err.statusCode = 409;
        err.code = 'EMAIL_EXISTS';
        throw err;
      }

      const branchIds = Array.isArray(userData.branchIds) && userData.branchIds.length > 0
        ? userData.branchIds.filter(Boolean)
        : (userData.branchId ? [userData.branchId] : []);

      const newUser = {
        id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        email: normalizedEmail,
        fullName: userData.fullName.trim(),
        role: userData.role || ROLES.BUYER,
        phone: userData.phone || '',
        branchId: userData.branchId || branchIds[0] || null,
        branchIds,
        branchName: userData.branchName || null,
        sessionVersion: 1,
        disabledAt: null,
        passwordHash: userData.passwordHash,
        memberCode: `#SIGMA-${Math.floor(1000 + Math.random() * 9000)}`,
        tier: userData.tier || 'Thành viên mới',
        nextTier: 'Silver',
        points: userData.points || 500,
        birthDate: userData.birthDate || '',
        address: userData.address || '',
        savedCars: userData.savedCars || [],
        notificationPrefs: {
          pushOrder: true,
          pushPromo: true,
          pushAccount: true,
          emailOrder: true,
          emailPromo: false,
          emailAccount: true,
          smsOrder: false,
          smsMaintenance: false,
          smsConsent: false
        },
        securityPrefs: {
          publicProfile: false,
          marketingConsent: false
        },
        createdAt: new Date().toISOString()
      };

      state.users.push(newUser);
      return newUser;
    });
  },

  async update(id, updates) {
    return runInTransaction(async (state) => {
      const idx = state.users.findIndex(u => u.id === id);
      if (idx === -1) {
        const err = new Error('Không tìm thấy người dùng.');
        err.statusCode = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }

      // Prevent unauthorized privilege or credential mutations through generic update
      const { role, id: _id, passwordHash, sessionVersion, branchId, branchIds, branchName, disabledAt, ...safeUpdates } = updates;
      state.users[idx] = { ...state.users[idx], ...safeUpdates, updatedAt: new Date().toISOString() };
      return state.users[idx];
    });
  },

  async updatePasswordHash(id, newPasswordHash) {
    return runInTransaction(async (state) => {
      const idx = state.users.findIndex(u => u.id === id);
      if (idx === -1) {
        const err = new Error('Không tìm thấy người dùng.');
        err.statusCode = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }
      state.users[idx].passwordHash = newPasswordHash;
      state.users[idx].sessionVersion = (state.users[idx].sessionVersion || 1) + 1;
      state.users[idx].updatedAt = new Date().toISOString();
      return state.users[idx];
    });
  },

  async bumpSessionVersion(id) {
    return runInTransaction(async (state) => {
      const idx = state.users.findIndex(u => u.id === id);
      if (idx === -1) {
        const err = new Error('Không tìm thấy người dùng.');
        err.statusCode = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }
      state.users[idx].sessionVersion = (state.users[idx].sessionVersion || 1) + 1;
      state.users[idx].updatedAt = new Date().toISOString();
      return state.users[idx];
    });
  },

  async findAll() {
    return dbState.users.map(u => Security.sanitizeUser(u));
  },

  async updateRoleByAdmin(id, newRole, branchId, branchName, branchIds, disabledAt, actor = null) {
    return runInTransaction(async (state) => {
      const idx = state.users.findIndex(u => u.id === id);
      if (idx === -1) {
        const err = new Error('Không tìm thấy người dùng.');
        err.statusCode = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }
      const current = state.users[idx];
      // T0.3: disabling an active admin removes an admin exactly like demotion does.
      const disablesActiveAdmin = current.role === ROLES.ADMIN && !current.disabledAt && Boolean(disabledAt);
      if ((current.role === ROLES.ADMIN && newRole !== ROLES.ADMIN) || disablesActiveAdmin) {
        const activeAdmins = state.users.filter(u => u.role === ROLES.ADMIN && !u.disabledAt && u.id !== id);
        if (activeAdmins.length === 0) {
          const err = new Error('Không thể hạ quyền Quản trị viên cuối cùng của hệ thống.');
          err.statusCode = 409;
          err.code = 'LAST_ADMIN_PROTECTED';
          throw err;
        }
      }
      const before = { role: current.role, branchId: current.branchId || null, disabledAt: current.disabledAt || null };
      if (newRole !== undefined) state.users[idx].role = newRole;
      if (branchId !== undefined) state.users[idx].branchId = branchId;
      if (branchName !== undefined) state.users[idx].branchName = branchName;
      if (Array.isArray(branchIds)) {
        state.users[idx].branchIds = branchIds.filter(Boolean);
        if (!state.users[idx].branchId && state.users[idx].branchIds.length > 0) {
          state.users[idx].branchId = state.users[idx].branchIds[0];
        }
      } else if (branchId !== undefined) {
        state.users[idx].branchIds = branchId ? [branchId] : [];
      }
      if (disabledAt !== undefined) {
        state.users[idx].disabledAt = disabledAt;
      }
      // Revoke existing sessions whenever role, branch, or disable state changes
      state.users[idx].sessionVersion = (state.users[idx].sessionVersion || 1) + 1;
      state.users[idx].updatedAt = new Date().toISOString();
      // PLAN T4.15: audit every role / branch / disable change
      const after = { role: state.users[idx].role, branchId: state.users[idx].branchId || null, disabledAt: state.users[idx].disabledAt || null };
      appendUserAudit(state, actor, 'USER_ROLE_UPDATED', id,
        `${current.email || id}: vai trò ${before.role} → ${after.role}; chi nhánh ${before.branchId || '—'} → ${after.branchId || '—'}; ${after.disabledAt ? 'đã vô hiệu hóa' : 'đang hoạt động'}${before.disabledAt && !after.disabledAt ? ' (mở khóa lại)' : ''}`);
      return Security.sanitizeUser(state.users[idx]);
    });
  },

  async delete(id, actor = null) {
    return runInTransaction(async (state) => {
      const idx = state.users.findIndex(u => u.id === id);
      if (idx === -1) {
        const err = new Error('Không tìm thấy người dùng.');
        err.statusCode = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }
      if (state.users[idx].role === ROLES.ADMIN) {
        const err = new Error('Không thể xóa tài khoản Quản trị viên tối cao.');
        err.statusCode = 409;
        err.code = 'ADMIN_PROTECTED';
        throw err;
      }
      const deleted = state.users.splice(idx, 1)[0];
      appendUserAudit(state, actor, 'USER_DELETED', id, `Xóa tài khoản ${deleted.email || id} (vai trò ${deleted.role})`); // PLAN T4.15
      return Security.sanitizeUser(deleted);
    });
  }
};

module.exports = UserRepository;
