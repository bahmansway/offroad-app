import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { io as ioClient, type Socket } from 'socket.io-client';
import { makeApp, noisePng, register, resetDb, TEST_DB_URL } from './helpers.js';

type U = Awaited<ReturnType<typeof register>>;
let app: FastifyInstance;
let base: string;
let sql: pg.Client;
const sockets: Socket[] = [];
let org: U, second: U, third: U, outsider: U, clanMate: U;
const carOf: Record<string, string> = {};
let spotId: string;

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
const inDays = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();
async function addCar(u: U) {
  const r = await req('POST', '/api/cars', u, { make: 'Toyota', model: 'Land Cruiser', year: 2015 });
  expect(r.statusCode).toBe(201);
  carOf[u.user.id] = r.json().id;
  return r.json().id as string;
}
const car = (u: U) => carOf[u.user.id];
const eventBody = (u: U, extra: Record<string, unknown> = {}) => ({
  title: 'Weekend at Qobustan',
  startsAt: inDays(3),
  spotId,
  maxCars: 2,
  carId: car(u),
  ...extra,
});
const messagesOf = async (convId: string, u: U) => (await req('GET', `/api/conversations/${convId}/messages`, u)).json().items as any[];

beforeAll(async () => {
  await resetDb();
  app = await makeApp({ RATE_LIMIT_MESSAGES: '1000' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  sql = new pg.Client({ connectionString: TEST_DB_URL });
  await sql.connect();
  org = await register(app, 'Org');
  second = await register(app, 'Second');
  third = await register(app, 'Third');
  outsider = await register(app, 'Outsider');
  clanMate = await register(app, 'ClanMate');
  for (const u of [org, second, third, outsider, clanMate]) await addCar(u);
  const s = await req('POST', '/api/spots', org, { type: 'trail', name: 'Qobustan mud', lat: 40.1, lng: 49.4, difficulty: 3 });
  spotId = s.json().id;
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await sql.end();
  await app.close();
});

describe('events: create + validation', () => {
  it('validates the body', async () => {
    expect((await req('POST', '/api/events', undefined, eventBody(org))).statusCode).toBe(401);
    const bad = [
      { title: 'ab' },
      { title: 'x'.repeat(81) },
      { description: 'x'.repeat(2001) },
      { startsAt: new Date(Date.now() - 60_000).toISOString() },
      { startsAt: inDays(400) },
      { startsAt: 'tomorrow' },
      { endsAt: inDays(2) },
      { endsAt: inDays(11) },
      { maxCars: 1 },
      { maxCars: 101 },
      { maxCars: 2.5 },
      { minDifficulty: 6 },
      { requirements: Array(9).fill('4WD') },
      { requirements: ['x'.repeat(25)] },
      { visibility: 'secret' },
      { seats: 7 },
      { carId: undefined },
      { spotId: null },
      { spotId: null, meetingPoint: { lat: 91, lng: 0, label: 'x' } },
      { spotId: null, meetingPoint: { lat: 40, lng: 49, label: 'x'.repeat(81) } },
      { extra: true },
    ];
    for (const b of bad) {
      const r = await req('POST', '/api/events', org, eventBody(org, b));
      expect(r.statusCode, JSON.stringify(b)).toBe(400);
      expect(r.json().error.code).toBe('VALIDATION');
    }
    // someone else's car
    expect((await req('POST', '/api/events', org, eventBody(org, { carId: car(second) }))).statusCode).toBe(403);
    // unknown spot
    expect((await req('POST', '/api/events', org, eventBody(org, { spotId: '00000000-0000-4000-8000-000000000000' }))).statusCode).toBe(404);
    // clan-only without a clan
    expect((await req('POST', '/api/events', org, eventBody(org, { visibility: 'clan' }))).statusCode).toBe(409);
  });

  it('meeting point instead of spot; shape', async () => {
    const r = await req('POST', '/api/events', org, {
      ...eventBody(org, { spotId: undefined }),
      title: 'Meet at the bridge',
      meetingPoint: { lat: 40.4, lng: 49.8, label: 'Shell station' },
      endsAt: inDays(4),
      requirements: ['4WD', 'Radio'],
      minDifficulty: 2,
      seats: 2,
    });
    expect(r.statusCode).toBe(201);
    const e = r.json();
    expect(e).toMatchObject({
      title: 'Meet at the bridge',
      spot: null,
      meetingPoint: { lat: 40.4, lng: 49.8, label: 'Shell station' },
      maxCars: 2,
      minDifficulty: 2,
      requirements: ['4WD', 'Radio'],
      visibility: 'public',
      clan: null,
      organizer: { id: org.user.id },
      status: 'scheduled',
      participantCount: 3,
      carCount: 1,
      myStatus: 'organizer',
      coverUrl: null,
      chatReadOnly: false,
      canEdit: true,
    });
    expect(e.conversationId).toMatch(/[0-9a-f-]{36}/);
    // others don't get the chat id
    const seen = (await req('GET', `/api/events/${e.id}`, second)).json();
    expect(seen.myStatus).toBeNull();
    expect(seen.conversationId).toBeNull();
    expect((await req('GET', `/api/events/${e.id}`)).statusCode).toBe(200);
  });
});

describe('events: acceptance check 2 (join, waitlist, promotion, cancel)', () => {
  let eventId: string;
  let convId: string;
  it('full flow', async () => {
    const created = (await req('POST', '/api/events', org, eventBody(org))).json();
    eventId = created.id;
    convId = created.conversationId;
    expect(created.spot).toMatchObject({ id: spotId, name: 'Qobustan mud', difficulty: 3 });

    // socket of the second user: should get event chat messages after joining
    const s2 = await connect(second.accessToken);
    const got2: any[] = [];
    s2.on('message:new', (m) => got2.push(m));

    // second joins -> going (2/2 full)
    let r = await req('POST', `/api/events/${eventId}/join`, second, { carId: car(second), seats: 1 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ myStatus: 'going', carCount: 2, isFull: true, conversationId: convId });
    // joined twice -> 409; someone else's car -> 403
    expect((await req('POST', `/api/events/${eventId}/join`, second, { carId: car(second) })).statusCode).toBe(409);
    expect((await req('POST', `/api/events/${eventId}/join`, third, { carId: car(second) })).statusCode).toBe(403);
    expect((await req('POST', `/api/events/${eventId}/join`, third, { carId: car(third), seats: 9 })).statusCode).toBe(400);

    // third -> waitlist
    r = await req('POST', `/api/events/${eventId}/join`, third, { carId: car(third) });
    expect(r.json()).toMatchObject({ myStatus: 'waitlist', carCount: 2, waitlistCount: 1, conversationId: convId });

    // participants list with cars
    const parts = (await req('GET', `/api/events/${eventId}/participants`)).json().items;
    expect(parts.map((p: any) => [p.user.id, p.status, p.isOrganizer])).toEqual([
      [org.user.id, 'going', true],
      [second.user.id, 'going', false],
      [third.user.id, 'waitlist', false],
    ]);
    expect(parts[1]).toMatchObject({ seats: 1, car: { id: car(second), make: 'Toyota' } });

    // the second user gets a socket system message when third waitlists
    await until(() => got2.some((m) => m.systemKey === 'event.waitlisted'));
    const sys = got2.find((m) => m.systemKey === 'event.waitlisted');
    expect(sys).toMatchObject({ type: 'system', sender: null, systemParams: { userId: third.user.id } });

    // second leaves -> third promoted with a system message
    const s3 = await connect(third.accessToken);
    const got3: any[] = [];
    s3.on('message:new', (m) => got3.push(m));
    expect((await req('POST', `/api/events/${eventId}/leave`, second)).statusCode).toBe(204);
    expect((await req('POST', `/api/events/${eventId}/leave`, second)).statusCode).toBe(404);
    const after = (await req('GET', `/api/events/${eventId}`, third)).json();
    expect(after).toMatchObject({ myStatus: 'going', carCount: 2, waitlistCount: 0 });
    await until(() => got3.some((m) => m.systemKey === 'event.promoted'));
    const msgs = await messagesOf(convId, third);
    expect(msgs.map((m) => m.systemKey)).toEqual(['event.joined', 'event.waitlisted', 'event.left', 'event.promoted']);
    expect(msgs.every((m) => m.type === 'system' && m.sender === null && typeof m.text === 'string')).toBe(true);
    expect(msgs[3].systemParams).toMatchObject({ userId: third.user.id });

    // second lost chat access (REST + socket)
    expect((await req('GET', `/api/conversations/${convId}/messages`, second)).statusCode).toBe(403);
    const n = got2.length;
    await req('POST', `/api/conversations/${convId}/messages`, org, { text: 'see you there' });
    await until(() => got3.some((m) => m.text === 'see you there'));
    await wait(100);
    expect(got2.length).toBe(n);

    // organizer can't leave
    expect((await req('POST', `/api/events/${eventId}/leave`, org)).statusCode).toBe(409);
    // non-organizer can't cancel / edit / remove
    expect((await req('POST', `/api/events/${eventId}/cancel`, third, {})).statusCode).toBe(403);
    expect((await req('PATCH', `/api/events/${eventId}`, third, { title: 'Mine now' })).statusCode).toBe(403);
    expect((await req('DELETE', `/api/events/${eventId}/participants/${org.user.id}`, third)).statusCode).toBe(403);

    // cancel with reason -> read-only chat with system message
    r = await req('POST', `/api/events/${eventId}/cancel`, org, { reason: 'Heavy rain' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: 'cancelled', cancelReason: 'Heavy rain', chatReadOnly: true, canEdit: false });
    expect((await req('POST', `/api/events/${eventId}/cancel`, org, {})).statusCode).toBe(409);
    const last = (await messagesOf(convId, third)).pop();
    expect(last).toMatchObject({ type: 'system', systemKey: 'event.cancelled', systemParams: { reason: 'Heavy rain' } });
    const post = await req('POST', `/api/conversations/${convId}/messages`, third, { text: 'too bad' });
    expect(post.statusCode).toBe(403);
    expect((await req('GET', `/api/conversations/${convId}`, third)).json()).toMatchObject({ type: 'event', readOnly: true, eventId });
    // can't join / edit a cancelled event
    expect((await req('POST', `/api/events/${eventId}/join`, outsider, { carId: car(outsider) })).statusCode).toBe(409);
    expect((await req('PATCH', `/api/events/${eventId}`, org, { title: 'Back on' })).statusCode).toBe(409);
    // still listed under "past", not "upcoming"
    const up = (await req('GET', '/api/events?scope=upcoming', org)).json().items.map((e: any) => e.id);
    const past = (await req('GET', '/api/events?scope=past', org)).json().items.map((e: any) => e.id);
    expect(up).not.toContain(eventId);
    expect(past).toContain(eventId);

    // 7 days after cancel the chat disappears
    await sql.query(`update events set cancelled_at = now() - interval '8 days' where id = $1`, [eventId]);
    expect((await req('GET', `/api/conversations/${convId}/messages`, third)).statusCode).toBe(404);
    expect((await req('GET', '/api/conversations', third)).json().map((c: any) => c.id)).not.toContain(convId);
    expect((await req('GET', `/api/events/${eventId}`, third)).json().conversationId).toBeNull();
  });

  it('finished events (by time) are read-only; edit after start rejected', async () => {
    const e = (await req('POST', '/api/events', org, eventBody(org, { title: 'Old trip' }))).json();
    await sql.query(`update events set starts_at = now() - interval '2 hours', ends_at = now() + interval '1 hour' where id = $1`, [e.id]);
    expect((await req('PATCH', `/api/events/${e.id}`, org, { title: 'Too late' })).statusCode).toBe(409);
    expect((await req('POST', `/api/events/${e.id}/join`, second, { carId: car(second) })).statusCode).toBe(409);
    expect((await req('GET', `/api/events/${e.id}`, org)).json()).toMatchObject({ status: 'scheduled', canEdit: false, chatReadOnly: false });
    // chat still open while running
    expect((await req('POST', `/api/conversations/${e.conversationId}/messages`, org, { text: 'on the way' })).statusCode).toBe(201);
    await sql.query(`update events set ends_at = now() - interval '1 hour' where id = $1`, [e.id]);
    expect((await req('GET', `/api/events/${e.id}`, org)).json()).toMatchObject({ status: 'finished', chatReadOnly: true });
    expect((await req('POST', `/api/conversations/${e.conversationId}/messages`, org, { text: 'thanks all' })).statusCode).toBe(403);
    expect((await req('GET', `/api/conversations/${e.conversationId}/messages`, org)).statusCode).toBe(200);
    expect((await req('POST', `/api/events/${e.id}/cancel`, org, {})).statusCode).toBe(409);
    await sql.query(`delete from events where id = $1`, [e.id]);
  });
});

describe('events: last seat under concurrency', () => {
  it('only one of many simultaneous joins gets the last seat; the rest are waitlisted in order', async () => {
    const e = (await req('POST', '/api/events', org, eventBody(org, { title: 'Race for the seat', maxCars: 2 }))).json();
    const racers: U[] = [];
    for (let i = 0; i < 8; i++) {
      const u = await register(app, `Racer${i}`);
      await addCar(u);
      racers.push(u);
    }
    const res = await Promise.all(racers.map((u) => req('POST', `/api/events/${e.id}/join`, u, { carId: car(u) })));
    expect(res.map((r) => r.statusCode)).toEqual(Array(8).fill(200));
    const statuses = res.map((r) => r.json().myStatus);
    expect(statuses.filter((s) => s === 'going')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'waitlist')).toHaveLength(7);
    const { rows } = await sql.query(`select count(*)::int n from event_participants where event_id = $1 and status = 'going'`, [e.id]);
    expect(rows[0].n).toBe(2);

    // concurrent leaves of 'going' + more joins never overbook
    const goingRacer = racers[statuses.indexOf('going')];
    await Promise.all([
      req('POST', `/api/events/${e.id}/leave`, goingRacer),
      ...racers.filter((u) => u !== goingRacer).slice(0, 3).map((u) => req('POST', `/api/events/${e.id}/leave`, u)),
    ]);
    const after = await sql.query(
      `select status, count(*)::int n from event_participants where event_id = $1 group by status order by status`,
      [e.id],
    );
    expect(after.rows).toEqual([
      { status: 'going', n: 2 },
      { status: 'waitlist', n: 3 },
    ]);
  });

  it('raising maxCars promotes the waitlist (FIFO); lowering below going is rejected', async () => {
    const e = (await req('POST', '/api/events', org, eventBody(org, { title: 'Grow me', maxCars: 2 }))).json();
    for (const u of [second, third, outsider]) await req('POST', `/api/events/${e.id}/join`, u, { carId: car(u) });
    let parts = (await req('GET', `/api/events/${e.id}/participants`)).json().items;
    expect(parts.map((p: any) => p.status)).toEqual(['going', 'going', 'waitlist', 'waitlist']);
    expect((await req('PATCH', `/api/events/${e.id}`, org, { maxCars: 3 })).json()).toMatchObject({ carCount: 3, waitlistCount: 1 });
    parts = (await req('GET', `/api/events/${e.id}/participants`)).json().items;
    expect(parts.find((p: any) => p.user.id === third.user.id).status).toBe('going');
    expect(parts.find((p: any) => p.user.id === outsider.user.id).status).toBe('waitlist');
    expect((await req('PATCH', `/api/events/${e.id}`, org, { maxCars: 2 })).statusCode).toBe(409);
    const msgs = await messagesOf(e.conversationId, org);
    expect(msgs.slice(-2).map((m) => m.systemKey)).toEqual(['event.edited', 'event.promoted']);
    expect(msgs[msgs.length - 2].systemParams).toEqual({ fields: ['maxCars'] });

    // organizer removes a going participant -> next promoted; removed can't rejoin and loses chat
    expect((await req('DELETE', `/api/events/${e.id}/participants/${second.user.id}`, org)).statusCode).toBe(204);
    expect((await req('DELETE', `/api/events/${e.id}/participants/${second.user.id}`, org)).statusCode).toBe(404);
    expect((await req('DELETE', `/api/events/${e.id}/participants/${org.user.id}`, org)).statusCode).toBe(409);
    parts = (await req('GET', `/api/events/${e.id}/participants`)).json().items;
    expect(parts.map((p: any) => p.user.id)).not.toContain(second.user.id);
    expect(parts.find((p: any) => p.user.id === outsider.user.id).status).toBe('going');
    expect((await req('POST', `/api/events/${e.id}/join`, second, { carId: car(second) })).statusCode).toBe(403);
    expect((await req('GET', `/api/conversations/${e.conversationId}/messages`, second)).statusCode).toBe(403);
    expect((await messagesOf(e.conversationId, org)).slice(-2).map((m) => m.systemKey)).toEqual(['event.removed', 'event.promoted']);
  });
});

describe('events: edit', () => {
  it('organizer edits; time rules re-checked; system message', async () => {
    const e = (await req('POST', '/api/events', org, eventBody(org, { title: 'Editable' }))).json();
    let r = await req('PATCH', `/api/events/${e.id}`, org, { title: 'Edited title', requirements: ['Winch'], startsAt: inDays(5), endsAt: inDays(6) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ title: 'Edited title', requirements: ['Winch'] });
    expect((await req('PATCH', `/api/events/${e.id}`, org, { endsAt: inDays(4) })).statusCode).toBe(400);
    expect((await req('PATCH', `/api/events/${e.id}`, org, { startsAt: new Date(Date.now() - 1000).toISOString() })).statusCode).toBe(400);
    expect((await req('PATCH', `/api/events/${e.id}`, org, { spotId: null })).statusCode).toBe(400);
    r = await req('PATCH', `/api/events/${e.id}`, org, { spotId: null, meetingPoint: { lat: 40, lng: 49, label: 'Gas station' } });
    expect(r.json()).toMatchObject({ spot: null, meetingPoint: { label: 'Gas station' } });
    expect((await req('PATCH', `/api/events/${e.id}`, org, { bogus: 1 })).statusCode).toBe(400);
    const msgs = await messagesOf(e.conversationId, org);
    expect(msgs.filter((m) => m.systemKey === 'event.edited').length).toBe(2);
  });
});

describe('events: clan-only visibility (acceptance check 3)', () => {
  let clanId: string;
  let ev: any;
  it('setup clan with org + clanMate', async () => {
    clanId = (await req('POST', '/api/clans', org, { name: 'Sand Foxes', tag: 'SFX' })).json().id;
    expect((await req('POST', `/api/clans/${clanId}/join`, clanMate)).statusCode).toBe(200);
    ev = (await req('POST', '/api/events', org, eventBody(org, { title: 'Clan secret trip', visibility: 'clan', maxCars: 5 }))).json();
    expect(ev).toMatchObject({ visibility: 'clan', clan: { id: clanId, name: 'Sand Foxes', tag: 'SFX' } });
  });

  it('404 to non-members everywhere; members see and join', async () => {
    for (const u of [outsider, undefined]) {
      expect((await req('GET', `/api/events/${ev.id}`, u)).statusCode).toBe(404);
      expect((await req('GET', `/api/events/${ev.id}/participants`, u)).statusCode).toBe(404);
      const list = (await req('GET', '/api/events?scope=upcoming&limit=50', u)).json().items.map((e: any) => e.id);
      expect(list).not.toContain(ev.id);
      const spot = (await req('GET', `/api/spots/${spotId}`, u)).json();
      expect(spot.upcomingEvents.map((e: any) => e.id)).not.toContain(ev.id);
      const clanEv = (await req('GET', `/api/clans/${clanId}/events`, u)).json().items.map((e: any) => e.id);
      expect(clanEv).not.toContain(ev.id);
    }
    expect((await req('POST', `/api/events/${ev.id}/join`, outsider, { carId: car(outsider) })).statusCode).toBe(404);
    expect((await req('PATCH', `/api/events/${ev.id}`, outsider, { title: 'Hijack' })).statusCode).toBe(404);
    expect((await req('PUT', `/api/events/${ev.id}/cover`, outsider)).statusCode).toBe(404);
    expect((await req('POST', '/api/reports', outsider, { targetType: 'event', targetId: ev.id, reason: 'spam' })).statusCode).toBe(404);

    expect((await req('GET', `/api/events/${ev.id}`, clanMate)).statusCode).toBe(200);
    expect((await req('GET', '/api/events?clanOnly=true', clanMate)).json().items.map((e: any) => e.id)).toEqual([ev.id]);
    expect((await req('GET', `/api/clans/${clanId}/events`, clanMate)).json().items.map((e: any) => e.id)).toContain(ev.id);
    expect((await req('GET', `/api/spots/${spotId}`, clanMate)).json().upcomingEvents.map((e: any) => e.id)).toContain(ev.id);
    expect((await req('POST', `/api/events/${ev.id}/join`, clanMate, { carId: car(clanMate) })).json().myStatus).toBe('going');
    expect((await req('POST', '/api/reports', clanMate, { targetType: 'event', targetId: ev.id, reason: 'test report' })).statusCode).toBe(201);
    // a public event shows for everyone, including anonymous
    const pub = (await req('POST', '/api/events', org, eventBody(org, { title: 'Open to all' }))).json();
    expect((await req('POST', '/api/reports', outsider, { targetType: 'event', targetId: pub.id, reason: 'x' })).statusCode).toBe(201);
    expect((await req('GET', `/api/spots/${spotId}`)).json().upcomingEvents.map((e: any) => e.id)).toContain(pub.id);
    expect((await req('GET', `/api/spots/${spotId}`)).json().upcomingEvents.length).toBeLessThanOrEqual(5);
  });
});

describe('events: list, limits, cover', () => {
  it('scopes, near filter and cursor paging', async () => {
    const u = await register(app, 'Lister');
    await addCar(u);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const e = (await req('POST', '/api/events', u, { ...eventBody(u, { spotId: undefined }), title: `Far trip ${i}`, startsAt: inDays(30 + i), meetingPoint: { lat: 41.6, lng: 46.6, label: 'Zaqatala' } })).json();
      ids.push(e.id);
    }
    const mine = (await req('GET', '/api/events?scope=mine', u)).json();
    expect(mine.items.map((e: any) => e.id)).toEqual(ids);
    expect((await req('GET', '/api/events?scope=mine')).statusCode).toBe(403);
    // near Zaqatala within 50 km -> only these three
    const near = (await req('GET', '/api/events?near=41.6,46.6&radiusKm=50')).json().items.map((e: any) => e.id);
    expect(near).toEqual(ids);
    expect((await req('GET', '/api/events?near=abc')).statusCode).toBe(400);
    // paging
    const p1 = (await req('GET', '/api/events?scope=mine&limit=2', u)).json();
    expect(p1.items.map((e: any) => e.id)).toEqual(ids.slice(0, 2));
    const p2 = (await req('GET', `/api/events?scope=mine&limit=2&cursor=${p1.nextCursor}`, u)).json();
    expect(p2.items.map((e: any) => e.id)).toEqual([ids[2]]);
    expect(p2.nextCursor).toBeNull();
    expect((await req('GET', '/api/events?cursor=garbage')).statusCode).toBe(400);
  });

  it('max 20 upcoming organized, 10 created per day', async () => {
    const u = await register(app, 'Busy');
    await addCar(u);
    for (let i = 0; i < 10; i++) expect((await req('POST', '/api/events', u, eventBody(u, { title: `Trip ${i}` }))).statusCode).toBe(201);
    const r = await req('POST', '/api/events', u, eventBody(u, { title: 'Trip 11' }));
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('CONFLICT');
    // pretend 10 more were created yesterday -> 20 upcoming
    await sql.query(`update events set created_at = now() - interval '2 days' where organizer_id = $1`, [u.user.id]);
    for (let i = 0; i < 10; i++) expect((await req('POST', '/api/events', u, eventBody(u, { title: `More ${i}` }))).statusCode).toBe(201);
    await sql.query(`update events set created_at = now() - interval '2 days' where organizer_id = $1`, [u.user.id]);
    const over = await req('POST', '/api/events', u, eventBody(u, { title: 'One too many' }));
    expect(over.statusCode).toBe(409);
    expect(over.json().error.message).toMatch(/20 upcoming/);
    // cancelled ones don't count
    const { rows } = await sql.query(`select id from events where organizer_id = $1 limit 1`, [u.user.id]);
    await req('POST', `/api/events/${rows[0].id}/cancel`, u, {});
    expect((await req('POST', '/api/events', u, eventBody(u, { title: 'Now fits' }))).statusCode).toBe(201);
  });

  it('cover photo: organizer only, re-encoded, counts against quota', async () => {
    const e = (await req('POST', '/api/events', org, eventBody(org, { title: 'With cover' }))).json();
    const png = await noisePng(300, 200);
    const put = (u: U | undefined, body: Buffer) =>
      app.inject({ method: 'PUT', url: `/api/events/${e.id}/cover`, headers: { ...(u?.auth ?? {}), 'content-type': 'image/png' }, payload: body });
    expect((await put(undefined, png)).statusCode).toBe(401);
    expect((await put(second, png)).statusCode).toBe(403);
    expect((await put(org, Buffer.from('GIF89a................'))).statusCode).toBe(415);
    const r = await put(org, png);
    expect(r.statusCode).toBe(200);
    const coverUrl = r.json().coverUrl;
    expect(coverUrl).toMatch(/^\/api\/images\//);
    const img = await app.inject({ method: 'GET', url: coverUrl });
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect((await req('GET', `/api/events/${e.id}`)).json().coverUrl).toBe(coverUrl);
    const { rows } = await sql.query(`select kind from images where id = $1`, [coverUrl.split('/').pop()]);
    expect(rows[0].kind).toBe('event');
    // quota: fill org's storage up to the limit and the next cover is refused
    await sql.query(`update images set bytes = 20*1024*1024 where id = $1`, [coverUrl.split('/').pop()]);
    const other = (await req('POST', '/api/events', org, eventBody(org, { title: 'Second cover' }))).json();
    const q = await app.inject({ method: 'PUT', url: `/api/events/${other.id}/cover`, headers: { ...org.auth, 'content-type': 'image/png' }, payload: png });
    expect(q.statusCode).toBe(409);
    // replacing the same cover is allowed (old one doesn't count)
    expect((await put(org, png)).statusCode).toBe(200);
    expect((await req('DELETE', `/api/events/${e.id}/cover`, second)).statusCode).toBe(403);
    expect((await req('DELETE', `/api/events/${e.id}/cover`, org)).statusCode).toBe(204);
    expect((await req('GET', `/api/events/${e.id}`)).json().coverUrl).toBeNull();
  });

  it('migration keeps v2 messages valid (user type, sender set)', async () => {
    const { rows } = await sql.query(`select count(*)::int n from messages where type = 'user' and sender_id is null`);
    expect(rows[0].n).toBe(0);
  });
});

// ---------------- review fixes ----------------

describe('review fixes: events', () => {
  it('edit: 20 per hour; "edited" message only when something changed', async () => {
    const u = await register(app, 'Editor');
    await addCar(u);
    const e = (await req('POST', '/api/events', u, eventBody(u, { title: 'Same title', requirements: ['4WD'] }))).json();
    const count = async () => (await messagesOf(e.conversationId, u)).filter((m) => m.systemKey === 'event.edited').length;
    // no real change -> no message
    expect((await req('PATCH', `/api/events/${e.id}`, u, { title: 'Same title', maxCars: 2, requirements: ['4WD'], spotId, visibility: 'public', startsAt: e.startsAt })).statusCode).toBe(200);
    expect(await count()).toBe(0);
    expect((await req('PATCH', `/api/events/${e.id}`, u, { title: 'New title', maxCars: 2 })).statusCode).toBe(200);
    const msgs = (await messagesOf(e.conversationId, u)).filter((m) => m.systemKey === 'event.edited');
    expect(msgs.map((m) => m.systemParams)).toEqual([{ fields: ['title'] }]);
    for (let i = 2; i < 20; i++) expect((await req('PATCH', `/api/events/${e.id}`, u, { title: `Title ${i}` })).statusCode).toBe(200);
    const r = await req('PATCH', `/api/events/${e.id}`, u, { title: 'One too many' });
    expect(r.statusCode).toBe(429);
    expect(r.json().error.code).toBe('RATE_LIMITED');
  });

  it('leave: 20 per hour', async () => {
    const u = await register(app, 'Leaver');
    const e = (await req('POST', '/api/events', org, eventBody(org, { title: 'Leave spam' }))).json();
    for (let i = 0; i < 20; i++) expect((await req('POST', `/api/events/${e.id}/leave`, u)).statusCode).toBe(404);
    expect((await req('POST', `/api/events/${e.id}/leave`, u)).statusCode).toBe(429);
  });

  it('switching to clan-only uses the organizer\'s current clan; 409 without one', async () => {
    const u = await register(app, 'Switcher');
    await addCar(u);
    const clanA = (await req('POST', '/api/clans', u, { name: 'Clan Alpha', tag: 'ALFA' })).json();
    const e = (await req('POST', '/api/events', u, eventBody(u, { title: 'Public first' }))).json();
    expect(e.clan).toMatchObject({ id: clanA.id });
    expect((await req('DELETE', `/api/clans/${clanA.id}`, u)).statusCode).toBe(204);
    // no clan now
    expect((await req('PATCH', `/api/events/${e.id}`, u, { visibility: 'clan' })).statusCode).toBe(409);
    const clanB = (await req('POST', '/api/clans', u, { name: 'Clan Bravo', tag: 'BRVO' })).json();
    const r = await req('PATCH', `/api/events/${e.id}`, u, { visibility: 'clan' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ visibility: 'clan', clan: { id: clanB.id, name: 'Clan Bravo' } });
  });

  it('requirement tags are de-duplicated (ignoring case)', async () => {
    const org = await register(app, 'Tagger');
    await addCar(org);
    const e = (await req('POST', '/api/events', org, eventBody(org, { title: 'Tags', requirements: ['4WD', '4wd', 'Winch', ' winch ', 'Radio'] }))).json();
    expect(e.requirements).toEqual(['4WD', 'Winch', 'Radio']);
    const p = (await req('PATCH', `/api/events/${e.id}`, org, { requirements: ['Radio', 'RADIO'] })).json();
    expect(p.requirements).toEqual(['Radio']);
  });

  it('spot / meeting point presence is only checked when those fields change', async () => {
    const u = await register(app, 'SpotLoser');
    await addCar(u);
    const sp = (await req('POST', '/api/spots', u, { type: 'camp', name: 'Temporary camp', lat: 40.5, lng: 49.5 })).json();
    const e = (await req('POST', '/api/events', u, eventBody(u, { title: 'Camp night', spotId: sp.id }))).json();
    expect((await req('DELETE', `/api/spots/${sp.id}`, u)).statusCode).toBe(204);
    expect((await req('PATCH', `/api/events/${e.id}`, u, { title: 'Camp night (moved)' })).statusCode).toBe(200);
    expect((await req('PATCH', `/api/events/${e.id}`, u, { spotId: null })).statusCode).toBe(400);
  });

  it('no "left" message once the chat is read-only', async () => {
    const org = await register(app, 'Quiet');
    await addCar(org);
    const e = (await req('POST', '/api/events', org, eventBody(org, { title: 'Quiet after cancel', maxCars: 5 }))).json();
    await req('POST', `/api/events/${e.id}/join`, third, { carId: car(third) });
    await req('POST', `/api/events/${e.id}/cancel`, org, {});
    expect((await req('POST', `/api/events/${e.id}/leave`, third)).statusCode).toBe(204);
    const keys = (await messagesOf(e.conversationId, org)).map((m) => m.systemKey);
    expect(keys).toEqual(['event.joined', 'event.cancelled']);
  });

  it('cover can\'t change after start or cancel', async () => {
    const org = await register(app, 'Coverer');
    await addCar(org);
    const png = await noisePng(64, 64);
    const put = (id: string) =>
      app.inject({ method: 'PUT', url: `/api/events/${id}/cover`, headers: { ...org.auth, 'content-type': 'image/png' }, payload: png });
    const a = (await req('POST', '/api/events', org, eventBody(org, { title: 'Cover cancel' }))).json();
    expect((await put(a.id)).statusCode).toBe(200);
    await req('POST', `/api/events/${a.id}/cancel`, org, {});
    expect((await put(a.id)).statusCode).toBe(409);
    expect((await req('DELETE', `/api/events/${a.id}/cover`, org)).statusCode).toBe(409);
    const b = (await req('POST', '/api/events', org, eventBody(org, { title: 'Cover started' }))).json();
    await sql.query(`update events set starts_at = now() - interval '1 hour' where id = $1`, [b.id]);
    expect((await put(b.id)).statusCode).toBe(409);
  });
});
