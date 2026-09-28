import { loadConfig } from '@domdelo/config';

import { buildApp } from './app.js';
import { BotConversationService, type MaxUpdate } from './modules/webhook/bot-conversation.js';
import { maxEventId } from './modules/webhook/routes.js';
import { MaxNotifier, maxUpdateTypes } from './services/max-notifier.js';

const config = loadConfig();
const notifier = new MaxNotifier(config.maxBotToken, config.maxApiBaseUrl);
const app = await buildApp({ config, notifier });

const close = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  notifier.stopPolling();
  await app.close();
  process.exit(0);
};

process.on('SIGINT', () => void close('SIGINT'));
process.on('SIGTERM', () => void close('SIGTERM'));

try {
  await app.listen({ host: '0.0.0.0', port: config.port });
  if (config.maxDeliveryMode === 'webhook') {
    if (config.maxBotToken && config.maxWebhookSecret) {
      const webhookUrl = new URL('/webhooks/max', config.publicBaseUrl).toString();
      try {
        const botInfo = await notifier.registerWebhook(webhookUrl, config.maxWebhookSecret);
        app.log.info(
          { botId: botInfo.user_id, username: botInfo.username, webhookUrl, updateTypes: maxUpdateTypes },
          'MAX webhook subscription registered',
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const safeMessage = [config.maxBotToken, config.maxWebhookSecret].filter(Boolean).reduce(
          (message, secret) => message.replaceAll(secret!, '[redacted]'),
          errorMessage,
        );
        app.log.error({ message: safeMessage, webhookUrl }, 'MAX webhook subscription registration failed');
      }
    } else {
      app.log.warn('MAX webhook subscription skipped: MAX_BOT_TOKEN or MAX_WEBHOOK_SECRET is not configured');
    }
  }
  if (config.maxDeliveryMode === 'polling') {
    const conversations = new BotConversationService(app, notifier);
    const botInfo = await notifier.startPolling(
      async (rawUpdate) => {
        const update = rawUpdate as MaxUpdate;
        const id = maxEventId(update);
        const inserted = await app.caseRepository.saveWebhookEvent(
          id,
          update.update_type || 'unknown',
          update,
        );
        if (inserted) await conversations.handle(update);
      },
      (error, update) =>
        app.log.error(
          { error, updateType: update?.update_type },
          'MAX Long Polling update failed',
        ),
      { removeWebhookSubscriptions: config.maxPollingRemoveWebhookSubscriptions },
    );
    app.log.info(
      { botId: botInfo.user_id, username: botInfo.username },
      'MAX Long Polling started',
    );
  }
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
