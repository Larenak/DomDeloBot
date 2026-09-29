import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { AddressProvider } from './address-provider.js';
import { PublicHousingDataProvider, scanZipCsv } from './public-housing-data.js';

const FRT = 'https://xn--80adsazqn.xn--p1aee.xn--p1ai';
const fiasId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const addressProvider: AddressProvider = {
  suggest: async () => [],
  resolveHouse: async (id) => ({
    fiasId: id, address: 'Пермский край, г Пермь, ул Ленина, д 1',
    region: 'Пермский край', city: 'Пермь', street: 'Ленина', building: '1',
  }),
};

function zipCsv(csv: string): Uint8Array {
  const name = Buffer.from('report-20260901.csv');
  const data = Buffer.from(csv);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const directory = Buffer.concat([central, name]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, directory, end]);
}

const options = '<select>' + Array.from({ length: 69 }, (_, i) =>
  `<option value="${i + 1}">Регион ${i + 1}</option>`).join('') +
  '<option class="region" value="70">Пермский край</option></select>';
const reports = '<article>Многоквартирные дома (отчет КР 1.1) <a href="/opendata/export/101">Экспорт</a></article>' +
  '<article>Работы по капитальному ремонту (КР 1.3) <a href="/opendata/export/103">Экспорт</a></article>';
const reportsWithInlineSvg = '<article>Многоквартирные дома (КР 1.1)' + '<svg></svg>'.repeat(900) +
  '<a href="/opendata/export/101">Экспорт</a></article>' +
  '<article>Работы по капитальному ремонту (КР 1.3)' + '<svg></svg>'.repeat(900) +
  '<a href="/opendata/export/103">Экспорт</a></article>';
const houseCsv = `houseguid;mkd_code;mun_obr_oktmo;money_collecting_way;overhaul_funds_balance;owners_payment;inclusion_date_to_program;update_date_of_information\n${fiasId};42;57701000;Региональный оператор;123,5;9,36;2015-01-01;2026-09-01\n`;
const worksCsv = 'mkd_code;mun_obr_oktmo;service_type;service_date;fact_date_services_finished;contractor_name\n42;57701000;Ремонт крыши;2028;;Подрядчик\n';

afterEach(() => vi.unstubAllGlobals());

describe('public overhaul data', () => {
  it('finds a newly added Sverdlovsk house in the bundled snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('FRT blocked'); }));
    const id = '7de0f8e1-73cd-441f-b308-237d62b9b10b';
    const data = await new PublicHousingDataProvider().get('ekb-lenina-29', id);
    expect(data.management.status).toBe('found');
    expect(data.overhaul.status).toBe('found');
    expect(data.overhaul.works.length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('finds a Rostov house in the bundled snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('FRT blocked'); }));
    const id = 'a084e156-f488-48c3-99f0-a64721ff0c26';
    const rostovAddress: AddressProvider = {
      ...addressProvider,
      resolveHouse: async () => ({
        fiasId: id, address: 'Ростовская область, проверочный дом',
        region: 'Ростовская область', city: 'Ростов-на-Дону', street: '', building: '1',
      }),
    };
    const data = await new PublicHousingDataProvider(rostovAddress).get('rostov-house', id);
    expect(data.overhaul.status).toBe('found');
    expect(data.overhaul.works.length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts an official ZIP whose declared expanded CSV size exceeds 250 MiB', async () => {
    const archive = Buffer.from(zipCsv('houseguid;mkd_code\nexample;1\n'));
    const eocd = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    archive.writeUInt32LE(277 * 1024 * 1024, archive.readUInt32LE(eocd + 16) + 24);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(archive)));
    const rows: Record<string, string>[] = [];
    await scanZipCsv(FRT + '/opendata/export/389', (row) => rows.push(row));
    expect(rows).toEqual([{ houseguid: 'example', mkd_code: '1' }]);
  });

  it('uses a dated local snapshot when the FRT site is blocked', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'domdelo-overhaul-test-'));
    try {
      await mkdir(join(directory, 'buckets'));
      await writeFile(join(directory, 'manifest.json'), JSON.stringify({
        'пермскийкрай': {
          file: 'region.ndjson.gz', houseSourceUrl: FRT + '/opendata/export/101', snapshotDate: '2026-09-01',
        },
      }));
      await writeFile(join(directory, 'buckets', 'aa.ndjson.gz'), gzipSync(JSON.stringify([
        fiasId, '2026-09-01', 'Региональный оператор', 123.5, 9.36, '2015-01-01',
        [['Ремонт крыши', '2028', null, 'Подрядчик']],
      ]) + '\n'));
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('FRT blocked'); }));

      const data = await new PublicHousingDataProvider(addressProvider, undefined, directory).get('house-1', fiasId);
      expect(data.overhaul.status).toBe('found');
      expect(data.overhaul.snapshotDate).toBe('2026-09-01');
      expect(data.overhaul.works).toHaveLength(1);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('finds a house without a UK row using its verified region', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === FRT + '/opendata') return new Response(options);
      if (url.includes('gid=70')) return new Response(reports);
      if (url.endsWith('/101')) return new Response(zipCsv(houseCsv));
      if (url.endsWith('/103')) return new Response(zipCsv(worksCsv));
      throw new Error('Unexpected URL ' + url);
    }));

    const data = await new PublicHousingDataProvider(addressProvider, undefined, null).get('house-1', fiasId);
    expect(data.management.status).toBe('missing');
    expect(data.overhaul.status).toBe('found');
    expect(data.overhaul.fundBalanceThousandRub).toBe(123.5);
    expect(data.overhaul.works).toEqual([{
      type: 'Ремонт крыши', plannedYear: '2028', contractor: 'Подрядчик',
    }]);
    expect(data.overhaul.snapshotDate).toBe('2026-09-01');
  });

  it('finds export links after long inline SVG markup on the real FRT page', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === FRT + '/opendata') return new Response(options);
      if (url.includes('gid=70')) return new Response(reportsWithInlineSvg);
      if (url.endsWith('/101')) return new Response(zipCsv(houseCsv));
      if (url.endsWith('/103')) return new Response(zipCsv(worksCsv));
      throw new Error('Unexpected URL ' + url);
    }));

    const data = await new PublicHousingDataProvider(addressProvider, undefined, null).get('house-1', fiasId);
    expect(data.overhaul.status).toBe('found');
    expect(data.overhaul.works).toHaveLength(1);
  });

  it('reports source denial as unavailable, not as an absent house', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('You are blocked', { status: 403 })));
    const warn = vi.fn();
    const data = await new PublicHousingDataProvider(addressProvider, { warn }, null).get('house-1', fiasId);
    expect(data.overhaul.status).toBe('unavailable');
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'regional_export_failed', region: 'Пермский край',
    }), 'Overhaul lookup unavailable');
  });

  it('distinguishes a checked archive without the house from a missing regional export', async () => {
    const fetchArchive = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === FRT + '/opendata') return new Response(options);
      if (url.includes('gid=70')) return new Response(reports);
      if (url.endsWith('/101')) return new Response(zipCsv(houseCsv.replace(fiasId, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')));
      if (url.endsWith('/103')) return new Response(zipCsv(worksCsv));
      throw new Error('Unexpected URL ' + url);
    });
    vi.stubGlobal('fetch', fetchArchive);
    expect((await new PublicHousingDataProvider(addressProvider, undefined, null).get('house-1', fiasId)).overhaul.status).toBe('missing');

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) =>
      new Response(String(input) === FRT + '/opendata' ? options : '<div>Нет наборов КР</div>')));
    expect((await new PublicHousingDataProvider(addressProvider, undefined, null).get('house-2', fiasId)).overhaul.status).toBe('unavailable');
  });
});
