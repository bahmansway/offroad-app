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

/** Builds a v2 database with data in it, then lets buildApp apply the v3 migration on top. */
async function seedV2Database() {
  await resetDb();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  fs.cpSync(MIGRATIONS_DIR, tmp, { recursive: true });
  const journal = JSON.parse(fs.readFileSync(path.join(tmp, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: any) => e.idx <= 1);
  fs.writeFileSync(path.join(tmp, 'meta/_journal.json'), JSON.stringify(journal));
  const pool = new pg.Pool({ connectionString: TEST_DB_URL });
  await migrate(drizzle(pool), { migrationsFolder: tmp });
  await pool.query(`
    insert into users (id, email, password_hash, display_name) values
      ('11111111-1111-4111-8111-111111111111', 'old1@example.com', 'x', 'Old One'),
      ('22222222-2222-4222-8222-222222222222', 'old2@example.com', 'x', 'Old Two');
    insert into clans (id, name, name_key, tag, leader_id) values
      ('33333333-3333-4333-8333-333333333333', 'Old Clan', 'old clan', 'OLD', '11111111-1111-4111-8111-111111111111');
    insert into clan_members (user_id, clan_id, role) values
      ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'leader'),
      ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 'member');
    insert into conversations (id, type, clan_id) values ('44444444-4444-4444-8444-444444444444', 'clan', '33333333-3333-4333-8333-333333333333');
    insert into conversations (id, type, dm_key) values ('55555555-5555-4555-8555-555555555555', 'dm', '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222');
    insert into messages (conversation_id, sender_id, text, client_id) values
      ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'old clan message', 'c1'),
      ('55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222', 'old dm', 'c2');
  `);
  await pool.end();
  fs.rmSync(tmp, { recursive: true, force: true });
}

beforeAll(async () => {
  await seedV2Database();
  app = await makeApp({ RATE_LIMIT_MESSAGES: '1000' }); // applies 0002 on top of existing rows
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

describe('migration on a live v2 database', () => {
  it('existing rows survive with v3 defaults', async () => {
    const m = await sql.query(`select type, text, deleted_at, system_key from messages order by text`);
    expect(m.rows).toEqual([
      { type: 'user', text: 'old clan message', deleted_at: null, system_key: null },
      { type: 'user', text: 'old dm', deleted_at: null, system_key: null },
    ]);
    const c = await sql.query(`select type, event_id, pinned_message_id from conversations order by type`);
    expect(c.rows).toEqual([
      { type: 'clan', event_id: null, pinned_message_id: null },
      { type: 'dm', event_id: null, pinned_message_id: null },
    ]);
    const cm = await sql.query(`select role from clan_members order by role`);
    expect(cm.rows.map((r) => r.role)).toEqual(['leader', 'member']);
  });
});

// ---------------- officers: permission matrix ----------------

describe('clan roles (acceptance check 4)', () => {
  let leader: U, officer: U, officer2: U, member: U, member2: U, outsider: U, applicant: U, applicant2: U;
  let clanId: string;
  beforeAll(async () => {
    leader = await register(app, 'Leader');
    officer = await register(app, 'Officer');
    officer2 = await register(app, 'Officer2');
    member = await register(app, 'Member');
    member2 = await register(app, 'Member2');
    outsider = await register(app, 'Outsider');
    applicant = await register(app, 'Applicant');
    applicant2 = await register(app, 'Applicant2');
    clanId = (await req('POST', '/api/clans', leader, { name: 'Rock Crawlers', tag: 'ROCK', isOpen: false })).json().id;
    for (const u of [officer, officer2, member, member2]) {
      await req('POST', `/api/clans/${clanId}/join`, u);
      expect((await req('POST', `/api/clans/${clanId}/requests/${u.user.id}/approve`, leader)).statusCode).toBe(204);
    }
  });

  it('only the leader promotes/demotes', async () => {
    const promote = (by: U | undefined, u: U, role = 'officer') => req('POST', `/api/clans/${clanId}/members/${u.user.id}/role`, by, { role });
    expect((await promote(undefined, officer)).statusCode).toBe(401);
    expect((await promote(outsider, officer)).statusCode).toBe(403);
    expect((await promote(member, officer)).statusCode).toBe(403);
    expect((await promote(leader, officer, 'leader')).statusCode).toBe(400);
    expect((await promote(leader, outsider)).statusCode).toBe(404);
    expect((await promote(leader, leader)).statusCode).toBe(409);
    let r = await promote(leader, officer);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ userId: officer.user.id, role: 'officer' });
    expect((await promote(leader, officer2)).statusCode).toBe(200);
    // officers can't promote others
    expect((await promote(officer, member)).statusCode).toBe(403);
    expect((await req('GET', `/api/clans/${clanId}`, officer)).json()).toMatchObject({ myRole: 'officer' });
    expect((await req('GET', `/api/clans/${clanId}`, officer)).json().conversationId).toMatch(/[0-9a-f-]{36}/);
    const members = (await req('GET', `/api/clans/${clanId}/members`)).json().items;
    expect(members.map((m: any) => m.role)).toEqual(['leader', 'officer', 'officer', 'member', 'member']);
    // demote and re-promote
    expect((await promote(leader, officer2, 'member')).statusCode).toBe(200);
    expect((await promote(leader, officer2)).statusCode).toBe(200);
  });

  it('requests: leader + officer approve/reject; member/outsider 403', async () => {
    await req('POST', `/api/clans/${clanId}/join`, applicant);
    await req('POST', `/api/clans/${clanId}/join`, applicant2);
    for (const u of [member, outsider]) {
      expect((await req('GET', `/api/clans/${clanId}/requests`, u)).statusCode).toBe(403);
      expect((await req('POST', `/api/clans/${clanId}/requests/${applicant.user.id}/approve`, u)).statusCode).toBe(403);
      expect((await req('POST', `/api/clans/${clanId}/requests/${applicant.user.id}/reject`, u)).statusCode).toBe(403);
    }
    expect((await req('GET', `/api/clans/${clanId}/requests`, officer)).json().items).toHaveLength(2);
    expect((await req('POST', `/api/clans/${clanId}/requests/${applicant.user.id}/approve`, officer)).statusCode).toBe(204);
    expect((await req('POST', `/api/clans/${clanId}/requests/${applicant2.user.id}/reject`, officer)).statusCode).toBe(204);
    expect((await req('POST', `/api/clans/${clanId}/requests/${applicant2.user.id}/approve`, officer)).statusCode).toBe(404);
    expect((await req('GET', `/api/clans/${clanId}`, applicant)).json().myRole).toBe('member');
    // approved user is in the clan chat
    const conv = (await req('GET', `/api/clans/${clanId}`, applicant)).json().conversationId;
    expect((await req('GET', `/api/conversations/${conv}/messages`, applicant)).statusCode).toBe(200);
  });

  it('remove: officer removes members only; leader removes officers; nobody removes the leader', async () => {
    const rm = (by: U, u: U) => req('DELETE', `/api/clans/${clanId}/members/${u.user.id}`, by);
    expect((await rm(member, member2)).statusCode).toBe(403);
    expect((await rm(outsider, member2)).statusCode).toBe(403);
    expect((await rm(officer, leader)).statusCode).toBe(403);
    expect((await rm(officer, officer2)).statusCode).toBe(403);
    expect((await rm(officer, outsider)).statusCode).toBe(404);
    expect((await rm(officer, applicant)).statusCode).toBe(204);
    expect((await req('GET', `/api/clans/${clanId}`, applicant)).json().myRole).toBeNull();
    expect((await rm(leader, officer2)).statusCode).toBe(204);
    expect((await rm(leader, leader)).statusCode).toBe(409);
    expect((await rm(officer, officer)).statusCode).toBe(409);
  });

  it('leader-only stays leader-only: edit, logo, delete, handover', async () => {
    expect((await req('PATCH', `/api/clans/${clanId}`, officer, { description: 'officer edit' })).statusCode).toBe(403);
    expect((await req('PUT', `/api/clans/${clanId}/logo`, officer)).statusCode).toBe(403);
    expect((await req('DELETE', `/api/clans/${clanId}/logo`, officer)).statusCode).toBe(403);
    expect((await req('DELETE', `/api/clans/${clanId}`, officer)).statusCode).toBe(403);
    expect((await req('POST', `/api/clans/${clanId}/leader`, officer, { userId: officer.user.id })).statusCode).toBe(403);
    expect((await req('PATCH', `/api/clans/${clanId}`, leader, { description: 'leader edit' })).statusCode).toBe(200);
  });

  it('handover to an officer; old leader becomes member; officer can leave', async () => {
    expect((await req('POST', `/api/clans/${clanId}/leader`, leader, { userId: officer.user.id })).statusCode).toBe(200);
    const members = (await req('GET', `/api/clans/${clanId}/members`)).json().items;
    expect(members.find((m: any) => m.user.id === officer.user.id).role).toBe('leader');
    expect(members.find((m: any) => m.user.id === leader.user.id).role).toBe('member');
    // hand back, then promote + let an officer leave
    expect((await req('POST', `/api/clans/${clanId}/leader`, officer, { userId: leader.user.id })).statusCode).toBe(200);
    expect((await req('POST', `/api/clans/${clanId}/members/${member2.user.id}/role`, leader, { role: 'officer' })).statusCode).toBe(200);
    expect((await req('POST', `/api/clans/${clanId}/leave`, member2)).statusCode).toBe(200);
    expect((await req('GET', `/api/clans/${clanId}`, member2)).json().myRole).toBeNull();
  });

  it('pins in clan chat: leader + officer yes, member no', async () => {
    const conv = (await req('GET', `/api/clans/${clanId}`, leader)).json().conversationId;
    // officer here is the officer (handed back above), member is a plain member
    const msg = (await req('POST', `/api/conversations/${conv}/messages`, member, { text: 'Meet at 9' })).json();
    expect((await req('PUT', `/api/conversations/${conv}/pin`, member, { messageId: msg.id })).statusCode).toBe(403);
    expect((await req('DELETE', `/api/conversations/${conv}/pin`, member)).statusCode).toBe(403);
    expect((await req('PUT', `/api/conversations/${conv}/pin`, outsider, { messageId: msg.id })).statusCode).toBe(403);
    expect((await req('GET', `/api/conversations/${conv}`, member)).json().canPin).toBe(false);
    // officer needs the officer role again (handover made them member)
    expect((await req('POST', `/api/clans/${clanId}/members/${officer.user.id}/role`, leader, { role: 'officer' })).statusCode).toBe(200);
    expect((await req('GET', `/api/conversations/${conv}`, officer)).json().canPin).toBe(true);
    const r = await req('PUT', `/api/conversations/${conv}/pin`, officer, { messageId: msg.id });
    expect(r.statusCode).toBe(200);
    expect(r.json().pinned).toMatchObject({ message: { id: msg.id, text: 'Meet at 9' }, pinnedBy: officer.user.id });
    expect((await req('GET', `/api/conversations/${conv}`, member)).json().pinned.message.id).toBe(msg.id);
    expect((await req('DELETE', `/api/conversations/${conv}/pin`, leader)).statusCode).toBe(204);
    expect((await req('GET', `/api/conversations/${conv}`, member)).json().pinned).toBeNull();
  });
});

// ---------------- invites ----------------

describe('clan invites (acceptance check 5)', () => {
  let leader: U, officer: U, member: U, invitee: U, other: U, busy: U;
  let clanId: string;
  beforeAll(async () => {
    leader = await register(app, 'InvLeader');
    officer = await register(app, 'InvOfficer');
    member = await register(app, 'InvMember');
    invitee = await register(app, 'Invitee');
    other = await register(app, 'InvOther');
    busy = await register(app, 'Busy');
    clanId = (await req('POST', '/api/clans', leader, { name: 'Desert Rats', tag: 'RATS', isOpen: false })).json().id;
    for (const u of [officer, member]) {
      await req('POST', `/api/clans/${clanId}/join`, u);
      await req('POST', `/api/clans/${clanId}/requests/${u.user.id}/approve`, leader);
    }
    await req('POST', `/api/clans/${clanId}/members/${officer.user.id}/role`, leader, { role: 'officer' });
    await req('POST', '/api/clans', busy, { name: 'Busy Clan', tag: 'BUSY' });
  });

  it('create: staff only, validation, duplicates, already in a clan', async () => {
    const invite = (by: U, u: { user: { id: string } }) => req('POST', `/api/clans/${clanId}/invites`, by, { userId: u.user.id });
    expect((await invite(member, invitee)).statusCode).toBe(403);
    expect((await invite(other, invitee)).statusCode).toBe(403);
    expect((await req('POST', `/api/clans/${clanId}/invites`, leader, { userId: 'nope' })).statusCode).toBe(400);
    expect((await req('POST', `/api/clans/${clanId}/invites`, leader, { userId: invitee.user.id, x: 1 })).statusCode).toBe(400);
    expect((await invite(leader, { user: { id: '00000000-0000-4000-8000-000000000000' } })).statusCode).toBe(404);
    expect((await invite(leader, leader)).statusCode).toBe(400);
    expect((await invite(leader, member)).statusCode).toBe(409);
    expect((await invite(leader, busy)).statusCode).toBe(409);

    const s = await connect(invitee.accessToken);
    const got: any[] = [];
    s.on('clan:invite', (p) => got.push(p));
    const r = await invite(officer, invitee);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ clan: { id: clanId, name: 'Desert Rats', tag: 'RATS' }, invitedBy: { id: officer.user.id }, user: { id: invitee.user.id } });
    const exp = new Date(r.json().expiresAt).getTime() - Date.now();
    expect(exp).toBeGreaterThan(6.9 * 86400_000);
    expect(exp).toBeLessThanOrEqual(7 * 86400_000);
    await until(() => got.length === 1);
    // duplicate
    const dup = await invite(leader, invitee);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.message).toMatch(/pending invite/);

    const staffList = (await req('GET', `/api/clans/${clanId}/invites`, leader)).json().items;
    expect(staffList.map((i: any) => i.user.id)).toEqual([invitee.user.id]);
    expect((await req('GET', `/api/clans/${clanId}/invites`, member)).statusCode).toBe(403);
    const mine = (await req('GET', '/api/me/clan-invites', invitee)).json().items;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ clan: { id: clanId }, invitedBy: { id: officer.user.id } });
  });

  it('decline / accept; not someone else\'s invite', async () => {
    const [inv] = (await req('GET', '/api/me/clan-invites', invitee)).json().items;
    expect((await req('POST', `/api/clan-invites/${inv.id}/accept`, other)).statusCode).toBe(404);
    expect((await req('POST', `/api/clan-invites/${inv.id}/decline`, other)).statusCode).toBe(404);
    expect((await req('POST', `/api/clan-invites/${inv.id}/decline`, invitee)).statusCode).toBe(204);
    expect((await req('POST', `/api/clan-invites/${inv.id}/accept`, invitee)).statusCode).toBe(404);
    // invite again and accept -> member + clan chat, pending request/invites cleared
    await req('POST', '/api/clans', other, { name: 'Other Clan', tag: 'OTH', isOpen: false });
    const otherClan = (await req('GET', '/api/clans?q=Other', other)).json().items[0].id;
    await req('POST', `/api/clans/${otherClan}/invites`, other, { userId: invitee.user.id });
    const inv2 = (await req('POST', `/api/clans/${clanId}/invites`, leader, { userId: invitee.user.id })).json();
    const r = await req('POST', `/api/clan-invites/${inv2.id}/accept`, invitee);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: clanId, myRole: 'member' });
    expect((await req('GET', '/api/me/clan-invites', invitee)).json().items).toEqual([]);
    expect((await req('GET', `/api/conversations/${r.json().conversationId}/messages`, invitee)).statusCode).toBe(200);
  });

  it('expired invites are rejected and do not block a new one', async () => {
    const u = await register(app, 'Late');
    const inv = (await req('POST', `/api/clans/${clanId}/invites`, leader, { userId: u.user.id })).json();
    await sql.query(`update clan_invites set expires_at = now() - interval '1 minute' where id = $1`, [inv.id]);
    expect((await req('GET', '/api/me/clan-invites', u)).json().items).toEqual([]);
    expect((await req('GET', `/api/clans/${clanId}/invites`, leader)).json().items.map((i: any) => i.user.id)).not.toContain(u.user.id);
    const r = await req('POST', `/api/clan-invites/${inv.id}/accept`, u);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.message).toMatch(/expired/);
    expect((await req('POST', `/api/clans/${clanId}/invites`, leader, { userId: u.user.id })).statusCode).toBe(201);
  });

  it('accepting while already in a clan -> 409 (one-clan rule)', async () => {
    const u = await register(app, 'Hopper');
    const inv = (await req('POST', `/api/clans/${clanId}/invites`, leader, { userId: u.user.id })).json();
    await req('POST', '/api/clans', u, { name: 'Hopper Clan', tag: 'HOP' });
    expect((await req('POST', `/api/clan-invites/${inv.id}/accept`, u)).statusCode).toBe(409);
    const { rows } = await sql.query(`select count(*)::int n from clan_members where user_id = $1`, [u.user.id]);
    expect(rows[0].n).toBe(1);
  });

  it('staff can revoke; max 30 pending per clan', async () => {
    const list = (await req('GET', `/api/clans/${clanId}/invites`, leader)).json().items;
    expect((await req('DELETE', `/api/clans/${clanId}/invites/${list[0].id}`, member)).statusCode).toBe(403);
    expect((await req('DELETE', `/api/clans/${clanId}/invites/${list[0].id}`, officer)).statusCode).toBe(204);
    expect((await req('DELETE', `/api/clans/${clanId}/invites/${list[0].id}`, officer)).statusCode).toBe(404);
    const pending = (await req('GET', `/api/clans/${clanId}/invites`, leader)).json().items.length;
    const ids = await sql.query(
      `insert into users (email, password_hash, display_name) select 'bulk' || g || '@example.com', 'x', 'Bulk ' || g from generate_series(1, ${31 - pending}) g returning id`,
    );
    const codes: number[] = [];
    for (const r of ids.rows) codes.push((await req('POST', `/api/clans/${clanId}/invites`, leader, { userId: r.id })).statusCode);
    expect(codes.filter((c) => c === 201)).toHaveLength(30 - pending);
    expect(codes[codes.length - 1]).toBe(409);
  });
});

// ---------------- member cap ----------------

describe('clan member cap 200', () => {
  it('201st member is refused on join, approve and invite accept', async () => {
    const leader = await register(app, 'CapLeader');
    const clan = (await req('POST', '/api/clans', leader, { name: 'Big Clan', tag: 'BIG' })).json();
    await sql.query(`
      with u as (insert into users (email, password_hash, display_name)
        select 'cap' || g || '@example.com', 'x', 'Cap ' || g from generate_series(1, 199) g returning id)
      insert into clan_members (user_id, clan_id, role) select id, '${clan.id}', 'member' from u`);
    expect((await req('GET', `/api/clans/${clan.id}`)).json().memberCount).toBe(200);
    const late = await register(app, 'TooLate');
    const r = await req('POST', `/api/clans/${clan.id}/join`, late);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.message).toMatch(/full/);
    // request clan + approve
    await req('PATCH', `/api/clans/${clan.id}`, leader, { isOpen: false });
    await req('POST', `/api/clans/${clan.id}/join`, late);
    expect((await req('POST', `/api/clans/${clan.id}/requests/${late.user.id}/approve`, leader)).statusCode).toBe(409);
    const inv = (await req('POST', `/api/clans/${clan.id}/invites`, leader, { userId: late.user.id })).json();
    expect((await req('POST', `/api/clan-invites/${inv.id}/accept`, late)).statusCode).toBe(409);
    expect((await req('GET', `/api/clans/${clan.id}`)).json().memberCount).toBe(200);
  });
});

// ---------------- delete / pin / mute (acceptance check 6) ----------------

describe('messages: delete, pin, mute', () => {
  let a: U, b: U, c: U;
  let dm: string;
  beforeAll(async () => {
    a = await register(app, 'A');
    b = await register(app, 'B');
    c = await register(app, 'C');
    dm = (await req('POST', '/api/conversations/dm', a, { userId: b.user.id })).json().id;
  });

  it('delete own message within 24h -> placeholder for everyone + socket message:deleted', async () => {
    const sb = await connect(b.accessToken);
    const deleted: any[] = [];
    sb.on('message:deleted', (p) => deleted.push(p));
    const m = (await req('POST', `/api/conversations/${dm}/messages`, a, { text: 'oops wrong chat' })).json();
    expect(m).toMatchObject({ type: 'user', deletedAt: null, systemKey: null });
    // someone else's message -> 403, non-member -> 403, unknown -> 404
    expect((await req('DELETE', `/api/conversations/${dm}/messages/${m.id}`, b)).statusCode).toBe(403);
    expect((await req('DELETE', `/api/conversations/${dm}/messages/${m.id}`, c)).statusCode).toBe(403);
    expect((await req('DELETE', `/api/conversations/${dm}/messages/00000000-0000-4000-8000-000000000000`, a)).statusCode).toBe(404);
    expect((await req('DELETE', `/api/conversations/${dm}/messages/${m.id}`, a)).statusCode).toBe(204);
    expect((await req('DELETE', `/api/conversations/${dm}/messages/${m.id}`, a)).statusCode).toBe(204); // idempotent
    await until(() => deleted.length >= 1);
    expect(deleted[0]).toMatchObject({ id: m.id, conversationId: dm });
    await wait(100);
    expect(deleted).toHaveLength(1);
    const items = (await req('GET', `/api/conversations/${dm}/messages`, b)).json().items;
    const seen = items.find((x: any) => x.id === m.id);
    expect(seen.text).toBe('');
    expect(seen.deletedAt).toEqual(expect.any(String));
    // the original text is kept for moderation only
    const { rows } = await sql.query(`select text from messages where id = $1`, [m.id]);
    expect(rows[0].text).toBe('oops wrong chat');
    // a deleted message isn't counted as unread
    expect((await req('GET', '/api/conversations/unread', b)).json().total).toBe(0);
  });

  it('older than 24h -> 403', async () => {
    const m = (await req('POST', `/api/conversations/${dm}/messages`, a, { text: 'old news' })).json();
    await sql.query(`update messages set created_at = now() - interval '25 hours' where id = $1`, [m.id]);
    const r = await req('DELETE', `/api/conversations/${dm}/messages/${m.id}`, a);
    expect(r.statusCode).toBe(403);
    expect(r.json().error.message).toMatch(/24 hours/);
  });

  it('DM pin: either user; pin event on socket; deleting pinned message unpins', async () => {
    const sb = await connect(b.accessToken);
    const pins: any[] = [];
    sb.on('conversation:pinned', (p) => pins.push(p));
    const m = (await req('POST', `/api/conversations/${dm}/messages`, a, { text: 'Address: Baku, Nizami 1' })).json();
    expect((await req('PUT', `/api/conversations/${dm}/pin`, c, { messageId: m.id })).statusCode).toBe(403);
    expect((await req('PUT', `/api/conversations/${dm}/pin`, b, { messageId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(404);
    expect((await req('PUT', `/api/conversations/${dm}/pin`, b, { messageId: m.id })).statusCode).toBe(200);
    await until(() => pins.length === 1);
    expect(pins[0]).toMatchObject({ conversationId: dm, pinned: { message: { id: m.id }, pinnedBy: b.user.id } });
    expect((await req('GET', `/api/conversations/${dm}`, a)).json().pinned.message.id).toBe(m.id);
    expect((await req('DELETE', `/api/conversations/${dm}/messages/${m.id}`, a)).statusCode).toBe(204);
    await until(() => pins.length === 2);
    expect(pins[1]).toEqual({ conversationId: dm, pinned: null });
    expect((await req('GET', `/api/conversations/${dm}`, a)).json().pinned).toBeNull();
    // can't pin a deleted message, or one from another conversation
    expect((await req('PUT', `/api/conversations/${dm}/pin`, a, { messageId: m.id })).statusCode).toBe(400);
  });

  it('mute: per user, excluded from the unread total', async () => {
    await req('POST', `/api/conversations/${dm}/read`, b);
    await req('POST', `/api/conversations/${dm}/messages`, a, { text: 'ping 1' });
    expect((await req('GET', '/api/conversations/unread', b)).json().total).toBe(1);
    expect((await req('PUT', `/api/conversations/${dm}/mute`, c)).statusCode).toBe(403);
    expect((await req('PUT', `/api/conversations/${dm}/mute`, b)).json()).toEqual({ muted: true });
    expect((await req('GET', '/api/conversations/unread', b)).json().total).toBe(0);
    const summary = (await req('GET', `/api/conversations/${dm}`, b)).json();
    expect(summary).toMatchObject({ muted: true, unreadCount: 1 });
    // a's view isn't muted
    expect((await req('GET', `/api/conversations/${dm}`, a)).json().muted).toBe(false);
    expect((await req('DELETE', `/api/conversations/${dm}/mute`, b)).json()).toEqual({ muted: false });
    expect((await req('GET', '/api/conversations/unread', b)).json().total).toBe(1);
  });
});

// ---------------- event chat ----------------

describe('event chat', () => {
  it('pin: organizer only; socket delivery of user + system messages; read-only blocks pin/delete', async () => {
    const o = await register(app, 'EvOrg');
    const p = await register(app, 'EvPart');
    const carO = (await req('POST', '/api/cars', o, { make: 'UAZ', model: 'Patriot', year: 2018 })).json().id;
    const carP = (await req('POST', '/api/cars', p, { make: 'Lada', model: 'Niva', year: 2020 })).json().id;
    const ev = (await req('POST', '/api/events', o, {
      title: 'Shahdag run',
      startsAt: new Date(Date.now() + 86400_000).toISOString(),
      meetingPoint: { lat: 41.3, lng: 48.1, label: 'Quba' },
      maxCars: 5,
      carId: carO,
    })).json();
    const so = await connect(o.accessToken);
    const gotO: any[] = [];
    so.on('message:new', (m) => gotO.push(m));
    // p joins: the socket of p is added to the room live
    const sp = await connect(p.accessToken);
    const gotP: any[] = [];
    sp.on('message:new', (m) => gotP.push(m));
    const joined = (await req('POST', `/api/events/${ev.id}/join`, p, { carId: carP })).json();
    expect(joined.conversationId).toBe(ev.conversationId);
    await until(() => gotO.some((m) => m.systemKey === 'event.joined'));
    const msg = (await req('POST', `/api/conversations/${ev.conversationId}/messages`, o, { text: 'Bring chains' })).json();
    await until(() => gotP.some((m) => m.id === msg.id));
    // pin rules
    expect((await req('PUT', `/api/conversations/${ev.conversationId}/pin`, p, { messageId: msg.id })).statusCode).toBe(403);
    expect((await req('PUT', `/api/conversations/${ev.conversationId}/pin`, o, { messageId: msg.id })).statusCode).toBe(200);
    // conversation list shows the event chat with title and pin
    const list = (await req('GET', '/api/conversations', p)).json();
    expect(list.find((c: any) => c.id === ev.conversationId)).toMatchObject({ type: 'event', title: 'Shahdag run', eventId: ev.id, readOnly: false, canPin: false, pinned: { message: { id: msg.id } } });
    // delete in event chat works + socket event to others
    const del: any[] = [];
    so.on('message:deleted', (x) => del.push(x));
    const pm = (await req('POST', `/api/conversations/${ev.conversationId}/messages`, p, { text: 'typo' })).json();
    expect((await req('DELETE', `/api/conversations/${ev.conversationId}/messages/${pm.id}`, p)).statusCode).toBe(204);
    await until(() => del.some((x) => x.id === pm.id));
    // cancelled: read-only -> no post, pin or delete; reading still works
    const pm2 = (await req('POST', `/api/conversations/${ev.conversationId}/messages`, p, { text: 'see you' })).json();
    await req('POST', `/api/events/${ev.id}/cancel`, o, {});
    await until(() => gotP.some((m) => m.systemKey === 'event.cancelled'));
    expect(gotP.find((m) => m.systemKey === 'event.cancelled').systemParams).toEqual({ reason: null });
    expect((await req('DELETE', `/api/conversations/${ev.conversationId}/messages/${pm2.id}`, p)).statusCode).toBe(403);
    expect((await req('PUT', `/api/conversations/${ev.conversationId}/pin`, o, { messageId: msg.id })).statusCode).toBe(403);
    const sum = (await req('GET', `/api/conversations/${ev.conversationId}`, p)).json();
    expect(sum.readOnly).toBe(true);
    expect(new Date(sum.readOnlyUntil).getTime() - Date.now()).toBeGreaterThan(6.9 * 86400_000);
    expect((await req('PUT', `/api/conversations/${ev.conversationId}/mute`, p)).statusCode).toBe(200);
  });

  it('private mod prices still hidden (v2 behaviour intact)', async () => {
    const o = await register(app, 'ModOwner');
    const v = await register(app, 'Viewer');
    const car = (await req('POST', '/api/cars', o, { make: 'Jeep', model: 'Wrangler', year: 2021 })).json().id;
    await req('POST', `/api/cars/${car}/mods`, o, { name: 'Winch', category: 'recovery', price: 900, pricePublic: false });
    expect((await req('GET', `/api/cars/${car}`, v)).json().mods[0].price).toBeNull();
    expect((await req('GET', `/api/cars/${car}`, o)).json().mods[0].price).toBe(900);
  });
});
