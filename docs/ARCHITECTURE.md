# BYD Wallet — Arquitectura

## Diagrama de flujo

```
                    ┌──────────────────────────────────┐
                    │          Navegador                │
                    │  localhost:3000 / GitHub Pages    │
                    └────────────┬─────────────────────┘
                                 │
                    ┌────────────▼─────────────────────┐
                    │       Next.js 16 (App Router)     │
                    │                                   │
                    │  app/layout.tsx                   │
                    │  ├── Fuentes Geist                │
                    │  ├── Metadata (lang=es, title)    │
                    │  ├── Tailwind (globals.css)       │
                    │  └── <body>{children}</body>      │
                    │                                   │
                    │  app/page.tsx ("use client")      │
                    │  ├── Home (componente principal)  │
                    │  │   ├── useEffect → fetch datos  │
                    │  │   ├── KpiCards (2 filas)       │
                    │  │   ├── NavTabs (6 secciones)    │
                    │  │   └── Sección activa           │
                    │  └── Modals (formularios)         │
                    └────────────┬─────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
    ┌─────────────────┐ ┌──────────────┐ ┌────────────────┐
    │    Supabase     │ │ localStorage │ │    Recharts    │
    │  (PostgreSQL)   │ │  (5 claves)  │ │   (gráficos)   │
    │                 │ │              │ │                │
    │  recargas (19)  │ │ byd-gasolina │ │ AreaChart      │
    │  configuracion  │ │ byd-cargas   │ │ BarChart       │
    │  cargas_elec.   │ │ byd-mantto.  │ │ LineChart      │
    │                 │ │ byd-settings │ │                │
    │                 │ │ byd-tickets  │ │                │
    └─────────────────┘ └──────────────┘ └────────────────┘
```

## Flujo de datos detallado

### 1. Inicio (mount de Home)

```
useEffect[()]
    │
    ├── fetchRecargasFromSupabase()
    │       │
    │       ├── getSupabaseClient()
    │       │       └── createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)
    │       │
    │       ├── sb.from("recargas").select("*").order("fecha", false)
    │       │       └── Retorna RecargaRow[]
    │       │
    │       └── Retorna data[] o []
    │
    └── fetchConfigFromSupabase()
            │
            ├── sb.from("configuracion").select("*").limit(1)
            │       └── Retorna ConfiguracionRow | null
            │
            └── Retorna config o null
```

### 2. Cálculo de KPIs

```
computeKpisFromRecargas(recargas, config)
    │
    ├── reduce → totalGasolina, totalLitros, numRecargas
    ├── map → odometroActual (max), odometroInicial (min)
    ├── forEach con normalizeDate → gastoHoy, gastoSemanal, gastoMensual, gastoAnual
    └── Retorna objeto KPI
```

### 3. Renderizado de secciones

```
Home
    │
    ├── section === "gasolina"
    │       └── gasolinaList = recargas.filter(gasolina).map(GasolinaEntry).sort(fecha)
    │
    ├── section === "cargas"
    │       └── cargasList = recargas.filter(EV).map(CargaEntry).sort(fecha)
    │
    ├── section === "mantenimiento"
    │       └── mantenimientoList = loadData(localStorage).sort(fecha)
    │
    ├── section === "historial"
    │       └── HistoryTable(recargas) → allRows → filter(fecha) → render
    │
    ├── section === "tickets"
    │       └── TicketsView → loadData(localStorage) → sort(fecha) → grid
    │
    └── section === "reportes"
            ├── GastoPorDia (AreaChart, últimos 7 días)
            ├── GastoPorMes (BarChart, agrupado por mes)
            ├── RendimientoHistorico (LineChart, km/L por recarga)
            └── ComparativoGasolinaVsElectricidad (BarChart apilado)
```

## Fuentes de datos por sección

| Sección | Supabase | localStorage | Ambas |
|---|---|---|---|
| KPIs (gastos) | ✅ (recargas) | ❌ | — |
| Gasolina | ✅ (tipo_combustible = gasolina) | ✅ (byd-gasolina) | — |
| Cargas EV | ✅ (tipo_combustible = EV) | ✅ (byd-cargas) | — |
| Mantenimiento | ❌ | ✅ (byd-mantenimiento) | — |
| Historial | ✅ (recargas) | ✅ (gasolina, cargas, mantto.) | ✅ (unifica) |
| Tickets | ❌ | ✅ (byd-tickets) | — |
| Reportes | ❌ | ✅ (gasolina, cargas, mantto.) | — |

## Archivos del proyecto

```
byd-wallet/
├── app/
│   ├── layout.tsx          # Layout raíz (Next.js App Router)
│   ├── page.tsx            # Componente principal (toda la app)
│   └── globals.css         # Tailwind + paleta BYD
├── lib/
│   └── supabase.ts         # Cliente Supabase singleton
├── .github/workflows/
│   └── deploy.yml          # GitHub Actions → Pages
├── next.config.ts          # Static export config
├── package.json            # Dependencias
├── tsconfig.json           # TypeScript config
├── eslint.config.mjs       # ESLint config
├── postcss.config.mjs      # PostCSS para Tailwind
└── .env.local              # Credenciales Supabase (no versionado)
```
