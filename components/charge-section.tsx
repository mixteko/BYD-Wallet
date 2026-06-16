'use client'

import type { FormEvent } from 'react'
import { currency } from '@/lib/format'
import type { ChargeEntry } from '@/lib/types'
import { FormGrid, InputField, SelectField } from './form-fields'
import { RecordTable } from './record-table'
import { SectionTitle } from './section-title'

export function ChargeSection({
  entries,
  onSubmit,
}: {
  entries: ChargeEntry[]
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <section className="section-card">
      <SectionTitle
        title="Registro de cargas eléctricas"
        subtitle="Sesiones domésticas o públicas con SOC inicial/final y costo."
      />
      <FormGrid onSubmit={onSubmit}>
        <InputField label="Fecha" name="date" type="date" required />
        <InputField label="Odómetro (km)" name="odometer" type="number" required />
        <InputField label="kWh" name="kwh" type="number" step="0.1" required />
        <InputField label="Costo (MXN)" name="cost" type="number" step="0.01" required />
        <SelectField label="Tipo de carga" name="chargeType" options={['Casa', 'Pública', 'Rápida']} />
        <InputField label="Ubicación" name="location" placeholder="Garage, plaza, oficina" required />
        <InputField label="SOC inicial %" name="socStart" type="number" required />
        <InputField label="SOC final %" name="socEnd" type="number" required />
        <InputField label="Notas" name="notes" placeholder="Tarifa o detalle" />
        <button className="submit-button md:col-span-2" type="submit">
          Guardar carga
        </button>
      </FormGrid>
      <RecordTable
        items={[...entries]
          .sort((left, right) => right.date.localeCompare(left.date))
          .map((entry) => ({
            primary: `${entry.kwh.toFixed(1)} kWh · ${entry.chargeType}`,
            secondary: `${entry.location} · ${entry.odometer.toLocaleString('es-MX')} km`,
            value: currency.format(entry.cost),
          }))}
      />
    </section>
  )
}
