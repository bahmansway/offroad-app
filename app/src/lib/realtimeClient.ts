import type { ConversationUpdate, Message } from './types';

/**
 * Live chat connection (Socket.IO). No React here so the reconnect rules can be unit-tested.
 *
 * - Connects with the access token in the handshake (`auth: { token }`).
 * - `connect_error` "UNAUTHORIZED" or the server dropping us (token expired after 15 min): get a fresh
 *   token through the API client's refresh (same lock + rotation rules as every request), put it in
 *   `socket.auth`, connect again.
 * - Any other drop: socket.io retries by itself; if it gives up we retry with a backoff.
 * - While not connected, `onPoll` fires every 10 s so the app can fetch over REST instead.
 * - `foreground()` (app back on screen) reconnects right away.
 */

export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'offline';

export interface SocketLike {
  connected: boolean;
  /** false after a middleware rejection or a server-side disconnect: socket.io won't retry by itself */
  active: boolean;
  auth: unknown;
  on(event: string, fn: (...args: any[]) => void): unknown;
  connect(): unknown;
  disconnect(): unknown;
  removeAllListeners(): unknown;
}

export type IoFactory = (url: string, opts: Record<string, unknown>) => SocketLike;

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
}

export interface RealtimeOptions {
  url: string;
  io: IoFactory;
  /** current access token (null = logged out) */
  getToken: () => Promise<string | null>;
  /** refresh after `stale` was rejected; resolves to the new access token or null */
  refresh: (stale: string | undefined) => Promise<string | null>;
  onMessage?: (m: Message) => void;
  onConversation?: (u: ConversationUpdate) => void;
  onStatus?: (s: RealtimeStatus) => void;
  /** fires right after a (re)connect is ready, so the app can catch up on what it missed */
  onReady?: () => void;
  /** fires every `pollMs` while not connected */
  onPoll?: () => void;
  pollMs?: number;
  timers?: Timers;
}

/** Waits between manual reconnect attempts (ms). */
export const BACKOFF = [1000, 2000, 5000, 10000, 30000];
/** After this many UNAUTHORIZED rejections in a row (even with fresh tokens) stop trying; polling continues. */
export const MAX_AUTH_FAILS = 3;

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export function createRealtimeClient(o: RealtimeOptions) {
  const timers = o.timers ?? defaultTimers;
  const pollMs = o.pollMs ?? 10_000;
  let socket: SocketLike | null = null;
  let status: RealtimeStatus = 'idle';
  let stopped = true;
  let token: string | undefined;
  let attempt = 0;
  let retryTimer: unknown = null;
  let pollTimer: unknown = null;
  let refreshing = false;
  /** UNAUTHORIZED rejections since the last successful connect */
  let authFails = 0;
  let gaveUp = false;
  /** bumps on stop() so late async work from an old session does nothing */
  let session = 0;

  function setStatus(s: RealtimeStatus) {
    if (s === status) return;
    status = s;
    o.onStatus?.(s);
    if (s === 'connected') stopPolling();
    else if (!stopped) startPolling();
  }

  function startPolling() {
    if (pollTimer || stopped) return;
    pollTimer = timers.setInterval(() => o.onPoll?.(), pollMs);
  }
  function stopPolling() {
    if (pollTimer) timers.clearInterval(pollTimer);
    pollTimer = null;
  }
  function clearRetry() {
    if (retryTimer) timers.clearTimeout(retryTimer);
    retryTimer = null;
  }

  function scheduleRetry(fn: () => void) {
    clearRetry();
    const wait = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
    attempt++;
    const my = session;
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      if (my === session && !stopped) fn();
    }, wait);
  }

  /** (Re)connect with the newest stored token. */
  async function connectNow() {
    const my = session;
    const t = await o.getToken();
    if (my !== session || stopped) return;
    if (!t) {
      setStatus('offline');
      return;
    }
    token = t;
    if (!socket) {
      socket = o.io(o.url, {
        path: '/socket.io',
        auth: { token: t },
        transports: ['websocket'],
        autoConnect: false,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
      });
      wire(socket);
    } else {
      socket.auth = { token: t };
    }
    if (socket.connected) return;
    setStatus('connecting');
    socket.connect();
  }

  /** Token was rejected (or expired): refresh, then reconnect. */
  async function refreshAndReconnect() {
    if (refreshing) return;
    refreshing = true;
    const my = session;
    try {
      const fresh = await o.refresh(token);
      if (my !== session || stopped) return;
      if (fresh && fresh !== token) {
        token = fresh;
        if (socket) socket.auth = { token: fresh };
        setStatus('connecting');
        socket?.connect();
      } else {
        // could not refresh right now (offline / server busy): keep polling, try again later
        setStatus('offline');
        scheduleRetry(() => { refreshAndReconnect(); });
      }
    } catch {
      if (my === session && !stopped) {
        setStatus('offline');
        scheduleRetry(() => { refreshAndReconnect(); });
      }
    } finally {
      refreshing = false;
    }
  }

  function wire(s: SocketLike) {
    s.on('ready', () => {
      attempt = 0;
      authFails = 0;
      gaveUp = false;
      clearRetry();
      setStatus('connected');
      o.onReady?.();
    });
    s.on('message:new', (m: Message) => o.onMessage?.(m));
    s.on('conversation:updated', (u: ConversationUpdate) => o.onConversation?.(u));
    s.on('connect_error', (err: { message?: string } | undefined) => {
      if (stopped) return;
      setStatus('offline');
      if (err?.message === 'UNAUTHORIZED') {
        authFails++;
        if (authFails >= MAX_AUTH_FAILS) {
          // the server keeps rejecting even fresh tokens: stop, stay on polling until foreground()/start()
          gaveUp = true;
          clearRetry();
          return;
        }
        // first rejection: refresh right away; repeated ones: wait (backoff) before refreshing again
        if (authFails === 1) refreshAndReconnect();
        else scheduleRetry(() => { refreshAndReconnect(); });
      } else if (!s.active) {
        scheduleRetry(() => { connectNow(); });
      }
      // otherwise socket.io's own reconnection is still trying
    });
    s.on('disconnect', (reason: string) => {
      if (stopped) return;
      setStatus('offline');
      if (reason === 'io server disconnect') {
        // the server dropped us: usually the access token expired
        refreshAndReconnect();
      } else if (reason === 'io client disconnect' || gaveUp) {
        // we called disconnect() ourselves
      } else if (!s.active) {
        scheduleRetry(() => { connectNow(); });
      }
    });
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      attempt = 0;
      authFails = 0;
      gaveUp = false;
      connectNow();
    },
    stop() {
      stopped = true;
      session++;
      clearRetry();
      stopPolling();
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
      socket = null;
      token = undefined;
      status = 'idle';
      o.onStatus?.('idle');
    },
    /** App came back to the foreground (or browser went online): reconnect now if needed. */
    foreground() {
      if (stopped) return;
      if (socket?.connected && status === 'connected') return;
      attempt = 0;
      authFails = 0;
      gaveUp = false;
      clearRetry();
      connectNow();
    },
    get status() {
      return status;
    },
  };
}

export type RealtimeClient = ReturnType<typeof createRealtimeClient>;
