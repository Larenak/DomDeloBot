import type {
  CaseCategory,
  CaseDto,
  CreateCaseInput,
  DuplicateSearchInput,
  TransitionCaseInput,
} from '@domdelo/contracts';
import { assertTransitionAllowed, type CaseStatus } from '@domdelo/domain';
import { and, count, desc, eq, ne, sql } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import {
  assignments,
  auditLog,
  chatBindings,
  caseAttachments,
  caseConfirmations,
  cases,
  caseStatusHistory,
  caseWatchers,
  houseMembers,
  idempotencyKeys,
  outboxEvents,
  processedWebhookEvents,
  users,
} from '../db/schema.js';
import type { AuthenticatedActor } from '../types.js';
import type { ObjectStorage } from '../services/object-storage.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type AttachmentUpload,
  type CaseRepository,
} from './case-repository.js';
import { routeResponsibleOrganization } from './in-memory-case-repository.js';

function normalized(value: string): string {
  return value
    .toLocaleLowerCase('ru-RU')
    .replace(/[^a-zа-яё0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureResident(actor: AuthenticatedActor): void {
  if (!['resident', 'admin'].includes(actor.role)) {
    throw new ForbiddenError('Действие доступно жильцу дома');
  }
}

export class PostgresCaseRepository implements CaseRepository {
  constructor(
    private readonly db: Database,
    private readonly objectStorage: ObjectStorage,
  ) {}

  async ready(): Promise<boolean> {
    await this.db.execute(sql`select 1`);
    return true;
  }

  async resolveMaxUser(input: {
    maxUserId: bigint;
    displayName: string;
    maxChatId?: bigint;
  }): Promise<AuthenticatedActor> {
    if (input.maxChatId === undefined) {
      throw new ForbiddenError('Откройте мини-приложение из домового чата MAX');
    }
    const [binding] = await this.db
      .select({ houseId: chatBindings.houseId })
      .from(chatBindings)
      .where(eq(chatBindings.maxChatId, input.maxChatId))
      .limit(1);
    if (!binding) throw new ForbiddenError('Домовой чат ещё не подключён к ДомДелу');

    const [user] = await this.db
      .insert(users)
      .values({ maxUserId: input.maxUserId, displayName: input.displayName })
      .onConflictDoUpdate({
        target: users.maxUserId,
        set: { displayName: input.displayName },
      })
      .returning({ id: users.id, role: users.role, displayName: users.displayName });
    if (!user) throw new Error('Не удалось создать пользователя MAX');
    await this.db
      .insert(houseMembers)
      .values({ houseId: binding.houseId, userId: user.id })
      .onConflictDoNothing();
    return {
      id: user.id,
      role: user.role,
      houseId: binding.houseId,
      displayName: user.displayName,
    };
  }

  async listCases(actor: AuthenticatedActor, status?: CaseStatus): Promise<CaseDto[]> {
    const rows = await this.db
      .select({ id: cases.id })
      .from(cases)
      .where(and(eq(cases.houseId, actor.houseId), status ? eq(cases.status, status) : undefined))
      .orderBy(desc(cases.updatedAt));
    return Promise.all(rows.map(({ id }) => this.hydrate(actor, id)));
  }

  async getCase(actor: AuthenticatedActor, caseId: string): Promise<CaseDto> {
    return this.hydrate(actor, caseId);
  }

  async findDuplicates(
    actor: AuthenticatedActor,
    input: DuplicateSearchInput,
  ): Promise<CaseDto[]> {
    const inputText = normalized(`${input.place} ${input.description}`);
    const similarity = sql<number>`similarity(${cases.normalizedText}, ${inputText})`;
    const rows = await this.db
      .select({ id: cases.id, score: similarity })
      .from(cases)
      .where(
        and(
          eq(cases.houseId, actor.houseId),
          ne(cases.status, 'resolved'),
          eq(cases.category, input.category),
          input.entrance ? eq(cases.entrance, input.entrance) : undefined,
          sql`${similarity} >= 0.2`,
          sql`${cases.createdAt} >= now() - interval '30 days'`,
        ),
      )
      .orderBy(desc(similarity))
      .limit(3);
    return Promise.all(rows.map(({ id }) => this.hydrate(actor, id)));
  }

  async createCase(
    actor: AuthenticatedActor,
    input: CreateCaseInput,
    idempotencyKey: string,
  ): Promise<CaseDto> {
    ensureResident(actor);
    if (input.duplicateCaseId) return this.confirmCase(actor, input.duplicateCaseId);

    const created = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${actor.id}:${idempotencyKey}`}, 0))`);
      const [existing] = await tx
        .select({ id: idempotencyKeys.caseId })
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.userId, actor.id), eq(idempotencyKeys.key, idempotencyKey)))
        .limit(1);
      if (existing) return existing;

      const [inserted] = await tx
        .insert(cases)
        .values({
          houseId: actor.houseId,
          authorId: actor.id,
          title: input.title,
          description: input.description,
          category: input.category,
          ...(input.entrance ? { entrance: input.entrance } : {}),
          place: input.place,
          normalizedText: normalized(`${input.place} ${input.description}`),
          status: 'registered',
          responsibleOrganization: routeResponsibleOrganization(input.category),
          isDemo: true,
        })
        .returning({ id: cases.id });
      if (!inserted) throw new Error('Не удалось создать дело');
      await Promise.all([
        tx.insert(idempotencyKeys).values({
          userId: actor.id,
          key: idempotencyKey,
          caseId: inserted.id,
        }),
        tx.insert(caseConfirmations).values({ caseId: inserted.id, userId: actor.id }),
        tx.insert(caseWatchers).values({ caseId: inserted.id, userId: actor.id }),
        tx.insert(caseStatusHistory).values({
          caseId: inserted.id,
          toStatus: 'registered',
          actorId: actor.id,
          comment: 'Дело зарегистрировано',
        }),
        tx.insert(outboxEvents).values({
          topic: 'case.registered',
          aggregateId: inserted.id,
          payload: { caseId: inserted.id, actorId: actor.id },
        }),
        tx.insert(auditLog).values({
          actorId: actor.id,
          action: 'case.created',
          entityType: 'case',
          entityId: inserted.id,
          metadata: { category: input.category },
        }),
      ]);
      return inserted;
    });
    return this.hydrate(actor, created.id);
  }

  async confirmCase(actor: AuthenticatedActor, caseId: string): Promise<CaseDto> {
    ensureResident(actor);
    await this.ensureVisible(actor, caseId);
    await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(caseConfirmations)
        .values({ caseId, userId: actor.id })
        .onConflictDoNothing()
        .returning({ caseId: caseConfirmations.caseId });
      if (inserted.length > 0) {
        await tx.update(cases).set({ updatedAt: new Date() }).where(eq(cases.id, caseId));
        await tx.insert(auditLog).values({
          actorId: actor.id,
          action: 'case.confirmed',
          entityType: 'case',
          entityId: caseId,
        });
      }
    });
    return this.hydrate(actor, caseId);
  }

  async watchCase(actor: AuthenticatedActor, caseId: string): Promise<CaseDto> {
    await this.ensureVisible(actor, caseId);
    await this.db
      .insert(caseWatchers)
      .values({ caseId, userId: actor.id })
      .onConflictDoNothing();
    return this.hydrate(actor, caseId);
  }

  async transitionCase(
    actor: AuthenticatedActor,
    caseId: string,
    input: TransitionCaseInput,
  ): Promise<CaseDto> {
    const current = await this.ensureVisible(actor, caseId);
    assertTransitionAllowed(current.status, input.status, actor.role);

    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(cases)
        .set({
          status: input.status,
          version: sql`${cases.version} + 1`,
          updatedAt: new Date(),
          ...(input.assignee ? { assignee: input.assignee } : {}),
          ...(input.comment && input.status === 'awaiting_resident_verification'
            ? { resultComment: input.comment }
            : {}),
        })
        .where(
          and(
            eq(cases.id, caseId),
            eq(cases.houseId, actor.houseId),
            eq(cases.version, input.expectedVersion),
          ),
        )
        .returning({ id: cases.id });
      if (updated.length === 0) {
        throw new ConflictError('Карточка уже изменилась. Обновите данные и повторите действие.');
      }
      await tx.insert(caseStatusHistory).values({
        caseId,
        fromStatus: current.status,
        toStatus: input.status,
        actorId: actor.id,
        ...(input.comment ? { comment: input.comment } : {}),
      });
      if (input.assignee) {
        await tx.update(assignments).set({ active: false }).where(eq(assignments.caseId, caseId));
        await tx.insert(assignments).values({
          caseId,
          assignedBy: actor.id,
          assigneeName: input.assignee,
        });
      }
      await Promise.all([
        tx.insert(outboxEvents).values({
          topic: 'case.status_changed',
          aggregateId: caseId,
          payload: { caseId, fromStatus: current.status, toStatus: input.status },
        }),
        tx.insert(auditLog).values({
          actorId: actor.id,
          action: 'case.status_changed',
          entityType: 'case',
          entityId: caseId,
          metadata: { fromStatus: current.status, toStatus: input.status },
        }),
      ]);
    });
    return this.hydrate(actor, caseId);
  }

  async addAttachment(
    actor: AuthenticatedActor,
    caseId: string,
    upload: AttachmentUpload,
  ): Promise<CaseDto> {
    await this.ensureVisible(actor, caseId);
    if (upload.kind === 'result' && !['dispatcher', 'executor', 'admin'].includes(actor.role)) {
      throw new ForbiddenError('Фото результата может добавить исполнитель или диспетчер');
    }
    await this.db.transaction(async (tx) => {
      await tx.insert(caseAttachments).values({
        caseId,
        uploadedBy: actor.id,
        kind: upload.kind,
        objectKey: upload.objectKey,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        size: upload.size,
      });
      await tx.update(cases).set({ updatedAt: new Date() }).where(eq(cases.id, caseId));
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'case.attachment_added',
        entityType: 'case',
        entityId: caseId,
        metadata: { kind: upload.kind, mimeType: upload.mimeType, size: upload.size },
      });
    });
    return this.hydrate(actor, caseId);
  }

  async saveWebhookEvent(eventId: string, eventType: string, payload: unknown): Promise<boolean> {
    const inserted = await this.db
      .insert(processedWebhookEvents)
      .values({ eventId, eventType, payload })
      .onConflictDoNothing()
      .returning({ eventId: processedWebhookEvents.eventId });
    return inserted.length > 0;
  }

  private async ensureVisible(actor: AuthenticatedActor, caseId: string) {
    const [item] = await this.db
      .select()
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.houseId, actor.houseId)))
      .limit(1);
    if (!item) throw new NotFoundError('Дело не найдено');
    return item;
  }

  private async hydrate(actor: AuthenticatedActor, caseId: string): Promise<CaseDto> {
    const item = await this.ensureVisible(actor, caseId);
    const [[confirmationCount], [watcherCount], historyRows, attachmentRows] = await Promise.all([
      this.db
        .select({ value: count() })
        .from(caseConfirmations)
        .where(eq(caseConfirmations.caseId, caseId)),
      this.db
        .select({ value: count() })
        .from(caseWatchers)
        .where(eq(caseWatchers.caseId, caseId)),
      this.db
        .select({
          id: caseStatusHistory.id,
          fromStatus: caseStatusHistory.fromStatus,
          toStatus: caseStatusHistory.toStatus,
          comment: caseStatusHistory.comment,
          actorName: users.displayName,
          createdAt: caseStatusHistory.createdAt,
        })
        .from(caseStatusHistory)
        .innerJoin(users, eq(caseStatusHistory.actorId, users.id))
        .where(eq(caseStatusHistory.caseId, caseId))
        .orderBy(caseStatusHistory.createdAt),
      this.db
        .select()
        .from(caseAttachments)
        .where(eq(caseAttachments.caseId, caseId))
        .orderBy(caseAttachments.createdAt),
    ]);

    const attachmentsWithUrls = await Promise.all(
      attachmentRows.map(async (row) => ({
        id: row.id,
        kind: row.kind,
        url: await this.objectStorage.url(row.objectKey),
        fileName: row.fileName,
        mimeType: row.mimeType,
        createdAt: row.createdAt.toISOString(),
      })),
    );

    return {
      id: item.id,
      number: item.number,
      houseId: item.houseId,
      title: item.title,
      description: item.description,
      category: item.category as CaseCategory,
      ...(item.entrance ? { entrance: item.entrance } : {}),
      place: item.place,
      status: item.status,
      confirmationsCount: confirmationCount?.value ?? 0,
      watchersCount: watcherCount?.value ?? 0,
      responsibleOrganization: item.responsibleOrganization,
      ...(item.assignee ? { assignee: item.assignee } : {}),
      ...(item.resultComment ? { resultComment: item.resultComment } : {}),
      version: item.version,
      isDemo: item.isDemo,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      history: historyRows.map((row) => ({
        id: row.id,
        ...(row.fromStatus ? { fromStatus: row.fromStatus } : {}),
        toStatus: row.toStatus,
        ...(row.comment ? { comment: row.comment } : {}),
        actorName: row.actorName,
        createdAt: row.createdAt.toISOString(),
      })),
      attachments: attachmentsWithUrls,
    };
  }
}
