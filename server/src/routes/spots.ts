import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { spots, spotRatings, users } from '../db/schema.js';
import { forbidden, idParam, notFound, parse } from '../lib/errors.js';
import { ratingSchema, round1 } from '../lib/common.js';
import { makeLimiter } from '../lib/limits.js';

const baseFields = {
  type: z.enum(['trail', 'camp']),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(2000).default(''),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  difficulty: z.number().int().min(1).max(5).nullable().optional(),
  season: z.string().trim().max(40).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(8).default([]),
};

type SpotInput = { type: 'trail' | 'camp'; difficulty?: number | null };
const difficultyRule = <T extends SpotInput>(s: T, ctx: z.RefinementCtx) => {
  if (s.type === 'trail' && (s.difficulty === null || s.difficulty === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['difficulty'], message: 'Trails need a difficulty level (1-5)' });
  }
  if (s.type === 'camp' && s.difficulty !== null && s.difficulty !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['difficulty'], message: 'Camps have no difficulty level' });
  }
};

const createSchema = z.object(baseFields).strict().superRefine(difficultyRule);
const patchSchema = z
  .object({
    type: baseFields.type.optional(),
    name: baseFields.name.optional(),
    description: z.string().trim().max(2000).optional(),
    lat: baseFields.lat.optional(),
    lng: baseFields.lng.optional(),
    difficulty: baseFields.difficulty,
    season: baseFields.season,
    tags: z.array(z.string().trim().min(1).max(24)).max(8).optional(),
  })
  .strict();

const level = z.coerce.number().int().min(1).max(5);
const listQuery = z
  .object({
    type: z.enum(['trail', 'camp']).optional(),
    minLevel: level.optional(),
    maxLevel: level.optional(),
    q: z.string().trim().max(80).optional(),
  })
  .refine((v) => v.minLevel === undefined || v.maxLevel === undefined || v.minLevel <= v.maxLevel, {
    path: ['minLevel'],
    message: 'minLevel must not be greater than maxLevel',
  });

const ratingAvgSql = sql<number | null>`(select avg(r.stars)::float from ${spotRatings} r where r.spot_id = ${spots.id})`;
const ratingCountSql = sql<number>`(select count(*)::int from ${spotRatings} r where r.spot_id = ${spots.id})`;

const selectFields = {
  spot: spots,
  ownerName: users.displayName,
  ratingAvg: ratingAvgSql,
  ratingCount: ratingCountSql,
};

type Row = {
  spot: typeof spots.$inferSelect;
  ownerName: string;
  ratingAvg: number | null;
  ratingCount: number;
};

const toSpot = (r: Row) => ({
  id: r.spot.id,
  type: r.spot.type,
  name: r.spot.name,
  description: r.spot.description,
  lat: r.spot.lat,
  lng: r.spot.lng,
  difficulty: r.spot.difficulty,
  season: r.spot.season,
  tags: r.spot.tags,
  ratingAvg: round1(r.ratingAvg),
  ratingCount: r.ratingCount,
  owner: { id: r.spot.ownerId, displayName: r.ownerName },
  createdAt: r.spot.createdAt.toISOString(),
});

export async function spotRoutes(app: FastifyInstance) {
  const db = app.db;
  const createLimit = makeLimiter(app, {
    max: app.config.rateLimits.create,
    timeWindow: '1 hour',
    key: (req) => `spot:${req.userId}`,
  });

  const loadSpot = async (id: string) => {
    const [row] = await db
      .select(selectFields)
      .from(spots)
      .innerJoin(users, eq(users.id, spots.ownerId))
      .where(eq(spots.id, id))
      .limit(1);
    return row as Row | undefined;
  };
  const myRating = async (spotId: string, userId: string | null) => {
    if (!userId) return null;
    const [r] = await db
      .select({ stars: spotRatings.stars })
      .from(spotRatings)
      .where(and(eq(spotRatings.spotId, spotId), eq(spotRatings.userId, userId)));
    return r?.stars ?? null;
  };
  const loadOwned = async (id: string, userId: string) => {
    const [s] = await db.select().from(spots).where(eq(spots.id, id)).limit(1);
    if (!s) throw notFound('Spot not found');
    if (s.ownerId !== userId) throw forbidden('You can only change your own spots');
    return s;
  };

  app.get('/spots', async (req) => {
    const q = parse(listQuery, req.query);
    const conds: SQL[] = [];
    if (q.type) conds.push(eq(spots.type, q.type));
    // Level range filters trails; camps have no level and are kept unless type=trail.
    if (q.minLevel !== undefined || q.maxLevel !== undefined) {
      const min = q.minLevel ?? 1;
      const max = q.maxLevel ?? 5;
      conds.push(sql`(${spots.type} = 'camp' or ${spots.difficulty} between ${min} and ${max})`);
    }
    if (q.q) {
      const like = `%${q.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      conds.push(
        sql`(${spots.name} ilike ${like} or ${spots.description} ilike ${like} or exists (select 1 from unnest(${spots.tags}) t where t ilike ${like}))`,
      );
    }
    const rows = await db
      .select(selectFields)
      .from(spots)
      .innerJoin(users, eq(users.id, spots.ownerId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(spots.createdAt))
      .limit(500);
    return { items: (rows as Row[]).map(toSpot) };
  });

  app.get('/spots/:id', async (req) => {
    const id = idParam(req.params);
    const row = await loadSpot(id);
    if (!row) throw notFound('Spot not found');
    return { ...toSpot(row), myRating: await myRating(id, req.userId) };
  });

  app.post('/spots', { preHandler: [app.authenticate, createLimit] }, async (req, reply) => {
    const body = parse(createSchema, req.body);
    const [s] = await db
      .insert(spots)
      .values({
        ownerId: req.userId!,
        type: body.type,
        name: body.name,
        description: body.description,
        lat: body.lat,
        lng: body.lng,
        difficulty: body.type === 'trail' ? body.difficulty! : null,
        season: body.season || null,
        tags: body.tags,
      })
      .returning({ id: spots.id });
    const row = await loadSpot(s.id);
    return reply.status(201).send({ ...toSpot(row!), myRating: null });
  });

  app.patch('/spots/:id', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    const body = parse(patchSchema, req.body);
    const current = await loadOwned(id, req.userId!);
    // Validate the merged result so trail/camp difficulty rules always hold.
    const type = body.type ?? current.type;
    let difficulty = body.difficulty !== undefined ? body.difficulty : current.difficulty;
    if (type === 'camp' && body.type === 'camp' && body.difficulty === undefined) difficulty = null;
    parse(z.object({ type: baseFields.type, difficulty: baseFields.difficulty }).superRefine(difficultyRule), {
      type,
      difficulty,
    });
    await db
      .update(spots)
      .set({
        type,
        difficulty,
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.lat !== undefined && { lat: body.lat }),
        ...(body.lng !== undefined && { lng: body.lng }),
        ...(body.season !== undefined && { season: body.season || null }),
        ...(body.tags !== undefined && { tags: body.tags }),
      })
      .where(eq(spots.id, id));
    const row = await loadSpot(id);
    return { ...toSpot(row!), myRating: await myRating(id, req.userId) };
  });

  app.delete('/spots/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    await loadOwned(id, req.userId!);
    await db.delete(spots).where(eq(spots.id, id));
    return reply.status(204).send();
  });

  app.put('/spots/:id/rating', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    const { stars } = parse(ratingSchema, req.body);
    const [s] = await db.select({ id: spots.id }).from(spots).where(eq(spots.id, id)).limit(1);
    if (!s) throw notFound('Spot not found');
    await db
      .insert(spotRatings)
      .values({ spotId: id, userId: req.userId!, stars })
      .onConflictDoUpdate({
        target: [spotRatings.spotId, spotRatings.userId],
        set: { stars, updatedAt: new Date() },
      });
    const [agg] = await db
      .select({ avg: sql<number | null>`avg(${spotRatings.stars})::float`, count: sql<number>`count(*)::int` })
      .from(spotRatings)
      .where(eq(spotRatings.spotId, id));
    return { ratingAvg: round1(agg.avg), ratingCount: agg.count, myRating: stars };
  });
}
