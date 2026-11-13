-- M7 Parts Ledger & Service Job Parts Consumption
CREATE TABLE IF NOT EXISTS parts_ledger (
  sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
  stock_on_hand INTEGER NOT NULL CHECK (stock_on_hand >= 0),
  stock_reserved INTEGER NOT NULL DEFAULT 0 CHECK (stock_reserved >= 0),
  compatible_fuels JSONB NOT NULL DEFAULT '["ev","gas","hybrid"]'::jsonb,
  compatible_vehicle_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_job_parts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES workshop_jobs(id) ON DELETE CASCADE,
  part_sku TEXT NOT NULL REFERENCES parts_ledger(sku),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
  line_total BIGINT NOT NULL CHECK (line_total >= 0),
  reservation_status TEXT NOT NULL DEFAULT 'reserved'
);
