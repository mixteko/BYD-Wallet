import type { Vehicle } from '@/lib/types'

export function HeroHeader({
  vehicles,
  activeVehicleId,
  activeVehicle,
  onVehicleChange,
}: {
  vehicles: Vehicle[]
  activeVehicleId: string
  activeVehicle: Vehicle
  onVehicleChange: (vehicleId: string) => void
}) {
  return (
    <header className="surface overflow-hidden p-6 md:p-[30px]">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-accent/15 px-3 py-2 text-[0.82rem] uppercase tracking-[0.04em] text-accent">
          PWA MVP
        </span>
        <span className="text-textSoft">BYD Wallet para BYD King</span>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1.6fr_0.8fr] lg:items-end">
        <div>
          <h1 className="m-0 text-[clamp(2rem,7vw,4.25rem)] leading-[0.95] tracking-[-0.05em]">
            Control premium de gastos, cargas y rendimiento.
          </h1>
          <p className="mt-[18px] max-w-[60ch] text-textSoft">
            Dashboard oscuro estilo Tesla/BYD con enfoque mobile-first, métricas híbridas y base
            lista para OCR de tickets, OBD2 y múltiples vehículos.
          </p>
        </div>
        <div className="grid gap-3">
          <label className="text-textSoft" htmlFor="vehicle-select">
            Vehículo activo
          </label>
          <select
            id="vehicle-select"
            className="select-input"
            value={activeVehicleId}
            onChange={(event) => onVehicleChange(event.target.value)}
          >
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.name} · {vehicle.alias}
              </option>
            ))}
          </select>
          <div className="inline-flex w-fit items-center gap-2.5 rounded-[18px] bg-accentStrong/15 px-3.5 py-3">
            <span>{activeVehicle.modelYear}</span>
            <strong>{activeVehicle.powertrain}</strong>
          </div>
        </div>
      </div>
    </header>
  )
}
