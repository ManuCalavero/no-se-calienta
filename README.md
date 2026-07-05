# No Se Calienta

Comparador de evolucion climatica diario por estacion meteorologica, con home de mapa de Espana.

## Que muestra

- Temperatura maxima (TM), minima (Tm) y media (T).
- Precipitacion (PP).
- Evolucion ano por ano para el mismo dia seleccionado.
- Home con mapa de Espana y estaciones geolocalizadas.
- Ruta por estacion: `/estacion/CODIGO`.

La fecha por defecto es hoy, y puedes seleccionar cualquier fecha hacia atras.

## Fuente de datos

Datos scrapeados desde:

- https://www.tutiempo.net/clima/MM-YYYY/ws-CODIGO.html

Rango configurado: 1976 hasta hoy.

## Uso

1. Instalar dependencias:

```bash
npm install
```

2. Descubrir estaciones disponibles en la web:

```bash
npm run discover:stations
```

3. Construir indice geolocalizado de estaciones de Espana:

```bash
npm run build:spain-stations
```

4. Generar dataset historico de una estacion (por defecto 82210):

```bash
npm run scrape
```

5. Generar dataset historico para todas las estaciones descubiertas:

```bash
npm run scrape:all
```

Actualizacion incremental (recomendado):

```bash
# Solo estaciones de Espana (usa public/stations-spain.json)
npm run scrape:spain

# Una estacion concreta
node scripts/scrape-weather.mjs --station=82210

# Forzar recalculo completo (sin incremental)
node scripts/scrape-weather.mjs --spain --full
```

Tambien puedes limitar estaciones para una prueba rapida:

```bash
node scripts/scrape-weather.mjs --all --limit=5
```

6. Lanzar la aplicacion:

```bash
npm run dev
```

Archivos generados:

- `public/stations-index.json`: catalogo descubierto de estaciones.
- `public/stations-spain.json`: estaciones de Espana geolocalizadas (lat/lon).
- `public/weather-history-index.json`: indice de datasets ya scrapeados.
- `public/stations/data/ws-XXXX.json`: dataset por estacion.
- `public/weather-history.json`: compatibilidad para ejecucion de una sola estacion.

## Actualizacion automatica diaria

Hay un workflow para actualizar datos automaticamente:

- `.github/workflows/update-weather-data.yml`

Comportamiento:

- Diario a las 06:00 UTC: actualiza estaciones de Espana en modo incremental.
- Manual (`workflow_dispatch`): permite elegir modo `station`, `spain` o `all`.
- Si hay cambios en JSON, hace commit y push automaticamente.

## Proxy AEMET con Cloudflare (basico)

Archivos ya preparados en el repo:

- `workers/aemet-proxy.js`
- `wrangler.toml`

Pasos:

1. Instalar y autenticar Wrangler:

```bash
npm i -g wrangler
wrangler login
```

2. Guardar tu key como secret (no se expone al frontend):

```bash
wrangler secret put AEMET_API_KEY
```

3. Desplegar el Worker:

```bash
wrangler deploy
```

4. Probar endpoints:

```bash
curl "https://TU-WORKER.workers.dev/aemet/estaciones"
curl "https://TU-WORKER.workers.dev/aemet/diarios/3195?start=2024-01-01&end=2024-01-31"
```

Notas:

- El Worker aplica cache (`CACHE_TTL_SECONDS`, por defecto 300s).
- Si AEMET responde con limite de caudal, el Worker devuelve `429` con `Retry-After: 60`.
- Para produccion, cambia `ALLOWED_ORIGIN` en `wrangler.toml` a tu dominio.
