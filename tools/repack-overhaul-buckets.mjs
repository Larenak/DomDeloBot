// Repack the regional snapshots into small FIAS-prefix files for low-memory lookups.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';

const root = new URL('../apps/server/data/overhaul/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
const buckets = new Map();
const output = new URL('buckets/', root);
for (let index = 0; index < 256; index++) {
  const prefix = index.toString(16).padStart(2, '0');
  const existing = await readFile(new URL(`${prefix}.ndjson.gz`, output)).catch(() => null);
  if (!existing) continue;
  const rows = new Map();
  for (const line of gunzipSync(existing).toString('utf8').split('\n')) {
    if (line) rows.set(line.slice(2, 38), line);
  }
  buckets.set(prefix, rows);
}
for (const info of Object.values(manifest)) {
  // Raw regional files are generated locally and not committed; existing buckets
  // remain usable when a new region is added from a fresh checkout.
  const archive = await readFile(new URL(info.file, root)).catch(() => null);
  if (!archive) continue;
  const contents = gunzipSync(archive).toString('utf8');
  for (const line of contents.split('\n')) {
    if (!line) continue;
    const prefix = line.slice(2, 4);
    if (!/^[0-9a-f]{2}$/.test(prefix)) throw new Error('Invalid FIAS prefix in snapshot');
    const rows = buckets.get(prefix) || new Map();
    rows.set(line.slice(2, 38), line);
    buckets.set(prefix, rows);
  }
}
await mkdir(output, { recursive: true });
for (const [prefix, rows] of buckets) {
  await writeFile(new URL(`${prefix}.ndjson.gz`, output), gzipSync([...rows.values()].join('\n') + '\n', { level: 9 }));
}
console.log(`Packed ${Object.keys(manifest).length} regions into ${buckets.size} buckets`);
