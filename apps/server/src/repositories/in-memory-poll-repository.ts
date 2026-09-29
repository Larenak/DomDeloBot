import type { CreatePollInput, PollDto } from '@domdelo/contracts';
import { randomUUID } from 'node:crypto';

import type { AuthenticatedActor } from '../types.js';
import { AddressOnboardingRequiredError, ConflictError, ForbiddenError, NotFoundError } from './case-repository.js';
import { DEMO_HOUSE_ID } from './in-memory-case-repository.js';
import type { PollRepository } from './poll-repository.js';

function activeHouseId(actor: AuthenticatedActor): string {
  if (!actor.houseId) throw new AddressOnboardingRequiredError('Сначала добавьте адрес дома');
  return actor.houseId;
}

export class InMemoryPollRepository implements PollRepository {
  private readonly polls: PollDto[] = [];
  private readonly votes = new Map<string, string>();

  constructor() {
    this.polls.push({
      id: '51515151-5151-4515-8515-515151515151',
      houseId: DEMO_HOUSE_ID,
      question: 'Как улучшить освещение двора?',
      options: [
        { id: '61616161-6161-4616-8616-616161616161', label: 'Добавить фонари у дорожек', votes: 0 },
        { id: '71717171-7171-4717-8717-717171717171', label: 'Осветить детскую площадку', votes: 0 },
      ],
      closesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      createdAt: new Date().toISOString(),
      totalVotes: 0,
      isDemo: true,
    });
  }

  async list(actor: AuthenticatedActor): Promise<PollDto[]> {
    const houseId = activeHouseId(actor);
    return this.polls.filter((poll) => poll.houseId === houseId)
      .map((poll) => this.view(poll, actor.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(actor: AuthenticatedActor, input: CreatePollInput): Promise<PollDto> {
    if (!['chair', 'admin'].includes(actor.role)) {
      throw new ForbiddenError('Создать опрос может председатель совета дома');
    }
    if (new Date(input.closesAt).getTime() <= Date.now()) {
      throw new ConflictError('Дата завершения должна быть в будущем');
    }
    const labels = input.options.map((value) => value.trim());
    if (new Set(labels.map((value) => value.toLocaleLowerCase('ru-RU'))).size !== labels.length) {
      throw new ConflictError('Варианты ответа должны отличаться');
    }
    const poll: PollDto = {
      id: randomUUID(),
      houseId: activeHouseId(actor),
      question: input.question.trim(),
      options: labels.map((label) => ({ id: randomUUID(), label, votes: 0 })),
      closesAt: input.closesAt,
      createdAt: new Date().toISOString(),
      totalVotes: 0,
      isDemo: true,
    };
    this.polls.push(poll);
    return this.view(poll, actor.id);
  }

  async vote(actor: AuthenticatedActor, pollId: string, optionId: string): Promise<PollDto> {
    if (!['owner', 'chair'].includes(actor.role)) {
      throw new ForbiddenError('Голосовать может только подтверждённый собственник');
    }
    const poll = this.polls.find((item) => item.id === pollId && item.houseId === activeHouseId(actor));
    if (!poll) throw new NotFoundError('Опрос не найден');
    if (new Date(poll.closesAt).getTime() <= Date.now()) throw new ConflictError('Опрос завершён');
    const option = poll.options.find((item) => item.id === optionId);
    if (!option) throw new NotFoundError('Вариант ответа не найден');
    const key = poll.id + ':' + actor.id;
    const previous = this.votes.get(key);
    if (previous && previous !== optionId) throw new ConflictError('Ответ уже сохранён');
    if (!previous) {
      this.votes.set(key, optionId);
      option.votes += 1;
      poll.totalVotes += 1;
    }
    return this.view(poll, actor.id);
  }

  private view(poll: PollDto, userId: string): PollDto {
    const myOptionId = this.votes.get(poll.id + ':' + userId);
    return structuredClone({ ...poll, ...(myOptionId ? { myOptionId } : {}) });
  }
}
