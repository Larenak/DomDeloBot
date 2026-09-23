import {
  CaseSchema,
  CaseStatusSchema,
  CreateCaseSchema,
  DuplicateSearchSchema,
  ErrorSchema,
  TransitionCaseSchema,
} from '@domdelo/contracts';
import type { CaseStatus } from '@domdelo/domain';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

export async function registerCaseRoutes(app: FastifyInstance): Promise<void> {
  const secured = { preHandler: app.authenticate };

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

  app.post(
    '/api/cases/deduplication',
    {
      ...secured,
      schema: {
        tags: ['cases'],
        security: [{ bearerAuth: [] }, { demoUser: [] }],
        body: DuplicateSearchSchema,
        response: { 200: { type: 'array', items: CaseSchema } },
      },
    },
    async (request) => app.caseRepository.findDuplicates(request.actor!, request.body as never),
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
        response: { 201: CaseSchema, 400: ErrorSchema, 403: ErrorSchema },
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
        response: { 200: CaseSchema, 409: ErrorSchema },
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
        response: { 200: CaseSchema, 400: ErrorSchema, 413: ErrorSchema, 415: ErrorSchema },
      },
    },
    async (request, reply) => {
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
