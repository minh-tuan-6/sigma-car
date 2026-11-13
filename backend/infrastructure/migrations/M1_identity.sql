-- M1: Identity, RBAC & Branch Scope
CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  hotline TEXT,
  home_service_districts_json TEXT DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  phone TEXT,
  branch_id TEXT,
  branch_ids_json TEXT DEFAULT '[]',
  branch_name TEXT,
  session_version INTEGER NOT NULL DEFAULT 1,
  disabled_at TEXT,
  password_hash TEXT NOT NULL,
  member_code TEXT,
  tier TEXT,
  points INTEGER NOT NULL DEFAULT 0,
  birth_date TEXT,
  address TEXT,
  saved_cars_json TEXT DEFAULT '[]',
  notification_prefs_json TEXT DEFAULT '{}',
  security_prefs_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS consent_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  granted INTEGER NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  target_id TEXT,
  detail TEXT,
  timestamp TEXT NOT NULL
);
