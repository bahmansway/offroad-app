import type { TokenPair } from './types';
import type { LockFn, TokenStore } from './tokenStore';

export const TOKEN_KEY = 'offroad.tokens';

/** Web: localStorage (wrapped so private mode / blocked storage does not crash the app). */
export const tokenStore: TokenStore = {
  async get() {
    try {
      const raw = globalThis.localStorage?.getItem(TOKEN_KEY);
      return raw ? (JSON.parse(raw) as TokenPair) : null;
    } catch {
      return null;
    }
  },
  async set(tokens) {
    try {
      globalThis.localStorage?.setItem(TOKEN_KEY, JSON.stringify(tokens));
    } catch {
      /* storage unavailable: session lasts until reload */
    }
  },
  async clear() {
    try {
      globalThis.localStorage?.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
  subscribe(onChange) {
    if (typeof window === 'undefined') return () => {};
    // `storage` fires in *other* tabs when one tab writes localStorage.
    const handler = (e: StorageEvent) => {
      if (e.key === TOKEN_KEY || e.key === null) onChange();
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  },
};

type Locks = { request<T>(name: string, cb: () => Promise<T>): Promise<T> };

/** Web Locks API: only one tab at a time may refresh. Missing in very old browsers → no lock. */
export const withLock: LockFn | undefined =
  typeof navigator !== 'undefined' && (navigator as { locks?: Locks }).locks
    ? (name, fn) => (navigator as unknown as { locks: Locks }).locks.request(name, fn)
    : undefined;
