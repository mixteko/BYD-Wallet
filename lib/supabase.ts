import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ── Types matching Supabase tables ───────────────────────────────────────

export interface RecargaRow {
  id: number;
  fecha_hora: string | null;
  fecha: string;
  odometro_km: number;
  distancia_km: number | null;
  tipo_combustible: string | null;
  litros: number;
  precio_litro_mxn: number;
  costo_total_mxn: number;
  completar_tanque: boolean | null;
  tanque_pct: number | null;
  rendimiento_fuelio_km_l: number | null;
  costo_km_fuelio_mxn: number | null;
  gasolinera: string | null;
  notas: string | null;
  created_at: string | null;
}

export interface ConfiguracionRow {
  id?: number;
  vehiculo: string;
  modelo: number | string;
  bateria_kwh: number;
  tanque_litros: number;
  tarifa_cfe_mxn_kwh: number;
  odometro_inicial_km: number;
  odometro_actual_km: number;
}
