// Download Central London building outlines from the official Ordnance Survey
// OS OpenMap Local ArcGIS service. The exporter joins these polygons only to
// GLA records whose published point lies inside the same outline.

import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('/private/tmp/central-london-os-buildings.geojson');
const ENDPOINT = 'https://services.arcgis.com/qHLhLQrcvEnxjtPr/arcgis/rest/services/OS_OpenMap_Local_Buildings/FeatureServer/1/query';
const ENVELOPE = {
  xmin: 527500,
  ymin: 175500,
  xmax: 539500,
  ymax: 184800,
  spatialReference: { wkid: 27700 }
};
const PAGE = 2000;

const features = [];
let offset = 0;
while (true) {
  const url = new URL(ENDPOINT);
  url.searchParams.set('where', '1=1');
  url.searchParams.set('geometry', JSON.stringify(ENVELOPE));
  url.searchParams.set('geometryType', 'esriGeometryEnvelope');
  url.searchParams.set('inSR', '27700');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', 'ID,OBJECTID');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('orderByFields', 'OBJECTID');
  url.searchParams.set('resultOffset', String(offset));
  url.searchParams.set('resultRecordCount', String(PAGE));
  url.searchParams.set('f', 'geojson');

  const response = await fetch(url);
  if (!response.ok) throw new Error(`OS OpenMap Local request failed: ${response.status}`);
  const page = await response.json();
  if (page.error) throw new Error(JSON.stringify(page.error));
  const rows = page.features || [];
  features.push(...rows);
  process.stdout.write(`\rfetched ${features.length.toLocaleString()} official OS footprints`);
  if (rows.length < PAGE) break;
  offset += PAGE;
}

await fs.writeFile(OUT, JSON.stringify({ type: 'FeatureCollection', features }));
process.stdout.write('\n');
console.log(`wrote ${OUT} · ${features.length.toLocaleString()} official OS footprints`);
