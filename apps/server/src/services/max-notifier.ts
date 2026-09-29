import { Bot } from '@maxhub/max-bot-api';
import type { BotInfo, Update, UpdateType } from '@maxhub/max-bot-api/types';

export type BotButton =
  | { type: 'callback'; text: string; payload: string }
  | { type: 'message'; text: string }
  | { type: 'link'; text: string; url: string }
  | { type: 'open_app'; text: string; web_app: string; payload?: string };

export type BotMessageOptions = {
  buttons?: BotButton[][];
};

export interface BotNotifier {
  readonly configured: boolean;
  sendToChat(chatId: number, message: string, options?: BotMessageOptions): Promise<void>;
  sendToUser(userId: number, message: string, options?: BotMessageOptions): Promise<void>;
  answerCallback(callbackId: string, message?: string): Promise<void>;
  chatMembers(chatId: number, userIds: number[]): Promise<number[]>;
  postToChat(chatId: number, message: string): Promise<string>;
  pinChatMessage(chatId: number, messageId: string): Promise<void>;
  removeChatMember(chatId: number, userId: number): Promise<void>;
  clearMissingPin(chatId: number, messageId: string): Promise<void>;
}

export const maxUpdateTypes: UpdateType[] = ['bot_started', 'message_created', 'message_callback'];

type PollingErrorHandler = (error: unknown, update?: Update) => void;

export class MaxNotifier implements BotNotifier {
  private readonly bot?: Bot;
  private pollingStarted = false;

  constructor(token?: string, baseUrl?: string) {
    if (token) {
      this.bot = new Bot(token, {
        clientOptions: baseUrl ? { baseUrl } : {},
      });
    }
  }

  get configured(): boolean {
    return Boolean(this.bot);
  }

  private messageExtra(options?: BotMessageOptions) {
    return {
      format: 'markdown' as const,
      ...(options?.buttons
        ? {
            attachments: [
              {
                type: 'inline_keyboard' as const,
                payload: { buttons: options.buttons },
              },
            ],
          }
        : {}),
    };
  }

  async sendToChat(chatId: number, message: string, options?: BotMessageOptions): Promise<void> {
    if (!this.bot) return;
    await this.bot.api.sendMessageToChat(chatId, message, this.messageExtra(options));
  }

  async chatMembers(chatId: number, userIds: number[]): Promise<number[]> {
    if (!this.bot) throw new Error('MAX_BOT_TOKEN не настроен');
    if (!userIds.length) return [];
    const result = await this.bot.api.getChatMembers(chatId, { user_ids: userIds });
    return result.members.map((member) => member.user_id);
  }

  async postToChat(chatId: number, message: string): Promise<string> {
    if (!this.bot) throw new Error('MAX_BOT_TOKEN не настроен');
    const sent = await this.bot.api.sendMessageToChat(chatId, message, this.messageExtra());
    return sent.body.mid;
  }

  async pinChatMessage(chatId: number, messageId: string): Promise<void> {
    if (!this.bot) throw new Error('MAX_BOT_TOKEN не настроен');
    const result = await this.bot.api.pinMessage(chatId, messageId);
    if (!result.success) throw new Error(result.message || 'MAX не закрепил сообщение');
  }

  async removeChatMember(chatId: number, userId: number): Promise<void> {
    if (!this.bot) throw new Error('MAX_BOT_TOKEN не настроен');
    const result = await this.bot.api.removeChatMember(chatId, userId);
    if (!result.success) throw new Error(result.message || 'MAX не удалил участника');
  }
  async clearMissingPin(chatId: number, messageId: string): Promise<void> {
    if (!this.bot) throw new Error('MAX_BOT_TOKEN не настроен');
    const pinned = await this.bot.api.getPinnedMessage(chatId);
    if (pinned.message?.body.mid === messageId) await this.bot.api.unpinMessage(chatId);
  }
  async sendToUser(userId: number, message: string, options?: BotMessageOptions): Promise<void> {
    if (!this.bot) return;
    await this.bot.api.sendMessageToUser(userId, message, this.messageExtra(options));
  }

  async answerCallback(callbackId: string, message?: string): Promise<void> {
    if (!this.bot) return;
    await this.bot.api.answerOnCallback(callbackId, message ? { message: { text: message } } : {});
  }

  async registerWebhook(url: string, secret: string): Promise<BotInfo> {
    if (!this.bot) throw new Error('MAX_BOT_TOKEN не настроен');

    const botInfo = await this.bot.api.getMyInfo();
    const result = await this.bot.api.subscribe(url, secret, maxUpdateTypes);
    if (!result.success) {
      throw new Error(`MAX не зарегистрировал webhook: ${result.message}`);
    }
    return botInfo;
  }

  async startPolling(
    handleUpdate: (update: Update) => Promise<void>,
    handleError: PollingErrorHandler,
    options: { removeWebhookSubscriptions?: boolean } = {},
  ): Promise<BotInfo> {
    if (!this.bot) throw new Error('MAX_BOT_TOKEN не настроен');
    if (this.pollingStarted) throw new Error('MAX Long Polling уже запущен');

    this.bot.on(maxUpdateTypes, async (context) => handleUpdate(context.update));
    this.bot.catch((error, context) => handleError(error, context.update));

    const botInfo = await this.bot.api.getMyInfo();
    this.bot.botInfo = botInfo;
    const subscriptions = await this.bot.api.getSubscriptions();
    if (subscriptions.length > 0 && !options.removeWebhookSubscriptions) {
      throw new Error(
        'У бота есть активные webhook-подписки. Используйте отдельного тестового бота или явно задайте MAX_POLLING_REMOVE_WEBHOOKS=true.',
      );
    }
    for (const subscription of subscriptions) {
      await this.bot.api.unsubscribe(subscription.url);
    }

    this.pollingStarted = true;
    void this.bot
      .startPolling({ allowedUpdates: maxUpdateTypes, retry: true })
      .catch((error) => handleError(error));
    return botInfo;
  }

  stopPolling(): void {
    if (!this.pollingStarted) return;
    this.bot?.stopPolling();
    this.pollingStarted = false;
  }
}
