import { loadConfig } from '@domdelo/config';
import { userRoles } from '@domdelo/domain';
import { expect, it } from 'vitest';
import { buildApp } from '../../app.js';

it('removes owner and tenant users from application and bot roles', async () => {
  const app = await buildApp({ config: loadConfig({
    NODE_ENV: 'test', STORAGE_MODE: 'memory', DEMO_MODE: 'true',
    SESSION_SECRET: 'test-session-secret-with-enough-entropy',
  }) });
  try {
    const users = await app.inject({ method: 'GET', url: '/api/demo/users' });
    expect(users.statusCode).toBe(200);
    expect(users.json().map((user: { key: string }) => user.key)).not.toContain('owner-1');
    expect(users.json().map((user: { key: string }) => user.key)).not.toContain('tenant-1');
    for (const key of ['owner-1', 'tenant-1']) {
      const login = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { 'x-demo-user': key } });
      expect(login.statusCode).toBe(401);
    }
    expect(userRoles).not.toContain('owner');
    expect(userRoles).not.toContain('tenant');
    const botActor = await app.caseRepository.resolveMaxUser({ maxUserId: 98765n, displayName: 'Житель' });
    expect(botActor.role).toBe('resident');
  } finally {
    await app.close();
  }
});
