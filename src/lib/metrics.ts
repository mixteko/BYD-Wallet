import type {
  ChargeEntry,
  FuelEntry,
  HistoryItem,
  MaintenanceEntry,
  MetricSnapshot,
  PerformancePoint,
  TrendPoint,
  Vehicle,
} from '../types'

const DAY_MS = 24 * 60 * 60 * 1000

const toDate = (value: string) => new Date(`${value}T00:00:00`)

const sortByDate = <T extends { date: string }>(entries: T[]) =>
  [...entries].sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime())

const round = (value: number) => Math.round(value * 100) / 100

const sumCost = (entries: Array<{ cost: number }>) =>
  entries.reduce((accumulator, entry) => accumulator + entry.cost, 0)

const calculateDistanceFromEntries = <
  T extends {
    date: string
    odometer: number
  },
>(
  entries: T[],
) => {
  const ordered = sortByDate(entries)
  return ordered.slice(1).reduce((distance, entry, index) => {
    const previous = ordered[index]
    const delta = entry.odometer - previous.odometer
    return delta > 0 ? distance + delta : distance
  }, 0)
}

const getOverallDistance = (
  fuelEntries: FuelEntry[],
  chargeEntries: ChargeEntry[],
  maintenanceEntries: MaintenanceEntry[],
) => {
  const odometerValues = [...fuelEntries, ...chargeEntries, ...maintenanceEntries]
    .map((entry) => entry.odometer)
    .sort((left, right) => left - right)

  if (odometerValues.length < 2) {
    return 0
  }

  return odometerValues.at(-1)! - odometerValues[0]
}

const withinRange = (value: Date, min: Date, max: Date) =>
  value.getTime() >= min.getTime() && value.getTime() <= max.getTime()

const getExpenseWindow = (
  records: Array<{ date: string; cost: number }>,
  referenceDate: Date = new Date(),
) => {
  const startOfToday = new Date(referenceDate)
  startOfToday.setHours(0, 0, 0, 0)

  const currentYear = startOfToday.getFullYear()
  const currentMonth = startOfToday.getMonth()

  const totals = {
    daily: 0,
    weekly: 0,
    monthly: 0,
    yearly: 0,
  }

  for (const record of records) {
    const current = toDate(record.date)
    const dayDelta = Math.floor((startOfToday.getTime() - current.getTime()) / DAY_MS)

    if (dayDelta === 0) {
      totals.daily += record.cost
    }

    if (dayDelta >= 0 && dayDelta < 7) {
      totals.weekly += record.cost
    }

    if (current.getFullYear() === currentYear && current.getMonth() === currentMonth) {
      totals.monthly += record.cost
    }

    if (current.getFullYear() === currentYear) {
      totals.yearly += record.cost
    }
  }

  return totals
}

export const calculateSnapshot = (
  vehicle: Vehicle,
  fuelEntries: FuelEntry[],
  chargeEntries: ChargeEntry[],
  maintenanceEntries: MaintenanceEntry[],
): MetricSnapshot => {
  const totalFuelSpend = sumCost(fuelEntries)
  const totalChargeSpend = sumCost(chargeEntries)
  const totalMaintenanceSpend = sumCost(maintenanceEntries)
  const totalSpend = totalFuelSpend + totalChargeSpend + totalMaintenanceSpend
  const totalDistance = getOverallDistance(fuelEntries, chargeEntries, maintenanceEntries)
  const fuelDistance = calculateDistanceFromEntries(fuelEntries)
  const electricDistance = calculateDistanceFromEntries(chargeEntries)
  const totalLiters = fuelEntries.reduce((accumulator, entry) => accumulator + entry.liters, 0)
  const totalKwh = chargeEntries.reduce((accumulator, entry) => accumulator + entry.kwh, 0)
  const costPerKm = totalDistance > 0 ? totalSpend / totalDistance : 0
  const kmPerLiter = totalLiters > 0 ? fuelDistance / totalLiters : 0
  const kmPerKwh = totalKwh > 0 ? electricDistance / totalKwh : 0

  const fuelScore = kmPerLiter > 0 ? (kmPerLiter / vehicle.benchmarkFuelEfficiency) * 100 : 0
  const electricScore =
    kmPerKwh > 0 ? (kmPerKwh / vehicle.benchmarkElectricEfficiency) * 100 : 0

  const scoreValues = [fuelScore, electricScore].filter((value) => value > 0)
  const averagePerformanceScore = scoreValues.length
    ? scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length
    : 0

  const baselineGasCost =
    totalDistance > 0 ? (totalDistance / vehicle.benchmarkFuelEfficiency) * vehicle.benchmarkFuelPrice : 0
  const actualMobilityCost = totalFuelSpend + totalChargeSpend
  const cumulativeSavings = baselineGasCost - actualMobilityCost

  return {
    totalDistance: round(totalDistance),
    totalSpend: round(totalSpend),
    totalFuelSpend: round(totalFuelSpend),
    totalChargeSpend: round(totalChargeSpend),
    totalMaintenanceSpend: round(totalMaintenanceSpend),
    costPerKm: round(costPerKm),
    kmPerLiter: round(kmPerLiter),
    kmPerKwh: round(kmPerKwh),
    averagePerformanceScore: round(averagePerformanceScore),
    cumulativeSavings: round(cumulativeSavings),
    expenseWindow: getExpenseWindow([...fuelEntries, ...chargeEntries, ...maintenanceEntries]),
  }
}

export const buildDailyTrend = (
  fuelEntries: FuelEntry[],
  chargeEntries: ChargeEntry[],
  maintenanceEntries: MaintenanceEntry[],
  referenceDate: Date = new Date(),
): TrendPoint[] => {
  const startOfToday = new Date(referenceDate)
  startOfToday.setHours(0, 0, 0, 0)

  return Array.from({ length: 7 }, (_, offset) => {
    const currentDay = new Date(startOfToday)
    currentDay.setDate(startOfToday.getDate() - (6 - offset))

    const dayStart = new Date(currentDay)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(currentDay)
    dayEnd.setHours(23, 59, 59, 999)

    const fuel = sumCost(fuelEntries.filter((entry) => withinRange(toDate(entry.date), dayStart, dayEnd)))
    const charge = sumCost(
      chargeEntries.filter((entry) => withinRange(toDate(entry.date), dayStart, dayEnd)),
    )
    const maintenance = sumCost(
      maintenanceEntries.filter((entry) => withinRange(toDate(entry.date), dayStart, dayEnd)),
    )

    return {
      label: currentDay.toLocaleDateString('es-MX', { weekday: 'short' }),
      total: round(fuel + charge + maintenance),
      fuel: round(fuel),
      charge: round(charge),
      maintenance: round(maintenance),
    }
  })
}

export const buildMonthlyBreakdown = (
  fuelEntries: FuelEntry[],
  chargeEntries: ChargeEntry[],
  maintenanceEntries: MaintenanceEntry[],
): TrendPoint[] => {
  const monthKeys = new Set(
    [...fuelEntries, ...chargeEntries, ...maintenanceEntries].map((entry) => entry.date.slice(0, 7)),
  )

  return [...monthKeys]
    .sort()
    .map((monthKey) => {
      const labelDate = toDate(`${monthKey}-01`)
      const fuel = sumCost(fuelEntries.filter((entry) => entry.date.startsWith(monthKey)))
      const charge = sumCost(chargeEntries.filter((entry) => entry.date.startsWith(monthKey)))
      const maintenance = sumCost(
        maintenanceEntries.filter((entry) => entry.date.startsWith(monthKey)),
      )

      return {
        label: labelDate.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }),
        total: round(fuel + charge + maintenance),
        fuel: round(fuel),
        charge: round(charge),
        maintenance: round(maintenance),
      }
    })
}

export const buildHistory = (
  fuelEntries: FuelEntry[],
  chargeEntries: ChargeEntry[],
  maintenanceEntries: MaintenanceEntry[],
): HistoryItem[] =>
  [
    ...fuelEntries.map<HistoryItem>((entry) => ({
      id: entry.id,
      date: entry.date,
      type: 'Gasolina',
      title: `${entry.liters.toFixed(1)} L en ${entry.station}`,
      subtitle: entry.notes || 'Consumo registrado',
      cost: round(entry.cost),
      odometer: entry.odometer,
    })),
    ...chargeEntries.map<HistoryItem>((entry) => ({
      id: entry.id,
      date: entry.date,
      type: 'Carga',
      title: `${entry.kwh.toFixed(1)} kWh · ${entry.chargeType}`,
      subtitle: entry.location || 'Carga registrada',
      cost: round(entry.cost),
      odometer: entry.odometer,
    })),
    ...maintenanceEntries.map<HistoryItem>((entry) => ({
      id: entry.id,
      date: entry.date,
      type: 'Mantenimiento',
      title: entry.category,
      subtitle: entry.provider || 'Servicio registrado',
      cost: round(entry.cost),
      odometer: entry.odometer,
    })),
  ].sort((left, right) => toDate(right.date).getTime() - toDate(left.date).getTime())

export const buildPerformanceSeries = (
  fuelEntries: FuelEntry[],
  chargeEntries: ChargeEntry[],
): PerformancePoint[] => {
  const fuelSeries = sortByDate(fuelEntries).slice(1).map((entry, index, ordered) => {
    const previous = ordered[index]
    const distance = entry.odometer - previous.odometer
    return {
      date: entry.date,
      value: distance > 0 && entry.liters > 0 ? round(distance / entry.liters) : 0,
    }
  })

  const chargeSeries = sortByDate(chargeEntries).slice(1).map((entry, index, ordered) => {
    const previous = ordered[index]
    const distance = entry.odometer - previous.odometer
    return {
      date: entry.date,
      value: distance > 0 && entry.kwh > 0 ? round(distance / entry.kwh) : 0,
    }
  })

  const keys = new Set([...fuelSeries, ...chargeSeries].map((entry) => entry.date))

  return [...keys]
    .sort()
    .map((key) => ({
      label: toDate(key).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
      fuelEfficiency: fuelSeries.find((entry) => entry.date === key)?.value ?? 0,
      electricEfficiency: chargeSeries.find((entry) => entry.date === key)?.value ?? 0,
    }))
}
