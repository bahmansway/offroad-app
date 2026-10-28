import { createApiClient, ApiError } from '../apiClient';
import { sessionStateAfterMeError } from '../sessionCheck';
import type { TokenStore } from '../tokenStore';
import type { TokenPair } from '../types';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function memStore(v: TokenPair | null) {
  let value = v;
  const store: TokenStore = { get: async () => value, set: async (t) => { value = t; }, clear: async () => { value = null; } };
  return { store, get value() { return value; } };
}

describe('startup /me with an expired access token', () => {
  it.each([429, 500, 503])('refresh %i → keep tokens, show offline (not logged out)', async (status) => {
    const s = memStore({ accessToken: 'expired', refreshToken: 'R1' });
    const client = createApiClient({
      baseUrl: 'http://x', store: s.store,
      fetch: async (url) => (url.endsWith('/refresh') ? json(status) : json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } })),
    });
    let err: unknown;
    try { await client.request('/api/me'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('UNAUTHORIZED');
    const still = await client.getTokens();
    expect(still).toEqual({ accessToken: 'expired', refreshToken: 'R1' });
    expect(sessionStateAfterMeError(err, !!still)).toBe('offline');
    expect(s.value).not.toBeNull();
  });

  it('refresh token rejected → tokens cleared, logged out', async () => {
    const s = memStore({ accessToken: 'expired', refreshToken: 'bad' });
    const client = createApiClient({ baseUrl: 'http://x', store: s.store, fetch: async () => json(401) });
    let err: unknown;
    try { await client.request('/api/me'); } catch (e) { err = e; }
    const still = await client.getTokens();
    expect(still).toBeNull();
    expect(sessionStateAfterMeError(err, !!still)).toBe('loggedOut');
  });

  it('network error with tokens → offline', () => {
    expect(sessionStateAfterMeError(new ApiError(0, 'NETWORK', 'x'), true)).toBe('offline');
  });
});

describe('another tab logged out', () => {
  it('calls onAuthLost when our session is gone from the shared store', async () => {
    const s = memStore({ accessToken: 'A1', refreshToken: 'R1' });
    const lost = jest.fn();
    const client = createApiClient({
      baseUrl: 'http://x', store: s.store, onAuthLost: lost,
      fetch: async (url, init) =>
        (init?.headers as Record<string, string>)?.Authorization === 'Bearer A1' && url.endsWith('/ok') ? json(200, {}) : json(401),
    });
    await client.request('/api/ok'); // cache A1/R1
    await s.store.clear(); // other tab logs out
    await expect(client.request('/api/me')).rejects.toBeTruthy();
    expect(lost).toHaveBeenCalledTimes(1);
  });
});
