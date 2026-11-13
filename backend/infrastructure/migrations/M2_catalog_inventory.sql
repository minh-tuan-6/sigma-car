-- M2: Vehicle Catalog & Branch Inventory Ledger
CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  product_code TEXT,
  name TEXT NOT NULL,
  brand TEXT,
  version TEXT,
  category TEXT NOT NULL,
  fuel TEXT NOT NULL,
  price REAL NOT NULL,
  sale_price REAL,
  range_km REAL,
  battery_kwh REAL,
  hp REAL,
  seats INTEGER,
  image TEXT,
  stock INTEGER NOT NULL DEFAULT 0,
  is_available INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  specs_json TEXT DEFAULT '{}',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS certified_vehicles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  year INTEGER,
  vin TEXT,
  odo_num INTEGER,
  price REAL NOT NULL,
  battery_health TEXT,
  category TEXT,
  image TEXT,
  status TEXT,
  stock INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS branch_inventory (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  stock_on_hand INTEGER NOT NULL DEFAULT 0,
  reserved_qty INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  order_id TEXT,
  cart_id TEXT,
  user_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  branch_id TEXT,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_id TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL
);
