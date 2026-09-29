import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '@domdelo/config';
import { and, eq, isNull } from 'drizzle-orm';

import { createDatabase } from './client.js';
import { houses, houseInvites, users } from './schema.js';
import { houseInviteHash } from '../modules/auth/house-invites.js';

const envFile = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(envFile)) loadEnvFile(envFile);

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const houseId = argument('--house-id');
  const maxUserIdRaw = argument('--max-user-id');
  const role = argument('--role');
  if (!process.argv.includes('--verified') ||
      !houseId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(houseId) ||
      !maxUserIdRaw || !/^[1-9][0-9]*$/u.test(maxUserIdRaw) ||
      !['resident', 'dispatcher', 'executor'].includes(role || '')) {
    throw new Error('Использование: pnpm invite:house --house-id <UUID> --max-user-id <MAX ID> --role resident|dispatcher|executor --verified');
  }

  const maxUserId = BigInt(maxUserIdRaw);
  const { client, db } = createDatabase(loadConfig());
  try {
    const code = randomBytes(32).toString('base64url');
    await db.transaction(async (tx) => {
      const [house] = await tx.select({ id: houses.id }).from(houses)
        .where(and(eq(houses.id, houseId), eq(houses.isDemo, false))).limit(1);
      if (!house) throw new Error('Рабочий дом не найден');
      const [user] = await tx.select({ id: users.id }).from(users)
        .where(eq(users.maxUserId, maxUserId)).limit(1);
      if (!user) throw new Error('Пользователь ещё не вошёл в приложение через MAX');

      const now = new Date();
      await tx.update(houseInvites).set({ expiresAt: now })
        .where(and(
          eq(houseInvites.houseId, houseId),
          eq(houseInvites.maxUserId, maxUserId),
          eq(houseInvites.role, role as 'resident' | 'dispatcher' | 'executor'),
          isNull(houseInvites.usedAt),
        ));
      await tx.insert(houseInvites).values({
        codeHash: houseInviteHash(code),
        houseId,
        maxUserId,
        role: role as 'resident' | 'dispatcher' | 'executor',
        expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1000),
      });
    });
    // The code is shown once and only its hash is stored.
    process.stdout.write('Приглашение (' + role + ', дом ' + houseId + ', 72 часа): ' + code + '\n');
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.message : 'Не удалось выпустить приглашение') + '\n');
  process.exitCode = 1;
});
