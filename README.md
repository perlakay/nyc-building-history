# The Skyline Project

Interactive 3D city maps built from open building data, landmark stories, and local texture. The project started as a New York City building atlas and now includes editions for San Francisco and Central London.

**Free to run locally. No API keys or paid map services required.**

## Maps

- **Landing page**: `/`
- **New York City**: `/nyc.html`
- **San Francisco**: `/sf.html`
- **Central London**: `/london.html`

## Features

- 3D building footprints rendered with MapLibre GL.
- City-specific datasets under `public/data/nyc` and `public/data/sf`.
- Central London edition built from official Ordnance Survey OpenMap Local footprints and published GLA construction-age bands.
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
london.html                London map entry
src/main.js                Shared MapLibre engine
src/cities/nyc.js          NYC config
src/cities/nyc-landmarks.js
src/cities/sf.js           SF config
src/cities/sf-landmarks.js
src/cities/london.js       London config
src/cities/london-landmarks.js
public/data/nyc            NYC map data
public/data/sf             SF map data
public/data/london         London map data
scripts/export_nyc_buildings.mjs
scripts/export_sf_buildings.mjs
scripts/export_london_buildings.mjs
```

## Data Sources

- **Basemap tiles**: [CARTO dark-matter](https://carto.com/basemaps/) using OpenStreetMap data.
- **NYC/SF building parts**: [OpenStreetMap](https://www.openstreetmap.org/) via the [Overpass API](https://overpass-turbo.eu/).
- **NYC building details**: [NYC MapPLUTO](https://data.cityofnewyork.us/City-Government/MapPLUTO/f888-ni5f).
- **NYC landmarks**: [NYC Individual Landmarks](https://data.cityofnewyork.us/Housing-Development/Individual-Landmarks/ch5p-r223).
- **SF building attributes**: San Francisco open building/parcel data, normalized into local GeoJSON.
- **London footprints**: [Ordnance Survey OS OpenMap Local](https://osdatahub.os.uk/downloads/open/OpenMapLocal).
- **London construction-age bands**: [GLA London Building Stock Model 2](https://data.london.gov.uk/dataset/london-building-stock-model-2-lbsm-2-2k55d/), applied only where the record point is inside an official OS footprint.
- **Startup office pins**: Curated from public company location listings and the Brex AI map reference.

## Notes

- NYC data was moved into `public/data/nyc` without changing the original NYC map content.
- SF uses its own dataset and configuration in `public/data/sf` and `src/cities/sf.js`.
- London uses residential-focused LBSM 2 construction-age bands only where a GLA record point falls inside an official OS OpenMap Local footprint; unmatched buildings are shown neutrally.
- Startup pins are rendered as map symbols so they stay anchored while panning and zooming.
