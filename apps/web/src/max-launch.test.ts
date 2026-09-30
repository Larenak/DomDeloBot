import { describe, expect, it } from 'vitest';

import { pathFromMaxStartParam } from './max-launch.js';

describe('MAX launch payload', () => {
  it('opens a requested case card', () => {
    expect(
      pathFromMaxStartParam('case_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).toBe('/cases/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  it('opens the selected demo role without accepting arbitrary paths', () => {
    expect(pathFromMaxStartParam('demo_dispatcher')).toBe('/demo?role=dispatcher');
    expect(pathFromMaxStartParam('demo_admin')).toBeUndefined();
    expect(pathFromMaxStartParam('demo_owner')).toBeUndefined();
    expect(pathFromMaxStartParam('demo_tenant')).toBeUndefined();
  });

  it('ignores an unknown or unsafe payload', () => {
    expect(pathFromMaxStartParam('../dispatcher')).toBeUndefined();
  });
});
