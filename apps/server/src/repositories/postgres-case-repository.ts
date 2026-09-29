import type {
  CaseCategory,
  CaseDto,
  HouseReportDto,
  CreateCaseInput,
  DuplicateSearchInput,
  HouseContextDto,
  TransitionCaseInput,
} from '@domdelo/contracts';
import { assertTransitionAllowed, type CaseStatus, type UserRole } from '@domdelo/domain';
import { and, count, desc, eq, gt, isNull, ne, or, sql } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import {
  assignments,
  auditLog,
  caseAttachments,
  caseConfirmations,
  cases,
  caseStatusHistory,
  caseWatchers,
  houseMembers,
  houseRoleGrants,
  houses,
  idempotencyKeys,
  outboxEvents,
  processedWebhookEvents,
  users,
} from '../db/schema.js';
import type { AuthenticatedActor } from '../types.js';
import { makeHouseReport } from '../modules/cases/report.js';
import type { ObjectStorage } from '../services/object-storage.js';
import { assertAcceptableCaseText } from '../services/case-text-moderation.js';
import type { VerifiedHouse } from '../services/address-provider.js';
import {
  AddressOnboardingRequiredError,
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

function normalizedAddressPart(value: string): string {
  return value
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/[^a-zа-я0-9]/giu, '');
}

function legacyAddressKey(input: VerifiedHouse): string {
  return [input.city, input.street, input.building].map(normalizedAddressPart).join('|');
}

function activeHouseId(actor: AuthenticatedActor): string {
  if (!actor.houseId) {
    throw new AddressOnboardingRequiredError('Сначала добавьте адрес дома');
  }
  return actor.houseId;
}

function ensureResident(actor: AuthenticatedActor): void {
  if (!['resident', 'owner', 'tenant', 'chair', 'admin'].includes(actor.role)) {
    throw new ForbiddenError('Действие доступно жильцу дома');
  }
}

export class PostgresCaseRepository implements CaseRepository {
  constructor(
    private readonly db: Database,
    private readonly objectStorage: ObjectStorage,
    private readonly demoMode = true,
  ) {}

  async ready(): Promise<boolean> {
    await this.db.execute(sql`select 1`);
    return true;
  }

  async refreshActor(actor: AuthenticatedActor): Promise<AuthenticatedActor> {
    const [user] = await this.db
      .select({
        id: users.id,
        role: users.role,
        displayName: users.displayName,
        activeHouseId: users.activeHouseId,
        maxUserId: users.maxUserId,
      })
      .from(users)
      .where(eq(users.id, actor.id))
      .limit(1);
    if (!user) throw new ForbiddenError('Пользователь не найден');

    let houseId: string | undefined;
    let isDemoHouse = false;
    if (user.activeHouseId) {
      const [membership] = await this.db
        .select({ houseId: houseMembers.houseId, isDemo: houses.isDemo })
        .from(houseMembers)
        .innerJoin(houses, eq(houseMembers.houseId, houses.id))
        .where(
          and(
            eq(houseMembers.userId, user.id),
            eq(houseMembers.houseId, user.activeHouseId),
            eq(houseMembers.isFavorite, true),
          ),
        )
        .limit(1);
      houseId = membership?.houseId;
      isDemoHouse = membership?.isDemo ?? false;
    }
    const verifiedRole = houseId ? await this.getActiveRole(houseId, user.id) : undefined;
    if (!this.demoMode && !isDemoHouse && !verifiedRole) houseId = undefined;
    return {
      id: user.id,
      role: verifiedRole ?? 'resident',
      displayName: user.displayName,
      ...(user.maxUserId ? { maxUserId: user.maxUserId.toString() } : {}),
      isDemoHouse,
      ...(houseId ? { houseId } : {}),
    };
  }

  private async getActiveRole(houseId: string, userId: string): Promise<UserRole | undefined> {
    const [grant] = await this.db.select({ role: houseRoleGrants.role })
      .from(houseRoleGrants)
      .where(and(
        eq(houseRoleGrants.houseId, houseId),
        eq(houseRoleGrants.userId, userId),
        isNull(houseRoleGrants.revokedAt),
        or(isNull(houseRoleGrants.expiresAt), gt(houseRoleGrants.expiresAt, new Date())),
      )).limit(1);
    return grant?.role;
  }
  async resolveMaxUser(input: {
    maxUserId: bigint;
    displayName: string;
    maxChatId?: bigint;
  }): Promise<AuthenticatedActor> {
    const [user] = await this.db
      .insert(users)
      .values({ maxUserId: input.maxUserId, displayName: input.displayName })
      .onConflictDoUpdate({
        target: users.maxUserId,
        set: { displayName: input.displayName },
      })
      .returning({ id: users.id, displayName: users.displayName });
    if (!user) throw new Error('Не удалось создать пользователя MAX');
    return this.refreshActor({
      id: user.id,
      role: 'resident',
      displayName: user.displayName,
    });
  }

  async getHouseContext(actor: AuthenticatedActor): Promise<HouseContextDto> {
    const rows = await this.db
      .select({
        id: houses.id,
        address: houses.address,
        isDemo: houses.isDemo,
        lastUsedAt: houseMembers.lastUsedAt,
      })
      .from(houseMembers)
      .innerJoin(houses, eq(houseMembers.houseId, houses.id))
      .where(and(eq(houseMembers.userId, actor.id), eq(houseMembers.isFavorite, true)))
      .orderBy(desc(houseMembers.lastUsedAt), houses.address);
    const selectedHouse = rows.find((row) => row.id === actor.houseId);
    const activeGrant = selectedHouse ? await this.getActiveRole(selectedHouse.id, actor.id) : undefined;
    const activeId = selectedHouse && (this.demoMode || selectedHouse.isDemo || activeGrant)
      ? selectedHouse.id : undefined;
    return {
      houses: rows.map((row) => ({
        id: row.id,
        address: row.address,
        isActive: row.id === activeId,
        isDemo: row.isDemo,
      })),
      ...(activeId ? { activeHouseId: activeId, activeRole: selectedHouse?.isDemo ? actor.role : activeGrant ?? actor.role } : {}),
      onboardingRequired: rows.length === 0,
      accessPending: rows.length > 0 && !activeId && !this.demoMode,
    };
  }

  async addHouse(actor: AuthenticatedActor, input: VerifiedHouse): Promise<HouseContextDto> {
    const selected = await this.db.transaction(async (tx) => {
      const [known] = await tx.select({ id: houses.id }).from(houses)
        .where(eq(houses.fiasId, input.fiasId)).limit(1);
      const [legacy] = known ? [] : await tx.select({ id: houses.id }).from(houses)
        .where(and(eq(houses.normalizedAddress, legacyAddressKey(input)), isNull(houses.fiasId)))
        .limit(1);
      let houseId = known?.id || legacy?.id;
      if (legacy) {
        await tx.update(houses).set({ fiasId: input.fiasId, address: input.address })
          .where(eq(houses.id, legacy.id));
      }
      if (!houseId) {
        const [house] = await tx.insert(houses).values({
          fiasId: input.fiasId,
          address: input.address,
          normalizedAddress: `gar|${input.fiasId}`,
        }).onConflictDoUpdate({ target: houses.fiasId, set: { address: input.address } })
          .returning({ id: houses.id });
        if (!house) throw new Error('Не удалось сохранить адрес');
        houseId = house.id;
      }
      const now = new Date();
      await tx
        .insert(houseMembers)
        .values({ houseId, userId: actor.id, isFavorite: true, lastUsedAt: now })
        .onConflictDoUpdate({
          target: [houseMembers.houseId, houseMembers.userId],
          set: { isFavorite: true, lastUsedAt: now },
        });
      await tx.update(users).set({ activeHouseId: houseId }).where(eq(users.id, actor.id));
      return houseId;
    });
    actor.houseId = selected;
    return this.getHouseContext(await this.refreshActor(actor));
  }

  async joinDemoHouse(actor: AuthenticatedActor, houseId: string): Promise<HouseContextDto> {
    const [house] = await this.db.select({ id: houses.id }).from(houses)
      .where(and(eq(houses.id, houseId), eq(houses.isDemo, true))).limit(1);
    if (!house) throw new NotFoundError('Демонстрационный дом не найден');
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.insert(houseMembers)
        .values({ houseId, userId: actor.id, isFavorite: true, lastUsedAt: now })
        .onConflictDoUpdate({
          target: [houseMembers.houseId, houseMembers.userId],
          set: { isFavorite: true, lastUsedAt: now },
        });
      await tx.update(users).set({ activeHouseId: houseId }).where(eq(users.id, actor.id));
    });
    actor.houseId = houseId;
    return this.getHouseContext(await this.refreshActor(actor));
  }

  async selectHouse(actor: AuthenticatedActor, houseId: string): Promise<HouseContextDto> {
    const [membership] = await this.db
      .select({ houseId: houseMembers.houseId })
      .from(houseMembers)
      .where(
        and(
          eq(houseMembers.userId, actor.id),
          eq(houseMembers.houseId, houseId),
          eq(houseMembers.isFavorite, true),
        ),
      )
      .limit(1);
    if (!membership) throw new ForbiddenError('Сначала добавьте этот адрес в «Мои дома»');
    const now = new Date();
    await Promise.all([
      this.db.update(users).set({ activeHouseId: houseId }).where(eq(users.id, actor.id)),
      this.db
        .update(houseMembers)
        .set({ lastUsedAt: now })
        .where(and(eq(houseMembers.userId, actor.id), eq(houseMembers.houseId, houseId))),
    ]);
    actor.houseId = houseId;
    return this.getHouseContext(await this.refreshActor(actor));
  }

  async listCases(actor: AuthenticatedActor, status?: CaseStatus): Promise<CaseDto[]> {
    const houseId = activeHouseId(actor);
    if (actor.role === 'authority') throw new ForbiddenError('Доступна только сводная статистика');
    const rows = await this.db
      .select({ id: cases.id })
      .from(cases)
      .where(and(eq(cases.houseId, houseId), status ? eq(cases.status, status) : undefined))
      .orderBy(desc(cases.updatedAt));
    return Promise.all(rows.map(({ id }) => this.hydrate(actor, id)));
  }

  async getHouseReport(actor: AuthenticatedActor): Promise<HouseReportDto> {
    if (!['dispatcher', 'authority', 'admin'].includes(actor.role)) {
      throw new ForbiddenError('Сводка доступна УК и уполномоченным органам');
    }
    const houseId = activeHouseId(actor);
    const [house, rows] = await Promise.all([
      this.db.select({ address: houses.address }).from(houses)
        .where(eq(houses.id, houseId)).limit(1),
      this.db.select({ id: cases.id }).from(cases).where(eq(cases.houseId, houseId)),
    ]);
    if (!house[0]) throw new NotFoundError('Дом не найден');
    const items = await Promise.all(rows.map(({ id }) => this.hydrate(actor, id)));
    return makeHouseReport(houseId, house[0].address, items);
  }

  async getCase(actor: AuthenticatedActor, caseId: string): Promise<CaseDto> {
    if (actor.role === 'authority') throw new ForbiddenError('Доступна только сводная статистика');
    return this.hydrate(actor, caseId);
  }

  async findDuplicates(
    actor: AuthenticatedActor,
    input: DuplicateSearchInput,
  ): Promise<CaseDto[]> {
    const houseId = activeHouseId(actor);
    if (actor.role === 'authority') throw new ForbiddenError('Доступна только сводная статистика');
    assertAcceptableCaseText({ 'Описание': input.description, 'Место': input.place });
    const inputText = normalized(`${input.place} ${input.description}`);
    const similarity = sql<number>`similarity(${cases.normalizedText}, ${inputText})`;
    const rows = await this.db
      .select({ id: cases.id, score: similarity })
      .from(cases)
      .where(
        and(
          eq(cases.houseId, houseId),
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
    assertAcceptableCaseText({ 'Заголовок': input.title, 'Описание': input.description, 'Место': input.place, 'Подъезд': input.entrance });
    const houseId = activeHouseId(actor);
    if (input.duplicateCaseId) return this.confirmCase(actor, input.duplicateCaseId);
    const [house] = await this.db.select({ isDemo: houses.isDemo }).from(houses)
      .where(eq(houses.id, houseId)).limit(1);
    if (!house) throw new NotFoundError('Дом не найден');

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
          houseId,
          authorId: actor.id,
          title: input.title,
          description: input.description,
          category: input.category,
          ...(input.entrance ? { entrance: input.entrance } : {}),
          place: input.place,
          normalizedText: normalized(`${input.place} ${input.description}`),
          status: 'registered',
          responsibleOrganization: 'Адресат уточняется диспетчером',
          isDemo: this.demoMode || house.isDemo,
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

  async unwatchCase(actor: AuthenticatedActor, caseId: string): Promise<CaseDto> {
    await this.ensureVisible(actor, caseId);
    await this.db
      .delete(caseWatchers)
      .where(and(eq(caseWatchers.caseId, caseId), eq(caseWatchers.userId, actor.id)));
    return this.hydrate(actor, caseId);
  }

  async transitionCase(
    actor: AuthenticatedActor,
    caseId: string,
    input: TransitionCaseInput,
  ): Promise<CaseDto> {
    const current = await this.ensureVisible(actor, caseId);
    const houseId = activeHouseId(actor);
    assertTransitionAllowed(current.status, input.status, actor.role);
    assertAcceptableCaseText({ 'Исполнитель': input.assignee, 'Комментарий': input.comment });
    if (input.status === 'assigned' && !input.assignee?.trim()) {
      throw new ConflictError('Укажите исполнителя при назначении');
    }
    if (input.plannedCompletionAt && !['dispatcher', 'executor', 'admin'].includes(actor.role)) {
      throw new ForbiddenError('Плановую дату указывает диспетчер или исполнитель');
    }
    if (input.plannedCompletionAt && !['assigned', 'in_progress'].includes(input.status)) {
      throw new ConflictError('Плановая дата доступна при назначении или начале работ');
    }
    if (input.plannedCompletionAt && new Date(input.plannedCompletionAt).getTime() <= Date.now()) {
      throw new ConflictError('Плановая дата должна быть в будущем');
    }

    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(cases)
        .set({
          status: input.status,
          version: sql`${cases.version} + 1`,
          updatedAt: new Date(),
          ...(input.assignee ? { assignee: input.assignee } : {}),
          ...(input.plannedCompletionAt ? { plannedCompletionAt: new Date(input.plannedCompletionAt) } : {}),
          ...(['awaiting_resident_verification', 'resolved', 'disputed'].includes(input.status)
            ? { plannedCompletionAt: null }
            : {}),
          ...(input.comment && input.status === 'awaiting_resident_verification'
            ? { resultComment: input.comment }
            : {}),
        })
        .where(
          and(
            eq(cases.id, caseId),
            eq(cases.houseId, houseId),
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
        ...((input.assignee || input.comment) ? {
          comment: [input.assignee ? 'Исполнитель: ' + input.assignee : '', input.comment].filter(Boolean).join(' · '),
        } : {}),
        ...(input.plannedCompletionAt ? { plannedCompletionAt: new Date(input.plannedCompletionAt) } : {}),
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
    const houseId = activeHouseId(actor);
    const [item] = await this.db
      .select()
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.houseId, houseId)))
      .limit(1);
    if (!item) throw new NotFoundError('Дело не найдено');
    return item;
  }

  private async hydrate(actor: AuthenticatedActor, caseId: string): Promise<CaseDto> {
    const item = await this.ensureVisible(actor, caseId);
    const [[confirmationCount], [watcherCount], [ownWatch], historyRows, attachmentRows] = await Promise.all([
      this.db
        .select({ value: count() })
        .from(caseConfirmations)
        .where(eq(caseConfirmations.caseId, caseId)),
      this.db
        .select({ value: count() })
        .from(caseWatchers)
        .where(eq(caseWatchers.caseId, caseId)),
      this.db
        .select({ userId: caseWatchers.userId })
        .from(caseWatchers)
        .where(and(eq(caseWatchers.caseId, caseId), eq(caseWatchers.userId, actor.id)))
        .limit(1),
      this.db
        .select({
          id: caseStatusHistory.id,
          fromStatus: caseStatusHistory.fromStatus,
          toStatus: caseStatusHistory.toStatus,
          comment: caseStatusHistory.comment,
          plannedCompletionAt: caseStatusHistory.plannedCompletionAt,
          actorName: users.displayName,
          actorIsDemo: users.isDemo,
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
      isWatched: Boolean(ownWatch),
      responsibleOrganization: item.responsibleOrganization,
      ...(item.assignee ? { assignee: item.assignee } : {}),
      ...(item.resultComment ? { resultComment: item.resultComment } : {}),
      ...(item.plannedCompletionAt ? { plannedCompletionAt: item.plannedCompletionAt.toISOString() } : {}),
      version: item.version,
      isDemo: item.isDemo,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      history: historyRows.map((row) => ({
        id: row.id,
        ...(row.fromStatus ? { fromStatus: row.fromStatus } : {}),
        toStatus: row.toStatus,
        ...(row.comment ? { comment: row.comment } : {}),
        ...(row.plannedCompletionAt ? { plannedCompletionAt: row.plannedCompletionAt.toISOString() } : {}),
        actorName: item.isDemo && !row.actorIsDemo ? 'Участник демонстрации' : row.actorName,
        createdAt: row.createdAt.toISOString(),
      })),
      attachments: attachmentsWithUrls,
    };
  }
}
