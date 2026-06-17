import { createClient } from "@supabase/supabase-js";

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

export interface PeriodoElectricoRow {
  id: number;
  fecha_inicio: string;
  fecha_fin: string;
  kwh_bimestre: number;
  costo_total_mxn: number;
  costo_kwh_mxn: number | null;
  kwh_byd_periodo: number | null;
  proveedor: string | null;
  tarifa: string | null;
  numero_recibo: string | null;
  notas: string | null;
  created_at: string | null;
}

export interface MaintenanceRecordRow {
  id?: number;
  km_programado: number;
  meses_programado: number;
  costo_estimado: number;
  fecha_realizada: string;
  odometro_realizado: number;
  costo_real: number;
  agencia: string | null;
  notas: string | null;
  estado: string;
  created_at?: string | null;
}

export interface MaintenanceExtraCostRow {
  id: number;
  date: string;
  odometer: number | null;
  concept: string;
  category: string;
  cost: number;
  provider: string | null;
  notes: string | null;
  created_at?: string | null;
}

export interface CargaElectricaRow {
  id: number;
  fecha: string | null;
  odometro_km: number | null;
  porcentaje_inicio: number | null;
  porcentaje_fin: number | null;
  kwh_estimados: number | null;
  tarifa_kwh_mxn: number | null;
  costo_total_mxn: number | null;
  tipo_carga: string | null;
  notas: string | null;
  created_at: string | null;
}

// ── Client — lazy singleton ──────────────────────────────────────────────

let client: ReturnType<typeof createClient> | null = null;

export function getSupabaseClient() {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.error(
      "[Supabase] NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY no están definidos.",
      "Verifica que exista un archivo .env.local con ambas variables."
    );
    return null;
  }

  if (url.includes("TU_PROYECTO") || key.includes("TU_ANON_KEY")) {
    console.error("[Supabase] Las credenciales en .env.local aún tienen valores placeholder.");
    return null;
  }

  console.log("[Supabase] Cliente inicializado con URL:", url);
  client = createClient(url, key);
  return client;
}
