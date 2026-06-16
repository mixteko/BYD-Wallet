'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { currency, tooltipStyle } from '@/lib/format'
import type { MetricSnapshot, TrendPoint } from '@/lib/types'
import { MetricCard } from './metric-card'
import { SectionTitle } from './section-title'

export function ReportsSection({
  monthlyBreakdown,
  snapshot,
}: {
  monthlyBreakdown: TrendPoint[]
  snapshot: MetricSnapshot
}) {
  return (
    <section className="section-card">
      <SectionTitle
        title="Reportes"
        subtitle="Concentrado mensual de gastos y mezcla energética del vehículo."
      />
      <div className="h-[280px] w-full">
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
      </div>
      <div className="mt-[18px] grid gap-3.5 md:grid-cols-3">
        <MetricCard title="Gasto gasolina" value={currency.format(snapshot.totalFuelSpend)} />
        <MetricCard title="Gasto eléctrico" value={currency.format(snapshot.totalChargeSpend)} />
        <MetricCard title="Mantenimiento" value={currency.format(snapshot.totalMaintenanceSpend)} />
      </div>
    </section>
  )
}
