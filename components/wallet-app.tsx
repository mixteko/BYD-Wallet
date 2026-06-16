'use client'

import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  BatteryCharging,
  CarFront,
  ChartColumn,
  History,
  ReceiptText,
  Sparkles,
  Wrench,
} from 'lucide-react'
import { BottomNav } from '@/components/bottom-nav'
import { ChargeSection } from '@/components/charge-section'
import { DashboardView } from '@/components/dashboard-view'
import { FuelSection } from '@/components/fuel-section'
import { HeroHeader } from '@/components/hero-header'
import { HistorySection } from '@/components/history-section'
import { MaintenanceSection } from '@/components/maintenance-section'
import { MetricCard } from '@/components/metric-card'
import { ReportsSection } from '@/components/reports-section'
import { SectionTitle } from '@/components/section-title'
import { StatsSection } from '@/components/stats-section'
import { currency, decimal, percentage } from '@/lib/format'
import {
  buildDailyTrend,
  buildHistory,
  buildMonthlyBreakdown,
  buildPerformanceSeries,
  calculateSnapshot,
} from '@/lib/metrics'
import { seedAppState } from '@/lib/seed'
import { createId, loadState, saveState } from '@/lib/storage'
import type { AppState, ChargeEntry, FuelEntry, MaintenanceEntry, Section } from '@/lib/types'

const navItems = [
  { key: 'dashboard' as const, label: 'Dashboard', icon: Sparkles },
  { key: 'fuel' as const, label: 'Gasolina', icon: CarFront },
  { key: 'charge' as const, label: 'Cargas', icon: BatteryCharging },
  { key: 'maintenance' as const, label: 'Mantenimiento', icon: Wrench },
  { key: 'history' as const, label: 'Historial', icon: History },
  { key: 'reports' as const, label: 'Reportes', icon: ReceiptText },
  { key: 'stats' as const, label: 'Estadísticas', icon: ChartColumn },
]

export function WalletApp() {
  const [section, setSection] = useState<Section>('dashboard')
  const [state, setState] = useState<AppState>(seedAppState)
  const [selectedVehicleId, setSelectedVehicleId] = useState(seedAppState.vehicles[0]?.id ?? '')
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const stored = loadState()
    setState(stored)
    setSelectedVehicleId(stored.vehicles[0]?.id ?? '')
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (hydrated) {
      saveState(state)
    }
  }, [hydrated, state])

  const activeVehicleId = state.vehicles.some((vehicle) => vehicle.id === selectedVehicleId)
    ? selectedVehicleId
    : state.vehicles[0]?.id ?? ''
  const activeVehicle = state.vehicles.find((vehicle) => vehicle.id === activeVehicleId) ?? state.vehicles[0]

  const fuelEntries = useMemo(
    () => state.fuelEntries.filter((entry) => entry.vehicleId === activeVehicle.id),
    [activeVehicle.id, state.fuelEntries],
  )
  const chargeEntries = useMemo(
    () => state.chargeEntries.filter((entry) => entry.vehicleId === activeVehicle.id),
    [activeVehicle.id, state.chargeEntries],
  )
  const maintenanceEntries = useMemo(
    () => state.maintenanceEntries.filter((entry) => entry.vehicleId === activeVehicle.id),
    [activeVehicle.id, state.maintenanceEntries],
  )

  const snapshot = useMemo(
    () => calculateSnapshot(activeVehicle, fuelEntries, chargeEntries, maintenanceEntries),
    [activeVehicle, chargeEntries, fuelEntries, maintenanceEntries],
  )
  const dailyTrend = useMemo(
    () => buildDailyTrend(fuelEntries, chargeEntries, maintenanceEntries),
    [chargeEntries, fuelEntries, maintenanceEntries],
  )
  const monthlyBreakdown = useMemo(
    () => buildMonthlyBreakdown(fuelEntries, chargeEntries, maintenanceEntries),
    [chargeEntries, fuelEntries, maintenanceEntries],
  )
  const historyItems = useMemo(
    () => buildHistory(fuelEntries, chargeEntries, maintenanceEntries),
    [chargeEntries, fuelEntries, maintenanceEntries],
  )
  const performanceSeries = useMemo(
    () => buildPerformanceSeries(fuelEntries, chargeEntries),
    [chargeEntries, fuelEntries],
  )

  const expenseSplit = [
    { name: 'Gasolina', value: snapshot.totalFuelSpend },
    { name: 'Eléctrico', value: snapshot.totalChargeSpend },
    { name: 'Mantto.', value: snapshot.totalMaintenanceSpend },
  ].filter((entry) => entry.value > 0)

  const handleFuelSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)

    const entry: FuelEntry = {
      id: createId('fuel'),
      vehicleId: activeVehicle.id,
      date: String(form.get('date') || ''),
      odometer: Number(form.get('odometer') || 0),
      liters: Number(form.get('liters') || 0),
      cost: Number(form.get('cost') || 0),
      station: String(form.get('station') || 'Sin estación'),
      notes: String(form.get('notes') || ''),
    }

    setState((current) => ({ ...current, fuelEntries: [entry, ...current.fuelEntries] }))
    event.currentTarget.reset()
    setSection('dashboard')
  }

  const handleChargeSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)

    const entry: ChargeEntry = {
      id: createId('charge'),
      vehicleId: activeVehicle.id,
      date: String(form.get('date') || ''),
      odometer: Number(form.get('odometer') || 0),
      kwh: Number(form.get('kwh') || 0),
      cost: Number(form.get('cost') || 0),
      chargeType: String(form.get('chargeType') || 'Casa') as ChargeEntry['chargeType'],
      location: String(form.get('location') || 'Sin ubicación'),
      socStart: Number(form.get('socStart') || 0),
      socEnd: Number(form.get('socEnd') || 0),
      notes: String(form.get('notes') || ''),
    }

    setState((current) => ({ ...current, chargeEntries: [entry, ...current.chargeEntries] }))
    event.currentTarget.reset()
    setSection('dashboard')
  }

  const handleMaintenanceSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)

    const entry: MaintenanceEntry = {
      id: createId('maintenance'),
      vehicleId: activeVehicle.id,
      date: String(form.get('date') || ''),
      odometer: Number(form.get('odometer') || 0),
      category: String(form.get('category') || 'Servicio') as MaintenanceEntry['category'],
      cost: Number(form.get('cost') || 0),
      provider: String(form.get('provider') || 'Sin proveedor'),
      notes: String(form.get('notes') || ''),
    }

    setState((current) => ({
      ...current,
      maintenanceEntries: [entry, ...current.maintenanceEntries],
    }))
    event.currentTarget.reset()
    setSection('dashboard')
  }

  if (!hydrated) {
    return <div className="mx-auto min-h-screen w-full max-w-[1180px] p-5 text-textSoft">Cargando BYD Wallet...</div>
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-[1180px] px-4 pb-[110px] pt-5 md:px-6">
      <HeroHeader
        vehicles={state.vehicles}
        activeVehicleId={activeVehicleId}
        activeVehicle={activeVehicle}
        onVehicleChange={setSelectedVehicleId}
      />

      <main className="mt-[18px] grid gap-[18px]">
        <section className="grid gap-3.5 md:grid-cols-2 lg:grid-cols-5">
          <MetricCard
            title="Costo por km"
            value={currency.format(snapshot.costPerKm)}
            helper="Costo integral incluyendo mantenimiento"
          />
          <MetricCard
            title="km/L"
            value={decimal.format(snapshot.kmPerLiter)}
            helper="Promedio entre cargas de gasolina"
          />
          <MetricCard
            title="km/kWh"
            value={decimal.format(snapshot.kmPerKwh)}
            helper="Promedio entre sesiones eléctricas"
          />
          <MetricCard
            title="Rendimiento promedio"
            value={`${percentage.format(snapshot.averagePerformanceScore)}%`}
            helper="Score híbrido vs metas del vehículo"
          />
          <MetricCard
            title="Ahorro acumulado"
            value={currency.format(snapshot.cumulativeSavings)}
            helper="Comparado contra recorrer todo en gasolina"
            accent={snapshot.cumulativeSavings >= 0}
          />
        </section>

        <section className="section-card">
          <SectionTitle
            title="Gasto inteligente"
            subtitle="Cortes automáticos diarios, semanales, mensuales y anuales."
          />
          <div className="grid gap-3.5 md:grid-cols-2 lg:grid-cols-4">
            <MetricCard title="Diario" value={currency.format(snapshot.expenseWindow.daily)} />
            <MetricCard title="Semanal" value={currency.format(snapshot.expenseWindow.weekly)} />
            <MetricCard title="Mensual" value={currency.format(snapshot.expenseWindow.monthly)} />
            <MetricCard title="Anual" value={currency.format(snapshot.expenseWindow.yearly)} />
          </div>
        </section>

        {section === 'dashboard' && (
          <DashboardView
            dailyTrend={dailyTrend}
            expenseSplit={expenseSplit}
            onNavigate={setSection}
          />
        )}
        {section === 'fuel' && <FuelSection entries={fuelEntries} onSubmit={handleFuelSubmit} />}
        {section === 'charge' && <ChargeSection entries={chargeEntries} onSubmit={handleChargeSubmit} />}
        {section === 'maintenance' && (
          <MaintenanceSection entries={maintenanceEntries} onSubmit={handleMaintenanceSubmit} />
        )}
        {section === 'history' && <HistorySection items={historyItems} />}
        {section === 'reports' && (
          <ReportsSection monthlyBreakdown={monthlyBreakdown} snapshot={snapshot} />
        )}
        {section === 'stats' && (
          <StatsSection performanceSeries={performanceSeries} snapshot={snapshot} />
        )}
      </main>

      <BottomNav items={navItems} section={section} onChange={setSection} />
    </div>
  )
}
