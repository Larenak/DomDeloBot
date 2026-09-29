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

describe('опрос собственников', () => {
  it('allows the chair to create and one owner to answer once', async () => {
    const app = await buildApp({ config });
    openedApps.push(app);
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
      headers: { 'x-demo-user': 'owner-1' },
      payload: { optionId: poll.options[0].id },
    };
    const first = await app.inject(voteRequest);
    const repeated = await app.inject(voteRequest);
    expect(first.json()).toMatchObject({ totalVotes: 1, myOptionId: poll.options[0].id });
    expect(repeated.json().totalVotes).toBe(1);

    const changed = await app.inject({ ...voteRequest, payload: { optionId: poll.options[1].id } });
    expect(changed.statusCode).toBe(409);
    const tenant = await app.inject({ ...voteRequest, headers: { 'x-demo-user': 'tenant-1' } });
    expect(tenant.statusCode).toBe(403);
  });

  it('does not let an unverified chat resident create or answer an owner poll', async () => {
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
    expect(vote.statusCode).toBe(403);
  });
});
