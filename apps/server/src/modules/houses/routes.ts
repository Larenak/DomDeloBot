import {
  AddHouseSchema,
  AddressSuggestionSchema,
  ErrorSchema,
  HouseContextSchema,
  type AddHouseInput,
} from '@domdelo/contracts';
import type { FastifyInstance } from 'fastify';
import type { AddressProvider } from '../../services/address-provider.js';
import { DEMO_HOUSE_ID } from '../../repositories/in-memory-case-repository.js';

export async function registerHouseRoutes(app: FastifyInstance, addressProvider: AddressProvider): Promise<void> {
  const secured = { preHandler: app.authenticate };
  const security = [{ bearerAuth: [] }, { demoUser: [] }];

  app.get(
    '/api/addresses/suggest',
    {
      ...secured,
      schema: {
        tags: ['houses'],
        security,
        querystring: {
          type: 'object', required: ['q'],
          properties: { q: { type: 'string', minLength: 2, maxLength: 200 } },
        },
        response: { 200: { type: 'array', items: AddressSuggestionSchema }, 401: ErrorSchema },
      },
    },
    async (request) => {
      const { q } = request.query as { q: string };
      return addressProvider.suggest(q.trim());
    },
  );

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
        response: { 200: HouseContextSchema, 400: ErrorSchema, 401: ErrorSchema, 422: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { fiasId } = request.body as AddHouseInput;
      const verified = await addressProvider.resolveHouse(fiasId);
      if (!verified) {
        return reply.code(422).send({
          error: 'address_not_found',
          message: 'Выберите существующий дом из подсказок. Если адрес больше неактуален, попробуйте другой.',
        });
      }
      return app.caseRepository.addHouse(request.actor!, verified);
    },
  );

  app.post(
    '/api/me/houses/demo',
    {
      ...secured,
      schema: {
        tags: ['houses'],
        security,
        response: { 200: HouseContextSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const houseId = app.config.hackathonHouseId ||
        (app.config.demoMode && app.config.storageMode === 'memory' ? DEMO_HOUSE_ID : undefined);
      if (!houseId) {
        return reply.code(404).send({ error: 'not_found', message: 'Демонстрационный дом не настроен' });
      }
      return app.caseRepository.joinDemoHouse(request.actor!, houseId);
    },
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

  app.delete(
    '/api/me/houses/:houseId',
    {
      ...secured,
      schema: {
        tags: ['houses'], security,
        params: {
          type: 'object', required: ['houseId'],
          properties: { houseId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: HouseContextSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request) => {
      const { houseId } = request.params as { houseId: string };
      return app.caseRepository.removeHouse(request.actor!, houseId);
    },
  );
}
