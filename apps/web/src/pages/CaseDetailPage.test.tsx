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

async function renderCase(canDelete = true) {
  vi.spyOn(caseApi, 'get').mockResolvedValue({ ...item, canDelete });
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
