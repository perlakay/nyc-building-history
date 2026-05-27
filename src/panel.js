const panel = () => document.getElementById('panel');
const content = () => document.getElementById('panel-content');

export function renderWelcomePanel({ buildingCount, landmarkCount, cityName = 'NYC' }) {
  panel().className = 'panel card card--beauxarts';

  content().innerHTML = `
    <div class="card__body card__body--welcome">
      <div class="card__eyebrow">${escape(cityName)} Building Atlas</div>
      <h1 class="card__title">Read the city through its skyline.</h1>
      <p class="card__lede">
        Search any address, click a building in the 3D map, or use the skyline ribbon to jump into curated landmark stories across ${escape(cityName)}.
      </p>

      <dl class="card__meta">
        ${row('Buildings in view', Number(buildingCount || 0).toLocaleString())}
        ${row('Curated landmarks', Number(landmarkCount || 0).toLocaleString())}
        ${row('Coverage', `${escape(cityName)} address search + skyline stories`)}
      </dl>

      <section class="card__section">
        <h2>How to explore</h2>
        <p>Search any address, click a landmark massing, or inspect individual buildings block by block. The atlas blends height, age, and landmark history so the city reads like a timeline rather than a pile of parcels.</p>
      </section>

      <aside class="card__fact">
        <div class="card__fact-label">Try this</div>
        <p>Open a skyscraper, then click nearby buildings to compare eras, building classes, heights, and zoning on the same street.</p>
      </aside>

      <div class="card__footer">
        Click any extruded building on the map to begin.
      </div>
    </div>
  `;

  panel().classList.remove('panel--hidden');
  content().scrollTop = 0;
}

export function renderPanel(l) {
  if (l.generic) return renderGeneric(l);

  panel().className = `panel card card--${l.era || 'beauxarts'}`;

  content().innerHTML = `
    <div class="card__body">
      <div class="card__eyebrow">${escape((l.objectType || l.style || 'Landmark').toUpperCase())}</div>
      <h1 class="card__title">${escape(l.name)}</h1>
      <div class="card__year-line">${escape(l.dateLabel || 'Built')} ${escape(String(l.year))}</div>

      <dl class="card__meta">
        ${l.architect ? `<div><dt>Architect</dt><dd>${escape(l.architect)}</dd></div>` : ''}
        ${l.height ? `<div><dt>Size</dt><dd>${escape(l.height)}</dd></div>` : ''}
        ${l.agencies?.length ? `<div><dt>Federal use</dt><dd>${escape(l.agencies.join(', '))}</dd></div>` : ''}
        ${row('Era', eraLabel(l.era))}
      </dl>

      ${l.history ? `
        <section class="card__section">
          <h2>History</h2>
          <p>${escape(l.history)}</p>
        </section>` : ''}

      ${l.design ? `
        <section class="card__section">
          <h2>Design notes</h2>
          <p>${escape(l.design)}</p>
        </section>` : ''}

      ${l.agencies?.length ? `
        <section class="card__section">
          <h2>Departments / offices</h2>
          <p>${escape(l.agencies.join(', '))}</p>
        </section>` : ''}

      ${l.fact ? `
        <aside class="card__fact">
          <div class="card__fact-label">Did you know</div>
          <p>${escape(l.fact)}</p>
        </aside>` : ''}

      ${l.sources?.length ? `
        <section class="card__section">
          <h2>Sources</h2>
          <ul class="card__sources">
            ${l.sources.map(sourceItem).join('')}
          </ul>
        </section>` : ''}

      <div class="card__footer">
        ${l.sourceFooter || 'Story curated · building data via city open data'}
      </div>
    </div>
  `;
  panel().classList.remove('panel--hidden');
  content().scrollTop = 0;
}

function sourceItem(source) {
  if (typeof source === 'string') return `<li>${escape(source)}</li>`;
  const label = escape(source.label || source.url || 'Source');
  if (!source.url) return `<li>${label}</li>`;
  return `<li><a href="${escape(source.url)}" target="_blank" rel="noopener">${label}</a></li>`;
}

function renderGeneric(l) {
  const a = l.address || {};
  const yearbuilt = a.yearbuilt && a.yearbuilt > 1700 ? a.yearbuilt : null;
  const yearBand = a.yearBand || null;
  const era = l.era || eraFromYear(yearbuilt);
  const cityName = l.cityName || 'NYC';
  const sources = l.sources || {};

  panel().className = `panel card card--${era || 'unknown'}`;

  const footerSource = l.localOnly
    ? (sources.local || `Source · ${escape(cityName)} building footprints`)
    : (sources.parcel || `Source · ${escape(cityName)} building footprints + parcel records`);

  if (l.notFound) {
    content().innerHTML = `
      <div class="card__body">
        <div class="card__eyebrow">No record</div>
        <h1 class="card__title card__title--small">Outside the atlas</h1>
        <p class="card__loading-text">No building record found here. This is usually a park, road, or stretch of water.</p>
      </div>`;
    return;
  }

  // History paragraph — rich narrative weaving year, era, district, alterations.
  const historyBits = [];
  if (/London/i.test(cityName) && yearBand) {
    const archEra = architecturalEra(yearbuilt, cityName);
    historyBits.push(`Recorded in the GLA London Building Stock Model as ${yearBand}${archEra ? ', representing ' + archEra : ''}.`);
  } else if (/Washington/i.test(cityName) && yearbuilt) {
    historyBits.push(`DC HistoryQuest records the year for this building as ${yearbuilt}.`);
  } else if (yearbuilt) {
    const archEra = architecturalEra(yearbuilt, cityName);
    historyBits.push(`Built in ${yearbuilt}${archEra ? ', ' + archEra : ''}.`);
  } else if (a.styleHint) {
    historyBits.push(`Likely a ${a.styleHint}.`);
  } else if (!l.addressLoading) {
    historyBits.push(`No construction date is recorded for this lot in the city's parcel data.`);
  }
  if (a.histdist) historyBits.push(`It sits inside the ${a.histdist} Historic District, where exterior changes are reviewed by the Landmarks Preservation Commission.`);
  if (a.yearalter1 && a.yearalter1 > 1700) {
    historyBits.push(`The building was significantly altered in ${a.yearalter1}${a.yearalter2 && a.yearalter2 > a.yearalter1 ? `, and again in ${a.yearalter2}` : ''}.`);
  }
  if (a.purpose && /Washington/i.test(cityName)) {
    historyBits.push(`The historic record identifies its original use as ${a.purpose}.`);
  }

  // Design / form paragraph.
  const designBits = [];
  if (a.form) designBits.push(`The massing reads as a ${a.form}.`);
  if (a.material && /Washington/i.test(cityName)) designBits.push(`The historic material record lists ${a.material}.`);

  // Did-you-know fact — synthesized from what we know.
  const fact = synthesizeFact(yearbuilt, a, cityName);

  const titleText = compactTitle(a.address) || 'Unlisted address';
  const titleClass = l.addressLoading ? 'card__title card__title--loading' : 'card__title';

  content().innerHTML = `
    <div class="card__body">
      <div class="card__eyebrow">${escape(eraLabel(era))}</div>
      <h1 class="${titleClass}">${escape(titleText)}</h1>
      <div class="card__year-line">${yearBand ? `Construction age ${escape(yearBand)}` : (yearbuilt ? (/Washington/i.test(cityName) ? `Recorded year ${yearbuilt}` : `Built ${yearbuilt}`) : 'Year unknown')}</div>

      <dl class="card__meta">
        ${yearBand ? row('Age band', yearBand) : row(/Washington/i.test(cityName) ? 'Recorded year' : 'Built', yearbuilt ? String(yearbuilt) : '—')}
        ${a.height ? row(a.heightEstimated ? 'Est. height' : 'Height', a.height + (a.heightMeters ? ` · ${a.heightMeters}` : '')) : ''}
        ${a.borough ? row('Borough', boroughLabel(a.borough)) : ''}
      </dl>

      ${historyBits.length ? `
        <section class="card__section">
          <h2>History</h2>
          <p>${historyBits.map(escape).join(' ')}</p>
        </section>` : ''}

      ${designBits.length ? `
        <section class="card__section">
          <h2>Design notes</h2>
          <p>${designBits.map(escape).join(' ')}</p>
        </section>` : ''}

      ${a.startups && a.startups.length ? `
        <section class="card__section">
          <h2>Companies &amp; startups</h2>
          <ul class="card__startups">
            ${a.startups.map(s => `
              <li class="card__startup">
                <div class="card__startup-head">
                  <span class="card__startup-name">${escape(s.name)}</span>
                  ${s.valuation_usd ? `<span class="card__startup-val">$${escape(s.valuation_usd)}</span>` : ''}
                </div>
                <div class="card__startup-meta">
                  ${s.founded ? `Founded ${s.founded}` : ''}${s.moved_in ? ` · here ${s.moved_in}${s.moved_out ? '–' + s.moved_out : '–present'}` : ''}
                </div>
                ${s.note ? `<p class="card__startup-note">${escape(s.note)}</p>` : ''}
              </li>`).join('')}
          </ul>
        </section>` : ''}

      ${fact ? `
        <aside class="card__fact">
          <div class="card__fact-label">Did you know</div>
          <p>${escape(fact)}</p>
        </aside>` : ''}

      ${l.fromSearch ? `
        <p class="card__note">
          Pin position is our best guess from the city geocoder — on dense
          blocks the highlighted footprint may be a neighbor, but the address
          shown above is what you searched.
        </p>` : ''}
      ${(!l.fromSearch && !l.notFound) ? `
        <p class="card__note">
          Address is reverse-geocoded from the click point. ${escape(cityName)} assigns one
          primary address per lot, so neighboring buildings on the same parcel
          can share an address even when they're physically distinct.
        </p>` : ''}
      ${implausible(yearbuilt, a.height) ? `
        <p class="card__note card__note--warn">
          The year and height in the city's records are physically
          inconsistent (no skyscrapers before 1890). The city often carries
          the year of a prior building on the lot — the figure you see may
          not reflect the structure standing today.
        </p>` : ''}

      <div class="card__footer">
        ${footerSource}
      </div>
    </div>
  `;
}

function synthesizeFact(year, a, cityName = 'NYC') {
  if (!year && !a.height) return null;
  if (/London/i.test(cityName)) {
    if (a.yearBand) return `This colour uses a GLA construction-age band based on October 2024 data, not an exact completion year. The official OS OpenMap Local footprint was retrieved on 24 May 2026.`;
    return `This official OS OpenMap Local footprint was retrieved on 24 May 2026; no GLA construction-age point was verified inside it.`;
  }
  if (/Washington/i.test(cityName)) {
    return null;
  }
  if (year && year < 1860) return `This is one of the oldest standing structures in this part of the city — it was already here when the elevated trains, the subway, and even most of the brownstones did not exist yet.`;
  if (year && year < 1900) return `When this was built, NYC had no skyscrapers, no subway, and the city ended near 59th Street. The Brooklyn Bridge had not yet opened.`;
  if (year && year >= 1900 && year < 1916) return `Built in the run-up to the 1916 Zoning Resolution — the first comprehensive zoning law in any U.S. city, written largely in response to towers like the nearby Equitable Building.`;
  if (year && year >= 1916 && year < 1932) return `This rose during NYC's great Art Deco / setback skyscraper boom. The 1916 zoning law forced upper-floor stepbacks, which is why so many towers from this period taper as they climb.`;
  if (year && year >= 1932 && year < 1946) return `Construction during the Depression and wartime years was rare — buildings from this stretch are unusual survivors.`;
  if (year && year >= 1946 && year < 1975) return `The post-war glass-and-steel International Style took over the skyline in this period. The 1961 zoning resolution rewarded plaza-and-tower designs over the older setback ziggurats.`;
  if (year && year >= 1975 && year < 2000) return `The late-20th-century waterfront and Midtown booms reshaped large blocks of the city — air-rights transfers and incentive zoning produced many of the towers from this period.`;
  if (year && year >= 2000) return `A 21st-century building — likely engineered with a concrete or steel-and-glass core, slim-floorplate techniques, and modern wind-engineering that did not exist in earlier eras.`;
  return null;
}

function row(k, v) {
  return `<div><dt>${escape(k)}</dt><dd>${escape(v)}</dd></div>`;
}

function compactTitle(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  const parts = s.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length <= 2) return s;
  const cityWords = /^(San Francisco|California|United States|London|City of London|Greater London|England|United Kingdom|\d{5}(?:-\d{4})?|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})$/i;
  const useful = parts.filter(p => !cityWords.test(p));
  return useful.slice(0, 2).join(', ') || parts.slice(0, 2).join(', ');
}

function eraFromYear(y) {
  if (!y) return 'unknown';
  if (y < 1900) return 'victorian';
  if (y < 1930) return 'beauxarts';
  if (y < 1960) return 'artdeco';
  if (y < 2000) return 'modernist';
  return 'contemporary';
}

function architecturalEra(year, cityName = 'NYC') {
  if (!year) return null;
  if (/London/i.test(cityName)) {
    if (year < 1900) return 'historic City fabric';
    if (year < 1930) return 'Edwardian and early interwar construction';
    if (year < 1950) return 'interwar construction';
    if (year < 1967) return 'postwar rebuilding';
    if (year < 1983) return 'later postwar construction';
    if (year < 1996) return 'late twentieth-century development';
    if (year < 2012) return 'turn-of-the-century development';
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

function zoneDescription(zone) {
  const z = (zone || '').toUpperCase();
  if (z.startsWith('R')) return ' (residential)';
  if (z.startsWith('C')) return ' (commercial)';
  if (z.startsWith('M')) return ' (manufacturing)';
  return '';
}

function bldgClassDescription(cls) {
  const m = {
    A: 'one-family dwelling', B: 'two-family dwelling',
    C: 'walk-up apartment', D: 'elevator apartment',
    E: 'warehouse', F: 'factory / industrial',
    G: 'garage / gas station', H: 'hotel',
    I: 'hospital / health facility', J: 'theater',
    K: 'store / retail', L: 'loft', M: 'religious',
    N: 'asylum / home', O: 'office', P: 'cultural / public assembly',
    Q: 'outdoor recreation', R: 'condominium',
    S: 'mixed residential/commercial', T: 'transportation',
    U: 'utility', V: 'vacant land', W: 'educational',
    Y: 'government', Z: 'miscellaneous'
  };
  return m[(cls || '')[0]] || null;
}

function boroughLabel(value) {
  const raw = String(value || '').trim().toUpperCase();
  return ({
    '1': 'Manhattan',
    '2': 'Bronx',
    '3': 'Brooklyn',
    '4': 'Queens',
    '5': 'Staten Island',
    'MN': 'Manhattan',
    'BX': 'Bronx',
    'BK': 'Brooklyn',
    'QN': 'Queens',
    'SI': 'Staten Island'
  })[raw] || value;
}

function eraLabel(era) {
  return ({
    artdeco: 'Art Deco', beauxarts: 'Beaux-Arts', gothic: 'Neo-Gothic',
    modernist: 'Modernist', victorian: 'Victorian', contemporary: 'Contemporary',
    theatrical: 'Theatrical', startup: 'Startup Office', federal: 'Federal Building',
    historic: 'Historic London', unknown: 'Undated'
  })[era] || (era || 'Landmark');
}

function implausible(year, heightStr) {
  if (!year || !heightStr) return false;
  const m = String(heightStr).match(/(\d+(?:\.\d+)?)\s*ft/);
  if (!m) return false;
  const h = parseFloat(m[1]);
  if (year < 1860 && h > 100) return true;
  if (year < 1890 && h > 250) return true;
  return false;
}

function escape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
