import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { AppConfig } from '@domdelo/config';
import Fastify from 'fastify';
import { fileURLToPath } from 'node:url';

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
  PostgresObjectStorage,
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

  const needsDatabase = options.config.storageMode === 'postgres' &&
    (!options.caseRepository || (!options.objectStorage && options.config.objectStorageMode === 'postgres'));
  const database = needsDatabase ? createDatabase(options.config) : undefined;
  const objectStorage: ObjectStorage = options.objectStorage || (
    options.config.objectStorageMode === 'memory'
      ? new InMemoryObjectStorage()
      : options.config.objectStorageMode === 'postgres'
        ? new PostgresObjectStorage(database!.db, options.config.sessionSecret)
        : new S3ObjectStorage(options.config)
  );
  app.decorate('objectStorage', objectStorage);

  const notifier = options.notifier || new MaxNotifier(options.config.maxBotToken, options.config.maxApiBaseUrl);
  let stopOutboxWorker: (() => void) | undefined;

  if (options.caseRepository) {
    app.decorate('caseRepository', options.caseRepository);
  } else if (options.config.storageMode === 'memory') {
    app.decorate('caseRepository', new InMemoryCaseRepository());
  } else {
    app.decorate('caseRepository', new PostgresCaseRepository(
      database!.db,
      objectStorage,
      options.config.hackathonHouseId,
      options.config.demoMode,
    ));
    stopOutboxWorker = startOutboxWorker(database!.db, notifier, app.log);
  }
  if (database) {
    app.addHook('onClose', async () => {
      stopOutboxWorker?.();
      await database.client.end();
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
      const query = request.query as { expires?: string; signature?: string };
      const found = await objectStorage.get!(decodeURIComponent(key), query);
      if (!found) return reply.code(404).send({ error: 'not_found', message: 'Файл не найден' });
      return reply.type(found.contentType).send(found.body);
    });
  }

  if (options.config.serveWeb) {
    await app.register(fastifyStatic, {
      root: fileURLToPath(new URL('../../web/dist/', import.meta.url)),
      wildcard: false,
    });
    app.setNotFoundHandler((request, reply) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (
        request.method === 'GET' &&
        request.headers.accept?.includes('text/html') &&
        !/^\/(api|health|docs|webhooks)(\/|$)/u.test(pathname)
      ) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not_found', message: 'Страница не найдена' });
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
