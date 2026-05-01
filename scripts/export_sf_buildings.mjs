// Export SF building footprints in the exact same shape as NYC's
// public/data/nyc/buildings.geojson — `{bin, y, h}` per feature.
//
//   bin = stable numeric id (derived from DataSF sf16_bldgid)
//   y   = year built (int or null) joined from the assessor parcel table
//   h   = roof height in feet (from LiDAR-derived hgt_median_m)
//
// Data sources:
//   ynuv-fyni  SF building footprints + heights
//   wv5m-vpq2  Historic Secured Property Tax Roll (year_property_built)
//
// Output: public/data/sf/buildings.geojson

import fs from 'node:fs/promises';
import path from 'node:path';

const PAGE = 5000;

// SF citywide coverage, with a little room around the northern waterfront and
// bridge approaches. DataSF's footprint source is San Francisco-scoped, so this
// rectangle broadens coverage without pulling in non-SF building datasets.
const BBOX = { minLat: 37.68, minLng: -122.53, maxLat: 37.84, maxLng: -122.34 };

async function fetchAll(url, where, select, order) {
  const out = [];
  let offset = 0;
  let page;
  do {
    const u = new URL(url);
    u.searchParams.set('$select', select);
    if (where) u.searchParams.set('$where', where);
    if (order) u.searchParams.set('$order', order);
    u.searchParams.set('$limit', String(PAGE));
    u.searchParams.set('$offset', String(offset));
    const res = await fetch(u);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${url} ${res.status} at offset ${offset}${body ? `\n${body}` : ''}`);
    }
    page = await res.json();
    out.push(...page);
    offset += PAGE;
    process.stderr.write(`  ${url.split('/').pop()} +${page.length} → ${out.length}\n`);
  } while (page.length === PAGE);
  return out;
}

function round5(n) { return Math.round(n * 1e5) / 1e5; }

function shrinkGeom(geom) {
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
  // 1) Year per parcel — current closed roll only.
  process.stderr.write('Fetching parcel years (closed roll 2024)…\n');
  const yearRows = await fetchAll(
    'https://data.sfgov.org/resource/wv5m-vpq2.json',
    "closed_roll_year = '2024' AND year_property_built IS NOT NULL",
    'parcel_number,year_property_built',
    'parcel_number'
  );
  const yearByParcel = new Map();
  for (const r of yearRows) {
    if (!r.parcel_number || !r.year_property_built) continue;
    const y = parseInt(r.year_property_built, 10);
    if (y > 1700 && y < 2030) yearByParcel.set(r.parcel_number, y);
  }
  process.stderr.write(`  → ${yearByParcel.size} parcels with year built\n`);

  // 2) Building footprints + height in our bbox.
  process.stderr.write('Fetching SF building footprints + heights…\n');
  // DataSF exposes hgt_median_m as text, so keep the Socrata filter spatial
  // and do the numeric height threshold in JS below.
  const where = `hgt_median_m IS NOT NULL ` +
    `AND within_box(shape, ${BBOX.maxLat}, ${BBOX.minLng}, ${BBOX.minLat}, ${BBOX.maxLng})`;
  const buildings = await fetchAll(
    'https://data.sfgov.org/resource/ynuv-fyni.json',
    where,
    'sf16_bldgid,mblr,hgt_median_m,shape',
    'sf16_bldgid'
  );
  process.stderr.write(`  → ${buildings.length} building footprints\n`);

  // 3) Build features. mblr = "SF" + parcel_number; strip "SF" to join.
  const features = [];
  let withYear = 0;
  for (const b of buildings) {
    if (!b.shape) continue;
    const mblr = b.mblr || '';
    const parcel = mblr.startsWith('SF') ? mblr.slice(2) : mblr;
    const y = parcel ? (yearByParcel.get(parcel) ?? null) : null;

    const heightM = parseFloat(b.hgt_median_m);
    if (!Number.isFinite(heightM) || heightM <= 0) continue;
    const h = Math.round(heightM * 3.28084 * 10) / 10;
    if (h < 18) continue;  // drop sheds / 1-story outbuildings

    // Stable numeric BIN from sf16_bldgid like "201006.0000003"
    const idDigits = String(b.sf16_bldgid || '').replace(/[^0-9]/g, '');
    const bin = idDigits ? parseInt(idDigits.slice(-9), 10) : null;
    if (!bin) continue;
    if (y) withYear++;

    features.push({
      type: 'Feature',
      properties: { bin, y, h },
      geometry: shrinkGeom(b.shape)
    });
  }

  process.stderr.write(`Final: ${features.length} buildings (${withYear} with year)\n`);

  const fc = { type: 'FeatureCollection', features };
  const out = path.resolve('public/data/sf/buildings.geojson');
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(fc));
  const stat = await fs.stat(out);
  console.log(`wrote ${out} · ${(stat.size / 1e6).toFixed(2)} MB`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
