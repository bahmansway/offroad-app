import { BACKOFF, createRealtimeClient, MAX_AUTH_FAILS, type SocketLike, type Timers } from '../realtimeClient';

/** Fake socket.io socket: records connect() calls and lets the test fire events. */
class FakeSocket implements SocketLike {
  connected = false;
  active = false;
  auth: unknown;
  connects: unknown[] = [];
  handlers = new Map<string, ((...a: any[]) => void)[]>();
  constructor(public opts: Record<string, unknown>) {
    this.auth = opts.auth;
  }
  on(e: string, fn: (...a: any[]) => void) {
    this.handlers.set(e, [...(this.handlers.get(e) ?? []), fn]);
    return this;
  }
  emit(e: string, ...a: any[]) {
    for (const h of this.handlers.get(e) ?? []) h(...a);
  }
  connect() {
    this.connects.push(this.auth);
    this.active = true;
    return this;
  }
  disconnect() {
    this.connected = false;
    this.active = false;
    return this;
  }
  removeAllListeners() {
    this.handlers.clear();
    return this;
  }
  // test helpers
  ready() {
    this.connected = true;
    this.emit('connect');
    this.emit('ready', { userId: 'u1' });
  }
}

/** Manual clock. */
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map<number, { at: number; fn: () => void; every?: number }>();
  const t: Timers & { advance(ms: number): void; pending(): number } = {
    setTimeout: (fn, ms) => { const id = nextId++; tasks.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (h) => { tasks.delete(h as number); },
    setInterval: (fn, ms) => { const id = nextId++; tasks.set(id, { at: now + ms, fn, every: ms }); return id; },
    clearInterval: (h) => { tasks.delete(h as number); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...tasks.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, task] = due;
        now = task.at;
        if (task.every) task.at += task.every; else tasks.delete(id);
        task.fn();
      }
      now = end;
    },
    pending: () => tasks.size,
  };
  return t;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(o: { token?: string | null; refreshTo?: (string | null)[] } = {}) {
  const timers = fakeTimers();
  const sockets: FakeSocket[] = [];
  let token: string | null = o.token === undefined ? 'A1' : o.token;
  const refreshQueue = [...(o.refreshTo ?? ['A2'])];
  const refresh = jest.fn(async (_stale: string | undefined) => {
    const next = refreshQueue.length ? refreshQueue.shift()! : null;
    if (next) token = next;
    return next;
  });
  const statuses: string[] = [];
  const onPoll = jest.fn();
  const onReady = jest.fn();
  const onMessage = jest.fn();
  const rt = createRealtimeClient({
    url: 'http://api',
    io: (_url, opts) => { const s = new FakeSocket(opts); sockets.push(s); return s; },
    getToken: async () => token,
    refresh,
    onStatus: (s) => statuses.push(s),
    onPoll,
    onReady,
    onMessage,
    timers,
  });
  return { rt, timers, sockets, refresh, statuses, onPoll, onReady, onMessage, setToken: (t: string) => { token = t; } };
}

describe('realtime client', () => {
  it('connects with the access token over websocket on /socket.io', async () => {
    const { rt, sockets } = setup();
    rt.start();
    await flush();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].opts).toMatchObject({ path: '/socket.io', transports: ['websocket'], auth: { token: 'A1' } });
    expect(sockets[0].connects).toEqual([{ token: 'A1' }]);
    sockets[0].ready();
    expect(rt.status).toBe('connected');
  });

  it('delivers message:new', async () => {
    const { rt, sockets, onMessage } = setup();
    rt.start();
    await flush();
    sockets[0].ready();
    sockets[0].emit('message:new', { id: 'm1' });
    expect(onMessage).toHaveBeenCalledWith({ id: 'm1' });
  });

  it('on UNAUTHORIZED: refreshes via the API client, sets the new token, reconnects', async () => {
    const { rt, sockets, refresh } = setup({ refreshTo: ['A2'] });
    rt.start();
    await flush();
    const s = sockets[0];
    s.active = false; // middleware rejection: socket.io will not retry by itself
    s.emit('connect_error', { message: 'UNAUTHORIZED' });
    await flush();
    expect(refresh).toHaveBeenCalledWith('A1');
    expect(s.auth).toEqual({ token: 'A2' });
    expect(s.connects).toEqual([{ token: 'A1' }, { token: 'A2' }]);
    expect(sockets).toHaveLength(1); // same socket, new auth
  });

  it('when the server drops the socket (token expired) it refreshes and reconnects', async () => {
    const { rt, sockets, refresh } = setup({ refreshTo: ['A2'] });
    rt.start();
    await flush();
    sockets[0].ready();
    sockets[0].connected = false;
    sockets[0].active = false;
    sockets[0].emit('disconnect', 'io server disconnect');
    expect(rt.status).toBe('offline');
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(sockets[0].connects.at(-1)).toEqual({ token: 'A2' });
  });

  it('polls every 10 s while disconnected and stops once connected', async () => {
    const { rt, sockets, timers, onPoll, onReady } = setup();
    rt.start();
    await flush();
    timers.advance(10_000);
    expect(onPoll).toHaveBeenCalledTimes(1); // still "connecting"
    timers.advance(20_000);
    expect(onPoll).toHaveBeenCalledTimes(3);
    sockets[0].ready();
    expect(onReady).toHaveBeenCalledTimes(1); // catch-up after connect
    timers.advance(60_000);
    expect(onPoll).toHaveBeenCalledTimes(3);
    // dropped by the network → polling again
    sockets[0].connected = false;
    sockets[0].emit('disconnect', 'transport close');
    timers.advance(10_000);
    expect(onPoll).toHaveBeenCalledTimes(4);
  });

  it('if refresh fails it keeps polling and retries with backoff', async () => {
    const { rt, sockets, timers, refresh, onPoll } = setup({ refreshTo: [null, 'A3'] });
    rt.start();
    await flush();
    sockets[0].active = false;
    sockets[0].emit('connect_error', { message: 'UNAUTHORIZED' });
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(rt.status).toBe('offline');
    timers.advance(BACKOFF[0]);
    await flush();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(sockets[0].connects.at(-1)).toEqual({ token: 'A3' });
    timers.advance(10_000);
    expect(onPoll).toHaveBeenCalled();
  });

  it('retries a plain connect error with backoff when socket.io gave up', async () => {
    const { rt, sockets, timers } = setup();
    rt.start();
    await flush();
    sockets[0].active = false;
    sockets[0].emit('connect_error', { message: 'xhr poll error' });
    expect(sockets[0].connects).toHaveLength(1);
    timers.advance(BACKOFF[0]);
    await flush();
    expect(sockets[0].connects).toHaveLength(2);
  });

  it('leaves retries to socket.io while it is still active', async () => {
    const { rt, sockets, timers, refresh } = setup();
    rt.start();
    await flush();
    sockets[0].active = true;
    sockets[0].emit('connect_error', { message: 'websocket error' });
    timers.advance(5_000);
    await flush();
    expect(sockets[0].connects).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reconnects with the latest stored token when the app comes to the foreground', async () => {
    const { rt, sockets, setToken } = setup();
    rt.start();
    await flush();
    sockets[0].ready();
    rt.foreground();
    await flush();
    expect(sockets[0].connects).toHaveLength(1); // already connected: nothing to do
    sockets[0].connected = false;
    sockets[0].active = false;
    sockets[0].emit('disconnect', 'transport close');
    setToken('A9'); // e.g. a request refreshed meanwhile
    rt.foreground();
    await flush();
    expect(sockets[0].connects.at(-1)).toEqual({ token: 'A9' });
  });

  it('stays offline (polling) without a token, and stop() cleans everything', async () => {
    const { rt, sockets, timers, onPoll } = setup({ token: null });
    rt.start();
    await flush();
    expect(sockets).toHaveLength(0);
    expect(rt.status).toBe('offline');
    timers.advance(10_000);
    expect(onPoll).toHaveBeenCalledTimes(1);
    rt.stop();
    expect(rt.status).toBe('idle');
    expect(timers.pending()).toBe(0);
  });

  it('ignores late events after stop()', async () => {
    const { rt, sockets, refresh } = setup();
    rt.start();
    await flush();
    const s = sockets[0];
    const handlers = new Map(s.handlers);
    rt.stop();
    for (const h of handlers.get('connect_error') ?? []) h({ message: 'UNAUTHORIZED' });
    await flush();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('repeated UNAUTHORIZED after a successful refresh: backs off, gives up after 3 and stays on polling', async () => {
    const { rt, sockets, timers, refresh, onPoll } = setup({ refreshTo: ['A2', 'A3', 'A4', 'A5'] });
    rt.start();
    await flush();
    const s = sockets[0];
    s.active = false;
    s.emit('connect_error', { message: 'UNAUTHORIZED' }); // 1st: refresh at once
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    s.emit('connect_error', { message: 'UNAUTHORIZED' }); // 2nd: no immediate refresh…
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    timers.advance(BACKOFF[0]); // …only after a pause
    await flush();
    expect(refresh).toHaveBeenCalledTimes(2);
    for (let i = 2; i < MAX_AUTH_FAILS; i++) s.emit('connect_error', { message: 'UNAUTHORIZED' }); // 3rd: give up
    await flush();
    timers.advance(120_000);
    await flush();
    expect(refresh).toHaveBeenCalledTimes(2);
    const connects = s.connects.length;
    expect(onPoll.mock.calls.length).toBeGreaterThanOrEqual(10); // still fetching every 10 s
    // coming back to the app tries again
    rt.foreground();
    await flush();
    expect(s.connects.length).toBe(connects + 1);
  });

  it('a successful connect resets the auth failure count', async () => {
    const { rt, sockets, timers, refresh } = setup({ refreshTo: ['A2', 'A3', 'A4'] });
    rt.start();
    await flush();
    const s = sockets[0];
    s.active = false;
    s.emit('connect_error', { message: 'UNAUTHORIZED' });
    await flush();
    s.emit('connect_error', { message: 'UNAUTHORIZED' });
    timers.advance(BACKOFF[0]);
    await flush();
    s.ready(); // connected fine
    s.connected = false;
    s.emit('connect_error', { message: 'UNAUTHORIZED' }); // counts from 1 again → immediate refresh
    await flush();
    expect(refresh).toHaveBeenCalledTimes(3);
  });
});

describe('v3 socket events', () => {
  it('forwards message:deleted, conversation:pinned, event:updated and clan:invite; ignores junk', async () => {
    let sock: FakeSocket | null = null;
    const got: string[] = [];
    const c = createRealtimeClient({
      url: 'http://x',
      io: (_u, o) => (sock = new FakeSocket(o)),
      getToken: async () => 'tok',
      refresh: async () => null,
      timers: fakeTimers(),
      onMessageDeleted: (d) => got.push(`del:${d.id}`),
      onPinned: (p) => got.push(`pin:${p.conversationId}:${p.pinned ? 'on' : 'off'}`),
      onEventUpdated: (e) => got.push(`ev:${e.eventId}`),
      onClanInvite: (i) => got.push(`inv:${i.id}`),
    });
    c.start();
    await flush();
    sock!.ready();
    sock!.emit('message:deleted', { id: 'm1', conversationId: 'c1', deletedAt: 'x' });
    sock!.emit('conversation:pinned', { conversationId: 'c1', pinned: null });
    sock!.emit('event:updated', { eventId: 'e1' });
    sock!.emit('clan:invite', { id: 'i1', clan: { id: 'k', name: 'K', tag: 'K', logoUrl: null }, invitedBy: null, createdAt: '', expiresAt: '' });
    sock!.emit('message:deleted', null);
    sock!.emit('event:updated', {});
    expect(got).toEqual(['del:m1', 'pin:c1:off', 'ev:e1', 'inv:i1']);
    c.stop();
  });
});
