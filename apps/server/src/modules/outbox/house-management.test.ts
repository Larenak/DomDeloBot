import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../db/client.js';
import type { BotNotifier } from '../../services/max-notifier.js';
import { checkHouseManagement } from './house-management.js';

function harness(row: Record<string, unknown>, members: number[]) {
  const actions: string[] = [];
  const saved: Record<string, unknown>[] = [];
  const query = {
    from() { return this; }, innerJoin() { return this; }, leftJoin() { return this; },
    where: async () => [row],
  };
  const db = {
    select: () => query,
    insert: () => ({ values: (value: Record<string, unknown>) => ({
      onConflictDoUpdate: async () => { saved.push(value); },
    }) }),
  } as unknown as Database;
  const notifier = {
    configured: true,
    chatMembers: vi.fn(async () => members),
    postToChat: vi.fn(async () => { actions.push('missing'); return 'notice-1'; }),
    pinChatMessage: vi.fn(async () => { actions.push('pin'); }),
    removeChatMember: vi.fn(async () => { actions.push('remove'); }),
    sendToChat: vi.fn(async () => { actions.push('new'); }),
    clearMissingPin: vi.fn(async () => { actions.push('unpin'); }),
  } as unknown as BotNotifier;
  const logger = { warn: vi.fn() };
  return { db, notifier, logger, actions, saved };
}

const base = {
  chatId: 123n, address: 'ул. Тестовая, 1', organization: null,
  currentId: null, previousId: null, revision: null,
  checkedAt: null, announcedRevision: null, presence: null,
  missingNoticeId: null, previousRemovedRevision: null,
};

describe('daily house management check', () => {
  it('posts and attempts to pin the missing representative notice', async () => {
    const h = harness(base, []);
    await checkHouseManagement(h.db, h.notifier, h.logger as never);
    expect(h.actions).toEqual(['missing', 'pin']);
    expect(h.saved[0]).toMatchObject({ presence: 'missing', missingNoticeId: 'notice-1' });
  });

  it('removes only the previously verified service account and announces the new one', async () => {
    const h = harness({ ...base, organization: 'Новая УК', currentId: 22n,
      previousId: 11n, revision: 2, announcedRevision: 1,
      previousRemovedRevision: 1, presence: 'missing', missingNoticeId: 'notice-1',
    }, [11, 22]);
    await checkHouseManagement(h.db, h.notifier, h.logger as never);
    expect(h.actions).toEqual(['remove', 'new', 'unpin']);
    expect(h.notifier.removeChatMember).toHaveBeenCalledWith(123, 11);
    expect(h.saved[0]).toMatchObject({ presence: 'present', announcedRevision: 2, previousRemovedRevision: 2 });
  });

  it('does not report the new UK when its account is absent', async () => {
    const h = harness({ ...base, organization: 'Новая УК', currentId: 22n,
      previousId: 11n, revision: 2, announcedRevision: 1,
      previousRemovedRevision: 1, presence: 'missing',
    }, [11]);
    await checkHouseManagement(h.db, h.notifier, h.logger as never);
    expect(h.actions).toEqual(['remove', 'missing', 'pin']);
  });
});
