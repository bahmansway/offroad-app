const mockMem = new Map<string, string>();
jest.mock('../settingsStore', () => ({
  loadSetting: async (k: string) => mockMem.get(k) ?? null,
  saveSetting: async (k: string, v: string) => { mockMem.set(k, v); },
}));

import { ApiError } from '../apiClient';
import { addPending, MAX_PENDING, parsePending, PENDING_KEY, rememberRemoval, removalDone, retryRemovals } from '../pushCleanup';

const T = (n: number) => `ExponentPushToken[tok${n}xxxxxxxx]`;

beforeEach(() => mockMem.clear());

describe('push token removal notes', () => {
  it('adds newest first, without duplicates, capped', () => {
    let l = addPending([], { refreshToken: 'r1', pushToken: T(1) });
    l = addPending(l, { refreshToken: 'r1', pushToken: T(1) });
    expect(l).toHaveLength(1);
    for (let i = 2; i < 10; i++) l = addPending(l, { refreshToken: `r${i}`, pushToken: T(i) });
    expect(l).toHaveLength(MAX_PENDING);
    expect(l[0].refreshToken).toBe('r9');
  });
  it('done when the server answered; retry on network trouble, 5xx and 429', () => {
    expect(removalDone(null)).toBe(true);
    expect(removalDone(new ApiError(400, 'VALIDATION', 'x'))).toBe(true);
    expect(removalDone(new ApiError(0, 'NETWORK' as never, 'offline'))).toBe(false);
    expect(removalDone(new ApiError(503, 'INTERNAL' as never, 'x'))).toBe(false);
    expect(removalDone(new ApiError(429, 'RATE_LIMITED', 'x'))).toBe(false);
    expect(removalDone(new Error('fetch failed'))).toBe(false);
  });
  it('reads stored notes safely', () => {
    expect(parsePending(null)).toEqual([]);
    expect(parsePending('garbage')).toEqual([]);
    expect(parsePending('[{"refreshToken":"r","pushToken":"p"},{"x":1}]')).toEqual([{ refreshToken: 'r', pushToken: 'p' }]);
  });
  it('retries on next start: done notes go, failed ones stay', async () => {
    await rememberRemoval({ refreshToken: 'ok', pushToken: T(1) });
    await rememberRemoval({ refreshToken: 'offline', pushToken: T(2) });
    await rememberRemoval({ refreshToken: 'bad', pushToken: T(3) });
    const calls: string[] = [];
    await retryRemovals(async (rt, pt) => {
      calls.push(`${rt}:${pt}`);
      if (rt === 'offline') throw new ApiError(0, 'NETWORK' as never, 'offline');
      if (rt === 'bad') throw new ApiError(400, 'VALIDATION', 'bad');
    });
    expect(calls).toHaveLength(3);
    expect(parsePending(mockMem.get(PENDING_KEY) ?? null)).toEqual([{ refreshToken: 'offline', pushToken: T(2) }]);
    // back online
    await retryRemovals(async () => {});
    expect(parsePending(mockMem.get(PENDING_KEY) ?? null)).toEqual([]);
  });
  it('nothing stored: no calls', async () => {
    const fn = jest.fn();
    await retryRemovals(fn);
    expect(fn).not.toHaveBeenCalled();
  });
});
