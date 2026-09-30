import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../db/client.js';
import { checkHouseManagement } from './house-management.js';

function harness(initial: Record<string, unknown>, members: number[]) {
  const row = { ...initial };
  const actions: string[] = [];
  const messages: string[] = [];
  const saved: Record<string, unknown>[] = [];
  const query = {
    from() { return this; }, innerJoin() { return this; }, leftJoin() { return this; },
    where: async () => [{ ...row }],
  };
  const db = {
    select: () => query,
    insert: () => ({ values: (value: Record<string, unknown>) => ({
      onConflictDoUpdate: async () => { saved.push(value); Object.assign(row, value); },
    }) }),
  } as unknown as Database;
  const notifier = {
    configured: true,
    chatAdminAccess: vi.fn(async () => ({ isAdmin: true, canRemoveMembers: true })),
    chatMembers: vi.fn(async () => members),
    postToChat: vi.fn(async () => { actions.push('missing'); return 'notice-1'; }),
    pinChatMessage: vi.fn(async () => { actions.push('pin'); }),
    removeChatMember: vi.fn(async () => { actions.push('remove'); }),
    sendToChat: vi.fn(async (_chatId: number, text: string) => { actions.push('message'); messages.push(text); }),
    clearMissingPin: vi.fn(async () => { actions.push('unpin'); }),
    sendToUser: vi.fn(async () => {}),
    answerCallback: vi.fn(async () => {}),
  };
  const logger = { warn: vi.fn() };
  const run = () => checkHouseManagement(db, notifier, logger as never);
  return { db, notifier, logger, actions, messages, saved, row, run };
}

const base = {
  chatId: 123n, address: 'ул. Тестовая, 1', organization: null,
  currentId: null, previousId: null, revision: null,
  checkedAt: null, announcedRevision: null, presence: null,
  missingNoticeId: null, previousRemovedRevision: null, actionNoticeKey: null,
};
const changed = {
  ...base, organization: 'Новая УК', currentId: 22n, previousId: 11n,
  revision: 2, announcedRevision: 1, previousRemovedRevision: 1,
  presence: 'missing', missingNoticeId: 'notice-1',
};

describe('daily house management check', () => {
  it('posts and attempts to pin the missing representative notice', async () => {
    const h = harness(base, []);
    await h.run();
    expect(h.actions).toEqual(['missing', 'pin']);
    expect(h.row).toMatchObject({ presence: 'missing', missingNoticeId: 'notice-1' });
  });

  it('announces a new UK, removes only its verified predecessor and clears the absence pin', async () => {
    const h = harness(changed, [11, 22]);
    await h.run();
    expect(h.actions).toEqual(['message', 'remove', 'unpin']);
    expect(h.messages[0]).toContain('сменилась управляющая компания. Новая УК — «Новая УК»');
    expect(h.notifier.removeChatMember).toHaveBeenCalledWith(123, 11);
    expect(h.row).toMatchObject({ presence: 'present', announcedRevision: 2, previousRemovedRevision: 2 });
  });

  it('announces the change even before the new representative joins and requests a manual invitation', async () => {
    const h = harness(changed, [11]);
    await h.run();
    expect(h.messages[0]).toContain('Новая УК — «Новая УК»');
    expect(h.messages[1]).toContain('нужно пригласить его вручную');
    expect(h.messages[1]).toContain('API MAX не поддерживает добавление участников ботом');
    expect(h.row.presence).toBe('missing');
  });

  it('warns once without admin rights and retries deletion after rights are granted', async () => {
    const h = harness(changed, [11, 22]);
    h.notifier.chatAdminAccess.mockResolvedValue({ isAdmin: false, canRemoveMembers: false });
    await h.run();
    expect(h.messages[1]).toContain('У бота нет прав администратора');
    expect(h.messages[1]).toContain('MAX ID 11');
    expect(h.notifier.removeChatMember).not.toHaveBeenCalled();
    expect(h.row.previousRemovedRevision).toBe(1);
    await h.run();
    expect(h.messages).toHaveLength(2);
    h.notifier.chatAdminAccess.mockResolvedValue({ isAdmin: true, canRemoveMembers: true });
    await h.run();
    expect(h.notifier.removeChatMember).toHaveBeenCalledTimes(1);
    expect(h.row).toMatchObject({ previousRemovedRevision: 2, actionNoticeKey: null });
    expect(h.messages).toHaveLength(2);
  });

  it('warns about the missing member removal permission even for an admin bot', async () => {
    const h = harness(changed, [11, 22]);
    h.notifier.chatAdminAccess.mockResolvedValue({ isAdmin: true, canRemoveMembers: false });
    await h.run();
    expect(h.messages[1]).toContain('с правом удаления участников');
    expect(h.notifier.removeChatMember).not.toHaveBeenCalled();
    expect(h.row.previousRemovedRevision).toBe(1);
  });

  it('announces and saves a warning when MAX rejects removal, without repeated messages', async () => {
    const h = harness(changed, [11, 22]);
    h.notifier.removeChatMember.mockRejectedValue({ status: 403 });
    await h.run();
    await h.run();
    expect(h.messages).toHaveLength(2);
    expect(h.messages[0]).toContain('Новая УК — «Новая УК»');
    expect(h.messages[1]).toContain('Не удалось удалить');
    expect(h.row).toMatchObject({ announcedRevision: 2, previousRemovedRevision: 1 });
  });

  it('keeps the change announcement when member lookup is denied and warns once', async () => {
    const h = harness(changed, []);
    h.notifier.chatMembers.mockRejectedValue({ status: 403 });
    await h.run();
    await h.run();
    expect(h.messages).toHaveLength(2);
    expect(h.messages[0]).toContain('Новая УК — «Новая УК»');
    expect(h.messages[1]).toContain('нет доступа к списку участников');
    expect(h.notifier.postToChat).not.toHaveBeenCalled();
    expect(h.row.announcedRevision).toBe(2);
  });

  it('asks for a manual invitation and warns about admin rights when only the new account is absent', async () => {
    const h = harness({ ...changed, previousId: null }, []);
    h.notifier.chatAdminAccess.mockResolvedValue({ isAdmin: false, canRemoveMembers: false });
    await h.run();
    expect(h.messages[1]).toContain('У бота нет прав администратора');
    expect(h.messages[1]).toContain('MAX ID 22');
    expect(h.messages[1]).toContain('пригласить его вручную');
    expect(h.notifier.removeChatMember).not.toHaveBeenCalled();
    expect(h.row.previousRemovedRevision).toBe(2);
  });
  it('announces the new UK and warns once when MAX denies the bot rights check', async () => {
    const h = harness(changed, [11, 22]);
    h.notifier.chatAdminAccess.mockRejectedValue({ status: 403 });
    await h.run();
    await h.run();
    expect(h.messages).toHaveLength(2);
    expect(h.messages[0]).toContain('Новая УК — «Новая УК»');
    expect(h.messages[1]).toContain('MAX не разрешил проверить права бота');
    expect(h.notifier.removeChatMember).not.toHaveBeenCalled();
    expect(h.row.announcedRevision).toBe(2);
  });

});
