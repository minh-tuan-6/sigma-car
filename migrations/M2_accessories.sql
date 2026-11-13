-- SIGMACAR M2 Migration: Normalized Accessories, Components & Smart Bundles
CREATE TABLE IF NOT EXISTS accessory_skus (
  sku VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  brand VARCHAR(120) NOT NULL,
  category VARCHAR(120) NOT NULL,
  item_kind VARCHAR(32) NOT NULL DEFAULT 'accessory',
  price_vnd BIGINT NOT NULL CHECK (price_vnd >= 0),
  stock_quantity INT NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  compatibility_rule_json TEXT NOT NULL,
  warranty_months INT NOT NULL DEFAULT 12,
  provenance TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bundle_quotes (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64),
  vehicle_id VARCHAR(64),
  items_json TEXT NOT NULL,
  subtotal_vnd BIGINT NOT NULL,
  discount_vnd BIGINT NOT NULL DEFAULT 0,
  total_vnd BIGINT NOT NULL,
  policy_version VARCHAR(32) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
