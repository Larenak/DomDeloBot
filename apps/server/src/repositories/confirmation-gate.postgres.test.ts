import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../db/schema.js';
import { InMemoryObjectStorage } from '../services/object-storage.js';
import { PostgresCaseRepository } from './postgres-case-repository.js';
import { NotFoundError } from './case-repository.js';
import type { AuthenticatedActor } from '../types.js';

const url = process.env.CONFIRMATION_TEST_DATABASE_URL;
const schemaName = 'confirmation_test_' + randomUUID().replaceAll('-', '');
const houseId = randomUUID();
const legacyIds = [randomUUID(), randomUUID(), randomUUID()];
const accounts = Array.from({ length: 21 }, (_, i): AuthenticatedActor => ({
  id: randomUUID(), houseId, role: i === 20 ? 'dispatcher' : 'resident', displayName: 'Тестовый аккаунт ' + i,
}));
let client: ReturnType<typeof postgres> | undefined;
let db: ReturnType<typeof drizzle<typeof schema>>;
let repository: PostgresCaseRepository;

describe.skipIf(!url)('PostgreSQL confirmation gate and migration', () => {
  beforeAll(async () => {
    const destination = new URL(url!);
    if (destination.hostname !== '127.0.0.1' || destination.pathname !== '/domdelo_confirmation_test') {
      throw new Error('This test requires a dedicated local domdelo_confirmation_test database');
    }
    client = postgres(url!, { max: 10, onnotice: () => {}, connection: { search_path: `${schemaName},public` } });
    await client`CREATE SCHEMA ${client(schemaName)}`;
    db = drizzle(client, { schema });
    const migrationsFolder = fileURLToPath(new URL('../../../../db/migrations/generated/', import.meta.url));
    const oldFolder = fileURLToPath(new URL(`../../../../tmp/verification/${schemaName}/`, import.meta.url));
    await mkdir(oldFolder + 'meta', { recursive: true });
    const journal = JSON.parse(await readFile(migrationsFolder + 'meta/_journal.json', 'utf8'));
    const allEntries = journal.entries;
    journal.entries = allEntries.filter((entry: { idx: number }) => entry.idx < 10);
    for (const entry of allEntries) {
      const migration = (await readFile(migrationsFolder + entry.tag + '.sql', 'utf8')).replaceAll('"public"', `"${schemaName}"`);
      await writeFile(oldFolder + entry.tag + '.sql', migration);
    }
    await writeFile(oldFolder + 'meta/_journal.json', JSON.stringify(journal));
    await migrate(db, { migrationsFolder: oldFolder, migrationsSchema: schemaName });
    await db.insert(schema.houses).values({ id: houseId, address: 'Вымышленный дом', normalizedAddress: randomUUID(), isDemo: true });
    await db.insert(schema.users).values(accounts.map(({ id, displayName, role }) => ({ id, displayName, role, isDemo: true })));
    await db.insert(schema.houseMembers).values(accounts.map(actor => ({ houseId, userId: actor.id, isFavorite: true })));
    // Insert using the old schema before the gate's new columns exist.
    for (const [index, id] of legacyIds.entries()) {
      await client`INSERT INTO cases (id, house_id, author_id, title, description, category, place, normalized_text, status, responsible_organization)
        VALUES (${id}, ${houseId}, ${accounts[0]!.id}, 'Старая проблема', 'Описание старой проблемы', 'water', 'Подвал', 'подвал проблема', ${index === 2 ? 'in_progress' : 'registered'}, 'УК')`;
    }
    await db.insert(schema.caseConfirmations).values([1, 2].map(index => ({ caseId: legacyIds[1]!, userId: accounts[index]!.id })));
    journal.entries = allEntries;
    await writeFile(oldFolder + 'meta/_journal.json', JSON.stringify(journal));
    await migrate(db, { migrationsFolder: oldFolder, migrationsSchema: schemaName });
    repository = new PostgresCaseRepository(db, new InMemoryObjectStorage(), true);
  }, 30_000);

  afterAll(async () => {
    if (client) {
      await client`DROP SCHEMA ${client(schemaName)} CASCADE`;
      await client.end();
    }
  });

  it('returns unconfirmed legacy registered cases to collection and preserves already accepted work', async () => {
    const pending = await repository.getCase(accounts[0]!, legacyIds[0]!);
    expect(pending).toMatchObject({ status: 'draft', confirmationsCount: 1, submission: { requiredConfirmations: 3, registeredAccounts: 21 } });
    expect(pending.submission.sentAt).toBeUndefined();
    expect(pending.deadline).toBeUndefined();
    await expect(repository.getCase(accounts[20]!, pending.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await repository.getCase(accounts[0]!, legacyIds[1]!)).submission.sentAt).toBeTruthy();
    expect((await repository.getCase(accounts[20]!, legacyIds[2]!)).status).toBe('in_progress');
  });

  it('atomically submits once under concurrent confirmations and preserves the sent case across repository restarts', async () => {
    const author = accounts[0]!;
    const created = await repository.createCase(author, { title: 'Срочная протечка в доме', description: 'Аварийная протечка трубы в общем подвале.', category: 'water', place: 'Подвал' }, randomUUID());
    expect(created).toMatchObject({ status: 'draft', confirmationsCount: 1, isConfirmed: true, submission: { requiredConfirmations: 3, registeredAccounts: 21 } });
    expect(created.deadline).toBeUndefined();
    expect((await repository.confirmCase(author, created.id)).confirmationsCount).toBe(1);
    expect((await repository.confirmCase(accounts[1]!, created.id)).status).toBe('draft');
    await Promise.all(Array.from({ length: 8 }, (_, i) => repository.confirmCase(accounts[i % 2 === 0 ? 2 : 3]!, created.id)));
    const sent = await repository.getCase(author, created.id);
    expect(sent).toMatchObject({ status: 'registered', confirmationsCount: 4, submission: { requiredConfirmations: 3 } });
    expect(sent.submission.sentAt).toBeTruthy();
    expect(sent.deadline?.startedAt).toBe(sent.submission.sentAt);
    const history = await db.select().from(schema.caseStatusHistory).where(and(eq(schema.caseStatusHistory.caseId, sent.id), eq(schema.caseStatusHistory.toStatus, 'registered')));
    expect(history).toHaveLength(1);
    const audit = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, sent.id), eq(schema.auditLog.action, 'case.submitted_to_uk_demo')));
    expect(audit).toHaveLength(1);
    const nextRepository = new PostgresCaseRepository(db, new InMemoryObjectStorage(), true);
    expect((await nextRepository.getCase(accounts[20]!, sent.id)).submission.sentAt).toBe(sent.submission.sentAt);
    expect(await nextRepository.listCases(accounts[20]!)).toContainEqual(expect.objectContaining({ id: sent.id }));
    const assigned = await nextRepository.transitionCase(accounts[20]!, sent.id, { status: 'assigned', expectedVersion: sent.version, assignee: 'Мастер' });
    expect(assigned.status).toBe('assigned');
  }, 20_000);
});
