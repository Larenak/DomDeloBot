import type { FastifyInstance } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';

import type { MaxNotifier } from '../../services/max-notifier.js';

type MaxUpdate = {
  update_type?: string;
  timestamp?: number;
  message?: {
    body?: { mid?: string; text?: string };
    sender?: { user_id?: number };
    recipient?: { chat_id?: number };
  };
};

function sameSecret(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function eventId(update: MaxUpdate): string {
  if (update.message?.body?.mid) return `${update.update_type || 'unknown'}:${update.message.body.mid}`;
  return createHash('sha256').update(JSON.stringify(update)).digest('hex');
}

async function processUpdate(update: MaxUpdate, notifier: MaxNotifier): Promise<void> {
  const text = update.message?.body?.text?.trim().toLocaleLowerCase('ru-RU');
  const userId = update.message?.sender?.user_id;
  if (!userId) return;

  if (update.update_type === 'bot_started' || text === '/start') {
    await notifier.sendToUser(
      userId,
      '**ДомДело** превращает сообщение о проблеме в доме в прозрачное коллективное дело.\n\nНапишите «Создать дело», чтобы начать.',
    );
  } else if (text === 'создать дело') {
    await notifier.sendToUser(
      userId,
      'Опишите проблему одним сообщением: что произошло и где. Затем прикрепите фотографию.',
    );
  }
}

export async function registerWebhookRoutes(
  app: FastifyInstance,
  notifier: MaxNotifier,
): Promise<void> {
  app.post(
    '/webhooks/max',
    {
      schema: {
        tags: ['MAX webhook'],
        headers: {
          type: 'object',
          properties: { 'x-max-bot-api-secret': { type: 'string' } },
        },
        body: { type: 'object', additionalProperties: true },
        response: {
          200: {
            type: 'object',
            required: ['ok', 'duplicate'],
            properties: { ok: { type: 'boolean' }, duplicate: { type: 'boolean' } },
          },
          401: {
            type: 'object',
            required: ['error', 'message'],
            properties: { error: { type: 'string' }, message: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const expectedSecret = app.config.maxWebhookSecret;
      const actualSecret = request.headers['x-max-bot-api-secret'];
      if (!expectedSecret || !sameSecret(typeof actualSecret === 'string' ? actualSecret : undefined, expectedSecret)) {
        return reply.code(401).send({ error: 'invalid_webhook_secret', message: 'Неверный секрет webhook' });
      }

      const update = request.body as MaxUpdate;
      const id = eventId(update);
      const inserted = await app.caseRepository.saveWebhookEvent(
        id,
        update.update_type || 'unknown',
        update,
      );
      if (inserted) {
        setImmediate(() => {
          void processUpdate(update, notifier).catch((error) =>
            app.log.error({ error, eventId: id }, 'MAX update processing failed'),
          );
        });
      }
      return { ok: true, duplicate: !inserted };
    },
  );
}
