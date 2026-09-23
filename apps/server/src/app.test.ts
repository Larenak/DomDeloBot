import { loadConfig } from '@domdelo/config';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

const config = loadConfig({
  NODE_ENV: 'test',
  STORAGE_MODE: 'memory',
  DEMO_MODE: 'true',
  MAX_WEBHOOK_SECRET: 'test-webhook-secret',
  SESSION_SECRET: 'test-session-secret-with-enough-entropy',
});

const openedApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

async function testApp() {
  const app = await buildApp({ config });
  openedApps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(openedApps.splice(0).map((app) => app.close()));
});

describe('ДомДело API', () => {
  it('reports liveness and readiness', async () => {
    const app = await testApp();
    const live = await app.inject({ method: 'GET', url: '/health/live' });
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(live.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready' });
  });

  it('finds a similar open case before creating a duplicate', async () => {
    const app = await testApp();
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

  it('runs creation and dispatcher assignment through the same workflow', async () => {
    const app = await testApp();
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
