import { currency } from '@/lib/format'
import type { HistoryItem } from '@/lib/types'
import { SectionTitle } from './section-title'

export function HistorySection({ items }: { items: HistoryItem[] }) {
  return (
    <section className="section-card">
      <SectionTitle
        title="Historial consolidado"
        subtitle="Vista cronológica de gasolina, cargas y mantenimiento."
      />
      <div className="grid gap-3">
        {items.map((item) => (
          <article
            key={item.id}
            className="flex items-start justify-between gap-3 rounded-[22px] border border-white/10 bg-muted p-4"
          >
            <div>
              <span className="inline-flex w-fit rounded-full bg-accent/15 px-2.5 py-1.5 text-[0.82rem] text-accent">
                {item.type}
              </span>
              <h3 className="mb-1 mt-2">{item.title}</h3>
              <p className="m-0 text-textSoft">
                {item.subtitle} · {item.odometer.toLocaleString('es-MX')} km
              </p>
            </div>
            <div className="flex flex-col items-end">
              <strong>{currency.format(item.cost)}</strong>
              <span className="text-textSoft">{item.date}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
