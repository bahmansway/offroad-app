import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { makeApp, register, resetDb, TEST_DB_URL } from './helpers.js';
import { demoEmail, demoFromEnv, removeDemo, seedDemo } from '../src/seedDemo.js';

const PASSWORD = 'demo-test-password-1';
let app: FastifyInstance;
let sql: pg.Client;
type Auth = { authorization: string };
const req = (method: string, url: string, auth?: Auth, payload?: unknown) =>
  app.inject({ method: method as any, url, headers: auth, payload: payload as any });
const one = async (q: string, p: unknown[] = []) => (await sql.query(q, p)).rows[0];
const num = async (q: string, p: unknown[] = []) => Number(Object.values(await one(q, p))[0]);
const DEMO = `lower(email) like '%@demo.yolchu.az'`;

async function login(email: string): Promise<Auth> {
  const r = await req('POST', '/api/auth/login', undefined, { email, password: PASSWORD });
  expect(r.statusCode).toBe(200);
  return { authorization: `Bearer ${r.json().accessToken}` };
}

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

describe('demo seed', () => {
  let real: Awaited<ReturnType<typeof register>>;
  let real2: Awaited<ReturnType<typeof register>>;
  let realSpot: string;
  let realCar: string;
  let real2Car: string;

  it('a real user with their own data exists before seeding', async () => {
    real = await register(app, 'Real');
    real2 = await register(app, 'Real Two');
    let r = await req('POST', '/api/spots', real.auth, { type: 'trail', name: 'My own trail', lat: 40.5, lng: 49.5, difficulty: 2, tags: [] });
    realSpot = r.json().id;
    r = await req('POST', '/api/cars', real.auth, { make: 'Toyota', model: 'Hilux', year: 2018 });
    realCar = r.json().id;
    await req('POST', `/api/cars/${realCar}/mods`, real.auth, { name: 'Winch', category: 'recovery', price: 900, pricePublic: false });
    r = await req('POST', '/api/cars', real2.auth, { make: 'Lada', model: 'Niva', year: 2015 });
    real2Car = r.json().id;
  });

  it('refuses without a password', async () => {
    await expect(seedDemo(app.db, { password: '' })).rejects.toThrow(/DEMO_PASSWORD/);
    await expect(seedDemo(app.db, { password: 'only-15-chars!!' })).rejects.toThrow(/16 characters/);
    expect(await num(`select count(*) from users where ${DEMO}`)).toBe(0);
  });

  it('seeds the expected amounts', async () => {
    const r = await seedDemo(app.db, { password: PASSWORD });
    expect(r.skipped).toBe(false);
    expect(await num(`select count(*) from users where ${DEMO}`)).toBe(33);
    expect(await num('select count(*) from cars c join users u on u.id = c.owner_id where ' + DEMO)).toBe(45);
    expect(await num(`select count(*) from spots where type = 'trail' and owner_id <> $1`, [real.user.id])).toBe(25);
    expect(await num(`select count(*) from spots where type = 'camp'`)).toBe(8);
    expect(await num('select count(*) from clans')).toBe(4);
    expect(await num('select count(*) from clan_requests')).toBeGreaterThan(0);
    expect(await num('select count(*) from events')).toBe(12);
    expect(await num(`select count(*) from conversations where type = 'group'`)).toBe(2);
    expect(await num(`select count(*) from conversations where type = 'dm'`)).toBeGreaterThanOrEqual(5);
    expect(await num('select count(*) from friend_requests')).toBeGreaterThan(0);
    // every demo user has 3-10 friends
    const f = await one(`select min(n)::int as lo, max(n)::int as hi from (select count(*) n from friendships group by user_id) x`);
    expect(f.lo).toBeGreaterThanOrEqual(3);
    expect(f.hi).toBeLessThanOrEqual(10);
    // nobody rated their own car; spots are old enough for points
    expect(await num('select count(*) from car_ratings r join cars c on c.id = r.car_id where c.owner_id = r.user_id')).toBe(0);
    expect(await num(`select count(*) from spots where owner_id <> $1 and created_at > now() - interval '24 hours'`, [real.user.id])).toBe(0);
    // demo marking: every demo bio, every upcoming demo event; past events unchanged
    expect(await num(`select count(*) from users where ${DEMO} and bio not like '%Demo hesab'`)).toBe(0);
    expect(await num(`select count(*) from events where starts_at > now() and description not like '%— Demo tədbir, real deyil.'`)).toBe(0);
    expect(await num(`select count(*) from events where starts_at < now() and description like '%Demo tədbir%'`)).toBe(0);
    // event chat lines never come before their sender joined
    expect(await num(`select count(*) from messages m join conversations c on c.id = m.conversation_id
      join event_participants p on p.event_id = c.event_id and p.user_id = m.sender_id
      where m.type = 'user' and m.created_at < p.joined_at`)).toBe(0);
    expect(await num(`select count(*) from messages where created_at > now()`)).toBe(0);
    // demo accounts log in with the demo password (same argon2 hashing as sign-up)
    await login(demoEmail('reshad.mammadov'));
  });

  it('leaderboard looks alive for this month and all time', async () => {
    app.leaderboard.clear();
    const month = (await req('GET', '/api/leaderboard?period=month')).json();
    const all = (await req('GET', '/api/leaderboard?period=all')).json();
    expect(month.items.length).toBeGreaterThanOrEqual(10);
    expect(all.items.length).toBe(20);
    expect(new Set(all.items.map((i: any) => i.points)).size).toBeGreaterThan(5);
    expect(all.items.some((i: any) => i.breakdown.events > 0)).toBe(true);
    expect(all.items.some((i: any) => i.breakdown.attended > 0)).toBe(true);
    expect(all.items.some((i: any) => i.breakdown.cars > 0)).toBe(true);
    expect(all.items[0].points).toBeGreaterThan(month.items[0].points - 1);
  });

  it('private mod prices stay hidden from others, visible to the owner', async () => {
    const row = await one(`select m.car_id, u.email from mods m join cars c on c.id = m.car_id join users u on u.id = c.owner_id
      where m.price_public = false and m.price is not null and ${DEMO} limit 1`);
    const asOther = (await req('GET', `/api/cars/${row.car_id}`, real.auth)).json();
    const hidden = asOther.mods.filter((m: any) => !m.pricePublic);
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.every((m: any) => m.price === null)).toBe(true);
    expect(asOther.hiddenPriceCount).toBeGreaterThan(0);
    const anon = (await req('GET', `/api/cars/${row.car_id}`)).json();
    expect(anon.mods.filter((m: any) => !m.pricePublic).every((m: any) => m.price === null)).toBe(true);
    const asOwner = (await req('GET', `/api/cars/${row.car_id}`, await login(row.email))).json();
    expect(asOwner.mods.filter((m: any) => !m.pricePublic).every((m: any) => m.price !== null)).toBe(true);
  });

  it('clans show driver titles, events show full / waitlist / clan-only', async () => {
    const dmk = await one(`select id from clans where tag = 'DMK'`);
    const members = (await req('GET', `/api/clans/${dmk.id}/members`)).json().items;
    const titles = new Set(members.map((m: any) => m.title));
    for (const t of ['leader', 'navigator', 'driver', 'rookie']) expect(titles.has(t)).toBe(true);

    const upcoming = (await req('GET', '/api/events?scope=upcoming&limit=50', real.auth)).json().items;
    expect(upcoming.length).toBe(5); // the clan-only one is hidden from non-members
    expect(upcoming.some((e: any) => e.isFull && e.waitlistCount > 0)).toBe(true);
    const clanOnly = await one(`select id from events where visibility = 'clan'`);
    expect((await req('GET', `/api/events/${clanOnly.id}`, real.auth)).statusCode).toBe(404);
    const member = await login(demoEmail('leyla.rzayeva'));
    expect((await req('GET', `/api/events/${clanOnly.id}`, member)).statusCode).toBe(200);
    const past = (await req('GET', '/api/events?scope=past&limit=50')).json().items;
    expect(past.length).toBe(6);
    expect(past.every((e: any) => e.status === 'finished' && e.carCount >= 2)).toBe(true);
  });

  it('a second run does nothing', async () => {
    const before = await num('select count(*) from messages');
    expect(await seedDemo(app.db, { password: PASSWORD })).toEqual({ skipped: true });
    expect(await num(`select count(*) from users where ${DEMO}`)).toBe(33);
    expect(await num('select count(*) from messages')).toBe(before);
  });

  it('nobody can register with the demo email domain', async () => {
    const r = await req('POST', '/api/auth/register', undefined, { email: 'someone@demo.yolchu.az', password: 'long-enough-1', displayName: 'Fake' });
    expect(r.statusCode).toBe(400);
  });

  let realEvent: string;
  let realGroup: string;
  it('real users mix with demo users', async () => {
    const niva = await one(`select id from clans where tag = 'NIVA'`);
    expect((await req('POST', `/api/clans/${niva.id}/join`, real.auth)).statusCode).toBe(200);
    const demoUser = await one(`select id from users where email = $1`, [demoEmail('ramil.abbasov')]);
    const demoAuth = await login(demoEmail('ramil.abbasov'));
    const dm = (await req('POST', '/api/conversations/dm', real.auth, { userId: demoUser.id })).json();
    expect((await req('POST', `/api/conversations/${dm.id}/messages`, real.auth, { text: 'Salam!', clientId: 'c1' })).statusCode).toBe(201);
    const demoSpot = await one(`select s.id from spots s join users u on u.id = s.owner_id where ${DEMO} and s.type = 'trail' limit 1`);
    await req('PUT', `/api/spots/${demoSpot.id}/rating`, real.auth, { stars: 5 });
    // real event at a demo spot: demo user going, second real user waitlisted
    const ev = await req('POST', '/api/events', real.auth, {
      title: 'Real trip', startsAt: new Date(Date.now() + 5 * 86400000).toISOString(), spotId: demoSpot.id, maxCars: 2, carId: realCar,
    });
    expect(ev.statusCode).toBe(201);
    realEvent = ev.json().id;
    const demoCar = await one(`select current_car_id as id from users where id = $1`, [demoUser.id]);
    expect((await req('POST', `/api/events/${realEvent}/join`, demoAuth, { carId: demoCar.id })).json().myStatus).toBe('going');
    expect((await req('POST', `/api/events/${realEvent}/join`, real2.auth, { carId: real2Car })).json().myStatus).toBe('waitlist');
    // group: real admin with a demo friend and a real friend
    const fr = (await req('POST', '/api/friends/requests', real.auth, { userId: demoUser.id })).json();
    await req('POST', `/api/friends/requests/${fr.request.id}/accept`, demoAuth);
    const fr2 = (await req('POST', '/api/friends/requests', real.auth, { userId: real2.user.id })).json();
    await req('POST', `/api/friends/requests/${fr2.request.id}/accept`, real2.auth);
    const g = await req('POST', '/api/conversations/group', real.auth, { name: 'Mixed', userIds: [demoUser.id, real2.user.id] });
    expect(g.statusCode).toBe(201);
    realGroup = g.json().id;
    // a real user in a demo group and a demo DM-free check later
    await sql.query(`insert into reports (reporter_id, target_type, target_id, reason) values ($1, 'user', $2, 'test')`, [real.user.id, demoUser.id]);
  });

  it('removeDemo removes only demo data', async () => {
    // an unrelated empty group (no demo members ever) must not be touched
    await sql.query(`insert into conversations (type, name) values ('group', 'Not demo')`);
    const r = await removeDemo(app.db);
    expect(r.users).toBe(33);
    expect(await num(`select count(*) from conversations where name = 'Not demo'`)).toBe(1);
    expect(await num(`select count(*) from users where ${DEMO}`)).toBe(0);
    expect(await num('select count(*) from users')).toBe(2);
    // real data intact
    expect(await num('select count(*) from spots where id = $1', [realSpot])).toBe(1);
    expect(await num('select count(*) from cars where id = $1', [realCar])).toBe(1);
    expect(await num('select count(*) from mods m where m.car_id = $1 and price = 900', [realCar])).toBe(1);
    // real event survives at the old spot location, waitlisted real user promoted
    const e = (await req('GET', `/api/events/${realEvent}`, real.auth)).json();
    expect(e.spot).toBeNull();
    expect(e.meetingPoint).not.toBeNull();
    expect(e.carCount).toBe(2);
    expect(e.waitlistCount).toBe(0);
    const parts = (await req('GET', `/api/events/${realEvent}/participants`, real.auth)).json().items;
    expect(parts.map((p: any) => p.user.id).sort()).toEqual([real.user.id, real2.user.id].sort());
    // mixed group keeps the real people
    const members = (await req('GET', `/api/conversations/${realGroup}/members`, real.auth)).json().items;
    expect(members.length).toBe(2);
    // demo clan, DM, images, ratings, reports, conversations gone
    expect(await num('select count(*) from clans')).toBe(0);
    expect(await num('select count(*) from clan_members')).toBe(0);
    expect(await num(`select count(*) from conversations where type in ('dm', 'clan')`)).toBe(0);
    expect(await num(`select count(*) from conversations where type = 'group'`)).toBe(2); // mixed + 'Not demo'
    expect(await num(`select count(*) from conversations where name in ('Şahdağ komandası', 'Qadın sürücülər 4x4')`)).toBe(0);
    expect(await num('select count(*) from events')).toBe(1);
    expect(await num('select count(*) from images')).toBe(0);
    expect(await num('select count(*) from reports')).toBe(0);
    expect(await num('select count(*) from friendships')).toBe(2);
    expect(await num(`select count(*) from messages where type = 'system' and system_params->>'userId' not in (select id::text from users)`)).toBe(0);
    app.leaderboard.clear();
    const board = (await req('GET', '/api/leaderboard?period=all')).json();
    expect(board.items.every((i: any) => [real.user.id, real2.user.id].includes(i.user.id))).toBe(true);
    expect((await removeDemo(app.db)).users).toBe(0);
  });

  it('startup flags: nothing by default, password required, never logged', async () => {
    const lines: string[] = [];
    const log = (l: string) => lines.push(l);
    expect(await demoFromEnv(app.db, {}, log)).toBe('none');
    expect(await demoFromEnv(app.db, { DEMO_SEED: '1' }, log)).toBe('error');
    expect(await demoFromEnv(app.db, { DEMO_SEED: '1', DEMO_PASSWORD: 'short-password' }, log)).toBe('error');
    expect(await demoFromEnv(app.db, { DEMO_SEED: '1', DEMO_REMOVE: '1', DEMO_PASSWORD: PASSWORD }, log)).toBe('error');
    expect(await num(`select count(*) from users where ${DEMO}`)).toBe(0);
    expect(await demoFromEnv(app.db, { DEMO_SEED: '1', DEMO_PASSWORD: PASSWORD }, log)).toBe('seeded');
    expect(await demoFromEnv(app.db, { DEMO_SEED: '1', DEMO_PASSWORD: PASSWORD }, log)).toBe('skipped');
    expect(await demoFromEnv(app.db, { DEMO_REMOVE: '1' }, log)).toBe('removed');
    expect(await num(`select count(*) from users where ${DEMO}`)).toBe(0);
    expect(lines.length).toBe(6); // 'none' logs nothing
    expect(lines.some((l) => l.includes(PASSWORD))).toBe(false);
    expect(lines[1]).toMatch(/too short.*16 characters/);
    expect(lines[3]).toMatch(/^demo seed: 33 users, 45 cars/);
  });
});
