import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { validateMaxInitData } from './max-init-data.js';

function signedInitData(token: string, authDate: number): string {
  const values = [
    ['auth_date', String(authDate)],
    ['query_id', 'query-1'],
    ['user', JSON.stringify({ id: 123, first_name: 'Анна', last_name: 'Петрова' })],
  ] as const;
  const launchParams = values.map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(launchParams).digest('hex');
  return `${values.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}&hash=${hash}`;
}

describe('MAX initData validation', () => {
  it('accepts a fresh correctly signed payload', () => {
    const now = 1_791_000_000;
    const result = validateMaxInitData(signedInitData('bot-token', now - 5), 'bot-token', now);
    expect(result?.user).toMatchObject({ id: 123, first_name: 'Анна' });
  });

  it('rejects a stale payload and a wrong token', () => {
    const now = 1_791_000_000;
    expect(validateMaxInitData(signedInitData('bot-token', now - 901), 'bot-token', now)).toBeNull();
    expect(validateMaxInitData(signedInitData('bot-token', now), 'another-token', now)).toBeNull();
  });
});

