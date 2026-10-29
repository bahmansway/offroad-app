import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { makeApp, register, resetDb, TEST_DB_URL } from './helpers.js';
import { bakuMonth, buildBoard, computeRanking } from '../src/lib/leaderboard.js';

type U = Awaited<ReturnType<typeof register>>;
let app: FastifyInstance;
let sql: pg.Client;
const req = (method: string, url: string, user?: U, payload?: unknown) =>
  app.inject({ method: method as any, url, headers: user?.auth, payload: payload as any });

beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  sql = new pg.Client({ connectionString: TEST_DB_URL });
  await sql.connect();
});
afterAll(async () => {
  await sql.end();
  await app.close();
});

describe('Baku month boundaries (UTC+4)', () => {
  it('month starts at 20:00 UTC on the last day of the previous month', () => {
    expect(bakuMonth(new Date('2026-11-15T12:00:00Z')).start.toISOString()).toBe('2026-10-31T20:00:00.000Z');
    expect(bakuMonth(new Date('2026-11-15T12:00:00Z')).end.toISOString()).toBe('2026-11-30T20:00:00.000Z');
    // 21:00 UTC on 31 Oct is already 1 Nov in Baku
    expect(bakuMonth(new Date('2026-10-31T21:00:00Z')).start.toISOString()).toBe('2026-10-31T20:00:00.000Z');
    expect(bakuMonth(new Date('2026-10-31T19:59:59Z')).start.toISOString()).toBe('2026-09-30T20:00:00.000Z');
    expect(bakuMonth(new Date('2026-12-31T20:30:00Z')).start.toISOString()).toBe('2026-12-31T20:00:00.000Z');
  });
});

describe('leaderboard points (seeded scenario, fixed "now")', () => {
  const NOW = new Date('2026-11-15T12:00:00Z');
  const U: Record<string, string> = {};
  const names = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'];
  const q = (text: string, params: unknown[] = []) => sql.query(text, params);

  beforeAll(async () => {
    for (const n of names) {
      U[n] = (await q(`insert into users (email, password_hash, display_name) values ($1, 'x', $2) returning id`, [`${n}@lb.test`, n.toUpperCase()])).rows[0].id;
    }
    const img = (await q(`insert into images (owner_id, kind, width, height, bytes, data) values ($1, 'car', 1, 1, 1, '\\x00') returning id`, [U.u3])).rows[0].id;
    const spot = async (owner: string, at: string) =>
      (await q(`insert into spots (owner_id, type, name, lat, lng, created_at) values ($1, 'camp', 'S', 40.4, 49.8, $2) returning id`, [owner, at])).rows[0].id;
    const event = async (org: string, startsAt: string, endsAt: string | null, status = 'scheduled') =>
      (
        await q(
          `insert into events (organizer_id, title, starts_at, ends_at, meeting_lat, meeting_lng, max_cars, status, cancelled_at)
           values ($1, 'E', $2, $3, 40.4, 49.8, 10, $4, case when $4 = 'cancelled' then $2::timestamptz else null end) returning id`,
          [org, startsAt, endsAt, status],
        )
      ).rows[0].id;
    const part = (eventId: string, userId: string, status = 'going') =>
      q(`insert into event_participants (event_id, user_id, status) values ($1, $2, $3)`, [eventId, userId, status]);
    const car = async (owner: string, at: string, photo: boolean) =>
      (await q(`insert into cars (owner_id, make, model, year, created_at, photo_image_id) values ($1, 'Toyota', 'LC', 2010, $2, $3) returning id`, [owner, at, photo ? img : null])).rows[0].id;

    // U1: spot just after the Baku month start (still October in UTC) + one just before it
    await spot(U.u1, '2026-10-31T20:30:00Z');
    await spot(U.u1, '2026-10-31T19:30:00Z');
    // deleted spot: no points
    const gone = await spot(U.u1, '2026-11-03T10:00:00Z');
    await q(`delete from spots where id = $1`, [gone]);

    // U2 organizes A (finished, 2 cars going); U3 attends; U1 only waitlisted; U8 removed
    const a = await event(U.u2, '2026-11-10T08:00:00Z', '2026-11-10T16:00:00Z');
    await part(a, U.u2);
    await part(a, U.u3);
    await part(a, U.u1, 'waitlist');
    await part(a, U.u8, 'removed');
    // cancelled event with 2 cars: nothing for anyone
    const b = await event(U.u2, '2026-11-05T08:00:00Z', '2026-11-05T12:00:00Z', 'cancelled');
    await part(b, U.u2);
    await part(b, U.u8);
    // finished but only the organizer going: nothing
    const c = await event(U.u8, '2026-11-06T08:00:00Z', '2026-11-06T12:00:00Z');
    await part(c, U.u8);
    // not finished yet (ends after "now"): nothing
    const d = await event(U.u8, '2026-11-14T08:00:00Z', '2026-11-20T12:00:00Z');
    await part(d, U.u8);
    await part(d, U.u1);
    // no end time -> finished 24 h after start (2 Nov 06:00 UTC)
    const e = await event(U.u4, '2026-11-01T06:00:00Z', null);
    await part(e, U.u4);
    await part(e, U.u5);
    // finished in October Baku time (19:00 UTC on 31 Oct = 23:00 Baku): all-time only
    const f = await event(U.u6, '2026-10-31T10:00:00Z', '2026-10-31T19:00:00Z');
    await part(f, U.u6);
    await part(f, U.u7);

    // U3: 3 cars with a photo (only first 2 count) + 1 without
    await car(U.u3, '2026-11-02T00:00:00Z', true);
    await car(U.u3, '2026-11-02T01:00:00Z', true);
    await car(U.u3, '2026-11-02T02:00:00Z', true);
    await car(U.u3, '2026-11-02T03:00:00Z', false);
    // U4: a photo car in September (all-time only)
    await car(U.u4, '2026-09-10T00:00:00Z', true);

    // U5 owns 30 old spots (September); U4 rates 25 of them in November (cap 20) and 5 in October
    const old: string[] = [];
    for (let i = 0; i < 30; i++) old.push(await spot(U.u5, '2026-09-01T10:00:00Z'));
    for (let i = 0; i < 25; i++) {
      await q(`insert into spot_ratings (spot_id, user_id, stars, created_at) values ($1, $2, 4, $3)`, [old[i], U.u4, `2026-11-04T10:${String(i).padStart(2, '0')}:00Z`]);
    }
    for (let i = 25; i < 30; i++) {
      await q(`insert into spot_ratings (spot_id, user_id, stars, created_at) values ($1, $2, 4, '2026-10-10T10:00:00Z')`, [old[i], U.u4]);
    }
    // own-spot rating: no points
    await q(`insert into spot_ratings (spot_id, user_id, stars, created_at) values ($1, $2, 5, '2026-11-04T10:00:00Z')`, [old[0], U.u5]);
    // re-rating later (updated_at moves) keeps the original month
    await q(`update spot_ratings set stars = 2, updated_at = '2026-12-20T00:00:00Z' where spot_id = $1 and user_id = $2`, [old[0], U.u4]);

    // U6 and U7: one November spot each, U7's earlier (tie rule)
    await spot(U.u6, '2026-11-05T10:00:00Z');
    await spot(U.u7, '2026-11-03T10:00:00Z');
  });

  const view = (rows: Awaited<ReturnType<typeof computeRanking>>) =>
    rows.map((r) => [Object.keys(U).find((k) => U[k] === r.userId), r.points]);

  it('this month (Baku): exact points, ties by earlier first activity', async () => {
    const rows = await computeRanking(app.db, 'month', NOW);
    expect(view(rows)).toEqual([
      ['u4', 35],
      ['u3', 15],
      ['u2', 15],
      ['u1', 10],
      ['u7', 10],
      ['u6', 10],
      ['u5', 5],
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.userId, r.breakdown]));
    expect(by[U.u4]).toEqual({ spots: 0, events: 15, attended: 0, cars: 0, ratings: 20 });
    expect(by[U.u3]).toEqual({ spots: 0, events: 0, attended: 5, cars: 10, ratings: 0 });
    expect(by[U.u2]).toEqual({ spots: 0, events: 15, attended: 0, cars: 0, ratings: 0 });
    expect(by[U.u1]).toEqual({ spots: 10, events: 0, attended: 0, cars: 0, ratings: 0 });
    expect(by[U.u5]).toEqual({ spots: 0, events: 0, attended: 5, cars: 0, ratings: 0 });
  });

  it('all time', async () => {
    const rows = await computeRanking(app.db, 'all', NOW);
    expect(view(rows)).toEqual([
      ['u5', 305],
      ['u4', 45],
      ['u6', 25],
      ['u1', 20],
      ['u7', 15],
      ['u3', 15],
      ['u2', 15],
    ]);
    const u4 = rows.find((r) => r.userId === U.u4)!;
    expect(u4.breakdown).toEqual({ spots: 0, events: 15, attended: 0, cars: 5, ratings: 25 });
  });

  it('a month earlier the November activity does not count yet', async () => {
    const rows = await computeRanking(app.db, 'month', new Date('2026-10-31T19:45:00Z'));
    expect(view(rows)).toEqual([
      ['u6', 15],
      ['u1', 10],
      ['u4', 5],
      ['u7', 5],
    ]);
  });

  it('board shape: top 20 with user summary, rank map', async () => {
    const b = await buildBoard(app.db, 'month', NOW);
    expect(b.monthStart).toBe('2026-10-31T20:00:00.000Z');
    expect(b.items[0]).toMatchObject({
      rank: 1,
      points: 35,
      user: { id: U.u4, displayName: 'U4', avatarUrl: null, currentCar: null, clan: null },
    });
    expect(b.ranks.get(U.u5)).toEqual({ rank: 7, points: 5 });
    expect(b.ranks.get(U.u8)).toBeUndefined();
  });

  afterAll(async () => {
    await q(`delete from users where email like '%@lb.test'`);
  });
});

describe('GET /api/leaderboard (acceptance check 5)', () => {
  let a: U, b: U;
  beforeAll(async () => {
    a = await register(app, 'Aysel');
    b = await register(app, 'Bilal');
    app.leaderboard.clear();
  });

  it('validates period; logged out me = null', async () => {
    expect((await req('GET', '/api/leaderboard?period=week')).statusCode).toBe(400);
    const r = (await req('GET', '/api/leaderboard')).json();
    expect(r).toMatchObject({ period: 'month', items: [], me: null });
    expect(r.monthStart).toBe(bakuMonth(new Date()).start.toISOString());
    expect((await req('GET', '/api/leaderboard', a)).json().me).toEqual({ rank: null, points: 0 });
  });

  it('points from real actions, my rank, 5-minute cache, blocked flag', async () => {
    app.leaderboard.clear();
    await req('POST', '/api/spots', a, { type: 'camp', name: 'Camp A', lat: 40.5, lng: 49.9 });
    let r = (await req('GET', '/api/leaderboard', a)).json();
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ rank: 1, points: 10, user: { id: a.user.id }, breakdown: { spots: 10 }, blocked: false });
    expect(r.me).toEqual({ rank: 1, points: 10 });
    // cached: B's new spot doesn't show until the cache expires
    await req('POST', '/api/spots', b, { type: 'camp', name: 'Camp B', lat: 40.6, lng: 49.9 });
    expect((await req('GET', '/api/leaderboard', b)).json().items).toHaveLength(1);
    app.leaderboard.clear();
    r = (await req('GET', '/api/leaderboard', b)).json();
    expect(r.items.map((i: any) => i.user.id)).toEqual([a.user.id, b.user.id]); // tie: A was first
    expect(r.me).toEqual({ rank: 2, points: 10 });
    // public board: blocked users still listed, flagged for the viewer
    await req('POST', `/api/users/${a.user.id}/block`, b);
    expect((await req('GET', '/api/leaderboard', b)).json().items[0]).toMatchObject({ user: { id: a.user.id }, blocked: true });
    expect((await req('GET', '/api/leaderboard', a)).json().items[1]).toMatchObject({ user: { id: b.user.id }, blocked: true });
    const all = (await req('GET', '/api/leaderboard?period=all', a)).json();
    expect(all.period).toBe('all');
    expect(all.me).toEqual({ rank: 1, points: 10 });
  });
});

describe('clan driver titles + monthly points (acceptance check 4)', () => {
  it('titles, rookie window, sorting, clan points; permissions unchanged', async () => {
    const leader = await register(app, 'Lider');
    const nav = await register(app, 'Navi');
    const vet = await register(app, 'Veteran');
    const rookie = await register(app, 'Rookie');
    const clan = (await req('POST', '/api/clans', leader, { name: 'Title Clan', tag: 'TTL' })).json();
    for (const u of [nav, vet, rookie]) await req('POST', `/api/clans/${clan.id}/join`, u);
    await req('POST', `/api/clans/${clan.id}/members/${nav.user.id}/role`, leader, { role: 'officer' });
    await sql.query(`update clan_members set joined_at = now() - interval '31 days' where user_id = $1`, [vet.user.id]);
    await sql.query(`update clan_members set joined_at = now() - interval '29 days' where user_id = $1`, [rookie.user.id]);
    // points this month: rookie 20, vet 0, leader 10
    await req('POST', '/api/spots', rookie, { type: 'camp', name: 'R1', lat: 40.1, lng: 49.1 });
    await req('POST', '/api/spots', rookie, { type: 'camp', name: 'R2', lat: 40.2, lng: 49.2 });
    await req('POST', '/api/spots', leader, { type: 'camp', name: 'L1', lat: 40.3, lng: 49.3 });
    app.leaderboard.clear();
    const m = (await req('GET', `/api/clans/${clan.id}/members`)).json().items;
    expect(m.map((x: any) => [x.user.id, x.role, x.title, x.monthPoints])).toEqual([
      [leader.user.id, 'leader', 'leader', 10],
      [nav.user.id, 'officer', 'navigator', 0],
      [vet.user.id, 'member', 'driver', 0],
      [rookie.user.id, 'member', 'rookie', 20],
    ]);
    expect(m[0].joinedAt).toMatch(/Z$/);
    expect((await req('GET', `/api/clans/${clan.id}`)).json().monthPoints).toBe(30);
    expect((await req('GET', `/api/users/${rookie.user.id}`)).json().clan).toMatchObject({ role: 'member', title: 'rookie' });
    // permissions follow the role, not the title
    expect((await req('DELETE', `/api/clans/${clan.id}/members/${vet.user.id}`, rookie)).statusCode).toBe(403);
    expect((await req('DELETE', `/api/clans/${clan.id}/members/${vet.user.id}`, nav)).statusCode).toBe(204);
  });
});
