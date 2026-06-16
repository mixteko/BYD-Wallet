export function RecordTable({
  items,
}: {
  items: Array<{ primary: string; secondary: string; value: string }>
}) {
  return (
    <div className="mt-[18px] grid gap-3">
      {items.map((item) => (
        <article
          key={`${item.primary}-${item.secondary}-${item.value}`}
          className="flex items-center justify-between gap-3 rounded-[22px] border border-white/10 bg-muted p-4"
        >
          <div>
            <strong className="mb-1 block">{item.primary}</strong>
            <p className="m-0 text-textSoft">{item.secondary}</p>
          </div>
          <span>{item.value}</span>
        </article>
      ))}
    </div>
  )
}
