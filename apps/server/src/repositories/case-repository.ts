import type {
  CaseDto,
  HouseReportDto,
  CreateCaseInput,
  DuplicateSearchInput,
  HouseContextDto,
  TransitionCaseInput,
} from '@domdelo/contracts';
import type { CaseStatus } from '@domdelo/domain';

import type { AuthenticatedActor } from '../types.js';
import type { VerifiedHouse } from '../services/address-provider.js';

export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class ForbiddenError extends Error {}
export class AddressOnboardingRequiredError extends ForbiddenError {}

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
  refreshActor(actor: AuthenticatedActor): Promise<AuthenticatedActor>;
  resolveMaxUser(input: {
    maxUserId: bigint;
    displayName: string;
    maxChatId?: bigint;
  }): Promise<AuthenticatedActor>;
  getHouseContext(actor: AuthenticatedActor): Promise<HouseContextDto>;
  addHouse(actor: AuthenticatedActor, input: VerifiedHouse): Promise<HouseContextDto>;
  joinDemoHouse(actor: AuthenticatedActor, houseId: string): Promise<HouseContextDto>;
  selectHouse(actor: AuthenticatedActor, houseId: string): Promise<HouseContextDto>;
  removeHouse(actor: AuthenticatedActor, houseId: string): Promise<HouseContextDto>;
  listCases(actor: AuthenticatedActor, status?: CaseStatus): Promise<CaseDto[]>;
  getHouseReport(actor: AuthenticatedActor): Promise<HouseReportDto>;
  getCase(actor: AuthenticatedActor, caseId: string): Promise<CaseDto>;
  deleteCase(actor: AuthenticatedActor, caseId: string): Promise<void>;
  findDuplicates(actor: AuthenticatedActor, input: DuplicateSearchInput): Promise<CaseDto[]>;
  createCase(
    actor: AuthenticatedActor,
    input: CreateCaseInput,
    idempotencyKey: string,
  ): Promise<CaseDto>;
  confirmCase(actor: AuthenticatedActor, caseId: string): Promise<CaseDto>;
  watchCase(actor: AuthenticatedActor, caseId: string): Promise<CaseDto>;
  unwatchCase(actor: AuthenticatedActor, caseId: string): Promise<CaseDto>;
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
