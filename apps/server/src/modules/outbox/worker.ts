import { caseStatusLabels, type CaseStatus } from '@domdelo/domain';
import { and, eq, isNull, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import type { Database } from '../../db/client.js';
import { cases, chatBindings, outboxEvents } from '../../db/schema.js';
import type { BotNotifier } from '../../services/max-notifier.js';

export function startOutboxWorker(
  db: Database,
  notifier: BotNotifier,
  logger: FastifyBaseLogger,
): () => void {
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running || !notifier.configured) return;
    running = true;
    try {
      const events = await db
        .select()
        .from(outboxEvents)
        .where(and(isNull(outboxEvents.processedAt), lte(outboxEvents.availableAt, new Date())))
        .limit(20);
      for (const event of events) {
        try {
          const [target] = await db
            .select({ chatId: chatBindings.maxChatId, caseNumber: cases.number })
            .from(cases)
            .innerJoin(chatBindings, eq(cases.houseId, chatBindings.houseId))
            .where(eq(cases.id, event.aggregateId))
            .limit(1);
          if (!target) throw new Error('Для дома не настроен чат MAX');
          const payload = event.payload as { toStatus?: CaseStatus };
          const message = payload.toStatus
            ? `**Дело №${target.caseNumber}**\nНовый статус: ${caseStatusLabels[payload.toStatus]}`
            : `**Дело №${target.caseNumber} зарегистрировано**\nОткройте мини-приложение, чтобы посмотреть детали.`;
          await notifier.sendToChat(Number(target.chatId), message);
          await db
            .update(outboxEvents)
            .set({ processedAt: new Date(), lastError: null })
            .where(eq(outboxEvents.id, event.id));
        } catch (error) {
          const attempts = event.attempts + 1;
          const delaySeconds = Math.min(3600, 30 * 2 ** Math.min(attempts, 7));
          await db
            .update(outboxEvents)
            .set({
              attempts,
              availableAt: new Date(Date.now() + delaySeconds * 1000),
              lastError: error instanceof Error ? error.message.slice(0, 500) : 'unknown error',
            })
            .where(eq(outboxEvents.id, event.id));
          logger.warn({ eventId: event.id, attempts }, 'outbox delivery failed');
        }
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), 5_000);
  timer.unref();
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
