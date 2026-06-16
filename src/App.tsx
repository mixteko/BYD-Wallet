import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BatteryCharging,
  CarFront,
  ChartColumn,
  Gauge,
  History,
  ReceiptText,
  Sparkles,
  Wrench,
} from 'lucide-react'
import { seedAppState, STORAGE_KEY } from './data/seed'
import {
  buildDailyTrend,
  buildHistory,
  buildMonthlyBreakdown,
  buildPerformanceSeries,
  calculateSnapshot,
} from './lib/metrics'
import type { AppState, ChargeEntry, FuelEntry, MaintenanceEntry, Section } from './types'

const navItems: Array<{ key: Section; label: string; icon: typeof Sparkles }> = [
  { key: 'dashboard', label: 'Dashboard', icon: Sparkles },
  { key: 'fuel', label: 'Gasolina', icon: CarFront },
  { key: 'charge', label: 'Cargas', icon: BatteryCharging },
  { key: 'maintenance', label: 'Mantenimiento', icon: Wrench },
  { key: 'history', label: 'Historial', icon: History },
  { key: 'reports', label: 'Reportes', icon: ReceiptText },
  { key: 'stats', label: 'Estadísticas', icon: ChartColumn },
]

const currency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
})

const decimal = new Intl.NumberFormat('es-MX', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
})

const percentage = new Intl.NumberFormat('es-MX', {
  maximumFractionDigits: 0,
})

const chartPalette = ['#2dd4bf', '#7c3aed', '#f59e0b']

const loadState = (): AppState => {
  const storedValue = localStorage.getItem(STORAGE_KEY)

  if (!storedValue) {
    return seedAppState
  }

  try {
    const parsed = JSON.parse(storedValue) as AppState
    return {
      ...seedAppState,
      ...parsed,
    }
  } catch {
    return seedAppState
  }
}

const createId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

function App() {
  const [section, setSection] = useState<Section>('dashboard')
  const [state, setState] = useState<AppState>(loadState)
  const [selectedVehicleId, setSelectedVehicleId] = useState(state.vehicles[0]?.id ?? '')

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  useEffect(() => {
    if (!state.vehicles.some((vehicle) => vehicle.id === selectedVehicleId)) {
      setSelectedVehicleId(state.vehicles[0]?.id ?? '')
    }
  }, [selectedVehicleId, state.vehicles])

  const activeVehicle = state.vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? state.vehicles[0]

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

    setState((current) => ({
      ...current,
      fuelEntries: [entry, ...current.fuelEntries],
    }))
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

    setState((current) => ({
      ...current,
      chargeEntries: [entry, ...current.chargeEntries],
    }))
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

  return (
    <div className="app-shell">
      <header className="hero-card surface">
        <div className="eyebrow">
          <span className="eyebrow-pill">PWA MVP</span>
          <span className="eyebrow-text">BYD Wallet para BYD King</span>
        </div>
        <div className="hero-grid">
          <div>
            <h1>Control premium de gastos, cargas y rendimiento.</h1>
            <p className="hero-copy">
              Dashboard oscuro estilo Tesla/BYD con enfoque mobile-first, métricas híbridas y base
              lista para OCR de tickets, OBD2 y múltiples vehículos.
            </p>
          </div>
          <div className="hero-aside">
            <label className="field-label" htmlFor="vehicle-select">
              Vehículo activo
            </label>
            <select
              id="vehicle-select"
              className="select-input"
              value={selectedVehicleId}
              onChange={(event) => setSelectedVehicleId(event.target.value)}
            >
              {state.vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.name} · {vehicle.alias}
                </option>
              ))}
            </select>
            <div className="vehicle-chip">
              <span>{activeVehicle.modelYear}</span>
              <strong>{activeVehicle.powertrain}</strong>
            </div>
          </div>
        </div>
      </header>

      <main className="content-stack">
        <section className="metrics-grid">
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

        <section className="surface section-card">
          <SectionTitle
            title="Gasto inteligente"
            subtitle="Cortes automáticos diarios, semanales, mensuales y anuales."
          />
          <div className="expense-grid">
            <MetricCard title="Diario" value={currency.format(snapshot.expenseWindow.daily)} />
            <MetricCard title="Semanal" value={currency.format(snapshot.expenseWindow.weekly)} />
            <MetricCard title="Mensual" value={currency.format(snapshot.expenseWindow.monthly)} />
            <MetricCard title="Anual" value={currency.format(snapshot.expenseWindow.yearly)} />
          </div>
        </section>

        {section === 'dashboard' && (
          <>
            <section className="chart-grid">
              <article className="surface section-card">
                <SectionTitle
                  title="Tendencia de 7 días"
                  subtitle="Gráfica interactiva con combustible, carga y mantenimiento."
                />
                <ChartContainer>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dailyTrend}>
                      <defs>
                        <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#2dd4bf" stopOpacity={0.65} />
                          <stop offset="95%" stopColor="#2dd4bf" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#1f2937" vertical={false} />
                      <XAxis dataKey="label" stroke="#6b7280" />
                      <YAxis stroke="#6b7280" />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Area
                        type="monotone"
                        dataKey="total"
                        stroke="#2dd4bf"
                        fill="url(#trendGradient)"
                        strokeWidth={3}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </article>

              <article className="surface section-card">
                <SectionTitle
                  title="Distribución de gasto"
                  subtitle="Qué parte del wallet se va a gasolina, eléctrico y cuidado."
                />
                <ChartContainer>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={expenseSplit}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={54}
                        outerRadius={92}
                        paddingAngle={4}
                      >
                        {expenseSplit.map((entry, index) => (
                          <Cell key={entry.name} fill={chartPalette[index % chartPalette.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </article>
            </section>

            <section className="dashboard-grid">
              <article className="surface section-card">
                <SectionTitle
                  title="Acciones rápidas"
                  subtitle="Registra nuevos movimientos sin perder contexto del tablero."
                />
                <div className="quick-actions">
                  <button className="action-button" onClick={() => setSection('fuel')} type="button">
                    Registrar gasolina
                  </button>
                  <button className="action-button" onClick={() => setSection('charge')} type="button">
                    Registrar carga
                  </button>
                  <button
                    className="action-button ghost"
                    onClick={() => setSection('maintenance')}
                    type="button"
                  >
                    Registrar mantenimiento
                  </button>
                </div>
              </article>

              <article className="surface section-card">
                <SectionTitle
                  title="Arquitectura preparada"
                  subtitle="Capas previstas para la siguiente fase sin bloquear el MVP."
                />
                <div className="architecture-list">
                  <ArchitectureCard
                    title="OCR de tickets"
                    status="Ready"
                    description="Interfaz pensada para adjuntar foto, preprocesar y completar formularios."
                  />
                  <ArchitectureCard
                    title="Integración OBD2"
                    status="Ready"
                    description="Modelo de datos compatible con telemetría y sincronización por vehículo."
                  />
                  <ArchitectureCard
                    title="Múltiples vehículos"
                    status="Activo"
                    description="Selector y storage desacoplado por vehicleId desde el MVP."
                  />
                </div>
              </article>
            </section>
          </>
        )}

        {section === 'fuel' && (
          <section className="surface section-card">
            <SectionTitle
              title="Registro de gasolina"
              subtitle="Captura rápida enfocada en costo, litros, odómetro y estación."
            />
            <FormGrid onSubmit={handleFuelSubmit}>
              <InputField label="Fecha" name="date" type="date" required />
              <InputField label="Odómetro (km)" name="odometer" type="number" required />
              <InputField label="Litros" name="liters" type="number" step="0.1" required />
              <InputField label="Costo (MXN)" name="cost" type="number" step="0.01" required />
              <InputField label="Estación" name="station" placeholder="Ej. BYD Mobility Hub" required />
              <InputField label="Notas" name="notes" placeholder="Uso, ruta o contexto" />
              <button className="submit-button" type="submit">
                Guardar gasolina
              </button>
            </FormGrid>
            <RecordTable
              items={fuelEntries
                .slice()
                .sort((left, right) => right.date.localeCompare(left.date))
                .map((entry) => ({
                  primary: `${entry.liters.toFixed(1)} L`,
                  secondary: `${entry.station} · ${entry.odometer.toLocaleString('es-MX')} km`,
                  value: currency.format(entry.cost),
                }))}
            />
          </section>
        )}

        {section === 'charge' && (
          <section className="surface section-card">
            <SectionTitle
              title="Registro de cargas eléctricas"
              subtitle="Sesiones domésticas o públicas con SOC inicial/final y costo."
            />
            <FormGrid onSubmit={handleChargeSubmit}>
              <InputField label="Fecha" name="date" type="date" required />
              <InputField label="Odómetro (km)" name="odometer" type="number" required />
              <InputField label="kWh" name="kwh" type="number" step="0.1" required />
              <InputField label="Costo (MXN)" name="cost" type="number" step="0.01" required />
              <SelectField
                label="Tipo de carga"
                name="chargeType"
                options={['Casa', 'Pública', 'Rápida']}
              />
              <InputField label="Ubicación" name="location" placeholder="Garage, plaza, oficina" required />
              <InputField label="SOC inicial %" name="socStart" type="number" required />
              <InputField label="SOC final %" name="socEnd" type="number" required />
              <InputField label="Notas" name="notes" placeholder="Tarifa o detalle" />
              <button className="submit-button" type="submit">
                Guardar carga
              </button>
            </FormGrid>
            <RecordTable
              items={chargeEntries
                .slice()
                .sort((left, right) => right.date.localeCompare(left.date))
                .map((entry) => ({
                  primary: `${entry.kwh.toFixed(1)} kWh · ${entry.chargeType}`,
                  secondary: `${entry.location} · ${entry.odometer.toLocaleString('es-MX')} km`,
                  value: currency.format(entry.cost),
                }))}
            />
          </section>
        )}

        {section === 'maintenance' && (
          <section className="surface section-card">
            <SectionTitle
              title="Mantenimiento"
              subtitle="Controla servicio, llantas, seguro y gastos complementarios."
            />
            <FormGrid onSubmit={handleMaintenanceSubmit}>
              <InputField label="Fecha" name="date" type="date" required />
              <InputField label="Odómetro (km)" name="odometer" type="number" required />
              <SelectField
                label="Categoría"
                name="category"
                options={['Servicio', 'Llantas', 'Seguro', 'Lavado', 'Otro']}
              />
              <InputField label="Costo (MXN)" name="cost" type="number" step="0.01" required />
              <InputField label="Proveedor" name="provider" placeholder="Centro BYD, detailing, etc." required />
              <InputField label="Notas" name="notes" placeholder="Resumen del trabajo realizado" />
              <button className="submit-button" type="submit">
                Guardar mantenimiento
              </button>
            </FormGrid>
            <RecordTable
              items={maintenanceEntries
                .slice()
                .sort((left, right) => right.date.localeCompare(left.date))
                .map((entry) => ({
                  primary: entry.category,
                  secondary: `${entry.provider} · ${entry.odometer.toLocaleString('es-MX')} km`,
                  value: currency.format(entry.cost),
                }))}
            />
          </section>
        )}

        {section === 'history' && (
          <section className="surface section-card">
            <SectionTitle
              title="Historial consolidado"
              subtitle="Vista cronológica de gasolina, cargas y mantenimiento."
            />
            <div className="history-list">
              {historyItems.map((item) => (
                <article className="history-item" key={item.id}>
                  <div>
                    <span className="history-type">{item.type}</span>
                    <h3>{item.title}</h3>
                    <p>
                      {item.subtitle} · {item.odometer.toLocaleString('es-MX')} km
                    </p>
                  </div>
                  <div className="history-meta">
                    <strong>{currency.format(item.cost)}</strong>
                    <span>{item.date}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {section === 'reports' && (
          <section className="surface section-card">
            <SectionTitle
              title="Reportes"
              subtitle="Concentrado mensual de gastos y mezcla energética del vehículo."
            />
            <ChartContainer>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyBreakdown}>
                  <CartesianGrid stroke="#1f2937" vertical={false} />
                  <XAxis dataKey="label" stroke="#6b7280" />
                  <YAxis stroke="#6b7280" />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="fuel" stackId="a" fill="#2dd4bf" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="charge" stackId="a" fill="#7c3aed" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="maintenance" stackId="a" fill="#f59e0b" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
            <div className="report-grid">
              <MetricCard title="Gasto gasolina" value={currency.format(snapshot.totalFuelSpend)} />
              <MetricCard title="Gasto eléctrico" value={currency.format(snapshot.totalChargeSpend)} />
              <MetricCard title="Mantenimiento" value={currency.format(snapshot.totalMaintenanceSpend)} />
            </div>
          </section>
        )}

        {section === 'stats' && (
          <section className="surface section-card">
            <SectionTitle
              title="Estadísticas"
              subtitle="Lectura más fina del desempeño energético y económico."
            />
            <ChartContainer>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={performanceSeries}>
                  <CartesianGrid stroke="#1f2937" vertical={false} />
                  <XAxis dataKey="label" stroke="#6b7280" />
                  <YAxis stroke="#6b7280" />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line
                    type="monotone"
                    dataKey="fuelEfficiency"
                    name="km/L"
                    stroke="#2dd4bf"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="electricEfficiency"
                    name="km/kWh"
                    stroke="#7c3aed"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>
            <div className="report-grid">
              <MetricCard title="Distancia total" value={`${snapshot.totalDistance.toLocaleString('es-MX')} km`} />
              <MetricCard
                title="Costo movilidad"
                value={currency.format(snapshot.totalFuelSpend + snapshot.totalChargeSpend)}
              />
              <MetricCard
                title="Meta híbrida"
                value={`${percentage.format(snapshot.averagePerformanceScore)}%`}
                helper="Promedio de desempeño frente a los benchmarks configurados"
              />
            </div>
          </section>
        )}
      </main>

      <nav className="bottom-nav">
        {navItems.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className={`nav-item ${section === key ? 'active' : ''}`}
            onClick={() => setSection(key)}
          >
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

const tooltipStyle = {
  backgroundColor: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: '16px',
  color: '#e5eef9',
}

function MetricCard({
  title,
  value,
  helper,
  accent,
}: {
  title: string
  value: string
  helper?: string
  accent?: boolean
}) {
  return (
    <article className={`metric-card surface ${accent ? 'accent' : ''}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      {helper ? <p>{helper}</p> : null}
    </article>
  )
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="section-title">
      <div className="section-icon">
        <Gauge size={18} />
      </div>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  )
}

function ChartContainer({ children }: { children: ReactNode }) {
  return <div className="chart-frame">{children}</div>
}

function ArchitectureCard({
  title,
  status,
  description,
}: {
  title: string
  status: string
  description: string
}) {
  return (
    <div className="architecture-card">
      <div className="architecture-header">
        <strong>{title}</strong>
        <span>{status}</span>
      </div>
      <p>{description}</p>
    </div>
  )
}

function FormGrid({
  children,
  onSubmit,
}: {
  children: ReactNode
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      {children}
    </form>
  )
}

function InputField({
  label,
  name,
  type = 'text',
  step,
  placeholder,
  required,
}: {
  label: string
  name: string
  type?: string
  step?: string
  placeholder?: string
  required?: boolean
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className="text-input" name={name} type={type} step={step} placeholder={placeholder} required={required} />
    </label>
  )
}

function SelectField({
  label,
  name,
  options,
}: {
  label: string
  name: string
  options: string[]
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select className="select-input" name={name}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

function RecordTable({
  items,
}: {
  items: Array<{ primary: string; secondary: string; value: string }>
}) {
  return (
    <div className="record-list">
      {items.map((item) => (
        <article className="record-row" key={`${item.primary}-${item.secondary}-${item.value}`}>
          <div>
            <strong>{item.primary}</strong>
            <p>{item.secondary}</p>
          </div>
          <span>{item.value}</span>
        </article>
      ))}
    </div>
  )
}

export default App
