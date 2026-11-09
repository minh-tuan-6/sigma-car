// backend/infrastructure/repositories/user-repository.js
// UserRepository interface & implementation

const { dbState, runInTransaction } = require('../storage-engine');

const UserRepository = {
  async findById(id) {
    return dbState.users.find(u => u.id === id) || null;
  },

  async findByEmail(email) {
    if (!email) return null;
    const lower = email.toLowerCase().trim();
    return dbState.users.find(u => u.email.toLowerCase() === lower) || null;
  },

  async create(userData) {
    return runInTransaction(async (state) => {
      // Check unique email constraint
      const existing = state.users.find(u => u.email.toLowerCase() === userData.email.toLowerCase().trim());
      if (existing) {
        throw new Error('Email này đã được sử dụng. Vui lòng chọn email khác.');
      }

      const newUser = {
        id: `usr_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        email: userData.email.toLowerCase().trim(),
        fullName: userData.fullName.trim(),
        role: userData.role || 'buyer',
        phone: userData.phone || '',
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
          emailPromo: true,
          emailAccount: true,
          smsOrder: false,
          smsMaintenance: false,
          smsConsent: false
        },
        securityPrefs: {
          twoFactorEnabled: false,
          publicProfile: false,
          marketingConsent: true
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
      if (idx === -1) throw new Error('Không tìm thấy người dùng.');

      // Prevent unauthorized role escalation through generic update
      const { role, id: _id, passwordHash, ...safeUpdates } = updates;
      state.users[idx] = { ...state.users[idx], ...safeUpdates, updatedAt: new Date().toISOString() };
      return state.users[idx];
    });
  },

  async updatePasswordHash(id, newPasswordHash) {
    return runInTransaction(async (state) => {
      const idx = state.users.findIndex(u => u.id === id);
      if (idx === -1) throw new Error('Không tìm thấy người dùng.');
      state.users[idx].passwordHash = newPasswordHash;
      state.users[idx].updatedAt = new Date().toISOString();
      return state.users[idx];
    });
  },

  async findAll() {
    return dbState.users.map(u => {
      const { passwordHash, ...safe } = u;
      return safe;
    });
  },

  async updateRoleByAdmin(id, newRole, branchId, branchName) {
    return runInTransaction(async (state) => {
      const idx = state.users.findIndex(u => u.id === id);
      if (idx === -1) throw new Error('Không tìm thấy người dùng.');
      state.users[idx].role = newRole;
      if (branchId !== undefined) state.users[idx].branchId = branchId;
      if (branchName !== undefined) state.users[idx].branchName = branchName;
      state.users[idx].updatedAt = new Date().toISOString();
      const { passwordHash, ...safe } = state.users[idx];
      return safe;
    });
  }
};

module.exports = UserRepository;
