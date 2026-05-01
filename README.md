# The Skyline Project

Interactive 3D city maps built from open building data, landmark stories, and local texture. The project started as a New York City building atlas and now includes a San Francisco edition with citywide buildings, bridges, landmarks, and a toggleable startup-office view.

**Free to run locally. No API keys or paid map services required.**

## Maps

- **Landing page**: `/`
- **New York City**: `/nyc.html`
- **San Francisco**: `/sf.html`

## Features

- 3D building footprints rendered with MapLibre GL.
- City-specific datasets under `public/data/nyc` and `public/data/sf`.
- Curated landmark stories for skyline-scale buildings and bridges.
- Address search and click-to-inspect building panels.
- San Francisco startup view with logo pins for major AI/startup offices.
- Shared map engine with separate city configuration files.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Build

```bash
npm run build
```

The San Francisco buildings file is large, so Vite may also show a bundle-size warning for the app chunk. GitHub may warn that `public/data/sf/buildings.geojson` is larger than 50 MB.

## Project Structure

```text
index.html                 Landing page
nyc.html                   NYC map entry
sf.html                    SF map entry
src/main.js                Shared MapLibre engine
src/cities/nyc.js          NYC config
src/cities/nyc-landmarks.js
src/cities/sf.js           SF config
src/cities/sf-landmarks.js
public/data/nyc            NYC map data
public/data/sf             SF map data
scripts/export_nyc_buildings.mjs
scripts/export_sf_buildings.mjs
```

## Data Sources

- **Basemap tiles**: [CARTO dark-matter](https://carto.com/basemaps/) using OpenStreetMap data.
- **Building footprints**: [OpenStreetMap](https://www.openstreetmap.org/) via the [Overpass API](https://overpass-turbo.eu/).
- **NYC building details**: [NYC MapPLUTO](https://data.cityofnewyork.us/City-Government/MapPLUTO/f888-ni5f).
- **NYC landmarks**: [NYC Individual Landmarks](https://data.cityofnewyork.us/Housing-Development/Individual-Landmarks/ch5p-r223).
- **SF building attributes**: San Francisco open building/parcel data, normalized into local GeoJSON.
- **Startup office pins**: Curated from public company location listings and the Brex AI map reference.

## Notes

- NYC data was moved into `public/data/nyc` without changing the original NYC map content.
- SF uses its own dataset and configuration in `public/data/sf` and `src/cities/sf.js`.
- Startup pins are rendered as map symbols so they stay anchored while panning and zooming.
