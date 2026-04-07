-- Freedom Pools Tennessee - Database Schema

-- App settings (Stripe keys, company info, etc.)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Users / Techs
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'tech',  -- owner, tech, office
  phone TEXT,
  email TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Default admin (password: changeme)
INSERT INTO users (username, password_hash, full_name, role)
  VALUES ('admin', '$2b$10$RD6kKQ9SFhdNFiOnL1KYTumdXT.prciq4qFRT.h57PZWfkGLztYzC', 'Owner', 'owner')
  ON CONFLICT DO NOTHING;

-- Customers
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT DEFAULT 'TN',
  zip TEXT,
  phone TEXT,
  email TEXT,
  billing_rate NUMERIC,             -- monthly service rate
  billing_frequency TEXT DEFAULT 'monthly',  -- monthly, per-visit, etc.
  stripe_customer_id TEXT,
  auto_pay BOOLEAN DEFAULT FALSE,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Pools (each customer can have multiple)
CREATE TABLE IF NOT EXISTS pools (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT DEFAULT 'Main Pool',
  pool_type TEXT,           -- inground, above-ground, spa, etc.
  size_gallons INTEGER,
  surface_type TEXT,        -- plaster, vinyl, fiberglass, etc.
  pump_model TEXT,
  filter_type TEXT,         -- sand, cartridge, DE
  heater_type TEXT,
  chlorine_type TEXT,       -- salt, tablet, liquid
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Equipment (at customer site, with AI-scanned data)
CREATE TABLE IF NOT EXISTS equipment (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  pool_id INTEGER REFERENCES pools(id) ON DELETE SET NULL,
  equipment_type TEXT NOT NULL,   -- pump, filter, heater, chlorinator, automation, cleaner, etc.
  manufacturer TEXT,
  model_number TEXT,
  serial_number TEXT,
  specs JSONB DEFAULT '{}',       -- voltage, HP, GPM, BTU, filter_sqft, etc.
  install_date DATE,
  warranty_expiry DATE,
  condition TEXT,                  -- good, fair, needs-repair, replaced
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Equipment photos (tag scans, nameplate shots, etc.)
CREATE TABLE IF NOT EXISTS equipment_photos (
  id SERIAL PRIMARY KEY,
  equipment_id INTEGER REFERENCES equipment(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  caption TEXT,
  ai_extracted_data JSONB DEFAULT '{}',
  uploaded_at TIMESTAMP DEFAULT NOW()
);

-- Customer site photos
CREATE TABLE IF NOT EXISTS customer_photos (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  caption TEXT,
  uploaded_at TIMESTAMP DEFAULT NOW()
);

-- Chemical catalog
CREATE TABLE IF NOT EXISTS chemical_catalog (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,          -- sanitizer, shock, algaecide, pH, alkalinity, etc.
  unit TEXT DEFAULT 'oz',
  cost_per_unit NUMERIC DEFAULT 0,
  sell_per_unit NUMERIC DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Truck inventory (parts techs carry)
CREATE TABLE IF NOT EXISTS truck_inventory (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,            -- plumbing, seals, electrical, filters, misc
  unit TEXT DEFAULT 'each',
  quantity_on_hand INTEGER DEFAULT 0,
  reorder_level INTEGER DEFAULT 2,
  cost_price NUMERIC DEFAULT 0,
  sell_price NUMERIC DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Jobs
CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  pool_id INTEGER REFERENCES pools(id) ON DELETE SET NULL,
  tech_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL,          -- maintenance, open, close, repair, install, cleaning
  status TEXT DEFAULT 'scheduled', -- scheduled, in-progress, completed, cancelled, needs-return
  scheduled_date DATE,
  scheduled_time TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  description TEXT,
  internal_notes TEXT,
  labor_hours NUMERIC,
  labor_rate NUMERIC,
  flat_rate NUMERIC,               -- for flat-rate jobs
  invoice_id INTEGER,              -- linked after invoice generated
  created_at TIMESTAMP DEFAULT NOW()
);

-- Job chemicals used
CREATE TABLE IF NOT EXISTS job_chemicals (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  chemical_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit TEXT DEFAULT 'oz',
  cost NUMERIC DEFAULT 0,
  sell_price NUMERIC DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Job parts used
CREATE TABLE IF NOT EXISTS job_parts (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  part_name TEXT NOT NULL,
  truck_inventory_id INTEGER REFERENCES truck_inventory(id) ON DELETE SET NULL,
  quantity INTEGER DEFAULT 1,
  cost_each NUMERIC DEFAULT 0,
  sell_each NUMERIC DEFAULT 0,
  source TEXT DEFAULT 'truck',  -- truck, ordered, manual
  order_status TEXT,            -- null, pending, ordered, received
  created_at TIMESTAMP DEFAULT NOW()
);

-- Job photos (before, during, after)
CREATE TABLE IF NOT EXISTS job_photos (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  phase TEXT DEFAULT 'other',  -- before, after, other
  file_path TEXT NOT NULL,
  caption TEXT,
  uploaded_at TIMESTAMP DEFAULT NOW()
);

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  invoice_number TEXT,
  status TEXT DEFAULT 'draft',    -- draft, sent, paid, overdue, void
  subtotal NUMERIC DEFAULT 0,
  tax_rate NUMERIC DEFAULT 0,
  tax_amount NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  amount_paid NUMERIC DEFAULT 0,
  balance_due NUMERIC DEFAULT 0,
  due_date DATE,
  sent_at TIMESTAMP,
  paid_at TIMESTAMP,
  stripe_payment_link TEXT,
  stripe_invoice_id TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Invoice line items
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC DEFAULT 1,
  unit_price NUMERIC DEFAULT 0,
  line_total NUMERIC DEFAULT 0,
  item_type TEXT,                -- service, chemical, part, labor, other
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  method TEXT NOT NULL,           -- card, ach, cash, check, auto-pay
  stripe_payment_id TEXT,
  reference_note TEXT,            -- check #, cash note, etc.
  payment_date TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Water chemistry readings
CREATE TABLE IF NOT EXISTS water_readings (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  free_chlorine NUMERIC,
  total_chlorine NUMERIC,
  ph NUMERIC,
  alkalinity NUMERIC,
  calcium_hardness NUMERIC,
  cya NUMERIC,                   -- cyanuric acid / stabilizer
  salt_level NUMERIC,
  temperature NUMERIC,
  notes TEXT,
  reading_date TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_jobs_customer ON jobs(customer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_tech ON jobs(tech_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled ON jobs(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_equipment_customer ON equipment(customer_id);
CREATE INDEX IF NOT EXISTS idx_job_photos_job ON job_photos(job_id);
