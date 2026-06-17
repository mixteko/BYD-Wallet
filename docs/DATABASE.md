# BYD Wallet — Base de Datos (Supabase)

## Conexión

- **URL**: `https://szutmyfujgbfruurgjcl.supabase.co`
- **Cliente**: `lib/supabase.ts` → `getSupabaseClient()`
- **Variables de entorno**: `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` desde `.env.local`
- **Singleton**: El cliente se crea una sola vez (lazy) y se reusa

---

## Tabla: `recargas` (19 registros)

Registros históricos de carga de combustible (gasolina) importados desde Fuelio.

### Columnas

| Columna | Tipo SQL | Nulable | Tipo TS | Descripción |
|---|---|---|---|---|
| `id` | `bigint` | NO | `number` | Clave primaria |
| `fecha` | `text` | YES | `string` | Fecha en formato DD/MM/YY (ej. " 25/08/25", "07/09/25" — ejemplos observados durante el desarrollo. Verificar si cambia la estructura de Supabase). |
| `fecha_hora` | `text` | YES | `string \| null` | Fecha con hora (ej. "07/09/25 20:09" — ejemplo observado durante el desarrollo). `null` en algunos registros |
| `odometro_km` | `integer` | YES | `number` | Kilometraje del vehículo al momento de la carga |
| `distancia_km` | `integer` | YES | `number \| null` | Distancia recorrida (no usado actualmente) |
| `tipo_combustible` | `text` | YES | `string \| null` | Tipo: "Gasolina Premium" (valor observado durante el desarrollo. Verificar si cambia la estructura de Supabase). |
| `litros` | `numeric` | YES | `number` | Litros cargados (llega como string desde Supabase) |
| `precio_litro_mxn` | `numeric` | YES | `number` | Precio por litro en MXN |
| `costo_total_mxn` | `numeric` | YES | `number` | Costo total de la recarga en MXN |
| `completar_tanque` | `text` | YES | `boolean \| null` | Indica si se llenó el tanque |
| `tanque_pct` | `integer` | YES | `number \| null` | Porcentaje del tanque |
| `rendimiento_fuelio_km_l` | `numeric` | YES | `number \| null` | Rendimiento calculado por Fuelio |
| `costo_km_fuelio_mxn` | `numeric` | YES | `number \| null` | Costo por km calculado por Fuelio |
| `gasolinera` | `text` | YES | `string \| null` | Nombre de la gasolinera |
| `notas` | `text` | YES | `string \| null` | Notas adicionales |
| `created_at` | `timestamp without time zone` | YES | `string \| null` | Fecha de creación del registro |

### Uso en el código

```typescript
// app/page.tsx — fetch
const { data, error } = await sb.from("recargas").select("*").order("fecha", { ascending: false });

// lib/supabase.ts — tipo TypeScript
export interface RecargaRow { ... }

// app/page.tsx — mapeo a gasolinaList
recargas.filter((r) => !r.tipo_combustible || r.tipo_combustible.toLowerCase().startsWith("gasolina"))

// app/page.tsx — mapeo a cargasList (si tipo_combustible = "Electricidad")
recargas.filter((r) => r.tipo_combustible === "Electricidad" || r.tipo_combustible === "EV")

// app/page.tsx — KPIs
computeKpisFromRecargas(recargas, config)

// app/page.tsx — HistoryTable
<HistoryTable recargas={recargas} />
```

---

## Tabla: `configuracion` (1 registro)

Configuración general del vehículo.

### Columnas

| Columna | Tipo SQL | Nulable | Tipo TS | Descripción |
|---|---|---|---|---|
| `id` | `bigint` | NO | `number` | Clave primaria |
| `vehiculo` | `text` | YES | `string` | Nombre del vehículo (ej. "BYD King DM-i") |
| `modelo` | `text` | YES | `number \| string` | Modelo del vehículo |
| `bateria_kwh` | `numeric` | YES | `number` | Capacidad de la batería en kWh |
| `tanque_litros` | `numeric` | YES | `number` | Capacidad del tanque en litros |
| `tarifa_cfe_mxn_kwh` | `numeric` | YES | `number` | Tarifa CFE por kWh en MXN |
| `odometro_inicial_km` | `integer` | YES | `number` | Odómetro inicial de referencia |
| `odometro_actual_km` | `integer` | YES | `number` | Odómetro actual |
| `created_at` | `timestamp without time zone` | YES | `string \| null` | Fecha de creación |

### Uso en el código

```typescript
// app/page.tsx — fetch
const { data } = await sb.from("configuracion").select("*").limit(1);

// lib/supabase.ts — tipo TypeScript
export interface ConfiguracionRow { ... }

// app/page.tsx — KPIs
computeKpisFromRecargas(recargas, config)
```

---

## Tabla: `cargas_electricas` (0 registros)

Tabla reservada para futuras cargas eléctricas desde Supabase. Actualmente sin datos.

### Columnas

| Columna | Tipo SQL | Nulable |
|---|---|---|
| `id` | `bigint` | NO |
| `fecha` | `text` | YES |
| `odometro_km` | `integer` | YES |
| `porcentaje_inicio` | `integer` | YES |
| `porcentaje_fin` | `integer` | YES |
| `kwh_estimados` | `numeric` | YES |
| `tarifa_kwh_mxn` | `numeric` | YES |
| `costo_total_mxn` | `numeric` | YES |
| `tipo_carga` | `text` | YES |
| `notas` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |

### Nota

Actualmente no se usa en el código. Las cargas eléctricas se almacenan en `localStorage` bajo la clave `byd-cargas`.

---

## Resumen de relaciones

- `recargas` → no tiene FK. Es un dataset independiente.
- `configuracion` → tabla singleton (1 fila). No tiene FK.
- `cargas_electricas` → tabla reservada, sin datos ni relaciones.
- `localStorage` → no es una tabla Supabase. Almacena datos creados por el usuario (gasolina, cargas EV, mantenimiento, tickets, settings). No hay relación entre Supabase y localStorage.
