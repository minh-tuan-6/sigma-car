// backend/infrastructure/repositories/configuration-repository.js
// Repository for Owner-Scoped & Versioned Vehicle 3D Configurations (SIG-P3-003)

const { dbState } = require('../storage-engine');

const ConfigurationRepository = {
  ensureCollection(state = dbState) {
    if (!Array.isArray(state.configurations)) {
      state.configurations = [];
    }
    return state.configurations;
  },

  findByUserId(userId) {
    const list = this.ensureCollection();
    return list
      .filter(c => c.userId === userId)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
  },

  findById(id) {
    return this.ensureCollection().find(c => c.id === id) || null;
  },

  findByUserAndVehicle(userId, vehicleId) {
    return this.ensureCollection().find(c => c.userId === userId && c.vehicleId === vehicleId) || null;
  }
};

module.exports = ConfigurationRepository;
