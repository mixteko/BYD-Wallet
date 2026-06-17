# BYD Wallet — Roadmap

> **Nota importante:** Este documento representa la visión y planificación futura del proyecto. No describe funcionalidades implementadas. Las fases posteriores al estado actual son propuestas de desarrollo y podrán modificarse conforme evolucione el proyecto.

## Fase 1: Arquitectura ✅

- [x] Configurar Next.js 16 con App Router
- [x] Conectar Supabase (recargas + configuracion)
- [x] Configurar Tailwind CSS v4 con paleta BYD
- [x] Configurar static export para GitHub Pages
- [x] Mover archivos legacy a `legacy-github-pages/`
- [x] Documentar el proyecto (carpeta `docs/`)

---

## Fase 2: KPIs

- [x] Calcular gasto hoy, semanal, mensual, anual
- [x] Calcular costo por km
- [x] Calcular rendimiento km/L
- [x] Calcular rendimiento km/kWh
- [x] Mostrar KPIs en tarjetas (KpiCard)
- [ ] **Corregir** bug en `rendimientoKmL`: actualmente retorna 0 cuando hay datos en lugar de calcular el valor real
- [ ] **Implementar** ahorro acumulado (actualmente hardcodeado en 0)

---

## Fase 3: Gasolina

- [x] Mostrar listado de recargas de gasolina (desde Supabase)
- [x] Mostrar listado de cargas de gasolina (desde localStorage)
- [x] Formulario para agregar carga de gasolina
- [ ] Validar que el filtro `tipo_combustible` funcione con todos los valores posibles (Gasolina, Gasolina Premium, Gasolina Regular, etc.)

---

## Fase 4: Cargas EV

- [x] Mostrar listado de cargas EV (desde Supabase y localStorage)
- [x] Formulario para agregar carga EV con cálculos automáticos (kWh, $/kWh, km)
- [ ] Integrar datos desde la tabla `cargas_electricas` de Supabase (actualmente 0 registros)
- [ ] Agregar tipos de carga adicionales si es necesario

---

## Fase 5: Mantenimiento

- [x] Mostrar listado de mantenimiento (localStorage)
- [x] Formulario para agregar mantenimiento
- [ ] Agregar tabla de mantenimiento en Supabase para persistencia
- [ ] Agregar notificaciones/alertas por km para servicios programados

---

## Fase 6: Historial

- [x] Tabla unificada con datos de Supabase + localStorage
- [x] Filtros por período (Hoy, Semana, Mes, Año)
- [x] Vista desktop (tabla) y mobile (tarjetas)
- [ ] Agregar ordenamiento por columna (fecha, importe, tipo)
- [ ] Agregar búsqueda por texto
- [ ] Agregar exportación a CSV

---

## Fase 7: Reportes

- [x] Gasto por día (AreaChart, últimos 7 días)
- [x] Gasto por mes (BarChart)
- [x] Rendimiento histórico (LineChart, km/L)
- [x] Comparativo gasolina vs electricidad (BarChart)
- [ ] Agregar selector de rango de fechas personalizado
- [ ] Agregar gráfico de costo por km histórico
- [ ] Agregar gráfico de distribución de gastos por categoría
- [ ] Agregar tooltips más informativos

---

## Fase 8: Configuración

- [x] Formulario de configuración del vehículo
- [x] Cálculos automáticos de electricidad (CFE)
- [x] Botones de reset (borrar datos, restablecer configuración)
- [ ] Validar que `fechaInicioPeriodo` y `fechaFinPeriodo` tengan sentido (inicio < fin)
- [ ] Agregar selector de moneda (MXN, USD, CLP)
- [ ] Agregar exportación/importación de configuración

---

## Fase 9: IA para Tickets

- [ ] Integrar OCR para extraer texto de imágenes de tickets
- [ ] Clasificación automática de tickets por categoría (gasolina, carga, mantenimiento, otro)
- [ ] Extracción automática de montos, proveedores y fechas
- [ ] Sugerencia de precios de referencia (gasolina, kWh)
- [ ] Detección de duplicados

---

## Fase 10: Integración OBD2

- [ ] Investigar protocolo OBD2 para BYD King DM-i
- [ ] Conectar escáner OBD2 Bluetooth
- [ ] Leer datos en tiempo real: velocidad, RPM, nivel de batería, consumo
- [ ] Registrar viajes automáticamente
- [ ] Calcular rendimiento real vs estimado
- [ ] Detectar códigos de error (DTC)
- [ ] Mostrar dashboard de conducción en tiempo real

---

## Prioridades post-MVP

| Prioridad | Tarea | Dependencia |
|---|---|---|
| 🔴 Alta | Corregir bug rendimientoKmL (retorna 0) | Fase 2 |
| 🔴 Alta | Implementar ahorro acumulado real | Fase 2 |
| 🟡 Media | Exportación CSV del historial | Fase 6 |
| 🟡 Media | Selector de rango de fechas en reportes | Fase 7 |
| 🟡 Media | Validación de fechas en configuración | Fase 8 |
| 🟢 Baja | OCR en tickets | Fase 9 |
| 🟢 Baja | Integración OBD2 | Fase 10 |
