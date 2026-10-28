import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { io as ioClient, type Socket } from 'socket.io-client';
import { makeApp, noisePng, register, resetDb } from './helpers.js';

type U = Awaited<ReturnType<typeof register>>;
let app: FastifyInstance;
let base: string;
let leader: U, joiner: U, outsider: U, other: U, third: U;
const sockets: Socket[] = [];

beforeAll(async () => {
  await resetDb();
  app = await makeApp({ RATE_LIMIT_MESSAGES: '30' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
  leader = await register(app, 'Leader');
  joiner = await register(app, 'Joiner');
  outsider = await register(app, 'Outsider');
  other = await register(app, 'Other');
  third = await register(app, 'Third');
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await app.close();
});

const req = (method: string, url: string, user?: U, payload?: unknown) =>
  app.inject({ method: method as any, url, headers: user?.auth, payload: payload as any });

function connect(token: string | null, transports = ['websocket']): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(base, { path: '/socket.io', auth: token ? { token } : {}, transports, reconnection: false, forceNew: true });
    sockets.push(s);
    s.on('ready', () => resolve(s));
    s.on('connect_error', (e) => reject(e));
  });
}
function collect(s: Socket, event: string) {
  const got: any[] = [];
  s.on(event, (p) => got.push(p));
  return got;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout');
    await wait(20);
  }
}

let clanId: string;
let clanConv: string;

describe('clans', () => {
  it('create: validation, unique name/tag (case-insensitive), clan chat created', async () => {
    expect((await req('POST', '/api/clans', undefined, { name: 'Mud Wolves', tag: 'MUD' })).statusCode).toBe(401);
    for (const p of [{ name: 'ab', tag: 'MW' }, { name: 'x'.repeat(41), tag: 'MW' }, { name: 'Mud Wolves', tag: 'M' }, { name: 'Mud Wolves', tag: 'TOOLONG' }, { name: 'Mud Wolves', tag: 'M W' }, { name: 'Mud Wolves', tag: 'MW', description: 'x'.repeat(501) }, { name: 'Mud Wolves', tag: 'MW', extra: 1 }]) {
      expect((await req('POST', '/api/clans', leader, p)).statusCode, JSON.stringify(p)).toBe(400);
    }
    const r = await req('POST', '/api/clans', leader, { name: 'Mud Wolves', tag: 'MÜD', description: 'Weekend mud', city: 'Bakı', isOpen: false });
    expect(r.statusCode).toBe(201);
    const c = r.json();
    clanId = c.id;
    clanConv = c.conversationId;
    expect(c).toMatchObject({ name: 'Mud Wolves', tag: 'MÜD', isOpen: false, memberCount: 1, myRole: 'leader', logoUrl: null, leader: { id: leader.user.id } });
    expect(clanConv).toMatch(/[0-9a-f-]{36}/);

    const dupName = await req('POST', '/api/clans', other, { name: 'mud wolves', tag: 'XX' });
    expect(dupName.statusCode).toBe(409);
    expect(dupName.json().error.code).toBe('CONFLICT');
    expect((await req('POST', '/api/clans', other, { name: 'Other Clan', tag: 'müd' })).statusCode).toBe(409);
    // leader can't make a second clan
    expect((await req('POST', '/api/clans', leader, { name: 'Second Clan', tag: 'SC' })).statusCode).toBe(409);

    const conv = (await req('GET', '/api/conversations', leader)).json();
    expect(conv).toEqual([expect.objectContaining({ id: clanConv, type: 'clan', title: 'Mud Wolves', unreadCount: 0, lastMessage: null })]);
    // anonymous / non-member view hides the chat id
    expect((await req('GET', `/api/clans/${clanId}`)).json()).toMatchObject({ myRole: null, conversationId: null });
    expect((await req('GET', '/api/clans?q=wolv')).json().items.map((x: any) => x.id)).toEqual([clanId]);
    expect((await req('GET', '/api/clans?q=zzz')).json().items).toEqual([]);
  });

  it('request clan: request -> pending -> leader approves; non-leader cannot', async () => {
    const j = await req('POST', `/api/clans/${clanId}/join`, joiner);
    expect(j.statusCode).toBe(200);
    expect(j.json()).toMatchObject({ myRole: 'pending', memberCount: 1, conversationId: null });
    // still pending: no chat access
    expect((await req('GET', `/api/conversations/${clanConv}/messages`, joiner)).statusCode).toBe(403);

    expect((await req('GET', `/api/clans/${clanId}/requests`, joiner)).statusCode).toBe(403);
    expect((await req('POST', `/api/clans/${clanId}/requests/${joiner.user.id}/approve`, joiner)).statusCode).toBe(403);
    const reqs = (await req('GET', `/api/clans/${clanId}/requests`, leader)).json().items;
    expect(reqs.map((x: any) => x.user.id)).toEqual([joiner.user.id]);

    // outsider requests, leader rejects
    await req('POST', `/api/clans/${clanId}/join`, outsider);
    expect((await req('POST', `/api/clans/${clanId}/requests/${outsider.user.id}/reject`, leader)).statusCode).toBe(204);
    expect((await req('GET', `/api/clans/${clanId}`, outsider)).json().myRole).toBeNull();
    expect((await req('POST', `/api/clans/${clanId}/requests/${outsider.user.id}/approve`, leader)).statusCode).toBe(404);

    expect((await req('POST', `/api/clans/${clanId}/requests/${joiner.user.id}/approve`, leader)).statusCode).toBe(204);
    const after = (await req('GET', `/api/clans/${clanId}`, joiner)).json();
    expect(after).toMatchObject({ myRole: 'member', memberCount: 2, conversationId: clanConv });
    const members = (await req('GET', `/api/clans/${clanId}/members`)).json().items;
    expect(members.map((m: any) => [m.user.id, m.role])).toEqual([[leader.user.id, 'leader'], [joiner.user.id, 'member']]);
    expect((await req('GET', `/api/users/${joiner.user.id}`)).json().clan).toMatchObject({ id: clanId, role: 'member' });
  });

  it('one clan per user', async () => {
    const open = await req('POST', '/api/clans', other, { name: 'Open Riders', tag: 'OPEN', isOpen: true });
    expect(open.statusCode).toBe(201);
    const openId = open.json().id;
    // member of Mud Wolves cannot join or create another clan
    const r = await req('POST', `/api/clans/${openId}/join`, joiner);
    expect(r.statusCode).toBe(409);
    expect((await req('POST', '/api/clans', joiner, { name: 'Joiner Clan', tag: 'JC' })).statusCode).toBe(409);
    // pending request elsewhere is dropped when the user joins an open clan; stale approval -> 409
    await req('POST', `/api/clans/${clanId}/join`, third);
    const joined = await req('POST', `/api/clans/${openId}/join`, third);
    expect(joined.json()).toMatchObject({ myRole: 'member', memberCount: 2 });
    expect((await req('GET', `/api/clans/${clanId}`, third)).json().myRole).toBeNull();
    // raw request row re-created then approved while third is in another clan
    await (app as any).db.$client.query('insert into clan_requests (clan_id, user_id) values ($1, $2)', [clanId, third.user.id]);
    expect((await req('POST', `/api/clans/${clanId}/requests/${third.user.id}/approve`, leader)).statusCode).toBe(409);
    expect((await req('GET', `/api/clans/${clanId}/requests`, leader)).json().items).toEqual([]);
    // the database itself refuses a second membership
    await expect(
      (app as any).db.$client.query("insert into clan_members (user_id, clan_id, role) values ($1, $2, 'member')", [third.user.id, clanId]),
    ).rejects.toThrow();
  });

  it('leader-only actions', async () => {
    const png = Buffer.from('not an image at all, definitely not');
    const checks: [string, string, unknown?][] = [
      ['PATCH', `/api/clans/${clanId}`, { description: 'hacked' }],
      ['DELETE', `/api/clans/${clanId}`],
      ['DELETE', `/api/clans/${clanId}/members/${leader.user.id}`],
      ['POST', `/api/clans/${clanId}/leader`, { userId: joiner.user.id }],
      ['GET', `/api/clans/${clanId}/requests`],
      ['DELETE', `/api/clans/${clanId}/logo`],
    ];
    for (const [m, u, p] of checks) {
      const r = await req(m, u, joiner, p);
      expect(r.statusCode, `${m} ${u}`).toBe(403);
    }
    expect((await app.inject({ method: 'PUT', url: `/api/clans/${clanId}/logo`, headers: { ...joiner.auth, 'content-type': 'image/png' }, payload: png })).statusCode).toBe(403);
    const big = await noisePng();
    expect(big.length).toBeGreaterThan(256 * 1024);
    const logo = await app.inject({ method: 'PUT', url: `/api/clans/${clanId}/logo`, headers: { ...leader.auth, 'content-type': 'image/png' }, payload: big });
    expect(logo.statusCode, logo.body).toBe(200);
    expect((await req('GET', `/api/clans/${clanId}`)).json().logoUrl).toBe(logo.json().logoUrl);
    const ok = await req('PATCH', `/api/clans/${clanId}`, leader, { description: 'Updated', isOpen: false });
    expect(ok.json()).toMatchObject({ description: 'Updated' });
    expect((await req('PATCH', `/api/clans/${clanId}`, leader, { name: 'open riders' })).statusCode).toBe(409);
  });

  it('concurrent leader actions cannot leave two leaders or a leaderless clan', async () => {
    const l = await register(app, 'RaceLeader');
    const m1 = await register(app, 'RaceM1');
    const m2 = await register(app, 'RaceM2');
    const c = (await req('POST', '/api/clans', l, { name: 'Race Crew', tag: 'RACE' })).json();
    await req('POST', `/api/clans/${c.id}/join`, m1);
    await req('POST', `/api/clans/${c.id}/join`, m2);
    // hand over to two people at once: exactly one wins
    const [h1, h2] = await Promise.all([
      req('POST', `/api/clans/${c.id}/leader`, l, { userId: m1.user.id }),
      req('POST', `/api/clans/${c.id}/leader`, l, { userId: m2.user.id }),
    ]);
    expect([h1.statusCode, h2.statusCode].sort()).toEqual([200, 403]);
    const pool = (app as any).db.$client;
    const leaders = (await pool.query("select user_id from clan_members where clan_id = $1 and role = 'leader'", [c.id])).rows;
    expect(leaders.length).toBe(1);
    const clanRow = (await pool.query('select leader_id from clans where id = $1', [c.id])).rows[0];
    expect(clanRow.leader_id).toBe(leaders[0].user_id);
    const newLeader = leaders[0].user_id === m1.user.id ? m1 : m2;
    const otherM = newLeader === m1 ? m2 : m1;
    // new leader removes the old leader while the old leader tries to leave: no error state, no leaderless clan
    const [rm, lv] = await Promise.all([
      req('DELETE', `/api/clans/${c.id}/members/${l.user.id}`, newLeader),
      req('POST', `/api/clans/${c.id}/leave`, l),
    ]);
    expect([rm.statusCode, lv.statusCode].every((s) => s === 200 || s === 204 || s === 404), `${rm.statusCode} ${rm.body} ${lv.statusCode} ${lv.body}`).toBe(true);
    expect((await req('GET', `/api/clans/${c.id}`, l)).json().myRole).toBeNull();
    // removing a non-member / a leader -> 404, never deletes the leader row
    expect((await req('DELETE', `/api/clans/${c.id}/members/${l.user.id}`, newLeader)).statusCode).toBe(404);
    // cleanup so later tests don't see this clan
    await req('DELETE', `/api/clans/${c.id}/members/${otherM.user.id}`, newLeader);
    expect((await req('DELETE', `/api/clans/${c.id}`, newLeader)).statusCode).toBe(204);
  });

  it('leader must hand over before leaving; cannot delete with members', async () => {
    const leave = await req('POST', `/api/clans/${clanId}/leave`, leader);
    expect(leave.statusCode).toBe(409);
    expect((await req('DELETE', `/api/clans/${clanId}`, leader)).statusCode).toBe(409);
    expect((await req('DELETE', `/api/clans/${clanId}/members/${leader.user.id}`, leader)).statusCode).toBe(409);
    expect((await req('POST', `/api/clans/${clanId}/leader`, leader, { userId: outsider.user.id })).statusCode).toBe(404);
  });
});

describe('chat', () => {
  let leaderSock: Socket, joinerSock: Socket, outsiderSock: Socket;

  it('socket auth: rejects missing/bad tokens and refresh tokens', async () => {
    await expect(connect(null)).rejects.toThrow('UNAUTHORIZED');
    await expect(connect('garbage')).rejects.toThrow('UNAUTHORIZED');
    await expect(connect(leader.refreshToken)).rejects.toThrow('UNAUTHORIZED');
    leaderSock = await connect(leader.accessToken);
    joinerSock = await connect(joiner.accessToken, ['polling', 'websocket']); // polling upgrade path also works
    outsiderSock = await connect(outsider.accessToken);
  });

  it('members chat in real time; non-member gets 403 and no socket events', async () => {
    const joinerGot = collect(joinerSock, 'message:new');
    const joinerConv = collect(joinerSock, 'conversation:updated');
    const outsiderGot = collect(outsiderSock, 'message:new');
    const outsiderConv = collect(outsiderSock, 'conversation:updated');

    const r = await req('POST', `/api/conversations/${clanConv}/messages`, leader, { text: '  Salam!  ', clientId: 'c1' });
    expect(r.statusCode).toBe(201);
    const msg = r.json();
    expect(msg).toMatchObject({ conversationId: clanConv, text: 'Salam!', clientId: 'c1', sender: { id: leader.user.id, avatarUrl: null } });
    await until(() => joinerGot.length === 1 && joinerConv.length === 1);
    expect(joinerGot[0]).toEqual(msg);
    expect(joinerConv[0]).toMatchObject({ id: clanConv, lastMessage: { id: msg.id } });

    // same clientId again -> same message, no duplicate
    const dup = await req('POST', `/api/conversations/${clanConv}/messages`, leader, { text: 'Salam!', clientId: 'c1' });
    expect(dup.statusCode).toBe(200);
    expect(dup.json().id).toBe(msg.id);

    await req('POST', `/api/conversations/${clanConv}/messages`, joiner, { text: 'Hey', clientId: 'j1' });
    const list = (await req('GET', `/api/conversations/${clanConv}/messages`, leader)).json();
    expect(list.items.map((m: any) => m.text)).toEqual(['Salam!', 'Hey']);
    expect(list.hasMore).toBe(false);

    // non-member: 403 on read/post/read-mark, nothing over the socket
    expect((await req('GET', `/api/conversations/${clanConv}/messages`, outsider)).statusCode).toBe(403);
    expect((await req('POST', `/api/conversations/${clanConv}/messages`, outsider, { text: 'let me in' })).statusCode).toBe(403);
    expect((await req('POST', `/api/conversations/${clanConv}/read`, outsider)).statusCode).toBe(403);
    expect((await req('GET', `/api/conversations/${clanConv}`, outsider)).statusCode).toBe(403);
    await wait(150);
    expect(outsiderGot).toEqual([]);
    expect(outsiderConv).toEqual([]);

    // validation
    for (const p of [{ text: '' }, { text: '   ' }, { text: 'x'.repeat(2001) }, { text: 'ok', clientId: 'x'.repeat(65) }, { text: 'ok', extra: true }]) {
      expect((await req('POST', `/api/conversations/${clanConv}/messages`, leader, p)).statusCode, JSON.stringify(p)).toBe(400);
    }
    expect((await req('GET', `/api/conversations/00000000-0000-0000-0000-000000000000/messages`, leader)).statusCode).toBe(404);
  });

  it('unread counts and read marker; pagination', async () => {
    let c = (await req('GET', '/api/conversations', leader)).json().find((x: any) => x.id === clanConv);
    expect(c.unreadCount).toBe(1); // joiner's "Hey"
    expect(c.lastMessage.text).toBe('Hey');
    expect((await req('POST', `/api/conversations/${clanConv}/read`, leader)).statusCode).toBe(204);
    c = (await req('GET', '/api/conversations', leader)).json().find((x: any) => x.id === clanConv);
    expect(c.unreadCount).toBe(0);

    for (let i = 0; i < 5; i++) await req('POST', `/api/conversations/${clanConv}/messages`, joiner, { text: `m${i}` });
    const p1 = (await req('GET', `/api/conversations/${clanConv}/messages?limit=3`, leader)).json();
    expect(p1.items.map((m: any) => m.text)).toEqual(['m2', 'm3', 'm4']);
    expect(p1.hasMore).toBe(true);
    const p2 = (await req('GET', `/api/conversations/${clanConv}/messages?limit=3&before=${p1.items[0].id}`, leader)).json();
    expect(p2.items.map((m: any) => m.text)).toEqual(['Hey', 'm0', 'm1']);
    expect((await req('GET', `/api/conversations/${clanConv}/messages?limit=101`, leader)).statusCode).toBe(400);
  });

  it('removed member loses clan chat access (REST + socket)', async () => {
    const got = collect(joinerSock, 'message:new');
    expect((await req('DELETE', `/api/clans/${clanId}/members/${joiner.user.id}`, leader)).statusCode).toBe(204);
    expect((await req('GET', `/api/conversations/${clanConv}/messages`, joiner)).statusCode).toBe(403);
    expect((await req('GET', '/api/conversations', joiner)).json().find((x: any) => x.id === clanConv)).toBeUndefined();
    await req('POST', `/api/conversations/${clanConv}/messages`, leader, { text: 'secret plan' });
    await wait(150);
    expect(got).toEqual([]);
    expect((await req('GET', `/api/clans/${clanId}`, joiner)).json().myRole).toBeNull();
  });

  it('member leaves -> loses access; hand over leadership; leader then leaves; last one deletes', async () => {
    // joiner re-requests and is approved; socket joins the room live
    await req('POST', `/api/clans/${clanId}/join`, joiner);
    await req('POST', `/api/clans/${clanId}/requests/${joiner.user.id}/approve`, leader);
    const got = collect(joinerSock, 'message:new');
    await req('POST', `/api/conversations/${clanConv}/messages`, leader, { text: 'welcome back' });
    await until(() => got.length === 1);

    const h = await req('POST', `/api/clans/${clanId}/leader`, leader, { userId: joiner.user.id });
    expect(h.statusCode).toBe(200);
    expect(h.json()).toMatchObject({ leader: { id: joiner.user.id }, myRole: 'member' });
    expect((await req('PATCH', `/api/clans/${clanId}`, leader, { description: 'x' })).statusCode).toBe(403);
    expect((await req('POST', `/api/clans/${clanId}/leave`, leader)).json().myRole).toBeNull();
    expect((await req('GET', `/api/conversations/${clanConv}/messages`, leader)).statusCode).toBe(403);
    expect((await req('POST', `/api/clans/${clanId}/leave`, leader)).statusCode).toBe(404);
    // new leader alone -> can delete; chat goes with it
    expect((await req('DELETE', `/api/clans/${clanId}`, joiner)).statusCode).toBe(204);
    expect((await req('GET', `/api/clans/${clanId}`)).statusCode).toBe(404);
    expect((await req('GET', `/api/conversations/${clanConv}/messages`, joiner)).statusCode).toBe(404);
  });

  let dmId: string;
  let dmMsgId: string;

  it('DMs: get-or-create, realtime, not to self', async () => {
    expect((await req('POST', '/api/conversations/dm', leader, { userId: leader.user.id })).statusCode).toBe(400);
    expect((await req('POST', '/api/conversations/dm', leader, { userId: '00000000-0000-0000-0000-000000000000' })).statusCode).toBe(404);
    const r = await req('POST', '/api/conversations/dm', leader, { userId: outsider.user.id });
    expect(r.statusCode).toBe(200);
    dmId = r.json().id;
    expect(r.json()).toMatchObject({ type: 'dm', title: outsider.user.displayName, otherUser: { id: outsider.user.id } });
    expect((await req('POST', '/api/conversations/dm', outsider, { userId: leader.user.id })).json().id).toBe(dmId);

    const got = collect(outsiderSock, 'message:new'); // joined the new room live
    const joinerGot = collect(joinerSock, 'message:new');
    const m = await req('POST', `/api/conversations/${dmId}/messages`, leader, { text: 'Hi there' });
    expect(m.statusCode).toBe(201);
    dmMsgId = m.json().id;
    await until(() => got.length === 1);
    expect(got[0].text).toBe('Hi there');
    await wait(100);
    expect(joinerGot).toEqual([]);
    expect((await req('GET', `/api/conversations/${dmId}/messages`, joiner)).statusCode).toBe(403);
  });

  it('report a message (only if you can see it) and a clan', async () => {
    expect((await req('POST', '/api/reports', outsider, { targetType: 'message', targetId: dmMsgId, reason: 'rude' })).statusCode).toBe(201);
    expect((await req('POST', '/api/reports', joiner, { targetType: 'message', targetId: dmMsgId, reason: 'rude' })).statusCode).toBe(404);
    const openClan = (await req('GET', '/api/clans?q=open')).json().items[0];
    expect((await req('POST', '/api/reports', outsider, { targetType: 'clan', targetId: openClan.id, reason: 'offensive name' })).statusCode).toBe(201);
    expect((await req('POST', '/api/reports', outsider, { targetType: 'clan', targetId: dmMsgId, reason: 'x' })).statusCode).toBe(404);
  });

  it('block: no new DMs either way, blocked messages hidden, unblock restores', async () => {
    expect((await req('POST', `/api/users/${outsider.user.id}/block`, outsider)).statusCode).toBe(400);
    expect((await req('POST', `/api/users/${leader.user.id}/block`, outsider)).statusCode).toBe(204);
    expect((await req('POST', `/api/users/${leader.user.id}/block`, outsider)).statusCode).toBe(204); // idempotent
    expect((await req('GET', '/api/me/blocks', outsider)).json().items.map((u: any) => u.id)).toEqual([leader.user.id]);
    expect((await req('GET', `/api/users/${leader.user.id}`, outsider)).json().isBlocked).toBe(true);

    // existing DM: blocked user can't post, blocker can't either
    expect((await req('POST', `/api/conversations/${dmId}/messages`, leader, { text: 'hello?' })).statusCode).toBe(403);
    expect((await req('POST', `/api/conversations/${dmId}/messages`, outsider, { text: 'hm' })).statusCode).toBe(403);
    // new DM can't be opened
    expect((await req('POST', '/api/conversations/dm', leader, { userId: outsider.user.id })).statusCode).toBe(403);
    // earlier messages from the blocked user are hidden for the blocker
    expect((await req('GET', `/api/conversations/${dmId}/messages`, outsider)).json().items).toEqual([]);
    const conv = (await req('GET', '/api/conversations', outsider)).json().find((x: any) => x.id === dmId);
    expect(conv).toMatchObject({ lastMessage: null, unreadCount: 0 });
    // ...but the sender still sees their own
    expect((await req('GET', `/api/conversations/${dmId}/messages`, leader)).json().items.length).toBe(1);

    expect((await req('DELETE', `/api/users/${leader.user.id}/block`, outsider)).statusCode).toBe(204);
    expect((await req('POST', `/api/conversations/${dmId}/messages`, leader, { text: 'friends again' })).statusCode).toBe(201);
    expect((await req('GET', `/api/conversations/${dmId}/messages`, outsider)).json().items.length).toBe(2);
  });

  it('blocked sender in a shared clan: hidden over REST and socket for the blocker', async () => {
    // other leads "Open Riders" (open), third is a member; outsider joins; outsider blocks third
    const openClan = (await req('GET', '/api/clans?q=open', outsider)).json().items[0];
    await req('POST', `/api/clans/${openClan.id}/join`, outsider);
    const conv = (await req('GET', `/api/clans/${openClan.id}`, outsider)).json().conversationId;
    await req('POST', `/api/users/${third.user.id}/block`, outsider);
    const got = collect(outsiderSock, 'message:new');
    const thirdSock = await connect(third.accessToken);
    void thirdSock;
    const otherSock = await connect(other.accessToken);
    const otherGot = collect(otherSock, 'message:new');
    expect((await req('POST', `/api/conversations/${conv}/messages`, third, { text: 'from third' })).statusCode).toBe(201);
    await until(() => otherGot.length === 1);
    await wait(100);
    expect(got).toEqual([]);
    expect((await req('GET', `/api/conversations/${conv}/messages`, outsider)).json().items).toEqual([]);
    expect((await req('GET', `/api/conversations/${conv}/messages`, other)).json().items.length).toBe(1);
  });

  it('30 messages per minute per user', async () => {
    const r = await req('POST', '/api/conversations/dm', other, { userId: third.user.id });
    const id = r.json().id;
    const codes: number[] = [];
    for (let i = 0; i < 32; i++) codes.push((await req('POST', `/api/conversations/${id}/messages`, other, { text: `spam ${i}` })).statusCode);
    expect(codes.filter((c) => c === 201).length).toBe(30);
    expect(codes.slice(30)).toEqual([429, 429]);
    // per user: the other side can still talk
    expect((await req('POST', `/api/conversations/${id}/messages`, third, { text: 'calm down' })).statusCode).toBe(201);
  });
});
