import { eq, lt, or, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../../db/client.js';
import { chatBindings, chatManagementChecks, houseManagement, houses } from '../../db/schema.js';
import type { BotNotifier } from '../../services/max-notifier.js';

const day = 86_400_000;
const denied = (error: unknown) => typeof error === 'object' && error !== null
  && 'status' in error && error.status === 403;

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
    actionNoticeKey: chatManagementChecks.actionNoticeKey,
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
    const save = async (state: Partial<typeof chatManagementChecks.$inferInsert>) => {
      await db.insert(chatManagementChecks).values({ maxChatId: binding.chatId, ...state })
        .onConflictDoUpdate({ target: chatManagementChecks.maxChatId, set: state });
    };
    let noticeKey = binding.actionNoticeKey ?? null;
    const notifyAction = async (key: string, message: string) => {
      if (noticeKey === key) return;
      await notifier.sendToChat(chatId, message);
      await save({ actionNoticeKey: key });
      noticeKey = key;
    };
    try {
      let announcedRevision = binding.announcedRevision ?? 0;
      const changed = revision > announcedRevision;
      // Announce a verified management change even if membership or removal fails.
      if (changed && binding.organization) {
        const message = revision > 1
          ? `В доме по адресу ${binding.address} сменилась управляющая компания. Новая УК — «${binding.organization}».`
          : `Для дома по адресу ${binding.address} подтверждена актуальная УК — «${binding.organization}».`;
        await notifier.sendToChat(chatId, message);
        announcedRevision = revision;
        await save({ announcedRevision });
      }

      const ids = [binding.currentId, binding.previousId].filter((id): id is bigint => id !== null);
      let access: Awaited<ReturnType<BotNotifier['chatAdminAccess']>> | undefined;
      try {
        access = ids.length ? await notifier.chatAdminAccess(chatId) : undefined;
      } catch (error) {
        if (denied(error)) {
          await notifyAction(`${revision}:access-denied`,
            `Предупреждение для дома по адресу ${binding.address}: MAX не разрешил проверить права бота. Администратору группы нужно проверить назначение бота и право удаления участников. Представителя новой УК пригласите вручную.`);
        }
        throw error;
      }
      let members: number[];
      try {
        members = await notifier.chatMembers(chatId, ids.map(Number));
      } catch (error) {
        if (denied(error)) {
          await notifyAction(`${revision}:members-denied`,
            `Предупреждение для дома по адресу ${binding.address}: ${access?.isAdmin === false ? 'у бота нет прав администратора и' : 'у бота'} нет доступа к списку участников. Администратору группы нужно проверить права бота и состав представителей УК. Нового представителя УК пригласите вручную.`);
        }
        throw error;
      }
      const hasCurrent = binding.currentId !== null && members.includes(Number(binding.currentId));
      const oldIsPresent = binding.previousId !== null && binding.previousId !== binding.currentId
        && members.includes(Number(binding.previousId));
      let removedRevision = binding.previousRemovedRevision ?? 0;
      let removalFailure = false;
      if (revision > removedRevision) {
        if (!oldIsPresent) {
          removedRevision = revision;
        } else if (access?.canRemoveMembers) {
          try {
            await notifier.removeChatMember(chatId, Number(binding.previousId));
            removedRevision = revision;
          } catch (error) {
            removalFailure = true;
            logger.warn({ chatId, error }, 'management account removal failed');
          }
        }
      }

      const needsRemoval = oldIsPresent && revision > removedRevision;
      const needsInvitation = binding.currentId !== null && !hasCurrent;
      const permissionReason = (needsRemoval || needsInvitation) && access && !access.isAdmin
        ? 'not-admin'
        : needsRemoval && !access?.canRemoveMembers ? 'cannot-remove' : null;
      if (permissionReason || needsInvitation || removalFailure) {
        const lines = [`Предупреждение для дома по адресу ${binding.address}.`];
        if (permissionReason === 'not-admin') lines.push('У бота нет прав администратора в этой группе.');
        if (needsRemoval) {
          lines.push(permissionReason
            ? `Не могу удалить служебный аккаунт прежней УК (MAX ID ${binding.previousId}). Назначьте бота администратором с правом удаления участников или удалите этот аккаунт вручную.`
            : `Не удалось удалить служебный аккаунт прежней УК (MAX ID ${binding.previousId}). Администратору нужно проверить права бота или удалить этот аккаунт вручную.`);
        }
        if (needsInvitation) {
          lines.push(`Представителя актуальной УК «${binding.organization}» (MAX ID ${binding.currentId}) пока нет в группе. Администратору нужно пригласить его вручную: API MAX не поддерживает добавление участников ботом.`);
        }
        await notifyAction(`${revision}:${permissionReason ?? 'admin'}:${needsRemoval}:${needsInvitation}:${removalFailure}`, lines.join('\n'));
      } else {
        noticeKey = null;
      }

      const presence = hasCurrent ? 'present' : 'missing';
      let missingNoticeId = binding.missingNoticeId;
      if (!hasCurrent && (binding.presence !== 'missing' || changed)) {
        const message = binding.organization
          ? `По адресу ${binding.address} представитель УК «${binding.organization}» пока не присоединился к группе. Участники могут сообщать о проблемах через бот; сведения об УК проверяются ежедневно.`
          : `По адресу ${binding.address} в группе нет подтверждённого представителя УК. Участники могут сообщать о проблемах через бот; сведения об УК проверяются ежедневно.`;
        missingNoticeId = await notifier.postToChat(chatId, message);
        try { await notifier.pinChatMessage(chatId, missingNoticeId); }
        catch (error) { logger.warn({ chatId, error }, 'unable to pin missing management notice'); }
        announcedRevision = revision;
      } else if (hasCurrent && binding.presence !== 'present' && !changed) {
        await notifier.sendToChat(chatId,
          `По адресу ${binding.address} в группу присоединился подтверждённый представитель УК «${binding.organization}».`,
        );
      }
      if (hasCurrent && missingNoticeId) {
        try {
          await notifier.clearMissingPin(chatId, missingNoticeId);
          missingNoticeId = null;
        } catch (error) {
          logger.warn({ chatId, error }, 'unable to clear missing management pin');
        }
      }
      await save({ checkedAt: now, presence, announcedRevision, missingNoticeId,
        previousRemovedRevision: removedRevision, actionNoticeKey: noticeKey });
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
