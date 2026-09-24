export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  publicBaseUrl: string;
  databaseUrl: string;
  maxApiBaseUrl: string;
  maxBotToken?: string;
  maxWebhookSecret?: string;
  maxDeliveryMode: 'webhook' | 'polling' | 'disabled';
  sessionSecret: string;
  logLevel: string;
  demoMode: boolean;
  storageMode: 'postgres' | 'memory';
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV || 'development') as AppConfig['nodeEnv'];
  const storageMode = (env.STORAGE_MODE || 'postgres') as AppConfig['storageMode'];
  const maxDeliveryMode = (env.MAX_DELIVERY_MODE || 'webhook') as AppConfig['maxDeliveryMode'];

  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV должен быть development, test или production');
  }
  if (!['postgres', 'memory'].includes(storageMode)) {
    throw new Error('STORAGE_MODE должен быть postgres или memory');
  }
  if (!['webhook', 'polling', 'disabled'].includes(maxDeliveryMode)) {
    throw new Error('MAX_DELIVERY_MODE должен быть webhook, polling или disabled');
  }

  return {
    nodeEnv,
    port: Number(env.PORT || 3000),
    publicBaseUrl: env.PUBLIC_BASE_URL || 'http://localhost:8080',
    databaseUrl: env.DATABASE_URL || 'postgres://domdelo:domdelo@localhost:5432/domdelo',
    maxApiBaseUrl: env.MAX_API_BASE_URL || 'https://platform-api2.max.ru',
    ...(env.MAX_BOT_TOKEN ? { maxBotToken: env.MAX_BOT_TOKEN } : {}),
    ...(env.MAX_WEBHOOK_SECRET ? { maxWebhookSecret: env.MAX_WEBHOOK_SECRET } : {}),
    maxDeliveryMode,
    sessionSecret: requiredInProduction(
      'SESSION_SECRET',
      env.SESSION_SECRET,
      nodeEnv,
      'development-only-session-secret-change-me',
    ),
    logLevel: env.LOG_LEVEL || 'info',
    demoMode: booleanValue(env.DEMO_MODE, true),
    storageMode,
    s3: {
      endpoint: env.S3_ENDPOINT || 'http://localhost:9000',
      region: env.S3_REGION || 'ru-1',
      bucket: env.S3_BUCKET || 'domdelo',
      accessKeyId: env.S3_ACCESS_KEY_ID || 'domdelo',
      secretAccessKey: requiredInProduction(
        'S3_SECRET_ACCESS_KEY',
        env.S3_SECRET_ACCESS_KEY,
        nodeEnv,
        'domdelo-development-secret',
      ),
      forcePathStyle: booleanValue(env.S3_FORCE_PATH_STYLE, true),
    },
  };
}
