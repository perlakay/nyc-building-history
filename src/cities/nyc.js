// NYC city config consumed by the shared map engine in src/main.js.
// Loaded by nyc.html, which sets `window.CITY = NYC` before main.js runs.

import { LANDMARKS, ERA_BY_ID } from './nyc-landmarks.js';

// NYC Geosearch — free, no key, returns addresses + the city's authoritative
// BIN (Building Identification Number) in `addendum.pad`.
const GEOSEARCH = 'https://geosearch.planninglabs.nyc/v2/search';

async function geocoder(q) {
  const url = `${GEOSEARCH}?text=${encodeURIComponent(q)}` +
    `&focus.point.lat=40.7128&focus.point.lon=-74.006` +
    `&boundary.rect.min_lat=40.49&boundary.rect.max_lat=40.93` +
    `&boundary.rect.min_lon=-74.30&boundary.rect.max_lon=-73.68` +
    `&size=8`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('geosearch ' + res.status);
  const data = await res.json();
  return (data.features || []).map(f => {
    const bin = f.properties.addendum?.pad?.bin;
    return {
      kind: 'address',
      label: f.properties.label || f.properties.name,
      borough: [f.properties.borough, f.properties.locality].filter(Boolean).join(', ') || 'New York City',
      coords: f.geometry.coordinates,
      idValue: bin ? parseInt(bin, 10) : null,
      name: f.properties.label
    };
  });
}

export const NYC = {
  id: 'nyc',
  name: 'New York City',
  idField: 'bin',
  // Building data
  attribution: '© <a href="https://carto.com/">CARTO</a> · © <a href="https://openstreetmap.org">OpenStreetMap</a> · Buildings © <a href="https://data.cityofnewyork.us/Housing-Development/Building-Footprints/5zhs-2jue">NYC DOITT</a>',
  // Camera framing — Empire State, dramatic 3D opening shot
  center: [-73.9857, 40.7484],
  zoom: 14.6,
  pitch: 62,
  bearing: -22,
  bounds: [[-74.30, 40.49], [-73.68, 40.93]],
  minZoom: 10.8,
  maxZoom: 18,
  theme: {
    mapBackground: '#4C4335',
    landmarkMarker: '#FFD27A',
    selected: '#FFA770',
    eraRamp: [
      'step',
      ['coalesce', ['get', 'y'], 1900],
      '#6A5940',
      1900, '#FFA770',
      1930, '#886139',
      1960, '#FFB53E',
      2000, '#D77336'
    ]
  },
  // Curated content
  landmarks: LANDMARKS,
  eraById: ERA_BY_ID,
  geocoder,
};
