import { loadConfig } from '@domdelo/config';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';

const config = loadConfig({
  NODE_ENV: 'test', STORAGE_MODE: 'memory', DEMO_MODE: 'true',
  SESSION_SECRET: 'test-session-secret-with-enough-entropy',
});
const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('сводка УК и органов', () => {
  it('returns only aggregates to an authority', async () => {
    const app = await buildApp({ config });
    apps.push(app);
    const report = await app.inject({
      method: 'GET', url: '/api/reports/house', headers: { 'x-demo-user': 'authority-1' },
    });
    expect(report.statusCode).toBe(200);
    expect(report.json()).toMatchObject({
      totalCases: 2, openCases: 2, source: 'domdelo_internal',
    });
    expect(report.body).not.toContain('Анна Петрова');
    const cases = await app.inject({
      method: 'GET', url: '/api/cases', headers: { 'x-demo-user': 'authority-1' },
    });
    expect(cases.statusCode).toBe(403);
    const caseDetail = await app.inject({
      method: 'GET', url: '/api/cases/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      headers: { 'x-demo-user': 'authority-1' },
    });
    expect(caseDetail.statusCode).toBe(403);
    const duplicates = await app.inject({
      method: 'POST', url: '/api/cases/deduplication',
      headers: { 'x-demo-user': 'authority-1' },
      payload: { category: 'lighting', place: 'Лестничная клетка', description: 'Нет света в подъезде' },
    });
    expect(duplicates.statusCode).toBe(403);
    const residentReport = await app.inject({
      method: 'GET', url: '/api/reports/house', headers: { 'x-demo-user': 'resident-1' },
    });
    expect(residentReport.statusCode).toBe(403);
  });
});
