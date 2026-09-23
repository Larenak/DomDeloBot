import type {
  CaseDto,
  CreateCaseInput,
  DuplicateSearchInput,
  TransitionCaseInput,
} from '@domdelo/contracts';
import type { CaseStatus } from '@domdelo/domain';

import type { AuthenticatedActor } from '../types.js';

export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class ForbiddenError extends Error {}

export type AttachmentUpload = {
  kind: 'problem' | 'result';
  objectKey: string;
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
};

export interface CaseRepository {
  ready(): Promise<boolean>;
  resolveMaxUser(input: {
    maxUserId: bigint;
    displayName: string;
    maxChatId?: bigint;
  }): Promise<AuthenticatedActor>;
  listCases(actor: AuthenticatedActor, status?: CaseStatus): Promise<CaseDto[]>;
  getCase(actor: AuthenticatedActor, caseId: string): Promise<CaseDto>;
  findDuplicates(actor: AuthenticatedActor, input: DuplicateSearchInput): Promise<CaseDto[]>;
  createCase(
    actor: AuthenticatedActor,
    input: CreateCaseInput,
    idempotencyKey: string,
  ): Promise<CaseDto>;
  confirmCase(actor: AuthenticatedActor, caseId: string): Promise<CaseDto>;
  watchCase(actor: AuthenticatedActor, caseId: string): Promise<CaseDto>;
  transitionCase(
    actor: AuthenticatedActor,
    caseId: string,
    input: TransitionCaseInput,
  ): Promise<CaseDto>;
  addAttachment(
    actor: AuthenticatedActor,
    caseId: string,
    upload: AttachmentUpload,
  ): Promise<CaseDto>;
  saveWebhookEvent(eventId: string, eventType: string, payload: unknown): Promise<boolean>;
}
