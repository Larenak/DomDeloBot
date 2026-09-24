import { loadConfig } from '@domdelo/config';

import { buildApp } from './app.js';
import { BotConversationService, type MaxUpdate } from './modules/webhook/bot-conversation.js';
import { maxEventId } from './modules/webhook/routes.js';
import { MaxNotifier } from './services/max-notifier.js';

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
