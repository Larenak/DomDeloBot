import { describe, expect, it } from 'vitest';

import { assertTransitionAllowed, getAvailableTransitions, requiredCaseConfirmations, WorkflowError } from './index.js';

describe('case workflow', () => {
  it('allows dispatcher to assign a registered case', () => {
    expect(() => assertTransitionAllowed('registered', 'assigned', 'dispatcher')).not.toThrow();
  });

  it('allows a resident to confirm or dispute only the result awaiting verification', () => {
    expect(getAvailableTransitions('awaiting_resident_verification', 'resident')).toEqual([
      'resolved',
      'disputed',
    ]);
  });

  it('rejects skipped transitions', () => {
    expect(() => assertTransitionAllowed('registered', 'resolved', 'admin')).toThrow(WorkflowError);
  });
});


describe('UK confirmation threshold', () => {
  it.each([[0,2], [1,2], [10,2], [20,2], [21,3], [30,3], [31,4], [100,10], [101,11]])('requires %i accounts to reach threshold %i', (accounts, expected) => {
    expect(requiredCaseConfirmations(accounts)).toBe(expected);
  });
  it('does not allow manual submission to bypass confirmations', () => {
    for (const role of ['resident', 'dispatcher', 'admin'] as const) {
      expect(() => assertTransitionAllowed('draft', 'registered', role)).toThrow(WorkflowError);
    }
  });
});
