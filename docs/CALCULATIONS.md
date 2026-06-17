# BYD Wallet — Cálculos

## Costo por km

**Fórmula**:

```
costoPorKm = totalGasolina / kmRecorridos
```

Donde:
- `totalGasolina` = suma de `costo_total_mxn` de todas las recargas en Supabase
- `kmRecorridos` = `odometroActual - odometroInicial`
- `odometroActual` = máximo valor de `odometro_km` entre todas las recargas (o `config.odometro_actual_km` si no hay recargas)
- `odometroInicial` = mínimo valor de `odometro_km` entre todas las recargas (o 0 si no hay recargas)

**Redondeo**: `Math.round()`

**Archivo**: `app/page.tsx`, función `computeKpisFromRecargas()`

**Variables**:
- `totalGasolina` (línea 318)
- `odometroActual` (línea 322-324)
- `odometroInicial` (línea 326-328)
- `kmRecorridos` (línea 329)
- `costoPorKm` (línea 330)

---

## Rendimiento (km/L)

**Fórmula**:

```
rendimientoKmL = 18.5  (valor fijo por defecto)
```

Actualmente no se calcula dinámicamente de los datos. Siempre retorna `18.5` (el valor de `DEFAULT_SETTINGS.rendimientoKmL`).

**Condición**: Si `precioPromedioLitros > 0`, la fórmula intenta:

```
Math.round((odometroActual > 0 ? 0 : 18.5) * 10) / 10
```

Pero como `odometroActual > 0` cuando hay datos, esto retorna `0`. El código actual tiene un bug: cuando hay recargas, el rendimiento se calcula como `0` en lugar de usar los valores reales.

**Archivo**: `app/page.tsx`, función `computeKpisFromRecargas()`, líneas 370-372

---

## Rendimiento EV (km/kWh)

**Fórmula**:

```
rendimientoKmKwh = 6.2  (valor fijo)
```

Siempre retorna `6.2`, independientemente de la configuración. `config?.bateria_kwh` se evalúa pero no afecta el resultado.

**Archivo**: `app/page.tsx`, función `computeKpisFromRecargas()`, línea 373

---

## Gasto hoy

**Fórmula**:

```
gastoHoy = Σ costo_total_mxn  (para recargas donde fecha = hoy)
```

Para cada recarga:
1. Se obtiene la fecha con `normalizeDate(r.fecha)`
2. Si la fecha es inválida, se salta (`continue`)
3. Si `isSameDay(fecha, now)`, se suma el costo

**Archivo**: `app/page.tsx`, función `computeKpisFromRecargas()`, líneas 342-346

**Variables**:
- `d` = `normalizeDate(r.fecha)` (línea 343)
- `costo` = `Number(r.costo_total_mxn || 0)` (línea 345)
- `gastoHoy` (línea 346, acumulador)

---

## Gasto semanal

**Fórmula**:

```
gastoSemanal = Σ costo_total_mxn  (para recargas donde fecha está en la semana actual)
```

La semana se define de domingo a sábado (`ref.getDate() - ref.getDay()`).

**Archivo**: `app/page.tsx`, función `computeKpisFromRecargas()`, línea 347

**Función auxiliar**: `isThisWeek(d, ref)` (líneas 249-256)

Lógica:
```
inicioSemana = domingo 00:00:00.000 de la semana actual
finSemana = inicioSemana + 7 días
retorna d >= inicioSemana && d < finSemana
```

---

## Gasto mensual

**Fórmula**:

```
gastoMensual = Σ costo_total_mxn  (para recargas del mismo mes y año que hoy)
```

**Archivo**: `app/page.tsx`, función `computeKpisFromRecargas()`, línea 348

**Función auxiliar**: `isThisMonth(d, ref)` (líneas 258-259)

```
retorna d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth()
```

---

## Gasto anual

**Fórmula**:

```
gastoAnual = Σ costo_total_mxn  (para recargas del mismo año que hoy)
```

**Archivo**: `app/page.tsx`, función `computeKpisFromRecargas()`, línea 349

**Función auxiliar**: `isThisYear(d, ref)` (líneas 262-263)

```
retorna d.getFullYear() === ref.getFullYear()
```

---

## Promedio precio por litro

**Fórmula**:

```
precioPromedioLitros = Σ precio_litro_mxn / numRecargas
```

**Archivo**: `app/page.tsx`, función `computeKpisFromRecargas()`, líneas 332-334

---

## kWh cargados (formulario Carga EV)

**Fórmula**:

```
pctCargado = max(0, pctFin - pctIni)
kwhCargados = ((pctCargado / 100) * capacidadBateria)  (redondeado a 1 decimal)
```

**Archivo**: `app/page.tsx`, componente `CargaForm`, líneas 615-616

---

## Costo por kWh (formulario Carga EV)

**Fórmula**:

```
costoPorKwh = kwhCargados > 0 ? round(costo / kwhCargados) : 0
```

**Archivo**: `app/page.tsx`, componente `CargaForm`, línea 618

---

## km EV obtenidos (formulario Carga EV)

**Fórmula**:

```
kmEvObtenidos = kwhCargados > 0 ? round(kwhCargados * settings.rendimientoKmKwh) : 0
```

**Archivo**: `app/page.tsx`, componente `CargaForm`, línea 619

---

## Historial: km/L por recarga (gráfico RendimientoHistórico)

**Fórmula**:

```
kmL = (kilometraje / litros) × 0.1  (redondeado a 1 decimal)
```

Se aplica solo a registros donde `litros > 0`, `kilometraje > 0` y `costo > 0`.

**Archivo**: `app/page.tsx`, componente `RendimientoHistorico`, línea 1596

---

## Settings: kWh auto en periodo

**Fórmula**:

```
kwhAutoReal = Σ kwhCargados  (de cargas donde fecha está entre fechaInicioPeriodo y fechaFinPeriodo)
kwhAutoRealRounded = round(kwhAutoReal × 10) / 10
```

**Archivo**: `app/page.tsx`, componente `SettingsForm`, líneas 898-902

---

## Settings: consumo estimado

**Fórmula**:

```
consumoTotalEstimado = base + kwhAutoRealRounded
costoAutoEstimado = round(kwhAutoRealRounded × kwhManual)
kwhTotalRecibo = kwhManual > 0 ? round(consumoTotalRecibo / kwhManual) : 0
kwhAutoEstimado = max(0, kwhTotalRecibo - base)
```

**Archivo**: `app/page.tsx`, componente `SettingsForm`, líneas 904-909

---

## Ahorro acumulado

**Estado**: 🔴 Pendiente de implementación

Actualmente retorna `0` (hardcodeado). No hay lógica implementada.

**Archivo**: `app/page.tsx`, función `computeKpisFromRecargas()`, línea 374

---

## Resumen de variables clave

| Variable | Fórmula | Archivo: Línea |
|---|---|---|
| `totalGasolina` | `reduce(Number(costo_total_mxn))` | page.tsx:318 |
| `totalLitros` | `reduce(Number(litros))` | page.tsx:319 |
| `numRecargas` | `recargas.length` | page.tsx:320 |
| `odometroActual` | `max(odometro_km)` | page.tsx:322-324 |
| `odometroInicial` | `min(odometro_km)` | page.tsx:326-328 |
| `kmRecorridos` | `odometroActual - odometroInicial` | page.tsx:329 |
| `costoPorKm` | `totalGasolina / kmRecorridos` | page.tsx:330 |
| `precioPromedioLitros` | `promedio(precio_litro_mxn)` | page.tsx:332-334 |
| `gastoHoy` | suma condicional por fecha | page.tsx:346 |
| `gastoSemanal` | suma condicional por semana | page.tsx:347 |
| `gastoMensual` | suma condicional por mes | page.tsx:348 |
| `gastoAnual` | suma condicional por año | page.tsx:349 |
| `rendimientoKmL` | fijo 18.5 (bug: 0 si hay datos) | page.tsx:370-372 |
| `rendimientoKmKwh` | fijo 6.2 | page.tsx:373 |
| `ahorroAcumulado` | fijo 0 (no implementado) | page.tsx:374 |
