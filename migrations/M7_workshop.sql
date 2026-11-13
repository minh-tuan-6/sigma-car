-- M7: Service Centers, Workshop Bays, Technicians, Jobs & Warranty Claims
CREATE TABLE IF NOT EXISTS service_centers (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  phone TEXT,
  bay_count INTEGER NOT NULL DEFAULT 4,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_bays (
  id TEXT PRIMARY KEY,
  service_center_id TEXT NOT NULL REFERENCES service_centers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bay_type TEXT NOT NULL DEFAULT 'general',
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS technicians (
  id TEXT PRIMARY KEY,
  service_center_id TEXT NOT NULL REFERENCES service_centers(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  specialty TEXT NOT NULL DEFAULT 'ev_high_voltage',
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS workshop_jobs (
  id TEXT PRIMARY KEY,
  job_code TEXT NOT NULL UNIQUE,
  service_center_id TEXT NOT NULL REFERENCES service_centers(id),
  bay_id TEXT NOT NULL REFERENCES service_bays(id),
  technician_id TEXT NOT NULL REFERENCES technicians(id),
  user_id TEXT NOT NULL,
  vehicle_id TEXT,
  vin TEXT NOT NULL,
  scheduled_date DATE NOT NULL,
  time_slot TEXT NOT NULL,
  service_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Scheduled',
  labor_cost BIGINT NOT NULL DEFAULT 0,
  parts_cost BIGINT NOT NULL DEFAULT 0,
  total_cost BIGINT NOT NULL DEFAULT 0,
  invoice_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_bay_slot UNIQUE (service_center_id, bay_id, scheduled_date, time_slot),
  CONSTRAINT uq_tech_slot UNIQUE (service_center_id, technician_id, scheduled_date, time_slot)
);

CREATE TABLE IF NOT EXISTS warranty_claims (
  id TEXT PRIMARY KEY,
  claim_code TEXT NOT NULL UNIQUE,
  warranty_id TEXT,
  order_id TEXT,
  user_id TEXT NOT NULL,
  vin TEXT NOT NULL,
  service_center_id TEXT NOT NULL REFERENCES service_centers(id),
  issue_summary TEXT NOT NULL,
  coverage_result TEXT NOT NULL,
  requires_manual_review BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'Submitted',
  estimated_cost BIGINT NOT NULL DEFAULT 0,
  approved_amount BIGINT NOT NULL DEFAULT 0,
  evidence_media_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  linked_job_id TEXT REFERENCES workshop_jobs(id),
  decision_reason TEXT,
  staff_internal_note TEXT,
  reviewed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
