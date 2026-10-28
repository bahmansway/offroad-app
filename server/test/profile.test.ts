import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { makeApp, noisePng, register, resetDb } from './helpers.js';
import { TRIMS } from '../src/routes/catalog.js';

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

/** 2000x1500 JPEG with EXIF (incl. a GPS-like tag) and a known Artist string. */
async function jpegWithExif() {
  return sharp({ create: { width: 2000, height: 1500, channels: 3, background: '#c2410c' } })
    .jpeg()
    .withExif({ IFD0: { Artist: 'SECRET-ARTIST-TAG', Copyright: 'x' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '40/1 24/1 0/1' } })
    .toBuffer();
}

describe('catalog', () => {
  it('brands, models (Turkish names fixed, offroad flag), trims', async () => {
    const brands = await app.inject({ url: '/api/catalog/brands' });
    expect(brands.statusCode).toBe(200);
    expect(brands.headers['cache-control']).toContain('max-age');
    const list = brands.json();
    expect(list.find((x: any) => x.name === 'UAZ')).toMatchObject({ modelCount: expect.any(Number) });
    expect(JSON.stringify(list)).not.toContain('Serisi');

    const mb = (await app.inject({ url: '/api/catalog/models?brand=mercedes-benz' })).json();
    expect(mb.find((m: any) => m.name === 'G-Class')).toEqual({ name: 'G-Class', offroad: true });
    expect(mb.some((m: any) => /Serisi/.test(m.name))).toBe(false);
    const toyota = (await app.inject({ url: '/api/catalog/models?brand=Toyota' })).json();
    for (const n of ['Land Cruiser', 'Land Cruiser Prado']) expect(toyota.find((m: any) => m.name === n).offroad).toBe(true);
    expect(toyota.find((m: any) => m.name === 'Corolla').offroad).toBe(false);
    const uaz = (await app.inject({ url: '/api/catalog/models?brand=UAZ' })).json().map((m: any) => m.name);
    expect(uaz).toEqual(expect.arrayContaining(['Patriot', 'Hunter', 'Bukhanka (SGR)', 'Pickup']));
    const lada = (await app.inject({ url: '/api/catalog/models?brand=Lada' })).json().map((m: any) => m.name);
    expect(lada).toEqual(expect.arrayContaining(['Niva Legend', 'Niva Travel']));
    const mit = (await app.inject({ url: '/api/catalog/models?brand=Mitsubishi' })).json().map((m: any) => m.name);
    expect(mit).toContain('Pajero Sport');
    expect((await app.inject({ url: '/api/catalog/models?brand=Nope' })).json()).toEqual([]);
    expect((await app.inject({ url: '/api/catalog/models' })).statusCode).toBe(400);

    const lc = (await app.inject({ url: '/api/catalog/trims?brand=Toyota&model=Land%20Cruiser&year=2010' })).json();
    expect(lc.length).toBeGreaterThan(0);
    for (const t of lc) {
      expect(t.yearFrom).toBeLessThanOrEqual(2010);
      expect(t.yearTo === null || t.yearTo >= 2010).toBe(true);
      expect(Object.keys(t).sort()).toEqual(
        ['brand', 'drive', 'engine', 'engineL', 'fuel', 'generation', 'hp', 'id', 'market', 'model', 'powerUnit', 'transmission', 'yearFrom', 'yearTo'].sort(),
      );
    }
    expect((await app.inject({ url: '/api/catalog/trims?brand=Toyota&year=abc' })).statusCode).toBe(400);
  });

  it('trims data is well-formed', () => {
    expect(TRIMS.length).toBeGreaterThanOrEqual(40);
    for (const t of TRIMS) {
      expect(t.engineL).toBeGreaterThanOrEqual(0.5);
      expect(t.engineL).toBeLessThanOrEqual(10);
      expect(t.hp).toBeGreaterThanOrEqual(20);
      expect(['4WD', 'AWD', 'FWD', 'RWD']).toContain(t.drive);
      expect(['manual', 'automatic', 'cvt']).toContain(t.transmission);
      expect(['petrol', 'diesel', 'hybrid', 'electric', 'lpg']).toContain(t.fuel);
      expect(t.engine.length).toBeLessThanOrEqual(40);
      expect(t.powerUnit).toBe(['US', 'GCC'].includes(t.market) ? 'hp' : 'PS');
    }
  });
});

describe('car specs', () => {
  it('create with trim + specs, owner can override, validation', async () => {
    const trim = TRIMS.find((t) => t.id === 'toyota-lc200-45d-286')!;
    const r = await app.inject({
      method: 'POST', url: '/api/cars', headers: a.auth,
      payload: { make: 'Toyota', model: 'Land Cruiser', year: 2010, trimId: trim.id, engine: trim.engine, engineL: trim.engineL, hp: trim.hp, drive: trim.drive, transmission: trim.transmission, fuel: trim.fuel, color: 'White' },
    });
    expect(r.statusCode).toBe(201);
    const car = r.json();
    expect(car).toMatchObject({ trimId: trim.id, engineL: 4.5, hp: 286, drive: '4WD', transmission: 'automatic', fuel: 'diesel', color: 'White', photoUrl: null });
    const p = await app.inject({ method: 'PATCH', url: `/api/cars/${car.id}`, headers: a.auth, payload: { hp: 320, color: null } });
    expect(p.json()).toMatchObject({ hp: 320, color: null, trimId: trim.id });
    for (const payload of [
      { trimId: 'not-a-trim' }, { engineL: 0.4 }, { engineL: 10.1 }, { hp: 19 }, { hp: 2001 }, { hp: 150.5 },
      { drive: '6WD' }, { transmission: 'dct' }, { fuel: 'coal' }, { color: 'x'.repeat(31) },
    ]) {
      const bad = await app.inject({ method: 'PATCH', url: `/api/cars/${car.id}`, headers: a.auth, payload });
      expect(bad.statusCode, JSON.stringify(payload)).toBe(400);
    }
    // manual entry without catalog still works
    const manual = await app.inject({ method: 'POST', url: '/api/cars', headers: a.auth, payload: { make: 'Homemade', model: 'Buggy', year: 2001 } });
    expect(manual.statusCode).toBe(201);
    expect(manual.json()).toMatchObject({ trimId: null, hp: null, drive: null });
    const summary = (await app.inject({ url: `/api/cars?userId=${a.user.id}` })).json().items.find((c: any) => c.id === car.id);
    expect(summary).toMatchObject({ hp: 320, photoUrl: null, drive: '4WD' });
  });

  it('private mod prices still hidden from others', async () => {
    const car = (await app.inject({ method: 'POST', url: '/api/cars', headers: a.auth, payload: { make: 'Lada', model: 'Niva Legend', year: 2022 } })).json();
    await app.inject({ method: 'POST', url: `/api/cars/${car.id}/mods`, headers: a.auth, payload: { name: 'Winch', category: 'recovery', price: 900, pricePublic: false } });
    const seen = (await app.inject({ url: `/api/cars/${car.id}`, headers: b.auth })).json();
    expect(seen.mods[0].price).toBeNull();
    expect(seen.hiddenPriceCount).toBe(1);
    expect((await app.inject({ url: `/api/cars/${car.id}`, headers: a.auth })).json().mods[0].price).toBe(900);
  });
});

describe('profile + photos', () => {
  let carId: string;

  it('PATCH /me: name, bio, city, currentCar (own only)', async () => {
    carId = (await app.inject({ method: 'POST', url: '/api/cars', headers: a.auth, payload: { make: 'UAZ', model: 'Patriot', year: 2019 } })).json().id;
    const bCar = (await app.inject({ method: 'POST', url: '/api/cars', headers: b.auth, payload: { make: 'UAZ', model: 'Hunter', year: 2015 } })).json().id;
    expect((await app.inject({ method: 'PATCH', url: '/api/me', payload: { bio: 'x' } })).statusCode).toBe(401);
    const r = await app.inject({ method: 'PATCH', url: '/api/me', headers: a.auth, payload: { displayName: 'Alice A', bio: 'Mud lover', city: 'Bakı', currentCarId: carId } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ displayName: 'Alice A', bio: 'Mud lover', city: 'Bakı', currentCarId: carId, currentCar: { id: carId, model: 'Patriot' }, avatarUrl: null });
    expect((await app.inject({ method: 'PATCH', url: '/api/me', headers: a.auth, payload: { currentCarId: bCar } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: '/api/me', headers: a.auth, payload: { currentCarId: '00000000-0000-0000-0000-000000000000' } })).statusCode).toBe(404);
    for (const payload of [{ bio: 'x'.repeat(301) }, { city: 'x'.repeat(61) }, { displayName: 'A' }, { email: 'x@y.z' }, { currentCarId: 'nope' }]) {
      expect((await app.inject({ method: 'PATCH', url: '/api/me', headers: a.auth, payload })).statusCode, JSON.stringify(payload)).toBe(400);
    }
    const cleared = await app.inject({ method: 'PATCH', url: '/api/me', headers: a.auth, payload: { bio: null } });
    expect(cleared.json().bio).toBeNull();
  });

  it('avatar upload re-encodes to JPEG, resizes to 512, strips EXIF/GPS', async () => {
    const input = await jpegWithExif();
    expect(input.includes('SECRET-ARTIST-TAG')).toBe(true);
    expect((await app.inject({ method: 'PUT', url: '/api/me/avatar', headers: { 'content-type': 'image/jpeg' }, payload: input })).statusCode).toBe(401);
    const r = await app.inject({ method: 'PUT', url: '/api/me/avatar', headers: { ...a.auth, 'content-type': 'image/jpeg' }, payload: input });
    expect(r.statusCode, r.body).toBe(200);
    const { avatarUrl } = r.json();
    expect(avatarUrl).toMatch(/^\/api\/images\/[0-9a-f-]{36}$/);
    const img = await app.inject({ url: avatarUrl });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(img.headers['cache-control']).toContain('immutable');
    expect(img.headers['cross-origin-resource-policy']).toBe('cross-origin');
    const meta = await sharp(img.rawPayload).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBe(512);
    expect(meta.exif).toBeUndefined();
    expect(img.rawPayload.includes('SECRET-ARTIST-TAG')).toBe(false);

    // public profile shows it
    const prof = (await app.inject({ url: `/api/users/${a.user.id}` })).json();
    expect(prof).toMatchObject({ avatarUrl, bio: null, city: 'Bakı', currentCar: { id: carId } });
    expect(prof.email).toBeUndefined();

    // replace -> old image gone
    const png = await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0.5 } } }).png().toBuffer();
    const r2 = await app.inject({ method: 'PUT', url: '/api/me/avatar', headers: { ...a.auth, 'content-type': 'image/png' }, payload: png });
    expect(r2.statusCode).toBe(200);
    expect((await app.inject({ url: avatarUrl })).statusCode).toBe(404);
    const m2 = await sharp((await app.inject({ url: r2.json().avatarUrl })).rawPayload).metadata();
    expect(m2).toMatchObject({ format: 'jpeg', width: 300, height: 200 }); // never enlarged

    expect((await app.inject({ method: 'DELETE', url: '/api/me/avatar', headers: a.auth })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/me', headers: a.auth })).json().avatarUrl).toBeNull();
    expect((await app.inject({ url: r2.json().avatarUrl })).statusCode).toBe(404);
  });

  it('rejects non-images, lying content types, too-large bodies', async () => {
    const h = { ...a.auth, 'content-type': 'image/jpeg' };
    const html = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(200, ' '));
    let r = await app.inject({ method: 'PUT', url: '/api/me/avatar', headers: h, payload: html });
    expect(r.statusCode).toBe(415);
    expect(r.json().error.code).toBe('VALIDATION');
    // GIF and SVG are not accepted either
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).gif().toBuffer();
    expect((await app.inject({ method: 'PUT', url: '/api/me/avatar', headers: h, payload: gif })).statusCode).toBe(415);
    r = await app.inject({ method: 'PUT', url: '/api/me/avatar', headers: { ...a.auth, 'content-type': 'image/svg+xml' }, payload: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    expect(r.statusCode).toBe(415);
    // JPEG magic bytes followed by garbage
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 7)]);
    expect((await app.inject({ method: 'PUT', url: '/api/me/avatar', headers: h, payload: fake })).statusCode).toBe(415);
    // > 2 MB
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2 * 1024 * 1024 + 10)]);
    r = await app.inject({ method: 'PUT', url: '/api/me/avatar', headers: h, payload: big });
    expect(r.statusCode).toBe(413);
    // empty
    expect((await app.inject({ method: 'PUT', url: '/api/me/avatar', headers: h, payload: Buffer.alloc(0) })).statusCode).toBe(400);
    // other routes still limited to 256 KB JSON
    expect((await app.inject({ method: 'PATCH', url: '/api/me', headers: a.auth, payload: { bio: 'x'.repeat(300 * 1024) } })).statusCode).toBe(413);
    expect((await app.inject({ url: '/api/images/00000000-0000-0000-0000-000000000000' })).statusCode).toBe(404);
  });

  it('car photo: owner only, 1024 max, delete', async () => {
    const jpg = await jpegWithExif();
    const h = { 'content-type': 'image/jpeg' };
    expect((await app.inject({ method: 'PUT', url: `/api/cars/${carId}/photo`, headers: { ...b.auth, ...h }, payload: jpg })).statusCode).toBe(403);
    const r = await app.inject({ method: 'PUT', url: `/api/cars/${carId}/photo`, headers: { ...a.auth, ...h }, payload: jpg });
    expect(r.statusCode).toBe(200);
    const meta = await sharp((await app.inject({ url: r.json().photoUrl })).rawPayload).metadata();
    expect(meta.width).toBe(1024);
    expect(meta.exif).toBeUndefined();
    expect((await app.inject({ url: `/api/cars/${carId}`, headers: b.auth })).json().photoUrl).toBe(r.json().photoUrl);
    expect((await app.inject({ url: `/api/users/${a.user.id}` })).json().currentCar.photoUrl).toBe(r.json().photoUrl);
    expect((await app.inject({ method: 'DELETE', url: `/api/cars/${carId}/photo`, headers: b.auth })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/cars/${carId}/photo`, headers: a.auth })).statusCode).toBe(204);
    expect((await app.inject({ url: `/api/cars/${carId}` })).json().photoUrl).toBeNull();
    expect((await app.inject({ url: r.json().photoUrl })).statusCode).toBe(404);
  });

  it('uploads larger than 256 KB (but under 2 MB) work on every photo route', async () => {
    const big = await noisePng();
    expect(big.length).toBeGreaterThan(256 * 1024);
    expect(big.length).toBeLessThan(2 * 1024 * 1024);
    const h = { ...a.auth, 'content-type': 'image/png' };
    const av = await app.inject({ method: 'PUT', url: '/api/me/avatar', headers: h, payload: big });
    expect(av.statusCode, av.body).toBe(200);
    const car = await app.inject({ method: 'PUT', url: `/api/cars/${carId}/photo`, headers: h, payload: big });
    expect(car.statusCode, car.body).toBe(200);
    // (clan logo route is covered in clans-chat.test.ts)
  });

  it('PATCH /me currentCarId pointing at a car deleted meanwhile -> 404 (FK race)', async () => {
    // simulate the race: the car disappears between the ownership check and the update
    const tmp = (await app.inject({ method: 'POST', url: '/api/cars', headers: a.auth, payload: { make: 'Tmp', model: 'Car', year: 2000 } })).json().id;
    const pool = (app as any).db.$client;
    await pool.query('create or replace function test_drop_car() returns trigger as $$ begin delete from cars where id = new.current_car_id; return new; end $$ language plpgsql');
    await pool.query('create trigger test_drop_car before update of current_car_id on users for each row when (new.current_car_id is not null) execute function test_drop_car()');
    try {
      const r = await app.inject({ method: 'PATCH', url: '/api/me', headers: a.auth, payload: { currentCarId: tmp } });
      expect(r.statusCode, r.body).toBe(404);
      expect(r.json().error.code).toBe('NOT_FOUND');
    } finally {
      await pool.query('drop trigger test_drop_car on users; drop function test_drop_car()');
    }
  });

  it('deleting the current car clears currentCar', async () => {
    expect((await app.inject({ method: 'DELETE', url: `/api/cars/${carId}`, headers: a.auth })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/me', headers: a.auth })).json()).toMatchObject({ currentCarId: null, currentCar: null });
  });
});

describe('limits', () => {
  it('max 20 cars per user', async () => {
    const u = await register(app, 'Collector');
    for (let i = 0; i < 20; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/cars', headers: u.auth, payload: { make: 'Lada', model: `N${i}`, year: 2000 } });
      expect(r.statusCode).toBe(201);
    }
    const r = await app.inject({ method: 'POST', url: '/api/cars', headers: u.auth, payload: { make: 'Lada', model: 'One too many', year: 2000 } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('CONFLICT');
  });

  it('20 MB stored image quota per user; replacing a photo does not double-count', async () => {
    const u = await register(app, 'Photographer');
    const pool = (app as any).db.$client;
    // pretend the user already stores 19.9 MB
    await pool.query("insert into images (owner_id, kind, width, height, bytes, data) values ($1, 'car', 1, 1, $2, '\\x00')", [u.user.id, 20 * 1024 * 1024 - 1024]);
    const img = await noisePng(300, 300); // re-encoded JPEG is > 100 KB
    const h = { ...u.auth, 'content-type': 'image/png' };
    const r = await app.inject({ method: 'PUT', url: '/api/me/avatar', headers: h, payload: img });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json().error.message).toMatch(/20 MB/);
    await pool.query('delete from images where owner_id = $1', [u.user.id]);
    await pool.query("insert into images (owner_id, kind, width, height, bytes, data) values ($1, 'car', 1, 1, $2, '\\x00')", [u.user.id, 20 * 1024 * 1024 - 600 * 1024]);
    const first = await app.inject({ method: 'PUT', url: '/api/me/avatar', headers: h, payload: img });
    expect(first.statusCode, first.body).toBe(200);
    // replacing the avatar: old avatar's bytes are excluded from the count
    const again = await app.inject({ method: 'PUT', url: '/api/me/avatar', headers: h, payload: img });
    expect(again.statusCode, again.body).toBe(200);
  });
});
