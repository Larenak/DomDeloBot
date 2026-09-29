import { loadConfig } from '@domdelo/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import type { AddressProvider } from '../../services/address-provider.js';
import type { PublicHousingData } from '../../services/public-housing-data.js';

const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const addressProvider: AddressProvider = {
  suggest: async () => [],
  resolveHouse: async (fiasId) => [first, second].includes(fiasId) ? {
    fiasId, address: fiasId === first ? 'Первый дом' : 'Второй дом',
    city: 'Казань', street: 'Улица', building: '1',
  } : null,
};
const config = loadConfig({
  NODE_ENV: 'test',
  STORAGE_MODE: 'memory',
  DEMO_MODE: 'true',
  SESSION_SECRET: 'test-session-secret-with-enough-entropy',
});
const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('public house services', () => {
  it('shows explicitly fictional management and overhaul data only in the demo house', async () => {
    const get = vi.fn();
    const app = await buildApp({ config, addressProvider, publicHousingDataProvider: { get } });
    apps.push(app);
    const headers = { 'x-demo-user': 'resident-1' };
    const joined = await app.inject({ method: 'POST', url: '/api/me/houses/demo', headers });
    expect(joined.statusCode).toBe(200);
    const response = await app.inject({ method: 'GET', url: '/api/services/house', headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      isDemo: true,
      management: { status: 'found', name: 'УК «Наш дом»' },
      overhaul: { status: 'found' },
    });
    expect(response.json().overhaul.works).toHaveLength(3);
    expect(get).not.toHaveBeenCalled();
  });

  it('uses only the active house and requires authentication', async () => {
    const get = vi.fn(async (houseId: string, fiasId?: string): Promise<PublicHousingData> => ({
      houseId,
      management: { status: 'found', name: fiasId === second ? 'УК второго дома' : 'УК первого дома',
        sourceUrl: 'https://tochno.st/datasets/gisgkh', snapshotDate: '2026-09-17' },
      overhaul: { status: 'missing', sourceUrl: 'https://xn--80adsazqn.xn--p1aee.xn--p1ai/opendata', works: [] },
    }));
    const app = await buildApp({ config, addressProvider, publicHousingDataProvider: { get } });
    apps.push(app);
    const anonymous = await app.inject({ method: 'GET', url: '/api/services/house' });
    expect(anonymous.statusCode).toBe(401);
    const noHouse = await app.inject({ method: 'GET', url: '/api/services/house', headers: { 'x-demo-user': 'resident-1' } });
    expect(noHouse.statusCode).toBe(403);
    expect(get).not.toHaveBeenCalled();

    for (const fiasId of [first, second]) {
      const added = await app.inject({
        method: 'POST', url: '/api/me/houses', headers: { 'x-demo-user': 'resident-1' }, payload: { fiasId },
      });
      expect(added.statusCode).toBe(200);
    }
    const response = await app.inject({ method: 'GET', url: '/api/services/house', headers: { 'x-demo-user': 'resident-1' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().management.name).toBe('УК второго дома');
    expect(get).toHaveBeenCalledWith(expect.any(String), second);
  });
});

