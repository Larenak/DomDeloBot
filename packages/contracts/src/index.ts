import { Type, type Static } from '@sinclair/typebox';

export const CaseStatusSchema = Type.Union([
  Type.Literal('draft'),
  Type.Literal('registered'),
  Type.Literal('assigned'),
  Type.Literal('in_progress'),
  Type.Literal('awaiting_resident_verification'),
  Type.Literal('resolved'),
  Type.Literal('disputed'),
]);

export const UserRoleSchema = Type.Union([
  Type.Literal('resident'),
  Type.Literal('chair'),
  Type.Literal('dispatcher'),
  Type.Literal('executor'),
  Type.Literal('authority'),
  Type.Literal('admin'),
]);

export const CaseCategorySchema = Type.Union([
  Type.Literal('lighting'),
  Type.Literal('entrance'),
  Type.Literal('elevator'),
  Type.Literal('water'),
  Type.Literal('heating'),
  Type.Literal('yard'),
  Type.Literal('other'),
]);

export type CaseCategory = Static<typeof CaseCategorySchema>;

export const HouseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  address: Type.String(),
  fiasId: Type.Optional(Type.String({ format: 'uuid' })),
  isActive: Type.Boolean(),
  isDemo: Type.Boolean(),
});

export const HouseContextSchema = Type.Object({
  houses: Type.Array(HouseSchema),
  activeHouseId: Type.Optional(Type.String({ format: 'uuid' })),
  activeRole: Type.Optional(UserRoleSchema),
  onboardingRequired: Type.Boolean(),
  accessPending: Type.Boolean(),
});

export const AddHouseSchema = Type.Object({
  fiasId: Type.String({ format: 'uuid' }),
});

export const AddressSuggestionSchema = Type.Object({
  value: Type.String(),
  isHouse: Type.Boolean(),
  fiasId: Type.Optional(Type.String({ format: 'uuid' })),
});

export type HouseDto = Static<typeof HouseSchema>;
export type HouseContextDto = Static<typeof HouseContextSchema>;
export type AddHouseInput = Static<typeof AddHouseSchema>;
export type AddressSuggestionDto = Static<typeof AddressSuggestionSchema>;

export const PublicHousingDataSchema = Type.Object({
  houseId: Type.String({ format: 'uuid' }),
  management: Type.Object({
    status: Type.Union([Type.Literal('found'), Type.Literal('missing'), Type.Literal('unavailable')]),
    name: Type.Optional(Type.String()),
    managementType: Type.Optional(Type.String()),
    organizationUrl: Type.Optional(Type.String()),
    sourceUrl: Type.String(),
    snapshotDate: Type.String(),
  }),
  overhaul: Type.Object({
    status: Type.Union([Type.Literal('found'), Type.Literal('missing'), Type.Literal('unavailable')]),
    sourceUrl: Type.String(),
    worksSourceUrl: Type.Optional(Type.String()),
    snapshotDate: Type.Optional(Type.String()),
    updatedAt: Type.Optional(Type.String()),
    fundingMethod: Type.Optional(Type.String()),
    fundBalanceThousandRub: Type.Optional(Type.Number({ minimum: 0 })),
    contributionRubPerSqM: Type.Optional(Type.Number({ minimum: 0 })),
    includedAt: Type.Optional(Type.String()),
    works: Type.Array(Type.Object({
      type: Type.String(),
      plannedYear: Type.Optional(Type.String()),
      completedDate: Type.Optional(Type.String()),
      contractor: Type.Optional(Type.String()),
    })),
  }),
});
export type PublicHousingDataDto = Static<typeof PublicHousingDataSchema>;
export const CaseHistoryItemSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  fromStatus: Type.Optional(CaseStatusSchema),
  toStatus: CaseStatusSchema,
  comment: Type.Optional(Type.String()),
  actorName: Type.String(),
  plannedCompletionAt: Type.Optional(Type.String({ format: 'date-time' })),
  createdAt: Type.String({ format: 'date-time' }),
});

export const AttachmentSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  kind: Type.Union([Type.Literal('problem'), Type.Literal('result')]),
  url: Type.String(),
  fileName: Type.String(),
  mimeType: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
});

export const CaseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  number: Type.Integer({ minimum: 1 }),
  houseId: Type.String({ format: 'uuid' }),
  title: Type.String(),
  description: Type.String(),
  category: CaseCategorySchema,
  entrance: Type.Optional(Type.String()),
  place: Type.String(),
  status: CaseStatusSchema,
  confirmationsCount: Type.Integer({ minimum: 1 }),
  watchersCount: Type.Integer({ minimum: 0 }),
  isWatched: Type.Boolean(),
  responsibleOrganization: Type.String(),
  assignee: Type.Optional(Type.String()),
  resultComment: Type.Optional(Type.String()),
  plannedCompletionAt: Type.Optional(Type.String({ format: 'date-time' })),
  version: Type.Integer({ minimum: 1 }),
  isDemo: Type.Boolean(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
  history: Type.Array(CaseHistoryItemSchema),
  attachments: Type.Array(AttachmentSchema),
});

export const CreateCaseSchema = Type.Object({
  title: Type.String({ minLength: 5, maxLength: 120 }),
  description: Type.String({ minLength: 10, maxLength: 2000 }),
  category: CaseCategorySchema,
  entrance: Type.Optional(Type.String({ maxLength: 20 })),
  place: Type.String({ minLength: 2, maxLength: 120 }),
  duplicateCaseId: Type.Optional(Type.String({ format: 'uuid' })),
});

export type CreateCaseInput = Static<typeof CreateCaseSchema>;

export const DuplicateSearchSchema = Type.Object({
  description: Type.String({ minLength: 5, maxLength: 2000 }),
  category: CaseCategorySchema,
  entrance: Type.Optional(Type.String({ maxLength: 20 })),
  place: Type.String({ minLength: 2, maxLength: 120 }),
});

export type DuplicateSearchInput = Static<typeof DuplicateSearchSchema>;

export const TransitionCaseSchema = Type.Object({
  status: CaseStatusSchema,
  expectedVersion: Type.Integer({ minimum: 1 }),
  assignee: Type.Optional(Type.String({ maxLength: 120 })),
  comment: Type.Optional(Type.String({ maxLength: 1000 })),
  plannedCompletionAt: Type.Optional(Type.String({ format: 'date-time' })),
});

export type TransitionCaseInput = Static<typeof TransitionCaseSchema>;
export type CaseDto = Static<typeof CaseSchema>;

export const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.String(),
  requestId: Type.Optional(Type.String()),
});


export const PollOptionSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  label: Type.String(),
  votes: Type.Integer({ minimum: 0 }),
});

export const PollSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  houseId: Type.String({ format: 'uuid' }),
  question: Type.String(),
  options: Type.Array(PollOptionSchema),
  closesAt: Type.String({ format: 'date-time' }),
  createdAt: Type.String({ format: 'date-time' }),
  totalVotes: Type.Integer({ minimum: 0 }),
  myOptionId: Type.Optional(Type.String({ format: 'uuid' })),
  isDemo: Type.Boolean(),
});

export const CreatePollSchema = Type.Object({
  question: Type.String({ minLength: 10, maxLength: 300 }),
  options: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { minItems: 2, maxItems: 6 }),
  closesAt: Type.String({ format: 'date-time' }),
});

export const VotePollSchema = Type.Object({
  optionId: Type.String({ format: 'uuid' }),
});

export type PollDto = Static<typeof PollSchema>;
export type CreatePollInput = Static<typeof CreatePollSchema>;
export const HouseReportSchema = Type.Object({
  houseId: Type.String({ format: 'uuid' }),
  address: Type.String(),
  asOf: Type.String({ format: 'date-time' }),
  totalCases: Type.Integer({ minimum: 0 }),
  openCases: Type.Integer({ minimum: 0 }),
  overdueForecasts: Type.Integer({ minimum: 0 }),
  manyConfirmed: Type.Integer({ minimum: 0 }),
  categories: Type.Array(Type.Object({
    category: CaseCategorySchema,
    cases: Type.Integer({ minimum: 0 }),
    confirmations: Type.Integer({ minimum: 0 }),
  })),
  source: Type.Literal('domdelo_internal'),
});

export type HouseReportDto = Static<typeof HouseReportSchema>;
