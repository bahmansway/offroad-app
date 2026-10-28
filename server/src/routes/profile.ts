import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, sql } from 'drizzle-orm';
import { blocks, cars, clanMembers, clans, images, spots, users } from '../db/schema.js';
import type { Db } from '../db/index.js';
import { badRequest, forbidden, idParam, notFound, parse, unauthorized } from '../lib/errors.js';
import { deleteImage, imageUrl, MAX_UPLOAD_BYTES, storeImage } from '../lib/images.js';
import { makeLimiter } from '../lib/limits.js';
import { isForeignKeyViolation, privateUser, userRef, userRefCols } from '../lib/users.js';
import { loadCarSummaries } from './cars.js';

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : v === undefined ? undefined : null));

const mePatch = z
  .object({
    displayName: z.string().trim().min(2).max(40).optional(),
    bio: optText(300),
    city: optText(60),
    currentCarId: z.uuid().nullable().optional(),
  })
  .strict();

async function carSummary(db: Db, carId: string | null) {
  if (!carId) return null;
  const [c] = await loadCarSummaries(db, { id: carId }, 1);
  return c ?? null;
}

/** GET /me shape: private user + current car summary. Also used by auth responses. */
export async function loadMe(db: Db, userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return null;
  return { ...privateUser(u), currentCar: await carSummary(db, u.currentCarId) };
}

/** The clan a user is in (badge on profiles), or null. */
export async function userClan(db: Db, userId: string) {
  const [row] = await db
    .select({ id: clans.id, name: clans.name, tag: clans.tag, logoImageId: clans.logoImageId, role: clanMembers.role })
    .from(clanMembers)
    .innerJoin(clans, eq(clans.id, clanMembers.clanId))
    .where(eq(clanMembers.userId, userId))
    .limit(1);
  return row ? { id: row.id, name: row.name, tag: row.tag, logoUrl: imageUrl(row.logoImageId), role: row.role } : null;
}

export async function profileRoutes(app: FastifyInstance) {
  const db = app.db;
  const photoLimit = makeLimiter(app, {
    max: app.config.rateLimits.create,
    timeWindow: '1 hour',
    key: (req) => `photo:${req.userId}`,
  });
  const uploadOpts = { bodyLimit: MAX_UPLOAD_BYTES, preHandler: [app.authenticate, photoLimit] };

  app.get('/me', { preHandler: app.authenticate }, async (req) => {
    const me = await loadMe(db, req.userId!);
    if (!me) throw unauthorized();
    return me;
  });

  app.patch('/me', { preHandler: app.authenticate }, async (req) => {
    const b = parse(mePatch, req.body);
    if (b.currentCarId) {
      const [c] = await db.select({ ownerId: cars.ownerId }).from(cars).where(eq(cars.id, b.currentCarId)).limit(1);
      if (!c) throw notFound('Car not found');
      if (c.ownerId !== req.userId) throw forbidden('You can only pick one of your own cars');
    }
    const set = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    if (Object.keys(set).length) {
      try {
        await db.update(users).set(set).where(eq(users.id, req.userId!));
      } catch (err) {
        // car deleted between the check and the update
        if (isForeignKeyViolation(err)) throw notFound('Car not found');
        throw err;
      }
    }
    const me = await loadMe(db, req.userId!);
    if (!me) throw unauthorized();
    return me;
  });

  // ---- avatar: raw image body (image/jpeg|png|webp), max 2 MB ----
  app.put('/me/avatar', uploadOpts, async (req) => {
    const [u] = await db.select({ old: users.avatarImageId }).from(users).where(eq(users.id, req.userId!)).limit(1);
    if (!u) throw unauthorized();
    const id = await storeImage(db, req.userId!, 'avatar', req.body, u.old);
    await db.update(users).set({ avatarImageId: id }).where(eq(users.id, req.userId!));
    await deleteImage(db, u.old);
    return { avatarUrl: imageUrl(id) };
  });

  app.delete('/me/avatar', { preHandler: app.authenticate }, async (req, reply) => {
    const [u] = await db.select({ old: users.avatarImageId }).from(users).where(eq(users.id, req.userId!)).limit(1);
    await db.update(users).set({ avatarImageId: null }).where(eq(users.id, req.userId!));
    await deleteImage(db, u?.old);
    return reply.status(204).send();
  });

  // ---- images (public; ids are random and change whenever a photo is replaced) ----
  app.get('/images/:id', async (req, reply) => {
    const id = idParam(req.params);
    const [img] = await db.select({ data: images.data, mime: images.mime }).from(images).where(eq(images.id, id)).limit(1);
    if (!img) throw notFound('Image not found');
    return reply
      .header('content-type', img.mime)
      .header('cache-control', 'public, max-age=31536000, immutable')
      // allow <img> from the Expo web dev server / other origins; helmet's default is same-origin
      .header('cross-origin-resource-policy', 'cross-origin')
      .header('content-security-policy', "default-src 'none'")
      .send(img.data);
  });

  // ---- public profile ----
  app.get('/users/:id', async (req) => {
    const id = idParam(req.params);
    const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!u) throw notFound('User not found');
    const [sc] = await db.select({ n: sql<number>`count(*)::int` }).from(spots).where(eq(spots.ownerId, id));
    let isBlocked = false;
    if (req.userId && req.userId !== id) {
      const [b] = await db
        .select({ x: blocks.blockerId })
        .from(blocks)
        .where(and(eq(blocks.blockerId, req.userId), eq(blocks.blockedId, id)))
        .limit(1);
      isBlocked = !!b;
    }
    return {
      id: u.id,
      displayName: u.displayName,
      createdAt: u.createdAt.toISOString(),
      avatarUrl: imageUrl(u.avatarImageId),
      bio: u.bio,
      city: u.city,
      currentCar: await carSummary(db, u.currentCarId),
      cars: await loadCarSummaries(db, { ownerId: id }, 200),
      spotCount: sc.n,
      clan: await userClan(db, id),
      isBlocked,
    };
  });

  // ---- block / unblock ----
  app.post('/users/:id/block', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    if (id === req.userId) throw badRequest('You cannot block yourself');
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!u) throw notFound('User not found');
    await db.insert(blocks).values({ blockerId: req.userId!, blockedId: id }).onConflictDoNothing();
    return reply.status(204).send();
  });

  app.delete('/users/:id/block', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    await db.delete(blocks).where(and(eq(blocks.blockerId, req.userId!), eq(blocks.blockedId, id)));
    return reply.status(204).send();
  });

  app.get('/me/blocks', { preHandler: app.authenticate }, async (req) => {
    const rows = await db
      .select(userRefCols)
      .from(blocks)
      .innerJoin(users, eq(users.id, blocks.blockedId))
      .where(eq(blocks.blockerId, req.userId!))
      .orderBy(asc(users.displayName));
    return { items: rows.map(userRef) };
  });
}
