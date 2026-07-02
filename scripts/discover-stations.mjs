import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cheerio from 'cheerio'

const ROOT = 'https://www.tutiempo.net'
const START_PATH = '/clima'
const REQUEST_DELAY_MS = 100
const MAX_RETRIES = 3
const args = parseArgs(process.argv.slice(2))
const MAX_PAGES = args.maxPages

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const outputPath = path.join(rootDir, 'public', 'stations-index.json')

const queue = [START_PATH]
const visited = new Set()
const stationMap = new Map()

while (queue.length && visited.size < MAX_PAGES) {
  const nextPath = queue.shift()
  if (!nextPath || visited.has(nextPath)) continue

  visited.add(nextPath)

  try {
    const url = `${ROOT}${nextPath}`
    const html = await fetchWithRetry(url)
    const $ = cheerio.load(html)

    $('a[href]').each((_, anchor) => {
      const hrefRaw = ($(anchor).attr('href') || '').trim()
      if (!hrefRaw) return

      const href = normalizeHref(hrefRaw)
      if (!href) return

      const wsMatch = href.match(/\/ws-(\d+)\.html$/)
      if (wsMatch) {
        const code = wsMatch[1]
        const label = $(anchor).text().replace(/\s+/g, ' ').trim()

        if (!stationMap.has(code)) {
          stationMap.set(code, {
            code,
            name: label || `Estacion ${code}`,
            url: `${ROOT}${href}`,
          })
        } else if (label && stationMap.get(code).name.startsWith('Estacion')) {
          stationMap.set(code, {
            ...stationMap.get(code),
            name: label,
          })
        }
      }

      if (href.startsWith('/clima') && href.endsWith('.html') && !visited.has(href)) {
        queue.push(href)
      }
    })

    if (visited.size % 100 === 0) {
      console.log(`Paginas exploradas: ${visited.size} · Estaciones detectadas: ${stationMap.size}`)
    }

    await delay(REQUEST_DELAY_MS)
  } catch (error) {
    console.log(`Error en ${nextPath}: ${error.message}`)
    await delay(250)
  }
}

const stations = Array.from(stationMap.values()).sort((a, b) => Number(a.code) - Number(b.code))

const payload = {
  generatedAt: new Date().toISOString(),
  exploredPages: visited.size,
  totalStations: stations.length,
  stations,
}

await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf-8')

console.log(`\nExploracion terminada.`)
console.log(`Paginas exploradas: ${visited.size}`)
console.log(`Estaciones encontradas: ${stations.length}`)
console.log(`Archivo: ${outputPath}`)

function parseArgs(argv) {
  let maxPages = 2800

  for (const arg of argv) {
    if (arg.startsWith('--maxPages=')) {
      maxPages = Number.parseInt(arg.split('=')[1], 10) || maxPages
    }
  }

  return { maxPages }
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

function normalizeHref(href) {
  if (href.startsWith('#')) return ''
  if (href.startsWith('mailto:')) return ''
  if (href.startsWith('javascript:')) return ''

  if (href.startsWith(ROOT)) {
    return href.slice(ROOT.length)
  }

  if (href.startsWith('/')) return href

  return ''
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
