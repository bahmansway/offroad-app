import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, gt, inArray, isNull, lt, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { clanMembers, clans, conversationMembers, conversations, events, messages, users } from '../db/schema.js';
import type { Db } from '../db/index.js';
import { badRequest, forbidden, idParam, notFound, parse } from '../lib/errors.js';
import { imageUrl } from '../lib/images.js';
import { makeLimiter } from '../lib/limits.js';
import { eitherBlocked, userRef, userRefCols } from '../lib/users.js';
import { broadcastMessage, toMessage, type Ref } from '../lib/messages.js';
import { chatClosedSql, eventState } from '../lib/eventState.js';

export { toMessage } from '../lib/messages.js';

type ConvRow = typeof conversations.$inferSelect;
type EventRow = typeof events.$inferSelect;

/** Soft delete is allowed this long after sending. */
export const DELETE_WINDOW_MS = 24 * 60 * 60 * 1000;

const sendSchema = z
  .object({
    text: z.string().trim().min(1).max(2000),
    clientId: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .strict();
const dmSchema = z.object({ userId: z.uuid() }).strict();
const pinSchema = z.object({ messageId: z.uuid() }).strict();
const pageQuery = z.object({
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Users the viewer has blocked: their messages are hidden from the viewer (system messages always show). */
const visibleTo = (viewerId: string) =>
  or(
    isNull(messages.senderId),
    notInArray(messages.senderId, sql`(select blocked_id from blocks where blocker_id = ${viewerId})`),
  )!;

export async function isMember(db: Db, conversationId: string, userId: string) {
  const [m] = await db
    .select({ x: conversationMembers.userId })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)))
    .limit(1);
  return !!m;
}

async function loadEvent(db: Db, conv: ConvRow) {
  if (conv.type !== 'event' || !conv.eventId) return null;
  const [e] = await db.select().from(events).where(eq(events.id, conv.eventId)).limit(1);
  return e ?? null;
}

/**
 * 404 if the conversation doesn't exist (or is an event chat past its 7-day read-only window),
 * 403 if the viewer is not a member.
 */
async function requireMember(db: Db, conversationId: string, userId: string) {
  const [c] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!c) throw notFound('Conversation not found');
  const ev = await loadEvent(db, c);
  if (c.type === 'event' && (!ev || eventState(ev).chatClosed)) throw notFound('Conversation not found');
  if (!(await isMember(db, conversationId, userId))) throw forbidden('You are not in this conversation');
  return { conv: c, event: ev };
}

/** Who may pin in a conversation: clan leader/officer, event organizer, either DM user. */
async function canPin(db: Db, conv: ConvRow, ev: EventRow | null, userId: string) {
  if (conv.type === 'dm') return true;
  if (conv.type === 'event') return !!ev && ev.organizerId === userId;
  if (conv.type === 'clan' && conv.clanId) {
    const [m] = await db
      .select({ role: clanMembers.role })
      .from(clanMembers)
      .where(and(eq(clanMembers.userId, userId), eq(clanMembers.clanId, conv.clanId)));
    return m?.role === 'leader' || m?.role === 'officer';
  }
  return false;
}

async function loadMessageWithSender(db: Db, id: string) {
  const [r] = await db
    .select({ m: messages, id: users.id, displayName: users.displayName, avatarImageId: users.avatarImageId })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.senderId))
    .where(eq(messages.id, id))
    .limit(1);
  if (!r) return null;
  return toMessage(r.m, r.id ? userRef({ id: r.id, displayName: r.displayName!, avatarImageId: r.avatarImageId }) : null);
}

/** Pinned message as the viewer sees it (hidden if its sender is blocked by the viewer). */
async function pinnedFor(db: Db, conv: ConvRow, viewerId: string) {
  if (!conv.pinnedMessageId) return null;
  const [r] = await db
    .select({ m: messages, ...userRefCols })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.senderId))
    .where(and(eq(messages.id, conv.pinnedMessageId), visibleTo(viewerId)))
    .limit(1);
  if (!r) return null;
  return {
    message: toMessage(r.m, r.id ? userRef(r as any) : null),
    pinnedBy: conv.pinnedById,
    pinnedAt: conv.pinnedAt ? conv.pinnedAt.toISOString() : null,
  };
}

/** Conversation list item as seen by `viewerId`. */
export async function conversationSummary(db: Db, conv: ConvRow, viewerId: string, ev?: EventRow | null) {
  let title = '';
  let avatarUrl: string | null = null;
  let otherUser: Ref | null = null;
  let readOnly = false;
  let readOnlyUntil: string | null = null;
  if (conv.type === 'clan' && conv.clanId) {
    const [c] = await db.select({ name: clans.name, logo: clans.logoImageId }).from(clans).where(eq(clans.id, conv.clanId));
    title = c?.name ?? '';
    avatarUrl = imageUrl(c?.logo);
  } else if (conv.type === 'event') {
    if (ev === undefined) ev = await loadEvent(db, conv);
    if (ev) {
      title = ev.title;
      avatarUrl = imageUrl(ev.coverImageId);
      const st = eventState(ev);
      readOnly = st.readOnly;
      readOnlyUntil = st.chatClosesAt ? st.chatClosesAt.toISOString() : null;
    }
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
  const visible = and(eq(messages.conversationId, conv.id), visibleTo(viewerId));
  const [last] = await db
    .select({ m: messages, ...userRefCols })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.senderId))
    .where(visible)
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(1);
  const [mine] = await db
    .select({ lastReadAt: conversationMembers.lastReadAt, mutedAt: conversationMembers.mutedAt })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conv.id), eq(conversationMembers.userId, viewerId)));
  const [unread] = mine
    ? await db
        .select({ n: sql<number>`count(*)::int` })
        .from(messages)
        .where(
          and(
            visible,
            isNull(messages.deletedAt),
            or(isNull(messages.senderId), ne(messages.senderId, viewerId)),
            gt(messages.createdAt, mine.lastReadAt),
          ),
        )
    : [{ n: 0 }];
  return {
    id: conv.id,
    type: conv.type,
    title,
    avatarUrl,
    clanId: conv.clanId,
    eventId: conv.eventId,
    otherUser,
    lastMessage: last ? toMessage(last.m, last.id ? userRef(last as any) : null) : null,
    unreadCount: unread?.n ?? 0,
    muted: !!mine?.mutedAt,
    readOnly,
    readOnlyUntil,
    pinned: await pinnedFor(db, conv, viewerId),
    canPin: readOnly ? false : await canPin(db, conv, ev ?? null, viewerId),
    updatedAt: conv.updatedAt.toISOString(),
  };
}

/** Conversations of a user, minus event chats past their read-only window. */
const myConversations = (db: Db, userId: string) =>
  db
    .select({ c: conversations, mutedAt: conversationMembers.mutedAt })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .leftJoin(events, eq(events.id, conversations.eventId))
    .where(
      and(
        eq(conversationMembers.userId, userId),
        or(ne(conversations.type, 'event'), sql`not (${chatClosedSql('events')})`),
      ),
    );

export async function chatRoutes(app: FastifyInstance) {
  const db = app.db;
  const sendLimit = makeLimiter(app, {
    max: app.config.rateLimits.messages,
    timeWindow: '1 minute',
    key: (req) => `msg:${req.userId}`,
  });
  const dmLimit = makeLimiter(app, { max: 60, timeWindow: '1 hour', key: (req) => `dm:${req.userId}` });

  app.get('/conversations', { preHandler: app.authenticate }, async (req) => {
    const rows = await myConversations(db, req.userId!).orderBy(desc(conversations.updatedAt)).limit(200);
    return Promise.all(rows.map((r) => conversationSummary(db, r.c, req.userId!)));
  });

  // Total unread for the tab badge. Muted conversations are not counted.
  app.get('/conversations/unread', { preHandler: app.authenticate }, async (req) => {
    const me = req.userId!;
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(
        conversationMembers,
        and(eq(conversationMembers.conversationId, messages.conversationId), eq(conversationMembers.userId, me)),
      )
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .leftJoin(events, eq(events.id, conversations.eventId))
      .where(
        and(
          isNull(conversationMembers.mutedAt),
          visibleTo(me),
          isNull(messages.deletedAt),
          or(isNull(messages.senderId), ne(messages.senderId, me)),
          gt(messages.createdAt, conversationMembers.lastReadAt),
          or(ne(conversations.type, 'event'), sql`not (${chatClosedSql('events')})`),
        ),
      );
    return { total: r.n };
  });

  app.get('/conversations/:id', { preHandler: app.authenticate }, async (req) => {
    const { conv, event } = await requireMember(db, idParam(req.params), req.userId!);
    return conversationSummary(db, conv, req.userId!, event);
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
    const conds: SQL[] = [eq(messages.conversationId, id), visibleTo(req.userId!)];
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
      .leftJoin(users, eq(users.id, messages.senderId))
      .where(and(...conds))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(q.limit + 1);
    const hasMore = rows.length > q.limit;
    // oldest first, ready to render top-to-bottom
    const items = rows
      .slice(0, q.limit)
      .reverse()
      .map((r) => toMessage(r.m, r.id ? userRef(r as any) : null));
    return { items, hasMore };
  });

  app.post('/conversations/:id/messages', { preHandler: [app.authenticate, sendLimit] }, async (req, reply) => {
    const id = idParam(req.params);
    const b = parse(sendSchema, req.body);
    const me = req.userId!;
    const { conv, event } = await requireMember(db, id, me);
    if (event && eventState(event).readOnly) throw forbidden('This chat is read-only');
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
      .values({ conversationId: id, senderId: me, type: 'user', text: b.text, clientId })
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
    await db.update(conversations).set({ updatedAt: inserted[0].createdAt }).where(eq(conversations.id, id));
    await db
      .update(conversationMembers)
      .set({ lastReadAt: inserted[0].createdAt })
      .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, me)));
    const msg = await broadcastMessage(app, inserted[0], userRef(sender));
    return reply.status(201).send(msg);
  });

  // Soft delete own message within 24 h. Everyone then sees a "Message deleted" placeholder.
  app.delete('/conversations/:id/messages/:messageId', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const messageId = idParam(req.params, 'messageId');
    const me = req.userId!;
    const { event } = await requireMember(db, id, me);
    if (event && eventState(event).readOnly) throw forbidden('This chat is read-only');
    const [m] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.conversationId, id)))
      .limit(1);
    if (!m) throw notFound('Message not found');
    if (m.type !== 'user' || m.senderId !== me) throw forbidden('You can only delete your own messages');
    if (m.deletedAt) return reply.status(204).send();
    if (Date.now() - m.createdAt.getTime() > DELETE_WINDOW_MS) {
      throw forbidden('Messages can only be deleted within 24 hours');
    }
    const [d] = await db
      .update(messages)
      .set({ deletedAt: new Date() })
      .where(and(eq(messages.id, messageId), isNull(messages.deletedAt)))
      .returning({ deletedAt: messages.deletedAt });
    // a deleted message can't stay pinned
    const unpinned = await db
      .update(conversations)
      .set({ pinnedMessageId: null, pinnedById: null, pinnedAt: null })
      .where(and(eq(conversations.id, id), eq(conversations.pinnedMessageId, messageId)))
      .returning({ id: conversations.id });
    if (d) {
      app.realtime.toConversation(id, 'message:deleted', {
        id: messageId,
        conversationId: id,
        deletedAt: d.deletedAt!.toISOString(),
      });
    }
    if (unpinned.length) app.realtime.toConversation(id, 'conversation:pinned', { conversationId: id, pinned: null });
    return reply.status(204).send();
  });

  // ---- pinned message (one per conversation) ----
  app.put('/conversations/:id/pin', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    const { messageId } = parse(pinSchema, req.body);
    const me = req.userId!;
    const { conv, event } = await requireMember(db, id, me);
    if (event && eventState(event).readOnly) throw forbidden('This chat is read-only');
    if (!(await canPin(db, conv, event, me))) throw forbidden('You cannot pin messages in this chat');
    const [m] = await db
      .select({ id: messages.id, deletedAt: messages.deletedAt })
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.conversationId, id)))
      .limit(1);
    if (!m) throw notFound('Message not found');
    if (m.deletedAt) throw badRequest('A deleted message cannot be pinned');
    const [updated] = await db
      .update(conversations)
      .set({ pinnedMessageId: messageId, pinnedById: me, pinnedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning();
    const pinned = await pinnedFor(db, updated, me);
    const message = await loadMessageWithSender(db, messageId);
    app.realtime.toConversation(id, 'conversation:pinned', {
      conversationId: id,
      pinned: { message, pinnedBy: me, pinnedAt: updated.pinnedAt!.toISOString() },
    });
    return { pinned };
  });

  app.delete('/conversations/:id/pin', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const me = req.userId!;
    const { conv, event } = await requireMember(db, id, me);
    if (event && eventState(event).readOnly) throw forbidden('This chat is read-only');
    if (!(await canPin(db, conv, event, me))) throw forbidden('You cannot pin messages in this chat');
    await db.update(conversations).set({ pinnedMessageId: null, pinnedById: null, pinnedAt: null }).where(eq(conversations.id, id));
    app.realtime.toConversation(id, 'conversation:pinned', { conversationId: id, pinned: null });
    return reply.status(204).send();
  });

  // ---- mute (per user) ----
  const setMute = async (conversationId: string, userId: string, muted: boolean) => {
    await requireMember(db, conversationId, userId);
    await db
      .update(conversationMembers)
      .set({ mutedAt: muted ? new Date() : null })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
    return { muted };
  };
  app.put('/conversations/:id/mute', { preHandler: app.authenticate }, async (req) =>
    setMute(idParam(req.params), req.userId!, true),
  );
  app.delete('/conversations/:id/mute', { preHandler: app.authenticate }, async (req) =>
    setMute(idParam(req.params), req.userId!, false),
  );

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

/** Membership helpers used by clan and event routes (keep sockets in sync). Call after the DB change commits. */
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
