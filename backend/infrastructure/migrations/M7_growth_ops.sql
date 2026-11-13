-- M7: Content CMS, Reviews/Q&A, Notifications Outbox, Campaigns & Analytics
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  order_id TEXT,
  rating INTEGER NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  moderation_status TEXT NOT NULL,
  verified_owner INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answers_json TEXT DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_entries (
  id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body_sanitized TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  published_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  segment TEXT NOT NULL,
  status TEXT NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  session_id TEXT,
  user_id TEXT,
  vehicle_id TEXT,
  branch_id TEXT,
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);
