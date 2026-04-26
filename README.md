# NYC Building Atlas

Interactive 3D map of New York City buildings with a curated skyline ribbon for major landmarks. Search an address, click a building, or jump through illustrated silhouettes to read age, zoning, ownership, historic district context, and landmark stories.

**100% free, no API keys, no credit card required.**

## Run

```
npm install
npm run dev
```

Open http://localhost:5173

## Data sources (all free, no auth)

- **Basemap tiles**: [CARTO dark-matter](https://carto.com/basemaps/) (OpenStreetMap data, Carto styling)
- **Building footprints**: [OpenStreetMap](https://www.openstreetmap.org/) via the [Overpass API](https://overpass-turbo.eu/)
- **Building details** (year built, owner, class, zoning): [NYC MapPLUTO](https://data.cityofnewyork.us/City-Government/MapPLUTO/f888-ni5f)
- **Landmark status**: [NYC Individual Landmarks](https://data.cityofnewyork.us/Housing-Development/Individual-Landmarks/ch5p-r223)

## Next ideas

- Cache PLUTO responses in `localStorage` by BBL
- Color buildings by year built (like the transit-time heatmap ref)
- Pull Wikipedia summaries for famous addresses
- Expand the local footprint dataset to full five-borough building geometry
