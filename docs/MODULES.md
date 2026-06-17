# BYD Wallet — Módulos

> **Nota sobre estados:** El estado (✅ 🟡 🔴) representa una evaluación funcional del proyecto y puede cambiar conforme avance el desarrollo.

## Dashboard (KPIs)

**Estado**: ✅ Terminado

Muestra dos filas de indicadores financieros y de rendimiento en la parte superior de la pantalla principal. Siempre visible, independientemente de la sección activa.

### Archivos involucrados
- `app/page.tsx` — componente `KpiCard`, función `computeKpisFromRecargas()`, renderizado en `Home`

### KPIs mostrados
- Gasto hoy
- Gasto semanal
- Gasto mensual
- Gasto anual
- Costo por km
- Rendimiento (km/L)
- Rendimiento EV (km/kWh)
- Total recargas

### Dependencias
- Supabase: `recargas` + `configuracion`
- `normalizeDate()` para filtrar por fechas

---

## Gasolina

**Estado**: ✅ Terminado

Muestra el historial de cargas de gasolina provenientes de Supabase (recargas con `tipo_combustible` que empiece con "gasolina") y de localStorage.

### Archivos involucrados
- `app/page.tsx`:
  - `GasolinaForm` — formulario modal para agregar carga
  - `gasolinaList` — `useMemo` que filtra y mapea recargas
  - Vista de listado en `Home` (sección "gasolina")

### Fuente de datos
- Supabase: `recargas` filtradas por `tipo_combustible` (startsWith "gasolina")
- localStorage: clave `byd-gasolina`

### Campos del formulario
- Litros (number, step 0.1)
- Costo en $ (number)
- Kilometraje (number)
- Concepto (text)

---

## Cargas EV

**Estado**: 🟡 En desarrollo (parcial)

Muestra el historial de cargas eléctricas. Puede obtener datos desde Supabase (si `tipo_combustible` = "Electricidad") o desde localStorage.

### Archivos involucrados
- `app/page.tsx`:
  - `CargaForm` — formulario modal para agregar carga
  - `cargasList` — `useMemo` que filtra recargas EV de Supabase
  - Vista de listado en `Home` (sección "cargas")

### Fuente de datos
- Supabase: `recargas` filtradas por `tipo_combustible === "Electricidad"` o `"EV"`
- localStorage: clave `byd-cargas`
- Tabla `cargas_electricas` en Supabase (0 registros, reservada)

### Campos del formulario
- Fecha (date)
- Tipo de carga (CCS2, AC 7kW, AC 22kW)
- Batería % inicial
- Batería % final
- Costo total ($)

### Cálculos automáticos en el formulario
- kWh cargados = ((%final - %inicial) / 100) × capacidadBatería
- Costo por kWh = costoTotal / kWhCargados
- km EV obtenidos = kWhCargados × rendimientoKmKwh

---

## Mantenimiento

**Estado**: 🟡 En desarrollo (parcial)

Registros de mantenimiento del vehículo. Solo localStorage (sin datos en Supabase).

### Archivos involucrados
- `app/page.tsx`:
  - `MantenimientoForm` — formulario modal
  - `mantenimientoList` — `loadData` desde localStorage + sort por fecha
  - Vista de listado en `Home` (sección "mantenimiento")

### Fuente de datos
- localStorage: clave `byd-mantenimiento`

### Campos del formulario
- Servicio (text)
- Kilometraje (number)
- Costo ($)
- Estado (completado / pendiente)

---

## Historial

**Estado**: ✅ Terminado

Tabla unificada que combina recargas de Supabase + datos de localStorage (gasolina, cargas EV, mantenimiento). Incluye filtros por período (Hoy, Semana, Mes, Año).

### Archivos involucrados
- `app/page.tsx`:
  - `HistoryTable` — componente principal
  - `HistoryFilterButton` — botones de filtro
  - Vista desktop (tabla HTML) y mobile (tarjetas)

### Fuente de datos
- Supabase: `recargas` (todas, sin filtrar por tipo)
- localStorage: `byd-gasolina`, `byd-cargas`, `byd-mantenimiento`

### Lógica de unificación
1. Recargas de Supabase → tipo "Gasolina"
2. Gasolina de localStorage → tipo "Gasolina"
3. Cargas EV de localStorage → tipo "Carga EV"
4. Mantenimiento de localStorage → tipo "Mantenimiento"

### Filtros
- Hoy (`isSameDay`)
- Semana (`isThisWeek`: domingo a sábado)
- Mes (`isThisMonth`)
- Año (`isThisYear`)

### Orden
- Por `odometro_km` descendente (mayor kilometraje primero)

---

## Tickets

**Estado**: 🟡 En desarrollo (parcial)

Sistema de tickets con captura de imagen (Base64) y OCR pendiente.

### Archivos involucrados
- `app/page.tsx`:
  - `TicketForm` — formulario con carga de imagen
  - `TicketsView` — grid de tickets
  - `TicketDetailModal` — modal de detalle con imagen y metadatos

### Fuente de datos
- localStorage: clave `byd-tickets`

### Campos del formulario
- Título (text)
- Categoría (gasolina / carga / mantenimiento / otro)
- Proveedor (text)
- Monto ($)
- Imagen (file → Base64, máx 5 MB)

### Características
- Preview de imagen antes de guardar
- Eliminación individual
- Orden por fecha descendente

### Pendiente
- OCR de texto en imágenes
- Integración con IA para clasificación automática

---

## Reportes

**Estado**: ✅ Terminado

Cuatro gráficos interactivos usando Recharts.

### Archivos involucrados
- `app/page.tsx`:
  - `ChartCard` — wrapper con título
  - `GastoPorDia` — AreaChart (últimos 7 días)
  - `GastoPorMes` — BarChart (agrupado por mes)
  - `RendimientoHistorico` — LineChart (km/L por recarga)
  - `ComparativoGasolinaVsElectricidad` — BarChart agrupado

### Gráficos

#### GastoPorDia
- Tipo: AreaChart
- Datos: últimos 7 días
- Fuente: localStorage (gasolina + cargas + mantenimiento)
- Eje X: días de la semana (es-CL)

#### GastoPorMes
- Tipo: BarChart
- Datos: agrupado por mes (YYYY-MM)
- Fuente: localStorage (gasolina + cargas + mantenimiento)
- Eje X: nombres de mes abreviados

#### RendimientoHistorico
- Tipo: LineChart con 2 líneas
- Línea 1: km/L (gasolina) — calculado como kilometraje / litros × 0.1
- Línea 2: km/kWh (eléctrico) — valor fijo desde configuración
- Fuente: localStorage (gasolina) + settings

#### ComparativoGasolinaVsElectricidad
- Tipo: BarChart con 2 barras por mes
- Barra 1: gasto en gasolina
- Barra 2: gasto en electricidad
- Fuente: localStorage (gasolina + cargas)

### Dependencias
- Recharts: AreaChart, BarChart, LineChart, ResponsiveContainer, Tooltip, Legend

---

## Configuración

**Estado**: ✅ Terminado

Formulario de configuración del vehículo y parámetros financieros.

### Archivos involucrados
- `app/page.tsx`:
  - `SettingsForm` — formulario completo
  - `DEFAULT_SETTINGS` — valores por defecto
  - `MODELO_LABELS`, `PERIODO_LABELS`, `CARGADOR_LABELS`

### Fuente de datos
- localStorage: clave `byd-settings`
- Valores por defecto definidos en `DEFAULT_SETTINGS`

### Campos

#### Vehículo
- Modelo (king-gl / king-gs / personalizado)
- Capacidad de batería (fija 8.3 kWh para GL, configurable para GS)
- Tipo de cargador (portátil 110V / 220V / wallbox / pública AC/DC / otro)

#### Electricidad CFE
- Periodo de pago (bimestral / mensual)
- Fecha inicio/fin del periodo
- Consumo base del hogar (kWh por periodo)
- Costo por kWh ($)
- Total del recibo ($)

#### Rendimiento
- Rendimiento eléctrico (km/kWh)
- Kilometraje total del vehículo

### Cálculos automáticos
- kWh cargados al auto en el periodo actual (desde localStorage byd-cargas)
- Consumo total estimado = base hogar + kWh auto
- Costo estimado del auto = kWh auto × costo_kWh
- kWh estimado según recibo = max(0, total_recibo / costo_kWh - base_hogar)

### Acciones adicionales
- Borrar todos los datos (limpia gasolina, cargas, mantenimiento, tickets)
- Restablecer configuración (vuelve a DEFAULT_SETTINGS)
