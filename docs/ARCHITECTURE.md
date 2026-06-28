# BYD Wallet — Arquitectura

> **Versión del documento:** v0.5.1.2

## Arquitectura general

```
                    ┌──────────────────────────────────────┐
                    │           Navegador (cliente)          │
                    │   localhost:3001 / GitHub Pages        │
                    └──────────────┬───────────────────────-─┘
                                   │
                    ┌──────────────▼──────────────────────-─┐
                    │         Next.js 16 (App Router)         │
                    │                                         │
                    │  app/layout.tsx                         │
                    │  ├── Fuentes Geist                      │
                    │  ├── Metadata (lang=es, title)          │
                    │  ├── Tailwind (globals.css)             │
                    │  └── <body>{children}</body>            │
                    │                                         │
                    │  app/page.tsx ("use client")            │
                    │  ├── App version (APP_VERSION)          │
                    │  ├── Home (componente principal)        │
                    │  │   ├── Header (logo, fecha, versión,  │
                    │  │   │         settings, batería)       │
                    │  │   ├── KPI Cards (2 filas)            │
                    │  │   ├── NavTabs (7 secciones)          │
                    │  │   └── Sección activa                 │
                    │  └── Modals (formularios)               │
                    └──────────────┬──────────────────────-─-┘
                                   │
              ┌────────────────────┼──────────────────-─-┐
              ▼                    ▼                    ▼
    ┌─────────────────┐  ┌────────────────┐  ┌────────────────┐
    │    Supabase      │  │  localStorage   │  │   Recharts      │
    │  (PostgreSQL)    │  │   (5 claves)    │  │  (gráficos)     │
    │                  │  │                 │  │                 │
    │  recargas (19)   │  │ byd-gasolina    │  │ AreaChart       │
    │  configuracion   │  │ byd-cargas      │  │ BarChart        │
    │  cargas_elec.    │  │ byd-mantenim.   │  │ LineChart       │
    │  periodos_elec.  │  │ byd-settings    │  │                 │
    │                  │  │ byd-tickets     │  │                 │
    └─────────────────┘  └────────────────┘  └────────────────┘
```

## Módulos oficiales

---

### 1. Dashboard

**Objetivo:** Mostrar indicadores financieros y de rendimiento del vehículo en la pantalla principal. Siempre visible, independientemente de la sección activa.

| Aspecto | Detalle |
|---|---|
| **Estado** | ✅ Terminado |
| **Tablas Supabase** | `recargas`, `configuracion` |
| **Componentes React** | `KpiCard`, `ProgressRing`, `computeKpisFromRecargas()` |
| **Funciones futuras** | Ahorro acumulado real, costo por km por periodo, gráfico de tendencia de KPIs |
| **Dependencias** | Supabase (recargas + config), `normalizeDate()`, helpers de fecha |

**Indicadores actuales:**

- Gasto hoy, semanal, mensual, anual
- Gasto total
- Costo por km
- Rendimiento (km/L)
- Rendimiento EV (km/kWh)
- Número total de recargas

---

### 2. Gasolina

**Objetivo:** Registrar y visualizar todas las cargas de gasolina del vehículo. Incluye historial, rendimiento y estadísticas de consumo.

| Aspecto | Detalle |
|---|---|
| **Estado** | ✅ Terminado |
| **Tablas Supabase** | `recargas` (filtro: `tipo_combustible` startsWith "gasolina") |
| **Almacenamiento local** | `byd-gasolina` |
| **Componentes React** | `GasolinaForm`, vista de listado en sección "gasolina" |
| **Funciones futuras** | Validación de todos los valores de tipo combustible, precios de referencia históricos |
| **Dependencias** | Dashboard (KPIs de gasolina), Reportes (ChartCard, RendimientoHistorico) |

**Campos del formulario:**

- Litros (number, step 0.1)
- Costo en $ (number)
- Kilometraje (number)
- Concepto (text)

---

### 3. Energía

**Objetivo:** Administrar todo lo relacionado con el consumo eléctrico del vehículo: recibos CFE, cargas EV, distribución de consumo entre casa y BYD, y estadísticas energéticas.

| Aspecto | Detalle |
|---|---|
| **Estado** | 🟡 Pendiente (placeholder) |
| **Tablas Supabase** | `periodos_electricos`, `cargas_electricas` (reservada) |
| **Almacenamiento local** | `byd-cargas` (cargas EV del usuario) |
| **Componentes React** | `SeccionEnergia` (placeholder), `CargaForm` |
| **Funciones futuras** | CRUD de recibos CFE, cálculo promedio vs conservador vs marginal, distribución Casa vs BYD, estadísticas por periodo |
| **Dependencias** | Configuración (datos del vehículo), Cargas EV (historial de cargas) |

**Secciones planeadas:**

#### Recibos CFE
- Registro de recibos (kWh, costo total, tarifa)
- Visualización por periodo
- Historial de precios CFE

#### Cargas EV
- Listado de cargas eléctricas (desde Supabase y localStorage)
- Formulario con cálculos automáticos (kWh, $/kWh, km)
- Integración con tabla `cargas_electricas` de Supabase

#### Casa vs BYD
- Distribución del consumo del periodo
- Cálculo de kWh del BYD en el periodo
- Costo Casa estimado
- Comparativa visual (barras de progreso)

#### Métodos de cálculo

| Método | Descripción | Estado |
|---|---|---|
| **Promedio** | Costo BYD = kWh BYD × costo_kWh_promedio del recibo | Pendiente |
| **Conservador** | Costo BYD = kWh BYD × tarifa tope configurable | Pendiente |
| **Marginal** | Costo BYD basado en tarifa DAC o tarifa horaria | Futuro |

#### Estadísticas
- Costo mensual/anual de energía
- Comparativa gasolina vs electricidad
- Ahorro estimado vs gasolina

---

### 4. Mantenimiento

**Objetivo:** Registrar y dar seguimiento a los servicios, refacciones y mantenimientos del vehículo.

| Aspecto | Detalle |
|---|---|
| **Estado** | 🟡 En desarrollo (parcial) |
| **Tablas Supabase** | Ninguna (solo localStorage) |
| **Almacenamiento local** | `byd-mantenimiento` |
| **Componentes React** | `MantenimientoForm`, vista de listado en sección "mantenimiento" |
| **Funciones futuras** | Tabla en Supabase, recordatorios por kilometraje, alertas de servicio programado |
| **Dependencias** | Dashboard (contador de mantenimientos), Historial (fila unificada) |

**Campos del formulario:**

- Servicio (text)
- Kilometraje (number)
- Costo ($)
- Estado (completado / pendiente)

---

### 5. Reportes

**Objetivo:** Proporcionar análisis visuales del gasto y rendimiento del vehículo mediante gráficos interactivos.

| Aspecto | Detalle |
|---|---|
| **Estado** | ✅ Terminado |
| **Tablas Supabase** | Ninguna (usa datos de localStorage) |
| **Almacenamiento local** | `byd-gasolina`, `byd-cargas`, `byd-mantenimiento` |
| **Componentes React** | `ChartCard`, `GastoPorDia`, `GastoPorMes`, `RendimientoHistorico`, `ComparativoGasolinaVsElectricidad` |
| **Funciones futuras** | Exportación PDF/Excel, selector de rango de fechas, gráfico de costo por km histórico, distribución por categoría, tooltips mejorados |
| **Dependencias** | Recharts (AreaChart, BarChart, LineChart), helpers de formato (`formatCurrency`, `formatDecimal`) |

**Gráficos actuales:**

| Gráfico | Tipo | Datos |
|---|---|---|
| Gasto por día | AreaChart | Últimos 7 días |
| Gasto por mes | BarChart | Agrupado por mes |
| Rendimiento histórico | LineChart | km/L por recarga |
| Comparativo gasolina vs electricidad | BarChart agrupado | Gasto mensual por tipo |

---

### 6. IA

**Objetivo:** Procesar automáticamente tickets de gasolina, recibos CFE y otros documentos mediante OCR e inteligencia artificial.

| Aspecto | Detalle |
|---|---|
| **Estado** | 🔴 Pendiente |
| **Tablas Supabase** | Ninguna (planeado: tabla de procesamiento) |
| **Almacenamiento local** | `byd-tickets` (imágenes en Base64) |
| **Componentes React** | `TicketForm`, `TicketsView`, `TicketDetailModal` (captura y visualización) |
| **Funciones futuras** | OCR en imágenes, clasificación automática por categoría, extracción de montos y proveedores, detección de duplicados, confirmación de datos extraídos |
| **Dependencias** | Tickets (captura de imágenes), API de IA externa (futuro) |

**Pipeline planeado:**

```
1. Captura de imagen (TicketForm)
       │
2. OCR → texto extraído
       │
3. Clasificación por categoría (gasolina / carga / mantenimiento / otro)
       │
4. Extracción de datos (monto, proveedor, fecha)
       │
5. Confirmación del usuario
       │
6. Guardado en localStorage / Supabase
```

**Casos de uso:**
- Tickets de gasolina (precio, litros, gasolinera)
- Recibos CFE (kWh, tarifa, periodo, total)
- Facturas de mantenimiento (servicio, costo, proveedor)

---

### 7. Configuración

**Objetivo:** Administrar los datos del vehículo, preferencias del usuario, API keys y opciones generales de la aplicación.

| Aspecto | Detalle |
|---|---|
| **Estado** | ✅ Terminado |
| **Tablas Supabase** | `configuracion` (lectura), ninguna para escritura |
| **Almacenamiento local** | `byd-settings` |
| **Componentes React** | `SettingsForm`, `DEFAULT_SETTINGS`, `MODELO_LABELS`, `CARGADOR_LABELS` |
| **Funciones futuras** | Selector de moneda, exportación/importación de configuración, API keys para servicios externos |
| **Dependencias** | Dashboard (kilometraje total), Cargas EV (capacidad de batería, tipo de cargador), Energía (datos del vehículo) |

**Campos actuales:**

#### Vehículo
- Modelo (king-gl / king-gs / personalizado)
- Capacidad de batería (fija 8.3 kWh para GL, configurable para GS)
- Tipo de cargador (portátil 110V / 220V / wallbox / pública AC/DC / otro)
- Rendimiento eléctrico (km/kWh)
- Kilometraje total del vehículo

#### Acciones
- Borrar todos los datos (limpia gasolina, cargas, mantenimiento, tickets)
- Restablecer configuración (vuelve a DEFAULT_SETTINGS)

---

## Flujo de datos detallado

### Inicio (mount de Home)

```
useEffect[()]
    │
    ├── fetchRecargasFromSupabase()
    │       │
    │       ├── getSupabaseClient()
    │       │       └── createClient(url, anonKey)
    │       │
    │       ├── sb.from("recargas").select("*").order("fecha", false)
    │       │       └── Retorna RecargaRow[]
    │       │
    │       └── Retorna data[] o []
    │
    ├── fetchConfigFromSupabase()
    │       │
    │       ├── sb.from("configuracion").select("*").limit(1)
    │       │       └── Retorna ConfiguracionRow | null
    │       │
    │       └── Retorna config o null
    │
    └── fetchPeriodosElectricosFromSupabase()
            │
            ├── sb.from("periodos_electricos").select("*").order("fecha_inicio", false)
            │
            └── Retorna PeriodoElectricoRow[]
```

### Cálculo de KPIs

```
computeKpisFromRecargas(recargas, config)
    │
    ├── reduce → totalGasolina, totalLitros, numRecargas
    ├── map → odometroActual (max), odometroInicial (min)
    ├── forEach con normalizeDate → gastoHoy, gastoSemanal, gastoMensual, gastoAnual
    └── Retorna objeto KPI
```

### Renderizado de secciones

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
    ├── section === "reportes"
    │       ├── GastoPorDia (AreaChart, últimos 7 días)
    │       ├── GastoPorMes (BarChart, agrupado por mes)
    │       ├── RendimientoHistorico (LineChart, km/L por recarga)
    │       └── ComparativoGasolinaVsElectricidad (BarChart apilado)
    │
    └── section === "energia"
            └── SeccionEnergia (placeholder)
```

## Fuentes de datos por sección

| Sección | Supabase | localStorage |
|---|---|---|
| Dashboard (KPIs) | ✅ `recargas`, `configuracion` | ❌ |
| Gasolina | ✅ `recargas` (filtro gasolina) | ✅ `byd-gasolina` |
| Cargas EV | ✅ `recargas` (filtro EV) | ✅ `byd-cargas` |
| Energía | ✅ `periodos_electricos` (futuro) | ❌ |
| Mantenimiento | ❌ | ✅ `byd-mantenimiento` |
| Historial | ✅ `recargas` (todas) | ✅ `gasolina`, `cargas`, `mantenimiento` |
| Tickets | ❌ | ✅ `byd-tickets` |
| Reportes | ❌ | ✅ `gasolina`, `cargas`, `mantenimiento` |
| Configuración | ✅ `configuracion` (lectura) | ✅ `byd-settings` |

## Dependencias entre módulos

```
                    ┌──────────────┐
                    │  Dashboard    │
                    │    (KPIs)     │
                    └──────┬──────-┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                  ▼
   ┌──────────┐     ┌──────────┐     ┌──────────────┐
   │ Gasolina  │     │ Cargas EV│     │ Mantenimiento │
   └──────────┘     └─────┬────┘     └──────────────┘
                          │
                          ▼
                    ┌──────────┐
                    │  Energía  │
                    └──────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                  ▼
   ┌──────────┐     ┌──────────┐     ┌──────────────┐
   │ Reportes  │     │ Historial │     │    IA / OCR  │
   └──────────┘     └──────────┘     └──────────────┘
                                              │
                                              ▼
                                       ┌──────────────┐
                                       │ Conf. datos   │
                                       └──────────────┘

              ┌──────────────────────────────────────┐
              │           Configuración               │
              │  (vehículo, preferencias, API keys)   │
              └──────────────────────────────────────┘
                        │
                        ▼
                 Todos los módulos
```

## Tipos y constantes compartidas

### VehicleSettings

```typescript
interface VehicleSettings {
  vehiculo: string;
  modelo: "king-gl" | "king-gs" | "personalizado";
  capacidadBateria: number;
  tipoCargador: "portatil110" | "portatil220" | "wallbox" | "publicaAC" | "publicaDC" | "otro";
  rendimientoKmL: number;
  rendimientoKmKwh: number;
  precioGasolina: number;
  totalKm: number;
}
```

### Tipos Supabase (lib/supabase.ts)

```typescript
interface RecargaRow { /* 19 campos — datos de recargas Fuelio */ }
interface ConfiguracionRow { /* 8 campos — configuración del vehículo */ }
interface PeriodoElectricoRow { /* 11 campos — periodos CFE */ }
```

### localStorage keys

```typescript
const KEYS = {
  gasolina: "byd-gasolina",
  cargas: "byd-cargas",
  mantenimiento: "byd-mantenimiento",
  settings: "byd-settings",
  tickets: "byd-tickets",
} as const;
```

### Constante de versión

```typescript
const APP_VERSION = "0.5.1.2";
```

## Archivos del proyecto

```
byd-wallet/
├── app/
│   ├── layout.tsx            # Layout raíz (Next.js App Router)
│   ├── page.tsx              # Componente principal (~2100 líneas SPA)
│   └── globals.css           # Tailwind + paleta BYD
├── lib/
│   └── supabase.ts           # Cliente Supabase singleton + tipos
├── docs/
│   ├── ARCHITECTURE.md       # Este documento
│   ├── CALCULATIONS.md       # Fórmulas y cálculos
│   ├── DATABASE.md           # Esquema de base de datos
│   ├── MODULES.md            # Módulos del proyecto
│   ├── PROJECT_CONTEXT.md    # Contexto y decisiones
│   └── ROADMAP.md            # Plan de desarrollo
├── supabase/
│   └── periodos_electricos.sql  # SQL para tabla periodos_electricos
├── .github/workflows/
│   └── deploy.yml            # GitHub Actions → Pages
├── next.config.ts            # Static export config
├── package.json              # Dependencias
├── tsconfig.json             # TypeScript config
├── eslint.config.mjs         # ESLint config
├── postcss.config.mjs        # PostCSS para Tailwind
└── .env.local                # Credenciales Supabase
```
