import './style.css'
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
const today = new Date()
const maxDate = toIsoDate(today)
const DEFAULT_STATION_CODE = '82210'

let chart
let weatherData
let stationCatalog = []
let stationCode = DEFAULT_STATION_CODE

document.querySelector('#app').innerHTML = `
  <main class="layout">
    <header class="hero">
      <div class="hero-top">
        <div>
          <p id="heroStation" class="eyebrow">No Se Calienta · Estacion ${DEFAULT_STATION_CODE}</p>
          <h1>Evolucion climatica por dia del año</h1>
          <p class="subtitle">
            Compara la temperatura maxima, minima, media y la precipitacion del mismo dia
            desde ${START_YEAR} hasta hoy.
          </p>
        </div>
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

bootstrap().catch((error) => {
  selectionInfo.textContent = 'No se pudo cargar el dataset.'
  insights.innerHTML = `
    <article class="insight error">
      <h2>Error al cargar datos</h2>
      <p>${error.message}</p>
      <p>Ejecuta <code>npm run scrape</code> para generar <code>public/weather-history.json</code>.</p>
    </article>
  `
})

async function bootstrap() {
  await loadStationCatalog()
  await loadStationData(stationCode)

  stationSelect.addEventListener('change', async () => {
    stationCode = stationSelect.value
    await loadStationData(stationCode)
    renderForDate(dateInput.value)
  })

  dateInput.addEventListener('change', () => {
    renderForDate(dateInput.value)
  })

  renderForDate(dateInput.value)
}

async function loadStationCatalog() {
  stationCatalog = []

  let discovered = []
  let datasets = []
  let defaultFromDataset = ''

  try {
    const discoveredResponse = await fetch('/stations-index.json', { cache: 'no-store' })
    if (discoveredResponse.ok) {
      const discoveredPayload = await discoveredResponse.json()
      discovered = (discoveredPayload.stations || []).map((station) => ({
        code: station.code,
        name: station.name || `Estacion ${station.code}`,
      }))
    }
  } catch {
    // Ignore and fallback below.
  }

  try {
    const dataIndexResponse = await fetch('/weather-history-index.json', { cache: 'no-store' })
    if (dataIndexResponse.ok) {
      const dataIndexPayload = await dataIndexResponse.json()
      datasets = dataIndexPayload.stations || []
      defaultFromDataset = dataIndexPayload.defaultStation || ''
    }
  } catch {
    // Ignore and fallback below.
  }

  const datasetByCode = new Map(
    datasets.map((station) => [station.code, { file: station.file, recordsCount: station.recordsCount }]),
  )

  if (discovered.length) {
    stationCatalog = discovered.map((station) => {
      const knownDataset = datasetByCode.get(station.code)
      return {
        ...station,
        file: knownDataset?.file || `/stations/data/ws-${station.code}.json`,
        hasLocalData: Boolean(knownDataset),
      }
    })
  } else if (datasets.length) {
    stationCatalog = datasets.map((station) => ({
      code: station.code,
      name: station.name || `Estacion ${station.code}`,
      file: station.file || `/stations/data/ws-${station.code}.json`,
      hasLocalData: true,
    }))
  } else {
    stationCatalog = [
      {
        code: DEFAULT_STATION_CODE,
        name: 'Madrid / Barajas',
        file: '/weather-history.json',
        hasLocalData: true,
      },
    ]
  }

  const firstWithData = stationCatalog.find((station) => station.hasLocalData)
  stationCode =
    defaultFromDataset || firstWithData?.code || stationCatalog[0]?.code || DEFAULT_STATION_CODE

  stationSelect.innerHTML = stationCatalog
    .map((station) => {
      const suffix = station.hasLocalData ? '' : ' · sin datos locales'
      return `<option value="${station.code}">${station.name} (${station.code})${suffix}</option>`
    })
    .join('')
  stationSelect.value = stationCode
}

async function loadStationData(code) {
  const station = stationCatalog.find((item) => item.code === code)
  if (!station) {
    throw new Error(`No se encontro la estacion ${code}.`)
  }

  const filePath = station.file || `/stations/data/ws-${station.code}.json`
  const response = await fetch(filePath, { cache: 'no-store' })

  if (!response.ok) {
    throw new Error(
      `No hay datos locales para ${station.name} (${station.code}). Ejecuta scrape para esa estacion o usa npm run scrape:all.`,
    )
  }

  weatherData = await response.json()
  heroStation.textContent = `No Se Calienta · ${station.name} · Estacion ${station.code}`
}

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
        <p>Prueba con otro dia. En fechas especiales (como 29 de febrero) hay menos anos disponibles.</p>
      </article>
    `

    if (chart) {
      chart.destroy()
      chart = undefined
    }
    return
  }

  const stats = buildStats(series)
  renderSummaryCards(stats, dateLabel)
  renderInsights(stats, dateLabel)
  renderChart(series, dateLabel)
}

function renderSummaryCards(stats, dateLabel) {
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
}

function renderInsights(stats, dateLabel) {
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

  if (chart) {
    chart.destroy()
  }

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
