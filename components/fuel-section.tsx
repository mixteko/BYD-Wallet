'use client'

import type { FormEvent } from 'react'
import { currency } from '@/lib/format'
import type { FuelEntry } from '@/lib/types'
import { FormGrid, InputField } from './form-fields'
import { RecordTable } from './record-table'
import { SectionTitle } from './section-title'

export function FuelSection({
  entries,
  onSubmit,
}: {
  entries: FuelEntry[]
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <section className="section-card">
      <SectionTitle
        title="Registro de gasolina"
        subtitle="Captura rápida enfocada en costo, litros, odómetro y estación."
      />
      <FormGrid onSubmit={onSubmit}>
        <InputField label="Fecha" name="date" type="date" required />
        <InputField label="Odómetro (km)" name="odometer" type="number" required />
        <InputField label="Litros" name="liters" type="number" step="0.1" required />
        <InputField label="Costo (MXN)" name="cost" type="number" step="0.01" required />
        <InputField label="Estación" name="station" placeholder="Ej. BYD Mobility Hub" required />
        <InputField label="Notas" name="notes" placeholder="Uso, ruta o contexto" />
        <button className="submit-button md:col-span-2" type="submit">
          Guardar gasolina
        </button>
      </FormGrid>
      <RecordTable
        items={[...entries]
          .sort((left, right) => right.date.localeCompare(left.date))
          .map((entry) => ({
            primary: `${entry.liters.toFixed(1)} L`,
            secondary: `${entry.station} · ${entry.odometer.toLocaleString('es-MX')} km`,
            value: currency.format(entry.cost),
          }))}
      />
    </section>
  )
}
