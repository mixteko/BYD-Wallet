'use client'

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { currency, percentage, tooltipStyle } from '@/lib/format'
import type { MetricSnapshot, PerformancePoint } from '@/lib/types'
import { MetricCard } from './metric-card'
import { SectionTitle } from './section-title'

export function StatsSection({
  performanceSeries,
  snapshot,
}: {
  performanceSeries: PerformancePoint[]
  snapshot: MetricSnapshot
}) {
  return (
    <section className="section-card">
      <SectionTitle
        title="Estadísticas"
        subtitle="Lectura más fina del desempeño energético y económico."
      />
      <div className="h-[280px] w-full">
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
      </div>
      <div className="mt-[18px] grid gap-3.5 md:grid-cols-3">
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
  )
}
