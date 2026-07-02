# No Se Calienta

Comparador de evolucion climatica diario por estacion meteorologica, con datos historicos.

## Que muestra

- Temperatura maxima (TM), minima (Tm) y media (T).
- Precipitacion (PP).
- Evolucion ano por ano para el mismo dia seleccionado.
- Selector de estacion (cuando existe indice multiestacion).

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

3. Generar dataset historico de una estacion (por defecto 82210):

```bash
npm run scrape
```

4. Generar dataset historico para todas las estaciones descubiertas:

```bash
npm run scrape:all
```

Tambien puedes limitar estaciones para una prueba rapida:

```bash
node scripts/scrape-weather.mjs --all --limit=5
```

5. Lanzar la aplicacion:

```bash
npm run dev
```

Archivos generados:

- `public/stations-index.json`: catalogo descubierto de estaciones.
- `public/weather-history-index.json`: indice de datasets ya scrapeados.
- `public/stations/data/ws-XXXX.json`: dataset por estacion.
- `public/weather-history.json`: compatibilidad para ejecucion de una sola estacion.
