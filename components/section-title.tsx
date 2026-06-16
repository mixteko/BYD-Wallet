import { Gauge } from 'lucide-react'

export function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-[18px] flex items-start gap-3.5">
      <div className="grid h-10 w-10 place-items-center rounded-[14px] bg-accent/15 text-accent">
        <Gauge size={18} />
      </div>
      <div>
        <h2 className="m-0 text-[clamp(1.2rem,4vw,1.7rem)]">{title}</h2>
        <p className="m-0 text-textSoft">{subtitle}</p>
      </div>
    </div>
  )
}
