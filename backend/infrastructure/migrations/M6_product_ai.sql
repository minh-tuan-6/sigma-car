-- M6: Product Configuration, Accessories, Bundles, Media, AI Memory & TCO
CREATE TABLE IF NOT EXISTS configurations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  name TEXT,
  color_name TEXT,
  wheel_id TEXT,
  accessory_ids_json TEXT DEFAULT '[]',
  estimated_total REAL NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accessories (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  compatible_vehicles_json TEXT DEFAULT '["all"]',
  stock INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bundles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  accessory_ids_json TEXT NOT NULL,
  discount_percent REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  quarantine_status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  messages_json TEXT NOT NULL DEFAULT '[]',
  preferences_json TEXT DEFAULT '{}',
  updated_at TEXT NOT NULL
);
