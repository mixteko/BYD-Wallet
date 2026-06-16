export type Section =
  | 'dashboard'
  | 'fuel'
  | 'charge'
  | 'maintenance'
  | 'history'
  | 'reports'
  | 'stats'

export interface Vehicle {
  id: string
  name: string
  alias: string
  modelYear: number
  powertrain: 'PHEV' | 'EV' | 'ICE'
  benchmarkFuelEfficiency: number
  benchmarkElectricEfficiency: number
  benchmarkFuelPrice: number
}

export interface FuelEntry {
  id: string
  vehicleId: string
  date: string
  odometer: number
  liters: number
  cost: number
  station: string
  notes: string
}

export interface ChargeEntry {
  id: string
  vehicleId: string
  date: string
  odometer: number
  kwh: number
  cost: number
  chargeType: 'Casa' | 'Pública' | 'Rápida'
  location: string
  socStart: number
  socEnd: number
  notes: string
}

export interface MaintenanceEntry {
  id: string
  vehicleId: string
  date: string
  odometer: number
  category: 'Servicio' | 'Llantas' | 'Seguro' | 'Lavado' | 'Otro'
  cost: number
  provider: string
  notes: string
}

export interface AppState {
  vehicles: Vehicle[]
  fuelEntries: FuelEntry[]
  chargeEntries: ChargeEntry[]
  maintenanceEntries: MaintenanceEntry[]
}

export interface ExpenseWindow {
  daily: number
  weekly: number
  monthly: number
  yearly: number
}

export interface MetricSnapshot {
  totalDistance: number
  totalSpend: number
  totalFuelSpend: number
  totalChargeSpend: number
  totalMaintenanceSpend: number
  costPerKm: number
  kmPerLiter: number
  kmPerKwh: number
  averagePerformanceScore: number
  cumulativeSavings: number
  expenseWindow: ExpenseWindow
}

export interface HistoryItem {
  id: string
  date: string
  type: 'Gasolina' | 'Carga' | 'Mantenimiento'
  title: string
  subtitle: string
  cost: number
  odometer: number
}

export interface TrendPoint {
  label: string
  total: number
  fuel: number
  charge: number
  maintenance: number
}

export interface PerformancePoint {
  label: string
  fuelEfficiency: number
  electricEfficiency: number
}
