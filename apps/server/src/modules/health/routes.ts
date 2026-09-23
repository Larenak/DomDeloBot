import type { FastifyInstance } from 'fastify';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health/live', { schema: { tags: ['health'] } }, async () => ({ status: 'ok' }));
  app.get('/health/ready', { schema: { tags: ['health'] } }, async (_request, reply) => {
    try {
      await app.caseRepository.ready();
      return { status: 'ready' };
    } catch (error) {
      app.log.error({ error }, 'readiness check failed');
      return reply.code(503).send({ status: 'not_ready' });
    }
  });
}

