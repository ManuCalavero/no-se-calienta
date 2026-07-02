# No Se Calienta

Comparador de evolucion climatica para Madrid/Barajas (estacion 82210), con datos diarios historicos.

## Que muestra

- Temperatura maxima (TM), minima (Tm) y media (T).
- Precipitacion (PP).
- Evolucion ano por ano para el mismo dia seleccionado.

La fecha por defecto es hoy, y puedes seleccionar cualquier fecha hacia atras.

## Fuente de datos

Datos scrapeados desde:

- https://www.tutiempo.net/clima/MM-YYYY/ws-82210.html

Rango configurado: 1976 hasta hoy.

## Uso

1. Instalar dependencias:

```bash
npm install
```

2. Generar dataset historico:

```bash
npm run scrape
```

3. Lanzar la aplicacion:

```bash
npm run dev
```

El scraping genera `public/weather-history.json`.
