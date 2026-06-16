'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { chartPalette, tooltipStyle } from '@/lib/format'
import type { TrendPoint } from '@/lib/types'
import { ArchitectureCard } from './architecture-card'
import { SectionTitle } from './section-title'

export function DashboardView({
  dailyTrend,
  expenseSplit,
  onNavigate,
}: {
  dailyTrend: TrendPoint[]
  expenseSplit: Array<{ name: string; value: number }>
  onNavigate: (section: 'fuel' | 'charge' | 'maintenance') => void
}) {
  return (
    <>
      <section className="grid gap-[18px] md:grid-cols-2">
        <article className="section-card">
          <SectionTitle
            title="Tendencia de 7 días"
            subtitle="Gráfica interactiva con combustible, carga y mantenimiento."
          />
          <div className="h-[280px] w-full">
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
          </div>
        </article>

        <article className="section-card">
          <SectionTitle
            title="Distribución de gasto"
            subtitle="Qué parte del wallet se va a gasolina, eléctrico y cuidado."
          />
          <div className="h-[280px] w-full">
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
          </div>
        </article>
      </section>

      <section className="grid gap-[18px] md:grid-cols-2">
        <article className="section-card">
          <SectionTitle
            title="Acciones rápidas"
            subtitle="Registra nuevos movimientos sin perder contexto del tablero."
          />
          <div className="grid gap-3">
            <button className="action-button" onClick={() => onNavigate('fuel')} type="button">
              Registrar gasolina
            </button>
            <button className="action-button" onClick={() => onNavigate('charge')} type="button">
              Registrar carga
            </button>
            <button className="action-button ghost" onClick={() => onNavigate('maintenance')} type="button">
              Registrar mantenimiento
            </button>
          </div>
        </article>

        <article className="section-card">
          <SectionTitle
            title="Arquitectura preparada"
            subtitle="Capas previstas para la siguiente fase sin bloquear el MVP."
          />
          <div className="grid gap-3">
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
  )
}
