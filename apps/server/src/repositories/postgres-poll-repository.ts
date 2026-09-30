import type { CreatePollInput, PollDto } from '@domdelo/contracts';
import { and, count, desc, eq } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { houses, pollOptions, polls, pollVotes } from '../db/schema.js';
import type { AuthenticatedActor } from '../types.js';
import { AddressOnboardingRequiredError, ConflictError, ForbiddenError, NotFoundError } from './case-repository.js';
import type { PollRepository } from './poll-repository.js';

function activeHouseId(actor: AuthenticatedActor): string {
  if (!actor.houseId) throw new AddressOnboardingRequiredError('Сначала добавьте адрес дома');
  return actor.houseId;
}

export class PostgresPollRepository implements PollRepository {
  constructor(private readonly db: Database, private readonly demoMode: boolean) {}

  async list(actor: AuthenticatedActor): Promise<PollDto[]> {
    const rows = await this.db.select({ id: polls.id }).from(polls)
      .where(eq(polls.houseId, activeHouseId(actor))).orderBy(desc(polls.createdAt));
    return Promise.all(rows.map(({ id }) => this.hydrate(actor, id)));
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
    const id = await this.db.transaction(async (tx) => {
      const [created] = await tx.insert(polls).values({
        houseId: activeHouseId(actor), createdBy: actor.id,
        question: input.question.trim(), closesAt: new Date(input.closesAt),
      }).returning({ id: polls.id });
      if (!created) throw new Error('Не удалось создать опрос');
      await tx.insert(pollOptions).values(labels.map((label, position) => ({
        pollId: created.id, label, position,
      })));
      return created.id;
    });
    return this.hydrate(actor, id);
  }

  async vote(actor: AuthenticatedActor, pollId: string, optionId: string): Promise<PollDto> {
    if (!['resident', 'chair'].includes(actor.role)) {
      throw new ForbiddenError('Ответить на опрос может житель или председатель дома');
    }
    const [poll] = await this.db.select({ closesAt: polls.closesAt })
      .from(polls).where(and(eq(polls.id, pollId), eq(polls.houseId, activeHouseId(actor)))).limit(1);
    if (!poll) throw new NotFoundError('Опрос не найден');
    if (poll.closesAt.getTime() <= Date.now()) throw new ConflictError('Опрос завершён');
    const [option] = await this.db.select({ id: pollOptions.id }).from(pollOptions)
      .where(and(eq(pollOptions.id, optionId), eq(pollOptions.pollId, pollId))).limit(1);
    if (!option) throw new NotFoundError('Вариант ответа не найден');
    const [inserted] = await this.db.insert(pollVotes).values({
      pollId, userId: actor.id, optionId,
    }).onConflictDoNothing().returning({ userId: pollVotes.userId });
    if (!inserted) {
      const [previous] = await this.db.select({ optionId: pollVotes.optionId }).from(pollVotes)
        .where(and(eq(pollVotes.pollId, pollId), eq(pollVotes.userId, actor.id))).limit(1);
      if (previous?.optionId !== optionId) throw new ConflictError('Ответ уже сохранён');
    }
    return this.hydrate(actor, pollId);
  }

  private async hydrate(actor: AuthenticatedActor, pollId: string): Promise<PollDto> {
    const [poll] = await this.db.select().from(polls)
      .where(and(eq(polls.id, pollId), eq(polls.houseId, activeHouseId(actor)))).limit(1);
    if (!poll) throw new NotFoundError('Опрос не найден');
    const [demoHouse] = await this.db.select({ isDemo: houses.isDemo }).from(houses)
      .where(eq(houses.id, poll.houseId)).limit(1);
    const [options, counts, myVote] = await Promise.all([
      this.db.select().from(pollOptions).where(eq(pollOptions.pollId, pollId))
        .orderBy(pollOptions.position),
      this.db.select({ optionId: pollVotes.optionId, votes: count() }).from(pollVotes)
        .where(eq(pollVotes.pollId, pollId)).groupBy(pollVotes.optionId),
      this.db.select({ optionId: pollVotes.optionId }).from(pollVotes)
        .where(and(eq(pollVotes.pollId, pollId), eq(pollVotes.userId, actor.id))).limit(1),
    ]);
    const countByOption = new Map(counts.map((entry) => [entry.optionId, entry.votes]));
    return {
      id: poll.id,
      houseId: poll.houseId,
      question: poll.question,
      options: options.map((option) => ({
        id: option.id, label: option.label, votes: countByOption.get(option.id) ?? 0,
      })),
      closesAt: poll.closesAt.toISOString(),
      createdAt: poll.createdAt.toISOString(),
      totalVotes: counts.reduce((sum, entry) => sum + entry.votes, 0),
      ...(myVote[0] ? { myOptionId: myVote[0].optionId } : {}),
      isDemo: this.demoMode || Boolean(demoHouse?.isDemo),
    };
  }
}
