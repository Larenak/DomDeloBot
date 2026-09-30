import { loadConfig } from '@domdelo/config';
import type { CaseCategory } from '@domdelo/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { DEMO_HOUSE_ID, InMemoryCaseRepository, demoActors } from '../../repositories/in-memory-case-repository.js';
import { NotFoundError } from '../../repositories/case-repository.js';

const input = { title: 'Срочная проблема в доме', description: 'Срочная аварийная проблема в общем помещении.', category: 'water' as CaseCategory, place: 'Общее помещение' };
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

async function actors() {
  const repository = new InMemoryCaseRepository();
  const author = { ...demoActors['resident-1']! };
  const neighbour = { ...demoActors['resident-2']! };
  const dispatcher = { ...demoActors['dispatcher-1']! };
  for (const actor of [author, neighbour, dispatcher]) await repository.joinDemoHouse(actor, DEMO_HOUSE_ID);
  return { repository, author, neighbour, dispatcher };
}

describe('confirmation gate before demonstration UK delivery', () => {
  it.each(['lighting', 'entrance', 'elevator', 'water', 'heating', 'yard', 'other'] as const)('gates %s, including urgent reports, and counts the author once', async category => {
    const { repository, author, neighbour, dispatcher } = await actors();
    const created = await repository.createCase(author, { ...input, category }, 'gate-' + category);
    expect(created).toMatchObject({ status: 'draft', confirmationsCount: 1, isConfirmed: true, submission: { requiredConfirmations: 2, registeredAccounts: 6, mode: 'demo' } });
    expect(created.submission.sentAt).toBeUndefined();
    expect(created.deadline).toBeUndefined();
    expect(await repository.listCases(dispatcher)).not.toContainEqual(expect.objectContaining({ id: created.id }));
    await expect(repository.getCase(dispatcher, created.id)).rejects.toBeInstanceOf(NotFoundError);
    const ownRepeat = await repository.confirmCase(author, created.id);
    expect(ownRepeat.confirmationsCount).toBe(1);
    expect(ownRepeat.status).toBe('draft');
    const sent = await repository.confirmCase(neighbour, created.id);
    expect(sent).toMatchObject({ status: 'registered', confirmationsCount: 2, submission: { requiredConfirmations: 2, mode: 'demo' } });
    expect(sent.submission.sentAt).toBeTruthy();
    expect(sent.deadline?.startedAt).toBe(sent.submission.sentAt);
    expect(await repository.listCases(dispatcher)).toContainEqual(expect.objectContaining({ id: created.id }));
    const again = await repository.confirmCase(neighbour, created.id);
    expect(again.confirmationsCount).toBe(2);
    expect(again.submission.sentAt).toBe(sent.submission.sentAt);
    expect(again.history.filter(entry => entry.fromStatus === 'draft' && entry.toStatus === 'registered')).toHaveLength(1);
  });

  it('rounds 10% upward, uses registered accounts of this house and freezes completed delivery', async () => {
    const { repository, author, neighbour, dispatcher } = await actors();
    const residents = [];
    for (let index = 0; index < 15; index++) {
      const actor = await repository.resolveMaxUser({ maxUserId: BigInt(1000 + index), displayName: 'Тестовый житель' });
      await repository.joinDemoHouse(actor, DEMO_HOUSE_ID);
      residents.push(actor);
    }
    const foreign = await repository.resolveMaxUser({ maxUserId: 9000n, displayName: 'Другой дом' });
    await repository.addHouse(foreign, { fiasId: '99999999-9999-4999-8999-999999999999', address: 'Другой дом', city: 'Город', street: 'Улица', building: '1' });
    const created = await repository.createCase(author, input, 'gate-21-accounts');
    expect(created.submission).toMatchObject({ registeredAccounts: 21, requiredConfirmations: 3 });
    await expect(repository.confirmCase(foreign, created.id)).rejects.toBeInstanceOf(NotFoundError);
    const two = await repository.confirmCase(neighbour, created.id);
    expect(two.status).toBe('draft');
    expect(two.confirmationsCount).toBe(2);
    const sent = await repository.confirmCase(residents[0]!, created.id);
    expect(sent.status).toBe('registered');
    for (let index = 0; index < 20; index++) {
      const actor = await repository.resolveMaxUser({ maxUserId: BigInt(2000 + index), displayName: 'Новый житель' });
      await repository.joinDemoHouse(actor, DEMO_HOUSE_ID);
    }
    const refreshed = await repository.getCase(author, created.id);
    expect(refreshed.submission).toMatchObject({ registeredAccounts: 41, requiredConfirmations: 3, sentAt: sent.submission.sentAt });
    expect((await repository.getCase(dispatcher, created.id)).status).toBe('registered');
  });

  it('recalculates the pending threshold after house membership changes', async () => {
    const { repository, author, neighbour } = await actors();
    const residents = [];
    for (let index = 0; index < 15; index++) {
      const actor = await repository.resolveMaxUser({ maxUserId: BigInt(3000 + index), displayName: 'Тестовый житель' });
      await repository.joinDemoHouse(actor, DEMO_HOUSE_ID);
      residents.push(actor);
    }
    const created = await repository.createCase(author, input, 'gate-membership');
    expect((await repository.confirmCase(neighbour, created.id)).status).toBe('draft');
    await repository.removeHouse(residents[0]!, DEMO_HOUSE_ID);
    const sent = await repository.getCase(author, created.id);
    expect(sent).toMatchObject({ status: 'registered', submission: { registeredAccounts: 20, requiredConfirmations: 2 } });
  });

  it('prevents dispatcher access and workflow changes through the API until a distinct neighbour confirms', async () => {
    const { repository } = await actors();
    app = await buildApp({ config: loadConfig({ NODE_ENV: 'test', STORAGE_MODE: 'memory', DEMO_MODE: 'true' }), caseRepository: repository });
    const created = await app.inject({ method: 'POST', url: '/api/cases', headers: { 'x-demo-user': 'resident-1', 'idempotency-key': 'api-confirmation-gate' }, payload: input });
    const id = created.json().id;
    expect(created.statusCode).toBe(201);
    for (const role of ['dispatcher-1', 'executor-1']) {
      expect((await app.inject({ method: 'GET', url: `/api/cases/${id}`, headers: { 'x-demo-user': role } })).statusCode).toBe(404);
      const list = await app.inject({ method: 'GET', url: '/api/cases', headers: { 'x-demo-user': role } });
      expect(list.json().some((entry: { id: string }) => entry.id === id)).toBe(false);
      const similar = await app.inject({ method: 'POST', url: '/api/cases/deduplication', headers: { 'x-demo-user': role }, payload: { description: input.description, category: input.category, place: input.place } });
      expect(similar.json().some((entry: { id: string }) => entry.id === id)).toBe(false);
    }
    expect((await app.inject({ method: 'PATCH', url: `/api/cases/${id}/status`, headers: { 'x-demo-user': 'dispatcher-1' }, payload: { status: 'assigned', expectedVersion: 1, assignee: 'Мастер' } })).statusCode).toBe(404);
    const sent = await app.inject({ method: 'POST', url: `/api/cases/${id}/confirmations`, headers: { 'x-demo-user': 'resident-2' } });
    expect(sent.json().submission.sentAt).toBeTruthy();
    expect((await app.inject({ method: 'GET', url: `/api/cases/${id}`, headers: { 'x-demo-user': 'dispatcher-1' } })).statusCode).toBe(200);
    const assigned = await app.inject({ method: 'PATCH', url: `/api/cases/${id}/status`, headers: { 'x-demo-user': 'dispatcher-1' }, payload: { status: 'assigned', expectedVersion: sent.json().version, assignee: 'Мастер' } });
    expect(assigned.statusCode).toBe(200);
  });
});
