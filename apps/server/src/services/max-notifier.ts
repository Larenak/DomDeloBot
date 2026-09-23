import { Bot } from '@maxhub/max-bot-api';

export class MaxNotifier {
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

  async sendToChat(chatId: number, message: string): Promise<void> {
    if (!this.bot) return;
    await this.bot.api.sendMessageToChat(chatId, message, { format: 'markdown' });
  }

  async sendToUser(userId: number, message: string): Promise<void> {
    if (!this.bot) return;
    await this.bot.api.sendMessageToUser(userId, message, { format: 'markdown' });
  }
}
