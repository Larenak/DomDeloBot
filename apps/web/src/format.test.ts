import { describe, expect, it } from 'vitest';

import { formatRelativeDate, statusTone } from './format.js';

describe('interface formatting', () => {
  it('formats recent timestamps for the case list', () => {
    expect(
      formatRelativeDate('2026-09-23T10:00:00.000Z', new Date('2026-09-23T10:45:00.000Z')),
    ).toBe('45 мин назад');
  });

  it('marks a disputed result as dangerous', () => {
    expect(statusTone('disputed')).toBe('danger');
  });
});

