import maplibregl from 'maplibre-gl';

const cities = [
  {
    id: 'nyc',
    name: 'New York City',
    mapLabel: 'New York',
    region: 'United States',
    meta: 'Manhattan building atlas',
    href: '/nyc.html',
    coordinates: [-74.006, 40.713],
    color: '#FFA770'
  },
  {
    id: 'sf',
    name: 'San Francisco',
    mapLabel: 'San Francisco',
    region: 'United States',
    meta: 'Bay skyline atlas',
    href: '/sf.html',
    coordinates: [-122.419, 37.775],
    color: '#DCFF3E'
  },
  {
    id: 'london',
    name: 'Central London',
    mapLabel: 'London',
    region: 'United Kingdom',
    meta: 'Westminster to Tower Bridge',
    href: '/london.html',
    coordinates: [-0.096, 51.512],
    color: '#25C5E9'
  }
];

const cityPoints = {
  type: 'FeatureCollection',
  features: cities.map(city => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: city.coordinates },
    properties: { color: city.color, id: city.id }
  }))
};

const map = new maplibregl.Map({
  container: 'atlas-map',
  style: {
    version: 8,
    sources: {
      base: {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        attribution: '© CARTO · © OpenStreetMap'
      },
      labels: {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}.png'],
        tileSize: 256
      }
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#071116' } },
      { id: 'base', type: 'raster', source: 'base', paint: { 'raster-opacity': 0.58, 'raster-saturation': -0.85 } },
      { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.54 } }
    ]
  },
  center: [-45, 42],
  zoom: 2.35,
  minZoom: 1.8,
  maxZoom: 10,
  renderWorldCopies: false,
  maxBounds: [[-180, -85], [180, 85]],
  pitch: 0,
  bearing: 0
});

map.on('load', () => {
  map.addSource('cities', { type: 'geojson', data: cityPoints });
  map.addLayer({
    id: 'city-halo',
    type: 'circle',
    source: 'cities',
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 22, 6, 62],
      'circle-opacity': 0.12,
      'circle-blur': 0.55
    }
  });
  map.addLayer({
    id: 'city-light',
    type: 'circle',
    source: 'cities',
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 9, 6, 20],
      'circle-opacity': 0.18,
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': 1,
      'circle-stroke-opacity': 0.55
    }
  });

  for (const city of cities) {
    const pin = document.createElement('div');
    pin.className = `city-pin city-pin--${city.id}`;
    const link = document.createElement('a');
    link.className = `city-marker city-marker--${city.id}`;
    link.href = city.href;
    link.setAttribute('aria-label', `Open ${city.name} atlas`);
    link.innerHTML = `
      <span class="city-marker__flag"></span>
      <span class="city-marker__copy">
        <span class="city-marker__name">${city.mapLabel}</span>
      </span>
    `;
    pin.appendChild(link);
    new maplibregl.Marker({ element: pin, anchor: 'center' })
      .setLngLat(city.coordinates)
      .addTo(map);
  }
});

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
