// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { houseApi } from '../api.js';
import { DemoRoleLaunch } from './DemoRoleLaunch.js';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

let root: Root | undefined;
let client: QueryClient | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  client?.clear();
  localStorage.clear();
  document.body.innerHTML = '';
  navigate.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderDemo(role?: string, inMax = true) {
  const assign = navigate;
  const originalWindow = window;
  vi.stubGlobal('window', new Proxy(originalWindow, {
    get(target, key) {
      if (key === 'location') return { search: role ? '?role=' + role : '', assign };
      if (key === 'WebApp') return inMax ? { initData: 'signed-session' } : undefined;
      return Reflect.get(target, key);
    },
  }));
  const host = document.createElement('div');
  document.body.append(host);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  root = createRoot(host);
  await act(async () => root!.render(
    <StrictMode><QueryClientProvider client={client!}>
      <DemoRoleLaunch demoMode={!inMax} demoHouseAvailable />
    </QueryClientProvider></StrictMode>,
  ));
  return assign;
}

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}

describe('demo role launch from the bot', () => {
  it.each([
    ['resident', '/'], ['chair', '/'], ['dispatcher', '/dispatcher'],
    ['executor', '/dispatcher'], ['authority', '/reports'],
  ])('opens the first section for %s without another role selection', async (role, destination) => {
    const join = vi.spyOn(houseApi, 'joinDemo').mockResolvedValue({} as Awaited<ReturnType<typeof houseApi.joinDemo>>);
    const assign = await renderDemo(role);
    await settle();
    expect(join).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('domdelo.publicDemoRole')).toBe(role);
    expect(assign).toHaveBeenCalledWith(destination, { replace: true });
    expect(document.body.textContent).not.toContain('Выберите роль');
  });

  it('uses the selected demo user outside MAX', async () => {
    vi.spyOn(houseApi, 'joinDemo').mockResolvedValue({} as Awaited<ReturnType<typeof houseApi.joinDemo>>);
    const assign = await renderDemo('authority', false);
    await settle();
    expect(localStorage.getItem('domdelo.demoUser')).toBe('authority-1');
    expect(assign).toHaveBeenCalledWith('/reports', { replace: true });
  });

  it('directs users back to the chat when no role was provided', async () => {
    const join = vi.spyOn(houseApi, 'joinDemo');
    await renderDemo();
    expect(join).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Выберите роль в чате');
    expect(document.body.textContent).not.toContain('Режим для показа комиссии');
    expect(document.querySelector('button')).toBeNull();
  });

  it('shows a retry when joining fails and redirects only after success', async () => {
    const join = vi.spyOn(houseApi, 'joinDemo').mockRejectedValueOnce(new Error('Нет соединения'))
      .mockResolvedValue({} as Awaited<ReturnType<typeof houseApi.joinDemo>>);
    const assign = await renderDemo('dispatcher');
    await settle();
    expect(assign).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Нет соединения');
    await act(async () => document.querySelector<HTMLButtonElement>('button')!.click());
    await settle();
    expect(join).toHaveBeenCalledTimes(2);
    expect(assign).toHaveBeenCalledWith('/dispatcher', { replace: true });
  });
});
