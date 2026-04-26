// Tiny hand-drawn-feel SVG doodles per landmark. Pure silhouettes — meant to be
// glanceable at small size on the map. Each is 60x80, dark ink on transparent bg.

const INK = '#2a1a14';
const FILL = '#fffaf0';

function svg(inner) {
  return `<svg viewBox="0 0 60 80" xmlns="http://www.w3.org/2000/svg" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" fill="${FILL}">
    ${inner}
  </svg>`;
}

// Empire State — setback skyscraper
const empireState = svg(`
  <rect x="20" y="32" width="20" height="42"/>
  <rect x="22" y="22" width="16" height="10"/>
  <rect x="25" y="14" width="10" height="8"/>
  <line x1="30" y1="14" x2="30" y2="6" stroke-width="1.2"/>
  <circle cx="30" cy="5" r="1.5" fill="${INK}"/>
`);

// Chrysler — pointed sunburst spire
const chrysler = svg(`
  <rect x="22" y="38" width="16" height="36"/>
  <path d="M22 38 L30 14 L38 38 Z"/>
  <path d="M25 36 Q30 22 35 36"/>
  <path d="M27 33 Q30 26 33 33"/>
  <line x1="30" y1="14" x2="30" y2="6" stroke-width="1.2"/>
`);

// Flatiron — wedge
const flatiron = svg(`
  <path d="M22 24 L40 30 L38 74 L24 74 Z"/>
  <line x1="22" y1="40" x2="39" y2="44" stroke-width="0.8"/>
  <line x1="22" y1="56" x2="38" y2="60" stroke-width="0.8"/>
`);

// Grand Central — Beaux-Arts façade with clock
const grandCentral = svg(`
  <rect x="8" y="42" width="44" height="32"/>
  <rect x="16" y="32" width="28" height="10"/>
  <path d="M20 32 L30 18 L40 32"/>
  <circle cx="30" cy="28" r="3.5" fill="${FILL}"/>
  <line x1="30" y1="25" x2="30" y2="28" stroke-width="0.8"/>
  <line x1="30" y1="28" x2="32" y2="30" stroke-width="0.8"/>
`);

// Woolworth — Gothic spire
const woolworth = svg(`
  <rect x="22" y="32" width="16" height="42"/>
  <path d="M22 32 L30 12 L38 32 Z"/>
  <line x1="30" y1="12" x2="30" y2="4" stroke-width="1.2"/>
`);

// Rockefeller — slab
const rockefeller = svg(`
  <rect x="20" y="14" width="20" height="60"/>
  <line x1="20" y1="28" x2="40" y2="28" stroke-width="0.6"/>
  <line x1="20" y1="42" x2="40" y2="42" stroke-width="0.6"/>
  <line x1="20" y1="56" x2="40" y2="56" stroke-width="0.6"/>
`);

// One WTC — tapering prism
const oneWtc = svg(`
  <path d="M22 74 L38 74 L36 14 L24 14 Z"/>
  <line x1="30" y1="14" x2="30" y2="6" stroke-width="1.2"/>
`);

// Brooklyn Bridge — twin towers + cables
const brooklynBridge = svg(`
  <rect x="10" y="40" width="6" height="30"/>
  <rect x="44" y="40" width="6" height="30"/>
  <path d="M10 40 L10 35 Q13 32 16 35 L16 40"/>
  <path d="M44 40 L44 35 Q47 32 50 35 L50 40"/>
  <path d="M13 36 Q30 56 47 36" stroke-width="1.2"/>
  <line x1="6" y1="58" x2="54" y2="58" stroke-width="1"/>
`);

// Guggenheim — spiral
const guggenheim = svg(`
  <path d="M16 70 L44 70 Q42 60 44 56 Q40 52 44 46 Q40 42 44 36 Q40 32 44 28 L16 28 Q20 32 16 36 Q20 42 16 46 Q20 52 16 56 Q20 60 16 70 Z"/>
  <circle cx="30" cy="48" r="3"/>
`);

// The Met — wide Beaux-Arts façade
const metMuseum = svg(`
  <rect x="6" y="42" width="48" height="32"/>
  <rect x="20" y="26" width="20" height="16"/>
  <path d="M18 26 L30 14 L42 26"/>
  <line x1="22" y1="34" x2="22" y2="42" stroke-width="0.6"/>
  <line x1="28" y1="34" x2="28" y2="42" stroke-width="0.6"/>
  <line x1="32" y1="34" x2="32" y2="42" stroke-width="0.6"/>
  <line x1="38" y1="34" x2="38" y2="42" stroke-width="0.6"/>
`);

// MoMA — modernist box
const moma = svg(`
  <rect x="16" y="22" width="28" height="52"/>
  <line x1="22" y1="22" x2="22" y2="74" stroke-width="0.6"/>
  <line x1="30" y1="22" x2="30" y2="74" stroke-width="0.6"/>
  <line x1="38" y1="22" x2="38" y2="74" stroke-width="0.6"/>
  <line x1="16" y1="34" x2="44" y2="34" stroke-width="0.6"/>
  <line x1="16" y1="48" x2="44" y2="48" stroke-width="0.6"/>
  <line x1="16" y1="62" x2="44" y2="62" stroke-width="0.6"/>
`);

// Seagram — bronze tower
const seagram = svg(`
  <rect x="20" y="18" width="20" height="56"/>
  <line x1="24" y1="18" x2="24" y2="74" stroke-width="0.5"/>
  <line x1="28" y1="18" x2="28" y2="74" stroke-width="0.5"/>
  <line x1="32" y1="18" x2="32" y2="74" stroke-width="0.5"/>
  <line x1="36" y1="18" x2="36" y2="74" stroke-width="0.5"/>
`);

// Lever House — horizontal slab on vertical
const leverHouse = svg(`
  <rect x="8" y="36" width="44" height="10"/>
  <rect x="22" y="22" width="16" height="52"/>
`);

// Dakota — German Renaissance gables
const dakota = svg(`
  <rect x="10" y="40" width="40" height="34"/>
  <path d="M14 40 L14 30 L22 30 L22 40"/>
  <path d="M12 30 L18 22 L24 30 Z"/>
  <path d="M26 40 L26 26 L34 26 L34 40"/>
  <path d="M24 26 L30 16 L36 26 Z"/>
  <path d="M38 40 L38 30 L46 30 L46 40"/>
  <path d="M36 30 L42 22 L48 30 Z"/>
`);

// Apollo — marquee
const apollo = svg(`
  <rect x="10" y="28" width="40" height="46"/>
  <rect x="6" y="40" width="48" height="10" fill="${INK}" stroke="none"/>
`);

// St Patrick's — twin spires
const stPatricks = svg(`
  <rect x="14" y="38" width="32" height="36"/>
  <rect x="10" y="32" width="10" height="6"/>
  <rect x="40" y="32" width="10" height="6"/>
  <path d="M10 32 L15 8 L20 32 Z"/>
  <path d="M40 32 L45 8 L50 32 Z"/>
  <line x1="15" y1="8" x2="15" y2="3" stroke-width="1.2"/>
  <line x1="45" y1="8" x2="45" y2="3" stroke-width="1.2"/>
  <path d="M20 38 Q30 26 40 38"/>
`);

// Washington Square Arch
const washingtonArch = svg(`
  <rect x="8" y="22" width="44" height="52"/>
  <path d="M18 74 L18 44 Q30 28 42 44 L42 74 Z" fill="${FILL}"/>
  <rect x="8" y="18" width="44" height="6"/>
`);

// High Line — elevated rail with plants
const highLine = svg(`
  <rect x="4" y="44" width="52" height="8"/>
  <rect x="4" y="52" width="52" height="6"/>
  <rect x="10" y="58" width="3" height="16" fill="${INK}" stroke="none"/>
  <rect x="28" y="58" width="3" height="16" fill="${INK}" stroke="none"/>
  <rect x="46" y="58" width="3" height="16" fill="${INK}" stroke="none"/>
  <path d="M14 44 Q18 36 22 44"/>
  <path d="M28 44 Q34 32 40 44"/>
  <path d="M44 44 Q48 38 52 44"/>
`);

// Radio City — Art Deco marquee
const radioCity = svg(`
  <rect x="8" y="26" width="44" height="48"/>
  <rect x="4" y="38" width="52" height="12"/>
  <path d="M4 38 L4 34 L8 30 L52 30 L56 34 L56 38 Z" fill="${INK}" stroke="none"/>
`);

// Plaza Hotel — chateau with mansard
const plazaHotel = svg(`
  <rect x="10" y="38" width="40" height="36"/>
  <path d="M10 38 L14 22 L46 22 L50 38 Z"/>
  <path d="M18 22 L18 16 L24 16 L24 22"/>
  <path d="M28 22 L28 16 L34 16 L34 22"/>
  <path d="M38 22 L38 16 L44 16 L44 22"/>
`);

// Carnegie Hall — Italian Renaissance brick
const carnegieHall = svg(`
  <rect x="10" y="24" width="40" height="50"/>
  <rect x="8" y="20" width="44" height="6"/>
  <path d="M14 36 Q17 32 20 36 M22 36 Q25 32 28 36 M30 36 Q33 32 36 36 M38 36 Q41 32 44 36"/>
`);

// NYPL — columns and lions
const nypl = svg(`
  <rect x="6" y="38" width="48" height="36"/>
  <path d="M14 38 L14 22 L46 22 L46 38"/>
  <path d="M12 22 L30 10 L48 22"/>
  <line x1="18" y1="44" x2="18" y2="64" stroke-width="0.8"/>
  <line x1="24" y1="44" x2="24" y2="64" stroke-width="0.8"/>
  <line x1="30" y1="44" x2="30" y2="64" stroke-width="0.8"/>
  <line x1="36" y1="44" x2="36" y2="64" stroke-width="0.8"/>
  <line x1="42" y1="44" x2="42" y2="64" stroke-width="0.8"/>
`);

// Washington Square Park — fountain & trees
const washSquare = svg(`
  <rect x="6" y="40" width="48" height="34"/>
  <circle cx="30" cy="56" r="8"/>
  <circle cx="14" cy="48" r="5"/>
  <circle cx="46" cy="48" r="5"/>
  <line x1="14" y1="53" x2="14" y2="58" stroke-width="0.8"/>
  <line x1="46" y1="53" x2="46" y2="58" stroke-width="0.8"/>
`);

// Tenement
const tenement = svg(`
  <rect x="16" y="16" width="28" height="58"/>
  <rect x="20" y="22" width="5" height="6"/>
  <rect x="28" y="22" width="5" height="6"/>
  <rect x="35" y="22" width="5" height="6"/>
  <rect x="20" y="32" width="5" height="6"/>
  <rect x="28" y="32" width="5" height="6"/>
  <rect x="35" y="32" width="5" height="6"/>
  <rect x="20" y="42" width="5" height="6"/>
  <rect x="28" y="42" width="5" height="6"/>
  <rect x="35" y="42" width="5" height="6"/>
  <rect x="20" y="52" width="5" height="6"/>
  <rect x="28" y="52" width="5" height="6"/>
  <rect x="35" y="52" width="5" height="6"/>
  <rect x="13" y="24" width="3" height="42" fill="${INK}" stroke="none" opacity="0.4"/>
`);

export const DOODLES = {
  'empire-state': empireState,
  'chrysler': chrysler,
  'flatiron': flatiron,
  'grand-central': grandCentral,
  'woolworth': woolworth,
  'rockefeller': rockefeller,
  'one-wtc': oneWtc,
  'statue-liberty-view': brooklynBridge,
  'guggenheim': guggenheim,
  'met-museum': metMuseum,
  'moma': moma,
  'seagram': seagram,
  'lever-house': leverHouse,
  'dakota': dakota,
  'apollo': apollo,
  'st-patricks': stPatricks,
  'washington-square-arch': washingtonArch,
  'high-line': highLine,
  'radio-city': radioCity,
  'plaza-hotel': plazaHotel,
  'carnegie-hall': carnegieHall,
  'nypl-main': nypl,
  'one-fifth': washSquare,
  'tenement-museum': tenement
};
