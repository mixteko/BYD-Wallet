import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BYD Wallet',
    short_name: 'BYD Wallet',
    description: 'Wallet premium para controlar gastos, cargas y mantenimiento del BYD King.',
    start_url: '/',
    display: 'standalone',
    background_color: '#06080f',
    theme_color: '#06080f',
    icons: [
      {
        src: '/pwa-192.svg',
        sizes: '192x192',
        type: 'image/svg+xml',
      },
      {
        src: '/pwa-512.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  }
}
