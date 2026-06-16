import type { Metadata, Viewport } from 'next'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'BYD Wallet',
  description: 'Wallet premium para controlar gastos, cargas y mantenimiento del BYD King.',
  applicationName: 'BYD Wallet',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'BYD Wallet',
  },
  manifest: '/manifest.webmanifest',
}

export const viewport: Viewport = {
  themeColor: '#06080f',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
