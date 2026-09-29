import { loadConfig } from '@domdelo/config';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { createSessionToken } from './modules/auth/session.js';
import type { AddressProvider, VerifiedHouse } from './services/address-provider.js';

const kazanId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const moscowId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const knownHouses: Record<string, VerifiedHouse> = {
  [kazanId]: {
    fiasId: kazanId, address: 'г. Казань, ул. Спортивная, д. 12',
    city: 'Казань', street: 'Спортивная', building: '12',
  },
  [moscowId]: {
    fiasId: moscowId, address: 'г. Москва, ул. Тверская, д. 7',
    city: 'Москва', street: 'Тверская', building: '7',
  },
};
const addressProvider: AddressProvider = {
  suggest: async (query) => Object.values(knownHouses)
    .filter((house) => house.address.toLocaleLowerCase('ru-RU').includes(query.toLocaleLowerCase('ru-RU')))
    .map((house) => ({ value: house.address, fiasId: house.fiasId, isHouse: true })),
  resolveHouse: async (fiasId) => knownHouses[fiasId] || null,
};

const config = loadConfig({
  NODE_ENV: 'test',
  STORAGE_MODE: 'memory',
  DEMO_MODE: 'true',
  MAX_WEBHOOK_SECRET: 'test-webhook-secret',
  SESSION_SECRET: 'test-session-secret-with-enough-entropy',
});

const openedApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

async function testApp() {
  const app = await buildApp({ config, addressProvider });
  openedApps.push(app);
  return app;
}

async function addDemoHouse(
  app: Awaited<ReturnType<typeof buildApp>>,
  user = 'resident-1',
) {
  return app.inject({
    method: 'POST',
    url: '/api/me/houses',
    headers: { 'x-demo-user': user },
    payload: { fiasId: kazanId },
  });
}

afterEach(async () => {
  await Promise.all(openedApps.splice(0).map((app) => app.close()));
});

describe('ДомДело API', () => {
  it('does not accept demo roles when published', async () => {
    const productionConfig = loadConfig({
      NODE_ENV: 'production',
      STORAGE_MODE: 'memory',
      DEMO_MODE: 'false',
      SESSION_SECRET: 'test-session-secret-with-enough-entropy',
    });
    const app = await buildApp({ config: productionConfig });
    openedApps.push(app);
    const publicConfig = await app.inject({ method: 'GET', url: '/api/public-config' });
    const cases = await app.inject({
      method: 'GET',
      url: '/api/cases',
      headers: { 'x-demo-user': 'dispatcher-1' },
    });
    expect(publicConfig.json()).toEqual({ demoMode: false });
    expect(cases.statusCode).toBe(401);
  });

  it('requires a signed session for personal invitations', async () => {
    const app = await testApp();
    const anonymous = await app.inject({
      method: 'POST', url: '/api/auth/house-invite',
      payload: { code: 'A'.repeat(43) },
    });
    expect(anonymous.statusCode).toBe(401);

    const demo = await app.inject({
      method: 'POST', url: '/api/auth/house-invite',
      headers: { 'x-demo-user': 'resident-1' },
      payload: { code: 'A'.repeat(43) },
    });
    expect(demo.statusCode).toBe(401);
    expect(demo.json().error).toBe('unauthorized');

    const token = createSessionToken({
      id: 'abababab-abab-4bab-8bab-abababababab',
      role: 'resident',
      displayName: 'MAX user',
    }, config.sessionSecret);
    const signed = await app.inject({
      method: 'POST', url: '/api/auth/house-invite',
      headers: { authorization: 'Bearer ' + token },
      payload: { code: 'A'.repeat(43) },
    });
    expect(signed.statusCode).toBe(503);

    const identity = await app.inject({
      method: 'GET', url: '/api/auth/me',
      headers: { 'x-demo-user': 'resident-1' },
    });
    expect(identity.json().actor.role).toBe('resident');
  });

  it('reports liveness and readiness', async () => {
    const app = await testApp();
    const live = await app.inject({ method: 'GET', url: '/health/live' });
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(live.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready' });
  });

  it('requires an address before exposing house cases', async () => {
    const app = await testApp();
    const blocked = await app.inject({
      method: 'GET',
      url: '/api/cases',
      headers: { 'x-demo-user': 'resident-1' },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ error: 'address_required' });

    const added = await addDemoHouse(app);
    expect(added.statusCode).toBe(200);
    expect(added.json()).toMatchObject({ onboardingRequired: false });
    expect(added.json().houses).toHaveLength(1);

    const cases = await app.inject({
      method: 'GET',
      url: '/api/cases',
      headers: { 'x-demo-user': 'resident-1' },
    });
    expect(cases.statusCode).toBe(200);
  });

  it('opens only the configured demonstration house without an address provider', async () => {
    const demoConfig = loadConfig({
      NODE_ENV: 'test',
      STORAGE_MODE: 'memory',
      DEMO_MODE: 'true',
      HACKATHON_HOUSE_ID: '11111111-1111-4111-8111-111111111111',
      SESSION_SECRET: 'test-session-secret-with-enough-entropy',
    });
    const app = await buildApp({ config: demoConfig });
    openedApps.push(app);
    const publicConfig = await app.inject({ method: 'GET', url: '/api/public-config' });
    expect(publicConfig.json()).toMatchObject({ demoHouseAvailable: true });
    const joined = await app.inject({
      method: 'POST', url: '/api/me/houses/demo',
      headers: { 'x-demo-user': 'resident-1' },
    });
    expect(joined.statusCode).toBe(200);
    expect(joined.json()).toMatchObject({
      activeHouseId: '11111111-1111-4111-8111-111111111111',
      onboardingRequired: false, accessPending: false,
    });
    const cases = await app.inject({
      method: 'GET', url: '/api/cases',
      headers: { 'x-demo-user': 'resident-1' },
    });
    expect(cases.statusCode).toBe(200);
    expect(cases.json()).toHaveLength(2);
  });

  it('allows demo personas only inside the configured demonstration house', async () => {
    const secret = 'test-session-secret-with-enough-entropy';
    const demoConfig = loadConfig({
      NODE_ENV: 'production', STORAGE_MODE: 'memory', DEMO_MODE: 'false',
      HACKATHON_HOUSE_ID: '11111111-1111-4111-8111-111111111111',
      SESSION_SECRET: secret,
    });
    const app = await buildApp({ config: demoConfig, addressProvider });
    openedApps.push(app);
    const token = createSessionToken({
      id: 'efefefef-efef-4fef-8fef-efefefefefef', role: 'resident', displayName: 'Гость MAX',
    }, secret);
    const headers = { authorization: `Bearer ${token}` };
    const joined = await app.inject({ method: 'POST', url: '/api/me/houses/demo', headers });
    expect(joined.statusCode).toBe(200);
    const report = await app.inject({ method: 'GET', url: '/api/reports/house',
      headers: { ...headers, 'x-demo-role': 'authority' } });
    expect(report.statusCode).toBe(200);
    const demoContext = await app.inject({ method: 'GET', url: '/api/me/houses',
      headers: { ...headers, 'x-demo-role': 'authority' } });
    expect(demoContext.json().activeRole).toBe('authority');
    const personalCases = await app.inject({ method: 'GET', url: '/api/cases',
      headers: { ...headers, 'x-demo-role': 'authority' } });
    expect(personalCases.statusCode).toBe(403);
    const upload = await app.inject({ method: 'POST',
      url: '/api/cases/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/attachments?kind=problem', headers });
    expect(upload.statusCode).toBe(403);
    expect(upload.json().error).toBe('demo_upload_disabled');
    const realHouse = await app.inject({ method: 'POST', url: '/api/me/houses', headers,
      payload: { fiasId: moscowId } });
    expect(realHouse.statusCode).toBe(200);
    expect(realHouse.json().activeRole).toBe('resident');
    const denied = await app.inject({ method: 'GET', url: '/api/reports/house',
      headers: { ...headers, 'x-demo-role': 'authority' } });
    expect(denied.statusCode).toBe(403);
  });

  it('suggests known addresses and rejects free text or unknown house identifiers', async () => {
    const app = await testApp();
    const suggestions = await app.inject({
      method: 'GET', url: '/api/addresses/suggest?q=Казань',
      headers: { 'x-demo-user': 'resident-1' },
    });
    expect(suggestions.statusCode).toBe(200);
    expect(suggestions.json()).toContainEqual({
      value: knownHouses[kazanId]!.address, fiasId: kazanId, isHouse: true,
    });

    const freeText = await app.inject({
      method: 'POST', url: '/api/me/houses', headers: { 'x-demo-user': 'resident-1' },
      payload: { city: 'Несуществующий', street: 'Выдуманная', building: '99' },
    });
    expect(freeText.statusCode).toBe(400);
    const unknown = await app.inject({
      method: 'POST', url: '/api/me/houses', headers: { 'x-demo-user': 'resident-1' },
      payload: { fiasId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1' },
    });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json()).toMatchObject({ error: 'address_not_found' });
  });

  it('keeps cases isolated while a resident switches between favorite homes', async () => {
    const app = await testApp();
    const first = await addDemoHouse(app);
    const firstHouseId = first.json().activeHouseId as string;

    const second = await app.inject({
      method: 'POST',
      url: '/api/me/houses',
      headers: { 'x-demo-user': 'resident-1' },
      payload: { fiasId: moscowId },
    });
    expect(second.json().houses).toHaveLength(2);

    const emptySecondHouse = await app.inject({
      method: 'GET',
      url: '/api/cases',
      headers: { 'x-demo-user': 'resident-1' },
    });
    expect(emptySecondHouse.json()).toEqual([]);

    await app.inject({
      method: 'POST',
      url: `/api/me/houses/${firstHouseId}/select`,
      headers: { 'x-demo-user': 'resident-1' },
    });
    const originalHouseCases = await app.inject({
      method: 'GET',
      url: '/api/cases',
      headers: { 'x-demo-user': 'resident-1' },
    });
    expect(originalHouseCases.json()).toHaveLength(2);
  });

  it('finds a similar open case before creating a duplicate', async () => {
    const app = await testApp();
    await addDemoHouse(app, 'resident-2');
    const response = await app.inject({
      method: 'POST',
      url: '/api/cases/deduplication',
      headers: { 'x-demo-user': 'resident-2' },
      payload: {
        description: 'На втором этаже не горят лампы, в подъезде темно',
        category: 'lighting',
        entrance: '2',
        place: 'Лестничная клетка',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()[0]).toMatchObject({ number: 128, category: 'lighting' });
  });

  it('tracks followed cases per resident and follows newly created cases automatically', async () => {
    const app = await testApp();
    await addDemoHouse(app, 'resident-1');
    await addDemoHouse(app, 'resident-2');
    const created = await app.inject({
      method: 'POST',
      url: '/api/cases',
      headers: { 'x-demo-user': 'resident-1', 'idempotency-key': 'follow-created-case' },
      payload: {
        title: 'Течёт труба в подвале',
        description: 'В подвале течёт труба, на полу скопилась вода.',
        category: 'water',
        place: 'Подвал',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ isWatched: true, watchersCount: 1 });
    const caseId = created.json().id as string;

    const secondResidentList = await app.inject({
      method: 'GET', url: '/api/cases', headers: { 'x-demo-user': 'resident-2' },
    });
    expect(secondResidentList.json().find((item: { id: string }) => item.id === caseId)).toMatchObject({
      isWatched: false, watchersCount: 1,
    });

    const watched = await app.inject({
      method: 'POST', url: `/api/cases/${caseId}/watchers`, headers: { 'x-demo-user': 'resident-2' },
    });
    expect(watched.json()).toMatchObject({ isWatched: true, watchersCount: 2 });
    const unwatched = await app.inject({
      method: 'DELETE', url: `/api/cases/${caseId}/watchers`, headers: { 'x-demo-user': 'resident-2' },
    });
    expect(unwatched.json()).toMatchObject({ isWatched: false, watchersCount: 1 });
  });

  it('runs creation and dispatcher assignment through the same workflow', async () => {
    const app = await testApp();
    await addDemoHouse(app, 'resident-1');
    await addDemoHouse(app, 'dispatcher-1');
    const createRequest = {
      method: 'POST',
      url: '/api/cases',
      headers: { 'x-demo-user': 'resident-1', 'idempotency-key': 'test-create-domofon' },
      payload: {
        title: 'Не работает домофон',
        description: 'Домофон не открывает входную дверь со вчерашнего вечера.',
        category: 'entrance',
        entrance: '3',
        place: 'Входная дверь',
      },
    } as const;
    const createdResponse = await app.inject(createRequest);
    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json();
    const repeatedResponse = await app.inject(createRequest);
    expect(repeatedResponse.json().id).toBe(created.id);

    const assignedResponse = await app.inject({
      method: 'PATCH',
      url: `/api/cases/${created.id}/status`,
      headers: { 'x-demo-user': 'dispatcher-1' },
      payload: {
        status: 'assigned',
        expectedVersion: created.version,
        assignee: 'Мастер домофонов Алексей',
      },
    });
    expect(assignedResponse.statusCode).toBe(200);
    expect(assignedResponse.json()).toMatchObject({
      status: 'assigned',
      assignee: 'Мастер домофонов Алексей',
      version: 2,
    });
  });

  it('shows a dispatcher forecast in the case timeline and clears it after work', async () => {
    const app = await testApp();
    const plannedCompletionAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const assigned = await app.inject({
      method: 'PATCH',
      url: '/api/cases/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/status',
      headers: { 'x-demo-user': 'dispatcher-1' },
      payload: { status: 'assigned', expectedVersion: 1, assignee: 'Мастер', plannedCompletionAt },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json()).toMatchObject({ plannedCompletionAt });
    expect(assigned.json().history.at(-1)).toMatchObject({ plannedCompletionAt, comment: 'Исполнитель: Мастер' });

    const started = await app.inject({
      method: 'PATCH',
      url: '/api/cases/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/status',
      headers: { 'x-demo-user': 'dispatcher-1' },
      payload: { status: 'in_progress', expectedVersion: 2 },
    });
    expect(started.json().plannedCompletionAt).toBe(plannedCompletionAt);

    const finished = await app.inject({
      method: 'PATCH',
      url: '/api/cases/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/status',
      headers: { 'x-demo-user': 'dispatcher-1' },
      payload: { status: 'awaiting_resident_verification', expectedVersion: 3 },
    });
    expect(finished.json().plannedCompletionAt).toBeUndefined();
    expect(finished.json().history[1].plannedCompletionAt).toBe(plannedCompletionAt);
  });

  it('stores a repeated MAX webhook only once', async () => {
    const app = await testApp();
    const request = {
      method: 'POST' as const,
      url: '/webhooks/max',
      headers: { 'x-max-bot-api-secret': 'test-webhook-secret' },
      payload: {
        update_type: 'message_created',
        message: { body: { mid: 'mid.123', text: 'Создать дело' }, sender: { user_id: 42 } },
      },
    };
    const first = await app.inject(request);
    const second = await app.inject(request);
    expect(first.json()).toEqual({ ok: true, duplicate: false });
    expect(second.json()).toEqual({ ok: true, duplicate: true });
  });
});

describe('automatic text moderation', () => {
  it('rejects inappropriate case text before it appears to neighbors', async () => {
    const app = await testApp();
    await addDemoHouse(app, 'resident-1');
    const headers = { 'x-demo-user': 'resident-1', 'idempotency-key': 'moderation-create-case' };
    const before = await app.inject({ method: 'GET', url: '/api/cases', headers });

    const rejected = await app.inject({
      method: 'POST', url: '/api/cases', headers,
      payload: {
        title: 'Сломана дверь в подъезде',
        description: 'На двери написано слово х.у.й, которое нужно убрать.',
        category: 'entrance', place: 'Входная дверь',
      },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json()).toMatchObject({ error: 'inappropriate_text' });
    const after = await app.inject({ method: 'GET', url: '/api/cases', headers });
    expect(after.json()).toHaveLength(before.json().length);

    const duplicateSearch = await app.inject({
      method: 'POST', url: '/api/cases/deduplication', headers,
      payload: { description: 'В подъезде х у й на стене', category: 'entrance', place: 'Подъезд' },
    });
    expect(duplicateSearch.statusCode).toBe(422);
  });

  it('rejects inappropriate status comments without changing the case', async () => {
    const app = await testApp();
    await addDemoHouse(app, 'resident-1');
    await addDemoHouse(app, 'dispatcher-1');
    const created = await app.inject({
      method: 'POST', url: '/api/cases',
      headers: { 'x-demo-user': 'resident-1', 'idempotency-key': 'moderation-status-case' },
      payload: {
        title: 'Не закрывается входная дверь',
        description: 'В подъезде не закрывается входная дверь.',
        category: 'entrance', place: 'Входная дверь',
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    const rejected = await app.inject({
      method: 'PATCH', url: `/api/cases/${id}/status`,
      headers: { 'x-demo-user': 'dispatcher-1' },
      payload: {
        status: 'assigned', expectedVersion: created.json().version,
        assignee: 'Мастер', comment: 'Сука, опять сломали дверь',
      },
    });
    expect(rejected.statusCode).toBe(422);
    const unchanged = await app.inject({
      method: 'GET', url: `/api/cases/${id}`, headers: { 'x-demo-user': 'resident-1' },
    });
    expect(unchanged.json()).toMatchObject({ status: 'registered', version: created.json().version });
  });
});
