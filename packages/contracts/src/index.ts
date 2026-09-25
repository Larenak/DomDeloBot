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
  Type.Literal('dispatcher'),
  Type.Literal('executor'),
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
  isActive: Type.Boolean(),
  isDemo: Type.Boolean(),
});

export const HouseContextSchema = Type.Object({
  houses: Type.Array(HouseSchema),
  activeHouseId: Type.Optional(Type.String({ format: 'uuid' })),
  onboardingRequired: Type.Boolean(),
});

export const AddHouseSchema = Type.Object({
  city: Type.String({ minLength: 2, maxLength: 100, pattern: '.*[A-Za-zА-Яа-яЁё0-9].*' }),
  street: Type.String({ minLength: 2, maxLength: 120, pattern: '.*[A-Za-zА-Яа-яЁё0-9].*' }),
  building: Type.String({ minLength: 1, maxLength: 30, pattern: '.*[A-Za-zА-Яа-яЁё0-9].*' }),
});

export type HouseDto = Static<typeof HouseSchema>;
export type HouseContextDto = Static<typeof HouseContextSchema>;
export type AddHouseInput = Static<typeof AddHouseSchema>;

export const CaseHistoryItemSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  fromStatus: Type.Optional(CaseStatusSchema),
  toStatus: CaseStatusSchema,
  comment: Type.Optional(Type.String()),
  actorName: Type.String(),
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
  responsibleOrganization: Type.String(),
  assignee: Type.Optional(Type.String()),
  resultComment: Type.Optional(Type.String()),
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
});

export type TransitionCaseInput = Static<typeof TransitionCaseSchema>;
export type CaseDto = Static<typeof CaseSchema>;

export const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.String(),
  requestId: Type.Optional(Type.String()),
});
