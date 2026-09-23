import type { FastifyInstance } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';

import type { BotNotifier } from '../../services/max-notifier.js';
import { BotConversationService, type MaxUpdate } from './bot-conversation.js';

function sameSecret(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function eventId(update: MaxUpdate): string {
  if (update.callback?.callback_id) return `${update.update_type || 'callback'}:${update.callback.callback_id}`;
  if (update.message?.body?.mid) return `${update.update_type || 'unknown'}:${update.message.body.mid}`;
  return createHash('sha256').update(JSON.stringify(update)).digest('hex');
}

export async function registerWebhookRoutes(
  app: FastifyInstance,
  notifier: BotNotifier,
): Promise<void> {
  const conversations = new BotConversationService(app, notifier);
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
          void conversations.handle(update).catch((error) =>
            app.log.error({ error, eventId: id }, 'MAX update processing failed'),
          );
        });
      }
      return { ok: true, duplicate: !inserted };
    },
  );
}
