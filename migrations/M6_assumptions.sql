-- SIGMACAR M6 Migration: TCO Cost Assumptions & Saved Estimates (PostgreSQL/SQLite compatible)
CREATE TABLE IF NOT EXISTS cost_assumptions (
  id VARCHAR(64) PRIMARY KEY,
  version VARCHAR(32) NOT NULL,
  region VARCHAR(32) NOT NULL DEFAULT 'vietnam',
  electricity_vnd_per_kwh BIGINT NOT NULL,
  fuel_vnd_per_liter BIGINT NOT NULL,
  default_charging_loss_percent NUMERIC(5,2) NOT NULL DEFAULT 8.00,
  ev_default_annual_maintenance_vnd BIGINT NOT NULL DEFAULT 3200000,
  ice_default_annual_maintenance_vnd BIGINT NOT NULL DEFAULT 6800000,
  source_note TEXT NOT NULL,
  effective_from DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
