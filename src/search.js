// Address + landmark search. Two phases:
//   1. Match against curated landmark names locally (instant).
//   2. Hit the city's geocoder for addresses (city-specific endpoint, no key).
//
// `geocoder` is provided by the per-city config so we can swap NYC Geosearch
// for a SF-aware geocoder (e.g. Nominatim filtered to SF) without forking
// this file.

export function createSearch({ landmarks, geocoder, cityName = 'New York City', onPickLandmark, onPickAddress, onClear }) {
  const input = document.getElementById('search-input');
  const clear = document.getElementById('search-clear');
  const wrap = input.closest('.search');
  const resultsEl = document.getElementById('search-results');

  let currentResults = [];
  let activeIdx = -1;
  let debounceTimer = null;
  let lastQuery = '';

  function render(results) {
    currentResults = results;
    activeIdx = -1;
    if (!results.length) {
      resultsEl.innerHTML = '';
      resultsEl.classList.remove('search-results--open');
      return;
    }
    resultsEl.innerHTML = results.map((r, i) => {
      if (r.kind === 'landmark') {
        return `
          <div class="search-result search-result--landmark" data-i="${i}">
            <div class="search-result__label">LANDMARK</div>
            <div class="search-result__title">${escape(r.name)}</div>
            <div class="search-result__sub">${escape(r.style || '')}</div>
          </div>`;
      }
      if (r.kind === 'address') {
        return `
          <div class="search-result" data-i="${i}">
            <div class="search-result__label">ADDRESS</div>
            <div class="search-result__title">${escape(r.label)}</div>
            <div class="search-result__sub">${escape(r.borough || cityName)}</div>
          </div>`;
      }
      if (r.kind === 'empty') {
        return `<div class="search-result search-result--empty">${escape(r.message)}</div>`;
      }
      return '';
    }).join('');
    resultsEl.classList.add('search-results--open');

    resultsEl.querySelectorAll('.search-result[data-i]').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(parseInt(el.dataset.i, 10));
      });
    });
  }

  function pick(i) {
    const r = currentResults[i];
    if (!r) return;
    if (r.kind === 'landmark') {
      onPickLandmark(r.id);
    } else if (r.kind === 'address') {
      onPickAddress(r);
    }
    input.value = r.name || r.label || '';
    close();
  }

  function close() {
    resultsEl.classList.remove('search-results--open');
    activeIdx = -1;
  }

  async function runSearch(q) {
    q = q.trim();
    if (!q) {
      render([]);
      return;
    }
    if (q === lastQuery) return;
    lastQuery = q;

    // Local landmark matches (instant)
    const ql = q.toLowerCase();
    const lmMatches = landmarks
      .filter(l =>
        l.name.toLowerCase().includes(ql) ||
        (l.style || '').toLowerCase().includes(ql) ||
        (l.architect || '').toLowerCase().includes(ql)
      )
      .slice(0, 5)
      .map(l => ({ kind: 'landmark', id: l.id, name: l.name, style: l.style }));

    // Show landmarks immediately, fetch addresses async
    render(lmMatches.length ? lmMatches : [{ kind: 'empty', message: 'searching addresses…' }]);

    try {
      const addrMatches = (await geocoder(q)).slice(0, 6);
      const combined = [...lmMatches, ...addrMatches];
      if (!combined.length) {
        render([{ kind: 'empty', message: 'no results' }]);
      } else {
        render(combined);
      }
    } catch (err) {
      // If geosearch fails, keep showing whatever landmark matches we had
      if (lmMatches.length) render(lmMatches);
      else render([{ kind: 'empty', message: 'no results · address lookup unavailable' }]);
    }
  }

  input.addEventListener('input', (e) => {
    const v = e.target.value;
    wrap.classList.toggle('search--active', v.length > 0);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(v), 180);
  });

  input.addEventListener('focus', () => {
    if (currentResults.length) resultsEl.classList.add('search-results--open');
  });

  input.addEventListener('blur', () => setTimeout(close, 120));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, currentResults.length - 1);
      highlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      highlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0) pick(activeIdx);
      else if (currentResults[0] && currentResults[0].kind !== 'empty') pick(0);
    } else if (e.key === 'Escape') {
      close();
      input.blur();
    }
  });

  function highlight() {
    resultsEl.querySelectorAll('.search-result').forEach((el, i) => {
      el.classList.toggle('search-result--active', i === activeIdx);
    });
  }

  clear.addEventListener('click', () => {
    input.value = '';
    lastQuery = '';
    wrap.classList.remove('search--active');
    render([]);
    onClear?.();
    input.focus();
  });
}

function escape(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
