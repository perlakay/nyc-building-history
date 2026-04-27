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

// BIN → building feature index. Built once when buildings load so we can
// snap a search hit to the exact footprint by NYC's authoritative ID.
const buildingByBin = new Map();

map.on('load', async () => {
  try {
    const fc = await loadBuildings();
    for (const f of fc.features) {
      const bin = f.properties && f.properties.bin;
      if (bin != null) buildingByBin.set(bin, f);
    }
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

    // Neighborhoods overlay (toggleable). Soft outlines + labels — does not
    // overtake the buildings unless the toggle is on.
    try {
      const hoodsRes = await fetch('/data/neighborhoods.geojson');
      const hoodsFc = await hoodsRes.json();
      // Source uses array-index ids so feature-state works deterministically.
      hoodsFc.features.forEach((f, i) => { f.id = i; });
      buildHoodsList(hoodsFc);
      map.addSource('hoods', { type: 'geojson', data: hoodsFc });
      // Color each neighborhood from its own feature property — so the
      // overlay reads as a map-of-distinct-areas, not one wash of color.
      // Layer is below buildings-fill so it never covers the towers.
      map.addLayer({
        id: 'hoods-fill',
        type: 'fill',
        source: 'hoods',
        layout: { visibility: 'none' },
        paint: {
          'fill-color': ['coalesce', ['get', 'color'], '#888'],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 0.32,
            0.14
          ]
        }
      }, 'buildings-fill');
      map.addLayer({
        id: 'hoods-outline',
        type: 'line',
        source: 'hoods',
        layout: { visibility: 'none' },
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#888'],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 2.5,
            1.2
          ],
          'line-opacity': 0.85
        }
      }, 'buildings-fill');
    } catch (e) {
      console.warn('neighborhoods overlay unavailable', e);
    }

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

// Neighborhoods overlay + side panel.
const hoodsToggle = document.getElementById('hoods-toggle');
const hoodsListEl = document.getElementById('hoods-list');
const hoodsItemsEl = document.getElementById('hoods-list-items');
let hoodsVisible = false;
let hoodsData = null;
let selectedHoodId = null;

// Two independent states: the map overlay (the colored polygons) and the
// side panel (the list of neighborhoods).
let hoodsPanelOpen = false;

function setHoodsOverlay(on) {
  hoodsVisible = on;
  hoodsToggle?.setAttribute('aria-pressed', String(on));
  hoodsToggle?.classList.toggle('hoods-toggle--active', on);
  const v = on ? 'visible' : 'none';
  if (map.getLayer('hoods-fill')) map.setLayoutProperty('hoods-fill', 'visibility', v);
  if (map.getLayer('hoods-outline')) map.setLayoutProperty('hoods-outline', 'visibility', v);
  if (!on) selectHood(null);
}

function setHoodsPanel(open) {
  hoodsPanelOpen = open;
  hoodsListEl?.classList.toggle('hoods-list--hidden', !open);
}

// The toggle button turns the overlay on/off AND opens the list when turning
// on, but doesn't force the list closed when turning off (so you can keep the
// panel open even with overlay off, or vice versa). Closing the panel via the
// × button leaves the overlay on the map.
hoodsToggle?.addEventListener('click', () => {
  const next = !hoodsVisible;
  setHoodsOverlay(next);
  if (next) setHoodsPanel(true);
});
document.getElementById('hoods-list-close')?.addEventListener('click', () => {
  setHoodsPanel(false);
});

// Per-neighborhood visibility set. All on by default.
const hoodVisibility = new Map();

function buildHoodsList(fc) {
  hoodsData = fc;
  for (const f of fc.features) {
    if (!hoodVisibility.has(f.properties.id)) hoodVisibility.set(f.properties.id, true);
  }
  if (!hoodsItemsEl) return;
  hoodsItemsEl.innerHTML = fc.features.map(f => {
    const p = f.properties;
    const on = hoodVisibility.get(p.id);
    return `<div class="hoods-list__item${on ? ' hoods-list__item--on' : ''}" data-id="${escapeAttr(p.id)}" style="--hood-color:${escapeAttr(p.color)}">
      <button class="hoods-list__check" data-action="toggle" aria-pressed="${on}" title="Show/hide">
        <span class="hoods-list__swatch"></span>
      </button>
      <button class="hoods-list__name" data-action="select">${escape(p.name)}</button>
    </div>`;
  }).join('');
  hoodsItemsEl.querySelectorAll('.hoods-list__item').forEach(el => {
    const id = el.dataset.id;
    el.querySelector('[data-action="toggle"]').addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleHoodVisibility(id);
    });
    el.querySelector('[data-action="select"]').addEventListener('click', () => {
      // Auto-enable visibility when picking a hidden hood, so the user can
      // see what they just selected.
      if (!hoodVisibility.get(id)) toggleHoodVisibility(id, true);
      selectHood(id);
    });
  });
  applyHoodFilter();
}

function applyHoodFilter() {
  if (!map.getLayer('hoods-fill')) return;
  // Filter out hoods whose visibility is false.
  const hiddenIds = [...hoodVisibility.entries()].filter(([, v]) => !v).map(([k]) => k);
  const filter = hiddenIds.length
    ? ['!', ['in', ['get', 'id'], ['literal', hiddenIds]]]
    : null;
  map.setFilter('hoods-fill', filter);
  map.setFilter('hoods-outline', filter);
}

function toggleHoodVisibility(id, force) {
  const next = typeof force === 'boolean' ? force : !hoodVisibility.get(id);
  hoodVisibility.set(id, next);
  const el = hoodsItemsEl?.querySelector(`.hoods-list__item[data-id="${cssEscape(id)}"]`);
  if (el) {
    el.classList.toggle('hoods-list__item--on', next);
    el.querySelector('[data-action="toggle"]')?.setAttribute('aria-pressed', String(next));
  }
  // If we just hid the currently selected hood, drop the selection.
  if (!next && selectedHoodId === id) selectHood(null);
  applyHoodFilter();
}

function setAllHoodsVisibility(visible) {
  for (const id of hoodVisibility.keys()) hoodVisibility.set(id, visible);
  hoodsItemsEl?.querySelectorAll('.hoods-list__item').forEach(el => {
    el.classList.toggle('hoods-list__item--on', visible);
    el.querySelector('[data-action="toggle"]')?.setAttribute('aria-pressed', String(visible));
  });
  if (!visible) selectHood(null);
  applyHoodFilter();
}

function cssEscape(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function escape(s) {
  return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
}

function selectHood(id) {
  // Clear previous selection by feature index.
  if (selectedHoodId !== null && hoodsData) {
    const prev = hoodsData.features.find(x => x.properties.id === selectedHoodId);
    if (prev) {
      try { map.setFeatureState({ source: 'hoods', id: prev.id }, { selected: false }); } catch {}
    }
  }
  selectedHoodId = id;
  hoodsItemsEl?.querySelectorAll('.hoods-list__item').forEach(el => {
    el.classList.toggle('hoods-list__item--active', el.dataset.id === id);
  });
  if (id == null || !hoodsData) return;
  const f = hoodsData.features.find(x => x.properties.id === id);
  if (!f) return;
  try { map.setFeatureState({ source: 'hoods', id: f.id }, { selected: true }); } catch {}
  // Fly to the polygon's center.
  const c = featureCentroid(f);
  if (c) map.easeTo({ center: c, zoom: Math.max(map.getZoom(), 14), pitch: 50, duration: 700, offset: [220, 0] });
  openNeighborhood(f.properties);
}

function escapeAttr(s) { return String(s).replace(/[&"<>']/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;',"'":'&#39;'}[c])); }

// Single click handler — every building should pop a card.
// We only treat a click as a "landmark" click when it hits the landmark's
// GROUND FOOTPRINT (`landmark-fill`). Tower setbacks / spires (`landmark-parts`,
// which sit high in the air with `min_h_m > 0`) are excluded — otherwise they
// hijack clicks on adjacent buildings whose pixels happen to sit under a spire.
map.on('click', (e) => {
  // 1. Landmark ground-footprint hit?
  if (map.getLayer('landmark-fill')) {
    const lm = map.queryRenderedFeatures(e.point, { layers: ['landmark-fill'] });
    if (lm.length && lm[0].properties.id) {
      setSelectedBuilding(null);
      openLandmark(lm[0].properties.id);
      return;
    }
  }

  // 2. Any building under the cursor → its own card.
  // (Neighborhood overlay does not intercept clicks — interaction is via
  // the side panel only, so it never gets in the way of building clicks.)
  if (map.getLayer('buildings-fill')) {
    const bld = map.queryRenderedFeatures(e.point, { layers: ['buildings-fill'] });
    if (bld.length) {
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
    fromSearch: fuzzyMatch
  });
  document.getElementById('panel').classList.remove('panel--hidden');

  const pluto = fetchAddress(lngLat.lng, lngLat.lat).catch(() => null);
  const reversePromise = knownAddress ? Promise.resolve(knownAddress) : reverseGeocode(lngLat.lng, lngLat.lat);

  const reverseAddr = await reversePromise;
  const plutoSettled = await Promise.race([pluto, new Promise(r => setTimeout(() => r('pending'), 0))]);

  if (plutoSettled === 'pending' && reverseAddr && !knownAddress) {
    renderPanel({
      generic: true,
      era: localRecord.era,
      address: { ...localRecord, address: reverseAddr },
      localOnly: true,
      addressLoading: true,
      fromSearch: fuzzyMatch
    });
  }

  const details = await pluto;
  if (details) {
    const merged = { ...localRecord, ...details };
    if (knownAddress) merged.address = knownAddress;
    else if (!merged.address) merged.address = reverseAddr || 'Address unavailable';
    renderPanel({
      generic: true,
      era: eraFromYear(details.yearbuilt) || localRecord.era,
      address: merged,
      addressLoading: false,
      fromSearch: fuzzyMatch
    });
  } else {
    renderPanel({
      generic: true,
      era: localRecord.era,
      address: { ...localRecord, address: knownAddress || reverseAddr || 'Address unavailable' },
      localOnly: true,
      addressLoading: false,
      fromSearch: fuzzyMatch
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

function openNeighborhood(props) {
  setSelectedBuilding(null);
  selectedLandmarkId = null;
  if (map.getLayer('landmark-selected')) {
    map.setFilter('landmark-selected', ['==', ['get', 'id'], '']);
  }
  renderPanel({
    name: props.name,
    style: 'Neighborhood',
    year: '—',
    history: props.blurb,
    era: props.era || 'beauxarts',
    isHood: true
  });
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

createSearch({
  landmarks: LANDMARKS,
  onPickLandmark: (id) => {
    if (searchMarker) { searchMarker.remove(); searchMarker = null; }
    setSelectedBuilding(null);
    openLandmark(id);
  },
  onPickAddress: async (r) => {
    // Prefer BIN match (NYC's authoritative building id) when Geosearch
    // gives us one — it lands on the exact footprint, no proximity guessing.
    const binFeature = r.bin ? buildingByBin.get(r.bin) : null;
    if (binFeature) {
      const c = featureCentroid(binFeature) || r.coords;
      map.easeTo({ center: c, zoom: Math.max(map.getZoom(), 17), pitch: Math.max(map.getPitch(), 45), duration: 900, offset: [220, 0] });
      placeSearchMarker(c[0], c[1], r.label);
      // Grab the rendered feature's id at the centroid so feature-state
      // shading lights up the exact footprint (id source = MapLibre's
      // internal generated id, which we can't predict from BIN alone).
      map.once('idle', () => {
        const pt = map.project(c);
        const feats = map.queryRenderedFeatures(pt, { layers: ['buildings-fill'] });
        const matched = feats.find(f => f.properties && f.properties.bin === r.bin) || feats[0];
        if (matched) setSelectedBuilding(matched.id);
      });
      openGenericAt({ lng: c[0], lat: c[1] }, binFeature.properties, r.label, { exactMatch: true });
      return;
    }

    // No BIN (rare, e.g. an intersection or place result) → centroid snap.
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
