import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@domdelo/config';
import { Bot } from '@maxhub/max-bot-api';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { createDatabase } from './client.js';
import { chatBindings, houseManagement, houseRoleGrants, houses, users } from './schema.js';

const envFile = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(envFile)) loadEnvFile(envFile);
const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const action = process.argv[2];
const houseId = arg('--house-id');
const chatIdRaw = arg('--chat-id');
const userIdRaw = arg('--service-max-user-id');
const name = arg('--uk-name')?.trim();
const none = process.argv.includes('--none');
const verified = process.argv.includes('--verified');
const safeMaxId = (value: string | undefined) => value !== undefined && /^[1-9][0-9]*$/u.test(value) && Number.isSafeInteger(Number(value));
if (!verified || !houseId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(houseId) ||
    !['bind', 'management'].includes(action || '') ||
    (action === 'bind' && (!safeMaxId(chatIdRaw))) ||
    (action === 'management' && !none && (!name || !safeMaxId(userIdRaw)))) {
  throw new Error('Использование: house:chat bind --house-id UUID --chat-id MAX_ID --verified; house:chat management --house-id UUID --uk-name НАЗВАНИЕ --service-max-user-id MAX_ID --verified; или --none --verified');
}
const config = loadConfig();
const { client, db } = createDatabase(config);
try {
  const [house] = await db.select({ id: houses.id, isDemo: houses.isDemo }).from(houses).where(eq(houses.id, houseId)).limit(1);
  if (!house || house.isDemo) throw new Error('Нужен существующий недемонстрационный дом');
  if (action === 'bind') {
    if (!config.maxBotToken) throw new Error('MAX_BOT_TOKEN не настроен');
    const bot = new Bot(config.maxBotToken, {
      clientOptions: config.maxApiBaseUrl ? { baseUrl: config.maxApiBaseUrl } : {},
    });
    const chat = await bot.api.getChat(Number(chatIdRaw));
    if (chat.type !== 'chat') throw new Error('Можно привязать только групповой чат MAX');
    await bot.api.getChatMembership(Number(chatIdRaw));
    const chatId = BigInt(chatIdRaw!);
    const [existing] = await db.select().from(chatBindings).where(eq(chatBindings.maxChatId, chatId)).limit(1);
    if (existing && existing.houseId !== houseId) throw new Error('Чат уже привязан к другому дому');
    if (!existing) await db.insert(chatBindings).values({ houseId, maxChatId: chatId });
    console.info('Чат привязан к дому. Проверьте, что бот добавлен в группу.');
  } else {
    const currentId = none ? null : BigInt(userIdRaw!);
    await db.transaction(async (tx) => {
      const [previous] = await tx.select().from(houseManagement).where(eq(houseManagement.houseId, houseId)).limit(1);
      if (previous?.organizationName === (none ? null : name) && previous?.serviceMaxUserId === currentId) return;
      const oldId = previous?.serviceMaxUserId ?? null;
      if (oldId && oldId !== currentId) {
        const [oldUser] = await tx.select({ id: users.id }).from(users).where(eq(users.maxUserId, oldId)).limit(1);
        if (oldUser) await tx.update(houseRoleGrants).set({ revokedAt: new Date() }).where(and(
          eq(houseRoleGrants.houseId, houseId), eq(houseRoleGrants.userId, oldUser.id),
          inArray(houseRoleGrants.role, ['dispatcher', 'executor']),
          isNull(houseRoleGrants.revokedAt),
        ));
      }
      await tx.insert(houseManagement).values({
        houseId, organizationName: none ? null : name!, serviceMaxUserId: currentId,
        previousServiceMaxUserId: oldId === currentId ? null : oldId,
        revision: (previous?.revision ?? 0) + 1, verifiedAt: new Date(),
      }).onConflictDoUpdate({ target: houseManagement.houseId, set: {
        organizationName: none ? null : name!, serviceMaxUserId: currentId,
        previousServiceMaxUserId: oldId === currentId ? null : oldId,
        revision: (previous?.revision ?? 0) + 1, verifiedAt: new Date(),
      } });
    });
    console.info('Проверенные сведения об УК сохранены. Бот сверит участника группы при следующей проверке.');
  }
} finally { await client.end(); }
