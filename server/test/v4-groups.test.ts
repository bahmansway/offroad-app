import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import sharp from 'sharp';
import { io as ioClient, type Socket } from 'socket.io-client';
import { makeApp, register, resetDb, TEST_DB_URL } from './helpers.js';

type U = Awaited<ReturnType<typeof register>>;
let app: FastifyInstance;
let base: string;
let sql: pg.Client;
const sockets: Socket[] = [];

const req = (method: string, url: string, user?: U, payload?: unknown) =>
  app.inject({ method: method as any, url, headers: user?.auth, payload: payload as any });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout');
    await wait(20);
  }
}
function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(base, { path: '/socket.io', auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(s);
    s.on('ready', () => resolve(s));
    s.on('connect_error', reject);
  });
}
async function befriend(a: string, b: string) {
  await sql.query(`insert into friendships (user_id, friend_id) values ($1, $2), ($2, $1) on conflict do nothing`, [a, b]);
}
const send = (u: U, convId: string, text: string) => req('POST', `/api/conversations/${convId}/messages`, u, { text });
const messages = async (u: U, convId: string) => (await req('GET', `/api/conversations/${convId}/messages`, u)).json().items;
const systemKeys = async (u: U, convId: string) =>
  (await messages(u, convId)).filter((m: any) => m.type === 'system').map((m: any) => m.systemKey);

beforeAll(async () => {
  await resetDb();
  app = await makeApp({ RATE_LIMIT_MESSAGES: '1000' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  sql = new pg.Client({ connectionString: TEST_DB_URL });
  await sql.connect();
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await sql.end();
  await app.close();
});

describe('group chats (acceptance check 3)', () => {
  let admin: U, b: U, c: U, d: U, stranger: U;
  let gid: string;
  const inbox: Record<string, any[]> = { b: [], c: [], d: [], cRemoved: [], bUpdated: [] };

  beforeAll(async () => {
    admin = await register(app, 'Admin');
    b = await register(app, 'Bahruz');
    c = await register(app, 'Ceyhun');
    d = await register(app, 'Davud');
    stranger = await register(app, 'Stranger');
    for (const u of [b, c, d]) await befriend(admin.user.id, u.user.id);
    // sockets connected before the group exists: membership must sync live
    const sb = await connect(b.accessToken);
    const sc = await connect(c.accessToken);
    const sd = await connect(d.accessToken);
    sb.on('message:new', (m) => inbox.b.push(m));
    sc.on('message:new', (m) => inbox.c.push(m));
    sd.on('message:new', (m) => inbox.d.push(m));
    sc.on('group:removed', (p) => inbox.cRemoved.push(p));
    sb.on('group:updated', (p) => inbox.bUpdated.push(p));
  });

  it('create: validation and friends-only', async () => {
    const create = (by: U | undefined, body: unknown) => req('POST', '/api/conversations/group', by, body);
    expect((await create(undefined, { name: 'X', userIds: [b.user.id] })).statusCode).toBe(401);
    expect((await create(admin, { name: 'X', userIds: [] })).statusCode).toBe(400);
    expect((await create(admin, { name: '', userIds: [b.user.id] })).statusCode).toBe(400);
    expect((await create(admin, { name: 'x'.repeat(41), userIds: [b.user.id] })).statusCode).toBe(400);
    expect((await create(admin, { name: 'X', userIds: [b.user.id], extra: 1 })).statusCode).toBe(400);
    expect((await create(admin, { name: 'X', userIds: [admin.user.id] })).statusCode).toBe(400);
    expect((await create(admin, { name: 'X', userIds: Array(20).fill(b.user.id) })).statusCode).toBe(400);
    // non-friend -> 403 (acceptance check 2)
    const nf = await create(admin, { name: 'X', userIds: [b.user.id, stranger.user.id] });
    expect(nf.statusCode).toBe(403);
    expect((await create(admin, { name: 'X', userIds: ['00000000-0000-4000-8000-000000000000'] })).statusCode).toBe(403);
    expect((await sql.query(`select count(*)::int n from conversations where type = 'group'`)).rows[0].n).toBe(0);
  });

  it('create works; members get it live', async () => {
    const r = await req('POST', '/api/conversations/group', admin, { name: 'Qobustan crew', userIds: [b.user.id, c.user.id, b.user.id] });
    expect(r.statusCode).toBe(201);
    const g = r.json();
    gid = g.id;
    expect(g).toMatchObject({
      type: 'group',
      title: 'Qobustan crew',
      avatarUrl: null,
      adminId: admin.user.id,
      isAdmin: true,
      memberCount: 3,
      canPin: true,
      lastMessage: { type: 'system', systemKey: 'group.created', systemParams: { name: 'Qobustan crew', byUserId: admin.user.id } },
    });
    await until(() => inbox.b.length === 1 && inbox.c.length === 1);
    expect((await req('GET', `/api/conversations/${gid}`, b)).json()).toMatchObject({ isAdmin: false, canPin: false, adminId: admin.user.id });
    expect((await req('GET', '/api/conversations', b)).json().map((x: any) => x.id)).toContain(gid);
    const members = (await req('GET', `/api/conversations/${gid}/members`, b)).json().items;
    expect(members.map((m: any) => [m.user.id, m.isAdmin])).toEqual([
      [admin.user.id, true],
      [b.user.id, false],
      [c.user.id, false],
    ]);
    // live message to members
    expect((await send(b, gid, 'salam hamıya')).statusCode).toBe(201);
    await until(() => inbox.c.some((m) => m.text === 'salam hamıya'));
    expect(inbox.d).toEqual([]);
  });

  it('non-members get 403 everywhere', async () => {
    expect((await req('GET', `/api/conversations/${gid}`, stranger)).statusCode).toBe(403);
    expect((await req('GET', `/api/conversations/${gid}/messages`, stranger)).statusCode).toBe(403);
    expect((await req('GET', `/api/conversations/${gid}/members`, stranger)).statusCode).toBe(403);
    expect((await send(stranger, gid, 'hi')).statusCode).toBe(403);
    expect((await req('PATCH', `/api/conversations/${gid}`, stranger, { name: 'Mine' })).statusCode).toBe(403);
    expect((await req('POST', `/api/conversations/${gid}/members`, stranger, { userIds: [d.user.id] })).statusCode).toBe(403);
    expect((await req('DELETE', `/api/conversations/${gid}/members/${b.user.id}`, stranger)).statusCode).toBe(403);
    expect((await req('PUT', `/api/conversations/${gid}/mute`, stranger)).statusCode).toBe(403);
    expect((await req('GET', `/api/conversations/00000000-0000-4000-8000-000000000000`, stranger)).statusCode).toBe(404);
  });

  it('plain members cannot manage the group', async () => {
    expect((await req('PATCH', `/api/conversations/${gid}`, b, { name: 'Mine' })).statusCode).toBe(403);
    expect((await req('POST', `/api/conversations/${gid}/members`, b, { userIds: [d.user.id] })).statusCode).toBe(403);
    expect((await req('DELETE', `/api/conversations/${gid}/members/${c.user.id}`, b)).statusCode).toBe(403);
    expect((await req('DELETE', `/api/conversations/${gid}/avatar`, b)).statusCode).toBe(403);
    const m = (await messages(b, gid)).find((x: any) => x.type === 'user');
    expect((await req('PUT', `/api/conversations/${gid}/pin`, b, { messageId: m.id })).statusCode).toBe(403);
  });

  it('admin renames (system message only when it changes)', async () => {
    expect((await req('PATCH', `/api/conversations/${gid}`, admin, { name: '  ' })).statusCode).toBe(400);
    const r = await req('PATCH', `/api/conversations/${gid}`, admin, { name: 'Qobustan 4x4' });
    expect(r.statusCode).toBe(200);
    expect(r.json().title).toBe('Qobustan 4x4');
    await req('PATCH', `/api/conversations/${gid}`, admin, { name: 'Qobustan 4x4' });
    expect(await systemKeys(b, gid)).toEqual(['group.created', 'group.renamed']);
    await until(() => inbox.bUpdated.length > 0);
  });

  it('admin sets the group photo', async () => {
    const png = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#336699' } }).png().toBuffer();
    const r = await app.inject({
      method: 'PUT',
      url: `/api/conversations/${gid}/avatar`,
      headers: { ...admin.auth, 'content-type': 'image/png' },
      payload: png,
    });
    expect(r.statusCode).toBe(200);
    const url = r.json().avatarUrl;
    expect((await req('GET', `/api/conversations/${gid}`, b)).json().avatarUrl).toBe(url);
    const img = await app.inject({ method: 'GET', url });
    expect((await sharp(img.rawPayload).metadata()).width).toBe(512);
    const bad = await app.inject({
      method: 'PUT',
      url: `/api/conversations/${gid}/avatar`,
      headers: { ...b.auth, 'content-type': 'image/png' },
      payload: png,
    });
    expect(bad.statusCode).toBe(403);
  });

  it('admin adds friends only; added member syncs live', async () => {
    expect((await req('POST', `/api/conversations/${gid}/members`, admin, { userIds: [stranger.user.id] })).statusCode).toBe(403);
    expect((await req('POST', `/api/conversations/${gid}/members`, admin, { userIds: [b.user.id] })).statusCode).toBe(409);
    const r = await req('POST', `/api/conversations/${gid}/members`, admin, { userIds: [d.user.id, b.user.id] });
    expect(r.statusCode).toBe(200);
    expect(r.json().memberCount).toBe(4);
    await until(() => inbox.d.some((m) => m.systemKey === 'group.added'));
    expect(inbox.d.find((m) => m.systemKey === 'group.added').systemParams).toMatchObject({ userId: d.user.id, byUserId: admin.user.id });
    await send(admin, gid, 'Davud, xoş gəldin');
    await until(() => inbox.d.some((m) => m.text === 'Davud, xoş gəldin'));
  });

  it('pin (admin), mute, delete own, reports work in groups', async () => {
    const mine = (await send(b, gid, 'my msg')).json();
    const p = await req('PUT', `/api/conversations/${gid}/pin`, admin, { messageId: mine.id });
    expect(p.statusCode).toBe(200);
    expect((await req('GET', `/api/conversations/${gid}`, c)).json().pinned.message.id).toBe(mine.id);
    expect((await req('DELETE', `/api/conversations/${gid}/pin`, b)).statusCode).toBe(403);
    expect((await req('PUT', `/api/conversations/${gid}/mute`, c)).json()).toEqual({ muted: true });
    expect((await req('GET', `/api/conversations/${gid}`, c)).json().muted).toBe(true);
    const adminMsg = (await messages(b, gid)).find((m: any) => m.sender?.id === admin.user.id);
    expect((await req('DELETE', `/api/conversations/${gid}/messages/${adminMsg.id}`, b)).statusCode).toBe(403);
    expect((await req('DELETE', `/api/conversations/${gid}/messages/${mine.id}`, b)).statusCode).toBe(204);
    expect((await req('GET', `/api/conversations/${gid}`, c)).json().pinned).toBeNull();
    const rep = await req('POST', '/api/reports', c, { targetType: 'message', targetId: adminMsg.id, reason: 'spam' });
    expect(rep.statusCode).toBe(201);
    expect((await req('POST', '/api/reports', stranger, { targetType: 'message', targetId: adminMsg.id, reason: 'x' })).statusCode).toBe(404);
  });

  it('admin removes a member: they lose access and stop getting messages', async () => {
    expect((await req('DELETE', `/api/conversations/${gid}/members/${stranger.user.id}`, admin)).statusCode).toBe(404);
    expect((await req('DELETE', `/api/conversations/${gid}/members/${c.user.id}`, admin)).statusCode).toBe(204);
    await until(() => inbox.cRemoved.length === 1);
    expect(inbox.cRemoved[0]).toEqual({ conversationId: gid });
    expect((await req('GET', `/api/conversations/${gid}/messages`, c)).statusCode).toBe(403);
    const before = inbox.c.length;
    await send(admin, gid, 'after removal');
    await until(() => inbox.b.some((m) => m.text === 'after removal'));
    await wait(100);
    expect(inbox.c.length).toBe(before);
    expect((await systemKeys(b, gid)).slice(-1)).toEqual(['group.removed']);
    expect((await req('GET', '/api/conversations', c)).json().map((x: any) => x.id)).not.toContain(gid);
  });

  it('admin leaves: longest-standing member becomes admin', async () => {
    expect((await req('DELETE', `/api/conversations/${gid}/members/${admin.user.id}`, admin)).statusCode).toBe(204);
    expect((await systemKeys(b, gid)).slice(-2)).toEqual(['group.left', 'group.admin']);
    const s = (await req('GET', `/api/conversations/${gid}`, b)).json();
    expect(s).toMatchObject({ adminId: b.user.id, isAdmin: true, canPin: true, memberCount: 2 });
    expect((await req('GET', `/api/conversations/${gid}`, admin)).statusCode).toBe(403);
    // the new admin can manage now
    expect((await req('PATCH', `/api/conversations/${gid}`, b, { name: 'Bahruz group' })).statusCode).toBe(200);
  });

  it('a member leaves; the last one out deletes the group', async () => {
    expect((await req('DELETE', `/api/conversations/${gid}/members/${d.user.id}`, d)).statusCode).toBe(204);
    expect((await systemKeys(b, gid)).slice(-1)).toEqual(['group.left']);
    expect((await req('GET', `/api/conversations/${gid}`, b)).json().adminId).toBe(b.user.id);
    expect((await req('DELETE', `/api/conversations/${gid}/members/${b.user.id}`, b)).statusCode).toBe(204);
    expect((await sql.query(`select count(*)::int n from conversations where id = $1`, [gid])).rows[0].n).toBe(0);
    expect((await sql.query(`select count(*)::int n from images where kind = 'group'`)).rows[0].n).toBe(0);
    expect((await req('GET', `/api/conversations/${gid}`, b)).statusCode).toBe(404);
  });

  it('cap 20 members', async () => {
    const owner = await register(app, 'Owner');
    const ids = (
      await sql.query(
        `insert into users (email, password_hash, display_name) select 'g' || g || '@example.com', 'x', 'G ' || g from generate_series(1, 20) g returning id`,
      )
    ).rows.map((r) => r.id);
    for (const id of ids) await befriend(owner.user.id, id);
    const r = await req('POST', '/api/conversations/group', owner, { name: 'Big', userIds: ids.slice(0, 19) });
    expect(r.statusCode).toBe(201);
    expect(r.json().memberCount).toBe(20);
    const add = await req('POST', `/api/conversations/${r.json().id}/members`, owner, { userIds: [ids[19]] });
    expect(add.statusCode).toBe(409);
    expect(add.json().error.message).toMatch(/20/);
    // a smaller group can't jump past 20 either
    const small = (await req('POST', '/api/conversations/group', owner, { name: 'Small', userIds: ids.slice(0, 2) })).json();
    expect((await req('POST', `/api/conversations/${small.id}/members`, owner, { userIds: ids.slice(2, 20) })).statusCode).toBe(409);
    expect((await req('POST', `/api/conversations/${small.id}/members`, owner, { userIds: ids.slice(2, 19) })).statusCode).toBe(200);
  });

  it('group-only actions on other chats return 400', async () => {
    const x = await register(app, 'Xeyal');
    const dm = (await req('POST', '/api/conversations/dm', x, { userId: stranger.user.id })).json();
    expect((await req('PATCH', `/api/conversations/${dm.id}`, x, { name: 'DM' })).statusCode).toBe(400);
    expect((await req('POST', `/api/conversations/${dm.id}/members`, x, { userIds: [b.user.id] })).statusCode).toBe(400);
    expect((await req('DELETE', `/api/conversations/${dm.id}/members/${x.user.id}`, x)).statusCode).toBe(400);
    expect((await req('GET', `/api/conversations/${dm.id}`, x)).json()).toMatchObject({ adminId: null, isAdmin: false, memberCount: 2 });
  });
});
