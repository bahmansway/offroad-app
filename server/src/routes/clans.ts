import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { clanMembers, clanRequests, clans, conversations, users } from '../db/schema.js';
import type { Db } from '../db/index.js';
import { conflict, forbidden, idParam, notFound, parse } from '../lib/errors.js';
import { deleteImage, imageUrl, MAX_UPLOAD_BYTES, storeImage } from '../lib/images.js';
import { makeLimiter } from '../lib/limits.js';
import { isForeignKeyViolation, isUniqueViolation, userRef, userRefCols } from '../lib/users.js';
import { addConversationMember, removeConversationMembers } from './chat.js';

type ClanRow = typeof clans.$inferSelect;
type Role = 'leader' | 'member' | 'pending' | null;

const name = z.string().trim().min(3).max(40);
const tag = z
  .string()
  .trim()
  .regex(/^[\p{L}\p{N}]{2,5}$/u, 'Tag must be 2-5 letters or digits')
  .transform((t) => t.toUpperCase());
const nameKey = (n: string) => n.normalize('NFC').toLowerCase();
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : v === undefined ? undefined : null));

const createSchema = z
  .object({
    name,
    tag,
    description: z.string().trim().max(500).default(''),
    city: optText(60),
    isOpen: z.boolean().default(true),
  })
  .strict();
const patchSchema = z
  .object({
    name: name.optional(),
    tag: tag.optional(),
    description: z.string().trim().max(500).optional(),
    city: optText(60),
    isOpen: z.boolean().optional(),
  })
  .strict();
const listQuery = z.object({ q: z.string().trim().max(40).optional() });
const leaderSchema = z.object({ userId: z.uuid() }).strict();

const nameTakenError = (err: unknown) => {
  if (isUniqueViolation(err, 'clans_name_key_idx')) return conflict('A clan with this name already exists');
  if (isUniqueViolation(err, 'clans_tag_idx')) return conflict('A clan with this tag already exists');
  if (isUniqueViolation(err, 'clan_members_pkey')) return conflict('You are already in a clan');
  return null;
};

async function myRole(db: Db, clanId: string, userId: string | null): Promise<Role> {
  if (!userId) return null;
  const [m] = await db
    .select({ role: clanMembers.role })
    .from(clanMembers)
    .where(and(eq(clanMembers.userId, userId), eq(clanMembers.clanId, clanId)))
    .limit(1);
  if (m) return m.role;
  const [r] = await db
    .select({ x: clanRequests.userId })
    .from(clanRequests)
    .where(and(eq(clanRequests.clanId, clanId), eq(clanRequests.userId, userId)))
    .limit(1);
  return r ? 'pending' : null;
}

async function clanConversationId(db: Db, clanId: string) {
  const [c] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.clanId, clanId));
  return c?.id ?? null;
}

const memberCountSql = sql<number>`(select count(*)::int from ${clanMembers} m where m.clan_id = ${clans.id})`;

async function toClan(db: Db, c: ClanRow, viewerId: string | null, memberCount?: number) {
  const [leader] = await db.select(userRefCols).from(users).where(eq(users.id, c.leaderId));
  if (memberCount === undefined) {
    const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(clanMembers).where(eq(clanMembers.clanId, c.id));
    memberCount = n.n;
  }
  const role = await myRole(db, c.id, viewerId);
  return {
    id: c.id,
    name: c.name,
    tag: c.tag,
    description: c.description,
    logoUrl: imageUrl(c.logoImageId),
    city: c.city,
    isOpen: c.isOpen,
    leader: userRef(leader),
    memberCount,
    myRole: role,
    // only members get the chat id
    conversationId: role === 'leader' || role === 'member' ? await clanConversationId(db, c.id) : null,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function clanRoutes(app: FastifyInstance) {
  const db = app.db;
  const createLimit = makeLimiter(app, { max: app.config.rateLimits.create, timeWindow: '1 hour', key: (req) => `clan:${req.userId}` });
  const joinLimit = makeLimiter(app, { max: 30, timeWindow: '1 hour', key: (req) => `clanjoin:${req.userId}` });
  const logoLimit = makeLimiter(app, {
    max: app.config.rateLimits.create,
    timeWindow: '1 hour',
    key: (req) => `photo:${req.userId}`,
  });

  const loadClan = async (id: string) => {
    const [c] = await db.select().from(clans).where(eq(clans.id, id)).limit(1);
    if (!c) throw notFound('Clan not found');
    return c;
  };
  const loadLed = async (id: string, userId: string) => {
    const c = await loadClan(id);
    if (c.leaderId !== userId) throw forbidden('Only the clan leader can do this');
    return c;
  };
  /** Add a user to a clan + its chat. Throws 409 if they are already in a clan (DB-enforced). */
  const addMember = async (clanId: string, userId: string) => {
    try {
      await db.transaction(async (tx) => {
        await tx.insert(clanMembers).values({ userId, clanId, role: 'member' });
        // joined: drop every pending request this user had
        await tx.delete(clanRequests).where(eq(clanRequests.userId, userId));
      });
    } catch (err) {
      if (isUniqueViolation(err, 'clan_members_pkey')) throw conflict('This user is already in a clan');
      if (isForeignKeyViolation(err)) throw notFound('Clan not found'); // deleted meanwhile
      throw err;
    }
    const convId = await clanConversationId(db, clanId);
    if (convId) await addConversationMember(app, db, convId, userId);
  };
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
  /**
   * Run `fn` in a transaction holding a row lock on the clan, after checking the caller is still the
   * leader. Serialises leader actions (handover, removal, delete) so two can't interleave.
   */
  const asLeader = async <T>(clanId: string, userId: string, fn: (tx: Tx, clan: ClanRow) => Promise<T>) =>
    db.transaction(async (tx) => {
      const [c] = await tx.select().from(clans).where(eq(clans.id, clanId)).for('update').limit(1);
      if (!c) throw notFound('Clan not found');
      if (c.leaderId !== userId) throw forbidden('Only the clan leader can do this');
      return fn(tx, c);
    });
  /** Remove a plain member (never the leader). Returns false when there was no such member row. */
  const removeMember = async (clanId: string, userId: string, tx: Tx | Db = db) => {
    const removed = await tx
      .delete(clanMembers)
      .where(and(eq(clanMembers.clanId, clanId), eq(clanMembers.userId, userId), eq(clanMembers.role, 'member')))
      .returning({ userId: clanMembers.userId });
    return removed.length > 0;
  };
  const dropFromChat = async (clanId: string, userId: string) => {
    const convId = await clanConversationId(db, clanId);
    if (convId) await removeConversationMembers(app, db, convId, [userId]);
  };

  app.get('/clans', async (req) => {
    const q = parse(listQuery, req.query);
    const like = q.q ? `%${q.q.replace(/[\\%_]/g, (c) => '\\' + c)}%` : null;
    const rows = await db
      .select({ c: clans, n: memberCountSql })
      .from(clans)
      .where(like ? or(ilike(clans.name, like), ilike(clans.tag, like)) : undefined)
      .orderBy(desc(memberCountSql), asc(clans.name))
      .limit(50);
    return { items: await Promise.all(rows.map((r) => toClan(db, r.c, req.userId, r.n))) };
  });

  app.post('/clans', { preHandler: [app.authenticate, createLimit] }, async (req, reply) => {
    const b = parse(createSchema, req.body);
    const me = req.userId!;
    let clan: ClanRow;
    let convId: string;
    try {
      ({ clan, convId } = await db.transaction(async (tx) => {
        const [c] = await tx
          .insert(clans)
          .values({ name: b.name, nameKey: nameKey(b.name), tag: b.tag, description: b.description, city: b.city ?? null, isOpen: b.isOpen, leaderId: me })
          .returning();
        await tx.insert(clanMembers).values({ userId: me, clanId: c.id, role: 'leader' });
        await tx.delete(clanRequests).where(eq(clanRequests.userId, me));
        const [conv] = await tx.insert(conversations).values({ type: 'clan', clanId: c.id }).returning({ id: conversations.id });
        return { clan: c, convId: conv.id };
      }));
    } catch (err) {
      throw nameTakenError(err) ?? err;
    }
    await addConversationMember(app, db, convId, me);
    return reply.status(201).send(await toClan(db, clan, me, 1));
  });

  app.get('/clans/:id', async (req) => toClan(db, await loadClan(idParam(req.params)), req.userId));

  app.patch('/clans/:id', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    const b = parse(patchSchema, req.body);
    await loadLed(id, req.userId!);
    const set: Record<string, unknown> = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    if (b.name !== undefined) set.nameKey = nameKey(b.name);
    if (Object.keys(set).length) {
      try {
        await db.update(clans).set(set).where(eq(clans.id, id));
      } catch (err) {
        throw nameTakenError(err) ?? err;
      }
    }
    return toClan(db, await loadClan(id), req.userId);
  });

  app.delete('/clans/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const convId = await clanConversationId(db, id);
    const c = await asLeader(id, req.userId!, async (tx, clan) => {
      const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(clanMembers).where(eq(clanMembers.clanId, id));
      if (n.n > 1) throw conflict('Remove the other members or hand over leadership before deleting the clan');
      await tx.delete(clans).where(eq(clans.id, id)); // cascades members, requests, chat
      return clan;
    });
    if (convId) app.realtime.removeMember(req.userId!, convId);
    await deleteImage(db, c.logoImageId);
    return reply.status(204).send();
  });

  app.put('/clans/:id/logo', { bodyLimit: MAX_UPLOAD_BYTES, preHandler: [app.authenticate, logoLimit] }, async (req) => {
    const id = idParam(req.params);
    const c = await loadLed(id, req.userId!);
    const imageId = await storeImage(db, req.userId!, 'clan', req.body, c.logoImageId);
    await db.update(clans).set({ logoImageId: imageId }).where(eq(clans.id, id));
    await deleteImage(db, c.logoImageId);
    return { logoUrl: imageUrl(imageId) };
  });

  app.delete('/clans/:id/logo', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const c = await loadLed(id, req.userId!);
    await db.update(clans).set({ logoImageId: null }).where(eq(clans.id, id));
    await deleteImage(db, c.logoImageId);
    return reply.status(204).send();
  });

  // Open clan: join right away. Request clan: create a pending request for the leader.
  app.post('/clans/:id/join', { preHandler: [app.authenticate, joinLimit] }, async (req) => {
    const id = idParam(req.params);
    const me = req.userId!;
    const c = await loadClan(id);
    const [mine] = await db.select({ clanId: clanMembers.clanId }).from(clanMembers).where(eq(clanMembers.userId, me));
    if (mine) throw conflict(mine.clanId === id ? 'You are already in this clan' : 'You are already in a clan');
    if (c.isOpen) await addMember(id, me);
    else await db.insert(clanRequests).values({ clanId: id, userId: me }).onConflictDoNothing();
    return toClan(db, c, me);
  });

  // Members leave; a pending request is cancelled. The leader must hand over (or delete the clan) first.
  app.post('/clans/:id/leave', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    const me = req.userId!;
    const c = await loadClan(id);
    const role = await myRole(db, id, me);
    if (role === 'leader') throw conflict('Hand over leadership first, or delete the clan if you are the only member');
    if (role === 'member') {
      // conditional on role='member': if they were just made leader, this removes nothing
      if (!(await removeMember(id, me))) {
        // changed meanwhile: promoted to leader, or already removed
        if ((await myRole(db, id, me)) === 'leader') throw conflict('Hand over leadership first, or delete the clan if you are the only member');
        throw notFound('You are not in this clan');
      }
      await dropFromChat(id, me);
    } else if (role === 'pending') {
      await db.delete(clanRequests).where(and(eq(clanRequests.clanId, id), eq(clanRequests.userId, me)));
    } else throw notFound('You are not in this clan');
    return toClan(db, c, me);
  });

  app.get('/clans/:id/members', async (req) => {
    const id = idParam(req.params);
    await loadClan(id);
    const rows = await db
      .select({ ...userRefCols, role: clanMembers.role, joinedAt: clanMembers.joinedAt })
      .from(clanMembers)
      .innerJoin(users, eq(users.id, clanMembers.userId))
      .where(eq(clanMembers.clanId, id))
      .orderBy(sql`case when ${clanMembers.role} = 'leader' then 0 else 1 end`, asc(clanMembers.joinedAt))
      .limit(1000);
    return { items: rows.map((r) => ({ user: userRef(r), role: r.role, joinedAt: r.joinedAt.toISOString() })) };
  });

  app.get('/clans/:id/requests', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    await loadLed(id, req.userId!);
    const rows = await db
      .select({ ...userRefCols, createdAt: clanRequests.createdAt })
      .from(clanRequests)
      .innerJoin(users, eq(users.id, clanRequests.userId))
      .where(eq(clanRequests.clanId, id))
      .orderBy(asc(clanRequests.createdAt));
    return { items: rows.map((r) => ({ user: userRef(r), createdAt: r.createdAt.toISOString() })) };
  });

  const loadRequest = async (clanId: string, userId: string) => {
    const [r] = await db
      .select({ x: clanRequests.userId })
      .from(clanRequests)
      .where(and(eq(clanRequests.clanId, clanId), eq(clanRequests.userId, userId)));
    if (!r) throw notFound('Request not found');
  };

  app.post('/clans/:id/requests/:userId/approve', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const userId = idParam(req.params, 'userId');
    await loadLed(id, req.userId!);
    await loadRequest(id, userId);
    try {
      await addMember(id, userId);
    } catch (err) {
      // they joined another clan meanwhile: the request is stale
      await db.delete(clanRequests).where(and(eq(clanRequests.clanId, id), eq(clanRequests.userId, userId)));
      throw err;
    }
    return reply.status(204).send();
  });

  app.post('/clans/:id/requests/:userId/reject', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const userId = idParam(req.params, 'userId');
    await loadLed(id, req.userId!);
    await loadRequest(id, userId);
    await db.delete(clanRequests).where(and(eq(clanRequests.clanId, id), eq(clanRequests.userId, userId)));
    return reply.status(204).send();
  });

  app.delete('/clans/:id/members/:userId', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const userId = idParam(req.params, 'userId');
    if (userId === req.userId) {
      await loadLed(id, req.userId!);
      throw conflict('The leader cannot remove themselves; hand over leadership first');
    }
    const removed = await asLeader(id, req.userId!, (tx) => removeMember(id, userId, tx));
    if (!removed) throw notFound('Member not found');
    await dropFromChat(id, userId);
    return reply.status(204).send();
  });

  app.post('/clans/:id/leader', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    const { userId } = parse(leaderSchema, req.body);
    const me = req.userId!;
    if (userId === me) {
      await loadLed(id, me);
      throw conflict('You are already the leader');
    }
    await asLeader(id, me, async (tx) => {
      // conditional updates: each must hit exactly one row, otherwise roll everything back
      const promoted = await tx
        .update(clanMembers)
        .set({ role: 'leader' })
        .where(and(eq(clanMembers.clanId, id), eq(clanMembers.userId, userId), eq(clanMembers.role, 'member')))
        .returning({ u: clanMembers.userId });
      if (promoted.length !== 1) throw notFound('Member not found');
      const demoted = await tx
        .update(clanMembers)
        .set({ role: 'member' })
        .where(and(eq(clanMembers.clanId, id), eq(clanMembers.userId, me), eq(clanMembers.role, 'leader')))
        .returning({ u: clanMembers.userId });
      const moved = await tx
        .update(clans)
        .set({ leaderId: userId })
        .where(and(eq(clans.id, id), eq(clans.leaderId, me)))
        .returning({ id: clans.id });
      if (demoted.length !== 1 || moved.length !== 1) throw conflict('Leadership changed meanwhile, try again');
    });
    return toClan(db, await loadClan(id), req.userId);
  });
}
