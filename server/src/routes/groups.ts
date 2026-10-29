import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { blocks, conversationMembers, conversations, users } from '../db/schema.js';
import type { Tx } from '../db/index.js';
import { badRequest, conflict, forbidden, idParam, notFound, parse } from '../lib/errors.js';
import { deleteImage, imageUrl, MAX_UPLOAD_BYTES, processImage, saveImage } from '../lib/images.js';
import { makeLimiter } from '../lib/limits.js';
import { broadcastMessage, insertSystemMessage, type SystemKey } from '../lib/messages.js';
import { notFriends } from '../lib/friends.js';
import { conversationSummary } from './chat.js';

type ConvRow = typeof conversations.$inferSelect;
type MsgRow = Awaited<ReturnType<typeof insertSystemMessage>>;

/** Members of a group, creator included. */
export const GROUP_MAX_MEMBERS = 20;

const userIds = z
  .array(z.uuid())
  .min(1)
  .max(GROUP_MAX_MEMBERS - 1)
  .transform((ids) => [...new Set(ids.map((i) => i.toLowerCase()))]);
const groupName = z.string().trim().min(1).max(40);
const createSchema = z.object({ name: groupName, userIds }).strict();
const renameSchema = z.object({ name: groupName }).strict();
const addSchema = z.object({ userIds }).strict();

type Out = { msgs: MsgRow[]; add: string[]; remove: string[]; deleted: boolean };
const newOut = (): Out => ({ msgs: [], add: [], remove: [], deleted: false });

export async function groupRoutes(app: FastifyInstance) {
  const db = app.db;
  const createLimit = makeLimiter(app, { max: 20, timeWindow: '1 hour', key: (req) => `group:${req.userId}` });
  const editLimit = makeLimiter(app, { max: 60, timeWindow: '1 hour', key: (req) => `groupedit:${req.userId}` });
  const photoLimit = makeLimiter(app, {
    max: app.config.rateLimits.create,
    timeWindow: '1 hour',
    key: (req) => `photo:${req.userId}`,
  });

  const nameOf = async (tx: Tx, id: string) => {
    const [u] = await tx.select({ n: users.displayName }).from(users).where(eq(users.id, id));
    return u?.n ?? '';
  };
  const sys = async (tx: Tx, convId: string, out: Out, key: SystemKey, params: Record<string, unknown>) => {
    out.msgs.push(await insertSystemMessage(tx, convId, key, params));
  };
  const memberIds = async (tx: Tx, convId: string) =>
    (
      await tx
        .select({ id: conversationMembers.userId })
        .from(conversationMembers)
        .where(eq(conversationMembers.conversationId, convId))
        .orderBy(asc(conversationMembers.joinedAt), asc(conversationMembers.userId))
    ).map((r) => r.id);

  /** The new people must all be my friends, and nobody blocked anybody between me and them. */
  const checkInvitees = async (tx: Tx, me: string, ids: string[]) => {
    if (ids.includes(me)) throw badRequest('userIds: do not include yourself');
    if ((await notFriends(tx, me, ids)).length) throw forbidden('You can only add your friends to a group');
    const [b] = await tx
      .select({ x: blocks.blockerId })
      .from(blocks)
      .where(
        or(
          and(eq(blocks.blockerId, me), inArray(blocks.blockedId, ids)),
          and(eq(blocks.blockedId, me), inArray(blocks.blockerId, ids)),
        ),
      )
      .limit(1);
    if (b) throw forbidden('You can only add your friends to a group');
  };

  /** Add members one by one with clock_timestamp so join order (admin succession) is exact. */
  const insertMembers = async (tx: Tx, convId: string, ids: string[]) => {
    for (const u of ids) {
      await tx
        .insert(conversationMembers)
        .values({ conversationId: convId, userId: u, joinedAt: sql`clock_timestamp()` })
        .onConflictDoNothing();
    }
  };

  /**
   * Lock the group row and run fn. 404 if it doesn't exist, 403 if I'm not in it, 400 if it's not a group.
   * All membership / admin changes of one group go through here, one at a time.
   */
  const withGroup = async <T>(id: string, me: string, fn: (tx: Tx, c: ConvRow) => Promise<T>) =>
    db.transaction(async (tx) => {
      const [c] = await tx.select().from(conversations).where(eq(conversations.id, id)).for('update').limit(1);
      if (!c) throw notFound('Conversation not found');
      const [m] = await tx
        .select({ x: conversationMembers.userId })
        .from(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, me)));
      if (!m) throw forbidden('You are not in this conversation');
      if (c.type !== 'group') throw badRequest('Only group chats can be changed this way');
      return fn(tx, c);
    });
  const asAdmin = <T>(id: string, me: string, fn: (tx: Tx, c: ConvRow) => Promise<T>) =>
    withGroup(id, me, async (tx, c) => {
      if (c.adminId !== me) throw forbidden('Only the group admin can do this');
      return fn(tx, c);
    });

  /** Socket sync + system messages after commit. */
  const afterCommit = async (convId: string, out: Out) => {
    for (const u of out.add) app.realtime.addMember(u, convId);
    for (const m of out.msgs) await broadcastMessage(app, m, null);
    if (!out.deleted) app.realtime.toConversation(convId, 'group:updated', { conversationId: convId });
    for (const u of out.remove) {
      app.realtime.toUser(u, 'group:removed', { conversationId: convId });
      app.realtime.removeMember(u, convId);
    }
  };

  app.post('/conversations/group', { preHandler: [app.authenticate, createLimit] }, async (req, reply) => {
    const b = parse(createSchema, req.body);
    const me = req.userId!;
    const out = newOut();
    const convId = await db.transaction(async (tx) => {
      await checkInvitees(tx, me, b.userIds);
      const [c] = await tx
        .insert(conversations)
        .values({ type: 'group', name: b.name, adminId: me })
        .returning({ id: conversations.id });
      await insertMembers(tx, c.id, [me, ...b.userIds]);
      await sys(tx, c.id, out, 'group.created', { name: b.name, byUserId: me, byDisplayName: await nameOf(tx, me) });
      out.add.push(me, ...b.userIds);
      return c.id;
    });
    await afterCommit(convId, out);
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, convId));
    return reply.status(201).send(await conversationSummary(db, conv, me));
  });

  app.patch('/conversations/:id', { preHandler: [app.authenticate, editLimit] }, async (req) => {
    const id = idParam(req.params);
    const { name } = parse(renameSchema, req.body);
    const me = req.userId!;
    const out = newOut();
    await asAdmin(id, me, async (tx, c) => {
      if (c.name === name) return;
      await tx.update(conversations).set({ name }).where(eq(conversations.id, id));
      await sys(tx, id, out, 'group.renamed', { name, byUserId: me, byDisplayName: await nameOf(tx, me) });
    });
    await afterCommit(id, out);
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    return conversationSummary(db, conv, me);
  });

  app.put('/conversations/:id/avatar', { bodyLimit: MAX_UPLOAD_BYTES, preHandler: [app.authenticate, photoLimit] }, async (req) => {
    const id = idParam(req.params);
    const me = req.userId!;
    await asAdmin(id, me, async () => undefined); // cheap checks before resizing
    const processed = await processImage(req.body, 'group');
    const { imageId, old } = await asAdmin(id, me, async (tx, c) => {
      const imageId = await saveImage(tx, me, 'group', processed, c.avatarImageId);
      await tx.update(conversations).set({ avatarImageId: imageId }).where(eq(conversations.id, id));
      return { imageId, old: c.avatarImageId };
    });
    await deleteImage(db, old);
    app.realtime.toConversation(id, 'group:updated', { conversationId: id });
    return { avatarUrl: imageUrl(imageId) };
  });

  app.delete('/conversations/:id/avatar', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const old = await asAdmin(id, req.userId!, async (tx, c) => {
      await tx.update(conversations).set({ avatarImageId: null }).where(eq(conversations.id, id));
      return c.avatarImageId;
    });
    await deleteImage(db, old);
    app.realtime.toConversation(id, 'group:updated', { conversationId: id });
    return reply.status(204).send();
  });

  app.post('/conversations/:id/members', { preHandler: [app.authenticate, editLimit] }, async (req) => {
    const id = idParam(req.params);
    const b = parse(addSchema, req.body);
    const me = req.userId!;
    const out = newOut();
    await asAdmin(id, me, async (tx) => {
      const current = new Set(await memberIds(tx, id));
      const fresh = b.userIds.filter((u) => !current.has(u));
      if (!fresh.length) throw conflict('They are already in this group');
      await checkInvitees(tx, me, fresh);
      if (current.size + fresh.length > GROUP_MAX_MEMBERS) {
        throw conflict(`A group can have at most ${GROUP_MAX_MEMBERS} members`);
      }
      await insertMembers(tx, id, fresh);
      const by = await nameOf(tx, me);
      for (const u of fresh) {
        await sys(tx, id, out, 'group.added', { userId: u, displayName: await nameOf(tx, u), byUserId: me, byDisplayName: by });
      }
      out.add.push(...fresh);
    });
    await afterCommit(id, out);
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    return conversationSummary(db, conv, me);
  });

  // Admin removes someone, or anyone removes themselves (= leave).
  app.delete('/conversations/:id/members/:userId', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const target = idParam(req.params, 'userId');
    const me = req.userId!;
    const out = newOut();
    let oldAvatar: string | null = null;
    await withGroup(id, me, async (tx, c) => {
      const leaving = target === me;
      if (!leaving && c.adminId !== me) throw forbidden('Only the group admin can remove members');
      const removed = await tx
        .delete(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, target)))
        .returning({ id: conversationMembers.userId });
      if (!removed.length) throw notFound('Member not found');
      out.remove.push(target);
      const rest = await memberIds(tx, id);
      if (!rest.length) {
        // last one out: the group is gone (messages cascade)
        oldAvatar = c.avatarImageId;
        await tx.delete(conversations).where(eq(conversations.id, id));
        out.deleted = true;
        return;
      }
      const who = { userId: target, displayName: await nameOf(tx, target) };
      if (leaving) await sys(tx, id, out, 'group.left', who);
      else await sys(tx, id, out, 'group.removed', { ...who, byUserId: me, byDisplayName: await nameOf(tx, me) });
      if (c.adminId === target || c.adminId === null) {
        // longest-standing member takes over
        const next = rest[0];
        await tx.update(conversations).set({ adminId: next }).where(eq(conversations.id, id));
        await sys(tx, id, out, 'group.admin', { userId: next, displayName: await nameOf(tx, next) });
      }
    });
    await afterCommit(id, out);
    await deleteImage(db, oldAvatar);
    return reply.status(204).send();
  });
}
