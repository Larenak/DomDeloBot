import type {
  CaseDto,
  CreateCaseInput,
  DuplicateSearchInput,
  TransitionCaseInput,
} from '@domdelo/contracts';

const DEMO_USER_KEY = 'domdelo.demoUser';
const SESSION_KEY = 'domdelo.session';

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
  const result = (await response.json()) as { token: string };
  sessionStorage.setItem(SESSION_KEY, result.token);
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
