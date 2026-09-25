import {
  AddHouseSchema,
  ErrorSchema,
  HouseContextSchema,
  type AddHouseInput,
} from '@domdelo/contracts';
import type { FastifyInstance } from 'fastify';

export async function registerHouseRoutes(app: FastifyInstance): Promise<void> {
  const secured = { preHandler: app.authenticate };
  const security = [{ bearerAuth: [] }, { demoUser: [] }];

  app.get(
    '/api/me/houses',
    {
      ...secured,
      schema: {
        tags: ['houses'],
        security,
        response: { 200: HouseContextSchema, 401: ErrorSchema },
      },
    },
    async (request) => app.caseRepository.getHouseContext(request.actor!),
  );

  app.post(
    '/api/me/houses',
    {
      ...secured,
      schema: {
        tags: ['houses'],
        security,
        body: AddHouseSchema,
        response: { 200: HouseContextSchema, 400: ErrorSchema, 401: ErrorSchema },
      },
    },
    async (request) =>
      app.caseRepository.addHouse(request.actor!, request.body as AddHouseInput),
  );

  app.post(
    '/api/me/houses/:houseId/select',
    {
      ...secured,
      schema: {
        tags: ['houses'],
        security,
        params: {
          type: 'object',
          required: ['houseId'],
          properties: { houseId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: HouseContextSchema, 401: ErrorSchema, 403: ErrorSchema },
      },
    },
    async (request) => {
      const { houseId } = request.params as { houseId: string };
      return app.caseRepository.selectHouse(request.actor!, houseId);
    },
  );
}
