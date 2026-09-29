import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressProvider } from './address-provider.js';
import { PublicHousingDataProvider } from './public-housing-data.js';

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
const houseCsv = `houseguid;mkd_code;mun_obr_oktmo;money_collecting_way;overhaul_funds_balance;owners_payment;inclusion_date_to_program;update_date_of_information\n${fiasId};42;57701000;Региональный оператор;123,5;9,36;2015-01-01;2026-09-01\n`;
const worksCsv = 'mkd_code;mun_obr_oktmo;service_type;service_date;fact_date_services_finished;contractor_name\n42;57701000;Ремонт крыши;2028;;Подрядчик\n';

afterEach(() => vi.unstubAllGlobals());

describe('public overhaul data', () => {
  it('finds a house without a UK row using its verified region', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === FRT + '/opendata') return new Response(options);
      if (url.includes('gid=70')) return new Response(reports);
      if (url.endsWith('/101')) return new Response(zipCsv(houseCsv));
      if (url.endsWith('/103')) return new Response(zipCsv(worksCsv));
      throw new Error('Unexpected URL ' + url);
    }));

    const data = await new PublicHousingDataProvider(addressProvider).get('house-1', fiasId);
    expect(data.management.status).toBe('missing');
    expect(data.overhaul.status).toBe('found');
    expect(data.overhaul.fundBalanceThousandRub).toBe(123.5);
    expect(data.overhaul.works).toEqual([{
      type: 'Ремонт крыши', plannedYear: '2028', contractor: 'Подрядчик',
    }]);
    expect(data.overhaul.snapshotDate).toBe('2026-09-01');
  });

  it('reports source denial as unavailable, not as an absent house', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('You are blocked', { status: 403 })));
    const data = await new PublicHousingDataProvider(addressProvider).get('house-1', fiasId);
    expect(data.overhaul.status).toBe('unavailable');
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
    expect((await new PublicHousingDataProvider(addressProvider).get('house-1', fiasId)).overhaul.status).toBe('missing');

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) =>
      new Response(String(input) === FRT + '/opendata' ? options : '<div>Нет наборов КР</div>')));
    expect((await new PublicHousingDataProvider(addressProvider).get('house-2', fiasId)).overhaul.status).toBe('unavailable');
  });
});
