// backend/application/auth-service.js
// Authentication & Role-Based Access Control Service

const UserRepository = require('../infrastructure/repositories/user-repository');
const Security = require('../infrastructure/security');
const { ROLES } = require('../domain/constants');

const AuthService = {
  // Public registration - Mandatory security: public registration MUST ALWAYS assign BUYER role!
  async register({ email, password, fullName, phone }) {
    if (!email || !password || !fullName) {
      throw new Error('Vui lòng điền đầy đủ Email, Mật khẩu và Họ tên.');
    }
    const cleanEmail = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new Error('Định dạng email không hợp lệ.');
    }

    const passwordHash = await Security.hashPassword(password);

    const user = await UserRepository.create({
      email: cleanEmail,
      fullName: Security.sanitizeString(fullName),
      phone: Security.sanitizeString(phone || ''),
      role: ROLES.BUYER, // Enforce Buyer role strictly
      passwordHash
    });

    const token = Security.createToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName
    });

    return {
      user: Security.sanitizeUser(user),
      token
    };
  },

  // Login
  async login({ email, password }) {
    if (!email || !password) {
      throw new Error('Vui lòng nhập Email và Mật khẩu.');
    }
    const cleanEmail = email.toLowerCase().trim();
    const user = await UserRepository.findByEmail(cleanEmail);

    if (!user) {
      const err = new Error('Email hoặc mật khẩu không chính xác.');
      err.statusCode = 401;
      err.code = 'UNAUTHORIZED';
      throw err;
    }

    const isValid = await Security.verifyPassword(password, user.passwordHash);
    if (!isValid) {
      const err = new Error('Email hoặc mật khẩu không chính xác.');
      err.statusCode = 401;
      err.code = 'UNAUTHORIZED';
      throw err;
    }

    const token = Security.createToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      branchId: user.branchId || null,
      branchName: user.branchName || null,
      fullName: user.fullName
    });

    return {
      user: Security.sanitizeUser(user),
      token
    };
  },

  // Profile retrieval
  async getProfile(userId) {
    const user = await UserRepository.findById(userId);
    if (!user) {
      throw new Error('Không tìm thấy tài khoản người dùng.');
    }
    return Security.sanitizeUser(user);
  },

  // Update personal profile info
  async updateProfile(userId, { fullName, phone, birthDate, address }) {
    const user = await UserRepository.findById(userId);
    if (!user) throw new Error('Không tìm thấy tài khoản người dùng.');

    const updates = {};
    if (fullName !== undefined) updates.fullName = Security.sanitizeString(fullName);
    if (phone !== undefined) updates.phone = Security.sanitizeString(phone);
    if (birthDate !== undefined) updates.birthDate = Security.sanitizeString(birthDate);
    if (address !== undefined) updates.address = Security.sanitizeString(address);

    const updated = await UserRepository.update(userId, updates);
    return Security.sanitizeUser(updated);
  },

  // Change password with verification
  async changePassword(userId, { currentPassword, newPassword }) {
    if (!currentPassword || !newPassword) {
      throw new Error('Vui lòng nhập mật khẩu hiện tại và mật khẩu mới.');
    }
    if (String(newPassword).length < 6) {
      throw new Error('Mật khẩu mới phải có tối thiểu 6 ký tự.');
    }
    const user = await UserRepository.findById(userId);
    if (!user) throw new Error('Không tìm thấy tài khoản người dùng.');

    const isValid = await Security.verifyPassword(currentPassword, user.passwordHash);
    if (!isValid) {
      const err = new Error('Mật khẩu hiện tại không chính xác.');
      err.statusCode = 400;
      throw err;
    }

    const newHash = await Security.hashPassword(newPassword);
    await UserRepository.updatePasswordHash(userId, newHash);
    return { updated: true };
  },

  // Update notification and security preferences
  async updatePreferences(userId, { notificationPrefs, securityPrefs }) {
    const user = await UserRepository.findById(userId);
    if (!user) throw new Error('Không tìm thấy tài khoản người dùng.');

    const updates = {};
    if (notificationPrefs && typeof notificationPrefs === 'object') {
      updates.notificationPrefs = { ...(user.notificationPrefs || {}), ...notificationPrefs };
    }
    if (securityPrefs && typeof securityPrefs === 'object') {
      updates.securityPrefs = { ...(user.securityPrefs || {}), ...securityPrefs };
    }

    const updated = await UserRepository.update(userId, updates);
    return Security.sanitizeUser(updated);
  },

  // Toggle saved car in wishlist
  async toggleSavedCar(userId, vehicleId) {
    if (!vehicleId) throw new Error('Thiếu mã mẫu xe.');
    const user = await UserRepository.findById(userId);
    if (!user) throw new Error('Không tìm thấy tài khoản người dùng.');

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
