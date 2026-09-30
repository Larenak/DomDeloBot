// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CaseDto } from '@domdelo/contracts';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { caseApi } from '../api.js';
import { CaseDetailPage } from './CaseDetailPage.js';

const item: CaseDto = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', houseId: '11111111-1111-4111-8111-111111111111',
  number: 128, title: 'Не горит свет', description: 'На площадке не горит свет.', category: 'lighting',
  place: 'Площадка', status: 'registered', confirmationsCount: 2, watchersCount: 2,
  isConfirmed: true, submission: { requiredConfirmations: 2, registeredAccounts: 6, mode: 'demo' },
  isWatched: true, canDelete: true, responsibleOrganization: 'УК', version: 1, isDemo: false,
  createdAt: '2026-09-30T10:00:00.000Z', updatedAt: '2026-09-30T10:00:00.000Z', history: [], attachments: [],
};
let root: Root | undefined;
let client: QueryClient | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  client?.clear();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function renderCase(canDelete = true, caseData: CaseDto = item) {
  vi.spyOn(caseApi, 'get').mockResolvedValue({ ...caseData, canDelete });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['cases'], [item]);
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(
    <QueryClientProvider client={client!}>
      <MemoryRouter initialEntries={['/cases/' + item.id]}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetailPage demoMode={false} role="resident" />} />
          <Route path="/" element={<h1>Список дел</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.body.textContent).toContain(item.title);
  });
}
function button(label: string) {
  const result = [...document.querySelectorAll('button')].find((entry) => entry.textContent === label);
  expect(result).toBeDefined();
  return result!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}

describe('case deletion interface', () => {
  it('hides deletion for other authors', async () => {
    await renderCase(false);
    expect(document.body.textContent).not.toContain('Удалить дело');
  });

  it('requires confirmation, supports cancellation and returns to the refreshed list', async () => {
    const remove = vi.spyOn(caseApi, 'remove').mockResolvedValue({ deleted: true });
    await renderCase();
    await click('Удалить дело');
    expect(document.body.textContent).toContain('Удалить дело №128?');
    expect(remove).not.toHaveBeenCalled();
    await click('Отмена');
    expect(document.body.textContent).not.toContain('Восстановить его не получится');
    expect(remove).not.toHaveBeenCalled();
    await click('Удалить дело');
    await click('Да, удалить дело');
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.body.textContent).toContain('Список дел');
    });
    expect(remove).toHaveBeenCalledExactlyOnceWith(item.id);
    expect(client!.getQueryData(['case', item.id])).toBeUndefined();
    expect(client!.getQueryState(['cases'])?.isInvalidated).toBe(true);
  });

  it('shows a server rejection and keeps the case open', async () => {
    vi.spyOn(caseApi, 'remove').mockRejectedValue(new Error('Удалить дело может только его автор'));
    await renderCase();
    await click('Удалить дело');
    await click('Да, удалить дело');
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.querySelector('.form-error')?.textContent).toBe('Удалить дело может только его автор');
    });
    expect(document.body.textContent).toContain(item.title);
    expect(button('Да, удалить дело').disabled).toBe(false);
  });
});

const pending: CaseDto = { ...item, status: 'draft', confirmationsCount: 2, isConfirmed: false,
  submission: { requiredConfirmations: 3, registeredAccounts: 21, mode: 'demo' } };

describe('confirmation progress and demonstration UK delivery', () => {
  it('shows the required count and counts the author without an extra click', async () => {
    await renderCase(true, { ...pending, confirmationsCount: 1, isConfirmed: true });
    expect(document.body.textContent).toContain('Подтверждений для отправки в УК: 1 из 3');
    expect(document.body.textContent).toContain('Нужно ещё 2. Автор уже учтён.');
    expect(document.querySelector('progress')?.max).toBe(3);
    expect(button('✓ Вы подтвердили проблему').disabled).toBe(true);
    expect(document.body.textContent).not.toContain('Составить обращение');
    expect(document.body.textContent).not.toContain('Дело успешно отправлено');
  });

  it('shows sending success immediately when the final neighbour confirms', async () => {
    const sent = { ...pending, status: 'registered' as const, confirmationsCount: 3, isConfirmed: true,
      submission: { ...pending.submission, sentAt: '2026-09-30T12:00:00.000Z' } };
    const confirm = vi.spyOn(caseApi, 'confirm').mockResolvedValue(sent);
    await renderCase(false, pending);
    await click('У меня тоже');
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.body.textContent).toContain('Дело успешно отправлено диспетчеру УК');
    });
    expect(confirm).toHaveBeenCalledExactlyOnceWith(item.id);
    expect(document.body.textContent).toContain('Демонстрационная отправка в очередь УК');
    expect(document.body.textContent).toContain('Подтверждений: 3 из 3 необходимых.');
    expect(button('✓ Вы подтвердили проблему').disabled).toBe(true);
  });

  it('keeps collection progress and shows an error when confirmation fails', async () => {
    vi.spyOn(caseApi, 'confirm').mockRejectedValue(new Error('Подтверждение не сохранено'));
    await renderCase(false, pending);
    await click('У меня тоже');
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.querySelector('[role="alert"]')?.textContent).toBe('Подтверждение не сохранено');
    });
    expect(document.body.textContent).toContain('Подтверждений для отправки в УК: 2 из 3');
    expect(document.body.textContent).not.toContain('Дело успешно отправлено');
    expect(button('У меня тоже').disabled).toBe(false);
  });
});
