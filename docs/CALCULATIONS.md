# BYD Wallet — Fórmulas oficiales de cálculo (v0.6.4)

Motor centralizado en `lib/calculations.ts`.  
Dashboard, Reportes y módulos **deben** usar estas funciones; no duplicar fórmulas en componentes.

---

## Fuentes de datos

| Categoría | Origen |
|---|---|
| Gasolina | Supabase `recargas` (tipo gasolina) |
| Electricidad BYD | Centro de Energía (`periodos_electricos`) **o** Cargas EV (`cargas_electricas`) |
| Mantenimiento | Supabase `maintenance_records` + local |
| Otros costos | Supabase `maintenance_extra_costs` + local |
| Kilómetros | Odómetro actual − odómetro mínimo en recargas de gasolina |

---

## Gasto eléctrico BYD — regla de fuente única

**Caso A — Centro de Energía configurado**  
Existe al menos un recibo CFE con `costo_kwh_mxn > 0` y `kwh_bimestre > 0`.

```
Gasto eléctrico BYD = Σ (kWh BYD del periodo × tarifa CFE del periodo)
```

- kWh BYD = `kwh_byd_periodo` manual **o** suma de cargas EV dentro del rango del recibo.
- Las Cargas EV son **eventos**; no se suma `costo_total` de cargas para evitar duplicar el gasto CFE.

**Caso B — Sin Centro de Energía válido**

```
Gasto eléctrico BYD = Σ cargas_electricas.costo_total
```

Función: `calculateElectricCost()`

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
Incluye apoyo del sistema híbrido.  
Función: `calculateGlobalEfficiency()`

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
- Chip **Gasto eléctrico** → `calculateElectricCost()`
- Panel **Electricidad BYD** → acumulado, mensual y anual vía funciones eléctricas oficiales
- **Eficiencia y Costos** → `calculateEfficiencyAndCosts()`
- **Reportes** (gráficas) → `buildMonthlyExpenseBreakdown12()` / `buildDailyExpenseLast7Days()`
