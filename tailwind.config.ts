import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: '#06080f',
        surface: 'rgba(12, 18, 31, 0.84)',
        muted: 'rgba(15, 23, 42, 0.72)',
        accent: '#2dd4bf',
        accentStrong: '#7c3aed',
        warning: '#f59e0b',
        positive: '#34d399',
        textSoft: '#9ca9bc',
      },
      boxShadow: {
        premium: '0 30px 80px rgba(2, 8, 23, 0.55)',
      },
    },
  },
  plugins: [],
}

export default config
