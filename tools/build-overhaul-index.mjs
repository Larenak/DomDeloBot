// Build a compact, dated snapshot from the official FRT open-data exports.
// Run `pnpm --filter @domdelo/server build` first, then `node tools/build-overhaul-index.mjs`.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { normalizeRegion, reportLinks, scanZipCsv } from '../apps/server/dist/services/public-housing-data.js';

const source = 'https://xn--80adsazqn.xn--p1aee.xn--p1ai';
const output = new URL('../apps/server/data/overhaul/', import.meta.url);
const requested = process.argv.slice(2).map((value) => normalizeRegion(value));
const manifestUrl = new URL('manifest.json', output);
const amount = (value) => {
  if (!value) return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

async function textFrom(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const text = await response.text();
  if (text.includes('wallarm-logo') || text.includes('You are blocked')) throw new Error(`${url} access denied`);
  return text;
}

async function exportsFor(gid) {
  const links = new Map();
  for (let page = 1; page <= 10 && (!links.has('1') || !links.has('3')); page++) {
    const html = await textFrom(`${source}/opendata?gid=${gid}&cids=overhaul&page=${page}&pageSize=12`);
    for (const [kind, link] of reportLinks(html)) links.set(kind, link);
    if (!html.includes('/opendata/export/')) break;
  }
  return links;
}

async function buildRegion(name, gid) {
  const links = await exportsFor(gid);
  const houseSourceUrl = links.get('1');
  if (!houseSourceUrl) throw new Error(`No KR 1.1 export for ${name}`);
  const worksSourceUrl = links.get('3');
  const records = new Map();
  const byCode = new Map();
  const snapshotDate = await scanZipCsv(houseSourceUrl, (house) => {
    const fiasId = house.houseguid?.toLowerCase();
    if (!fiasId || !/^[0-9a-f-]{36}$/.test(fiasId)) return;
    const record = [fiasId, house.update_date_of_information || null, house.money_collecting_way || null,
      amount(house.overhaul_funds_balance), amount(house.owners_payment), house.inclusion_date_to_program || null, []];
    records.set(fiasId, record);
    if (house.mkd_code) {
      const code = `${house.mkd_code}|${house.mun_obr_oktmo}`;
      const group = byCode.get(code) || [];
      group.push(record);
      byCode.set(code, group);
    }
  });
  if (worksSourceUrl) {
    await scanZipCsv(worksSourceUrl, (work) => {
      if (!work.service_type) return;
      for (const record of byCode.get(`${work.mkd_code}|${work.mun_obr_oktmo}`) || []) {
        record[6].push([work.service_type, work.service_date || work.service_date_by_plan || null,
          work.fact_date_services_finished || null, work.contractor_name || null]);
      }
    });
  }
  for (const record of records.values()) {
    record[6].sort((a, b) => Number(Boolean(a[2])) - Number(Boolean(b[2])) ||
      (a[2] ? (b[1] || '').localeCompare(a[1] || '') : (a[1] || '').localeCompare(b[1] || '')));
    record[6] = record[6].slice(0, 60);
  }
  const file = `${gid}.ndjson.gz`;
  const data = [...records.values()].map((record) => JSON.stringify(record)).join('\n') + '\n';
  await writeFile(new URL(file, output), gzipSync(data, { level: 9 }));
  return { file, houseSourceUrl, ...(worksSourceUrl ? { worksSourceUrl } : {}),
    ...(snapshotDate ? { snapshotDate } : {}) };
}

await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8').catch(() => '{}'));
const catalog = await textFrom(`${source}/opendata`);
const regions = [...catalog.matchAll(/<option\b[^>]*\bvalue\s*=\s*["']?(\d+)["']?[^>]*>([^<]+)<\/option>/gi)]
  .map((match) => ({ gid: match[1], name: match[2].trim() }));
if (regions.length < 70) throw new Error(`Incomplete FRT region list: ${regions.length}`);
let failed = 0;
for (const { gid, name } of regions) {
  const key = normalizeRegion(name);
  if (requested.length && !requested.includes(key)) continue;
  if (manifest[key]) continue;
  try {
    manifest[key] = await buildRegion(name, gid);
    await writeFile(manifestUrl, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`${name}: ${manifest[key].file}`);
  } catch (error) {
    failed++;
    console.error(`${name}: ${error.message}`);
  }
}
console.log(`Regions saved: ${Object.keys(manifest).length}; failed this run: ${failed}`);
if (failed) process.exitCode = 1;
