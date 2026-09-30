import { loadConfig } from '@domdelo/config';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';
import { demoActors } from '../../repositories/in-memory-case-repository.js';

const config = loadConfig({
  NODE_ENV: 'test',
  STORAGE_MODE: 'memory',
  DEMO_MODE: 'true',
  SESSION_SECRET: 'test-session-secret-with-enough-entropy',
});

const openedApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
afterEach(async () => {
  await Promise.all(openedApps.splice(0).map((app) => app.close()));
});

describe('опрос жителей', () => {
  it('allows the chair to create and one resident to answer once', async () => {
    const app = await buildApp({ config });
    openedApps.push(app);
    await app.caseRepository.addHouse(demoActors['resident-1']!, {
      fiasId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      address: 'г. Казань, ул. Спортивная, д. 12',
      city: 'Казань', street: 'Спортивная', building: '12',
    });
    const created = await app.inject({
      method: 'POST', url: '/api/polls',
      headers: { 'x-demo-user': 'chair-1' },
      payload: {
        question: 'Какие деревья посадить у дома?',
        options: ['Липы', 'Клёны'],
        closesAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(created.statusCode).toBe(201);
    const poll = created.json();
    const voteRequest = {
      method: 'POST' as const, url: '/api/polls/' + poll.id + '/votes',
      headers: { 'x-demo-user': 'resident-1' },
      payload: { optionId: poll.options[0].id },
    };
    const first = await app.inject(voteRequest);
    const repeated = await app.inject(voteRequest);
    expect(first.json()).toMatchObject({ totalVotes: 1, myOptionId: poll.options[0].id });
    expect(repeated.json().totalVotes).toBe(1);

    const changed = await app.inject({ ...voteRequest, payload: { optionId: poll.options[1].id } });
    expect(changed.statusCode).toBe(409);
    const dispatcher = await app.inject({ ...voteRequest, headers: { 'x-demo-user': 'dispatcher-1' } });
    expect(dispatcher.statusCode).toBe(403);
  });

  it('allows a resident to answer an informal house poll but not create one', async () => {
    const app = await buildApp({ config });
    openedApps.push(app);
    await app.caseRepository.addHouse(demoActors['resident-1']!, {
      fiasId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      address: 'г. Казань, ул. Спортивная, д. 12',
      city: 'Казань', street: 'Спортивная', building: '12',
    });
    const polls = await app.inject({ method: 'GET', url: '/api/polls', headers: { 'x-demo-user': 'resident-1' } });
    expect(polls.statusCode).toBe(200);
    const poll = polls.json()[0];
    const vote = await app.inject({
      method: 'POST', url: '/api/polls/' + poll.id + '/votes',
      headers: { 'x-demo-user': 'resident-1' },
      payload: { optionId: poll.options[0].id },
    });
    expect(vote.statusCode).toBe(200);
    const create = await app.inject({
      method: 'POST', url: '/api/polls', headers: { 'x-demo-user': 'resident-1' },
      payload: { question: 'Какие деревья посадить у дома?', options: ['Липы', 'Клёны'], closesAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    expect(create.statusCode).toBe(403);
  });
  it('allows the chair to delete a house poll with answers and rejects other roles and houses', async () => {
    const app = await buildApp({ config });
    openedApps.push(app);
    const headers = { 'x-demo-user': 'chair-1' };
    const listed = await app.inject({ method: 'GET', url: '/api/polls', headers });
    const poll = listed.json()[0];
    const vote = await app.inject({
      method: 'POST', url: '/api/polls/' + poll.id + '/votes', headers,
      payload: { optionId: poll.options[0].id },
    });
    expect(vote.statusCode).toBe(200);
    expect(vote.json().totalVotes).toBe(1);

    const url = '/api/polls/' + poll.id;
    expect((await app.inject({ method: 'DELETE', url })).statusCode).toBe(401);
    for (const role of ['resident-1', 'dispatcher-1', 'executor-1', 'authority-1']) {
      expect((await app.inject({ method: 'DELETE', url, headers: { 'x-demo-user': role } })).statusCode).toBe(403);
    }
    await expect(app.pollRepository.remove({
      ...demoActors['chair-1']!, houseId: '99999999-9999-4999-8999-999999999999',
    }, poll.id)).rejects.toThrow('Опрос не найден');
    expect((await app.inject({ method: 'GET', url: '/api/polls', headers })).json()).toHaveLength(1);

    const removed = await app.inject({ method: 'DELETE', url, headers });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ deleted: true });
    expect((await app.inject({ method: 'GET', url: '/api/polls', headers })).json()).toEqual([]);
    expect((await app.inject({
      method: 'POST', url: url + '/votes', headers, payload: { optionId: poll.options[0].id },
    })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url, headers })).statusCode).toBe(404);
  });

});
