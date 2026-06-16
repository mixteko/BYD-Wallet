import type { LucideIcon } from 'lucide-react'
import type { Section } from '@/lib/types'

export function BottomNav({
  items,
  section,
  onChange,
}: {
  items: Array<{ key: Section; label: string; icon: LucideIcon }>
  section: Section
  onChange: (section: Section) => void
}) {
  return (
    <nav className="fixed bottom-3.5 left-1/2 z-50 grid w-[min(calc(100%-20px),860px)] -translate-x-1/2 grid-cols-4 gap-2 rounded-[26px] border border-white/20 bg-[rgba(8,12,22,0.94)] p-2.5 backdrop-blur-[20px] md:grid-cols-7">
      {items.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          className={`grid min-h-[54px] place-items-center gap-1 rounded-[18px] px-1 py-2 ${
            section === key ? 'bg-accent/15 text-[#e5eef9]' : 'bg-transparent text-textSoft'
          }`}
          onClick={() => onChange(key)}
        >
          <Icon size={18} />
          <span className="text-[0.74rem]">{label}</span>
        </button>
      ))}
    </nav>
  )
}
