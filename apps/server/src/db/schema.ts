import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', [
  'resident',
  'owner',
  'tenant',
  'chair',
  'dispatcher',
  'executor',
  'authority',
  'admin',
]);

export const caseStatusEnum = pgEnum('case_status', [
  'draft',
  'registered',
  'assigned',
  'in_progress',
  'awaiting_resident_verification',
  'resolved',
  'disputed',
]);

export const attachmentKindEnum = pgEnum('attachment_kind', ['problem', 'result']);

export const houses = pgTable(
  'houses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    address: text('address').notNull(),
    normalizedAddress: text('normalized_address').notNull(),
    fiasId: uuid('fias_id'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('houses_normalized_address_unique').on(table.normalizedAddress),
    uniqueIndex('houses_fias_id_unique').on(table.fiasId),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    maxUserId: bigint('max_user_id', { mode: 'bigint' }),
    displayName: text('display_name').notNull(),
    role: userRoleEnum('role').notNull().default('resident'),
    activeHouseId: uuid('active_house_id'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_max_user_id_unique').on(table.maxUserId)],
);

export const houseMembers = pgTable(
  'house_members',
  {
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    isFavorite: boolean('is_favorite').notNull().default(false),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.houseId, table.userId] })],
);

export const houseRoleGrants = pgTable('house_role_grants', {
  houseId: uuid('house_id').notNull().references(() => houses.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: userRoleEnum('role').notNull(),
  source: text('source').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [primaryKey({ columns: [table.houseId, table.userId] })]);
export const houseInvites = pgTable('house_invites', {
  codeHash: text('code_hash').primaryKey(),
  houseId: uuid('house_id').notNull().references(() => houses.id, { onDelete: 'cascade' }),
  maxUserId: bigint('max_user_id', { mode: 'bigint' }).notNull(),
  role: userRoleEnum('role').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  usedBy: uuid('used_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('house_invites_target_idx').on(table.maxUserId, table.expiresAt)]);

export const chatBindings = pgTable('chat_bindings', {
  id: uuid('id').primaryKey().defaultRandom(),
  houseId: uuid('house_id')
    .notNull()
    .references(() => houses.id, { onDelete: 'cascade' }),
  maxChatId: bigint('max_chat_id', { mode: 'bigint' }).notNull().unique(),
  isDemo: boolean('is_demo').notNull().default(false),
});

// Small hackathon deployments can store photos in PostgreSQL when S3 is unavailable.
export const storedObjects = pgTable('stored_objects', {
  key: text('key').primaryKey(),
  contentType: text('content_type').notNull(),
  bodyBase64: text('body_base64').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cases = pgTable(
  'cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: bigserial('number', { mode: 'number' }).notNull().unique(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull(),
    entrance: text('entrance'),
    place: text('place').notNull(),
    normalizedText: text('normalized_text').notNull(),
    status: caseStatusEnum('status').notNull().default('registered'),
    responsibleOrganization: text('responsible_organization').notNull(),
    assignee: text('assignee'),
    resultComment: text('result_comment'),
    plannedCompletionAt: timestamp('planned_completion_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('cases_house_status_idx').on(table.houseId, table.status),
    index('cases_house_category_idx').on(table.houseId, table.category),
  ],
);

export const caseConfirmations = pgTable(
  'case_confirmations',
  {
    caseId: uuid('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    observesProblem: boolean('observes_problem').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.caseId, table.userId] })],
);

export const caseWatchers = pgTable(
  'case_watchers',
  {
    caseId: uuid('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.caseId, table.userId] })],
);

export const caseAttachments = pgTable('case_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id')
    .notNull()
    .references(() => cases.id, { onDelete: 'cascade' }),
  uploadedBy: uuid('uploaded_by')
    .notNull()
    .references(() => users.id),
  kind: attachmentKindEnum('kind').notNull(),
  objectKey: text('object_key').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const caseStatusHistory = pgTable('case_status_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id')
    .notNull()
    .references(() => cases.id, { onDelete: 'cascade' }),
  fromStatus: caseStatusEnum('from_status'),
  toStatus: caseStatusEnum('to_status').notNull(),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => users.id),
  comment: text('comment'),
  plannedCompletionAt: timestamp('planned_completion_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const assignments = pgTable('assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id')
    .notNull()
    .references(() => cases.id, { onDelete: 'cascade' }),
  assignedBy: uuid('assigned_by')
    .notNull()
    .references(() => users.id),
  assigneeName: text('assignee_name').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const polls = pgTable('polls', {
  id: uuid('id').primaryKey().defaultRandom(),
  houseId: uuid('house_id').notNull().references(() => houses.id, { onDelete: 'cascade' }),
  caseId: uuid('case_id').references(() => cases.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  question: text('question').notNull(),
  closesAt: timestamp('closes_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pollOptions = pgTable('poll_options', {
  id: uuid('id').primaryKey().defaultRandom(),
  pollId: uuid('poll_id')
    .notNull()
    .references(() => polls.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  position: integer('position').notNull(),
});

export const pollVotes = pgTable('poll_votes', {
  pollId: uuid('poll_id').notNull().references(() => polls.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  optionId: uuid('option_id').notNull().references(() => pollOptions.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.pollId, table.userId] })]);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topic: text('topic').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('outbox_pending_idx').on(table.processedAt, table.availableAt)],
);

export const outboxDeliveries = pgTable('outbox_deliveries', {
  eventId: uuid('event_id').notNull().references(() => outboxEvents.id, { onDelete: 'cascade' }),
  maxChatId: bigint('max_chat_id', { mode: 'bigint' }).notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.eventId, table.maxChatId] })]);
export const processedWebhookEvents = pgTable('processed_webhook_events', {
  eventId: text('event_id').primaryKey(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.key] })],
);

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: uuid('actor_id').references(() => users.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Only an operator-verified service account may be removed when management changes.
export const houseManagement = pgTable('house_management', {
  houseId: uuid('house_id').primaryKey().references(() => houses.id, { onDelete: 'cascade' }),
  organizationName: text('organization_name'),
  serviceMaxUserId: bigint('service_max_user_id', { mode: 'bigint' }),
  previousServiceMaxUserId: bigint('previous_service_max_user_id', { mode: 'bigint' }),
  revision: integer('revision').notNull().default(0),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
});

export const chatManagementChecks = pgTable('chat_management_checks', {
  maxChatId: bigint('max_chat_id', { mode: 'bigint' }).primaryKey().references(() => chatBindings.maxChatId, { onDelete: 'cascade' }),
  checkedAt: timestamp('checked_at', { withTimezone: true }),
  announcedRevision: integer('announced_revision').notNull().default(0),
  presence: text('presence'),
  missingNoticeId: text('missing_notice_id'),
  previousRemovedRevision: integer('previous_removed_revision').notNull().default(0),
});
