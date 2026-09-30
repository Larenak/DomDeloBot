/** Local security review: assertions capture CURRENT bugs, not desired behavior. */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@domdelo/config';
import { count, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDatabase } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { createSessionToken } from '../src/modules/auth/session.js';
import { PostgresCaseRepository } from '../src/repositories/postgres-case-repository.js';
import { PostgresObjectStorage } from '../src/services/object-storage.js';
import type { AuthenticatedActor } from '../src/types.js';
const databaseUrl = process.env.SECURITY_REVIEW_DATABASE_URL;
const secret = 'synthetic-local-review-secret-not-a-real-credential';
const houseId = randomUUID(), otherHouseId = randomUUID(), fiasId = randomUUID();
const actor = (role: AuthenticatedActor['role'], withHouse = true): AuthenticatedActor => ({
  id: randomUUID(), role, displayName: `Synthetic ${role}`, ...(withHouse ? { houseId } : {}),
});
const resident = actor('resident'), neighbour = actor('resident'), dispatcher = actor('dispatcher');
const authority = actor('authority'), newcomer = actor('resident', false);
const outsider = { ...actor('resident'), houseId: otherHouseId };
let database: ReturnType<typeof createDatabase>;
let repository: PostgresCaseRepository;
let storage: PostgresObjectStorage;
let app: Awaited<ReturnType<typeof buildApp>>;
let caseId: string;
const suggest = vi.fn(async () => []);
const notifier = { configured: false, sendToChat: vi.fn(async () => {}), sendToUser: vi.fn(async () => {}), answerCallback: vi.fn(async () => {}) };
const headers = (a: AuthenticatedActor) => ({ authorization: `Bearer ${createSessionToken(a, secret)}` });
async function upload(a: AuthenticatedActor, target: string, kind = 'problem') {
  const boundary = 'security-review-boundary';
  const payload = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.png"\r\nContent-Type: image/png\r\n\r\nnot really an image\r\n--${boundary}--\r\n`);
  return app.inject({ method: 'POST', url: `/api/cases/${target}/attachments?kind=${kind}`,
    headers: { ...headers(a), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
}
async function objectCount() { return (await database.db.select({ n: count() }).from(schema.storedObjects))[0]!.n; }
describe.skipIf(!databaseUrl)('Local security review: current behavior reproductions', () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== '127.0.0.1' || url.port !== '55439' || url.pathname !== '/domdelo_security_review') throw new Error('Dedicated local port 55439 / domdelo_security_review required');
    const config = loadConfig({ NODE_ENV: 'test', STORAGE_MODE: 'postgres', OBJECT_STORAGE_MODE: 'postgres', DEMO_MODE: 'false',
      DATABASE_URL: databaseUrl!, SESSION_SECRET: secret, MAX_BOT_TOKEN: 'synthetic-bot-token', MAX_WEBHOOK_SECRET: 'synthetic-webhook-secret', MAX_DELIVERY_MODE: 'disabled' });
    database = createDatabase(config);
    await migrate(database.db, { migrationsFolder: fileURLToPath(new URL('../../../db/migrations/generated/', import.meta.url)) });
    storage = new PostgresObjectStorage(database.db, secret);
    repository = new PostgresCaseRepository(database.db, storage, false);
    await database.db.insert(schema.houses).values([
      { id: houseId, fiasId, address: 'Synthetic private address', normalizedAddress: houseId },
      { id: otherHouseId, address: 'Other synthetic house', normalizedAddress: otherHouseId },
    ]);
    const actors = [resident, neighbour, dispatcher, authority, newcomer, outsider];
    await database.db.insert(schema.users).values(actors.map((a, i) => ({ id: a.id, displayName: a.displayName, activeHouseId: a.houseId ?? null, maxUserId: BigInt(Date.now()) + BigInt(i) })));
    await database.db.insert(schema.houseMembers).values(actors.filter(a => a.houseId).map(a => ({ houseId: a.houseId!, userId: a.id, isFavorite: true })));
    await database.db.insert(schema.houseRoleGrants).values([dispatcher, authority].map(a => ({ houseId, userId: a.id, role: a.role, source: 'synthetic_review_fixture' })));
    app = await buildApp({ config, caseRepository: repository, objectStorage: storage, notifier,
      addressProvider: { suggest, resolveHouse: async id => id === fiasId ? { fiasId, address: 'Synthetic private address', city: 'Synthetic', street: 'Test', building: '1' } : null } });
    await app.ready();
    const item = await repository.createCase(resident, { title: 'Synthetic review case', description: 'Synthetic confidential description', category: 'water', place: 'Basement' }, randomUUID());
    caseId = item.id;
    await repository.confirmCase(neighbour, caseId);
  }, 30_000);
  afterAll(async () => { await app?.close(); await database?.client.end(); });
  it('control: rejects anonymous, altered session, cross-house access, demo spoofing and bad webhook secret', async () => {
    expect((await app.inject({ url: '/api/cases' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/cases', headers: { authorization: 'Bearer invalid.signature' } })).statusCode).toBe(401);
    expect((await app.inject({ url: `/api/cases/${caseId}`, headers: headers(outsider) })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/auth/me', headers: { ...headers(resident), 'x-demo-role': 'dispatcher' } })).json().actor.role).toBe('resident');
    expect((await app.inject({ url: '/api/cases', headers: { 'x-demo-user': 'dispatcher-1' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/webhooks/max', payload: {} })).statusCode).toBe(401);
  });
  it('F1: persists orphan bytes for no house, nonexistent case, and forbidden role', async () => {
    const before = await objectCount();
    expect((await upload(newcomer, randomUUID())).statusCode).toBe(403);
    expect((await upload(resident, randomUUID())).statusCode).toBe(404);
    expect((await upload(resident, caseId, 'result')).statusCode).toBe(403);
    expect(await objectCount()).toBe(before + 3);
  });
  it('F2: authority reads full details through watchers despite forbidden GET', async () => {
    expect((await app.inject({ url: `/api/cases/${caseId}`, headers: headers(authority) })).statusCode).toBe(403);
    const watched = await app.inject({ method: 'POST', url: `/api/cases/${caseId}/watchers`, headers: headers(authority) });
    expect(watched.statusCode).toBe(200);
    expect(watched.json().description).toBe('Synthetic confidential description');
    expect(watched.json().history.some((row: { actorName: string }) => row.actorName === resident.displayName)).toBe(true);
    const unwatched = await app.inject({ method: 'DELETE', url: `/api/cases/${caseId}/watchers`, headers: headers(authority) });
    expect(unwatched.statusCode).toBe(200);
    expect(unwatched.json().description).toBe('Synthetic confidential description');
  });
  it('F2: authority writes attachments and gets signed URLs; false image MIME passes', async () => {
    const result = await upload(authority, caseId);
    expect(result.statusCode).toBe(200);
    const fetched = await app.inject({ url: result.json().attachments.at(-1).url });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.body).toBe('not really an image');
  });
  it('F3: webhook retry becomes duplicate after first processing fails', async () => {
    notifier.sendToChat.mockRejectedValueOnce(new Error('Synthetic temporary network failure'));
    const before = notifier.sendToChat.mock.calls.length;
    const update = { update_type: 'bot_started', timestamp: Date.now(), chat_id: 50001, user: { user_id: 50001, first_name: 'Synthetic' } };
    const send = () => app.inject({ method: 'POST', url: '/webhooks/max', headers: { 'x-max-bot-api-secret': 'synthetic-webhook-secret' }, payload: update });
    expect((await send()).json()).toEqual({ ok: true, duplicate: false });
    await vi.waitFor(() => expect(notifier.sendToChat.mock.calls.length).toBe(before + 1));
    expect((await send()).json()).toEqual({ ok: true, duplicate: true });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(notifier.sendToChat.mock.calls.length).toBe(before + 1);
  });
  it('F4: forwards all 25 suggestion requests without a quota response', async () => {
    suggest.mockClear();
    const results = await Promise.all(Array.from({ length: 25 }, () => app.inject({ url: '/api/addresses/suggest?q=Test', headers: headers(newcomer) })));
    expect(results.every(r => r.statusCode === 200)).toBe(true);
    expect(suggest).toHaveBeenCalledTimes(25);
  });
  it('F5: malformed URI encoding in unsigned initData causes HTTP 500', async () => {
    for (const initData of ['hash=%', `hash=${'0'.repeat(64)}&user=%`]) expect((await app.inject({ method: 'POST', url: '/api/auth/max', payload: { initData } })).statusCode).toBe(500);
  });
  it('design risk: unverified account joins real house and reads cases', async () => {
    const joined = await app.inject({ method: 'POST', url: '/api/me/houses', headers: headers(newcomer), payload: { fiasId } });
    expect(joined.statusCode).toBe(200);
    expect(joined.json().accessPending).toBe(false);
    expect((await app.inject({ url: `/api/cases/${caseId}`, headers: headers(newcomer) })).json().description).toBe('Synthetic confidential description');
  });
  it('control: revoked grant is not retained by old session', async () => {
    const oldHeaders = headers(dispatcher);
    await database.db.update(schema.houseRoleGrants).set({ revokedAt: new Date() }).where(eq(schema.houseRoleGrants.userId, dispatcher.id));
    expect((await app.inject({ url: '/api/auth/me', headers: oldHeaders })).json().actor.role).toBe('resident');
  });
});

// The browser keeps an expired session even if MAX provides fresh launch data.
describe('Browser session recovery reproduction', () => {
  it('F6: cached expired bearer prevents reauthentication after HTTP 401', async () => {
    const { initializeMaxSession, caseApi } = await import('../../web/src/api.js');
    const values = new Map([['domdelo.session', createSessionToken(resident, secret, -1)]]);
    const fetchStub = vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized', message: 'Требуется авторизация' }), {
      status: 401, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('window', { WebApp: { initData: 'fresh-launch-data-placeholder' } });
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    vi.stubGlobal('localStorage', { getItem: () => null });
    vi.stubGlobal('fetch', fetchStub);
    try {
      await initializeMaxSession();
      expect(fetchStub).not.toHaveBeenCalled();
      await expect(caseApi.list()).rejects.toMatchObject({ status: 401 });
      await initializeMaxSession();
      expect(fetchStub).toHaveBeenCalledTimes(1);
      expect(fetchStub.mock.calls[0]![0]).toBe('/api/cases');
      expect(values.has('domdelo.session')).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });
});
