-- SIGMACAR M6 Migration: AI Consultation Conversations, Preferences & Media Consent
CREATE TABLE IF NOT EXISTS ai_preferences (
  user_id VARCHAR(64) PRIMARY KEY,
  budget_vnd BIGINT,
  monthly_budget_vnd BIGINT,
  down_payment_vnd BIGINT,
  passengers INT,
  daily_km INT,
  usage VARCHAR(64),
  charging_access VARCHAR(64),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  title VARCHAR(180) NOT NULL,
  messages_json TEXT NOT NULL DEFAULT '[]',
  attached_media_ids_json TEXT NOT NULL DEFAULT '[]',
  last_recommendations_json TEXT NOT NULL DEFAULT '[]',
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON ai_conversations(user_id, updated_at DESC);
