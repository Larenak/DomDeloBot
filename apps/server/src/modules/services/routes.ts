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
    if (house.isDemo) return {
      houseId: house.id,
      isDemo: true,
      management: {
        status: 'found' as const, name: 'УК «Наш дом»', managementType: 'УО',
        sourceUrl: '', snapshotDate: 'Учебный пример',
      },
      overhaul: {
        status: 'found' as const, sourceUrl: '', fundingMethod: 'Счёт регионального оператора',
        contributionRubPerSqM: 12.5,
        works: [
          { type: 'Ремонт крыши', plannedYear: '2028' },
          { type: 'Ремонт внутридомовой системы водоснабжения', plannedYear: '2029' },
          { type: 'Ремонт фасада', plannedYear: '2031' },
        ],
      },
    };
    return provider.get(house.id, house.fiasId);
  });
}

