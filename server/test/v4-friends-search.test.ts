import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { io as ioClient, type Socket } from 'socket.io-client';
import { makeApp, register, resetDb, TEST_DB_URL } from './helpers.js';
import { MIGRATIONS_DIR } from '../src/db/migrate.js';

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
/** Fast users straight in the database (no password hashing). */
async function bulkUsers(n: number, prefix: string): Promise<string[]> {
  const r = await sql.query(
    `insert into users (email, password_hash, display_name)
     select $1 || g || '@example.com', 'x', $1 || ' ' || g from generate_series(1, $2::int) g returning id`,
    [prefix, n],
  );
  return r.rows.map((x) => x.id);
}

/** A v3 database with data in it; buildApp then applies the v4 migration on top. */
async function seedV3Database() {
  await resetDb();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  fs.cpSync(MIGRATIONS_DIR, tmp, { recursive: true });
  const journal = JSON.parse(fs.readFileSync(path.join(tmp, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: any) => e.idx <= 3);
  fs.writeFileSync(path.join(tmp, 'meta/_journal.json'), JSON.stringify(journal));
  const pool = new pg.Pool({ connectionString: TEST_DB_URL });
  await migrate(drizzle(pool), { migrationsFolder: tmp });
  await pool.query(`
    insert into users (id, email, password_hash, display_name) values
      ('11111111-1111-4111-8111-111111111111', 'old1@example.com', 'x', 'Old One'),
      ('22222222-2222-4222-8222-222222222222', 'old2@example.com', 'x', 'Old Two');
    insert into spots (id, owner_id, type, name, lat, lng) values
      ('66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', 'camp', 'Old Camp', 40.4, 49.8);
    insert into spot_ratings (spot_id, user_id, stars, updated_at) values
      ('66666666-6666-4666-8666-666666666666', '22222222-2222-4222-8222-222222222222', 4, '2026-05-05T10:00:00Z');
    insert into conversations (id, type, dm_key) values ('55555555-5555-4555-8555-555555555555', 'dm', '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222');
    insert into messages (conversation_id, sender_id, text) values
      ('55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222', 'old dm');
  `);
  await pool.end();
  fs.rmSync(tmp, { recursive: true, force: true });
}

beforeAll(async () => {
  await seedV3Database();
  app = await makeApp();
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

describe('v4 migration on a live v3 database', () => {
  it('keeps old rows; old ratings get created_at from updated_at', async () => {
    const r = await sql.query(`select created_at, updated_at from spot_ratings`);
    expect(r.rows[0].created_at.toISOString()).toBe('2026-05-05T10:00:00.000Z');
    const c = await sql.query(`select type, name, admin_id from conversations`);
    expect(c.rows).toEqual([{ type: 'dm', name: null, admin_id: null }]);
    expect((await sql.query(`select text from messages`)).rows[0].text).toBe('old dm');
    // a group needs a name (check constraint)
    await expect(sql.query(`insert into conversations (type) values ('group')`)).rejects.toThrow();
  });
});

describe('friend requests (acceptance check 1)', () => {
  let a: U, b: U, c: U;
  let sa: Socket, sb: Socket;
  const got: Record<string, any[]> = { aReq: [], bReq: [], aAcc: [], bAcc: [] };
  beforeAll(async () => {
    a = await register(app, 'Anar');
    b = await register(app, 'Bayram');
    c = await register(app, 'Cavid');
    sa = await connect(a.accessToken);
    sb = await connect(b.accessToken);
    sa.on('friend:request', (p) => got.aReq.push(p));
    sb.on('friend:request', (p) => got.bReq.push(p));
    sa.on('friend:accepted', (p) => got.aAcc.push(p));
    sb.on('friend:accepted', (p) => got.bAcc.push(p));
  });

  it('validates input', async () => {
    expect((await req('POST', '/api/friends/requests', undefined, { userId: b.user.id })).statusCode).toBe(401);
    expect((await req('POST', '/api/friends/requests', a, { userId: a.user.id })).statusCode).toBe(400);
    expect((await req('POST', '/api/friends/requests', a, { userId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(404);
    expect((await req('POST', '/api/friends/requests', a, { userId: b.user.id, x: 1 })).statusCode).toBe(400);
    expect((await req('POST', '/api/friends/requests', a, { userId: 'nope' })).statusCode).toBe(400);
    expect((await req('GET', '/api/friends/requests?dir=sideways', a)).statusCode).toBe(400);
    expect((await req('POST', '/api/friends/requests/not-a-uuid/accept', a)).statusCode).toBe(404);
  });

  it('A requests B; B sees badge + incoming; profile fields; socket', async () => {
    const r = await req('POST', '/api/friends/requests', a, { userId: b.user.id });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.status).toBe('pending');
    expect(body.request).toMatchObject({ from: { id: a.user.id }, to: { id: b.user.id } });
    expect((await req('POST', '/api/friends/requests', a, { userId: b.user.id })).statusCode).toBe(409);
    await until(() => got.bReq.length === 1);
    expect(got.bReq[0]).toMatchObject({ id: body.request.id, from: { id: a.user.id, displayName: a.user.displayName } });
    expect((await req('GET', '/api/me/badges', b)).json()).toEqual({ messages: 0, friendRequests: 1, clanInvites: 0, newFollowers: 1 });
    expect((await req('GET', '/api/me/badges', a)).json()).toEqual({ messages: 0, friendRequests: 0, clanInvites: 0, newFollowers: 0 });
    const inB = (await req('GET', '/api/friends/requests?dir=in', b)).json().items;
    expect(inB.map((x: any) => x.id)).toEqual([body.request.id]);
    expect((await req('GET', '/api/friends/requests?dir=out', a)).json().items.map((x: any) => x.to.id)).toEqual([b.user.id]);
    expect((await req('GET', '/api/friends/requests?dir=in', a)).json().items).toEqual([]);
    expect((await req('GET', `/api/users/${b.user.id}`, a)).json()).toMatchObject({
      friendship: 'outgoing',
      requestId: body.request.id,
      friendCount: 0,
      mutualFriends: 0,
    });
    expect((await req('GET', `/api/users/${a.user.id}`, b)).json()).toMatchObject({ friendship: 'incoming', requestId: body.request.id });
    expect((await req('GET', `/api/users/${a.user.id}`)).json()).toMatchObject({ friendship: 'none', requestId: null });
    // only the recipient can accept or decline
    expect((await req('POST', `/api/friends/requests/${body.request.id}/accept`, a)).statusCode).toBe(404);
    expect((await req('POST', `/api/friends/requests/${body.request.id}/decline`, c)).statusCode).toBe(404);
    // only the sender can cancel
    expect((await req('DELETE', `/api/friends/requests/${body.request.id}`, b)).statusCode).toBe(404);
  });

  it('B accepts; both are friends; socket to both; unfriend', async () => {
    const id = (await req('GET', '/api/friends/requests?dir=in', b)).json().items[0].id;
    const r = await req('POST', `/api/friends/requests/${id}/accept`, b);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: 'friends', user: { id: a.user.id } });
    await until(() => got.aAcc.length === 1 && got.bAcc.length === 1);
    expect(got.aAcc[0].user.id).toBe(b.user.id);
    expect(got.bAcc[0].user.id).toBe(a.user.id);
    expect((await req('POST', `/api/friends/requests/${id}/accept`, b)).statusCode).toBe(404);
    expect((await req('GET', '/api/friends', a)).json().items.map((x: any) => x.user.id)).toEqual([b.user.id]);
    expect((await req('GET', '/api/friends', b)).json().items.map((x: any) => x.user.id)).toEqual([a.user.id]);
    expect((await req('GET', '/api/me/badges', b)).json().friendRequests).toBe(0);
    expect((await req('POST', '/api/friends/requests', b, { userId: a.user.id })).statusCode).toBe(409);
    expect((await req('GET', `/api/users/${b.user.id}`, a)).json()).toMatchObject({ friendship: 'friends', requestId: null, friendCount: 1 });

    // mutual friends: C befriends both
    for (const u of [a, b]) {
      const rq = (await req('POST', '/api/friends/requests', c, { userId: u.user.id })).json().request;
      expect((await req('POST', `/api/friends/requests/${rq.id}/accept`, u)).statusCode).toBe(200);
    }
    expect((await req('GET', `/api/users/${b.user.id}`, a)).json()).toMatchObject({ friendCount: 2, mutualFriends: 1 });
    // searchable list
    const q = encodeURIComponent('cav');
    expect((await req('GET', `/api/friends?q=${q}`, a)).json().items.map((x: any) => x.user.id)).toEqual([c.user.id]);

    expect((await req('DELETE', `/api/friends/${b.user.id}`, a)).statusCode).toBe(204);
    expect((await req('DELETE', `/api/friends/${b.user.id}`, a)).statusCode).toBe(204);
    expect((await req('GET', '/api/friends', a)).json().items.map((x: any) => x.user.id)).toEqual([c.user.id]);
    expect((await req('GET', '/api/friends', b)).json().items.map((x: any) => x.user.id)).toEqual([c.user.id]);
    expect((await req('GET', `/api/users/${b.user.id}`, a)).json()).toMatchObject({ friendship: 'none', mutualFriends: 1 });
  });

  it('crossing requests auto-accept', async () => {
    const x = await register(app, 'Xan');
    const y = await register(app, 'Yusif');
    expect((await req('POST', '/api/friends/requests', x, { userId: y.user.id })).statusCode).toBe(201);
    const r = await req('POST', '/api/friends/requests', y, { userId: x.user.id });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: 'friends', request: null, user: { id: x.user.id } });
    expect((await req('GET', '/api/friends/requests?dir=out', x)).json().items).toEqual([]);
    expect((await req('GET', '/api/friends', x)).json().items.map((i: any) => i.user.id)).toEqual([y.user.id]);
  });

  it('simultaneous crossing requests end as one friendship, no leftover request', async () => {
    for (let i = 0; i < 3; i++) {
      const x = await register(app, 'ParX');
      const y = await register(app, 'ParY');
      const [r1, r2] = await Promise.all([
        req('POST', '/api/friends/requests', x, { userId: y.user.id }),
        req('POST', '/api/friends/requests', y, { userId: x.user.id }),
      ]);
      expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 201]);
      const left = await sql.query(`select count(*)::int n from friend_requests where from_id in ($1, $2)`, [x.user.id, y.user.id]);
      expect(left.rows[0].n).toBe(0);
      const f = await sql.query(`select count(*)::int n from friendships where user_id in ($1, $2)`, [x.user.id, y.user.id]);
      expect(f.rows[0].n).toBe(2);
    }
  });

  it('decline: 24 h cooldown for the sender, hidden from lists', async () => {
    const d = await register(app, 'Dilan');
    const e = await register(app, 'Elnur');
    const id = (await req('POST', '/api/friends/requests', d, { userId: e.user.id })).json().request.id;
    expect((await req('POST', `/api/friends/requests/${id}/decline`, e)).statusCode).toBe(204);
    expect((await req('POST', `/api/friends/requests/${id}/decline`, e)).statusCode).toBe(404);
    expect((await req('POST', `/api/friends/requests/${id}/accept`, e)).statusCode).toBe(404);
    expect((await req('GET', '/api/friends/requests?dir=in', e)).json().items).toEqual([]);
    expect((await req('GET', '/api/friends/requests?dir=out', d)).json().items).toEqual([]);
    expect((await req('GET', `/api/users/${e.user.id}`, d)).json().friendship).toBe('none');
    const again = await req('POST', '/api/friends/requests', d, { userId: e.user.id });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.message).toMatch(/24 hours/);
    // after 24 h it works again
    await sql.query(`update friend_requests set declined_at = now() - interval '25 hours' where id = $1`, [id]);
    expect((await req('POST', '/api/friends/requests', d, { userId: e.user.id })).statusCode).toBe(201);
  });

  it('cancel own outgoing request', async () => {
    const l = await register(app, 'Leyla');
    const m = await register(app, 'Murad');
    const id = (await req('POST', '/api/friends/requests', l, { userId: m.user.id })).json().request.id;
    expect((await req('GET', '/api/me/badges', m)).json().friendRequests).toBe(1);
    expect((await req('DELETE', `/api/friends/requests/${id}`, l)).statusCode).toBe(204);
    expect((await req('DELETE', `/api/friends/requests/${id}`, l)).statusCode).toBe(404);
    expect((await req('GET', '/api/me/badges', m)).json().friendRequests).toBe(0);
    expect((await req('POST', `/api/friends/requests/${id}/accept`, m)).statusCode).toBe(404);
    // no cooldown after a cancel
    expect((await req('POST', '/api/friends/requests', l, { userId: m.user.id })).statusCode).toBe(201);
  });

  it('blocked either way -> 403; blocking ends friendship and pending requests', async () => {
    const h = await register(app, 'Hikmet');
    const i = await register(app, 'Ilkin');
    await req('POST', `/api/users/${i.user.id}/block`, h);
    expect((await req('POST', '/api/friends/requests', h, { userId: i.user.id })).statusCode).toBe(403);
    expect((await req('POST', '/api/friends/requests', i, { userId: h.user.id })).statusCode).toBe(403);

    const j = await register(app, 'Jale');
    const k = await register(app, 'Kamal');
    const id = (await req('POST', '/api/friends/requests', j, { userId: k.user.id })).json().request.id;
    await req('POST', `/api/friends/requests/${id}/accept`, k);
    const id2 = (await req('POST', '/api/friends/requests', h, { userId: k.user.id })).json().request.id;
    expect((await req('GET', '/api/friends', j)).json().items).toHaveLength(1);
    await req('POST', `/api/users/${j.user.id}/block`, k);
    expect((await req('GET', '/api/friends', j)).json().items).toEqual([]);
    expect((await req('GET', '/api/friends', k)).json().items).toEqual([]);
    // incoming request from someone I then block: gone
    await req('POST', `/api/users/${h.user.id}/block`, k);
    expect((await req('POST', `/api/friends/requests/${id2}/accept`, k)).statusCode).toBe(404);
    expect((await req('GET', '/api/me/badges', k)).json().friendRequests).toBe(0);
  });

  it('block racing an accept never leaves blocked friends', async () => {
    for (let i = 0; i < 5; i++) {
      const x = await register(app, 'RaceX');
      const y = await register(app, 'RaceY');
      const id = (await req('POST', '/api/friends/requests', x, { userId: y.user.id })).json().request.id;
      const [acc, blk] = await Promise.all([
        req('POST', `/api/friends/requests/${id}/accept`, y),
        req('POST', `/api/users/${y.user.id}/block`, x),
      ]);
      expect(blk.statusCode).toBe(204);
      expect([200, 403, 404]).toContain(acc.statusCode);
      const f = await sql.query(`select count(*)::int n from friendships where user_id in ($1, $2)`, [x.user.id, y.user.id]);
      expect(f.rows[0].n).toBe(0);
    }
  });

  it('caps: 50 pending outgoing, 1000 friends', async () => {
    const n = await register(app, 'Nigar');
    const targets = await bulkUsers(51, 'capout');
    await sql.query(`insert into friend_requests (from_id, to_id) select $1, unnest($2::uuid[])`, [n.user.id, targets.slice(0, 50)]);
    const r = await req('POST', '/api/friends/requests', n, { userId: targets[50] });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.message).toMatch(/50/);

    const p = await register(app, 'Pervin');
    const q = await register(app, 'Qasim');
    const many = await bulkUsers(1000, 'capfr');
    await sql.query(
      `insert into friendships (user_id, friend_id) select $1, unnest($2::uuid[]) union all select unnest($2::uuid[]), $1`,
      [p.user.id, many],
    );
    expect((await req('POST', '/api/friends/requests', p, { userId: q.user.id })).statusCode).toBe(409);
    const id = (await req('POST', '/api/friends/requests', q, { userId: p.user.id })).json().request.id;
    const acc = await req('POST', `/api/friends/requests/${id}/accept`, p);
    expect(acc.statusCode).toBe(409);
    expect(acc.json().error.message).toMatch(/1000/);
    expect((await req('GET', '/api/friends', p)).json().items).toHaveLength(1000);
  });

  it('rate limit: 30 requests per hour', async () => {
    const r0 = await register(app, 'Rauf');
    const targets = await bulkUsers(31, 'rate');
    for (let i = 0; i < 30; i++) {
      expect((await req('POST', '/api/friends/requests', r0, { userId: targets[i] })).statusCode).toBe(201);
    }
    const r = await req('POST', '/api/friends/requests', r0, { userId: targets[30] });
    expect(r.statusCode).toBe(429);
    expect(r.json().error.code).toBe('RATE_LIMITED');
  });
});

describe('search (acceptance check 2)', () => {
  let s: U, friend: U, stranger: U, blockedBySearcher: U, blocksSearcher: U;
  beforeAll(async () => {
    s = await register(app, 'Searcher');
    friend = await register(app, 'Zaur Friend');
    stranger = await register(app, 'Zaur Stranger');
    blockedBySearcher = await register(app, 'Zaur Blocked');
    blocksSearcher = await register(app, 'Zaur Blocker');
    const id = (await req('POST', '/api/friends/requests', s, { userId: friend.user.id })).json().request.id;
    await req('POST', `/api/friends/requests/${id}/accept`, friend);
    await req('POST', `/api/users/${blockedBySearcher.user.id}/block`, s);
    await req('POST', `/api/users/${s.user.id}/block`, blocksSearcher);
    await req('POST', '/api/clans', stranger, { name: 'Zaurlar Club', tag: 'ZRL' });
    await req('POST', '/api/conversations/dm', s, { userId: stranger.user.id });
    await req('POST', '/api/conversations/group', s, { name: 'Weekend Quba', userIds: [friend.user.id] });
  });

  it('validates q', async () => {
    expect((await req('GET', '/api/search?q=a', s)).statusCode).toBe(400);
    expect((await req('GET', `/api/search?q=${'a'.repeat(41)}`, s)).statusCode).toBe(400);
    expect((await req('GET', '/api/search', s)).statusCode).toBe(400);
  });

  it('users: friends first, blocked either way excluded, never myself', async () => {
    const r = (await req('GET', '/api/search?q=zaur', s)).json();
    expect(r.users.map((u: any) => u.id)).toEqual([friend.user.id, stranger.user.id]);
    expect(r.users[0]).toMatchObject({ isFriend: true, displayName: friend.user.displayName });
    expect(r.users[1].isFriend).toBe(false);
    expect((await req('GET', '/api/search?q=searcher', s)).json().users).toEqual([]);
    // logged out: no block filter, no chats
    const anonRes = await req('GET', '/api/search?q=zaur');
    expect(anonRes.body).not.toMatch(/error/);
    const anon = anonRes.json();
    expect(anon.users).toHaveLength(4);
    expect(anon.conversations).toEqual([]);
    // wildcard characters are literal
    expect((await req('GET', '/api/search?q=%25%25', s)).json().users).toEqual([]);
  });

  it('clans and my chats (title or member name)', async () => {
    const r = (await req('GET', '/api/search?q=zaur', s)).json();
    expect(r.clans.map((c: any) => c.tag)).toEqual(['ZRL']);
    expect(r.clans[0]).toMatchObject({ name: 'Zaurlar Club', memberCount: 1, isOpen: true });
    // DM with Zaur Stranger and the group that has Zaur Friend
    expect(r.conversations.map((c: any) => c.type).sort()).toEqual(['dm', 'group']);
    const g = (await req('GET', '/api/search?q=quba', s)).json();
    expect(g.conversations.map((c: any) => c.title)).toEqual(['Weekend Quba']);
    // other people's chats never show
    expect((await req('GET', '/api/search?q=quba', stranger)).json().conversations).toEqual([]);
    // clan chat by clan name, for its member
    expect((await req('GET', '/api/search?q=zaurlar', stranger)).json().conversations.map((c: any) => c.type)).toEqual(['clan']);
  });
});
