import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, register, resetDb } from './helpers.js';

let app: FastifyInstance;
let owner: Awaited<ReturnType<typeof register>>;
let other: Awaited<ReturnType<typeof register>>;
let third: Awaited<ReturnType<typeof register>>;
beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  owner = await register(app, 'Owner');
  other = await register(app, 'Other');
  third = await register(app, 'Third');
});
afterAll(async () => app.close());

describe('cars & mods', () => {
  let carId: string;
  const modIds: string[] = [];

  it('create car (auth) and validation', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/cars', payload: { make: 'Toyota', model: 'LC80', year: 1995 } })).statusCode).toBe(401);
    const nextYear = new Date().getFullYear() + 1;
    for (const payload of [
      { make: '', model: 'LC80', year: 1995 },
      { make: 'Toyota', model: 'x'.repeat(61), year: 1995 },
      { make: 'Toyota', model: 'LC80', year: 1949 },
      { make: 'Toyota', model: 'LC80', year: nextYear + 1 },
      { make: 'Toyota', model: 'LC80', year: 1995, engine: 'x'.repeat(41) },
      { make: 'Toyota', model: 'LC80', year: 1995, description: 'x'.repeat(1001) },
      { make: 'Toyota', model: 'LC80' },
    ]) {
      const r = await app.inject({ method: 'POST', url: '/api/cars', headers: owner.auth, payload });
      expect(r.statusCode, JSON.stringify(payload)).toBe(400);
      expect(r.json().error.code).toBe('VALIDATION');
    }
    const ny = await app.inject({ method: 'POST', url: '/api/cars', headers: owner.auth, payload: { make: 'Toyota', model: 'Future', year: nextYear } });
    expect(ny.statusCode).toBe(201);

    const r = await app.inject({
      method: 'POST', url: '/api/cars', headers: owner.auth,
      payload: { make: 'Toyota', model: 'Land Cruiser 80', year: 1995, engine: '4.2 diesel', description: 'Weekend rig' },
    });
    expect(r.statusCode).toBe(201);
    const c = r.json();
    carId = c.id;
    expect(c).toMatchObject({
      make: 'Toyota', model: 'Land Cruiser 80', year: 1995, engine: '4.2 diesel', description: 'Weekend rig',
      owner: { id: owner.user.id, displayName: owner.user.displayName }, mods: [], ratingAvg: null, ratingCount: 0,
      myRating: null, totalPublicSpend: { AZN: 0, USD: 0, EUR: 0 }, hiddenPriceCount: 0,
    });
  });

  it('owner adds 3 mods, one with hidden price', async () => {
    const payloads = [
      { name: 'OME 2" lift', category: 'lift', price: 2400 },
      { name: 'KO2 tyres', category: 'tyres', price: 3200.5, currency: 'AZN', pricePublic: true },
      { name: 'Warn winch', category: 'recovery', price: 1500, currency: 'USD', pricePublic: false },
    ];
    for (const payload of payloads) {
      const r = await app.inject({ method: 'POST', url: `/api/cars/${carId}/mods`, headers: owner.auth, payload });
      expect(r.statusCode).toBe(201);
      modIds.push(r.json().id);
    }
    const first = (await app.inject({ url: `/api/cars/${carId}`, headers: owner.auth })).json().mods[0];
    expect(Object.keys(first).sort()).toEqual(['category', 'currency', 'id', 'name', 'price', 'pricePublic']);
    expect(first).toMatchObject({ currency: 'AZN', pricePublic: true, price: 2400 });

    const usdPublic = await app.inject({ method: 'POST', url: `/api/cars/${carId}/mods`, headers: owner.auth, payload: { name: 'Light bar', category: 'lighting', price: 200, currency: 'USD' } });
    expect(usdPublic.statusCode).toBe(201);
    modIds.push(usdPublic.json().id);
    const noPrice = await app.inject({ method: 'POST', url: `/api/cars/${carId}/mods`, headers: owner.auth, payload: { name: 'Bumper', category: 'bumpers' } });
    expect(noPrice.statusCode).toBe(201);
    expect(noPrice.json()).toMatchObject({ price: null, currency: 'AZN', pricePublic: true });
    modIds.push(noPrice.json().id);
  });

  it('mod validation', async () => {
    for (const payload of [
      { name: '', category: 'lift' },
      { name: 'x'.repeat(81), category: 'lift' },
      { name: 'Thing', category: 'rocket' },
      { name: 'Thing', category: 'lift', price: -1 },
      { name: 'Thing', category: 'lift', price: 10_000_001 },
      { name: 'Thing', category: 'lift', currency: 'GBP' },
      { name: 'Thing', category: 'lift', pricePublic: 'no' },
    ]) {
      const r = await app.inject({ method: 'POST', url: `/api/cars/${carId}/mods`, headers: owner.auth, payload });
      expect(r.statusCode, JSON.stringify(payload)).toBe(400);
      expect(r.json().error.code).toBe('VALIDATION');
    }
  });

  it('other user sees hidden price as null and totals excluding it', async () => {
    const r = await app.inject({ url: `/api/cars/${carId}`, headers: other.auth });
    expect(r.statusCode).toBe(200);
    const c = r.json();
    const winch = c.mods.find((m: any) => m.name === 'Warn winch');
    expect(winch).toMatchObject({ pricePublic: false, price: null, currency: 'USD' });
    expect(c.mods.find((m: any) => m.name === 'KO2 tyres').price).toBe(3200.5);
    expect(c.totalPublicSpend).toEqual({ AZN: 5600.5, USD: 200, EUR: 0 });
    expect(c.hiddenPriceCount).toBe(1);

    const anon = (await app.inject({ url: `/api/cars/${carId}` })).json();
    expect(anon.mods.find((m: any) => m.name === 'Warn winch').price).toBeNull();
    expect(anon.myRating).toBeNull();
  });

  it('owner sees all prices', async () => {
    const c = (await app.inject({ url: `/api/cars/${carId}`, headers: owner.auth })).json();
    expect(c.mods.find((m: any) => m.name === 'Warn winch').price).toBe(1500);
    // totals are always the public ones, even for the owner
    expect(c.totalPublicSpend).toEqual({ AZN: 5600.5, USD: 200, EUR: 0 });
    expect(c.hiddenPriceCount).toBe(1);
    expect(c.mods.length).toBe(5);
  });

  it('owner cannot rate own car; others can, upsert, averages update', async () => {
    const own = await app.inject({ method: 'PUT', url: `/api/cars/${carId}/rating`, headers: owner.auth, payload: { stars: 5 } });
    expect(own.statusCode).toBe(403);
    expect(own.json().error.code).toBe('FORBIDDEN');

    const r1 = await app.inject({ method: 'PUT', url: `/api/cars/${carId}/rating`, headers: other.auth, payload: { stars: 5 } });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toEqual({ ratingAvg: 5, ratingCount: 1, myRating: 5 });
    const r2 = await app.inject({ method: 'PUT', url: `/api/cars/${carId}/rating`, headers: third.auth, payload: { stars: 2 } });
    expect(r2.json()).toEqual({ ratingAvg: 3.5, ratingCount: 2, myRating: 2 });
    const r3 = await app.inject({ method: 'PUT', url: `/api/cars/${carId}/rating`, headers: other.auth, payload: { stars: 3 } });
    expect(r3.json()).toEqual({ ratingAvg: 2.5, ratingCount: 2, myRating: 3 });

    const c = (await app.inject({ url: `/api/cars/${carId}`, headers: other.auth })).json();
    expect(c).toMatchObject({ ratingAvg: 2.5, ratingCount: 2, myRating: 3 });
    expect((await app.inject({ method: 'PUT', url: `/api/cars/${carId}/rating`, headers: other.auth, payload: { stars: 7 } })).statusCode).toBe(400);
  });

  it('list cars and user profile', async () => {
    const latest = (await app.inject({ url: '/api/cars' })).json();
    expect(latest.items.length).toBe(2);
    const mine = (await app.inject({ url: `/api/cars?userId=${owner.user.id}` })).json().items;
    expect(mine.length).toBe(2);
    const lc = mine.find((x: any) => x.id === carId);
    expect(lc).toMatchObject({ make: 'Toyota', model: 'Land Cruiser 80', year: 1995, owner: { id: owner.user.id }, ratingAvg: 2.5, ratingCount: 2 });
    expect((await app.inject({ url: `/api/cars?userId=${other.user.id}` })).json().items).toEqual([]);
    expect((await app.inject({ url: '/api/cars?userId=nope' })).statusCode).toBe(400);

    const prof = await app.inject({ url: `/api/users/${owner.user.id}` });
    expect(prof.statusCode).toBe(200);
    const p = prof.json();
    expect(p).toMatchObject({ id: owner.user.id, displayName: owner.user.displayName, spotCount: 0 });
    expect(p.cars.length).toBe(2);
    expect(p.email).toBeUndefined();
    expect((await app.inject({ url: '/api/users/00000000-0000-0000-0000-000000000000' })).statusCode).toBe(404);
  });

  it("cannot edit/delete someone else's car or mod (403)", async () => {
    const checks = [
      { method: 'PATCH', url: `/api/cars/${carId}`, payload: { model: 'Hacked' } },
      { method: 'DELETE', url: `/api/cars/${carId}` },
      { method: 'POST', url: `/api/cars/${carId}/mods`, payload: { name: 'Sneaky', category: 'other' } },
      { method: 'PATCH', url: `/api/mods/${modIds[0]}`, payload: { price: 1 } },
      { method: 'DELETE', url: `/api/mods/${modIds[0]}` },
    ] as const;
    for (const c of checks) {
      const r = await app.inject({ ...c, headers: other.auth } as any);
      expect(r.statusCode, `${c.method} ${c.url}`).toBe(403);
      expect(r.json().error.code).toBe('FORBIDDEN');
    }
    const c = (await app.inject({ url: `/api/cars/${carId}` })).json();
    expect(c.model).toBe('Land Cruiser 80');
    expect(c.mods.length).toBe(5);
    expect((await app.inject({ method: 'PATCH', url: `/api/mods/00000000-0000-0000-0000-000000000000`, headers: other.auth, payload: { price: 1 } })).statusCode).toBe(404);
  });

  it('owner edits car and mods; hiding a price updates totals', async () => {
    const p = await app.inject({ method: 'PATCH', url: `/api/cars/${carId}`, headers: owner.auth, payload: { model: 'Land Cruiser 80 VX', engine: null } });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ model: 'Land Cruiser 80 VX', engine: null, year: 1995 });

    const m = await app.inject({ method: 'PATCH', url: `/api/mods/${modIds[0]}`, headers: owner.auth, payload: { pricePublic: false } });
    expect(m.statusCode).toBe(200);
    expect(m.json()).toMatchObject({ pricePublic: false, price: 2400 });
    const seen = (await app.inject({ url: `/api/cars/${carId}`, headers: other.auth })).json();
    expect(seen.totalPublicSpend).toEqual({ AZN: 3200.5, USD: 200, EUR: 0 });
    expect(seen.hiddenPriceCount).toBe(2);
    expect(seen.mods.find((x: any) => x.id === modIds[0]).price).toBeNull();

    expect((await app.inject({ method: 'PATCH', url: `/api/mods/${modIds[0]}`, headers: owner.auth, payload: { category: 'bad' } })).statusCode).toBe(400);

    const d = await app.inject({ method: 'DELETE', url: `/api/mods/${modIds[1]}`, headers: owner.auth });
    expect(d.statusCode).toBe(204);
    const after = (await app.inject({ url: `/api/cars/${carId}`, headers: other.auth })).json();
    expect(after.totalPublicSpend).toEqual({ AZN: 0, USD: 200, EUR: 0 });

    expect((await app.inject({ method: 'DELETE', url: `/api/cars/${carId}`, headers: owner.auth })).statusCode).toBe(204);
    expect((await app.inject({ url: `/api/cars/${carId}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/mods/${modIds[2]}`, headers: owner.auth })).statusCode).toBe(404);
  });

  it('reports', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/reports', payload: { targetType: 'user', targetId: owner.user.id, reason: 'spam' } })).statusCode).toBe(401);
    const r = await app.inject({ method: 'POST', url: '/api/reports', headers: other.auth, payload: { targetType: 'user', targetId: owner.user.id, reason: 'spam' } });
    expect(r.statusCode).toBe(201);
    const car2 = (await app.inject({ method: 'POST', url: '/api/cars', headers: owner.auth, payload: { make: 'Niva', model: '4x4', year: 2010 } })).json();
    expect((await app.inject({ method: 'POST', url: '/api/reports', headers: other.auth, payload: { targetType: 'car', targetId: car2.id, reason: 'fake' } })).statusCode).toBe(201);
    const missing = '00000000-0000-0000-0000-000000000000';
    for (const targetType of ['spot', 'car', 'user']) {
      const nf = await app.inject({ method: 'POST', url: '/api/reports', headers: other.auth, payload: { targetType, targetId: missing, reason: 'x' } });
      expect(nf.statusCode, targetType).toBe(404);
      expect(nf.json().error.code).toBe('NOT_FOUND');
    }
    // id of a user reported as a spot -> not found
    expect((await app.inject({ method: 'POST', url: '/api/reports', headers: other.auth, payload: { targetType: 'spot', targetId: owner.user.id, reason: 'x' } })).statusCode).toBe(404);
    for (const payload of [
      { targetType: 'event', targetId: owner.user.id, reason: 'x' },
      { targetType: 'user', targetId: 'abc', reason: 'x' },
      { targetType: 'user', targetId: owner.user.id, reason: '' },
      { targetType: 'user', targetId: owner.user.id, reason: 'x'.repeat(501) },
    ]) {
      expect((await app.inject({ method: 'POST', url: '/api/reports', headers: other.auth, payload })).statusCode).toBe(400);
    }
  });
});
