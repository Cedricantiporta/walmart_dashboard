-- Add GTIN, SKU ID, unit_amount, reimbursed_qty columns to rms_cases
-- Run in Supabase SQL editor

ALTER TABLE rms_cases
  ADD COLUMN IF NOT EXISTS gtin TEXT,
  ADD COLUMN IF NOT EXISTS sku_id TEXT,
  ADD COLUMN IF NOT EXISTS unit_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reimbursed_qty INTEGER DEFAULT 0;
