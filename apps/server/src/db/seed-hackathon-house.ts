import { loadConfig } from '@domdelo/config';

import { createDatabase } from './client.js';
import { houses } from './schema.js';

const config = loadConfig();
if (config.hackathonHouseId) {
  const { client, db } = createDatabase(config);
  try {
    await db.insert(houses).values({
      id: config.hackathonHouseId,
      address: process.env.HACKATHON_HOUSE_ADDRESS || 'Демонстрационный дом',
      normalizedAddress: `legacy|${config.hackathonHouseId}`,
      isDemo: true,
    }).onConflictDoNothing();
  } finally {
    await client.end();
  }
}
