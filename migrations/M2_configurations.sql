-- SIGMACAR M2 Migration: Saved Vehicle 3D Configurations (Owner-Scoped & Versioned)
CREATE TABLE IF NOT EXISTS vehicle_configurations (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  vehicle_id VARCHAR(64) NOT NULL,
  trim_id VARCHAR(64),
  color_idx INT NOT NULL DEFAULT 0,
  color_name VARCHAR(120),
  color_hex VARCHAR(16),
  wheel_id VARCHAR(64),
  wheel_name VARCHAR(120),
  accessory_ids_json TEXT NOT NULL DEFAULT '[]',
  asset_version VARCHAR(32) NOT NULL DEFAULT '2.1.0',
  version INT NOT NULL DEFAULT 1,
  base_price_vnd BIGINT NOT NULL DEFAULT 0,
  options_delta_vnd BIGINT NOT NULL DEFAULT 0,
  total_price_vnd BIGINT NOT NULL DEFAULT 0,
  compatibility_status VARCHAR(32) NOT NULL DEFAULT 'valid',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vehicle_configurations_user ON vehicle_configurations(user_id, updated_at DESC);
