import { LANDMARKS, ERA_BY_ID } from './london-landmarks.js';

const VIEWBOX = '-0.175,51.552,0.018,51.455';

async function geocoder(q) {
  const url = 'https://nominatim.openstreetmap.org/search?' +
    new URLSearchParams({
      q: `${q}, Central London, United Kingdom`,
      format: 'geojson',
      addressdetails: '1',
      limit: '8',
      viewbox: VIEWBOX,
      bounded: '1'
    });
  const response = await fetch(url);
  if (!response.ok) throw new Error('nominatim ' + response.status);
  const data = await response.json();
  return (data.features || []).map(feature => ({
    kind: 'address',
    label: feature.properties?.display_name || q,
    borough: 'Central London',
    coords: feature.geometry.coordinates,
    idValue: null,
    name: feature.properties?.display_name || q
  }));
}

async function reverseGeocoder(lng, lat) {
  const url = 'https://nominatim.openstreetmap.org/reverse?' +
    new URLSearchParams({ lon: String(lng), lat: String(lat), format: 'jsonv2', zoom: '18' });
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const result = await response.json();
    return result.display_name || null;
  } catch {
    return null;
  }
}

export const LONDON = {
  id: 'london',
  name: 'Central London',
  idField: 'bin',
  attribution: 'Buildings © <a href="https://www.ordnancesurvey.co.uk/">Ordnance Survey</a> · Ages © <a href="https://data.london.gov.uk/dataset/london-building-stock-model-2-lbsm-2-2k55d/">GLA LBSM 2</a>',
  center: [-0.078, 51.505],
  zoom: 12.25,
  pitch: 0,
  bearing: 0,
  explorePitch: 54,
  exploreBearing: -22,
  bounds: [[-0.19, 51.44], [0.04, 51.57]],
  minZoom: 11.35,
  maxZoom: 19,
  theme: {
    mapBackground: '#021225',
    landmarkMarker: '#86F2FF',
    selected: '#F2FFF6',
    showLandmarkLabels: false,
    hideLandmarkGlow: true,
    landmarkPins: true,
    preserveBoundLandmarkFootprints: true,
    heightEstimated: true,
    preservePitchOnFocus: true,
    pinAtCuratedCoordinates: true,
    exactSearchSelection: true,
    bridgeClickRadiusKm: 0.04,
    eraRamp: [
      'step',
      ['coalesce', ['get', 'y'], 0],
      '#15384B',
      1800, '#20566A',
      1900, '#F2FFF6',
      1930, '#238689',
      1950, '#CAFFDE',
      1967, '#25C5E9',
      1983, '#19707C',
      1996, '#8FE8D7',
      2012, '#4ADCEB'
    ]
  },
  landmarks: LANDMARKS,
  eraById: ERA_BY_ID,
  geocoder,
  reverseGeocoder,
  sources: {
    local: 'Sources · Ordnance Survey OpenMap Local official footprints retrieved 24 May 2026; GLA London Building Stock Model 2 age bands based on October 2024 data only where its point falls inside that footprint',
    parcel: 'Sources · Ordnance Survey OpenMap Local official footprints retrieved 24 May 2026; GLA London Building Stock Model 2 age bands based on October 2024 data',
    landmarks: 'Stories curated · landmark history and design notes'
  }
};
