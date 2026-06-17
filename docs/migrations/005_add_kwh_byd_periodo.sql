-- Migration: add kwh_byd_periodo column to periodos_electricos
-- Run this in Supabase SQL editor

ALTER TABLE periodos_electricos
ADD COLUMN IF NOT EXISTS kwh_byd_periodo NUMERIC(10,2) DEFAULT 0;
