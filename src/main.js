import maplibregl from 'maplibre-gl';
import { renderPanel, renderWelcomePanel } from './panel.js';
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
const STARTUP_MARKER_COLOR = '#9b5cff';
const LANDMARK_MARKER_COLOR = '#c43a1f';
const DATA = (path) => `/data/${CITY.id}/${path}`;
// Per-city building id — `bin` for NYC, `building_id` for SF, etc. The engine
// uses this name for index keys, search routing, and de-duping curated lots.
const ID_FIELD = CITY.idField;
console.log('[atlas] starting', CITY.id, '— buildings will load from', DATA('buildings.geojson'));

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
  center: CITY.center,
  zoom: CITY.zoom,
  pitch: CITY.pitch,
  bearing: CITY.bearing,
  maxBounds: CITY.bounds,
  minZoom: CITY.minZoom,
  maxZoom: CITY.maxZoom ?? 18,
  antialias: true
});
window.mapDebug = map;

let selectedLandmarkId = null;
let selectedBuildingId = null;

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
  const res = await fetch(DATA('buildings.geojson'));
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
    for (const f of fc.features) {
      const bin = f.properties && f.properties[ID_FIELD];
      if (bin != null) {
        buildingByBin.set(bin, f);
        const ov = buildingOverrides[String(bin)];
        if (ov) {
          if (ov.y != null) f.properties.y = ov.y;
          if (ov.h != null) f.properties.h = ov.h;
          if (ov.name != null) f.properties.name = ov.name;
          f.properties.corrected = true;
        }
      }
    }
    const lmRes = await fetch(DATA('landmark_footprints.geojson'));
    const lmFc = await lmRes.json();
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
          geometry: { type: 'Point', coordinates: l.coords },
          properties: { id: l.id, name: l.name, kind: l.kind || 'landmark' }
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

    // Hide the generic buildings-fill polygon for any BIN that's a curated
    // landmark — those are drawn by the dedicated landmark-fill layer in their
    // signature red. Stops the z-fighting / hover-flicker between the two.
    const landmarkIds = LANDMARKS.map(l => l[ID_FIELD]).filter(Boolean);
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
          '#f3d27a',
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
      filter: ['!=', ['get', 'kind'], 'startup'],
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          11, 4,
          14, 7,
          17, 10
        ],
        'circle-color': [
          'case',
          ['==', ['get', 'kind'], 'startup'],
          STARTUP_MARKER_COLOR,
          LANDMARK_MARKER_COLOR
        ],
        'circle-opacity': 0.65,
        'circle-blur': 0.5,
        'circle-stroke-color': '#fffaf0',
        'circle-stroke-width': 1.5,
        'circle-stroke-opacity': 0.7
      }
    });

    await addStartupOfficePins();
    setupStartupToggle();

    renderWelcomePanel({
      buildingCount: fc.features.length,
      landmarkCount: LANDMARKS.length,
      cityName: CITY.name
    });
    document.getElementById('loading').classList.add('loading--hidden');
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

// Compass — rotate rose based on map bearing, click toggles top-down ↔ 3D.
const DEFAULT_PITCH = CITY.pitch;
const DEFAULT_BEARING = CITY.bearing;
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

  // Landmark point markers are intentionally small and always visible. They
  // make off-footprint places like bridges and startup offices easy to open.
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
      openGenericAt({ lng: c[0], lat: c[1] }, bld[0].properties);
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
      openGenericAt({ lng: c[0], lat: c[1] }, wider[0].properties);
      return;
    }
  }
  setSelectedBuilding(null);

  // 4. Linear features (bridges) are easy to miss with a precise click —
  // their footprints are thin ribbons. If no building was hit, check whether
  // the click is within ~250 m of a bridge coord and open that landmark.
  const near = nearestLandmark(e.lngLat);
  if (near && near.distKm < 0.25 && near.landmark.id.endsWith('-bridge')) {
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
        props: best.properties
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
  const initialAddress = knownAddress || 'Loading address…';
  renderPanel({
    generic: true,
    era: localRecord.era,
    address: { ...localRecord, address: initialAddress },
    localOnly: true,
    addressLoading: !knownAddress,
    fromSearch: fuzzyMatch,
    cityName: CITY.name,
    sources: CITY.sources
  });
  document.getElementById('panel').classList.remove('panel--hidden');

  const parcelDetails = fetchAddress(lngLat.lng, lngLat.lat).catch(() => null);
  const reversePromise = knownAddress ? Promise.resolve(knownAddress) : reverseGeocode(lngLat.lng, lngLat.lat);

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
    address: null,            // resolved async — see openGenericAt
    yearbuilt,
    floors: estFloors,
    height: heightFt ? `${Math.round(heightFt)} ft` : null,
    heightMeters: heightM ? `${heightM} m` : null,
    form: describeBuildingForm(yearbuilt, heightFt),
    styleHint: architecturalEra(yearbuilt),
    zone: null,
    histdist: null,
    era,
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
  renderPanel({ ...landmark, era, sourceFooter: CITY.sources?.landmarks });
  // Move just enough to frame the landmark next to the panel. If the user is
  // already close, keep their zoom (don't overshoot); only nudge in when far.
  const currentZoom = map.getZoom();
  const targetZoom = currentZoom >= 16 ? currentZoom : 16.5;
  map.easeTo({
    center: landmark.coords,
    zoom: targetZoom,
    pitch: Math.max(map.getPitch(), 45),
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
      map.easeTo({ center: c, zoom: Math.max(map.getZoom(), 17), pitch: Math.max(map.getPitch(), 45), duration: 900, offset: [220, 0] });
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
    map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 17), pitch: Math.max(map.getPitch(), 45), duration: 900, offset: [220, 0] });
    map.once('idle', () => {
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
