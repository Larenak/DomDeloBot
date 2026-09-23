import type {
  CaseDto,
  CreateCaseInput,
  DuplicateSearchInput,
  TransitionCaseInput,
} from '@domdelo/contracts';
import {
  assertTransitionAllowed,
  openCaseStatuses,
  type CaseStatus,
} from '@domdelo/domain';
import { randomUUID } from 'node:crypto';

import type { AuthenticatedActor } from '../types.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type AttachmentUpload,
  type CaseRepository,
} from './case-repository.js';

export const DEMO_HOUSE_ID = '11111111-1111-4111-8111-111111111111';

export const demoActors: Record<string, AuthenticatedActor> = {
  'resident-1': {
    id: '22222222-2222-4222-8222-222222222222',
    role: 'resident',
    houseId: DEMO_HOUSE_ID,
    displayName: 'Анна Петрова',
  },
  'resident-2': {
    id: '33333333-3333-4333-8333-333333333333',
    role: 'resident',
    houseId: DEMO_HOUSE_ID,
    displayName: 'Михаил Соколов',
  },
  'dispatcher-1': {
    id: '44444444-4444-4444-8444-444444444444',
    role: 'dispatcher',
    houseId: DEMO_HOUSE_ID,
    displayName: 'Елена, диспетчер УК',
  },
  'executor-1': {
    id: '55555555-5555-4555-8555-555555555555',
    role: 'executor',
    houseId: DEMO_HOUSE_ID,
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
      watchersCount: 4,
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
      watchersCount: 5,
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

function cloneCase(item: CaseDto): CaseDto {
  return structuredClone(item);
}

function ensureResidentOrAdmin(actor: AuthenticatedActor): void {
  if (!['resident', 'admin'].includes(actor.role)) {
    throw new ForbiddenError('Действие доступно жильцу дома');
  }
}

export class InMemoryCaseRepository implements CaseRepository {
  private readonly items = seedCases();
  private readonly confirmations = new Set<string>();
  private readonly watchers = new Set<string>();
  private readonly webhookEvents = new Set<string>();
  private readonly idempotencyKeys = new Map<string, string>();

  constructor() {
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

  async resolveMaxUser(): Promise<AuthenticatedActor> {
    return demoActors['resident-1']!;
  }

  async listCases(actor: AuthenticatedActor, status?: CaseStatus): Promise<CaseDto[]> {
    return this.items
      .filter((item) => item.houseId === actor.houseId && (!status || item.status === status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(cloneCase);
  }

  async getCase(actor: AuthenticatedActor, caseId: string): Promise<CaseDto> {
    const item = this.getMutable(actor, caseId);
    return cloneCase(item);
  }

  async findDuplicates(
    actor: AuthenticatedActor,
    input: DuplicateSearchInput,
  ): Promise<CaseDto[]> {
    return this.items
      .filter(
        (item) =>
          item.houseId === actor.houseId &&
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
      .map(({ item }) => cloneCase(item));
  }

  async createCase(
    actor: AuthenticatedActor,
    input: CreateCaseInput,
    idempotencyKey: string,
  ): Promise<CaseDto> {
    ensureResidentOrAdmin(actor);
    if (input.duplicateCaseId) {
      return this.confirmCase(actor, input.duplicateCaseId);
    }

    const idempotencyScope = `${actor.id}:${idempotencyKey}`;
    const existingId = this.idempotencyKeys.get(idempotencyScope);
    if (existingId) return this.getCase(actor, existingId);

    const createdAt = new Date().toISOString();
    const item: CaseDto = {
      id: randomUUID(),
      number: Math.max(...this.items.map((candidate) => candidate.number)) + 1,
      houseId: actor.houseId,
      title: input.title,
      description: input.description,
      category: input.category,
      ...(input.entrance ? { entrance: input.entrance } : {}),
      place: input.place,
      status: 'registered',
      confirmationsCount: 1,
      watchersCount: 1,
      responsibleOrganization: routeResponsibleOrganization(input.category),
      version: 1,
      isDemo: true,
      createdAt,
      updatedAt: createdAt,
      history: [
        {
          id: randomUUID(),
          toStatus: 'registered',
          actorName: actor.displayName,
          comment: 'Дело зарегистрировано',
          createdAt,
        },
      ],
      attachments: [],
    };
    this.items.push(item);
    this.idempotencyKeys.set(idempotencyScope, item.id);
    this.confirmations.add(`${item.id}:${actor.id}`);
    this.watchers.add(`${item.id}:${actor.id}`);
    return cloneCase(item);
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
    return cloneCase(item);
  }

  async watchCase(actor: AuthenticatedActor, caseId: string): Promise<CaseDto> {
    const item = this.getMutable(actor, caseId);
    const key = `${caseId}:${actor.id}`;
    if (!this.watchers.has(key)) {
      this.watchers.add(key);
      item.watchersCount += 1;
      item.updatedAt = new Date().toISOString();
    }
    return cloneCase(item);
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
    assertTransitionAllowed(item.status, input.status, actor.role);

    const previous = item.status;
    item.status = input.status;
    item.version += 1;
    item.updatedAt = new Date().toISOString();
    if (input.assignee) item.assignee = input.assignee;
    if (input.comment && input.status === 'awaiting_resident_verification') {
      item.resultComment = input.comment;
    }
    item.history.push({
      id: randomUUID(),
      fromStatus: previous,
      toStatus: input.status,
      actorName: actor.displayName,
      ...(input.comment ? { comment: input.comment } : {}),
      createdAt: item.updatedAt,
    });
    return cloneCase(item);
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
    return cloneCase(item);
  }

  async saveWebhookEvent(eventId: string): Promise<boolean> {
    if (this.webhookEvents.has(eventId)) return false;
    this.webhookEvents.add(eventId);
    return true;
  }

  private getMutable(actor: AuthenticatedActor, caseId: string): CaseDto {
    const item = this.items.find((candidate) => candidate.id === caseId);
    if (!item || item.houseId !== actor.houseId) {
      throw new NotFoundError('Дело не найдено');
    }
    return item;
  }
}

export function routeResponsibleOrganization(category: string): string {
  if (['lighting', 'entrance', 'elevator', 'heating'].includes(category)) return 'УК «Наш дом»';
  if (category === 'water') return 'Ресурсоснабжающая организация';
  if (category === 'yard') return 'УК «Наш дом» / муниципальная служба';
  return 'Диспетчер дома уточнит ответственного';
}
