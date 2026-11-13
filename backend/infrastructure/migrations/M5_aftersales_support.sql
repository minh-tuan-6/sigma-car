-- M5: After-Sales, Returns, Refunds, Warranties, Service Workshop & Tickets
CREATE TABLE IF NOT EXISTS return_requests (
  id TEXT PRIMARY KEY,
  return_code TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL,
  branch_id TEXT,
  user_id TEXT NOT NULL,
  reason_id TEXT NOT NULL,
  current_odo_km REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  estimated_refund_amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  return_id TEXT,
  order_id TEXT NOT NULL,
  amount REAL NOT NULL,
  transaction_ref TEXT,
  status TEXT NOT NULL,
  processed_by TEXT,
  processed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS warranties (
  id TEXT PRIMARY KEY,
  warranty_code TEXT NOT NULL UNIQUE,
  order_id TEXT,
  user_id TEXT NOT NULL,
  vehicle_id TEXT,
  vehicle_name TEXT NOT NULL,
  vin TEXT NOT NULL,
  license_plate TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  battery_end_date TEXT,
  current_odo_km REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_appointments (
  id TEXT PRIMARY KEY,
  appointment_code TEXT NOT NULL,
  user_id TEXT NOT NULL,
  service_center_id TEXT NOT NULL,
  preferred_date TEXT NOT NULL,
  time_slot TEXT NOT NULL,
  bay_id TEXT,
  technician_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  ticket_code TEXT NOT NULL UNIQUE,
  user_id TEXT,
  branch_id TEXT,
  subject TEXT NOT NULL,
  category TEXT NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  assigned_staff_id TEXT,
  sla_due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
