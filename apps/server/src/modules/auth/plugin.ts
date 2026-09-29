import type { UserRole } from '@domdelo/domain';
import type { FastifyInstance } from 'fastify';

import { demoActors } from '../../repositories/in-memory-case-repository.js';
import { createSessionToken, verifySessionToken } from './session.js';
import { validateMaxInitData } from './max-init-data.js';

const publicDemoRoles = new Set<UserRole>(['resident', 'owner', 'tenant', 'chair', 'dispatcher', 'executor', 'authority']);

export async function registerAuth(app: FastifyInstance): Promise<void> {
  app.get('/api/public-config', async () => ({
    demoMode: app.config.demoMode,
    ...(app.config.hackathonHouseId ? { demoHouseAvailable: true } : {}),
  }));

  app.decorate('authenticate', async (request, reply) => {
    const demoUser = request.headers['x-demo-user'];
    if (app.config.demoMode && typeof demoUser === 'string' && demoActors[demoUser]) {
      request.actor = await app.caseRepository.refreshActor(demoActors[demoUser]);
      return;
    }

    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const sessionActor = token ? verifySessionToken(token, app.config.sessionSecret) : null;
    if (!sessionActor) {
      await reply.code(401).send({ error: 'unauthorized', message: 'Требуется авторизация' });
      return;
    }
    request.actor = await app.caseRepository.refreshActor(sessionActor);
    const demoRole = request.headers['x-demo-role'];
    if (request.actor.isDemoHouse && request.actor.houseId === app.config.hackathonHouseId &&
      typeof demoRole === 'string' && publicDemoRoles.has(demoRole as UserRole)) {
      request.actor.role = demoRole as UserRole;
    }
  });

  app.post(
    '/api/auth/max',
    {
      schema: {
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['initData'],
          properties: { initData: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { initData: string };
      if (!app.config.maxBotToken) {
        return reply.code(503).send({
          error: 'max_not_configured',
          message: 'MAX_BOT_TOKEN не настроен',
        });
      }
      const data = validateMaxInitData(body.initData, app.config.maxBotToken);
      if (!data) {
        return reply.code(401).send({ error: 'invalid_init_data', message: 'Данные запуска MAX недействительны' });
      }
      const actor = await app.caseRepository.resolveMaxUser({
        maxUserId: BigInt(data.user.id),
        displayName: [data.user.first_name, data.user.last_name].filter(Boolean).join(' '),
        ...(data.chat ? { maxChatId: BigInt(data.chat.id) } : {}),
      });
      return {
        token: createSessionToken(actor, app.config.sessionSecret),
        actor,
      };
    },
  );

  if (app.config.demoMode) {
    app.get('/api/demo/users', async () =>
      Object.entries(demoActors).map(([key, actor]) => ({ key, ...actor })),
    );
  }
}
