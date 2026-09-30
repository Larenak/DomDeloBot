import { describe, expect, it } from 'vitest';
import { DEMO_HOUSE_ID, InMemoryCaseRepository, demoActors } from './in-memory-case-repository.js';
import { ForbiddenError } from './case-repository.js';

describe('case deletion ownership', () => {
  it("does not grant an administrator the right to delete someone else's case", async () => {
    const repository = new InMemoryCaseRepository();
    const actor = { ...demoActors['resident-2']!, houseId: DEMO_HOUSE_ID, role: 'admin' as const };
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect((await repository.getCase(actor, id)).canDelete).toBe(false);
    await expect(repository.deleteCase(actor, id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await repository.getCase(actor, id)).id).toBe(id);
  });

  it('keeps ownership after a role change and after neighbours join', async () => {
    const repository = new InMemoryCaseRepository();
    const author = { ...demoActors['resident-1']!, houseId: DEMO_HOUSE_ID };
    const neighbour = { ...demoActors['resident-2']!, houseId: DEMO_HOUSE_ID };
    const item = await repository.createCase(author, { title: 'Не горит свет', description: 'На площадке не горит свет.', category: 'lighting', place: 'Площадка' }, 'role-change-delete');
    await repository.confirmCase(neighbour, item.id);
    const newRole = { ...author, role: 'dispatcher' as const };
    expect((await repository.getCase(newRole, item.id)).canDelete).toBe(true);
    await repository.deleteCase(newRole, item.id);
    expect(await repository.listCases(neighbour)).not.toContainEqual(expect.objectContaining({ id: item.id }));
  });
});
