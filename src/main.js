import maplibregl from 'maplibre-gl';
import { renderPanel } from './panel.js';
import { createSearch } from './search.js';

// City config is set by each entry HTML via window.CITY before this script
// runs. It tells the engine where to fetch data, the camera framing, the
// curated landmarks, and the city-specific copy.
//
// We resolve CITY at module-execution-time rather than top-level so that if
// the module gets evaluated before window.CITY is set we throw a clear error
// rather than silently shipping `undefined` everywhere.
function resolveCity() {
  const c = (typeof window !== 'undefined' && window.CITY) || null;
  if (!c) throw new Error('window.CITY not set — define it in the entry HTML before loading main.js');
  return c;
}

const CITY = resolveCity();
const LANDMARKS = CITY.landmarks;
const ERA_BY_ID = CITY.eraById;
const THEME = CITY.theme || {};
const STARTUP_MARKER_COLOR = THEME.startupMarker || '#9b5cff';
const LANDMARK_MARKER_COLOR = THEME.landmarkMarker || '#c43a1f';
const SELECTED_COLOR = THEME.selected || '#f3d27a';
const DATA = (path) => `/data/${CITY.id}/${path}`;
// Per-city building id — `bin` for NYC, `building_id` for SF, etc. The engine
// uses this name for index keys, search routing, and de-duping curated lots.
const ID_FIELD = CITY.idField;
const RENDER_DATA_FILE = CITY.renderDataFile || 'buildings.geojson';
console.log('[atlas] starting', CITY.id, '— buildings will load from', DATA(RENDER_DATA_FILE));

// Dark canvas. CARTO dark-matter (no labels) for streets/water. Labels go
// BELOW the buildings so they never intercept clicks on building footprints.
const STYLE = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    'carto-dark': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}.png'
      ],
      tileSize: 256,
      attribution: CITY.attribution
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
    { id: 'bg', type: 'background', paint: { 'background-color': THEME.mapBackground || '#0e1422' } },
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
  center: CITY.center,
  zoom: CITY.zoom,
  pitch: CITY.pitch,
  bearing: CITY.bearing,
  ...(CITY.bounds ? { maxBounds: CITY.bounds } : {}),
  minZoom: CITY.minZoom,
  maxZoom: CITY.maxZoom ?? 18,
  antialias: true
});
window.mapDebug = map;

let selectedLandmarkId = null;
let selectedBuildingId = null;
const landmarkAnchorById = new Map();

function setSelectedBuilding(id) {
  if (selectedBuildingId === id) return;
  if (selectedBuildingId !== null && selectedBuildingId !== undefined) {
    try { map.setFeatureState({ source: 'buildings', id: selectedBuildingId }, { selected: false }); } catch {}
  }
  selectedBuildingId = id;
  if (id !== null && id !== undefined) {
    try { map.setFeatureState({ source: 'buildings', id }, { selected: true }); } catch {}
  }
}

async function loadBuildings() {
  updateLoading('downloading building footprints…', 5);
  const res = await fetch(DATA(RENDER_DATA_FILE));
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

// BIN → building feature index. Built once when buildings load so we can
// snap a search hit to the exact footprint by NYC's authoritative ID.
const buildingByBin = new Map();
// BIN → curated correction (overrides DOITT data when DOITT is wrong).
let buildingOverrides = {};
let startupHistory = { by_bin: {}, by_building_id: {}, by_mblr: {} };
function fullBuildingProperties(properties = {}) {
  const id = properties[ID_FIELD];
  return (id != null && buildingByBin.get(id)?.properties) || properties;
}

function indexBuildingDetails(fc) {
  for (const feature of fc.features) {
    const id = feature.properties?.[ID_FIELD];
    if (id == null) continue;
    const override = buildingOverrides[String(id)];
    if (override) {
      if (override.y != null) feature.properties.y = override.y;
      if (override.h != null) feature.properties.h = override.h;
      if (override.name != null) feature.properties.name = override.name;
      feature.properties.corrected = true;
    }
    buildingByBin.set(id, feature);
  }
}

async function loadBackgroundDetails() {
  if (!CITY.detailDataFile) return;
  try {
    const response = await fetch(DATA(CITY.detailDataFile));
    if (!response.ok) throw new Error(`details fetch ${response.status}`);
    const full = await response.json();
    indexBuildingDetails(full);
    console.log('[atlas] full detail records ready,', full.features.length, 'features');
  } catch (error) {
    console.warn('[atlas] full detail records unavailable:', error.message);
  }
}

map.on('load', async () => {
  try {
    const fc = await loadBuildings();
    // Apply curated corrections — DOITT has known-wrong year/height for some
    // famous lots (rebuilds where the year reflects a prior structure).
    try {
      const ovRes = await fetch(DATA('building_overrides.json'));
      buildingOverrides = ovRes.ok ? await ovRes.json() : {};
    } catch { buildingOverrides = {}; }
    try {
      const shRes = await fetch(DATA('startup_history.json'));
      if (shRes.ok) {
        const sh = await shRes.json();
        startupHistory = {
          by_bin: sh.by_bin || {},
          by_building_id: sh.by_building_id || {},
          by_mblr: sh.by_mblr || {}
        };
      }
    } catch {}
    indexBuildingDetails(fc);
    const lmRes = await fetch(DATA('landmark_footprints.geojson'));
    const lmFc = await lmRes.json();
    for (const f of lmFc.features || []) {
      const id = f.properties?.id;
      const c = featureCentroid(f);
      if (id && c) landmarkAnchorById.set(id, c);
    }
    // Detailed OSM building parts for landmarks (where available) — gives
    // tower setbacks, spires, etc. Falls back gracefully if the file is empty.
    let partsFc = { type: 'FeatureCollection', features: [] };
    try {
      const r = await fetch(DATA('landmark_parts.geojson'));
      if (r.ok) partsFc = await r.json();
    } catch {}

    map.addSource('buildings', { type: 'geojson', data: fc, generateId: true });
    console.log('[atlas] buildings source added,', fc.features.length, 'features');
    map.on('error', (e) => console.error('[atlas] map error:', e.error?.message || e));
    map.addSource('landmarks-poly', { type: 'geojson', data: lmFc });
    map.addSource('landmark-parts', { type: 'geojson', data: partsFc });
    map.addSource('landmarks-pt', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: LANDMARKS.map(l => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: landmarkPoint(l) },
          properties: { id: l.id, name: l.name, kind: l.kind || 'landmark' }
        }))
      }
    });

    // Era color ramp. Each city can supply its own locally meaningful palette.
    // Missing/zero years use the city's neutral fallback.
    const ERA_RAMP = THEME.eraRamp || [
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

    // Cities with replacement landmark geometry may hide the source footprint
    // to prevent z-fighting. London keeps official footprints and uses BINs
    // only to route a building click to its curated landmark card.
    const landmarkIds = THEME.preserveBoundLandmarkFootprints
      ? []
      : LANDMARKS.map(l => l[ID_FIELD]).filter(Boolean);
    const bridgeIds = LANDMARKS.filter(l => l.id.endsWith('-bridge')).map(l => l.id);

    if (bridgeIds.length) {
      // Bridges are crossings, not buildings. Draw low decks beneath official
      // shore footprints so an abutment never appears to consume a building.
      map.addLayer({
        id: 'landmark-bridge-fill',
        type: 'fill-extrusion',
        source: 'landmarks-poly',
        filter: ['in', ['get', 'id'], ['literal', bridgeIds]],
        paint: {
          'fill-extrusion-color': ['coalesce', ['get', 'color'], LANDMARK_MARKER_COLOR],
          'fill-extrusion-height': 1.5,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.98,
          'fill-extrusion-vertical-gradient': false
        }
      });
    }

    map.addLayer({
      id: 'buildings-fill',
      type: 'fill-extrusion',
      source: 'buildings',
      ...(landmarkIds.length
        ? { filter: ['!', ['in', ['get', ID_FIELD], ['literal', landmarkIds]]] }
        : {}),
      paint: {
        'fill-extrusion-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          SELECTED_COLOR,
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
      ...(bridgeIds.length
        ? { filter: ['!', ['in', ['get', 'id'], ['literal', bridgeIds]]] }
        : {}),
      paint: {
        'fill-extrusion-color': ['coalesce', ['get', 'color'], LANDMARK_MARKER_COLOR],
        'fill-extrusion-height': HEIGHT_EXPR,
        'fill-extrusion-base': ['*', ['coalesce', ['get', 'base_ft'], 0], 0.3048],
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
        'fill-extrusion-color': ['coalesce', ['get', 'color'], LANDMARK_MARKER_COLOR],
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

    if (!THEME.hideLandmarkGlow) {
      map.addLayer({
        id: 'landmark-glow',
        type: 'circle',
        source: 'landmarks-pt',
        filter: ['!=', ['get', 'kind'], 'startup'],
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            11, THEME.showLandmarkLabels ? 7 : 4,
            14, THEME.showLandmarkLabels ? 11 : 7,
            17, THEME.showLandmarkLabels ? 15 : 10
          ],
          'circle-color': [
            'case',
            ['==', ['get', 'kind'], 'federal'],
            '#f7f0df',
            LANDMARK_MARKER_COLOR
          ],
          'circle-opacity': THEME.showLandmarkLabels ? 0.82 : 0.65,
          'circle-blur': 0.5,
          'circle-stroke-color': [
            'case',
            ['==', ['get', 'kind'], 'federal'],
            '#c6283b',
            '#fffaf0'
          ],
          'circle-stroke-width': THEME.showLandmarkLabels ? 2.5 : 1.5,
          'circle-stroke-opacity': 0.9
        }
      });
    }

    if (THEME.showLandmarkLabels) {
      map.addLayer({
        id: 'landmark-labels',
        type: 'symbol',
        source: 'landmarks-pt',
        filter: ['!=', ['get', 'kind'], 'startup'],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': [
            'interpolate', ['linear'], ['zoom'],
            11, 10,
            15, 13
          ],
          'text-anchor': 'top',
          'text-offset': [0, 0.8],
          'text-allow-overlap': false,
          'text-optional': true
        },
        paint: {
          'text-color': '#fffaf0',
          'text-halo-color': '#06172e',
          'text-halo-width': 2
        }
      });
    }

    await addLandmarkPins();
    await addFederalBuildingPins();
    await addStartupOfficePins();
    setupLandmarkToggle();
    setupStartupToggle();

    document.getElementById('loading').classList.add('loading--hidden');
    void loadBackgroundDetails();
  } catch (err) {
    console.error(err);
    updateLoading(`error: ${err.message}`, 0);
  }
});

async function addStartupOfficePins() {
  const startups = LANDMARKS.filter(l => l.kind === 'startup');
  if (!startups.length) return;

  map.addSource('startup-offices', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: startups.map(l => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: l.coords },
        properties: {
          id: l.id,
          name: l.name,
          icon: `startup-${l.id}`
        }
      }))
    }
  });

  await Promise.all(startups.map(async (startup) => {
    const imageId = `startup-${startup.id}`;
    if (map.hasImage(imageId)) return;
    const image = await createStartupIcon(startup);
    map.addImage(imageId, image, { pixelRatio: 2 });
  }));

  map.addLayer({
    id: 'startup-pins',
    type: 'symbol',
    source: 'startup-offices',
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-anchor': 'bottom',
      'icon-size': [
        'interpolate', ['linear'], ['zoom'],
        11, 0.72,
        14, 0.9,
        17, 1.08
      ],
      'icon-allow-overlap': true,
      'text-field': ['step', ['zoom'], '', 13.2, ['get', 'name']],
      'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
      'text-size': 13,
      'text-anchor': 'top',
      'text-offset': [0, 0.35],
      'text-allow-overlap': false,
      'text-optional': true
    },
    paint: {
      'text-color': '#fffaf0',
      'text-halo-color': '#111827',
      'text-halo-width': 1.8
    }
  });

  map.on('click', 'startup-pins', (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (!id) return;
    setSelectedBuilding(null);
    openLandmark(id);
  });
  map.on('mouseenter', 'startup-pins', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'startup-pins', () => { map.getCanvas().style.cursor = ''; });
}

async function addLandmarkPins() {
  const landmarks = LANDMARKS.filter(l => (l.kind || 'landmark') !== 'startup' && l.kind !== 'federal');
  if (!THEME.landmarkPins || !landmarks.length) return;

  map.addSource('landmark-pins-source', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: landmarks.map(l => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: landmarkPoint(l) },
        properties: {
          id: l.id,
          name: l.name,
          icon: `landmark-${l.id}`,
          showAtOverview: Boolean(l.showAtOverview)
        }
      }))
    }
  });

  await Promise.all(landmarks.map(async (landmark) => {
    const imageId = `landmark-${landmark.id}`;
    if (map.hasImage(imageId)) return;
    const image = landmark.mapSymbol === 'wheel'
      ? createWheelIcon(LANDMARK_MARKER_COLOR)
      : createSimplePinIcon(LANDMARK_MARKER_COLOR);
    map.addImage(imageId, image, { pixelRatio: 2 });
  }));

  // Map-native anchors keep each landmark visibly located even if a custom
  // icon is delayed or fails to paint while map assets load.
  map.addLayer({
    id: 'landmark-pin-halo',
    type: 'circle',
    source: 'landmark-pins-source',
    paint: {
      'circle-color': LANDMARK_MARKER_COLOR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 7, 14, 10, 17, 14],
      'circle-opacity': 0.16,
      'circle-blur': 0.4
    }
  });

  map.addLayer({
    id: 'landmark-pin-anchor',
    type: 'circle',
    source: 'landmark-pins-source',
    paint: {
      'circle-color': LANDMARK_MARKER_COLOR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3.5, 14, 4.5, 17, 6],
      'circle-stroke-color': '#fffaf0',
      'circle-stroke-width': 1.4,
      'circle-opacity': 0.98
    }
  });

  map.addLayer({
    id: 'landmark-pins',
    type: 'symbol',
    source: 'landmark-pins-source',
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-anchor': 'bottom',
      'icon-size': [
        'interpolate', ['linear'], ['zoom'],
        11, 0.58,
        14, 0.76,
        17, 0.94
      ],
      'icon-allow-overlap': true,
      'text-field': [
        'case',
        ['boolean', ['get', 'showAtOverview'], false],
        ['get', 'name'],
        ['step', ['zoom'], '', 14.6, ['get', 'name']]
      ],
      'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 0.25],
      'text-allow-overlap': false,
      'text-optional': true
    },
    paint: {
      'text-color': '#fffaf0',
      'text-halo-color': THEME.mapBackground || '#111827',
      'text-halo-width': 1.8
    }
  });

  map.on('click', 'landmark-pins', (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (!id) return;
    setSelectedBuilding(null);
    openLandmark(id);
  });
  map.on('mouseenter', 'landmark-pin-anchor', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'landmark-pin-anchor', () => { map.getCanvas().style.cursor = ''; });
  map.on('mouseenter', 'landmark-pins', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'landmark-pins', () => { map.getCanvas().style.cursor = ''; });
}

async function addFederalBuildingPins() {
  const federal = LANDMARKS.filter(l => l.kind === 'federal');
  if (!federal.length) return;

  map.addSource('federal-buildings', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: federal.map(l => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: landmarkPoint(l) },
        properties: {
          id: l.id,
          name: l.name,
          icon: `federal-${l.id}`
        }
      }))
    }
  });

  await Promise.all(federal.map(async (building) => {
    const imageId = `federal-${building.id}`;
    if (map.hasImage(imageId)) return;
    const image = await createFederalPinIcon(building);
    map.addImage(imageId, image, { pixelRatio: 2 });
  }));

  map.addLayer({
    id: 'federal-pins',
    type: 'symbol',
    source: 'federal-buildings',
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-anchor': 'bottom',
      'icon-size': [
        'interpolate', ['linear'], ['zoom'],
        11, 0.62,
        14, 0.78,
        17, 0.96
      ],
      'icon-allow-overlap': true,
      'text-field': ['step', ['zoom'], '', 14.2, ['get', 'name']],
      'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 0.25],
      'text-allow-overlap': false,
      'text-optional': true
    },
    paint: {
      'text-color': '#fffaf0',
      'text-halo-color': '#071a33',
      'text-halo-width': 1.8
    }
  });

  map.on('click', 'federal-pins', (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (!id) return;
    setSelectedBuilding(null);
    openLandmark(id);
  });
  map.on('mouseenter', 'federal-pins', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'federal-pins', () => { map.getCanvas().style.cursor = ''; });
}

async function createFederalPinIcon(building) {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 112;
  const ctx = canvas.getContext('2d');
  const color = building.pinColor || '#244a7c';
  const src = building.logoSrc || THEME.federalIcon || '/images/gov-emblem.png';

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.shadowColor = 'rgba(2, 8, 23, 0.5)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 5;
  ctx.beginPath();
  ctx.arc(48, 43, 32, 0, Math.PI * 2);
  ctx.fillStyle = '#fffaf0';
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(48, 43, 30, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = color;
  ctx.stroke();

  let logo = null;
  try { logo = await loadLogoImage(src); } catch {}
  if (logo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(48, 43, 22, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, 26, 21, 44, 44);
    ctx.restore();
  } else {
    ctx.fillStyle = color;
    ctx.font = '800 18px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('GOV', 48, 44);
  }

  ctx.beginPath();
  ctx.moveTo(39, 72);
  ctx.lineTo(57, 72);
  ctx.lineTo(48, 91);
  ctx.closePath();
  ctx.fillStyle = '#fffaf0';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = color;
  ctx.stroke();

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function landmarkPoint(landmark) {
  if (THEME.pinAtCuratedCoordinates) return landmark.coords;
  return landmarkAnchorById.get(landmark.id) || landmark.coords;
}

function createSimplePinIcon(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 72;
  canvas.height = 92;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.shadowColor = 'rgba(2, 8, 23, 0.45)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 4;
  ctx.beginPath();
  ctx.moveTo(36, 4);
  ctx.bezierCurveTo(18, 4, 8, 16, 8, 32);
  ctx.bezierCurveTo(8, 53, 36, 88, 36, 88);
  ctx.bezierCurveTo(36, 88, 64, 53, 64, 32);
  ctx.bezierCurveTo(64, 16, 54, 4, 36, 4);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();

  ctx.lineWidth = 4;
  ctx.strokeStyle = '#fffaf0';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(36, 32, 10, 0, Math.PI * 2);
  ctx.fillStyle = '#fffaf0';
  ctx.fill();

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function createWheelIcon(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 104;
  canvas.height = 120;
  const ctx = canvas.getContext('2d');
  const centerX = 52;
  const centerY = 48;
  const radius = 35;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.shadowColor = 'rgba(2, 8, 23, 0.65)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = '#fffaf0';
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 8; i += 1) {
    const angle = i * Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
    ctx.stroke();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY + 3);
  ctx.lineTo(37, 105);
  ctx.moveTo(centerX, centerY + 3);
  ctx.lineTo(67, 105);
  ctx.moveTo(34, 105);
  ctx.lineTo(70, 105);
  ctx.stroke();

  ctx.fillStyle = '#fffaf0';
  for (let i = 0; i < 8; i += 1) {
    const angle = i * Math.PI / 4;
    ctx.beginPath();
    ctx.arc(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius, 3.4, 0, Math.PI * 2);
    ctx.fill();
  }

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function createStartupIcon(startup) {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = 112;
  const ctx = canvas.getContext('2d');
  const color = startup.logoColor || STARTUP_MARKER_COLOR;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.shadowColor = 'rgba(13, 10, 25, 0.45)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 5;
  ctx.beginPath();
  ctx.arc(48, 44, 33, 0, Math.PI * 2);
  ctx.fillStyle = '#fffaf0';
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(48, 44, 30, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = color;
  ctx.stroke();

  let logo = null;
  if (startup.logoSrc) {
    try { logo = await loadLogoImage(startup.logoSrc); } catch {}
  }
  if (logo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(48, 44, 22, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, 27, 23, 42, 42);
    ctx.restore();
  } else {
    ctx.fillStyle = color;
    ctx.font = '800 22px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(startup.logoText || startup.name.slice(0, 2), 48, 45);
  }

  ctx.beginPath();
  ctx.moveTo(39, 74);
  ctx.lineTo(57, 74);
  ctx.lineTo(48, 91);
  ctx.closePath();
  ctx.fillStyle = '#fffaf0';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = color;
  ctx.stroke();

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function loadLogoImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function setupStartupToggle() {
  const toggle = document.getElementById('startup-toggle');
  if (!toggle || !map.getLayer('startup-pins')) return;
  toggle.addEventListener('click', () => {
    const visible = map.getLayoutProperty('startup-pins', 'visibility') !== 'none';
    map.setLayoutProperty('startup-pins', 'visibility', visible ? 'none' : 'visible');
    toggle.classList.toggle('map-toggle--active', !visible);
    toggle.setAttribute('aria-pressed', String(!visible));
  });
}

function setupLandmarkToggle() {
  const toggle = document.getElementById('landmark-toggle');
  const layers = ['landmark-pin-halo', 'landmark-pin-anchor', 'landmark-pins', 'federal-pins'].filter(id => map.getLayer(id));
  if (!toggle || !layers.length) return;
  toggle.addEventListener('click', () => {
    const visible = map.getLayoutProperty(layers[0], 'visibility') !== 'none';
    for (const layer of layers) {
      map.setLayoutProperty(layer, 'visibility', visible ? 'none' : 'visible');
    }
    toggle.classList.toggle('map-toggle--active', !visible);
    toggle.setAttribute('aria-pressed', String(!visible));
  });
}

function setupLegendToggle() {
  const legend = document.querySelector('.legend');
  if (!legend) return;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'legend__close';
  close.setAttribute('aria-label', 'Hide year key');
  close.textContent = 'x';

  const reopen = document.createElement('button');
  reopen.type = 'button';
  reopen.className = 'legend__reopen';
  reopen.textContent = 'Year key';

  legend.append(close, reopen);
  close.addEventListener('click', () => legend.classList.add('legend--closed'));
  reopen.addEventListener('click', () => legend.classList.remove('legend--closed'));
}

setupLegendToggle();

// Compass — rotate rose based on map bearing, click toggles top-down ↔ 3D.
const DEFAULT_PITCH = CITY.explorePitch ?? CITY.pitch;
const DEFAULT_BEARING = CITY.exploreBearing ?? CITY.bearing;
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
// We only treat a click as a "landmark" click when it hits the landmark's
// GROUND FOOTPRINT (`landmark-fill`). Tower setbacks / spires (`landmark-parts`,
// which sit high in the air with `min_h_m > 0`) are excluded — otherwise they
// hijack clicks on adjacent buildings whose pixels happen to sit under a spire.
map.on('click', (e) => {
  if (map.getLayer('landmark-pins')) {
    const pin = map.queryRenderedFeatures(e.point, { layers: ['landmark-pins'] });
    if (pin.length && pin[0].properties.id) {
      setSelectedBuilding(null);
      openLandmark(pin[0].properties.id);
      return;
    }
  }
  if (map.getLayer('landmark-pin-anchor')) {
    const anchor = map.queryRenderedFeatures(e.point, { layers: ['landmark-pin-anchor'] });
    if (anchor.length && anchor[0].properties.id) {
      setSelectedBuilding(null);
      openLandmark(anchor[0].properties.id);
      return;
    }
  }

  // 0a. Federal seal pins sit above the skyline on DC.
  if (map.getLayer('federal-pins')) {
    const federal = map.queryRenderedFeatures(e.point, { layers: ['federal-pins'] });
    if (federal.length && federal[0].properties.id) {
      setSelectedBuilding(null);
      openLandmark(federal[0].properties.id);
      return;
    }
  }

  // 0. Startup office pin? These sit visually above buildings and should win
  // the click target even when a building footprint is directly underneath.
  if (map.getLayer('startup-pins') && map.getLayoutProperty('startup-pins', 'visibility') !== 'none') {
    const startup = map.queryRenderedFeatures(e.point, { layers: ['startup-pins'] });
    if (startup.length && startup[0].properties.id) {
      setSelectedBuilding(null);
      openLandmark(startup[0].properties.id);
      return;
    }
  }

  // 1. Landmark ground-footprint hit?
  if (map.getLayer('landmark-fill')) {
    const lm = map.queryRenderedFeatures(e.point, { layers: ['landmark-fill'] });
    if (lm.length && lm[0].properties.id) {
      setSelectedBuilding(null);
      openLandmark(lm[0].properties.id);
      return;
    }
  }
  if (map.getLayer('landmark-glow')) {
    const marker = map.queryRenderedFeatures(e.point, { layers: ['landmark-glow'] });
    if (marker.length && marker[0].properties.id) {
      setSelectedBuilding(null);
      openLandmark(marker[0].properties.id);
      return;
    }
  }

  // 2. Any building under the cursor → its own card. If the building is a
  // curated landmark (matched by BIN), open the hand-written landmark card
  // instead of the parcel record.
  if (map.getLayer('buildings-fill')) {
    const bld = map.queryRenderedFeatures(e.point, { layers: ['buildings-fill'] });
    if (bld.length) {
      const idVal = bld[0].properties[ID_FIELD];
      const lm = idVal ? LANDMARKS.find(l => l[ID_FIELD] === idVal) : null;
      if (lm) {
        setSelectedBuilding(null);
        openLandmark(lm.id);
        return;
      }
      setSelectedBuilding(bld[0].id);
      const c = featureCentroid(bld[0]) || [e.lngLat.lng, e.lngLat.lat];
      openGenericAt({ lng: c[0], lat: c[1] }, fullBuildingProperties(bld[0].properties));
      return;
    }
  }

  // 3. Sliver-lot fallback — small radius around the click.
  if (map.getLayer('buildings-fill')) {
    const wider = map.queryRenderedFeatures(
      [[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]],
      { layers: ['buildings-fill'] }
    );
    if (wider.length) {
      setSelectedBuilding(wider[0].id);
      const c = featureCentroid(wider[0]) || [e.lngLat.lng, e.lngLat.lat];
      openGenericAt({ lng: c[0], lat: c[1] }, fullBuildingProperties(wider[0].properties));
      return;
    }
  }

  if (map.getLayer('landmark-bridge-fill')) {
    const bridge = map.queryRenderedFeatures(e.point, { layers: ['landmark-bridge-fill'] });
    if (bridge.length && bridge[0].properties.id) {
      setSelectedBuilding(null);
      openLandmark(bridge[0].properties.id);
      return;
    }
  }
  setSelectedBuilding(null);

  // 4. Linear features (bridges) are easy to miss with a precise click —
  // their footprints are thin ribbons. If no building was hit, check whether
  // the click is within ~250 m of a bridge coord and open that landmark.
  const near = nearestLandmark(e.lngLat);
  const bridgeClickRadiusKm = THEME.bridgeClickRadiusKm ?? 0.25;
  if (near && near.distKm < bridgeClickRadiusKm && near.landmark.id.endsWith('-bridge')) {
    openLandmark(near.landmark.id);
    return;
  }

  // 5. Truly empty space (water, road, park) — "outside the atlas" card.
  renderPanel({ generic: true, notFound: true, cityName: CITY.name });
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
  const hoverLayers = ['landmark-fill', 'landmark-bridge-fill', 'landmark-parts', 'landmark-glow'];
  if (map.getLayer('landmark-pin-anchor')) hoverLayers.push('landmark-pin-anchor');
  if (map.getLayer('landmark-pins')) hoverLayers.push('landmark-pins');
  if (map.getLayer('federal-pins')) hoverLayers.push('federal-pins');
  const lm = map.queryRenderedFeatures(e.point, { layers: hoverLayers.filter(id => map.getLayer(id)) });
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

// Snap an arbitrary lng/lat to the nearest building footprint visible on
// screen. Returns the centroid of the matched footprint, the feature id (so
// the caller can highlight it), and its properties.
function snapToBuilding(lng, lat) {
  if (!map.getLayer('buildings-fill')) return { lng, lat, id: null, props: null };
  const pt = map.project([lng, lat]);
  for (const r of [0, 6, 14, 28, 50, 80]) {
    const feats = map.queryRenderedFeatures(
      r === 0 ? pt : [[pt.x - r, pt.y - r], [pt.x + r, pt.y + r]],
      { layers: ['buildings-fill'] }
    );
    if (feats.length) {
      // For widening rings, pick the feature whose centroid is closest to the
      // original point so we don't grab a far building accidentally.
      let best = feats[0], bestD = Infinity;
      for (const f of feats) {
        const c = featureCentroid(f);
        if (!c) continue;
        const d = (c[0] - lng) ** 2 + (c[1] - lat) ** 2;
        if (d < bestD) { bestD = d; best = f; }
      }
      const c = featureCentroid(best);
      return {
        lng: c ? c[0] : lng,
        lat: c ? c[1] : lat,
        id: best.id,
        props: fullBuildingProperties(best.properties)
      };
    }
  }
  return { lng, lat, id: null, props: null };
}

function featureCentroid(feature) {
  const g = feature.geometry;
  if (!g) return null;
  const rings = g.type === 'Polygon' ? [g.coordinates[0]]
              : g.type === 'MultiPolygon' ? g.coordinates.map(p => p[0])
              : null;
  if (!rings) return null;
  let sx = 0, sy = 0, n = 0;
  for (const ring of rings) {
    for (const [x, y] of ring) { sx += x; sy += y; n++; }
  }
  return n ? [sx / n, sy / n] : null;
}

async function openGenericAt(lngLat, props = {}, knownAddress = null, opts = {}) {
  const { exactMatch = false } = opts;
  const localRecord = buildLocalRecord(lngLat, props);
  const fromSearch = !!knownAddress;
  // Only show the "best guess" disclaimer when search was a fuzzy snap; exact
  // BIN matches don't need it.
  const fuzzyMatch = fromSearch && !exactMatch;
  const initialAddress = knownAddress || localRecord.address || 'Loading address…';
  renderPanel({
    generic: true,
    era: localRecord.era,
    address: { ...localRecord, address: initialAddress },
    localOnly: true,
    addressLoading: !knownAddress && !localRecord.address,
    fromSearch: fuzzyMatch,
    cityName: CITY.name,
    sources: CITY.sources
  });
  document.getElementById('panel').classList.remove('panel--hidden');

  const parcelDetails = fetchAddress(lngLat.lng, lngLat.lat).catch(() => null);
  const reversePromise = knownAddress || localRecord.address
    ? Promise.resolve(knownAddress || localRecord.address)
    : reverseGeocode(lngLat.lng, lngLat.lat);

  const reverseAddr = await reversePromise;
  const parcelSettled = await Promise.race([parcelDetails, new Promise(r => setTimeout(() => r('pending'), 0))]);

  if (parcelSettled === 'pending' && reverseAddr && !knownAddress) {
    renderPanel({
      generic: true,
      era: localRecord.era,
      address: { ...localRecord, address: reverseAddr },
      localOnly: true,
      addressLoading: true,
      fromSearch: fuzzyMatch,
      cityName: CITY.name,
      sources: CITY.sources
    });
  }

  const details = await parcelDetails;
  if (details) {
    // Trust the BUILDING's own DOITT record (localRecord) for year/height
    // over PLUTO. PLUTO is parcel-based and the ±50m proximity query can
    // return a NEIGHBORING lot's year — which is how the displayed year
    // could end up disagreeing with our local data.
    const merged = { ...details, ...localRecord };
    // Bring in PLUTO fields that don't conflict with the building footprint:
    // address text, owner, units, building class, zoning, historic district.
    if (details.address) merged.address = details.address;
    if (details.owner) merged.owner = details.owner;
    if (details.units) merged.units = details.units;
    if (details.bldgclass) merged.bldgclass = details.bldgclass;
    if (details.zone) merged.zone = details.zone;
    if (details.histdist) merged.histdist = details.histdist;
    if (details.borough) merged.borough = details.borough;
    if (details.yearalter1) merged.yearalter1 = details.yearalter1;
    if (details.yearalter2) merged.yearalter2 = details.yearalter2;
    if (knownAddress) merged.address = knownAddress;
    else if (!merged.address) merged.address = reverseAddr || 'Address unavailable';
    renderPanel({
      generic: true,
      era: localRecord.era,
      address: merged,
      addressLoading: false,
      fromSearch: fuzzyMatch,
      cityName: CITY.name,
      sources: CITY.sources
    });
  } else {
    renderPanel({
      generic: true,
      era: localRecord.era,
      address: { ...localRecord, address: knownAddress || reverseAddr || 'Address unavailable' },
      localOnly: true,
      addressLoading: false,
      fromSearch: fuzzyMatch,
      cityName: CITY.name,
      sources: CITY.sources
    });
  }
}

async function fetchAddress(lng, lat) {
  if (CITY.fetchAddress) return CITY.fetchAddress(lng, lat);
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
  const startups = lookupStartupHistory(props);

  return {
    address: props.address || props.name || null,
    yearbuilt,
    yearBand: props.age_band || null,
    floors: props.stories ? parseFloat(props.stories) : estFloors,
    height: heightFt && props.height_available !== false ? `${Math.round(heightFt)} ft` : null,
    heightMeters: heightM && props.height_available !== false ? `${heightM} m` : null,
    heightEstimated: Boolean(THEME.heightEstimated || CITY.id === 'dc'),
    form: CITY.id === 'dc' ? null : describeBuildingForm(yearbuilt, heightFt),
    styleHint: CITY.id === 'dc' ? null : architecturalEra(yearbuilt, CITY.id),
    zone: null,
    histdist: null,
    era,
    owner: props.owner || null,
    architect: props.architect || props.architect_group || null,
    builder: props.builder || props.developer || null,
    material: props.material || props.front_material || null,
    purpose: props.purpose || props.house_type || null,
    permitNumber: props.permit_number || null,
    permitSource: props.permits_source || null,
    permitNotes: props.permit_notes || props.notes || null,
    squareLot: props.square_lot || null,
    facade: props.facade || null,
    roof: props.roof_material || props.roof_type || null,
    heat: props.heat || null,
    estimatedCost: props.estimated_cost || null,
    contributing: props.contributing || null,
    startups
  };
}

// Curated startup history lookup. NYC keys by BIN; SF keys by building_id or
// (more commonly) by mblr (block-lot id) since SF's block-lot is the natural
// "this is the building" identifier for famous HQs.
function lookupStartupHistory(props) {
  if (!props) return null;
  const bin = props.bin;
  if (bin && startupHistory.by_bin[String(bin)]) return startupHistory.by_bin[String(bin)];
  const bid = props.building_id;
  if (bid && startupHistory.by_building_id[String(bid)]) return startupHistory.by_building_id[String(bid)];
  const mblr = props.mblr;
  if (mblr && startupHistory.by_mblr[String(mblr)]) return startupHistory.by_mblr[String(mblr)];
  return null;
}

// Reverse-geocode via NYC Geosearch (same free API as the search bar).
// Returns the closest street address or null.
async function reverseGeocode(lng, lat) {
  if (CITY.reverseGeocoder) return CITY.reverseGeocoder(lng, lat);
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

function architecturalEra(year, cityId = 'nyc') {
  if (!year) return null;
  if (cityId === 'london') {
    if (year < 1900) return 'historic London fabric';
    if (year < 1930) return 'Edwardian and interwar London fabric';
    if (year < 1950) return 'interwar London fabric';
    if (year < 1967) return 'postwar rebuilding-era fabric';
    if (year < 1983) return 'late postwar London fabric';
    if (year < 1996) return 'late twentieth-century City development';
    if (year < 2012) return 'millennial City development';
    return 'recent City development';
  }
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

function focusPitch() {
  return THEME.preservePitchOnFocus ? map.getPitch() : Math.max(map.getPitch(), 45);
}

function openLandmark(id) {
  const landmark = LANDMARKS.find(l => l.id === id);
  if (!landmark) return;
  selectedLandmarkId = id;
  if (map.getLayer('landmark-selected')) {
    map.setFilter('landmark-selected', ['==', ['get', 'id'], id]);
  }
  const era = ERA_BY_ID[landmark.id] || 'beauxarts';
  renderPanel({ ...landmark, era, sourceFooter: CITY.sources?.landmarks });
  // Move just enough to frame the landmark next to the panel. If the user is
  // already close, keep their zoom (don't overshoot); only nudge in when far.
  const currentZoom = map.getZoom();
  const targetZoom = currentZoom >= 16 ? currentZoom : 16.5;
  map.easeTo({
    center: landmarkPoint(landmark),
    zoom: targetZoom,
    pitch: focusPitch(),
    duration: 900,
    offset: [220, 0]
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
  setSelectedBuilding(null);
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

function escapeAttr(s) {
  return escapeText(s).replace(/"/g, '&quot;');
}

createSearch({
  landmarks: LANDMARKS,
  geocoder: CITY.geocoder,
  cityName: CITY.name,
  onPickLandmark: (id) => {
    if (searchMarker) { searchMarker.remove(); searchMarker = null; }
    setSelectedBuilding(null);
    openLandmark(id);
  },
  onPickAddress: async (r) => {
    // r.idValue is the city's authoritative building id (BIN for NYC,
    // building_id for SF, etc.) returned by the geocoder when available.
    if (r.idValue != null) {
      const lm = LANDMARKS.find(l => l[ID_FIELD] === r.idValue);
      if (lm) {
        if (searchMarker) { searchMarker.remove(); searchMarker = null; }
        setSelectedBuilding(null);
        openLandmark(lm.id);
        return;
      }
    }
    // Prefer authoritative-id match when the geocoder gives us one — it lands
    // on the exact footprint with no proximity guessing.
    const idFeature = r.idValue != null ? buildingByBin.get(r.idValue) : null;
    if (idFeature) {
      const c = featureCentroid(idFeature) || r.coords;
      map.easeTo({ center: c, zoom: Math.max(map.getZoom(), 17), pitch: focusPitch(), duration: 900, offset: [220, 0] });
      placeSearchMarker(c[0], c[1], r.label);
      map.once('idle', () => {
        const pt = map.project(c);
        const feats = map.queryRenderedFeatures(pt, { layers: ['buildings-fill'] });
        const matched = feats.find(f => f.properties && f.properties[ID_FIELD] === r.idValue) || feats[0];
        if (matched) setSelectedBuilding(matched.id);
      });
      openGenericAt({ lng: c[0], lat: c[1] }, idFeature.properties, r.label, { exactMatch: true });
      return;
    }

    // No id (rare, e.g. an intersection or place result) → centroid snap.
    const [lng, lat] = r.coords;
    map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 17), pitch: focusPitch(), duration: 900, offset: [220, 0] });
    map.once('idle', () => {
      if (THEME.exactSearchSelection) {
        const point = map.project([lng, lat]);
        const exact = map.queryRenderedFeatures(point, { layers: ['buildings-fill'] })[0] || null;
        placeSearchMarker(lng, lat, r.label);
        if (exact) {
          setSelectedBuilding(exact.id);
          const props = fullBuildingProperties(exact.properties);
          openGenericAt({ lng, lat }, props, props.address || r.label, { exactMatch: false });
        } else {
          setSelectedBuilding(null);
          renderPanel({ generic: true, notFound: true, cityName: CITY.name });
          document.getElementById('panel').classList.remove('panel--hidden');
        }
        return;
      }
      const snap = snapToBuilding(lng, lat);
      setSelectedBuilding(snap.id);
      placeSearchMarker(snap.lng, snap.lat, r.label);
      openGenericAt({ lng: snap.lng, lat: snap.lat }, snap.props || {}, r.label, { exactMatch: false });
    });
  },
  onClear: () => {
    if (searchMarker) { searchMarker.remove(); searchMarker = null; }
    setSelectedBuilding(null);
  }
});

function updateLoading(msg, pct) {
  const hint = document.getElementById('loading-hint');
  if (hint) hint.textContent = msg;
  const fill = document.getElementById('loading-fill');
  if (fill && typeof pct === 'number') fill.style.width = pct + '%';
}
