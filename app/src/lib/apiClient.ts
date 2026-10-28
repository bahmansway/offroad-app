import type { ErrorCode, TokenPair } from './types';
import type { LockFn, TokenStore } from './tokenStore';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl: string;
  store: TokenStore;
  fetch?: FetchLike;
  /** Cross-tab lock (web). Refresh runs inside it so two tabs never send the same refresh token. */
  lock?: LockFn;
  /** Request timeout in ms (default 15 s). */
  timeoutMs?: number;
  /** Called when the refresh token is rejected — the user must log in again. */
  onAuthLost?: () => void;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Send the access token if we have one (default true). */
  auth?: boolean;
  query?: Record<string, string | number | undefined | null>;
}

const KNOWN_CODES: ErrorCode[] = ['VALIDATION', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'RATE_LIMITED'];
const LOCK_NAME = 'offroad-refresh';

function codeFromStatus(status: number): ErrorCode {
  switch (status) {
    case 400: case 422: return 'VALIDATION';
    case 401: return 'UNAUTHORIZED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    case 429: return 'RATE_LIMITED';
    default: return 'UNKNOWN';
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = codeFromStatus(res.status);
  let message = res.statusText || `HTTP ${res.status}`;
  try {
    const data = await res.json();
    const e = data?.error;
    if (e && typeof e === 'object') {
      if (KNOWN_CODES.includes(e.code)) code = e.code;
      if (typeof e.message === 'string') message = e.message;
    }
  } catch {
    /* non-JSON body */
  }
  return new ApiError(res.status, code, message);
}

export function isTokenPair(v: unknown): v is TokenPair {
  const o = v as Record<string, unknown> | null;
  return !!o && typeof o.accessToken === 'string' && o.accessToken.length > 0
    && typeof o.refreshToken === 'string' && o.refreshToken.length > 0;
}

export function buildQuery(query?: RequestOptions['query']): string {
  if (!query) return '';
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * JSON client for /api. Keeps tokens in `store`, adds the Bearer header, and when a
 * request gets 401 it refreshes once and retries.
 *
 * Refresh tokens rotate and the server treats reuse of an old one as theft (it revokes every
 * session). So before calling /auth/refresh we re-read the store: if another tab (or client)
 * already rotated, we adopt its tokens instead. On web the whole step runs under a Web Lock.
 */
export function createApiClient(opts: ApiClientOptions) {
  const doFetch: FetchLike = opts.fetch ?? ((i, init) => fetch(i, init));
  const base = opts.baseUrl.replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const lock: LockFn = opts.lock ?? ((_n, fn) => fn());
  let cached: TokenPair | null | undefined; // undefined = not loaded yet
  let refreshing: Promise<TokenPair | null> | null = null;
  /** Bumped on every explicit setTokens(); a refresh that started earlier must not write over it. */
  let generation = 0;

  // Another tab changed the tokens → forget our copy; next request re-reads storage.
  opts.store.subscribe?.(() => {
    cached = undefined;
  });

  async function getTokens(): Promise<TokenPair | null> {
    if (cached === undefined) cached = await opts.store.get();
    return cached;
  }

  async function setTokens(t: TokenPair | null) {
    generation++;
    cached = t;
    if (t) await opts.store.set(t);
    else await opts.store.clear();
  }

  async function raw(path: string, init: RequestInit): Promise<Response> {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      return await doFetch(`${base}${path}`, { ...init, signal: ctrl?.signal });
    } catch (e) {
      const timedOut = ctrl?.signal.aborted;
      throw new ApiError(0, 'NETWORK', timedOut ? 'Request timed out' : e instanceof Error ? e.message : 'Network error');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Gets a fresh token pair. `staleAccess` is the access token that just got a 401.
   * Returns null when the session is gone (or the server could not refresh right now).
   */
  function refresh(staleAccess?: string): Promise<TokenPair | null> {
    if (refreshing) return refreshing;
    const startGen = generation;
    refreshing = lock(LOCK_NAME, async () => {
      // Re-read the shared store inside the lock: another tab may have rotated already.
      const stored = await opts.store.get();
      const held = cached;
      if (generation !== startGen) return cached ?? null; // logged in/out meanwhile
      if (!stored?.refreshToken) {
        cached = null;
        // We had a session but the shared store is empty → another tab logged out.
        if (held) opts.onAuthLost?.();
        return null;
      }
      const someoneElseRotated =
        (held && stored.refreshToken !== held.refreshToken) ||
        (staleAccess !== undefined && stored.accessToken !== staleAccess);
      if (someoneElseRotated) {
        cached = stored;
        return stored;
      }

      const res = await raw('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refreshToken: stored.refreshToken }),
      });
      if (generation !== startGen) return cached ?? null; // user logged out while we waited
      if (!res.ok) {
        // Only a definite rejection logs the user out; 429 / 5xx keep the session for later.
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          await setTokens(null);
          opts.onAuthLost?.();
        }
        return null;
      }
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!isTokenPair(data)) return null;
      const pair = { accessToken: data.accessToken, refreshToken: data.refreshToken };
      cached = pair;
      await opts.store.set(pair);
      return pair;
    }).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function request<T>(path: string, o: RequestOptions = {}): Promise<T> {
    const useAuth = o.auth !== false;
    const url = path + buildQuery(o.query);
    const send = async (token?: string) => {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (o.body !== undefined) headers['Content-Type'] = 'application/json';
      if (token) headers.Authorization = `Bearer ${token}`;
      return raw(url, {
        method: o.method ?? 'GET',
        headers,
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      });
    };

    // If a refresh is already in flight, wait for it instead of sending a token we know is stale.
    if (useAuth && refreshing) await refreshing.catch(() => null);
    const tokens = useAuth ? await getTokens() : null;
    let res = await send(tokens?.accessToken);

    if (res.status === 401 && useAuth && tokens?.refreshToken) {
      const fresh = await refresh(tokens.accessToken);
      if (fresh && fresh.accessToken !== tokens.accessToken) res = await send(fresh.accessToken);
    }

    if (!res.ok) throw await toApiError(res);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    request,
    getTokens,
    setTokens,
    refresh,
    baseUrl: base,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
