import { describe, expect, it } from 'vitest';

import { assertTransitionAllowed, getAvailableTransitions, WorkflowError } from './index.js';

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

