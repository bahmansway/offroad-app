import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, notInArray, sql } from 'drizzle-orm';
import { notificationSettings, pushTokens } from '../db/schema.js';
import { parse } from '../lib/errors.js';
import { makeLimiter } from '../lib/limits.js';
import { PUSH_TOKEN_RE } from '../lib/push.js';

/** A user keeps at most this many phones registered; the oldest (by last seen) are dropped. */
export const MAX_PUSH_TOKENS_PER_USER = 10;

const tokenSchema = z.string().trim().max(255).regex(PUSH_TOKEN_RE, 'not an Expo push token');
const registerSchema = z
  .object({
    token: tokenSchema,
    platform: z.enum(['ios', 'android']),
    locale: z.enum(['az', 'en']).default('az'),
  })
  .strict();
const unregisterSchema = z.object({ token: tokenSchema }).strict();
const settingsSchema = z
  .object({
    messages: z.boolean().optional(),
    friends: z.boolean().optional(),
    clans: z.boolean().optional(),
    events: z.boolean().optional(),
    social: z.boolean().optional(),
  })
  .strict();

export async function notificationRoutes(app: FastifyInstance) {
  const db = app.db;
  const tokenLimit = makeLimiter(app, { max: 60, timeWindow: '1 hour', key: (req) => `pushtoken:${req.userId}` });

  // Register this phone (upsert). A token moves to the latest user who registers it.
  app.post('/me/push-tokens', { preHandler: [app.authenticate, tokenLimit] }, async (req, reply) => {
    const b = parse(registerSchema, req.body);
    const me = req.userId!;
    await db.transaction(async (tx) => {
      await tx
        .insert(pushTokens)
        .values({ userId: me, token: b.token, platform: b.platform, locale: b.locale })
        .onConflictDoUpdate({
          target: pushTokens.token,
          set: { userId: me, platform: b.platform, locale: b.locale, lastSeenAt: new Date() },
        });
      const keep = tx
        .select({ id: pushTokens.id })
        .from(pushTokens)
        .where(eq(pushTokens.userId, me))
        .orderBy(sql`${pushTokens.lastSeenAt} desc`, asc(pushTokens.id))
        .limit(MAX_PUSH_TOKENS_PER_USER);
      await tx.delete(pushTokens).where(and(eq(pushTokens.userId, me), notInArray(pushTokens.id, keep)));
    });
    return reply.status(204).send();
  });

  // Logout: forget this phone. Only my own token is removed; unknown tokens are fine (204).
  app.delete('/me/push-tokens', { preHandler: [app.authenticate, tokenLimit] }, async (req, reply) => {
    const b = parse(unregisterSchema, req.body);
    await db.delete(pushTokens).where(and(eq(pushTokens.token, b.token), eq(pushTokens.userId, req.userId!)));
    return reply.status(204).send();
  });

  const read = async (me: string) => {
    const [s] = await db.select().from(notificationSettings).where(eq(notificationSettings.userId, me));
    return {
      messages: s?.messages ?? true,
      friends: s?.friends ?? true,
      clans: s?.clans ?? true,
      events: s?.events ?? true,
      social: s?.social ?? true,
    };
  };

  app.get('/me/notification-settings', { preHandler: app.authenticate }, async (req) => read(req.userId!));

  app.patch('/me/notification-settings', { preHandler: app.authenticate }, async (req) => {
    const b = parse(settingsSchema, req.body);
    const me = req.userId!;
    const set = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    if (Object.keys(set).length) {
      await db
        .insert(notificationSettings)
        .values({ userId: me, ...set })
        .onConflictDoUpdate({ target: notificationSettings.userId, set: { ...set, updatedAt: new Date() } });
    }
    return read(me);
  });
}
