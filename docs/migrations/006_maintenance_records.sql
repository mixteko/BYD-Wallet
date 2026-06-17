-- Migration 006: Create maintenance_records table for BYD King service history
-- Run this in Supabase SQL Editor before using the Mantenimiento module.

CREATE TABLE IF NOT EXISTS maintenance_records (
  id                  BIGSERIAL PRIMARY KEY,
  km_programado       INTEGER       NOT NULL,
  meses_programado    INTEGER       NOT NULL,
  costo_estimado      NUMERIC(10,2) NOT NULL,
  fecha_realizada     DATE          NOT NULL,
  odometro_realizado  INTEGER       NOT NULL,
  costo_real          NUMERIC(10,2) NOT NULL,
  agencia             TEXT,
  notas               TEXT,
  estado              TEXT          NOT NULL DEFAULT 'completado',
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE maintenance_records ENABLE ROW LEVEL SECURITY;

-- Allow anonymous reads and writes (adjust to your auth setup)
CREATE POLICY "anon_select" ON maintenance_records
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_insert" ON maintenance_records
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_update" ON maintenance_records
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_delete" ON maintenance_records
  FOR DELETE TO anon USING (true);
