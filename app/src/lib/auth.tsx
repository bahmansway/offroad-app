import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { api, client, onAuthLost } from './api';
import { sessionStateAfterMeError } from './sessionCheck';
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
    onAuthLost(() => {
      setUser(null);
      setOffline(false);
      setSessionLost(true);
    });
    check();
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
    if (refreshToken) {
      try {
        await api.logout(refreshToken);
      } catch {
        /* server unreachable: local logout still counts */
      }
    }
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
