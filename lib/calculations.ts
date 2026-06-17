/**
 * BYD Wallet — motor oficial de cálculos (v0.6.4)
 * Fuente única de fórmulas para Dashboard, Reportes y módulos.
 * Ver docs/CALCULATIONS.md
 */

import type { PeriodoElectricoRow } from "./supabase";

// ── Tipos de entrada ────────────────────────────────────────────────────────

export type GastoRow = { fecha: string; costo: number };

export type FuelRow = GastoRow & { litros: number; kilometraje: number };

export type ElectricChargeRow = GastoRow & {
  kwhCargados: number;
  kmEvObtenidos?: number;
  /** Ubicación/tipo: Casa, Pública, Electrolinera, etc. */
  tipoCarga?: string | null;
};

export type ElectricCostSource = "combinado" | "centro_energia" | "cargas_ev";

export interface ElectricCostResult {
  total: number;
  casa: number;
  externo: number;
  source: ElectricCostSource;
}

export const TIPO_CARGA_EV_CASA = "Casa";

export function normalizeTipoCargaEv(raw: string | null | undefined): string {
  if (!raw?.trim()) return "Otro";
  const t = raw.trim();
  if (t === TIPO_CARGA_EV_CASA) return TIPO_CARGA_EV_CASA;
  if (["Pública", "Supermercado", "Electrolinera", "Trabajo", "Otro"].includes(t)) return t;
  if (t === "CCS2") return "Electrolinera";
  if (t === "AC 7kW" || t === "AC 22kW") return "Pública";
  return "Otro";
}

export function getCargaEvTipo(c: { tipoCarga?: string | null; tipo?: string | null }): string {
  return normalizeTipoCargaEv(c.tipoCarga ?? c.tipo ?? null);
}

/** Recarga externa pagada fuera de casa — suma al gasto eléctrico total. */
export function isCargaEvExterna(c: { tipoCarga?: string | null; tipo?: string | null }): boolean {
  return getCargaEvTipo(c) !== TIPO_CARGA_EV_CASA;
}

export function isCargaEvCasa(c: { tipoCarga?: string | null; tipo?: string | null }): boolean {
  return getCargaEvTipo(c) === TIPO_CARGA_EV_CASA;
}

export interface VehicleCostInput {
  fuelRows: FuelRow[];
  electricPeriods: PeriodoElectricoRow[];
  electricCharges: ElectricChargeRow[];
  maintenanceRows: GastoRow[];
  otherCostRows: GastoRow[];
}

export interface EficienciaCostosStats {
  gastoGasolina: number;
  gastoElectricoByd: number;
  totalEnergia: number;
  kmRecorridos: number;
  totalLitros: number;
  costoPromedioPorKm: number | null;
  costoPor100Km: number | null;
  eficienciaGlobal: number | null;
  hasGasolina: boolean;
  hasElectricidad: boolean;
  hasKmSuficientes: boolean;
}

export type DashboardGastoMes = {
  key: string;
  label: string;
  gasolina: number;
  electricidad: number;
  mantenimiento: number;
  otros: number;
};

/** Registro crudo de mantenimiento (Supabase, localStorage u otros orígenes). */
export type MaintenanceSourceRecord = {
  id?: number | string | null;
  fecha_realizada?: string | null;
  fecha_realizado?: string | null;
  date?: string | null;
  fecha?: string | null;
  created_at?: string | null;
  costo_real?: number | string | null;
  real_cost?: number | string | null;
  cost?: number | string | null;
  costo?: number | string | null;
  costoReal?: number | string | null;
  costo_estimado?: number | string | null;
  costoEstimado?: number | string | null;
  estimated_cost?: number | string | null;
  estado?: string | null;
  status?: string | null;
  completed?: boolean | null;
  is_done?: boolean | null;
  km_programado?: number | string | null;
  kmProgramado?: number | string | null;
  scheduled_km?: number | string | null;
  service_km?: number | string | null;
  km?: number | string | null;
  odometro_realizado?: number | string | null;
  servicio?: string | null;
  notas?: string | null;
  agencia?: string | null;
};

/** Alias de compatibilidad. */
export type MaintenanceGastoRecord = MaintenanceSourceRecord;

export type NormalizedMaintenanceRecord = {
  date: string;
  cost: number;
  status: string;
  serviceKm: number | null;
  type: "maintenance";
  sourceId: string;
  label: string;
  observaciones: string;
};

function maintenanceEstadoRaw(record: MaintenanceSourceRecord): string | null {
  return record.estado?.trim() || record.status?.trim() || null;
}

function parseMaintenanceNumber(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

export function isMaintenanceRecordRealizado(
  record: MaintenanceSourceRecord | string | null | undefined,
): boolean {
  if (typeof record === "object" && record != null) {
    if (record.is_done === true || record.completed === true) return true;
    if (record.is_done === false || record.completed === false) return false;
  }
  const estado = typeof record === "string" ? record : maintenanceEstadoRaw(record ?? {});
  if (!estado) return true;
  const e = estado.toLowerCase().trim();
  if (e === "pendiente" || e === "pending" || e === "programado") return false;
  return true;
}

/** Objeto uniforme para Dashboard, Reportes e Historial. */
export function normalizeMaintenanceRecord(
  record: MaintenanceSourceRecord,
  meta?: { sourceId?: string; label?: string; observaciones?: string },
): NormalizedMaintenanceRecord | null {
  if (!isMaintenanceRecordRealizado(record)) return null;

  const status = maintenanceEstadoRaw(record) ?? "realizado";

  const dateRaw =
    record.fecha_realizado?.trim()
    || record.fecha?.trim()
    || record.date?.trim()
    || record.fecha_realizada?.trim()
    || null;
  const date = dateRaw
    || (record.created_at?.trim() ? record.created_at.trim().slice(0, 10) : null);
  if (!date) return null;

  const costReal = parseMaintenanceNumber(
    record.costo_real ?? record.real_cost ?? record.cost ?? record.costo ?? record.costoReal,
  );
  let cost = costReal;
  if (cost <= 0) {
    cost = parseMaintenanceNumber(
      record.costo_estimado ?? record.estimated_cost ?? record.costoEstimado,
    );
  }
  if (cost <= 0) return null;

  const serviceKmRaw =
    record.km_programado
    ?? record.kmProgramado
    ?? record.service_km
    ?? record.scheduled_km
    ?? record.km
    ?? null;
  const serviceKmParsed = parseMaintenanceNumber(serviceKmRaw);
  const serviceKm = serviceKmParsed > 0 ? serviceKmParsed : null;

  const odometer = parseMaintenanceNumber(record.odometro_realizado ?? record.km);
  const label =
    meta?.label
    || record.servicio?.trim()
    || record.notas?.trim()
    || (serviceKm ? `Servicio ${serviceKm.toLocaleString()} km` : "Servicio oficial");
  const observaciones =
    meta?.observaciones
    || [
      odometer > 0 ? `${odometer.toLocaleString()} km` : null,
      record.agencia?.trim() || null,
      record.notas?.trim() || null,
    ].filter(Boolean).join(" · ");

  return {
    date,
    cost: roundMoney(cost),
    status,
    serviceKm,
    type: "maintenance",
    sourceId: meta?.sourceId ?? String(record.id ?? `${date}|${cost}`),
    label,
    observaciones,
  };
}

function maintenanceDedupeKey(record: NormalizedMaintenanceRecord): string {
  return `${monthKeyFromIso(record.date)}|${record.cost}|${record.serviceKm ?? ""}`;
}

function dedupeGastoRows(rows: GastoRow[]): GastoRow[] {
  const seen = new Set<string>();
  const out: GastoRow[] = [];
  for (const r of rows) {
    if (!r.fecha || r.costo <= 0) continue;
    const key = `${monthKeyFromIso(r.fecha)}|${roundMoney(r.costo)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ fecha: r.fecha, costo: roundMoney(r.costo) });
  }
  return out;
}

/** Supabase + localStorage → lista normalizada sin duplicados. */
export function resolveAllNormalizedMaintenance(
  dbRecords?: MaintenanceSourceRecord[] | null,
  localRecords?: MaintenanceSourceRecord[] | null,
): NormalizedMaintenanceRecord[] {
  const seen = new Set<string>();
  const out: NormalizedMaintenanceRecord[] = [];

  for (const record of dbRecords ?? []) {
    const normalized = normalizeMaintenanceRecord(record, {
      sourceId: record.id != null ? `db-${record.id}` : undefined,
    });
    if (!normalized) continue;
    const key = maintenanceDedupeKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  for (const record of localRecords ?? []) {
    const normalized = normalizeMaintenanceRecord(record, {
      sourceId: record.id != null ? `local-${record.id}` : undefined,
    });
    if (!normalized) continue;
    const key = maintenanceDedupeKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  return out;
}

/** Fuente única de gasto de mantenimiento para Dashboard e Informes. */
export function resolveAllMaintenanceGastoRows(
  dbRecords?: MaintenanceSourceRecord[] | null,
  localRecords?: MaintenanceSourceRecord[] | null,
): GastoRow[] {
  return dedupeGastoRows(
    resolveAllNormalizedMaintenance(dbRecords, localRecords).map((r) => ({
      fecha: r.date,
      costo: r.cost,
    })),
  );
}

/** Prioriza fecha del servicio; created_at solo si no hay fecha de servicio y está realizado. */
export function resolveMaintenanceServiceDate(record: MaintenanceSourceRecord): string | null {
  return normalizeMaintenanceRecord(record)?.date ?? null;
}

export function resolveMaintenanceGastoCost(record: MaintenanceSourceRecord): number {
  return normalizeMaintenanceRecord(record)?.cost ?? 0;
}

/** Mantenimiento realizado → fila de gasto por mes de servicio. */
export function mapMaintenanceRecordsToGastoRows(
  records: MaintenanceSourceRecord[],
): GastoRow[] {
  return resolveAllMaintenanceGastoRows(records, []);
}

/** @deprecated Usar resolveAllMaintenanceGastoRows con fuentes separadas. */
export function resolveMaintenanceGastoRowsForMonthly(
  records: MaintenanceSourceRecord[] | undefined,
  fallbackRows: GastoRow[],
  localRows?: GastoRow[],
): GastoRow[] {
  const fromPrimary = resolveAllMaintenanceGastoRows(records, localRows?.map((r) => ({ fecha: r.fecha, costo: r.costo })));
  if (fromPrimary.length > 0) return fromPrimary;
  return dedupeGastoRows(fallbackRows);
}

// ── Fechas ──────────────────────────────────────────────────────────────────

export function normalizeDate(fecha: string | null | undefined): Date | null {
  if (!fecha) return null;
  const s = fecha.trim();

  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    const date = new Date(y, m, d);
    if (date.getFullYear() === y && date.getMonth() === m && date.getDate() === d) {
      return date;
    }
    return null;
  }

  const dmy2Match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (dmy2Match) {
    const day = parseInt(dmy2Match[1], 10);
    const month = parseInt(dmy2Match[2], 10) - 1;
    let year = parseInt(dmy2Match[3], 10);
    year += year >= 50 ? 1900 : 2000;
    const date = new Date(year, month, day);
    if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) {
      return date;
    }
    return null;
  }

  const dmy4Match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy4Match) {
    const day = parseInt(dmy4Match[1], 10);
    const month = parseInt(dmy4Match[2], 10) - 1;
    const year = parseInt(dmy4Match[3], 10);
    const date = new Date(year, month, day);
    if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) {
      return date;
    }
    return null;
  }

  return null;
}

export function monthKeyLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthKeyFromIso(iso: string): string {
  const d = normalizeDate(iso);
  return d ? monthKeyLocal(d) : "";
}

export function dateIsoFromEntry(fecha: string): string {
  const d = normalizeDate(fecha);
  if (!d) return fecha.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumGastoEnAnio(rows: GastoRow[], year: number): number {
  return roundMoney(
    rows.reduce((s, e) => {
      const d = normalizeDate(e.fecha);
      if (!d || d.getFullYear() !== year) return s;
      return s + e.costo;
    }, 0),
  );
}

// ── Centro de Energía / electricidad ────────────────────────────────────────

export function isPeriodoElectricoValido(r: PeriodoElectricoRow): boolean {
  const diffMs =
    new Date(`${r.fecha_fin}T12:00:00`).getTime() -
    new Date(`${r.fecha_inicio}T12:00:00`).getTime();
  const diffDays = diffMs / 86400000;
  return diffDays >= 20 && diffDays <= 70;
}

export function getUltimoReciboElectrico(periodos: PeriodoElectricoRow[]): PeriodoElectricoRow | null {
  const validos = periodos.filter(isPeriodoElectricoValido);
  if (validos.length > 0) return validos[0];
  return periodos.length > 0 ? periodos[0] : null;
}

export function cargaEnPeriodoElectrico(c: ElectricChargeRow, p: PeriodoElectricoRow): boolean {
  const d = normalizeDate(c.fecha);
  if (!d) return false;
  const iso = dateIsoFromEntry(c.fecha);
  return iso >= p.fecha_inicio && iso <= p.fecha_fin;
}

export function getBydKwhForPeriod(r: PeriodoElectricoRow, cargas: ElectricChargeRow[]) {
  const manualVal = r.kwh_byd_periodo != null ? Number(r.kwh_byd_periodo) : 0;
  if (manualVal > 0) {
    return { value: manualVal, isManual: true };
  }
  // Solo cargas en casa como respaldo de kWh (Centro de Energía); externas no afectan CFE.
  const casaCargas = cargas.filter((c) => isCargaEvCasa(c));
  const calculated = casaCargas
    .filter((c) => cargaEnPeriodoElectrico(c, r))
    .reduce((sum, c) => sum + c.kwhCargados, 0);
  return { value: Math.round(calculated * 10) / 10, isManual: false };
}

function costoBydFromPeriodo(p: PeriodoElectricoRow, cargas: ElectricChargeRow[] = []): number {
  const bydInfo = getBydKwhForPeriod(p, cargas);
  const rate = p.costo_kwh_mxn ? Number(p.costo_kwh_mxn) : 0;
  if (bydInfo.value <= 0 || rate <= 0) return 0;
  return roundMoney(bydInfo.value * rate);
}

export function hasCentroEnergiaConfigurado(periodos: PeriodoElectricoRow[]): boolean {
  return periodos.some(
    (p) => Number(p.costo_kwh_mxn) > 0 && Number(p.kwh_bimestre) > 0,
  );
}

function electricCostFromCentro(periodos: PeriodoElectricoRow[], cargas: ElectricChargeRow[]): number {
  const casaCargas = cargas.filter((c) => isCargaEvCasa(c));
  return roundMoney(periodos.reduce((s, p) => s + costoBydFromPeriodo(p, casaCargas), 0));
}

function electricCostFromExternalCharges(cargas: ElectricChargeRow[]): number {
  return roundMoney(
    cargas.filter((c) => isCargaEvExterna(c)).reduce((s, c) => s + c.costo, 0),
  );
}

function resolveElectricCostSource(casa: number, externo: number): ElectricCostSource {
  if (casa > 0 && externo > 0) return "combinado";
  if (casa > 0) return "centro_energia";
  return "cargas_ev";
}

/** Gasto eléctrico BYD = Centro de Energía (casa) + recargas EV externas. */
export function calculateElectricCost(
  periodos: PeriodoElectricoRow[],
  cargas: ElectricChargeRow[],
): ElectricCostResult {
  const casa = electricCostFromCentro(periodos, cargas);
  const externo = electricCostFromExternalCharges(cargas);
  return {
    total: roundMoney(casa + externo),
    casa,
    externo,
    source: resolveElectricCostSource(casa, externo),
  };
}

export function calculateElectricCostAnnual(
  periodos: PeriodoElectricoRow[],
  cargas: ElectricChargeRow[],
  year: number = new Date().getFullYear(),
): number {
  const casaCargas = cargas.filter((c) => isCargaEvCasa(c));
  const casa = roundMoney(
    periodos.reduce((s, p) => {
      const fin = normalizeDate(p.fecha_fin);
      if (!fin || fin.getFullYear() !== year) return s;
      return s + costoBydFromPeriodo(p, casaCargas);
    }, 0),
  );
  const externo = roundMoney(
    cargas.reduce((s, c) => {
      if (!isCargaEvExterna(c)) return s;
      const d = normalizeDate(c.fecha);
      if (!d || d.getFullYear() !== year) return s;
      return s + c.costo;
    }, 0),
  );
  return roundMoney(casa + externo);
}

export function calculateElectricCostMonthly(
  periodos: PeriodoElectricoRow[],
  cargas: ElectricChargeRow[],
  monthKey: string,
): number {
  const casaCargas = cargas.filter((c) => isCargaEvCasa(c));
  const casa = roundMoney(
    periodos.reduce((s, p) => {
      const key = monthKeyFromIso(p.fecha_fin);
      if (key !== monthKey) return s;
      return s + costoBydFromPeriodo(p, casaCargas);
    }, 0),
  );
  const externo = roundMoney(
    cargas.reduce((s, c) => {
      if (!isCargaEvExterna(c)) return s;
      const key = monthKeyFromIso(c.fecha);
      if (key !== monthKey) return s;
      return s + c.costo;
    }, 0),
  );
  return roundMoney(casa + externo);
}

export function calculateElectricCostDaily(
  periodos: PeriodoElectricoRow[],
  cargas: ElectricChargeRow[],
  isoDate: string,
): number {
  const casaCargas = cargas.filter((c) => isCargaEvCasa(c));
  const casa = roundMoney(
    periodos.reduce((s, p) => {
      if (p.fecha_fin !== isoDate) return s;
      return s + costoBydFromPeriodo(p, casaCargas);
    }, 0),
  );
  const externo = roundMoney(
    cargas.reduce((s, c) => {
      if (!isCargaEvExterna(c)) return s;
      return dateIsoFromEntry(c.fecha) === isoDate ? s + c.costo : s;
    }, 0),
  );
  return roundMoney(casa + externo);
}

export function getCentroEnergiaCostos(
  ultimoRecibo: PeriodoElectricoRow | null,
  cargas: ElectricChargeRow[],
) {
  if (!ultimoRecibo) return null;
  const casaCargas = cargas.filter((c) => isCargaEvCasa(c));
  const bydInfo = getBydKwhForPeriod(ultimoRecibo, casaCargas);
  const kwhByd = bydInfo.value;
  const kwhBimestre = Number(ultimoRecibo.kwh_bimestre) || 0;
  const costoKwh = ultimoRecibo.costo_kwh_mxn ? Number(ultimoRecibo.costo_kwh_mxn) : 0;
  const kwhCasa = kwhBimestre > 0 ? Math.max(0, kwhBimestre - kwhByd) : 0;
  const costoByd = costoKwh > 0 && kwhByd > 0 ? roundMoney(kwhByd * costoKwh) : null;
  const costoCasa = costoKwh > 0 && kwhCasa > 0 ? roundMoney(kwhCasa * costoKwh) : null;
  return {
    costoKwh: costoKwh > 0 ? costoKwh : null,
    kwhByd,
    kwhCasa,
    kwhBimestre,
    costoByd,
    costoCasa,
  };
}

export function calculateTotalKwhByd(
  periodos: PeriodoElectricoRow[],
  cargas: ElectricChargeRow[],
): number {
  const casaCargas = cargas.filter((c) => isCargaEvCasa(c));
  const kwhCentro = periodos.reduce((s, p) => s + getBydKwhForPeriod(p, casaCargas).value, 0);
  const kwhExterno = cargas
    .filter((c) => isCargaEvExterna(c))
    .reduce((s, c) => s + c.kwhCargados, 0);
  return Math.round((kwhCentro + kwhExterno) * 10) / 10;
}

// ── Gastos por categoría ────────────────────────────────────────────────────

export function calculateFuelCost(rows: { costo: number }[]): number {
  return roundMoney(rows.reduce((s, e) => s + e.costo, 0));
}

export function calculateMaintenanceCost(rows: GastoRow[]): number {
  return roundMoney(rows.reduce((s, e) => s + e.costo, 0));
}

export function calculateOtherCosts(rows: GastoRow[]): number {
  return roundMoney(rows.reduce((s, e) => s + e.costo, 0));
}

export function calculateTotalVehicleCost(input: VehicleCostInput): number {
  const fuel = calculateFuelCost(input.fuelRows);
  const electric = calculateElectricCost(input.electricPeriods, input.electricCharges).total;
  const maintenance = calculateMaintenanceCost(input.maintenanceRows);
  const otros = calculateOtherCosts(input.otherCostRows);
  return roundMoney(fuel + electric + maintenance + otros);
}

export function calculateAnnualTotalCost(
  input: VehicleCostInput,
  year: number = new Date().getFullYear(),
): number {
  const gasolinaAnual = sumGastoEnAnio(input.fuelRows, year);
  const electricoAnual = calculateElectricCostAnnual(input.electricPeriods, input.electricCharges, year);
  const mantAnual = sumGastoEnAnio(input.maintenanceRows, year);
  const otrosAnual = sumGastoEnAnio(input.otherCostRows, year);
  return roundMoney(gasolinaAnual + electricoAnual + mantAnual + otrosAnual);
}

// ── Kilometraje y eficiencia ────────────────────────────────────────────────

export function calculateKmTraveled(fuelRows: FuelRow[], odometerCurrent: number): number {
  const odometros = fuelRows.map((e) => e.kilometraje).filter((k) => k > 0);
  const odometroInicial = odometros.length > 0 ? Math.min(...odometros) : 0;
  return odometerCurrent > odometroInicial ? odometerCurrent - odometroInicial : 0;
}

export function calculateCostPerKm(totalInvested: number, kmTraveled: number): number {
  return kmTraveled > 0 ? roundMoney(totalInvested / kmTraveled) : 0;
}

export function calculateCostPer100Km(costoPorKm: number | null): number | null {
  return costoPorKm != null ? roundMoney(costoPorKm * 100) : null;
}

export function calculateGlobalEfficiency(kmTraveled: number, totalLitros: number): number | null {
  if (totalLitros <= 0 || kmTraveled <= 0) return null;
  return Math.round((kmTraveled / totalLitros) * 100) / 100;
}

export function calculateFuelKmPerLiter(fuelRows: FuelRow[]): number | null {
  const sorted = [...fuelRows].sort((a, b) => {
    const da = normalizeDate(a.fecha)?.getTime() ?? 0;
    const db = normalizeDate(b.fecha)?.getTime() ?? 0;
    return da - db;
  });
  let totalKm = 0;
  let totalLitros = 0;
  for (let i = 1; i < sorted.length; i++) {
    const km = sorted[i].kilometraje - sorted[i - 1].kilometraje;
    if (km > 0 && sorted[i].litros > 0) {
      totalKm += km;
      totalLitros += sorted[i].litros;
    }
  }
  if (totalKm <= 0 || totalLitros <= 0) return null;
  return Math.round((totalKm / totalLitros) * 100) / 100;
}

export function calculateEvKmPerKwh(charges: ElectricChargeRow[]): number | null {
  const valid = charges.filter((c) => c.kwhCargados > 0 && (c.kmEvObtenidos ?? 0) > 0);
  if (valid.length === 0) return null;
  const totalKm = valid.reduce((s, c) => s + (c.kmEvObtenidos ?? 0), 0);
  const totalKwh = valid.reduce((s, c) => s + c.kwhCargados, 0);
  if (totalKwh <= 0) return null;
  return roundMoney(totalKm / totalKwh);
}

/** % de km recorridos atribuidos a modo EV (km EV ÷ km totales). */
export function calculatePctKmEv(
  kmRecorridos: number,
  charges: ElectricChargeRow[],
): number | null {
  if (kmRecorridos <= 0) return null;
  const kmEv = charges.reduce((s, c) => s + Math.max(0, c.kmEvObtenidos ?? 0), 0);
  if (kmEv <= 0) return 0;
  return Math.min(100, roundMoney((kmEv / kmRecorridos) * 100));
}

function buildFuelEnergyCostPerKmHistory(fuelRows: FuelRow[]): number[] {
  const sorted = [...fuelRows].sort((a, b) => {
    const da = normalizeDate(a.fecha)?.getTime() ?? 0;
    const db = normalizeDate(b.fecha)?.getTime() ?? 0;
    if (da !== db) return da - db;
    return a.kilometraje - b.kilometraje;
  });
  const costs: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const km = sorted[i].kilometraje - sorted[i - 1].kilometraje;
    if (km > 0 && sorted[i].costo >= 0) {
      costs.push(roundMoney(sorted[i].costo / km));
    }
  }
  return costs;
}

function scoreInRangeHigherBetter(value: number, samples: number[]): number {
  const valid = samples.filter((v) => v > 0);
  if (value <= 0 || valid.length === 0) return 0;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  if (max <= min) return 100;
  return Math.round(Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)));
}

function scoreInRangeLowerBetter(value: number, samples: number[]): number {
  const valid = samples.filter((v) => v > 0);
  if (value <= 0 || valid.length === 0) return 0;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  if (max <= min) return 100;
  return Math.round(Math.min(100, Math.max(0, ((max - value) / (max - min)) * 100)));
}

export function interpretIndiceEficienciaHibrida(score: number): string {
  if (score >= 95) return "Excelente";
  if (score >= 85) return "Muy eficiente";
  if (score >= 70) return "Eficiencia buena";
  if (score >= 50) return "Puede mejorar";
  return "Uso poco eficiente";
}

export type IndiceEficienciaHibridaResult = {
  score: number | null;
  label: string | null;
  kmPerLiter: number | null;
  kmPerKwh: number | null;
  pctKmEv: number | null;
  costoPorKm: number | null;
  costoPor100Km: number | null;
  components: {
    fuelScore: number;
    evScore: number | null;
    evUsageScore: number;
    costScore: number;
  } | null;
};

/**
 * IEH (0–100): resume el uso híbrido con métricas reales del vehículo.
 * Sin conversiones litros↔kWh; referencias solo del historial del usuario.
 */
export function calculateIndiceEficienciaHibrida(
  fuelRows: FuelRow[],
  electricPeriods: PeriodoElectricoRow[],
  electricCharges: ElectricChargeRow[],
  odometerCurrent: number,
): IndiceEficienciaHibridaResult {
  const stats = calculateEfficiencyAndCosts(
    fuelRows,
    electricPeriods,
    electricCharges,
    odometerCurrent,
  );
  const kmPerLiter = calculateFuelKmPerLiter(fuelRows);
  const kmPerKwh = calculateEvKmPerKwh(electricCharges);
  const pctKmEv = calculatePctKmEv(stats.kmRecorridos, electricCharges);
  const costoPorKm = stats.costoPromedioPorKm;
  const costoPor100Km = stats.costoPor100Km;

  const empty: IndiceEficienciaHibridaResult = {
    score: null,
    label: null,
    kmPerLiter,
    kmPerKwh,
    pctKmEv,
    costoPorKm,
    costoPor100Km,
    components: null,
  };

  if (!stats.hasGasolina || !stats.hasKmSuficientes || kmPerLiter == null || costoPorKm == null) {
    return empty;
  }

  const fuelHistory = buildFuelEfficiencyHistory(fuelRows).map((p) => p.kmL);
  const evHistory = buildEvEfficiencyHistory(electricCharges).map((p) => p.kmKwh);
  const costHistory = buildFuelEnergyCostPerKmHistory(fuelRows);
  const costSamples = [...costHistory, costoPorKm].filter((v) => v > 0);

  const fuelScore = scoreInRangeHigherBetter(
    kmPerLiter,
    fuelHistory.length > 0 ? fuelHistory : [kmPerLiter],
  );
  const evScore =
    kmPerKwh != null && evHistory.length > 0
      ? scoreInRangeHigherBetter(kmPerKwh, evHistory)
      : null;
  const evUsageScore = pctKmEv ?? 0;
  const costScore =
    costSamples.length > 0 ? scoreInRangeLowerBetter(costoPorKm, costSamples) : 0;

  const score =
    evScore != null
      ? Math.round(0.25 * fuelScore + 0.25 * evScore + 0.20 * evUsageScore + 0.30 * costScore)
      : Math.round(0.40 * fuelScore + 0.60 * costScore);

  const clamped = Math.min(100, Math.max(0, score));

  return {
    score: clamped,
    label: interpretIndiceEficienciaHibrida(clamped),
    kmPerLiter,
    kmPerKwh,
    pctKmEv,
    costoPorKm,
    costoPor100Km,
    components: {
      fuelScore,
      evScore,
      evUsageScore,
      costScore,
    },
  };
}

export function calculateAverageKwhRate(
  totalGasto: number,
  totalKwh: number,
  tarifaRecibo: number | null,
): number | null {
  if (totalKwh > 0 && totalGasto > 0) {
    return roundMoney(totalGasto / totalKwh);
  }
  if (tarifaRecibo != null && tarifaRecibo > 0) {
    return roundMoney(tarifaRecibo);
  }
  return null;
}

// ── Panel Eficiencia y Costos ───────────────────────────────────────────────

export function calculateEfficiencyAndCosts(
  fuelRows: FuelRow[],
  electricPeriods: PeriodoElectricoRow[],
  electricCharges: ElectricChargeRow[],
  odometerCurrent: number,
): EficienciaCostosStats {
  const gastoGasolina = calculateFuelCost(fuelRows);
  const totalLitros = roundMoney(fuelRows.reduce((s, e) => s + e.litros, 0));
  const gastoElectricoByd = calculateElectricCost(electricPeriods, electricCharges).total;
  const totalEnergia = roundMoney(gastoGasolina + gastoElectricoByd);
  const kmRecorridos = calculateKmTraveled(fuelRows, odometerCurrent);
  const costoPromedioPorKm =
    kmRecorridos > 0 ? roundMoney(totalEnergia / kmRecorridos) : null;
  const costoPor100Km = calculateCostPer100Km(costoPromedioPorKm);
  const eficienciaGlobal = calculateGlobalEfficiency(kmRecorridos, totalLitros);

  return {
    gastoGasolina,
    gastoElectricoByd,
    totalEnergia,
    kmRecorridos,
    totalLitros,
    costoPromedioPorKm,
    costoPor100Km,
    eficienciaGlobal,
    hasGasolina: fuelRows.length > 0 && totalLitros > 0,
    hasElectricidad:
      gastoElectricoByd > 0 ||
      electricCharges.some((c) => c.kwhCargados > 0) ||
      electricPeriods.some((p) => Number(p.costo_kwh_mxn) > 0),
    hasKmSuficientes: kmRecorridos > 0,
  };
}

// ── Series temporales (Dashboard / Reportes) ────────────────────────────────

export function buildMonthlyExpenseBreakdown12(
  fuelRows: FuelRow[],
  electricPeriods: PeriodoElectricoRow[],
  electricCharges: ElectricChargeRow[],
  maintenanceRows: GastoRow[],
  otherCostRows: GastoRow[],
): DashboardGastoMes[] {
  const effectiveMaintenanceRows = dedupeGastoRows(maintenanceRows);

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

  fuelRows.forEach((e) => {
    const key = monthKeyFromIso(e.fecha);
    if (!key) return;
    const m = find(key);
    if (m) m.gasolina += e.costo;
  });

  months.forEach((m) => {
    m.electricidad = calculateElectricCostMonthly(electricPeriods, electricCharges, m.key);
  });

  effectiveMaintenanceRows.forEach((e) => {
    const key = monthKeyFromIso(e.fecha);
    if (!key) return;
    const m = find(key);
    if (m) m.mantenimiento = roundMoney(m.mantenimiento + e.costo);
  });

  otherCostRows.forEach((e) => {
    const key = monthKeyFromIso(e.fecha);
    if (!key) return;
    const m = find(key);
    if (m) m.otros += e.costo;
  });

  return months;
}

export function buildDailyExpenseLast7Days(
  fuelRows: FuelRow[],
  electricPeriods: PeriodoElectricoRow[],
  electricCharges: ElectricChargeRow[],
  maintenanceRows: GastoRow[],
  otherCostRows: GastoRow[],
): { date: string; label: string; gasto: number }[] {
  const days: { date: string; label: string; gasto: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const labelRaw = i === 0 ? "Hoy" : d.toLocaleDateString("es-CL", { weekday: "short" });
    let total = calculateElectricCostDaily(electricPeriods, electricCharges, iso);
    fuelRows.forEach((e) => {
      if (dateIsoFromEntry(e.fecha) === iso) total += e.costo;
    });
    maintenanceRows.forEach((e) => {
      if (dateIsoFromEntry(e.fecha) === iso) total += e.costo;
    });
    otherCostRows.forEach((e) => {
      if (dateIsoFromEntry(e.fecha) === iso) total += e.costo;
    });
    days.push({
      date: iso,
      label: labelRaw.charAt(0).toUpperCase() + labelRaw.slice(1),
      gasto: roundMoney(total),
    });
  }
  return days;
}

// ── Rendimiento energético histórico (Reportes) ─────────────────────────────

export type RefillEfficiencyPoint = { label: string; kmL: number };

export type ChargeEfficiencyPoint = { label: string; kmKwh: number };

export type GlobalEfficiencyPoint = { label: string; kmLGlobal: number };

export type EnergyEfficiencyChartPoint = {
  label: string;
  kmL: number | null;
  kmKwh: number | null;
  kmLGlobal: number | null;
};

/** km/L por recarga: (odómetro actual − anterior) / litros cargados. */
export function buildFuelEfficiencyHistory(fuelRows: FuelRow[]): RefillEfficiencyPoint[] {
  const sorted = [...fuelRows].sort((a, b) => {
    const da = normalizeDate(a.fecha)?.getTime() ?? 0;
    const db = normalizeDate(b.fecha)?.getTime() ?? 0;
    if (da !== db) return da - db;
    return a.kilometraje - b.kilometraje;
  });
  const points: RefillEfficiencyPoint[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const km = sorted[i].kilometraje - sorted[i - 1].kilometraje;
    if (km > 0 && sorted[i].litros > 0) {
      points.push({
        label: `#${points.length + 1}`,
        kmL: Math.round((km / sorted[i].litros) * 100) / 100,
      });
    }
  }
  return points;
}

/** km/kWh por carga EV: km EV obtenidos / kWh cargados. */
export function buildEvEfficiencyHistory(charges: ElectricChargeRow[]): ChargeEfficiencyPoint[] {
  return [...charges]
    .filter((c) => c.kwhCargados > 0 && (c.kmEvObtenidos ?? 0) > 0)
    .sort((a, b) => {
      const da = normalizeDate(a.fecha)?.getTime() ?? 0;
      const db = normalizeDate(b.fecha)?.getTime() ?? 0;
      return da - db;
    })
    .map((c, i) => ({
      label: `#${i + 1}`,
      kmKwh: Math.round(((c.kmEvObtenidos ?? 0) / c.kwhCargados) * 100) / 100,
    }));
}

/** Km/L global acumulado: km totales / litros acumulados entre recargas. */
export function buildGlobalFuelEfficiencyHistory(fuelRows: FuelRow[]): GlobalEfficiencyPoint[] {
  const sorted = [...fuelRows].sort((a, b) => {
    const da = normalizeDate(a.fecha)?.getTime() ?? 0;
    const db = normalizeDate(b.fecha)?.getTime() ?? 0;
    if (da !== db) return da - db;
    return a.kilometraje - b.kilometraje;
  });
  const points: GlobalEfficiencyPoint[] = [];
  let cumKm = 0;
  let cumLitros = 0;
  for (let i = 1; i < sorted.length; i++) {
    const km = sorted[i].kilometraje - sorted[i - 1].kilometraje;
    if (km > 0 && sorted[i].litros > 0) {
      cumKm += km;
      cumLitros += sorted[i].litros;
      points.push({
        label: `#${points.length + 1}`,
        kmLGlobal: Math.round((cumKm / cumLitros) * 100) / 100,
      });
    }
  }
  return points;
}

export function mergeEnergyEfficiencyForChart(
  fuelPoints: RefillEfficiencyPoint[],
  evPoints: ChargeEfficiencyPoint[],
  globalPoints: GlobalEfficiencyPoint[] = [],
): EnergyEfficiencyChartPoint[] {
  const maxLen = Math.max(fuelPoints.length, evPoints.length, globalPoints.length);
  if (maxLen === 0) return [];
  return Array.from({ length: maxLen }, (_, i) => ({
    label: `#${i + 1}`,
    kmL: fuelPoints[i]?.kmL ?? null,
    kmKwh: evPoints[i]?.kmKwh ?? null,
    kmLGlobal: globalPoints[i]?.kmLGlobal ?? null,
  }));
}

// ── Formato KPI ─────────────────────────────────────────────────────────────

export function formatCostoPorKm(n: number): string {
  return `$${n.toFixed(2)}/km`;
}

export function formatTarifaKwh(rate: number | null | undefined): string {
  if (rate == null || rate <= 0) return "Sin dato";
  return `$${rate.toFixed(2)}/kWh`;
}

// ── Alias de compatibilidad (migración desde page.tsx) ──────────────────────

export const resolveGastoElectricoByd = calculateElectricCost;
export const getTotalGastoElectricoByd = (
  periodos: PeriodoElectricoRow[],
  cargas: ElectricChargeRow[],
) => calculateElectricCost(periodos, cargas).total;
export const getGastoElectricoBydAnual = calculateElectricCostAnnual;
export const getGastoElectricoByMes = calculateElectricCostMonthly;
export const getGastoElectricoByDia = calculateElectricCostDaily;
export const computeKmRecorridosDesdeGasolina = calculateKmTraveled;
export const computeGastoAnualIntegrado = calculateAnnualTotalCost;
export const computeTotalInvertidoIntegrado = (
  gastoGasolina: number,
  gastoElectrico: number,
  mantenimientoRows: GastoRow[],
  otrosRows: GastoRow[],
) => roundMoney(gastoGasolina + gastoElectrico + calculateMaintenanceCost(mantenimientoRows) + calculateOtherCosts(otrosRows));
export const computeCostoPorKmIntegrado = calculateCostPerKm;
export const getTarifaPromedioByd = calculateAverageKwhRate;
export const getTotalKwhBydUnificado = calculateTotalKwhByd;
export const computeEficienciaCostos = calculateEfficiencyAndCosts;
export const buildDashboardGastoPorMes12 = buildMonthlyExpenseBreakdown12;
export const buildGastoPorDia7 = buildDailyExpenseLast7Days;

export type DashboardGastoRow = GastoRow;
