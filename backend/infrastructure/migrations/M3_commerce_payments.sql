-- M3: Commerce, Cart, Quotes, Promotions, Orders, Payments & Ledger
CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  discount_type TEXT NOT NULL,
  discount_value REAL NOT NULL,
  min_order_value REAL DEFAULT 0,
  usage_limit INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  expires_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS carts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  branch_id TEXT,
  promo_code TEXT,
  items_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  buyer_name TEXT NOT NULL,
  buyer_phone TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  vehicle_name TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  branch_name TEXT,
  unit_price REAL NOT NULL,
  deposit_amount REAL NOT NULL,
  paid_amount REAL NOT NULL DEFAULT 0,
  order_status TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  registration_status TEXT,
  payment_method TEXT,
  vin TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS payment_intents (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'VND',
  status TEXT NOT NULL,
  idempotency_key TEXT,
  provider_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS payment_ledger (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  payment_intent_id TEXT,
  entry_type TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'VND',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT,
  processed_at TEXT NOT NULL
);
