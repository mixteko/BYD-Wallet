"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area,
  LineChart, Line, CartesianGrid, Legend,
} from "recharts";
import { getSupabaseClient, type RecargaRow, type ConfiguracionRow, type PeriodoElectricoRow } from "@/lib/supabase";

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
}

interface MantenimientoEntry {
  id: string;
  fecha: string;
  servicio: string;
  km: number;
  costo: number;
  estado: "completado" | "pendiente";
}

interface VehicleSettings {
  vehiculo: string;
  modelo: "king-gl" | "king-gs" | "personalizado";
  capacidadBateria: number;
  tipoCargador: "portatil110" | "portatil220" | "wallbox" | "publicaAC" | "publicaDC" | "otro";
  periodoPago: "bimestral" | "mensual";
  consumoBaseHogar: number;
  costoKwhManual: number;
  costoTotalRecibo: number;
  fechaInicioPeriodo: string;
  fechaFinPeriodo: string;
  rendimientoKmL: number;
  rendimientoKmKwh: number;
  precioGasolina: number;
  totalKm: number;
  costoKwhManualAlto: number;
}

type Section = "gasolina" | "cargas" | "mantenimiento" | "historial" | "tickets" | "reportes" | "energia";

type FormModal = "gasolina" | "carga" | "mantenimiento" | "ticket" | "settings" | null;

type HistoryFilter = "hoy" | "semana" | "mes" | "ano";

interface HistoryRow {
  id: string;
  fecha: string;
  fecha_hora?: string | null;
  tipo: "Gasolina" | "Carga EV" | "Mantenimiento";
  importe: number;
  observaciones: string;
  source: "gasolina" | "cargas" | "mantenimiento";
  odometro_km: number;
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
  periodoPago: "bimestral",
  consumoBaseHogar: 300,
  costoKwhManual: 180,
  costoTotalRecibo: 3000,
  fechaInicioPeriodo: "2026-01-01",
  fechaFinPeriodo: "2026-02-28",
  rendimientoKmL: 18.5,
  rendimientoKmKwh: 6.2,
  precioGasolina: 1250,
  totalKm: 15000,
  costoKwhManualAlto: 5.00,
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
    <div className={`relative overflow-hidden rounded-2xl border ${isZero ? "border-white/[0.03]" : "border-white/5"} bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-4 backdrop-blur-xl transition-all duration-300 hover:border-byd-500/30 hover:shadow-[0_0_30px_-8px_rgba(18,184,160,0.25)] sm:p-5`}>
      <div className="flex items-start justify-between">
        <p className={`text-[11px] font-medium uppercase tracking-widest sm:text-xs ${isZero ? "text-white/25" : "text-white/40"}`}>
          {label}
        </p>
        {icon && (
          <span className={`flex items-center justify-center rounded-lg p-1.5 ${isZero ? "bg-white/[0.03] text-white/20" : "bg-byd-500/10 text-byd-400"}`}>
            {icon}
          </span>
        )}
      </div>
      <p className={`mt-1 text-lg font-semibold tracking-tight sm:text-2xl ${isZero ? "text-white/20" : color}`}>
        {value}
      </p>
      {sub && <p className={`mt-0.5 text-[11px] sm:text-xs ${isZero ? "text-white/15" : "text-white/30"}`}>{sub}</p>}
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
      className={`relative whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 sm:px-5 ${
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
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1117] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">{title}</h3>
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
}: {
  onSave: (entry: GasolinaEntry) => void;
  onClose: () => void;
}) {
  const [litros, setLitros] = useState("");
  const [costo, setCosto] = useState("");
  const [kilometraje, setKilometraje] = useState("");
  const [concepto, setConcepto] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const entry: GasolinaEntry = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
      fecha: new Date().toISOString().split("T")[0],
      litros: parseFloat(litros) || 0,
      costo: parseInt(costo) || 0,
      kilometraje: parseInt(kilometraje) || 0,
      concepto,
    };
    onSave(entry);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <InputField label="Litros" type="number" step="0.1" value={litros} onChange={setLitros} required />
      <InputField label="Costo ($)" type="number" value={costo} onChange={setCosto} required />
      <InputField label="Kilometraje" type="number" value={kilometraje} onChange={setKilometraje} required />
      <InputField label="Concepto" type="text" value={concepto} onChange={setConcepto} required />
      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/60 transition-colors hover:bg-white/10">
          Cancelar
        </button>
        <button type="submit" className="flex-1 rounded-xl bg-byd-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-byd-400">
          Guardar
        </button>
      </div>
    </form>
  );
}

function CargaForm({
  onSave,
  onClose,
}: {
  onSave: (entry: CargaEntry) => void;
  onClose: () => void;
}) {
  const [tipo, setTipo] = useState<"CCS2" | "AC 7kW" | "AC 22kW">("CCS2");
  const [fecha, setFecha] = useState(new Date().toISOString().split("T")[0]);
  const [pctInicial, setPctInicial] = useState("");
  const [pctFinal, setPctFinal] = useState("");
  const [costoTotal, setCostoTotal] = useState("");

  const settings = loadData<VehicleSettings>(KEYS.settings, DEFAULT_SETTINGS);
  const capacidadBateria = settings.capacidadBateria || 8.3;

  const pctIni = parseFloat(pctInicial) || 0;
  const pctFin = parseFloat(pctFinal) || 0;
  const pctCargado = Math.max(0, pctFin - pctIni);
  const kwhCargados = pctCargado > 0 ? Math.round(((pctCargado / 100) * capacidadBateria) * 10) / 10 : 0;
  const costo = parseInt(costoTotal) || 0;
  const costoPorKwh = kwhCargados > 0 ? Math.round(costo / kwhCargados) : 0;
  const kmEvObtenidos = kwhCargados > 0 ? Math.round(kwhCargados * settings.rendimientoKmKwh) : 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pctFin <= pctIni) {
      alert("El porcentaje final debe ser mayor al inicial");
      return;
    }
    const entry: CargaEntry = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
      fecha,
      tipo,
      pctInicial: pctIni,
      pctFinal: pctFin,
      kwhCargados,
      costo,
      costoPorKwh,
      kmEvObtenidos,
    };
    onSave(entry);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <InputField label="Fecha" type="date" value={fecha} onChange={setFecha} required />
      <div>
        <label className="mb-1 block text-xs font-medium text-white/50">Tipo de carga</label>
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as "CCS2" | "AC 7kW" | "AC 22kW")}
          className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-byd-500/50"
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
      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/60 transition-colors hover:bg-white/10">
          Cancelar
        </button>
        <button type="submit" className="flex-1 rounded-xl bg-byd-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-byd-400">
          Guardar
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
          className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-byd-500/50"
        >
          <option value="pendiente">Pendiente</option>
          <option value="completado">Completado</option>
        </select>
      </div>
      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/60 transition-colors hover:bg-white/10">
          Cancelar
        </button>
        <button type="submit" className="flex-1 rounded-xl bg-byd-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-byd-400">
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
          className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-byd-500/50"
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
        <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/60 transition-colors hover:bg-white/10">
          Cancelar
        </button>
        <button type="submit" disabled={!imageBase64} className="flex-1 rounded-xl bg-byd-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-byd-400 disabled:opacity-40">
          Guardar ticket
        </button>
      </div>
    </form>
  );
}

// ── Settings form ────────────────────────────────────────────────────────────
const MODELO_LABELS: Record<string, string> = {
  "king-gl": "BYD King GL",
  "king-gs": "BYD King GS",
  personalizado: "Personalizado",
};

const PERIODO_LABELS: Record<string, string> = {
  bimestral: "Bimestral (cada 2 meses)",
  mensual: "Mensual",
};

const CARGADOR_LABELS: Record<string, string> = {
  portatil110: "Cargador portátil 110V",
  portatil220: "Cargador portátil 220V",
  wallbox: "Wallbox",
  publicaAC: "Carga pública AC",
  publicaDC: "Carga pública DC",
  otro: "Otro",
};

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
  const [tipoCargador, setTipoCargador] = useState(settings.tipoCargador);
  const [periodoPago, setPeriodoPago] = useState(settings.periodoPago);
  const [consumoBaseHogar, setConsumoBaseHogar] = useState(String(settings.consumoBaseHogar));
  const [costoKwhManual, setCostoKwhManual] = useState(String(settings.costoKwhManual));
  const [costoTotalRecibo, setCostoTotalRecibo] = useState(String(settings.costoTotalRecibo));
  const [fechaInicioPeriodo, setFechaInicioPeriodo] = useState(settings.fechaInicioPeriodo);
  const [fechaFinPeriodo, setFechaFinPeriodo] = useState(settings.fechaFinPeriodo);
  const [rendimientoKmKwh, setRendimientoKmKwh] = useState(String(settings.rendimientoKmKwh));
  const [totalKm, setTotalKm] = useState(String(settings.totalKm));

  const capacidad =
    modelo === "king-gl" ? 8.3
    : modelo === "king-gs" ? parseFloat(capacidadBateria) || 0
    : parseFloat(capacidadBateria) || 0;

  // Compute kWh auto from actual cargas in the current billing period
  const cargas = loadData<CargaEntry[]>(KEYS.cargas, []);
  const kwhAutoReal = cargas
    .filter((c) => c.fecha >= settings.fechaInicioPeriodo && c.fecha <= settings.fechaFinPeriodo)
    .reduce((sum, c) => sum + c.kwhCargados, 0);
  const kwhAutoRealRounded = Math.round(kwhAutoReal * 10) / 10;
  const base = parseInt(consumoBaseHogar) || 0;
  const kwhManual = parseInt(costoKwhManual) || 0;
  const consumoTotalEstimado = base + kwhAutoRealRounded;
  const costoAutoEstimado = Math.round(kwhAutoRealRounded * kwhManual);
  const consumoTotalRecibo = parseInt(costoTotalRecibo) || 0;
  const kwhTotalRecibo = kwhManual > 0 ? Math.round(consumoTotalRecibo / kwhManual) : 0;
  const kwhAutoEstimado = Math.max(0, kwhTotalRecibo - base);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...settings,
      modelo,
      capacidadBateria: capacidad,
      tipoCargador,
      periodoPago,
      consumoBaseHogar: parseInt(consumoBaseHogar) || 0,
      costoKwhManual: parseInt(costoKwhManual) || 0,
      costoTotalRecibo: parseInt(costoTotalRecibo) || 0,
      fechaInicioPeriodo,
      fechaFinPeriodo,
      rendimientoKmKwh: parseFloat(rendimientoKmKwh) || 0,
      totalKm: parseInt(totalKm) || 0,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-white/50">Modelo del vehículo</label>
        <select value={modelo} onChange={(e) => setModelo(e.target.value as VehicleSettings["modelo"])}
          className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-byd-500/50">
          <option value="king-gl">BYD King GL — 8.3 kWh</option>
          <option value="king-gs">BYD King GS — Configurable</option>
          <option value="personalizado">Personalizado</option>
        </select>
      </div>

      {/* Battery capacity */}
      <div>
        <label className="mb-1 block text-xs font-medium text-white/50">
          Capacidad de batería
          {modelo === "king-gl" && <span className="ml-1 text-byd-400">(fija: 8.3 kWh)</span>}
        </label>
        {modelo === "king-gl" ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white/50">
            8.3 kWh — BYD King GL
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.1"
              min="1"
              value={capacidadBateria}
              onChange={(e) => setCapacidadBateria(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-byd-500/50"
              required
            />
            <span className="text-sm text-white/40">kWh</span>
          </div>
        )}
      </div>

      {modelo !== "king-gl" && (
        <div className="rounded-xl border border-byd-500/20 bg-byd-500/5 p-3 text-center text-sm text-byd-400">
          Capacidad: <strong>{capacidad} kWh</strong>
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-white/50">Tipo de cargador habitual</label>
        <select value={tipoCargador} onChange={(e) => setTipoCargador(e.target.value as VehicleSettings["tipoCargador"])}
          className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-byd-500/50">
          {Object.entries(CARGADOR_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* Electricity configuration */}
      <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
        <p className="mb-3 text-xs font-semibold text-white/60">Electricidad CFE México</p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-white/50">Periodo de pago</label>
            <select value={periodoPago} onChange={(e) => setPeriodoPago(e.target.value as VehicleSettings["periodoPago"])}
              className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-byd-500/50">
              {Object.entries(PERIODO_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <InputField label="Fecha inicio periodo" type="date" value={fechaInicioPeriodo} onChange={setFechaInicioPeriodo} required />
            <InputField label="Fecha fin periodo" type="date" value={fechaFinPeriodo} onChange={setFechaFinPeriodo} required />
          </div>

          <InputField label="Consumo base del hogar (kWh por periodo)" type="number" value={consumoBaseHogar} onChange={setConsumoBaseHogar} required />

          <InputField label="Costo por kWh ($)" type="number" value={costoKwhManual} onChange={setCostoKwhManual} required />

          <InputField label="Total del recibo ($)" type="number" value={costoTotalRecibo} onChange={setCostoTotalRecibo} required />

          {/* Auto-calculated summary */}
          <div className="rounded-xl border border-byd-500/20 bg-byd-500/5 p-3 text-sm">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-byd-400">
              Resumen del periodo
            </p>
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-white/40">kWh cargados al auto</span>
                <span className="font-semibold text-byd-400">{kwhAutoRealRounded} kWh</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Consumo total estimado</span>
                <span className="font-semibold text-white">{consumoTotalEstimado} kWh</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Costo estimado del auto</span>
                <span className="font-semibold text-white">{formatCurrency(costoAutoEstimado)}</span>
              </div>
              <div className="border-t border-byd-500/10 pt-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-white/30">Referencia: recibo / kWh</span>
                  <span className="text-white/30">{kwhAutoEstimado} kWh (est.)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <InputField label="Rendimiento eléctrico (km/kWh)" type="number" step="0.1" value={rendimientoKmKwh} onChange={setRendimientoKmKwh} required />
      <InputField label="Kilometraje total del vehículo" type="number" value={totalKm} onChange={setTotalKm} required />

      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/60 transition-colors hover:bg-white/10">
          Cancelar
        </button>
        <button type="submit" className="flex-1 rounded-xl bg-byd-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-byd-400">
          Guardar configuración
        </button>
      </div>

      <div className="border-t border-white/5 pt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => {
            if (confirm("¿Seguro que quieres borrar todos los datos?\n\nEsto eliminará:\n• Registros de gasolina\n• Cargas eléctricas\n• Mantenimiento\n• Tickets\n\nLa configuración del vehículo NO se borrará.")) {
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
      <label className="mb-1 block text-xs font-medium text-white/50">{label}</label>
      <input
        type={type}
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-white/20 focus:border-byd-500/50"
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
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold sm:text-base">{title}</h2>
        <span className="text-[11px] text-white/30 sm:text-xs">{count} registros</span>
      </div>
      <button
        onClick={onAdd}
        className="flex items-center gap-1 rounded-xl bg-byd-500/15 px-3 py-1.5 text-xs font-medium text-byd-400 transition-colors hover:bg-byd-500/25 sm:text-sm"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Agregar +
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
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all sm:text-sm ${
        active
          ? "bg-byd-500/15 text-byd-400 shadow-[inset_0_0_0_1px_rgba(18,184,160,0.25)]"
          : "text-white/40 hover:bg-white/[0.04] hover:text-white/70"
      }`}
    >
      {label}
    </button>
  );
}

function HistoryTable({ recargas }: { recargas: RecargaRow[] }) {
  const [filter, setFilter] = useState<HistoryFilter>("mes");

  const gasolina = loadData<GasolinaEntry[]>(KEYS.gasolina, []);
  const cargas = loadData<CargaEntry[]>(KEYS.cargas, []);
  const mantenimiento = loadData<MantenimientoEntry[]>(KEYS.mantenimiento, []);

  const now = new Date();

  const allRows: HistoryRow[] = [
    // Supabase recargas → Gasolina entries
    ...recargas.map((r) => ({
      id: String(r.id),
      fecha: r.fecha,
      fecha_hora: r.fecha_hora,
      tipo: "Gasolina" as const,
      importe: Number(r.costo_total_mxn),
      observaciones: `${r.gasolinera || "Recarga"} · ${Number(r.litros)} L · ${Number(r.odometro_km).toLocaleString()} km`,
      source: "gasolina" as const,
      odometro_km: Number(r.odometro_km),
    })),
    // localStorage entries
    ...gasolina.map((e) => ({
      id: e.id,
      fecha: e.fecha,
      tipo: "Gasolina" as const,
      importe: e.costo,
      observaciones: `${e.concepto} · ${e.litros} L · ${e.kilometraje.toLocaleString()} km`,
      source: "gasolina" as const,
      odometro_km: e.kilometraje,
    })),
    ...cargas.map((e) => ({
      id: e.id,
      fecha: e.fecha,
      tipo: "Carga EV" as const,
      importe: e.costo,
      observaciones: `${e.tipo} · ${e.kwhCargados} kWh (${e.pctInicial}% → ${e.pctFinal}%)`,
      source: "cargas" as const,
      odometro_km: e.kmEvObtenidos,
    })),
    ...mantenimiento.map((e) => ({
      id: e.id,
      fecha: e.fecha,
      tipo: "Mantenimiento" as const,
      importe: e.costo,
      observaciones: `${e.servicio} · ${e.km.toLocaleString()} km`,
      source: "mantenimiento" as const,
      odometro_km: e.km,
    })),
  ];

  // Sort by odometro_km descending (highest first)
  const sortedRows = [...allRows].sort((a, b) => b.odometro_km - a.odometro_km);

  const filtered = sortedRows.filter((row) => {
    const dateStr = row.fecha || row.fecha_hora || "";
    const d = normalizeDate(dateStr);
    if (!d) return false;
    switch (filter) {
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
    Mantenimiento: "🔧",
  };

  const tipoColor: Record<string, string> = {
    Gasolina: "text-byd-400",
    "Carga EV": "text-byd-400",
    Mantenimiento: "text-amber-400",
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold sm:text-base">Historial completo</h2>
        <div className="flex gap-1.5">
          <HistoryFilterButton active={filter === "hoy"} label="Hoy" onClick={() => setFilter("hoy")} />
          <HistoryFilterButton active={filter === "semana"} label="Semana" onClick={() => setFilter("semana")} />
          <HistoryFilterButton active={filter === "mes"} label="Mes" onClick={() => setFilter("mes")} />
          <HistoryFilterButton active={filter === "ano"} label="Año" onClick={() => setFilter("ano")} />
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-xl border border-white/5 sm:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/5 bg-white/[0.03] text-[11px] font-medium uppercase tracking-wider text-white/30">
              <th className="px-4 py-3">Fecha</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3 text-right">Importe</th>
              <th className="px-4 py-3">Observaciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} className="border-b border-white/5 transition-colors hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-white/60">{formatFechaMX(row.fecha, row.fecha_hora)}</td>
                <td className="px-4 py-3">
                  <span className={`flex items-center gap-1.5 text-sm font-medium ${tipoColor[row.tipo]}`}>
                    {tipoIcon[row.tipo]} {row.tipo}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-semibold text-white">
                  {formatCurrency(row.importe)}
                </td>
                <td className="px-4 py-3 text-[13px] text-white/50">{row.observaciones}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 sm:hidden">
        {filtered.map((row) => (
          <div key={row.id} className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-3">
            <div className="mb-1 flex items-center justify-between">
              <span className={`flex items-center gap-1 text-sm font-medium ${tipoColor[row.tipo]}`}>
                {tipoIcon[row.tipo]} {row.tipo}
              </span>
              <span className="text-xs text-white/40">{formatFechaMX(row.fecha, row.fecha_hora)}</span>
            </div>
            <p className="mb-1 text-[13px] text-white/50">{row.observaciones}</p>
            <p className="text-right text-sm font-semibold text-white">{formatCurrency(row.importe)}</p>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="py-10 text-center text-sm text-white/30">
          No hay movimientos en este período
        </p>
      )}

      {filtered.length > 0 && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
          <span className="text-sm font-medium text-white/50">{filtered.length} movimientos</span>
          <span className="text-base font-bold text-white">{formatCurrency(totalImporte)}</span>
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
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#0d1117] p-5 shadow-2xl sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">{ticket.titulo}</h3>
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

        <button onClick={onClose} className="mt-4 w-full rounded-xl bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/10">
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
        <div className="flex flex-col items-center gap-3 py-12 text-white/30">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p className="text-sm">No hay tickets aún</p>
          <p className="text-xs">Sube la foto de tu primer ticket</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 sm:p-5">
      <h3 className="mb-4 text-sm font-semibold text-white/80 sm:text-base">{title}</h3>
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
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
          <defs>
            <linearGradient id="gastoDia" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#12b8a0" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#12b8a0" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, color: "#fff" }}
            formatter={(value: any) => [formatCurrency(Number(value)), "Gasto"]}
          />
          <Area type="monotone" dataKey="gasto" stroke="#12b8a0" strokeWidth={2} fill="url(#gastoDia)" />
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
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="mes" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, color: "#fff" }}
            formatter={(value: any) => [formatCurrency(Number(value)), "Gasto"]}
          />
          <Bar dataKey="gasto" fill="#12b8a0" radius={[4, 4, 0, 0]} />
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
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="n" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, "auto"]} />
          <Tooltip
            contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, color: "#fff" }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}
            formatter={(value) => <span style={{ color: "rgba(255,255,255,0.5)" }}>{value}</span>}
          />
          <Line type="monotone" dataKey="kmL" stroke="#12b8a0" strokeWidth={2} dot={{ r: 3, fill: "#12b8a0" }} name="km/L (gasolina)" />
          <Line type="monotone" dataKey="kmKwh" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3, fill: "#0ea5e9" }} name="km/kWh (eléctrico)" />
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
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="mes" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, color: "#fff" }}
            formatter={(value: any, name: any) => {
              const label = name === "gasolina" ? "Gasolina" : "Electricidad";
              return [formatCurrency(Number(value)), label];
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}
            formatter={(value) => {
              const label = value === "gasolina" ? "Gasolina" : "Electricidad";
              return <span style={{ color: "rgba(255,255,255,0.5)" }}>{label}</span>;
            }}
          />
          <Bar dataKey="gasolina" fill="#12b8a0" radius={[4, 4, 0, 0]} name="gasolina" />
          <Bar dataKey="electricidad" fill="#0ea5e9" radius={[4, 4, 0, 0]} name="electricidad" />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ── Energía component ────────────────────────────────────────────────────
function SeccionEnergia({
  periodos,
  cargas,
  settings,
}: {
  periodos: PeriodoElectricoRow[];
  cargas: CargaEntry[];
  settings: VehicleSettings;
}) {
  if (periodos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-white/30">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <p className="text-sm">No hay recibos CFE registrados todavía.</p>
      </div>
    );
  }

  const ultimoPeriodo = periodos[0];
  const kwhBimestre = Number(ultimoPeriodo.kwh_bimestre);
  const costoKwh = ultimoPeriodo.costo_kwh_mxn ? Number(ultimoPeriodo.costo_kwh_mxn) : 0;
  const ini = ultimoPeriodo.fecha_inicio;
  const fin = ultimoPeriodo.fecha_fin;

  // Calcular kWh del BYD en el periodo
  const kwhBydPeriodo = cargas
    .filter((c) => c.fecha >= ini && c.fecha <= fin)
    .reduce((sum, c) => sum + c.kwhCargados, 0);
  const kwhBydRounded = Math.round(kwhBydPeriodo * 10) / 10;

  const kwhCasaEstimado = Math.max(0, kwhBimestre - kwhBydRounded);
  const pctByd = kwhBimestre > 0 ? Math.round((kwhBydRounded / kwhBimestre) * 100) : 0;
  const pctCasa = 100 - pctByd;

  const costoBydPromedio = kwhBydRounded * costoKwh;
  const costoBydConservador = kwhBydRounded * (settings.costoKwhManualAlto || 5);
  const costoBydPromedioRounded = Math.round(costoBydPromedio * 100) / 100;
  const costoBydConservadorRounded = Math.round(costoBydConservador * 100) / 100;
  const costoBydAhorro = Math.max(0, Math.round((costoBydConservador - costoBydPromedio) * 100) / 100);
  const costoCasapromedio = Math.round(kwhCasaEstimado * costoKwh * 100) / 100;

  const fmt = (n: number) => formatCurrency(n);
  const fmtNum = (n: number) => n.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return (
    <div className="space-y-4">
      {/* Periodo activo */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 sm:p-5">
        <h3 className="mb-3 text-sm font-semibold text-white/80 sm:text-base">Periodo activo</h3>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-[11px] text-white/40">Inicio</p>
            <p className="font-medium text-white/80">{formatDate(ini)}</p>
          </div>
          <div>
            <p className="text-[11px] text-white/40">Fin</p>
            <p className="font-medium text-white/80">{formatDate(fin)}</p>
          </div>
          <div>
            <p className="text-[11px] text-white/40">Consumo total</p>
            <p className="font-medium text-white/80">{fmtNum(kwhBimestre)} kWh</p>
          </div>
          <div>
            <p className="text-[11px] text-white/40">Costo promedio</p>
            <p className="font-medium text-white/80">{fmt(costoKwh)}</p>
          </div>
        </div>
      </div>

      {/* Distribución Casa vs BYD */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 sm:p-5">
        <h3 className="mb-3 text-sm font-semibold text-white/80 sm:text-base">Distribución del consumo</h3>

        {/* Barra de progreso visual */}
        <div className="mb-3 flex h-4 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="bg-byd-400 transition-all duration-500"
            style={{ width: `${pctByd}%` }}
          />
          <div
            className="bg-amber-500/40 transition-all duration-500"
            style={{ width: `${pctCasa}%` }}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-byd-500/10 p-3">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-byd-400" />
              <span className="text-xs font-medium text-white/50">BYD</span>
            </div>
            <p className="mt-1 text-lg font-semibold text-byd-400">{pctByd}%</p>
            <p className="text-xs text-white/40">{fmtNum(kwhBydRounded)} kWh</p>
          </div>
          <div className="rounded-lg bg-amber-500/10 p-3">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-amber-500/40" />
              <span className="text-xs font-medium text-white/50">Casa</span>
            </div>
            <p className="mt-1 text-lg font-semibold text-amber-400">{pctCasa}%</p>
            <p className="text-xs text-white/40">{fmtNum(kwhCasaEstimado)} kWh</p>
          </div>
        </div>
      </div>

      {/* Comparativa de costos */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 sm:p-5">
        <h3 className="mb-3 text-sm font-semibold text-white/80 sm:text-base">Costo del auto (BYD)</h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2.5">
            <div>
              <p className="font-medium text-white/80">Promedio</p>
              <p className="text-[11px] text-white/30">{fmtNum(kwhBydRounded)} kWh × {fmt(costoKwh)}</p>
            </div>
            <p className="font-semibold text-byd-400">{fmt(costoBydPromedioRounded)}</p>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2.5">
            <div>
              <p className="font-medium text-white/80">Conservador</p>
              <p className="text-[11px] text-white/30">{fmtNum(kwhBydRounded)} kWh × {fmt(settings.costoKwhManualAlto)}</p>
            </div>
            <p className="font-semibold text-amber-400">{fmt(costoBydConservadorRounded)}</p>
          </div>
          {costoBydAhorro > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-byd-500/5 px-3 py-2.5">
              <p className="font-medium text-byd-400">Ahorro estimado</p>
              <p className="font-semibold text-byd-400">{fmt(costoBydAhorro)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Costo casa */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white/80 sm:text-base">Costo de la casa</h3>
          <p className="text-sm font-semibold text-white">{fmt(costoCasapromedio)}</p>
        </div>
        <p className="mt-1 text-xs text-white/30">{fmtNum(kwhCasaEstimado)} kWh × {fmt(costoKwh)}</p>
      </div>
    </div>
  );
}

export default function Home() {
  const [section, setSection] = useState<Section>("gasolina");
  const [formModal, setFormModal] = useState<FormModal>(null);
  const [kpiVersion, setKpiVersion] = useState(0);
  const [recargas, setRecargas] = useState<RecargaRow[]>([]);
  const [config, setConfig] = useState<ConfiguracionRow | null>(null);
  const [periodosElectricos, setPeriodosElectricos] = useState<PeriodoElectricoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch from Supabase on mount
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        const [recargasData, configData] = await Promise.all([
          fetchRecargasFromSupabase(),
          fetchConfigFromSupabase(),
        ]);
        setRecargas(recargasData);
        setConfig(configData);

        // Carga adicional de periodos eléctricos (independiente, no bloquea)
        const periodosData = await fetchPeriodosElectricosFromSupabase();
        setPeriodosElectricos(periodosData);

        if (recargasData.length === 0) {
          console.warn("[BYD Wallet] No se encontraron recargas en Supabase");
        } else {
          console.log("[BYD Wallet] Datos cargados exitosamente:", {
            recargas: recargasData.length,
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

  // Map recargas with kWh to CargaEntry-like format
  const cargasList = useMemo(() =>
    recargas
      .filter((r) => r.tipo_combustible === "Electricidad" || r.tipo_combustible === "EV")
      .map((r) => ({
        id: String(r.id),
        fecha: r.fecha,
        tipo: "CCS2" as const,
        pctInicial: 0,
        pctFinal: 100,
        kwhCargados: Number(r.distancia_km || 0) / 6.2,
        costo: Number(r.costo_total_mxn),
        costoPorKwh: Number(r.precio_litro_mxn) || 0,
        kmEvObtenidos: Number(r.distancia_km || 0),
      }))
      .sort((a, b) => dateSortValue(b.fecha) - dateSortValue(a.fecha)),
    [recargas]);

  const settings = loadData<VehicleSettings>(KEYS.settings, DEFAULT_SETTINGS);
  const mantenimientoList = loadData<MantenimientoEntry[]>(KEYS.mantenimiento, [])
    .sort((a, b) => dateSortValue(b.fecha) - dateSortValue(a.fecha));

  const handleSave = useCallback(function <T>(key: string, entry: T) {
    const list = loadData<T[]>(key, []);
    saveData(key, [...list, entry]);
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
    <div className="min-h-screen bg-[#080a0b] text-white selection:bg-byd-500/30">
      {/* ── Background decoration ── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 right-[-10%] h-[500px] w-[500px] rounded-full bg-byd-500/[0.04] blur-[120px]" />
        <div className="absolute bottom-[-20%] left-[-10%] h-[400px] w-[400px] rounded-full bg-byd-500/[0.03] blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pb-12 pt-4 sm:px-6 sm:pt-6 lg:px-8">
        {/* ═══ HEADER ═══ */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 sm:mb-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-byd-500 text-black sm:h-10 sm:w-10">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight sm:text-lg">BYD Wallet</h1>
              <p className="text-[11px] text-white/35 sm:text-xs">{kpis.vehiculo}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-[11px] text-white/40 sm:text-xs">{dateStr}</p>
            </div>
            <button
              onClick={() => setFormModal("settings")}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 bg-white/[0.04] text-white/30 transition-colors hover:border-byd-500/30 hover:text-byd-400"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.04] px-3 py-1.5">
              <ProgressRing pct={batteryPct} />
              <div className="text-right">
                <p className="text-[10px] leading-tight text-white/40">Batería</p>
                <p className="text-sm font-semibold">{batteryPct}%</p>
              </div>
            </div>
          </div>
        </header>

        {/* ═══ KPI ROW 1 ═══ */}
        <section className="mb-4 grid grid-cols-2 gap-3 sm:mb-6 sm:grid-cols-5">
          <KpiCard label="Gasto hoy" value={formatCurrency(kpis.gastoHoy)} icon={<IconDollar />} />
          <KpiCard label="Gasto semanal" value={formatCurrency(kpis.gastoSemanal)} icon={<IconCalendar />} />
          <KpiCard label="Gasto mensual" value={formatCurrency(kpis.gastoMensual)} icon={<IconCalendar />} />
          <KpiCard label="Gasto anual" value={formatCurrency(kpis.gastoAnual)} icon={<IconCalendar />} />
          <KpiCard label="Gasto total" value={formatCurrency(kpis.gastoTotal)} color="text-byd-400" icon={<IconTotal />} />
        </section>

        {/* ═══ KPI ROW 2 ═══ */}
        <section className="mb-6 grid grid-cols-2 gap-3 sm:mb-8 sm:grid-cols-4">
          <KpiCard
            label="Costo por km"
            value={`$${kpis.costoPorKm}`}
            sub="pesos por kilómetro"
            icon={<IconRoute />}
          />
          <KpiCard label="Rendimiento" value={`${formatDecimal(kpis.rendimientoKmL)} km/L`} sub="promedio recargas" icon={<IconFuel />} />
          <KpiCard label="Rendimiento EV" value={`${formatDecimal(kpis.rendimientoKmKwh)} km/kWh`} sub="eléctrico" icon={<IconBolt />} />
          <KpiCard
            label="Total recargas"
            value={String(kpis.numRecargas)}
            color="text-byd-400"
            sub={formatCurrency(kpis.totalGasolina) + " gastados"}
            icon={<IconRefresh />}
          />
        </section>

        {/* ═══ NAV TABS ═══ */}
        <nav className="mb-5 flex gap-1 overflow-x-auto rounded-2xl border border-white/5 bg-white/[0.03] p-1 sm:mb-6">
          <NavTab active={section === "gasolina"} label="⛽ Gasolina" onClick={() => setSection("gasolina")} />
          <NavTab active={section === "cargas"} label="⚡ Cargas EV" onClick={() => setSection("cargas")} />
          <NavTab active={section === "mantenimiento"} label="🔧 Mantenimiento" onClick={() => setSection("mantenimiento")} />
          <NavTab active={section === "historial"} label="📋 Historial" onClick={() => setSection("historial")} />
          <NavTab active={section === "tickets"} label="🎫 Tickets" onClick={() => setSection("tickets")} />
          <NavTab active={section === "reportes"} label="📊 Reportes" onClick={() => setSection("reportes")} />
          <NavTab active={section === "energia"} label="⚡ Energía" onClick={() => setSection("energia")} />
        </nav>

        {/* ═══ SECTION CONTENT ═══ */}
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 backdrop-blur-xl sm:p-6">
          {/* ── Gasolina ── */}
          {section === "gasolina" && (
            <div>
              <SectionHeader title="Historial de carga" count={gasolinaList.length} onAdd={() => setFormModal("gasolina")} />
              <div className="space-y-1">
                {gasolinaList.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.03] sm:px-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-byd-500/15 text-sm text-byd-400">
                        ⛽
                      </div>
                      <div>
                        <p className="text-sm font-medium">{entry.concepto}</p>
                        <p className="text-[11px] text-white/30">
                          {formatDateShort(entry.fecha)} · {entry.litros} L · {entry.kilometraje.toLocaleString()} km
                        </p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-byd-400">{formatCurrency(entry.costo)}</p>
                  </div>
                ))}
                {gasolinaList.length === 0 && (
                  <p className="py-8 text-center text-sm text-white/30">No hay registros de gasolina</p>
                )}
              </div>
            </div>
          )}

          {/* ── Cargas EV ── */}
          {section === "cargas" && (
            <div>
              <SectionHeader title="Cargas eléctricas" count={cargasList.length} onAdd={() => setFormModal("carga")} />
              <div className="space-y-2">
                {cargasList.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2.5 transition-colors hover:bg-white/[0.06] sm:px-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-byd-500/15 text-sm text-byd-400">
                        ⚡
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {entry.tipo}
                        </p>
                        <p className="text-[11px] text-white/30">
                          {formatDateShort(entry.fecha)} · {entry.kwhCargados} kWh ({entry.pctInicial}% → {entry.pctFinal}%)
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-byd-400">{formatCurrency(entry.costo)}</p>
                      <p className="text-[10px] text-white/30">{entry.kmEvObtenidos} km</p>
                    </div>
                  </div>
                ))}
                {cargasList.length === 0 && (
                  <p className="py-8 text-center text-sm text-white/30">No hay registros de cargas</p>
                )}
              </div>
            </div>
          )}

          {/* ── Mantenimiento ── */}
          {section === "mantenimiento" && (
            <div>
              <SectionHeader title="Mantenimiento" count={mantenimientoList.length} onAdd={() => setFormModal("mantenimiento")} />
              <div className="space-y-2">
                {mantenimientoList.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2.5 transition-colors hover:bg-white/[0.06] sm:px-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-sm text-white/50">
                        🔧
                      </div>
                      <div>
                        <p className="text-sm font-medium">{entry.servicio}</p>
                        <p className="text-[11px] text-white/30">
                          {formatDate(entry.fecha)} · {entry.km.toLocaleString()} km
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-white/70">{formatCurrency(entry.costo)}</p>
                      <Tag variant={entry.estado === "completado" ? "green" : "amber"}>
                        {entry.estado === "completado" ? "Completado" : "Pendiente"}
                      </Tag>
                    </div>
                  </div>
                ))}
                {mantenimientoList.length === 0 && (
                  <p className="py-8 text-center text-sm text-white/30">No hay registros de mantenimiento</p>
                )}
              </div>
            </div>
          )}

          {/* ── Historial ── */}
          {section === "historial" && <HistoryTable recargas={recargas} />}

          {/* ── Tickets ── */}
          {section === "tickets" && <TicketsView onOpenForm={() => setFormModal("ticket")} />}

          {/* ── Reportes ── */}
          {section === "reportes" && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
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
              settings={settings}
            />
          )}
        </div>

        {/* ═══ FOOTER ═══ */}
        <footer className="mt-8 text-center text-[11px] text-white/15 sm:text-xs">
          BYD Wallet · Monitor de gastos · v0.1 MVP
        </footer>
      </div>

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

      <Modal isOpen={formModal === "carga"} onClose={() => setFormModal(null)} title="Agregar carga eléctrica">
        <CargaForm
          onSave={(entry) => {
            handleSave(KEYS.cargas, entry);
            setFormModal(null);
          }}
          onClose={() => setFormModal(null)}
        />
      </Modal>

      <Modal isOpen={formModal === "mantenimiento"} onClose={() => setFormModal(null)} title="Agregar mantenimiento">
        <MantenimientoForm
          onSave={(entry) => {
            handleSave(KEYS.mantenimiento, entry);
            setFormModal(null);
          }}
          onClose={() => setFormModal(null)}
        />
      </Modal>

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
    </div>
  );
}
