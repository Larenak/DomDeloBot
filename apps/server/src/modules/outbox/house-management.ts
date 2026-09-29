import { eq, lt, or, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../../db/client.js';
import { chatBindings, chatManagementChecks, houseManagement, houses } from '../../db/schema.js';
import type { BotNotifier } from '../../services/max-notifier.js';

const day = 86_400_000;

export async function checkHouseManagement(
  db: Database, notifier: BotNotifier, logger: FastifyBaseLogger, now = new Date(),
): Promise<void> {
  if (!notifier.configured) return;
  const bindings = await db.select({
    chatId: chatBindings.maxChatId,
    address: houses.address,
    organization: houseManagement.organizationName,
    currentId: houseManagement.serviceMaxUserId,
    previousId: houseManagement.previousServiceMaxUserId,
    revision: houseManagement.revision,
    checkedAt: chatManagementChecks.checkedAt,
    announcedRevision: chatManagementChecks.announcedRevision,
    presence: chatManagementChecks.presence,
    missingNoticeId: chatManagementChecks.missingNoticeId,
    previousRemovedRevision: chatManagementChecks.previousRemovedRevision,
  }).from(chatBindings)
    .innerJoin(houses, eq(houses.id, chatBindings.houseId))
    .leftJoin(houseManagement, eq(houseManagement.houseId, houses.id))
    .leftJoin(chatManagementChecks, eq(chatManagementChecks.maxChatId, chatBindings.maxChatId))
    .where(or(isNull(chatManagementChecks.checkedAt), lt(chatManagementChecks.checkedAt, new Date(now.getTime() - day)),
      lt(chatManagementChecks.announcedRevision, houseManagement.revision),
      lt(chatManagementChecks.previousRemovedRevision, houseManagement.revision)));

  for (const binding of bindings) {
    const chatId = Number(binding.chatId);
    const revision = binding.revision ?? 0;
    try {
      const ids = [binding.currentId, binding.previousId].filter((id): id is bigint => id !== null);
      const members = await notifier.chatMembers(chatId, ids.map(Number));
      const hasCurrent = binding.currentId !== null && members.includes(Number(binding.currentId));
      const oldIsPresent = binding.previousId !== null && binding.previousId !== binding.currentId
        && members.includes(Number(binding.previousId));
      let removedRevision = binding.previousRemovedRevision ?? 0;
      if (revision > removedRevision) {
        if (oldIsPresent) await notifier.removeChatMember(chatId, Number(binding.previousId));
        removedRevision = revision;
      }

      const presence = hasCurrent ? 'present' : 'missing';
      let announcedRevision = binding.announcedRevision ?? 0;
      let missingNoticeId = binding.missingNoticeId;
      if (!hasCurrent && (binding.presence !== 'missing' || announcedRevision < revision)) {
        const message = binding.organization
          ? `По адресу ${binding.address} представитель УК «${binding.organization}» пока не присоединился к группе. Участники могут сообщать о проблемах через бот; сведения об УК проверяются ежедневно.`
          : `По адресу ${binding.address} в группе нет подтверждённого представителя УК. Участники могут сообщать о проблемах через бот; сведения об УК проверяются ежедневно.`;
        missingNoticeId = await notifier.postToChat(chatId, message);
        try { await notifier.pinChatMessage(chatId, missingNoticeId); }
        catch (error) { logger.warn({ chatId, error }, 'unable to pin missing management notice'); }
        announcedRevision = revision;
      } else if (hasCurrent && (binding.presence !== 'present' || announcedRevision < revision)) {
        await notifier.sendToChat(chatId,
          `По адресу ${binding.address} в группе теперь есть подтверждённый представитель УК «${binding.organization}».`,
        );
        announcedRevision = revision;
      }
      if (hasCurrent && missingNoticeId) {
        try {
          await notifier.clearMissingPin(chatId, missingNoticeId);
          missingNoticeId = null;
        } catch (error) {
          logger.warn({ chatId, error }, 'unable to clear missing management pin');
        }
      }
      await db.insert(chatManagementChecks).values({
        maxChatId: binding.chatId, checkedAt: now, presence, announcedRevision,
        missingNoticeId, previousRemovedRevision: removedRevision,
      }).onConflictDoUpdate({ target: chatManagementChecks.maxChatId, set: {
        checkedAt: now, presence, announcedRevision, missingNoticeId, previousRemovedRevision: removedRevision,
      } });
    } catch (error) {
      logger.warn({ chatId, error }, 'management check failed');
    }
  }
}

export function startHouseManagementWorker(db: Database, notifier: BotNotifier, logger: FastifyBaseLogger): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await checkHouseManagement(db, notifier, logger); }
    catch (error) { logger.warn({ error }, 'management check scan failed'); }
    finally { running = false; }
  };
  const timer = setInterval(() => void tick(), 60_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
