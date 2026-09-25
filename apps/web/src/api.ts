import type {
  AddHouseInput,
  CaseDto,
  CreateCaseInput,
  DuplicateSearchInput,
  HouseContextDto,
  TransitionCaseInput,
} from '@domdelo/contracts';

const DEMO_USER_KEY = 'domdelo.demoUser';
const SESSION_KEY = 'domdelo.session';
const ACTOR_KEY = 'domdelo.actor';

type SessionActor = { id: string; role: 'resident' | 'dispatcher' | 'executor' | 'admin'; houseId: string; displayName: string };

export function getSessionActor(): SessionActor | null {
  try {
    const value = sessionStorage.getItem(ACTOR_KEY);
    return value ? JSON.parse(value) as SessionActor : null;
  } catch {
    return null;
  }
}

export async function getPublicConfig(): Promise<{ demoMode: boolean }> {
  const response = await fetch('/api/public-config');
  if (!response.ok) throw new Error('Не удалось загрузить настройки приложения');
  return response.json() as Promise<{ demoMode: boolean }>;
}

export type DemoUserKey = 'resident-1' | 'resident-2' | 'dispatcher-1' | 'executor-1';

export function getDemoUser(): DemoUserKey {
  return (localStorage.getItem(DEMO_USER_KEY) as DemoUserKey | null) || 'resident-1';
}

export function setDemoUser(value: DemoUserKey): void {
  localStorage.setItem(DEMO_USER_KEY, value);
}

export async function initializeMaxSession(): Promise<void> {
  const initData = window.WebApp?.initData;
  if (!initData || sessionStorage.getItem(SESSION_KEY)) return;
  const response = await fetch('/api/auth/max', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData }),
  });
  if (!response.ok) throw await toApiError(response);
  const result = (await response.json()) as { token: string; actor: SessionActor };
  sessionStorage.setItem(SESSION_KEY, result.token);
  sessionStorage.setItem(ACTOR_KEY, JSON.stringify(result.actor));
}

function requestHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const token = sessionStorage.getItem(SESSION_KEY);
  if (token) headers.set('authorization', `Bearer ${token}`);
  else headers.set('x-demo-user', getDemoUser());
  return headers;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as
    | { message?: string; error?: string }
    | null;
  return new ApiError(
    body?.message || 'Не удалось выполнить запрос',
    response.status,
    body?.error || 'unknown_error',
  );
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: requestHeaders(init?.headers),
  });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

export const caseApi = {
  list: () => api<CaseDto[]>('/api/cases'),
  get: (id: string) => api<CaseDto>(`/api/cases/${id}`),
  duplicates: (input: DuplicateSearchInput) =>
    api<CaseDto[]>('/api/cases/deduplication', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  create: (input: CreateCaseInput) =>
    api<CaseDto>('/api/cases', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(input),
    }),
  confirm: (id: string) => api<CaseDto>(`/api/cases/${id}/confirmations`, { method: 'POST' }),
  watch: (id: string) => api<CaseDto>(`/api/cases/${id}/watchers`, { method: 'POST' }),
  transition: (id: string, input: TransitionCaseInput) =>
    api<CaseDto>(`/api/cases/${id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  upload: (id: string, kind: 'problem' | 'result', file: File) => {
    const body = new FormData();
    body.append('file', file);
    return api<CaseDto>(`/api/cases/${id}/attachments?kind=${kind}`, {
      method: 'POST',
      body,
    });
  },
};

export const houseApi = {
  context: () => api<HouseContextDto>('/api/me/houses'),
  add: (input: AddHouseInput) =>
    api<HouseContextDto>('/api/me/houses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  select: (houseId: string) =>
    api<HouseContextDto>(`/api/me/houses/${houseId}/select`, { method: 'POST' }),
};
