export function ArchitectureCard({
  title,
  status,
  description,
}: {
  title: string
  status: string
  description: string
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-muted p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <strong>{title}</strong>
        <span className="inline-flex w-fit rounded-full bg-accent/15 px-2.5 py-1.5 text-[0.82rem] text-accent">
          {status}
        </span>
      </div>
      <p className="m-0 text-textSoft">{description}</p>
    </div>
  )
}
