import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, register, resetDb } from './helpers.js';

let app: FastifyInstance;
let a: Awaited<ReturnType<typeof register>>;
let b: Awaited<ReturnType<typeof register>>;
beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  a = await register(app, 'Alice');
  b = await register(app, 'Bob');
});
afterAll(async () => app.close());

const trail = { type: 'trail', name: 'Candy Cane loop', description: 'Clay hills', lat: 40.9, lng: 49.1, difficulty: 3, season: 'Apr-Oct', tags: ['clay', 'views'] };
const camp = { type: 'camp', name: 'Qabala camp', description: 'Meadow', lat: 40.98, lng: 47.85, tags: [] };

describe('spots', () => {
  let trailId: string;
  let campId: string;

  it('create needs auth', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/spots', payload: trail });
    expect(r.statusCode).toBe(401);
  });

  it('creates a trail with level and returns full Spot shape', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/spots', headers: a.auth, payload: trail });
    expect(r.statusCode).toBe(201);
    const s = r.json();
    trailId = s.id;
    expect(s).toMatchObject({
      type: 'trail', name: trail.name, description: trail.description, lat: 40.9, lng: 49.1,
      difficulty: 3, season: 'Apr-Oct', tags: ['clay', 'views'], ratingAvg: null, ratingCount: 0,
      owner: { id: a.user.id, displayName: a.user.displayName },
    });
    expect(s.createdAt).toMatch(/^\d{4}-/);
    expect(s.owner.email).toBeUndefined();
  });

  it('creates a camp with no level (null)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/spots', headers: a.auth, payload: { ...camp, difficulty: null } });
    expect(r.statusCode).toBe(201);
    expect(r.json().difficulty).toBeNull();
    campId = r.json().id;
    const r2 = await app.inject({ method: 'POST', url: '/api/spots', headers: b.auth, payload: camp });
    expect(r2.statusCode).toBe(201);
    expect(r2.json().difficulty).toBeNull();
  });

  it('trail without level / camp with level -> VALIDATION', async () => {
    const { difficulty: _d, ...noLevel } = trail;
    for (const payload of [noLevel, { ...trail, difficulty: null }, { ...camp, difficulty: 2 }]) {
      const r = await app.inject({ method: 'POST', url: '/api/spots', headers: a.auth, payload });
      expect(r.statusCode).toBe(400);
      expect(r.json().error.code).toBe('VALIDATION');
    }
  });

  it('other spot validation', async () => {
    const bad = [
      { ...trail, difficulty: 6 }, { ...trail, difficulty: 0 }, { ...trail, difficulty: 2.5 },
      { ...trail, lat: 91 }, { ...trail, lng: -181 }, { ...trail, name: 'x' }, { ...trail, name: 'x'.repeat(81) },
      { ...trail, description: 'x'.repeat(2001) }, { ...trail, season: 'x'.repeat(41) },
      { ...trail, tags: Array(9).fill('t') }, { ...trail, tags: ['x'.repeat(25)] }, { ...trail, type: 'road' },
      { ...trail, lat: '40.1' },
    ];
    for (const payload of bad) {
      const r = await app.inject({ method: 'POST', url: '/api/spots', headers: a.auth, payload });
      expect(r.statusCode, JSON.stringify(payload)).toBe(400);
      expect(r.json().error.code).toBe('VALIDATION');
    }
  });

  it('list is visible to other users and anonymous, with filters', async () => {
    await app.inject({ method: 'POST', url: '/api/spots', headers: b.auth, payload: { ...trail, name: 'Shahdag pass', difficulty: 5, tags: ['rocks'] } });
    await app.inject({ method: 'POST', url: '/api/spots', headers: b.auth, payload: { ...trail, name: 'Gobustan easy', difficulty: 1, tags: [] } });

    const all = (await app.inject({ url: '/api/spots', headers: b.auth })).json();
    expect(all.items.length).toBe(5);
    expect(all.items.map((s: any) => s.id)).toContain(trailId);

    const trails = (await app.inject({ url: '/api/spots?type=trail' })).json().items;
    expect(trails.every((s: any) => s.type === 'trail')).toBe(true);
    expect(trails.length).toBe(3);

    const camps = (await app.inject({ url: '/api/spots?type=camp' })).json().items;
    expect(camps.length).toBe(2);
    expect(camps.every((s: any) => s.difficulty === null)).toBe(true);

    const mid = (await app.inject({ url: '/api/spots?type=trail&minLevel=2&maxLevel=4' })).json().items;
    expect(mid.map((s: any) => s.difficulty)).toEqual([3]);

    const hard = (await app.inject({ url: '/api/spots?type=trail&minLevel=4' })).json().items;
    expect(hard.map((s: any) => s.name)).toEqual(['Shahdag pass']);

    const q = (await app.inject({ url: '/api/spots?q=ROCK' })).json().items;
    expect(q.map((s: any) => s.name)).toEqual(['Shahdag pass']);
    const q2 = (await app.inject({ url: '/api/spots?q=candy' })).json().items;
    expect(q2.length).toBe(1);

    const badQ = await app.inject({ url: '/api/spots?minLevel=9' });
    expect(badQ.statusCode).toBe(400);
    expect((await app.inject({ url: '/api/spots?type=road' })).statusCode).toBe(400);
    const flipped = await app.inject({ url: '/api/spots?minLevel=4&maxLevel=2' });
    expect(flipped.statusCode).toBe(400);
    expect(flipped.json().error.code).toBe('VALIDATION');
    expect((await app.inject({ url: '/api/spots?minLevel=3&maxLevel=3' })).statusCode).toBe(200);
  });

  it('get one, with myRating; unknown id -> 404', async () => {
    const r = await app.inject({ url: `/api/spots/${trailId}` });
    expect(r.statusCode).toBe(200);
    expect(r.json().myRating).toBeNull();
    expect((await app.inject({ url: '/api/spots/00000000-0000-0000-0000-000000000000' })).statusCode).toBe(404);
    const nf = await app.inject({ url: '/api/spots/not-a-uuid' });
    expect(nf.statusCode).toBe(404);
    expect(nf.json().error.code).toBe('NOT_FOUND');
  });

  it('rating: upsert, averages update, owner may rate own spot', async () => {
    const r1 = await app.inject({ method: 'PUT', url: `/api/spots/${trailId}/rating`, headers: b.auth, payload: { stars: 4 } });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toEqual({ ratingAvg: 4, ratingCount: 1, myRating: 4 });
    const r2 = await app.inject({ method: 'PUT', url: `/api/spots/${trailId}/rating`, headers: b.auth, payload: { stars: 2 } });
    expect(r2.json()).toEqual({ ratingAvg: 2, ratingCount: 1, myRating: 2 });
    const r3 = await app.inject({ method: 'PUT', url: `/api/spots/${trailId}/rating`, headers: a.auth, payload: { stars: 5 } });
    expect(r3.json()).toEqual({ ratingAvg: 3.5, ratingCount: 2, myRating: 5 });

    const s = (await app.inject({ url: `/api/spots/${trailId}`, headers: b.auth })).json();
    expect(s).toMatchObject({ ratingAvg: 3.5, ratingCount: 2, myRating: 2 });

    for (const stars of [0, 6, 3.5, '4']) {
      const bad = await app.inject({ method: 'PUT', url: `/api/spots/${trailId}/rating`, headers: b.auth, payload: { stars } });
      expect(bad.statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'PUT', url: `/api/spots/${trailId}/rating`, payload: { stars: 3 } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: `/api/spots/00000000-0000-0000-0000-000000000000/rating`, headers: b.auth, payload: { stars: 3 } })).statusCode).toBe(404);
  });

  it("cannot edit/delete someone else's spot (403)", async () => {
    const p = await app.inject({ method: 'PATCH', url: `/api/spots/${trailId}`, headers: b.auth, payload: { name: 'Hacked' } });
    expect(p.statusCode).toBe(403);
    expect(p.json().error.code).toBe('FORBIDDEN');
    const d = await app.inject({ method: 'DELETE', url: `/api/spots/${trailId}`, headers: b.auth });
    expect(d.statusCode).toBe(403);
    expect((await app.inject({ url: `/api/spots/${trailId}` })).json().name).toBe(trail.name);
  });

  it('owner can patch (keeps level rules) and delete', async () => {
    const p = await app.inject({ method: 'PATCH', url: `/api/spots/${trailId}`, headers: a.auth, payload: { name: 'Candy Cane big loop', difficulty: 4 } });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ name: 'Candy Cane big loop', difficulty: 4, type: 'trail' });

    const bad = await app.inject({ method: 'PATCH', url: `/api/spots/${trailId}`, headers: a.auth, payload: { difficulty: null } });
    expect(bad.statusCode).toBe(400);
    const badCamp = await app.inject({ method: 'PATCH', url: `/api/spots/${campId}`, headers: a.auth, payload: { difficulty: 2 } });
    expect(badCamp.statusCode).toBe(400);
    const toTrailNoLevel = await app.inject({ method: 'PATCH', url: `/api/spots/${campId}`, headers: a.auth, payload: { type: 'trail' } });
    expect(toTrailNoLevel.statusCode).toBe(400);
    const toCamp = await app.inject({ method: 'PATCH', url: `/api/spots/${trailId}`, headers: a.auth, payload: { type: 'camp', difficulty: null } });
    expect(toCamp.statusCode).toBe(200);
    expect(toCamp.json().difficulty).toBeNull();

    const d = await app.inject({ method: 'DELETE', url: `/api/spots/${trailId}`, headers: a.auth });
    expect(d.statusCode).toBe(204);
    expect((await app.inject({ url: `/api/spots/${trailId}` })).statusCode).toBe(404);
  });
});

describe('create limits', () => {
  it('30 spots, cars and mods per user per hour (each), per user not per IP', async () => {
    const limited = await makeApp({ RATE_LIMIT_CREATE: '2' });
    try {
      const u1 = await register(limited);
      const u2 = await register(limited);
      const post = (u: typeof u1, url: string, payload: object) => limited.inject({ method: 'POST', url, headers: u.auth, payload });
      const spot = { ...camp, name: 'Limit camp' };
      expect((await post(u1, '/api/spots', spot)).statusCode).toBe(201);
      expect((await post(u1, '/api/spots', spot)).statusCode).toBe(201);
      const r = await post(u1, '/api/spots', spot);
      expect(r.statusCode).toBe(429);
      expect(r.json().error.code).toBe('RATE_LIMITED');
      expect(Number(r.headers['retry-after'])).toBeGreaterThan(15 * 60); // ~1 hour window
      expect(Number(r.headers['retry-after'])).toBeLessThanOrEqual(3600);
      // another user (same IP) is unaffected
      expect((await post(u2, '/api/spots', spot)).statusCode).toBe(201);

      const car = { make: 'UAZ', model: '469', year: 1985 };
      const c1 = await post(u1, '/api/cars', car);
      expect(c1.statusCode).toBe(201);
      expect((await post(u1, '/api/cars', car)).statusCode).toBe(201);
      expect((await post(u1, '/api/cars', car)).statusCode).toBe(429);

      const modUrl = `/api/cars/${c1.json().id}/mods`;
      expect((await post(u1, modUrl, { name: 'Snorkel', category: 'engine' })).statusCode).toBe(201);
      expect((await post(u1, modUrl, { name: 'Snorkel', category: 'engine' })).statusCode).toBe(201);
      expect((await post(u1, modUrl, { name: 'Snorkel', category: 'engine' })).statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
