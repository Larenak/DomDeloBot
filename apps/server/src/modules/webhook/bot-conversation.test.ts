import { loadConfig } from '@domdelo/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../app.js';
import type { BotMessageOptions, BotNotifier } from '../../services/max-notifier.js';
import { parseCaseDescription } from './bot-conversation.js';

const config = loadConfig({
  NODE_ENV: 'test',
  STORAGE_MODE: 'memory',
  DEMO_MODE: 'true',
  MAX_WEBHOOK_SECRET: 'test-webhook-secret',
  SESSION_SECRET: 'test-session-secret-with-enough-entropy',
  PUBLIC_BASE_URL: 'https://domdelo.test',
});

class RecordingNotifier implements BotNotifier {
  readonly configured = true;
  readonly messages: Array<{ target: number; text: string; options?: BotMessageOptions }> = [];
  readonly callbacks: string[] = [];

  async sendToChat(target: number, text: string, options?: BotMessageOptions): Promise<void> {
    this.messages.push({ target, text, ...(options ? { options } : {}) });
  }

  async sendToUser(target: number, text: string, options?: BotMessageOptions): Promise<void> {
    this.messages.push({ target, text, ...(options ? { options } : {}) });
  }

  async answerCallback(callbackId: string): Promise<void> {
    this.callbacks.push(callbackId);
  }
}

const openedApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

afterEach(async () => {
  await Promise.all(openedApps.splice(0).map((app) => app.close()));
  vi.unstubAllGlobals();
});

describe('MAX bot conversation', () => {
  it('extracts explainable routing fields from a resident description', () => {
    expect(
      parseCaseDescription('В подъезде №2 со вчерашнего вечера не работает освещение на втором этаже.'),
    ).toMatchObject({
      category: 'lighting',
      entrance: '2',
      place: 'Лестничная клетка',
    });
  });

  it('starts a guided case flow for a bot_started update', async () => {
    const notifier = new RecordingNotifier();
    const app = await buildApp({ config, notifier });
    openedApps.push(app);

    const webhook = (payload: object) =>
      app.inject({
        method: 'POST',
        url: '/webhooks/max',
        headers: { 'x-max-bot-api-secret': 'test-webhook-secret' },
        payload,
      });

    await webhook({
      update_type: 'bot_started',
      timestamp: 1,
      chat_id: 777,
      user: { user_id: 42, first_name: 'Анна', name: 'Анна' },
    });
    await expect.poll(() => notifier.messages.length).toBe(1);
    expect(notifier.messages[0]).toMatchObject({ target: 777 });
    expect(notifier.messages[0]?.options?.buttons?.flat().map((button) => button.text)).toContain(
      'Создать дело',
    );

    await webhook({
      update_type: 'message_created',
      message: {
        body: { mid: 'start-case', text: 'Создать дело' },
        sender: { user_id: 42, first_name: 'Анна', name: 'Анна' },
        recipient: { chat_id: 777 },
      },
    });
    await expect.poll(() => notifier.messages.length).toBe(2);
    expect(notifier.messages[1]?.text).toContain('что произошло, где и когда');

    await webhook({
      update_type: 'message_created',
      message: {
        body: {
          mid: 'description',
          text: 'В подъезде №2 со вчерашнего вечера не работает освещение на втором этаже.',
        },
        sender: { user_id: 42, first_name: 'Анна', name: 'Анна' },
        recipient: { chat_id: 777 },
      },
    });
    await expect.poll(() => notifier.messages.length).toBe(3);
    expect(notifier.messages[2]?.text).toContain('Теперь прикрепите одну фотографию');
  });

  it('offers a duplicate and joins it with the MAX photo attached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'content-length': '4' },
        })),
    );
    const notifier = new RecordingNotifier();
    const app = await buildApp({ config, notifier });
    openedApps.push(app);
    const webhook = (payload: object) =>
      app.inject({
        method: 'POST',
        url: '/webhooks/max',
        headers: { 'x-max-bot-api-secret': 'test-webhook-secret' },
        payload,
      });
    const sender = { user_id: 84, first_name: 'Михаил', name: 'Михаил' };

    await webhook({
      update_type: 'message_created',
      message: {
        body: { mid: 'create-with-photo', text: 'Создать дело' },
        sender,
        recipient: { chat_id: 777 },
      },
    });
    await expect.poll(() => notifier.messages.length).toBe(1);

    await webhook({
      update_type: 'message_created',
      message: {
        body: {
          mid: 'photo-with-caption',
          text: 'В подъезде №2 не работает освещение на втором этаже, со вчера темно.',
          attachments: [
            {
              type: 'image',
              payload: { url: 'https://cdn.max.test/problem.jpg', photo_id: 7, token: 'demo' },
            },
          ],
        },
        sender,
        recipient: { chat_id: 777 },
      },
    });
    await expect.poll(() => notifier.messages.length).toBe(2);
    expect(notifier.messages[1]?.text).toContain('Нашёл похожее открытое дело **№128**');

    await webhook({
      update_type: 'message_callback',
      callback: {
        callback_id: 'join-callback',
        payload: 'domdelo:join:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        user: sender,
      },
      message: { recipient: { chat_id: 777 } },
    });
    await expect.poll(() => notifier.messages.length).toBe(3);
    expect(notifier.callbacks).toContain('join-callback');
    expect(notifier.messages[2]?.text).toContain('Вы присоединились к делу **№128**');

    const caseResponse = await app.inject({
      method: 'GET',
      url: '/api/cases/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      headers: { 'x-demo-user': 'resident-1' },
    });
    expect(caseResponse.json().attachments).toHaveLength(1);
  });
});
