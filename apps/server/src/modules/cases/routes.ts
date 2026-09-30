import {
  CaseSchema,
  CaseStatusSchema,
  CreateCaseSchema,
  DuplicateSearchSchema,
  ErrorSchema,
  HouseReportSchema,
  TransitionCaseSchema,
} from '@domdelo/contracts';
import type { CaseStatus } from '@domdelo/domain';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { assertAcceptableCaseText } from '../../services/case-text-moderation.js';

export async function registerCaseRoutes(app: FastifyInstance): Promise<void> {
  const secured = { preHandler: app.authenticate };

  app.get('/api/reports/house', {
    ...secured,
    schema: {
      tags: ['reports'],
      security: [{ bearerAuth: [] }, { demoUser: [] }],
      response: { 200: HouseReportSchema, 403: ErrorSchema },
    },
  }, async (request) => app.caseRepository.getHouseReport(request.actor!));
  app.get(
    '/api/cases',
    {
      ...secured,
      schema: {
        tags: ['cases'],
        security: [{ bearerAuth: [] }, { demoUser: [] }],
        querystring: {
          type: 'object',
          properties: { status: CaseStatusSchema },
        },
        response: { 200: { type: 'array', items: CaseSchema }, 401: ErrorSchema },
      },
    },
    async (request) => {
      const query = request.query as { status?: CaseStatus };
      return app.caseRepository.listCases(request.actor!, query.status);
    },
  );

  app.get(
    '/api/cases/:caseId',
    {
      ...secured,
      schema: {
        tags: ['cases'],
        security: [{ bearerAuth: [] }, { demoUser: [] }],
        params: {
          type: 'object',
          required: ['caseId'],
          properties: { caseId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: CaseSchema, 404: ErrorSchema },
      },
    },
    async (request) => {
      const { caseId } = request.params as { caseId: string };
      return app.caseRepository.getCase(request.actor!, caseId);
    },
  );

  app.delete(
    '/api/cases/:caseId',
    {
      ...secured,
      schema: {
        tags: ['cases'],
        security: [{ bearerAuth: [] }, { demoUser: [] }],
        params: {
          type: 'object',
          required: ['caseId'],
          properties: { caseId: { type: 'string', format: 'uuid' } },
        },
        response: {
          200: { type: 'object', required: ['deleted'], properties: { deleted: { type: 'boolean' } } },
          401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema,
        },
      },
    },
    async (request) => {
      const { caseId } = request.params as { caseId: string };
      await app.caseRepository.deleteCase(request.actor!, caseId);
      return { deleted: true };
    },
  );

  app.post(
    '/api/cases/deduplication',
    {
      ...secured,
      schema: {
        tags: ['cases'],
        security: [{ bearerAuth: [] }, { demoUser: [] }],
        body: DuplicateSearchSchema,
        response: { 200: { type: 'array', items: CaseSchema }, 422: ErrorSchema },
      },
    },
    async (request) => {
      const input = request.body as { description: string; place: string };
      assertAcceptableCaseText({ 'Описание': input.description, 'Место': input.place });
      return app.caseRepository.findDuplicates(request.actor!, request.body as never);
    },
  );

  app.post(
    '/api/cases',
    {
      ...secured,
      schema: {
        tags: ['cases'],
        security: [{ bearerAuth: [] }, { demoUser: [] }],
        headers: {
          type: 'object',
          required: ['idempotency-key'],
          properties: {
            'idempotency-key': { type: 'string', minLength: 8, maxLength: 128 },
          },
        },
        body: CreateCaseSchema,
        response: { 201: CaseSchema, 400: ErrorSchema, 403: ErrorSchema, 422: ErrorSchema },
      },
    },
    async (request, reply) => {
      const idempotencyKey = request.headers['idempotency-key'] as string;
      const created = await app.caseRepository.createCase(
        request.actor!,
        request.body as never,
        idempotencyKey,
      );
      return reply.code(201).send(created);
    },
  );

  app.post(
    '/api/cases/:caseId/confirmations',
    {
      ...secured,
      schema: {
        tags: ['cases'],
        security: [{ bearerAuth: [] }, { demoUser: [] }],
        params: {
          type: 'object',
          required: ['caseId'],
          properties: { caseId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: CaseSchema },
      },
    },
    async (request) => {
      const { caseId } = request.params as { caseId: string };
      return app.caseRepository.confirmCase(request.actor!, caseId);
    },
  );

  app.post(
    '/api/cases/:caseId/watchers',
    {
      ...secured,
      schema: {
        tags: ['cases'],
        security: [{ bearerAuth: [] }, { demoUser: [] }],
        params: {
          type: 'object',
          required: ['caseId'],
          properties: { caseId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: CaseSchema },
      },
    },
    async (request) => {
      const { caseId } = request.params as { caseId: string };
      return app.caseRepository.watchCase(request.actor!, caseId);
    },
  );

  app.delete(
    '/api/cases/:caseId/watchers',
    {
      ...secured,
      schema: {
        tags: ['cases'],
        security: [{ bearerAuth: [] }, { demoUser: [] }],
        params: {
          type: 'object',
          required: ['caseId'],
          properties: { caseId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: CaseSchema },
      },
    },
    async (request) => {
      const { caseId } = request.params as { caseId: string };
      return app.caseRepository.unwatchCase(request.actor!, caseId);
    },
  );

  app.patch(
    '/api/cases/:caseId/status',
    {
      ...secured,
      schema: {
        tags: ['case-workflow'],
        security: [{ bearerAuth: [] }, { demoUser: [] }],
        params: {
          type: 'object',
          required: ['caseId'],
          properties: { caseId: { type: 'string', format: 'uuid' } },
        },
        body: TransitionCaseSchema,
        response: { 200: CaseSchema, 409: ErrorSchema, 422: ErrorSchema },
      },
    },
    async (request) => {
      const { caseId } = request.params as { caseId: string };
      return app.caseRepository.transitionCase(request.actor!, caseId, request.body as never);
    },
  );

  app.post(
    '/api/cases/:caseId/attachments',
    {
      ...secured,
      schema: {
        tags: ['attachments'],
        security: [{ bearerAuth: [] }, { demoUser: [] }],
        consumes: ['multipart/form-data'],
        params: {
          type: 'object',
          required: ['caseId'],
          properties: { caseId: { type: 'string', format: 'uuid' } },
        },
        querystring: {
          type: 'object',
          required: ['kind'],
          properties: { kind: { type: 'string', enum: ['problem', 'result'] } },
        },
        response: { 200: CaseSchema, 400: ErrorSchema, 403: ErrorSchema, 413: ErrorSchema, 415: ErrorSchema, 422: ErrorSchema },
      },
    },
    async (request, reply) => {
      if (request.actor?.isDemoHouse && !app.config.demoMode) {
        return reply.code(403).send({ error: 'demo_upload_disabled', message: 'Фотографии в открытом демонстрационном доме отключены' });
      }
      const { caseId } = request.params as { caseId: string };
      const { kind } = request.query as { kind: 'problem' | 'result' };
      const file = await request.file({ limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
      if (!file) {
        return reply.code(400).send({ error: 'file_required', message: 'Выберите фотографию' });
      }
      const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
      if (!allowedTypes.has(file.mimetype)) {
        return reply.code(415).send({
          error: 'unsupported_media_type',
          message: 'Поддерживаются JPEG, PNG и WebP',
        });
      }
      const body = await file.toBuffer();
      assertAcceptableCaseText({ 'Имя файла': file.filename });
      const extension = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
      const key = `cases/${caseId}/${kind}/${randomUUID()}.${extension}`;
      const stored = await app.objectStorage.put(key, body, file.mimetype);
      return app.caseRepository.addAttachment(request.actor!, caseId, {
        kind,
        objectKey: stored.key,
        url: stored.url,
        fileName: file.filename,
        mimeType: file.mimetype,
        size: body.byteLength,
      });
    },
  );
}
