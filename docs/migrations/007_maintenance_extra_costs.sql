-- Migration: 007_maintenance_extra_costs
-- Created: v0.5.3.6
-- Purpose: store extra maintenance costs that are NOT part of the official
--          BYD King service calendar (filters, alignments, parts, labour, etc.)

CREATE TABLE IF NOT EXISTS maintenance_extra_costs (
  id          BIGSERIAL PRIMARY KEY,
  date        DATE          NOT NULL,
  odometer    INTEGER,
  concept     TEXT          NOT NULL,
  category    TEXT          NOT NULL,
  cost        NUMERIC(10,2) NOT NULL CHECK (cost >= 0),
  provider    TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_maintenance_extra_costs_updated_at ON maintenance_extra_costs;
CREATE TRIGGER trg_maintenance_extra_costs_updated_at
  BEFORE UPDATE ON maintenance_extra_costs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Row Level Security
ALTER TABLE maintenance_extra_costs ENABLE ROW LEVEL SECURITY;

-- Allow anon read (same pattern as maintenance_records)
CREATE POLICY "anon_select_maintenance_extra_costs"
  ON maintenance_extra_costs FOR SELECT
  TO anon
  USING (true);

-- Allow anon insert/update/delete (personal-use app, no auth)
CREATE POLICY "anon_insert_maintenance_extra_costs"
  ON maintenance_extra_costs FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "anon_update_maintenance_extra_costs"
  ON maintenance_extra_costs FOR UPDATE
  TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_delete_maintenance_extra_costs"
  ON maintenance_extra_costs FOR DELETE
  TO anon
  USING (true);

-- Useful index for ordering by date
CREATE INDEX IF NOT EXISTS idx_maintenance_extra_costs_date
  ON maintenance_extra_costs (date DESC);
