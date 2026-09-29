import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { join } from 'node:path';
import { once } from 'node:events';

// "Если быть точным" publishes a CC BY 4.0 extract of the public GIS ЖКХ
// housing registry. Keep only the fields needed for house-level lookup.
const source = 'https://storage.yandexcloud.net/tochno-st-catalog/Minstroy/data_gisgkh_157_v20260917/data_gisgkh_157_v20260917.csv';
const destination = join(process.cwd(), 'apps', 'server', 'data', 'uk');
const temporary = join(process.cwd(), 'tmp', 'uk-index');
await mkdir(temporary, { recursive: true });
await mkdir(destination, { recursive: true });

const response = await fetch(source, { signal: AbortSignal.timeout(600_000) });
if (!response.ok || !response.body) throw new Error(`Source returned ${response.status}`);
const writers = new Map();
let columns;
let row = [];
let field = '';
let quoted = false;
let count = 0;
const decoder = new TextDecoder();

async function finishRow() {
  row.push(field);
  field = '';
  if (!columns) {
    columns = Object.fromEntries(row.map((name, index) => [name.replace(/^\uFEFF/, ''), index]));
    for (const required of ['fias_id', 'region_name', 'house_management_type', 'management_organization_name', 'management_organization_link']) {
      if (columns[required] === undefined) throw new Error(`Missing column ${required}`);
    }
  } else {
    const fiasId = row[columns.fias_id]?.toLowerCase();
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(fiasId || '')) {
      const prefix = fiasId.slice(0, 2);
      let writer = writers.get(prefix);
      if (!writer) {
        writer = createWriteStream(join(temporary, `${prefix}.ndjson`), { encoding: 'utf8' });
        writers.set(prefix, writer);
      }
      const record = [fiasId, row[columns.region_name], row[columns.house_management_type], row[columns.management_organization_name], row[columns.management_organization_link]];
      if (!writer.write(`${JSON.stringify(record)}\n`)) await once(writer, 'drain');
      count++;
    }
  }
  row = [];
}

async function processChunk(text) {
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index++; }
      else quoted = !quoted;
    } else if (char === ';' && !quoted) {
      row.push(field); field = '';
    } else if (char === '\n' && !quoted) {
      if (field.endsWith('\r')) field = field.slice(0, -1);
      await finishRow();
    } else {
      field += char;
    }
  }
}

for await (const chunk of response.body) await processChunk(decoder.decode(chunk, { stream: true }));
await processChunk(decoder.decode());
if (field || row.length) await finishRow();
for (const writer of writers.values()) {
  writer.end();
  await once(writer, 'finish');
}

let totalBytes = 0;
for (const file of await readdir(temporary)) {
  const output = join(destination, `${file}.gz`);
  await pipeline(createReadStream(join(temporary, file)), createGzip({ level: 9 }), createWriteStream(output));
  totalBytes += (await stat(output)).size;
}
await rm(temporary, { recursive: true });
console.log(`Indexed ${count} houses into ${writers.size} files (${(totalBytes / 1024 / 1024).toFixed(1)} MiB).`);
