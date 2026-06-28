# BYD Wallet — Contexto del Proyecto

## Objetivo

BYD Wallet es una aplicación web para monitorear y controlar los gastos operativos de un vehículo BYD King DM-i. Centraliza en un solo lugar los registros de gasolina, cargas eléctricas, mantenimiento, tickets y genera reportes de rendimiento y ahorro.

## Estado actual

- **Versión**: v0.1 MVP
- **Estado**: Funcional con 19 registros históricos en Supabase
- **Frontend**: Next.js 16 (App Router) — diseño oscuro
- **Backend**: Supabase (Base de datos PostgreSQL en línea)
- **Deploy**: Localhost (desarrollo) + GitHub Pages (estático mediante GitHub Actions)

## Arquitectura (resumen)

```
Navegador (usuario)
    │
    ▼
Next.js 16 (App Router)
    │
    ├── app/layout.tsx     ← Layout raíz (fuentes, metadata, estilos globales)
    ├── app/page.tsx       ← Componente único SPA (toda la app)
    │
    ├── lib/supabase.ts    ← Conexión a Supabase (lazy singleton)
    │       │
    │       ▼
    │   Supabase (PostgreSQL)
    │       ├── recargas          ← 19 registros históricos
    │       ├── configuracion     ← 1 registro (vehículo)
    │       └── cargas_electricas ← 0 registros (tabla reservada)
    │
    └── localStorage              ← Datos creados por el usuario
            ├── byd-gasolina
            ├── byd-cargas
            ├── byd-mantenimiento
            ├── byd-settings
            └── byd-tickets
```

## Tecnologías

| Tecnología | Versión | Propósito |
|---|---|---|
| Next.js | 16.2.9 | Framework React (App Router) |
| React | 19.2.4 | UI |
| TypeScript | ~5 | Tipado estático |
| Tailwind CSS | 4 | Estilos utilitarios |
| Recharts | ~3.8.1 | Gráficos (AreaChart, BarChart, LineChart) |
| Supabase JS | ~2.108.2 | Cliente Supabase (browser) |
| PostCSS | — | Procesador CSS para Tailwind |
| ESLint | ~9 | Linter |

## Flujo de trabajo

1. El usuario abre `localhost:3001` (dev) o la URL de GitHub Pages
2. Next.js renderiza el layout (`app/layout.tsx`) con Tailwind y fuentes Geist
3. El componente `Home` en `app/page.tsx` se monta como `"use client"`
4. En el `useEffect` de mount:
   - Se llama a `fetchRecargasFromSupabase()` → consulta todas las recargas
   - Se llama a `fetchConfigFromSupabase()` → obtiene configuración del vehículo
5. Con los datos, `computeKpisFromRecargas()` calcula KPIs
6. Los datos se filtran por `tipo_combustible` para las vistas de Gasolina / Cargas EV
7. El usuario puede cambiar entre secciones mediante tabs (Gasolina, Cargas EV, Mantenimiento, Historial, Tickets, Reportes)
8. Los formularios agregan datos a `localStorage`
9. Los tickets se almacenan como Base64 en localStorage

## Decisiones importantes

A continuación se clasifican las decisiones de arquitectura en tres categorías: hechos verificados directamente del código, inferencias basadas en evidencia, y decisiones de diseño explícitas.

### Hechos verificados (directamente del código)

| Hecho | Verificación |
|---|---|
| `app/page.tsx` contiene toda la lógica de la aplicación como un solo componente SPA | El archivo tiene ~2100 líneas con `"use client"`, estado, formularios, gráficos y KPIs |
| `next.config.ts` usa `output: "export"`, `basePath: "/BYD-Wallet"`, `assetPrefix: "/BYD-Wallet/"` | Configuración leída directamente del archivo |
| Se usa `normalizeDate()` para parseo manual de fechas | Función implementada en `page.tsx` (líneas 154-212) sin usar `new Date(string)` |
| El filtro de `tipo_combustible` usa `toLowerCase().startsWith("gasolina")` | Código en `page.tsx` línea 1738 |
| Los formularios guardan datos en `localStorage` mediante `saveData()` | Implementado en `page.tsx` (KEYS + loadData/saveData) |
| Las funciones `formatDate`, `formatDateShort`, `formatFechaMX` retornan "Sin fecha" o "Fecha inválida", nunca "Invalid Date" | Código revisado, no hay cadenas "Invalid Date" en la UI |
| La app se despliega a GitHub Pages mediante GitHub Actions | `.github/workflows/deploy.yml` verificado |
| `lib/supabase.ts` implementa un lazy singleton | Verificado en el archivo: `if (client) return client` |

### Inferencias (basadas en evidencia del código, no documentadas explícitamente)

| Inferencia | Evidencia |
|---|---|
| Los datos de Supabase se consideran históricos y de solo lectura | La app nunca escribe en Supabase. Solo consulta `SELECT` en `fetchRecargasFromSupabase()` y `fetchConfigFromSupabase()` |
| Los registros provienen originalmente de Fuelio | Los nombres de columna `rendimiento_fuelio_km_l` y `costo_km_fuelio_mxn` hacen referencia a Fuelio |
| Los valores de `tipo_combustible` incluyen "Gasolina Premium" | Observado durante diagnósticos de la sesión de desarrollo. El filtro case-insensitive se creó específicamente para manejar esta variante |
| La aplicación asume que las fechas en Supabase pueden tener espacios (ej. " 25/08/25") | `normalizeDate()` aplica `.trim()` antes de parsear |

### Decisiones de diseño explícitas

| Decisión | Justificación |
|---|---|
| **SPA de un solo archivo** | MVP rápido, todo en un componente. A futuro se puede dividir en módulos |
| **Static export para GitHub Pages** | GitHub Pages no puede ejecutar Node.js. Se usa `output: "export"` para generar HTML estático |
| **`"use client"` en page.tsx** | Toda la lógica es client-side: Supabase desde browser, localStorage, Recharts |
| **localStorage para datos creados por el usuario** | No requiere backend para escritura. Los datos de Supabase se mantienen como referencia histórica |
| **`normalizeDate()` con parseo manual** | Evita bugs con `new Date(string)` en formatos como `DD/MM/YY` y fechas con espacios/spacios |
| **Filtro flexible de `tipo_combustible`** | Acepta "Gasolina", "Gasolina Premium" y cualquier variante que empiece con "gasolina", además de `null`/`undefined` para compatibilidad histórica |

## Roadmap

Ver `ROADMAP.md` para el plan detallado de desarrollo.
