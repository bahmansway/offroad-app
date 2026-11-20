import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { makeApp, register, resetDb, TEST_DB_URL } from './helpers.js';
import { MIGRATIONS_DIR } from '../src/db/migrate.js';
import { createPush, truncate } from '../src/lib/push.js';
import { bakuShort } from '../src/lib/notify.js';
import { loadConfig } from '../src/config.js';

type U = Awaited<ReturnType<typeof register>>;
type PushMsg = { to: string; title: string; body: string; data: Record<string, string>; badge?: number; channelId: string; sound: string };

// ---------------- mocked Expo push service ----------------
const mock = {
  sends: [] as { headers: http.IncomingHttpHeaders; body: PushMsg[] }[],
  receiptCalls: [] as string[][],
  /** tokens answered with a DeviceNotRegistered ticket */
  goneTokens: new Set<string>(),
  /** ticket ids answered with a DeviceNotRegistered receipt */
  goneReceipts: new Set<string>(),
  status: 200,
  delayMs: 0,
  reset() {
    this.sends = [];
    this.receiptCalls = [];
    this.goneTokens.clear();
    this.goneReceipts.clear();
    this.status = 200;
    this.delayMs = 0;
  },
  /** every notification sent, flattened */
  all(): PushMsg[] {
    return this.sends.flatMap((s) => s.body);
  },
  to(token: string) {
    return this.all().filter((m) => m.to === token);
  },
};
let ticketN = 0;
const mockServer = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    if (mock.delayMs) await new Promise((r) => setTimeout(r, mock.delayMs));
    const body = raw ? JSON.parse(raw) : null;
    res.setHeader('content-type', 'application/json');
    if (mock.status !== 200) {
      res.statusCode = mock.status;
      return res.end(JSON.stringify({ errors: [{ code: 'INTERNAL_SERVER_ERROR', message: 'boom' }] }));
    }
    if (req.url === '/--/api/v2/push/send') {
      mock.sends.push({ headers: req.headers, body });
      const data = (body as PushMsg[]).map((m) =>
        mock.goneTokens.has(m.to)
          ? { status: 'error', message: `"${m.to}" is not a registered push notification recipient`, details: { error: 'DeviceNotRegistered' } }
          : { status: 'ok', id: `ticket-${++ticketN}-${m.to}` },
      );
      return res.end(JSON.stringify({ data }));
    }
    if (req.url === '/--/api/v2/push/getReceipts') {
      const ids: string[] = body.ids;
      mock.receiptCalls.push(ids);
      const data: Record<string, unknown> = {};
      for (const id of ids) {
        data[id] = [...mock.goneReceipts].some((t) => id.endsWith(t))
          ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
          : { status: 'ok' };
      }
      return res.end(JSON.stringify({ data }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
});

let app: FastifyInstance;
let sql: pg.Client;
let mockUrl: string;
const req = (method: string, url: string, user?: U, payload?: unknown) =>
  app.inject({ method: method as any, url, headers: user?.auth, payload: payload as any });
let tokenN = 0;
const newToken = () => `ExponentPushToken[t${Date.now().toString(36)}x${++tokenN}abcdefgh]`;
async function withToken(u: U, locale: 'az' | 'en' = 'az', platform: 'ios' | 'android' = 'ios') {
  const token = newToken();
  const r = await req('POST', '/api/me/push-tokens', u, { token, platform, locale });
  expect(r.statusCode).toBe(204);
  return token;
}
const settled = async () => {
  await app.push.idle();
};
async function dmBetween(a: U, b: U) {
  return (await req('POST', '/api/conversations/dm', a, { userId: b.user.id })).json().id as string;
}
async function send(u: U, conv: string, text: string) {
  const r = await req('POST', `/api/conversations/${conv}/messages`, u, { text });
  expect(r.statusCode).toBe(201);
  return r;
}

/** A v4 database with data in it; buildApp then applies the v5 migration on top. */
async function seedV4Database() {
  await resetDb();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  fs.cpSync(MIGRATIONS_DIR, tmp, { recursive: true });
  const journal = JSON.parse(fs.readFileSync(path.join(tmp, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: any) => e.idx <= 5);
  fs.writeFileSync(path.join(tmp, 'meta/_journal.json'), JSON.stringify(journal));
  const pool = new pg.Pool({ connectionString: TEST_DB_URL });
  await migrate(drizzle(pool), { migrationsFolder: tmp });
  await pool.query(`
    insert into users (id, email, password_hash, display_name) values
      ('11111111-1111-4111-8111-111111111111', 'old1@example.com', 'x', 'Old One'),
      ('22222222-2222-4222-8222-222222222222', 'old2@example.com', 'x', 'Old Two');
    insert into friendships (user_id, friend_id) values
      ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'),
      ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111');
    insert into conversations (id, type, dm_key) values ('55555555-5555-4555-8555-555555555555', 'dm', '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222');
    insert into messages (conversation_id, sender_id, text) values
      ('55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222', 'old dm');
  `);
  await pool.end();
  fs.rmSync(tmp, { recursive: true, force: true });
}

beforeAll(async () => {
  await new Promise<void>((r) => mockServer.listen(0, '127.0.0.1', () => r()));
  mockUrl = `http://127.0.0.1:${(mockServer.address() as { port: number }).port}`;
  await seedV4Database();
  app = await makeApp({ EXPO_PUSH_URL: mockUrl, PUSH_RECEIPT_DELAY_MS: '3600000' });
  sql = new pg.Client({ connectionString: TEST_DB_URL });
  await sql.connect();
});
afterAll(async () => {
  await app?.close();
  await sql?.end();
  await new Promise((r) => mockServer.close(r));
});
beforeEach(() => mock.reset());

describe('v5 migration', () => {
  it('adds the tables on a v4 database and keeps old data', async () => {
    const t = await sql.query(`select to_regclass('push_tokens') a, to_regclass('notification_settings') b`);
    expect(t.rows[0]).toEqual({ a: 'push_tokens', b: 'notification_settings' });
    const m = await sql.query(`select text from messages where conversation_id = '55555555-5555-4555-8555-555555555555'`);
    expect(m.rows).toEqual([{ text: 'old dm' }]);
    const f = await sql.query(`select count(*)::int n from friendships`);
    expect(f.rows[0].n).toBe(2);
  });
});

describe('push tokens', () => {
  it('validates the body and needs login', async () => {
    const a = await register(app, 'Tok');
    expect((await req('POST', '/api/me/push-tokens', undefined, { token: newToken(), platform: 'ios' })).statusCode).toBe(401);
    for (const body of [
      { token: 'not-a-token', platform: 'ios' },
      { token: 'ExponentPushToken[]', platform: 'ios' },
      { token: newToken(), platform: 'web' },
      { token: newToken(), platform: 'ios', locale: 'ru' },
      { token: newToken(), platform: 'ios', extra: 1 },
      { platform: 'ios' },
    ]) {
      const r = await req('POST', '/api/me/push-tokens', a, body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
      expect(r.json().error.code).toBe('VALIDATION');
    }
    expect((await req('POST', '/api/me/push-tokens', a, { token: 'ExpoPushToken[abcdefghijkl]', platform: 'android' })).statusCode).toBe(204);
  });

  it('upserts, moves a token to the latest user, and only deletes your own', async () => {
    const a = await register(app, 'TokA');
    const b = await register(app, 'TokB');
    const token = newToken();
    expect((await req('POST', '/api/me/push-tokens', a, { token, platform: 'ios' })).statusCode).toBe(204);
    expect((await req('POST', '/api/me/push-tokens', a, { token, platform: 'ios', locale: 'en' })).statusCode).toBe(204);
    let rows = (await sql.query('select user_id, locale from push_tokens where token = $1', [token])).rows;
    expect(rows).toEqual([{ user_id: a.user.id, locale: 'en' }]);
    // same phone, other account
    expect((await req('POST', '/api/me/push-tokens', b, { token, platform: 'ios' })).statusCode).toBe(204);
    rows = (await sql.query('select user_id from push_tokens where token = $1', [token])).rows;
    expect(rows).toEqual([{ user_id: b.user.id }]);
    // a can't remove b's token
    expect((await req('DELETE', '/api/me/push-tokens', a, { token })).statusCode).toBe(204);
    expect((await sql.query('select 1 from push_tokens where token = $1', [token])).rowCount).toBe(1);
    expect((await req('DELETE', '/api/me/push-tokens', b, { token })).statusCode).toBe(204);
    expect((await sql.query('select 1 from push_tokens where token = $1', [token])).rowCount).toBe(0);
    expect((await req('DELETE', '/api/me/push-tokens', b, { token: 'bad' })).statusCode).toBe(400);
    expect((await req('DELETE', '/api/me/push-tokens', undefined, { token })).statusCode).toBe(401);
  });

  it('keeps at most 10 phones per user (oldest dropped)', async () => {
    const a = await register(app, 'Many');
    const tokens: string[] = [];
    for (let i = 0; i < 12; i++) tokens.push(await withToken(a));
    const rows = (await sql.query('select token from push_tokens where user_id = $1', [a.user.id])).rows.map((r) => r.token);
    expect(rows).toHaveLength(10);
    expect(rows).not.toContain(tokens[0]);
    expect(rows).toContain(tokens[11]);
  });
});

describe('notification settings', () => {
  it('defaults to all on, PATCH changes only what is sent, strict body', async () => {
    const a = await register(app, 'Set');
    expect((await req('GET', '/api/me/notification-settings')).statusCode).toBe(401);
    expect((await req('GET', '/api/me/notification-settings', a)).json()).toEqual({ messages: true, friends: true, clans: true, events: true });
    let r = await req('PATCH', '/api/me/notification-settings', a, { friends: false });
    expect(r.json()).toEqual({ messages: true, friends: false, clans: true, events: true });
    r = await req('PATCH', '/api/me/notification-settings', a, { events: false, messages: false });
    expect(r.json()).toEqual({ messages: false, friends: false, clans: true, events: false });
    expect((await req('PATCH', '/api/me/notification-settings', a, {})).json()).toEqual({ messages: false, friends: false, clans: true, events: false });
    expect((await req('PATCH', '/api/me/notification-settings', a, { sms: true })).statusCode).toBe(400);
    expect((await req('PATCH', '/api/me/notification-settings', a, { friends: 'yes' })).statusCode).toBe(400);
  });
});

describe('message notifications', () => {
  it('DM: to the other person only, sender name as title, truncated body, badge, data', async () => {
    const a = await register(app, 'Aida');
    const b = await register(app, 'Babek');
    const ta = await withToken(a);
    const tb = await withToken(b);
    const dm = await dmBetween(a, b);
    const long = 'Salam! '.repeat(40);
    await send(a, dm, long);
    await settled();
    expect(mock.to(ta)).toHaveLength(0); // never to the sender
    const [m] = mock.to(tb);
    expect(m.title).toBe(a.user.displayName);
    expect(Array.from(m.body)).toHaveLength(120);
    expect(m.body.endsWith('…')).toBe(true);
    expect(m.data).toEqual({ type: 'message', conversationId: dm });
    expect(m.channelId).toBe('messages');
    expect(m.sound).toBe('default');
    expect(m.badge).toBe(1); // 1 unread message
    expect(mock.sends[0].headers.authorization).toBeUndefined();
  });

  it('coalesces: one per chat per person per 30 s, other chats still notify; badge keeps counting', async () => {
    const a = await register(app, 'Co');
    const b = await register(app, 'Co');
    const c = await register(app, 'Co');
    const tb = await withToken(b);
    const dm1 = await dmBetween(a, b);
    const dm2 = await dmBetween(c, b);
    await send(a, dm1, 'one');
    await send(a, dm1, 'two');
    await send(a, dm1, 'three');
    await settled();
    expect(mock.to(tb).map((m) => m.body)).toEqual(['one']);
    await send(c, dm2, 'other chat');
    await settled();
    const msgs = mock.to(tb);
    expect(msgs.map((m) => m.body)).toEqual(['one', 'other chat']);
    expect(msgs[1].badge).toBe(4); // 3 + 1 unread
    // the unread count itself is untouched by coalescing
    expect((await req('GET', '/api/me/badges', b)).json().messages).toBe(4);
  });

  it('clan chat: title = clan, body names the sender; mutes, blocks and settings respected', async () => {
    const lead = await register(app, 'Lead');
    const muted = await register(app, 'Muted');
    const blocker = await register(app, 'Blocker');
    const off = await register(app, 'Off');
    const normal = await register(app, 'Normal');
    const clan = (await req('POST', '/api/clans', lead, { name: `Push Clan ${Date.now()}`, tag: 'PSH' })).json();
    for (const u of [muted, blocker, off, normal]) expect((await req('POST', `/api/clans/${clan.id}/join`, u)).statusCode).toBe(200);
    const conv = (await req('GET', `/api/clans/${clan.id}`, lead)).json().conversationId;
    const tLead = await withToken(lead);
    const tMuted = await withToken(muted);
    const tBlocker = await withToken(blocker);
    const tOff = await withToken(off);
    const tNormal = await withToken(normal, 'en');
    expect((await req('PUT', `/api/conversations/${conv}/mute`, muted)).statusCode).toBe(200);
    expect((await req('POST', `/api/users/${lead.user.id}/block`, blocker)).statusCode).toBe(204);
    await req('PATCH', '/api/me/notification-settings', off, { messages: false });
    await send(lead, conv, 'Sabah 09:00 Xızı');
    await settled();
    expect(mock.to(tLead)).toHaveLength(0);
    expect(mock.to(tMuted)).toHaveLength(0);
    expect(mock.to(tBlocker)).toHaveLength(0);
    expect(mock.to(tOff)).toHaveLength(0);
    const [m] = mock.to(tNormal);
    expect(m.title).toBe(clan.name);
    expect(m.body).toBe(`${lead.user.displayName}: Sabah 09:00 Xızı`);
  });

  it('sends in batches of at most 100', async () => {
    const a = await register(app, 'Batch');
    const b = await register(app, 'Batch');
    await sql.query(
      `insert into push_tokens (user_id, token, platform) select $1, 'ExponentPushToken[bulk' || g || 'xxxxxxxx]', 'android' from generate_series(1, 150) g`,
      [b.user.id],
    );
    const dm = await dmBetween(a, b);
    await send(a, dm, 'hello all phones');
    await settled();
    expect(mock.sends.map((s) => s.body.length)).toEqual([100, 50]);
    await sql.query(`delete from push_tokens where token like 'ExponentPushToken[bulk%'`);
  });

  it('never makes the request wait for the push service', async () => {
    const a = await register(app, 'Slow');
    const b = await register(app, 'Slow');
    await withToken(b);
    const dm = await dmBetween(a, b);
    mock.delayMs = 1500;
    const t0 = Date.now();
    await send(a, dm, 'quick');
    expect(Date.now() - t0).toBeLessThan(1000);
    await settled();
    expect(mock.all()).toHaveLength(1);
  });
});

describe('push service errors', () => {
  it('DeviceNotRegistered in a ticket deletes the token', async () => {
    const a = await register(app, 'Gone');
    const b = await register(app, 'Gone');
    const tb = await withToken(b);
    const tb2 = await withToken(b);
    mock.goneTokens.add(tb);
    await send(a, await dmBetween(a, b), 'are you there?');
    await settled();
    const left = (await sql.query('select token from push_tokens where user_id = $1', [b.user.id])).rows.map((r) => r.token);
    expect(left).toEqual([tb2]);
  });

  it('DeviceNotRegistered in a receipt deletes the token', async () => {
    const a = await register(app, 'Rcpt');
    const b = await register(app, 'Rcpt');
    const tb = await withToken(b);
    await send(a, await dmBetween(a, b), 'receipt test');
    await settled();
    expect(app.push.receiptCount()).toBeGreaterThan(0);
    mock.goneReceipts.add(tb);
    await app.push.checkReceipts();
    expect(mock.receiptCalls.flat().some((id) => id.endsWith(tb))).toBe(true);
    expect((await sql.query('select 1 from push_tokens where token = $1', [tb])).rowCount).toBe(0);
    expect(app.push.receiptCount()).toBe(0);
  });

  it('logs failures without tokens or message text', async () => {
    const a = await register(app, 'Log');
    const b = await register(app, 'Log');
    const tb = await withToken(b);
    const spy = vi.spyOn(app.log, 'warn');
    mock.status = 500;
    await send(a, await dmBetween(a, b), 'secret words here');
    await settled();
    expect(spy).toHaveBeenCalled();
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain('500');
    expect(logged).not.toContain(tb);
    expect(logged).not.toContain('secret words');
    spy.mockRestore();
  });

  it('sends the optional EXPO_ACCESS_TOKEN as a bearer header', async () => {
    const b = await register(app, 'Hdr');
    const tb = await withToken(b);
    const config = loadConfig({ DATABASE_URL: TEST_DB_URL, EXPO_PUSH_URL: mockUrl, EXPO_ACCESS_TOKEN: 'expo-secret-abc' }).push;
    const push = createPush({ db: app.db, config, log: { warn: () => {} } });
    await push.send([b.user.id], {
      category: 'messages',
      channelId: 'messages',
      text: () => ({ title: 't', body: 'b' }),
      data: { type: 'message', conversationId: 'x' },
    });
    expect(mock.sends[0].headers.authorization).toBe('Bearer expo-secret-abc');
    expect(mock.to(tb)).toHaveLength(1);
    await push.close();
  });

  it('truncate keeps whole characters', () => {
    expect(truncate('a'.repeat(120))).toBe('a'.repeat(120));
    expect(truncate('😀'.repeat(130))).toBe('😀'.repeat(119) + '…');
    expect(truncate('  many   spaces \n here ')).toBe('many spaces here');
    expect(bakuShort(new Date('2026-11-22T05:00:00.000Z'))).toBe('22.11 09:00');
  });
});

describe('friend and clan notifications', () => {
  it('friend request and accept go to the right person, in their language; setting respected', async () => {
    const a = await register(app, 'FrA');
    const b = await register(app, 'FrB');
    const ta = await withToken(a, 'en');
    const tb = await withToken(b, 'az');
    const r = await req('POST', '/api/friends/requests', a, { userId: b.user.id });
    expect(r.statusCode).toBe(201);
    await settled();
    expect(mock.to(ta)).toHaveLength(0);
    const [m] = mock.to(tb);
    expect(m).toMatchObject({ title: 'Dostluq təklifi', body: `${a.user.displayName} sizə dostluq təklifi göndərdi` });
    expect(m.data).toEqual({ type: 'friend_request', userId: a.user.id });
    expect(m.badge).toBe(1); // one incoming friend request
    mock.reset();
    expect((await req('POST', `/api/friends/requests/${r.json().request.id}/accept`, b)).statusCode).toBe(200);
    await settled();
    expect(mock.to(tb)).toHaveLength(0);
    expect(mock.to(ta)[0]).toMatchObject({ title: 'New friend', body: `${b.user.displayName} accepted your friend request` });
    expect(mock.to(ta)[0].data).toEqual({ type: 'friend_accepted', userId: b.user.id });

    // crossing requests: the second one auto-accepts and tells the first sender
    const c = await register(app, 'FrC');
    const tc = await withToken(c);
    await req('PATCH', '/api/me/notification-settings', a, { friends: false });
    mock.reset();
    expect((await req('POST', '/api/friends/requests', c, { userId: a.user.id })).statusCode).toBe(201);
    expect((await req('POST', '/api/friends/requests', a, { userId: c.user.id })).json().status).toBe('friends');
    await settled();
    expect(mock.to(ta)).toHaveLength(0); // a switched friends off
    expect(mock.to(tc)[0].data).toEqual({ type: 'friend_accepted', userId: a.user.id });
  });

  it('clan invite to the invitee; join request to leader + navigators only', async () => {
    const lead = await register(app, 'CLead');
    const nav = await register(app, 'CNav');
    const member = await register(app, 'CMem');
    const asker = await register(app, 'CAsk');
    const blockedNav = await register(app, 'CBlk');
    const clan = (await req('POST', '/api/clans', lead, { name: `Request Clan ${Date.now()}`, tag: 'REQ' })).json();
    for (const u of [nav, member, blockedNav]) await req('POST', `/api/clans/${clan.id}/join`, u);
    await req('POST', `/api/clans/${clan.id}/members/${nav.user.id}/role`, lead, { role: 'officer' });
    await req('POST', `/api/clans/${clan.id}/members/${blockedNav.user.id}/role`, lead, { role: 'officer' });
    await req('PATCH', `/api/clans/${clan.id}`, lead, { isOpen: false });
    await req('POST', `/api/users/${asker.user.id}/block`, blockedNav);
    const [tl, tn, tm, ta, tbn] = [await withToken(lead), await withToken(nav), await withToken(member), await withToken(asker), await withToken(blockedNav)];
    expect((await req('POST', `/api/clans/${clan.id}/join`, asker)).json().myRole).toBe('pending');
    await settled();
    expect(mock.to(tl)[0]).toMatchObject({ title: 'Klana qoşulmaq istəyi' });
    expect(mock.to(tl)[0].data).toEqual({ type: 'clan_request', clanId: clan.id });
    expect(mock.to(tn)).toHaveLength(1);
    expect(mock.to(tm)).toHaveLength(0);
    expect(mock.to(ta)).toHaveLength(0);
    expect(mock.to(tbn)).toHaveLength(0);
    // asking again does not notify twice
    mock.reset();
    await req('POST', `/api/clans/${clan.id}/join`, asker);
    await settled();
    expect(mock.all()).toHaveLength(0);

    const guest = await register(app, 'CGuest');
    const tg = await withToken(guest);
    const inv = await req('POST', `/api/clans/${clan.id}/invites`, nav, { userId: guest.user.id });
    expect(inv.statusCode).toBe(201);
    await settled();
    expect(mock.to(tn)).toHaveLength(0);
    expect(mock.to(tg)[0]).toMatchObject({ title: 'Klana dəvət', body: `${nav.user.displayName} sizi «${clan.name}» klanına dəvət edir` });
    expect(mock.to(tg)[0].data).toEqual({ type: 'clan_invite', clanId: clan.id, inviteId: inv.json().id });
    expect(mock.to(tg)[0].badge).toBe(1); // the invite
  });
});

describe('event notifications', () => {
  const car = async (u: U) => (await req('POST', '/api/cars', u, { make: 'Toyota', model: 'Land Cruiser', year: 2015 })).json().id as string;
  const inDays = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  it('promoted, edited time/place, cancelled: to the right participants only', async () => {
    const org = await register(app, 'Org');
    const p = await register(app, 'Going');
    const w = await register(app, 'Wait');
    const blocker = await register(app, 'EvBlk');
    const off = await register(app, 'EvOff');
    const [co, cp, cw, cb, cf] = [await car(org), await car(p), await car(w), await car(blocker), await car(off)];
    const ev = (
      await req('POST', '/api/events', org, {
        title: 'Xızı trip', startsAt: inDays(3), meetingPoint: { lat: 40.9, lng: 49.07, label: 'Xızı' }, maxCars: 2, carId: co,
      })
    ).json();
    expect((await req('POST', `/api/events/${ev.id}/join`, p, { carId: cp })).json().myStatus).toBe('going');
    expect((await req('POST', `/api/events/${ev.id}/join`, w, { carId: cw })).json().myStatus).toBe('waitlist');
    expect((await req('POST', `/api/events/${ev.id}/join`, blocker, { carId: cb })).json().myStatus).toBe('waitlist');
    expect((await req('POST', `/api/events/${ev.id}/join`, off, { carId: cf })).json().myStatus).toBe('waitlist');
    await req('POST', `/api/users/${org.user.id}/block`, blocker);
    await req('PATCH', '/api/me/notification-settings', off, { events: false });
    const [to, tp, tw, tb, tf] = [await withToken(org), await withToken(p), await withToken(w, 'en'), await withToken(blocker), await withToken(off)];
    await settled();
    mock.reset();

    // p leaves -> w promoted
    expect((await req('POST', `/api/events/${ev.id}/leave`, p)).statusCode).toBe(204);
    await settled();
    expect(mock.to(tw)).toHaveLength(1);
    expect(mock.to(tw)[0]).toMatchObject({ title: 'Xızı trip', body: 'A place opened up: you are now going', channelId: 'events' });
    expect(mock.to(tw)[0].data).toEqual({ type: 'event', eventId: ev.id });
    expect(mock.all().filter((m) => m.data.type === 'event')).toHaveLength(1);

    // title-only edit: no notification
    mock.reset();
    expect((await req('PATCH', `/api/events/${ev.id}`, org, { title: 'Xızı trip!' })).statusCode).toBe(200);
    await settled();
    expect(mock.all().filter((m) => m.data.type === 'event')).toHaveLength(0);

    // time change: going + waitlist, not organizer, not the blocker, not the one who switched events off
    mock.reset();
    const newStart = new Date(Date.parse(ev.startsAt) + 86400000);
    expect((await req('PATCH', `/api/events/${ev.id}`, org, { startsAt: newStart.toISOString() })).statusCode).toBe(200);
    await settled();
    expect(mock.to(to)).toHaveLength(0);
    expect(mock.to(tp)).toHaveLength(0); // left
    expect(mock.to(tb)).toHaveLength(0);
    expect(mock.to(tf)).toHaveLength(0);
    expect(mock.to(tw)[0].body).toBe(`New time or place: ${bakuShort(newStart)} · Xızı`);

    // cancel
    mock.reset();
    expect((await req('POST', `/api/events/${ev.id}/cancel`, org, { reason: 'Qar yağır' })).statusCode).toBe(200);
    await settled();
    expect(mock.to(to)).toHaveLength(0);
    expect(mock.to(tw)[0]).toMatchObject({ title: 'Xızı trip!', body: 'The event was cancelled: Qar yağır' });
    expect(mock.to(tb)).toHaveLength(0);
    expect(mock.to(tf)).toHaveLength(0);
  });
});
