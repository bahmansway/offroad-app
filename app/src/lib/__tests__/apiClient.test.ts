import { ApiError, buildQuery, createApiClient } from '../apiClient';
import type { TokenStore } from '../tokenStore';
import type { TokenPair } from '../types';

function memoryStore(initial: TokenPair | null): TokenStore & { value: TokenPair | null } {
  const s = {
    value: initial,
    get: async () => s.value,
    set: async (t: TokenPair) => { s.value = t; },
    clear: async () => { s.value = null; },
  };
  return s;
}

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Call = { url: string; init?: RequestInit };
function authHeader(c: Call) {
  return (c.init?.headers as Record<string, string> | undefined)?.Authorization;
}

describe('createApiClient', () => {
  it('sends the bearer token and parses JSON', async () => {
    const calls: Call[] = [];
    const client = createApiClient({
      baseUrl: 'http://api.test/',
      store: memoryStore({ accessToken: 'A1', refreshToken: 'R1' }),
      fetch: async (url, init) => { calls.push({ url, init }); return json(200, { id: 'u1' }); },
    });
    await expect(client.request('/api/me')).resolves.toEqual({ id: 'u1' });
    expect(calls[0].url).toBe('http://api.test/api/me');
    expect(authHeader(calls[0])).toBe('Bearer A1');
  });

  it('on 401 refreshes once, stores the rotated pair and retries', async () => {
    const store = memoryStore({ accessToken: 'old', refreshToken: 'R1' });
    const calls: Call[] = [];
    const client = createApiClient({
      baseUrl: 'http://api.test',
      store,
      fetch: async (url, init) => {
        calls.push({ url, init });
        if (url.endsWith('/api/auth/refresh')) {
          expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: 'R1' });
          return json(200, { accessToken: 'new', refreshToken: 'R2' });
        }
        return authHeader({ url, init }) === 'Bearer new' ? json(200, { ok: true }) : json(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } });
      },
    });
    await expect(client.request('/api/me')).resolves.toEqual({ ok: true });
    expect(calls.map((c) => c.url.replace('http://api.test', ''))).toEqual(['/api/me', '/api/auth/refresh', '/api/me']);
    expect(store.value).toEqual({ accessToken: 'new', refreshToken: 'R2' });
  });

  it('shares one refresh between parallel requests', async () => {
    let refreshes = 0;
    const client = createApiClient({
      baseUrl: 'http://api.test',
      store: memoryStore({ accessToken: 'old', refreshToken: 'R1' }),
      fetch: async (url, init) => {
        if (url.endsWith('/refresh')) {
          refreshes++;
          await new Promise((r) => setTimeout(r, 10));
          return json(200, { accessToken: 'new', refreshToken: 'R2' });
        }
        return authHeader({ url, init }) === 'Bearer new' ? json(200, { url }) : json(401);
      },
    });
    const results = await Promise.all([client.request('/api/a'), client.request('/api/b'), client.request('/api/c')]);
    expect(results).toHaveLength(3);
    expect(refreshes).toBe(1);
  });

  it('clears tokens and calls onAuthLost when the refresh token is rejected', async () => {
    const store = memoryStore({ accessToken: 'old', refreshToken: 'bad' });
    const onAuthLost = jest.fn();
    const client = createApiClient({
      baseUrl: 'http://api.test',
      store,
      onAuthLost,
      fetch: async () => json(401, { error: { code: 'UNAUTHORIZED', message: 'nope' } }),
    });
    await expect(client.request('/api/me')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(store.value).toBeNull();
    expect(onAuthLost).toHaveBeenCalledTimes(1);
  });

  it('keeps the session when refresh fails with a server error', async () => {
    const store = memoryStore({ accessToken: 'old', refreshToken: 'R1' });
    const onAuthLost = jest.fn();
    const client = createApiClient({
      baseUrl: 'http://api.test',
      store,
      onAuthLost,
      fetch: async (url) => (url.endsWith('/refresh') ? json(503) : json(401)),
    });
    await expect(client.request('/api/me')).rejects.toBeInstanceOf(ApiError);
    expect(store.value).toEqual({ accessToken: 'old', refreshToken: 'R1' });
    expect(onAuthLost).not.toHaveBeenCalled();
  });

  it('does not refresh for unauthenticated calls such as login', async () => {
    const calls: string[] = [];
    const client = createApiClient({
      baseUrl: 'http://api.test',
      store: memoryStore({ accessToken: 'A', refreshToken: 'R' }),
      fetch: async (url, init) => {
        calls.push(url);
        expect(authHeader({ url, init })).toBeUndefined();
        return json(401, { error: { code: 'UNAUTHORIZED', message: 'Wrong password' } });
      },
    });
    await expect(client.request('/api/auth/login', { method: 'POST', body: {}, auth: false })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Wrong password',
    });
    expect(calls).toHaveLength(1);
  });

  it('maps error bodies and network failures', async () => {
    const forbidden = createApiClient({
      baseUrl: 'http://api.test',
      store: memoryStore(null),
      fetch: async () => json(403, { error: { code: 'FORBIDDEN', message: 'Not yours' } }),
    });
    await expect(forbidden.request('/api/spots/1', { method: 'DELETE' })).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });

    const offline = createApiClient({
      baseUrl: 'http://api.test',
      store: memoryStore(null),
      fetch: async () => { throw new TypeError('Failed to fetch'); },
    });
    await expect(offline.request('/api/health')).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('returns undefined for 204', async () => {
    const client = createApiClient({ baseUrl: 'http://x', store: memoryStore(null), fetch: async () => new Response(null, { status: 204 }) });
    await expect(client.request('/api/auth/logout', { method: 'POST', body: {} })).resolves.toBeUndefined();
  });
});

describe('buildQuery', () => {
  it('skips empty values and encodes', () => {
    expect(buildQuery({ type: 'trail', minLevel: 2, q: 'Xızı dağ', x: undefined, y: null, z: '' })).toBe(
      '?type=trail&minLevel=2&q=X%C4%B1z%C4%B1%20da%C4%9F',
    );
    expect(buildQuery({})).toBe('');
  });
});
