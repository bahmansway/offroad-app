import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { api, client, onAuthLost } from './api';
import { sessionStateAfterMeError } from './sessionCheck';
import { rememberRemoval, removalDone, retryRemovals } from './pushCleanup';
import type { User } from './types';

interface AuthValue {
  user: User | null;
  /** true until we know whether a saved session exists */
  loading: boolean;
  /** a saved session exists but the server could not be reached to confirm it */
  offline: boolean;
  /** try /me again (used by the offline banner) */
  retry: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  /** set when a saved session expired; cleared on next login */
  sessionLost: boolean;
  /** merge fields into the current user after a profile change (PATCH /me, avatar upload) */
  updateUser: (patch: Partial<User>) => void;
  /** reload /me (e.g. after deleting the current car) */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/** v5: where logout finds this phone's push token (set by the notifications provider). */
let pushTokenSource: (() => Promise<string | null>) | null = null;
export function setLogoutPushTokenSource(fn: (() => Promise<string | null>) | null) {
  pushTokenSource = fn;
}
async function currentPushToken(): Promise<string | null> {
  try {
    return (await pushTokenSource?.()) || null;
  } catch {
    return null;
  }
}
/** Tell the server to forget this phone for the account of `refreshToken`; keep a note to retry when it can't be reached. */
async function forgetPhone(refreshToken: string, pushToken: string | null) {
  try {
    await api.logout(refreshToken, pushToken);
  } catch (e) {
    if (pushToken && !removalDone(e)) await rememberRemoval({ refreshToken, pushToken }).catch(() => {});
  }
}

/** v5: work that must run while still logged in, right before logout (e.g. removing this phone's push token). */
const beforeLogout = new Set<() => Promise<void>>();
export function onBeforeLogout(fn: () => Promise<void>): () => void {
  beforeLogout.add(fn);
  return () => { beforeLogout.delete(fn); };
}
/** Runs the hooks; never fails and never takes longer than `capMs` (logout must stay fast offline). */
export async function runBeforeLogout(capMs = 4000): Promise<void> {
  const all = Promise.all([...beforeLogout].map((fn) => fn().catch(() => { /* best effort */ })));
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([all, new Promise((r) => { timer = setTimeout(r, capMs); })]);
  if (timer) clearTimeout(timer);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [sessionLost, setSessionLost] = useState(false);
  const alive = useRef(true);
  const checking = useRef(false);

  /** Loads the saved session. Network trouble → `offline` (tokens kept), not "logged out". */
  const check = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      const tokens = await client.getTokens();
      if (!tokens) {
        if (alive.current) { setUser(null); setOffline(false); }
        return;
      }
      const me = await api.me();
      if (alive.current) { setUser(me); setOffline(false); }
    } catch (e) {
      if (!alive.current) return;
      // Never wipe tokens here: the API client already cleared them if the refresh token was rejected.
      const still = await client.getTokens();
      if (sessionStateAfterMeError(e, !!still) === 'offline') {
        setOffline(true);
      } else {
        setUser(null);
        setOffline(false);
      }
    } finally {
      checking.current = false;
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    onAuthLost((lastRefreshToken) => {
      setUser(null);
      setOffline(false);
      setSessionLost(true);
      // session lost: this phone must stop getting that account's notifications
      if (lastRefreshToken) {
        currentPushToken().then((pushToken) => { if (pushToken) forgetPhone(lastRefreshToken, pushToken); });
      }
    });
    check();
    // removals that could not reach the server last time (offline logout, lost session)
    retryRemovals((rt, pt) => api.logout(rt, pt)).catch(() => {});
    return () => {
      alive.current = false;
      onAuthLost(null);
    };
  }, [check]);

  // While offline, retry when the app comes back to the foreground / the browser goes online.
  useEffect(() => {
    if (!offline) return;
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return;
      const h = () => { check(); };
      window.addEventListener('online', h);
      window.addEventListener('focus', h);
      return () => {
        window.removeEventListener('online', h);
        window.removeEventListener('focus', h);
      };
    }
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => sub.remove();
  }, [offline, check]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login({ email: email.trim(), password });
    await client.setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    setSessionLost(false);
    setOffline(false);
    setUser(res.user);
  }, []);

  const register = useCallback(async (email: string, password: string, displayName: string) => {
    const res = await api.register({ email: email.trim(), password, displayName: displayName.trim() });
    await client.setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    setSessionLost(false);
    setOffline(false);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    const pushToken = await currentPushToken(); // read before the hooks forget it
    await runBeforeLogout();
    let refreshToken: string | undefined;
    try {
      refreshToken = (await client.getTokens())?.refreshToken;
    } catch {
      /* ignore */
    }
    // Clear locally first: a refresh still in flight sees the generation change and won't write tokens back.
    try {
      await client.setTokens(null);
    } catch {
      /* storage failure: still drop the in-memory session */
    }
    setUser(null);
    setOffline(false);
    // server unreachable: local logout still counts; the push token removal is retried on next start
    if (refreshToken) await forgetPhone(refreshToken, pushToken);
  }, []);

  const updateUser = useCallback((patch: Partial<User>) => {
    setUser((u) => (u ? { ...u, ...patch } : u));
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const me = await api.me();
      if (alive.current) setUser(me);
    } catch {
      /* keep what we have; check() handles offline/expired */
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, offline, retry: check, login, register, logout, sessionLost, updateUser, refreshUser }),
    [user, loading, offline, check, login, register, logout, sessionLost, updateUser, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
