/**
 * app.js — Comparador de temperaturas históricas
 * Carga ../data/all_data.json y renderiza la tabla comparativa
 */

'use strict';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------
const DATA_URL = '../data/all_data.json';

const START_YEAR = 1973;
const END_YEAR   = 2026;
const YEARS      = Array.from({ length: END_YEAR - START_YEAR + 1 }, (_, i) => START_YEAR + i);

const MONTH_NAMES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
];

const METRIC_LABELS = {
  media:  { label: 'Tª Media',      unit: '°C' },
  min:    { label: 'Tª Mínima',     unit: '°C' },
  max:    { label: 'Tª Máxima',     unit: '°C' },
  precip: { label: 'Precipitación', unit: 'mm' },
};

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // máx por mes (feb = 29)

// ---------------------------------------------------------------------------
// Estado global
// ---------------------------------------------------------------------------
let allData   = null;   // datos cargados del JSON
let curMonth  = 6;      // 1-12
let curMetric = 'media';

const today = new Date();
const CUR_YEAR  = today.getFullYear();
const CUR_MONTH = today.getMonth() + 1; // 1-12
const CUR_DAY   = today.getDate();

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const monthSelect  = document.getElementById('month-select');
const metricBtns   = document.querySelectorAll('.metric-btn');
const statusMsg    = document.getElementById('status-msg');
const tableWrapper = document.getElementById('table-wrapper');
const tableHead    = document.getElementById('table-head');
const tableBody    = document.getElementById('table-body');
const tableFoot    = document.getElementById('table-foot');
const tooltip      = document.getElementById('tooltip');

// ---------------------------------------------------------------------------
// Inicialización
// ---------------------------------------------------------------------------
async function init() {
  curMonth = CUR_MONTH <= END_YEAR ? CUR_MONTH : 6;
  monthSelect.value = String(curMonth);

  attachListeners();
  await loadData();
}

function attachListeners() {
  monthSelect.addEventListener('change', () => {
    curMonth = parseInt(monthSelect.value, 10);
    render();
  });

  metricBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      curMetric = btn.dataset.metric;
      metricBtns.forEach(b => b.classList.toggle('active', b === btn));
      render();
    });
  });
}

// ---------------------------------------------------------------------------
// Carga de datos
// ---------------------------------------------------------------------------
async function loadData() {
  try {
    const resp = await fetch(DATA_URL);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    allData = await resp.json();
    showStatus(null);
    render();
  } catch (err) {
    showStatus(
      `<strong>⚠️ No se encontraron datos.</strong><br>
      Parece que todavía no has ejecutado el scraper.<br><br>
      <strong>Pasos para obtener los datos:</strong><br>
      1. Instala las dependencias: <code>pip install -r scraper/requirements.txt</code><br>
      2. Ejecuta el scraper: <code>python scraper/scraper.py</code><br>
      3. Recarga esta página una vez finalizado.`,
      'error'
    );
    tableWrapper.classList.add('hidden');
  }
}

// ---------------------------------------------------------------------------
// Mensaje de estado
// ---------------------------------------------------------------------------
function showStatus(html, type = '') {
  if (!html) {
    statusMsg.classList.add('hidden');
    tableWrapper.classList.remove('hidden');
    return;
  }
  statusMsg.innerHTML = html;
  statusMsg.className = 'status-msg' + (type ? ` ${type}` : '');
  statusMsg.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Renderizado principal
// ---------------------------------------------------------------------------
function render() {
  if (!allData) return;

  const monthData = allData[String(curMonth)] || {};
  const maxDays   = DAYS_IN_MONTH[curMonth - 1];

  // Recopilar todos los valores visibles para calcular la escala de color
  const allValues = [];
  for (let day = 1; day <= maxDays; day++) {
    const dayData = monthData[String(day)] || {};
    for (const year of YEARS) {
      const v = dayData[String(year)]?.[curMetric];
      if (v != null) allValues.push(v);
    }
  }

  const minVal = allValues.length ? Math.min(...allValues) : 0;
  const maxVal = allValues.length ? Math.max(...allValues) : 1;

  // --- THEAD ---
  const headRow = document.createElement('tr');
  headRow.innerHTML = '<th>Día</th>';
  for (const year of YEARS) {
    const th = document.createElement('th');
    th.textContent = year;
    if (year === CUR_YEAR) th.classList.add('cur-year');
    headRow.appendChild(th);
  }
  tableHead.innerHTML = '';
  tableHead.appendChild(headRow);

  // --- TBODY ---
  tableBody.innerHTML = '';

  for (let day = 1; day <= maxDays; day++) {
    const dayData = monthData[String(day)] || {};
    const tr = document.createElement('tr');

    // ¿Es el día de hoy?
    if (curMonth === CUR_MONTH && day === CUR_DAY) {
      tr.classList.add('today-row');
    }

    // Celda de día
    const tdDay = document.createElement('td');
    tdDay.textContent = day;
    tr.appendChild(tdDay);

    for (const year of YEARS) {
      const td = document.createElement('td');
      const entry = dayData[String(year)];
      const val   = entry?.[curMetric];

      if (val != null) {
        td.textContent = formatVal(val);
        td.style.background = valueToColor(val, minVal, maxVal, curMetric);
        td.style.color = contrastColor(val, minVal, maxVal, curMetric);
        attachTooltip(td, day, year, val);
      } else {
        td.textContent = '–';
        td.style.color = 'var(--text-muted)';
      }

      if (year === CUR_YEAR) td.classList.add('cur-year');
      tr.appendChild(td);
    }

    tableBody.appendChild(tr);
  }

  // --- TFOOT (estadísticas: media del mes por año) ---
  const footRow = document.createElement('tr');
  const tdLabel = document.createElement('td');
  tdLabel.textContent = 'Media';
  footRow.appendChild(tdLabel);

  for (const year of YEARS) {
    const td = document.createElement('td');
    td.classList.add('stat-val');
    if (year === CUR_YEAR) td.classList.add('cur-year');

    // Media de todos los días del mes para ese año
    let sum = 0, count = 0;
    for (let day = 1; day <= maxDays; day++) {
      const v = (monthData[String(day)] || {})[String(year)]?.[curMetric];
      if (v != null) { sum += v; count++; }
    }
    td.textContent = count > 0 ? formatVal(sum / count) : '–';
    footRow.appendChild(td);
  }

  tableFoot.innerHTML = '';
  tableFoot.appendChild(footRow);
}

// ---------------------------------------------------------------------------
// Formato de valores
// ---------------------------------------------------------------------------
function formatVal(v) {
  if (v == null) return '–';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// ---------------------------------------------------------------------------
// Colorización
// ---------------------------------------------------------------------------
function valueToColor(val, min, max, metric) {
  if (min === max) return 'transparent';
  const t = (val - min) / (max - min); // 0..1

  if (metric === 'precip') {
    // Blanco → azul oscuro
    if (val === 0) return 'transparent';
    const r = Math.round(255 * (1 - t));
    const g = Math.round(255 * (1 - t * 0.8));
    const b = Math.round(200 + 55 * (1 - t)); // siempre algo azulado
    return `rgb(${r},${g},${b})`;
  }

  // Temperatura: azul → blanco → rojo
  if (t < 0.5) {
    const s = t / 0.5;
    const r = Math.round(50  + 205  * s);
    const g = Math.round(100 + 155  * s);
    const b = Math.round(220 + 35   * s);
    return `rgb(${r},${g},${b})`;
  } else {
    const s = (t - 0.5) / 0.5;
    const r = Math.round(255);
    const g = Math.round(255 - 205 * s);
    const b = Math.round(255 - 205 * s);
    return `rgb(${r},${g},${b})`;
  }
}

function contrastColor(val, min, max, metric) {
  // Texto oscuro en celdas muy claras
  if (min === max) return 'inherit';
  const t = (val - min) / (max - min);
  if (metric === 'precip') return t > 0.6 ? '#fff' : '#0f1117';
  // para temperaturas: extremos son oscuros (azul/rojo oscuro), centro claro
  if (t < 0.25 || t > 0.75) return '#fff';
  return '#0f1117';
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------
function attachTooltip(td, day, year, val) {
  td.addEventListener('mouseenter', (e) => {
    const unit  = METRIC_LABELS[curMetric].unit;
    const label = METRIC_LABELS[curMetric].label;
    const monthName = MONTH_NAMES[curMonth - 1];

    tooltip.innerHTML = `
      <div class="tt-date">${day} de ${monthName} de ${year}</div>
      <div class="tt-val">${label}: ${formatVal(val)} ${unit}</div>
    `;
    tooltip.classList.remove('hidden');
    positionTooltip(e);
  });

  td.addEventListener('mousemove', positionTooltip);

  td.addEventListener('mouseleave', () => {
    tooltip.classList.add('hidden');
  });
}

function positionTooltip(e) {
  const pad = 12;
  let x = e.clientX + pad;
  let y = e.clientY + pad;

  // Evitar que se salga de la ventana
  const tw = tooltip.offsetWidth  || 200;
  const th = tooltip.offsetHeight || 60;
  if (x + tw > window.innerWidth)  x = e.clientX - tw - pad;
  if (y + th > window.innerHeight) y = e.clientY - th - pad;

  tooltip.style.left = `${x}px`;
  tooltip.style.top  = `${y}px`;
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', init);
