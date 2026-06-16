"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area,
  LineChart, Line, CartesianGrid, Legend,
} from "recharts";

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
  energia: number;
  costo: number;
  duracion: string;
  kilometraje: number;
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
  rendimientoKmL: number;
  rendimientoKmKwh: number;
  precioGasolina: number;
  precioKwh: number;
  totalKm: number;
}

type Section = "gasolina" | "cargas" | "mantenimiento" | "historial" | "tickets" | "reportes";

type FormModal = "gasolina" | "carga" | "mantenimiento" | "ticket" | null;

type HistoryFilter = "hoy" | "semana" | "mes" | "ano";

interface HistoryRow {
  id: string;
  fecha: string;
  tipo: "Gasolina" | "Carga EV" | "Mantenimiento";
  importe: number;
  observaciones: string;
  source: "gasolina" | "cargas" | "mantenimiento";
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

// ── Seed data ────────────────────────────────────────────────────────────────
const SEED_GASOLINA: GasolinaEntry[] = [
  { id: "g1", fecha: "2026-06-16", litros: 15, costo: 45_200, kilometraje: 15000, concepto: "Carga rápida CCS2" },
  { id: "g2", fecha: "2026-06-15", litros: 10, costo: 4_500, kilometraje: 14950, concepto: "Estacionamiento" },
  { id: "g3", fecha: "2026-06-14", litros: 20, costo: 8_200, kilometraje: 14800, concepto: "Carga AC 7kW" },
  { id: "g4", fecha: "2026-06-14", litros: 5, costo: 6_800, kilometraje: 14700, concepto: "Peaje autopista" },
  { id: "g5", fecha: "2026-06-12", litros: 25, costo: 22_100, kilometraje: 14500, concepto: "Carga rápida CCS2" },
  { id: "g6", fecha: "2026-06-11", litros: 8, costo: 95_000, kilometraje: 14000, concepto: "Mantenimiento preventivo" },
];

const SEED_CARGAS: CargaEntry[] = [
  { id: "c1", fecha: "2026-06-15", tipo: "CCS2", energia: 42.5, costo: 18_400, duracion: "38 min", kilometraje: 15000 },
  { id: "c2", fecha: "2026-06-14", tipo: "AC 7kW", energia: 28.0, costo: 8_200, duracion: "4 h 10 min", kilometraje: 14800 },
  { id: "c3", fecha: "2026-06-12", tipo: "CCS2", energia: 51.2, costo: 22_100, duracion: "45 min", kilometraje: 14500 },
  { id: "c4", fecha: "2026-06-10", tipo: "AC 22kW", energia: 35.8, costo: 12_600, duracion: "1 h 35 min", kilometraje: 14200 },
  { id: "c5", fecha: "2026-06-08", tipo: "CCS2", energia: 38.0, costo: 16_500, duracion: "32 min", kilometraje: 13900 },
];

const SEED_MANTENIMIENTO: MantenimientoEntry[] = [
  { id: "m1", fecha: "2026-06-12", servicio: "Cambio de aceite", km: 15_000, costo: 85_000, estado: "completado" },
  { id: "m2", fecha: "2026-05-28", servicio: "Rotación de neumáticos", km: 12_500, costo: 32_000, estado: "completado" },
  { id: "m3", fecha: "2026-07-10", servicio: "Frenos + pastillas", km: 20_000, costo: 210_000, estado: "pendiente" },
  { id: "m4", fecha: "2026-08-05", servicio: "Batería 12V", km: 25_000, costo: 180_000, estado: "pendiente" },
];

const SEED_SETTINGS: VehicleSettings = {
  vehiculo: "BYD King DM-i",
  rendimientoKmL: 18.5,
  rendimientoKmKwh: 6.2,
  precioGasolina: 1250,
  precioKwh: 180,
  totalKm: 15000,
};

// ── Initialize localStorage with seeds if empty ──────────────────────────────
function initializeData(): void {
  if (typeof window === "undefined") return;
  if (!localStorage.getItem(KEYS.gasolina)) {
    saveData(KEYS.gasolina, SEED_GASOLINA);
  }
  if (!localStorage.getItem(KEYS.cargas)) {
    saveData(KEYS.cargas, SEED_CARGAS);
  }
  if (!localStorage.getItem(KEYS.mantenimiento)) {
    saveData(KEYS.mantenimiento, SEED_MANTENIMIENTO);
  }
  if (!localStorage.getItem(KEYS.settings)) {
    saveData(KEYS.settings, SEED_SETTINGS);
  }
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function toDate(fecha: string): Date {
  const d = new Date(fecha);
  return isNaN(d.getTime()) ? new Date() : d;
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
  startOfWeek.setDate(ref.getDate() - ref.getDay());
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

// ── KPI computation ──────────────────────────────────────────────────────────
function computeKpis() {
  const gasolina = loadData<GasolinaEntry[]>(KEYS.gasolina, []);
  const cargas = loadData<CargaEntry[]>(KEYS.cargas, []);
  const mantenimiento = loadData<MantenimientoEntry[]>(KEYS.mantenimiento, []);
  const settings = loadData<VehicleSettings>(KEYS.settings, SEED_SETTINGS);

  const now = new Date();

  const allEntries: { fecha: string; costo: number }[] = [
    ...gasolina.map((e) => ({ fecha: e.fecha, costo: e.costo })),
    ...cargas.map((e) => ({ fecha: e.fecha, costo: e.costo })),
    ...mantenimiento.map((e) => ({ fecha: e.fecha, costo: e.costo })),
  ];

  let gastoHoy = 0;
  let gastoSemanal = 0;
  let gastoMensual = 0;
  let gastoAnual = 0;

  for (const entry of allEntries) {
    const d = toDate(entry.fecha);
    if (isSameDay(d, now)) gastoHoy += entry.costo;
    if (isThisWeek(d, now)) gastoSemanal += entry.costo;
    if (isThisMonth(d, now)) gastoMensual += entry.costo;
    if (isThisYear(d, now)) gastoAnual += entry.costo;
  }

  const totalKm = settings.totalKm || 150;
  const totalGastos = gastoAnual;
  const costoPorKm = totalGastos > 0 ? Math.round(totalGastos / totalKm) : 0;

  return {
    gastoHoy,
    gastoSemanal,
    gastoMensual,
    gastoAnual,
    costoPorKm,
    rendimientoKmL: settings.rendimientoKmL,
    rendimientoKmKwh: settings.rendimientoKmKwh,
    ahorroAcumulado: 2_450_000,
    vehiculo: settings.vehiculo,
    totalKm,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const MONTHS = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

function formatCurrency(n: number): string {
  return `$${n.toLocaleString("es-CL")}`;
}

function formatDecimal(n: number, d: number = 1): string {
  return n.toFixed(d);
}

function formatDate(iso: string): string {
  const d = toDate(iso);
  return d.toLocaleDateString("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateShort(iso: string): string {
  const d = toDate(iso);
  const now = new Date();
  if (isSameDay(d, now)) return "Hoy";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, yesterday)) return "Ayer";
  return d.toLocaleDateString("es-CL", { day: "numeric", month: "short" });
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
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-4 backdrop-blur-xl transition-all duration-300 hover:border-byd-500/30 hover:shadow-[0_0_30px_-8px_rgba(18,184,160,0.25)] sm:p-5">
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-medium uppercase tracking-widest text-white/40 sm:text-xs">
          {label}
        </p>
        {icon && <span className="text-white/30">{icon}</span>}
      </div>
      <p className={`mt-1 text-lg font-semibold tracking-tight sm:text-2xl ${color}`}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-white/30 sm:text-xs">{sub}</p>}
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
  const [energia, setEnergia] = useState("");
  const [costo, setCosto] = useState("");
  const [duracion, setDuracion] = useState("");
  const [kilometraje, setKilometraje] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const entry: CargaEntry = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
      fecha: new Date().toISOString().split("T")[0],
      tipo,
      energia: parseFloat(energia) || 0,
      costo: parseInt(costo) || 0,
      duracion,
      kilometraje: parseInt(kilometraje) || 0,
    };
    onSave(entry);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-white/50">Tipo de carga</label>
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as "CCS2" | "AC 7kW" | "AC 22kW")}
          className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-byd-500/50"
        >
          <option value="CCS2">CCS2</option>
          <option value="AC 7kW">AC 7kW</option>
          <option value="AC 22kW">AC 22kW</option>
        </select>
      </div>
      <InputField label="Energía (kWh)" type="number" step="0.1" value={energia} onChange={setEnergia} required />
      <InputField label="Costo ($)" type="number" value={costo} onChange={setCosto} required />
      <InputField label="Duración" type="text" value={duracion} onChange={setDuracion} placeholder="ej. 38 min" required />
      <InputField label="Kilometraje" type="number" value={kilometraje} onChange={setKilometraje} required />
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

function InputField({
  label,
  type,
  step,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  type: string;
  step?: string;
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

function HistoryTable() {
  const [filter, setFilter] = useState<HistoryFilter>("mes");

  const gasolina = loadData<GasolinaEntry[]>(KEYS.gasolina, []);
  const cargas = loadData<CargaEntry[]>(KEYS.cargas, []);
  const mantenimiento = loadData<MantenimientoEntry[]>(KEYS.mantenimiento, []);

  const now = new Date();

  const allRows: HistoryRow[] = [
    ...gasolina.map((e) => ({
      id: e.id,
      fecha: e.fecha,
      tipo: "Gasolina" as const,
      importe: e.costo,
      observaciones: `${e.concepto} · ${e.litros} L · ${e.kilometraje.toLocaleString()} km`,
      source: "gasolina" as const,
    })),
    ...cargas.map((e) => ({
      id: e.id,
      fecha: e.fecha,
      tipo: "Carga EV" as const,
      importe: e.costo,
      observaciones: `${e.tipo} · ${e.energia} kWh · ${e.duracion}`,
      source: "cargas" as const,
    })),
    ...mantenimiento.map((e) => ({
      id: e.id,
      fecha: e.fecha,
      tipo: "Mantenimiento" as const,
      importe: e.costo,
      observaciones: `${e.servicio} · ${e.km.toLocaleString()} km`,
      source: "mantenimiento" as const,
    })),
  ];

  const filtered = allRows.filter((row) => {
    const d = toDate(row.fecha);
    switch (filter) {
      case "hoy": return isSameDay(d, now);
      case "semana": return isThisWeek(d, now);
      case "mes": return isThisMonth(d, now);
      case "ano": return isThisYear(d, now);
    }
  }).sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

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
                <td className="px-4 py-3 text-white/60">{formatDateShort(row.fecha)}</td>
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
              <span className="text-xs text-white/40">{formatDateShort(row.fecha)}</span>
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
            formatter={(value: any) => [`$${Number(value).toLocaleString("es-CL")}`, "Gasto"]}
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
            formatter={(value: any) => [`$${Number(value).toLocaleString("es-CL")}`, "Gasto"]}
          />
          <Bar dataKey="gasto" fill="#12b8a0" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function RendimientoHistorico() {
  const gasolina = loadData<GasolinaEntry[]>(KEYS.gasolina, []);
  const settings = loadData<VehicleSettings>(KEYS.settings, SEED_SETTINGS);

  const data = useMemo(() => {
    const entries = gasolina
      .filter((e) => e.litros > 0 && e.kilometraje > 0 && e.costo > 0)
      .slice()
      .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime())
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
  const settings = loadData<VehicleSettings>(KEYS.settings, SEED_SETTINGS);

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
              return [`$${Number(value).toLocaleString("es-CL")}`, label];
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
export default function Home() {
  const [section, setSection] = useState<Section>("gasolina");
  const [formModal, setFormModal] = useState<FormModal>(null);
  const [kpiVersion, setKpiVersion] = useState(0);

  const today = new Date();
  const dateStr = today.toLocaleDateString("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const batteryPct = 78;

  // Initialize localStorage on mount
  useEffect(() => {
    initializeData();
    setKpiVersion((v) => v + 1);
  }, []);

  // Load data
  const kpis = computeKpis();
  const gasolinaList = loadData<GasolinaEntry[]>(KEYS.gasolina, [])
    .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  const cargasList = loadData<CargaEntry[]>(KEYS.cargas, [])
    .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  const mantenimientoList = loadData<MantenimientoEntry[]>(KEYS.mantenimiento, [])
    .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

  const handleSave = useCallback(function <T>(key: string, entry: T) {
    const list = loadData<T[]>(key, []);
    saveData(key, [...list, entry]);
    setKpiVersion((v) => v + 1);
  }, []);

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
        <section className="mb-4 grid grid-cols-2 gap-3 sm:mb-6 sm:grid-cols-4">
          <KpiCard label="Gasto hoy" value={formatCurrency(kpis.gastoHoy)} />
          <KpiCard label="Gasto semanal" value={formatCurrency(kpis.gastoSemanal)} />
          <KpiCard label="Gasto mensual" value={formatCurrency(kpis.gastoMensual)} />
          <KpiCard label="Gasto anual" value={formatCurrency(kpis.gastoAnual)} />
        </section>

        {/* ═══ KPI ROW 2 ═══ */}
        <section className="mb-6 grid grid-cols-2 gap-3 sm:mb-8 sm:grid-cols-4">
          <KpiCard
            label="Costo por km"
            value={`$${kpis.costoPorKm}`}
            sub="pesos por kilómetro"
          />
          <KpiCard label="Rendimiento" value={`${formatDecimal(kpis.rendimientoKmL)} km/L`} sub="equivalente gasolina" />
          <KpiCard label="Rendimiento EV" value={`${formatDecimal(kpis.rendimientoKmKwh)} km/kWh`} sub="eléctrico" />
          <KpiCard
            label="Ahorro acumulado"
            value={formatCurrency(kpis.ahorroAcumulado)}
            color="text-emerald-400"
            sub="vs. gasolina 93"
          />
        </section>

        {/* ═══ NAV TABS ═══ */}
        <nav className="mb-5 flex gap-1 overflow-x-auto rounded-2xl border border-white/5 bg-white/[0.03] p-1 sm:mb-6">
          <NavTab active={section === "gasolina"} label="⛽ Gasolina" onClick={() => setSection("gasolina")} />
          <NavTab active={section === "cargas"} label="⚡ Cargas EV" onClick={() => setSection("cargas")} />
          <NavTab active={section === "mantenimiento"} label="🔧 Mantenimiento" onClick={() => setSection("mantenimiento")} />
          <NavTab active={section === "historial"} label="📋 Historial" onClick={() => setSection("historial")} />
          <NavTab active={section === "reportes"} label="📊 Reportes" onClick={() => setSection("reportes")} />
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
                          {entry.tipo} · {entry.energia} kWh
                        </p>
                        <p className="text-[11px] text-white/30">
                          {formatDateShort(entry.fecha)} · {entry.duracion} · {entry.kilometraje.toLocaleString()} km
                        </p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-byd-400">{formatCurrency(entry.costo)}</p>
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
          {section === "historial" && <HistoryTable />}

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
    </div>
  );
}
