-- ============================================================
-- WFS Billing Dashboard — Supabase Schema
-- Run this in the Supabase SQL Editor to set up all tables.
-- ============================================================

-- RMS Cases (synced from Google Sheets via GAS trigger every 3 min)
CREATE TABLE IF NOT EXISTS rms_cases (
  id         BIGSERIAL PRIMARY KEY,
  case_id    TEXT UNIQUE NOT NULL,
  client_name TEXT NOT NULL,
  date_filed DATE,
  claim_type TEXT,
  reimbursement_status TEXT,
  reimbursement_amount NUMERIC(12,2) DEFAULT 0,
  rms_posting_date DATE,
  synced_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_cases_client      ON rms_cases(client_name);
CREATE INDEX IF NOT EXISTS idx_rms_cases_status      ON rms_cases(reimbursement_status);
CREATE INDEX IF NOT EXISTS idx_rms_cases_posting     ON rms_cases(rms_posting_date);
CREATE INDEX IF NOT EXISTS idx_rms_cases_synced      ON rms_cases(synced_at DESC);

-- Clients — onboarding info (synced from WFS Onboarding sheet)
CREATE TABLE IF NOT EXISTS clients (
  id          BIGSERIAL PRIMARY KEY,
  client_name TEXT UNIQUE NOT NULL,
  status      TEXT DEFAULT 'N/A',
  rate        NUMERIC(5,4) DEFAULT 0.22,
  start_date  DATE,
  pilot_end_date DATE,
  synced_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Billing contacts (synced from Billing Summary sheet)
CREATE TABLE IF NOT EXISTS billing_contacts (
  id             BIGSERIAL PRIMARY KEY,
  client_name    TEXT UNIQUE NOT NULL,
  invoice_date   DATE,
  payment_terms  TEXT,
  address        TEXT,
  synced_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Invoices — written by the Next.js app (not the GAS app going forward)
CREATE TABLE IF NOT EXISTS invoices (
  id               BIGSERIAL PRIMARY KEY,
  invoice_number   TEXT UNIQUE NOT NULL,
  client_name      TEXT NOT NULL,
  billed_date      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  billed_fee       NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_reimbursed NUMERIC(12,2) NOT NULL DEFAULT 0,
  case_ids         JSONB NOT NULL DEFAULT '[]',
  case_snapshot    JSONB NOT NULL DEFAULT '[]',
  pdf_url          TEXT DEFAULT '',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_client  ON invoices(client_name);
CREATE INDEX IF NOT EXISTS idx_invoices_date    ON invoices(billed_date DESC);

-- App config — replaces GAS PropertiesService
CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed defaults (safe to re-run — ON CONFLICT DO NOTHING)
INSERT INTO app_config (key, value) VALUES
  ('DEFAULT_STARTUP_TAB',   'dashboard'),
  ('DEFAULT_BILLING_TAB',   'ready'),
  ('DEFAULT_FEE_RATE',      '0'),
  ('DEFAULT_THEME',         'light'),
  ('DEFAULT_DASHBOARD_TIME','thisMonth'),
  ('VANTAGE_CUTOFF_DATE',   '2026-05-06')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- RLS: disable for internal tool (service role key used on server)
-- Enable row-level security but allow all for service role.
-- ============================================================
ALTER TABLE rms_cases       ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients         ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config      ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically.
-- Anon key needs explicit policies if client-side reads are needed.
-- For now: all reads/writes go through server routes with service role.
