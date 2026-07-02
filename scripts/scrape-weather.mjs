import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cheerio from 'cheerio'

const START_YEAR = 1976
const STATION_CODE = '82210'
const BASE_URL = 'https://www.tutiempo.net/clima'
const REQUEST_DELAY_MS = 180
const MAX_RETRIES = 3

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const outputPath = path.join(rootDir, 'public', 'weather-history.json')

const now = new Date()
const endYear = now.getFullYear()
const endMonth = now.getMonth() + 1
const todayIso = toIsoDate(now)

const byDay = {}
const failures = []

console.log(`Iniciando scraping ${START_YEAR}-${endYear} para estacion ${STATION_CODE}...`)

for (let year = START_YEAR; year <= endYear; year += 1) {
  const maxMonth = year === endYear ? endMonth : 12

  for (let month = 1; month <= maxMonth; month += 1) {
    const url = `${BASE_URL}/${String(month).padStart(2, '0')}-${year}/ws-${STATION_CODE}.html`

    try {
      const html = await fetchWithRetry(url)
      const monthRecords = parseMonthPage(html, year, month)

      for (const record of monthRecords) {
        if (record.isoDate > todayIso) {
          continue
        }

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

      process.stdout.write(`\rProcesando ${year}-${String(month).padStart(2, '0')}...`)
      await delay(REQUEST_DELAY_MS)
    } catch (error) {
      failures.push({ url, message: error.message })
      process.stdout.write(`\rFallo ${year}-${String(month).padStart(2, '0')} (${error.message})\n`)
      await delay(500)
    }
  }
}

for (const key of Object.keys(byDay)) {
  byDay[key].sort((a, b) => a.year - b.year)
}

const recordsCount = Object.values(byDay).reduce((acc, records) => acc + records.length, 0)

const payload = {
  meta: {
    station: STATION_CODE,
    source: 'https://www.tutiempo.net',
    startYear: START_YEAR,
    endYear,
    generatedAt: new Date().toISOString(),
    throughDate: todayIso,
    recordsCount,
    failedPages: failures.length,
  },
  failures,
  byDay,
}

await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf-8')

console.log('\nScraping completado.')
console.log(`Registros diarios guardados: ${recordsCount}`)
console.log(`Archivo: ${outputPath}`)
if (failures.length) {
  console.log(`Paginas con error: ${failures.length}`)
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
      await delay(350 * attempt)
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
