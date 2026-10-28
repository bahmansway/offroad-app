import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { users, spots, cars, reports, clans, messages, conversationMembers, REPORT_TARGETS } from '../db/schema.js';
import { notFound, parse } from '../lib/errors.js';

const reportSchema = z
  .object({
    targetType: z.enum(REPORT_TARGETS),
    targetId: z.uuid(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export async function otherRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/health', async () => ({ ok: true }));

  app.post(
    '/reports',
    { preHandler: app.authenticate, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const b = parse(reportSchema, req.body);
      let exists: boolean;
      if (b.targetType === 'message') {
        // Only messages the reporter can see (member of that conversation) can be reported.
        const [m] = await db
          .select({ id: messages.id })
          .from(messages)
          .innerJoin(
            conversationMembers,
            and(eq(conversationMembers.conversationId, messages.conversationId), eq(conversationMembers.userId, req.userId!)),
          )
          .where(eq(messages.id, b.targetId))
          .limit(1);
        exists = !!m;
      } else {
        const table = { spot: spots, car: cars, user: users, clan: clans }[b.targetType];
        const [target] = await db.select({ id: table.id }).from(table).where(eq(table.id, b.targetId)).limit(1);
        exists = !!target;
      }
      if (!exists) throw notFound(`That ${b.targetType} does not exist`);
      const [r] = await db
        .insert(reports)
        .values({ reporterId: req.userId!, targetType: b.targetType, targetId: b.targetId, reason: b.reason })
        .returning({ id: reports.id, createdAt: reports.createdAt });
      return reply.status(201).send({ id: r.id, createdAt: r.createdAt.toISOString() });
    },
  );
}
