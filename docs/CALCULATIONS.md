# BYD Wallet — Fórmulas oficiales de cálculo (v0.6.5)

Motor centralizado en `lib/calculations.ts`.  
Dashboard, Reportes y módulos **deben** usar estas funciones; no duplicar fórmulas en componentes.

---

## Fuentes de datos

| Categoría | Origen |
|---|---|
| Gasolina | Supabase `recargas` (tipo gasolina) |
| Electricidad BYD | Centro de Energía (`periodos_electricos`) **+** Cargas EV externas (`cargas_electricas`, tipo ≠ Casa) |
| Mantenimiento | Supabase `maintenance_records` + local |
| Otros costos | Supabase `maintenance_extra_costs` + local |
| Kilómetros | Odómetro actual − odómetro mínimo en recargas de gasolina |

---

## Gasto eléctrico BYD — regla oficial (v0.6.4)

La electricidad del BYD se compone de **dos fuentes complementarias** que siempre se suman:

```
Electricidad BYD total =
  Gasto eléctrico BYD en casa (Centro de Energía / CFE)
  +
  Recargas EV externas pagadas fuera de casa
```

### Centro de Energía (carga en casa)

```
Gasto casa = Σ (kWh BYD del periodo × tarifa CFE del periodo)
```

- Origen: recibos CFE en `periodos_electricos`.
- kWh BYD = `kwh_byd_periodo` manual **o** suma de cargas tipo **Casa** dentro del rango del recibo (solo kWh, sin costo).
- Cubre la carga doméstica calculada desde la factura de luz.

### Cargas EV externas

```
Gasto externo = Σ cargas_electricas.costo_total_mxn  (tipo_carga ≠ "Casa")
```

- Origen: `cargas_electricas` — electrolineras, supermercados, cargadores públicos, trabajo, etc.
- **No duplica** Centro de Energía: son pagos fuera de casa.
- Cargas tipo **Casa** se registran como evento pero **no suman** al gasto (evita doble conteo con CFE).

Función principal: `calculateElectricCost()` → `{ total, casa, externo, source }`

---

## Fórmulas por indicador

### Gasto gasolina
```
Σ costo de todas las recargas de gasolina
```
Función: `calculateFuelCost()`

### Gasto eléctrico BYD (acumulado)
Ver regla de fuente única arriba.  
Función: `calculateElectricCost().total`

### Gasto mantenimiento
```
Σ costo_real de maintenance_records (o equivalente local)
```
Función: `calculateMaintenanceCost()`

### Otros costos
```
Σ cost de maintenance_extra_costs (o equivalente local)
```
Función: `calculateOtherCosts()`

### Total invertido
```
Gasolina + Electricidad BYD + Mantenimiento + Otros costos
```
Función: `calculateTotalVehicleCost()`

Nuevas categorías futuras deben sumarse en esta función.

### Gasto anual total
```
Σ gasolina del año en curso
+ gasto eléctrico BYD del año en curso
+ Σ mantenimiento del año en curso
+ Σ otros costos del año en curso
```
Función: `calculateAnnualTotalCost()`

### Gasto eléctrico anual
```
Caso A: Σ costo BYD de recibos CFE con fecha_fin en el año
Caso B: Σ costo_total de cargas EV con fecha en el año
```
Función: `calculateElectricCostAnnual()`

### Gasto eléctrico mensual
```
Caso A: Σ costo BYD de recibos con fecha_fin en el mes (YYYY-MM)
Caso B: Σ costo_total de cargas EV con fecha en el mes
```
Función: `calculateElectricCostMonthly()`

### Costo por km
```
Total invertido ÷ Kilómetros recorridos
```
Función: `calculateCostPerKm()`

Tooltip: *"Costo promedio real considerando todos los gastos registrados del vehículo."*

### Costo por 100 km
```
Costo por km × 100
```
Función: `calculateCostPer100Km()`

### Eficiencia global
```
Kilómetros recorridos ÷ Litros totales de gasolina
```
Incluye apoyo del sistema híbrido. Visible en **Reportes** (panel Eficiencia y Costos).  
Función: `calculateGlobalEfficiency()`

### Índice de Eficiencia Híbrida (IEH)
Calificación **0–100** que resume el aprovechamiento del sistema híbrido usando **solo métricas reales** del vehículo. **No convierte litros a kWh ni usa equivalencias energéticas.**

Variables de entrada:
| Variable | Origen |
|---|---|
| Km/L gasolina | `calculateFuelKmPerLiter()` |
| Km/kWh eléctrico | `calculateEvKmPerKwh()` — km EV ÷ kWh cargados |
| % km en modo EV | `calculatePctKmEv()` — Σ km EV ÷ km recorridos |
| Costo por km (energía) | `calculateEfficiencyAndCosts().costoPromedioPorKm` |
| Costo por 100 km | `calculateCostPer100Km()` |

Sub-puntajes (0–100), normalizados contra el **historial del propio usuario** (sin constantes fijas):
- **Rendimiento gasolina:** km/L actual vs historial km/L por recarga (`buildFuelEfficiencyHistory`)
- **Rendimiento eléctrico:** km/kWh actual vs historial por carga (`buildEvEfficiencyHistory`)
- **Uso EV:** % km en modo EV (0–100 directo)
- **Costo energético:** costo/km actual vs historial de costo/km por tramo de gasolina (menor = mejor)

Fórmula compuesta:
```
Con datos EV:
  IEH = 25% rendimiento gasolina + 25% rendimiento eléctrico + 20% uso EV + 30% costo energético

Sin datos EV suficientes:
  IEH = 40% rendimiento gasolina + 60% costo energético
```

Interpretación:
| Rango | Etiqueta |
|---|---|
| 95–100 | Excelente |
| 85–94 | Muy eficiente |
| 70–84 | Eficiencia buena |
| 50–69 | Puede mejorar |
| &lt;50 | Uso poco eficiente |

Funciones: `calculateIndiceEficienciaHibrida()`, `interpretIndiceEficienciaHibrida()`  
Visible en **Dashboard** (sustituye Eficiencia global en el panel Eficiencia y Costos).

Tooltip: *"Este índice resume el rendimiento del vehículo considerando el uso de gasolina, electricidad y el costo por kilómetro. Un valor más alto indica un mejor aprovechamiento del sistema híbrido."*

### Km/L gasolina (entre recargas)
```
Σ km entre recargas consecutivas ÷ Σ litros de esas recargas
```
Función: `calculateFuelKmPerLiter()`

### Tarifa promedio kWh
```
Si hay kWh y gasto: Gasto eléctrico BYD ÷ kWh BYD total
Si no: tarifa del recibo CFE vigente
```
Mostrar con **2 decimales** (`$1.31/kWh`).  
Función: `calculateAverageKwhRate()`

---

## Series temporales (Dashboard / Reportes)

| Gráfica | Función |
|---|---|
| Evolución 12 meses / comparativo | `buildMonthlyExpenseBreakdown12()` |
| Gasto por día (7 días) | `buildDailyExpenseLast7Days()` |
| Eficiencia y Costos (panel) | `calculateEfficiencyAndCosts()` |
| Rendimiento histórico (Reportes) | `buildFuelEfficiencyHistory()` + `buildEvEfficiencyHistory()` — solo Km/L Gasolina y Km/kWh Eléctrico |
| IEH (Dashboard) | `calculateIndiceEficienciaHibrida()` |

---

## Formato de presentación

| Tipo | Formato |
|---|---|
| Montos monetarios | `$X,XXX.XX` (`formatCurrency`) |
| Costo por km | `$X.XX/km` (`formatCostoPorKm`) |
| Tarifa kWh | `$X.XX/kWh` (`formatTarifaKwh`) |
| Rendimiento / eficiencia | 2 decimales |
| Porcentajes | 1 decimal máximo |

---

## Validación de consistencia

Los siguientes módulos leen el mismo motor:

- Chip **Gasto anual** → `calculateAnnualTotalCost()`
- Chip **Costo por km** → `calculateCostPerKm(calculateTotalVehicleCost(), calculateKmTraveled())`
- Chip **Gasto eléctrico** → `calculateElectricCost()` (casa + externas)
- Panel **Electricidad BYD** → acumulado, mensual y anual vía funciones eléctricas oficiales
- **Eficiencia y Costos** → `calculateEfficiencyAndCosts()`
- **Reportes** (gráficas) → `buildMonthlyExpenseBreakdown12()` / `buildDailyExpenseLast7Days()`
