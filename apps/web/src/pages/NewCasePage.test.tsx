// @vitest-environment jsdom
import type { CaseDto } from '@domdelo/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { caseApi } from '../api.js';
import { CaseDetailPage } from './CaseDetailPage.js';
import { NewCasePage } from './NewCasePage.js';

const item: CaseDto = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', houseId: '11111111-1111-4111-8111-111111111111',
  number: 128, title: 'Не горит свет', description: 'На площадке не горит свет.', category: 'lighting',
  place: 'Площадка', entrance: '2', status: 'registered', confirmationsCount: 1, watchersCount: 1,
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

async function renderForm() {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['cases'], []);
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(
    <QueryClientProvider client={client!}>
      <MemoryRouter initialEntries={['/new']}>
        <Routes>
          <Route path="/new" element={<NewCasePage />} />
          <Route path="/cases/:caseId" element={<CaseDetailPage demoMode={false} role="resident" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
  const fields = [...document.querySelectorAll('input, textarea')];
  for (const [index, value] of [item.title, item.place, item.entrance!, item.description].entries()) {
    const field = fields[index] as HTMLInputElement | HTMLTextAreaElement;
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}
async function submit() {
  await act(async () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
}
async function waitForText(text: string) {
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.body.textContent).toContain(text);
  });
}

describe('one-step case creation', () => {
  it('creates on the first click and immediately shows success without waiting for list or detail reloads', async () => {
    const create = vi.spyOn(caseApi, 'create').mockResolvedValue(item);
    const duplicates = vi.spyOn(caseApi, 'duplicates').mockResolvedValue([item]);
    vi.spyOn(caseApi, 'get').mockImplementation(() => new Promise(() => {}));
    await renderForm();
    const invalidate = vi.spyOn(client!, 'invalidateQueries').mockImplementation(() => new Promise(() => {}));
    await submit();
    await waitForText('Дело успешно размещено');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toEqual({
      title: item.title, description: item.description, category: item.category, place: item.place, entrance: item.entrance,
    });
    expect(duplicates).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cases'] });
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Дело успешно размещено');
    expect(document.body.textContent).toContain('Дело №128');
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
    expect(document.body.textContent).not.toContain('Похоже, это уже обсуждают');
    expect(document.body.textContent).not.toContain('Создать новое дело');
  });

  it('disables repeated submission while creation is pending', async () => {
    let resolve!: (value: CaseDto) => void;
    const create = vi.spyOn(caseApi, 'create').mockImplementation(() => new Promise(done => { resolve = done; }));
    vi.spyOn(caseApi, 'get').mockResolvedValue(item);
    await renderForm();
    await submit();
    await waitForText('Размещаем дело…');
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(create).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain('Дело успешно размещено');
    await act(async () => resolve(item));
    await waitForText('Дело успешно размещено');
  });

  it('keeps the entered problem on server rejection and allows retry', async () => {
    const create = vi.spyOn(caseApi, 'create').mockRejectedValueOnce(new Error('Не удалось разместить дело')).mockResolvedValue(item);
    vi.spyOn(caseApi, 'get').mockResolvedValue(item);
    await renderForm();
    await submit();
    await waitForText('Не удалось разместить дело');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Не удалось разместить дело');
    expect(document.querySelector('textarea')!.value).toBe(item.description);
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    expect(document.body.textContent).not.toContain('Дело успешно размещено');
    await submit();
    await waitForText('Дело успешно размещено');
    expect(create).toHaveBeenCalledTimes(2);
  });
});
