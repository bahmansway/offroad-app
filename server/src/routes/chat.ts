import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, gt, inArray, lt, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { blocks, clans, conversationMembers, conversations, messages, users } from '../db/schema.js';
import type { Db } from '../db/index.js';
import { badRequest, forbidden, idParam, notFound, parse } from '../lib/errors.js';
import { imageUrl } from '../lib/images.js';
import { makeLimiter } from '../lib/limits.js';
import { eitherBlocked, userRef, userRefCols } from '../lib/users.js';

type MessageRow = typeof messages.$inferSelect;
type Ref = ReturnType<typeof userRef>;

export const toMessage = (m: MessageRow, sender: Ref) => ({
  id: m.id,
  conversationId: m.conversationId,
  sender,
  text: m.text,
  createdAt: m.createdAt.toISOString(),
  clientId: m.clientId,
});

const sendSchema = z
  .object({
    text: z.string().trim().min(1).max(2000),
    clientId: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .strict();
const dmSchema = z.object({ userId: z.uuid() }).strict();
const pageQuery = z.object({
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Users the viewer has blocked: their messages are hidden from the viewer. */
const blockedByViewer = (viewerId: string) =>
  sql`(select ${blocks.blockedId} from ${blocks} where ${blocks.blockerId} = ${viewerId})`;

export async function isMember(db: Db, conversationId: string, userId: string) {
  const [m] = await db
    .select({ x: conversationMembers.userId })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)))
    .limit(1);
  return !!m;
}

/** 404 if the conversation doesn't exist, 403 if the viewer is not a member. */
async function requireMember(db: Db, conversationId: string, userId: string) {
  const [c] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!c) throw notFound('Conversation not found');
  if (!(await isMember(db, conversationId, userId))) throw forbidden('You are not in this conversation');
  return c;
}

/** Conversation list item as seen by `viewerId`. */
export async function conversationSummary(db: Db, conv: typeof conversations.$inferSelect, viewerId: string) {
  let title = '';
  let avatarUrl: string | null = null;
  let otherUser: Ref | null = null;
  if (conv.type === 'clan' && conv.clanId) {
    const [c] = await db.select({ name: clans.name, logo: clans.logoImageId }).from(clans).where(eq(clans.id, conv.clanId));
    title = c?.name ?? '';
    avatarUrl = imageUrl(c?.logo);
  } else {
    const [o] = await db
      .select(userRefCols)
      .from(conversationMembers)
      .innerJoin(users, eq(users.id, conversationMembers.userId))
      .where(and(eq(conversationMembers.conversationId, conv.id), ne(conversationMembers.userId, viewerId)))
      .limit(1);
    if (o) {
      otherUser = userRef(o);
      title = o.displayName;
      avatarUrl = otherUser.avatarUrl;
    }
  }
  const visible = and(eq(messages.conversationId, conv.id), notInArray(messages.senderId, blockedByViewer(viewerId)));
  const [last] = await db
    .select({ m: messages, ...userRefCols })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.senderId))
    .where(visible)
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(1);
  const [unread] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(
      conversationMembers,
      and(eq(conversationMembers.conversationId, messages.conversationId), eq(conversationMembers.userId, viewerId)),
    )
    .where(and(visible, ne(messages.senderId, viewerId), gt(messages.createdAt, conversationMembers.lastReadAt)));
  return {
    id: conv.id,
    type: conv.type,
    title,
    avatarUrl,
    clanId: conv.clanId,
    otherUser,
    lastMessage: last ? toMessage(last.m, userRef(last)) : null,
    unreadCount: unread?.n ?? 0,
    updatedAt: conv.updatedAt.toISOString(),
  };
}

export async function chatRoutes(app: FastifyInstance) {
  const db = app.db;
  const sendLimit = makeLimiter(app, {
    max: app.config.rateLimits.messages,
    timeWindow: '1 minute',
    key: (req) => `msg:${req.userId}`,
  });
  const dmLimit = makeLimiter(app, { max: 60, timeWindow: '1 hour', key: (req) => `dm:${req.userId}` });

  app.get('/conversations', { preHandler: app.authenticate }, async (req) => {
    const rows = await db
      .select({ c: conversations })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(eq(conversationMembers.userId, req.userId!))
      .orderBy(desc(conversations.updatedAt))
      .limit(200);
    return Promise.all(rows.map((r) => conversationSummary(db, r.c, req.userId!)));
  });

  app.get('/conversations/:id', { preHandler: app.authenticate }, async (req) => {
    const c = await requireMember(db, idParam(req.params), req.userId!);
    return conversationSummary(db, c, req.userId!);
  });

  app.post('/conversations/dm', { preHandler: [app.authenticate, dmLimit] }, async (req) => {
    const { userId } = parse(dmSchema, req.body);
    const me = req.userId!;
    if (userId === me) throw badRequest('You cannot message yourself');
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw notFound('User not found');
    if (await eitherBlocked(db, me, userId)) throw forbidden('You cannot message this user');
    const dmKey = [me, userId].sort().join(':');
    await db.insert(conversations).values({ type: 'dm', dmKey }).onConflictDoNothing();
    const [conv] = await db.select().from(conversations).where(eq(conversations.dmKey, dmKey)).limit(1);
    await db
      .insert(conversationMembers)
      .values([
        { conversationId: conv.id, userId: me },
        { conversationId: conv.id, userId },
      ])
      .onConflictDoNothing();
    app.realtime.addMember(me, conv.id);
    app.realtime.addMember(userId, conv.id);
    return conversationSummary(db, conv, me);
  });

  app.get('/conversations/:id/messages', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    const q = parse(pageQuery, req.query);
    await requireMember(db, id, req.userId!);
    const conds: SQL[] = [eq(messages.conversationId, id), notInArray(messages.senderId, blockedByViewer(req.userId!))];
    if (q.before) {
      const [b] = await db
        .select({ createdAt: messages.createdAt })
        .from(messages)
        .where(and(eq(messages.id, q.before), eq(messages.conversationId, id)));
      if (!b) throw badRequest('Unknown "before" message');
      conds.push(
        or(lt(messages.createdAt, b.createdAt), and(eq(messages.createdAt, b.createdAt), lt(messages.id, q.before)))!,
      );
    }
    const rows = await db
      .select({ m: messages, ...userRefCols })
      .from(messages)
      .innerJoin(users, eq(users.id, messages.senderId))
      .where(and(...conds))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(q.limit + 1);
    const hasMore = rows.length > q.limit;
    // oldest first, ready to render top-to-bottom
    const items = rows
      .slice(0, q.limit)
      .reverse()
      .map((r) => toMessage(r.m, userRef(r)));
    return { items, hasMore };
  });

  app.post('/conversations/:id/messages', { preHandler: [app.authenticate, sendLimit] }, async (req, reply) => {
    const id = idParam(req.params);
    const b = parse(sendSchema, req.body);
    const me = req.userId!;
    const conv = await requireMember(db, id, me);
    if (conv.type === 'dm') {
      const [other] = await db
        .select({ id: conversationMembers.userId })
        .from(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, id), ne(conversationMembers.userId, me)));
      if (other && (await eitherBlocked(db, me, other.id))) throw forbidden('You cannot message this user');
    }
    const clientId = b.clientId ?? null;
    const inserted = await db
      .insert(messages)
      .values({ conversationId: id, senderId: me, text: b.text, clientId })
      .onConflictDoNothing()
      .returning();
    const [sender] = await db.select(userRefCols).from(users).where(eq(users.id, me));
    if (inserted.length === 0) {
      // Same clientId sent again (retry after a network drop): return the original, don't re-broadcast.
      const [existing] = await db
        .select()
        .from(messages)
        .where(and(eq(messages.conversationId, id), eq(messages.senderId, me), eq(messages.clientId, clientId!)));
      return reply.status(200).send(toMessage(existing, userRef(sender)));
    }
    const msg = toMessage(inserted[0], userRef(sender));
    const [updated] = await db
      .update(conversations)
      .set({ updatedAt: inserted[0].createdAt })
      .where(eq(conversations.id, id))
      .returning({ updatedAt: conversations.updatedAt });
    await db
      .update(conversationMembers)
      .set({ lastReadAt: inserted[0].createdAt })
      .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, me)));
    // Members who blocked the sender don't get it.
    const blockers = await db
      .select({ id: blocks.blockerId })
      .from(blocks)
      .innerJoin(
        conversationMembers,
        and(eq(conversationMembers.userId, blocks.blockerId), eq(conversationMembers.conversationId, id)),
      )
      .where(eq(blocks.blockedId, me));
    const except = blockers.map((x) => x.id);
    app.realtime.toConversation(id, 'message:new', msg, except);
    app.realtime.toConversation(
      id,
      'conversation:updated',
      { id, lastMessage: msg, updatedAt: updated.updatedAt.toISOString() },
      except,
    );
    return reply.status(201).send(msg);
  });

  app.post('/conversations/:id/read', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    await requireMember(db, id, req.userId!);
    await db
      .update(conversationMembers)
      .set({ lastReadAt: new Date() })
      .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, req.userId!)));
    return reply.status(204).send();
  });
}

/** Membership helpers used by clan routes (keeps sockets in sync). */
export async function addConversationMember(app: FastifyInstance, db: Db, conversationId: string, userId: string) {
  await db.insert(conversationMembers).values({ conversationId, userId }).onConflictDoNothing();
  app.realtime.addMember(userId, conversationId);
}

export async function removeConversationMembers(app: FastifyInstance, db: Db, conversationId: string, userIds: string[]) {
  if (!userIds.length) return;
  await db
    .delete(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), inArray(conversationMembers.userId, userIds)));
  for (const u of userIds) app.realtime.removeMember(u, conversationId);
}
