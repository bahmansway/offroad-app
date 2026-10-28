import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { cars, carRatings, mods, users, MOD_CATEGORIES, CURRENCIES, DRIVES, TRANSMISSIONS, FUELS } from '../db/schema.js';
import { badRequest, conflict, forbidden, idParam, notFound, parse } from '../lib/errors.js';
import { ratingSchema, round1 } from '../lib/common.js';
import type { Db } from '../db/index.js';
import { makeLimiter } from '../lib/limits.js';
import { deleteImage, imageUrl, MAX_UPLOAD_BYTES, storeImage } from '../lib/images.js';
import { trimById } from './catalog.js';

export const MAX_CARS_PER_USER = 20;

const maxYear = () => new Date().getFullYear() + 1;
const year = z
  .number()
  .int()
  .min(1950)
  .refine((y) => y <= maxYear(), { message: `Year must be ${1950}-next year` });
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : v === undefined ? undefined : null));

// v2 spec fields: all optional, nullable (null clears). Values pre-filled from a trim stay editable.
const specFields = {
  trimId: z
    .string()
    .max(80)
    .nullable()
    .optional()
    .refine((v) => v === undefined || v === null || trimById.has(v), { message: 'Unknown trim' }),
  engineL: z.number().min(0.5).max(10).nullable().optional(),
  hp: z.number().int().min(20).max(2000).nullable().optional(),
  drive: z.enum(DRIVES).nullable().optional(),
  transmission: z.enum(TRANSMISSIONS).nullable().optional(),
  fuel: z.enum(FUELS).nullable().optional(),
  color: optText(30),
};

const carCreate = z
  .object({
    make: z.string().trim().min(1).max(40),
    model: z.string().trim().min(1).max(60),
    year,
    engine: optText(40),
    description: optText(1000),
    ...specFields,
  })
  .strict();
const carPatch = z
  .object({
    make: z.string().trim().min(1).max(40).optional(),
    model: z.string().trim().min(1).max(60).optional(),
    year: year.optional(),
    engine: optText(40),
    description: optText(1000),
    ...specFields,
  })
  .strict();

const price = z.number().min(0).max(10_000_000).nullable();
const modCreate = z
  .object({
    name: z.string().trim().min(1).max(80),
    category: z.enum(MOD_CATEGORIES),
    price: price.optional(),
    currency: z.enum(CURRENCIES).default('AZN'),
    pricePublic: z.boolean().default(true),
  })
  .strict();
const modPatch = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    category: z.enum(MOD_CATEGORIES).optional(),
    price: price.optional(),
    currency: z.enum(CURRENCIES).optional(),
    pricePublic: z.boolean().optional(),
  })
  .strict();

const listQuery = z.object({ userId: z.uuid().optional() });

type CarRow = typeof cars.$inferSelect;
type ModRow = typeof mods.$inferSelect;

const roundMoney = (n: number) => Math.round(n * 100) / 100;

/** Spec fields shared by CarSummary and Car. */
export const carSpecs = (c: CarRow) => ({
  trimId: c.trimId,
  engineL: c.engineL,
  hp: c.hp,
  drive: c.drive,
  transmission: c.transmission,
  fuel: c.fuel,
  color: c.color,
  photoUrl: imageUrl(c.photoImageId),
});

export const toMod = (m: ModRow, viewerIsOwner: boolean) => ({
  id: m.id,
  name: m.name,
  category: m.category,
  currency: m.currency,
  pricePublic: m.pricePublic,
  price: m.price === null ? null : viewerIsOwner || m.pricePublic ? Number(m.price) : null,
});

/** Car summaries (list cards) for the given filter. */
export async function loadCarSummaries(db: Db, where: { ownerId?: string; id?: string }, limit = 50) {
  const rows = await db
    .select({
      car: cars,
      ownerName: users.displayName,
      ratingAvg: sql<number | null>`(select avg(r.stars)::float from ${carRatings} r where r.car_id = ${cars.id})`,
      ratingCount: sql<number>`(select count(*)::int from ${carRatings} r where r.car_id = ${cars.id})`,
      modCount: sql<number>`(select count(*)::int from ${mods} m where m.car_id = ${cars.id})`,
    })
    .from(cars)
    .innerJoin(users, eq(users.id, cars.ownerId))
    .where(
      where.id ? eq(cars.id, where.id) : where.ownerId ? eq(cars.ownerId, where.ownerId) : undefined,
    )
    .orderBy(desc(cars.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.car.id,
    make: r.car.make,
    model: r.car.model,
    year: r.car.year,
    engine: r.car.engine,
    ...carSpecs(r.car),
    owner: { id: r.car.ownerId, displayName: r.ownerName },
    ratingAvg: round1(r.ratingAvg),
    ratingCount: r.ratingCount,
    modCount: r.modCount,
    createdAt: r.car.createdAt.toISOString(),
  }));
}

export async function carRoutes(app: FastifyInstance) {
  const db = app.db;
  const perUserHourly = (kind: string) =>
    makeLimiter(app, { max: app.config.rateLimits.create, timeWindow: '1 hour', key: (req) => `${kind}:${req.userId}` });
  const carCreateLimit = perUserHourly('car');
  const modCreateLimit = perUserHourly('mod');
  const photoLimit = perUserHourly('photo');

  const ratingAgg = async (carId: string) => {
    const [agg] = await db
      .select({ avg: sql<number | null>`avg(${carRatings.stars})::float`, count: sql<number>`count(*)::int` })
      .from(carRatings)
      .where(eq(carRatings.carId, carId));
    return { ratingAvg: round1(agg.avg), ratingCount: agg.count };
  };

  const loadCar = async (id: string, viewerId: string | null) => {
    const [row] = await db
      .select({ car: cars, ownerName: users.displayName })
      .from(cars)
      .innerJoin(users, eq(users.id, cars.ownerId))
      .where(eq(cars.id, id))
      .limit(1);
    if (!row) throw notFound('Car not found');
    const c = row.car;
    const isOwner = viewerId === c.ownerId;
    const modRows = await db.select().from(mods).where(eq(mods.carId, id)).orderBy(asc(mods.createdAt), asc(mods.id));
    const totalPublicSpend = { AZN: 0, USD: 0, EUR: 0 };
    let hiddenPriceCount = 0;
    for (const m of modRows) {
      if (m.price === null) continue;
      if (m.pricePublic) totalPublicSpend[m.currency] += Number(m.price);
      else hiddenPriceCount++;
    }
    for (const k of CURRENCIES) totalPublicSpend[k] = roundMoney(totalPublicSpend[k]);
    let myRating: number | null = null;
    if (viewerId) {
      const [r] = await db
        .select({ stars: carRatings.stars })
        .from(carRatings)
        .where(and(eq(carRatings.carId, id), eq(carRatings.userId, viewerId)));
      myRating = r?.stars ?? null;
    }
    return {
      id: c.id,
      make: c.make,
      model: c.model,
      year: c.year,
      engine: c.engine,
      description: c.description,
      ...carSpecs(c),
      owner: { id: c.ownerId, displayName: row.ownerName },
      mods: modRows.map((m) => toMod(m, isOwner)),
      ...(await ratingAgg(id)),
      myRating,
      totalPublicSpend,
      hiddenPriceCount,
      createdAt: c.createdAt.toISOString(),
    };
  };

  const loadOwnedCar = async (id: string, userId: string): Promise<CarRow> => {
    const [c] = await db.select().from(cars).where(eq(cars.id, id)).limit(1);
    if (!c) throw notFound('Car not found');
    if (c.ownerId !== userId) throw forbidden('You can only change your own cars');
    return c;
  };

  const loadOwnedMod = async (id: string, userId: string) => {
    const [row] = await db
      .select({ mod: mods, ownerId: cars.ownerId })
      .from(mods)
      .innerJoin(cars, eq(cars.id, mods.carId))
      .where(eq(mods.id, id))
      .limit(1);
    if (!row) throw notFound('Modification not found');
    if (row.ownerId !== userId) throw forbidden('You can only change mods on your own cars');
    return row.mod;
  };

  // ---- cars ----
  app.get('/cars', async (req) => {
    const q = parse(listQuery, req.query);
    return { items: await loadCarSummaries(db, { ownerId: q.userId }, q.userId ? 200 : 50) };
  });

  app.get('/cars/:id', async (req) => loadCar(idParam(req.params), req.userId));

  app.post('/cars', { preHandler: [app.authenticate, carCreateLimit] }, async (req, reply) => {
    const b = parse(carCreate, req.body);
    const [owned] = await db.select({ n: sql<number>`count(*)::int` }).from(cars).where(eq(cars.ownerId, req.userId!));
    if (owned.n >= MAX_CARS_PER_USER) throw conflict(`You can have at most ${MAX_CARS_PER_USER} cars`);
    const [c] = await db
      .insert(cars)
      .values({
        ownerId: req.userId!,
        make: b.make,
        model: b.model,
        year: b.year,
        engine: b.engine ?? null,
        description: b.description ?? null,
        trimId: b.trimId ?? null,
        engineL: b.engineL ?? null,
        hp: b.hp ?? null,
        drive: b.drive ?? null,
        transmission: b.transmission ?? null,
        fuel: b.fuel ?? null,
        color: b.color ?? null,
      })
      .returning({ id: cars.id });
    return reply.status(201).send(await loadCar(c.id, req.userId));
  });

  app.patch('/cars/:id', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    const b = parse(carPatch, req.body);
    await loadOwnedCar(id, req.userId!);
    const set = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    if (Object.keys(set).length) await db.update(cars).set(set).where(eq(cars.id, id));
    return loadCar(id, req.userId);
  });

  app.delete('/cars/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const c = await loadOwnedCar(id, req.userId!);
    await db.delete(cars).where(eq(cars.id, id));
    await deleteImage(db, c.photoImageId);
    return reply.status(204).send();
  });

  // ---- car photo (raw image body, see lib/images.ts) ----
  app.put('/cars/:id/photo', { bodyLimit: MAX_UPLOAD_BYTES, preHandler: [app.authenticate, photoLimit] }, async (req) => {
    const id = idParam(req.params);
    const c = await loadOwnedCar(id, req.userId!);
    const imageId = await storeImage(db, req.userId!, 'car', req.body, c.photoImageId);
    await db.update(cars).set({ photoImageId: imageId }).where(eq(cars.id, id));
    await deleteImage(db, c.photoImageId);
    return { photoUrl: imageUrl(imageId) };
  });

  app.delete('/cars/:id/photo', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const c = await loadOwnedCar(id, req.userId!);
    await db.update(cars).set({ photoImageId: null }).where(eq(cars.id, id));
    await deleteImage(db, c.photoImageId);
    return reply.status(204).send();
  });

  app.put('/cars/:id/rating', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    const { stars } = parse(ratingSchema, req.body);
    const [c] = await db.select({ ownerId: cars.ownerId }).from(cars).where(eq(cars.id, id)).limit(1);
    if (!c) throw notFound('Car not found');
    if (c.ownerId === req.userId) throw forbidden('You cannot rate your own car');
    await db
      .insert(carRatings)
      .values({ carId: id, userId: req.userId!, stars })
      .onConflictDoUpdate({ target: [carRatings.carId, carRatings.userId], set: { stars, updatedAt: new Date() } });
    return { ...(await ratingAgg(id)), myRating: stars };
  });

  // ---- mods ----
  app.post('/cars/:id/mods', { preHandler: [app.authenticate, modCreateLimit] }, async (req, reply) => {
    const carId = idParam(req.params);
    const b = parse(modCreate, req.body);
    await loadOwnedCar(carId, req.userId!);
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(mods).where(eq(mods.carId, carId));
    if (count.n >= 200) throw badRequest('Too many modifications on this car');
    const [m] = await db
      .insert(mods)
      .values({
        carId,
        name: b.name,
        category: b.category,
        price: b.price ?? null,
        currency: b.currency,
        pricePublic: b.pricePublic,
      })
      .returning();
    return reply.status(201).send(toMod(m, true));
  });

  app.patch('/mods/:id', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    const b = parse(modPatch, req.body);
    await loadOwnedMod(id, req.userId!);
    const set = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    if (Object.keys(set).length) {
      const [m] = await db.update(mods).set(set).where(eq(mods.id, id)).returning();
      return toMod(m, true);
    }
    const [m] = await db.select().from(mods).where(eq(mods.id, id));
    return toMod(m, true);
  });

  app.delete('/mods/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    await loadOwnedMod(id, req.userId!);
    await db.delete(mods).where(eq(mods.id, id));
    return reply.status(204).send();
  });
}

