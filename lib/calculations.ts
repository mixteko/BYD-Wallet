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

  maintenanceRows.forEach((e) => {
    const key = monthKeyFromIso(e.fecha);
    if (!key) return;
    const m = find(key);
    if (m) m.mantenimiento += e.costo;
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
