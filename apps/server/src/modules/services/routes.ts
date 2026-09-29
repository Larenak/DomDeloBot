import { ErrorSchema, PublicHousingDataSchema } from '@domdelo/contracts';
import type { FastifyInstance } from 'fastify';
import { PublicHousingDataProvider } from '../../services/public-housing-data.js';

export async function registerServiceRoutes(
  app: FastifyInstance,
  provider: Pick<PublicHousingDataProvider, 'get'>,
): Promise<void> {
  app.get('/api/services/house', {
    preHandler: app.authenticate,
    schema: {
      tags: ['services'],
      security: [{ bearerAuth: [] }, { demoUser: [] }],
      response: { 200: PublicHousingDataSchema, 401: ErrorSchema, 403: ErrorSchema },
    },
  }, async (request, reply) => {
    const context = await app.caseRepository.getHouseContext(request.actor!);
    const house = context.houses.find((item) => item.id === context.activeHouseId);
    if (!house) return reply.code(403).send({
      error: 'house_required',
      message: 'Выберите дом, чтобы увидеть сведения об услугах.',
    });
    return provider.get(house.id, house.fiasId);
  });
}

