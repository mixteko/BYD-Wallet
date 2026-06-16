export function MetricCard({
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
    <article className={`metric-card ${accent ? 'border-positive/40 shadow-[0_25px_60px_rgba(16,185,129,0.12)]' : ''}`}>
      <span className="block text-sm text-textSoft">{title}</span>
      <strong className="mt-3.5 block text-[clamp(1.6rem,4.5vw,2.2rem)] tracking-[-0.04em]">{value}</strong>
      {helper ? <p className="mt-2 text-sm text-textSoft">{helper}</p> : null}
    </article>
  )
}
