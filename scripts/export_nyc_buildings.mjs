// Re-export Manhattan building footprints from NYC DOITT (5zhs-2jue) with
// `bin` (Building Identification Number) attached to each feature, so the
// search-pin can match by BIN against NYC Geosearch's `addendum.pad.bin`.
//
// Usage: node scripts/export_buildings.mjs
// Output: public/data/nyc/buildings.geojson

import fs from 'node:fs/promises';
import path from 'node:path';

const ENDPOINT = 'https://data.cityofnewyork.us/resource/5zhs-2jue.json';

// Bounding box matches the existing dataset's coverage (Manhattan + small bleed).
const BBOX = { minLat: 40.6843, minLng: -74.0473, maxLat: 40.8787, maxLng: -73.9066 };

// Manhattan BINs start with 1 (1_000_000 – 1_999_999).
const WHERE = [
  `feature_code='2100'`,
  `height_roof >= 10`,
  `bin >= 1000000 AND bin < 2000000`,
  `within_box(the_geom, ${BBOX.maxLat}, ${BBOX.minLng}, ${BBOX.minLat}, ${BBOX.maxLng})`
].join(' AND ');

const PAGE = 5000;
const SELECT = 'bin,construction_year,height_roof,the_geom';

async function fetchPage(offset) {
  const url = new URL(ENDPOINT);
  url.searchParams.set('$select', SELECT);
  url.searchParams.set('$where', WHERE);
  url.searchParams.set('$order', 'bin');
  url.searchParams.set('$limit', String(PAGE));
  url.searchParams.set('$offset', String(offset));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Socrata ${res.status} at offset ${offset}: ${await res.text().catch(() => '')}`);
  return res.json();
}

function round5(n) {
  // 5 decimal places ≈ 1 m precision — keeps file size reasonable.
  return Math.round(n * 1e5) / 1e5;
}

function shrinkGeom(geom) {
  // Round all coordinates to 5dp; keep MultiPolygon structure.
  if (!geom) return null;
  const rounded = JSON.parse(JSON.stringify(geom));
  const walk = (arr) => {
    if (typeof arr[0] === 'number') {
      arr[0] = round5(arr[0]);
      arr[1] = round5(arr[1]);
    } else for (const x of arr) walk(x);
  };
  walk(rounded.coordinates);
  return rounded;
}

(async () => {
  const features = [];
  let offset = 0;
  let page;
  do {
    process.stdout.write(`\rfetching offset=${offset.toString().padStart(7)}…`);
    page = await fetchPage(offset);
    for (const row of page) {
      if (!row.the_geom || !row.bin) continue;
      const h = parseFloat(row.height_roof);
      const y = row.construction_year ? parseInt(row.construction_year, 10) : null;
      if (!Number.isFinite(h) || h <= 0) continue;
      features.push({
        type: 'Feature',
        properties: {
          bin: parseInt(row.bin, 10),
          y: y && y > 1700 ? y : null,
          h: Math.round(h * 10) / 10
        },
        geometry: shrinkGeom(row.the_geom)
      });
    }
    offset += PAGE;
  } while (page.length === PAGE);

  process.stdout.write(`\rfetched ${features.length} features in ${offset / PAGE} pages          \n`);

  const fc = { type: 'FeatureCollection', features };
  const out = path.resolve('public/data/nyc/buildings.geojson');
  // Compact JSON (no whitespace) to keep the file small.
  await fs.writeFile(out, JSON.stringify(fc));
  const stat = await fs.stat(out);
  console.log(`wrote ${out} · ${(stat.size / 1e6).toFixed(2)} MB · ${features.length.toLocaleString()} buildings`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
