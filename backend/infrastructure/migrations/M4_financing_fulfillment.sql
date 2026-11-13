-- M4: Financing, Test Drives, Handover, Registration & Digital Contracts
CREATE TABLE IF NOT EXISTS financing_applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  order_id TEXT,
  vehicle_price REAL NOT NULL,
  down_payment_percent REAL NOT NULL,
  annual_interest_rate REAL NOT NULL,
  term_months INTEGER NOT NULL,
  repayment_method TEXT NOT NULL,
  monthly_income REAL,
  monthly_obligation REAL,
  status TEXT NOT NULL,
  reviewer_id TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  car_name TEXT,
  vehicle_id TEXT,
  branch_id TEXT NOT NULL,
  branch_name TEXT,
  preferred_date TEXT NOT NULL,
  time_slot TEXT NOT NULL,
  is_home_service INTEGER NOT NULL DEFAULT 0,
  district TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS registration_cases (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  province TEXT NOT NULL,
  buyer_type TEXT NOT NULL,
  fee_breakdown_json TEXT NOT NULL,
  status TEXT NOT NULL,
  plate_number TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS handovers (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  vin TEXT NOT NULL,
  motor_number TEXT,
  inspector_id TEXT NOT NULL,
  pdi_passed INTEGER NOT NULL DEFAULT 0,
  odo_at_handover INTEGER NOT NULL DEFAULT 0,
  checklist_json TEXT NOT NULL DEFAULT '[]',
  handed_over_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  terms_hash TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  signer_name TEXT NOT NULL,
  signer_id_last4 TEXT
);
