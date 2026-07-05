import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_RETRIES = 3
const REQUEST_DELAY_MS = 50
const CONCURRENCY = 25

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const stationIndexPath = path.join(rootDir, 'public', 'stations-index.json')
const outputPath = path.join(rootDir, 'public', 'stations-spain.json')

const raw = await fs.readFile(stationIndexPath, 'utf-8')
const payload = JSON.parse(raw)
const stations = payload.stations || []

let cursor = 0
const spainStations = []

async function worker() {
  while (cursor < stations.length) {
    const current = stations[cursor]
    cursor += 1

    const result = await inspectStation(current)
    if (result) {
      spainStations.push(result)
    }

    if (cursor % 500 === 0) {
      console.log(`Revisadas ${cursor}/${stations.length} · España ${spainStations.length}`)
    }

    await delay(REQUEST_DELAY_MS)
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

spainStations.sort((a, b) => Number(a.code) - Number(b.code))

const output = {
  generatedAt: new Date().toISOString(),
  source: 'https://www.tutiempo.net',
  totalStationsReviewed: stations.length,
  totalSpainStations: spainStations.length,
  stations: spainStations,
}

await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8')

console.log(`\nArchivo generado: ${outputPath}`)
console.log(`Estaciones de España geolocalizadas: ${spainStations.length}`)

async function inspectStation(station) {
  try {
    const html = await fetchWithRetry(station.url)
    if (!html.includes('/clima/espana.html')) {
      return null
    }

    const datasetJson = extractDatasetJson(html)
    if (!datasetJson) {
      return null
    }

    const dataset = JSON.parse(datasetJson)
    const geo = dataset?.spatialCoverage?.geo
    const lat = Number.parseFloat(geo?.latitude)
    const lon = Number.parseFloat(geo?.longitude)

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return null
    }

    return {
      code: String(station.code),
      name: station.name || dataset?.spatialCoverage?.name || `Estacion ${station.code}`,
      latitude: lat,
      longitude: lon,
      url: station.url,
    }
  } catch {
    return null
  }
}

function extractDatasetJson(html) {
  const regex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
  let match

  while ((match = regex.exec(html)) !== null) {
    const text = match[1]?.trim()
    if (!text) continue

    try {
      const parsed = JSON.parse(text)
      if (parsed?.['@type'] === 'Dataset') {
        return text
      }
    } catch {
      // Ignore malformed blocks.
    }
  }

  return ''
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
      await delay(220 * attempt)
    }
  }

  throw lastError ?? new Error('Error desconocido')
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
