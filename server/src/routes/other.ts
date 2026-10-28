import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { users, spots, cars, reports } from '../db/schema.js';
import { idParam, notFound, parse } from '../lib/errors.js';
import { loadCarSummaries } from './cars.js';

const reportSchema = z
  .object({
    targetType: z.enum(['spot', 'car', 'user']),
    targetId: z.uuid(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export async function otherRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/health', async () => ({ ok: true }));

  app.get('/users/:id', async (req) => {
    const id = idParam(req.params);
    const [u] = await db
      .select({ id: users.id, displayName: users.displayName, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!u) throw notFound('User not found');
    const [sc] = await db.select({ n: sql<number>`count(*)::int` }).from(spots).where(eq(spots.ownerId, id));
    return {
      id: u.id,
      displayName: u.displayName,
      createdAt: u.createdAt.toISOString(),
      cars: await loadCarSummaries(db, { ownerId: id }, 200),
      spotCount: sc.n,
    };
  });

  app.post(
    '/reports',
    { preHandler: app.authenticate, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const b = parse(reportSchema, req.body);
      const table = { spot: spots, car: cars, user: users }[b.targetType];
      const [target] = await db.select({ id: table.id }).from(table).where(eq(table.id, b.targetId)).limit(1);
      if (!target) throw notFound(`That ${b.targetType} does not exist`);
      const [r] = await db
        .insert(reports)
        .values({ reporterId: req.userId!, targetType: b.targetType, targetId: b.targetId, reason: b.reason })
        .returning({ id: reports.id, createdAt: reports.createdAt });
      return reply.status(201).send({ id: r.id, createdAt: r.createdAt.toISOString() });
    },
  );
}
