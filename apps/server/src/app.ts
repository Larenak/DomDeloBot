import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { AppConfig } from '@domdelo/config';
import Fastify from 'fastify';

import { createDatabase } from './db/client.js';
import { registerAuth } from './modules/auth/plugin.js';
import { registerCaseRoutes } from './modules/cases/routes.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import { startOutboxWorker } from './modules/outbox/worker.js';
import { registerWebhookRoutes } from './modules/webhook/routes.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type CaseRepository,
} from './repositories/case-repository.js';
import { InMemoryCaseRepository } from './repositories/in-memory-case-repository.js';
import { PostgresCaseRepository } from './repositories/postgres-case-repository.js';
import { MaxNotifier, type BotNotifier } from './services/max-notifier.js';
import {
  InMemoryObjectStorage,
  S3ObjectStorage,
  type ObjectStorage,
} from './services/object-storage.js';
import './types.js';

type BuildAppOptions = {
  config: AppConfig;
  caseRepository?: CaseRepository;
  objectStorage?: ObjectStorage;
  notifier?: BotNotifier;
};

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    logger: options.config.nodeEnv === 'test' ? false : { level: options.config.logLevel },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });
  app.decorate('config', options.config);

  const objectStorage =
    options.objectStorage ||
    (options.config.storageMode === 'memory'
      ? new InMemoryObjectStorage()
      : new S3ObjectStorage(options.config));
  app.decorate('objectStorage', objectStorage);

  const notifier = options.notifier || new MaxNotifier(options.config.maxBotToken, options.config.maxApiBaseUrl);
  let stopOutboxWorker: (() => void) | undefined;

  if (options.caseRepository) {
    app.decorate('caseRepository', options.caseRepository);
  } else if (options.config.storageMode === 'memory') {
    app.decorate('caseRepository', new InMemoryCaseRepository());
  } else {
    const { client, db } = createDatabase(options.config);
    app.decorate('caseRepository', new PostgresCaseRepository(db, objectStorage));
    stopOutboxWorker = startOutboxWorker(db, notifier, app.log);
    app.addHook('onClose', async () => {
      stopOutboxWorker?.();
      await client.end();
    });
  }

  await app.register(cors, {
    origin: options.config.demoMode ? true : [options.config.publicBaseUrl],
    credentials: false,
  });
  await app.register(multipart, {
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 5 },
  });
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'ДомДело API',
        version: '0.1.0',
        description: 'API MVP для коллективных дел жителей дома',
      },
      servers: [{ url: options.config.publicBaseUrl }],
      tags: [
        { name: 'auth' },
        { name: 'cases' },
        { name: 'case-workflow' },
        { name: 'attachments' },
        { name: 'MAX webhook' },
        { name: 'health' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'session' },
          demoUser: { type: 'apiKey', in: 'header', name: 'X-Demo-User' },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  await registerAuth(app);
  await registerHealthRoutes(app);
  await registerCaseRoutes(app);
  await registerWebhookRoutes(app, notifier);

  if (objectStorage.get) {
    app.get('/api/files/:key', async (request, reply) => {
      const { key } = request.params as { key: string };
      const found = await objectStorage.get!(decodeURIComponent(key));
      if (!found) return reply.code(404).send({ error: 'not_found', message: 'Файл не найден' });
      return reply.type(found.contentType).send(found.body);
    });
  }

  app.setErrorHandler((error, request, reply) => {
    const typedError = error as Error & { validation?: unknown };
    const requestId = request.id;
    if (error instanceof NotFoundError) {
      return reply.code(404).send({ error: 'not_found', message: error.message, requestId });
    }
    if (error instanceof ForbiddenError || typedError.name === 'WorkflowError') {
      return reply.code(403).send({ error: 'forbidden', message: typedError.message, requestId });
    }
    if (error instanceof ConflictError) {
      return reply.code(409).send({ error: 'conflict', message: error.message, requestId });
    }
    if (typedError.validation) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Проверьте заполнение полей',
        requestId,
      });
    }
    request.log.error({ error, requestId }, 'request failed');
    return reply.code(500).send({
      error: 'internal_error',
      message: 'Не удалось выполнить запрос. Повторите попытку.',
      requestId,
    });
  });

  return app;
}
