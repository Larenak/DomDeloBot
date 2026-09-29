import { CreatePollSchema, ErrorSchema, PollSchema, VotePollSchema } from '@domdelo/contracts';
import type { CreatePollInput } from '@domdelo/contracts';
import type { FastifyInstance } from 'fastify';

export async function registerPollRoutes(app: FastifyInstance): Promise<void> {
  const secured = { preHandler: app.authenticate };

  app.get('/api/polls', {
    ...secured,
    schema: {
      tags: ['polls'],
      security: [{ bearerAuth: [] }, { demoUser: [] }],
      response: { 200: { type: 'array', items: PollSchema } },
    },
  }, async (request) => app.pollRepository.list(request.actor!));

  app.post('/api/polls', {
    ...secured,
    schema: {
      tags: ['polls'],
      security: [{ bearerAuth: [] }, { demoUser: [] }],
      body: CreatePollSchema,
      response: { 201: PollSchema, 403: ErrorSchema },
    },
  }, async (request, reply) => {
    const poll = await app.pollRepository.create(request.actor!, request.body as CreatePollInput);
    return reply.code(201).send(poll);
  });

  app.post('/api/polls/:pollId/votes', {
    ...secured,
    schema: {
      tags: ['polls'],
      security: [{ bearerAuth: [] }, { demoUser: [] }],
      params: {
        type: 'object', required: ['pollId'],
        properties: { pollId: { type: 'string', format: 'uuid' } },
      },
      body: VotePollSchema,
      response: { 200: PollSchema, 403: ErrorSchema, 409: ErrorSchema },
    },
  }, async (request) => {
    const { pollId } = request.params as { pollId: string };
    const { optionId } = request.body as { optionId: string };
    return app.pollRepository.vote(request.actor!, pollId, optionId);
  });
}
