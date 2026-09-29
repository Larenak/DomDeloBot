import type { CreatePollInput, PollDto } from '@domdelo/contracts';

import type { AuthenticatedActor } from '../types.js';

export interface PollRepository {
  list(actor: AuthenticatedActor): Promise<PollDto[]>;
  create(actor: AuthenticatedActor, input: CreatePollInput): Promise<PollDto>;
  vote(actor: AuthenticatedActor, pollId: string, optionId: string): Promise<PollDto>;
}
