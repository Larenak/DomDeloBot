import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { createInflateRaw, gunzipSync } from 'node:zlib';
import type { AddressProvider } from './address-provider.js';

const FRT = 'https://xn--80adsazqn.xn--p1aee.xn--p1ai';
const UK_SOURCE = 'https://tochno.st/datasets/gisgkh';
const INDEX = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'uk');
const FIAS = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const ALIASES: Record<string, string> = {
  'Кемеровская область': 'Кемеровская область - Кузбасс',
  'Санкт-Петербург': 'город Санкт-Петербург',
  'Москва': 'город Москва',
  'Севастополь': 'город Севастополь',
  'Архангельская область (с автономным округом)': 'Архангельская область',
  'Тюменская область (с автономными округами)': 'Тюменская область',
  'Республика Северная Осетия — Алания': 'Республика Северная Осетия-Алания',
  'Ханты-Мансийский автономный округ — Югра': 'Ханты-Мансийский автономный округ - Югра',
};

export type ManagementData = {
  status: 'found' | 'missing' | 'unavailable';
  name?: string | undefined;
  managementType?: string | undefined;
  organizationUrl?: string | undefined;
  sourceUrl: string;
  snapshotDate: string;
};
export type OverhaulWork = {
  type: string;
  plannedYear?: string | undefined;
  completedDate?: string | undefined;
  contractor?: string | undefined;
};
export type OverhaulData = {
  status: 'found' | 'missing' | 'unavailable';
  sourceUrl: string;
  worksSourceUrl?: string | undefined;
  snapshotDate?: string | undefined;
  updatedAt?: string | undefined;
  fundingMethod?: string | undefined;
  fundBalanceThousandRub?: number | undefined;
  contributionRubPerSqM?: number | undefined;
  includedAt?: string | undefined;
  works: OverhaulWork[];
};
export type PublicHousingData = {
  houseId: string;
  management: ManagementData;
  overhaul: OverhaulData;
};
type UkRecord = [string, string, string, string, string];
type Row = Record<string, string>;
type Reports = { house: string; works?: string | undefined; loadedAt: number };

async function textFrom(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error('Source returned ' + response.status);
  const text = await response.text();
  // The public FRT site sometimes returns a WAF page instead of the catalogue.
  if (text.includes('wallarm-logo') || text.includes('You are blocked')) throw new Error('FRT access denied');
  return text;
}

function normalizeRegion(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
    .replace(/(?:респ(?:ублика)?|обл(?:асть)?|город|г\.|автономный округ|ао)/g, '')
    .replace(/[^а-яa-z0-9]/g, '');
}

function reportLinks(html: string): Map<string, string> {
  const links = new Map<string, string>();
  // Titles and export buttons are in the same card, but the site's CSS classes change.
  const titles = [...html.matchAll(/КР\s*1[.\-]\s*([13])/gi)];
  for (let i = 0; i < titles.length; i++) {
    const match = titles[i]!;
    const kind = match[1]!;
    if (links.has(kind)) continue;
    const next = titles[i + 1]?.index ?? html.length;
    const nearby = html.slice(match.index!, Math.min(next, match.index! + 4000));
    const id = nearby.match(/(?:href=["']|href=)\/?(?:https?:\/\/[^/"']+\/)?opendata\/export\/(\d+)/i)?.[1];
    if (id) links.set(kind, FRT + '/opendata/export/' + id);
  }
  return links;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ';' && !quoted) {
      result.push(field); field = '';
    } else if (char !== '\r' && char !== '\n') field += char;
  }
  result.push(field);
  return result;
}

async function scanZipCsv(url: string, visit: (row: Row) => void): Promise<string | undefined> {
  const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error('Source returned ' + response.status);
  const zip = Buffer.from(await response.arrayBuffer());
  if (zip.length > 100 * 1024 * 1024) throw new Error('Archive too large');
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Invalid ZIP');
  const entry = zip.readUInt32LE(eocd + 16);
  if (zip.readUInt32LE(entry) !== 0x02014b50) throw new Error('Invalid ZIP directory');
  const method = zip.readUInt16LE(entry + 10);
  const compressedSize = zip.readUInt32LE(entry + 20);
  const uncompressedSize = zip.readUInt32LE(entry + 24);
  const offset = zip.readUInt32LE(entry + 42);
  const filename = zip.subarray(entry + 46, entry + 46 + zip.readUInt16LE(entry + 28)).toString('utf8');
  if (compressedSize > zip.length || uncompressedSize > 250 * 1024 * 1024 || zip.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error('Invalid ZIP entry');
  }
  const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
  if (start + compressedSize > zip.length) throw new Error('Invalid ZIP size');
  const compressed = zip.subarray(start, start + compressedSize);
  const stream = method === 8 ? Readable.from([compressed]).pipe(createInflateRaw())
    : method === 0 ? Readable.from([compressed]) : undefined;
  if (!stream) throw new Error('Unsupported ZIP method');
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let quoted = false;
  let header: string[] | undefined;
  const processLine = (line: string) => {
    const cells = parseCsvLine(line);
    if (!header) header = cells.map((cell) => cell.replace(/^\uFEFF/, ''));
    else visit(Object.fromEntries(header.map((key, i) => [key, cells[i] || ''])));
  };
  for await (const chunk of stream) {
    const part = decoder.decode(chunk as Buffer, { stream: true });
    let startOfLine = 0;
    for (let i = 0; i < part.length; i++) {
      if (part[i] === '"') {
        if (quoted && part[i + 1] === '"') i++;
        else quoted = !quoted;
      } else if (part[i] === '\n' && !quoted) {
        processLine(buffer + part.slice(startOfLine, i + 1));
        buffer = '';
        startOfLine = i + 1;
      }
    }
    buffer += part.slice(startOfLine);
    if (buffer.length > 1024 * 1024) throw new Error('CSV row too large');
  }
  if (buffer.trim()) processLine(buffer);
  const date = filename.match(/-(\d{8})\.csv$/)?.[1];
  return date ? date.slice(0, 4) + '-' + date.slice(4, 6) + '-' + date.slice(6) : undefined;
}

export class PublicHousingDataProvider {
  constructor(private readonly addressProvider?: AddressProvider) {}
  private ukCache = new Map<string, Map<string, UkRecord[]>>();
  private regionIds?: { values: Map<string, string>; loadedAt: number };
  private reports = new Map<string, Reports>();
  private resultCache = new Map<string, { data: PublicHousingData; loadedAt: number }>();
  private pending = new Map<string, Promise<PublicHousingData>>();

  private async lookupUk(fiasId: string): Promise<UkRecord[]> {
    const prefix = fiasId.slice(0, 2);
    let rows = this.ukCache.get(prefix);
    if (!rows) {
      rows = new Map();
      const data = gunzipSync(await readFile(join(INDEX, prefix + '.ndjson.gz'))).toString('utf8');
      for (const line of data.split('\n')) {
        if (!line) continue;
        const row = JSON.parse(line) as UkRecord;
        const existing = rows.get(row[0]) || [];
        existing.push(row);
        rows.set(row[0], existing);
      }
      this.ukCache.set(prefix, rows);
      if (this.ukCache.size > 8) this.ukCache.delete(this.ukCache.keys().next().value!);
    }
    return rows.get(fiasId) || [];
  }

  private async getRegions(): Promise<Map<string, string>> {
    if (this.regionIds && Date.now() - this.regionIds.loadedAt < 86_400_000) return this.regionIds.values;
    const html = await textFrom(FRT + '/opendata');
    const values = new Map<string, string>();
    for (const found of html.matchAll(/<option\b[^>]*\bvalue\s*=\s*["']?(\d+)["']?[^>]*>([^<]+)<\/option>/gi)) {
      values.set(found[2]!.trim(), found[1]!);
    }
    if (values.size < 70) throw new Error('Incomplete FRT region list');
    this.regionIds = { values, loadedAt: Date.now() };
    return values;
  }

  private async getReports(region: string): Promise<Reports | undefined> {
    const cached = this.reports.get(region);
    if (cached && Date.now() - cached.loadedAt < 86_400_000) return cached;
    const regions = await this.getRegions();
    const regionName = ALIASES[region] || region.replace(/^г /, 'город ');
    const gid = regions.get(regionName) || [...regions].find(([name]) => normalizeRegion(name) === normalizeRegion(regionName))?.[1];
    if (!gid) return undefined;
    const ids = new Map<string, string>();
    for (let page = 1; page <= 10 && (!ids.has('1') || !ids.has('3')); page++) {
      const html = await textFrom(FRT + '/opendata?gid=' + gid + '&cids=overhaul&page=' + page + '&pageSize=12');
      for (const [kind, url] of reportLinks(html)) ids.set(kind, url);
      if (!html.includes('/opendata/export/')) break;
    }
    const house = ids.get('1');
    if (!house) return undefined;
    const reports = { house, works: ids.get('3'), loadedAt: Date.now() };
    this.reports.set(region, reports);
    return reports;
  }

  async get(houseId: string, fiasId?: string): Promise<PublicHousingData> {
    const key = fiasId?.toLowerCase() || houseId;
    const cached = this.resultCache.get(key);
    const ttl = cached?.data.overhaul.status === 'unavailable' ? 300_000 : 3_600_000;
    if (cached && Date.now() - cached.loadedAt < ttl) return { ...cached.data, houseId };
    let pending = this.pending.get(key);
    if (!pending) {
      pending = this.load(houseId, fiasId);
      this.pending.set(key, pending);
    }
    try {
      const data = await pending;
      this.resultCache.set(key, { data, loadedAt: Date.now() });
      if (this.resultCache.size > 100) this.resultCache.delete(this.resultCache.keys().next().value!);
      return { ...data, houseId };
    } finally {
      this.pending.delete(key);
    }
  }

  private async load(houseId: string, fiasId?: string): Promise<PublicHousingData> {
    const management: ManagementData = { status: 'missing', sourceUrl: UK_SOURCE, snapshotDate: '2026-09-17' };
    const overhaul: OverhaulData = { status: 'missing', sourceUrl: FRT + '/opendata', works: [] };
    if (!fiasId || !FIAS.test(fiasId.toLowerCase())) return { houseId, management, overhaul };
    const key = fiasId.toLowerCase();
    let ukRows: UkRecord[] = [];
    try { ukRows = await this.lookupUk(key); }
    catch { management.status = 'unavailable'; }
    const distinct = new Map(ukRows.map((row) => [row[3] + '|' + row[4], row]));
    if (distinct.size === 1) {
      const row = [...distinct.values()][0]!;
      if (row[3]) {
        management.status = 'found';
        management.name = row[3];
        management.managementType = row[2] || undefined;
        management.organizationUrl = row[4].startsWith('https://dom.gosuslugi.ru/') ? row[4] : undefined;
      }
    }
    let region = ukRows[0]?.[1];
    if (!region && this.addressProvider) {
      try { region = (await this.addressProvider.resolveHouse(key))?.region; }
      catch { /* The address source must not hide already-known UK data. */ }
    }
    if (!region) {
      overhaul.status = 'unavailable';
      return { houseId, management, overhaul };
    }
    try {
      const reports = await this.getReports(region);
      if (!reports) {
        overhaul.status = 'unavailable';
        return { houseId, management, overhaul };
      }
      overhaul.sourceUrl = reports.house;
      overhaul.worksSourceUrl = reports.works;
      let match: Row | undefined;
      let duplicate = false;
      overhaul.snapshotDate = await scanZipCsv(reports.house, (row) => {
        if (row.houseguid?.toLowerCase() !== key) return;
        if (match) duplicate = true;
        else match = row;
      });
      if (duplicate) {
        overhaul.status = 'unavailable';
        return { houseId, management, overhaul };
      }
      if (!match) return { houseId, management, overhaul };
      const house = match as Row;
      overhaul.status = 'found';
      overhaul.updatedAt = house.update_date_of_information || undefined;
      overhaul.fundingMethod = house.money_collecting_way || undefined;
      const amount = (value: string) => { const parsed = Number(value.replace(',', '.')); return value && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined; };
      overhaul.fundBalanceThousandRub = amount(house.overhaul_funds_balance || '');
      overhaul.contributionRubPerSqM = amount(house.owners_payment || '');
      overhaul.includedAt = house.inclusion_date_to_program || undefined;
      if (reports.works && house.mkd_code) {
        try {
          await scanZipCsv(reports.works, (row) => {
            if (row.mkd_code !== house.mkd_code || row.mun_obr_oktmo !== house.mun_obr_oktmo) return;
            if (!row.service_type) return;
            overhaul.works.push({
              type: row.service_type,
              plannedYear: row.service_date || row.service_date_by_plan || undefined,
              completedDate: row.fact_date_services_finished || undefined,
              contractor: row.contractor_name || undefined,
            });
          });
        } catch { overhaul.worksSourceUrl = undefined; }
      }
      overhaul.works.sort((a, b) => Number(Boolean(a.completedDate)) - Number(Boolean(b.completedDate)) ||
        (a.completedDate ? (b.plannedYear || '').localeCompare(a.plannedYear || '') : (a.plannedYear || '').localeCompare(b.plannedYear || '')));
      overhaul.works = overhaul.works.slice(0, 60);
    } catch { overhaul.status = 'unavailable'; }
    return { houseId, management, overhaul };
  }
}

