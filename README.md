# 🌡️ ¿Se está calentando?

Comparador de temperaturas históricas con ironía.

Consulta datos diarios de temperatura media, mínima, máxima y precipitación desde **1973 hasta 2026** para la estación meteorológica **ws-82210**, y compáralos año a año en una tabla interactiva con escala de colores.

---

## Estructura del proyecto

```
no-se-calienta/
├── README.md
├── scraper/
│   ├── scraper.py          # Script de scraping
│   └── requirements.txt    # requests, beautifulsoup4, lxml
├── data/
│   └── .gitkeep            # Los JSON generados irán aquí
└── web/
    ├── index.html
    ├── style.css
    └── app.js
```

---

## 1. Instalar dependencias del scraper

```bash
pip install -r scraper/requirements.txt
```

## 2. Ejecutar el scraper

```bash
python scraper/scraper.py
```

El script recorre todas las URLs del patrón `https://www.tutiempo.net/clima/MM-YYYY/ws-82210.html` (desde enero de 1973 hasta junio de 2026), extrae los datos diarios y los guarda en la carpeta `data/`:

- Un archivo por mes: `data/YYYY_MM.json`
- Un archivo consolidado: `data/all_data.json` (necesario para la web)

Si un mes ya ha sido descargado, el script lo salta y usa la caché local.

## 3. Abrir la web

Abre `web/index.html` directamente en tu navegador, **o** usa un servidor local para evitar restricciones CORS al cargar el JSON:

```bash
# Con Python 3
cd web
python -m http.server 8080
# Luego abre http://localhost:8080
```

Si todavía no has ejecutado el scraper, la web mostrará un mensaje explicando los pasos a seguir.

---

## Funcionalidades de la web

- **Selector de mes** (enero–diciembre)
- **4 métricas**: Tª Media · Tª Mínima · Tª Máxima · Precipitación
- **Tabla comparativa**: filas = días, columnas = años (1973–2026)
- **Colorización por escala de calor**: azul (frío) → blanco → rojo (calor) para temperaturas; blanco → azul oscuro para precipitaciones
- **Fila de medias** al pie de la tabla por año
- **Tooltip** con fecha completa y valor exacto al pasar el ratón
- **Año actual (2026)** destacado visualmente
- Diseño oscuro y responsive

---

## Fuente de datos

[tutiempo.net](https://www.tutiempo.net) · Estación meteorológica **ws-82210**
