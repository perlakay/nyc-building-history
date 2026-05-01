// San Francisco city config consumed by the shared map engine in src/main.js.
// Loaded by sf.html, which sets `window.CITY = SF` before main.js runs.

import { LANDMARKS, ERA_BY_ID } from './sf-landmarks.js';

const VIEWBOX = '-122.52,37.84,-122.35,37.70';

async function geocoder(q) {
  const url = 'https://nominatim.openstreetmap.org/search?' +
    new URLSearchParams({
      q,
      format: 'geojson',
      addressdetails: '1',
      limit: '8',
      viewbox: VIEWBOX,
      bounded: '1'
    });
  const res = await fetch(url);
  if (!res.ok) throw new Error('nominatim ' + res.status);
  const data = await res.json();
  return (data.features || []).map(f => {
    const p = f.properties || {};
    const a = p.address || {};
    return {
      kind: 'address',
      label: p.display_name || p.name,
      borough: [a.neighbourhood || a.suburb || a.quarter, 'San Francisco'].filter(Boolean).join(', '),
      coords: f.geometry.coordinates,
      idValue: null,
      name: p.display_name || p.name
    };
  });
}

function compactAddress(properties = {}) {
  const a = properties.address || {};
  const name = properties.name || a.amenity || a.shop || a.office || a.building;
  const street = a.road || a.pedestrian || a.footway || a.neighbourhood || a.suburb;
  const house = a.house_number;
  if (house && street) return `${house} ${street}`;
  if (name && street && !String(name).includes(street)) return `${name}, ${street}`;
  if (name) return name;
  if (street) return street;
  return properties.display_name ? properties.display_name.split(',').slice(0, 2).join(',').trim() : null;
}

async function reverseGeocoder(lng, lat) {
  const url = 'https://nominatim.openstreetmap.org/reverse?' +
    new URLSearchParams({
      lon: String(lng),
      lat: String(lat),
      format: 'geojson',
      addressdetails: '1',
      zoom: '18'
    });
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const f = (data.features || [])[0];
  return compactAddress(f?.properties || {}) || null;
}

export const SF = {
  id: 'sf',
  name: 'San Francisco',
  idField: 'bin',
  attribution: '© <a href="https://carto.com/">CARTO</a> · © <a href="https://openstreetmap.org">OpenStreetMap</a> · Buildings © <a href="https://data.sfgov.org/Geographic-Locations-and-Boundaries/Building-Footprints/ynuv-fyni">DataSF</a>',
  center: [-122.431, 37.797],
  zoom: 12.7,
  pitch: 58,
  bearing: 18,
  bounds: [[-122.53, 37.68], [-122.34, 37.84]],
  minZoom: 10.8,
  maxZoom: 18,
  landmarks: LANDMARKS,
  eraById: ERA_BY_ID,
  geocoder,
  reverseGeocoder,
  sources: {
    local: 'Source · SF building footprints and LiDAR heights via <a href="https://data.sfgov.org/Geographic-Locations-and-Boundaries/Building-Footprints/ynuv-fyni" target="_blank">DataSF</a>',
    parcel: 'Source · SF building footprints, assessor years, and address lookup',
    landmarks: 'Story curated · building data via <a href="https://data.sfgov.org/" target="_blank">DataSF</a> and OpenStreetMap'
  }
};
