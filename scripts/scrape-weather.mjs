import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cheerio from 'cheerio'

const START_YEAR = 1976
const DEFAULT_STATION_CODE = '82210'
const DEFAULT_STATION_NAME = 'Madrid / Barajas'
const BASE_URL = 'https://www.tutiempo.net/clima'
const REQUEST_DELAY_MS = 140
const MAX_RETRIES = 3

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const publicDir = path.join(rootDir, 'public')
const stationsDataDir = path.join(publicDir, 'stations', 'data')
const stationIndexPath = path.join(publicDir, 'stations-index.json')
const spainStationsPath = path.join(publicDir, 'stations-spain.json')
const multiStationIndexPath = path.join(publicDir, 'weather-history-index.json')
const legacySinglePath = path.join(publicDir, 'weather-history.json')

const args = parseArgs(process.argv.slice(2))
const now = new Date()
const endYear = now.getFullYear()
const endMonth = now.getMonth() + 1
const todayIso = toIsoDate(now)

await fs.mkdir(stationsDataDir, { recursive: true })

const stations = await resolveStations(args)

if (!stations.length) {
  throw new Error('No hay estaciones para procesar.')
}

console.log(`Estaciones a procesar: ${stations.length}`)

const stationResults = []
const existingIndex = await loadExistingWeatherIndex()

for (let index = 0; index < stations.length; index += 1) {
  const station = stations[index]
  console.log(`\n[${index + 1}/${stations.length}] Scrapeando ${station.name} (${station.code})...`)

  try {
    const existingPayload = args.incremental ? await loadExistingStationPayload(station.code) : null
    const payload = await scrapeStation(station, {
      startYear: START_YEAR,
      endYear,
      endMonth,
      todayIso,
      existingPayload,
      forceFull: args.full,
    })
    const outputFile = `/stations/data/ws-${station.code}.json`
    const outputPath = path.join(publicDir, outputFile)

    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf-8')

    stationResults.push({
      code: station.code,
      name: station.name,
      file: outputFile,
      recordsCount: payload.meta.recordsCount,
      failedPages: payload.meta.failedPages,
      throughDate: payload.meta.throughDate,
    })

    console.log(`Guardado: ${outputFile} (${payload.meta.recordsCount} registros)`)
  } catch (error) {
    console.log(`Error en estacion ${station.code}: ${error.message}`)
  }
}

const mergedStationsMap = new Map((existingIndex.stations || []).map((station) => [station.code, station]))
for (const stationResult of stationResults) {
  mergedStationsMap.set(stationResult.code, stationResult)
}

const mergedStations = Array.from(mergedStationsMap.values()).sort((a, b) => Number(a.code) - Number(b.code))

const indexPayload = {
  generatedAt: new Date().toISOString(),
  defaultStation:
    mergedStationsMap.has(existingIndex.defaultStation)
      ? existingIndex.defaultStation
      : mergedStations[0]?.code || DEFAULT_STATION_CODE,
  stations: mergedStations,
}

await fs.writeFile(multiStationIndexPath, JSON.stringify(indexPayload, null, 2), 'utf-8')
console.log(`\nIndice multiestacion actualizado: ${multiStationIndexPath}`)

if (stationResults.length === 1) {
  const onlyStationPath = path.join(publicDir, stationResults[0].file)
  const onlyStationData = await fs.readFile(onlyStationPath, 'utf-8')
  await fs.writeFile(legacySinglePath, onlyStationData, 'utf-8')
  console.log(`Compatibilidad legacy: ${legacySinglePath}`)
}

console.log(`Estaciones procesadas correctamente: ${stationResults.length}`)

async function resolveStations(cliArgs) {
  if (cliArgs.station) {
    return [
      {
        code: cliArgs.station,
        name: cliArgs.name || `Estacion ${cliArgs.station}`,
      },
    ]
  }

  if (cliArgs.spain) {
    const spainIndex = await loadSpainStationIndex()
    const limited = cliArgs.limit > 0 ? spainIndex.slice(0, cliArgs.limit) : spainIndex
    return limited
  }

  if (cliArgs.all) {
    const stationIndex = await loadStationIndex()
    const limited = cliArgs.limit > 0 ? stationIndex.slice(0, cliArgs.limit) : stationIndex
    return limited
  }

  return [
    {
      code: DEFAULT_STATION_CODE,
      name: DEFAULT_STATION_NAME,
    },
  ]
}

async function loadStationIndex() {
  try {
    const raw = await fs.readFile(stationIndexPath, 'utf-8')
    const payload = JSON.parse(raw)
    return (payload.stations || []).map((item) => ({
      code: String(item.code),
      name: item.name || `Estacion ${item.code}`,
    }))
  } catch {
    throw new Error('Falta public/stations-index.json. Ejecuta primero: npm run discover:stations')
  }
}

async function loadSpainStationIndex() {
  try {
    const raw = await fs.readFile(spainStationsPath, 'utf-8')
    const payload = JSON.parse(raw)
    return (payload.stations || []).map((item) => ({
      code: String(item.code),
      name: item.name || `Estacion ${item.code}`,
    }))
  } catch {
    throw new Error('Falta public/stations-spain.json. Ejecuta primero: npm run build:spain-stations')
  }
}

async function loadExistingWeatherIndex() {
  try {
    const raw = await fs.readFile(multiStationIndexPath, 'utf-8')
    const payload = JSON.parse(raw)
    return {
      defaultStation: payload.defaultStation || DEFAULT_STATION_CODE,
      stations: Array.isArray(payload.stations) ? payload.stations : [],
    }
  } catch {
    return {
      defaultStation: DEFAULT_STATION_CODE,
      stations: [],
    }
  }
}

async function loadExistingStationPayload(code) {
  const dataPath = path.join(stationsDataDir, `ws-${code}.json`)
  try {
    const raw = await fs.readFile(dataPath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function scrapeStation(station, options) {
  const {
    startYear,
    endYear: targetEndYear,
    endMonth: targetEndMonth,
    todayIso: todayLimit,
    existingPayload,
    forceFull,
  } = options

  const scrapeWindow = resolveScrapeWindow({
    startYear,
    endYear: targetEndYear,
    endMonth: targetEndMonth,
    todayIso: todayLimit,
    existingPayload,
    forceFull,
  })

  if (scrapeWindow.skip && existingPayload) {
    console.log(`Sin cambios: ${station.code} ya estaba al dia (${existingPayload.meta?.throughDate || todayLimit}).`)
    return existingPayload
  }

  const byDay = cloneByDay(existingPayload?.byDay || {})
  const failures = []

  for (let year = scrapeWindow.startYear; year <= targetEndYear; year += 1) {
    const maxMonth = year === targetEndYear ? targetEndMonth : 12
    const firstMonth = year === scrapeWindow.startYear ? scrapeWindow.startMonth : 1

    for (let month = firstMonth; month <= maxMonth; month += 1) {
      const url = `${BASE_URL}/${String(month).padStart(2, '0')}-${year}/ws-${station.code}.html`

      try {
        const html = await fetchWithRetry(url)
        const monthRecords = parseMonthPage(html, year, month)

        for (const record of monthRecords) {
          if (record.isoDate > todayLimit) continue

          const key = `${String(record.month).padStart(2, '0')}-${String(record.day).padStart(2, '0')}`
          if (!byDay[key]) byDay[key] = []

          upsertYearRecord(byDay[key], {
            year: record.year,
            tAvg: record.tAvg,
            tMax: record.tMax,
            tMin: record.tMin,
            precip: record.precip,
          })
        }

        process.stdout.write(`\rProcesando ${station.code} ${year}-${String(month).padStart(2, '0')}...`)
        await delay(REQUEST_DELAY_MS)
      } catch (error) {
        failures.push({ url, message: error.message })
        process.stdout.write(`\rFallo ${station.code} ${year}-${String(month).padStart(2, '0')} (${error.message})\n`)
        await delay(320)
      }
    }
  }

  for (const key of Object.keys(byDay)) {
    byDay[key].sort((a, b) => a.year - b.year)
  }

  const recordsCount = Object.values(byDay).reduce((acc, records) => acc + records.length, 0)

  return {
    meta: {
      station: station.code,
      stationName: station.name,
      source: 'https://www.tutiempo.net',
      startYear: existingPayload?.meta?.startYear || startYear,
      endYear: targetEndYear,
      generatedAt: new Date().toISOString(),
      throughDate: todayLimit,
      recordsCount,
      failedPages: failures.length,
    },
    failures,
    byDay,
  }
}

function resolveScrapeWindow(options) {
  const { startYear, endYear, endMonth, todayIso, existingPayload, forceFull } = options

  if (forceFull || !existingPayload?.meta?.throughDate || !isIsoDate(existingPayload.meta.throughDate)) {
    return {
      startYear,
      startMonth: 1,
      skip: false,
    }
  }

  const throughDate = existingPayload.meta.throughDate
  if (throughDate >= todayIso) {
    return {
      startYear: endYear,
      startMonth: endMonth,
      skip: true,
    }
  }

  const [year, month] = throughDate.split('-').map((part) => Number(part))
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return {
      startYear,
      startMonth: 1,
      skip: false,
    }
  }

  return {
    // Rescrape from the month of the latest stored day to handle partial month updates.
    startYear: year,
    startMonth: month,
    skip: false,
  }
}

function upsertYearRecord(series, entry) {
  const existingIndex = series.findIndex((item) => item.year === entry.year)
  if (existingIndex >= 0) {
    series[existingIndex] = entry
    return
  }

  series.push(entry)
}

function cloneByDay(byDay) {
  const cloned = {}
  for (const [key, records] of Object.entries(byDay)) {
    cloned[key] = (records || []).map((record) => ({ ...record }))
  }
  return cloned
}

async function fetchWithRetry(url) {
  let lastError

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      return await response.text()
    } catch (error) {
      lastError = error
      await delay(300 * attempt)
    }
  }

  throw lastError ?? new Error('Error desconocido')
}

function parseMonthPage(html, year, month) {
  const $ = cheerio.load(html)
  const rows = $('table.medias.mensuales tr')
  const records = []

  rows.each((index, row) => {
    if (index === 0) return

    const cells = $(row)
      .find('th,td')
      .map((_, cell) => $(cell).text().trim())
      .get()

    if (!cells.length) return

    const day = Number.parseInt(cells[0], 10)
    if (!Number.isInteger(day) || day < 1 || day > 31) return

    const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

    records.push({
      isoDate,
      year,
      month,
      day,
      tAvg: parseClimateNumber(cells[1]),
      tMax: parseClimateNumber(cells[2]),
      tMin: parseClimateNumber(cells[3]),
      precip: parseClimateNumber(cells[6]),
    })
  })

  return records
}

function parseClimateNumber(raw) {
  if (!raw) return null

  const cleaned = raw.trim().replace(',', '.').replace(/\s+/g, '')
  if (!cleaned || cleaned === '-') return null
  if (/^ip$/i.test(cleaned)) return 0

  const match = cleaned.match(/-?\d+(\.\d+)?/)
  if (!match) return null

  const parsed = Number.parseFloat(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

function toIsoDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function parseArgs(argv) {
  const output = {
    all: false,
    spain: false,
    station: '',
    name: '',
    limit: 0,
    incremental: true,
    full: false,
  }

  for (const arg of argv) {
    if (arg === '--all') output.all = true
    if (arg === '--spain') output.spain = true
    if (arg === '--full') {
      output.full = true
      output.incremental = false
    }
    if (arg === '--no-incremental') output.incremental = false
    if (arg.startsWith('--station=')) output.station = arg.split('=')[1]
    if (arg.startsWith('--name=')) output.name = decodeURIComponent(arg.split('=')[1])
    if (arg.startsWith('--limit=')) output.limit = Number.parseInt(arg.split('=')[1], 10) || 0
  }

  return output
}
