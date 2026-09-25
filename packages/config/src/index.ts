export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  publicBaseUrl: string;
  maxMiniAppUrl?: string;
  maxMiniAppBotUsername?: string;
  databaseUrl: string;
  maxApiBaseUrl: string;
  maxBotToken?: string;
  maxWebhookSecret?: string;
  maxDeliveryMode: 'webhook' | 'polling' | 'disabled';
  maxPollingRemoveWebhookSubscriptions: boolean;
  sessionSecret: string;
  logLevel: string;
  demoMode: boolean;
  storageMode: 'postgres' | 'memory';
  objectStorageMode: 's3' | 'postgres' | 'memory';
  serveWeb: boolean;
  hackathonHouseId?: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
};

function booleanValue(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') return defaultValue;
  return value.toLowerCase() === 'true';
}

function requiredInProduction(
  name: string,
  value: string | undefined,
  nodeEnv: AppConfig['nodeEnv'],
  fallback: string,
): string {
  if (nodeEnv === 'production' && !value) {
    throw new Error(`Переменная окружения ${name} обязательна в production`);
  }
  return value || fallback;
}

function normalizedBaseUrl(name: string, value: string, httpsOnly = false): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Переменная окружения ${name} должна содержать корректный URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || (httpsOnly && url.protocol !== 'https:')) {
    throw new Error(
      httpsOnly
        ? `Переменная окружения ${name} должна начинаться с https://`
        : `Переменная окружения ${name} должна начинаться с http:// или https://`,
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`Переменная окружения ${name} не должна содержать логин, query-параметры или hash`);
  }
  if (httpsOnly && value.length > 1024) {
    throw new Error(`Переменная окружения ${name} не должна быть длиннее 1024 символов`);
  }
  if (
    httpsOnly &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLocaleLowerCase('en-US'))
  ) {
    throw new Error(
      `Переменная окружения ${name} должна содержать публичный HTTPS-адрес; для локальной разработки используйте pnpm dev:max`,
    );
  }
  return url.toString().replace(/\/$/u, '');
}

function normalizedBotUsername(value: string | undefined): string | undefined {
  const username = value?.trim().replace(/^@/u, '');
  if (!username) return undefined;
  if (!/^[a-z0-9_]{3,64}$/iu.test(username)) {
    throw new Error(
      'Переменная окружения MAX_MINI_APP_BOT_USERNAME должна содержать username бота без ссылки',
    );
  }
  return username;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV || 'development') as AppConfig['nodeEnv'];
  const storageMode = (env.STORAGE_MODE || 'postgres') as AppConfig['storageMode'];
  const objectStorageMode = (env.OBJECT_STORAGE_MODE || (storageMode === 'memory' ? 'memory' : 's3')) as AppConfig['objectStorageMode'];
  const maxDeliveryMode = (env.MAX_DELIVERY_MODE || 'webhook') as AppConfig['maxDeliveryMode'];

  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV должен быть development, test или production');
  }
  if (!['postgres', 'memory'].includes(storageMode)) {
    throw new Error('STORAGE_MODE должен быть postgres или memory');
  }
  if (!['s3', 'postgres', 'memory'].includes(objectStorageMode)) {
    throw new Error('OBJECT_STORAGE_MODE должен быть s3, postgres или memory');
  }
  if (objectStorageMode === 'postgres' && storageMode !== 'postgres') {
    throw new Error('OBJECT_STORAGE_MODE=postgres требует STORAGE_MODE=postgres');
  }
  if (!['webhook', 'polling', 'disabled'].includes(maxDeliveryMode)) {
    throw new Error('MAX_DELIVERY_MODE должен быть webhook, polling или disabled');
  }

  const publicBaseUrl = normalizedBaseUrl(
    'PUBLIC_BASE_URL',
    env.PUBLIC_BASE_URL || 'http://localhost:8080',
  );
  const explicitMiniAppUrl = env.MAX_MINI_APP_URL?.trim();
  const miniAppUrlCandidate =
    explicitMiniAppUrl || (publicBaseUrl.startsWith('https://') ? publicBaseUrl : undefined);
  const maxMiniAppUrl = miniAppUrlCandidate
    ? normalizedBaseUrl('MAX_MINI_APP_URL', miniAppUrlCandidate, true)
    : undefined;
  const maxMiniAppBotUsername = normalizedBotUsername(env.MAX_MINI_APP_BOT_USERNAME);
  const hackathonHouseId = env.HACKATHON_HOUSE_ID?.trim();
  if (hackathonHouseId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(hackathonHouseId)) {
    throw new Error('HACKATHON_HOUSE_ID должен быть UUID');
  }

  return {
    nodeEnv,
    port: Number(env.PORT || 3000),
    publicBaseUrl,
    ...(maxMiniAppUrl ? { maxMiniAppUrl } : {}),
    ...(maxMiniAppBotUsername ? { maxMiniAppBotUsername } : {}),
    databaseUrl: env.DATABASE_URL || 'postgres://domdelo:domdelo@localhost:5432/domdelo',
    maxApiBaseUrl: env.MAX_API_BASE_URL || 'https://platform-api2.max.ru',
    ...(env.MAX_BOT_TOKEN ? { maxBotToken: env.MAX_BOT_TOKEN } : {}),
    ...(env.MAX_WEBHOOK_SECRET ? { maxWebhookSecret: env.MAX_WEBHOOK_SECRET } : {}),
    maxDeliveryMode,
    maxPollingRemoveWebhookSubscriptions: booleanValue(
      env.MAX_POLLING_REMOVE_WEBHOOKS,
      false,
    ),
    sessionSecret: requiredInProduction(
      'SESSION_SECRET',
      env.SESSION_SECRET,
      nodeEnv,
      'development-only-session-secret-change-me',
    ),
    logLevel: env.LOG_LEVEL || 'info',
    demoMode: booleanValue(env.DEMO_MODE, nodeEnv !== 'production'),
    storageMode,
    objectStorageMode,
    serveWeb: booleanValue(env.SERVE_WEB, false),
    ...(hackathonHouseId ? { hackathonHouseId } : {}),
    s3: {
      endpoint: env.S3_ENDPOINT || 'http://localhost:9000',
      region: env.S3_REGION || 'ru-1',
      bucket: env.S3_BUCKET || 'domdelo',
      accessKeyId: env.S3_ACCESS_KEY_ID || 'domdelo',
      secretAccessKey: objectStorageMode === 's3'
        ? requiredInProduction('S3_SECRET_ACCESS_KEY', env.S3_SECRET_ACCESS_KEY, nodeEnv, 'domdelo-development-secret')
        : env.S3_SECRET_ACCESS_KEY || 'unused',
      forcePathStyle: booleanValue(env.S3_FORCE_PATH_STYLE, true),
    },
  };
}
