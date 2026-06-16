'use client'

import type { FormEvent } from 'react'
import { currency } from '@/lib/format'
import type { MaintenanceEntry } from '@/lib/types'
import { FormGrid, InputField, SelectField } from './form-fields'
import { RecordTable } from './record-table'
import { SectionTitle } from './section-title'

export function MaintenanceSection({
  entries,
  onSubmit,
}: {
  entries: MaintenanceEntry[]
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <section className="section-card">
      <SectionTitle
        title="Mantenimiento"
        subtitle="Controla servicio, llantas, seguro y gastos complementarios."
      />
      <FormGrid onSubmit={onSubmit}>
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
        <button className="submit-button md:col-span-2" type="submit">
          Guardar mantenimiento
        </button>
      </FormGrid>
      <RecordTable
        items={[...entries]
          .sort((left, right) => right.date.localeCompare(left.date))
          .map((entry) => ({
            primary: entry.category,
            secondary: `${entry.provider} · ${entry.odometer.toLocaleString('es-MX')} km`,
            value: currency.format(entry.cost),
          }))}
      />
    </section>
  )
}
