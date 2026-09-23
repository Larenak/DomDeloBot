import type { AppConfig } from '@domdelo/config';
import type { WorkflowActor } from '@domdelo/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { CaseRepository } from './repositories/case-repository.js';
import type { ObjectStorage } from './services/object-storage.js';

export type AuthenticatedActor = WorkflowActor & {
  displayName: string;
};

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    caseRepository: CaseRepository;
    objectStorage: ObjectStorage;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    actor?: AuthenticatedActor;
  }
}

