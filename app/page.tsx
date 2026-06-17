"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area,
  LineChart, Line, CartesianGrid, Legend, PieChart, Pie, Cell,
} from "recharts";
import { getSupabaseClient, type RecargaRow, type ConfiguracionRow, type PeriodoElectricoRow, type MaintenanceRecordRow, type MaintenanceExtraCostRow, type CargaElectricaRow } from "@/lib/supabase";

// ── App version ──────────────────────────────────────────────────────────────
const APP_VERSION = "0.6.2";

// ── Types ────────────────────────────────────────────────────────────────────
interface GasolinaEntry {
  id: string;
  fecha: string;
  litros: number;
  costo: number;
  kilometraje: number;
  concepto: string;
}

interface CargaEntry {
  id: string;
  fecha: string;
  tipo: "CCS2" | "AC 7kW" | "AC 22kW";
  pctInicial: number;
  pctFinal: number;
  kwhCargados: number;
  costo: number;
  costoPorKwh: number;
  kmEvObtenidos: number;
  notas?: string | null;
}

interface ChecklistItemState {
  id: string;
  realizado: boolean;
  nota?: string;
}

interface MantenimientoEntry {
  id: string;
  fecha: string;
  servicio: string;
  km: number;               // odómetro al realizar
  costo: number;            // alias of costoReal for backward compat
  estado: "completado" | "pendiente";
  // v0.5.3.1 extended fields
  kmProgramado?: number;
  mesesProgramado?: number;
  costoEstimado?: number;
  costoReal?: number;
  agencia?: string;
  notas?: string;
  // v0.5.3.2 checklist
  checklist?: ChecklistItemState[];
  // v0.5.3.4 adjunto
  adjunto?: {
    nombre: string;
    tipo: string;   // MIME type
    data: string;   // base64 data URL
  };
}

// v0.5.3.6 — extra maintenance costs (not part of official service calendar)
interface OtroCostoEntry {
  id: string;
  fecha: string;
  odometro?: number;
  concepto: string;
  categoria: string;
  costo: number;
  notas?: string;
  proveedor?: string;
}

const OTRAS_CATEGORIAS = [
  "Filtro de aire",
  "Filtro de cabina",
  "Alineación y balanceo",
  "Rotación de llantas",
  "Líquido de frenos",
  "Refacciones",
  "Mano de obra",
  "Otros",
] as const;

interface VehicleSettings {
  vehiculo: string;
  modelo: "king-gl" | "king-gs" | "personalizado";
  capacidadBateria: number;
  tipoCargador: "portatil110" | "portatil220" | "wallbox" | "publicaAC" | "publicaDC" | "otro";
  rendimientoKmL: number;
  rendimientoKmKwh: number;
  precioGasolina: number;
  totalKm: number;
}

type Section = "dashboard" | "gasolina" | "cargas" | "mantenimiento" | "historial" | "tickets" | "reportes" | "energia";

type FormModal = "gasolina" | "carga" | "mantenimiento" | "ticket" | "settings" | "recibo" | null;

type HistoryPeriodFilter = "hoy" | "semana" | "mes" | "ano";
type HistoryCategoryFilter = "todos" | "gasolina" | "electricidad" | "mantenimiento" | "otros" | "cfe";

interface HistoryRow {
  id: string;
  fecha: string;
  fecha_hora?: string | null;
  tipo: string;
  descripcion: string;
  importe: number;
  observaciones: string;
  category: HistoryCategoryFilter;
  sortKey: number;
  onViewDetail: () => void;
}

interface TicketEntry {
  id: string;
  fecha: string;
  titulo: string;
  categoria: "gasolina" | "carga" | "mantenimiento" | "otro";
  proveedor: string;
  monto: number;
  imageBase64: string;
  ocrText: string | null;
  ocrProcesado: boolean;
}

// ── localStorage helpers ──────────────────────────────────────────────────────
const KEYS = {
  gasolina: "byd-gasolina",
  cargas: "byd-cargas",
  mantenimiento: "byd-mantenimiento",
  otrosCostos: "byd-otros-costos",
  settings: "byd-settings",
  tickets: "byd-tickets",
} as const;

function loadData<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveData<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // storage full or unavailable
  }
}

// ── Default settings (used when no config saved) ─────────────────────────
const DEFAULT_SETTINGS: VehicleSettings = {
  vehiculo: "BYD King DM-i",
  modelo: "king-gl",
  capacidadBateria: 8.3,
  tipoCargador: "wallbox",
  rendimientoKmL: 18.5,
  rendimientoKmKwh: 6.2,
  precioGasolina: 1250,
  totalKm: 15000,
};

// ── Initialize only settings on first mount ──────────────────────────────
function initializeData(): void {
  if (typeof window === "undefined") return;
  if (!localStorage.getItem(KEYS.settings)) {
    saveData(KEYS.settings, DEFAULT_SETTINGS);
  }
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Normaliza una fecha string a un objeto Date usando parseo manual.
 * SOPORTA:
 *   YYYY-MM-DD         → 2026-03-29
 *   YYYY-MM-DDTHH:mm:ss → 2026-03-29T17:48:00
 *   DD/MM/YY           → 29/03/26
 *   DD/MM/YYYY         → 29/03/2026
 * NUNCA usa new Date(string) sobre strings ambiguos.
 * Devuelve null si la fecha es inválida.
 */
function normalizeDate(fecha: string | null | undefined): Date | null {
  if (!fecha) return null;
  const s = fecha.trim();

  // YYYY-MM-DD o YYYY-MM-DDTHH:mm:ss
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    const date = new Date(y, m, d);
    // Validate: the constructor won't throw but may wrap; check components
    if (
      date.getFullYear() === y &&
      date.getMonth() === m &&
      date.getDate() === d
    ) {
      return date;
    }
    return null;
  }

  // DD/MM/YY
  const dmy2Match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (dmy2Match) {
    const day = parseInt(dmy2Match[1], 10);
    const month = parseInt(dmy2Match[2], 10) - 1;
    let year = parseInt(dmy2Match[3], 10);
    year += year >= 50 ? 1900 : 2000;
    const date = new Date(year, month, day);
    if (
      date.getFullYear() === year &&
      date.getMonth() === month &&
      date.getDate() === day
    ) {
      return date;
    }
    return null;
  }

  // DD/MM/YYYY
  const dmy4Match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy4Match) {
    const day = parseInt(dmy4Match[1], 10);
    const month = parseInt(dmy4Match[2], 10) - 1;
    const year = parseInt(dmy4Match[3], 10);
    const date = new Date(year, month, day);
    if (
      date.getFullYear() === year &&
      date.getMonth() === month &&
      date.getDate() === day
    ) {
      return date;
    }
    return null;
  }

  return null;
}

/**
 * Formatea una fecha a DD/MM/YYYY usando México.
 * Devuelve null si la fecha es inválida.
 */
function formatDateOnlyMX(fecha: string | null | undefined): string | null {
  const d = normalizeDate(fecha);
  if (!d) return null;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatFechaMX(fecha: string | null | undefined, fecha_hora: string | null | undefined): string {
  const d = normalizeDate(fecha) || normalizeDate(fecha_hora);
  if (!d) return "Sin fecha";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function dateSortValue(fecha: string): number {
  const d = normalizeDate(fecha);
  return d ? d.getTime() : 0;
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function isThisWeek(d: Date, ref: Date): boolean {
  const startOfWeek = new Date(ref);
  startOfWeek.setDate(ref.getDate() - ((ref.getDay() + 6) % 7));
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);
  return d >= startOfWeek && d < endOfWeek;
}

function isThisMonth(d: Date, ref: Date): boolean {
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

function isThisYear(d: Date, ref: Date): boolean {
  return d.getFullYear() === ref.getFullYear();
}

// ── Supabase data fetching ───────────────────────────────────────────────────
async function fetchRecargasFromSupabase(): Promise<RecargaRow[]> {
  console.log("[BYD Wallet] Consultando recargas desde Supabase...");
  const sb = getSupabaseClient();
  if (!sb) {
    console.warn("[BYD Wallet] Cliente Supabase no disponible (credenciales faltantes).");
    console.log("[BYD Wallet] NEXT_PUBLIC_SUPABASE_URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);
    console.log("[BYD Wallet] NEXT_PUBLIC_SUPABASE_ANON_KEY:", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "✓ definida" : "✗ faltante");
    return [];
  }
  const { data, error } = await sb
    .from("recargas")
    .select("*")
    .order("fecha", { ascending: false });

  if (error) {
    console.error("[BYD Wallet] Error al consultar recargas:", error);
    return [];
  }

  console.log("[BYD Wallet] Recargas obtenidas:", data?.length ?? 0, "registros");
  if (data && data.length > 0) {
    console.log("[BYD Wallet] Primera recarga:", data[0]);
    console.log("[BYD Wallet] Última recarga:", data[data.length - 1]);
  }
  return data || [];
}

async function fetchCargasElectricasFromSupabase(): Promise<CargaElectricaRow[]> {
  console.log("[BYD Wallet] Consultando cargas_electricas desde Supabase...");
  const sb = getSupabaseClient();
  if (!sb) {
    console.warn("[BYD Wallet] Cliente Supabase no disponible para cargas_electricas.");
    return [];
  }
  const { data, error } = await sb
    .from("cargas_electricas")
    .select("*")
    .order("fecha", { ascending: false });

  if (error) {
    console.error("[BYD Wallet] Error al consultar cargas_electricas:", error);
    return [];
  }

  console.log("[BYD Wallet] Cargas eléctricas obtenidas:", data?.length ?? 0, "registros");
  return (data || []) as CargaElectricaRow[];
}

async function insertCargaElectrica(
  row: Omit<CargaElectricaRow, "id" | "created_at">
): Promise<{ id: number | null; error: string | null }> {
  const sb = getSupabaseClient();
  if (!sb) {
    return { id: null, error: "Cliente Supabase no disponible. Verifica .env.local" };
  }

  const { data, error } = await sb
    .from("cargas_electricas")
    .insert(row as never)
    .select("id")
    .single();

  if (error) {
    const isRls = error.code === "42501" || error.message.toLowerCase().includes("row-level security");
    const userMessage = isRls
      ? "Supabase bloqueó el INSERT por RLS en cargas_electricas. Ejecuta docs/migrations/008_cargas_electricas_rls_write.sql en el SQL Editor."
      : error.message;
    console.error("[BYD Wallet] Error al insertar carga eléctrica:", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      payload: row,
    });
    return { id: null, error: userMessage };
  }

  const id = (data as { id: number } | null)?.id ?? null;
  console.log("[BYD Wallet] Carga eléctrica insertada correctamente (id:", id, ")");
  return { id, error: null };
}

async function updateCargaElectrica(
  id: number,
  row: Omit<CargaElectricaRow, "id" | "created_at">
): Promise<{ error: string | null }> {
  const sb = getSupabaseClient();
  if (!sb) {
    return { error: "Cliente Supabase no disponible. Verifica .env.local" };
  }

  const { error } = await sb.from("cargas_electricas").update(row as never).eq("id", id);
  if (error) {
    console.error("[BYD Wallet] Error al actualizar carga eléctrica:", { id, message: error.message, payload: row });
    return { error: error.message };
  }
  console.log("[BYD Wallet] Carga eléctrica actualizada (id:", id, ")");
  return { error: null };
}

async function deleteCargaElectrica(id: number): Promise<{ error: string | null }> {
  const sb = getSupabaseClient();
  if (!sb) {
    return { error: "Cliente Supabase no disponible. Verifica .env.local" };
  }

  const { error } = await sb.from("cargas_electricas").delete().eq("id", id);
  if (error) {
    console.error("[BYD Wallet] Error al eliminar carga eléctrica:", { id, message: error.message });
    return { error: error.message };
  }
  console.log("[BYD Wallet] Carga eléctrica eliminada (id:", id, ")");
  return { error: null };
}

function isCargaSupabaseDb(id: string): boolean {
  return /^\d+$/.test(id);
}

function cargaEntryToDbRow(entry: CargaEntry): Omit<CargaElectricaRow, "id" | "created_at"> {
  return {
    fecha: entry.fecha,
    odometro_km: null,
    porcentaje_inicio: entry.pctInicial,
    porcentaje_fin: entry.pctFinal,
    kwh_estimados: entry.kwhCargados,
    tarifa_kwh_mxn: entry.costoPorKwh,
    costo_total_mxn: entry.costo,
    tipo_carga: entry.tipo,
    notas: entry.notas ?? null,
  };
}

function mapRecargaEvToCargaEntry(r: RecargaRow, rendimientoKmKwh: number): CargaEntry {
  const kwhFromDist = Number(r.distancia_km || 0) / rendimientoKmKwh;
  return {
    id: `recarga-${r.id}`,
    fecha: r.fecha,
    tipo: "CCS2",
    pctInicial: 0,
    pctFinal: 100,
    kwhCargados: Math.round(kwhFromDist * 10) / 10,
    costo: Number(r.costo_total_mxn),
    costoPorKwh: Number(r.precio_litro_mxn) || 0,
    kmEvObtenidos: Number(r.distancia_km || 0),
  };
}

function mapCargaElectricaToEntry(r: CargaElectricaRow, rendimientoKmKwh: number): CargaEntry {
  const kwh = Number(r.kwh_estimados || 0);
  const costo = Number(r.costo_total_mxn || 0);
  const tipo = (r.tipo_carga === "AC 7kW" || r.tipo_carga === "AC 22kW" || r.tipo_carga === "CCS2")
    ? r.tipo_carga
    : "CCS2";
  return {
    id: String(r.id),
    fecha: r.fecha || "",
    tipo,
    pctInicial: Number(r.porcentaje_inicio || 0),
    pctFinal: Number(r.porcentaje_fin || 100),
    kwhCargados: kwh,
    costo,
    costoPorKwh: Number(r.tarifa_kwh_mxn || 0) || (kwh > 0 ? Math.round(costo / kwh) : 0),
    kmEvObtenidos: kwh > 0 ? Math.round(kwh * rendimientoKmKwh) : 0,
    notas: r.notas,
  };
}

async function fetchConfigFromSupabase(): Promise<ConfiguracionRow | null> {
  console.log("[BYD Wallet] Consultando configuracion desde Supabase...");
  const sb = getSupabaseClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from("configuracion")
    .select("*")
    .limit(1);

  if (error) {
    console.error("[BYD Wallet] Error al consultar configuracion:", error);
    return null;
  }

  const config = (data && data[0]) || null;
  console.log("[BYD Wallet] Configuración obtenida:", config);
  return config;
}

async function fetchPeriodosElectricosFromSupabase(): Promise<PeriodoElectricoRow[]> {
  console.log("[BYD Wallet] Consultando periodos_electricos desde Supabase...");
  const sb = getSupabaseClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from("periodos_electricos")
    .select("*")
    .order("fecha_fin", { ascending: false })
    .order("fecha_inicio", { ascending: false });

  if (error) {
    console.warn("[BYD Wallet] Error al consultar periodos_electricos:", error.message);
    return [];
  }

  const periodos = (data || []) as PeriodoElectricoRow[];
  console.log("[BYD Wallet] Periodos eléctricos encontrados:", periodos.length);

  if (periodos.length > 0) {
    const ultimo = periodos[0];
    console.log("[BYD Wallet] Último periodo — costo_kwh_mxn:", ultimo.costo_kwh_mxn);
  }

  return periodos;
}

async function fetchMaintenanceRecordsFromSupabase(): Promise<MaintenanceRecordRow[]> {
  const sb = getSupabaseClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from("maintenance_records")
    .select("*")
    .order("fecha_realizada", { ascending: false });
  if (error) {
    console.warn("[BYD Wallet] Error al consultar maintenance_records:", error.message);
    return [];
  }
  return (data || []) as MaintenanceRecordRow[];
}

async function fetchMaintenanceExtraCostsFromSupabase(): Promise<MaintenanceExtraCostRow[]> {
  const sb = getSupabaseClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from("maintenance_extra_costs")
    .select("*")
    .order("date", { ascending: false });
  if (error) {
    console.warn("[BYD Wallet] Error al consultar maintenance_extra_costs:", error.message);
    return [];
  }
  return (data || []) as MaintenanceExtraCostRow[];
}

async function insertPeriodoElectrico(row: Omit<PeriodoElectricoRow, "id" | "created_at" | "costo_kwh_mxn">): Promise<boolean> {
  const sb = getSupabaseClient();
  if (!sb) return false;

  // Check for overlapping periods
  const { data: existing } = await sb
    .from("periodos_electricos")
    .select("id, fecha_inicio, fecha_fin");
  if (existing) {
    for (const p of existing as { id: number; fecha_inicio: string; fecha_fin: string }[]) {
      if (row.fecha_inicio <= p.fecha_fin && row.fecha_fin >= p.fecha_inicio) {
        console.error("[BYD Wallet] Traslape detectado con periodo id:", p.id, p.fecha_inicio, "-", p.fecha_fin);
        return false;
      }
    }
  }

  const { error } = await sb.from("periodos_electricos").insert(row as never);
  if (error) {
    console.error("[BYD Wallet] Error al insertar periodo eléctrico:", error.message);
    return false;
  }
  return true;
}

async function updatePeriodoElectrico(
  id: number,
  row: Omit<PeriodoElectricoRow, "id" | "created_at" | "costo_kwh_mxn">
): Promise<boolean> {
  const sb = getSupabaseClient();
  if (!sb) return false;

  // Check for overlapping periods (exclude self)
  const { data: existing } = await sb
    .from("periodos_electricos")
    .select("id, fecha_inicio, fecha_fin")
    .neq("id", id);
  if (existing) {
    for (const p of existing as { id: number; fecha_inicio: string; fecha_fin: string }[]) {
      if (row.fecha_inicio <= p.fecha_fin && row.fecha_fin >= p.fecha_inicio) {
        console.error("[BYD Wallet] Traslape detectado con periodo id:", p.id, p.fecha_inicio, "-", p.fecha_fin);
        return false;
      }
    }
  }

  console.log("[BYD Wallet] Actualizando periodo eléctrico:", { id, payload: row });
  const { error } = await sb.from("periodos_electricos").update(row as never).eq("id", id);
  if (error) {
    console.error("[BYD Wallet] Error al actualizar periodo eléctrico:", { id, payload: row, error: error.message });
    return false;
  }
  console.log("[BYD Wallet] Periodo eléctrico actualizado correctamente (id:", id, ")");
  return true;
}

async function deletePeriodoElectrico(id: number): Promise<boolean> {
  const sb = getSupabaseClient();
  if (!sb) return false;
  const { error } = await sb.from("periodos_electricos").delete().eq("id", id);
  if (error) {
    console.error("[BYD Wallet] Error al eliminar periodo eléctrico:", error.message);
    return false;
  }
  return true;
}

// ── Supabase: maintenance_records ────────────────────────────────────────────
async function insertMaintenanceRecord(
  row: Omit<MaintenanceRecordRow, "id" | "created_at">
): Promise<number | null> {
  const sb = getSupabaseClient();
  if (!sb) return null;
  const { data, error } = await sb.from("maintenance_records").insert(row as never).select("id").single();
  if (error) {
    console.error("[BYD Wallet] Error al insertar maintenance_record:", error.message);
    return null;
  }
  return (data as { id: number } | null)?.id ?? null;
}

async function updateMaintenanceRecord(
  id: number,
  row: Partial<Omit<MaintenanceRecordRow, "id" | "created_at">>
): Promise<boolean> {
  const sb = getSupabaseClient();
  if (!sb) return false;
  const { error } = await sb.from("maintenance_records").update(row as never).eq("id", id);
  if (error) {
    console.error("[BYD Wallet] Error al actualizar maintenance_record:", error.message);
    return false;
  }
  return true;
}

async function deleteMaintenanceRecord(id: number): Promise<boolean> {
  const sb = getSupabaseClient();
  if (!sb) return false;
  const { error } = await sb.from("maintenance_records").delete().eq("id", id);
  if (error) {
    console.error("[BYD Wallet] Error al eliminar maintenance_record:", error.message);
    return false;
  }
  return true;
}

// ── KPI computation from Supabase data ───────────────────────────────────────
function computeKpisFromRecargas(recargas: RecargaRow[], config: ConfiguracionRow | null) {
  console.log("[BYD Wallet] Calculando KPIs con", recargas.length, "recargas");

  const now = new Date();

  const totalGasolina = recargas.reduce((sum, r) => sum + Number(r.costo_total_mxn || 0), 0);
  const totalLitros = recargas.reduce((sum, r) => sum + Number(r.litros || 0), 0);
  const numRecargas = recargas.length;

  const odometroActual = recargas.length > 0
    ? Math.max(...recargas.map((r) => Number(r.odometro_km || 0)))
    : (config?.odometro_actual_km || 0);

  const odometroInicial = recargas.length > 0
    ? Math.min(...recargas.map((r) => Number(r.odometro_km || 0)))
    : 0;
  const kmRecorridos = odometroActual - odometroInicial;
  const costoPorKm = kmRecorridos > 0
    ? Math.round((totalGasolina / kmRecorridos) * 100) / 100
    : 0;

  const precioPromedioLitros = numRecargas > 0
    ? recargas.reduce((sum, r) => sum + Number(r.precio_litro_mxn || 0), 0) / numRecargas
    : 0;

  // Date-based KPI calculations
  let gastoHoy = 0;
  let gastoSemanal = 0;
  let gastoMensual = 0;
  let gastoAnual = 0;

  for (const r of recargas) {
    const d = normalizeDate(r.fecha);
    if (!d) continue;
    const costo = Number(r.costo_total_mxn || 0);
    if (isSameDay(d, now)) gastoHoy += costo;
    if (isThisWeek(d, now)) gastoSemanal += costo;
    if (isThisMonth(d, now)) gastoMensual += costo;
    if (isThisYear(d, now)) gastoAnual += costo;
  }

  console.log("[BYD Wallet] KPIs:", {
    odometroActual,
    totalGasolina,
    totalLitros,
    numRecargas,
    costoPorKm,
    gastoHoy,
    gastoSemanal,
    gastoMensual,
    gastoAnual,
  });

  return {
    gastoHoy,
    gastoSemanal,
    gastoMensual,
    gastoAnual,
    gastoTotal: totalGasolina,
    costoPorKm,
    rendimientoKmL: kmRecorridos > 0 && totalLitros > 0
      ? Math.round((kmRecorridos / totalLitros) * 10) / 10
      : 18.5,
    rendimientoKmKwh: config?.bateria_kwh ? 6.2 : 6.2,
    ahorroAcumulado: 0,
    vehiculo: config?.vehiculo || "BYD King",
    totalKm: kmRecorridos,
    odometroActual,
    totalGasolina,
    totalLitros,
    numRecargas,
    precioPromedioLitros,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const MONTHS = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDecimal(n: number, d: number = 1): string {
  return n.toFixed(d);
}

function formatDate(iso: string): string {
  const d = normalizeDate(iso);
  if (!d) return "Fecha inválida";
  return d.toLocaleDateString("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateShort(iso: string): string {
  const d = normalizeDate(iso);
  if (!d) return "Fecha inválida";
  const now = new Date();
  if (isSameDay(d, now)) return "Hoy";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, yesterday)) return "Ayer";
  return d.toLocaleDateString("es-CL", { day: "numeric", month: "short" });
}

// ── KPI Icons ────────────────────────────────────────────────────────────

function IconDollar() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-byd-400/70">
      <line x1="12" y1="2" x2="12" y2="22" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-byd-400/70">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function IconTrending() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-byd-400/70">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

function IconTotal() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-byd-400/70">
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

function IconRoute() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-byd-400/70">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconFuel() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-byd-400/70">
      <line x1="3" y1="5" x2="3" y2="19" />
      <line x1="21" y1="5" x2="21" y2="19" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="5" x2="21" y2="5" />
      <line x1="3" y1="19" x2="21" y2="19" />
    </svg>
  );
}

function IconBolt() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-byd-400/70">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-byd-400/70">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  color = "text-white",
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  icon?: React.ReactNode;
}) {
  const isZero = value === "$0.00" || value === "$0" || value === "0" || value === "$0.0";
  return (
    <div className={`relative overflow-hidden rounded-xl border ${isZero ? "border-white/[0.03]" : "border-white/5"} bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-3 backdrop-blur-xl transition-all duration-300 hover:border-byd-500/30 hover:shadow-[0_0_20px_-8px_rgba(18,184,160,0.25)] sm:p-4`}>
      <div className="flex items-start justify-between">
        <p className={`text-[10px] font-medium uppercase tracking-widest sm:text-[11px] ${isZero ? "text-white/25" : "text-white/40"}`}>
          {label}
        </p>
        {icon && (
          <span className={`flex items-center justify-center rounded-md p-1 ${isZero ? "bg-white/[0.03] text-white/20" : "bg-byd-500/10 text-byd-400"}`}>
            {icon}
          </span>
        )}
      </div>
      <p className={`mt-0.5 text-base font-semibold tracking-tight sm:text-xl ${isZero ? "text-white/20" : color}`}>
        {value}
      </p>
      {sub && <p className={`mt-0.5 text-[10px] sm:text-[11px] ${isZero ? "text-white/15" : "text-white/30"}`}>{sub}</p>}
    </div>
  );
}

function NavTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all duration-200 ${
        active
          ? "bg-byd-500/15 text-byd-400 shadow-[inset_0_0_0_1px_rgba(18,184,160,0.25)]"
          : "text-white/40 hover:bg-white/[0.04] hover:text-white/70"
      }`}
    >
      {label}
    </button>
  );
}

function Tag({ children, variant }: { children: React.ReactNode; variant?: "green" | "amber" }) {
  const cls =
    variant === "green"
      ? "bg-emerald-500/10 text-emerald-400"
      : variant === "amber"
        ? "bg-amber-500/10 text-amber-400"
        : "bg-white/5 text-white/50";
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" className="shrink-0">
      <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 18 18)"
        className="text-byd-400 transition-all duration-700"
      />
      <text x="18" y="18" textAnchor="middle" dominantBaseline="central" className="fill-white text-[8px] font-bold">
        {pct}
      </text>
    </svg>
  );
}

// ── Modal component ──────────────────────────────────────────────────────────
function Modal({
  isOpen,
  onClose,
  title,
  children,
  wide = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative my-3 w-full rounded-xl border border-white/10 bg-[#0d1117] p-3 shadow-2xl sm:p-4 ${wide ? "max-w-[880px]" : "max-w-md"}`}>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-white/80">{title}</h3>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Form Components ──────────────────────────────────────────────────────────
function GasolinaForm({
  onSave,
  onClose,
  initialData,
  isEdit,
}: {
  onSave: (entry: GasolinaEntry) => void;
  onClose: () => void;
  initialData?: GasolinaEntry | null;
  isEdit?: boolean;
}) {
  const [litros, setLitros] = useState(initialData ? String(initialData.litros) : "");
  const [costo, setCosto] = useState(initialData ? String(initialData.costo) : "");
  const [kilometraje, setKilometraje] = useState(initialData ? String(initialData.kilometraje) : "");
  const [concepto, setConcepto] = useState(initialData?.concepto || "");
  const [fecha, setFecha] = useState(initialData?.fecha || new Date().toISOString().split("T")[0]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const entry: GasolinaEntry = {
      id: initialData?.id || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)),
      fecha,
      litros: parseFloat(litros) || 0,
      costo: parseInt(costo) || 0,
      kilometraje: parseInt(kilometraje) || 0,
      concepto,
    };
    onSave(entry);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <InputField label="Fecha" type="date" value={fecha} onChange={setFecha} required />
      <InputField label="Litros" type="number" step="0.1" value={litros} onChange={setLitros} required />
      <InputField label="Costo ($)" type="number" value={costo} onChange={setCosto} required />
      <InputField label="Kilometraje" type="number" value={kilometraje} onChange={setKilometraje} required />
      <InputField label="Gasolinera" type="text" value={concepto} onChange={setConcepto} placeholder="Ej. Pemex, Shell..." required />
      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/60 transition-colors hover:bg-white/10">
          Cancelar
        </button>
        <button type="submit" className="flex-1 rounded-lg bg-byd-500 px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-byd-400">
          {isEdit ? "Actualizar" : "Guardar"}
        </button>
      </div>
    </form>
  );
}

function CargaForm({
  onSave,
  onClose,
  saving = false,
  externalError = null,
  initialData,
  isEdit,
}: {
  onSave: (entry: CargaEntry) => void | Promise<void>;
  onClose: () => void;
  saving?: boolean;
  externalError?: string | null;
  initialData?: CargaEntry | null;
  isEdit?: boolean;
}) {
  const [tipo, setTipo] = useState<"CCS2" | "AC 7kW" | "AC 22kW">(initialData?.tipo ?? "CCS2");
  const [fecha, setFecha] = useState(initialData?.fecha ?? new Date().toISOString().split("T")[0]);
  const [pctInicial, setPctInicial] = useState(initialData != null ? String(initialData.pctInicial) : "");
  const [pctFinal, setPctFinal] = useState(initialData != null ? String(initialData.pctFinal) : "");
  const [costoTotal, setCostoTotal] = useState(initialData != null ? String(initialData.costo) : "");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const settings = loadData<VehicleSettings>(KEYS.settings, DEFAULT_SETTINGS);
  const capacidadBateria = settings.capacidadBateria || 8.3;

  const pctIni = parseFloat(pctInicial) || 0;
  const pctFin = parseFloat(pctFinal) || 0;
  const pctCargado = Math.max(0, pctFin - pctIni);
  const kwhCargados = pctCargado > 0 ? Math.round(((pctCargado / 100) * capacidadBateria) * 10) / 10 : 0;
  const costo = parseInt(costoTotal) || 0;
  const costoPorKwh = kwhCargados > 0 ? Math.round(costo / kwhCargados) : 0;
  const kmEvObtenidos = kwhCargados > 0 ? Math.round(kwhCargados * settings.rendimientoKmKwh) : 0;
  const displayError = formError || externalError;
  const busy = saving || isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!fecha.trim()) {
      setFormError("La fecha es requerida.");
      return;
    }
    if (pctInicial === "" || pctFinal === "") {
      setFormError("Indica el porcentaje inicial y final de batería.");
      return;
    }
    if (pctFin <= pctIni) {
      setFormError("El porcentaje final debe ser mayor al inicial.");
      return;
    }
    if (kwhCargados <= 0) {
      setFormError("Los kWh calculados deben ser mayores a 0.");
      return;
    }
    if (costo <= 0) {
      setFormError("El costo total debe ser mayor a 0.");
      return;
    }

    const entry: CargaEntry = {
      id: initialData?.id || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)),
      fecha,
      tipo,
      pctInicial: pctIni,
      pctFinal: pctFin,
      kwhCargados,
      costo,
      costoPorKwh,
      kmEvObtenidos,
      notas: initialData?.notas ?? null,
    };

    setIsSubmitting(true);
    try {
      await onSave(entry);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo guardar la carga eléctrica.";
      setFormError(message);
      console.error("[BYD Wallet] Error en formulario Carga EV:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <InputField label="Fecha" type="date" value={fecha} onChange={setFecha} required />
      <div>
        <label className="mb-1 block text-xs font-medium text-white/50">Tipo de carga</label>
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as "CCS2" | "AC 7kW" | "AC 22kW")}
          className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-white outline-none transition-colors focus:border-byd-500/50"
        >
          <option value="CCS2">CCS2 — Carga rápida</option>
          <option value="AC 7kW">AC 7kW — Carga lenta</option>
          <option value="AC 22kW">AC 22kW — Carga semi-rápida</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <InputField label="Batería % inicial" type="number" min="0" max="100" value={pctInicial} onChange={setPctInicial} required />
        <InputField label="Batería % final" type="number" min="0" max="100" value={pctFinal} onChange={setPctFinal} required />
      </div>

      {/* Auto-calculated fields */}
      <div className="rounded-xl border border-byd-500/20 bg-byd-500/5 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10px] font-medium uppercase tracking-wider text-byd-400">Cálculo automático</p>
          <span className="text-[10px] text-white/30">{capacidadBateria} kWh bat.</span>
        </div>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-white/40">kWh cargados</span>
            <span className="font-semibold text-white">{kwhCargados} kWh</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Costo por kWh</span>
            <span className="font-semibold text-white">{formatCurrency(costoPorKwh)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">km EV obtenidos</span>
            <span className="font-semibold text-white">{kmEvObtenidos.toLocaleString()} km</span>
          </div>
        </div>
      </div>

      <InputField label="Costo total ($)" type="number" value={costoTotal} onChange={setCostoTotal} required />
      {displayError && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {displayError}
        </p>
      )}
      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onClose} disabled={busy} className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/60 transition-colors hover:bg-white/10 disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" disabled={busy} className="flex-1 rounded-lg bg-byd-500 px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-byd-400 disabled:opacity-50">
          {busy ? "Guardando..." : isEdit ? "Actualizar" : "Guardar"}
        </button>
      </div>
    </form>
  );
}

function MantenimientoForm({
  onSave,
  onClose,
}: {
  onSave: (entry: MantenimientoEntry) => void;
  onClose: () => void;
}) {
  const [servicio, setServicio] = useState("");
  const [km, setKm] = useState("");
  const [costo, setCosto] = useState("");
  const [estado, setEstado] = useState<"completado" | "pendiente">("pendiente");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const entry: MantenimientoEntry = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
      fecha: new Date().toISOString().split("T")[0],
      servicio,
      km: parseInt(km) || 0,
      costo: parseInt(costo) || 0,
      estado,
    };
    onSave(entry);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <InputField label="Servicio" type="text" value={servicio} onChange={setServicio} required />
      <InputField label="Kilometraje (km)" type="number" value={km} onChange={setKm} required />
      <InputField label="Costo ($)" type="number" value={costo} onChange={setCosto} required />
      <div>
        <label className="mb-1 block text-xs font-medium text-white/50">Estado</label>
        <select
          value={estado}
          onChange={(e) => setEstado(e.target.value as "completado" | "pendiente")}
          className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-white outline-none transition-colors focus:border-byd-500/50"
        >
          <option value="pendiente">Pendiente</option>
          <option value="completado">Completado</option>
        </select>
      </div>
      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/60 transition-colors hover:bg-white/10">
          Cancelar
        </button>
        <button type="submit" className="flex-1 rounded-lg bg-byd-500 px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-byd-400">
          Guardar
        </button>
      </div>
    </form>
  );
}

function TicketForm({
  onSave,
  onClose,
}: {
  onSave: (entry: TicketEntry) => void;
  onClose: () => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [categoria, setCategoria] = useState<TicketEntry["categoria"]>("otro");
  const [proveedor, setProveedor] = useState("");
  const [monto, setMonto] = useState("");
  const [imageBase64, setImageBase64] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("La imagen no debe superar 5 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      setImageBase64(result);
      setPreview(result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageBase64) return;
    const entry: TicketEntry = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
      fecha: new Date().toISOString().split("T")[0],
      titulo,
      categoria,
      proveedor,
      monto: parseInt(monto) || 0,
      imageBase64,
      ocrText: null,
      ocrProcesado: false,
    };
    onSave(entry);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <InputField label="Título" type="text" value={titulo} onChange={setTitulo} placeholder="ej. Carga de gasolina" required />
      <div>
        <label className="mb-1 block text-xs font-medium text-white/50">Categoría</label>
        <select
          value={categoria}
          onChange={(e) => setCategoria(e.target.value as TicketEntry["categoria"])}
          className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-white outline-none transition-colors focus:border-byd-500/50"
        >
          <option value="gasolina">Gasolina</option>
          <option value="carga">Carga eléctrica</option>
          <option value="mantenimiento">Mantenimiento</option>
          <option value="otro">Otro</option>
        </select>
      </div>
      <InputField label="Proveedor" type="text" value={proveedor} onChange={setProveedor} placeholder="ej. Copec, EnelX" />
      <InputField label="Monto ($)" type="number" value={monto} onChange={setMonto} />
      <div>
        <label className="mb-1 block text-xs font-medium text-white/50">Imagen del ticket</label>
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/10 bg-white/[0.03] py-6 transition-colors hover:border-byd-500/30 hover:bg-white/[0.06]">
          {preview ? (
            <img src={preview} alt="Vista previa" className="max-h-40 rounded-lg object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-white/40">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span className="text-xs">Toca para subir imagen</span>
              <span className="text-[10px]">PNG, JPG hasta 5 MB</span>
            </div>
          )}
          <input type="file" accept="image/*" onChange={handleFile} className="hidden" />
        </label>
      </div>
      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/60 transition-colors hover:bg-white/10">
          Cancelar
        </button>
        <button type="submit" disabled={!imageBase64} className="flex-1 rounded-lg bg-byd-500 px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-byd-400 disabled:opacity-40">
          Guardar ticket
        </button>
      </div>
    </form>
  );
}

// ── Settings form ────────────────────────────────────────────────────────────
function SettingsForm({
  settings,
  onSave,
  onClose,
  onReset,
  onResetSettings,
}: {
  settings: VehicleSettings;
  onSave: (s: VehicleSettings) => void;
  onClose: () => void;
  onReset?: () => void;
  onResetSettings?: () => void;
}) {
  const [modelo, setModelo] = useState(settings.modelo);
  const [capacidadBateria, setCapacidadBateria] = useState(String(settings.capacidadBateria));
  const [totalKm, setTotalKm] = useState(String(settings.totalKm));

  const capacidad =
    modelo === "king-gl" ? 8.3
    : modelo === "king-gs" ? parseFloat(capacidadBateria) || 0
    : parseFloat(capacidadBateria) || 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...settings,
      modelo,
      capacidadBateria: capacidad,
      totalKm: parseInt(totalKm) || 0,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-white/50">Modelo del vehículo</label>
        <select value={modelo} onChange={(e) => setModelo(e.target.value as VehicleSettings["modelo"])}
          className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-white outline-none transition-colors focus:border-byd-500/50">
          <option value="king-gl">BYD King GL</option>
          <option value="king-gs">BYD King GS — Configurable</option>
          <option value="personalizado">Personalizado</option>
        </select>
      </div>

      {/* Battery capacity */}
      <div>
        <label className="mb-1 block text-xs font-medium text-white/50">
          Capacidad de batería
        </label>
        {modelo === "king-gl" ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white/50">
            BYD King GL
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.1"
              min="1"
              value={capacidadBateria}
              onChange={(e) => setCapacidadBateria(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-white outline-none transition-colors focus:border-byd-500/50"
              required
            />
          </div>
        )}
      </div>

      {modelo !== "king-gl" && (
        <div className="rounded-xl border border-byd-500/20 bg-byd-500/5 p-3 text-center text-sm text-byd-400">
          Capacidad: <strong>{capacidad}</strong>
        </div>
      )}

      {/* Vehicle specs info block */}
      <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3 text-sm">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-white/40">
          Especificaciones
        </p>
        <div className="space-y-1 text-white/60">
          <div className="flex justify-between">
            <span>Batería</span>
            <span className="font-medium text-white/80">{capacidad} kWh</span>
          </div>
          <div className="flex justify-between">
            <span>Autonomía EV estimada</span>
            <span className="font-medium text-white/80">50 km</span>
          </div>
          <div className="flex justify-between">
            <span>Autonomía combinada estimada</span>
            <span className="font-medium text-white/80">1,175 km</span>
          </div>
        </div>
      </div>

      <InputField label="Kilometraje total del vehículo" type="number" value={totalKm} onChange={setTotalKm} required />

      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/60 transition-colors hover:bg-white/10">
          Cancelar
        </button>
        <button type="submit" className="flex-1 rounded-lg bg-byd-500 px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-byd-400">
          Guardar configuración
        </button>
      </div>

      <div className="border-t border-white/5 pt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => {
            if (confirm("¿Seguro que quieres borrar todos los datos?\n\nEsto eliminará:\n• Registros de gasolina\n• Mantenimiento\n• Tickets\n\nLa configuración del vehículo NO se borrará.")) {
              onReset?.();
            }
          }}
          className="w-full rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-2.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/15"
        >
          Borrar todos los datos
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm("¿Restablecer la configuración del vehículo a valores de fábrica?")) {
              onResetSettings?.();
            }
          }}
          className="w-full rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/15"
        >
          Restablecer configuración
        </button>
        <p className="text-center text-[10px] text-white/20">Los registros de gastos no se borran</p>
      </div>
    </form>
  );
}

function InputField({
  label,
  type,
  step,
  min,
  max,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  type: string;
  step?: string;
  min?: string;
  max?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-white/40">{label}</label>
      <input
        type={type}
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-white outline-none transition-colors placeholder:text-white/20 focus:border-byd-500/50"
      />
    </div>
  );
}

// ── Section header with Add button ───────────────────────────────────────────
function SectionHeader({
  title,
  count,
  onAdd,
}: {
  title: string;
  count: number;
  onAdd: () => void;
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-white/50">{title}</h2>
        <span className="text-[9px] text-white/25">{count} registros</span>
      </div>
      <button
        onClick={onAdd}
        className="flex items-center gap-1 rounded-lg bg-byd-500/15 px-2 py-1 text-[10px] font-medium text-byd-400 transition-colors hover:bg-byd-500/25"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Agregar
      </button>
    </div>
  );
}

// ── History table component ───────────────────────────────────────────────────
function HistoryFilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-2 py-1 text-[10px] font-medium transition-all ${
        active
          ? "bg-byd-500/15 text-byd-400 shadow-[inset_0_0_0_1px_rgba(18,184,160,0.25)]"
          : "text-white/40 hover:bg-white/[0.04] hover:text-white/70"
      }`}
    >
      {label}
    </button>
  );
}

function HistoryTable({
  gasolinaList,
  cargasList,
  periodosElectricos,
  mantenimientoList,
  otrosCostosList,
  onViewGasolina,
  onViewCarga,
  onViewCfe,
  onNavigate,
}: {
  gasolinaList: GasolinaEntry[];
  cargasList: CargaEntry[];
  periodosElectricos: PeriodoElectricoRow[];
  mantenimientoList: MantenimientoEntry[];
  otrosCostosList: OtroCostoEntry[];
  onViewGasolina: (entry: GasolinaEntry) => void;
  onViewCarga: (entry: CargaEntry) => void;
  onViewCfe: (periodo: PeriodoElectricoRow) => void;
  onNavigate: (section: Section) => void;
}) {
  const [periodFilter, setPeriodFilter] = useState<HistoryPeriodFilter>("mes");
  const [categoryFilter, setCategoryFilter] = useState<HistoryCategoryFilter>("todos");

  const now = new Date();

  const allRows = useMemo((): HistoryRow[] => {
    const rows: HistoryRow[] = [];

    gasolinaList.forEach((e) => {
      rows.push({
        id: `gas-${e.id}`,
        fecha: e.fecha,
        tipo: "Gasolina",
        descripcion: e.concepto || "Recarga de gasolina",
        importe: e.costo,
        observaciones: `${e.litros} L · ${e.kilometraje.toLocaleString()} km`,
        category: "gasolina",
        sortKey: dateSortValue(e.fecha),
        onViewDetail: () => onViewGasolina(e),
      });
    });

    cargasList.forEach((e) => {
      rows.push({
        id: `ev-${e.id}`,
        fecha: e.fecha,
        tipo: "Carga EV",
        descripcion: `${e.tipo} · ${e.kwhCargados.toFixed(1)} kWh`,
        importe: e.costo,
        observaciones: `${e.pctInicial}% → ${e.pctFinal}% · ${e.kmEvObtenidos.toLocaleString()} km EV`,
        category: "electricidad",
        sortKey: dateSortValue(e.fecha),
        onViewDetail: () => onViewCarga(e),
      });
    });

    periodosElectricos.forEach((p) => {
      const inicio = formatDateOnlyMX(p.fecha_inicio) ?? p.fecha_inicio;
      const fin = formatDateOnlyMX(p.fecha_fin) ?? p.fecha_fin;
      rows.push({
        id: `cfe-${p.id}`,
        fecha: p.fecha_fin,
        tipo: "Recibo CFE",
        descripcion: `Recibo CFE · ${inicio} — ${fin}`,
        importe: Number(p.costo_total_mxn),
        observaciones: `${p.kwh_bimestre} kWh · ${p.proveedor || "CFE"}${p.numero_recibo ? ` · #${p.numero_recibo}` : ""}`,
        category: "cfe",
        sortKey: dateSortValue(p.fecha_fin),
        onViewDetail: () => onViewCfe(p),
      });
    });

    mantenimientoList.forEach((e) => {
      if (!e.fecha) return;
      rows.push({
        id: `mnt-${e.id}`,
        fecha: e.fecha,
        tipo: "Mantenimiento",
        descripcion: e.servicio || "Servicio oficial",
        importe: e.costoReal ?? e.costo,
        observaciones: `${e.km.toLocaleString()} km${e.agencia ? ` · ${e.agencia}` : ""}${e.notas ? ` · ${e.notas}` : ""}`,
        category: "mantenimiento",
        sortKey: dateSortValue(e.fecha),
        onViewDetail: () => onNavigate("mantenimiento"),
      });
    });

    otrosCostosList.forEach((e) => {
      if (!e.fecha) return;
      rows.push({
        id: `otr-${e.id}`,
        fecha: e.fecha,
        tipo: "Otros costos",
        descripcion: e.concepto,
        importe: e.costo,
        observaciones: `${e.categoria}${e.odometro ? ` · ${e.odometro.toLocaleString()} km` : ""}${e.proveedor ? ` · ${e.proveedor}` : ""}`,
        category: "otros",
        sortKey: dateSortValue(e.fecha),
        onViewDetail: () => onNavigate("mantenimiento"),
      });
    });

    return rows.sort((a, b) => b.sortKey - a.sortKey);
  }, [gasolinaList, cargasList, periodosElectricos, mantenimientoList, otrosCostosList, onViewGasolina, onViewCarga, onViewCfe, onNavigate]);

  const filtered = allRows.filter((row) => {
    if (categoryFilter !== "todos" && row.category !== categoryFilter) return false;
    const d = normalizeDate(row.fecha || row.fecha_hora || "");
    if (!d) return false;
    switch (periodFilter) {
      case "hoy": return isSameDay(d, now);
      case "semana": return isThisWeek(d, now);
      case "mes": return isThisMonth(d, now);
      case "ano": return isThisYear(d, now);
    }
  });

  const totalImporte = filtered.reduce((acc, r) => acc + r.importe, 0);

  const tipoIcon: Record<string, string> = {
    Gasolina: "⛽",
    "Carga EV": "⚡",
    "Recibo CFE": "📄",
    Mantenimiento: "🔧",
    "Otros costos": "🔩",
  };

  const tipoColor: Record<string, string> = {
    Gasolina: "text-amber-400/90",
    "Carga EV": "text-green-400/90",
    "Recibo CFE": "text-byd-400/90",
    Mantenimiento: "text-blue-400/90",
    "Otros costos": "text-purple-400/90",
  };

  const categoryButtons: { key: HistoryCategoryFilter; label: string }[] = [
    { key: "todos", label: "Todos" },
    { key: "gasolina", label: "Gasolina" },
    { key: "electricidad", label: "Electricidad" },
    { key: "mantenimiento", label: "Mantenimiento" },
    { key: "otros", label: "Otros costos" },
    { key: "cfe", label: "Recibos CFE" },
  ];

  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Historial completo</h2>
        <div className="flex flex-wrap gap-1">
          <HistoryFilterButton active={periodFilter === "hoy"} label="Hoy" onClick={() => setPeriodFilter("hoy")} />
          <HistoryFilterButton active={periodFilter === "semana"} label="Semana" onClick={() => setPeriodFilter("semana")} />
          <HistoryFilterButton active={periodFilter === "mes"} label="Mes" onClick={() => setPeriodFilter("mes")} />
          <HistoryFilterButton active={periodFilter === "ano"} label="Año" onClick={() => setPeriodFilter("ano")} />
        </div>
      </div>

      <div className="mb-2.5 flex flex-wrap gap-1">
        {categoryButtons.map(({ key, label }) => (
          <HistoryFilterButton
            key={key}
            active={categoryFilter === key}
            label={label}
            onClick={() => setCategoryFilter(key)}
          />
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-xl border border-white/5 sm:block">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-white/5 bg-white/[0.03] text-[9px] font-medium uppercase tracking-wider text-white/30">
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Descripción</th>
              <th className="px-3 py-2 text-right">Importe</th>
              <th className="px-3 py-2">Observaciones</th>
              <th className="px-3 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} className="border-b border-white/5 transition-colors hover:bg-white/[0.02]">
                <td className="whitespace-nowrap px-3 py-2 text-white/55">{formatFechaMX(row.fecha, row.fecha_hora)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className={`flex items-center gap-1 text-xs font-medium ${tipoColor[row.tipo] ?? "text-white/60"}`}>
                    {tipoIcon[row.tipo] ?? "•"} {row.tipo}
                  </span>
                </td>
                <td className="max-w-[160px] truncate px-3 py-2 text-white/70">{row.descripcion}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-white/85">
                  {formatCurrency(row.importe)}
                </td>
                <td className="max-w-[200px] truncate px-3 py-2 text-[11px] text-white/45">{row.observaciones}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={row.onViewDetail}
                    className="rounded-md border border-white/10 px-2 py-0.5 text-[10px] text-white/45 transition-colors hover:bg-white/5 hover:text-white/70"
                  >
                    Ver detalle
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-1.5 sm:hidden">
        {filtered.map((row) => (
          <div key={row.id} className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
            <div className="mb-0.5 flex items-center justify-between gap-2">
              <span className={`flex items-center gap-1 text-xs font-medium ${tipoColor[row.tipo] ?? "text-white/60"}`}>
                {tipoIcon[row.tipo] ?? "•"} {row.tipo}
              </span>
              <span className="shrink-0 text-[10px] text-white/35">{formatFechaMX(row.fecha, row.fecha_hora)}</span>
            </div>
            <p className="text-[11px] font-medium text-white/65">{row.descripcion}</p>
            <p className="mb-1 text-[11px] text-white/45">{row.observaciones}</p>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-white/85">{formatCurrency(row.importe)}</p>
              <button
                type="button"
                onClick={row.onViewDetail}
                className="rounded-md border border-white/10 px-2 py-0.5 text-[10px] text-white/45 transition-colors hover:bg-white/5 hover:text-white/70"
              >
                Ver detalle
              </button>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="py-6 text-center text-xs text-white/30">
          No hay movimientos en este período
        </p>
      )}

      {filtered.length > 0 && (
        <div className="mt-2 flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-3 py-1.5">
          <span className="text-[10px] text-white/35">{filtered.length} movimientos</span>
          <span className="text-xs font-bold text-byd-400">{formatCurrency(totalImporte)}</span>
        </div>
      )}
    </div>
  );
}

// ── Ticket components ────────────────────────────────────────────────────────
function TicketDetailModal({
  ticket,
  onClose,
}: {
  ticket: TicketEntry | null;
  onClose: () => void;
}) {
  if (!ticket) return null;
  const catLabel: Record<string, string> = {
    gasolina: "Gasolina",
    carga: "Carga eléctrica",
    mantenimiento: "Mantenimiento",
    otro: "Otro",
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl border border-white/10 bg-[#0d1117] p-3 shadow-2xl sm:p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-white/80">{ticket.titulo}</h3>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/10 hover:text-white/80">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Image */}
        <div className="mb-4 overflow-hidden rounded-xl bg-white/[0.03]">
          <img src={ticket.imageBase64} alt={ticket.titulo} className="max-h-72 w-full object-contain" />
        </div>

        {/* Data */}
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-white/40">Fecha</span>
            <span className="text-white/80">{formatDate(ticket.fecha)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Categoría</span>
            <Tag variant={ticket.categoria === "mantenimiento" ? "amber" : "green"}>{catLabel[ticket.categoria]}</Tag>
          </div>
          {ticket.proveedor && (
            <div className="flex justify-between">
              <span className="text-white/40">Proveedor</span>
              <span className="text-white/80">{ticket.proveedor}</span>
            </div>
          )}
          {ticket.monto > 0 && (
            <div className="flex justify-between">
              <span className="text-white/40">Monto</span>
              <span className="font-semibold text-white">{formatCurrency(ticket.monto)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-white/40">OCR</span>
            <span className={ticket.ocrProcesado ? "text-emerald-400" : "text-amber-400"}>
              {ticket.ocrProcesado ? "Procesado" : "Pendiente"}
            </span>
          </div>
          {ticket.ocrText && (
            <div className="mt-2 rounded-lg bg-white/[0.03] p-3">
              <p className="mb-1 text-[11px] font-medium text-white/30">Texto extraído (OCR)</p>
              <p className="text-xs text-white/60 whitespace-pre-wrap">{ticket.ocrText}</p>
            </div>
          )}
        </div>

        <button onClick={onClose} className="mt-3 w-full rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:bg-white/10">
          Cerrar
        </button>
      </div>
    </div>
  );
}

function TicketsView({ onOpenForm }: { onOpenForm: () => void }) {
  const [tickets, setTickets] = useState<TicketEntry[]>([]);
  const [selected, setSelected] = useState<TicketEntry | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setTickets(loadData<TicketEntry[]>(KEYS.tickets, []));
  }, [refreshKey]);

  const sorted = [...tickets].sort((a, b) => dateSortValue(b.fecha) - dateSortValue(a.fecha));

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("¿Eliminar este ticket?")) return;
    const updated = tickets.filter((t) => t.id !== id);
    saveData(KEYS.tickets, updated);
    setRefreshKey((k) => k + 1);
  };

  const catIcon: Record<string, string> = {
    gasolina: "⛽",
    carga: "⚡",
    mantenimiento: "🔧",
    otro: "📄",
  };

  return (
    <div>
      <SectionHeader title="Tickets" count={tickets.length} onAdd={onOpenForm} />

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-white/30">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p className="text-xs">No hay tickets aún</p>
          <p className="text-[10px]">Sube la foto de tu primer ticket</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {sorted.map((ticket) => (
            <div
              key={ticket.id}
              onClick={() => setSelected(ticket)}
              className="group cursor-pointer overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] transition-all duration-200 hover:border-byd-500/30 hover:shadow-[0_0_20px_-8px_rgba(18,184,160,0.2)]"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-white/[0.03]">
                <img
                  src={ticket.imageBase64}
                  alt={ticket.titulo}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <button
                  onClick={(e) => handleDelete(ticket.id, e)}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-lg bg-black/50 text-white/50 opacity-0 transition-opacity hover:bg-red-500/60 hover:text-white group-hover:opacity-100"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
                {!ticket.ocrProcesado && (
                  <span className="absolute bottom-1.5 left-1.5 rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px] font-medium text-amber-400">
                    OCR pendiente
                  </span>
                )}
              </div>
              <div className="p-2.5 sm:p-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{catIcon[ticket.categoria]}</span>
                  <p className="truncate text-sm font-medium text-white/80">{ticket.titulo}</p>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[10px] text-white/30">{formatDateShort(ticket.fecha)}</span>
                  {ticket.monto > 0 && <span className="text-xs font-semibold text-white/60">{formatCurrency(ticket.monto)}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <TicketDetailModal ticket={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

// ── Chart components ─────────────────────────────────────────────────────────
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">{title}</h3>
      {children}
    </div>
  );
}

function GastoPorDia() {
  const gasolina = loadData<GasolinaEntry[]>(KEYS.gasolina, []);
  const cargas = loadData<CargaEntry[]>(KEYS.cargas, []);
  const mantenimiento = loadData<MantenimientoEntry[]>(KEYS.mantenimiento, []);

  const data = useMemo(() => {
    const days: { date: string; label: string; gasto: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().split("T")[0];
      const label = i === 0 ? "Hoy" : d.toLocaleDateString("es-CL", { weekday: "short" });
      let total = 0;
      [...gasolina, ...cargas, ...mantenimiento].forEach((e) => {
        if (e.fecha === iso) total += e.costo;
      });
      days.push({ date: iso, label: label.charAt(0).toUpperCase() + label.slice(1), gasto: total });
    }
    return days;
  }, [gasolina, cargas, mantenimiento]);

  return (
    <ChartCard title="Gasto por día (últimos 7 días)">
      <ResponsiveContainer width="100%" height={130}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="gastoDia" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#12b8a0" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#12b8a0" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} width={28} />
          <Tooltip
            contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 10, color: "rgba(255,255,255,0.8)" }}
            formatter={(value: any) => [formatCurrency(Number(value)), "Gasto"]}
          />
          <Area type="monotone" dataKey="gasto" stroke="#12b8a0" strokeWidth={1.5} fill="url(#gastoDia)" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function GastoPorMes() {
  const gasolina = loadData<GasolinaEntry[]>(KEYS.gasolina, []);
  const cargas = loadData<CargaEntry[]>(KEYS.cargas, []);
  const mantenimiento = loadData<MantenimientoEntry[]>(KEYS.mantenimiento, []);

  const data = useMemo(() => {
    const map = new Map<string, number>();
    [...gasolina, ...cargas, ...mantenimiento].forEach((e) => {
      const m = e.fecha.slice(0, 7);
      map.set(m, (map.get(m) || 0) + e.costo);
    });
    return Array.from(map.entries())
      .map(([date, gasto]) => {
        const d = new Date(date + "-01");
        return { mes: d.toLocaleDateString("es-CL", { month: "short" }), gasto };
      })
      .sort((a, b) => {
        const ma = MONTHS.indexOf(a.mes.charAt(0).toUpperCase() + a.mes.slice(1));
        const mb = MONTHS.indexOf(b.mes.charAt(0).toUpperCase() + b.mes.slice(1));
        return ma - mb;
      });
  }, [gasolina, cargas, mantenimiento]);

  return (
    <ChartCard title="Gasto por mes">
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="mes" tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} width={28} />
          <Tooltip
            contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 10, color: "rgba(255,255,255,0.8)" }}
            formatter={(value: any) => [formatCurrency(Number(value)), "Gasto"]}
          />
          <Bar dataKey="gasto" fill="#12b8a0" radius={[3, 3, 0, 0]} opacity={0.85} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function RendimientoHistorico() {
  const gasolina = loadData<GasolinaEntry[]>(KEYS.gasolina, []);
  const settings = loadData<VehicleSettings>(KEYS.settings, DEFAULT_SETTINGS);

  const data = useMemo(() => {
    const entries = gasolina
      .filter((e) => e.litros > 0 && e.kilometraje > 0 && e.costo > 0)
      .slice()
      .sort((a, b) => dateSortValue(a.fecha) - dateSortValue(b.fecha))
      .map((e, i) => ({
        n: `#${i + 1}`,
        kmL: Math.round((e.litros > 0 ? (e.kilometraje / e.litros) * 0.1 : 0) * 10) / 10,
        kmKwh: settings.rendimientoKmKwh,
      }));
    return entries.length > 0 ? entries : [{ n: "#1", kmL: settings.rendimientoKmL, kmKwh: settings.rendimientoKmKwh }];
  }, [gasolina, settings]);

  return (
    <ChartCard title="Rendimiento histórico">
      <ResponsiveContainer width="100%" height={130}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="n" tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 9 }} axisLine={false} tickLine={false} domain={[0, "auto"]} width={28} />
          <Tooltip
            contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 10, color: "rgba(255,255,255,0.8)" }}
          />
          <Legend wrapperStyle={{ paddingTop: 2 }} formatter={(value) => <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 9 }}>{value}</span>} />
          <Line type="monotone" dataKey="kmL" stroke="#12b8a0" strokeWidth={1.5} dot={false} name="km/L (gasolina)" />
          <Line type="monotone" dataKey="kmKwh" stroke="#0ea5e9" strokeWidth={1.5} dot={false} name="km/kWh (eléctrico)" />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function ComparativoGasolinaVsElectricidad() {
  const gasolina = loadData<GasolinaEntry[]>(KEYS.gasolina, []);
  const cargas = loadData<CargaEntry[]>(KEYS.cargas, []);
  const settings = loadData<VehicleSettings>(KEYS.settings, DEFAULT_SETTINGS);

  const data = useMemo(() => {
    const map = new Map<string, { gasolina: number; electricidad: number }>();
    [
      ...gasolina.map((e) => ({ mes: e.fecha.slice(0, 7), costo: e.costo, tipo: "gasolina" as const })),
      ...cargas.map((e) => ({ mes: e.fecha.slice(0, 7), costo: e.costo, tipo: "electricidad" as const })),
    ].forEach((e) => {
      if (!map.has(e.mes)) map.set(e.mes, { gasolina: 0, electricidad: 0 });
      const entry = map.get(e.mes)!;
      if (e.tipo === "gasolina") entry.gasolina += e.costo;
      else entry.electricidad += e.costo;
    });
    return Array.from(map.entries())
      .map(([date, values]) => {
        const d = new Date(date + "-01");
        return { mes: d.toLocaleDateString("es-CL", { month: "short" }), ...values };
      })
      .sort((a, b) => {
        const ma = MONTHS.indexOf(a.mes.charAt(0).toUpperCase() + a.mes.slice(1));
        const mb = MONTHS.indexOf(b.mes.charAt(0).toUpperCase() + b.mes.slice(1));
        return ma - mb;
      });
  }, [gasolina, cargas]);

  return (
    <ChartCard title="Comparativo gasolina vs electricidad">
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="mes" tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} width={28} />
          <Tooltip
            contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 10, color: "rgba(255,255,255,0.8)" }}
            formatter={(value: any, name: any) => {
              const label = name === "gasolina" ? "Gasolina" : "Electricidad";
              return [formatCurrency(Number(value)), label];
            }}
          />
          <Legend wrapperStyle={{ paddingTop: 2 }} formatter={(value) => {
              const label = value === "gasolina" ? "Gasolina" : "Electricidad";
              return <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 9 }}>{label}</span>;
            }} />
          <Bar dataKey="gasolina" fill="#12b8a0" radius={[3, 3, 0, 0]} opacity={0.85} name="gasolina" />
          <Bar dataKey="electricidad" fill="#0ea5e9" radius={[3, 3, 0, 0]} opacity={0.85} name="electricidad" />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ── Confirm dialog ───────────────────────────────────────────────────────
function ConfirmDialog({
  isOpen,
  onConfirm,
  onCancel,
  title,
  message,
}: {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
}) {
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-xl border border-white/10 bg-[#0d1117] p-3 shadow-2xl sm:p-4">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-white/80">{title}</h3>
        <p className="mb-4 text-xs text-white/50">{message}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/60 transition-colors hover:bg-white/10"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-400"
          >
            Eliminar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Recibo CFE form ──────────────────────────────────────────────────────
function ReciboForm({
  onSave,
  onClose,
  initialData,
  isEdit,
}: {
  onSave: (data: Omit<PeriodoElectricoRow, "id" | "created_at" | "costo_kwh_mxn">) => Promise<boolean>;
  onClose: () => void;
  initialData?: PeriodoElectricoRow | null;
  isEdit?: boolean;
}) {
  const [fechaInicio, setFechaInicio] = useState(initialData?.fecha_inicio || "");
  const [fechaFin, setFechaFin] = useState(initialData?.fecha_fin || "");
  const [kwh, setKwh] = useState(initialData ? String(initialData.kwh_bimestre) : "");
  const [total, setTotal] = useState(initialData ? String(initialData.costo_total_mxn) : "");
  const [tarifa, setTarifa] = useState(initialData?.tarifa || "");
  const [numRecibo, setNumRecibo] = useState(initialData?.numero_recibo || "");
  const [proveedor, setProveedor] = useState(initialData?.proveedor || "CFE");
  const [notas, setNotas] = useState(initialData?.notas || "");
  const [kwhByd, setKwhByd] = useState(initialData?.kwh_byd_periodo ? String(initialData.kwh_byd_periodo) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const kwhNum = parseFloat(kwh);
    const totalNum = parseFloat(total);
    const kwhBydNum = kwhByd ? parseFloat(kwhByd) : 0;

    if (!fechaInicio || !fechaFin) {
      setError("Ambas fechas son requeridas.");
      return;
    }
    if (fechaFin < fechaInicio) {
      setError("La fecha fin debe ser mayor o igual a la fecha inicio.");
      return;
    }
    if (!kwh || kwhNum <= 0) {
      setError("El consumo debe ser mayor a 0 kWh.");
      return;
    }
    if (total === "" || totalNum < 0) {
      setError("El total del recibo no puede ser negativo.");
      return;
    }
    if (kwhByd !== "" && (kwhBydNum < 0 || kwhBydNum > kwhNum)) {
      setError("El consumo BYD debe estar entre 0 y el total del consumo.");
      return;
    }

    setSaving(true);
    const success = await onSave({
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      kwh_bimestre: kwhNum,
      costo_total_mxn: totalNum,
      kwh_byd_periodo: kwhByd !== "" ? kwhBydNum : null,
      proveedor: proveedor || "CFE",
      tarifa: tarifa || null,
      numero_recibo: numRecibo || null,
      notas: notas || null,
    });
    setSaving(false);
    if (!success) {
      setError("No se pudo guardar. Verifica que no se traslape con otro periodo y revisa la consola.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <InputField label="Fecha inicio" type="date" value={fechaInicio} onChange={setFechaInicio} required />
        <InputField label="Fecha fin" type="date" value={fechaFin} onChange={setFechaFin} required />
      </div>
      <InputField label="Consumo (kWh)" type="number" step="0.1" min="0.1" value={kwh} onChange={setKwh} required />
      <InputField label="Total del recibo ($)" type="number" step="0.01" min="0" value={total} onChange={setTotal} required />
      <InputField label="Consumo BYD (kWh)" type="number" step="0.1" min="0" value={kwhByd} onChange={setKwhByd} placeholder="Opcional, dejar vacío si no se sabe" />
      <div className="grid grid-cols-2 gap-3">
        <InputField label="Tarifa" type="text" value={tarifa} onChange={setTarifa} placeholder="Ej. 1C, DAC" />
        <InputField label="Proveedor" type="text" value={proveedor} onChange={setProveedor} required />
      </div>
      <InputField label="Número de recibo" type="text" value={numRecibo} onChange={setNumRecibo} placeholder="Opcional" />
      <InputField label="Notas" type="text" value={notas} onChange={setNotas} placeholder="Opcional" />
      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/60 transition-colors hover:bg-white/10">
          Cancelar
        </button>
        <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-byd-500 px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-byd-400 disabled:opacity-40">
          {saving ? "Guardando..." : isEdit ? "Actualizar recibo" : "Guardar recibo"}
        </button>
      </div>
    </form>
  );
}

function getPeriodoAlerts(r: PeriodoElectricoRow): string[] {
  const alerts: string[] = [];
  if (r.costo_kwh_mxn != null && r.costo_kwh_mxn < 1) alerts.push("Costo/kWh muy bajo");
  if (r.costo_kwh_mxn != null && r.costo_kwh_mxn > 10) alerts.push("Costo/kWh muy alto");
  if (r.kwh_bimestre > 1000) alerts.push("Consumo anormalmente alto");
  const diffMs = new Date(r.fecha_fin).getTime() - new Date(r.fecha_inicio).getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays > 0 && diffDays < 20) alerts.push("Periodo muy corto (" + Math.round(diffDays) + " días)");
  if (diffDays > 70) alerts.push("Periodo muy largo (" + Math.round(diffDays) + " días)");
  return alerts;
}

function getBydKwhForPeriod(r: PeriodoElectricoRow, cargas: CargaEntry[]) {
  const manualVal = r.kwh_byd_periodo != null ? Number(r.kwh_byd_periodo) : 0;
  if (manualVal > 0) {
    return { value: manualVal, isManual: true };
  }
  const calculated = cargas
    .filter((c) => c.fecha >= r.fecha_inicio && c.fecha <= r.fecha_fin)
    .reduce((sum, c) => sum + c.kwhCargados, 0);
  const rounded = Math.round(calculated * 10) / 10;
  return { value: rounded, isManual: false };
}

// ── Mantenimiento BYD King ────────────────────────────────────────────────

const BYD_KING_SERVICIOS: { km: number; meses: number; costo: number }[] = [
  { km: 15000,  meses: 12,  costo: 2792 },
  { km: 30000,  meses: 24,  costo: 5278 },
  { km: 45000,  meses: 36,  costo: 2792 },
  { km: 60000,  meses: 48,  costo: 8032 },
  { km: 75000,  meses: 60,  costo: 4509 },
  { km: 90000,  meses: 72,  costo: 3560 },
  { km: 105000, meses: 84,  costo: 4509 },
  { km: 120000, meses: 96,  costo: 8032 },
  { km: 135000, meses: 108, costo: 2792 },
  { km: 150000, meses: 120, costo: 5278 },
];

function getMantenimientoStatus(kmRestantes: number, mesesRestantes?: number): {
  color: string;
  bg: string;
  borderColor: string;
  label: string;
  message: string;
  icon: string;
  dot: string;
} {
  const vencidoKm   = kmRestantes <= 0;
  const vencidoMes  = mesesRestantes !== undefined && mesesRestantes <= 0;
  const urgenteKm   = kmRestantes > 0 && kmRestantes <= 500;
  const proximoKm   = kmRestantes > 500 && kmRestantes <= 2000;
  const proximoMes  = mesesRestantes !== undefined && mesesRestantes > 0 && mesesRestantes <= 2;

  if (vencidoKm || vencidoMes)
    return {
      color: "text-red-400", bg: "bg-red-500/10", borderColor: "border-red-500/30",
      dot: "bg-red-400", label: "Vencido", icon: "🔴",
      message: "Servicio vencido — agenda lo antes posible",
    };
  if (urgenteKm)
    return {
      color: "text-red-400", bg: "bg-red-500/10", borderColor: "border-red-500/30",
      dot: "bg-red-400", label: "Urgente", icon: "🟠",
      message: "Agenda tu servicio pronto",
    };
  if (proximoKm || proximoMes)
    return {
      color: "text-amber-400", bg: "bg-amber-500/10", borderColor: "border-amber-500/25",
      dot: "bg-amber-400", label: "Próximo", icon: "🟡",
      message: "Servicio próximo — planifica tu cita",
    };
  return {
    color: "text-green-400", bg: "bg-green-500/10", borderColor: "border-green-500/20",
    dot: "bg-green-400", label: "Al día", icon: "🟢",
    message: "Todo bien — sin acciones requeridas",
  };
}

/** Estado por kilometraje — sin vencimiento por tiempo. */
function getMantenimientoStatusKm(kmRestantes: number) {
  return getMantenimientoStatus(kmRestantes, undefined);
}

type ServicioKmEstado = "realizado" | "vencido" | "urgente" | "proximo" | "al-dia" | "pendiente";

function getServicioKmEstado(
  servicioKm: number,
  odometroActual: number,
  proximoKm: number | null,
  realizado: boolean,
): ServicioKmEstado {
  if (realizado) return "realizado";
  if (odometroActual >= servicioKm) return "vencido";
  if (proximoKm === servicioKm) {
    const restantes = servicioKm - odometroActual;
    if (restantes <= 500) return "urgente";
    if (restantes <= 2000) return "proximo";
    return "al-dia";
  }
  return "pendiente";
}

function servicioKmEstadoMeta(estado: ServicioKmEstado): {
  label: string;
  dot: string;
  text: string;
  badgeBg: string;
} {
  switch (estado) {
    case "realizado":
      return { label: "Realizado", dot: "bg-green-400", text: "text-green-400", badgeBg: "bg-green-500/15 text-green-400" };
    case "vencido":
      return { label: "Vencido sin registro", dot: "bg-red-400", text: "text-red-400", badgeBg: "bg-red-500/15 text-red-400" };
    case "urgente":
      return { label: "Urgente", dot: "bg-red-400", text: "text-red-400", badgeBg: "bg-red-500/15 text-red-400" };
    case "proximo":
      return { label: "Próximo", dot: "bg-amber-400", text: "text-amber-400", badgeBg: "bg-amber-500/15 text-amber-400" };
    case "al-dia":
      return { label: "Al día", dot: "bg-green-400", text: "text-green-400", badgeBg: "bg-green-500/15 text-green-400" };
    default:
      return { label: "Pendiente", dot: "bg-white/20", text: "text-white/25", badgeBg: "bg-white/[0.04] text-white/30" };
  }
}

// ── Checklist de servicio BYD King ───────────────────────────────────────
const CHECKLIST_ITEMS: { id: string; label: string; importante: boolean }[] = [
  { id: "aceite-motor",          label: "Aceite de motor",                  importante: true  },
  { id: "filtro-aceite",         label: "Filtro de aceite",                 importante: false },
  { id: "filtro-aire",           label: "Filtro de aire",                   importante: false },
  { id: "filtro-cabina",         label: "Filtro de cabina",                 importante: false },
  { id: "liquido-frenos",        label: "Líquido de frenos",                importante: true  },
  { id: "refrigerante-motor",    label: "Refrigerante motor",               importante: false },
  { id: "refrigerante-hibrido",  label: "Refrigerante sistema híbrido",     importante: true  },
  { id: "frenos",                label: "Frenos",                           importante: true  },
  { id: "llantas",               label: "Llantas / rotación",               importante: false },
  { id: "alineacion",            label: "Alineación / balanceo",            importante: false },
  { id: "bateria-12v",           label: "Batería 12V",                      importante: true  },
  { id: "sistema-hibrido",       label: "Sistema híbrido / alto voltaje",   importante: true  },
  { id: "escaneo",               label: "Escaneo diagnóstico",              importante: false },
  { id: "software",              label: "Actualización de software",        importante: false },
];

function calcChecklistPct(checklist: ChecklistItemState[] | undefined): number {
  if (!checklist || checklist.length === 0) return 0;
  const done = checklist.filter((c) => c.realizado).length;
  return Math.round((done / CHECKLIST_ITEMS.length) * 100);
}

function getImportantesPendientes(checklist: ChecklistItemState[] | undefined): string[] {
  if (!checklist) return [];
  return CHECKLIST_ITEMS
    .filter((item) => item.importante)
    .filter((item) => {
      const state = checklist.find((c) => c.id === item.id);
      return !state || !state.realizado;
    })
    .map((item) => item.label);
}

// ── RegistrarServicioForm ──────────────────────────────────────────────────
function RegistrarServicioForm({
  initialKm,
  initialData,
  onSave,
}: {
  initialKm: number;
  initialData?: MantenimientoEntry;
  onSave: (entry: MantenimientoEntry) => void;
}) {
  const sched = BYD_KING_SERVICIOS.find((s) => s.km === initialKm) ?? BYD_KING_SERVICIOS[0];
  const isEdit = !!initialData;

  const [fecha, setFecha] = useState(initialData?.fecha ?? new Date().toISOString().slice(0, 10));
  const [odometro, setOdometro] = useState(String(initialData?.km ?? initialKm));
  const [costoReal, setCostoReal] = useState(String(initialData?.costoReal ?? initialData?.costo ?? ""));
  const [agencia, setAgencia] = useState(initialData?.agencia ?? "");
  const [notas, setNotas] = useState(initialData?.notas ?? "");
  const [error, setError] = useState("");
  const [expandNotas, setExpandNotas] = useState<string | null>(null);

  const [checklist, setChecklist] = useState<ChecklistItemState[]>(() =>
    CHECKLIST_ITEMS.map((item) => ({
      id: item.id,
      realizado: initialData?.checklist?.find((c) => c.id === item.id)?.realizado ?? false,
      nota: initialData?.checklist?.find((c) => c.id === item.id)?.nota ?? "",
    }))
  );

  const [adjunto, setAdjunto] = useState<MantenimientoEntry["adjunto"]>(initialData?.adjunto ?? undefined);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setError("El archivo no debe superar 4 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAdjunto({ nombre: file.name, tipo: file.type, data: reader.result as string });
      setError("");
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function toggleItem(id: string) {
    setChecklist((prev) =>
      prev.map((c) => (c.id === id ? { ...c, realizado: !c.realizado } : c))
    );
  }

  function setItemNota(id: string, nota: string) {
    setChecklist((prev) =>
      prev.map((c) => (c.id === id ? { ...c, nota } : c))
    );
  }

  const donePct = Math.round((checklist.filter((c) => c.realizado).length / CHECKLIST_ITEMS.length) * 100);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const odo = parseInt(odometro);
    const costo = parseFloat(costoReal);
    if (!fecha) { setError("La fecha es requerida."); return; }
    if (isNaN(odo) || odo <= 0) { setError("El odómetro debe ser mayor a 0."); return; }
    if (isNaN(costo) || costo < 0) { setError("El costo real no puede ser negativo."); return; }

    const entry: MantenimientoEntry = {
      id: initialData?.id ?? String(Date.now()),
      fecha,
      servicio: `Servicio ${sched.km.toLocaleString()} km`,
      km: odo,
      costo: costo,
      estado: "completado",
      kmProgramado: sched.km,
      mesesProgramado: sched.meses,
      costoEstimado: sched.costo,
      costoReal: costo,
      agencia: agencia.trim() || undefined,
      notas: notas.trim() || undefined,
      checklist: checklist.map((c) => ({ ...c, nota: c.nota?.trim() || undefined })),
      adjunto,
    };
    onSave(entry);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Two-column layout on wide modal: left = fields, right = checklist */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* Left: service info + basic fields */}
        <div className="flex-shrink-0 space-y-3 sm:w-64">
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-1">
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-[10px] text-white/35">Servicio programado</p>
              <p className="font-medium text-white/70">{sched.km.toLocaleString()} km · {sched.meses} meses</p>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-[10px] text-white/35">Costo estimado</p>
              <p className="font-medium text-white/70">{formatCurrency(sched.costo)}</p>
            </div>
          </div>
          <InputField label="Fecha realizada" type="date" value={fecha} onChange={setFecha} required />
          <InputField label="Odómetro (km)" type="number" value={odometro} onChange={setOdometro} required />
          <InputField label="Costo real ($)" type="number" step="0.01" min="0" value={costoReal} onChange={setCostoReal} required />
          <InputField label="Agencia / Taller" type="text" value={agencia} onChange={setAgencia} />
          <InputField label="Notas generales" type="text" value={notas} onChange={setNotas} />

          {/* Adjunto */}
          <div>
            <p className="mb-1 text-[11px] font-medium text-white/40">Adjunto (foto, PDF, factura)</p>
            {adjunto ? (
              <div className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-base">{adjunto.tipo.startsWith("image/") ? "🖼️" : "📄"}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-white/60">{adjunto.nombre}</span>
                  <button
                    type="button"
                    onClick={() => setAdjunto(undefined)}
                    className="shrink-0 text-[10px] text-red-400/50 hover:text-red-400"
                  >✕</button>
                </div>
                {adjunto.tipo.startsWith("image/") && (
                  <img src={adjunto.data} alt="preview" className="mt-2 max-h-24 w-full rounded object-cover opacity-70" />
                )}
              </div>
            ) : (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-white/10 bg-white/[0.02] px-3 py-2.5 text-[11px] text-white/30 transition-colors hover:border-white/20 hover:text-white/50">
                <span>📎</span>
                <span>Seleccionar archivo…</span>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>
            )}
          </div>
        </div>

        {/* Right: checklist — grows to fill remaining space */}
        <div className="min-w-0 flex-1">

      {/* Checklist */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
        {/* Header + progress */}
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-semibold text-white/70">Checklist de servicio</p>
          <span className={`text-[11px] font-medium ${donePct === 100 ? "text-green-400" : donePct >= 50 ? "text-amber-400" : "text-white/35"}`}>
            {donePct}% completado
          </span>
        </div>
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className={`h-full rounded-full transition-all duration-300 ${donePct === 100 ? "bg-green-400" : "bg-byd-400"}`}
            style={{ width: `${donePct}%` }}
          />
        </div>
        {/* 2-col grid */}
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {CHECKLIST_ITEMS.map((item) => {
            const state = checklist.find((c) => c.id === item.id)!;
            const showNota = expandNotas === item.id;
            return (
              <div
                key={item.id}
                className={`rounded-lg border px-2.5 py-1.5 transition-colors ${
                  state.realizado ? "border-byd-500/20 bg-byd-500/[0.06]" : "border-white/5 bg-white/[0.02]"
                }`}
              >
                <div className="flex items-center gap-2">
                  {/* Checkbox */}
                  <button
                    type="button"
                    onClick={() => toggleItem(item.id)}
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold transition-colors ${
                      state.realizado
                        ? "border-byd-400/60 bg-byd-500/25 text-byd-400"
                        : "border-white/15 bg-transparent text-transparent"
                    }`}
                  >
                    ✓
                  </button>
                  {/* Label */}
                  <span className={`flex-1 truncate text-[11px] ${state.realizado ? "text-white/75" : "text-white/40"}`}>
                    {item.label}
                    {item.importante && (
                      <span className="ml-1 text-[9px] text-amber-400/50">★</span>
                    )}
                  </span>
                  {/* Note toggle */}
                  <button
                    type="button"
                    onClick={() => setExpandNotas(showNota ? null : item.id)}
                    className="shrink-0 rounded px-1 py-0.5 text-[9px] text-white/20 transition-colors hover:bg-white/5 hover:text-white/45"
                  >
                    {showNota ? "▲" : "📝"}
                  </button>
                </div>
                {showNota && (
                  <input
                    type="text"
                    value={state.nota ?? ""}
                    onChange={(e) => setItemNota(item.id, e.target.value)}
                    placeholder="Nota…"
                    className="mt-1 w-full rounded border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/70 outline-none placeholder:text-white/20 focus:border-byd-500/40"
                  />
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[9px] text-white/20">★ = punto de seguridad importante</p>
      </div>
        </div>{/* /right col */}
      </div>{/* /flex row */}

      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        className="w-full rounded-lg bg-byd-500 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-byd-400"
      >
        {isEdit ? "Guardar cambios" : "Registrar servicio"}
      </button>
    </form>
  );
}

// ── KpiChip ───────────────────────────────────────────────────────────────
function KpiChip({ label, value, sub, color, colorHex }: {
  label: string; value: string; sub?: string; color?: string; colorHex?: string;
}) {
  return (
    <div className="flex min-h-[52px] flex-col justify-center rounded-xl border border-white/5 bg-white/[0.025] px-2.5 py-1.5">
      <p className="mb-0.5 truncate text-[9px] font-medium uppercase leading-none tracking-wider text-white/30">{label}</p>
      <p className={`truncate text-[11px] font-bold leading-tight ${color || "text-white/75"}`}
         style={colorHex ? { color: colorHex } : {}}>
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-[9px] leading-none text-white/25">{sub}</p>}
    </div>
  );
}

// ── Dashboard data helpers ─────────────────────────────────────────────────
function monthKeyLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthKeyFromIso(iso: string): string {
  const d = normalizeDate(iso);
  return d ? monthKeyLocal(d) : "";
}

function isPeriodoElectricoValido(r: PeriodoElectricoRow): boolean {
  const diffMs =
    new Date(`${r.fecha_fin}T12:00:00`).getTime() -
    new Date(`${r.fecha_inicio}T12:00:00`).getTime();
  const diffDays = diffMs / 86400000;
  return diffDays >= 20 && diffDays <= 70;
}

/** Misma selección que Centro de Energía: recibo válido más reciente. */
function getUltimoReciboElectrico(periodos: PeriodoElectricoRow[]): PeriodoElectricoRow | null {
  const validos = periodos.filter(isPeriodoElectricoValido);
  if (validos.length > 0) return validos[0];
  return periodos.length > 0 ? periodos[0] : null;
}

function getCentroEnergiaCostos(ultimoRecibo: PeriodoElectricoRow | null, cargas: CargaEntry[]) {
  if (!ultimoRecibo) return null;
  const bydInfo = getBydKwhForPeriod(ultimoRecibo, cargas);
  const kwhByd = bydInfo.value;
  const kwhBimestre = Number(ultimoRecibo.kwh_bimestre) || 0;
  const costoKwh = ultimoRecibo.costo_kwh_mxn ? Number(ultimoRecibo.costo_kwh_mxn) : 0;
  const kwhCasa = kwhBimestre > 0 ? Math.max(0, kwhBimestre - kwhByd) : 0;
  const costoByd =
    costoKwh > 0 && kwhByd > 0 ? Math.round(kwhByd * costoKwh * 100) / 100 : null;
  const costoCasa =
    costoKwh > 0 && kwhCasa > 0 ? Math.round(kwhCasa * costoKwh * 100) / 100 : null;
  return {
    costoKwh: costoKwh > 0 ? costoKwh : null,
    kwhByd,
    kwhCasa,
    kwhBimestre,
    costoByd,
    costoCasa,
  };
}

function costoBydFromPeriodo(p: PeriodoElectricoRow, cargas: CargaEntry[] = []): number {
  const bydInfo = getBydKwhForPeriod(p, cargas);
  const rate = p.costo_kwh_mxn ? Number(p.costo_kwh_mxn) : 0;
  if (bydInfo.value <= 0 || rate <= 0) return 0;
  return Math.round(bydInfo.value * rate * 100) / 100;
}

/** Centro de Energía configurado → gasto BYD desde recibos CFE; si no, suma directa de Cargas EV. */
function hasCentroEnergiaConfigurado(periodos: PeriodoElectricoRow[]): boolean {
  return periodos.length > 0;
}

function getTotalGastoElectricoByd(periodos: PeriodoElectricoRow[], cargas: CargaEntry[]): number {
  if (hasCentroEnergiaConfigurado(periodos)) {
    return Math.round(
      periodos.reduce((s, p) => s + costoBydFromPeriodo(p, cargas), 0) * 100,
    ) / 100;
  }
  return Math.round(cargas.reduce((s, c) => s + c.costo, 0) * 100) / 100;
}

function getGastoElectricoBydAnual(periodos: PeriodoElectricoRow[], cargas: CargaEntry[]): number {
  const year = new Date().getFullYear();
  if (hasCentroEnergiaConfigurado(periodos)) {
    return Math.round(
      periodos.reduce((s, p) => {
        const fin = normalizeDate(p.fecha_fin);
        if (!fin || fin.getFullYear() !== year) return s;
        return s + costoBydFromPeriodo(p, cargas);
      }, 0) * 100,
    ) / 100;
  }
  return Math.round(
    cargas.reduce((s, c) => {
      const d = normalizeDate(c.fecha);
      if (!d || d.getFullYear() !== year) return s;
      return s + c.costo;
    }, 0) * 100,
  ) / 100;
}

function getDashboardEstadoMantenimiento(
  odometroActual: number,
  proximo: { km: number } | null,
  kmRestantes: number,
): string {
  if (!proximo) return "Completado";
  if (odometroActual >= proximo.km) return "Vencido";
  if (kmRestantes <= 500) return "Urgente";
  if (kmRestantes <= 2000) return "Próximo";
  return "Al día";
}

type DashboardGastoRow = { fecha: string; costo: number };

type DashboardGastoMes = {
  key: string;
  label: string;
  gasolina: number;
  electricidad: number;
  mantenimiento: number;
  otros: number;
};

function buildDashboardGastoPorMes12(
  gasolinaList: GasolinaEntry[],
  periodosElectricos: PeriodoElectricoRow[],
  cargasList: CargaEntry[],
  mantenimientoRows: DashboardGastoRow[],
  otrosRows: DashboardGastoRow[],
): DashboardGastoMes[] {
  const now = new Date();
  const months: DashboardGastoMes[] = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return {
      key: monthKeyLocal(d),
      label: d.toLocaleDateString("es-MX", { month: "short", year: "2-digit" }),
      gasolina: 0,
      electricidad: 0,
      mantenimiento: 0,
      otros: 0,
    };
  });
  const find = (k: string) => months.find((m) => m.key === k);

  gasolinaList.forEach((e) => {
    const key = monthKeyFromIso(e.fecha);
    if (!key) return;
    const m = find(key);
    if (m) m.gasolina += e.costo;
  });

  periodosElectricos.forEach((p) => {
    const costoByd = costoBydFromPeriodo(p, cargasList);
    if (costoByd <= 0) return;
    const key = monthKeyFromIso(p.fecha_fin);
    if (!key) return;
    const m = find(key);
    if (m) m.electricidad += costoByd;
  });

  if (!hasCentroEnergiaConfigurado(periodosElectricos)) {
    cargasList.forEach((c) => {
      const key = monthKeyFromIso(c.fecha);
      if (!key) return;
      const m = find(key);
      if (m) m.electricidad += c.costo;
    });
  }

  mantenimientoRows.forEach((e) => {
    const key = monthKeyFromIso(e.fecha);
    if (!key) return;
    const m = find(key);
    if (m) m.mantenimiento += e.costo;
  });

  otrosRows.forEach((e) => {
    const key = monthKeyFromIso(e.fecha);
    if (!key) return;
    const m = find(key);
    if (m) m.otros += e.costo;
  });

  return months;
}

// ── GastoEvolucionLine ────────────────────────────────────────────────────
function GastoEvolucionLine({ gasolinaList, periodosElectricos, cargasList, mantenimientoRows, otrosRows }: {
  gasolinaList: GasolinaEntry[];
  periodosElectricos: PeriodoElectricoRow[];
  cargasList: CargaEntry[];
  mantenimientoRows: DashboardGastoRow[];
  otrosRows: DashboardGastoRow[];
}) {
  const data = useMemo(
    () => buildDashboardGastoPorMes12(gasolinaList, periodosElectricos, cargasList, mantenimientoRows, otrosRows),
    [gasolinaList, periodosElectricos, cargasList, mantenimientoRows, otrosRows],
  );

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">Evolución de gastos (12 meses)</p>
      <ResponsiveContainer width="100%" height={130}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} width={28} />
          <Tooltip contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 10, color: "rgba(255,255,255,0.8)" }} formatter={(v: unknown) => [formatCurrency(Number(v))]} />
          <Legend wrapperStyle={{ paddingTop: 4 }} formatter={(value) => <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 9 }}>{value}</span>} />
          <Line type="monotone" dataKey="gasolina"     stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Gasolina" />
          <Line type="monotone" dataKey="electricidad" stroke="#34d399" strokeWidth={1.5} dot={false} name="Electricidad BYD" />
          <Line type="monotone" dataKey="mantenimiento" stroke="#60a5fa" strokeWidth={1.5} dot={false} name="Mantenimiento" />
          <Line type="monotone" dataKey="otros"        stroke="#c084fc" strokeWidth={1.5} dot={false} name="Otros costos" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── GastoComparativoStacked ───────────────────────────────────────────────
function GastoComparativoStacked({ gasolinaList, periodosElectricos, cargasList, mantenimientoRows, otrosRows }: {
  gasolinaList: GasolinaEntry[];
  periodosElectricos: PeriodoElectricoRow[];
  cargasList: CargaEntry[];
  mantenimientoRows: DashboardGastoRow[];
  otrosRows: DashboardGastoRow[];
}) {
  const data = useMemo(
    () => buildDashboardGastoPorMes12(gasolinaList, periodosElectricos, cargasList, mantenimientoRows, otrosRows),
    [gasolinaList, periodosElectricos, cargasList, mantenimientoRows, otrosRows],
  );

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">Comparativo por categoría</p>
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} width={28} />
          <Tooltip contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 10, color: "rgba(255,255,255,0.8)" }} formatter={(v: unknown) => [formatCurrency(Number(v))]} />
          <Bar dataKey="gasolina"     stackId="a" fill="#f59e0b" opacity={0.8} />
          <Bar dataKey="electricidad" stackId="a" fill="#34d399" opacity={0.8} />
          <Bar dataKey="mantenimiento" stackId="a" fill="#60a5fa" opacity={0.8} />
          <Bar dataKey="otros"        stackId="a" fill="#c084fc" opacity={0.8} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── GastoDistribucionPie ──────────────────────────────────────────────────
function GastoDistribucionPie({ segments }: {
  segments: { label: string; value: number; color: string }[];
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) return null;
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">Distribución (este año)</p>
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <PieChart width={96} height={96}>
            <Pie data={segments} dataKey="value" cx="50%" cy="50%" innerRadius={28} outerRadius={44} strokeWidth={0}>
              {segments.map((s, i) => <Cell key={i} fill={s.color} opacity={0.85} />)}
            </Pie>
          </PieChart>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-[8px] text-white/30 leading-none">Total</p>
            <p className="text-[10px] font-bold leading-tight text-byd-400">{formatCurrency(total)}</p>
          </div>
        </div>
        <div className="flex-1 space-y-1">
          {segments.map((s) => (
            <div key={s.label} className="flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-1">
                <div className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="text-white/40">{s.label}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-white/55">{formatCurrency(s.value)}</span>
                <span className="text-white/25">{Math.round((s.value / total) * 100)}%</span>
              </div>
            </div>
          ))}
          <p className="pt-1 text-[8px] text-white/15">* Pueden superar 100% ya que son categorías independientes.</p>
        </div>
      </div>
    </div>
  );
}

// ── ActividadReciente ─────────────────────────────────────────────────────
function ActividadReciente({
  gasolinaList,
  cargasList,
  onNavigate,
}: {
  gasolinaList: GasolinaEntry[];
  cargasList: CargaEntry[];
  onNavigate: (s: Section) => void;
}) {
  const mantenimiento = loadData<MantenimientoEntry[]>(KEYS.mantenimiento, []);
  const otros       = loadData<OtroCostoEntry[]>(KEYS.otrosCostos, []);

  const items = useMemo(() => {
    const all = [
      ...gasolinaList.map((e)  => ({ id: e.id, fecha: e.fecha, label: e.concepto || "Carga gasolina", monto: e.costo,             icon: "⛽", color: "#f59e0b", section: "gasolina"     as Section })),
      ...cargasList.map((e)    => ({ id: e.id, fecha: e.fecha, label: `Carga EV ${e.tipo}`,            monto: e.costo,             icon: "⚡", color: "#34d399", section: "cargas"       as Section })),
      ...mantenimiento.map((e) => ({ id: e.id, fecha: e.fecha ?? "", label: e.servicio || "Mantenimiento", monto: e.costoReal ?? e.costo, icon: "🔧", color: "#60a5fa", section: "mantenimiento" as Section })),
      ...otros.map((e)     => ({ id: e.id, fecha: e.fecha ?? "", label: e.concepto,                monto: e.costo,             icon: "🔩", color: "#c084fc", section: "mantenimiento" as Section })),
    ];
    return all.sort((a, b) => dateSortValue(b.fecha) - dateSortValue(a.fecha)).slice(0, 5);
  }, [gasolinaList, cargasList]);

  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Actividad reciente</p>
        <button onClick={() => onNavigate("historial")} className="text-[9px] text-byd-400/60 transition-colors hover:text-byd-400">Ver todo →</button>
      </div>
      <div className="relative flex items-start">
        <div className="pointer-events-none absolute left-[10%] right-[10%] top-[14px] h-px bg-white/[0.06]" aria-hidden />
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.section)}
            className="group relative z-10 flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 text-center transition-opacity hover:opacity-90"
          >
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-[#0b0e11] text-xs transition-colors group-hover:border-white/20"
              style={{ boxShadow: `0 0 0 2px ${item.color}22` }}
            >
              {item.icon}
            </div>
            <p className="mt-1 w-full truncate text-[9px] font-medium leading-tight text-white/55">{item.label}</p>
            <p className="text-[8px] text-white/25">{formatDateShort(item.fecha)}</p>
            <p className="text-[9px] font-semibold text-byd-400">{formatCurrency(item.monto)}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── SeccionDashboard ──────────────────────────────────────────────────────
function SeccionDashboard({
  odometroActual,
  gastoGasolina,
  totalLitros,
  rendimientoKmL,
  gasolinaList,
  kpisElectricos,
  periodosElectricos,
  cargasList,
  mantenimientoList,
  mantenimientoRows,
  otrosCostosList,
  otrosRows,
  onNavigate,
}: {
  odometroActual: number;
  gastoGasolina: number;
  totalLitros: number;
  rendimientoKmL: number;
  gasolinaList: GasolinaEntry[];
  kpisElectricos: { total: number; mensual: number; anual: number };
  periodosElectricos: PeriodoElectricoRow[];
  cargasList: CargaEntry[];
  mantenimientoList: MantenimientoEntry[];
  mantenimientoRows: DashboardGastoRow[];
  otrosCostosList: OtroCostoEntry[];
  otrosRows: DashboardGastoRow[];
  onNavigate: (s: Section) => void;
}) {
  // ── Integrated spend ──────────────────────────────────────────────────
  const totalOficial = mantenimientoList.reduce((s, e) => s + (e.costoReal ?? e.costo), 0);
  const totalOtros   = otrosCostosList.reduce((s, e) => s + e.costo, 0);
  const totalElec    = getTotalGastoElectricoByd(periodosElectricos, cargasList);
  const totalIntegrado = gastoGasolina + totalElec + totalOficial + totalOtros;
  const costoPorKmGlobal =
    odometroActual > 0 ? Math.round((totalIntegrado / odometroActual) * 100) / 100 : 0;

  // ── Próximo mantenimiento ─────────────────────────────────────────────
  const proximo = BYD_KING_SERVICIOS.find((s) => s.km > odometroActual) ?? null;
  const kmRestantes = proximo ? proximo.km - odometroActual : 0;

  // ── Health score (km-based status for dashboard) ───────────────────────
  const estadoServicio = getDashboardEstadoMantenimiento(odometroActual, proximo, kmRestantes);
  const kmRestantesLabel = proximo
    ? kmRestantes > 0 ? `${kmRestantes.toLocaleString()} km` : "0 km"
    : "—";
  const status = getMantenimientoStatus(kmRestantes, undefined);
  let healthScore = 100;
  if (kmRestantes <= 0)               healthScore -= 35;
  else if (kmRestantes <= 500)        healthScore -= 20;
  else if (kmRestantes <= 2000)       healthScore -= 10;
  if (mantenimientoList.length === 0) healthScore -= 15;
  healthScore = Math.max(0, Math.min(100, healthScore));
  const healthLabel =
    healthScore >= 98 ? "Excelente" :
    healthScore >= 90 ? "Muy bueno" :
    healthScore >= 80 ? "Bueno" :
    healthScore >= 70 ? "Requiere atención" : "Atención inmediata";
  const healthColor =
    healthScore >= 98 ? "#4ade80" :
    healthScore >= 90 ? "#60efb0" :
    healthScore >= 80 ? "#a3e635" :
    healthScore >= 70 ? "#fbbf24" : "#f87171";

  // ── Gasolina summary ─────────────────────────────────────────────────
  const ultimaRecarga = gasolinaList[0] ?? null;
  const costoPorKmGasolina =
    odometroActual > 0 ? Math.round((gastoGasolina / odometroActual) * 100) / 100 : 0;
  const deltaKms = gasolinaList
    .slice(0, -1)
    .map((e, i) => e.kilometraje - gasolinaList[i + 1].kilometraje)
    .filter((d) => d > 0);
  const avgKmRecarga = deltaKms.length > 0
    ? Math.round(deltaKms.reduce((s, d) => s + d, 0) / deltaKms.length)
    : 0;

  // ── Electricidad summary (alineado con Centro de Energía) ───────────────
  const ultimoRecibo = getUltimoReciboElectrico(periodosElectricos);
  const energiaCostos = getCentroEnergiaCostos(ultimoRecibo, cargasList);
  const totalKwhByd = periodosElectricos.reduce(
    (s, p) => s + getBydKwhForPeriod(p, cargasList).value, 0,
  );
  const tarifaRecibo = energiaCostos?.costoKwh ?? null;
  const gastoBydMensual = energiaCostos?.costoByd ?? null;
  const gastoCasaMensual = energiaCostos?.costoCasa ?? null;
  const gastoAnualByd = getGastoElectricoBydAnual(periodosElectricos, cargasList);

  // ── Spend proportions (for stacked bar) ──────────────────────────────
  const segments = [
    { label: "Gasolina",        value: gastoGasolina,  color: "#f59e0b" },
    { label: "Electricidad",    value: totalElec,      color: "#34d399" },
    { label: "Mantenimiento",   value: totalOficial,   color: "#60a5fa" },
    { label: "Otros costos",    value: totalOtros,     color: "#c084fc" },
  ].filter((s) => s.value > 0);

  // (chips moved to global KPI row in Home)

  return (
    <div className="space-y-3">
      {/* ── 2-column layout: left = charts, right = module cards ── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_268px]">

        {/* ── LEFT: Charts ── */}
        <div className="space-y-3">
          <GastoEvolucionLine
            gasolinaList={gasolinaList}
            periodosElectricos={periodosElectricos}
            cargasList={cargasList}
            mantenimientoRows={mantenimientoRows}
            otrosRows={otrosRows}
          />
          <GastoComparativoStacked
            gasolinaList={gasolinaList}
            periodosElectricos={periodosElectricos}
            cargasList={cargasList}
            mantenimientoRows={mantenimientoRows}
            otrosRows={otrosRows}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <GastoDistribucionPie segments={segments} />
            {/* Resumen rápido */}
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">Resumen rápido</p>
              <div className="space-y-1.5 text-[10px]">
                {[
                  { icon: "⛽", label: "Costo por km (gasolina)", val: `$${costoPorKmGasolina.toFixed(2)}` },
                  { icon: "⚡", label: "Costo por km (eléctrico)", val: tarifaRecibo != null ? `$${(tarifaRecibo * 0.174).toFixed(2)}` : "—" },
                  { icon: "📊", label: "Costo por km (total)",    val: `$${costoPorKmGlobal.toFixed(2)}` },
                  { icon: "📅", label: "Gasto diario promedio",  val: formatCurrency(Math.round(totalIntegrado / 365)) },
                  { icon: "📅", label: "Gasto mensual promedio", val: formatCurrency(Math.round(totalIntegrado / 12)) },
                  { icon: "📋", label: "Última carga de gasolina", val: ultimaRecarga ? formatDateShort(ultimaRecarga.fecha) : "—" },
                ].map((x) => (
                  <div key={x.label} className="flex items-center justify-between gap-1">
                    <span className="flex items-center gap-1 text-white/35 min-w-0">
                      <span className="shrink-0">{x.icon}</span>
                      <span className="truncate">{x.label}</span>
                    </span>
                    <span className="ml-1 shrink-0 font-medium text-white/60">{x.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <ActividadReciente gasolinaList={gasolinaList} cargasList={cargasList} onNavigate={onNavigate} />
        </div>

        {/* ── RIGHT: Module summary cards ── */}
        <div className="space-y-2">

          {/* Health status */}
          <button type="button" onClick={() => onNavigate("mantenimiento")}
            className={`w-full flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors hover:opacity-90 ${status.borderColor} ${status.bg}`}>
            {(() => {
              const R = 16; const C = 2 * Math.PI * R;
              return (
                <svg width="38" height="38" viewBox="0 0 38 38" className="shrink-0">
                  <circle cx="19" cy="19" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
                  <circle cx="19" cy="19" r={R} fill="none" stroke={healthColor} strokeWidth="5"
                    strokeLinecap="round" strokeDasharray={C}
                    strokeDashoffset={C - (healthScore / 100) * C}
                    transform="rotate(-90 19 19)"
                    style={{ transition: "stroke-dashoffset 1s ease" }}
                  />
                  <text x="19" y="19" textAnchor="middle" dominantBaseline="central"
                    style={{ fontSize: 10, fontWeight: 700, fill: healthColor }}>{healthScore}</text>
                </svg>
              );
            })()}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-semibold" style={{ color: healthColor }}>{healthLabel}</span>
                <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-medium ${
                  estadoServicio === "Vencido" ? "text-red-400 border-red-500/30"
                  : estadoServicio === "Urgente" ? "text-red-400 border-red-500/30"
                  : estadoServicio === "Próximo" ? "text-amber-400 border-amber-500/25"
                  : "text-green-400 border-green-500/20"
                }`}>{estadoServicio}</span>
              </div>
              <p className="mt-0.5 text-[9px] text-white/30 truncate">
                {estadoServicio === "Vencido" ? "Servicio vencido — agenda lo antes posible"
                  : estadoServicio === "Urgente" ? "Agenda tu servicio pronto"
                  : estadoServicio === "Próximo" ? "Servicio próximo — planifica tu cita"
                  : "Todo bien — sin acciones requeridas"}
              </p>
            </div>
            <span className="shrink-0 text-white/20 text-xs">→</span>
          </button>

          {/* ⛽ Gasolina */}
          <button type="button" onClick={() => onNavigate("gasolina")}
            className="w-full rounded-xl border border-amber-500/15 bg-amber-500/[0.03] p-3 text-left transition-colors hover:bg-amber-500/[0.06]">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-400/80">⛽ Gasolina</span>
              <span className="text-[9px] text-byd-400/50">Ver detalle →</span>
            </div>
            <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 text-[10px]">
              <div><p className="text-white/25 leading-tight">Total litros</p><p className="font-semibold text-white/70">{totalLitros.toFixed(0)} L</p></div>
              <div><p className="text-white/25 leading-tight">Gasto acumulado</p><p className="font-semibold text-white/70">{formatCurrency(gastoGasolina)}</p></div>
              <div><p className="text-white/25 leading-tight">Rendimiento</p><p className="font-semibold text-white/70">{rendimientoKmL} km/L</p></div>
              <div><p className="text-white/25 leading-tight">Última carga</p><p className="font-semibold text-white/70 truncate">{ultimaRecarga ? formatDateShort(ultimaRecarga.fecha) : "—"}</p></div>
              <div><p className="text-white/25 leading-tight">Promedio km por tanque</p><p className="font-semibold text-white/70">{avgKmRecarga > 0 ? avgKmRecarga.toLocaleString() : "—"}</p></div>
              <div><p className="text-white/25 leading-tight">Costo por km</p><p className="font-semibold text-white/70">${costoPorKmGasolina.toFixed(2)}</p></div>
            </div>
          </button>

          {/* ⚡ Electricidad */}
          <button type="button" onClick={() => onNavigate("energia")}
            className="w-full rounded-xl border border-green-500/15 bg-green-500/[0.03] p-3 text-left transition-colors hover:bg-green-500/[0.06]">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-green-400/80">⚡ Electricidad BYD</span>
              <span className="text-[9px] text-byd-400/50">Ver detalle →</span>
            </div>
            <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 text-[10px]">
              <div><p className="text-white/25 leading-tight">Consumo BYD (kWh)</p><p className="font-semibold text-white/70">{totalKwhByd.toFixed(0)}</p></div>
              <div><p className="text-white/25 leading-tight">Gasto acumulado</p><p className="font-semibold text-white/70">{formatCurrency(totalElec)}</p></div>
              <div><p className="text-white/25 leading-tight">Tarifa promedio</p><p className="font-semibold text-white/70">{tarifaRecibo != null ? `$${tarifaRecibo.toFixed(4)}/kWh` : "Sin dato"}</p></div>
              <div><p className="text-white/25 leading-tight">Costo mensual de carga del BYD</p><p className="font-semibold text-white/70">{gastoBydMensual != null ? formatCurrency(gastoBydMensual) : "Sin dato"}</p></div>
              <div><p className="text-white/25 leading-tight">Gasto mensual de tu vivienda</p><p className="font-semibold text-white/70">{gastoCasaMensual != null ? formatCurrency(gastoCasaMensual) : "Sin dato"}</p></div>
              <div><p className="text-white/25 leading-tight">Gasto acumulado anual</p><p className="font-semibold text-white/70">{formatCurrency(Math.round(gastoAnualByd * 100) / 100)}</p></div>
            </div>
          </button>

          {/* 🔧 Mantenimiento */}
          <button type="button" onClick={() => onNavigate("mantenimiento")}
            className="w-full rounded-xl border border-blue-500/15 bg-blue-500/[0.03] p-3 text-left transition-colors hover:bg-blue-500/[0.06]">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-400/80">🔧 Mantenimiento</span>
              <span className="text-[9px] text-byd-400/50">Ver detalle →</span>
            </div>
            <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 text-[10px]">
              <div><p className="text-white/25 leading-tight">Servicios oficiales</p><p className="font-semibold text-white/70">{formatCurrency(totalOficial)}</p></div>
              <div><p className="text-white/25 leading-tight">Otros costos</p><p className="font-semibold text-white/70">{formatCurrency(totalOtros)}</p></div>
              <div><p className="text-white/25 leading-tight">Servicios realizados</p><p className="font-semibold text-white/70">{mantenimientoList.length}</p></div>
              <div><p className="text-white/25 leading-tight">Próximo servicio</p><p className={`font-semibold truncate ${estadoServicio === "Vencido" || estadoServicio === "Urgente" ? "text-red-400" : estadoServicio === "Próximo" ? "text-amber-400" : "text-white/70"}`}>{proximo ? `${proximo.km.toLocaleString()} km` : "Completado"}</p></div>
              <div><p className="text-white/25 leading-tight">Estado</p><p className={`font-semibold ${
                estadoServicio === "Vencido" || estadoServicio === "Urgente" ? "text-red-400"
                : estadoServicio === "Próximo" ? "text-amber-400"
                : "text-green-400"
              }`}>{estadoServicio}</p></div>
              <div><p className="text-white/25 leading-tight">Km restantes</p><p className={`font-semibold ${
                estadoServicio === "Vencido" || estadoServicio === "Urgente" ? "text-red-400"
                : estadoServicio === "Próximo" ? "text-amber-400"
                : "text-white/70"
              }`}>{kmRestantesLabel}</p></div>
            </div>
          </button>

          {/* 🔩 Otros costos */}
          {totalOtros > 0 && (
            <button type="button" onClick={() => onNavigate("mantenimiento")}
              className="w-full rounded-xl border border-purple-500/15 bg-purple-500/[0.03] p-3 text-left transition-colors hover:bg-purple-500/[0.06]">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-purple-400/80">🔩 Otros costos</span>
                <span className="text-[9px] text-byd-400/50">Ver detalle →</span>
              </div>
              <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 text-[10px]">
                <div><p className="text-white/25 leading-tight">Gasto acumulado</p><p className="font-semibold text-white/70">{formatCurrency(totalOtros)}</p></div>
                <div><p className="text-white/25 leading-tight">Registros</p><p className="font-semibold text-white/70">{otrosCostosList.length}</p></div>
                <div><p className="text-white/25 leading-tight">Promedio por registro</p><p className="font-semibold text-white/70">{otrosCostosList.length > 0 ? formatCurrency(Math.round(totalOtros / otrosCostosList.length)) : "—"}</p></div>
              </div>
            </button>
          )}

        </div>
      </div>
    </div>
  );
}

// ── OtroCostoForm ─────────────────────────────────────────────────────────
function OtroCostoForm({
  initialData,
  onSave,
}: {
  initialData?: OtroCostoEntry;
  onSave: (entry: OtroCostoEntry) => void;
}) {
  const isEdit = !!initialData;
  const [fecha, setFecha] = useState(initialData?.fecha ?? new Date().toISOString().slice(0, 10));
  const [odometro, setOdometro] = useState(String(initialData?.odometro ?? ""));
  const [concepto, setConcepto] = useState(initialData?.concepto ?? "");
  const [categoria, setCategoria] = useState<string>(initialData?.categoria ?? OTRAS_CATEGORIAS[0]);
  const [costo, setCosto] = useState(String(initialData?.costo ?? ""));
  const [proveedor, setProveedor] = useState(initialData?.proveedor ?? "");
  const [notas, setNotas] = useState(initialData?.notas ?? "");
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const costoNum = parseFloat(costo);
    if (!fecha) { setError("La fecha es requerida."); return; }
    if (!concepto.trim()) { setError("El concepto es requerido."); return; }
    if (isNaN(costoNum) || costoNum < 0) { setError("El costo debe ser mayor o igual a 0."); return; }
    const entry: OtroCostoEntry = {
      id: initialData?.id ?? String(Date.now()),
      fecha,
      odometro: odometro ? parseInt(odometro) : undefined,
      concepto: concepto.trim(),
      categoria,
      costo: costoNum,
      proveedor: proveedor.trim() || undefined,
      notas: notas.trim() || undefined,
    };
    onSave(entry);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <InputField label="Fecha" type="date" value={fecha} onChange={setFecha} required />
        <InputField label="Odómetro (km)" type="number" value={odometro} onChange={setOdometro} />
      </div>
      <div>
        <p className="mb-1 text-[11px] font-medium text-white/40">Categoría</p>
        <select
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none focus:border-byd-500/40"
        >
          {OTRAS_CATEGORIAS.map((c) => (
            <option key={c} value={c} className="bg-[#0d1117]">{c}</option>
          ))}
        </select>
      </div>
      <InputField label="Concepto" type="text" value={concepto} onChange={setConcepto} required />
      <div className="grid grid-cols-2 gap-3">
        <InputField label="Costo ($)" type="number" step="0.01" min="0" value={costo} onChange={setCosto} required />
        <InputField label="Taller / Proveedor" type="text" value={proveedor} onChange={setProveedor} />
      </div>
      <InputField label="Notas" type="text" value={notas} onChange={setNotas} />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        className="w-full rounded-lg bg-byd-500 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-byd-400"
      >
        {isEdit ? "Guardar cambios" : "Registrar gasto"}
      </button>
    </form>
  );
}

// ── SeccionMantenimiento ───────────────────────────────────────────────────
function SeccionMantenimiento({
  odometroActual,
  mantenimientoList,
  otrosCostosList,
  onRegistrar,
  onEdit,
  onDelete,
  onUpdateAdjunto,
  onNewOtroCosto,
  onEditOtroCosto,
  onDeleteOtroCosto,
}: {
  odometroActual: number;
  mantenimientoList: MantenimientoEntry[];
  otrosCostosList: OtroCostoEntry[];
  onRegistrar: (km: number) => void;
  onEdit: (entry: MantenimientoEntry) => void;
  onDelete: (entry: MantenimientoEntry) => void;
  onUpdateAdjunto: (id: string, adjunto: MantenimientoEntry["adjunto"]) => void;
  onNewOtroCosto: () => void;
  onEditOtroCosto: (entry: OtroCostoEntry) => void;
  onDeleteOtroCosto: (entry: OtroCostoEntry) => void;
}) {
  const [viewChecklistId, setViewChecklistId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [adjuntoTargetId, setAdjuntoTargetId] = useState<string | null>(null);

  function triggerFilePick(id: string) {
    setAdjuntoTargetId(id);
    fileInputRef.current?.click();
  }

  function handleAdjuntoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !adjuntoTargetId) return;
    if (file.size > 4 * 1024 * 1024) {
      alert("El archivo no debe superar 4 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      onUpdateAdjunto(adjuntoTargetId, {
        nombre: file.name,
        tipo: file.type,
        data: reader.result as string,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
    setAdjuntoTargetId(null);
  }

  function verAdjunto(adjunto: NonNullable<MantenimientoEntry["adjunto"]>) {
    const win = window.open("", "_blank");
    if (!win) return;
    if (adjunto.tipo.startsWith("image/")) {
      win.document.write(`<html><body style="margin:0;background:#000"><img src="${adjunto.data}" style="max-width:100%;display:block;margin:auto"></body></html>`);
    } else {
      win.document.write(`<html><body style="margin:0"><embed src="${adjunto.data}" width="100%" height="100%" type="${adjunto.tipo}"></body></html>`);
    }
  }
  const proximo = BYD_KING_SERVICIOS.find((s) => s.km > odometroActual) ?? null;
  const anterior = proximo
    ? (BYD_KING_SERVICIOS[BYD_KING_SERVICIOS.indexOf(proximo) - 1] ?? null)
    : BYD_KING_SERVICIOS[BYD_KING_SERVICIOS.length - 1];

  const kmRestantes = proximo ? proximo.km - odometroActual : 0;
  const rangeKm = proximo && anterior ? proximo.km - anterior.km : proximo ? proximo.km : 15000;
  const kmFromLast = proximo && anterior ? odometroActual - anterior.km : odometroActual;
  const progressPct = Math.min(100, Math.round((kmFromLast / rangeKm) * 100));

  const status = getMantenimientoStatusKm(kmRestantes);
  const statusMessage =
    status.label === "Al día" && kmRestantes > 0
      ? `Al día — aún faltan ${kmRestantes.toLocaleString()} km para el próximo servicio.`
      : status.message;

  // KPI calculations — oficial services only
  const totalOficial = mantenimientoList.reduce((s, e) => s + (e.costoReal ?? e.costo), 0);
  const totalEstimado = mantenimientoList.reduce((s, e) => s + (e.costoEstimado ?? e.costo), 0);
  const diffCosto = totalOficial - totalEstimado;   // oficial only, no otros
  const maxOdo = mantenimientoList.length > 0 ? Math.max(...mantenimientoList.map((e) => e.km)) : 0;
  const costoPorKm = maxOdo > 0 ? Math.round((totalOficial / maxOdo) * 100) / 100 : 0;
  const promedioPorServicio = mantenimientoList.length > 0
    ? Math.round(totalOficial / mantenimientoList.length)
    : 0;

  // Otros costos KPIs
  const totalOtros = otrosCostosList.reduce((s, e) => s + e.costo, 0);
  const totalGeneral = totalOficial + totalOtros;

  // Bar chart data for oficial services (oldest → newest)
  const chartData = [...mantenimientoList]
    .sort((a, b) => (a.fecha && b.fecha ? a.fecha.localeCompare(b.fecha) : a.km - b.km))
    .map((e) => ({
      label: e.kmProgramado ? `${(e.kmProgramado / 1000).toFixed(0)}k` : formatDateShort(e.fecha),
      real: e.costoReal ?? e.costo,
      estimado: e.costoEstimado ?? e.costo,
    }));

  // Category breakdown data (oficial + otros grouped by category)
  const catMap: Record<string, number> = { "Servicio oficial": totalOficial };
  for (const e of otrosCostosList) {
    catMap[e.categoria] = (catMap[e.categoria] ?? 0) + e.costo;
  }
  const catData = Object.entries(catMap)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, total]) => ({ cat, total }));

  // ── Salud del vehículo ─────────────────────────────────────────────────
  const serviciosCompletados = mantenimientoList.filter((e) => e.estado === "completado").length;
  const serviciosProximos   = status.label === "Próximo" || status.label === "Urgente" ? 1 : 0;
  const serviciosVencidos   = kmRestantes <= 0 ? 1 : 0;

  // Annual avg: span from first to last record date
  const sortedAscDates = [...mantenimientoList]
    .filter((e) => e.fecha)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const firstFecha = sortedAscDates[0]?.fecha;
  const lastFecha  = sortedAscDates[sortedAscDates.length - 1]?.fecha;
  const yearsSpan  = (() => {
    if (!firstFecha || !lastFecha || firstFecha === lastFecha) return 1;
    const d1 = new Date(firstFecha);
    const d2 = new Date(lastFecha);
    return Math.max(1, ((d2.getFullYear() - d1.getFullYear()) * 12 + d2.getMonth() - d1.getMonth()) / 12);
  })();
  const promedioAnual = mantenimientoList.length > 0
    ? Math.round(totalOficial / yearsSpan)
    : 0;

  // Health score (0-100)
  let healthScore = 100;
  if (kmRestantes <= 0)               healthScore -= 35;
  else if (kmRestantes <= 500)        healthScore -= 20;
  else if (kmRestantes <= 2000)       healthScore -= 10;
  if (mantenimientoList.length === 0) healthScore -= 15;
  healthScore = Math.max(0, Math.min(100, healthScore));

  const healthLabel =
    healthScore >= 98 ? "Excelente" :
    healthScore >= 90 ? "Muy bueno" :
    healthScore >= 80 ? "Bueno" :
    healthScore >= 70 ? "Requiere atención" : "Atención inmediata";
  const healthColor =
    healthScore >= 98 ? "#4ade80" :
    healthScore >= 90 ? "#60efb0" :
    healthScore >= 80 ? "#a3e635" :
    healthScore >= 70 ? "#fbbf24" : "#f87171";

  // ── Export helpers ──────────────────────────────────────────────────────
  function exportCSV() {
    const exportDate = new Date().toLocaleDateString("es-MX");
    const rows: string[] = [];
    const q = (s: string | number | undefined) =>
      `"${String(s ?? "").replace(/"/g, '""')}"`;

    rows.push(`"BYD Wallet — Exportación Mantenimiento","${exportDate}"`);
    rows.push("");

    // Servicios oficiales
    rows.push('"== SERVICIOS OFICIALES =="');
    rows.push([
      "Fecha", "Servicio", "Odómetro (km)", "Agencia",
      "Costo estimado ($)", "Costo real ($)", "Diferencia ($)", "Notas",
    ].map(q).join(","));
    const sorted = [...mantenimientoList].sort((a, b) =>
      (a.fecha ?? "").localeCompare(b.fecha ?? "")
    );
    for (const e of sorted) {
      const est = e.costoEstimado ?? e.costo;
      const real = e.costoReal ?? e.costo;
      rows.push([
        e.fecha, e.servicio, e.km, e.agencia ?? "",
        est.toFixed(2), real.toFixed(2), (real - est).toFixed(2), e.notas ?? "",
      ].map(q).join(","));
    }
    rows.push(`"Total servicios oficiales",,,,,"${totalOficial.toFixed(2)}"`);
    rows.push("");

    // Otros costos
    rows.push('"== OTROS COSTOS Y REFACCIONES =="');
    rows.push(["Fecha", "Concepto", "Categoría", "Odómetro (km)", "Proveedor", "Costo ($)", "Notas"].map(q).join(","));
    const sortedOtros = [...otrosCostosList].sort((a, b) =>
      (a.fecha ?? "").localeCompare(b.fecha ?? "")
    );
    for (const e of sortedOtros) {
      rows.push([
        e.fecha, e.concepto, e.categoria, e.odometro ?? "", e.proveedor ?? "",
        e.costo.toFixed(2), e.notas ?? "",
      ].map(q).join(","));
    }
    rows.push(`"Total otros costos",,,,,,"${totalOtros.toFixed(2)}"`);
    rows.push("");

    // Resumen
    rows.push('"== RESUMEN =="');
    rows.push(`"Total mantenimiento oficial","${totalOficial.toFixed(2)}"`);
    rows.push(`"Total otros costos","${totalOtros.toFixed(2)}"`);
    rows.push(`"TOTAL GENERAL","${totalGeneral.toFixed(2)}"`);
    rows.push(`"Diferencia estimado vs real (oficial)","${diffCosto.toFixed(2)}"`);
    rows.push(`"Costo por km","${costoPorKm.toFixed(2)}"`);
    rows.push(`"Fecha de exportación","${exportDate}"`);

    const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `byd-mantenimiento-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPDF() {
    const exportDate = new Date().toLocaleDateString("es-MX");
    const sortedOf = [...mantenimientoList].sort((a, b) =>
      (a.fecha ?? "").localeCompare(b.fecha ?? "")
    );
    const sortedOtros = [...otrosCostosList].sort((a, b) =>
      (a.fecha ?? "").localeCompare(b.fecha ?? "")
    );

    const rowStyle = `style="border-bottom:1px solid #e5e7eb;padding:6px 8px;font-size:12px;"`;
    const thStyle  = `style="background:#f3f4f6;padding:6px 8px;font-size:11px;font-weight:600;text-align:left;border-bottom:2px solid #d1d5db;"`;

    const oficialRows = sortedOf.map((e) => {
      const est = e.costoEstimado ?? e.costo;
      const real = e.costoReal ?? e.costo;
      return `<tr>
        <td ${rowStyle}>${e.fecha}</td>
        <td ${rowStyle}>${e.servicio}</td>
        <td ${rowStyle}>${e.km.toLocaleString()} km</td>
        <td ${rowStyle}>${e.agencia ?? "—"}</td>
        <td ${rowStyle}>$${est.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</td>
        <td ${rowStyle}>$${real.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</td>
        <td ${rowStyle} style="color:${real - est > 0 ? "#dc2626" : "#16a34a"}">
          ${real - est > 0 ? "+" : ""}$${(real - est).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
        </td>
      </tr>`;
    }).join("");

    const otrosRows = sortedOtros.map((e) => `<tr>
      <td ${rowStyle}>${e.fecha}</td>
      <td ${rowStyle}>${e.concepto}</td>
      <td ${rowStyle}>${e.categoria}</td>
      <td ${rowStyle}>${e.odometro ? e.odometro.toLocaleString() + " km" : "—"}</td>
      <td ${rowStyle}>${e.proveedor ?? "—"}</td>
      <td ${rowStyle}>$${e.costo.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</td>
    </tr>`).join("");

    const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>BYD Wallet — Mantenimiento</title>
<style>
  body{font-family:system-ui,sans-serif;margin:0;padding:24px 32px;color:#111;}
  h1{font-size:20px;margin:0 0 4px;}
  h2{font-size:14px;margin:24px 0 8px;color:#374151;}
  .meta{font-size:12px;color:#6b7280;margin-bottom:20px;}
  table{width:100%;border-collapse:collapse;margin-bottom:16px;}
  .summary{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:20px;}
  .kpi{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;}
  .kpi-label{font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;}
  .kpi-value{font-size:18px;font-weight:700;color:#111;margin-top:2px;}
  .kpi-total{background:#eff6ff;border-color:#bfdbfe;}
  .footer{margin-top:32px;font-size:10px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:12px;}
  @media print{body{padding:16px;}@page{margin:1cm;}}
</style></head><body>
<h1>🔧 Historial de Mantenimiento — BYD King</h1>
<p class="meta">Exportado el ${exportDate}</p>

<h2>Servicios Oficiales</h2>
<table>
  <thead><tr>
    <th ${thStyle}>Fecha</th><th ${thStyle}>Servicio</th><th ${thStyle}>Odómetro</th>
    <th ${thStyle}>Agencia</th><th ${thStyle}>Estimado</th><th ${thStyle}>Real</th><th ${thStyle}>Diferencia</th>
  </tr></thead>
  <tbody>${oficialRows || `<tr><td colspan="7" style="padding:12px;text-align:center;color:#9ca3af;">Sin registros</td></tr>`}</tbody>
  <tfoot><tr>
    <td colspan="5" style="padding:6px 8px;font-size:12px;font-weight:600;">Total servicios oficiales</td>
    <td colspan="2" style="padding:6px 8px;font-size:13px;font-weight:700;">$${totalOficial.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</td>
  </tr></tfoot>
</table>

<h2>Otros Costos y Refacciones</h2>
<table>
  <thead><tr>
    <th ${thStyle}>Fecha</th><th ${thStyle}>Concepto</th><th ${thStyle}>Categoría</th>
    <th ${thStyle}>Odómetro</th><th ${thStyle}>Proveedor</th><th ${thStyle}>Costo</th>
  </tr></thead>
  <tbody>${otrosRows || `<tr><td colspan="6" style="padding:12px;text-align:center;color:#9ca3af;">Sin registros</td></tr>`}</tbody>
  <tfoot><tr>
    <td colspan="5" style="padding:6px 8px;font-size:12px;font-weight:600;">Total otros costos</td>
    <td style="padding:6px 8px;font-size:13px;font-weight:700;">$${totalOtros.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</td>
  </tr></tfoot>
</table>

<div class="summary">
  <div class="kpi">
    <div class="kpi-label">Serv. oficial</div>
    <div class="kpi-value">$${totalOficial.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Otros costos</div>
    <div class="kpi-value">$${totalOtros.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</div>
  </div>
  <div class="kpi kpi-total">
    <div class="kpi-label">Total general</div>
    <div class="kpi-value">$${totalGeneral.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Dif. estimado vs real</div>
    <div class="kpi-value" style="color:${diffCosto > 0 ? "#dc2626" : "#16a34a"}">
      ${diffCosto > 0 ? "+" : ""}$${Math.abs(diffCosto).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
    </div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Costo / km</div>
    <div class="kpi-value">$${costoPorKm.toFixed(2)}</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Servicios registrados</div>
    <div class="kpi-value">${mantenimientoList.length}</div>
  </div>
</div>
<p class="footer">BYD Wallet v${APP_VERSION} · Exportado el ${exportDate}</p>
<script>window.onload=()=>window.print();</script>
</body></html>`;

    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); }
  }

  return (
    <div className="space-y-3">
      {/* Hidden file input for changing adjunto from history */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        onChange={handleAdjuntoFileChange}
      />

      {/* ── Export toolbar ── */}
      {(mantenimientoList.length > 0 || otrosCostosList.length > 0) && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-white/30">Exportar historial</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={exportCSV}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/70"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              CSV
            </button>
            <button
              type="button"
              onClick={exportPDF}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/70"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              PDF
            </button>
          </div>
        </div>
      )}

      {/* ══ 🩺 Estado del vehículo ══ */}
      {(() => {
        const R = 52;
        const C = 2 * Math.PI * R;
        const offset = C - (healthScore / 100) * C;
        return (
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="text-xs">🩺</span>
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Estado del vehículo</h3>
            </div>

            {/* Score + cards row */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              {/* Circular score */}
              <div className="flex shrink-0 flex-col items-center justify-center gap-1.5">
                <svg width="100" height="100" viewBox="0 0 128 128">
                  <circle cx="64" cy="64" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
                  <circle
                    cx="64" cy="64" r={R}
                    fill="none"
                    stroke={healthColor}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={C}
                    strokeDashoffset={offset}
                    transform="rotate(-90 64 64)"
                    style={{ transition: "stroke-dashoffset 1s ease, stroke 0.5s ease" }}
                  />
                  <text x="64" y="60" textAnchor="middle" dominantBaseline="middle"
                    style={{ fontSize: 28, fontWeight: 700, fill: healthColor }}>
                    {healthScore}
                  </text>
                  <text x="64" y="82" textAnchor="middle" dominantBaseline="middle"
                    style={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }}>
                    / 100
                  </text>
                </svg>
                <p className="text-center text-[11px] font-semibold" style={{ color: healthColor }}>{healthLabel}</p>
              </div>

              {/* 6 KPI cards */}
              <div className="grid flex-1 grid-cols-2 gap-1.5 sm:grid-cols-3">
                <div className="rounded-lg border border-green-500/15 bg-green-500/[0.04] p-2 text-center">
                  <p className="text-[11px] leading-none">✅</p>
                  <p className="mt-0.5 text-xs font-bold text-green-400">{serviciosCompletados}</p>
                  <p className="text-[9px] text-white/35">Al día</p>
                </div>
                <div className="rounded-lg border border-amber-500/15 bg-amber-500/[0.04] p-2 text-center">
                  <p className="text-[11px] leading-none">⚠️</p>
                  <p className="mt-0.5 text-xs font-bold text-amber-400">{serviciosProximos}</p>
                  <p className="text-[9px] text-white/35">Próximos</p>
                </div>
                <div className="rounded-lg border border-red-500/15 bg-red-500/[0.04] p-2 text-center">
                  <p className="text-[11px] leading-none">❌</p>
                  <p className="mt-0.5 text-xs font-bold text-red-400">{serviciosVencidos}</p>
                  <p className="text-[9px] text-white/35">Vencidos</p>
                </div>
                <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-center">
                  <p className="text-[11px] leading-none">💰</p>
                  <p className="mt-0.5 text-[10px] font-bold text-white/75">{formatCurrency(totalGeneral)}</p>
                  <p className="text-[9px] text-white/35">Gasto total</p>
                </div>
                <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-center">
                  <p className="text-[11px] leading-none">🔧</p>
                  <p className="mt-0.5 text-xs font-bold text-white/75">{mantenimientoList.length}</p>
                  <p className="text-[9px] text-white/35">Servicios</p>
                </div>
                <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-center">
                  <p className="text-[11px] leading-none">📈</p>
                  <p className="mt-0.5 text-[10px] font-bold text-white/75">{formatCurrency(promedioAnual)}</p>
                  <p className="text-[9px] text-white/35">Prom. anual</p>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div className="mt-3">
              <p className="mb-2 text-[10px] font-medium text-white/35">Línea de tiempo BYD King</p>
              <div className="hidden sm:grid sm:grid-cols-[5.5rem_3.5rem_minmax(0,1fr)_5.5rem] sm:gap-x-3 sm:px-1 sm:pb-1">
                <span className="text-[9px] uppercase tracking-wide text-white/20">Km</span>
                <span className="text-[9px] uppercase tracking-wide text-white/20">Meses</span>
                <span className="text-[9px] uppercase tracking-wide text-white/20">Estado</span>
                <span className="text-right text-[9px] uppercase tracking-wide text-white/20">Acción</span>
              </div>
              <div className="space-y-2">
                {BYD_KING_SERVICIOS.map((s, idx) => {
                  const realizado = mantenimientoList.find(
                    (e) => e.kmProgramado === s.km || e.km === s.km
                  );
                  const servicioEstado = getServicioKmEstado(
                    s.km,
                    odometroActual,
                    proximo?.km ?? null,
                    !!realizado,
                  );
                  const meta = servicioKmEstadoMeta(servicioEstado);
                  const isLast = idx === BYD_KING_SERVICIOS.length - 1;
                  const dotColor =
                    servicioEstado === "realizado" ? "#4ade80"
                    : servicioEstado === "vencido" || servicioEstado === "urgente" ? "#f87171"
                    : servicioEstado === "proximo" ? "#fbbf24"
                    : servicioEstado === "al-dia" ? "#4ade80"
                    : "rgba(255,255,255,0.15)";

                  return (
                    <div key={s.km} className="flex gap-3 sm:grid sm:grid-cols-[5.5rem_3.5rem_minmax(0,1fr)_5.5rem] sm:items-start sm:gap-x-3">
                      {/* Vertical line + dot (mobile) */}
                      <div className="flex flex-col items-center sm:hidden">
                        <div
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[9px] font-bold"
                          style={{ borderColor: dotColor, backgroundColor: realizado ? dotColor + "20" : "transparent" }}
                        >
                          {realizado ? <span style={{ color: dotColor }}>✓</span>
                           : servicioEstado === "vencido" || servicioEstado === "urgente" ? <span className="text-red-400">!</span>
                           : servicioEstado === "proximo" || servicioEstado === "al-dia" ? <span style={{ color: dotColor }}>◎</span>
                           : <span className="text-white/20">·</span>}
                        </div>
                        {!isLast && (
                          <div className="my-1 w-0.5 flex-1" style={{ background: realizado ? "#4ade8030" : "rgba(255,255,255,0.06)" }} />
                        )}
                      </div>

                      {/* Km */}
                      <div className="min-w-0 sm:pt-0.5">
                        <span className={`text-[11px] font-semibold ${
                          realizado ? "text-white/70" : meta.text
                        }`}>
                          {s.km.toLocaleString()} km
                        </span>
                      </div>

                      {/* Meses */}
                      <div className="hidden sm:block sm:pt-0.5">
                        <span className="text-[10px] text-white/30">{s.meses} m</span>
                      </div>

                      {/* Estado + detalle */}
                      <div className={`min-w-0 ${isLast ? "" : "pb-1 sm:pb-0"}`}>
                        <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center">
                          <span className="text-[9px] text-white/25 sm:hidden">{s.meses} meses</span>
                          <span className={`inline-flex w-fit rounded-full px-1.5 py-0.5 text-[9px] font-medium ${meta.badgeBg}`}>
                            {meta.label}
                          </span>
                          {realizado ? (
                            <div className="flex flex-wrap gap-x-3 text-[10px] text-white/30">
                              {realizado.fecha && <span>📅 {formatDate(realizado.fecha)}</span>}
                              <span>💰 {formatCurrency(realizado.costoReal ?? realizado.costo)}</span>
                              {realizado.agencia && <span>🏪 {realizado.agencia}</span>}
                            </div>
                          ) : (
                            <span className="text-[10px] text-white/20">Est. {formatCurrency(s.costo)}</span>
                          )}
                        </div>
                      </div>

                      {/* Acción */}
                      <div className="hidden shrink-0 justify-end sm:flex sm:pt-0.5">
                        {!realizado && proximo?.km === s.km ? (
                          <button
                            type="button"
                            onClick={() => onRegistrar(s.km)}
                            className="rounded border border-byd-500/30 bg-byd-500/10 px-2 py-0.5 text-[9px] font-medium text-byd-400 hover:bg-byd-500/20"
                          >
                            Registrar
                          </button>
                        ) : (
                          <span className="text-[9px] text-white/15">—</span>
                        )}
                      </div>

                      {/* Acción mobile */}
                      {!realizado && proximo?.km === s.km && (
                        <div className="col-span-full pl-8 sm:hidden">
                          <button
                            type="button"
                            onClick={() => onRegistrar(s.km)}
                            className="rounded border border-byd-500/30 bg-byd-500/10 px-2 py-0.5 text-[9px] font-medium text-byd-400 hover:bg-byd-500/20"
                          >
                            + Registrar
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── KPIs ── */}
      {(mantenimientoList.length > 0 || otrosCostosList.length > 0) && (
        <div className="space-y-2">
          {/* Row 1 — oficial */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
              <p className="text-[10px] text-white/35">Serv. oficial</p>
              <p className="mt-0.5 text-xs font-semibold text-white/75">{formatCurrency(totalOficial)}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
              <p className="text-[10px] text-white/35">Promedio / serv.</p>
              <p className="mt-0.5 text-xs font-semibold text-white/75">{formatCurrency(promedioPorServicio)}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
              <p className="text-[10px] text-white/35">Dif. est. vs real</p>
              <p className={`mt-0.5 text-sm font-semibold ${diffCosto > 0 ? "text-red-400" : diffCosto < 0 ? "text-green-400" : "text-white/60"}`}>
                {diffCosto === 0 ? "—" : `${diffCosto > 0 ? "+" : ""}${formatCurrency(diffCosto)}`}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
              <p className="text-[10px] text-white/35">Costo / km</p>
              <p className="mt-0.5 text-xs font-semibold text-white/75">${costoPorKm.toFixed(2)}</p>
            </div>
          </div>
          {/* Row 2 — otros + total */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-amber-500/10 bg-amber-500/[0.03] p-3 text-center">
              <p className="text-[10px] text-white/35">Otros costos</p>
              <p className="mt-0.5 text-sm font-semibold text-amber-400/80">{formatCurrency(totalOtros)}</p>
            </div>
            <div className="rounded-xl border border-byd-500/15 bg-byd-500/[0.04] p-3 text-center">
              <p className="text-[10px] text-white/35">Total general</p>
              <p className="mt-0.5 text-sm font-semibold text-byd-300">{formatCurrency(totalGeneral)}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Gráficas: 2-col desktop ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Left — Evolución servicios oficiales */}
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <div className="mb-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-white/50">📊 Servicios oficiales</h3>
            <p className="mt-0.5 text-[9px] text-white/25">Costo estimado vs costo real por servicio (MXN)</p>
          </div>
          {chartData.length === 0 ? (
            <p className="py-8 text-center text-xs text-white/30">Aún no hay mantenimientos registrados.</p>
          ) : chartData.length === 1 ? (
            <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-4 text-center">
              <p className="text-[11px] text-white/45">Aún hay pocos servicios registrados para comparar.</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                <div className="rounded-lg bg-white/[0.03] p-2">
                  <p className="text-white/30">Estimado ({chartData[0].label})</p>
                  <p className="mt-0.5 font-semibold text-white/55">{formatCurrency(chartData[0].estimado)}</p>
                </div>
                <div className="rounded-lg bg-byd-500/10 p-2">
                  <p className="text-white/30">Real ({chartData[0].label})</p>
                  <p className="mt-0.5 font-semibold text-byd-400">{formatCurrency(chartData[0].real)}</p>
                </div>
              </div>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={chartData} barGap={4} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.35)" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} tick={{ fontSize: 9, fill: "rgba(255,255,255,0.35)" }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip
                    contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 11, color: "rgba(255,255,255,0.8)" }}
                    formatter={(value: unknown, name: unknown) => [formatCurrency(Number(value)), name === "real" ? "Costo real" : "Costo estimado"]}
                    labelStyle={{ color: "rgba(255,255,255,0.4)" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 9, paddingTop: 4 }} formatter={(value) => <span style={{ color: "rgba(255,255,255,0.45)" }}>{value === "real" ? "Real" : "Estimado"}</span>} />
                  <Bar dataKey="estimado" name="estimado" fill="rgba(255,255,255,0.12)" radius={[3, 3, 0, 0]} maxBarSize={36} />
                  <Bar dataKey="real" name="real" fill="rgba(100,220,180,0.65)" radius={[3, 3, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </div>

        {/* Right — Desglose por categoría */}
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
          <h3 className="mb-3 text-xs font-semibold text-white/70">🗂️ Desglose por categoría</h3>
          {catData.length === 0 ? (
            <p className="py-8 text-center text-xs text-white/30">Sin datos todavía.</p>
          ) : (
            <div className="space-y-2">
              {catData.map(({ cat, total }) => {
                const pct = totalGeneral > 0 ? Math.round((total / totalGeneral) * 100) : 0;
                const isOficial = cat === "Servicio oficial";
                return (
                  <div key={cat}>
                    <div className="mb-0.5 flex items-center justify-between text-[10px]">
                      <span className={isOficial ? "text-green-400/70" : "text-amber-400/70"}>{cat}</span>
                      <span className="text-white/40">{formatCurrency(total)} · {pct}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                      <div
                        className={`h-full rounded-full ${isOficial ? "bg-green-400/50" : "bg-amber-400/50"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {catData.length > 0 && (
            <p className="mt-3 text-right text-[9px] text-white/20">Total: {formatCurrency(totalGeneral)}</p>
          )}
        </div>
      </div>

      {/* ── Próximo servicio ── */}
      {proximo ? (
        <div className={`rounded-xl border p-3 ${status.bg} ${status.borderColor}`}>
          {/* Header */}
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-white/50">🔧 Próximo mantenimiento</h3>
            <button
              type="button"
              onClick={() => onRegistrar(proximo.km)}
              className="rounded-lg border border-byd-500/30 bg-byd-500/10 px-2.5 py-1 text-[11px] font-medium text-byd-400 transition-colors hover:bg-byd-500/20"
            >
              + Registrar servicio
            </button>
          </div>

          {/* Alert banner */}
          <div className={`mb-4 flex items-center gap-3 rounded-xl px-4 py-3 ${status.bg} border ${status.borderColor}`}>
            <span className="text-lg leading-none">{status.icon}</span>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-sm font-semibold ${status.color}`}>{status.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${status.bg} ${status.color} border ${status.borderColor}`}>
                  {kmRestantes <= 0 ? "km vencido" : `${kmRestantes.toLocaleString()} km restantes`}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-white/40">{statusMessage}</p>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-[11px] text-white/35">Odómetro actual</p>
              <p className="font-semibold text-white/80">{odometroActual.toLocaleString()} km</p>
            </div>
            <div>
              <p className="text-[11px] text-white/35">Próximo servicio</p>
              <p className={`font-semibold ${status.color}`}>{proximo.km.toLocaleString()} km</p>
            </div>
            <div>
              <p className="text-[11px] text-white/35">Km restantes</p>
              <p className={`font-semibold ${kmRestantes <= 0 ? "text-red-400" : status.color}`}>
                {kmRestantes <= 0 ? "Vencido" : `${kmRestantes.toLocaleString()} km`}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-white/35">Costo estimado</p>
              <p className="font-semibold text-white/80">{formatCurrency(proximo.costo)}</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-[10px] text-white/30">
              <span>{anterior ? anterior.km.toLocaleString() : "0"} km</span>
              <span>{progressPct}% del intervalo</span>
              <span>{proximo.km.toLocaleString()} km</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  kmRestantes <= 0 ? "bg-red-400" :
                  kmRestantes <= 500 ? "bg-red-400" :
                  kmRestantes <= 2000 ? "bg-amber-400" : "bg-green-400"
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

        </div>
      ) : (
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 text-center">
          <p className="text-sm text-white/40">Odómetro fuera del rango del calendario BYD King (0–150,000 km).</p>
        </div>
      )}

      {/* ── Historial de mantenimientos ── */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-white/60">📋 Historial de mantenimientos</h3>
          <span className="text-[10px] text-white/30">{mantenimientoList.length} registros</span>
        </div>
        {mantenimientoList.length > 0 ? (
          <div className="space-y-2">
            {[...mantenimientoList]
              .sort((a, b) => {
                // Sort most-recent first: by fecha desc, then km desc as fallback
                if (a.fecha && b.fecha) return b.fecha.localeCompare(a.fecha);
                return b.km - a.km;
              })
              .map((entry) => {
              const real = entry.costoReal ?? entry.costo;
              const est = entry.costoEstimado ?? entry.costo;
              const diff = real - est;
              const pct = calcChecklistPct(entry.checklist);
              const importantesPendientes = getImportantesPendientes(entry.checklist);
              const showChecklist = viewChecklistId === entry.id;
              return (
                <div key={entry.id} className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2.5 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-white/80">{entry.servicio}</p>
                        {entry.checklist && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            pct === 100 ? "bg-green-500/15 text-green-400" :
                            pct >= 50 ? "bg-amber-500/15 text-amber-400" :
                            "bg-red-500/15 text-red-400"
                          }`}>
                            {pct}% checklist
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-white/35">
                        <span>{formatDate(entry.fecha)}</span>
                        <span>{entry.km.toLocaleString()} km</span>
                        {entry.agencia && <span>🏪 {entry.agencia}</span>}
                      </div>
                      {/* Important items alert */}
                      {importantesPendientes.length > 0 && (
                        <p className="mt-1 text-[10px] text-amber-400/80">
                          ⚠️ Pendientes importantes: {importantesPendientes.join(", ")}
                        </p>
                      )}
                      <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px]">
                        <div>
                          <p className="text-white/25">Estimado</p>
                          <p className="font-medium text-white/50">{formatCurrency(est)}</p>
                        </div>
                        <div>
                          <p className="text-white/25">Real</p>
                          <p className="font-medium text-white/80">{formatCurrency(real)}</p>
                        </div>
                        <div>
                          <p className="text-white/25">Diferencia</p>
                          <p className={`font-medium ${diff > 0 ? "text-red-400" : "text-green-400"}`}>
                            {diff > 0 ? "+" : ""}{formatCurrency(diff)}
                          </p>
                        </div>
                      </div>
                      {entry.notas && (
                        <p className="mt-1 text-[10px] text-white/25 italic">{entry.notas}</p>
                      )}
                      {/* Expandable checklist */}
                      {entry.checklist && (
                        <button
                          type="button"
                          onClick={() => setViewChecklistId(showChecklist ? null : entry.id)}
                          className="mt-1.5 text-[10px] text-byd-400/70 hover:text-byd-400"
                        >
                          {showChecklist ? "▲ Ocultar checklist" : "▼ Ver checklist"}
                        </button>
                      )}
                      {showChecklist && entry.checklist && (
                        <div className="mt-2 space-y-1 rounded-lg border border-white/5 bg-white/[0.02] p-2">
                          {CHECKLIST_ITEMS.map((item) => {
                            const state = entry.checklist!.find((c) => c.id === item.id);
                            return (
                              <div key={item.id} className="flex items-start gap-2 text-[11px]">
                                <span className={`mt-0.5 shrink-0 ${state?.realizado ? "text-byd-400" : "text-white/20"}`}>
                                  {state?.realizado ? "✓" : "○"}
                                </span>
                                <div className="min-w-0">
                                  <span className={state?.realizado ? "text-white/60" : "text-white/30"}>
                                    {item.label}
                                    {item.importante && <span className="ml-1 text-[9px] text-amber-400/60">★</span>}
                                  </span>
                                  {state?.nota && (
                                    <p className="text-[10px] text-white/25 italic">{state.nota}</p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <Tag variant="green">Completado</Tag>
                        {entry.adjunto && (
                          <span title={entry.adjunto.nombre} className="text-sm">📎</span>
                        )}
                      </div>
                      {/* Adjunto actions */}
                      {entry.adjunto ? (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => verAdjunto(entry.adjunto!)}
                            className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40 transition-colors hover:bg-white/5 hover:text-white/60"
                            title="Ver adjunto"
                          >Ver</button>
                          <button
                            type="button"
                            onClick={() => triggerFilePick(entry.id)}
                            className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40 transition-colors hover:bg-white/5 hover:text-white/60"
                            title="Cambiar adjunto"
                          >↺</button>
                          <button
                            type="button"
                            onClick={() => onUpdateAdjunto(entry.id, undefined)}
                            className="rounded border border-red-500/20 px-1.5 py-0.5 text-[10px] text-red-400/40 transition-colors hover:bg-red-500/10 hover:text-red-400"
                            title="Eliminar adjunto"
                          >✕</button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => triggerFilePick(entry.id)}
                          className="rounded border border-dashed border-white/10 px-1.5 py-0.5 text-[10px] text-white/25 transition-colors hover:border-white/20 hover:text-white/45"
                          title="Agregar adjunto"
                        >📎 Adjuntar</button>
                      )}
                      {/* Edit / Delete */}
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => onEdit(entry)}
                          className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/40 transition-colors hover:bg-white/5 hover:text-white/60"
                          title="Editar"
                        >✏️</button>
                        <button
                          type="button"
                          onClick={() => onDelete(entry)}
                          className="rounded-lg border border-red-500/20 px-2 py-1 text-[11px] text-red-400/40 transition-colors hover:bg-red-500/10 hover:text-red-400"
                          title="Eliminar"
                        >🗑️</button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-white/30">No hay registros de mantenimiento aún.</p>
        )}
      </div>

      {/* ── Otros costos y refacciones ── */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-white/60">🔩 Otros costos y refacciones</h3>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/30">{otrosCostosList.length} registros</span>
            <button
              type="button"
              onClick={onNewOtroCosto}
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-400 transition-colors hover:bg-amber-500/20"
            >
              + Agregar
            </button>
          </div>
        </div>
        {otrosCostosList.length > 0 ? (
          <div className="space-y-1.5">
            {[...otrosCostosList]
              .sort((a, b) => (a.fecha && b.fecha ? b.fecha.localeCompare(a.fecha) : 0))
              .map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-white/75">{entry.concepto}</p>
                      <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium text-amber-400/80">{entry.categoria}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10px] text-white/30">
                      <span>{formatDate(entry.fecha)}</span>
                      {entry.odometro && <span>{entry.odometro.toLocaleString()} km</span>}
                      {entry.proveedor && <span>🏪 {entry.proveedor}</span>}
                    </div>
                    {entry.notas && <p className="mt-0.5 text-[10px] italic text-white/20">{entry.notas}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold text-amber-400/80">{formatCurrency(entry.costo)}</p>
                    <div className="mt-1 flex gap-1">
                      <button
                        type="button"
                        onClick={() => onEditOtroCosto(entry)}
                        className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/35 transition-colors hover:bg-white/5 hover:text-white/60"
                      >✏️</button>
                      <button
                        type="button"
                        onClick={() => onDeleteOtroCosto(entry)}
                        className="rounded border border-red-500/15 px-1.5 py-0.5 text-[10px] text-red-400/35 transition-colors hover:bg-red-500/10 hover:text-red-400"
                      >🗑️</button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <p className="py-4 text-center text-xs text-white/25">Ningún gasto extra registrado aún. Agrega filtros, alineación, refacciones, etc.</p>
        )}
      </div>

      {/* ── Calendario oficial BYD King ── */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/60">📅 Calendario oficial BYD King</h3>
        <div className="space-y-1.5">
          {BYD_KING_SERVICIOS.map((s) => {
            const realizado = mantenimientoList.find(
              (e) => e.kmProgramado === s.km || e.km === s.km
            );
            const servicioEstado = getServicioKmEstado(
              s.km,
              odometroActual,
              proximo?.km ?? null,
              !!realizado,
            );
            const meta = servicioKmEstadoMeta(servicioEstado);
            const isCurrent = proximo?.km === s.km;
            return (
              <div
                key={s.km}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isCurrent ? "border border-white/10 bg-white/[0.05]" : "opacity-80"
                }`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                <span className="w-28 shrink-0 font-medium text-white/70">{s.km.toLocaleString()} km</span>
                <span className="text-[11px] text-white/30">{s.meses} meses</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${meta.badgeBg}`}>{meta.label}</span>
                <span className="ml-auto text-[11px] font-medium text-white/60">{formatCurrency(s.costo)}</span>
                {realizado && <span className="text-[10px] text-green-400/70">✓</span>}
                {isCurrent && !realizado && (
                  <button
                    type="button"
                    onClick={() => onRegistrar(s.km)}
                    className="rounded border border-byd-500/30 bg-byd-500/10 px-1.5 py-0.5 text-[10px] text-byd-400 hover:bg-byd-500/20"
                  >
                    + Registrar
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-right text-[10px] text-white/20">
          Total acumulado: {formatCurrency(BYD_KING_SERVICIOS.reduce((s, r) => s + r.costo, 0))}
        </p>
      </div>
    </div>
  );
}

// ── Gráfico histórico (SVG puro, sin librerías) ──────────────────────────
type GraficoMetrica = "kwh" | "costo" | "promedio";

function GraficoHistorico({
  periodos,
  cargas,
}: {
  periodos: PeriodoElectricoRow[];
  cargas: CargaEntry[];
}) {
  const [metrica, setMetrica] = useState<GraficoMetrica>("kwh");

  const data = [...periodos].reverse().map((r) => ({
    label: formatDateShort(r.fecha_fin),
    kwh: Number(r.kwh_bimestre) || 0,
    costo: Number(r.costo_total_mxn) || 0,
    promedio: r.costo_kwh_mxn ? Number(r.costo_kwh_mxn) : 0,
    r,
  }));

  const getValue = (d: (typeof data)[0]) =>
    metrica === "kwh" ? d.kwh : metrica === "costo" ? d.costo : d.promedio;

  const values = data.map(getValue);
  const maxVal = Math.max(...values, 1);

  const W = 480;
  const H = 120;
  const PAD = { top: 10, right: 12, bottom: 28, left: 48 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const n = data.length;

  const xOf = (i: number) =>
    n === 1 ? PAD.left + chartW / 2 : PAD.left + (i / (n - 1)) * chartW;
  const yOf = (v: number) =>
    PAD.top + chartH - (v / maxVal) * chartH;

  const polyline = data
    .map((d, i) => `${xOf(i)},${yOf(getValue(d))}`)
    .join(" ");

  const fmtY = (v: number) =>
    metrica === "kwh"
      ? `${Math.round(v)}`
      : metrica === "costo"
      ? `$${Math.round(v)}`
      : `$${v.toFixed(2)}`;

  const metricaLabel: Record<GraficoMetrica, string> = {
    kwh: "Consumo (kWh)",
    costo: "Costo total",
    promedio: "Costo promedio kWh",
  };

  return (
    <div className="mt-2 rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-white/80">📈 Evolución histórica</h3>
        <div className="flex gap-1.5">
          {(["kwh", "costo", "promedio"] as GraficoMetrica[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMetrica(m)}
              className={`rounded-lg px-2 py-1 text-[10px] font-medium transition-colors ${
                metrica === m
                  ? "bg-byd-500/30 text-byd-400"
                  : "bg-white/[0.04] text-white/35 hover:text-white/60"
              }`}
            >
              {metricaLabel[m]}
            </button>
          ))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        aria-label={`Gráfico ${metricaLabel[metrica]}`}
      >
        {/* Y grid lines & labels */}
        {[0, 0.5, 1].map((frac) => {
          const yy = PAD.top + chartH * (1 - frac);
          const val = maxVal * frac;
          return (
            <g key={frac}>
              <line
                x1={PAD.left}
                y1={yy}
                x2={PAD.left + chartW}
                y2={yy}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 4}
                y={yy + 4}
                textAnchor="end"
                fontSize={9}
                fill="rgba(255,255,255,0.3)"
              >
                {fmtY(val)}
              </text>
            </g>
          );
        })}
        {/* Area fill */}
        {n > 1 && (
          <polygon
            points={`${PAD.left},${PAD.top + chartH} ${polyline} ${PAD.left + chartW},${PAD.top + chartH}`}
            fill="rgba(14,165,233,0.08)"
          />
        )}
        {/* Line */}
        {n > 1 && (
          <polyline
            points={polyline}
            fill="none"
            stroke="#38bdf8"
            strokeWidth={1.8}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {/* Points + X labels */}
        {data.map((d, i) => {
          const x = xOf(i);
          const y = yOf(getValue(d));
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={3} fill="#38bdf8" />
              <title>{`${d.label}: ${fmtY(getValue(d))}`}</title>
              <text
                x={x}
                y={H - 4}
                textAnchor="middle"
                fontSize={8}
                fill="rgba(255,255,255,0.25)"
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Centro de Energía component ──────────────────────────────────────────
function SeccionEnergia({
  periodos,
  cargas,
  onNewRecibo,
  onEditRecibo,
  onDeleteRecibo,
  onViewRecibo,
  costoMarginalManual,
  onCostoMarginalChange,
  reciboEnDetalle,
}: {
  periodos: PeriodoElectricoRow[];
  cargas: CargaEntry[];
  onNewRecibo: () => void;
  onEditRecibo: (r: PeriodoElectricoRow) => void;
  onDeleteRecibo: (r: PeriodoElectricoRow) => void;
  onViewRecibo: (r: PeriodoElectricoRow | null) => void;
  costoMarginalManual: string;
  onCostoMarginalChange: (v: string) => void;
  reciboEnDetalle: PeriodoElectricoRow | null;
}) {
  // Select vigente: most recent valid period (20–70 days).
  // If all are suspicious, fall back to periodos[0] with a flag.
  const viGenteIsSuspicious = periodos.length > 0 && !periodos.some(isPeriodoElectricoValido);
  const ultimoRecibo = getUltimoReciboElectrico(periodos);

  // Compute kWh BYD — use stored value from DB if > 0, else calculate from cargas
  const bydInfo = ultimoRecibo ? getBydKwhForPeriod(ultimoRecibo, cargas) : { value: 0, isManual: false };
  const kwhBydRounded = bydInfo.value;
  
  const kwhBimestre = ultimoRecibo ? Number(ultimoRecibo.kwh_bimestre) : 0;
  const costoKwh = ultimoRecibo?.costo_kwh_mxn ? Number(ultimoRecibo.costo_kwh_mxn) : 0;
  const kwhCasa = kwhBimestre > 0 ? Math.max(0, kwhBimestre - kwhBydRounded) : 0;
  const pctByd = kwhBimestre > 0 ? Math.round((kwhBydRounded / kwhBimestre) * 100) : 0;
  const pctCasa = 100 - pctByd;
  const costoBydPromedio = Math.round(kwhBydRounded * costoKwh * 100) / 100;
  const costoCasaPromedio = Math.round(kwhCasa * costoKwh * 100) / 100;

  // Marginal calculation
  const costoMarginalPorKwh = parseFloat(costoMarginalManual) || 0;
  const costoBydMarginal = costoMarginalPorKwh > 0
    ? Math.round(kwhBydRounded * costoMarginalPorKwh * 100) / 100
    : 0;

  const recibosAnteriores = periodos.slice(1);

  // ── Detail modal ──
  const detalle = reciboEnDetalle;

  return (
    <>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-white/50">⚡ Centro de Energía</h2>
        <button
          type="button"
          onClick={onNewRecibo}
          className="rounded-lg bg-byd-500 px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-byd-400"
        >
          + Nuevo recibo
        </button>
      </div>

      {/* ═══ Detail modal ═══ */}
      <Modal isOpen={!!detalle} onClose={() => onViewRecibo(null)} title="📄 Detalle del recibo">
        {detalle && (() => {
          const dInfo = getBydKwhForPeriod(detalle, cargas);
          return (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-white/40">Periodo</span>
                <span className="font-medium text-white/80">
                  {formatDateOnlyMX(detalle.fecha_inicio)} — {formatDateOnlyMX(detalle.fecha_fin)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Proveedor</span>
                <span className="font-medium text-white/80">{detalle.proveedor || "CFE"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Tarifa</span>
                <span className="font-medium text-white/80">{detalle.tarifa || "1C"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Consumo total</span>
                <span className="font-medium text-white/80">{detalle.kwh_bimestre} kWh</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Consumo BYD</span>
                <span className="font-medium text-byd-400">
                  {dInfo.isManual ? "BYD: " : "BYD auto: "}{dInfo.value} kWh
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Costo total</span>
                <span className="font-medium text-byd-400">{formatCurrency(detalle.costo_total_mxn)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Costo promedio</span>
                <span className="font-medium text-white/80">
                  {detalle.costo_kwh_mxn ? `${Number(detalle.costo_kwh_mxn).toFixed(4)}/kWh` : "—"}
                </span>
              </div>
              {detalle.numero_recibo && (
                <div className="flex justify-between">
                  <span className="text-white/40">Número de recibo</span>
                  <span className="font-medium text-white/60 text-xs">{detalle.numero_recibo}</span>
                </div>
              )}
              {detalle.notas && (
                <div className="flex justify-between">
                  <span className="text-white/40">Notas</span>
                  <span className="font-medium text-white/60 text-xs">{detalle.notas}</span>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* ── Fila 1: Recibo vigente + Casa vs BYD ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">

        {/* Card A: Recibo CFE vigente */}
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
        {ultimoRecibo ? (
          <>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/50">📄 Recibo CFE vigente</h3>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-white/40">Periodo</span>
                <span className="font-medium text-white/80">
                  {formatDateOnlyMX(ultimoRecibo.fecha_inicio)} — {formatDateOnlyMX(ultimoRecibo.fecha_fin)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Proveedor</span>
                <span className="font-medium text-white/80">{ultimoRecibo.proveedor || "CFE"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Tarifa</span>
                <span className="font-medium text-white/80">{ultimoRecibo.tarifa || "1C"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Consumo</span>
                <span className="font-medium text-white/80">{kwhBimestre} kWh</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">🚗 Consumo BYD</span>
                <span className="font-medium text-byd-400">
                  {kwhBydRounded} kWh{bydInfo.isManual ? "" : " (auto)"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">🏠 Consumo Casa</span>
                <span className="font-medium text-amber-400">{kwhCasa} kWh</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Costo total</span>
                <span className="font-medium text-byd-400">{formatCurrency(ultimoRecibo.costo_total_mxn)}</span>
              </div>
              <div>
                <div className="flex justify-between">
                  <span className="text-white/40">Costo promedio del recibo</span>
                  <span className="font-medium text-white/80">
                    {costoKwh > 0 ? `$${costoKwh.toFixed(4)} / kWh` : "—"}
                  </span>
                </div>
                {costoKwh > 0 && (
                  <p className="mt-0.5 text-right text-[10px] text-white/25">Promedio calculado del recibo CFE</p>
                )}
              </div>
              {ultimoRecibo.numero_recibo && (
                <div className="flex justify-between">
                  <span className="text-white/40">Número de recibo</span>
                  <span className="font-medium text-white/60 text-xs">{ultimoRecibo.numero_recibo}</span>
                </div>
              )}
            </div>
            {viGenteIsSuspicious && (
              <p className="mt-2 text-[10px] text-amber-400/80">
                ⚠️ Todos los recibos son sospechosos. Mostrando el más reciente.
              </p>
            )}
            {ultimoRecibo && getPeriodoAlerts(ultimoRecibo).length > 0 && (
              <div className="mt-1 space-y-0.5">
                {getPeriodoAlerts(ultimoRecibo).map((a, i) => (
                  <p key={i} className="text-[10px] text-amber-400/70">⚠️ {a}</p>
                ))}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => onViewRecibo(ultimoRecibo)}
                className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/50 transition-colors hover:bg-white/5 hover:text-white/70"
              >
                📋 Detalle
              </button>
              <button
                type="button"
                onClick={() => onEditRecibo(ultimoRecibo)}
                className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/50 transition-colors hover:bg-white/5 hover:text-white/70"
              >
                ✏️ Editar
              </button>
              <button
                type="button"
                onClick={() => onDeleteRecibo(ultimoRecibo)}
                className="rounded-lg border border-red-500/20 px-2.5 py-1 text-[11px] text-red-400/60 transition-colors hover:bg-red-500/10 hover:text-red-400"
              >
                🗑️ Eliminar
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="mb-3 text-sm font-medium text-white/80">📄 Recibo CFE vigente</h3>
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-sm text-white/30">No hay recibos CFE registrados.</p>
              <button
                type="button"
                onClick={onNewRecibo}
                className="rounded-xl border border-byd-500/30 bg-byd-500/10 px-4 py-2 text-sm font-medium text-byd-400 transition-colors hover:bg-byd-500/20"
              >
                + Agregar primer recibo
              </button>
            </div>
          </>
        )}
      </div>

      {/* Card B: Consumo Casa vs BYD */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
        {ultimoRecibo ? (
          <>
            <h3 className="mb-2 text-xs font-medium text-white/60 uppercase tracking-wide">Consumo Casa vs BYD</h3>
            <div className="space-y-2">
              {kwhBimestre > 0 && (
                <div className="mb-2 flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="bg-byd-400 transition-all duration-500" style={{ width: `${pctByd}%` }} />
                  <div className="bg-amber-500/40 transition-all duration-500" style={{ width: `${pctCasa}%` }} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-byd-500/10 p-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-byd-400" />
                    <span className="text-xs font-medium text-white/50">🚗 BYD</span>
                  </div>
                  <p className="mt-1 text-base font-semibold text-byd-400">{pctByd}%</p>
                  <p className="text-xs text-white/40">{kwhBydRounded} kWh</p>
                </div>
                <div className="rounded-lg bg-amber-500/10 p-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-amber-500/40" />
                    <span className="text-xs font-medium text-white/50">🏠 Casa</span>
                  </div>
                  <p className="mt-1 text-base font-semibold text-amber-400">{pctCasa}%</p>
                  <p className="text-xs text-white/40">{kwhCasa} kWh</p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <h3 className="mb-2 text-sm font-medium text-white/80">Consumo Casa vs BYD</h3>
            <p className="text-sm text-white/30">Aquí se comparará el consumo del hogar contra el consumo del vehículo.</p>
          </>
        )}
      </div>
      </div>{/* ── /Fila 1 ── */}

      {/* ── Fila 2: Costos eléctricos + Resumen del periodo ── */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">

        {/* Card C: Costos eléctricos */}
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
        <h3 className="mb-2 text-xs font-medium text-white/60 uppercase tracking-wide">Costos eléctricos</h3>
        {ultimoRecibo ? (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg bg-byd-500/10 px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-white/40">Costo BYD (Promedio)</span>
                <span className="font-semibold text-byd-400">{formatCurrency(costoBydPromedio)}</span>
              </div>
              <p className="mt-0.5 text-[10px] text-white/30">
                {costoKwh > 0 ? `${costoKwh.toFixed(4)}/kWh × ${kwhBydRounded} kWh` : "—"}
              </p>
            </div>
            <div className="rounded-lg bg-amber-500/10 px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-white/40">Costo Casa (Promedio)</span>
                <span className="font-semibold text-white">{formatCurrency(costoCasaPromedio)}</span>
              </div>
              <p className="mt-0.5 text-[10px] text-white/30">
                {costoKwh > 0 ? `${costoKwh.toFixed(4)}/kWh × ${kwhCasa} kWh` : "—"}
              </p>
            </div>
            <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-white/40">Costo BYD (Conservador)</span>
                <span className="font-semibold text-cyan-400">
                  {costoBydMarginal > 0 ? formatCurrency(costoBydMarginal) : "—"}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-white/25">Utiliza un costo manual por kWh para estimaciones.</p>
              <div className="mt-1.5 flex items-center gap-2">
                <label className="text-[10px] text-white/30">$/kWh manual:</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={costoMarginalManual}
                  onChange={(e) => onCostoMarginalChange(e.target.value)}
                  placeholder="0.00"
                  className="w-20 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-white/80 outline-none transition-colors focus:border-byd-500/50"
                />
              </div>
              {costoMarginalPorKwh > 0 && (
                <p className="mt-0.5 text-[10px] text-white/30">
                  {costoMarginalPorKwh.toFixed(2)}/kWh × {kwhBydRounded} kWh
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-white/30">Aquí se mostrarán los costos cuando haya un recibo vigente.</p>
        )}
        </div>

        {/* Card E: Resumen del periodo */}
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <h3 className="mb-2 text-xs font-medium text-white/60 uppercase tracking-wide">📊 Resumen del periodo</h3>
          {ultimoRecibo ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <p className="text-[11px] text-white/35">Consumo total</p>
                <p className="font-semibold text-white/80">{kwhBimestre} kWh</p>
              </div>
              <div>
                <p className="text-[11px] text-white/35">🚗 Consumo BYD</p>
                <p className="font-semibold text-byd-400">{kwhBydRounded} kWh</p>
              </div>
              <div>
                <p className="text-[11px] text-white/35">🏠 Consumo Casa</p>
                <p className="font-semibold text-amber-400">{kwhCasa} kWh</p>
              </div>
              <div>
                <p className="text-[11px] text-white/35">Costo total</p>
                <p className="font-semibold text-white/80">{formatCurrency(ultimoRecibo.costo_total_mxn)}</p>
              </div>
              <div>
                <p className="text-[11px] text-white/35">🚗 Costo BYD</p>
                <p className="font-semibold text-byd-400">{formatCurrency(costoBydPromedio)}</p>
              </div>
              <div>
                <p className="text-[11px] text-white/35">🏠 Costo Casa</p>
                <p className="font-semibold text-amber-400">{formatCurrency(costoCasaPromedio)}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-white/30">Aquí se mostrará el resumen cuando haya un recibo vigente.</p>
          )}
        </div>
      </div>{/* ── /Fila 2 ── */}

      {/* ── Fila 3: Evolución histórica (ancho completo) ── */}
      {periodos.length > 1 && (
        <GraficoHistorico periodos={periodos} cargas={cargas} />
      )}

      {/* ── Historial de recibos (ancho completo, filas compactas) ── */}
      <div className="mt-2 rounded-xl border border-white/5 bg-white/[0.02] p-3">
        <h3 className="mb-2 text-xs font-medium text-white/50 uppercase tracking-wide">Historial de recibos</h3>
        {periodos.length > 0 ? (
          recibosAnteriores.length > 0 ? (
            <div className="space-y-1.5">
              {recibosAnteriores.map((r) => {
                const hByd = getBydKwhForPeriod(r, cargas);
                const total = Number(r.kwh_bimestre);
                const bydKwh = hByd.value;
                const casaKwh = Math.max(0, total - bydKwh);
                const bydPct = total > 0 ? Math.round((bydKwh / total) * 100) : 0;
                const casaPct = 100 - bydPct;
                return (
                  <div key={r.id} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-3">
                        <span className="text-[11px] font-medium text-white/60">
                          {formatDateOnlyMX(r.fecha_inicio)} — {formatDateOnlyMX(r.fecha_fin)}
                        </span>
                        <span className="text-[11px] text-white/30">{formatCurrency(r.costo_total_mxn)}</span>
                        <span className="text-[10px] text-white/20">
                          Tarifa {r.tarifa || "1C"} · {r.costo_kwh_mxn ? `$${Number(r.costo_kwh_mxn).toFixed(2)}/kWh` : "—"}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10px]">
                        <span className="text-white/25">Total: {total} kWh</span>
                        <span className="text-byd-400/70">🚗 {bydKwh} kWh ({bydPct}%){!hByd.isManual ? " auto" : ""}</span>
                        <span className="text-amber-400/70">🏠 {casaKwh} kWh ({casaPct}%)</span>
                        {getPeriodoAlerts(r).map((a, i) => (
                          <span key={i} className="text-amber-400/60">⚠️ {a}</span>
                        ))}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => onViewRecibo(r)}
                        className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/40 transition-colors hover:bg-white/5 hover:text-white/60"
                        title="Ver detalle"
                      >
                        📋
                      </button>
                      <button
                        type="button"
                        onClick={() => onEditRecibo(r)}
                        className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/40 transition-colors hover:bg-white/5 hover:text-white/60"
                        title="Editar"
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteRecibo(r)}
                        className="rounded-lg border border-red-500/20 px-2 py-1 text-[11px] text-red-400/40 transition-colors hover:bg-red-500/10 hover:text-red-400"
                        title="Eliminar"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-white/30">Solo hay un recibo registrado (el vigente).</p>
          )
        ) : (
          <p className="text-sm text-white/30">Aquí se listarán los recibos CFE registrados.</p>
        )}
      </div>

      {/* Footer: información del cálculo */}
      <p className="mt-5 text-center text-[10px] leading-relaxed text-white/20">
        Costo promedio = Total del recibo ÷ Consumo total.&nbsp;&nbsp;
        Costo BYD = Consumo BYD × Costo promedio.&nbsp;&nbsp;
        Costo Casa = Consumo Casa × Costo promedio.
      </p>
    </>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────
const NAV_ITEMS: { label: string; icon: string; s: Section }[] = [
  { label: "Dashboard",       icon: "🏠", s: "dashboard"     },
  { label: "Gasolina",        icon: "⛽", s: "gasolina"      },
  { label: "Cargas EV",       icon: "⚡", s: "cargas"        },
  { label: "Mantenimiento",   icon: "🔧", s: "mantenimiento" },
  { label: "Historial",       icon: "📋", s: "historial"     },
  { label: "Tickets",         icon: "🎫", s: "tickets"       },
  { label: "Reportes",        icon: "📊", s: "reportes"      },
  { label: "Centro Energía",  icon: "⚡", s: "energia"       },
];

function Sidebar({ section, onNavigate, odometroActual, batteryPct, vehiculo, onSettings }: {
  section: Section;
  onNavigate: (s: Section) => void;
  odometroActual: number;
  batteryPct: number;
  vehiculo: string;
  onSettings: () => void;
}) {
  return (
    <aside className="hidden w-[210px] shrink-0 flex-col border-r border-white/[0.05] bg-[#080a0b] sm:flex">
      {/* Logo */}
      <div className="border-b border-white/[0.05] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-byd-500 text-black">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold leading-none">BYD Wallet</p>
            <p className="mt-0.5 truncate text-[9px] text-white/30">{vehiculo}</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.s}
            type="button"
            onClick={() => onNavigate(item.s)}
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
              section === item.s
                ? "bg-byd-500/15 text-byd-400 shadow-[inset_0_0_0_1px_rgba(18,184,160,0.2)]"
                : "text-white/35 hover:bg-white/[0.04] hover:text-white/65"
            }`}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-xs leading-none">{item.icon}</span>
            <span className="text-[11px] font-medium leading-none">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Vehicle info */}
      <div className="mx-2 mb-1.5 rounded-xl border border-white/[0.05] bg-white/[0.025] p-2.5">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-white/25">Odómetro</p>
        <p className="mt-0.5 text-sm font-bold text-white/80">{odometroActual.toLocaleString()} km</p>
      </div>

      {/* Battery */}
      <div className="mx-2 mb-1.5 flex items-center gap-2.5 rounded-xl border border-white/[0.05] bg-white/[0.025] px-2.5 py-2">
        <ProgressRing pct={batteryPct} />
        <div>
          <p className="text-[9px] text-white/25">Batería</p>
          <p className="text-xs font-semibold">{batteryPct}%</p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-white/[0.05] px-3 py-2">
        <span className="text-[9px] text-white/20">v{APP_VERSION}</span>
        <button
          type="button"
          onClick={onSettings}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-white/25 transition-colors hover:text-byd-400"
          title="Configuración"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
    </aside>
  );
}

export default function Home() {
  const [section, setSection] = useState<Section>("dashboard");
  const [formModal, setFormModal] = useState<FormModal>(null);
  const [kpiVersion, setKpiVersion] = useState(0);
  const [recargas, setRecargas] = useState<RecargaRow[]>([]);
  const [cargasElectricasDb, setCargasElectricasDb] = useState<CargaElectricaRow[]>([]);
  const [config, setConfig] = useState<ConfiguracionRow | null>(null);
  const [periodosElectricos, setPeriodosElectricos] = useState<PeriodoElectricoRow[]>([]);
  const [maintenanceRecordsDb, setMaintenanceRecordsDb] = useState<MaintenanceRecordRow[]>([]);
  const [maintenanceExtraDb, setMaintenanceExtraDb] = useState<MaintenanceExtraCostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingRecibo, setEditingRecibo] = useState<PeriodoElectricoRow | null>(null);
  const [deletingRecibo, setDeletingRecibo] = useState<PeriodoElectricoRow | null>(null);
  const [reciboEnDetalle, setReciboEnDetalle] = useState<PeriodoElectricoRow | null>(null);
  const [costoMarginalManual, setCostoMarginalManual] = useState("");
  const [editingGasolina, setEditingGasolina] = useState<GasolinaEntry | null>(null);
  const [deletingGasolina, setDeletingGasolina] = useState<GasolinaEntry | null>(null);
  const [gasolinaEnDetalle, setGasolinaEnDetalle] = useState<GasolinaEntry | null>(null);
  const [registrarServicioKm, setRegistrarServicioKm] = useState<number | null>(null);
  const [editingMantenimiento, setEditingMantenimiento] = useState<MantenimientoEntry | null>(null);
  const [deletingMantenimiento, setDeletingMantenimiento] = useState<MantenimientoEntry | null>(null);
  const [showOtroCostoForm, setShowOtroCostoForm] = useState(false);
  const [editingOtroCosto, setEditingOtroCosto] = useState<OtroCostoEntry | null>(null);
  const [deletingOtroCosto, setDeletingOtroCosto] = useState<OtroCostoEntry | null>(null);
  const [cargaSaveError, setCargaSaveError] = useState<string | null>(null);
  const [savingCarga, setSavingCarga] = useState(false);
  const [cargaEnDetalle, setCargaEnDetalle] = useState<CargaEntry | null>(null);
  const [editingCarga, setEditingCarga] = useState<CargaEntry | null>(null);
  const [deletingCarga, setDeletingCarga] = useState<CargaEntry | null>(null);

  // Fetch from Supabase on mount
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        const [recargasData, configData, cargasElectricasData] = await Promise.all([
          fetchRecargasFromSupabase(),
          fetchConfigFromSupabase(),
          fetchCargasElectricasFromSupabase(),
        ]);
        setRecargas(recargasData);
        setConfig(configData);
        setCargasElectricasDb(cargasElectricasData);

        // Carga adicional de periodos eléctricos (independiente, no bloquea)
        const [periodosData, maintenanceData, extraCostsData] = await Promise.all([
          fetchPeriodosElectricosFromSupabase(),
          fetchMaintenanceRecordsFromSupabase(),
          fetchMaintenanceExtraCostsFromSupabase(),
        ]);
        setPeriodosElectricos(periodosData);
        setMaintenanceRecordsDb(maintenanceData);
        setMaintenanceExtraDb(extraCostsData);

        if (recargasData.length === 0) {
          console.warn("[BYD Wallet] No se encontraron recargas en Supabase");
        } else {
          console.log("[BYD Wallet] Datos cargados exitosamente:", {
            recargas: recargasData.length,
            cargasElectricas: cargasElectricasData.length,
            config: configData ? "OK" : "null",
          });
        }
      } catch (err) {
        console.error("[BYD Wallet] Error fatal cargando datos:", err);
        setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [kpiVersion]);

  // Seed the 15,000 km service record once if it doesn't already exist
  useEffect(() => {
    const list = loadData<MantenimientoEntry[]>(KEYS.mantenimiento, []);
    const already = list.some((e) => e.kmProgramado === 15000 || e.km === 15000);
    if (already) return;
    const seedChecklist: ChecklistItemState[] = CHECKLIST_ITEMS.map((item) => ({
      id: item.id,
      realizado: true,
    }));
    const seedEntry: MantenimientoEntry = {
      id: "seed-mantenimiento-15000",
      fecha: "2025-04-01",
      servicio: "15,000 km / 12 meses",
      km: 15000,
      costo: 2792,
      estado: "completado",
      kmProgramado: 15000,
      mesesProgramado: 12,
      costoEstimado: 2792,
      costoReal: 2792,
      agencia: "BYD",
      notas: "Primer mantenimiento registrado",
      checklist: seedChecklist,
    };
    saveData(KEYS.mantenimiento, [seedEntry]);
    setKpiVersion((v) => v + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today = new Date();
  const dateStr = today.toLocaleDateString("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const batteryPct = 78;

  // Compute KPIs from Supabase data
  const kpis = useMemo(() => computeKpisFromRecargas(recargas, config), [recargas, config]);

  // Electrical cost KPIs from periodos_electricos
  const kpisElectricos = useMemo(() => {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    let total = 0;
    let mensual = 0;
    let anual = 0;
    for (const p of periodosElectricos) {
      const kwh = p.kwh_byd_periodo != null ? Number(p.kwh_byd_periodo) : 0;
      const rate = p.costo_kwh_mxn ? Number(p.costo_kwh_mxn) : 0;
      if (kwh <= 0 || rate <= 0) continue;
      const costo = Math.round(kwh * rate * 100) / 100;
      total += costo;
      const fin = new Date(p.fecha_fin);
      if (fin.getFullYear() === thisYear) {
        anual += costo;
        if (fin.getMonth() === thisMonth) mensual += costo;
      }
    }
    return {
      total: Math.round(total * 100) / 100,
      mensual: Math.round(mensual * 100) / 100,
      anual: Math.round(anual * 100) / 100,
    };
  }, [periodosElectricos]);

  // Map recargas to GasolinaEntry-like format for existing components
  // Filter: includes all records whose tipo_combustible starts with "gasolina" (case-insensitive)
  // or where tipo_combustible is null/undefined (legacy data assumed gasolina)
  const gasolinaList = useMemo(() =>
    recargas
      .filter((r) => !r.tipo_combustible || r.tipo_combustible.toLowerCase().startsWith("gasolina"))
      .map((r) => ({
        id: String(r.id),
        fecha: r.fecha,
        litros: Number(r.litros),
        costo: Number(r.costo_total_mxn),
        kilometraje: Number(r.odometro_km),
        concepto: r.gasolinera || `Recarga #${r.id}`,
      }))
      .sort((a, b) => dateSortValue(b.fecha) - dateSortValue(a.fecha)),
    [recargas]);

  const settings = loadData<VehicleSettings>(KEYS.settings, DEFAULT_SETTINGS);

  // Map cargas eléctricas desde Supabase + legacy recargas EV + localStorage pendiente
  const cargasList = useMemo(() => {
    const rendimientoKmKwh = settings.rendimientoKmKwh || 6.2;
    const fromDb = cargasElectricasDb.map((r) => mapCargaElectricaToEntry(r, rendimientoKmKwh));
    const dbIds = new Set(fromDb.map((e) => e.id));

    const fromRecargas = recargas
      .filter((r) => r.tipo_combustible === "Electricidad" || r.tipo_combustible === "EV")
      .map((r) => mapRecargaEvToCargaEntry(r, rendimientoKmKwh))
      .filter((e) => !dbIds.has(e.id));

    const localOnly = loadData<CargaEntry[]>(KEYS.cargas, [])
      .filter((e) => !dbIds.has(e.id) && !fromRecargas.some((r) => r.id === e.id));

    return [...fromDb, ...fromRecargas, ...localOnly]
      .sort((a, b) => dateSortValue(b.fecha) - dateSortValue(a.fecha));
  }, [cargasElectricasDb, recargas, settings.rendimientoKmKwh, kpiVersion]);

  const mantenimientoList = loadData<MantenimientoEntry[]>(KEYS.mantenimiento, [])
    .sort((a, b) => dateSortValue(b.fecha) - dateSortValue(a.fecha));
  const otrosCostosList = loadData<OtroCostoEntry[]>(KEYS.otrosCostos, [])
    .sort((a, b) => dateSortValue(b.fecha) - dateSortValue(a.fecha));

  const gastoGasolinaTotal = useMemo(
    () => Math.round(gasolinaList.reduce((s, e) => s + e.costo, 0) * 100) / 100,
    [gasolinaList],
  );

  const dashboardMantenimientoRows = useMemo((): DashboardGastoRow[] => {
    if (maintenanceRecordsDb.length > 0) {
      return maintenanceRecordsDb.map((r) => ({
        fecha: r.fecha_realizada,
        costo: Number(r.costo_real),
      }));
    }
    return mantenimientoList
      .filter((e) => e.fecha)
      .map((e) => ({ fecha: e.fecha, costo: e.costoReal ?? e.costo }));
  }, [maintenanceRecordsDb, mantenimientoList, kpiVersion]);

  const dashboardOtrosRows = useMemo((): DashboardGastoRow[] => {
    if (maintenanceExtraDb.length > 0) {
      return maintenanceExtraDb.map((r) => ({
        fecha: r.date,
        costo: Number(r.cost),
      }));
    }
    return otrosCostosList
      .filter((e) => e.fecha)
      .map((e) => ({ fecha: e.fecha, costo: e.costo }));
  }, [maintenanceExtraDb, otrosCostosList, kpiVersion]);

  const centroEnergiaResumen = useMemo(
    () => getCentroEnergiaCostos(getUltimoReciboElectrico(periodosElectricos), cargasList),
    [periodosElectricos, cargasList],
  );

  // ── Global health/próximo computation (for top KPI chips) ─────────────
  const proximoServicioGlobal = BYD_KING_SERVICIOS.find((s) => s.km > kpis.odometroActual) ?? null;
  const kmRestantesGlobal = proximoServicioGlobal ? proximoServicioGlobal.km - kpis.odometroActual : 0;
  const estadoServicioGlobal = getDashboardEstadoMantenimiento(kpis.odometroActual, proximoServicioGlobal, kmRestantesGlobal);
  const statusGlobal = getMantenimientoStatus(kmRestantesGlobal, undefined);
  let healthScoreGlobal = 100;
  if (kmRestantesGlobal <= 0)         healthScoreGlobal -= 35;
  else if (kmRestantesGlobal <= 500)  healthScoreGlobal -= 20;
  else if (kmRestantesGlobal <= 2000) healthScoreGlobal -= 10;
  if (mantenimientoList.length === 0) healthScoreGlobal -= 15;
  healthScoreGlobal = Math.max(0, Math.min(100, healthScoreGlobal));
  const healthLabelGlobal =
    healthScoreGlobal >= 98 ? "Excelente" :
    healthScoreGlobal >= 90 ? "Muy bueno" :
    healthScoreGlobal >= 80 ? "Bueno" :
    healthScoreGlobal >= 70 ? "Requiere atención" : "Atención inmediata";
  const healthColorGlobal =
    healthScoreGlobal >= 98 ? "#4ade80" :
    healthScoreGlobal >= 90 ? "#60efb0" :
    healthScoreGlobal >= 80 ? "#a3e635" :
    healthScoreGlobal >= 70 ? "#fbbf24" : "#f87171";

  const gastoBydMensualGlobal = centroEnergiaResumen?.costoByd ?? null;
  const tarifaKwhGlobal = centroEnergiaResumen?.costoKwh ?? null;

  const handleSave = useCallback(function <T>(key: string, entry: T) {
    const list = loadData<T[]>(key, []);
    saveData(key, [...list, entry]);
    setKpiVersion((v) => v + 1);
  }, []);

  const handleSaveCarga = useCallback(async function (entry: CargaEntry) {
    setCargaSaveError(null);
    setSavingCarga(true);

    const row = cargaEntryToDbRow(entry);
    let errorMessage: string | null = null;

    if (isCargaSupabaseDb(entry.id)) {
      const result = await updateCargaElectrica(Number(entry.id), row);
      errorMessage = result.error;
    } else {
      const result = await insertCargaElectrica(row);
      if (result.error || result.id == null) {
        errorMessage = result.error
          || "No se pudo guardar la carga en Supabase. Verifica permisos RLS en cargas_electricas.";
      }
    }

    setSavingCarga(false);

    if (errorMessage) {
      setCargaSaveError(errorMessage);
      throw new Error(errorMessage);
    }

    const refreshed = await fetchCargasElectricasFromSupabase();
    setCargasElectricasDb(refreshed);
    setCargaSaveError(null);
    setFormModal(null);
    setEditingCarga(null);
  }, []);

  const handleDeleteCarga = useCallback(async function (entry: CargaEntry) {
    if (!isCargaSupabaseDb(entry.id)) {
      const list = loadData<CargaEntry[]>(KEYS.cargas, []).filter((e) => e.id !== entry.id);
      saveData(KEYS.cargas, list);
      setDeletingCarga(null);
      setKpiVersion((v) => v + 1);
      return;
    }

    setSavingCarga(true);
    const result = await deleteCargaElectrica(Number(entry.id));
    setSavingCarga(false);

    if (result.error) {
      setCargaSaveError(result.error);
      setDeletingCarga(null);
      return;
    }

    const refreshed = await fetchCargasElectricasFromSupabase();
    setCargasElectricasDb(refreshed);
    setDeletingCarga(null);
    setCargaEnDetalle((current) => (current?.id === entry.id ? null : current));
  }, []);

  const handleUpdateGasolina = useCallback(function (updated: GasolinaEntry) {
    const list = loadData<GasolinaEntry[]>(KEYS.gasolina, []);
    const newList = list.map((e) => (e.id === updated.id ? updated : e));
    saveData(KEYS.gasolina, newList);
    setKpiVersion((v) => v + 1);
  }, []);

  const handleDeleteGasolina = useCallback(function (id: string) {
    const list = loadData<GasolinaEntry[]>(KEYS.gasolina, []);
    saveData(KEYS.gasolina, list.filter((e) => e.id !== id));
    setKpiVersion((v) => v + 1);
  }, []);

  const handleSaveMantenimiento = useCallback(function (entry: MantenimientoEntry) {
    const list = loadData<MantenimientoEntry[]>(KEYS.mantenimiento, []);
    const exists = list.find((e) => e.id === entry.id);
    if (exists) {
      saveData(KEYS.mantenimiento, list.map((e) => (e.id === entry.id ? entry : e)));
    } else {
      saveData(KEYS.mantenimiento, [...list, entry]);
      // Fire-and-forget Supabase insert
      insertMaintenanceRecord({
        km_programado: entry.kmProgramado ?? 0,
        meses_programado: entry.mesesProgramado ?? 0,
        costo_estimado: entry.costoEstimado ?? entry.costo,
        fecha_realizada: entry.fecha,
        odometro_realizado: entry.km,
        costo_real: entry.costoReal ?? entry.costo,
        agencia: entry.agencia ?? null,
        notas: entry.notas ?? null,
        estado: entry.estado,
      }).catch(() => {});
    }
    setRegistrarServicioKm(null);
    setEditingMantenimiento(null);
    setKpiVersion((v) => v + 1);
  }, []);

  const handleDeleteMantenimiento = useCallback(function (id: string) {
    const list = loadData<MantenimientoEntry[]>(KEYS.mantenimiento, []);
    saveData(KEYS.mantenimiento, list.filter((e) => e.id !== id));
    setDeletingMantenimiento(null);
    setKpiVersion((v) => v + 1);
  }, []);

  const handleUpdateAdjunto = useCallback(function (
    id: string,
    adjunto: MantenimientoEntry["adjunto"]
  ) {
    const list = loadData<MantenimientoEntry[]>(KEYS.mantenimiento, []);
    saveData(
      KEYS.mantenimiento,
      list.map((e) => (e.id === id ? { ...e, adjunto } : e))
    );
    setKpiVersion((v) => v + 1);
  }, []);

  const handleSaveOtroCosto = useCallback(function (entry: OtroCostoEntry) {
    const list = loadData<OtroCostoEntry[]>(KEYS.otrosCostos, []);
    const exists = list.some((e) => e.id === entry.id);
    if (exists) {
      saveData(KEYS.otrosCostos, list.map((e) => (e.id === entry.id ? entry : e)));
    } else {
      saveData(KEYS.otrosCostos, [...list, entry]);
    }
    setShowOtroCostoForm(false);
    setEditingOtroCosto(null);
    setKpiVersion((v) => v + 1);
  }, []);

  const handleDeleteOtroCosto = useCallback(function (id: string) {
    const list = loadData<OtroCostoEntry[]>(KEYS.otrosCostos, []);
    saveData(KEYS.otrosCostos, list.filter((e) => e.id !== id));
    setDeletingOtroCosto(null);
    setKpiVersion((v) => v + 1);
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#080a0b] text-white">
        <div className="text-center">
          <div className="mb-4 mx-auto h-8 w-8 animate-spin rounded-full border-2 border-byd-500 border-t-transparent" />
          <p className="text-sm text-white/50">Conectando con Supabase...</p>
          <p className="mt-1 text-xs text-white/30">Cargando datos de tu vehículo</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#080a0b] text-white p-4">
        <div className="max-w-md text-center">
          <p className="mb-2 text-4xl">⚠️</p>
          <h2 className="mb-2 text-lg font-semibold">Error de conexión</h2>
          <p className="mb-4 text-sm text-white/60">
            No se pudieron cargar los datos desde Supabase. Verifica que:
          </p>
          <ul className="mb-4 space-y-1 text-left text-xs text-white/50">
            <li>• Las credenciales en .env.local sean correctas</li>
            <li>• La tabla recargas tenga datos</li>
            <li>• Las políticas RLS permitan SELECT para anon</li>
          </ul>
          <p className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400 font-mono">{error}</p>
          <button
            onClick={() => setKpiVersion((v) => v + 1)}
            className="rounded-xl bg-byd-500 px-6 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-byd-400"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#080a0b] text-white selection:bg-byd-500/30">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 right-[-10%] h-[500px] w-[500px] rounded-full bg-byd-500/[0.04] blur-[120px]" />
        <div className="absolute bottom-[-20%] left-[-10%] h-[400px] w-[400px] rounded-full bg-byd-500/[0.03] blur-[100px]" />
      </div>

      {/* Sidebar — desktop only */}
      <Sidebar
        section={section}
        onNavigate={setSection}
        odometroActual={kpis.odometroActual}
        batteryPct={batteryPct}
        vehiculo={kpis.vehiculo}
        onSettings={() => setFormModal("settings")}
      />

      {/* Main area */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">

        {/* Desktop top bar */}
        <header className="hidden shrink-0 items-center justify-between border-b border-white/[0.05] px-4 py-2 sm:flex">
          <div className="flex items-center gap-2 text-[10px] text-white/35">
            <span className="opacity-60">📅</span>
            <span className="capitalize">{dateStr}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-white/20">v{APP_VERSION}</span>
            <button type="button" onClick={() => setKpiVersion((v) => v + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/5 bg-white/[0.03] text-white/30 transition-colors hover:text-byd-400"
              title="Actualizar datos">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>
            <button type="button" onClick={() => setFormModal("settings")}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/5 bg-white/[0.03] text-white/30 transition-colors hover:text-byd-400">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>
        </header>

        {/* Mobile header */}
        <header className="flex shrink-0 items-center justify-between border-b border-white/[0.05] bg-[#080a0b] px-4 py-2.5 sm:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-byd-500 text-black">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-bold leading-none">BYD Wallet</p>
              <p className="text-[9px] text-white/30">{kpis.vehiculo}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.04] px-2 py-1">
              <ProgressRing pct={batteryPct} />
              <p className="text-xs font-semibold">{batteryPct}%</p>
            </div>
            <button type="button" onClick={() => setFormModal("settings")}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/5 bg-white/[0.04] text-white/30 hover:text-byd-400">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>
        </header>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
        <div className="px-3 pb-4 pt-2.5 sm:px-4">

        {/* 6-chip global KPI row */}
        <section className="mb-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          <KpiChip label="Gasto anual" value={formatCurrency(kpis.gastoAnual)} sub="Total del año" color="text-byd-400" />
          <KpiChip label="Costo por km" value={`$${kpis.costoPorKm}`} sub="Promedio global" />
          <KpiChip label="Odómetro" value={`${kpis.odometroActual.toLocaleString()} km`} sub="Lectura actual" />
          <KpiChip label="Salud del vehículo" value={`${healthScoreGlobal}`} sub={healthLabelGlobal} colorHex={healthColorGlobal} />
          <KpiChip label="Próximo servicio" value={proximoServicioGlobal ? `${proximoServicioGlobal.km.toLocaleString()} km` : "Completado"} sub={kmRestantesGlobal > 0 ? `${kmRestantesGlobal.toLocaleString()} km restantes` : estadoServicioGlobal} color={statusGlobal.color} />
          <KpiChip label="Costo eléctrico" value={gastoBydMensualGlobal != null ? formatCurrency(gastoBydMensualGlobal) : "Sin dato"} sub={tarifaKwhGlobal != null ? `$${tarifaKwhGlobal.toFixed(4)}/kWh` : "Gasto BYD · último recibo"} color="text-green-400/80" />
        </section>

        {/* Mobile-only nav tabs */}
        <nav className="mb-2 flex gap-0.5 overflow-x-auto rounded-xl border border-white/5 bg-white/[0.03] p-0.5 sm:hidden">
          {NAV_ITEMS.map((item) => (
            <NavTab key={item.s} active={section === item.s} label={`${item.icon} ${item.label}`} onClick={() => setSection(item.s)} />
          ))}
        </nav>

        {/* ═══ SECTION CONTENT ═══ */}
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 backdrop-blur-xl">
          {/* ── Dashboard ── */}
          {section === "dashboard" && (
            <SeccionDashboard
              odometroActual={kpis.odometroActual}
              gastoGasolina={gastoGasolinaTotal}
              totalLitros={gasolinaList.reduce((s, e) => s + e.litros, 0)}
              rendimientoKmL={kpis.rendimientoKmL}
              gasolinaList={gasolinaList}
              kpisElectricos={kpisElectricos}
              periodosElectricos={periodosElectricos}
              cargasList={cargasList}
              mantenimientoList={mantenimientoList}
              mantenimientoRows={dashboardMantenimientoRows}
              otrosCostosList={otrosCostosList}
              otrosRows={dashboardOtrosRows}
              onNavigate={(s) => setSection(s)}
            />
          )}

          {/* ── Gasolina ── */}
          {section === "gasolina" && (
            <div>
              <SectionHeader title="Historial de carga" count={gasolinaList.length} onAdd={() => setFormModal("gasolina")} />
              <div className="space-y-1">
                {gasolinaList.map((entry, idx) => {
                  const prev = gasolinaList[idx + 1];
                  const isFirst = idx === gasolinaList.length - 1;
                  const kmDelta = prev ? entry.kilometraje - prev.kilometraje : null;
                  return (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between rounded-lg px-2.5 py-2 transition-colors hover:bg-white/[0.03]"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-byd-500/15 text-xs text-byd-400">
                        ⛽
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">{entry.concepto}</p>
                        <p className="text-[10px] text-white/30">
                          {formatDateShort(entry.fecha)} · {entry.litros} L · {entry.kilometraje.toLocaleString()} km
                        </p>
                        {isFirst ? (
                          <p className="text-[9px] text-white/20">Primera recarga registrada</p>
                        ) : kmDelta !== null && kmDelta > 0 ? (
                          <p className="text-[9px] text-byd-400/60">Desde recarga anterior: {kmDelta.toLocaleString()} km</p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <p className="text-xs font-semibold text-byd-400">{formatCurrency(entry.costo)}</p>
                      <div className="ml-0.5 flex gap-0.5">
                        <button
                          type="button"
                          onClick={() => setGasolinaEnDetalle(entry)}
                          className="rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40 transition-colors hover:bg-white/5 hover:text-white/60"
                          title="Ver detalle"
                        >
                          📋
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingGasolina(entry)}
                          className="rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40 transition-colors hover:bg-white/5 hover:text-white/60"
                          title="Editar"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingGasolina(entry)}
                          className="rounded-md border border-red-500/20 px-1.5 py-0.5 text-[10px] text-red-400/40 transition-colors hover:bg-red-500/10 hover:text-red-400"
                          title="Eliminar"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                  );
                })}
                {gasolinaList.length === 0 && (
                  <p className="py-6 text-center text-xs text-white/30">No hay registros de gasolina</p>
                )}
              </div>
            </div>
          )}

          {/* ── Cargas EV ── */}
          {section === "cargas" && (
            <div>
              <SectionHeader
                title="Cargas eléctricas"
                count={cargasList.length}
                onAdd={() => {
                  setCargaSaveError(null);
                  setFormModal("carga");
                }}
              />
              <div className="space-y-1">
                {cargasList.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between rounded-lg px-2.5 py-2 transition-colors hover:bg-white/[0.03]"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-byd-500/15 text-xs text-byd-400">
                        ⚡
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">{entry.tipo}</p>
                        <p className="text-[10px] text-white/30">
                          {formatDateShort(entry.fecha)} · {entry.kwhCargados} kWh ({entry.pctInicial}% → {entry.pctFinal}%)
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <div className="text-right">
                        <p className="text-xs font-semibold text-byd-400">{formatCurrency(entry.costo)}</p>
                        <p className="text-[9px] text-white/30">{entry.kmEvObtenidos} km</p>
                      </div>
                      <div className="ml-0.5 flex gap-0.5">
                        <button
                          type="button"
                          onClick={() => setCargaEnDetalle(entry)}
                          className="rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40 transition-colors hover:bg-white/5 hover:text-white/60"
                          title="Ver detalle"
                        >
                          📋
                        </button>
                        {isCargaSupabaseDb(entry.id) && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setCargaSaveError(null);
                                setEditingCarga(entry);
                              }}
                              className="rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40 transition-colors hover:bg-white/5 hover:text-white/60"
                              title="Editar"
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingCarga(entry)}
                              className="rounded-md border border-red-500/20 px-1.5 py-0.5 text-[10px] text-red-400/40 transition-colors hover:bg-red-500/10 hover:text-red-400"
                              title="Eliminar"
                            >
                              🗑️
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {cargasList.length === 0 && (
                  <p className="py-6 text-center text-xs text-white/30">No hay registros de cargas</p>
                )}
              </div>
            </div>
          )}

          {/* ── Mantenimiento ── */}
          {section === "mantenimiento" && (
            <SeccionMantenimiento
              odometroActual={kpis.odometroActual}
              mantenimientoList={mantenimientoList}
              otrosCostosList={otrosCostosList}
              onRegistrar={(km) => setRegistrarServicioKm(km)}
              onEdit={(entry) => setEditingMantenimiento(entry)}
              onDelete={(entry) => setDeletingMantenimiento(entry)}
              onUpdateAdjunto={handleUpdateAdjunto}
              onNewOtroCosto={() => setShowOtroCostoForm(true)}
              onEditOtroCosto={(entry) => setEditingOtroCosto(entry)}
              onDeleteOtroCosto={(entry) => setDeletingOtroCosto(entry)}
            />
          )}

          {/* ── Historial ── */}
          {section === "historial" && (
            <HistoryTable
              gasolinaList={gasolinaList}
              cargasList={cargasList}
              periodosElectricos={periodosElectricos}
              mantenimientoList={mantenimientoList}
              otrosCostosList={otrosCostosList}
              onViewGasolina={(entry) => setGasolinaEnDetalle(entry)}
              onViewCarga={(entry) => setCargaEnDetalle(entry)}
              onViewCfe={(periodo) => setReciboEnDetalle(periodo)}
              onNavigate={setSection}
            />
          )}

          {/* ── Tickets ── */}
          {section === "tickets" && <TicketsView onOpenForm={() => setFormModal("ticket")} />}

          {/* ── Reportes ── */}
          {section === "reportes" && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <GastoPorDia />
                <GastoPorMes />
              </div>
              <RendimientoHistorico />
              <ComparativoGasolinaVsElectricidad />
            </div>
          )}

          {/* ── Energía ── */}
          {section === "energia" && (
            <SeccionEnergia
              periodos={periodosElectricos}
              cargas={cargasList}
              onNewRecibo={() => setFormModal("recibo")}
              onEditRecibo={(r) => setEditingRecibo(r)}
              onDeleteRecibo={(r) => setDeletingRecibo(r)}
              onViewRecibo={(r) => setReciboEnDetalle(r)}
              costoMarginalManual={costoMarginalManual}
              onCostoMarginalChange={setCostoMarginalManual}
              reciboEnDetalle={reciboEnDetalle}
            />
          )}
        </div>

        {/* ═══ FOOTER ═══ */}
        <footer className="mt-2 text-center text-[9px] text-white/15">
          BYD Wallet · v{APP_VERSION}
        </footer>
        </div>{/* end px-4 pb-5 */}
        </div>{/* end overflow-y-auto */}
      </div>{/* end main area */}

      {/* ═══ MODALS ═══ */}
      <Modal isOpen={formModal === "gasolina"} onClose={() => setFormModal(null)} title="Agregar carga de gasolina">
        <GasolinaForm
          onSave={(entry) => {
            handleSave(KEYS.gasolina, entry);
            setFormModal(null);
          }}
          onClose={() => setFormModal(null)}
        />
      </Modal>

      <Modal
        isOpen={formModal === "carga"}
        onClose={() => {
          if (!savingCarga) {
            setCargaSaveError(null);
            setFormModal(null);
          }
        }}
        title="Agregar carga eléctrica"
      >
        <CargaForm
          onSave={handleSaveCarga}
          onClose={() => {
            if (!savingCarga) {
              setCargaSaveError(null);
              setFormModal(null);
            }
          }}
          saving={savingCarga}
          externalError={cargaSaveError}
        />
      </Modal>

      {/* ═══ Carga EV detail modal ═══ */}
      <Modal isOpen={!!cargaEnDetalle} onClose={() => setCargaEnDetalle(null)} title="⚡ Detalle de carga EV">
        {cargaEnDetalle && (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-white/40">Fecha</span>
              <span className="font-medium text-white/80">{formatDate(cargaEnDetalle.fecha)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Tipo de carga</span>
              <span className="font-medium text-white/80">{cargaEnDetalle.tipo}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Batería inicial</span>
              <span className="font-medium text-white/80">{cargaEnDetalle.pctInicial}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Batería final</span>
              <span className="font-medium text-white/80">{cargaEnDetalle.pctFinal}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">kWh cargados</span>
              <span className="font-medium text-white/80">{cargaEnDetalle.kwhCargados.toFixed(1)} kWh</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Costo por kWh</span>
              <span className="font-medium text-white/80">{formatCurrency(cargaEnDetalle.costoPorKwh)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Costo total</span>
              <span className="font-medium text-byd-400">{formatCurrency(cargaEnDetalle.costo)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Km EV obtenidos</span>
              <span className="font-medium text-white/80">{cargaEnDetalle.kmEvObtenidos.toLocaleString()} km</span>
            </div>
            {cargaEnDetalle.notas && (
              <div className="flex justify-between gap-4">
                <span className="shrink-0 text-white/40">Notas</span>
                <span className="text-right font-medium text-white/80">{cargaEnDetalle.notas}</span>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ═══ Editar carga EV modal ═══ */}
      <Modal
        isOpen={!!editingCarga}
        onClose={() => {
          if (!savingCarga) {
            setCargaSaveError(null);
            setEditingCarga(null);
          }
        }}
        title="✏️ Editar carga eléctrica"
      >
        {editingCarga && (
          <CargaForm
            initialData={editingCarga}
            isEdit
            onSave={handleSaveCarga}
            onClose={() => {
              if (!savingCarga) {
                setCargaSaveError(null);
                setEditingCarga(null);
              }
            }}
            saving={savingCarga}
            externalError={cargaSaveError}
          />
        )}
      </Modal>

      {/* ═══ Eliminar carga EV confirm ═══ */}
      <ConfirmDialog
        isOpen={!!deletingCarga}
        title="Eliminar carga EV"
        message={`¿Eliminar la carga del ${deletingCarga ? formatDateShort(deletingCarga.fecha) : ""} (${deletingCarga?.kwhCargados.toFixed(1)} kWh)? Esta acción no se puede deshacer.`}
        onConfirm={() => deletingCarga && handleDeleteCarga(deletingCarga)}
        onCancel={() => setDeletingCarga(null)}
      />

      <Modal isOpen={formModal === "mantenimiento"} onClose={() => setFormModal(null)} title="Agregar mantenimiento">
        <MantenimientoForm
          onSave={(entry) => {
            handleSave(KEYS.mantenimiento, entry);
            setFormModal(null);
          }}
          onClose={() => setFormModal(null)}
        />
      </Modal>

      {/* ── Registrar servicio modal ── */}
      <Modal
        isOpen={registrarServicioKm !== null}
        onClose={() => setRegistrarServicioKm(null)}
        title="🔧 Registrar servicio"
        wide
      >
        {registrarServicioKm !== null && (
          <RegistrarServicioForm
            initialKm={registrarServicioKm}
            onSave={handleSaveMantenimiento}
          />
        )}
      </Modal>

      {/* ── Editar mantenimiento modal ── */}
      <Modal
        isOpen={editingMantenimiento !== null}
        onClose={() => setEditingMantenimiento(null)}
        title="✏️ Editar servicio"
        wide
      >
        {editingMantenimiento !== null && (
          <RegistrarServicioForm
            initialKm={editingMantenimiento.kmProgramado ?? editingMantenimiento.km}
            initialData={editingMantenimiento}
            onSave={handleSaveMantenimiento}
          />
        )}
      </Modal>

      {/* ── Eliminar mantenimiento confirm ── */}
      <ConfirmDialog
        isOpen={deletingMantenimiento !== null}
        title="Eliminar servicio"
        message={`¿Eliminar "${deletingMantenimiento?.servicio}"? Esta acción no se puede deshacer.`}
        onConfirm={() => deletingMantenimiento && handleDeleteMantenimiento(deletingMantenimiento.id)}
        onCancel={() => setDeletingMantenimiento(null)}
      />

      {/* ── Nuevo otro costo modal ── */}
      <Modal
        isOpen={showOtroCostoForm}
        onClose={() => setShowOtroCostoForm(false)}
        title="🔩 Agregar costo / refacción"
      >
        <OtroCostoForm onSave={handleSaveOtroCosto} />
      </Modal>

      {/* ── Editar otro costo modal ── */}
      <Modal
        isOpen={editingOtroCosto !== null}
        onClose={() => setEditingOtroCosto(null)}
        title="✏️ Editar costo / refacción"
      >
        {editingOtroCosto !== null && (
          <OtroCostoForm initialData={editingOtroCosto} onSave={handleSaveOtroCosto} />
        )}
      </Modal>

      {/* ── Eliminar otro costo confirm ── */}
      <ConfirmDialog
        isOpen={deletingOtroCosto !== null}
        title="Eliminar registro"
        message={`¿Eliminar "${deletingOtroCosto?.concepto}"? Esta acción no se puede deshacer.`}
        onConfirm={() => deletingOtroCosto && handleDeleteOtroCosto(deletingOtroCosto.id)}
        onCancel={() => setDeletingOtroCosto(null)}
      />

      <Modal isOpen={formModal === "ticket"} onClose={() => setFormModal(null)} title="Agregar ticket">
        <TicketForm
          onSave={(entry) => {
            handleSave(KEYS.tickets, entry);
            setFormModal(null);
          }}
          onClose={() => setFormModal(null)}
        />
      </Modal>

      <Modal isOpen={formModal === "settings"} onClose={() => setFormModal(null)} title="Configuración del vehículo">
        <SettingsForm
          settings={settings}
          onSave={(s) => {
            saveData(KEYS.settings, s);
            setKpiVersion((v) => v + 1);
            setFormModal(null);
          }}
          onClose={() => setFormModal(null)}
          onReset={() => {
            const keysToClear = [KEYS.gasolina, KEYS.cargas, KEYS.mantenimiento, KEYS.tickets];
            keysToClear.forEach((k) => localStorage.removeItem(k));
            setFormModal(null);
            setKpiVersion((v) => v + 1);
          }}
          onResetSettings={() => {
            saveData(KEYS.settings, DEFAULT_SETTINGS);
            setKpiVersion((v) => v + 1);
            setFormModal(null);
          }}
        />
      </Modal>

      <Modal isOpen={formModal === "recibo"} onClose={() => setFormModal(null)} title="➕ Nuevo recibo CFE">
        <ReciboForm
          onSave={async (data) => {
            const ok = await insertPeriodoElectrico(data);
            if (ok) {
              setFormModal(null);
              setKpiVersion((v) => v + 1);
            }
            return ok;
          }}
          onClose={() => setFormModal(null)}
        />
      </Modal>

      {/* ═══ Editar recibo modal ═══ */}
      <Modal isOpen={!!editingRecibo} onClose={() => setEditingRecibo(null)} title="✏️ Editar recibo CFE">
        {editingRecibo && (
          <ReciboForm
            initialData={editingRecibo}
            isEdit
            onSave={async (data) => {
              const ok = await updatePeriodoElectrico(editingRecibo.id, data);
              if (ok) {
                setEditingRecibo(null);
                setKpiVersion((v) => v + 1);
              }
              return ok;
            }}
            onClose={() => setEditingRecibo(null)}
          />
        )}
      </Modal>

      {/* ═══ Confirmar eliminación ═══ */}
      <ConfirmDialog
        isOpen={!!deletingRecibo}
        title="Eliminar recibo"
        message="¿Deseas eliminar este recibo?"
        onConfirm={async () => {
          if (!deletingRecibo) return;
          const ok = await deletePeriodoElectrico(deletingRecibo.id);
          if (ok) {
            setDeletingRecibo(null);
            setKpiVersion((v) => v + 1);
          }
        }}
        onCancel={() => setDeletingRecibo(null)}
      />

      {/* ═══ Gasolina detail modal ═══ */}
      <Modal isOpen={!!gasolinaEnDetalle} onClose={() => setGasolinaEnDetalle(null)} title="⛽ Detalle de recarga">
        {gasolinaEnDetalle && (() => {
          const idx = gasolinaList.findIndex((e) => e.id === gasolinaEnDetalle.id);
          const prev = idx >= 0 ? gasolinaList[idx + 1] : undefined;
          const kmDesdeAnterior = prev ? gasolinaEnDetalle.kilometraje - prev.kilometraje : null;
          const rendimientoEntreRecargas =
            kmDesdeAnterior != null && kmDesdeAnterior > 0 && gasolinaEnDetalle.litros > 0
              ? kmDesdeAnterior / gasolinaEnDetalle.litros
              : null;
          return (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-white/40">Fecha</span>
              <span className="font-medium text-white/80">{formatDate(gasolinaEnDetalle.fecha)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Gasolinera</span>
              <span className="font-medium text-white/80">{gasolinaEnDetalle.concepto}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Litros</span>
              <span className="font-medium text-white/80">{gasolinaEnDetalle.litros} L</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Precio por litro</span>
              <span className="font-medium text-white/80">
                {gasolinaEnDetalle.litros > 0
                  ? `${(gasolinaEnDetalle.costo / gasolinaEnDetalle.litros).toFixed(2)} $/L`
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Total</span>
              <span className="font-medium text-byd-400">{formatCurrency(gasolinaEnDetalle.costo)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Odómetro</span>
              <span className="font-medium text-white/80">{gasolinaEnDetalle.kilometraje.toLocaleString()} km</span>
            </div>
            {kmDesdeAnterior != null && kmDesdeAnterior > 0 && (
              <div className="flex justify-between">
                <span className="text-white/40">Km desde recarga anterior</span>
                <span className="font-medium text-white/80">{kmDesdeAnterior.toLocaleString()} km</span>
              </div>
            )}
            {rendimientoEntreRecargas != null && (
              <div>
                <div className="flex justify-between">
                  <span className="text-white/40">Rendimiento calculado entre recargas</span>
                  <span className="font-medium text-white/80">
                    {rendimientoEntreRecargas.toFixed(1)} km/L
                  </span>
                </div>
                <p className="mt-1 text-right text-[10px] text-white/30">
                  Se calcula con los km recorridos desde la recarga anterior ÷ litros cargados.
                </p>
                {rendimientoEntreRecargas > 100 && (
                  <p className="mt-1 text-right text-[10px] text-amber-400/70">
                    Valor alto por uso combinado EV + gasolina.
                  </p>
                )}
              </div>
            )}
          </div>
          );
        })()}
      </Modal>

      {/* ═══ Editar gasolina modal ═══ */}
      <Modal isOpen={!!editingGasolina} onClose={() => setEditingGasolina(null)} title="✏️ Editar recarga">
        {editingGasolina && (
          <GasolinaForm
            initialData={editingGasolina}
            isEdit
            onSave={(entry) => {
              handleUpdateGasolina(entry);
              setEditingGasolina(null);
            }}
            onClose={() => setEditingGasolina(null)}
          />
        )}
      </Modal>

      {/* ═══ Confirmar eliminación gasolina ═══ */}
      <ConfirmDialog
        isOpen={!!deletingGasolina}
        title="Eliminar recarga"
        message="¿Deseas eliminar esta recarga?"
        onConfirm={() => {
          if (!deletingGasolina) return;
          handleDeleteGasolina(deletingGasolina.id);
          setDeletingGasolina(null);
        }}
        onCancel={() => setDeletingGasolina(null)}
      />
    </div>
  );
}
