-- M8: Funnel Analytics, CMS Versioned Content, EV Charging Cache & Campaign Delivery Receipts
CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT,
  event_type TEXT NOT NULL,
  target_id TEXT,
  branch_id TEXT,
  promo_code TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  consent_granted BOOLEAN NOT NULL DEFAULT TRUE,
  cohort_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cms_contents (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  active_version INTEGER NOT NULL DEFAULT 1,
  published_version INTEGER,
  scheduled_publish_at TIMESTAMPTZ,
  author_id TEXT NOT NULL,
  publisher_id TEXT,
  versions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS charging_stations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  province TEXT NOT NULL,
  address TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  connectors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  tariff_vnd_per_kwh BIGINT,
  tariff_source TEXT,
  tariff_updated_at TIMESTAMPTZ,
  data_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaign_deliveries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'queued',
  provider_message_id TEXT,
  failure_reason TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  CONSTRAINT uq_campaign_recipient UNIQUE (campaign_id, recipient_user_id)
);
