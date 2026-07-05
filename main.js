import './style.css'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js'

Chart.register(
  CategoryScale,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  BarController,
  BarElement,
  Tooltip,
  Legend,
  Title,
)

const START_YEAR = 1976
const DEFAULT_STATION_CODE = '82210'
const APP_BASE = normalizeBase(import.meta.env.BASE_URL)
const today = new Date()
const maxDate = toIsoDate(today)

let chart
let spainStations = []
let stationDataIndex = new Map()
let weatherData = null
let currentStationCode = DEFAULT_STATION_CODE

startApp()

async function startApp() {
  await bootstrap()
}

async function bootstrap() {
  const appRoot = document.querySelector('#app')
  if (!appRoot) return

  try {
    await loadCatalogs()
  } catch (error) {
    appRoot.innerHTML = `<main class="layout"><section class="insight error"><h2>Error de carga</h2><p>${error.message}</p></section></main>`
    return
  }

  window.addEventListener('popstate', () => {
    renderRoute()
  })

  renderRoute()
}

async function loadCatalogs() {
  const [spainResponse, dataIndexResponse] = await Promise.all([
    fetch(assetPath('/stations-spain.json'), { cache: 'no-store' }),
    fetch(assetPath('/weather-history-index.json'), { cache: 'no-store' }),
  ])

  if (!spainResponse.ok) {
    throw new Error('Falta public/stations-spain.json. Ejecuta npm run build:spain-stations.')
  }

  const spainPayload = await spainResponse.json()
  spainStations = (spainPayload.stations || []).map((station) => ({
    code: String(station.code),
    name: station.name || `Estacion ${station.code}`,
    latitude: Number(station.latitude),
    longitude: Number(station.longitude),
  }))

  if (dataIndexResponse.ok) {
    const dataIndexPayload = await dataIndexResponse.json()
    stationDataIndex = new Map((dataIndexPayload.stations || []).map((station) => [station.code, station]))
    currentStationCode = dataIndexPayload.defaultStation || currentStationCode
  }
}

function renderRoute() {
  const route = parseRoute()

  if (route.view === 'station') {
    renderStationPage(route.code)
    return
  }

  renderHomePage()
}

function renderHomePage() {
  destroyChartIfAny()

  const appRoot = document.querySelector('#app')
  const stationsWithData = spainStations.filter((station) => stationDataIndex.has(station.code))
  const withData = stationsWithData.length
  const stationsForHome = withData > 0 ? stationsWithData : spainStations

  appRoot.innerHTML = `
    <main class="layout">
      <header class="hero">
        <div class="hero-top">
          <div>
            <p class="eyebrow">No Se Calienta · Mapa de estaciones de España</p>
            <h1>Selecciona una estación en el mapa</h1>
            <p class="subtitle">
              Estaciones españolas geolocalizadas: ${spainStations.length}. Con datos históricos descargados: ${withData}.
            </p>
            ${withData < spainStations.length ? `<p class="subtitle">Mostrando solo estaciones con datos locales para evitar errores de carga.</p>` : ''}
          </div>
        </div>
      </header>

      <section class="map-shell">
        <div id="spainMap" class="spain-map" role="img" aria-label="Mapa de estaciones meteorológicas de España"></div>
      </section>

      <section class="stations-panel">
        <h2 class="panel-title">Estaciones de España</h2>
        <ul class="station-list">
          ${stationsForHome
            .map((station) => {
              const href = stationPath(station.code)
              return `<li><a class="station-link" href="${href}" data-route="station" data-code="${station.code}">${station.name} (${station.code}) <span>datos listos</span></a></li>`
            })
            .join('')}
        </ul>
      </section>
    </main>
  `

  setupHomeInteractions()
  initializeSpainMap()
}

function setupHomeInteractions() {
  document.querySelectorAll('[data-route="station"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault()
      const code = event.currentTarget?.getAttribute('data-code')
      if (!code) return
      navigateToStation(code)
    })
  })
}

function initializeSpainMap() {
  const mapContainer = document.querySelector('#spainMap')
  if (!mapContainer) return

  const map = L.map(mapContainer, {
    zoomControl: true,
    minZoom: 5,
    maxZoom: 10,
  }).setView([40.3, -3.7], 6)

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map)

  const bounds = L.latLngBounds(
    [35.5, -10.5],
    [44.7, 4.8],
  )
  map.setMaxBounds(bounds)

  const stationsForMap = spainStations.filter((station) => stationDataIndex.has(station.code))
  const mapStations = stationsForMap.length ? stationsForMap : spainStations

  mapStations.forEach((station) => {
    if (!Number.isFinite(station.latitude) || !Number.isFinite(station.longitude)) return

    const marker = L.circleMarker([station.latitude, station.longitude], {
      radius: 5,
      color: '#ff7c3a',
      fillColor: '#ff7c3a',
      fillOpacity: 0.9,
      weight: 1,
    }).addTo(map)

    const popupLink = `<a href="${stationPath(station.code)}" data-route="station" data-code="${station.code}">${station.name} (${station.code})</a>`
    const popupBody = `${popupLink}<br/><small>datos listos</small>`

    marker.bindPopup(popupBody)
    marker.on('popupopen', () => {
      const popupNode = marker.getPopup()?.getElement()
      if (!popupNode) return

      popupNode.querySelectorAll('[data-route="station"]').forEach((anchor) => {
        anchor.addEventListener('click', (event) => {
          event.preventDefault()
          const code = event.currentTarget?.getAttribute('data-code')
          if (!code) return
          map.closePopup()
          navigateToStation(code)
        })
      })
    })
  })

  setTimeout(() => {
    map.invalidateSize()
  }, 0)
}

async function renderStationPage(codeFromRoute) {
  const appRoot = document.querySelector('#app')
  const stationsWithData = spainStations.filter((station) => stationDataIndex.has(station.code))
  const stationOptions = stationsWithData.length ? stationsWithData : spainStations
  const hasStation = stationOptions.some((station) => station.code === codeFromRoute)
  const fallbackCode = stationDataIndex.get(currentStationCode)?.code || stationDataIndex.keys().next().value || DEFAULT_STATION_CODE
  currentStationCode = hasStation ? codeFromRoute : fallbackCode

  appRoot.innerHTML = stationPageTemplate(currentStationCode)

  const dateInput = document.querySelector('#selectedDate')
  const stationSelect = document.querySelector('#stationSelect')
  const selectionInfo = document.querySelector('#selectionInfo')
  const summaryCards = document.querySelector('#summaryCards')
  const insights = document.querySelector('#insights')
  const heroStation = document.querySelector('#heroStation')
  const heroCurrentAvg = document.querySelector('#heroCurrentAvg')
  const heroCurrentYear = document.querySelector('#heroCurrentYear')
  const heroChangeAvg = document.querySelector('#heroChangeAvg')
  const heroChangeRange = document.querySelector('#heroChangeRange')

  stationSelect.innerHTML = stationOptions
    .map((station) => {
      return `<option value="${station.code}">${station.name} (${station.code})</option>`
    })
    .join('')
  stationSelect.value = currentStationCode

  document.querySelector('#backHome')?.addEventListener('click', (event) => {
    event.preventDefault()
    navigateToHome()
  })

  stationSelect.addEventListener('change', () => {
    const selected = stationSelect.value
    navigateToStation(selected)
  })

  dateInput.addEventListener('change', () => {
    renderForDate(dateInput.value)
  })

  function renderError(message) {
    selectionInfo.textContent = 'No se pudo cargar el dataset de esta estación.'
    summaryCards.innerHTML = ''
    insights.innerHTML = `
      <article class="insight error">
        <h2>Sin datos locales</h2>
        <p>${message}</p>
        <p>Para descargar más estaciones, ejecuta <code>npm run scrape:all</code>.</p>
      </article>
    `
    heroCurrentAvg.textContent = '--'
    heroCurrentYear.textContent = '--'
    heroChangeAvg.textContent = '--'
    heroChangeRange.textContent = '--'
    heroChangeAvg.className = 'kpi-value'
    destroyChartIfAny()
  }

  const selectedStation = stationOptions.find((station) => station.code === currentStationCode)
  const stationDisplayName = selectedStation?.name || `Estacion ${currentStationCode}`
  heroStation.textContent = `No Se Calienta · ${stationDisplayName} · Estacion ${currentStationCode}`

  try {
    weatherData = await loadStationWeatherData(currentStationCode)
  } catch (error) {
    renderError(error.message)
    return
  }

  const preferredDate = pickPreferredIsoDate(weatherData, maxDate)
  dateInput.max = preferredDate
  dateInput.value = preferredDate

  renderForDate(dateInput.value)

  function renderForDate(isoDate) {
    const key = isoDate.slice(5)
    const series = (weatherData.byDay[key] || []).slice().sort((a, b) => a.year - b.year)

    const dateLabel = formatDateWithoutYear(isoDate)
    selectionInfo.textContent = `${dateLabel} · ${series.length} anos con datos disponibles`

    if (!series.length) {
      summaryCards.innerHTML = ''
      insights.innerHTML = `
        <article class="insight error">
          <h2>Sin registros para esta fecha</h2>
          <p>Prueba con otro día. En fechas especiales (como 29 de febrero) hay menos años disponibles.</p>
        </article>
      `
      destroyChartIfAny()
      return
    }

    const stats = buildStats(series)
    const diffAvg = stats.lastAvg !== null && stats.firstAvg !== null ? (stats.lastAvg - stats.firstAvg).toFixed(1) : 'n/d'
    const diffSign = typeof diffAvg === 'string' && diffAvg !== 'n/d' ? Number(diffAvg) : null

    heroCurrentAvg.textContent = `${formatNumber(stats.lastAvg)} °C`
    heroCurrentYear.textContent = `Ano ${stats.lastYear}`
    heroChangeAvg.textContent = `${diffSign !== null && diffSign > 0 ? '+' : ''}${diffAvg} °C`
    heroChangeAvg.className = `kpi-value ${diffSign !== null && diffSign > 0 ? 'hot' : 'cold'}`
    heroChangeRange.textContent = `${stats.firstYear} -> ${stats.lastYear}`

    summaryCards.innerHTML = `
      <article class="card">
        <h2>Media ${dateLabel}</h2>
        <p class="value">${formatNumber(stats.lastAvg)} °C</p>
        <p class="meta">Ultimo ano: ${stats.lastYear}</p>
      </article>
      <article class="card">
        <h2>Cambio desde ${stats.firstYear}</h2>
        <p class="value ${diffSign !== null && diffSign > 0 ? 'hot' : 'cold'}">${diffAvg} °C</p>
        <p class="meta">Comparado con ${stats.firstYear}</p>
      </article>
      <article class="card">
        <h2>Precipitacion (ultimo ano)</h2>
        <p class="value">${formatNumber(stats.lastPrecip)} mm</p>
        <p class="meta">${stats.lastYear}</p>
      </article>
      <article class="card">
        <h2>Tendencia temperatura media</h2>
        <p class="value ${stats.slope > 0 ? 'hot' : 'cold'}">${stats.slope > 0 ? '+' : ''}${stats.slope.toFixed(3)} °C/ano</p>
        <p class="meta">Regresion lineal ${stats.firstYear}-${stats.lastYear}</p>
      </article>
    `

    insights.innerHTML = `
      <article class="insight">
        <h2>Lectura rapida</h2>
        <p>
          Para el ${dateLabel}, la temperatura media pasa de
          <strong>${formatNumber(stats.firstAvg)} °C</strong> en ${stats.firstYear}
          a <strong>${formatNumber(stats.lastAvg)} °C</strong> en ${stats.lastYear}.
        </p>
        <p>
          Maxima historica: <strong>${formatNumber(stats.maxOfMax)} °C</strong>.
          Minima historica: <strong>${formatNumber(stats.minOfMin)} °C</strong>.
        </p>
        <p>
          Precipitacion media para este dia: <strong>${formatNumber(stats.meanPrecip)} mm</strong>.
        </p>
      </article>
    `

    renderChart(series, dateLabel)
  }
}

function stationPageTemplate(code) {
  return `
    <main class="layout">
      <header class="hero">
        <div class="hero-top">
          <div>
            <p id="heroStation" class="eyebrow">No Se Calienta · Estacion ${code}</p>
            <h1>Evolucion climatica por dia del año</h1>
            <p class="subtitle">
              Compara la temperatura maxima, minima, media y la precipitacion del mismo dia desde ${START_YEAR} hasta hoy.
            </p>
          </div>
          <a id="backHome" class="back-home" href="${appPath('/')}">Volver al mapa</a>
        </div>

        <div class="hero-kpis">
          <article class="hero-kpi">
            <p class="kpi-label">Temperatura media actual</p>
            <p id="heroCurrentAvg" class="kpi-value">--</p>
            <p id="heroCurrentYear" class="kpi-meta">--</p>
          </article>
          <article class="hero-kpi">
            <p class="kpi-label">Cambio frente al primer ano</p>
            <p id="heroChangeAvg" class="kpi-value">--</p>
            <p id="heroChangeRange" class="kpi-meta">--</p>
          </article>
        </div>
      </header>

      <section class="controls">
        <div class="control-group">
          <label for="stationSelect">Estacion</label>
          <select id="stationSelect"></select>
        </div>
        <div class="control-group">
          <label for="selectedDate">Fecha (por defecto, hoy)</label>
          <input id="selectedDate" type="date" min="${START_YEAR}-01-01" max="${maxDate}" value="${maxDate}" />
        </div>
        <p id="selectionInfo" class="selection-info"></p>
      </section>

      <section class="chart-panel">
        <canvas id="climateChart" aria-label="Grafico de evolucion anual" role="img"></canvas>
      </section>

      <section class="cards" id="summaryCards" aria-live="polite"></section>
      <section class="insights" id="insights"></section>
    </main>
  `
}

function renderChart(series, dateLabel) {
  const labels = series.map((entry) => entry.year)

  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          type: 'line',
          label: 'Temperatura maxima (TM)',
          data: series.map((entry) => entry.tMax),
          borderColor: '#ff7c3a',
          backgroundColor: '#ff7c3a',
          yAxisID: 'yTemp',
          tension: 0,
          borderWidth: 1.3,
          pointRadius: 1.1,
        },
        {
          type: 'line',
          label: 'Temperatura minima (Tm)',
          data: series.map((entry) => entry.tMin),
          borderColor: '#7d8898',
          backgroundColor: '#7d8898',
          yAxisID: 'yTemp',
          tension: 0,
          borderWidth: 1.3,
          pointRadius: 1.1,
        },
        {
          type: 'line',
          label: 'Temperatura media (T)',
          data: series.map((entry) => entry.tAvg),
          borderColor: '#d1d6de',
          backgroundColor: '#d1d6de',
          yAxisID: 'yTemp',
          tension: 0,
          pointRadius: 1.1,
          borderWidth: 1.5,
        },
        {
          type: 'bar',
          label: 'Precipitacion (PP)',
          data: series.map((entry) => entry.precip),
          borderColor: '#28b18a',
          backgroundColor: 'rgba(40, 177, 138, 0.35)',
          yAxisID: 'yRain',
          borderWidth: 1,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: `Evolucion anual para ${dateLabel}`,
          color: '#e9edf4',
          font: {
            family: '"Space Grotesk", sans-serif',
            size: 18,
            weight: '600',
          },
        },
        legend: {
          labels: {
            color: '#acb5c2',
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            pointStyle: 'circle',
          },
        },
        tooltip: {
          backgroundColor: 'rgba(12, 14, 19, 0.93)',
          borderColor: '#252d39',
          borderWidth: 1,
          titleColor: '#f5f7fa',
          bodyColor: '#d8dee9',
          displayColors: true,
          padding: 10,
        },
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(82, 89, 103, 0.35)',
            borderDash: [3, 5],
          },
          ticks: {
            color: '#9fa9b8',
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12,
          },
        },
        yTemp: {
          position: 'left',
          grid: {
            color: 'rgba(82, 89, 103, 0.25)',
          },
          ticks: {
            color: '#9fa9b8',
          },
          title: {
            display: true,
            text: 'Temperatura (°C)',
            color: '#9fa9b8',
          },
        },
        yRain: {
          position: 'right',
          ticks: {
            color: '#9fa9b8',
          },
          title: {
            display: true,
            text: 'Precipitacion (mm)',
            color: '#9fa9b8',
          },
          grid: {
            drawOnChartArea: false,
          },
        },
      },
    },
  }

  destroyChartIfAny()
  chart = new Chart(document.querySelector('#climateChart'), config)
}

function buildStats(series) {
  const first = series[0]
  const last = series[series.length - 1]

  const meanPrecip = mean(series.map((entry) => entry.precip))
  const maxOfMax = max(series.map((entry) => entry.tMax))
  const minOfMin = min(series.map((entry) => entry.tMin))
  const slope = linearRegressionSlope(series.map((entry) => [entry.year, entry.tAvg]))

  return {
    firstYear: first.year,
    lastYear: last.year,
    firstAvg: first.tAvg,
    lastAvg: last.tAvg,
    lastPrecip: last.precip,
    meanPrecip,
    maxOfMax,
    minOfMin,
    slope,
  }
}

async function loadStationWeatherData(code) {
  const localDataset = stationDataIndex.get(code)
  if (!localDataset) {
    throw new Error(`La estación ${code} no tiene dataset local todavía.`)
  }

  const datasetPath = localDataset.file || `/stations/data/ws-${code}.json`
  const response = await fetch(assetPath(datasetPath), { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`No se pudo cargar el dataset local de la estación ${code}.`)
  }

  return await response.json()
}

function navigateToStation(code) {
  currentStationCode = code
  pushRoute(stationPath(code))
  renderRoute()
}

function navigateToHome() {
  pushRoute(appPath('/'))
  renderRoute()
}

function stationPath(code) {
  return appPath(`/estacion/${code}`)
}

function parseRoute() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  const localPath = stripBase(pathname, APP_BASE)

  if (localPath.startsWith('/estacion/')) {
    const code = localPath.split('/')[2]
    return {
      view: 'station',
      code: code || DEFAULT_STATION_CODE,
    }
  }

  if (localPath === '/estacion') {
    return { view: 'station', code: currentStationCode }
  }

  return { view: 'home' }
}

function pushRoute(path) {
  if (window.location.pathname === path) return
  window.history.pushState({}, '', path)
}

function appPath(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return APP_BASE ? `${APP_BASE}${normalizedPath}` : normalizedPath
}

function stripBase(pathname, base) {
  if (!base) return pathname
  if (pathname.startsWith(base)) {
    const stripped = pathname.slice(base.length)
    return stripped || '/'
  }
  return pathname
}

function normalizeBase(baseUrl) {
  if (!baseUrl || baseUrl === '/') return ''
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

function assetPath(path) {
  if (!path) return appPath('/')

  // Keep absolute URLs untouched.
  if (/^https?:\/\//i.test(path)) {
    return path
  }

  return appPath(path)
}

function destroyChartIfAny() {
  if (chart) {
    chart.destroy()
    chart = undefined
  }
}

function mean(values) {
  const filtered = values.filter((value) => Number.isFinite(value))
  if (!filtered.length) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

function min(values) {
  const filtered = values.filter((value) => Number.isFinite(value))
  if (!filtered.length) return null
  return Math.min(...filtered)
}

function max(values) {
  const filtered = values.filter((value) => Number.isFinite(value))
  if (!filtered.length) return null
  return Math.max(...filtered)
}

function linearRegressionSlope(pairs) {
  const clean = pairs.filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
  if (clean.length < 2) return 0

  const n = clean.length
  const sumX = clean.reduce((acc, [x]) => acc + x, 0)
  const sumY = clean.reduce((acc, [, y]) => acc + y, 0)
  const sumXY = clean.reduce((acc, [x, y]) => acc + x * y, 0)
  const sumX2 = clean.reduce((acc, [x]) => acc + x * x, 0)

  const numerator = n * sumXY - sumX * sumY
  const denominator = n * sumX2 - sumX * sumX
  if (denominator === 0) return 0
  return numerator / denominator
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

function pickPreferredIsoDate(dataset, todayIso) {
  const throughDate = dataset?.meta?.throughDate
  const cappedIso = isIsoDate(throughDate) && throughDate < todayIso ? throughDate : todayIso
  const currentYear = Number(cappedIso.slice(0, 4))
  const monthDay = cappedIso.slice(5)
  const hasCurrentYearAtCappedDate = (dataset?.byDay?.[monthDay] || []).some((entry) => entry.year === currentYear)

  if (hasCurrentYearAtCappedDate) {
    return cappedIso
  }

  const byDayEntries = Object.entries(dataset?.byDay || {})
  const currentYearDates = byDayEntries
    .filter(([, series]) => series.some((entry) => entry.year === currentYear))
    .map(([dayKey]) => `${currentYear}-${dayKey}`)
    .filter((iso) => iso <= cappedIso)
    .sort()

  if (currentYearDates.length) {
    return currentYearDates[currentYearDates.length - 1]
  }

  return cappedIso
}

function formatDateWithoutYear(isoDate) {
  const [, month, day] = isoDate.split('-').map((part) => Number(part))
  const fakeDate = new Date(2024, month - 1, day)
  return new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'long',
  }).format(fakeDate)
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return 'n/d'
  return new Intl.NumberFormat('es-ES', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(value)
}
