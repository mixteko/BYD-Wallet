import type { FormEvent, ReactNode } from 'react'

export function FormGrid({
  children,
  onSubmit,
}: {
  children: ReactNode
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <form className="grid gap-3.5 md:grid-cols-2" onSubmit={onSubmit}>
      {children}
    </form>
  )
}

export function InputField({
  label,
  name,
  type = 'text',
  step,
  placeholder,
  required,
}: {
  label: string
  name: string
  type?: string
  step?: string
  placeholder?: string
  required?: boolean
}) {
  return (
    <label className="grid gap-2">
      <span className="text-textSoft">{label}</span>
      <input
        className="text-input"
        name={name}
        type={type}
        step={step}
        placeholder={placeholder}
        required={required}
      />
    </label>
  )
}

export function SelectField({
  label,
  name,
  options,
}: {
  label: string
  name: string
  options: string[]
}) {
  return (
    <label className="grid gap-2">
      <span className="text-textSoft">{label}</span>
      <select className="select-input" name={name}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}
