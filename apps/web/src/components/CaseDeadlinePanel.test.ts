import { describe, expect, it } from 'vitest';

import { formatElapsedTime } from './CaseDeadlinePanel.js';

describe('formatElapsedTime', () => {
  it('formats running and stopped clocks', () => {
    expect(formatElapsedTime(0)).toBe('0 мин 0 с');
    expect(formatElapsedTime(90_000)).toBe('1 мин 30 с');
    expect(formatElapsedTime(90_061_000)).toBe('1 д 1 ч 1 мин 1 с');
  });
});
