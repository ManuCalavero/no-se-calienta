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
for (let index = 0; index < stations.length; index += 1) {
  const station = stations[index]
  console.log(`\n[${index + 1}/${stations.length}] Scrapeando ${station.name} (${station.code})...`)

  try {
    const payload = await scrapeStation(station, { startYear: START_YEAR, endYear, endMonth, todayIso })
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

const indexPayload = {
  generatedAt: new Date().toISOString(),
  defaultStation: stationResults[0]?.code || DEFAULT_STATION_CODE,
  stations: stationResults,
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

async function scrapeStation(station, options) {
  const { startYear, endYear: targetEndYear, endMonth: targetEndMonth, todayIso: todayLimit } = options

  const byDay = {}
  const failures = []

  for (let year = startYear; year <= targetEndYear; year += 1) {
    const maxMonth = year === targetEndYear ? targetEndMonth : 12

    for (let month = 1; month <= maxMonth; month += 1) {
      const url = `${BASE_URL}/${String(month).padStart(2, '0')}-${year}/ws-${station.code}.html`

      try {
        const html = await fetchWithRetry(url)
        const monthRecords = parseMonthPage(html, year, month)

        for (const record of monthRecords) {
          if (record.isoDate > todayLimit) continue

          const key = `${String(record.month).padStart(2, '0')}-${String(record.day).padStart(2, '0')}`
          if (!byDay[key]) byDay[key] = []

          byDay[key].push({
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
      startYear,
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

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function parseArgs(argv) {
  const output = {
    all: false,
    station: '',
    name: '',
    limit: 0,
  }

  for (const arg of argv) {
    if (arg === '--all') output.all = true
    if (arg.startsWith('--station=')) output.station = arg.split('=')[1]
    if (arg.startsWith('--name=')) output.name = decodeURIComponent(arg.split('=')[1])
    if (arg.startsWith('--limit=')) output.limit = Number.parseInt(arg.split('=')[1], 10) || 0
  }

  return output
}
