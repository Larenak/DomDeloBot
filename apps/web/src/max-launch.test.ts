import { describe, expect, it } from 'vitest';

import { pathFromMaxStartParam } from './max-launch.js';

describe('MAX launch payload', () => {
  it('opens a requested case card', () => {
    expect(
      pathFromMaxStartParam('case_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).toBe('/cases/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  it('ignores an unknown or unsafe payload', () => {
    expect(pathFromMaxStartParam('../dispatcher')).toBeUndefined();
  });
});
