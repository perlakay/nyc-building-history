import maplibregl from 'maplibre-gl';
import { LANDMARKS, ERA_BY_ID } from './landmarks.js';
import { renderPanel, renderWelcomePanel } from './panel.js';
import { createSearch } from './search.js';

// Dark canvas. CARTO dark-matter (no labels) for streets/water. Labels go
// BELOW the buildings so they never intercept clicks on building footprints.
const STYLE = {
  version: 8,
  sources: {
    'carto-dark': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}.png'
      ],
      tileSize: 256,
      attribution: '© <a href="https://carto.com/">CARTO</a> · © <a href="https://openstreetmap.org">OpenStreetMap</a> · Buildings © <a href="https://data.cityofnewyork.us/Housing-Development/Building-Footprints/5zhs-2jue">NYC DOITT</a>'
    },
    'carto-labels': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}.png'
      ],
      tileSize: 256
    }
  },
  light: {
    anchor: 'viewport',
    color: '#ffe9c4',
    intensity: 0.5,
    position: [1.4, 200, 50]
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0e1422' } },
    {
      id: 'carto-dark',
      type: 'raster',
      source: 'carto-dark',
      paint: { 'raster-opacity': 0.9, 'raster-saturation': -0.1 }
    },
    {
      id: 'carto-labels',
      type: 'raster',
      source: 'carto-labels',
      paint: { 'raster-opacity': 0.55 }
    }
  ]
};

const map = new maplibregl.Map({
  container: 'map',
  style: STYLE,
  center: [-73.9857, 40.7484],   // Empire State — dramatic opening framing
  zoom: 14.6,
  pitch: 62,
  bearing: -22,
  maxBounds: [[-74.30, 40.49], [-73.68, 40.93]],
  minZoom: 10.8,
  maxZoom: 18,
  antialias: true
});
window.mapDebug = map;

let selectedLandmarkId = null;

async function loadBuildings() {
  updateLoading('downloading building footprints…', 5);
  const res = await fetch('/data/buildings.geojson');
  if (!res.ok) throw new Error('buildings fetch failed');
  const total = parseInt(res.headers.get('content-length') || '0', 10);
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) {
      const pct = Math.min(60, 5 + Math.round((received / total) * 55));
      updateLoading(`downloading · ${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`, pct);
    }
  }
  updateLoading('parsing building shapes…', 70);
  await new Promise(r => setTimeout(r, 30));
  const blob = new Blob(chunks);
  const fc = JSON.parse(await blob.text());
  updateLoading(`drawing ${fc.features.length.toLocaleString()} buildings…`, 90);
  await new Promise(r => setTimeout(r, 30));
  return fc;
}

map.on('load', async () => {
  try {
    const fc = await loadBuildings();
    const lmRes = await fetch('/data/landmark_footprints.geojson');
    const lmFc = await lmRes.json();
    // Detailed OSM building parts for landmarks (where available) — gives
    // tower setbacks, spires, etc. Falls back gracefully if the file is empty.
    let partsFc = { type: 'FeatureCollection', features: [] };
    try {
      const r = await fetch('/data/landmark_parts.geojson');
      if (r.ok) partsFc = await r.json();
    } catch {}

    map.addSource('buildings', { type: 'geojson', data: fc, generateId: true });
    map.addSource('landmarks-poly', { type: 'geojson', data: lmFc });
    map.addSource('landmark-parts', { type: 'geojson', data: partsFc });
    map.addSource('landmarks-pt', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: LANDMARKS.map(l => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: l.coords },
          properties: { id: l.id, name: l.name }
        }))
      }
    });

    // Era color ramp — soft, low-contrast gradient (warm → cool) so the
    // skyline reads like a single illustration, not a heatmap with jumps.
    // We coalesce a missing/zero year to 1900 so unknowns blend in tonally.
    const ERA_RAMP = [
      'interpolate',
      ['linear'],
      ['coalesce', ['get', 'y'], 1900],
      1850, '#7a3a2a',
      1900, '#b15a35',
      1930, '#d8954a',
      1960, '#a89572',
      1990, '#6f8597',
      2020, '#4a6a8a'
    ];

    // Real building heights — `h` is in feet from DOITT.
    const HEIGHT_EXPR = ['*', ['get', 'h'], 0.3048];

    map.addLayer({
      id: 'buildings-fill',
      type: 'fill-extrusion',
      source: 'buildings',
      paint: {
        'fill-extrusion-color': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          '#1f1a14',
          ERA_RAMP
        ],
        'fill-extrusion-height': HEIGHT_EXPR,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.95,
        'fill-extrusion-vertical-gradient': true
      }
    });

    // Landmark fill — flat footprint (used for landmarks without OSM parts).
    map.addLayer({
      id: 'landmark-fill',
      type: 'fill-extrusion',
      source: 'landmarks-poly',
      paint: {
        'fill-extrusion-color': '#c43a1f',
        'fill-extrusion-height': HEIGHT_EXPR,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.98,
        'fill-extrusion-vertical-gradient': true
      }
    });

    // OSM building:part data — tower setbacks, spires, fine detail.
    map.addLayer({
      id: 'landmark-parts',
      type: 'fill-extrusion',
      source: 'landmark-parts',
      paint: {
        'fill-extrusion-color': '#c43a1f',
        'fill-extrusion-height': ['coalesce', ['to-number', ['get', 'h_m']], 30],
        'fill-extrusion-base': ['coalesce', ['to-number', ['get', 'min_h_m']], 0],
        'fill-extrusion-opacity': 0.99,
        'fill-extrusion-vertical-gradient': true
      }
    });

    // Selected landmark outline (drawn at ground level for clarity)
    map.addLayer({
      id: 'landmark-selected',
      type: 'line',
      source: 'landmarks-poly',
      filter: ['==', ['get', 'id'], ''],
      paint: { 'line-color': '#1c1614', 'line-width': 2.5, 'line-opacity': 0.85 }
    });

    // Landmark glow markers (always visible, even at low zoom)
    map.addLayer({
      id: 'landmark-glow',
      type: 'circle',
      source: 'landmarks-pt',
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          11, 4,
          14, 7,
          17, 10
        ],
        'circle-color': '#c43a1f',
        'circle-opacity': 0.65,
        'circle-blur': 0.5,
        'circle-stroke-color': '#fffaf0',
        'circle-stroke-width': 1.5,
        'circle-stroke-opacity': 0.7
      }
    });

    renderWelcomePanel({ buildingCount: fc.features.length, landmarkCount: LANDMARKS.length });
    document.getElementById('loading').classList.add('loading--hidden');
  } catch (err) {
    console.error(err);
    updateLoading(`error: ${err.message}`, 0);
  }
});

// Compass — rotate rose based on map bearing, click toggles top-down ↔ 3D.
const DEFAULT_PITCH = 62;
const DEFAULT_BEARING = -22;
const compassEl = document.getElementById('compass');
const compassRose = compassEl?.querySelector('#compass-rose');
function updateCompass() {
  if (compassRose) compassRose.setAttribute('transform', `rotate(${-map.getBearing()} 20 20)`);
}
map.on('rotate', updateCompass);
compassEl?.addEventListener('click', () => {
  // If we're already top-down, return to the dramatic default 3D view.
  if (map.getPitch() < 5) {
    map.easeTo({ bearing: DEFAULT_BEARING, pitch: DEFAULT_PITCH, duration: 600 });
  } else {
    map.easeTo({ bearing: 0, pitch: 0, duration: 600 });
  }
});

// Single click handler — every building should pop a card.
map.on('click', (e) => {
  // 1. Did the click hit one of the curated landmark masses?
  const lmLayers = ['landmark-fill', 'landmark-parts'].filter(id => map.getLayer(id));
  if (lmLayers.length) {
    const lm = map.queryRenderedFeatures(e.point, { layers: lmLayers });
    if (lm.length && lm[0].properties.id) {
      openLandmark(lm[0].properties.id);
      return;
    }
  }

  // 2. Otherwise, treat ANY clicked building as a building click.
  if (map.getLayer('buildings-fill')) {
    const bld = map.queryRenderedFeatures(e.point, { layers: ['buildings-fill'] });
    if (bld.length) {
      openGenericAt(e.lngLat, bld[0].properties);
      return;
    }
  }

  // 3. Nothing under the click — try a wider radius (helps thin/sliver lots).
  const wider = map.queryRenderedFeatures(
    [[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]],
    { layers: map.getLayer('buildings-fill') ? ['buildings-fill'] : [] }
  );
  if (wider.length) {
    openGenericAt(e.lngLat, wider[0].properties);
    return;
  }

  // 4. Last fallback — proximity to a landmark coordinate.
  const near = nearestLandmark(e.lngLat);
  if (near && near.distKm < 0.04) {
    openLandmark(near.landmark.id);
    return;
  }

  // 5. Truly empty space (water, park) — show an "outside the atlas" card.
  renderPanel({ generic: true, notFound: true });
  document.getElementById('panel').classList.remove('panel--hidden');
});

// Hover state — light up the building under the cursor and switch the cursor.
let hoveredBuildingId = null;
function setHoveredBuilding(id) {
  if (hoveredBuildingId === id) return;
  if (hoveredBuildingId !== null) {
    map.setFeatureState({ source: 'buildings', id: hoveredBuildingId }, { hover: false });
  }
  hoveredBuildingId = id;
  if (id !== null) {
    map.setFeatureState({ source: 'buildings', id }, { hover: true });
  }
}
map.on('mousemove', (e) => {
  const lm = map.queryRenderedFeatures(e.point, { layers: ['landmark-fill', 'landmark-parts', 'landmark-glow'] });
  if (lm.length) {
    map.getCanvas().style.cursor = 'pointer';
    setHoveredBuilding(null);
    return;
  }
  const bld = map.queryRenderedFeatures(e.point, { layers: ['buildings-fill'] });
  if (bld.length) {
    map.getCanvas().style.cursor = 'pointer';
    setHoveredBuilding(bld[0].id);
  } else {
    map.getCanvas().style.cursor = '';
    setHoveredBuilding(null);
  }
});
map.on('mouseleave', 'buildings-fill', () => setHoveredBuilding(null));

async function openGenericAt(lngLat, props = {}) {
  const localRecord = buildLocalRecord(lngLat, props);
  // Show the card immediately with a loading title.
  renderPanel({
    generic: true,
    era: localRecord.era,
    address: { ...localRecord, address: 'Loading address…' },
    localOnly: true,
    addressLoading: true
  });
  document.getElementById('panel').classList.remove('panel--hidden');

  // Race PLUTO (rich record) against reverse-geocode (just the street address).
  // Whichever returns first updates the title; PLUTO replaces it with full data.
  const pluto = fetchAddress(lngLat.lng, lngLat.lat).catch(() => null);
  const reverse = reverseGeocode(lngLat.lng, lngLat.lat);

  const reverseAddr = await reverse;
  const plutoSettled = await Promise.race([pluto, new Promise(r => setTimeout(() => r('pending'), 0))]);

  // If PLUTO is still pending, show the reverse-geocoded address so the user
  // never sees lat/lng coordinates as a title.
  if (plutoSettled === 'pending' && reverseAddr) {
    renderPanel({
      generic: true,
      era: localRecord.era,
      address: { ...localRecord, address: reverseAddr },
      localOnly: true,
      addressLoading: true
    });
  }

  const details = await pluto;
  if (details) {
    // PLUTO's address can be empty for some lots — fall back to reverse.
    const merged = { ...localRecord, ...details };
    if (!merged.address) merged.address = reverseAddr || 'Address unavailable';
    renderPanel({
      generic: true,
      era: eraFromYear(details.yearbuilt) || localRecord.era,
      address: merged,
      addressLoading: false
    });
  } else {
    // PLUTO failed — keep what we have, but ensure the title is real.
    renderPanel({
      generic: true,
      era: localRecord.era,
      address: { ...localRecord, address: reverseAddr || 'Address unavailable' },
      localOnly: true,
      addressLoading: false
    });
  }
}

async function fetchAddress(lng, lat) {
  const d = 0.0005;
  const where = [
    `latitude between ${lat - d} and ${lat + d}`,
    `longitude between ${lng - d} and ${lng + d}`
  ].join(' AND ');
  const url = `https://data.cityofnewyork.us/resource/64uk-42ks.json?$select=address,ownername,yearbuilt,yearalter1,yearalter2,numfloors,unitstotal,bldgclass,zonedist1,histdist,borough,latitude,longitude&$where=${encodeURIComponent(where)}&$limit=10`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const rows = await res.json();
  if (!rows.length) return null;
  let best = rows[0], bestD = Infinity;
  for (const r of rows) {
    const rl = parseFloat(r.latitude), rg = parseFloat(r.longitude);
    if (!isFinite(rl)) continue;
    const dist = (rl - lat) ** 2 + (rg - lng) ** 2;
    if (dist < bestD) { bestD = dist; best = r; }
  }
  return {
    address: titleCase((best.address || '').trim()),
    owner: titleCase((best.ownername || '').trim()),
    yearbuilt: best.yearbuilt ? parseInt(best.yearbuilt, 10) : null,
    yearalter1: best.yearalter1 ? parseInt(best.yearalter1, 10) : null,
    yearalter2: best.yearalter2 ? parseInt(best.yearalter2, 10) : null,
    floors: best.numfloors ? parseFloat(best.numfloors) : null,
    units: best.unitstotal ? parseInt(best.unitstotal, 10) : null,
    bldgclass: (best.bldgclass || '').trim(),
    zone: (best.zonedist1 || '').trim(),
    histdist: (best.histdist || '').trim(),
    borough: String(best.borough || '').trim(),
    coords: [parseFloat(best.longitude), parseFloat(best.latitude)]
  };
}
function titleCase(s) { return String(s || '').toLowerCase().replace(/\b([a-z])/g, (_, c) => c.toUpperCase()); }

function buildLocalRecord(lngLat, props = {}) {
  const yearbuilt = props.y ? parseInt(props.y, 10) : null;
  const heightFt = props.h ? parseFloat(props.h) : null;
  const heightM = heightFt ? Math.round(heightFt * 0.3048) : null;
  const estFloors = heightFt ? Math.max(1, Math.round(heightFt / 12)) : null;
  const era = eraFromYear(yearbuilt);

  return {
    address: null,            // resolved async — see openGenericAt
    yearbuilt,
    floors: estFloors,
    height: heightFt ? `${Math.round(heightFt)} ft` : null,
    heightMeters: heightM ? `${heightM} m` : null,
    form: describeBuildingForm(yearbuilt, heightFt),
    styleHint: architecturalEra(yearbuilt),
    zone: null,
    histdist: null,
    era
  };
}

// Reverse-geocode via NYC Geosearch (same free API as the search bar).
// Returns the closest street address or null.
async function reverseGeocode(lng, lat) {
  try {
    const url = `https://geosearch.planninglabs.nyc/v2/reverse?point.lon=${lng}&point.lat=${lat}&size=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const f = (data.features || [])[0];
    if (!f) return null;
    const p = f.properties || {};
    return p.label || p.name || null;
  } catch {
    return null;
  }
}

function describeBuildingForm(year, heightFt) {
  if (heightFt && heightFt >= 700) return 'supertall or skyline-defining tower';
  if (heightFt && heightFt >= 300) return 'high-rise tower';
  if (heightFt && heightFt >= 120) return 'mid-rise building';
  if (heightFt && heightFt >= 40) return 'low-rise streetwall building';
  if (year && year < 1900) return 'older rowhouse or tenement-scale structure';
  return 'small-scale building mass';
}

function architecturalEra(year) {
  if (!year) return null;
  if (year < 1825) return 'a Federal-era structure';
  if (year < 1860) return "from NYC's Greek Revival and early Italianate period";
  if (year < 1900) return 'during the tenement and brownstone boom';
  if (year < 1915) return 'during the Beaux-Arts era';
  if (year < 1931) return 'during the Art Deco / skyscraper boom';
  if (year < 1946) return 'during the Depression and wartime era';
  if (year < 1975) return 'during the post-war International Style era';
  if (year < 2000) return 'during the late-20th-century era';
  return 'a 21st-century structure';
}

function nearestLandmark({ lng, lat }) {
  let best = null, bestDist = Infinity;
  for (const l of LANDMARKS) {
    const dLng = (l.coords[0] - lng) * Math.cos(lat * Math.PI / 180);
    const dLat = l.coords[1] - lat;
    const dist = Math.sqrt(dLng * dLng + dLat * dLat) * 111;
    if (dist < bestDist) { bestDist = dist; best = l; }
  }
  return best ? { landmark: best, distKm: bestDist } : null;
}

function eraFromYear(y) {
  if (!y) return 'unknown';
  if (y < 1900) return 'victorian';
  if (y < 1930) return 'beauxarts';
  if (y < 1960) return 'artdeco';
  if (y < 2000) return 'modernist';
  return 'contemporary';
}

function openLandmark(id) {
  const landmark = LANDMARKS.find(l => l.id === id);
  if (!landmark) return;
  selectedLandmarkId = id;
  if (map.getLayer('landmark-selected')) {
    map.setFilter('landmark-selected', ['==', ['get', 'id'], id]);
  }
  const era = ERA_BY_ID[landmark.id] || 'beauxarts';
  renderPanel({ ...landmark, era });
  map.flyTo({
    center: landmark.coords,
    zoom: Math.max(map.getZoom(), 16),
    speed: 0.9, curve: 1.4,
    offset: [-220, 0]
  });
}

// Sources toggle (collapsible info tab)
const sourcesEl = document.getElementById('sources');
document.getElementById('sources-toggle')?.addEventListener('click', (e) => {
  e.stopPropagation();
  sourcesEl?.classList.toggle('sources--open');
});
document.addEventListener('click', (e) => {
  if (sourcesEl && !sourcesEl.contains(e.target)) {
    sourcesEl.classList.remove('sources--open');
  }
});

document.getElementById('panel-close').addEventListener('click', () => {
  document.getElementById('panel').classList.add('panel--hidden');
  selectedLandmarkId = null;
  if (map.getLayer('landmark-selected')) {
    map.setFilter('landmark-selected', ['==', ['get', 'id'], '']);
  }
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: false, showCompass: false }), 'bottom-right');

// A persistent marker that highlights the most recent search result
let searchMarker = null;
function placeSearchMarker(lng, lat, label) {
  if (searchMarker) searchMarker.remove();
  const el = document.createElement('div');
  el.className = 'search-pin';
  el.innerHTML = `
    <div class="search-pin__bubble">${escapeText(label)}</div>
    <svg class="search-pin__icon" viewBox="0 0 28 38" width="28" height="38">
      <path d="M14 1 C 6 1 1 6 1 14 C 1 22 14 37 14 37 C 14 37 27 22 27 14 C 27 6 22 1 14 1 Z"
            fill="#c84b2f" stroke="#5a2014" stroke-width="1.5" stroke-linejoin="round"/>
      <circle cx="14" cy="14" r="5" fill="#fffaf0" stroke="#5a2014" stroke-width="1.2"/>
    </svg>`;
  searchMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
    .setLngLat([lng, lat])
    .addTo(map);
}
function escapeText(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

createSearch({
  landmarks: LANDMARKS,
  onPickLandmark: (id) => {
    if (searchMarker) { searchMarker.remove(); searchMarker = null; }
    openLandmark(id);
  },
  onPickAddress: async (r) => {
    const [lng, lat] = r.coords;
    placeSearchMarker(lng, lat, r.label);
    map.flyTo({ center: [lng, lat], zoom: 17, speed: 1.0, curve: 1.4, offset: [-220, 0] });
    await openGenericAt({ lng, lat });
  },
  onClear: () => {
    if (searchMarker) { searchMarker.remove(); searchMarker = null; }
  }
});

function updateLoading(msg, pct) {
  const hint = document.getElementById('loading-hint');
  if (hint) hint.textContent = msg;
  const fill = document.getElementById('loading-fill');
  if (fill && typeof pct === 'number') fill.style.width = pct + '%';
}
