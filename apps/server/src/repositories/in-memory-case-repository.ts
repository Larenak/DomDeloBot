import type {
  CaseDto,
  HouseReportDto,
  CreateCaseInput,
  DuplicateSearchInput,
  HouseContextDto,
  TransitionCaseInput,
} from '@domdelo/contracts';
import {
  assertTransitionAllowed,
  requiredCaseConfirmations,
  openCaseStatuses,
  type CaseStatus,
} from '@domdelo/domain';
import { randomUUID } from 'node:crypto';

import type { AuthenticatedActor } from '../types.js';
import type { VerifiedHouse } from '../services/address-provider.js';
import { makeHouseReport } from '../modules/cases/report.js';
import { caseDeadlineDto, startCaseDeadline } from '../modules/cases/deadline-policy.js';
import { assertAcceptableCaseText } from '../services/case-text-moderation.js';
import {
  AddressOnboardingRequiredError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type AttachmentUpload,
  type CaseRepository,
} from './case-repository.js';

export const DEMO_HOUSE_ID = '11111111-1111-4111-8111-111111111111';
export const DEMO_ADDRESS = 'г. Казань, ул. Спортивная, 12';

export const demoActors: Record<string, AuthenticatedActor> = {
  'resident-1': {
    id: '22222222-2222-4222-8222-222222222222',
    role: 'resident',
    displayName: 'Анна Петрова',
  },
  'resident-2': {
    id: '33333333-3333-4333-8333-333333333333',
    role: 'resident',
    displayName: 'Михаил Соколов',
  },
  'chair-1': {
    id: '30303030-3030-4030-8030-303030303030',
    role: 'chair',
    houseId: DEMO_HOUSE_ID,
    displayName: 'Марина, председатель совета дома',
  },
  'authority-1': {
    id: '40404040-4040-4040-8040-404040404040',
    role: 'authority',
    houseId: DEMO_HOUSE_ID,
    displayName: 'Представитель муниципалитета',
  },
  'dispatcher-1': {
    id: '44444444-4444-4444-8444-444444444444',
    role: 'dispatcher',
    displayName: 'Елена, диспетчер УК',
  },
  'executor-1': {
    id: '55555555-5555-4555-8555-555555555555',
    role: 'executor',
    displayName: 'Илья, электрик',
  },
};

function iso(minutesAgo = 0): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function seedCases(): CaseDto[] {
  return [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      number: 128,
      houseId: DEMO_HOUSE_ID,
      title: 'Не работает освещение в подъезде №2',
      description: 'На площадках второго и третьего этажей не горят лампы.',
      category: 'lighting',
      entrance: '2',
      place: 'Лестничная клетка',
      status: 'registered',
      confirmationsCount: 6,
      isConfirmed: false,
      submission: { requiredConfirmations: 2, registeredAccounts: 6, sentAt: iso(190), mode: 'demo' },
      watchersCount: 4,
      isWatched: false,
      canDelete: false,
      responsibleOrganization: 'УК «Наш дом»',
      version: 1,
      isDemo: true,
      createdAt: iso(190),
      updatedAt: iso(185),
      history: [
        {
          id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
          toStatus: 'registered',
          actorName: 'Анна Петрова',
          comment: 'Создано из сообщения в домовом чате',
          createdAt: iso(190),
        },
      ],
      attachments: [],
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      number: 127,
      houseId: DEMO_HOUSE_ID,
      title: 'Сломана защёлка входной двери',
      description: 'Дверь первого подъезда не закрывается и остаётся открытой ночью.',
      category: 'entrance',
      entrance: '1',
      place: 'Входная дверь',
      status: 'in_progress',
      confirmationsCount: 3,
      isConfirmed: false,
      submission: { requiredConfirmations: 2, registeredAccounts: 6, sentAt: iso(1440), mode: 'demo' },
      watchersCount: 5,
      isWatched: false,
      canDelete: false,
      responsibleOrganization: 'УК «Наш дом»',
      assignee: 'Мастер участка Сергей',
      version: 3,
      isDemo: true,
      createdAt: iso(1_440),
      updatedAt: iso(45),
      history: [
        {
          id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
          toStatus: 'registered',
          actorName: 'Михаил Соколов',
          createdAt: iso(1_440),
        },
        {
          id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
          fromStatus: 'registered',
          toStatus: 'assigned',
          actorName: 'Елена, диспетчер УК',
          comment: 'Назначен мастер участка',
          createdAt: iso(120),
        },
        {
          id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4',
          fromStatus: 'assigned',
          toStatus: 'in_progress',
          actorName: 'Елена, диспетчер УК',
          createdAt: iso(45),
        },
      ],
      attachments: [],
    },
  ];
}

function normalize(value: string): string[] {
  return value
    .toLocaleLowerCase('ru-RU')
    .replace(/[^a-zа-яё0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function similarity(left: string, right: string): number {
  const a = new Set(normalize(left));
  const b = new Set(normalize(right));
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / (a.size + b.size - intersection);
}

function ensureResidentOrAdmin(actor: AuthenticatedActor): void {
  if (!['resident', 'chair', 'admin'].includes(actor.role)) {
    throw new ForbiddenError('Действие доступно жильцу дома');
  }
}

function activeHouseId(actor: AuthenticatedActor): string {
  if (!actor.houseId) {
    throw new AddressOnboardingRequiredError('Сначала добавьте адрес дома');
  }
  return actor.houseId;
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

type StoredHouse = { id: string; address: string; normalizedAddress: string; isDemo: boolean; fiasId?: string };

export class InMemoryCaseRepository implements CaseRepository {
  private readonly items = seedCases();
  private readonly authors = new Map<string, string>([
    ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', demoActors['resident-1']!.id],
    ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', demoActors['resident-2']!.id],
  ]);
  private readonly confirmations = new Set<string>();
  private readonly watchers = new Set<string>();
  private readonly webhookEvents = new Set<string>();
  private readonly idempotencyKeys = new Map<string, string>();
  private readonly houses = new Map<string, StoredHouse>([
    [
      DEMO_HOUSE_ID,
      {
        id: DEMO_HOUSE_ID,
        address: 'г. Казань, ул. Спортивная, д. 12',
        normalizedAddress: 'казань|спортивная|12',
        isDemo: true,
      },
    ],
  ]);
  private readonly favoriteHouses = new Map<string, Set<string>>();
  private readonly activeHouseIds = new Map<string, string>();
  private readonly maxActors = new Map<bigint, AuthenticatedActor>();

  constructor() {
    for (const actorKey of ['chair-1', 'authority-1', 'dispatcher-1', 'executor-1']) {
      const actorId = demoActors[actorKey]!.id;
      this.favoriteHouses.set(actorId, new Set([DEMO_HOUSE_ID]));
      this.activeHouseIds.set(actorId, DEMO_HOUSE_ID);
    }
    for (const actorKey of ['resident-1', 'resident-2']) {
      const actor = demoActors[actorKey]!;
      this.confirmations.add(`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:${actor.id}`);
      this.confirmations.add(`bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:${actor.id}`);
      this.watchers.add(`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:${actor.id}`);
      this.watchers.add(`bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:${actor.id}`);
    }
  }

  async ready(): Promise<boolean> {
    return true;
  }

  async refreshActor(actor: AuthenticatedActor): Promise<AuthenticatedActor> {
    const demo = Object.values(demoActors).find((known) => known.id === actor.id);
    const houseId = this.activeHouseIds.get(actor.id);
    const { houseId: _previousHouseId, ...identity } = actor;
    return {
      ...identity,
      ...(houseId ? { houseId } : {}),
      role: houseId === DEMO_HOUSE_ID ? demo?.role ?? 'resident' : 'resident',
      isDemoHouse: houseId === DEMO_HOUSE_ID,
    };
  }

  async resolveMaxUser(input: { maxUserId: bigint; displayName: string }): Promise<AuthenticatedActor> {
    const existing = this.maxActors.get(input.maxUserId);
    if (existing) return existing;
    const actor: AuthenticatedActor = {
      id: randomUUID(),
      role: 'resident',
      displayName: input.displayName,
      maxUserId: input.maxUserId.toString(),
    };
    this.maxActors.set(input.maxUserId, actor);
    return actor;
  }

  async getHouseContext(actor: AuthenticatedActor): Promise<HouseContextDto> {
    const favorites = this.favoriteHouses.get(actor.id) || new Set<string>();
    const items = [...favorites]
      .map((id) => this.houses.get(id))
      .filter((house): house is NonNullable<typeof house> => Boolean(house));
    return {
      houses: items.map((house) => ({
        id: house.id,
        address: house.address,
        ...(house.fiasId ? { fiasId: house.fiasId } : {}),
        isActive: house.id === actor.houseId,
        isDemo: house.isDemo,
      })),
      ...(actor.houseId && favorites.has(actor.houseId) ? { activeHouseId: actor.houseId, activeRole: actor.role } : {}),
      onboardingRequired: items.length === 0,
      accessPending: false,
    };
  }

  async addHouse(actor: AuthenticatedActor, input: VerifiedHouse): Promise<HouseContextDto> {
    let house = [...this.houses.values()].find(
      (candidate) => candidate.fiasId === input.fiasId,
    );
    if (!house) {
      house = [...this.houses.values()].find(
        (candidate) => !candidate.fiasId && candidate.normalizedAddress === legacyAddressKey(input),
      );
      if (house) {
        house.fiasId = input.fiasId;
        house.address = input.address;
      }
    }
    if (!house) {
      house = {
        id: randomUUID(), address: input.address,
        normalizedAddress: `gar|${input.fiasId}`, fiasId: input.fiasId, isDemo: false,
      };
      this.houses.set(house.id, house);
    }
    const favorites = this.favoriteHouses.get(actor.id) || new Set<string>();
    favorites.add(house.id);
    this.favoriteHouses.set(actor.id, favorites);
    actor.houseId = house.id;
    this.activeHouseIds.set(actor.id, house.id);
    return this.getHouseContext(await this.refreshActor(actor));
  }

  async joinDemoHouse(actor: AuthenticatedActor, houseId: string): Promise<HouseContextDto> {
    if (houseId !== DEMO_HOUSE_ID || !this.houses.get(houseId)?.isDemo) {
      throw new NotFoundError('Демонстрационный дом не найден');
    }
    const favorites = this.favoriteHouses.get(actor.id) || new Set<string>();
    favorites.add(houseId);
    this.favoriteHouses.set(actor.id, favorites);
    this.activeHouseIds.set(actor.id, houseId);
    actor.houseId = houseId;
    return this.getHouseContext(await this.refreshActor(actor));
  }

  async selectHouse(actor: AuthenticatedActor, houseId: string): Promise<HouseContextDto> {
    if (!this.favoriteHouses.get(actor.id)?.has(houseId)) {
      throw new ForbiddenError('Сначала добавьте этот адрес в «Мои дома»');
    }
    actor.houseId = houseId;
    this.activeHouseIds.set(actor.id, houseId);
    return this.getHouseContext(await this.refreshActor(actor));
  }

  async removeHouse(actor: AuthenticatedActor, houseId: string): Promise<HouseContextDto> {
    const favorites = this.favoriteHouses.get(actor.id);
    if (!favorites?.delete(houseId)) throw new NotFoundError('Адрес не найден в вашем профиле');
    if (this.activeHouseIds.get(actor.id) === houseId) {
      const next = favorites.values().next().value as string | undefined;
      if (next) this.activeHouseIds.set(actor.id, next);
      else this.activeHouseIds.delete(actor.id);
    }
    return this.getHouseContext(await this.refreshActor(actor));
  }

  async listCases(actor: AuthenticatedActor, status?: CaseStatus): Promise<CaseDto[]> {
    if (actor.role === 'authority') throw new ForbiddenError('Доступна только сводная статистика');
    const houseId = activeHouseId(actor);
    return this.items
      .filter((item) => {
        if (item.houseId !== houseId) return false;
        this.releaseIfConfirmed(item);
        return (!['dispatcher', 'executor'].includes(actor.role) || item.status !== 'draft') && (!status || item.status === status);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((item) => this.viewCase(actor, item));
  }

  async getHouseReport(actor: AuthenticatedActor): Promise<HouseReportDto> {
    if (!['dispatcher', 'authority', 'admin'].includes(actor.role)) {
      throw new ForbiddenError('Сводка доступна УК и уполномоченным органам');
    }
    const houseId = activeHouseId(actor);
    return makeHouseReport(houseId, this.houses.get(houseId)?.address ?? DEMO_ADDRESS,
      this.items.filter((item) => {
        if (item.houseId !== houseId) return false;
        this.releaseIfConfirmed(item);
        return actor.role !== 'dispatcher' || item.status !== 'draft';
      }));
  }

  async getCase(actor: AuthenticatedActor, caseId: string): Promise<CaseDto> {
    const item = this.getMutable(actor, caseId);
    return this.viewCase(actor, item);
  }

  async deleteCase(actor: AuthenticatedActor, caseId: string): Promise<void> {
    const item = this.getMutable(actor, caseId);
    if (this.authors.get(caseId) !== actor.id) {
      throw new ForbiddenError('Удалить дело может только его автор');
    }
    this.items.splice(this.items.indexOf(item), 1);
    this.authors.delete(caseId);
    for (const entries of [this.confirmations, this.watchers]) {
      for (const key of entries) {
        if (key.startsWith(`${caseId}:`)) entries.delete(key);
      }
    }
    for (const [key, id] of this.idempotencyKeys) {
      if (id === caseId) this.idempotencyKeys.delete(key);
    }
  }

  async findDuplicates(
    actor: AuthenticatedActor,
    input: DuplicateSearchInput,
  ): Promise<CaseDto[]> {
    if (actor.role === 'authority') throw new ForbiddenError('Доступна только сводная статистика');
    const houseId = activeHouseId(actor);
    assertAcceptableCaseText({ 'Описание': input.description, 'Место': input.place });
    return this.items
      .filter(
        (item) =>
          item.houseId === houseId &&
          (!['dispatcher', 'executor'].includes(actor.role) || item.status !== 'draft') &&
          openCaseStatuses.includes(item.status) &&
          item.category === input.category &&
          (!input.entrance || !item.entrance || item.entrance === input.entrance),
      )
      .map((item) => ({
        item,
        score:
          similarity(`${input.place} ${input.description}`, `${item.place} ${item.description}`) +
          (item.place.toLocaleLowerCase('ru-RU') === input.place.toLocaleLowerCase('ru-RU')
            ? 0.35
            : 0),
      }))
      .filter(({ score }) => score >= 0.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ item }) => this.viewCase(actor, item));
  }

  async createCase(
    actor: AuthenticatedActor,
    input: CreateCaseInput,
    idempotencyKey: string,
  ): Promise<CaseDto> {
    ensureResidentOrAdmin(actor);
    const houseId = activeHouseId(actor);
    if (input.duplicateCaseId) {
      return this.confirmCase(actor, input.duplicateCaseId);
    }

    assertAcceptableCaseText({ 'Заголовок': input.title, 'Описание': input.description, 'Место': input.place, 'Подъезд': input.entrance });
    const idempotencyScope = `${actor.id}:${idempotencyKey}`;
    const existingId = this.idempotencyKeys.get(idempotencyScope);
    if (existingId) return this.getCase(actor, existingId);

    const createdAt = new Date().toISOString();
    const item: CaseDto = {
      id: randomUUID(),
      number: Math.max(0, ...this.items.map((candidate) => candidate.number)) + 1,
      houseId,
      title: input.title,
      description: input.description,
      category: input.category,
      ...(input.entrance ? { entrance: input.entrance } : {}),
      place: input.place,
      status: 'draft',
      submission: { requiredConfirmations: requiredCaseConfirmations(this.registeredAccounts(houseId)), registeredAccounts: this.registeredAccounts(houseId), mode: 'demo' },
      isConfirmed: true,
      confirmationsCount: 1,
      watchersCount: 1,
      isWatched: true,
      canDelete: true,
      responsibleOrganization: routeResponsibleOrganization(input.category),
      version: 1,
      isDemo: true,
      createdAt,
      updatedAt: createdAt,
      history: [
        {
          id: randomUUID(),
          toStatus: 'draft',
          actorName: actor.displayName,
          comment: 'Дело размещено. Собираем подтверждения жителей',
          createdAt,
        },
      ],
      attachments: [],
    };
    this.items.push(item);
    this.authors.set(item.id, actor.id);
    this.idempotencyKeys.set(idempotencyScope, item.id);
    this.confirmations.add(`${item.id}:${actor.id}`);
    this.watchers.add(`${item.id}:${actor.id}`);
    return this.viewCase(actor, item);
  }

  async confirmCase(actor: AuthenticatedActor, caseId: string): Promise<CaseDto> {
    ensureResidentOrAdmin(actor);
    const item = this.getMutable(actor, caseId);
    const key = `${caseId}:${actor.id}`;
    if (!this.confirmations.has(key)) {
      this.confirmations.add(key);
      item.confirmationsCount += 1;
      item.updatedAt = new Date().toISOString();
    }
    this.releaseIfConfirmed(item);
    return this.viewCase(actor, item);
  }

  async watchCase(actor: AuthenticatedActor, caseId: string): Promise<CaseDto> {
    const item = this.getMutable(actor, caseId);
    const key = `${caseId}:${actor.id}`;
    if (!this.watchers.has(key)) {
      this.watchers.add(key);
      item.watchersCount += 1;
      item.updatedAt = new Date().toISOString();
    }
    return this.viewCase(actor, item);
  }

  async unwatchCase(actor: AuthenticatedActor, caseId: string): Promise<CaseDto> {
    const item = this.getMutable(actor, caseId);
    const key = `${caseId}:${actor.id}`;
    if (this.watchers.delete(key)) {
      item.watchersCount -= 1;
      item.updatedAt = new Date().toISOString();
    }
    return this.viewCase(actor, item);
  }

  async transitionCase(
    actor: AuthenticatedActor,
    caseId: string,
    input: TransitionCaseInput,
  ): Promise<CaseDto> {
    const item = this.getMutable(actor, caseId);
    if (item.version !== input.expectedVersion) {
      throw new ConflictError('Карточка уже изменилась. Обновите данные и повторите действие.');
    }
    if (item.status === 'draft') throw new ForbiddenError('Сначала нужны подтверждения жителей');
    assertTransitionAllowed(item.status, input.status, actor.role);
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

    const previous = item.status;
    item.status = input.status;
    item.version += 1;
    item.updatedAt = new Date().toISOString();
    if (item.deadline) {
      if (input.status === 'awaiting_resident_verification' || (input.status === 'resolved' && !item.deadline.stoppedAt)) {
        item.deadline.stoppedAt = item.updatedAt;
      } else if (input.status === 'disputed') {
        delete item.deadline.stoppedAt;
      }
    }
    if (input.assignee) item.assignee = input.assignee;
    if (input.plannedCompletionAt) item.plannedCompletionAt = input.plannedCompletionAt;
    if (['awaiting_resident_verification', 'resolved', 'disputed'].includes(input.status)) {
      delete item.plannedCompletionAt;
    }
    if (input.comment && input.status === 'awaiting_resident_verification') {
      item.resultComment = input.comment;
    }
    item.history.push({
      id: randomUUID(),
      fromStatus: previous,
      toStatus: input.status,
      actorName: actor.displayName,
      ...((input.assignee || input.comment) ? {
        comment: [input.assignee ? 'Исполнитель: ' + input.assignee : '', input.comment].filter(Boolean).join(' · '),
      } : {}),
      ...(input.plannedCompletionAt ? { plannedCompletionAt: input.plannedCompletionAt } : {}),
      createdAt: item.updatedAt,
    });
    return this.viewCase(actor, item);
  }

  async addAttachment(
    actor: AuthenticatedActor,
    caseId: string,
    upload: AttachmentUpload,
  ): Promise<CaseDto> {
    const item = this.getMutable(actor, caseId);
    if (upload.kind === 'result' && !['dispatcher', 'executor', 'admin'].includes(actor.role)) {
      throw new ForbiddenError('Фото результата может добавить исполнитель или диспетчер');
    }
    item.attachments.push({
      id: randomUUID(),
      kind: upload.kind,
      url: upload.url,
      fileName: upload.fileName,
      mimeType: upload.mimeType,
      createdAt: new Date().toISOString(),
    });
    item.updatedAt = new Date().toISOString();
    return this.viewCase(actor, item);
  }

  async saveWebhookEvent(eventId: string): Promise<boolean> {
    if (this.webhookEvents.has(eventId)) return false;
    this.webhookEvents.add(eventId);
    return true;
  }

  private registeredAccounts(houseId: string): number {
    return [...this.favoriteHouses.values()].filter((houses) => houses.has(houseId)).length;
  }

  private releaseIfConfirmed(item: CaseDto): void {
    if (item.status !== 'draft') return;
    const required = requiredCaseConfirmations(this.registeredAccounts(item.houseId));
    item.submission.requiredConfirmations = required;
    if (item.confirmationsCount < required) return;
    const sentAt = new Date().toISOString();
    item.status = 'registered';
    item.submission.sentAt = sentAt;
    item.version += 1;
    item.updatedAt = sentAt;
    const deadline = startCaseDeadline(item.category, new Date(sentAt));
    const deadlineDto = caseDeadlineDto({ policyKey: deadline.policyKey, startedAt: deadline.startedAt, dueAt: deadline.dueAt });
    if (deadlineDto) item.deadline = deadlineDto;
    item.history.push({ id: randomUUID(), fromStatus: 'draft', toStatus: 'registered', actorName: 'ДомДело',
      comment: 'Дело успешно отправлено диспетчеру УК (демонстрационный режим)', createdAt: sentAt });
  }

  private getMutable(actor: AuthenticatedActor, caseId: string): CaseDto {
    const houseId = activeHouseId(actor);
    if (actor.role === 'authority') throw new ForbiddenError('Доступна только сводная статистика');
    const item = this.items.find((candidate) => candidate.id === caseId);
    if (!item || item.houseId !== houseId) {
      throw new NotFoundError('Дело не найдено');
    }
    this.releaseIfConfirmed(item);
    if (item.status === 'draft' && ['dispatcher', 'executor'].includes(actor.role)) {
      throw new NotFoundError('Дело ещё не отправлено диспетчеру');
    }
    return item;
  }

  private viewCase(actor: AuthenticatedActor, item: CaseDto): CaseDto {
    this.releaseIfConfirmed(item);
    const started = startCaseDeadline(item.category, new Date(item.submission.sentAt ?? item.createdAt));
    const fallbackDeadline = caseDeadlineDto({
      policyKey: started.policyKey,
      startedAt: started.startedAt,
      dueAt: started.dueAt,
      stoppedAt: ['awaiting_resident_verification', 'resolved'].includes(item.status) ? item.updatedAt : undefined,
    });
    return {
      ...structuredClone(item),
      ...(item.status === 'draft' || item.deadline ? {} : fallbackDeadline ? { deadline: fallbackDeadline } : {}),
      isConfirmed: this.confirmations.has(`${item.id}:${actor.id}`),
      submission: { ...item.submission, registeredAccounts: this.registeredAccounts(item.houseId), requiredConfirmations: item.submission.sentAt ? item.submission.requiredConfirmations : requiredCaseConfirmations(this.registeredAccounts(item.houseId)) },
      isWatched: this.watchers.has(`${item.id}:${actor.id}`),
      canDelete: this.authors.get(item.id) === actor.id,
    };
  }
}

export function routeResponsibleOrganization(category: string): string {
  if (['lighting', 'entrance', 'elevator', 'heating'].includes(category)) return 'УК «Наш дом»';
  if (category === 'water') return 'Ресурсоснабжающая организация';
  if (category === 'yard') return 'УК «Наш дом» / муниципальная служба';
  return 'Диспетчер дома уточнит ответственного';
}
