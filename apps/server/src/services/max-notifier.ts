import { Bot } from '@maxhub/max-bot-api';

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

export class MaxNotifier implements BotNotifier {
  private readonly bot?: Bot;

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
}
