import { Bot } from '@maxhub/max-bot-api';
import type { BotInfo, Update, UpdateType } from '@maxhub/max-bot-api/types';

export type BotButton =
  | { type: 'callback'; text: string; payload: string }
  | { type: 'message'; text: string }
  | { type: 'open_app'; text: string; web_app: string };

export type BotMessageOptions = {
  buttons?: BotButton[][];
};

export interface BotNotifier {
  readonly configured: boolean;
  sendToChat(chatId: number, message: string, options?: BotMessageOptions): Promise<void>;
  sendToUser(userId: number, message: string, options?: BotMessageOptions): Promise<void>;
  answerCallback(callbackId: string, message?: string): Promise<void>;
}

const pollingUpdateTypes: UpdateType[] = ['bot_started', 'message_created', 'message_callback'];

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

  async sendToUser(userId: number, message: string, options?: BotMessageOptions): Promise<void> {
    if (!this.bot) return;
    await this.bot.api.sendMessageToUser(userId, message, this.messageExtra(options));
  }

  async answerCallback(callbackId: string, message?: string): Promise<void> {
    if (!this.bot) return;
    await this.bot.api.answerOnCallback(callbackId, message ? { message: { text: message } } : {});
  }

  async startPolling(
    handleUpdate: (update: Update) => Promise<void>,
    handleError: PollingErrorHandler,
  ): Promise<BotInfo> {
    if (!this.bot) throw new Error('MAX_BOT_TOKEN не настроен');
    if (this.pollingStarted) throw new Error('MAX Long Polling уже запущен');

    this.bot.on(pollingUpdateTypes, async (context) => handleUpdate(context.update));
    this.bot.catch((error, context) => handleError(error, context.update));

    const botInfo = await this.bot.api.getMyInfo();
    this.bot.botInfo = botInfo;
    const subscriptions = await this.bot.api.getSubscriptions();
    for (const subscription of subscriptions) {
      await this.bot.api.unsubscribe(subscription.url);
    }

    this.pollingStarted = true;
    void this.bot
      .startPolling({ allowedUpdates: pollingUpdateTypes, retry: true })
      .catch((error) => handleError(error));
    return botInfo;
  }

  stopPolling(): void {
    if (!this.pollingStarted) return;
    this.bot?.stopPolling();
    this.pollingStarted = false;
  }
}
