import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const buildingsPath = path.join(root, 'public/data/london/buildings.geojson');
const sourcePath = process.env.LONDON_LBSM_CSV || '/private/tmp/LBSMv2_London.zip';
const requested = Math.max(1, Number(process.argv[2]) || 50);
const rounds = Math.max(1, Number(process.argv[3]) || 3);
const fc = JSON.parse(fs.readFileSync(buildingsPath, 'utf8'));
const eligible = fc.features.filter(feature => feature.properties.official_toid && feature.properties.age_band);
const samples = Array.from({ length: rounds }, (_, round) => pickSamples(eligible, Math.min(requested, eligible.length), 20260524 + round));
const expected = new Map();
for (const round of samples) for (const feature of round) expected.set(feature.properties.official_toid, feature.properties);
const source = new Map([...expected.keys()].map(id => [id, { bands: new Map(), areas: new Set(), postcodes: new Set() }]));

await scanSource(sourcePath, source);

let totalPasses = 0;
for (const [roundIndex, round] of samples.entries()) {
  const results = round.map(feature => {
    const mapRecord = feature.properties;
    const official = source.get(mapRecord.official_toid);
    const officialBand = [...official.bands.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const ageMatches = officialBand === mapRecord.age_band;
    const boroughMatches = official.areas.has(mapRecord.borough);
    const strictGeometryMatch = mapRecord.join_method === 'inside-footprint';
    const ok = ageMatches && boroughMatches && strictGeometryMatch;
    if (ok) totalPasses += 1;
    return {
      id: mapRecord.bin,
      area: mapRecord.borough,
      mapped_band: mapRecord.age_band,
      official_band: officialBand,
      join: mapRecord.join_method,
      metres: mapRecord.join_distance_m,
      result: ok ? 'PASS' : 'FAIL'
    };
  });
  const passes = results.filter(row => row.result === 'PASS').length;
  console.log(`\nRound ${roundIndex + 1}: ${passes}/${results.length} strict passes (${(100 * passes / results.length).toFixed(1)}%)`);
  console.table(results.filter(row => row.result === 'FAIL'));
}

const total = samples.reduce((count, round) => count + round.length, 0);
console.log(`\nOverall: ${totalPasses}/${total} strict passes (${(100 * totalPasses / total).toFixed(1)}%). Passing requirement: 100% in every round.`);
if (totalPasses !== total) process.exitCode = 1;

async function scanSource(file, targets) {
  const child = file.endsWith('.zip') ? spawn('unzip', ['-p', file], { stdio: ['ignore', 'pipe', 'inherit'] }) : null;
  const input = child ? child.stdout : fs.createReadStream(file);
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let index = null;
  for await (const line of lines) {
    const row = parseCsvLine(line);
    if (!index) {
      index = Object.fromEntries(row.map((value, column) => [value, column]));
      continue;
    }
    const match = targets.get(row[index.os_topo_toid]);
    if (!match) continue;
    const band = row[index.construction_age_band_known] === '1' ? row[index.construction_age_band] : null;
    if (band) match.bands.set(band, (match.bands.get(band) || 0) + 1);
    match.areas.add(row[index.administrative_area]);
    match.postcodes.add(row[index.postcode_locator]);
  }
  if (child) await new Promise((resolve, reject) => child.on('close', code => code === 0 ? resolve() : reject(new Error(`unzip exited ${code}`))));
}

function pickSamples(features, count, initialSeed) {
  const pool = [...features];
  let seed = initialSeed;
  for (let i = pool.length - 1; i > 0; i -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function parseCsvLine(text) {
  const row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field.replace(/\r$/, ''));
  return row;
}
