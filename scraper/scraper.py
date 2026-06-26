#!/usr/bin/env python3
"""
Scraper para tutiempo.net - Estación ws-82210
Extrae datos de temperatura y precipitación históricos desde 1973 hasta 2026.
"""

import os
import json
import time
import random
import logging
from datetime import date

import requests
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------

BASE_URL = "https://www.tutiempo.net/clima/{month:02d}-{year}/ws-82210.html"
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")

START_YEAR = 1973
START_MONTH = 1
END_YEAR = 2026
END_MONTH = 6  # junio 2026

MAX_RETRIES = 3
DELAY_MIN = 1.0
DELAY_MAX = 2.0

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Scraping helpers
# ---------------------------------------------------------------------------

def fetch_page(url: str) -> str | None:
    """Descarga una URL con reintentos. Devuelve el HTML o None si falla."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=30)
            if resp.status_code == 200:
                return resp.text
            log.warning("HTTP %s para %s (intento %d/%d)", resp.status_code, url, attempt, MAX_RETRIES)
        except requests.RequestException as exc:
            log.warning("Error de red en %s (intento %d/%d): %s", url, attempt, MAX_RETRIES, exc)
        if attempt < MAX_RETRIES:
            time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))
    log.error("No se pudo obtener %s tras %d intentos", url, MAX_RETRIES)
    return None


def parse_float(value: str) -> float | None:
    """Convierte un string a float, devuelve None si no es válido."""
    if not value or value.strip() in ("", "-", "–", "—"):
        return None
    try:
        return float(value.strip().replace(",", "."))
    except ValueError:
        return None


def parse_month(html: str, year: int, month: int) -> dict:
    """
    Parsea la tabla de datos diarios de una página de tutiempo.net.

    Devuelve un dict con estructura:
        {
          "year": int,
          "month": int,
          "days": {
            "1": {"media": float|null, "min": float|null, "max": float|null, "precip": float|null},
            ...
          }
        }
    """
    soup = BeautifulSoup(html, "lxml")
    days: dict[str, dict] = {}

    # La tabla principal tiene id="listal" o class que contiene datos climáticos.
    # Buscamos todas las tablas y usamos la que tenga las columnas T, TM, Tm, PP.
    table = None
    for t in soup.find_all("table"):
        headers_row = t.find("tr")
        if headers_row:
            headers_text = [th.get_text(strip=True) for th in headers_row.find_all(["th", "td"])]
            if "T" in headers_text and "TM" in headers_text and "Tm" in headers_text:
                table = t
                break

    if table is None:
        log.debug("No se encontró tabla para %d/%02d", year, month)
        return {"year": year, "month": month, "days": {}}

    # Mapear índices de columna
    header_row = table.find("tr")
    col_names = [th.get_text(strip=True) for th in header_row.find_all(["th", "td"])]

    def col_idx(name: str) -> int | None:
        try:
            return col_names.index(name)
        except ValueError:
            return None

    idx_day = col_idx("Día") or col_idx("Day") or 0
    idx_T = col_idx("T")
    idx_TM = col_idx("TM")
    idx_Tm = col_idx("Tm")
    idx_PP = col_idx("PP")

    for row in table.find_all("tr")[1:]:
        cells = row.find_all(["td", "th"])
        if not cells:
            continue

        # Verificar que la primera celda sea un número de día
        day_text = cells[idx_day].get_text(strip=True) if idx_day < len(cells) else ""
        if not day_text.isdigit():
            continue
        day_num = int(day_text)

        def get_val(idx):
            if idx is None or idx >= len(cells):
                return None
            return parse_float(cells[idx].get_text(strip=True))

        days[str(day_num)] = {
            "media": get_val(idx_T),
            "min": get_val(idx_Tm),
            "max": get_val(idx_TM),
            "precip": get_val(idx_PP),
        }

    return {"year": year, "month": month, "days": days}


# ---------------------------------------------------------------------------
# Persistencia
# ---------------------------------------------------------------------------

def save_month(data: dict) -> None:
    """Guarda los datos de un mes en data/YYYY_MM.json"""
    os.makedirs(DATA_DIR, exist_ok=True)
    filename = os.path.join(DATA_DIR, f"{data['year']}_{data['month']:02d}.json")
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_month(year: int, month: int) -> dict | None:
    """Carga los datos de un mes desde disco si existen."""
    filename = os.path.join(DATA_DIR, f"{year}_{month:02d}.json")
    if os.path.exists(filename):
        with open(filename, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def build_all_data(months: list[dict]) -> dict:
    """
    Construye el JSON consolidado organizado por mes → día → año.

        {
          "1": {          # mes
            "1": {        # día
              "1973": { "media": ..., "min": ..., "max": ..., "precip": ... },
              ...
            }
          }
        }
    """
    all_data: dict = {}
    for month_data in months:
        m = str(month_data["month"])
        y = str(month_data["year"])
        if m not in all_data:
            all_data[m] = {}
        for day, vals in month_data["days"].items():
            if day not in all_data[m]:
                all_data[m][day] = {}
            all_data[m][day][y] = vals
    return all_data


def save_all_data(all_data: dict) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    filename = os.path.join(DATA_DIR, "all_data.json")
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(all_data, f, ensure_ascii=False, separators=(",", ":"))
    log.info("Guardado %s", filename)


# ---------------------------------------------------------------------------
# Iteración principal
# ---------------------------------------------------------------------------

def iter_months():
    """Genera (year, month) desde START hasta END, inclusive."""
    year, month = START_YEAR, START_MONTH
    while (year, month) <= (END_YEAR, END_MONTH):
        yield year, month
        month += 1
        if month > 12:
            month = 1
            year += 1


def main():
    log.info("Iniciando scraper tutiempo.net (ws-82210)")
    log.info("Rango: %d/%02d → %d/%02d", START_YEAR, START_MONTH, END_YEAR, END_MONTH)

    all_months: list[dict] = []
    total = sum(1 for _ in iter_months())
    processed = 0

    for year, month in iter_months():
        processed += 1
        pct = processed / total * 100

        # Si ya existe el archivo, cargamos y saltamos la petición
        cached = load_month(year, month)
        if cached is not None:
            log.info("[%3.0f%%] ✓ Cache  %d/%02d (%d días)", pct, year, month, len(cached["days"]))
            all_months.append(cached)
            continue

        url = BASE_URL.format(month=month, year=year)
        log.info("[%3.0f%%] ↓ Fetch  %d/%02d  %s", pct, year, month, url)

        html = fetch_page(url)
        if html is None:
            month_data = {"year": year, "month": month, "days": {}}
        else:
            month_data = parse_month(html, year, month)

        log.info("        %d días extraídos", len(month_data["days"]))
        save_month(month_data)
        all_months.append(month_data)

        # Delay cortés entre peticiones
        time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))

    log.info("Construyendo all_data.json…")
    all_data = build_all_data(all_months)
    save_all_data(all_data)
    log.info("¡Scraping completado! %d meses procesados.", len(all_months))


if __name__ == "__main__":
    main()
