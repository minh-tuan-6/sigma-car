// backend/application/auth-service.js
// Authentication & Role-Based Access Control Service

const UserRepository = require('../infrastructure/repositories/user-repository');
const Security = require('../infrastructure/security');
const { ROLES } = require('../domain/constants');

const NOTIFICATION_PREF_KEYS = [
  'pushOrder', 'pushPromo', 'pushAccount',
  'emailOrder', 'emailPromo', 'emailAccount',
  'smsOrder', 'smsMaintenance', 'smsConsent'
];

const SECURITY_PREF_KEYS = ['publicProfile', 'marketingConsent'];

function issueUserToken(user) {
  const branchIds = Array.isArray(user.branchIds) && user.branchIds.length > 0
    ? user.branchIds.filter(Boolean)
    : (user.branchId ? [user.branchId] : []);
  return Security.createToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    branchId: user.branchId || branchIds[0] || null,
    branchIds,
    branchName: user.branchName || null,
    fullName: user.fullName,
    sessionVersion: user.sessionVersion || 1
  });
}

const AuthService = {
  // Public registration - Mandatory security: public registration MUST ALWAYS assign BUYER role!
  async register({ email, password, fullName, phone }) {
    if (!email || !password || !fullName) {
      const err = new Error('Vui lòng điền đầy đủ Email, Mật khẩu và Họ tên.');
      err.statusCode = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    const cleanEmail = Security.normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      const err = new Error('Định dạng email không hợp lệ.');
      err.statusCode = 400;
      err.code = 'INVALID_EMAIL';
      throw err;
    }
    if (String(password).length < 6) {
      const err = new Error('Mật khẩu phải có tối thiểu 6 ký tự.');
      err.statusCode = 400;
      err.code = 'WEAK_PASSWORD';
      throw err;
    }

    const passwordHash = await Security.hashPassword(password);

    const user = await UserRepository.create({
      email: cleanEmail,
      fullName: Security.sanitizeString(fullName),
      phone: Security.sanitizeString(phone || ''),
      role: ROLES.BUYER, // Enforce Buyer role strictly
      passwordHash
    });

    return {
      user: Security.sanitizeUser(user),
      token: issueUserToken(user)
    };
  },

  // Login
  async login({ email, password }) {
    if (!email || !password) {
      const err = new Error('Vui lòng nhập Email và Mật khẩu.');
      err.statusCode = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    const cleanEmail = Security.normalizeEmail(email);
    const user = await UserRepository.findByEmail(cleanEmail);

    if (!user) {
      const err = new Error('Email hoặc mật khẩu không chính xác.');
      err.statusCode = 401;
      err.code = 'UNAUTHORIZED';
      throw err;
    }

    if (user.disabledAt || user.isDisabled) {
      const err = new Error('Tài khoản của bạn đã bị tạm khóa. Vui lòng liên hệ quản trị viên.');
      err.statusCode = 403;
      err.code = 'ACCOUNT_DISABLED';
      throw err;
    }

    const isValid = await Security.verifyPassword(password, user.passwordHash);
    if (!isValid) {
      const err = new Error('Email hoặc mật khẩu không chính xác.');
      err.statusCode = 401;
      err.code = 'UNAUTHORIZED';
      throw err;
    }

    return {
      user: Security.sanitizeUser(user),
      token: issueUserToken(user)
    };
  },

  async logout(userId) {
    if (!userId) return { loggedOut: true };
    await UserRepository.bumpSessionVersion(userId);
    return { loggedOut: true };
  },

  async refreshToken(userId) {
    const user = await UserRepository.findById(userId);
    if (!user || user.disabledAt || user.isDisabled) {
      const err = new Error('Phiên đăng nhập không hợp lệ.');
      err.statusCode = 401;
      err.code = 'UNAUTHORIZED';
      throw err;
    }
    return {
      user: Security.sanitizeUser(user),
      token: issueUserToken(user)
    };
  },

  // Profile retrieval
  async getProfile(userId) {
    const user = await UserRepository.findById(userId);
    if (!user) {
      const err = new Error('Không tìm thấy tài khoản người dùng.');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }
    return Security.sanitizeUser(user);
  },

  // Update personal profile info
  async updateProfile(userId, { fullName, phone, birthDate, address }) {
    const user = await UserRepository.findById(userId);
    if (!user) {
      const err = new Error('Không tìm thấy tài khoản người dùng.');
      err.statusCode = 404;
      throw err;
    }

    const updates = {};
    if (fullName !== undefined) updates.fullName = Security.sanitizeString(fullName);
    if (phone !== undefined) updates.phone = Security.sanitizeString(phone);
    if (birthDate !== undefined) updates.birthDate = Security.sanitizeString(birthDate);
    if (address !== undefined) updates.address = Security.sanitizeString(address);

    const updated = await UserRepository.update(userId, updates);
    return Security.sanitizeUser(updated);
  },

  // Change password with verification and immediate session revocation
  async changePassword(userId, { currentPassword, newPassword }) {
    if (!currentPassword || !newPassword) {
      const err = new Error('Vui lòng nhập mật khẩu hiện tại và mật khẩu mới.');
      err.statusCode = 400;
      throw err;
    }
    if (String(newPassword).length < 6) {
      const err = new Error('Mật khẩu mới phải có tối thiểu 6 ký tự.');
      err.statusCode = 400;
      throw err;
    }
    const user = await UserRepository.findById(userId);
    if (!user) {
      const err = new Error('Không tìm thấy tài khoản người dùng.');
      err.statusCode = 404;
      throw err;
    }

    const isValid = await Security.verifyPassword(currentPassword, user.passwordHash);
    if (!isValid) {
      const err = new Error('Mật khẩu hiện tại không chính xác.');
      err.statusCode = 400;
      throw err;
    }

    const newHash = await Security.hashPassword(newPassword);
    const updatedUser = await UserRepository.updatePasswordHash(userId, newHash);
    return {
      updated: true,
      sessionVersion: updatedUser.sessionVersion,
      token: issueUserToken(updatedUser)
    };
  },

  // Update notification and security preferences with strict boolean validation
  async updatePreferences(userId, { notificationPrefs, securityPrefs }) {
    const user = await UserRepository.findById(userId);
    if (!user) {
      const err = new Error('Không tìm thấy tài khoản người dùng.');
      err.statusCode = 404;
      throw err;
    }

    const updates = {};
    if (notificationPrefs !== undefined) {
      if (!notificationPrefs || typeof notificationPrefs !== 'object' || Array.isArray(notificationPrefs)) {
        const err = new Error('notificationPrefs phải là object hợp lệ.');
        err.statusCode = 400;
        throw err;
      }
      const nextNotif = { ...(user.notificationPrefs || {}) };
      for (const [k, v] of Object.entries(notificationPrefs)) {
        if (!NOTIFICATION_PREF_KEYS.includes(k)) continue;
        if (typeof v !== 'boolean') {
          const err = new Error(`Giá trị cấu hình "${k}" phải là kiểu boolean.`);
          err.statusCode = 400;
          throw err;
        }
        nextNotif[k] = v;
      }
      updates.notificationPrefs = nextNotif;
    }

    if (securityPrefs !== undefined) {
      if (!securityPrefs || typeof securityPrefs !== 'object' || Array.isArray(securityPrefs)) {
        const err = new Error('securityPrefs phải là object hợp lệ.');
        err.statusCode = 400;
        throw err;
      }
      if (securityPrefs.twoFactorEnabled === true) {
        const err = new Error('Tính năng Xác thực 2 bước (MFA/TOTP) hiện chưa được kích hoạt trên hệ thống.');
        err.statusCode = 501;
        err.code = 'MFA_NOT_SUPPORTED';
        throw err;
      }
      const nextSec = { ...(user.securityPrefs || {}) };
      for (const [k, v] of Object.entries(securityPrefs)) {
        if (!SECURITY_PREF_KEYS.includes(k)) continue;
        if (typeof v !== 'boolean') {
          const err = new Error(`Giá trị cấu hình "${k}" phải là kiểu boolean.`);
          err.statusCode = 400;
          throw err;
        }
        nextSec[k] = v;
      }
      updates.securityPrefs = nextSec;
    }

    const updated = await UserRepository.update(userId, updates);
    return Security.sanitizeUser(updated);
  },

  // Toggle saved car in wishlist
  async toggleSavedCar(userId, vehicleId) {
    if (!vehicleId) {
      const err = new Error('Thiếu mã mẫu xe.');
      err.statusCode = 400;
      throw err;
    }
    const user = await UserRepository.findById(userId);
    if (!user) {
      const err = new Error('Không tìm thấy tài khoản người dùng.');
      err.statusCode = 404;
      throw err;
    }

    const currentSaved = Array.isArray(user.savedCars) ? [...user.savedCars] : [];
    const idx = currentSaved.indexOf(vehicleId);
    let saved = false;
    if (idx >= 0) {
      currentSaved.splice(idx, 1);
      saved = false;
    } else {
      currentSaved.push(vehicleId);
      saved = true;
    }
    const updated = await UserRepository.update(userId, { savedCars: currentSaved });
    return {
      saved,
      savedCars: updated.savedCars,
      user: Security.sanitizeUser(updated)
    };
  }
};

module.exports = AuthService;
