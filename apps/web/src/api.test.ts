import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDemoUser, getPublicDemoRole } from './api.js';

afterEach(() => vi.unstubAllGlobals());

describe('saved user selection', () => {
  it.each(['owner', 'tenant'])('falls back to resident for removed role %s', (role) => {
    vi.stubGlobal('localStorage', { getItem: () => role });
    expect(getPublicDemoRole()).toBe('resident');
  });
  it.each(['owner-1', 'tenant-1'])('falls back to a resident for removed user %s', (user) => {
    vi.stubGlobal('localStorage', { getItem: () => user });
    expect(getDemoUser()).toBe('resident-1');
  });
  it('preserves an existing staff selection', () => {
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'domdelo.demoUser' ? 'dispatcher-1' : 'dispatcher' });
    expect(getDemoUser()).toBe('dispatcher-1');
    expect(getPublicDemoRole()).toBe('dispatcher');
  });
});
