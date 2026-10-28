import { createApiClient, isTokenPair } from '../apiClient';
import type { LockFn, TokenStore } from '../tokenStore';
import type { TokenPair } from '../types';

/** One shared store = two browser tabs on the same localStorage. Notifies the *other* subscribers on write. */
function sharedStore(initial: TokenPair | null) {
  let value = initial;
  const subs = new Set<() => void>();
  const make = (): TokenStore => {
    let mine: (() => void) | null = null;
    return {
      get: async () => value,
      set: async (t) => { value = t; subs.forEach((s) => s !== mine && s()); },
      clear: async () => { value = null; subs.forEach((s) => s !== mine && s()); },
      subscribe(cb) { mine = cb; subs.add(cb); return () => subs.delete(cb); },
    };
  };
  return { tab: make, get value() { return value; } };
}

/** A real mutex, like navigator.locks. */
function mutex(): LockFn {
  let tail: Promise<unknown> = Promise.resolve();
  return <T,>(_n: string, fn: () => Promise<T>) => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Fake server with rotating refresh tokens and reuse detection (like the real one). */
function fakeServer() {
  let n = 1;
  const valid = new Set<string>(['R1']);
  const used = new Set<string>();
  let access = 'A1';
  const refreshBodies: string[] = [];
  let revokedAll = false;
  const fetch = async (url: string, init?: RequestInit) => {
    await new Promise((r) => setTimeout(r, 5));
    if (url.endsWith('/api/auth/refresh')) {
      const { refreshToken } = JSON.parse(String(init?.body));
      refreshBodies.push(refreshToken);
      if (used.has(refreshToken)) { revokedAll = true; valid.clear(); return json(401, { error: { code: 'UNAUTHORIZED', message: 'reuse' } }); }
      if (!valid.has(refreshToken)) return json(401);
      valid.delete(refreshToken); used.add(refreshToken);
      n++;
      const pair = { accessToken: `A${n}`, refreshToken: `R${n}` };
      valid.add(pair.refreshToken); access = pair.accessToken;
      return json(200, pair);
    }
    const auth = (init?.headers as Record<string, string>)?.Authorization;
    return auth === `Bearer ${access}` ? json(200, { ok: true }) : json(401);
  };
  return { fetch, refreshBodies, expire: () => { access = 'expired-' + n; }, get revokedAll() { return revokedAll; } };
}

describe('refresh across tabs', () => {
  it('two clients sharing one store never send the same refresh token (with lock)', async () => {
    const server = fakeServer();
    const store = sharedStore({ accessToken: 'A1', refreshToken: 'R1' });
    const lock = mutex();
    const tabA = createApiClient({ baseUrl: 'http://x', store: store.tab(), fetch: server.fetch, lock });
    const tabB = createApiClient({ baseUrl: 'http://x', store: store.tab(), fetch: server.fetch, lock });
    await tabA.request('/api/me'); await tabB.request('/api/me'); // both cache A1/R1
    server.expire();
    const [a, b] = await Promise.all([tabA.request('/api/me'), tabB.request('/api/me')]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(server.refreshBodies).toEqual(['R1']);
    expect(new Set(server.refreshBodies).size).toBe(server.refreshBodies.length);
    expect(server.revokedAll).toBe(false);
  });

  it('without a lock, a tab whose cache is stale adopts the stored pair instead of reusing its old token', async () => {
    const server = fakeServer();
    const store = sharedStore({ accessToken: 'A1', refreshToken: 'R1' });
    const tabA = createApiClient({ baseUrl: 'http://x', store: store.tab(), fetch: server.fetch });
    const tabB = createApiClient({ baseUrl: 'http://x', store: store.tab(), fetch: server.fetch });
    await tabA.request('/api/me'); await tabB.request('/api/me');
    server.expire();
    await tabA.request('/api/me'); // A rotates R1 -> R2
    await expect(tabB.request('/api/me')).resolves.toEqual({ ok: true });
    expect(server.refreshBodies).toEqual(['R1']);
    expect(server.revokedAll).toBe(false);
  });

  it('even when the storage event is missed, B re-reads the store before refreshing', async () => {
    const server = fakeServer();
    const store = sharedStore({ accessToken: 'A1', refreshToken: 'R1' });
    const quietTab = (): TokenStore => { const t = store.tab(); return { get: t.get, set: t.set, clear: t.clear }; }; // no subscribe
    const tabA = createApiClient({ baseUrl: 'http://x', store: quietTab(), fetch: server.fetch });
    const tabB = createApiClient({ baseUrl: 'http://x', store: quietTab(), fetch: server.fetch });
    await tabA.request('/api/me'); await tabB.request('/api/me');
    server.expire();
    await tabA.request('/api/me');
    await expect(tabB.request('/api/me')).resolves.toEqual({ ok: true });
    expect(server.refreshBodies).toEqual(['R1']);
  });
});

describe('refresh edge cases', () => {
  it('logout during an in-flight refresh does not write tokens back', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let value: TokenPair | null = { accessToken: 'A1', refreshToken: 'R1' };
    const store: TokenStore = { get: async () => value, set: async (t) => { value = t; }, clear: async () => { value = null; } };
    const client = createApiClient({
      baseUrl: 'http://x',
      store,
      fetch: async (url) => {
        if (url.endsWith('/refresh')) { await gate; return json(200, { accessToken: 'A2', refreshToken: 'R2' }); }
        return json(401);
      },
    });
    const pending = client.request('/api/me').catch((e) => e);
    await new Promise((r) => setTimeout(r, 5));
    await client.setTokens(null); // logout
    release();
    await pending;
    expect(value).toBeNull();
    expect(await client.getTokens()).toBeNull();
  });

  it('ignores a malformed refresh response and keeps the session', async () => {
    let value: TokenPair | null = { accessToken: 'A1', refreshToken: 'R1' };
    const store: TokenStore = { get: async () => value, set: async (t) => { value = t; }, clear: async () => { value = null; } };
    const client = createApiClient({
      baseUrl: 'http://x', store,
      fetch: async (url) => (url.endsWith('/refresh') ? json(200, { accessToken: 42 }) : json(401)),
    });
    await expect(client.request('/api/me')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(value).toEqual({ accessToken: 'A1', refreshToken: 'R1' });
  });

  it('keeps the session when refresh is rate limited (429)', async () => {
    let value: TokenPair | null = { accessToken: 'A1', refreshToken: 'R1' };
    const lost = jest.fn();
    const store: TokenStore = { get: async () => value, set: async (t) => { value = t; }, clear: async () => { value = null; } };
    const client = createApiClient({
      baseUrl: 'http://x', store, onAuthLost: lost,
      fetch: async (url) => (url.endsWith('/refresh') ? json(429, { error: { code: 'RATE_LIMITED', message: 'slow' } }) : json(401)),
    });
    await expect(client.request('/api/me')).rejects.toBeTruthy();
    expect(value).not.toBeNull();
    expect(lost).not.toHaveBeenCalled();
  });

  it('times out a hanging request as NETWORK', async () => {
    const client = createApiClient({
      baseUrl: 'http://x',
      store: { get: async () => null, set: async () => {}, clear: async () => {} },
      timeoutMs: 20,
      fetch: (_u, init) => new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
      }),
    });
    await expect(client.request('/api/health')).rejects.toMatchObject({ code: 'NETWORK', message: 'Request timed out' });
  });

  it('isTokenPair validates shape', () => {
    expect(isTokenPair({ accessToken: 'a', refreshToken: 'b' })).toBe(true);
    expect(isTokenPair({ accessToken: '', refreshToken: 'b' })).toBe(false);
    expect(isTokenPair(null)).toBe(false);
    expect(isTokenPair({ accessToken: 1, refreshToken: 'b' })).toBe(false);
  });
});
