export const currency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
})

export const decimal = new Intl.NumberFormat('es-MX', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
})

export const percentage = new Intl.NumberFormat('es-MX', {
  maximumFractionDigits: 0,
})

export const chartPalette = ['#2dd4bf', '#7c3aed', '#f59e0b']

export const tooltipStyle = {
  backgroundColor: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: '16px',
  color: '#e5eef9',
}
