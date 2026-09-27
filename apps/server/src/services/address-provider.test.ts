import { afterEach, describe, expect, it, vi } from 'vitest';

import { AddressProviderUnavailableError, DadataAddressProvider } from './address-provider.js';

const fiasId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const house = {
  value: 'Респ Татарстан, г Казань, ул Спортивная, д 12',
  data: {
    country_iso_code: 'RU', city: 'Казань', settlement: null, area: null,
    street: 'Спортивная', house: '12', block: null, block_type: null,
    house_fias_id: fiasId, fias_id: fiasId, fias_level: '8', fias_actuality_state: '0',
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('DaData address provider', () => {
  it('requires a server-side API key', async () => {
    await expect(new DadataAddressProvider().suggest('Казань')).rejects.toBeInstanceOf(AddressProviderUnavailableError);
  });

  it('marks only Russian house results as selectable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      suggestions: [
        { value: 'г Казань', data: { country_iso_code: 'RU', fias_level: '4' } },
        house,
        { ...house, value: 'Старый дом', data: { ...house.data, fias_actuality_state: '99' } },
      ],
    }), { status: 200 })));
    const result = await new DadataAddressProvider('test-key').suggest('Казань');
    expect(result).toEqual([
      { value: 'г Казань', isHouse: false },
      { value: house.value, isHouse: true, fiasId },
    ]);
  });

  it('rechecks the exact current house identifier before accepting an address', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ suggestions: [house] }), { status: 200 })));
    const provider = new DadataAddressProvider('test-key');
    expect(await provider.resolveHouse(fiasId)).toEqual({
      fiasId, address: house.value, city: 'Казань', street: 'Спортивная', building: '12',
    });
    expect(await provider.resolveHouse('not-a-uuid')).toBeNull();
    expect(await provider.resolveHouse('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')).toBeNull();
  });
});
