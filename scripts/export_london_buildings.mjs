import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const lbsmPath = process.env.LONDON_LBSM_CSV || '/private/tmp/LBSMv2_London.zip';
const footprintPath = process.env.LONDON_OS_FOOTPRINTS || '/private/tmp/central-london-os-buildings.geojson';
const outDir = path.join(root, 'public/data/london');
const OSGB_BOUNDS = { minE: 527500, minN: 175500, maxE: 539500, maxN: 184800 };
const FOOTPRINT_RETRIEVED_ON = process.env.LONDON_FOOTPRINT_DATE || '2026-05-24';

const LANDMARKS = [
  { id: 'buckingham-palace', name: 'Buckingham Palace', coords: [-0.1419, 51.5014], h: 79 },
  { id: 'palace-westminster', name: 'Palace of Westminster', coords: [-0.12463, 51.49952], h: 316 },
  { id: 'westminster-abbey', name: 'Westminster Abbey', coords: [-0.1275, 51.4993], h: 225 },
  { id: 'london-eye', name: 'London Eye', coords: [-0.1195, 51.5033], h: 443 },
  { id: 'british-museum', name: 'British Museum', coords: [-0.1269, 51.5194], h: 70 },
  { id: 'somerset-house', name: 'Somerset House', coords: [-0.1175, 51.5111], h: 65 },
  { id: 'st-pauls', name: "St Paul's Cathedral", coords: [-0.09835, 51.51385], h: 365 },
  { id: 'tate-modern', name: 'Tate Modern', coords: [-0.0993, 51.5076], h: 325 },
  { id: 'the-shard', name: 'The Shard', coords: [-0.0865, 51.5045], h: 1016 },
  { id: 'guildhall', name: 'Guildhall', coords: [-0.09175, 51.51586], h: 75 },
  { id: 'mansion-house', name: 'Mansion House', coords: [-0.08904, 51.51263], h: 58 },
  { id: 'royal-exchange', name: 'Royal Exchange', coords: [-0.08748, 51.51312], h: 70 },
  { id: 'lloyds', name: "Lloyd's Building", coords: [-0.08317, 51.51282], h: 289 },
  { id: 'leadenhall', name: 'The Leadenhall Building', coords: [-0.08228, 51.51389], h: 737 },
  { id: 'walkie-talkie', name: '20 Fenchurch Street', coords: [-0.08355, 51.51130], h: 525 },
  { id: 'barbican-centre', name: 'Barbican Centre', coords: [-0.09313, 51.52014], h: 132 },
  { id: 'tower-of-london', name: 'Tower of London', coords: [-0.0761, 51.5081], h: 90 },
  { id: 'tower-bridge', name: 'Tower Bridge', coords: [-0.0754, 51.5055], h: 213 },
  { id: 'london-bridge', name: 'London Bridge', coords: [-0.08745, 51.50857], h: 45 }
];

// NYC includes bridges as deliberate crossing geometry, rather than snapping
// them to a nearby building. London uses that same contract.
const BRIDGE_FEATURES = {
  'tower-bridge': {
    type: 'Polygon',
    coordinates: [[[-0.07593, 51.50669], [-0.07523, 51.50383], [-0.07499, 51.50386], [-0.07569, 51.50673], [-0.07593, 51.50669]]]
  },
  'london-bridge': {
    type: 'Polygon',
    coordinates: [[[-0.08815, 51.5097], [-0.08679, 51.50735], [-0.08655, 51.50741], [-0.08791, 51.50976], [-0.08815, 51.5097]]]
  }
};

// A few landmark sites are not represented as one useful OS building polygon:
// station complexes swallow The Shard, courtyards split Somerset House and
// the Barbican, and Lloyd's needs its recognisable footprint rather than a
// neighbouring tower. These lightweight curated outlines keep the landmark
// highlight attached to the thing the visitor selected.
const CURATED_LANDMARK_FOOTPRINTS = {
  'the-shard': {
    type: 'Polygon',
    coordinates: [[
      [-0.08684, 51.50467], [-0.08675, 51.50435], [-0.08649, 51.50430],
      [-0.08627, 51.50447], [-0.08639, 51.50472], [-0.08666, 51.50478],
      [-0.08684, 51.50467]
    ]]
  },
  'somerset-house': {
    type: 'Polygon',
    coordinates: [[
      [-0.11865, 51.51138], [-0.11681, 51.51139], [-0.11673, 51.51065],
      [-0.11862, 51.51063], [-0.11865, 51.51138]
    ], [
      [-0.11823, 51.51118], [-0.11717, 51.51118], [-0.11716, 51.51083],
      [-0.11822, 51.51083], [-0.11823, 51.51118]
    ]]
  },
  lloyds: {
    type: 'Polygon',
    coordinates: [[
      [-0.08355, 51.51307], [-0.08302, 51.51313], [-0.08283, 51.51281],
      [-0.08300, 51.51256], [-0.08345, 51.51259], [-0.08355, 51.51307]
    ]]
  },
  'barbican-centre': {
    type: 'Polygon',
    coordinates: [[
      [-0.09420, 51.52058], [-0.09247, 51.52058], [-0.09247, 51.51978],
      [-0.09302, 51.51965], [-0.09416, 51.51975], [-0.09420, 51.52058]
    ]]
  }
};

const AGE_MIDPOINT = {
  'pre-1900': 1870,
  '1900-1929': 1915,
  '1930-1949': 1940,
  '1950-1966': 1958,
  '1967-1982': 1974,
  '1983-1995': 1989,
  '1996-2011': 2003,
  '2012-onwards': 2018
};

if (!fs.existsSync(lbsmPath) || !fs.existsSync(footprintPath)) {
  console.error('Missing inputs. Download the GLA LBSM 2 London archive and the Central London OS OpenMap Local footprint export first.');
  process.exit(1);
}

const sourceBuildings = await loadOfficialBuildings(lbsmPath);
const osFootprints = JSON.parse(fs.readFileSync(footprintPath, 'utf8'));
const outlineFeatures = (osFootprints.features || [])
  .filter(feature => feature.geometry && ['Polygon', 'MultiPolygon'].includes(feature.geometry.type))
  .map(toBuildingFeature);

const grid = makePointGrid(sourceBuildings);
let matched = 0;
const features = outlineFeatures.map(feature => {
  const join = matchOfficial(feature.geometry, grid);
  const official = join?.record || null;
  if (official) matched += 1;
  const height = determineHeight(official);
  const props = {
    bin: feature.properties.bin,
    h: height.feet,
    height_available: height.available,
    y: official?.year || null,
    age_band: official?.ageBand || null,
    official_toid: official?.id || null,
    join_method: join?.method || null,
    join_distance_m: join?.distance == null ? null : Math.round(join.distance * 10) / 10,
    address: official?.postcode ? `${official.postcode}, London` : null,
    borough: official?.area || 'Central London',
    ward: official?.ward || null,
    building_use: official?.use || null,
    stories: official?.floors || null,
    age_source: official ? 'GLA London Building Stock Model 2' : null,
    age_data_as_of: official ? 'October 2024' : null,
    footprint_retrieved_on: FOOTPRINT_RETRIEVED_ON
  };
  return { type: 'Feature', properties: props, geometry: feature.geometry };
});

const landmarkFeatures = LANDMARKS.map(landmark => {
  const geometry = CURATED_LANDMARK_FOOTPRINTS[landmark.id]
    || BRIDGE_FEATURES[landmark.id]
    || containingFeature(features, landmark.coords)?.geometry;
  if (!geometry) return null;
  return {
    type: 'Feature',
    properties: { id: landmark.id, name: landmark.name, h: landmark.h, color: '#d4b064' },
    geometry
  };
}).filter(Boolean);

fs.mkdirSync(outDir, { recursive: true });
writeJson('buildings.geojson', { type: 'FeatureCollection', features });
writeJson('landmark_footprints.geojson', { type: 'FeatureCollection', features: landmarkFeatures });
writeJson('landmark_parts.geojson', { type: 'FeatureCollection', features: [] });
writeJson('building_overrides.json', {});
writeJson('startup_history.json', { by_bin: {}, by_building_id: {}, by_mblr: {} });

console.log(`Central London: wrote ${features.length.toLocaleString()} official OS footprints; strictly matched ${matched.toLocaleString()} to GLA construction-age records.`);

function writeJson(file, data) {
  fs.writeFileSync(path.join(outDir, file), JSON.stringify(data));
}

function parseCsvLine(text) {
  const row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field.replace(/\r$/, ''));
  return row;
}

async function loadOfficialBuildings(file) {
  let input;
  let child = null;
  if (file.endsWith('.zip')) {
    child = spawn('unzip', ['-p', file], { stdio: ['ignore', 'pipe', 'inherit'] });
    input = child.stdout;
  } else {
    input = fs.createReadStream(file);
  }
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const grouped = new Map();
  let i = null;
  for await (const line of lines) {
    const row = parseCsvLine(line);
    if (!i) {
      i = Object.fromEntries(row.map((value, column) => [value, column]));
      continue;
    }
    const id = row[i.os_topo_toid];
    const easting = Number(row[i.easting]);
    const northing = Number(row[i.northing]);
    if (!id || !Number.isFinite(easting) || !Number.isFinite(northing)) continue;
    if (easting < OSGB_BOUNDS.minE || easting > OSGB_BOUNDS.maxE || northing < OSGB_BOUNDS.minN || northing > OSGB_BOUNDS.maxN) continue;
    const group = grouped.get(id) || {
      id,
      location: osgbToWgs84(easting, northing),
      bands: new Map(),
      floors: [],
      postcode: row[i.postcode_locator],
      area: row[i.administrative_area],
      ward: row[i.ward22nm],
      use: row[i.building_use]
    };
    const band = row[i.construction_age_band_known] === '1' ? row[i.construction_age_band] : null;
    if (band && AGE_MIDPOINT[band]) group.bands.set(band, (group.bands.get(band) || 0) + 1);
    const floors = Number(row[i.estimated_floor_count]);
    if (Number.isFinite(floors) && floors > 0) group.floors.push(floors);
    grouped.set(id, group);
  }
  if (child) await new Promise((resolve, reject) => child.on('close', code => code === 0 ? resolve() : reject(new Error(`unzip exited ${code}`))));
  return [...grouped.values()].map(group => {
    const ageBand = [...group.bands.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    group.floors.sort((a, b) => a - b);
    return {
      ...group,
      ageBand,
      year: ageBand ? AGE_MIDPOINT[ageBand] : null,
      floors: group.floors[Math.floor(group.floors.length / 2)] || null
    };
  });
}

function toBuildingFeature(feature) {
  const id = feature.properties?.ID || feature.properties?.OBJECTID;
  return {
    type: 'Feature',
    properties: { bin: `os-${id}` },
    geometry: roundGeometry(feature.geometry)
  };
}

function makePointGrid(records) {
  const grid = new Map();
  for (const record of records) {
    const key = gridKey(record.location);
    const bucket = grid.get(key) || [];
    bucket.push(record);
    grid.set(key, bucket);
  }
  return grid;
}

function matchOfficial(geometry, grid) {
  const centroid = featureCentroid(geometry);
  const candidates = [];
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dy = -2; dy <= 2; dy += 1) {
      candidates.push(...(grid.get(gridKey([centroid[0] + dx * 0.00025, centroid[1] + dy * 0.00025])) || []));
    }
  }
  const inside = candidates.find(record => pointInGeometry(record.location, geometry));
  if (inside) return { record: inside, method: 'inside-footprint', distance: metresBetween(centroid, inside.location) };
  return null;
}

function determineHeight(official) {
  if (official?.floors) return { feet: Math.max(10, Math.round(official.floors * 10.5)), available: true };
  return { feet: 32, available: false };
}

function containingFeature(features, point) {
  for (const feature of features) {
    if (pointInGeometry(point, feature.geometry)) return feature;
  }
  return null;
}

function gridKey([lng, lat]) {
  return `${Math.floor(lng / 0.00025)},${Math.floor(lat / 0.00025)}`;
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

function roundGeometry(geometry) {
  return {
    ...geometry,
    coordinates: JSON.parse(JSON.stringify(geometry.coordinates), (_key, value) => (
      typeof value === 'number' ? round(value) : value
    ))
  };
}

function featureCentroid(geometry) {
  const ring = geometry.type === 'MultiPolygon' ? geometry.coordinates[0][0] : geometry.coordinates[0];
  return polygonCentroid(ring);
}

function polygonCentroid(ring) {
  let x = 0;
  let y = 0;
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    x += (ring[i][0] + ring[i + 1][0]) * cross;
    y += (ring[i][1] + ring[i + 1][1]) * cross;
    area += cross;
  }
  return Math.abs(area) > 1e-12 ? [x / (3 * area), y / (3 * area)] : ring[0];
}

function pointInPolygon([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(point, geometry) {
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  return polygons.some(polygon => pointInPolygon(point, polygon[0]) && !polygon.slice(1).some(hole => pointInPolygon(point, hole)));
}

function metresBetween(a, b) {
  const dy = (a[1] - b[1]) * 111320;
  const dx = (a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180);
  return Math.hypot(dx, dy);
}

// Ordnance Survey National Grid (OSGB36) to WGS84 conversion using the
// published Airy 1830 transverse Mercator and the standard Helmert transform.
function osgbToWgs84(E, N) {
  const a = 6377563.396;
  const b = 6356256.909;
  const F0 = 0.9996012717;
  const lat0 = 49 * Math.PI / 180;
  const lon0 = -2 * Math.PI / 180;
  const N0 = -100000;
  const E0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  let lat = lat0;
  let M = 0;
  while (N - N0 - M >= 0.00001) {
    lat = (N - N0 - M) / (a * F0) + lat;
    const d = lat - lat0;
    const s = lat + lat0;
    M = b * F0 * ((1 + n + 1.25 * n ** 2 + 1.25 * n ** 3) * d
      - (3 * n + 3 * n ** 2 + 21 / 8 * n ** 3) * Math.sin(d) * Math.cos(s)
      + (15 / 8 * n ** 2 + 15 / 8 * n ** 3) * Math.sin(2 * d) * Math.cos(2 * s)
      - 35 / 24 * n ** 3 * Math.sin(3 * d) * Math.cos(3 * s));
  }
  const nu = a * F0 / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const rho = a * F0 * (1 - e2) / (1 - e2 * Math.sin(lat) ** 2) ** 1.5;
  const eta2 = nu / rho - 1;
  const tan = Math.tan(lat);
  const sec = 1 / Math.cos(lat);
  const dE = E - E0;
  const VII = tan / (2 * rho * nu);
  const VIII = tan / (24 * rho * nu ** 3) * (5 + 3 * tan ** 2 + eta2 - 9 * tan ** 2 * eta2);
  const IX = tan / (720 * rho * nu ** 5) * (61 + 90 * tan ** 2 + 45 * tan ** 4);
  const X = sec / nu;
  const XI = sec / (6 * nu ** 3) * (nu / rho + 2 * tan ** 2);
  const XII = sec / (120 * nu ** 5) * (5 + 28 * tan ** 2 + 24 * tan ** 4);
  const XIIA = sec / (5040 * nu ** 7) * (61 + 662 * tan ** 2 + 1320 * tan ** 4 + 720 * tan ** 6);
  const osLat = lat - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6;
  const osLon = lon0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7;
  return helmertToWgs84(osLat, osLon);
}

function helmertToWgs84(lat, lon) {
  const a = 6377563.396;
  const b = 6356256.909;
  const e2 = 1 - b ** 2 / a ** 2;
  const nu = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  let x = nu * Math.cos(lat) * Math.cos(lon);
  let y = nu * Math.cos(lat) * Math.sin(lon);
  let z = (nu * (1 - e2)) * Math.sin(lat);
  const tx = 446.448;
  const ty = -125.157;
  const tz = 542.06;
  const s = 20.4894e-6;
  const rx = 0.1502 * Math.PI / (180 * 3600);
  const ry = 0.247 * Math.PI / (180 * 3600);
  const rz = 0.8421 * Math.PI / (180 * 3600);
  [x, y, z] = [
    tx + (1 + s) * x - rz * y + ry * z,
    ty + rz * x + (1 + s) * y - rx * z,
    tz - ry * x + rx * y + (1 + s) * z
  ];
  const A = 6378137;
  const B = 6356752.3141;
  const E2 = 1 - B ** 2 / A ** 2;
  const p = Math.hypot(x, y);
  let wgsLat = Math.atan2(z, p * (1 - E2));
  for (let k = 0; k < 8; k += 1) {
    const n = A / Math.sqrt(1 - E2 * Math.sin(wgsLat) ** 2);
    wgsLat = Math.atan2(z + E2 * n * Math.sin(wgsLat), p);
  }
  return [Math.atan2(y, x) * 180 / Math.PI, wgsLat * 180 / Math.PI];
}
