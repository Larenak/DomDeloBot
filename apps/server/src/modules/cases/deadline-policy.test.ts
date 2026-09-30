import { describe, expect, it } from 'vitest';

import { caseDeadlineDto, startCaseDeadline } from './deadline-policy.js';

const startedAt = new Date('2026-09-30T08:00:00.000Z');

describe('case control clocks', () => {
  it.each(['yard', 'other'] as const)('%s counts elapsed time without an invented deadline', (category) => {
    const started = startCaseDeadline(category, startedAt);
    expect(started.dueAt).toBeUndefined();
    const dto = caseDeadlineDto({
      policyKey: started.policyKey,
      startedAt: started.startedAt,
      dueAt: started.dueAt,
    });
    expect(dto?.startedAt).toBe(startedAt.toISOString());
    expect(dto?.dueAt).toBeUndefined();
    expect(dto?.complaintGuideUrl).toBeUndefined();
    expect(dto?.note).toContain('Единый нормативный срок');
  });

  it.each([
    ['lighting', 7], ['entrance', 1], ['elevator', 1],
    ['water', 3], ['heating', 3],
  ] as const)('%s has a control date %i days later', (category, days) => {
    const started = startCaseDeadline(category, startedAt);
    expect(started.dueAt?.getTime() - startedAt.getTime()).toBe(days * 86_400_000);
    expect(caseDeadlineDto({
      policyKey: started.policyKey,
      startedAt: started.startedAt,
      dueAt: started.dueAt,
    })?.complaintGuideUrl).toContain('dom.gosuslugi.ru');
  });
});
